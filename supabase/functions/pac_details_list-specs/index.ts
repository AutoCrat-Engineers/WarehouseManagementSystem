/**
 * pac_details_list-specs — Edge Function
 *
 * Server-side consolidation of the Packing Details (Packing Specifications
 * Management) LIST page.  Replaces 4 parallel browser→DB calls with ONE
 * edge-function call.
 *
 * WHAT IT REPLACES (PackingDetails.tsx):
 *   - fetchCounts()  → 3 HEAD count queries on `packing_specifications`
 *                      (total / active / inactive) for summary cards.
 *   - fetchSpecs()   → 1 GET on `packing_specifications` with inner join
 *                      on `items`, optional search + active-status filter,
 *                      server-side pagination.
 *
 * BUSINESS LOGIC IS UNCHANGED.
 *   - Same status filter semantics: 'ACTIVE' → is_active=true,
 *     'INACTIVE' → is_active=false, 'ALL' → no filter.
 *   - Same search escaping (backslash + double-quote) applied to the
 *     PostgREST .or() filter on the joined `items` table.
 *   - Same ordering: created_at DESC.
 *   - Same page size + range.
 *   - Same enrichment shape: item_name / master_serial_no / part_number /
 *     revision flattened onto each spec row.
 *
 * No RPC is used — pure direct table operations via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders } from '../_shared/cors.ts';

interface ListSpecsBody {
  page?: number;
  page_size?: number;
  card_filter?: 'ALL' | 'ACTIVE' | 'INACTIVE';
  search_term?: string;
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
    const body: ListSpecsBody = await req.json().catch(() => ({}));
    const page = Math.max(0, Number(body.page ?? 0));
    const pageSize = Math.max(1, Math.min(200, Number(body.page_size ?? 20)));
    const cardFilter: 'ALL' | 'ACTIVE' | 'INACTIVE' =
      body.card_filter === 'ACTIVE' || body.card_filter === 'INACTIVE' ? body.card_filter : 'ALL';
    const searchTerm = (body.search_term || '').trim();
    const offset = page * pageSize;

    // Escape search term identically to the client — preserves parity
    // with PostgREST .or() grammar (comma + parentheses delimiters).
    const safeSearch = searchTerm.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    // ── List query builder (paginated + filtered + searched) ────────
    let listQuery = db
      .from('packing_specifications')
      .select(
        '*, items!inner(item_name, master_serial_no, part_number, revision)',
        { count: 'exact' },
      )
      .order('created_at', { ascending: false });

    if (cardFilter === 'ACTIVE') listQuery = listQuery.eq('is_active', true);
    if (cardFilter === 'INACTIVE') listQuery = listQuery.eq('is_active', false);

    if (safeSearch) {
      listQuery = listQuery.or(
        `item_code.ilike."%${safeSearch}%",item_name.ilike."%${safeSearch}%",` +
          `master_serial_no.ilike."%${safeSearch}%",part_number.ilike."%${safeSearch}%"`,
        { referencedTable: 'items' },
      );
    }

    // ── Parallel: list (with paginated data + exact count) + 3 summary counts ─
    const [listResult, totalResult, activeResult, inactiveResult] = await Promise.all([
      listQuery.range(offset, offset + pageSize - 1),
      db.from('packing_specifications').select('id', { count: 'exact', head: true }),
      db.from('packing_specifications').select('id', { count: 'exact', head: true }).eq('is_active', true),
      db.from('packing_specifications').select('id', { count: 'exact', head: true }).eq('is_active', false),
    ]);

    if (listResult.error) throw listResult.error;

    const specs = ((listResult.data || []) as any[]).map((r: any) => ({
      ...r,
      item_name: r.items?.item_name,
      master_serial_no: r.items?.master_serial_no,
      part_number: r.items?.part_number,
      revision: r.items?.revision,
    }));

    return json({
      success: true,
      specs,
      total_count: listResult.count ?? 0,
      summary: {
        total: totalResult.count ?? 0,
        active: activeResult.count ?? 0,
        inactive: inactiveResult.count ?? 0,
      },
    });
  } catch (err: any) {
    console.error('[pac_details_list-specs] Error:', err?.message || err);
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
