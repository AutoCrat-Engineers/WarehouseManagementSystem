/**
 * bpa_list — Edge Function
 *
 * Paginated list of BPAs for the BPA list UI.
 * Supports: search (agreement_number / customer_name / buyer_name),
 *           status filter, pagination, summary counts.
 *
 * INPUT (JSON):
 *   {
 *     page?:         0,
 *     page_size?:    25,        // 1..500
 *     status_filter?:'ALL' | 'DRAFT' | 'ACTIVE' | 'AMENDED' | 'EXPIRED' | 'CANCELLED',
 *     search_term?:  "260067",
 *     customer_code?:"OPW",
 *   }
 *
 * OUTPUT:
 *   {
 *     success: true,
 *     agreements: [...],
 *     total_count,
 *     counts: { total, active, draft, amended, expired, cancelled }
 *   }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody } from '../_shared/schemas.ts';

type StatusFilter = 'ALL' | 'DRAFT' | 'ACTIVE' | 'AMENDED' | 'EXPIRED' | 'CANCELLED';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const page = Math.max(0, Number(body.page ?? 0));
    const pageSize = Math.max(1, Math.min(500, Number(body.page_size ?? 25)));
    const offset = page * pageSize;

    const validFilters: StatusFilter[] = ['ALL','DRAFT','ACTIVE','AMENDED','EXPIRED','CANCELLED'];
    const statusFilter = (validFilters.includes(body.status_filter as StatusFilter)
                          ? body.status_filter : 'ALL') as StatusFilter;
    const searchTerm = ((body.search_term ?? '') as string).trim();
    const customerCode = ((body.customer_code ?? '') as string).trim();

    const safeSearch = searchTerm.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

    // ── Main list query ──────────────────────────────────────────────
    let q = ctx.db.from('customer_agreements')
        .select('*', { count: 'exact' })
        .order('agreement_date', { ascending: false });

    if (statusFilter !== 'ALL') q = q.eq('status', statusFilter);
    if (customerCode) q = q.eq('customer_code', customerCode);
    if (safeSearch) {
        q = q.or(
            `agreement_number.ilike."%${safeSearch}%",customer_name.ilike."%${safeSearch}%",buyer_name.ilike."%${safeSearch}%"`,
        );
    }

    // ── Parallel: list + 6 counts ────────────────────────────────────
    const countQ = (status?: string) => {
        let base = ctx.db.from('customer_agreements').select('id', { count: 'exact', head: true });
        if (status) base = base.eq('status', status);
        return base;
    };

    const [listRes, totalR, activeR, draftR, amendedR, expiredR, cancelledR] = await Promise.all([
        q.range(offset, offset + pageSize - 1),
        countQ(),
        countQ('ACTIVE'),
        countQ('DRAFT'),
        countQ('AMENDED'),
        countQ('EXPIRED'),
        countQ('CANCELLED'),
    ]);

    if (listRes.error) {
        return errorResponse('INTERNAL_ERROR', listRes.error.message, { origin });
    }

    return jsonResponse({
        success: true,
        agreements: listRes.data ?? [],
        total_count: listRes.count ?? 0,
        counts: {
            total:     totalR.count ?? 0,
            active:    activeR.count ?? 0,
            draft:     draftR.count ?? 0,
            amended:   amendedR.count ?? 0,
            expired:   expiredR.count ?? 0,
            cancelled: cancelledR.count ?? 0,
        },
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
