/**
 * perm_save_user_permissions — L3 saves grant-access changes for a user.
 *
 * Behaviour:
 *   - Replaces the user's permission set with whatever is in the request.
 *   - Modules where ALL four flags are false are DELETED from
 *     user_permissions (so the row count reflects only granted modules).
 *   - Modules with at least one true flag are upserted.
 *   - Action is rejected if target is L3 (L3 has implicit full access).
 *   - Self-edit is rejected (admin must use a 2nd L3 to edit themselves —
 *     not possible in single-L3 mode, so effectively L3 perms cannot be
 *     scoped down — by design).
 *
 * Body:
 *   {
 *     user_id: uuid,
 *     permissions: [
 *       { module_name, can_view, can_create, can_edit, can_delete,
 *         override_mode: 'grant' | 'full_control' }
 *     ]
 *   }
 *
 * Returns: { success: true, granted: number, revoked: number }
 *
 * Side-effects:
 *   - audit_log row 'PERMISSIONS_UPDATED'.
 *   - Realtime broadcasts the user_permissions row change → target user's
 *     open tabs receive it within ~1s and reload their effective set.
 */
import { getCorsHeaders } from '../_shared/cors.ts';
import { requireActiveSession } from '../_shared/session.ts';

const VALID_OVERRIDE_MODES = new Set(['grant', 'full_control']);

interface PermissionInput {
  module_name:    string;
  can_view:       boolean;
  can_create:     boolean;
  can_edit:       boolean;
  can_delete:     boolean;
  override_mode?: 'grant' | 'full_control';
}

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
  const incoming: PermissionInput[] = Array.isArray(body?.permissions) ? body.permissions : [];

  if (!targetUserId || typeof targetUserId !== 'string') {
    return json(cors, { error: 'user_id is required' }, 400);
  }
  if (targetUserId === ctx.userId) {
    return json(cors, { error: 'Cannot edit your own permissions.', code: 'SELF_EDIT_FORBIDDEN' }, 400);
  }

  // Target must exist + be L1 or L2 (L3 has implicit full access; nothing to edit).
  const { data: targetProfile, error: profileErr } = await ctx.db
    .from('profiles')
    .select('id, role, is_active')
    .eq('id', targetUserId)
    .maybeSingle();

  if (profileErr) {
    console.error('[perm_save_user_permissions] profile read failed:', profileErr);
    return json(cors, { error: 'Failed to load target profile.' }, 500);
  }
  if (!targetProfile) {
    return json(cors, { error: 'Target user not found.' }, 404);
  }
  if (targetProfile.role === 'L3') {
    return json(cors, {
      error: 'L3 has full access by design; permissions cannot be scoped down.',
      code:  'TARGET_IS_L3',
    }, 400);
  }

  // Validate every row has the expected shape.  Reject the whole batch on
  // any malformed entry — partial saves cause data integrity nightmares.
  const validModuleSet = new Set<string>();
  for (const p of incoming) {
    if (typeof p?.module_name !== 'string' || !p.module_name) {
      return json(cors, { error: 'Each permission must have a module_name' }, 400);
    }
    if (validModuleSet.has(p.module_name)) {
      return json(cors, { error: `Duplicate module: ${p.module_name}` }, 400);
    }
    validModuleSet.add(p.module_name);
    if (typeof p.can_view !== 'boolean' || typeof p.can_create !== 'boolean'
        || typeof p.can_edit !== 'boolean' || typeof p.can_delete !== 'boolean') {
      return json(cors, { error: `Permission flags must be booleans for ${p.module_name}` }, 400);
    }
    if (p.override_mode && !VALID_OVERRIDE_MODES.has(p.override_mode)) {
      return json(cors, { error: `Invalid override_mode for ${p.module_name}` }, 400);
    }
  }

  // Cross-check every module_name against module_registry to prevent
  // typos creating orphan permission rows.
  if (validModuleSet.size > 0) {
    const { data: registry, error: regErr } = await ctx.db
      .from('module_registry')
      .select('module_key')
      .in('module_key', Array.from(validModuleSet));
    if (regErr) {
      console.error('[perm_save_user_permissions] registry validation failed:', regErr);
      return json(cors, { error: 'Failed to validate modules.' }, 500);
    }
    const knownKeys = new Set((registry ?? []).map((r: any) => r.module_key));
    const unknown = Array.from(validModuleSet).filter(m => !knownKeys.has(m));
    if (unknown.length > 0) {
      return json(cors, { error: `Unknown module(s): ${unknown.join(', ')}` }, 400);
    }
  }

  const now = new Date().toISOString();

  // Split incoming into "delete" (all flags false) and "upsert" sets.
  const deleteModules: string[] = [];
  const upsertRows: Array<Record<string, unknown>> = [];

  for (const p of incoming) {
    const anyTrue = p.can_view || p.can_create || p.can_edit || p.can_delete;
    if (!anyTrue) {
      deleteModules.push(p.module_name);
      continue;
    }
    upsertRows.push({
      user_id:        targetUserId,
      module_name:    p.module_name,
      can_view:       p.can_view,
      can_create:     p.can_create,
      can_edit:       p.can_edit,
      can_delete:     p.can_delete,
      override_mode:  p.override_mode ?? 'grant',
      source_role:    targetProfile.role,
      overridden_by:  ctx.userId,
      overridden_at:  now,
      updated_at:     now,
    });
  }

  let granted = 0;
  let revoked = 0;

  // Apply deletes first so that a module flipped from "all true" to
  // "all false" doesn't transiently leave a stale row.
  if (deleteModules.length > 0) {
    const { error: delErr, count } = await ctx.db
      .from('user_permissions')
      .delete({ count: 'exact' })
      .eq('user_id', targetUserId)
      .in('module_name', deleteModules);
    if (delErr) {
      console.error('[perm_save_user_permissions] delete failed:', delErr);
      return json(cors, { error: 'Failed to revoke permissions.' }, 500);
    }
    revoked = count ?? 0;
  }

  if (upsertRows.length > 0) {
    const { error: upsertErr } = await ctx.db
      .from('user_permissions')
      .upsert(upsertRows, { onConflict: 'user_id,module_name' });
    if (upsertErr) {
      console.error('[perm_save_user_permissions] upsert failed:', upsertErr);
      return json(cors, { error: 'Failed to save permissions.', detail: upsertErr.message }, 500);
    }
    granted = upsertRows.length;
  }

  // Audit log.
  try {
    await ctx.db.from('audit_log').insert({
      user_id:     ctx.userId,
      action:      'PERMISSIONS_UPDATED',
      target_type: 'user',
      target_id:   targetUserId,
      old_value:   null,
      new_value:   { granted, revoked, modules: incoming.map(p => p.module_name) },
      ip_address:  req.headers.get('x-forwarded-for') ?? null,
      user_agent:  req.headers.get('user-agent') ?? null,
    });
  } catch (e) {
    console.warn('[perm_save_user_permissions] audit log failed:', e);
  }

  return json(cors, { success: true, granted, revoked });
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
