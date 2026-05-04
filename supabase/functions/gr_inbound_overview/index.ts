/**
 * gr_inbound_overview — Edge Function
 *
 * Companion to `shipment_dashboard_list`. Returns the *today-focused* KPIs
 * and the list of in-progress receive drafts so the inbound dashboard can
 * render draft badges and a "Resume" affordance on shipment cards.
 *
 * KPIs are computed against the full population (not the paginated slice
 * the list endpoint returns), so they're stable while the user paginates.
 *
 * INPUT:  {}  (no params; everything is scoped to "today" in server tz +
 *              the caller's identity)
 * OUTPUT:
 *   {
 *     kpis: {
 *       trucks_today:        number,   // PIs dispatched/stock_moved today
 *       in_progress:         number,   // PIs with at least one draft (any user)
 *       done_today:          number,   // GRs created today
 *       discrepancies_open:  number,   // GRs with missing+damaged > 0
 *     },
 *     my_drafts: [
 *       { proforma_invoice_id, mpl_id, updated_at, version,
 *         proforma_number, shipment_number, mpl_number }
 *     ],
 *     active_drafts_by_pi: {
 *       [proforma_invoice_id]: {
 *         total_drafts: number,
 *         my_drafts:    number,
 *         other_users:  number,        // drafts owned by people other than caller
 *         latest_at:    iso,           // most-recent updated_at across all drafts on this PI
 *       }
 *     }
 *   }
 *
 * Costs: ~4 light queries against indexed columns. Fine to refresh on every
 * dashboard refocus.
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    // ── Anchor "today" in UTC for now. A future slice can pass a tz so the
    //    cutoff matches the user's wall clock. UTC is fine for the KPI
    //    headline; per-shipment rendering uses local Date formatters anyway.
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const startIso = startOfToday.toISOString();

    // ── 1. Trucks expected/arriving today
    const trucksToday = await ctx.db
        .from('pack_proforma_invoices')
        .select('id', { count: 'exact', head: true })
        .in('status', ['STOCK_MOVED', 'DISPATCHED', 'RECEIVED'])
        .gte('stock_moved_at', startIso);

    // ── 2. GRs created today (done today)
    const doneToday = await ctx.db
        .from('goods_receipts')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', startIso);

    // ── 3. Open discrepancies — GRs with missing/damaged
    const discrepancies = await ctx.db
        .from('goods_receipts')
        .select('id', { count: 'exact', head: true })
        .or('total_pallets_missing.gt.0,total_pallets_damaged.gt.0');

    // ── 4. Drafts (mine + others) — full list, small table, no pagination
    const allDrafts = await ctx.db
        .from('gr_drafts')
        .select('id, user_id, proforma_invoice_id, mpl_id, updated_at, version');

    const draftRows = (allDrafts.data ?? []) as Array<{
        id: string; user_id: string; proforma_invoice_id: string;
        mpl_id: string; updated_at: string; version: number;
    }>;

    // Aggregate per PI
    const byPi = new Map<string, { total: number; mine: number; others: number; latest: string }>();
    for (const d of draftRows) {
        const cur = byPi.get(d.proforma_invoice_id) ?? { total: 0, mine: 0, others: 0, latest: '' };
        cur.total += 1;
        if (d.user_id === ctx.userId) cur.mine += 1;
        else                          cur.others += 1;
        if (!cur.latest || d.updated_at > cur.latest) cur.latest = d.updated_at;
        byPi.set(d.proforma_invoice_id, cur);
    }

    const inProgress = byPi.size;

    // Hydrate "my drafts" with proforma + mpl labels for the resume list
    const myDrafts = draftRows.filter(d => d.user_id === ctx.userId);
    const piIds  = Array.from(new Set(myDrafts.map(d => d.proforma_invoice_id)));
    const mplIds = Array.from(new Set(myDrafts.map(d => d.mpl_id)));

    const [{ data: pis }, { data: mpls }] = await Promise.all([
        piIds.length > 0
            ? ctx.db.from('pack_proforma_invoices').select('id, proforma_number, shipment_number').in('id', piIds)
            : Promise.resolve({ data: [] }),
        mplIds.length > 0
            ? ctx.db.from('master_packing_lists').select('id, mpl_number').in('id', mplIds)
            : Promise.resolve({ data: [] }),
    ]);

    const piById  = new Map((pis  ?? []).map((r: any) => [r.id, r]));
    const mplById = new Map((mpls ?? []).map((r: any) => [r.id, r]));

    const my_drafts = myDrafts
        .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
        .map(d => {
            const pi  = piById.get(d.proforma_invoice_id);
            const mpl = mplById.get(d.mpl_id);
            return {
                proforma_invoice_id: d.proforma_invoice_id,
                mpl_id:              d.mpl_id,
                updated_at:          d.updated_at,
                version:             d.version,
                proforma_number:     pi?.proforma_number  ?? null,
                shipment_number:     pi?.shipment_number  ?? null,
                mpl_number:          mpl?.mpl_number      ?? null,
            };
        });

    const active_drafts_by_pi: Record<string, {
        total_drafts: number; my_drafts: number; other_users: number; latest_at: string;
    }> = {};
    for (const [piId, agg] of byPi) {
        active_drafts_by_pi[piId] = {
            total_drafts: agg.total,
            my_drafts:    agg.mine,
            other_users:  agg.others,
            latest_at:    agg.latest,
        };
    }

    return jsonResponse({
        kpis: {
            trucks_today:       trucksToday.count ?? 0,
            in_progress:        inProgress,
            done_today:         doneToday.count ?? 0,
            discrepancies_open: discrepancies.count ?? 0,
        },
        my_drafts,
        active_drafts_by_pi,
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
