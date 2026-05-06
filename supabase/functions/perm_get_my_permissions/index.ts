/**
 * perm_get_my_permissions — Returns the calling user's effective permissions.
 *
 * Strict deny-by-default RBAC:
 *   - L3  → all 4 actions on every active module in module_registry.
 *   - L1/L2 → ONLY the rows that exist in user_permissions for them.
 *             No role defaults, no GREATEST() merging, no inheritance.
 *
 * Returns the same flat shape as the legacy `get_effective_permissions` RPC
 * so the client's PermissionMap conversion stays unchanged:
 *   [
 *     { module_name, can_view, can_create, can_edit, can_delete, source },
 *     ...
 *   ]
 *
 * Where `source` is:
 *   - 'l3_full_access'  → L3 user (all true)
 *   - 'override'        → explicit row in user_permissions
 *   - 'full_control'    → explicit row with override_mode='full_control'
 *
 * No row at all is returned for modules an L1/L2 has no entry for —
 * the client treats absence as deny.
 */
import { getCorsHeaders } from '../_shared/cors.ts';
import { requireActiveSession } from '../_shared/session.ts';

interface PermRow {
  module_name:  string;
  can_view:     boolean;
  can_create:   boolean;
  can_edit:     boolean;
  can_delete:   boolean;
  source:       'l3_full_access' | 'override' | 'full_control';
}

const handler = async (req: Request): Promise<Response> => {
  const cors = getCorsHeaders(req.headers.get('origin') ?? undefined);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST' && req.method !== 'GET') {
    return json(cors, { error: 'Method not allowed' }, 405);
  }

  // Auth: any authenticated user with an active session.
  const session = await requireActiveSession(req);
  if (!session.ok) return session.response;
  const ctx = session.ctx;

  // Confirm role from the freshly-fetched profile (already done by
  // requireActiveSession via authenticateRequest).
  const role = ctx.role;
  if (!role) {
    return json(cors, { error: 'No role assigned to user.' }, 403);
  }

  let rows: PermRow[] = [];

  if (role === 'L3') {
    // L3 — full access on every active module.
    const { data: modules, error } = await ctx.db
      .from('module_registry')
      .select('module_key')
      .eq('is_active', true);

    if (error) {
      console.error('[perm_get_my_permissions] module_registry read failed:', error);
      return json(cors, { error: 'Failed to load module registry.' }, 500);
    }

    rows = (modules ?? []).map((m: any) => ({
      module_name: m.module_key,
      can_view:    true,
      can_create:  true,
      can_edit:    true,
      can_delete:  true,
      source:      'l3_full_access',
    }));
  } else {
    // L1 / L2 — strict deny-by-default.  Only explicit rows in
    // user_permissions count.  Missing modules are NOT returned, so the
    // client-side PermissionMap simply has no key for them → denied.
    const { data: overrides, error } = await ctx.db
      .from('user_permissions')
      .select('module_name, can_view, can_create, can_edit, can_delete, override_mode')
      .eq('user_id', ctx.userId);

    if (error) {
      console.error('[perm_get_my_permissions] user_permissions read failed:', error);
      return json(cors, { error: 'Failed to load permissions.' }, 500);
    }

    rows = (overrides ?? []).map((r: any) => ({
      module_name: r.module_name,
      can_view:    !!r.can_view,
      can_create:  !!r.can_create,
      can_edit:    !!r.can_edit,
      can_delete:  !!r.can_delete,
      source:      r.override_mode === 'full_control' ? 'full_control' : 'override',
    }));
  }

  return json(cors, { permissions: rows });
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
