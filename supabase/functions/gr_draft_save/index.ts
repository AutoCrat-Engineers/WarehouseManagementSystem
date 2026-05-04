/**
 * gr_draft_save — Edge Function
 *
 * Upserts the caller's autosave draft for a single (proforma_invoice, mpl).
 *
 * Concurrency: optimistic via `expected_version`.
 *   - First save: client sends expected_version = 0 → row inserted with version 1.
 *   - Subsequent saves: client sends the version it received in the previous
 *     reply; server only writes if the row's current version matches. A second
 *     tab editing the same draft will collide and get CONCURRENT_MODIFICATION.
 *
 * INPUT:  { proforma_invoice_id: uuid,
 *           mpl_id: uuid,
 *           warehouse_id?: uuid,
 *           payload: object,
 *           expected_version: int }
 * OUTPUT: 200 { draft: { id, version, updated_at } }
 *         409 CONCURRENT_MODIFICATION — another save raced this one
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
        warehouse_id:        'uuid_optional',
        payload:             'jsonb_object',
        expected_version:    'int',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const expected = Number(body.expected_version);
    if (!Number.isInteger(expected) || expected < 0) {
        return errorResponse('VALIDATION_FAILED', 'expected_version must be a non-negative integer.', { origin });
    }

    const baseFilter = {
        user_id:             ctx.userId,
        proforma_invoice_id: body.proforma_invoice_id,
        mpl_id:              body.mpl_id,
    };

    // Look up current row to decide insert vs versioned-update.
    const { data: existing, error: selErr } = await ctx.db
        .from('gr_drafts')
        .select('id, version')
        .match(baseFilter)
        .maybeSingle();
    if (selErr) return errorResponse('INTERNAL_ERROR', selErr.message, { origin });

    if (!existing) {
        if (expected !== 0) {
            return errorResponse(
                'CONCURRENT_MODIFICATION',
                'No draft exists yet but client sent a non-zero expected_version. Reload before retrying.',
                { origin },
            );
        }
        const { data: inserted, error: insErr } = await ctx.db
            .from('gr_drafts')
            .insert({
                ...baseFilter,
                warehouse_id: body.warehouse_id ?? null,
                payload:      body.payload,
                version:      1,
            })
            .select('id, version, updated_at')
            .single();
        if (insErr) return errorResponse('INTERNAL_ERROR', insErr.message, { origin });
        return jsonResponse({ draft: inserted }, { origin });
    }

    if (Number(existing.version) !== expected) {
        return errorResponse(
            'CONCURRENT_MODIFICATION',
            `Draft was modified elsewhere (current version ${existing.version}, expected ${expected}). Reload to merge.`,
            { origin, details: { current_version: existing.version } },
        );
    }

    const nextVersion = expected + 1;
    const { data: updated, error: updErr } = await ctx.db
        .from('gr_drafts')
        .update({
            payload:      body.payload,
            warehouse_id: body.warehouse_id ?? null,
            version:      nextVersion,
        })
        .eq('id', existing.id)
        .eq('version', expected)              // double-guard against TOCTOU
        .select('id, version, updated_at')
        .maybeSingle();
    if (updErr) return errorResponse('INTERNAL_ERROR', updErr.message, { origin });
    if (!updated) {
        // Row version moved between SELECT and UPDATE.
        return errorResponse('CONCURRENT_MODIFICATION', 'Draft changed during save.', { origin });
    }

    return jsonResponse({ draft: updated }, { origin });
});

if (import.meta.main) Deno.serve(handler);
