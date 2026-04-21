/**
 * pac_dashboard_list-pallets — Edge Function
 *
 * Server-side consolidation of the Pallet Dashboard LIST page.  Replaces
 * the 9 parallel browser→DB calls that previously fired on every open /
 * filter / page change with ONE edge-function call.
 *
 * WHAT IT REPLACES (PalletDashboard.tsx):
 *   - fetchCounts()  → 7 HEAD count queries on `pack_pallets`
 *                      (total / READY / OPEN / FILLING / ADJUSTMENT_REQUIRED /
 *                      DISPATCHED / IN_TRANSIT), aggregated into 5 cards.
 *   - fetchData()    → 1 GET on `pack_pallets` with items inner-join +
 *                      optional state filter + optional date range,
 *                      server-side pagination.
 *   - Container pre-fetch → 1 GET on `pack_pallet_containers` with nested
 *                      pack_containers/packing_boxes, used by the client-
 *                      side search to match container numbers + packing IDs.
 *
 * BUSINESS LOGIC IS UNCHANGED.
 *   - Same card aggregation: filling = OPEN + FILLING;
 *                             dispatched = DISPATCHED + IN_TRANSIT.
 *   - Same filters: state equality; created_at gte(from) / lte(to + 23:59:59).
 *   - Same ordering: created_at DESC.
 *   - Same enrichment: items.item_name / master_serial_no / part_number
 *     flattened onto each pallet row.
 *   - Same container_id_map shape: lowercased list of container_number and
 *     packing_id per pallet_id (used verbatim by the client-side search
 *     filter).
 *
 * No RPC is used — pure direct table operations via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders } from '../_shared/cors.ts';

type PalletStateFilter =
  | 'ALL'
  | 'OPEN'
  | 'FILLING'
  | 'READY'
  | 'ADJUSTMENT_REQUIRED'
  | 'DISPATCHED'
  | 'IN_TRANSIT'
  | 'LOCKED'
  | 'CANCELLED';

interface ListPalletsBody {
  page?: number;
  page_size?: number;
  state_filter?: PalletStateFilter;
  date_from?: string | null;
  date_to?: string | null;
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
    const body: ListPalletsBody = await req.json().catch(() => ({}));
    const page = Math.max(0, Number(body.page ?? 0));
    const pageSize = Math.max(1, Math.min(200, Number(body.page_size ?? 20)));
    const stateFilter: PalletStateFilter = (body.state_filter || 'ALL') as PalletStateFilter;
    const dateFrom = body.date_from || null;
    const dateTo = body.date_to || null;
    const offset = page * pageSize;

    // ── List query builder (state + date filters) ───────────────────
    let listQuery = db
      .from('pack_pallets')
      .select(
        '*, items!pack_pallets_item_id_fkey(item_name, master_serial_no, part_number)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false });

    if (stateFilter !== 'ALL') listQuery = listQuery.eq('state', stateFilter);
    if (dateFrom) listQuery = listQuery.gte('created_at', dateFrom);
    if (dateTo) listQuery = listQuery.lte('created_at', dateTo + 'T23:59:59');

    // ── Parallel: list + 7 card-count queries ────────────────────────
    const [
      listResult,
      totalR,
      readyR,
      openR,
      fillingR,
      adjR,
      dispatchedR,
      inTransitR,
    ] = await Promise.all([
      listQuery.range(offset, offset + pageSize - 1),
      db.from('pack_pallets').select('id', { count: 'exact', head: true }),
      db.from('pack_pallets').select('id', { count: 'exact', head: true }).eq('state', 'READY'),
      db.from('pack_pallets').select('id', { count: 'exact', head: true }).eq('state', 'OPEN'),
      db.from('pack_pallets').select('id', { count: 'exact', head: true }).eq('state', 'FILLING'),
      db.from('pack_pallets').select('id', { count: 'exact', head: true }).eq('state', 'ADJUSTMENT_REQUIRED'),
      db.from('pack_pallets').select('id', { count: 'exact', head: true }).eq('state', 'DISPATCHED'),
      db.from('pack_pallets').select('id', { count: 'exact', head: true }).eq('state', 'IN_TRANSIT'),
    ]);

    if (listResult.error) throw listResult.error;

    const pallets = ((listResult.data || []) as any[]).map((r: any) => ({
      ...r,
      item_name: r.items?.item_name,
      master_serial_no: r.items?.master_serial_no,
      part_number: r.items?.part_number,
    }));

    // ── Container ID map for client-side search ─────────────────────
    // Returns { [pallet_id]: lowercased [container_number, packing_id, ...] }
    // Matches the exact shape the UI's client-side search filter expects.
    // `.range(0, 99999)` lifts the default 1000-row cap for safety when a
    // page has many pallets with many containers each.
    let containerIdMap: Record<string, string[]> = {};
    const palletIds = pallets.map((p) => p.id);
    if (palletIds.length > 0) {
      const { data: pcData } = await db
        .from('pack_pallet_containers')
        .select(
          'pallet_id, pack_containers(container_number, packing_boxes:packing_box_id(packing_id))',
        )
        .in('pallet_id', palletIds)
        .range(0, 99999);

      for (const row of (pcData || []) as any[]) {
        const pid = row.pallet_id as string;
        const ctn = row.pack_containers?.container_number || '';
        const pkgId = row.pack_containers?.packing_boxes?.packing_id || '';
        if (!containerIdMap[pid]) containerIdMap[pid] = [];
        if (ctn) containerIdMap[pid].push(String(ctn).toLowerCase());
        if (pkgId) containerIdMap[pid].push(String(pkgId).toLowerCase());
      }
    }

    return json({
      success: true,
      pallets,
      total_count: listResult.count ?? 0,
      counts: {
        total: totalR.count ?? 0,
        ready: readyR.count ?? 0,
        filling: (openR.count ?? 0) + (fillingR.count ?? 0),
        adjustment: adjR.count ?? 0,
        dispatched: (dispatchedR.count ?? 0) + (inTransitR.count ?? 0),
      },
      container_id_map: containerIdMap,
    });
  } catch (err: any) {
    console.error('[pac_dashboard_list-pallets] Error:', err?.message || err);
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
