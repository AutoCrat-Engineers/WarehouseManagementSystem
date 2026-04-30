/**
 * im_list-items — Edge Function
 *
 * Server-side consolidation of the Item Master LIST page.  Replaces 4
 * parallel browser→DB calls with ONE edge-function call.
 *
 * WHAT IT REPLACES (UnifiedItemMaster.tsx):
 *   - fetchCounts()  → 3 HEAD count queries on `items`
 *                      (total / active / inactive) powering summary cards.
 *   - fetchItems()   → 1 GET on `items` with optional card-filter, search,
 *                      sort, and server-side pagination.
 *
 * BUSINESS LOGIC IS UNCHANGED.
 *   - Same card-filter semantics: ACTIVE → is_active=true,
 *                                 INACTIVE → is_active=false,
 *                                 ALL → no filter.
 *   - Same search: `.or()` across master_serial_no / part_number / item_name
 *                  with the SAME escaping rule (backslash + double-quote).
 *   - Same sort fallback: custom field if provided, else created_at DESC.
 *   - Same page-size-based .range() pagination.
 *
 * No RPC is used — pure direct table operations via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { getCorsHeaders } from '../_shared/cors.ts';

type CardFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
type SortDirection = 'asc' | 'desc';

interface ListItemsBody {
  page?: number;
  page_size?: number;
  card_filter?: CardFilter;
  search_term?: string;
  sort_field?: string | null;
  sort_direction?: SortDirection | null;
}

// Whitelist of columns the UI can sort by.  Guards against arbitrary
// column names reaching PostgREST.
// item_code was dropped in migration 018 — part_number is canonical.
const SORTABLE_FIELDS = new Set([
  'item_name',
  'master_serial_no',
  'part_number',
  'uom',
  'unit_price',
  'standard_cost',
  'weight',
  'lead_time_days',
  'is_active',
  'created_at',
  'updated_at',
  'revision',
]);

export async function handler(req: Request): Promise<Response> {
  const corsHeaders = getCorsHeaders(req.headers.get('origin') ?? undefined);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── AUTH ─────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(corsHeaders, { error: 'Missing authorization header' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, Deno.env.get('PUBLISHABLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authError || !user) return json(corsHeaders, { error: 'Unauthorized' }, 401);

    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── BODY ─────────────────────────────────────────────────────────
    const body: ListItemsBody = await req.json().catch(() => ({}));
    const page = Math.max(0, Number(body.page ?? 0));
    const pageSize = Math.max(1, Math.min(500, Number(body.page_size ?? 25)));
    const cardFilter: CardFilter =
      body.card_filter === 'ACTIVE' || body.card_filter === 'INACTIVE' ? body.card_filter : 'ALL';
    const searchTerm = (body.search_term || '').trim();

    // Resolve sort — fall back to created_at DESC exactly like the client.
    const rawSortField = body.sort_field || null;
    const sortField = rawSortField && SORTABLE_FIELDS.has(rawSortField) ? rawSortField : null;
    const sortAsc = body.sort_direction === 'asc';

    const safeSearch = searchTerm.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const offset = page * pageSize;

    // ── List query (identical semantics to the prior inline query) ──
    // Soft-deleted rows (deleted_at IS NOT NULL) are excluded from EVERY
    // query — migration 018 added deleted_at. An INACTIVE card shows
    // is_active=false rows that are NOT yet hard-deleted.
    let listQuery = sortField
      ? db.from('items').select('*', { count: 'exact' }).is('deleted_at', null).order(sortField, { ascending: sortAsc })
      : db.from('items').select('*', { count: 'exact' }).is('deleted_at', null).order('created_at', { ascending: false });

    if (cardFilter === 'ACTIVE') listQuery = listQuery.eq('is_active', true);
    if (cardFilter === 'INACTIVE') listQuery = listQuery.eq('is_active', false);

    if (safeSearch) {
      listQuery = listQuery.or(
        `master_serial_no.ilike."%${safeSearch}%",part_number.ilike."%${safeSearch}%",item_name.ilike."%${safeSearch}%"`,
      );
    }

    // ── Parallel: list + 3 summary counts ───────────────────────────
    // All counts also exclude soft-deleted rows.
    const [listResult, totalR, activeR, inactiveR] = await Promise.all([
      listQuery.range(offset, offset + pageSize - 1),
      db.from('items').select('id', { count: 'exact', head: true }).is('deleted_at', null),
      db.from('items').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('is_active', true),
      db.from('items').select('id', { count: 'exact', head: true }).is('deleted_at', null).eq('is_active', false),
    ]);

    if (listResult.error) throw listResult.error;

    return json(corsHeaders, {
      success: true,
      items: listResult.data || [],
      total_count: listResult.count ?? 0,
      counts: {
        total: totalR.count ?? 0,
        active: activeR.count ?? 0,
        inactive: inactiveR.count ?? 0,
      },
    });
  } catch (err: any) {
    console.error('[im_list-items] Error:', err?.message || err);
    return json(corsHeaders, { error: err?.message || 'Internal server error' }, 500);
  }
}

function json(corsHeaders: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

if (import.meta.main) Deno.serve(handler);
