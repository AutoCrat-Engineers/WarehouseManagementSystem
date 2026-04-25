/**
 * pallet_place — Edge Function
 *
 * Thin wrapper around the `place_pallet_on_rack` RPC (atomic: locks source
 * pallet + target cell; prevents double-occupancy).
 *
 * INPUT (JSON):
 *   {
 *     pallet_id:        uuid,
 *     warehouse_id:     uuid,
 *     rack:             "A",
 *     location_number:  42,
 *     idempotency_key?: uuid
 *   }
 *
 * OUTPUT (from RPC):
 *   { success, rack_location_id, location_code, pallet_id }
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
        pallet_id: 'uuid',
        warehouse_id: 'uuid',
        rack: 'string',
        location_number: 'positive_int',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const { data, error } = await ctx.db.rpc('place_pallet_on_rack', {
        p_pallet_id: body.pallet_id,
        p_warehouse_id: body.warehouse_id,
        p_rack: body.rack,
        p_location_number: body.location_number,
        p_user_id: ctx.userId,
        p_idempotency_key: body.idempotency_key ?? null,
    });

    if (error) {
        const m = mapPgError(error);
        return errorResponse(m.code, m.message, { origin, details: { pg_code: error.code } });
    }

    return jsonResponse(data, { origin });
});

if (import.meta.main) Deno.serve(handler);
