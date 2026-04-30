/**
 * bpa_list — Edge Function
 *
 * Paginated list of BPAs for the BPA list UI.
 * Supports: search (agreement_number / customer_name / buyer_name),
 *           status filter, pagination, summary counts.
 *
 * INPUT (JSON):
 *   {
 *     page?:         0,
 *     page_size?:    25,        // 1..500
 *     status_filter?:'ALL' | 'DRAFT' | 'ACTIVE' | 'AMENDED' | 'EXPIRED' | 'CANCELLED',
 *     search_term?:  "260067",
 *     customer_code?:"OPW",
 *   }
 *
 * OUTPUT:
 *   {
 *     success: true,
 *     agreements: [...],
 *     total_count,
 *     counts: { total, active, draft, amended, expired, cancelled }
 *   }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody } from '../_shared/schemas.ts';

type StatusFilter = 'ALL' | 'DRAFT' | 'ACTIVE' | 'AMENDED' | 'EXPIRED' | 'CANCELLED';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const page = Math.max(0, Number(body.page ?? 0));
    const pageSize = Math.max(1, Math.min(500, Number(body.page_size ?? 25)));
    const offset = page * pageSize;

    const validFilters: StatusFilter[] = ['ALL','DRAFT','ACTIVE','AMENDED','EXPIRED','CANCELLED'];
    const statusFilter = (validFilters.includes(body.status_filter as StatusFilter)
                          ? body.status_filter : 'ALL') as StatusFilter;
    const searchTerm = ((body.search_term ?? '') as string).trim();
    const customerCode = ((body.customer_code ?? '') as string).trim();

    const safeSearch = searchTerm.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    // ── Main list query ──────────────────────────────────────────────
    let q = ctx.db.from('customer_agreements')
        .select('*', { count: 'exact' })
        .order('agreement_date', { ascending: false });

    if (statusFilter !== 'ALL') q = q.eq('status', statusFilter);
    if (customerCode) q = q.eq('customer_code', customerCode);
    if (safeSearch) {
        q = q.or(
            `agreement_number.ilike."%${safeSearch}%",customer_name.ilike."%${safeSearch}%",buyer_name.ilike."%${safeSearch}%"`,
        );
    }

    // ── Parallel: list + 6 counts ────────────────────────────────────
    const countQ = (status?: string) => {
        let base = ctx.db.from('customer_agreements').select('id', { count: 'exact', head: true });
        if (status) base = base.eq('status', status);
        return base;
    };

    const [listRes, totalR, activeR, draftR, amendedR, expiredR, cancelledR] = await Promise.all([
        q.range(offset, offset + pageSize - 1),
        countQ(),
        countQ('ACTIVE'),
        countQ('DRAFT'),
        countQ('AMENDED'),
        countQ('EXPIRED'),
        countQ('CANCELLED'),
    ]);

    if (listRes.error) {
        return errorResponse('INTERNAL_ERROR', listRes.error.message, { origin });
    }

    // ── Per-BPA fulfillment aggregates (for Portfolio Strip + card progress)
    const agreements = (listRes.data ?? []) as any[];
    const agrIds = agreements.map(a => a.id).filter(Boolean);
    const aggregatesByAgreement: Record<string, any> = {};
    let portfolioValue = 0;
    let releasedValue = 0;
    let inRackValue = 0;
    let expiringSoonCount = 0;
    const today = new Date();
    const sixtyDaysOut = new Date(today.getTime() + 60 * 86400000);

    let fulfillmentRows: any[] = [];
    if (agrIds.length > 0) {
        const { data: dashRows } = await ctx.db
            .from('mv_bpa_fulfillment_dashboard')
            .select('agreement_id, agreement_number, agreement_status, customer_name, buyer_name, effective_start_date, effective_end_date, part_number, msn_code, item_name, blanket_quantity, released_quantity, delivered_quantity, total_value, unit_price, pallets_in_rack, qty_in_rack, fulfillment_pct, pending_quantity, release_multiple')
            .in('agreement_id', agrIds);
        fulfillmentRows = (dashRows ?? []) as any[];

        for (const r of (dashRows ?? []) as any[]) {
            const aid = r.agreement_id;
            if (!aggregatesByAgreement[aid]) {
                aggregatesByAgreement[aid] = {
                    blanket_quantity: 0,
                    released_quantity: 0,
                    delivered_quantity: 0,
                    pending_quantity: 0,
                    total_value: 0,
                    released_value: 0,
                    delivered_value: 0,
                    in_rack_value: 0,
                    pallets_in_rack: 0,
                    qty_in_rack: 0,
                    parts_count: 0,
                };
            }
            const agg = aggregatesByAgreement[aid];
            const unit = Number(r.unit_price ?? 0);
            agg.blanket_quantity   += Number(r.blanket_quantity ?? 0);
            agg.released_quantity  += Number(r.released_quantity ?? 0);
            agg.delivered_quantity += Number(r.delivered_quantity ?? 0);
            agg.pending_quantity   += Number(r.pending_quantity ?? 0);
            agg.total_value        += Number(r.total_value ?? 0);
            agg.released_value     += Number(r.released_quantity ?? 0) * unit;
            agg.delivered_value    += Number(r.delivered_quantity ?? 0) * unit;
            agg.in_rack_value      += Number(r.qty_in_rack ?? 0) * unit;
            agg.pallets_in_rack    += Number(r.pallets_in_rack ?? 0);
            agg.qty_in_rack        += Number(r.qty_in_rack ?? 0);
            agg.parts_count        += 1;
        }

        // Post-process per agreement
        for (const a of agreements) {
            const agg = aggregatesByAgreement[a.id];
            if (agg) {
                agg.fulfillment_pct = agg.blanket_quantity > 0
                    ? +((agg.released_quantity / agg.blanket_quantity) * 100).toFixed(1)
                    : 0;
            }
            // Portfolio totals (across ACTIVE + AMENDED only)
            if (a.status === 'ACTIVE' || a.status === 'AMENDED') {
                portfolioValue  += Number(agg?.total_value ?? 0);
                releasedValue   += Number(agg?.released_value ?? 0);
                inRackValue     += Number(agg?.in_rack_value ?? 0);
                if (a.effective_end_date) {
                    const end = new Date(a.effective_end_date);
                    if (end >= today && end <= sixtyDaysOut) expiringSoonCount++;
                }
            }
        }
    }

    return jsonResponse({
        success: true,
        agreements,
        total_count: listRes.count ?? 0,
        counts: {
            total:     totalR.count ?? 0,
            active:    activeR.count ?? 0,
            draft:     draftR.count ?? 0,
            amended:   amendedR.count ?? 0,
            expired:   expiredR.count ?? 0,
            cancelled: cancelledR.count ?? 0,
        },
        aggregates: aggregatesByAgreement,
        fulfillment_rows: fulfillmentRows,
        portfolio: {
            portfolio_value:    +portfolioValue.toFixed(2),
            released_value:     +releasedValue.toFixed(2),
            in_rack_value:      +inRackValue.toFixed(2),
            expiring_soon:      expiringSoonCount,
        },
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
