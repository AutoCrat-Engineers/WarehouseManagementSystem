/**
 * gr_mark_placed — Edge Function
 *
 * Called by the legacy RackView when a pallet is physically placed.
 * Wraps `mark_gr_pallet_placed` RPC which updates the GR line and
 * auto-completes the GR when all lines are placed.
 *
 * INPUT:  { gr_id: uuid, pallet_id: uuid, rack_location_code: string }
 * OUTPUT: { success: true, remaining: integer }
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
        gr_id:              'uuid',
        pallet_id:          'uuid',
        rack_location_code: 'string',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const { data, error } = await ctx.db.rpc('mark_gr_pallet_placed', {
        p_gr_id:              body.gr_id,
        p_pallet_id:          body.pallet_id,
        p_rack_location_code: body.rack_location_code,
        p_user_id:            ctx.userId,
    });

    if (error) {
        const m = mapPgError(error);
        return errorResponse(m.code, m.message, { origin });
    }
    return jsonResponse(data, { origin });
});

if (import.meta.main) Deno.serve(handler);
