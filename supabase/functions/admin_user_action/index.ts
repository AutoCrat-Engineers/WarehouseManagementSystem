/**
 * admin_user_action — L3-gated user lifecycle endpoint.
 *
 * One endpoint for the two destructive admin operations on a profile:
 *   action: 'deactivate' — sets is_active=false, locked_at=now(),
 *                          lock_reason='ADMIN_DEACTIVATED', kills sessions.
 *   action: 'delete'     — soft-delete: sets deleted_at, is_active=false,
 *                          locked_at=now(), lock_reason='ADMIN_DELETED',
 *                          kills sessions.
 *
 * Atomicity:
 *   1) Profile fields are updated first (so subsequent logins are rejected
 *      by auth-login's pre-flight check).
 *   2) global_sessions UPDATE flips status='KILLED' with the right reason
 *      so the victim's open tabs receive a Realtime push and log out
 *      with the "Account locked, contact admin" banner.
 *   3) transaction_locks held by killed sessions are cleared.
 *
 * Authorization:
 *   - Caller MUST be L3 (verified via requireActiveSession + role check).
 *   - Self-action is rejected ("Cannot deactivate/delete your own account").
 *
 * Body: { user_id: uuid, action: 'deactivate' | 'delete', reason?: string }
 * Returns: { success: true, killed_count: number }
 */
import { getCorsHeaders } from '../_shared/cors.ts';
import { requireActiveSession } from '../_shared/session.ts';

const ACTIONS = new Set(['deactivate', 'delete']);

const handler = async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req.headers.get('origin') ?? undefined);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  // Caller must be authenticated AND L3.
  const session = await requireActiveSession(req, { requireRoles: ['L3'] });
  if (!session.ok) return session.response;
  const ctx = session.ctx;

  let body: any;
  try { body = await req.json(); }
  catch { return json(cors, { error: 'Invalid JSON body' }, 400); }

  const targetUserId: string | undefined = body?.user_id;
  const action: string = body?.action;
  const reason: string | null = body?.reason ?? null;

  if (!targetUserId || typeof targetUserId !== 'string') {
    return json(cors, { error: 'user_id is required' }, 400);
  }
  if (!ACTIONS.has(action)) {
    return json(cors, { error: "action must be 'deactivate' or 'delete'" }, 400);
  }
  if (targetUserId === ctx.userId) {
    return json(cors, { error: `Cannot ${action} your own account.` }, 400);
  }

  const now = new Date().toISOString();
  const lockReason = action === 'delete' ? 'ADMIN_DELETED' : 'ADMIN_DEACTIVATED';

  // 1. Lock the profile so future logins are rejected by auth-login.
  const update: Record<string, unknown> = {
    is_active:   false,
    locked_at:   now,
    lock_reason: lockReason,
    updated_at:  now,
  };
  if (action === 'delete') {
    update.deleted_at = now;
  }

  const { error: profErr } = await ctx.db
    .from('profiles')
    .update(update)
    .eq('id', targetUserId);

  if (profErr) {
    console.error('[admin_user_action] profile update failed:', profErr);
    return json(cors, { error: 'Failed to update profile.', details: profErr.message }, 500);
  }

  // 2. Kill any active sessions for this user — Realtime broadcasts the
  //    UPDATE event to the victim's open tabs so they log out instantly.
  const { data: killedRows, error: killErr } = await ctx.db
    .from('global_sessions')
    .update({
      status:               'KILLED',
      ended_at:             now,
      ended_reason:         lockReason,
      killed_by_session_id: ctx.sessionId,
    })
    .eq('user_id', targetUserId)
    .eq('status', 'ACTIVE')
    .select('id');

  if (killErr) {
    console.warn('[admin_user_action] session kill failed:', killErr);
  }

  // 3. Release any locks held by the killed sessions (defensive — the
  //    next login by anyone would skip the SESSION_BUSY check anyway).
  if (killedRows && killedRows.length > 0) {
    await ctx.db
      .from('transaction_locks')
      .delete()
      .eq('user_id', targetUserId);
  }

  // 4. Audit log.
  try {
    await ctx.db.from('audit_log').insert({
      user_id:     ctx.userId,
      action:      action === 'delete' ? 'USER_DELETE' : 'USER_DEACTIVATE',
      target_type: 'user',
      target_id:   targetUserId,
      old_value:   null,
      new_value:   {
        action, reason,
        lock_reason: lockReason,
        killed_count: killedRows?.length ?? 0,
      },
    });
  } catch (e) {
    console.warn('[admin_user_action] audit log failed:', e);
  }

  return json(cors, {
    success:      true,
    action,
    user_id:      targetUserId,
    killed_count: killedRows?.length ?? 0,
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
