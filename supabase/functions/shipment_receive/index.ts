/**
 * shipment_receive — Edge Function
 *
 * Milano's "Receive Shipment" flow. Given a proforma invoice or invoice
 * number, lists the EXPECTED pallets (from packing list + pallets table)
 * and allows Milano to tick off what was received / mark discrepancies.
 *
 * This function supports TWO modes:
 *   1. GET expected pallets for a proforma/invoice (no state changes)
 *   2. CONFIRM receipt of N pallets (sets state = 'ARRIVED_AT_3PL' and
 *      stamps received_at / received_by on pack_pallets)
 *
 * Pallets remain unplaced (not in any rack cell) after confirmation.
 * Placement is a separate action via pallet_place.
 *
 * INPUT:
 *   mode = "LIST":
 *     { mode: "LIST", proforma_invoice_number?: string, invoice_number?: string }
 *   mode = "CONFIRM":
 *     { mode: "CONFIRM", pallet_ids: uuid[], received_at?: iso_date,
 *       discrepancy_notes?: { pallet_id: "not received" } }
 *
 * OUTPUT:
 *   LIST: { success, expected_pallets: [...] }
 *   CONFIRM: { success, received_count, discrepancies, audit_id }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const mode = (body.mode ?? 'LIST') as 'LIST' | 'CONFIRM';

    if (mode === 'LIST') return handleList(ctx, body, origin);
    if (mode === 'CONFIRM') return handleConfirm(ctx, body, origin);
    return errorResponse('VALIDATION_FAILED', "mode must be 'LIST' or 'CONFIRM'", { origin });
});

// ──────────────────────────────────────────────────────────────────────────
// LIST: find expected pallets for a proforma / invoice
// ──────────────────────────────────────────────────────────────────────────
async function handleList(ctx: Awaited<ReturnType<typeof authenticateRequest>> & {}, body: Record<string, unknown>, origin: string | undefined) {
    if (!ctx) return unauthorized(origin);
    const proformaNo = (body.proforma_invoice_number ?? '') as string;
    const invoiceNo  = (body.invoice_number ?? '') as string;
    if (!proformaNo && !invoiceNo) {
        return errorResponse('VALIDATION_FAILED',
            'Provide proforma_invoice_number or invoice_number', { origin });
    }

    // Look up packing list(s) associated with the proforma/invoice
    // NOTE: master_packing_lists has `invoice_number` directly but NOT
    // `proforma_invoice_number` — instead it has a FK `proforma_invoice_id`
    // pointing to pack_proforma_invoices. So we resolve by PI# → id first.
    let plQ = ctx.db.from('master_packing_lists').select('*').limit(50);
    if (proformaNo) {
        const { data: piRow, error: piErr } = await ctx.db
            .from('pack_proforma_invoices')
            .select('id')
            .eq('proforma_number', proformaNo)
            .maybeSingle();
        if (piErr) return errorResponse('INTERNAL_ERROR', piErr.message, { origin });
        if (!piRow) {
            return errorResponse('NOT_FOUND',
                `No proforma invoice matches ${proformaNo}`, { origin });
        }
        plQ = plQ.eq('proforma_invoice_id', (piRow as any).id);
    } else {
        plQ = plQ.eq('invoice_number', invoiceNo);
    }

    const { data: pls, error: plErr } = await plQ;
    if (plErr) return errorResponse('INTERNAL_ERROR', plErr.message, { origin });
    if (!pls || pls.length === 0) {
        return errorResponse('NOT_FOUND',
            `No packing list found for ${proformaNo || invoiceNo}`, { origin });
    }
    const mplIds = pls.map(p => p.id);

    // Pallets are linked to MPLs via the master_packing_list_pallets junction,
    // NOT directly by packing_list_id on pack_pallets. Resolve pallet_ids
    // through the junction, then fetch the pallet rows.
    const { data: junction, error: jErr } = await ctx.db
        .from('master_packing_list_pallets')
        .select('pallet_id')
        .in('mpl_id', mplIds)
        .eq('status', 'ACTIVE');
    if (jErr) return errorResponse('INTERNAL_ERROR', jErr.message, { origin });

    const palletIds = (junction ?? []).map((j: any) => j.pallet_id).filter(Boolean);
    if (palletIds.length === 0) {
        return jsonResponse({
            success: true,
            packing_lists:   pls,
            expected_pallets: [],
            total_expected:  0,
        }, { origin });
    }

    const { data: pallets, error: pErr } = await ctx.db
        .from('pack_pallets')
        .select('*')
        .in('id', palletIds)
        .order('pallet_number', { ascending: true });
    if (pErr) return errorResponse('INTERNAL_ERROR', pErr.message, { origin });

    return jsonResponse({
        success: true,
        packing_lists:   pls,
        expected_pallets: pallets ?? [],
        total_expected:  pallets?.length ?? 0,
    }, { origin });
}

// ──────────────────────────────────────────────────────────────────────────
// CONFIRM: mark pallets as received at Milano
// ──────────────────────────────────────────────────────────────────────────
async function handleConfirm(ctx: Awaited<ReturnType<typeof authenticateRequest>> & {}, body: Record<string, unknown>, origin: string | undefined) {
    if (!ctx) return unauthorized(origin);
    const palletIds = body.pallet_ids;
    if (!Array.isArray(palletIds) || palletIds.length === 0) {
        return errorResponse('VALIDATION_FAILED', 'pallet_ids must be non-empty array', { origin });
    }
    const receivedAt = (body.received_at as string) ?? new Date().toISOString();
    const discrepancyNotes = (body.discrepancy_notes ?? {}) as Record<string, string>;

    const { data: updated, error } = await ctx.db
        .from('pack_pallets')
        .update({
            state:      'ARRIVED_AT_3PL',
            updated_at: new Date().toISOString(),
        })
        .in('id', palletIds as string[])
        .select('id, pallet_number, state');
    if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });

    // Audit one row per pallet (metadata includes discrepancy note if any)
    const auditRows = (updated ?? []).map(p => ({
        entity_type:   'PALLET',
        entity_id:     p.id,
        entity_number: p.pallet_number,
        action:        'STATE_CHANGE',
        new_values:    { state: 'ARRIVED_AT_3PL' },
        metadata:      {
            received_at:  receivedAt,
            received_by:  ctx.userId,
            discrepancy:  discrepancyNotes[p.id] ?? null,
        },
        performed_by:  ctx.userId,
    }));
    if (auditRows.length > 0) {
        await ctx.db.from('release_audit_log').insert(auditRows);
    }

    return jsonResponse({
        success:        true,
        received_count: updated?.length ?? 0,
        pallets:        updated ?? [],
        discrepancies:  Object.keys(discrepancyNotes).length,
    }, { origin });
}

if (import.meta.main) Deno.serve(handler);
