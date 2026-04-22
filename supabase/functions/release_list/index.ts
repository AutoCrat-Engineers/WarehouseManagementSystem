/**
 * release_list — Edge Function
 *
 * Paginated list of blanket releases (customer PO releases) for the
 * Release list UI. Joins to sub-invoice status so UI can show progress.
 *
 * INPUT (JSON):
 *   {
 *     page?: 0, page_size?: 25,
 *     status_filter?: 'ALL' | 'OPEN' | 'FULFILLED' | 'CANCELLED',
 *     search_term?: "260067252",
 *     agreement_id?: uuid
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
    const pageSize = Math.max(1, Math.min(500, Number(body.page_size ?? 25)));
    const offset = page * pageSize;

    const statusFilter = (body.status_filter ?? 'ALL') as string;
    const searchTerm = ((body.search_term ?? '') as string).trim();
    const safeSearch = searchTerm.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    let q = ctx.db.from('blanket_releases')
        .select('*', { count: 'exact' })
        .order('created_at', { ascending: false });

    if (statusFilter !== 'ALL') q = q.eq('status', statusFilter);
    if (body.agreement_id)      q = q.eq('agreement_id', body.agreement_id);
    if (safeSearch) {
        q = q.or(
            `release_number.ilike."%${safeSearch}%",customer_po_base.ilike."%${safeSearch}%",buyer_name.ilike."%${safeSearch}%"`,
        );
    }

    const countQ = (status?: string) => {
        let base = ctx.db.from('blanket_releases').select('id', { count: 'exact', head: true });
        if (status) base = base.eq('status', status);
        return base;
    };

    const [listR, totalR, openR, fulfilledR, cancelledR] = await Promise.all([
        q.range(offset, offset + pageSize - 1),
        countQ(),
        countQ('OPEN'),
        countQ('FULFILLED'),
        countQ('CANCELLED'),
    ]);

    if (listR.error) return errorResponse('INTERNAL_ERROR', listR.error.message, { origin });

    return jsonResponse({
        success:     true,
        releases:    listR.data ?? [],
        total_count: listR.count ?? 0,
        counts: {
            total:     totalR.count ?? 0,
            open:      openR.count ?? 0,
            fulfilled: fulfilledR.count ?? 0,
            cancelled: cancelledR.count ?? 0,
        },
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
