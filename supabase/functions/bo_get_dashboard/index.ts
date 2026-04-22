/**
 * bo_get_dashboard — Edge Function
 *
 * Returns the BPA / Blanket Order fulfillment dashboard. Reads from
 * `mv_bpa_fulfillment_dashboard` (materialized view, refreshed on change).
 *
 * INPUT (JSON):
 *   {
 *     agreement_id?: uuid,
 *     status_filter?: 'ALL'|'ACTIVE'|'AMENDED'|'EXPIRED'|'CANCELLED',
 *     pending_only?: boolean,
 *     page?: 0, page_size?: 50
 *   }
 *
 * OUTPUT:
 *   {
 *     success: true,
 *     rows: [...],
 *     summary: {
 *       total_agreements, active, amended,
 *       total_blanket_value, total_released_value, total_pending_value,
 *       avg_fulfillment_pct, parts_under_min_stock
 *     }
 *   }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const page = Math.max(0, Number(body.page ?? 0));
    const pageSize = Math.max(1, Math.min(500, Number(body.page_size ?? 50)));
    const offset = page * pageSize;

    let q = ctx.db.from('mv_bpa_fulfillment_dashboard')
        .select('*', { count: 'exact' })
        .order('agreement_number')
        .order('part_number');

    if (body.agreement_id)  q = q.eq('agreement_id', body.agreement_id);
    if (body.status_filter && body.status_filter !== 'ALL') {
        q = q.eq('agreement_status', body.status_filter);
    }
    if (body.pending_only)  q = q.gt('pending_quantity', 0);

    const { data: rows, error, count } = await q.range(offset, offset + pageSize - 1);
    if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });

    // ── Client-side summary across returned page ─────────────────────
    const agreements = new Set<string>();
    let totalBlanketValue = 0, totalReleasedValue = 0, totalPendingValue = 0;
    let fulfillmentSum = 0, fulfillmentN = 0, partsUnderMin = 0;
    const statuses: Record<string, number> = {};
    for (const r of rows ?? []) {
        agreements.add(r.agreement_id);
        totalBlanketValue  += Number(r.total_value ?? 0);
        const releasedValue = Number(r.released_quantity ?? 0) * Number(r.unit_price ?? 0);
        totalReleasedValue += releasedValue;
        totalPendingValue  += Math.max(0, Number(r.total_value ?? 0) - releasedValue);
        if (Number(r.blanket_quantity ?? 0) > 0) {
            fulfillmentSum += Number(r.fulfillment_pct ?? 0);
            fulfillmentN   += 1;
        }
        if (Number(r.qty_in_rack ?? 0) < Number(r.min_warehouse_stock ?? 0)) partsUnderMin++;
        statuses[r.agreement_status] = (statuses[r.agreement_status] ?? 0) + 1;
    }

    return jsonResponse({
        success:     true,
        rows:        rows ?? [],
        total_count: count ?? 0,
        summary: {
            agreements_count:      agreements.size,
            by_status:             statuses,
            total_blanket_value:   +totalBlanketValue.toFixed(2),
            total_released_value:  +totalReleasedValue.toFixed(2),
            total_pending_value:   +totalPendingValue.toFixed(2),
            avg_fulfillment_pct:   fulfillmentN > 0 ? +(fulfillmentSum / fulfillmentN).toFixed(2) : 0,
            parts_under_min_stock: partsUnderMin,
        },
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
