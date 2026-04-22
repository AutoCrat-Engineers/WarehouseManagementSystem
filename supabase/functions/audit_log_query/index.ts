/**
 * audit_log_query — Edge Function
 *
 * Paginated query of `release_audit_log` with filters. L3/ADMIN/FINANCE
 * see all rows; other users see only their own actions (enforced by RLS).
 *
 * INPUT (JSON):
 *   {
 *     entity_type?:  "AGREEMENT"|"SUB_INVOICE"|"RACK_PLACEMENT"|...,
 *     entity_id?:    uuid,
 *     action?:       "CREATED"|"AMENDED"|...,
 *     performed_by?: uuid,
 *     date_from?:    iso_datetime,
 *     date_to?:      iso_datetime,
 *     search_meta?:  "260067252",   -- JSONB GIN search
 *     page?: 0, page_size?: 50
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
    const page = Math.max(0, Number(body.page ?? 0));
    const pageSize = Math.max(1, Math.min(500, Number(body.page_size ?? 50)));
    const offset = page * pageSize;

    let q = ctx.db.from('release_audit_log')
        .select('*', { count: 'exact' })
        .order('performed_at', { ascending: false });

    if (body.entity_type)  q = q.eq('entity_type', body.entity_type);
    if (body.entity_id)    q = q.eq('entity_id', body.entity_id);
    if (body.action)       q = q.eq('action', body.action);
    if (body.performed_by) q = q.eq('performed_by', body.performed_by);
    if (body.date_from)    q = q.gte('performed_at', body.date_from);
    if (body.date_to)      q = q.lte('performed_at', body.date_to);

    // Free-text search on entity_number
    if (body.search_meta) {
        const safe = String(body.search_meta).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
        q = q.ilike('entity_number', `%${safe}%`);
    }

    const { data, error, count } = await q.range(offset, offset + pageSize - 1);
    if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });

    return jsonResponse({
        success:     true,
        entries:     data ?? [],
        total_count: count ?? 0,
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
