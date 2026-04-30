/**
 * tariff_invoice_list — Edge Function
 *
 * Paginated list of tariff invoices for the Finance queue UI.
 *
 * INPUT (JSON):
 *   {
 *     page?: 0, page_size?: 25,
 *     status_filter?: 'ALL'|'DRAFT'|'SUBMITTED'|'CLAIMED'|'PAID'|'CANCELLED',
 *     search_term?: "T-",
 *     date_from?: iso_date, date_to?: iso_date
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

    let q = ctx.db.from('tariff_invoices')
        .select('*', { count: 'exact' })
        .order('tariff_invoice_date', { ascending: false });

    if (statusFilter !== 'ALL') q = q.eq('status', statusFilter);
    if (body.date_from)         q = q.gte('tariff_invoice_date', body.date_from);
    if (body.date_to)           q = q.lte('tariff_invoice_date', body.date_to);
    if (safeSearch) {
        q = q.or(
            `tariff_invoice_number.ilike."%${safeSearch}%",sub_invoice_number.ilike."%${safeSearch}%",msn_code.ilike."%${safeSearch}%",part_number.ilike."%${safeSearch}%"`,
        );
    }

    const countQ = (status?: string) => {
        let base = ctx.db.from('tariff_invoices').select('id', { count: 'exact', head: true });
        if (status) base = base.eq('status', status);
        return base;
    };

    const [listR, totalR, draftR, submittedR, claimedR, paidR] = await Promise.all([
        q.range(offset, offset + pageSize - 1),
        countQ(),
        countQ('DRAFT'),
        countQ('SUBMITTED'),
        countQ('CLAIMED'),
        countQ('PAID'),
    ]);

    if (listR.error) return errorResponse('INTERNAL_ERROR', listR.error.message, { origin });

    // Aggregate total tariff value in scope
    const totalValue = (listR.data ?? []).reduce(
        (s, r) => s + Number(r.total_tariff ?? r.tariff_invoice_value ?? 0), 0);

    return jsonResponse({
        success:     true,
        tariffs:     listR.data ?? [],
        total_count: listR.count ?? 0,
        counts: {
            total:     totalR.count ?? 0,
            draft:     draftR.count ?? 0,
            submitted: submittedR.count ?? 0,
            claimed:   claimedR.count ?? 0,
            paid:      paidR.count ?? 0,
        },
        page_total_value: totalValue,
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
