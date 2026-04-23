/**
 * gr_confirm_receipt — Edge Function
 *
 * Wraps the atomic `confirm_goods_receipt` RPC. Creates GR header + lines,
 * transitions pallets DISPATCHED → ARRIVED_AT_3PL, writes audit log.
 *
 * INPUT:
 *   {
 *     proforma_invoice_id: uuid,
 *     warehouse_id: uuid,
 *     lines: [
 *       { pallet_id, pallet_number, part_number, msn_code,
 *         invoice_number, bpa_number,
 *         expected_qty, received_qty?,
 *         line_status: 'RECEIVED' | 'MISSING' | 'DAMAGED' | 'SHORT' | 'QUALITY_HOLD',
 *         discrepancy_note? }
 *     ],
 *     notes?: string,
 *     idempotency_key?: uuid
 *   }
 *
 * OUTPUT (from RPC):
 *   { success, gr_id, gr_number, pallets_expected, pallets_received,
 *     pallets_missing, qty_expected, qty_received, variance_qty,
 *     pending_placement }
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
        proforma_invoice_id: 'uuid',
        warehouse_id:        'uuid',
        lines:               'jsonb_array',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const { data, error } = await ctx.db.rpc('confirm_goods_receipt', {
        p_proforma_invoice_id: body.proforma_invoice_id,
        p_warehouse_id:        body.warehouse_id,
        p_lines:               body.lines,
        p_notes:               body.notes ?? null,
        p_user_id:             ctx.userId,
        p_idempotency_key:     body.idempotency_key ?? null,
    });

    if (error) {
        const m = mapPgError(error);
        return errorResponse(m.code, m.message, { origin, details: { pg_code: error.code } });
    }

    return jsonResponse(data, { origin });
});

if (import.meta.main) Deno.serve(handler);
