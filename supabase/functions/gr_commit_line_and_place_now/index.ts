/**
 * gr_commit_line_and_place_now — Edge Function
 *
 * Inline "Verify Place Now" for a single pallet during inbound receiving.
 * Wraps the atomic `confirm_gr_line_and_place` RPC. Upserts the GR for
 * (proforma_invoice_id, mpl_id), inserts exactly one goods_receipt_line
 * already marked placed at the given rack location, transitions the
 * pallet, recomputes header counters, writes audit log.
 *
 * INPUT:
 *   {
 *     proforma_invoice_id: uuid,
 *     warehouse_id:        uuid,
 *     mpl_id:              uuid,
 *     line: {
 *       pallet_id, pallet_number, part_number, msn_code,
 *       invoice_number, bpa_number,
 *       expected_qty, received_qty?,
 *       line_status: 'RECEIVED' | 'DAMAGED' | 'SHORT' | 'QUALITY_HOLD',
 *       discrepancy_note?, reason_code?, photo_paths?
 *     },
 *     rack_location_code:  string,
 *     idempotency_key?:    uuid
 *   }
 *
 * OUTPUT:
 *   { success, gr_id, gr_number, mpl_id, pallet_id,
 *     rack_location_code, remaining_in_gr, first_creation }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler, mapPgError } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const v = validate(body, {
        proforma_invoice_id: 'uuid',
        warehouse_id:        'uuid',
        mpl_id:              'uuid',
        line:                'jsonb_object',
        rack_location_code:  'string',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const { data, error } = await ctx.db.rpc('confirm_gr_line_and_place', {
        p_proforma_invoice_id: body.proforma_invoice_id,
        p_warehouse_id:        body.warehouse_id,
        p_mpl_id:              body.mpl_id,
        p_line:                body.line,
        p_rack_location_code:  body.rack_location_code,
        p_user_id:             ctx.userId,
        p_idempotency_key:     body.idempotency_key ?? null,
    });

    if (error) {
        const m = mapPgError(error);
        return errorResponse(m.code, m.message, { origin, details: { pg_code: error.code } });
    }

    return jsonResponse(data, { origin });
});

if (import.meta.main) Deno.serve(handler);
