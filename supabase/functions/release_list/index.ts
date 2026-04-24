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

    // Attach linked part (via line_config) + sub-invoice metadata
    const releases = (listR.data ?? []) as any[];
    const ids = releases.map(r => r.id).filter(Boolean);
    const lineConfigIds = Array.from(new Set(releases.map(r => r.line_config_id).filter(Boolean))) as string[];

    // Parts (from blanket_order_line_configs)
    const lineConfigById = new Map<string, any>();
    if (lineConfigIds.length > 0) {
        const { data: lcs } = await ctx.db
            .from('blanket_order_line_configs')
            .select('id, part_number, msn_code')
            .in('id', lineConfigIds);
        for (const l of (lcs ?? []) as any[]) lineConfigById.set(l.id, l);
    }

    // Sub-invoices + their lines (for per-parent-invoice breakdown on expand)
    const subByRelease = new Map<string, any>();
    const linesBySubInv = new Map<string, any[]>();
    if (ids.length > 0) {
        const { data: subs } = await ctx.db
            .from('pack_sub_invoices')
            .select('id, sub_invoice_number, blanket_release_id, status, total_quantity, total_pallets')
            .in('blanket_release_id', ids);
        for (const s of (subs ?? []) as any[]) {
            if (s.blanket_release_id && !subByRelease.has(s.blanket_release_id)) {
                subByRelease.set(s.blanket_release_id, s);
            }
        }

        const subIds = (subs ?? []).map((s: any) => s.id);
        if (subIds.length > 0) {
            // Sub-invoice lines (no embed — resolve invoice number separately)
            const { data: lines, error: linesErr } = await ctx.db
                .from('pack_sub_invoice_lines')
                .select('id, sub_invoice_id, parent_invoice_line_id, part_number, msn_code, quantity, pallet_count, unit_price')
                .in('sub_invoice_id', subIds);
            if (linesErr) console.error('sub_invoice_lines fetch error:', linesErr);
            const linesRaw = (lines ?? []) as any[];

            // Map parent_invoice_line_id → invoice_number
            const piliIds = Array.from(new Set(linesRaw.map(l => l.parent_invoice_line_id).filter(Boolean)));
            const invNoByPili = new Map<string, string>();
            if (piliIds.length > 0) {
                const { data: pilis } = await ctx.db
                    .from('pack_invoice_line_items')
                    .select('id, invoice_id')
                    .in('id', piliIds);
                const invIds = Array.from(new Set((pilis ?? []).map((p: any) => p.invoice_id).filter(Boolean)));
                const invNoById = new Map<string, string>();
                if (invIds.length > 0) {
                    const { data: invs } = await ctx.db
                        .from('pack_invoices')
                        .select('id, invoice_number')
                        .in('id', invIds);
                    for (const i of (invs ?? []) as any[]) invNoById.set(i.id, i.invoice_number);
                }
                for (const p of (pilis ?? []) as any[]) {
                    invNoByPili.set(p.id, invNoById.get(p.invoice_id) ?? '');
                }
            }

            for (const l of linesRaw) {
                l.parent_invoice_number = invNoByPili.get(l.parent_invoice_line_id) ?? null;
                const bucket = linesBySubInv.get(l.sub_invoice_id) ?? [];
                bucket.push(l);
                linesBySubInv.set(l.sub_invoice_id, bucket);
            }
        }
    }

    // Fallback: pull part_number / msn_code from release_pallet_assignments
    // for any release that still lacks it from line_config or sub-invoice lines
    const partByRelease = new Map<string, { part_number: string; msn_code: string }>();
    if (ids.length > 0) {
        const { data: rpaRows } = await ctx.db
            .from('release_pallet_assignments')
            .select('blanket_release_id, part_number, msn_code')
            .in('blanket_release_id', ids);
        for (const rpa of (rpaRows ?? []) as any[]) {
            if (rpa.blanket_release_id && rpa.part_number && !partByRelease.has(rpa.blanket_release_id)) {
                partByRelease.set(rpa.blanket_release_id, {
                    part_number: rpa.part_number,
                    msn_code:    rpa.msn_code,
                });
            }
        }
    }

    for (const r of releases) {
        const lc    = r.line_config_id ? lineConfigById.get(r.line_config_id) : null;
        const sub   = subByRelease.get(r.id);
        const lines = sub ? (linesBySubInv.get(sub.id) ?? []) : [];
        const first = lines[0];
        const rpa   = partByRelease.get(r.id);

        // Prefer: sub-invoice-line → line_config → release_pallet_assignments.
        r.part_number         = first?.part_number ?? lc?.part_number ?? rpa?.part_number ?? null;
        r.msn_code            = first?.msn_code    ?? lc?.msn_code    ?? rpa?.msn_code    ?? null;
        r.sub_invoice_number  = sub?.sub_invoice_number  ?? null;
        r.sub_invoice_status  = sub?.status              ?? null;
        r.sub_invoice_pallets = sub?.total_pallets       ?? null;
        r.sub_invoice_lines   = lines.map((l: any) => ({
            parent_invoice_number: l.parent_invoice_number,
            part_number:           l.part_number,
            msn_code:              l.msn_code,
            quantity:              l.quantity,
            pallet_count:          l.pallet_count,
            unit_price:            l.unit_price,
        }));
    }

    return jsonResponse({
        success:     true,
        releases,
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
