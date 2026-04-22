/**
 * sub_invoice_create — Edge Function
 *
 * THE CRITICAL RELEASE OPERATION. Wraps the `create_sub_invoice` RPC
 * which atomically touches 7 tables with row locks:
 *   1. LOCK pack_invoice_line_items (parent)
 *   2. INSERT pack_sub_invoices
 *   3. INSERT pack_sub_invoice_lines
 *   4. UPDATE pack_invoice_line_items (knock-off)
 *   5. INSERT release_pallet_assignments (N rows)
 *   6. UPDATE blanket_order_line_configs (running totals)
 *   7. INSERT tariff_invoices (DRAFT)
 *   8. INSERT release_audit_log
 *   9. UPDATE pack_pallets state → RELEASED
 *
 * INPUT (JSON):
 *   {
 *     parent_invoice_line_id: uuid,    REQ
 *     blanket_release_id?:    uuid,    (null for ad-hoc release)
 *     pallet_ids:             uuid[],  REQ
 *     quantity:               integer, REQ
 *     customer_po_number:     "260067252-10",
 *     buyer_name?:            string,
 *     sub_invoice_date?:      iso_date,
 *     notes?:                 string,
 *     idempotency_key?:       uuid     STRONGLY RECOMMENDED from client
 *   }
 *
 * OUTPUT (from RPC):
 *   { success, sub_invoice_id, sub_invoice_number,
 *     tariff_invoice_id, tariff_invoice_number,
 *     pallet_count, quantity, total_amount }
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
        parent_invoice_line_id: 'uuid',
        pallet_ids:             'uuid_array',
        quantity:               'positive_int',
        customer_po_number:     'string',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const { data, error } = await ctx.db.rpc('create_sub_invoice', {
        p_parent_invoice_line_id: body.parent_invoice_line_id,
        p_blanket_release_id:     body.blanket_release_id ?? null,
        p_pallet_ids:             body.pallet_ids,
        p_quantity:               body.quantity,
        p_customer_po_number:     body.customer_po_number,
        p_buyer_name:             body.buyer_name ?? null,
        p_sub_invoice_date:       body.sub_invoice_date ?? null,
        p_notes:                  body.notes ?? null,
        p_user_id:                ctx.userId,
        p_idempotency_key:        body.idempotency_key ?? null,
    });

    if (error) {
        const m = mapPgError(error);
        return errorResponse(m.code, m.message, { origin, details: { pg_code: error.code } });
    }

    return jsonResponse(data, { origin });
});

if (import.meta.main) Deno.serve(handler);
