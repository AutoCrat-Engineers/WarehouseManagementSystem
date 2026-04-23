/**
 * release_list_available_pallets — Edge Function
 *
 * Lists pallets available to release, sorted FIFO by shipment → placed_at.
 * Used by the "Pick pallets for release" UI.
 *
 * DATA SOURCE (as of mig 035+): pallets land in the rack via the GR flow,
 * which writes to goods_receipt_lines.rack_location_code and flips
 * pack_pallets.state to ARRIVED_AT_3PL / IN_3PL_WAREHOUSE. mv_rack_view is
 * no longer authoritative for release availability.
 *
 * A pallet is AVAILABLE iff:
 *   1. It has a goods_receipt_lines row with rack_location_code NOT NULL
 *   2. pack_pallets.state IN ('ARRIVED_AT_3PL','IN_3PL_WAREHOUSE')
 *   3. NOT already on release_pallet_assignments
 *
 * INPUT (JSON):
 *   { part_number: string, agreement_id?: uuid, limit?: 100 }
 *
 * OUTPUT:
 *   { success, pallets:[...], total_count, fifo_hint:{...} }
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

    // ── 1. Candidate GR lines for this part (most recent per pallet) ───
    const { data: grLines, error: grErr } = await ctx.db
        .from('goods_receipt_lines')
        .select(`
            pallet_id, pallet_number, part_number, received_qty,
            rack_location_code, rack_placed_at, line_status,
            invoice_number, bpa_number, gr_id,
            goods_receipts!inner(gr_number, status)
        `)
        .eq('part_number', body.part_number)
        .not('rack_location_code', 'is', null)
        .order('rack_placed_at', { ascending: true, nullsFirst: false });

    if (grErr) return errorResponse('INTERNAL_ERROR', grErr.message, { origin });

    // Dedup by pallet_id — keep earliest placement (FIFO base)
    const seen = new Set<string>();
    const byPallet: any[] = [];
    for (const r of (grLines ?? []) as any[]) {
        if (!r.pallet_id || seen.has(r.pallet_id)) continue;
        seen.add(r.pallet_id);
        byPallet.push(r);
    }
    if (byPallet.length === 0) {
        return jsonResponse({
            success: true, pallets: [], total_count: 0,
            fifo_hint: { oldest_shipment: null, oldest_shipment_pallets: 0, recommendation: 'No pallets in rack for this part.' },
        }, { origin });
    }

    const palletIds = byPallet.map(r => r.pallet_id);

    // ── 2. Cross-check pack_pallets for state + shipment_sequence ───────
    const { data: pallets, error: pErr } = await ctx.db
        .from('pack_pallets')
        .select('id, pallet_number, state, current_qty, shipment_sequence, packing_list_id, item_id')
        .in('id', palletIds)
        .in('state', ['ARRIVED_AT_3PL', 'IN_3PL_WAREHOUSE']);

    if (pErr) return errorResponse('INTERNAL_ERROR', pErr.message, { origin });
    const palletMap = new Map((pallets ?? []).map((p: any) => [p.id, p]));

    // ── 3. Exclude already-released pallets ─────────────────────────────
    const { data: assigned, error: aErr } = await ctx.db
        .from('release_pallet_assignments')
        .select('pallet_id')
        .in('pallet_id', palletIds);
    if (aErr) return errorResponse('INTERNAL_ERROR', aErr.message, { origin });
    const releasedSet = new Set((assigned ?? []).map((a: any) => a.pallet_id));

    // ── 4. MPL / agreement info for backchain display ───────────────────
    const { data: mppRows } = await ctx.db
        .from('master_packing_list_pallets')
        .select('pallet_id, master_packing_lists!inner(invoice_number, po_number, proforma_invoice_id)')
        .in('pallet_id', palletIds)
        .eq('status', 'ACTIVE');
    const mplByPallet = new Map<string, any>();
    for (const m of (mppRows ?? []) as any[]) {
        if (!mplByPallet.has(m.pallet_id)) mplByPallet.set(m.pallet_id, m.master_packing_lists);
    }

    // ── 4b. Parent invoice line_items for knock-off binding ─────────────
    // Group-by UI needs: which invoice this pallet's qty should knock off
    // against. Map (invoice_number, part_number) → pack_invoice_line_item.
    const invoiceNumbers = Array.from(new Set([...mplByPallet.values()].map(m => m?.invoice_number).filter(Boolean)));
    const invoiceByNumber = new Map<string, any>();
    const pili = new Map<string, any>(); // key = `${invoice_id}|${part_number}`
    if (invoiceNumbers.length > 0) {
        const { data: invs } = await ctx.db
            .from('pack_invoices')
            .select('id, invoice_number, invoice_date, currency_code')
            .in('invoice_number', invoiceNumbers);
        for (const i of (invs ?? []) as any[]) invoiceByNumber.set(i.invoice_number, i);

        const invIds = (invs ?? []).map((i: any) => i.id);
        if (invIds.length > 0) {
            const { data: piliRows } = await ctx.db
                .from('pack_invoice_line_items')
                .select('id, invoice_id, part_number, invoiced_quantity, released_quantity, pending_quantity, unit_price')
                .in('invoice_id', invIds)
                .eq('part_number', body.part_number);
            for (const r of (piliRows ?? []) as any[]) {
                pili.set(`${r.invoice_id}|${r.part_number}`, r);
            }
        }
    }

    // Agreement lookup by po_number (BPA#)
    const poNumbers = Array.from(new Set([...mplByPallet.values()].map(m => m?.po_number).filter(Boolean)));
    const agreementByPo = new Map<string, any>();
    if (poNumbers.length) {
        const { data: ags } = await ctx.db
            .from('customer_agreements')
            .select('id, agreement_number')
            .in('agreement_number', poNumbers)
            .in('status', ['ACTIVE', 'AMENDED']);
        for (const a of (ags ?? []) as any[]) agreementByPo.set(a.agreement_number, a);
    }

    // ── 5. Build + filter result ────────────────────────────────────────
    const now = Date.now();
    const available = byPallet.filter(r => palletMap.has(r.pallet_id) && !releasedSet.has(r.pallet_id));

    let enriched = available.map(r => {
        const pp      = palletMap.get(r.pallet_id);
        const mpl     = mplByPallet.get(r.pallet_id);
        const agNo    = mpl?.po_number ?? r.bpa_number ?? null;
        const ag      = agNo ? agreementByPo.get(agNo) : null;
        const invNo   = mpl?.invoice_number ?? r.invoice_number ?? null;
        const invObj  = invNo ? invoiceByNumber.get(invNo) : null;
        const piliRow = invObj ? pili.get(`${invObj.id}|${body.part_number}`) : null;
        const placedAt = r.rack_placed_at ? new Date(r.rack_placed_at).getTime() : now;
        const daysInRack = Math.max(0, Math.floor((now - placedAt) / 86400000));
        return {
            pallet_id:              r.pallet_id,
            pallet_number:          r.pallet_number ?? pp?.pallet_number,
            rack:                   r.rack_location_code?.[0] ?? null,
            location_code:          r.rack_location_code,
            quantity:               pp?.current_qty ?? r.received_qty,
            shipment_sequence:      pp?.shipment_sequence ?? null,
            placed_at:              r.rack_placed_at,
            days_in_rack:           daysInRack,
            parent_invoice_id:      invObj?.id ?? null,
            parent_invoice_number:  invNo,
            parent_invoice_date:    invObj?.invoice_date ?? null,
            parent_invoice_line_id: piliRow?.id ?? null,
            parent_invoiced_qty:    piliRow?.invoiced_quantity ?? null,
            parent_released_qty:    piliRow?.released_quantity ?? null,
            parent_pending_qty:     piliRow?.pending_quantity  ?? null,
            parent_unit_price:      piliRow?.unit_price        ?? null,
            agreement_id:           ag?.id ?? null,
            agreement_number:       agNo,
            packing_list_number:    null,
            blanket_order_id:       null,
            blanket_order_number:   null,
            is_oldest_shipment:     false,
            gr_number:              r.goods_receipts?.gr_number ?? null,
        };
    });

    if (body.agreement_id) {
        enriched = enriched.filter(p => p.agreement_id === body.agreement_id);
    }

    // FIFO sort: shipment_sequence asc (nulls last) then placed_at asc
    enriched.sort((a, b) => {
        const as = a.shipment_sequence ?? Number.POSITIVE_INFINITY;
        const bs = b.shipment_sequence ?? Number.POSITIVE_INFINITY;
        if (as !== bs) return as - bs;
        const at = a.placed_at ? new Date(a.placed_at).getTime() : 0;
        const bt = b.placed_at ? new Date(b.placed_at).getTime() : 0;
        return at - bt;
    });

    enriched = enriched.slice(0, limit);

    // FIFO hint
    const oldestShipment = enriched.reduce<number | null>(
        (acc, c) => c.shipment_sequence !== null && c.shipment_sequence !== undefined
            ? (acc === null ? c.shipment_sequence : Math.min(acc, c.shipment_sequence))
            : acc,
        null);
    for (const p of enriched) {
        p.is_oldest_shipment = oldestShipment !== null && p.shipment_sequence === oldestShipment;
    }
    const oldestShipmentPallets = enriched.filter(p => p.is_oldest_shipment).length;

    return jsonResponse({
        success: true,
        pallets: enriched,
        total_count: enriched.length,
        fifo_hint: {
            oldest_shipment:         oldestShipment,
            oldest_shipment_pallets: oldestShipmentPallets,
            recommendation: oldestShipment !== null
                ? `Pick from shipment ${oldestShipment} first (FIFO). ${oldestShipmentPallets} pallet(s) available.`
                : enriched.length > 0
                    ? `${enriched.length} pallet(s) available — pick oldest placed_at first.`
                    : 'No shipment info available.',
        },
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
