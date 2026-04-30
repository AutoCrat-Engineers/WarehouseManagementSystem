/**
 * shipment_dashboard_list — Edge Function
 *
 * Inbound Receiving dashboard feed. Returns one row per proforma/shipment
 * with aggregate verification + placement status.
 *
 * Status ladder per shipment:
 *   IN_TRANSIT        — PI dispatched, no GR yet
 *   AWAITING_VERIFY   — PI stock_moved/dispatched, no GR (alias of IN_TRANSIT
 *                       — kept separate for forward-compat with ASN)
 *   PARTIAL           — some MPLs have GR, others don't
 *   COMPLETE          — every MPL has a GR
 *   DISCREPANCY       — at least one GR reports missing/damaged pallets
 *
 * INPUT:  { status_filter?: ALL|IN_TRANSIT|PARTIAL|COMPLETE|DISCREPANCY,
 *           search_term?: string,
 *           page?: 0, page_size?: 25 }
 * OUTPUT: { shipments:[...], counts:{...}, total_count }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody } from '../_shared/schemas.ts';

type ShipmentStatus = 'IN_TRANSIT' | 'PARTIAL' | 'COMPLETE' | 'DISCREPANCY';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const page = Math.max(0, Number(body.page ?? 0));
    const pageSize = Math.max(1, Math.min(200, Number(body.page_size ?? 25)));
    const statusFilter = String(body.status_filter ?? 'ALL').toUpperCase();
    const search = String(body.search_term ?? '').trim();
    const safe = search.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const pattern = `%${safe}%`;

    // ── 1. List candidate proformas (dispatched or later) ─────────────
    let piQ = ctx.db.from('pack_proforma_invoices')
        .select('id, proforma_number, shipment_number, customer_name, stock_moved_at, status, created_at', { count: 'exact' })
        .in('status', ['STOCK_MOVED', 'DISPATCHED', 'RECEIVED'])
        .order('stock_moved_at', { ascending: false, nullsFirst: false });

    if (search) {
        piQ = piQ.or(`proforma_number.ilike.${pattern},shipment_number.ilike.${pattern},customer_name.ilike.${pattern}`);
    }

    // We fetch a wider slice (pageSize * 3) for client-side status filter, then paginate after
    const fetchRange = pageSize * 3;
    const { data: pis, error: piErr, count: piCount } = await piQ.range(0, fetchRange - 1);
    if (piErr) return errorResponse('INTERNAL_ERROR', piErr.message, { origin });

    const piRows = (pis ?? []) as any[];
    const piIds = piRows.map(p => p.id);

    // ── 2. MPLs per proforma + pallet counts ──────────────────────────
    const [{ data: pim }, { data: grs }] = await Promise.all([
        piIds.length > 0
            ? ctx.db.from('proforma_invoice_mpls').select('proforma_id, mpl_id').in('proforma_id', piIds)
            : Promise.resolve({ data: [] }),
        piIds.length > 0
            ? ctx.db.from('goods_receipts').select('id, gr_number, proforma_invoice_id, status, total_pallets_expected, total_pallets_received, total_pallets_missing, total_pallets_damaged, placement_completed_at, created_at').in('proforma_invoice_id', piIds)
            : Promise.resolve({ data: [] }),
    ]);

    const mplsByPi = new Map<string, Set<string>>();
    for (const r of (pim ?? []) as any[]) {
        if (!mplsByPi.has(r.proforma_id)) mplsByPi.set(r.proforma_id, new Set());
        mplsByPi.get(r.proforma_id)!.add(r.mpl_id);
    }
    const allMplIds = Array.from(new Set([...mplsByPi.values()].flatMap(s => [...s])));

    // Pallet counts per MPL
    const palletsByMpl = new Map<string, number>();
    const mplMeta = new Map<string, { invoice_number: string | null; po_number: string | null }>();
    if (allMplIds.length > 0) {
        const [{ data: mpp }, { data: mpls }] = await Promise.all([
            ctx.db.from('master_packing_list_pallets').select('mpl_id').in('mpl_id', allMplIds).eq('status', 'ACTIVE'),
            ctx.db.from('master_packing_lists').select('id, mpl_number, invoice_number, po_number').in('id', allMplIds),
        ]);
        for (const r of (mpp ?? []) as any[]) {
            palletsByMpl.set(r.mpl_id, (palletsByMpl.get(r.mpl_id) ?? 0) + 1);
        }
        for (const m of (mpls ?? []) as any[]) {
            mplMeta.set(m.id, { invoice_number: m.invoice_number, po_number: m.po_number });
        }
    }

    // GR aggregates per proforma — since one shipment may eventually have
    // multiple GRs (one per MPL), sum across them.
    const grByPi = new Map<string, {
        count: number; received: number; missing: number; damaged: number;
        latestStatus: string | null; gr_numbers: string[];
    }>();
    for (const g of (grs ?? []) as any[]) {
        const existing = grByPi.get(g.proforma_invoice_id) ?? {
            count: 0, received: 0, missing: 0, damaged: 0, latestStatus: null, gr_numbers: [],
        };
        existing.count += 1;
        existing.received += Number(g.total_pallets_received ?? 0);
        existing.missing  += Number(g.total_pallets_missing  ?? 0);
        existing.damaged  += Number(g.total_pallets_damaged  ?? 0);
        existing.latestStatus = g.status;
        if (g.gr_number) existing.gr_numbers.push(g.gr_number);
        grByPi.set(g.proforma_invoice_id, existing);
    }

    // ── 3. Build rows + classify status ──────────────────────────────
    const today = new Date();
    const shipments = piRows.map(p => {
        const mplIds = Array.from(mplsByPi.get(p.id) ?? new Set<string>());
        const totalPallets = mplIds.reduce((s, mid) => s + (palletsByMpl.get(mid) ?? 0), 0);
        const gr = grByPi.get(p.id);
        const mplCount = mplIds.length;

        // Today we have one GR per PI (pre-Phase-B). Treat gr.count > 0 AND
        // covers all MPLs as COMPLETE; otherwise IN_TRANSIT / PARTIAL.
        let status: ShipmentStatus;
        if (!gr || gr.count === 0) status = 'IN_TRANSIT';
        else if (gr.count < mplCount) status = 'PARTIAL';
        else if ((gr.missing + gr.damaged) > 0) status = 'DISCREPANCY';
        else status = 'COMPLETE';

        // BPA # / buyer proxy from first MPL.po_number
        const firstMpl = mplIds.map(mid => mplMeta.get(mid)).find(Boolean);

        return {
            id:              p.id,
            proforma_number: p.proforma_number,
            shipment_number: p.shipment_number,
            customer_name:   p.customer_name,
            bpa_number:      firstMpl?.po_number ?? null,
            invoice_number:  firstMpl?.invoice_number ?? null,
            dispatched_at:   p.stock_moved_at,
            created_at:      p.created_at,
            pi_status:       p.status,
            status,
            mpl_count:            mplCount,
            pallets_expected:     totalPallets,
            pallets_received:     gr?.received ?? 0,
            pallets_missing:      gr?.missing  ?? 0,
            pallets_damaged:      gr?.damaged  ?? 0,
            gr_count:             gr?.count    ?? 0,
            gr_numbers:           gr?.gr_numbers ?? [],
        };
    });

    // Status filter (client-side after computation)
    const filtered = statusFilter === 'ALL'
        ? shipments
        : shipments.filter(s => s.status === statusFilter);

    // Paginate
    const totalCount = filtered.length;
    const paged = filtered.slice(page * pageSize, (page + 1) * pageSize);

    // Portfolio counts across the fetched slice
    const counts = {
        total:       shipments.length,
        in_transit:  shipments.filter(s => s.status === 'IN_TRANSIT').length,
        partial:     shipments.filter(s => s.status === 'PARTIAL').length,
        complete:    shipments.filter(s => s.status === 'COMPLETE').length,
        discrepancy: shipments.filter(s => s.status === 'DISCREPANCY').length,
    };

    return jsonResponse({
        success:     true,
        shipments:   paged,
        counts,
        total_count: totalCount,
        source_count: piCount ?? shipments.length,
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
