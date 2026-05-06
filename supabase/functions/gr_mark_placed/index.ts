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
import { withMutationGuard } from '../_shared/session.ts';
import { jsonResponse, errorResponse, withErrorHandler, mapPgError } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler((req) => withMutationGuard(req, { label: 'Marking GR Pallet Placed' }, async (ctx) => {
    const origin = req.headers.get('origin') ?? undefined;
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
}));

if (import.meta.main) Deno.serve(handler);
