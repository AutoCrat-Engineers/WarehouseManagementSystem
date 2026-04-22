/**
 * item_get_full_detail — Edge Function
 *
 * Replaces the broken `im_get-blanket-orders` (which queried dropped view
 * `v_item_details`). Given an item_id, returns everything the Item Master
 * detail modal needs in ONE call:
 *   - The item row itself
 *   - Agreements including this part (via customer_agreement_parts)
 *   - Line configs with running totals (shipped/released/delivered/pending)
 *   - Recent sub-invoices (releases) for this part
 *   - Recent shipment log entries
 *   - Current rack placements
 *
 * INPUT:  { item_id: uuid }
 * OUTPUT: { success, item, agreements, line_configs, sub_invoices,
 *           shipment_log, rack_placements }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const v = validate(body, { item_id: 'uuid' });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    // ── Load the item ────────────────────────────────────────────────
    const { data: item, error: itemErr } = await ctx.db
        .from('items').select('*').eq('id', body.item_id).single();
    if (itemErr || !item) return errorResponse('NOT_FOUND', 'Item not found', { origin });

    const partNumber = item.part_number;

    // ── Parallel fan-out: agreement parts, line configs, sub-invoices,
    //    shipments, rack placements (all keyed on part_number) ────────
    const [agrPartsR, lineConfigsR, subInvLinesR, shipmentsR, rackR] = await Promise.all([
        // Agreement parts (with their parent agreement eager-joined)
        ctx.db.from('customer_agreement_parts')
            .select(`
                *,
                agreement:customer_agreements(
                    id, agreement_number, agreement_revision, agreement_type,
                    customer_code, customer_name, buyer_name,
                    effective_start_date, effective_end_date, status, currency_code
                )
            `)
            .eq('part_number', partNumber)
            .eq('is_active', true)
            .order('created_at', { ascending: false }),

        // Line configs — the operational mirror
        ctx.db.from('blanket_order_line_configs')
            .select('*')
            .eq('part_number', partNumber)
            .eq('is_active', true)
            .order('updated_at', { ascending: false }),

        // Recent sub-invoice lines (joined to sub-invoice header)
        ctx.db.from('pack_sub_invoice_lines')
            .select(`
                *,
                sub_invoice:pack_sub_invoices(
                    id, sub_invoice_number, sub_invoice_date, status,
                    customer_po_number, buyer_name, total_quantity, total_pallets,
                    total_amount, currency_code
                )
            `)
            .eq('part_number', partNumber)
            .order('created_at', { ascending: false })
            .limit(50),

        // Shipment log entries for any BO this part sits on
        ctx.db.from('blanket_order_shipment_log')
            .select('*')
            .order('shipment_date', { ascending: false })
            .limit(50),

        // Current rack placements
        ctx.db.from('mv_rack_view')
            .select('rack_location_id, rack, location_number, location_code, pallet_id, pallet_number, pallet_quantity, pallet_state, placed_at, shipment_sequence, agreement_number, warehouse_name, is_available, is_reserved')
            .eq('part_number', partNumber)
            .order('placed_at', { ascending: true }),
    ]);

    if (agrPartsR.error) return errorResponse('INTERNAL_ERROR', agrPartsR.error.message, { origin });

    return jsonResponse({
        success:          true,
        item,
        agreements:       agrPartsR.data ?? [],
        line_configs:     lineConfigsR.data ?? [],
        sub_invoice_lines: subInvLinesR.data ?? [],
        shipment_log:     shipmentsR.data ?? [],
        rack_placements:  rackR.data ?? [],
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
