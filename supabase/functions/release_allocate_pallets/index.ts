/**
 * release_allocate_pallets — Edge Function
 *
 * Commits the wizard's pallet picks to release_pallet_holds. The first
 * release to hold a pallet gets ALLOCATED; later ones queue as RESERVED.
 * Priority is release.need_by_date then created_at.
 *
 * INPUT:
 *   {
 *     release_id: uuid,                                REQ
 *     pallets: [{ pallet_id, part_number, quantity, warehouse_id? }]  REQ
 *   }
 *
 * OUTPUT:
 *   { success, release_id, allocated, reserved }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler, mapPgError } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const v = validate(body, { release_id: 'uuid' });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    if (!Array.isArray(body.pallets) || body.pallets.length === 0) {
        return errorResponse('VALIDATION_FAILED', 'pallets must be a non-empty array', { origin });
    }

    const { data, error } = await ctx.db.rpc('release_allocate_pallets', {
        p_release_id: body.release_id,
        p_pallets:    body.pallets,
        p_user_id:    ctx.userId,
    });

    if (error) {
        const m = mapPgError(error);
        return errorResponse(m.code, m.message, { origin, details: { pg_code: error.code } });
    }
    return jsonResponse(data, { origin });
});

if (import.meta.main) Deno.serve(handler);
