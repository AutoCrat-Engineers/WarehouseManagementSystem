/**
 * rack_get_cell_chain — Edge Function
 *
 * Returns the full back-chain for a rack cell: pallet → cartons → work orders
 * → packing list → invoice → BPA, plus placement + move history.
 *
 * Used when the user clicks on a cell in the rack grid.
 *
 * INPUT (JSON):
 *   { rack_location_id: uuid }   -- OR --
 *   { warehouse_id, rack, location_number }
 *
 * OUTPUT:
 *   {
 *     success: true,
 *     cell: { ...mv_rack_view row... },
 *     pallet: { id, pallet_number, state, current_qty, ... },
 *     cartons: [ ... ],
 *     packing_list: {...},
 *     invoice: {...},
 *     blanket_order: {...},
 *     agreement: {...},
 *     move_history: [...]
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

    // ── Locate the cell ──────────────────────────────────────────────
    let cellQuery = ctx.db.from('mv_rack_view').select('*').limit(1);
    if (body.rack_location_id) {
        cellQuery = cellQuery.eq('rack_location_id', body.rack_location_id);
    } else if (body.warehouse_id && body.rack && body.location_number !== undefined) {
        cellQuery = cellQuery
            .eq('warehouse_id', body.warehouse_id)
            .eq('rack', body.rack)
            .eq('location_number', body.location_number);
    } else {
        return errorResponse('VALIDATION_FAILED',
            'Provide rack_location_id OR (warehouse_id + rack + location_number)', { origin });
    }

    const { data: cells, error: cErr } = await cellQuery;
    if (cErr) return errorResponse('INTERNAL_ERROR', cErr.message, { origin });
    if (!cells || cells.length === 0) {
        return errorResponse('NOT_FOUND', 'Rack cell not found', { origin });
    }
    const cell = cells[0];

    // ── Parallel: back-chain pieces ──────────────────────────────────
    type QueryResult<T = unknown> = { data: T | null; error: { message: string } | null };

    const palletP = cell.pallet_id
        ? ctx.db.from('pack_pallets').select('*').eq('id', cell.pallet_id).maybeSingle()
        : Promise.resolve<QueryResult>({ data: null, error: null });

    const palletCartonsP = cell.pallet_id
        ? ctx.db.from('pack_pallet_containers')
            .select('*')
            .eq('pallet_id', cell.pallet_id)
        : Promise.resolve<QueryResult>({ data: [], error: null });

    const plP = cell.packing_list_id
        ? ctx.db.from('master_packing_lists').select('*').eq('id', cell.packing_list_id).maybeSingle()
        : Promise.resolve<QueryResult>({ data: null, error: null });

    const invP = cell.parent_invoice_id
        ? ctx.db.from('pack_invoices').select('*').eq('id', cell.parent_invoice_id).maybeSingle()
        : Promise.resolve<QueryResult>({ data: null, error: null });

    const boP = cell.blanket_order_id
        ? ctx.db.from('blanket_orders').select('*').eq('id', cell.blanket_order_id).maybeSingle()
        : Promise.resolve<QueryResult>({ data: null, error: null });

    const agrP = cell.agreement_id
        ? ctx.db.from('customer_agreements').select('*').eq('id', cell.agreement_id).maybeSingle()
        : Promise.resolve<QueryResult>({ data: null, error: null });

    // Move history: walk previous_location_id backwards up to 20 hops
    const historyP = ctx.db.from('warehouse_rack_locations')
        .select('id, rack, location_number, location_code, placed_at, placed_by, move_reason, previous_location_id')
        .eq('pallet_id', cell.pallet_id ?? '00000000-0000-0000-0000-000000000000')
        .order('placed_at', { ascending: true })
        .limit(20);

    const [pallet, cartons, pl, invoice, bo, agreement, history] = await Promise.all([
        palletP, palletCartonsP, plP, invP, boP, agrP, historyP,
    ]);

    return jsonResponse({
        success:       true,
        cell,
        pallet:        pallet.data,
        cartons:       cartons.data ?? [],
        packing_list:  pl.data,
        invoice:       invoice.data,
        blanket_order: bo.data,
        agreement:     agreement.data,
        move_history:  history.data ?? [],
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
