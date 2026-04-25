/**
 * tariff_submit — Edge Function
 *
 * Advances a tariff invoice through its state machine. Each transition is
 * validated by the trigger `validate_tariff_invoice_state_transition`.
 *
 * Allowed transitions:
 *   DRAFT     → SUBMITTED | CANCELLED
 *   SUBMITTED → CLAIMED   | CANCELLED
 *   CLAIMED   → PAID      | CANCELLED
 *
 * INPUT (JSON):
 *   {
 *     tariff_invoice_id: uuid,
 *     target_status: 'SUBMITTED'|'CLAIMED'|'PAID'|'CANCELLED',
 *     notes?: string,
 *     expected_row_version: integer     (optimistic lock)
 *   }
 *
 * Role gate: L3 / FINANCE / ADMIN only (finance signs off on tariff claims).
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, forbidden, withErrorHandler, mapPgError } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

const ALLOWED_TARGETS = ['SUBMITTED', 'CLAIMED', 'PAID', 'CANCELLED'];

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req, { requireRoles: ['L3', 'FINANCE', 'ADMIN'] });
    if (!ctx) return forbidden(origin, 'Advancing a tariff invoice requires L3, FINANCE, or ADMIN role.');

    const body = await parseBody(req);
    const v = validate(body, {
        tariff_invoice_id:    'uuid',
        target_status:        'string',
        expected_row_version: 'int',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const targetStatus = String(body.target_status).toUpperCase();
    if (!ALLOWED_TARGETS.includes(targetStatus)) {
        return errorResponse('VALIDATION_FAILED',
            `target_status must be one of ${ALLOWED_TARGETS.join(', ')}`, { origin });
    }

    // Optimistic lock: ensure row_version matches
    const { data: cur, error: curErr } = await ctx.db
        .from('tariff_invoices')
        .select('id, tariff_invoice_number, status, row_version, notes')
        .eq('id', body.tariff_invoice_id)
        .single();
    if (curErr || !cur) return errorResponse('NOT_FOUND', 'Tariff invoice not found', { origin });
    if (cur.row_version !== body.expected_row_version) {
        return errorResponse('CONCURRENT_MODIFICATION',
            `Stale version (expected ${body.expected_row_version}, found ${cur.row_version}). Refresh and retry.`,
            { origin });
    }

    const updated = {
        status: targetStatus,
        notes:  body.notes ? `${cur.notes ? cur.notes + '\n' : ''}[${targetStatus}] ${body.notes}` : cur.notes,
    };

    const { data, error } = await ctx.db
        .from('tariff_invoices')
        .update(updated)
        .eq('id', body.tariff_invoice_id)
        .eq('row_version', body.expected_row_version)
        .select('id, tariff_invoice_number, status, row_version')
        .single();

    if (error) {
        const m = mapPgError(error);
        return errorResponse(m.code, m.message, { origin, details: { pg_code: error.code } });
    }

    await ctx.db.from('release_audit_log').insert({
        entity_type:   'TARIFF_INVOICE',
        entity_id:     body.tariff_invoice_id,
        entity_number: data.tariff_invoice_number,
        action:        'STATE_CHANGE',
        old_values:    { status: cur.status },
        new_values:    { status: targetStatus },
        metadata:      { notes: body.notes },
        performed_by:  ctx.userId,
    });

    return jsonResponse({
        success:  true,
        tariff:   data,
        prev_status: cur.status,
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
