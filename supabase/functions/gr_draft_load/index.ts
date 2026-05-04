/**
 * gr_draft_load — Edge Function
 *
 * Returns the caller's autosave draft for a (proforma_invoice, mpl) pair,
 * or null if none. Used to restore in-progress receive sessions on screen
 * open / page refresh.
 *
 * INPUT:  { proforma_invoice_id: uuid, mpl_id: uuid }
 * OUTPUT: 200 { draft: { id, version, payload, updated_at } | null }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const v = validate(body, {
        proforma_invoice_id: 'uuid',
        mpl_id:              'uuid',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const { data, error } = await ctx.db
        .from('gr_drafts')
        .select('id, version, payload, updated_at, warehouse_id')
        .match({
            user_id:             ctx.userId,
            proforma_invoice_id: body.proforma_invoice_id,
            mpl_id:              body.mpl_id,
        })
        .maybeSingle();
    if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });

    return jsonResponse({ draft: data ?? null }, { origin });
});

if (import.meta.main) Deno.serve(handler);
