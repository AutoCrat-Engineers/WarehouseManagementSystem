/**
 * pending_placement_list — Edge Function
 *
 * Returns every pallet that has been verified (GR line written) but not
 * yet physically placed in a rack (rack_location_code IS NULL).
 *
 * Used by the "Pending Placement" queue at the top of Inbound Receiving.
 *
 * INPUT:  { search_term?: string, limit?: 200 }
 * OUTPUT: { lines: [ { gr_id, gr_number, pallet_id, pallet_number,
 *                     part_number, msn_code, item_name, received_qty,
 *                     line_status, shipment_number, proforma_number,
 *                     mpl_number, customer_name, received_at } ],
 *           count: integer }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const search = String(body.search_term ?? '').trim().toLowerCase();
    const limit  = Math.min(500, Math.max(1, Number(body.limit ?? 200)));

    // All GR lines with placeable status but no placement yet
    const { data: lines, error } = await ctx.db
        .from('goods_receipt_lines')
        .select('id, gr_id, pallet_id, pallet_number, part_number, msn_code, received_qty, line_status, created_at, invoice_number, bpa_number')
        .is('rack_location_code', null)
        .in('line_status', ['RECEIVED', 'DAMAGED', 'SHORT', 'QUALITY_HOLD'])
        .order('created_at', { ascending: true })
        .limit(limit);
    if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });

    const rows = (lines ?? []) as any[];
    if (rows.length === 0) {
        return jsonResponse({ lines: [], count: 0 }, { origin });
    }

    // Enrichment lookups
    const grIds     = Array.from(new Set(rows.map(r => r.gr_id).filter(Boolean)));
    const palletIds = Array.from(new Set(rows.map(r => r.pallet_id).filter(Boolean)));
    const partNums  = Array.from(new Set(rows.map(r => r.part_number).filter(Boolean)));

    const [{ data: grs }, { data: pallets }, { data: items }] = await Promise.all([
        grIds.length > 0
            ? ctx.db.from('goods_receipts').select('id, gr_number, shipment_number, proforma_number, proforma_invoice_id, mpl_id, received_at').in('id', grIds)
            : Promise.resolve({ data: [] }),
        palletIds.length > 0
            ? ctx.db.from('pack_pallets').select('id, current_qty, state').in('id', palletIds)
            : Promise.resolve({ data: [] }),
        partNums.length > 0
            ? ctx.db.from('items').select('part_number, item_name').in('part_number', partNums)
            : Promise.resolve({ data: [] }),
    ]);

    const grById     = new Map((grs ?? []).map((g: any) => [g.id, g]));
    const palletById = new Map((pallets ?? []).map((p: any) => [p.id, p]));
    const itemByPn   = new Map((items ?? []).map((i: any) => [i.part_number, i]));

    // Proforma / MPL metadata
    const piIds  = Array.from(new Set((grs ?? []).map((g: any) => g.proforma_invoice_id).filter(Boolean)));
    const mplIds = Array.from(new Set((grs ?? []).map((g: any) => g.mpl_id).filter(Boolean)));

    const [{ data: pis }, { data: mpls }] = await Promise.all([
        piIds.length > 0 ? ctx.db.from('pack_proforma_invoices').select('id, customer_name').in('id', piIds) : Promise.resolve({ data: [] }),
        mplIds.length > 0 ? ctx.db.from('master_packing_lists').select('id, mpl_number').in('id', mplIds) : Promise.resolve({ data: [] }),
    ]);
    const piById  = new Map((pis  ?? []).map((p: any) => [p.id, p]));
    const mplById = new Map((mpls ?? []).map((m: any) => [m.id, m]));

    const enriched = rows.map(r => {
        const gr     = grById.get(r.gr_id);
        const pallet = palletById.get(r.pallet_id);
        const item   = r.part_number ? itemByPn.get(r.part_number) : null;
        const pi     = gr?.proforma_invoice_id ? piById.get(gr.proforma_invoice_id) : null;
        const mpl    = gr?.mpl_id ? mplById.get(gr.mpl_id) : null;
        return {
            line_id:         r.id,
            gr_id:           r.gr_id,
            gr_number:       gr?.gr_number ?? null,
            pallet_id:       r.pallet_id,
            pallet_number:   r.pallet_number ?? null,
            part_number:     r.part_number,
            msn_code:        r.msn_code,
            item_name:       item?.item_name ?? null,
            received_qty:    r.received_qty,
            current_qty:     pallet?.current_qty ?? null,
            line_status:     r.line_status,
            shipment_number: gr?.shipment_number ?? null,
            proforma_number: gr?.proforma_number ?? null,
            proforma_invoice_id: gr?.proforma_invoice_id ?? null,
            mpl_number:      mpl?.mpl_number ?? null,
            customer_name:   pi?.customer_name ?? null,
            invoice_number:  r.invoice_number,
            bpa_number:      r.bpa_number,
            received_at:     gr?.received_at ?? null,
        };
    });

    // Client search
    const filtered = search
        ? enriched.filter(r =>
            (r.pallet_number ?? '').toLowerCase().includes(search) ||
            (r.part_number ?? '').toLowerCase().includes(search) ||
            (r.msn_code ?? '').toLowerCase().includes(search) ||
            (r.shipment_number ?? '').toLowerCase().includes(search) ||
            (r.proforma_number ?? '').toLowerCase().includes(search) ||
            (r.gr_number ?? '').toLowerCase().includes(search) ||
            (r.mpl_number ?? '').toLowerCase().includes(search))
        : enriched;

    return jsonResponse({ lines: filtered, count: filtered.length }, { origin });
});

if (import.meta.main) Deno.serve(handler);
