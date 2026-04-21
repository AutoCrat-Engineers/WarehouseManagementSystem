/**
 * pac_dashboard_get-containers — Edge Function
 *
 * Server-side port of the "expand pallet row" drawer on the Pallet
 * Dashboard.  Returns every container assigned to a given pallet, with
 * operator name + packing_id + box_number flattened onto each row.
 *
 * WHAT IT REPLACES (packingEngineService.ts fetchPalletContainers):
 *   SELECT *, pack_containers(
 *             *,
 *             profiles!pack_containers_created_by_fkey(full_name),
 *             packing_boxes:packing_box_id(packing_id, box_number)
 *           )
 *   FROM pack_pallet_containers
 *   WHERE pallet_id = $1
 *   ORDER BY position_sequence;
 *
 * BUSINESS LOGIC IS UNCHANGED.
 *   - Same nested SELECT (pack_containers + profiles + packing_boxes).
 *   - Same ordering: position_sequence ASC.
 *   - Same enrichment shape:
 *       { ...pack_containers row,
 *         operator_name:   pack_containers.profiles.full_name,
 *         packing_id:      pack_containers.packing_boxes.packing_id,
 *         box_number:      pack_containers.packing_boxes.box_number }
 *
 * No RPC is used — pure direct table operation via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders } from '../_shared/cors.ts';

interface GetContainersBody {
  pallet_id: string;
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

    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── BODY ─────────────────────────────────────────────────────────
    const body: GetContainersBody = await req.json().catch(() => ({} as any));
    const { pallet_id: palletId } = body;
    if (!palletId) return json({ error: 'pallet_id is required' }, 400);

    // ── Nested SELECT — 1:1 port of svc.fetchPalletContainers ────────
    const { data, error } = await db
      .from('pack_pallet_containers')
      .select(`
        *,
        pack_containers (
          *,
          profiles!pack_containers_created_by_fkey (full_name),
          packing_boxes:packing_box_id (packing_id, box_number)
        )
      `)
      .eq('pallet_id', palletId)
      .order('position_sequence');

    if (error) throw error;

    const containers = ((data || []) as any[]).map((d: any) => ({
      ...d.pack_containers,
      operator_name: d.pack_containers?.profiles?.full_name,
      packing_id: d.pack_containers?.packing_boxes?.packing_id || null,
      box_number: d.pack_containers?.packing_boxes?.box_number || null,
    }));

    return json({ success: true, containers });
  } catch (err: any) {
    console.error('[pac_dashboard_get-containers] Error:', err?.message || err);
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
