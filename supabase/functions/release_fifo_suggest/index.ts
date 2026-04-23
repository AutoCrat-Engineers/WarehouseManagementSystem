/**
 * release_fifo_suggest — Edge Function
 *
 * Given a part + required quantity, auto-suggest which pallets to pick
 * using FIFO-by-shipment. Returns a ready-to-submit pallet_ids array plus
 * the parent invoice line that knock-off will hit.
 *
 * DATA SOURCE: goods_receipt_lines + pack_pallets (GR-flow persistence).
 * mv_rack_view is no longer consulted.
 *
 * Parent invoice line: if pack_invoice_line_items doesn't yet exist for the
 * invoice that carried these pallets, we lazily backfill via the
 * ensure_invoice_line_items_for_pallets RPC (mig 037) so create_sub_invoice
 * has something to knock off against.
 *
 * INPUT (JSON):
 *   { part_number, required_quantity, agreement_id? }
 *
 * OUTPUT:
 *   { success, suggestion:{ pallet_ids, pallet_count, total_quantity,
 *                            parent_invoice_line_id, parent_invoice_number,
 *                            pending_on_parent, warnings } }
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
        part_number:       'string',
        required_quantity: 'positive_int',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const required = Number(body.required_quantity);
    const warnings: string[] = [];

    // ── 1. Pull candidate pallets from goods_receipt_lines ─────────────
    const { data: grLines, error: grErr } = await ctx.db
        .from('goods_receipt_lines')
        .select('pallet_id, received_qty, rack_location_code, rack_placed_at, invoice_number, bpa_number')
        .eq('part_number', body.part_number)
        .not('rack_location_code', 'is', null)
        .order('rack_placed_at', { ascending: true, nullsFirst: false });
    if (grErr) return errorResponse('INTERNAL_ERROR', grErr.message, { origin });

    const seen = new Set<string>();
    const candidates: any[] = [];
    for (const r of (grLines ?? []) as any[]) {
        if (!r.pallet_id || seen.has(r.pallet_id)) continue;
        seen.add(r.pallet_id);
        candidates.push(r);
    }
    if (candidates.length === 0) {
        return jsonResponse({
            success: true,
            suggestion: {
                pallet_ids: [], pallet_count: 0, total_quantity: 0,
                parent_invoice_line_id: null, parent_invoice_number: null,
                pending_on_parent: 0,
                warnings: ['No pallets in rack for this part.'],
            },
        }, { origin });
    }

    const candIds = candidates.map(c => c.pallet_id);

    // ── 2. Cross-check pack_pallets state + shipment_sequence ──────────
    const { data: pp, error: ppErr } = await ctx.db
        .from('pack_pallets')
        .select('id, current_qty, shipment_sequence, state')
        .in('id', candIds)
        .in('state', ['ARRIVED_AT_3PL', 'IN_3PL_WAREHOUSE']);
    if (ppErr) return errorResponse('INTERNAL_ERROR', ppErr.message, { origin });
    const ppMap = new Map((pp ?? []).map((p: any) => [p.id, p]));

    // ── 3. Exclude already-released ─────────────────────────────────────
    const { data: assigned } = await ctx.db
        .from('release_pallet_assignments')
        .select('pallet_id')
        .in('pallet_id', candIds);
    const releasedSet = new Set((assigned ?? []).map((a: any) => a.pallet_id));

    // ── 4. Optional agreement scoping via MPL.po_number ────────────────
    let allowPallet = (_id: string) => true;
    if (body.agreement_id) {
        const { data: ag } = await ctx.db
            .from('customer_agreements')
            .select('agreement_number').eq('id', body.agreement_id).maybeSingle();
        const agNo = ag?.agreement_number;
        if (agNo) {
            const { data: mpp } = await ctx.db
                .from('master_packing_list_pallets')
                .select('pallet_id, master_packing_lists!inner(po_number)')
                .in('pallet_id', candIds)
                .eq('status', 'ACTIVE');
            const palletToPo = new Map<string, string>();
            for (const r of (mpp ?? []) as any[]) palletToPo.set(r.pallet_id, r.master_packing_lists?.po_number);
            allowPallet = (id: string) => {
                const p = palletToPo.get(id);
                // allow pallets whose MPL matches, or pallets missing MPL (fall back on bpa_number match in grLines)
                if (p) return p === agNo;
                const grRow = candidates.find(c => c.pallet_id === id);
                return !grRow?.bpa_number || grRow.bpa_number === agNo;
            };
        }
    }

    // ── 5. Filter + FIFO-sort pool ─────────────────────────────────────
    const pool = candidates.filter(r => ppMap.has(r.pallet_id) && !releasedSet.has(r.pallet_id) && allowPallet(r.pallet_id));
    pool.sort((a, b) => {
        const as = ppMap.get(a.pallet_id)?.shipment_sequence ?? Number.POSITIVE_INFINITY;
        const bs = ppMap.get(b.pallet_id)?.shipment_sequence ?? Number.POSITIVE_INFINITY;
        if (as !== bs) return as - bs;
        const at = a.rack_placed_at ? new Date(a.rack_placed_at).getTime() : 0;
        const bt = b.rack_placed_at ? new Date(b.rack_placed_at).getTime() : 0;
        return at - bt;
    });

    // ── 6. Greedy pick until required reached ───────────────────────────
    const palletIds: string[] = [];
    let totalQty = 0;
    let selectedInvoiceNumber: string | null = null;
    for (const r of pool) {
        if (totalQty >= required) break;
        palletIds.push(r.pallet_id);
        totalQty += Number(ppMap.get(r.pallet_id)?.current_qty ?? r.received_qty ?? 0);
        if (!selectedInvoiceNumber && r.invoice_number) selectedInvoiceNumber = r.invoice_number;
    }

    if (totalQty < required) {
        warnings.push(`Only ${totalQty} pcs available on ${palletIds.length} pallet(s), but ${required} requested.`);
    }

    // ── 7. Lazy backfill pack_invoice_line_items for these pallets ─────
    if (palletIds.length > 0) {
        const { error: bfErr } = await ctx.db.rpc('ensure_invoice_line_items_for_pallets', {
            p_pallet_ids: palletIds,
        });
        if (bfErr) {
            warnings.push(`Backfill warning: ${bfErr.message}`);
        }
    }

    // ── 8. Resolve parent invoice line ──────────────────────────────────
    let parentLineId: string | null = null;
    let parentInvoiceNumber: string | null = selectedInvoiceNumber;
    let pendingOnParent = 0;

    if (selectedInvoiceNumber) {
        const { data: inv } = await ctx.db
            .from('pack_invoices')
            .select('id, invoice_number')
            .eq('invoice_number', selectedInvoiceNumber)
            .maybeSingle();
        if (inv) {
            const { data: line } = await ctx.db
                .from('pack_invoice_line_items')
                .select('id, pending_quantity')
                .eq('invoice_id', inv.id)
                .eq('part_number', body.part_number)
                .maybeSingle();
            if (line) {
                parentLineId = line.id;
                pendingOnParent = Number(line.pending_quantity ?? 0);
            }
        }
    }

    // Fallback: any invoice line for this part with pending qty
    if (!parentLineId) {
        const { data: line } = await ctx.db
            .from('pack_invoice_line_items')
            .select('id, pending_quantity, invoice_id, pack_invoices!inner(invoice_number)')
            .eq('part_number', body.part_number)
            .gt('pending_quantity', 0)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
        if (line) {
            parentLineId = line.id;
            pendingOnParent = Number(line.pending_quantity ?? 0);
            // @ts-ignore nested
            parentInvoiceNumber = line.pack_invoices?.invoice_number ?? parentInvoiceNumber;
        }
    }

    if (parentLineId && pendingOnParent < required) {
        warnings.push(`Parent invoice line has only ${pendingOnParent} pending; may need to split across invoices.`);
    }
    if (!parentLineId) {
        warnings.push('No parent invoice line with pending quantity found for this part.');
    }

    return jsonResponse({
        success: true,
        suggestion: {
            pallet_ids:             palletIds,
            pallet_count:           palletIds.length,
            total_quantity:         totalQty,
            parent_invoice_line_id: parentLineId,
            parent_invoice_number:  parentInvoiceNumber,
            pending_on_parent:      pendingOnParent,
            warnings,
        },
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
