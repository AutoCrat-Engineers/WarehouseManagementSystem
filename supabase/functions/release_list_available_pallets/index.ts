/**
 * release_list_available_pallets — Edge Function
 *
 * Lists pallets available to release, sorted FIFO by shipment → placed_at.
 * Used by the "Pick pallets for release" UI.
 *
 * Scoped by part_number (required) + optional warehouse / agreement filters.
 *
 * INPUT (JSON):
 *   {
 *     part_number:   "HW-LS-0022",       REQ
 *     agreement_id?: uuid,                (limit to this BPA)
 *     warehouse_id?: uuid,
 *     limit?: 100
 *   }
 *
 * OUTPUT:
 *   {
 *     success: true,
 *     pallets: [
 *       { pallet_id, pallet_number, rack, location_code, quantity,
 *         shipment_sequence, placed_at, days_in_rack,
 *         parent_invoice_number, agreement_number, is_oldest_shipment }
 *     ],
 *     fifo_hint: {
 *       oldest_shipment: 1,
 *       oldest_shipment_pallets: 3
 *     }
 *   }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const v = validate(body, { part_number: 'string' });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const limit = Math.min(500, Math.max(1, Number(body.limit ?? 100)));

    // Query mv_rack_view for available pallets of this part
    let q = ctx.db.from('mv_rack_view')
        .select('*')
        .eq('part_number', body.part_number)
        .eq('is_available', true);

    if (body.agreement_id) q = q.eq('agreement_id', body.agreement_id);
    if (body.warehouse_id) q = q.eq('warehouse_id', body.warehouse_id);

    // FIFO: oldest shipment first, then oldest placement within shipment
    q = q.order('shipment_sequence', { ascending: true, nullsFirst: false })
         .order('placed_at', { ascending: true, nullsFirst: false })
         .limit(limit);

    const { data: cells, error } = await q;
    if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });

    // Identify oldest shipment bucket to mark is_oldest_shipment for FIFO UI hint
    const oldestShipment = (cells && cells.length > 0)
        ? cells.reduce<number | null>(
            (acc, c) => c.shipment_sequence !== null && c.shipment_sequence !== undefined
                ? (acc === null ? c.shipment_sequence : Math.min(acc, c.shipment_sequence))
                : acc,
            null)
        : null;

    const pallets = (cells ?? []).map(c => ({
        pallet_id:              c.pallet_id,
        pallet_number:          c.pallet_number,
        rack:                   c.rack,
        location_code:          c.location_code,
        quantity:               c.pallet_quantity,
        shipment_sequence:      c.shipment_sequence,
        placed_at:              c.placed_at,
        days_in_rack:           c.days_in_rack,
        parent_invoice_id:      c.parent_invoice_id,
        parent_invoice_number:  c.parent_invoice_number,
        agreement_id:           c.agreement_id,
        agreement_number:       c.agreement_number,
        packing_list_number:    c.packing_list_number,
        blanket_order_id:       c.blanket_order_id,
        blanket_order_number:   c.blanket_order_number,
        is_oldest_shipment:     oldestShipment !== null && c.shipment_sequence === oldestShipment,
    }));

    const oldestShipmentPallets = pallets.filter(p => p.is_oldest_shipment).length;

    return jsonResponse({
        success: true,
        pallets,
        total_count: pallets.length,
        fifo_hint: {
            oldest_shipment:         oldestShipment,
            oldest_shipment_pallets: oldestShipmentPallets,
            recommendation: oldestShipment !== null
                ? `Pick from shipment ${oldestShipment} first (FIFO). ${oldestShipmentPallets} pallet(s) available.`
                : 'No shipment info available.',
        },
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
