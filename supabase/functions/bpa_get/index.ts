/**
 * bpa_get — Edge Function
 *
 * Fetch one BPA with: header + parts + last N revisions +
 * optional fulfillment dashboard snapshot from mv_bpa_fulfillment_dashboard.
 *
 * INPUT (JSON):
 *   {
 *     agreement_id: uuid,          // OR
 *     agreement_number: string,    // + optional revision
 *     revision?: integer,          // default = latest
 *     revision_history_limit?: 10  // how many recent revisions to return
 *   }
 *
 * OUTPUT:
 *   {
 *     success: true,
 *     agreement: {...},
 *     parts: [...],
 *     revisions: [...],            // latest N
 *     fulfillment: [...]           // from mv_bpa_fulfillment_dashboard
 *   }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const agreementId = body.agreement_id as string | undefined;
    const agreementNumber = body.agreement_number as string | undefined;
    const revisionHistoryLimit = Math.min(50, Math.max(1, Number(body.revision_history_limit ?? 10)));

    if (!agreementId && !agreementNumber) {
        return errorResponse('VALIDATION_FAILED',
            'Either agreement_id or agreement_number is required', { origin });
    }

    // ── Locate agreement ─────────────────────────────────────────────
    let q = ctx.db.from('customer_agreements').select('*').limit(1);
    if (agreementId) {
        q = q.eq('id', agreementId);
    } else {
        q = q.eq('agreement_number', agreementNumber!);
        if (body.revision !== undefined && body.revision !== null) {
            q = q.eq('agreement_revision', Number(body.revision));
        } else {
            q = q.order('agreement_revision', { ascending: false });
        }
    }
    const { data: agreements, error: aErr } = await q;
    if (aErr) return errorResponse('INTERNAL_ERROR', aErr.message, { origin });
    if (!agreements || agreements.length === 0) {
        return errorResponse('NOT_FOUND', 'Agreement not found', { origin });
    }
    const agreement = agreements[0];

    // ── Parallel: parts + revisions + fulfillment ───────────────────
    const [partsR, revisionsR, fulfillmentR] = await Promise.all([
        ctx.db.from('customer_agreement_parts')
            .select('*')
            .eq('agreement_id', agreement.id)
            .order('line_number', { ascending: true }),
        ctx.db.from('customer_agreement_revisions')
            .select('*')
            .eq('agreement_id', agreement.id)
            .order('revision_date', { ascending: false })
            .limit(revisionHistoryLimit),
        ctx.db.from('mv_bpa_fulfillment_dashboard')
            .select('*')
            .eq('agreement_id', agreement.id),
    ]);

    if (partsR.error) return errorResponse('INTERNAL_ERROR', partsR.error.message, { origin });

    return jsonResponse({
        success:     true,
        agreement,
        parts:       partsR.data ?? [],
        revisions:   revisionsR.data ?? [],
        fulfillment: fulfillmentR.data ?? [],
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
