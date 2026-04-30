/**
 * shipment_detail_get — Edge Function
 *
 * Returns the full breakdown of a shipment (proforma) for the Receive
 * Shipment wizard and Phase C detail view:
 *   - Shipment header (proforma + customer + buyer)
 *   - MPLs[] with per-MPL pallets[] (part, MSN, qty, GR status if verified)
 *
 * Each MPL may already have a sub-GRN. We expose `mpl.gr` when present so
 * the UI can render "VERIFIED" vs "AWAITING VERIFY" per MPL.
 *
 * INPUT:  { proforma_invoice_id: uuid }
 * OUTPUT: { shipment, mpls: [ { ..., pallets:[...], gr } ] }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const v = validate(body, { proforma_invoice_id: 'uuid' });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    // Shipment header
    const { data: pi, error: piErr } = await ctx.db
        .from('pack_proforma_invoices')
        .select('id, proforma_number, shipment_number, customer_name, stock_moved_at, status, created_at')
        .eq('id', body.proforma_invoice_id)
        .maybeSingle();
    if (piErr) return errorResponse('INTERNAL_ERROR', piErr.message, { origin });
    if (!pi)   return errorResponse('NOT_FOUND',      'Shipment not found', { origin });

    // MPL junction
    const { data: pim } = await ctx.db
        .from('proforma_invoice_mpls')
        .select('mpl_id')
        .eq('proforma_id', body.proforma_invoice_id);
    const mplIds = Array.from(new Set((pim ?? []).map((x: any) => x.mpl_id).filter(Boolean)));

    if (mplIds.length === 0) {
        return jsonResponse({ success: true, shipment: pi, mpls: [] }, { origin });
    }

    // MPL headers
    const { data: mpls } = await ctx.db
        .from('master_packing_lists')
        .select('id, mpl_number, invoice_number, po_number, status, dispatched_at, confirmed_at')
        .in('id', mplIds);

    // Pallet junction per MPL
    const { data: mpp } = await ctx.db
        .from('master_packing_list_pallets')
        .select('mpl_id, pallet_id')
        .in('mpl_id', mplIds)
        .eq('status', 'ACTIVE');

    const palletIds = Array.from(new Set((mpp ?? []).map((x: any) => x.pallet_id).filter(Boolean)));

    // Pallet details
    const { data: pallets } = palletIds.length > 0
        ? await ctx.db.from('pack_pallets')
            .select('id, pallet_number, item_id, state, current_qty, container_count, shipment_sequence, opened_at, ready_at, dispatched_at, item_code')
            .in('id', palletIds)
        : { data: [] };

    const itemIds = Array.from(new Set((pallets ?? []).map((p: any) => p.item_id).filter(Boolean)));
    const { data: items } = itemIds.length > 0
        ? await ctx.db.from('items')
            .select('id, part_number, master_serial_no, item_name')
            .in('id', itemIds)
        : { data: [] };
    const itemById = new Map((items ?? []).map((i: any) => [i.id, i]));

    // Existing GR per MPL (sub-GRN)
    const { data: grs } = await ctx.db
        .from('goods_receipts')
        .select('id, gr_number, mpl_id, status, total_pallets_expected, total_pallets_received, total_pallets_missing, total_pallets_damaged, placement_completed_at, created_at')
        .eq('proforma_invoice_id', body.proforma_invoice_id);

    const grByMpl = new Map<string, any>();
    for (const g of (grs ?? []) as any[]) {
        if (g.mpl_id) grByMpl.set(g.mpl_id, g);
    }

    // GR line status per pallet (so we can render per-pallet verified state)
    const grIds = (grs ?? []).map((g: any) => g.id);
    const grLinesByPallet = new Map<string, any>();
    if (grIds.length > 0) {
        const { data: grLines } = await ctx.db
            .from('goods_receipt_lines')
            .select('pallet_id, line_status, received_qty, discrepancy_note, rack_location_code, rack_placed_at, gr_id')
            .in('gr_id', grIds);
        for (const l of (grLines ?? []) as any[]) {
            grLinesByPallet.set(l.pallet_id, l);
        }
    }

    // Pallets grouped by MPL
    const palletsByMpl = new Map<string, any[]>();
    for (const r of (mpp ?? []) as any[]) {
        const list = palletsByMpl.get(r.mpl_id) ?? [];
        list.push(r.pallet_id);
        palletsByMpl.set(r.mpl_id, list);
    }
    const palletById = new Map((pallets ?? []).map((p: any) => [p.id, p]));

    const mplOut = (mpls ?? []).map((m: any) => {
        const palletIdsForMpl = palletsByMpl.get(m.id) ?? [];
        const palletsOut = palletIdsForMpl.map(pid => {
            const p   = palletById.get(pid);
            const itm = p ? itemById.get(p.item_id) : null;
            const line = grLinesByPallet.get(pid);
            return {
                pallet_id:     pid,
                pallet_number: p?.pallet_number ?? null,
                part_number:   itm?.part_number  ?? p?.item_code ?? null,
                msn_code:      itm?.master_serial_no ?? null,
                item_name:     itm?.item_name    ?? null,
                quantity:      p?.current_qty    ?? 0,
                container_count: p?.container_count ?? 0,
                state:         p?.state          ?? null,
                shipment_sequence: p?.shipment_sequence ?? null,
                // GR-line context (if this pallet was already verified)
                gr_line_status:   line?.line_status   ?? null,
                gr_received_qty:  line?.received_qty  ?? null,
                rack_location_code: line?.rack_location_code ?? null,
                rack_placed_at:     line?.rack_placed_at     ?? null,
                discrepancy_note:   line?.discrepancy_note   ?? null,
            };
        });

        const gr = grByMpl.get(m.id);
        return {
            mpl_id:         m.id,
            mpl_number:     m.mpl_number,
            invoice_number: m.invoice_number,
            bpa_number:     m.po_number,
            status:         m.status,
            dispatched_at:  m.dispatched_at,
            confirmed_at:   m.confirmed_at,
            pallet_count:   palletsOut.length,
            qty_total:      palletsOut.reduce((s, p) => s + Number(p.quantity ?? 0), 0),
            gr: gr ? {
                id:                     gr.id,
                gr_number:              gr.gr_number,
                status:                 gr.status,
                total_pallets_expected: gr.total_pallets_expected,
                total_pallets_received: gr.total_pallets_received,
                total_pallets_missing:  gr.total_pallets_missing,
                total_pallets_damaged:  gr.total_pallets_damaged,
                placement_completed_at: gr.placement_completed_at,
                created_at:             gr.created_at,
            } : null,
            pallets: palletsOut,
        };
    });

    return jsonResponse({ success: true, shipment: pi, mpls: mplOut }, { origin });
});

if (import.meta.main) Deno.serve(handler);
