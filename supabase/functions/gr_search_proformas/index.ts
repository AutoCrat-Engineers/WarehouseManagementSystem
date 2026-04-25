/**
 * gr_search_proformas — Edge Function
 *
 * Autocomplete search for proforma invoices eligible for goods receipt.
 * Returns matching PIs with MPL count, pallet count, and whether a GR
 * already exists.
 *
 * INPUT:  { query: string, limit?: number }
 * OUTPUT: { matches: [{ id, proforma_number, shipment_number, customer_name,
 *                       buyer_name, dispatched_at, total_mpls, total_pallets,
 *                       has_existing_gr, gr_number? }] }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const v = validate(body, { query: 'string' });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const q = String(body.query).trim();
    const limit = Math.min(20, Math.max(1, Number(body.limit ?? 10)));
    const safe = q.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const pattern = `%${safe}%`;

    // Only dispatched PIs can be received.
    // Note: pack_proforma_invoices has customer_name but NO buyer_name column —
    // buyer comes from the linked MPL.po_number / BPA. We fetch buyer below.
    const { data: pis, error } = await ctx.db
        .from('pack_proforma_invoices')
        .select('id, proforma_number, shipment_number, customer_name, stock_moved_at, status, created_at')
        .in('status', ['STOCK_MOVED', 'DISPATCHED'])
        .or(`proforma_number.ilike.${pattern},shipment_number.ilike.${pattern},customer_name.ilike.${pattern}`)
        .order('stock_moved_at', { ascending: false, nullsFirst: false })
        .limit(limit);

    if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });

    const piIds = (pis ?? []).map(p => p.id);

    // MPL + pallet counts
    const [{ data: pim }, { data: existing }] = await Promise.all([
        piIds.length > 0
            ? ctx.db.from('proforma_invoice_mpls').select('proforma_id, mpl_id').in('proforma_id', piIds)
            : Promise.resolve({ data: [] }),
        piIds.length > 0
            ? ctx.db.from('goods_receipts').select('id, gr_number, proforma_invoice_id, status').in('proforma_invoice_id', piIds)
            : Promise.resolve({ data: [] }),
    ]);

    const mplsByPi = new Map<string, Set<string>>();
    for (const r of (pim ?? []) as any[]) {
        if (!mplsByPi.has(r.proforma_id)) mplsByPi.set(r.proforma_id, new Set());
        mplsByPi.get(r.proforma_id)!.add(r.mpl_id);
    }
    const allMplIds = Array.from(new Set([...mplsByPi.values()].flatMap(s => [...s])));

    const palletsByMpl = new Map<string, number>();
    if (allMplIds.length > 0) {
        const { data: mppCount } = await ctx.db
            .from('master_packing_list_pallets')
            .select('mpl_id, pallet_id')
            .in('mpl_id', allMplIds)
            .eq('status', 'ACTIVE');
        for (const r of (mppCount ?? []) as any[]) {
            palletsByMpl.set(r.mpl_id, (palletsByMpl.get(r.mpl_id) ?? 0) + 1);
        }
    }

    const grByPi = new Map<string, any>();
    for (const g of (existing ?? []) as any[]) {
        if (!grByPi.has(g.proforma_invoice_id)) grByPi.set(g.proforma_invoice_id, g);
    }

    const matches = (pis ?? []).map((p: any) => {
        const mplSet = mplsByPi.get(p.id) ?? new Set<string>();
        const palletCount = [...mplSet].reduce((s, mid) => s + (palletsByMpl.get(mid) ?? 0), 0);
        const gr = grByPi.get(p.id);
        return {
            id:              p.id,
            proforma_number: p.proforma_number,
            shipment_number: p.shipment_number,
            customer_name:   p.customer_name,
            buyer_name:      null,           // populated from MPL.po_number lookup at detail-load time
            dispatched_at:   p.stock_moved_at,
            status:          p.status,
            total_mpls:      mplSet.size,
            total_pallets:   palletCount,
            has_existing_gr: !!gr,
            gr_number:       gr?.gr_number ?? null,
            gr_status:       gr?.status    ?? null,
        };
    });

    return jsonResponse({ matches }, { origin });
});

if (import.meta.main) Deno.serve(handler);
