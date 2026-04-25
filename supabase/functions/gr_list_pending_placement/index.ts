/**
 * gr_list_pending_placement — Edge Function
 *
 * Used by the legacy RackView when it receives ?gr=<gr_number> query param.
 * Returns the GR header + all lines still awaiting physical placement.
 *
 * INPUT:  { gr_number: string }  OR  { gr_id: uuid }
 * OUTPUT:
 *   {
 *     gr: {...},
 *     pending_lines: [
 *       { id, pallet_id, pallet_number, part_number, msn_code,
 *         received_qty, line_status, rack_placed_at, rack_location_code }
 *     ],
 *     placed_lines: [...]      -- lines already placed (for context)
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
    const grNumber = (body.gr_number as string | undefined) ?? null;
    const grId     = (body.gr_id as string | undefined) ?? null;
    if (!grNumber && !grId) {
        return errorResponse('VALIDATION_FAILED', 'Provide gr_number or gr_id', { origin });
    }

    let grQ = ctx.db.from('goods_receipts').select('*').limit(1);
    if (grId) grQ = grQ.eq('id', grId);
    else      grQ = grQ.eq('gr_number', grNumber);

    const { data: grs, error: grErr } = await grQ;
    if (grErr) return errorResponse('INTERNAL_ERROR', grErr.message, { origin });
    if (!grs || grs.length === 0) {
        return errorResponse('NOT_FOUND', 'Goods receipt not found', { origin });
    }
    const gr = grs[0];

    const { data: lines, error: lErr } = await ctx.db
        .from('goods_receipt_lines')
        .select('*')
        .eq('gr_id', gr.id)
        .in('line_status', ['RECEIVED', 'DAMAGED', 'SHORT', 'QUALITY_HOLD'])
        .order('created_at', { ascending: true });
    if (lErr) return errorResponse('INTERNAL_ERROR', lErr.message, { origin });

    const pending = (lines ?? []).filter((l: any) => !l.rack_placed_at);
    const placed  = (lines ?? []).filter((l: any) =>  l.rack_placed_at);

    return jsonResponse({
        gr,
        pending_lines: pending,
        placed_lines:  placed,
        total:         lines?.length ?? 0,
        pending_count: pending.length,
        placed_count:  placed.length,
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
