/**
 * gr_confirm_receipt — Edge Function
 *
 * Wraps the atomic `confirm_goods_receipt` RPC. Creates GR header + lines,
 * transitions pallets DISPATCHED → ARRIVED_AT_3PL, writes audit log.
 *
 * Session model: requireActiveSession + withTransactionLock keyed by the
 * proforma id so concurrent confirmations across sessions can never collide.
 */
import { requireActiveSession, withTransactionLock } from '../_shared/session.ts';
import { jsonResponse, errorResponse, withErrorHandler, mapPgError } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;

    const session = await requireActiveSession(req);
    if (!session.ok) return session.response;
    const ctx = session.ctx;

    const body = await parseBody(req);
    const v = validate(body, {
        proforma_invoice_id: 'uuid',
        warehouse_id:        'uuid',
        lines:               'jsonb_array',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    return await withTransactionLock(ctx, {
        key:   `gr_confirm_receipt:${body.proforma_invoice_id}`,
        label: 'Confirming Goods Receipt',
    }, async () => {
        const { data, error } = await ctx.db.rpc('confirm_goods_receipt', {
            p_proforma_invoice_id: body.proforma_invoice_id,
            p_warehouse_id:        body.warehouse_id,
            p_lines:               body.lines,
            p_notes:               body.notes ?? null,
            p_user_id:             ctx.userId,
            p_idempotency_key:     body.idempotency_key ?? null,
            p_mpl_id:              body.mpl_id ?? null,
        });
        if (error) {
            const m = mapPgError(error);
            return errorResponse(m.code, m.message, { origin, details: { pg_code: error.code } });
        }
        return jsonResponse(data, { origin });
    });
});

if (import.meta.main) Deno.serve(handler);
