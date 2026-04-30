/**
 * pallet_move — Edge Function
 *
 * Wrapper around `move_pallet_rack_location` RPC (atomic: locks source +
 * destination cells, writes previous_location_id history chain).
 *
 * INPUT (JSON):
 *   {
 *     pallet_id:             uuid,
 *     dest_warehouse_id:     uuid,
 *     dest_rack:             "B",
 *     dest_location_number:  17,
 *     move_reason:           "Consolidating rack A",
 *     idempotency_key?:      uuid
 *   }
 *
 * OUTPUT:
 *   { success, pallet_id, from_location, to_location, dest_rack_location_id }
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
        pallet_id:             'uuid',
        dest_warehouse_id:     'uuid',
        dest_rack:             'string',
        dest_location_number:  'positive_int',
        move_reason:           'string',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const { data, error } = await ctx.db.rpc('move_pallet_rack_location', {
        p_pallet_id:            body.pallet_id,
        p_dest_warehouse_id:    body.dest_warehouse_id,
        p_dest_rack:            body.dest_rack,
        p_dest_location_number: body.dest_location_number,
        p_move_reason:          body.move_reason,
        p_user_id:              ctx.userId,
        p_idempotency_key:      body.idempotency_key ?? null,
    });

    if (error) {
        const m = mapPgError(error);
        return errorResponse(m.code, m.message, { origin, details: { pg_code: error.code } });
    }

    return jsonResponse(data, { origin });
});

if (import.meta.main) Deno.serve(handler);
