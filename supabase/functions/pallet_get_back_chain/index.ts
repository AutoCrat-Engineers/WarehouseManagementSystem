/**
 * pallet_get_back_chain — Edge Function
 *
 * Given a pallet_id, return the full back-chain for pallet-click drilldowns
 * in the Rack Storage view:
 *   pallet → item → packing list → invoice → BPA → shipment (PI) → GR
 *
 * INPUT:  { pallet_id: uuid }
 * OUTPUT: { pallet, item, packing_list, invoice, bpa, shipment, gr, cartons }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const v = validate(body, { pallet_id: 'uuid' });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    // ── Pallet + item ────────────────────────────────────────────────
    const { data: pallet, error: pErr } = await ctx.db
        .from('pack_pallets')
        .select('id, pallet_number, item_id, item_code, state, current_qty, target_qty, container_count, packing_list_id, opened_at, ready_at, dispatched_at, shipment_sequence')
        .eq('id', body.pallet_id)
        .maybeSingle();
    if (pErr) return errorResponse('INTERNAL_ERROR', pErr.message, { origin });
    if (!pallet) return errorResponse('NOT_FOUND', 'Pallet not found', { origin });

    const itemP = (pallet as any).item_id
        ? ctx.db.from('items').select('item_name, master_serial_no, part_number, revision').eq('id', (pallet as any).item_id).maybeSingle()
        : Promise.resolve({ data: null });

    const plP = (pallet as any).packing_list_id
        ? ctx.db.from('pack_packing_lists').select('id, packing_list_number, confirmed_at, status').eq('id', (pallet as any).packing_list_id).maybeSingle()
        : Promise.resolve({ data: null });

    // Cartons / inner boxes on this pallet
    const cartonsP = ctx.db
        .from('pack_pallet_containers')
        .select(`
            position_sequence,
            pack_containers!inner (
                container_number, quantity, container_type, is_adjustment, sticker_printed,
                packing_boxes:packing_box_id (packing_id, box_number)
            )
        `)
        .eq('pallet_id', body.pallet_id)
        .order('position_sequence');

    // Master packing list rows. A pallet can have multiple MPL history
    // (e.g. original MPL cancelled, a new one created). Fetch all active
    // MPP rows and pick the one whose MPL is NOT cancelled, preferring the
    // most recent dispatched / created.
    const mppP = ctx.db
        .from('master_packing_list_pallets')
        .select('mpl_id, status, master_packing_lists!inner (id, mpl_number, invoice_number, po_number, proforma_invoice_id, dispatched_at, created_at, status)')
        .eq('pallet_id', body.pallet_id);

    // Most recent GR line referencing this pallet
    const grP = ctx.db
        .from('goods_receipt_lines')
        .select('gr_id, received_qty, line_status, rack_location_code, rack_placed_at, goods_receipts!inner (gr_number, gr_date, status, proforma_number, shipment_number)')
        .eq('pallet_id', body.pallet_id)
        .order('created_at', { ascending: false })
        .limit(1);

    const [itemR, plR, cartonsR, mppR, grR] = await Promise.all([itemP, plP, cartonsP, mppP, grP]);

    // Normalize MPL / shipment — pick the BEST MPL for this pallet:
    // 1. Prefer rows where the parent MPL is NOT CANCELLED
    // 2. Prefer MPP rows still flagged ACTIVE
    // 3. Then most recent dispatched / created
    const mppRows = ((mppR.data as any[]) ?? [])
        .map(r => ({ ...r, _mpl: r.master_packing_lists }))
        .sort((a, b) => {
            const aCancelled = a._mpl?.status === 'CANCELLED' ? 1 : 0;
            const bCancelled = b._mpl?.status === 'CANCELLED' ? 1 : 0;
            if (aCancelled !== bCancelled) return aCancelled - bCancelled;
            const aActive = a.status === 'ACTIVE' ? 0 : 1;
            const bActive = b.status === 'ACTIVE' ? 0 : 1;
            if (aActive !== bActive) return aActive - bActive;
            const aDt = a._mpl?.dispatched_at ?? a._mpl?.created_at ?? '';
            const bDt = b._mpl?.dispatched_at ?? b._mpl?.created_at ?? '';
            return bDt.localeCompare(aDt);
        });
    const mpp = mppRows[0] ?? null;
    const mpl = mpp?._mpl ?? null;

    // Proforma / shipment lookup
    const piId = mpl?.proforma_invoice_id;
    const { data: shipment } = piId
        ? await ctx.db.from('pack_proforma_invoices')
            .select('id, proforma_number, shipment_number, customer_name, status, stock_moved_at')
            .eq('id', piId).maybeSingle()
        : { data: null };

    const gr = (grR.data as any[])?.[0] ?? null;

    return jsonResponse({
        pallet,
        item:          itemR.data,
        packing_list:  plR.data,
        cartons:       (cartonsR.data ?? []) as any[],
        invoice_number: mpl?.invoice_number ?? null,
        bpa_number:     mpl?.po_number ?? null,
        mpl:           mpl ? {
            id:            mpl.id,
            mpl_number:    mpl.mpl_number,
            dispatched_at: mpl.dispatched_at,
            status:        mpl.status,
        } : null,
        shipment,
        gr: gr ? {
            gr_number:          gr.goods_receipts.gr_number,
            gr_date:            gr.goods_receipts.gr_date,
            status:             gr.goods_receipts.status,
            line_status:        gr.line_status,
            received_qty:       gr.received_qty,
            rack_location_code: gr.rack_location_code,
            rack_placed_at:     gr.rack_placed_at,
        } : null,
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
