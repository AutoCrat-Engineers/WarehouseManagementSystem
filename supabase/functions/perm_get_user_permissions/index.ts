/**
 * perm_get_user_permissions — L3 fetches a target user's permissions for
 * the Grant Access modal.
 *
 * Body: { user_id: uuid }
 * Returns:
 *   {
 *     target_role:  'L1' | 'L2' | 'L3',
 *     permissions:  [ { module_name, can_view, can_create, can_edit, can_delete, override_mode } ],
 *     all_modules:  [ { module_key, display_name, parent_module, is_active } ]
 *   }
 *
 * The modal renders all_modules as the master list and overlays
 * permissions to set initial checkbox state.  Modules with no row in
 * permissions are unchecked (deny-by-default).
 */
import { getCorsHeaders } from '../_shared/cors.ts';
import { requireActiveSession } from '../_shared/session.ts';

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

  const targetUserId = body?.user_id;
  if (typeof targetUserId !== 'string' || !targetUserId) {
    return json(cors, { error: 'user_id is required' }, 400);
  }

  // Target profile (so we know if they're L3 — modal renders read-only).
  const { data: targetProfile, error: profileErr } = await ctx.db
    .from('profiles')
    .select('id, role')
    .eq('id', targetUserId)
    .maybeSingle();

  if (profileErr) {
    console.error('[perm_get_user_permissions] profile read failed:', profileErr);
    return json(cors, { error: 'Failed to load target profile.' }, 500);
  }
  if (!targetProfile) {
    return json(cors, { error: 'Target user not found.' }, 404);
  }

  // Active modules from registry (master list for the modal).
  const { data: modules, error: modErr } = await ctx.db
    .from('module_registry')
    .select('module_key, display_name, parent_module, is_active, sort_order')
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  if (modErr) {
    console.error('[perm_get_user_permissions] module_registry read failed:', modErr);
    return json(cors, { error: 'Failed to load module registry.' }, 500);
  }

  // Existing overrides for this user.
  const { data: overrides, error: permErr } = await ctx.db
    .from('user_permissions')
    .select('module_name, can_view, can_create, can_edit, can_delete, override_mode')
    .eq('user_id', targetUserId);

  if (permErr) {
    console.error('[perm_get_user_permissions] user_permissions read failed:', permErr);
    return json(cors, { error: 'Failed to load user permissions.' }, 500);
  }

  return json(cors, {
    target_role: targetProfile.role,
    permissions: overrides ?? [],
    all_modules: modules ?? [],
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
