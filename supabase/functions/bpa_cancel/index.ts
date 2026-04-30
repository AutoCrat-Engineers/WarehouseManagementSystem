/**
 * bpa_cancel — Edge Function
 *
 * Cancel a BPA. Sets customer_agreements.status = 'CANCELLED' and writes
 * an audit entry. Fails if the BPA already has released pallets (hard
 * stop — once stock is committed to customer, cancellation goes through
 * an amendment flow, not a blanket cancel).
 *
 * INPUT:  { agreement_id: uuid, reason?: string }
 * OUTPUT: { success, agreement_id, prev_status, new_status }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const v = validate(body, { agreement_id: 'uuid' });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    // Fetch current status
    const { data: agr, error: agrErr } = await ctx.db
        .from('customer_agreements')
        .select('id, agreement_number, status')
        .eq('id', body.agreement_id)
        .maybeSingle();
    if (agrErr) return errorResponse('INTERNAL_ERROR', agrErr.message, { origin });
    if (!agr)   return errorResponse('NOT_FOUND',      'Agreement not found', { origin });
    if (agr.status === 'CANCELLED') {
        return errorResponse('ALREADY_CANCELLED', 'BPA is already cancelled', { origin });
    }

    // Guard: block cancel if any releases exist on this BPA
    const { count: releaseCount } = await ctx.db
        .from('blanket_releases')
        .select('id', { count: 'exact', head: true })
        .eq('agreement_id', body.agreement_id);
    if ((releaseCount ?? 0) > 0) {
        return errorResponse('HAS_RELEASES',
            `Cannot cancel — ${releaseCount} release(s) already exist on this BPA. Cancel the releases first, or create an amendment.`,
            { origin });
    }

    const prevStatus = agr.status;

    const { error: upErr } = await ctx.db
        .from('customer_agreements')
        .update({ status: 'CANCELLED', updated_at: new Date().toISOString() })
        .eq('id', body.agreement_id);
    if (upErr) return errorResponse('INTERNAL_ERROR', upErr.message, { origin });

    // Audit
    await ctx.db.from('release_audit_log').insert({
        entity_type:   'AGREEMENT',
        entity_id:     body.agreement_id,
        entity_number: agr.agreement_number,
        action:        'CANCELLED',
        metadata:      {
            prev_status: prevStatus,
            reason:      body.reason ?? null,
        },
        performed_by:  ctx.userId,
    });

    return jsonResponse({
        success:      true,
        agreement_id: body.agreement_id,
        prev_status:  prevStatus,
        new_status:   'CANCELLED',
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
