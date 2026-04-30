/**
 * bpa_amend — Edge Function
 *
 * Amend an existing BPA (price / qty / dates / etc.) via the atomic
 * `amend_bpa` RPC. Snapshots previous state to customer_agreement_revisions,
 * cascades to blanket_order_line_configs, writes audit.
 *
 * INPUT (JSON):
 *   {
 *     agreement_id:   uuid,                                REQ
 *     expected_row_version: integer,                       REQ (optimistic lock)
 *     revision_reason: "Customer amendment 2026-04-01",    REQ
 *     changes: {
 *       header: { unit_price?, effective_end_date?,
 *                 payment_terms?, incoterms?,
 *                 buyer_name?, buyer_email?,
 *                 delivery_location?, ship_via? },
 *       parts:  [ { part_number, unit_price?, blanket_quantity?,
 *                    release_multiple?, min_warehouse_stock?,
 *                    max_warehouse_stock?, drawing_revision?,
 *                    avg_monthly_demand?, safety_stock? } ]
 *     },
 *     idempotency_key?: uuid
 *   }
 *
 * OUTPUT:
 *   RPC return value from amend_bpa:
 *     { success, agreement_id, revision_from, revision_to, revision_id,
 *       parts_changed, cascaded_to_line_configs }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, forbidden, withErrorHandler, mapPgError } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;

    // Only L3 / ADMIN / FINANCE can amend a BPA
    const ctx = await authenticateRequest(req, {
        requireRoles: ['L3', 'ADMIN', 'FINANCE'],
    });
    if (!ctx) return forbidden(origin, 'Amending a BPA requires L3, ADMIN, or FINANCE role.');

    const body = await parseBody(req);
    const v = validate(body, {
        agreement_id:          'uuid',
        expected_row_version:  'int',
        revision_reason:       'string',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const changes = body.changes;
    if (typeof changes !== 'object' || changes === null) {
        return errorResponse('VALIDATION_FAILED', "Field 'changes' must be an object", { origin });
    }

    // ── Call the amend_bpa RPC ───────────────────────────────────────
    const { data, error } = await ctx.db.rpc('amend_bpa', {
        p_agreement_id:          body.agreement_id,
        p_changes:               changes,
        p_revision_reason:       body.revision_reason,
        p_expected_row_version:  body.expected_row_version,
        p_user_id:               ctx.userId,
        p_idempotency_key:       body.idempotency_key ?? null,
    });

    if (error) {
        const m = mapPgError(error);
        return errorResponse(m.code, m.message, { origin, details: { pg_code: error.code } });
    }

    return jsonResponse(data, { origin });
});

if (import.meta.main) Deno.serve(handler);
