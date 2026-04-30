/**
 * rack_view_get — Edge Function
 *
 * Hydrates the rack grid UI. Reads from mv_rack_view (materialized,
 * CONCURRENTLY refreshed on state change) for O(1) response time.
 *
 * INPUT (JSON):
 *   {
 *     warehouse_id?: uuid,         // filter by warehouse; optional
 *     rack?:         "A"|"B"|"C",  // single rack tab; optional
 *     status_filter?: 'ALL' | 'OCCUPIED' | 'EMPTY' | 'AVAILABLE' | 'RESERVED',
 *     part_filter?:   string,      // filter by part_number
 *     agreement_id?:  uuid,        // drill-down from BPA dashboard
 *     shipment_sequence?: integer  // filter by shipment bucket
 *   }
 *
 * OUTPUT:
 *   {
 *     success: true,
 *     cells: [ { ... rack cell row ... } ],
 *     summary: {
 *       total_cells, occupied, empty, available, reserved,
 *       parts_distinct, by_shipment: { "1": 10, "2": 47, ... }
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
    const statusFilter = (body.status_filter ?? 'ALL') as string;

    let q = ctx.db.from('mv_rack_view').select('*').order('rack').order('location_number');

    if (body.warehouse_id)      q = q.eq('warehouse_id', body.warehouse_id);
    if (body.rack)              q = q.eq('rack', body.rack);
    if (body.part_filter)       q = q.eq('part_number', body.part_filter);
    if (body.agreement_id)      q = q.eq('agreement_id', body.agreement_id);
    if (body.shipment_sequence !== undefined)
                                q = q.eq('shipment_sequence', body.shipment_sequence);

    switch (statusFilter) {
        case 'EMPTY':     q = q.eq('is_empty', true); break;
        case 'OCCUPIED':  q = q.eq('is_empty', false); break;
        case 'AVAILABLE': q = q.eq('is_available', true); break;
        case 'RESERVED':  q = q.eq('is_reserved', true); break;
    }

    const { data: cells, error } = await q;
    if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });

    // ── Summary (client-side aggregation — small result set, 500ish cells) ──
    const summary = {
        total_cells:     cells?.length ?? 0,
        occupied:        0,
        empty:           0,
        available:       0,
        reserved:        0,
        parts_distinct:  new Set<string>().size,
        by_shipment:     {} as Record<string, number>,
    };
    const partsSet = new Set<string>();
    for (const c of cells ?? []) {
        if (c.is_empty) summary.empty++; else summary.occupied++;
        if (c.is_available) summary.available++;
        if (c.is_reserved) summary.reserved++;
        if (c.part_number) partsSet.add(c.part_number);
        if (c.shipment_sequence !== null && c.shipment_sequence !== undefined) {
            const k = String(c.shipment_sequence);
            summary.by_shipment[k] = (summary.by_shipment[k] ?? 0) + 1;
        }
    }
    summary.parts_distinct = partsSet.size;

    return jsonResponse({ success: true, cells: cells ?? [], summary }, { origin });
});

if (import.meta.main) Deno.serve(handler);
