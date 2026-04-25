/**
 * rack_load_storage — Edge Function
 *
 * Returns all pallets currently placed on racks so the Rack Storage UI can
 * rehydrate from DB on mount. Reads from goods_receipt_lines (the
 * authoritative placement ledger).
 *
 * INPUT:  {}   (no filters for now — cheap query, ~hundreds of rows max)
 * OUTPUT: { placements: [ { rack_location_code, pallet_id, pallet_number,
 *                           msn_code, part_number, item_name, quantity,
 *                           gr_number, shipment_sequence } ] }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    // Most recent placement per pallet (pallet may appear multiple times if
    // moved; take the latest by created_at).
    const { data: rows, error } = await ctx.db
        .from('goods_receipt_lines')
        .select(`
            pallet_id,
            pallet_number,
            part_number,
            msn_code,
            received_qty,
            rack_location_code,
            rack_placed_at,
            line_status,
            goods_receipts!inner ( gr_number, status )
        `)
        .not('rack_location_code', 'is', null)
        .order('rack_placed_at', { ascending: false });

    if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });

    // Deduplicate by pallet_id — keep the most recent row
    const seen = new Set<string>();
    const placements: any[] = [];
    for (const r of (rows ?? []) as any[]) {
        if (seen.has(r.pallet_id)) continue;
        seen.add(r.pallet_id);
        placements.push({
            rack_location_code: r.rack_location_code,
            pallet_id:          r.pallet_id,
            pallet_number:      r.pallet_number,
            part_number:        r.part_number,
            msn_code:           r.msn_code,
            quantity:           r.received_qty,
            gr_number:          r.goods_receipts?.gr_number ?? null,
            gr_status:          r.goods_receipts?.status    ?? null,
            placed_at:          r.rack_placed_at,
            line_status:        r.line_status,
        });
    }

    // Fetch item names for distinct part_numbers (optional enrichment)
    const partNums = [...new Set(placements.map(p => p.part_number).filter(Boolean))];
    if (partNums.length > 0) {
        const { data: items } = await ctx.db
            .from('items')
            .select('part_number, item_name')
            .in('part_number', partNums)
            .is('deleted_at', null);
        const itemMap = new Map((items ?? []).map((i: any) => [i.part_number, i.item_name]));
        for (const p of placements) {
            p.item_name = itemMap.get(p.part_number) ?? null;
        }
    }

    return jsonResponse({ placements }, { origin });
});

if (import.meta.main) Deno.serve(handler);
