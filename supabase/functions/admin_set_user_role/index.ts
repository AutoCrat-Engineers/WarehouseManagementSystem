/**
 * admin_set_user_role — L3 changes a user's role (L1/L2/L3).
 *
 * Strict invariants:
 *   1. Caller must be L3.
 *   2. Cannot demote yourself (would orphan the system).  Promote a
 *      successor first using a separate flow if you really need this.
 *   3. At most ONE active L3 in the system.  Promoting a new L3 while
 *      another exists requires demotion of the old one in the same
 *      atomic step (server-side: we reject; admin must demote first).
 *   4. Demoting to L1/L2 wipes any cached role-default permissions —
 *      since the new RBAC is deny-by-default, a demoted user starts with
 *      nothing until L3 grants them modules.
 *   5. The demoted-from-L3 case wipes the previous L3's user_permissions
 *      rows (cleanup) — L3 had implicit full access, so any explicit
 *      rows are stale.
 *   6. Active sessions for the target user are killed so the new role
 *      takes effect on next login (no privilege escalation across
 *      session boundaries).
 *
 * Body:    { user_id: uuid, new_role: 'L1' | 'L2' | 'L3' }
 * Returns: { success: true, prev_role, new_role, killed_sessions }
 */
import { getCorsHeaders } from '../_shared/cors.ts';
import { requireActiveSession } from '../_shared/session.ts';

const VALID_ROLES = new Set(['L1', 'L2', 'L3']);

const handler = async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req.headers.get('origin') ?? undefined);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return json(cors, { error: 'Method not allowed' }, 405);

  // L3-only.
  const session = await requireActiveSession(req, { requireRoles: ['L3'] });
  if (!session.ok) return session.response;
  const ctx = session.ctx;

  let body: any;
  try { body = await req.json(); }
  catch { return json(cors, { error: 'Invalid JSON body' }, 400); }

  const targetUserId: string = body?.user_id;
  const newRole: string = body?.new_role;

  if (!targetUserId || typeof targetUserId !== 'string') {
    return json(cors, { error: 'user_id is required' }, 400);
  }
  if (!VALID_ROLES.has(newRole)) {
    return json(cors, { error: 'new_role must be L1, L2, or L3' }, 400);
  }
  if (targetUserId === ctx.userId) {
    return json(cors, {
      error: 'Cannot change your own role from User Management.',
      code:  'SELF_ROLE_CHANGE_FORBIDDEN',
    }, 400);
  }

  // Fetch target profile.
  const { data: targetProfile, error: profileErr } = await ctx.db
    .from('profiles')
    .select('id, role, full_name, email, is_active, deleted_at')
    .eq('id', targetUserId)
    .maybeSingle();

  if (profileErr) {
    console.error('[admin_set_user_role] profile read failed:', profileErr);
    return json(cors, { error: 'Failed to load target profile.' }, 500);
  }
  if (!targetProfile) {
    return json(cors, { error: 'Target user not found.' }, 404);
  }
  if (targetProfile.deleted_at) {
    return json(cors, { error: 'Cannot change role of a deleted user.' }, 400);
  }

  const prevRole: string = targetProfile.role;

  // Idempotent: same role, nothing to do.
  if (prevRole === newRole) {
    return json(cors, { success: true, prev_role: prevRole, new_role: newRole, killed_sessions: 0, no_change: true });
  }

  // Single-L3 invariant: if promoting to L3, ensure no other active L3.
  if (newRole === 'L3') {
    const { data: existingL3, error: l3Err } = await ctx.db
      .from('profiles')
      .select('id, full_name, email')
      .eq('role', 'L3')
      .is('deleted_at', null)
      .neq('id', targetUserId);

    if (l3Err) {
      console.error('[admin_set_user_role] L3 count failed:', l3Err);
      return json(cors, { error: 'Failed to verify L3 uniqueness.' }, 500);
    }
    if (existingL3 && existingL3.length > 0) {
      const other = existingL3[0];
      return json(cors, {
        error: `Cannot have two L3 (Manager) accounts. ${other.full_name} (${other.email}) is already L3. Demote them first.`,
        code:  'L3_ALREADY_EXISTS',
        existing_l3: { id: other.id, full_name: other.full_name, email: other.email },
      }, 409);
    }
  }

  const now = new Date().toISOString();

  // Apply role change.
  const { error: updErr } = await ctx.db
    .from('profiles')
    .update({ role: newRole, updated_at: now })
    .eq('id', targetUserId);

  if (updErr) {
    console.error('[admin_set_user_role] role update failed:', updErr);
    return json(cors, { error: 'Failed to update role.', detail: updErr.message }, 500);
  }

  // If demoting from L3 → wipe stale user_permissions rows (L3 had
  // implicit full access; explicit rows are obsolete and would mislead
  // the modal next time).
  if (prevRole === 'L3' && newRole !== 'L3') {
    await ctx.db.from('user_permissions').delete().eq('user_id', targetUserId);
  }

  // Kill active sessions so the new role takes effect on next login.
  // No privilege carry-over across sessions.
  const { data: killedRows } = await ctx.db
    .from('global_sessions')
    .update({
      status:               'KILLED',
      ended_at:             now,
      ended_reason:         'ROLE_CHANGED',
      killed_by_session_id: ctx.sessionId,
    })
    .eq('user_id', targetUserId)
    .eq('status', 'ACTIVE')
    .select('id');

  if (killedRows && killedRows.length > 0) {
    // Cascade-clean any locks the user held.
    await ctx.db.from('transaction_locks').delete().eq('user_id', targetUserId);
  }

  // Audit log.
  try {
    await ctx.db.from('audit_log').insert({
      user_id:     ctx.userId,
      action:      'ROLE_CHANGED',
      target_type: 'user',
      target_id:   targetUserId,
      old_value:   { role: prevRole },
      new_value:   {
        role: newRole,
        target_email: targetProfile.email,
        target_name:  targetProfile.full_name,
        killed_sessions: killedRows?.length ?? 0,
      },
      ip_address:  req.headers.get('x-forwarded-for') ?? null,
      user_agent:  req.headers.get('user-agent') ?? null,
    });
  } catch (e) {
    console.warn('[admin_set_user_role] audit log failed:', e);
  }

  return json(cors, {
    success:         true,
    prev_role:       prevRole,
    new_role:        newRole,
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
