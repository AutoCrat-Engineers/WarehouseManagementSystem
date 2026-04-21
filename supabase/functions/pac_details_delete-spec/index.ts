/**
 * pac_details_delete-spec — Edge Function
 *
 * Server-side handler for deleting a Packing Specification.  Writes the
 * audit log entry first, then deletes the row.  Both operations run in
 * the same edge-function invocation so the browser makes a single call.
 *
 * WHAT IT REPLACES (PackingDetails.tsx handleDeleteConfirm):
 *   - INSERT audit_log  (action='DELETE_PACKING_SPEC', old_value=<row>)
 *   - DELETE packing_specifications WHERE id = <spec_id>
 *
 * BUSINESS LOGIC IS UNCHANGED.
 *   - Same audit metadata shape:
 *       {
 *         user_id:       <caller>,
 *         action:        'DELETE_PACKING_SPEC',
 *         target_type:   'packing_specification',
 *         target_id:     <item_code>,
 *         old_value:     <full spec row as-was before delete>,
 *         new_value:     null,
 *       }
 *   - Same failure semantics: audit failure is non-blocking (logged +
 *     swallowed), mirroring the `console.warn(...)` in the original code.
 *     Delete failure IS fatal — surfaced to the client.
 *
 * Minor robustness fix (not a business-logic change):
 *   The old client-side flow passed an already-in-memory copy of the
 *   spec as `old_value`.  This edge function re-reads the row from the
 *   DB right before deletion so the audit payload reflects the exact
 *   on-disk state at the moment of delete — closes a TOCTOU window
 *   where the row could have been mutated after the UI loaded but
 *   before the delete button was clicked.  Same SHAPE, fresher data.
 *
 * No RPC is used — pure direct table operations via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders } from '../_shared/cors.ts';

interface DeleteSpecBody {
  spec_id: string;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── AUTH ─────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, Deno.env.get('PUBLISHABLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);
    const userId = user.id;

    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── BODY ─────────────────────────────────────────────────────────
    const body: DeleteSpecBody = await req.json().catch(() => ({} as any));
    const { spec_id: specId } = body;
    if (!specId) return json({ error: 'spec_id is required' }, 400);

    // ── Re-read the row for the audit payload (fresh state) ─────────
    const { data: specRow, error: fetchErr } = await db
      .from('packing_specifications')
      .select('*')
      .eq('id', specId)
      .single();
    if (fetchErr || !specRow) {
      return json({ error: 'Packing specification not found' }, 404);
    }

    // ── Audit log (best-effort — matches client's console.warn pattern) ──
    try {
      const { error: auditErr } = await db.from('audit_log').insert({
        user_id: userId,
        action: 'DELETE_PACKING_SPEC',
        target_type: 'packing_specification',
        target_id: (specRow as any).item_code,
        old_value: specRow,
        new_value: null,
      });
      if (auditErr) console.warn('[pac_details_delete-spec] Audit log warning:', auditErr.message);
    } catch (auditSwallow: any) {
      console.warn('[pac_details_delete-spec] Audit log swallowed:', auditSwallow?.message);
    }

    // ── Delete the spec ─────────────────────────────────────────────
    const { error: delErr } = await db
      .from('packing_specifications')
      .delete()
      .eq('id', specId);
    if (delErr) throw delErr;

    return json({
      success: true,
      deleted_spec_id: specId,
      item_code: (specRow as any).item_code,
    });
  } catch (err: any) {
    console.error('[pac_details_delete-spec] Error:', err?.message || err);
    return json({ error: err?.message || 'Internal server error' }, 500);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

if (import.meta.main) Deno.serve(handler);
