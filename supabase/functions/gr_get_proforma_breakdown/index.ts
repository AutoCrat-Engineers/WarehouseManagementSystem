/**
 * gr_get_proforma_breakdown — Edge Function
 *
 * Step 2 data — for a selected proforma, return the PI header + MPLs + a
 * hierarchical list of expected pallets grouped by item, with invoice # +
 * BPA # for each line.
 *
 * INPUT:  { proforma_invoice_id: uuid }
 * OUTPUT:
 *   {
 *     proforma: {...},
 *     mpls: [{ id, mpl_number, invoice_number, po_number, ... }],
 *     items: [
 *       {
 *         item_code, part_number, msn_code, item_name,
 *         invoice_number, bpa_number,
 *         total_expected_qty, pallet_count,
 *         pallets: [{ pallet_id, pallet_number, current_qty, state }]
 *       }
 *     ]
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
    const v = validate(body, { proforma_invoice_id: 'uuid' });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    // Proforma header
    const { data: proforma, error: piErr } = await ctx.db
        .from('pack_proforma_invoices').select('*').eq('id', body.proforma_invoice_id).single();
    if (piErr || !proforma) return errorResponse('NOT_FOUND', 'Proforma not found', { origin });

    // MPLs linked to this PI
    const { data: pim } = await ctx.db
        .from('proforma_invoice_mpls').select('mpl_id').eq('proforma_id', body.proforma_invoice_id);
    const mplIds = (pim ?? []).map((r: any) => r.mpl_id);
    if (mplIds.length === 0) {
        return jsonResponse({ proforma, mpls: [], items: [] }, { origin });
    }

    const { data: mpls } = await ctx.db
        .from('master_packing_lists')
        .select('id, mpl_number, invoice_number, po_number, item_code, item_name, status')
        .in('id', mplIds);

    // Pallets on those MPLs
    const { data: mpp } = await ctx.db
        .from('master_packing_list_pallets')
        .select('mpl_id, pallet_id, quantity, item_code, item_name')
        .in('mpl_id', mplIds)
        .eq('status', 'ACTIVE');

    const palletIds = [...new Set((mpp ?? []).map((r: any) => r.pallet_id).filter(Boolean))];
    const { data: pallets } = palletIds.length > 0
        ? await ctx.db.from('pack_pallets').select('id, pallet_number, current_qty, state, item_code, item_id').in('id', palletIds)
        : { data: [] as any[] };

    // Items lookup (MSN, item_name)
    const itemCodes = [...new Set((mpp ?? []).map((r: any) => r.item_code).filter(Boolean))];
    const { data: items } = itemCodes.length > 0
        ? await ctx.db.from('items')
            .select('item_code:part_number, part_number, item_name, master_serial_no')
            .in('part_number', itemCodes)
            .is('deleted_at', null)
        : { data: [] as any[] };
    const itemMap = new Map<string, any>((items ?? []).map((i: any) => [i.item_code, i]));

    // Group by item_code
    const palletMap = new Map<string, any>((pallets ?? []).map((p: any) => [p.id, p]));
    const mplByMplId = new Map<string, any>((mpls ?? []).map((m: any) => [m.id, m]));

    type ItemGroup = {
        item_code: string;
        part_number: string;
        msn_code: string | null;
        item_name: string;
        invoice_number: string | null;
        bpa_number: string | null;
        total_expected_qty: number;
        pallet_count: number;
        pallets: Array<{
            pallet_id: string; pallet_number: string | null; current_qty: number;
            state: string | null; expected_qty: number; mpl_id: string;
        }>;
    };
    const groups = new Map<string, ItemGroup>();

    for (const r of (mpp ?? []) as any[]) {
        const code = r.item_code ?? 'UNKNOWN';
        const info = itemMap.get(code) ?? {};
        const mpl  = mplByMplId.get(r.mpl_id) ?? {};
        const pkey = `${code}|${mpl.invoice_number ?? ''}|${mpl.po_number ?? ''}`;

        if (!groups.has(pkey)) {
            groups.set(pkey, {
                item_code:          code,
                part_number:        info.part_number ?? code,
                msn_code:           info.master_serial_no ?? null,
                item_name:          info.item_name ?? r.item_name ?? code,
                invoice_number:     mpl.invoice_number ?? null,
                bpa_number:         mpl.po_number ?? null,
                total_expected_qty: 0,
                pallet_count:       0,
                pallets:            [],
            });
        }
        const g = groups.get(pkey)!;
        const p = palletMap.get(r.pallet_id) ?? {};
        g.total_expected_qty += Number(r.quantity ?? 0);
        g.pallet_count += 1;
        g.pallets.push({
            pallet_id:    r.pallet_id,
            pallet_number: p.pallet_number ?? null,
            current_qty:  Number(p.current_qty ?? r.quantity ?? 0),
            state:        p.state ?? null,
            expected_qty: Number(r.quantity ?? 0),
            mpl_id:       r.mpl_id,
        });
    }

    return jsonResponse({
        proforma,
        mpls: mpls ?? [],
        items: Array.from(groups.values()),
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
