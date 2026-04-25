/**
 * sg_list-requests — Edge Function
 *
 * Server-side consolidation of the Sticker Generation LIST page (PackingModule).
 * Replaces the 11+ direct browser→DB round trips that previously fired on
 * every page open / filter change with a single edge-function call.
 *
 * WHAT IT REPLACES (client-side):
 *   - PackingModule.tsx fetchUser() profile lookup     (1 call)
 *   - PackingModule.tsx fetchRequests() count + data   (2 calls; +1 items if searching)
 *   - PackingModule.tsx fetchRequests() enrichment     (2 calls — items + packing_boxes)
 *   - PackingModule.tsx fetchSummaryCounts()           (4 parallel count calls)
 *
 * BUSINESS LOGIC IS UNCHANGED. Every filter, order, status condition, and
 * enrichment map is a 1:1 port of the client code. Optimisations are
 * server-only (single combined data+count query, single items/boxes
 * enrichment that fans in from the visible page).
 *
 * No RPC is used — pure direct table operations via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders } from '../_shared/cors.ts';

interface ListRequestsBody {
  page?: number;
  page_size?: number;
  status_filter?: string; // 'ALL' or a PackingRequestStatus
  search_term?: string;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── AUTH ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return json({ error: 'Missing authorization header' }, 401);
    }

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

    // ── BODY ──────────────────────────────────────────────────────────
    const body: ListRequestsBody = await req.json().catch(() => ({}));
    const page = Math.max(0, Number(body.page ?? 0));
    const pageSize = Math.max(1, Math.min(200, Number(body.page_size ?? 20)));
    const statusFilter = (body.status_filter || 'ALL').trim();
    const searchTerm = (body.search_term || '').trim();
    const offset = page * pageSize;

    // Escape search term exactly like the client did — preserves parity.
    const safeSearch = searchTerm.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    // ── SEARCH: resolve matching item_codes ONCE (client did this twice) ─
    // items.item_code dropped in migration 018 — part_number is canonical
    // and carries the values that the child tables (packing_requests etc.)
    // store in their `item_code` columns.
    let matchedCodes: string[] = [];
    if (safeSearch) {
      const { data: matchedItems } = await db
        .from('items')
        .select('part_number')
        .or(
          `item_name.ilike."%${safeSearch}%",master_serial_no.ilike."%${safeSearch}%",part_number.ilike."%${safeSearch}%"`,
        )
        .limit(500);
      matchedCodes = ((matchedItems || []) as any[]).map((i: any) => i.part_number);
    }

    // Helper: apply the current status+search filters to a query builder
    const applyFilters = (q: any) => {
      let out = q.neq('status', 'REJECTED');
      if (statusFilter !== 'ALL') out = out.eq('status', statusFilter);
      if (safeSearch) {
        let orStr =
          `movement_number.ilike."%${safeSearch}%",item_code.ilike."%${safeSearch}%"`;
        if (matchedCodes.length > 0) {
          const inList = matchedCodes
            .map((c) => `"${c.replace(/"/g, '\\"')}"`)
            .join(',');
          orStr += `,item_code.in.(${inList})`;
        }
        out = out.or(orStr);
      }
      return out;
    };

    // ── Parallel batch: list+count + 4 summary counts + user profile ──
    // The list query uses { count: 'exact' } so data AND total come back in
    // ONE request — saves a round-trip vs the client's count+data pattern.
    const [
      listResult,
      summaryTotal,
      summaryAwaiting,
      summaryInProgress,
      summaryCompleted,
      profileResult,
    ] = await Promise.all([
      applyFilters(db.from('packing_requests').select('*', { count: 'exact' }))
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1),

      // Summary card counts — same filter semantics as the client
      db.from('packing_requests')
        .select('id', { count: 'exact', head: true })
        .neq('status', 'REJECTED'),
      db.from('packing_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'APPROVED'),
      db.from('packing_requests')
        .select('id', { count: 'exact', head: true })
        .in('status', ['PACKING_IN_PROGRESS', 'PARTIALLY_TRANSFERRED']),
      db.from('packing_requests')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'COMPLETED'),

      db.from('profiles').select('full_name').eq('id', user.id).single(),
    ]);

    if (listResult.error) throw listResult.error;

    const rows = (listResult.data || []) as any[];
    const totalCount = listResult.count ?? 0;

    // ── Enrichment: items + packing_boxes (only for rows on this page) ──
    let enriched: any[] = rows;
    if (rows.length > 0) {
      const itemCodes = Array.from(
        new Set(rows.map((r: any) => r.item_code).filter(Boolean)),
      );
      const requestIds = rows.map((r: any) => r.id);

      // Items: one IN() query.
      // Boxes: we fetch the count PER request in parallel (one HEAD query
      // per request_id).  Why not one IN() query?  PostgREST (and/or the
      // project's max-rows setting) silently truncates multi-request fetches
      // past ~1000 rows and returns them in undefined order, which caused
      // some requests' boxes_count to display as "—" on pages where several
      // requests had hundreds of boxes between them.  HEAD + count=exact
      // returns only a count (no rows), so the row cap doesn't apply.
      // items.item_code dropped in migration 018 — look up by part_number
      // (which carries the same values since the FK-ed child tables point at
      // part_number). Alias part_number AS item_code so downstream code
      // continues to index by `i.item_code`.
      const itemsPromise = itemCodes.length > 0
        ? db.from('items')
            .select('item_name, master_serial_no, item_code:part_number')
            .in('part_number', itemCodes)
        : Promise.resolve({ data: [] as any[] });

      const boxCountPromises = requestIds.map((rid: string) =>
        db.from('packing_boxes')
          .select('id', { count: 'exact', head: true })
          .eq('packing_request_id', rid)
          .then((r: any) => ({ rid, count: r.count ?? 0 })),
      );

      const [itemsResult, ...boxCountResults] = await Promise.all([
        itemsPromise,
        ...boxCountPromises,
      ]);

      const itemMap: Record<string, { item_name: string; master_serial_no: string | null }> = {};
      ((itemsResult.data || []) as any[]).forEach((i: any) => {
        itemMap[i.item_code] = {
          item_name: i.item_name,
          master_serial_no: i.master_serial_no,
        };
      });

      const boxAgg: Record<string, number> = {};
      for (const r of boxCountResults as Array<{ rid: string; count: number }>) {
        boxAgg[r.rid] = r.count;
      }

      enriched = rows.map((r: any) => ({
        ...r,
        item_name: itemMap[r.item_code]?.item_name || r.item_code,
        master_serial_no: itemMap[r.item_code]?.master_serial_no || null,
        // Preserve original UI semantics: null → "—" for "no boxes yet"
        // (e.g. PENDING requests), positive integer for actual counts.
        boxes_count: (boxAgg[r.id] ?? 0) > 0 ? boxAgg[r.id] : null,
      }));
    }

    return json({
      success: true,
      summary: {
        total: summaryTotal.count ?? 0,
        awaiting: summaryAwaiting.count ?? 0,
        inProgress: summaryInProgress.count ?? 0,
        completed: summaryCompleted.count ?? 0,
      },
      requests: enriched,
      total_count: totalCount,
      current_user_name: (profileResult.data as any)?.full_name || '',
    });
  } catch (err: any) {
    console.error('[sg_list-requests] Error:', err);
    return json({ error: err.message || 'Internal server error' }, 500);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

if (import.meta.main) Deno.serve(handler);
