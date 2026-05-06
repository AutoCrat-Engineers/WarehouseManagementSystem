/**
 * gr_draft_discard — Edge Function
 *
 * Deletes the caller's draft for a (proforma_invoice, mpl) pair. Called on
 * successful confirm (from gr_confirm_receipt's caller, after the GR is
 * created) and on explicit "Cancel & discard draft".
 *
 * Idempotent: returns ok even when no draft exists.
 *
 * INPUT:  { proforma_invoice_id: uuid, mpl_id: uuid }
 * OUTPUT: 200 { discarded: bool }
 */
import { withMutationGuard } from '../_shared/session.ts';
import { jsonResponse, errorResponse, withErrorHandler } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler((req) => withMutationGuard(req, { label: 'Discarding GR Draft' }, async (ctx) => {
    const origin = req.headers.get('origin') ?? undefined;
    const body = await parseBody(req);
    const v = validate(body, {
        proforma_invoice_id: 'uuid',
        mpl_id:              'uuid',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const { data, error } = await ctx.db
        .from('gr_drafts')
        .delete()
        .match({
            user_id:             ctx.userId,
            proforma_invoice_id: body.proforma_invoice_id,
            mpl_id:              body.mpl_id,
        })
        .select('id');
    if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });

    return jsonResponse({ discarded: (data?.length ?? 0) > 0 }, { origin });
}));

if (import.meta.main) Deno.serve(handler);
