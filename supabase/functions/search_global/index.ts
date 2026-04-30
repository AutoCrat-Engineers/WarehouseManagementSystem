/**
 * search_global — Edge Function
 *
 * Unified search across the system. Single query, multiple result groups.
 * Used by the header search bar.
 *
 * Matches on:
 *   customer_agreements.agreement_number
 *   blanket_orders.order_number
 *   blanket_releases.release_number / customer_po_base
 *   pack_invoices.invoice_number
 *   pack_sub_invoices.sub_invoice_number / customer_po_number
 *   tariff_invoices.tariff_invoice_number
 *   pack_pallets.pallet_number
 *   items.part_number / master_serial_no / item_name
 *   warehouse_rack_locations.location_code  (e.g. "A42")
 *
 * INPUT (JSON):
 *   { query: "260067252", limit?: 10 }
 *
 * OUTPUT:
 *   {
 *     success: true,
 *     query,
 *     results: {
 *       agreements:    [...],
 *       blanket_orders:[...],
 *       releases:      [...],
 *       invoices:      [...],
 *       sub_invoices:  [...],
 *       tariff_invoices:[...],
 *       pallets:       [...],
 *       items:         [...],
 *       rack_cells:    [...]
 *     },
 *     total_hits: integer
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
    const v = validate(body, { query: 'string' });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });
    const query = String(body.query).trim();
    if (query.length < 2) {
        return errorResponse('VALIDATION_FAILED', 'Query must be at least 2 characters', { origin });
    }
    const limit = Math.min(50, Math.max(1, Number(body.limit ?? 10)));
    const safe = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const pattern = `%${safe}%`;

    // ── Parallel fan-out to each entity type ─────────────────────────
    const [agrR, boR, relR, invR, subR, tariffR, palletR, itemR, cellR] = await Promise.all([
        ctx.db.from('customer_agreements')
            .select('id, agreement_number, agreement_revision, status, customer_name, buyer_name')
            .ilike('agreement_number', pattern).limit(limit),

        ctx.db.from('blanket_orders')
            .select('id, order_number, status, agreement_id')
            .ilike('order_number', pattern).limit(limit),

        ctx.db.from('blanket_releases')
            .select('id, release_number, customer_po_base, release_sequence, status, agreement_id')
            .or(`release_number.ilike.${pattern},customer_po_base.ilike.${pattern}`)
            .limit(limit),

        ctx.db.from('pack_invoices')
            .select('id, invoice_number, invoice_date, status, blanket_order_id')
            .ilike('invoice_number', pattern).limit(limit),

        ctx.db.from('pack_sub_invoices')
            .select('id, sub_invoice_number, customer_po_number, sub_invoice_date, status, agreement_id')
            .or(`sub_invoice_number.ilike.${pattern},customer_po_number.ilike.${pattern}`)
            .limit(limit),

        ctx.db.from('tariff_invoices')
            .select('id, tariff_invoice_number, status, total_tariff, sub_invoice_id')
            .ilike('tariff_invoice_number', pattern).limit(limit),

        ctx.db.from('pack_pallets')
            .select('id, pallet_number, state, current_qty, rack_location_id')
            .ilike('pallet_number', pattern).limit(limit),

        ctx.db.from('items')
            .select('id, part_number, master_serial_no, item_name, unit_price, is_active')
            .is('deleted_at', null)
            .or(`part_number.ilike.${pattern},master_serial_no.ilike.${pattern},item_name.ilike.${pattern}`)
            .limit(limit),

        ctx.db.from('mv_rack_view')
            .select('rack_location_id, rack, location_number, location_code, pallet_id, pallet_number, part_number')
            .ilike('location_code', pattern).limit(limit),
    ]);

    const results = {
        agreements:     agrR.data ?? [],
        blanket_orders: boR.data ?? [],
        releases:       relR.data ?? [],
        invoices:       invR.data ?? [],
        sub_invoices:   subR.data ?? [],
        tariff_invoices: tariffR.data ?? [],
        pallets:        palletR.data ?? [],
        items:          itemR.data ?? [],
        rack_cells:     cellR.data ?? [],
    };

    const totalHits = Object.values(results).reduce((s, arr) => s + arr.length, 0);

    return jsonResponse({ success: true, query, results, total_hits: totalHits }, { origin });
});

if (import.meta.main) Deno.serve(handler);
