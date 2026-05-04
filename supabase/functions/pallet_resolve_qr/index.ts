/**
 * pallet_resolve_qr — Edge Function
 *
 * Resolves a raw QR scan (text payload from a pallet sticker) into a single
 * pallet record + its receive-time context. This is the foundation for the
 * scan-driven Receive flow: the client never has to parse QR text itself.
 *
 * Supports two payload formats:
 *
 *   v2 (line-delimited, current — see MasterPackingListHome QR generator):
 *       PALLET:<uuid>
 *       MPL:<mpl_number>
 *       PN:<pallet_number>
 *       PART:<part_number>
 *       ITEM:<item_name>
 *       MSN:<master_serial_no>
 *       QTY:<qty_per_pallet>
 *       V:2
 *
 *   v1 (legacy pipe-delimited, stickers printed before v2 rollout):
 *       <mpl_number>|<part_number>|<item_name>|<msn>|<qty>
 *       Resolved by best-effort field match. May return AMBIGUOUS if more
 *       than one pallet in the MPL has the same (part, msn, qty).
 *
 * Optional input `proforma_invoice_id` scopes the resolution to the active
 * receive session — a scan that doesn't belong to that shipment is rejected
 * with WRONG_SHIPMENT instead of being silently resolved.
 *
 * INPUT:  { qr_text: string, proforma_invoice_id?: uuid }
 * OUTPUT: 200 { pallet: { pallet_id, pallet_number, mpl_id, mpl_number,
 *                         part_number, item_name, msn_code, expected_qty,
 *                         shipment_id, payload_version } }
 *         404 NOT_FOUND       — payload parsed but no matching pallet
 *         409 CONFLICT        — legacy payload matched > 1 pallet (AMBIGUOUS)
 *         400 VALIDATION      — payload unparseable
 *         422 WRONG_SHIPMENT  — pallet belongs to a different shipment
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ParsedV2 {
    version: 2;
    pallet_id: string | null;
    mpl_number: string | null;
    pallet_number: string | null;
    part_number: string | null;
    item_name: string | null;
    msn: string | null;
    qty: number | null;
}
interface ParsedV1 {
    version: 1;
    mpl_number: string;
    part_number: string;
    item_name: string;
    msn: string;
    qty: number;
}

function parseQr(raw: string): ParsedV2 | ParsedV1 | null {
    const txt = raw.trim();
    if (!txt) return null;

    // v2: token-prefixed lines. Be lenient about line endings and whitespace.
    if (/(^|\n)\s*PALLET\s*:/i.test(txt) || /(^|\n)\s*V\s*:\s*2\b/i.test(txt)) {
        const get = (key: string): string | null => {
            const m = new RegExp(`(?:^|\\n)\\s*${key}\\s*:\\s*(.*?)\\s*(?=\\n|$)`, 'i').exec(txt);
            return m ? m[1].trim() : null;
        };
        const palletIdRaw = get('PALLET');
        const palletId = palletIdRaw && UUID_RE.test(palletIdRaw) ? palletIdRaw.toLowerCase() : null;
        const qtyRaw = get('QTY');
        const qty = qtyRaw ? Number(qtyRaw.replace(/[^0-9.]/g, '')) : null;
        return {
            version:       2,
            pallet_id:     palletId,
            mpl_number:    get('MPL'),
            pallet_number: get('PN'),
            part_number:   get('PART'),
            item_name:     get('ITEM'),
            msn:           get('MSN'),
            qty:           Number.isFinite(qty as number) ? (qty as number) : null,
        };
    }

    // v1: pipe-delimited, exactly 5 fields.
    const parts = txt.split('|').map(s => s.trim());
    if (parts.length === 5) {
        const qty = Number(parts[4].replace(/[^0-9.]/g, ''));
        if (parts[0] && Number.isFinite(qty)) {
            return {
                version:     1,
                mpl_number:  parts[0],
                part_number: parts[1],
                item_name:   parts[2],
                msn:         parts[3],
                qty,
            };
        }
    }

    return null;
}

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const v = validate(body, {
        qr_text:             'string',
        proforma_invoice_id: 'uuid_optional',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const parsed = parseQr(String(body.qr_text));
    if (!parsed) {
        return errorResponse('VALIDATION_FAILED', 'QR payload is not in a recognized format.', { origin });
    }

    // ------------------------------------------------------------------
    // 1. Find the pallet
    // ------------------------------------------------------------------
    let palletId: string | null = null;
    let ambiguous = false;

    if (parsed.version === 2 && parsed.pallet_id) {
        palletId = parsed.pallet_id;
    } else {
        // Legacy / fallback: best-effort match by (mpl_number, part, msn, qty).
        const mplNumber = parsed.version === 2 ? parsed.mpl_number : parsed.mpl_number;
        if (!mplNumber) {
            return errorResponse('VALIDATION_FAILED', 'QR is missing MPL number.', { origin });
        }

        // Resolve MPL by mpl_number.
        const { data: mplRow, error: mplErr } = await ctx.db
            .from('master_packing_lists')
            .select('id')
            .eq('mpl_number', mplNumber)
            .maybeSingle();
        if (mplErr) return errorResponse('INTERNAL_ERROR', mplErr.message, { origin });
        if (!mplRow) return errorResponse('NOT_FOUND', `MPL ${mplNumber} not found.`, { origin });

        // Pull active pallets in that MPL, then narrow by part + qty.
        const { data: linkRows, error: linkErr } = await ctx.db
            .from('master_packing_list_pallets')
            .select('pallet_id')
            .eq('mpl_id', mplRow.id)
            .eq('status', 'ACTIVE');
        if (linkErr) return errorResponse('INTERNAL_ERROR', linkErr.message, { origin });

        const palletIds = (linkRows ?? []).map((r: any) => r.pallet_id).filter(Boolean);
        if (palletIds.length === 0) {
            return errorResponse('NOT_FOUND', 'No active pallets found for that MPL.', { origin });
        }

        const { data: candPallets, error: pErr } = await ctx.db
            .from('pack_pallets')
            .select('id, pallet_number, item_id, current_qty')
            .in('id', palletIds);
        if (pErr) return errorResponse('INTERNAL_ERROR', pErr.message, { origin });

        // Match by qty first (cheap), then narrow by part_number via items.
        const qty = parsed.qty;
        let pool = (candPallets ?? []) as any[];
        if (qty != null) pool = pool.filter(p => Number(p.current_qty) === Number(qty));

        if (parsed.part_number || parsed.msn) {
            const itemIds = Array.from(new Set(pool.map(p => p.item_id).filter(Boolean)));
            if (itemIds.length > 0) {
                const { data: items } = await ctx.db
                    .from('items')
                    .select('id, part_number, master_serial_no')
                    .in('id', itemIds);
                const okItem = new Set((items ?? [])
                    .filter((i: any) =>
                        (!parsed.part_number || i.part_number === parsed.part_number) &&
                        (!parsed.msn        || i.master_serial_no === parsed.msn))
                    .map((i: any) => i.id));
                pool = pool.filter(p => okItem.has(p.item_id));
            }
        }

        // Tiebreak by pallet_number if v2 had it but no UUID
        if (parsed.version === 2 && parsed.pallet_number) {
            const exact = pool.filter(p => p.pallet_number === parsed.pallet_number);
            if (exact.length === 1) pool = exact;
        }

        if (pool.length === 0) {
            return errorResponse('NOT_FOUND', 'No pallet matches that QR in the named MPL.', { origin });
        }
        if (pool.length > 1) {
            ambiguous = true;
            return errorResponse('CONFLICT',
                `QR matches ${pool.length} pallets in MPL ${mplNumber}. Reprint with v2 sticker.`,
                { origin, details: { ambiguous, candidate_count: pool.length } });
        }
        palletId = pool[0].id;
    }

    if (!palletId) {
        return errorResponse('VALIDATION_FAILED', 'Could not determine pallet from QR.', { origin });
    }

    // ------------------------------------------------------------------
    // 2. Hydrate the pallet → MPL → shipment chain
    // ------------------------------------------------------------------
    const { data: pallet, error: palErr } = await ctx.db
        .from('pack_pallets')
        .select('id, pallet_number, item_id, current_qty, container_count, state, shipment_sequence')
        .eq('id', palletId)
        .maybeSingle();
    if (palErr) return errorResponse('INTERNAL_ERROR', palErr.message, { origin });
    if (!pallet) return errorResponse('NOT_FOUND', 'Pallet record not found.', { origin });

    const { data: mppRow } = await ctx.db
        .from('master_packing_list_pallets')
        .select('mpl_id')
        .eq('pallet_id', palletId)
        .eq('status', 'ACTIVE')
        .maybeSingle();

    let mplId: string | null = mppRow?.mpl_id ?? null;
    let mplNumber: string | null = null;
    let shipmentId: string | null = null;
    let shipmentNumber: string | null = null;

    if (mplId) {
        const { data: mpl } = await ctx.db
            .from('master_packing_lists')
            .select('id, mpl_number')
            .eq('id', mplId)
            .maybeSingle();
        mplNumber = mpl?.mpl_number ?? null;

        const { data: pim } = await ctx.db
            .from('proforma_invoice_mpls')
            .select('proforma_id')
            .eq('mpl_id', mplId)
            .maybeSingle();
        if (pim?.proforma_id) {
            const { data: pi } = await ctx.db
                .from('pack_proforma_invoices')
                .select('id, proforma_number, shipment_number')
                .eq('id', pim.proforma_id)
                .maybeSingle();
            shipmentId     = pi?.id ?? null;
            shipmentNumber = pi?.shipment_number ?? pi?.proforma_number ?? null;
        }
    }

    // Scope check: caller asserted a specific shipment.
    if (body.proforma_invoice_id && shipmentId && body.proforma_invoice_id !== shipmentId) {
        return errorResponse(
            'INVALID_STATE_TRANSITION',
            'Pallet belongs to a different shipment.',
            { origin, details: { scanned_shipment_id: shipmentId, scanned_shipment_number: shipmentNumber } },
        );
    }

    let item: { part_number: string | null; item_name: string | null; msn_code: string | null } = {
        part_number: null, item_name: null, msn_code: null,
    };
    if (pallet.item_id) {
        const { data: it } = await ctx.db
            .from('items')
            .select('part_number, item_name, master_serial_no')
            .eq('id', pallet.item_id)
            .maybeSingle();
        if (it) {
            item = {
                part_number: it.part_number ?? null,
                item_name:   it.item_name ?? null,
                msn_code:    it.master_serial_no ?? null,
            };
        }
    }

    return jsonResponse({
        pallet: {
            pallet_id:        pallet.id,
            pallet_number:    pallet.pallet_number,
            mpl_id:           mplId,
            mpl_number:       mplNumber,
            shipment_id:      shipmentId,
            shipment_number:  shipmentNumber,
            part_number:      item.part_number,
            item_name:        item.item_name,
            msn_code:         item.msn_code,
            expected_qty:     Number(pallet.current_qty ?? 0),
            container_count:  Number(pallet.container_count ?? 0),
            state:            pallet.state,
            payload_version:  parsed.version,
        },
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
