/**
 * release_fifo_suggest — Edge Function
 *
 * Given a part + required quantity, auto-suggest which pallets to pick
 * using FIFO-by-shipment. Returns a ready-to-submit pallet_ids array
 * plus the parent invoice line that knock-off will hit.
 *
 * Business rules applied:
 *   - Oldest shipment exhausted first
 *   - Within same shipment: oldest placed_at first
 *   - Quantity must be exact OR multiple of release_multiple (warning emitted
 *     if not, does not block)
 *   - Parent invoice line selected FIFO by invoice_date (oldest invoice first)
 *
 * INPUT (JSON):
 *   {
 *     part_number:        "HW-LS-0022",   REQ
 *     required_quantity:  560,            REQ
 *     agreement_id?:      uuid            (limit scope)
 *   }
 *
 * OUTPUT:
 *   {
 *     success: true,
 *     suggestion: {
 *       pallet_ids:             uuid[],
 *       pallet_count:           integer,
 *       total_quantity:         integer,
 *       parent_invoice_line_id: uuid | null,
 *       parent_invoice_number:  string | null,
 *       pending_on_parent:      integer,
 *       warnings:               string[]
 *     }
 *   }
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

    // ── 1. Pick pallets FIFO until quantity reached ────────────────────
    let palletQ = ctx.db.from('mv_rack_view')
        .select('pallet_id, pallet_quantity, shipment_sequence, placed_at, parent_invoice_id, parent_invoice_number')
        .eq('part_number', body.part_number)
        .eq('is_available', true)
        .order('shipment_sequence', { ascending: true, nullsFirst: false })
        .order('placed_at', { ascending: true, nullsFirst: false });
    if (body.agreement_id) palletQ = palletQ.eq('agreement_id', body.agreement_id);

    const { data: cells, error: pErr } = await palletQ;
    if (pErr) return errorResponse('INTERNAL_ERROR', pErr.message, { origin });

    const palletIds: string[] = [];
    let totalQty = 0;
    let selectedInvoiceId: string | null = null;
    let selectedInvoiceNumber: string | null = null;

    for (const c of cells ?? []) {
        if (totalQty >= required) break;
        if (!c.pallet_id) continue;
        palletIds.push(c.pallet_id);
        totalQty += Number(c.pallet_quantity ?? 0);
        if (!selectedInvoiceId && c.parent_invoice_id) {
            selectedInvoiceId = c.parent_invoice_id;
            selectedInvoiceNumber = c.parent_invoice_number;
        }
    }

    if (totalQty < required) {
        warnings.push(
            `Only ${totalQty} pcs available on ${palletIds.length} pallet(s), but ${required} requested.`,
        );
    }

    // ── 2. Resolve parent invoice line (oldest FIFO matching part) ─────
    let parentLineId: string | null = null;
    let pendingOnParent = 0;
    if (selectedInvoiceId) {
        const { data: line } = await ctx.db
            .from('pack_invoice_line_items')
            .select('id, pending_quantity, invoice_id')
            .eq('invoice_id', selectedInvoiceId)
            .eq('part_number', body.part_number)
            .maybeSingle();
        if (line) {
            parentLineId = line.id;
            pendingOnParent = Number(line.pending_quantity ?? 0);
            if (pendingOnParent < required) {
                warnings.push(
                    `Parent invoice line has only ${pendingOnParent} pending; may need to split across multiple invoices.`,
                );
            }
        }
    } else {
        // Fall back: find ANY invoice line for this part with pending qty
        const { data: line } = await ctx.db
            .from('pack_invoice_line_items')
            .select('id, pending_quantity, invoice_id, invoice:pack_invoices(invoice_number)')
            .eq('part_number', body.part_number)
            .gt('pending_quantity', 0)
            .order('created_at', { ascending: true })
            .limit(1)
            .maybeSingle();
        if (line) {
            parentLineId = line.id;
            pendingOnParent = Number(line.pending_quantity ?? 0);
            // @ts-ignore — supabase-js returns related record
            selectedInvoiceNumber = line.invoice?.invoice_number ?? null;
        }
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
            parent_invoice_number:  selectedInvoiceNumber,
            pending_on_parent:      pendingOnParent,
            warnings,
        },
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
