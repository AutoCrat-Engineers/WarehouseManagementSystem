/**
 * sub_invoice_create — Edge Function (v2: multi-invoice allocation)
 *
 * Wraps `create_sub_invoice_v2` RPC. A single release can draw pallets
 * from multiple parent invoices; each allocation row binds one pallet
 * to one parent_invoice_line with a quantity. The RPC produces ONE
 * sub-invoice (header) with N lines and knocks off each parent source.
 *
 * INPUT (JSON):
 *   {
 *     allocations: [
 *       { parent_invoice_line_id: uuid, pallet_id: uuid, quantity: int },
 *       ...
 *     ],                            REQ, non-empty
 *     blanket_release_id?:   uuid,   optional (null for ad-hoc)
 *     customer_po_number:    string, REQ   (e.g. "260067252-10")
 *     buyer_name?:           string,
 *     sub_invoice_date?:     iso_date,
 *     notes?:                string,
 *     idempotency_key?:      uuid
 *   }
 *
 * OUTPUT:
 *   { success, sub_invoice_id, sub_invoice_number,
 *     tariff_invoice_id, tariff_invoice_number,
 *     pallet_count, quantity, total_amount, parent_invoice_count }
 */
import { withMutationGuard } from '../_shared/session.ts';
import { jsonResponse, errorResponse, withErrorHandler, mapPgError } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler((req) => withMutationGuard(req, { label: 'Creating Sub-Invoice' }, async (ctx) => {
    const origin = req.headers.get('origin') ?? undefined;
    const body = await parseBody(req);
    const v = validate(body, {
        customer_po_number: 'string',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    if (!Array.isArray(body.allocations) || body.allocations.length === 0) {
        return errorResponse('VALIDATION_FAILED', 'allocations must be a non-empty array', { origin });
    }
    for (const a of body.allocations) {
        if (!a || typeof a !== 'object') {
            return errorResponse('VALIDATION_FAILED', 'allocation must be an object', { origin });
        }
        if (!a.parent_invoice_line_id || !a.pallet_id || !Number.isInteger(a.quantity) || a.quantity <= 0) {
            return errorResponse('VALIDATION_FAILED',
                'each allocation needs parent_invoice_line_id, pallet_id, positive integer quantity', { origin });
        }
    }

    const { data, error } = await ctx.db.rpc('create_sub_invoice_v2', {
        p_allocations:        body.allocations,
        p_blanket_release_id: body.blanket_release_id ?? null,
        p_customer_po_number: body.customer_po_number,
        p_buyer_name:         body.buyer_name ?? null,
        p_sub_invoice_date:   body.sub_invoice_date ?? null,
        p_notes:              body.notes ?? null,
        p_user_id:            ctx.userId,
        p_idempotency_key:    body.idempotency_key ?? null,
    });

    if (error) {
        const m = mapPgError(error);
        return errorResponse(m.code, m.message, { origin, details: { pg_code: error.code } });
    }

    return jsonResponse(data, { origin });
}));

if (import.meta.main) Deno.serve(handler);
