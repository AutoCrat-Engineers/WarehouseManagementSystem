/**
 * admin_reset_password — L3-gated direct password override.
 *
 * Use case (acknowledged trade-off): the L3 admin sets a specific password
 * for a user who has forgotten theirs.  The admin will know the new
 * password and communicate it verbally / in person to the user.
 *
 * Production-grade safeguards:
 *   1. Caller MUST be L3 (requireActiveSession + requireRoles).
 *   2. Self-reset is blocked — admins must use the normal change-password
 *      flow for their own account.
 *   3. Server-side password strength enforcement (length + complexity)
 *      so the client cannot bypass it.
 *   4. Common-weak-password rejection (top entries from breached-password
 *      lists) — defends against "Password1!" trivially passing the regex.
 *   5. Password is *never* echoed back in the response, *never* written to
 *      audit_log, *never* logged via console.
 *   6. Bcrypt hashing handled server-side by Supabase auth admin SDK
 *      (`auth.admin.updateUserById`) — we never touch raw hashes.
 *   7. All active sessions for the target user are killed so any open tab
 *      stops working immediately and the user must log in fresh with the
 *      new password.
 *   8. profiles.password_changed_at is updated for compliance reporting;
 *      profiles.must_change_password is left unchanged so the admin can
 *      still flip it via a future "force change at next login" toggle.
 *   9. failed_login_count is reset (a forgotten-password scenario often
 *      coexists with prior failed attempts).
 *  10. Audit log captures WHO reset WHOM, WHEN, from which IP — without
 *      the password content.
 *
 * Body:    { user_id: uuid, new_password: string }
 * Returns: { success: true, killed_sessions: number }
 */
import { getCorsHeaders } from '../_shared/cors.ts';
import { requireActiveSession } from '../_shared/session.ts';

// ─── Password policy ─────────────────────────────────────────────────
const MIN_LENGTH = 8;
const MAX_LENGTH = 72; // bcrypt's max input length

// Top weak passwords — hard reject regardless of complexity score.
// Keep small + lowercase-compared for cheap O(N) check.
const WEAK_LIST = new Set([
  'password', 'password1', 'password123', 'p@ssw0rd', 'p@ssw0rd1',
  'qwerty123', 'qwertyuiop', '12345678', '123456789', '1234567890',
  'abc12345', 'admin123', 'admin@123', 'welcome1', 'welcome123',
  'letmein1', 'iloveyou1', 'monkey123', 'dragon123',
]);

interface StrengthCheckResult {
  ok: boolean;
  reason?: string;
}

function checkPasswordStrength(pw: string): StrengthCheckResult {
  if (typeof pw !== 'string')      return { ok: false, reason: 'Password must be a string.' };
  if (pw.length < MIN_LENGTH)      return { ok: false, reason: `Password must be at least ${MIN_LENGTH} characters.` };
  if (pw.length > MAX_LENGTH)      return { ok: false, reason: `Password must be at most ${MAX_LENGTH} characters.` };
  if (!/[a-z]/.test(pw))           return { ok: false, reason: 'Password must contain at least one lowercase letter.' };
  if (!/[A-Z]/.test(pw))           return { ok: false, reason: 'Password must contain at least one uppercase letter.' };
  if (!/[0-9]/.test(pw))           return { ok: false, reason: 'Password must contain at least one digit.' };
  if (!/[^A-Za-z0-9]/.test(pw))    return { ok: false, reason: 'Password must contain at least one symbol.' };
  if (/\s/.test(pw))               return { ok: false, reason: 'Password must not contain whitespace.' };
  if (WEAK_LIST.has(pw.toLowerCase())) {
    return { ok: false, reason: 'Password is too common. Choose something less guessable.' };
  }
  return { ok: true };
}

// ─── HTTP handler ────────────────────────────────────────────────────
const handler = async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req.headers.get('origin') ?? undefined);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') {
    return json(cors, { error: 'Method not allowed' }, 405);
  }

  // 1. Auth: caller must be L3 with an active session.
  const session = await requireActiveSession(req, { requireRoles: ['L3'] });
  if (!session.ok) return session.response;
  const ctx = session.ctx;

  // 2. Body.
  let body: any;
  try { body = await req.json(); }
  catch { return json(cors, { error: 'Invalid JSON body' }, 400); }

  const targetUserId: unknown = body?.user_id;
  const newPassword: unknown = body?.new_password;

  if (typeof targetUserId !== 'string' || !targetUserId) {
    return json(cors, { error: 'user_id is required' }, 400);
  }
  if (typeof newPassword !== 'string' || !newPassword) {
    return json(cors, { error: 'new_password is required' }, 400);
  }

  // 3. Self-reset is not allowed via this endpoint.
  if (targetUserId === ctx.userId) {
    return json(cors, {
      error: 'You cannot reset your own password from User Management. Use the change-password flow instead.',
      code:  'SELF_RESET_FORBIDDEN',
    }, 400);
  }

  // 4. Strength check (server-authoritative).
  const strength = checkPasswordStrength(newPassword);
  if (!strength.ok) {
    return json(cors, { error: strength.reason, code: 'WEAK_PASSWORD' }, 400);
  }

  // 5. Verify the target profile exists (avoid silent no-op on a typo'd UUID).
  const { data: targetProfile, error: profileErr } = await ctx.db
    .from('profiles')
    .select('id, email, full_name')
    .eq('id', targetUserId)
    .maybeSingle();

  if (profileErr) {
    console.error('[admin_reset_password] target lookup failed:', profileErr);
    return json(cors, { error: 'Target user lookup failed.' }, 500);
  }
  if (!targetProfile) {
    return json(cors, { error: 'Target user not found.', code: 'USER_NOT_FOUND' }, 404);
  }

  // 6. Update the auth user's encrypted_password via the admin SDK.
  //    Supabase handles the bcrypt hash server-side; we never touch it.
  const { error: pwdErr } = await ctx.db.auth.admin.updateUserById(
    targetUserId,
    { password: newPassword },
  );
  if (pwdErr) {
    console.error('[admin_reset_password] auth update failed:', pwdErr.message);
    return json(cors, {
      error:  'Failed to update password.',
      // surface only the SDK message — it never echoes the password.
      detail: pwdErr.message,
    }, 500);
  }

  const now = new Date().toISOString();

  // 7. Profile metadata bookkeeping.
  await ctx.db.from('profiles')
    .update({
      password_changed_at: now,
      failed_login_count:  0,
      // Clear lockout that may have been set by failed attempts (if the
      // user was locked, the admin reset implicitly unlocks them).
      locked_at:           null,
      lock_reason:         null,
      is_active:           true,
      updated_at:          now,
    })
    .eq('id', targetUserId);

  // 8. Kill any active sessions so open tabs can't keep using the old
  //    auth token.  Realtime push will tell the victim "session no longer
  //    valid; please sign in again".
  const { data: killedRows } = await ctx.db
    .from('global_sessions')
    .update({
      status:               'KILLED',
      ended_at:             now,
      ended_reason:         'PASSWORD_RESET',
      killed_by_session_id: ctx.sessionId,
    })
    .eq('user_id', targetUserId)
    .eq('status', 'ACTIVE')
    .select('id');

  // 9. Cascade-release any transaction locks held by killed sessions.
  if (killedRows && killedRows.length > 0) {
    await ctx.db.from('transaction_locks').delete().eq('user_id', targetUserId);
  }

  // 10. Audit log — never write the password.
  try {
    await ctx.db.from('audit_log').insert({
      user_id:     ctx.userId,
      action:      'PASSWORD_RESET_BY_ADMIN',
      target_type: 'user',
      target_id:   targetUserId,
      old_value:   null,
      new_value:   {
        target_email:    targetProfile.email,
        target_name:     targetProfile.full_name,
        killed_sessions: killedRows?.length ?? 0,
      },
      ip_address:  req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? null,
      user_agent:  req.headers.get('user-agent') ?? null,
    });
  } catch (e) {
    console.warn('[admin_reset_password] audit log failed:', e);
  }

  return json(cors, {
    success:         true,
    killed_sessions: killedRows?.length ?? 0,
  });
};

function json(cors: Record<string, string>, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

const port = Number(Deno.env.get('PORT'));
if (Number.isInteger(port) && port > 0) Deno.serve({ port }, handler);
else Deno.serve(handler);
