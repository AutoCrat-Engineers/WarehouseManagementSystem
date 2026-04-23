/**
 * release_parse_po_number — Edge Function
 *
 * Parses a customer Release PO like "260067252-10" into its base BO# and
 * release sequence number, then looks up matching agreement + part +
 * pallets currently in rack.
 *
 * Used as the "paste PO number → auto-fill release" entry point.
 *
 * INPUT (JSON):
 *   { customer_po_number: "260067252-10" }
 *
 * OUTPUT:
 *   {
 *     success: true,
 *     po_base:         "260067252",
 *     release_sequence: 10,
 *     agreement:       {...} | null,
 *     parts:           [...],    // parts on the matched agreement
 *     available_pallets_count: 12,
 *     duplicate_release: false   // true if 260067252-10 already exists
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
    const v = validate(body, { customer_po_number: 'string' });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    const poNumber = String(body.customer_po_number).trim();
    let poBase: string;
    let releaseSequence: number | null = null;

    if (poNumber.includes('-')) {
        const parts = poNumber.split('-');
        poBase = parts[0];
        releaseSequence = parts[1] ? Number(parts[1]) : null;
        if (releaseSequence !== null && !Number.isInteger(releaseSequence)) {
            return errorResponse('VALIDATION_FAILED',
                `Release sequence must be integer, got '${parts[1]}'`, { origin });
        }
    } else {
        poBase = poNumber;
    }

    // Look up agreement matching po_base (BPA# == po_base is OPW's convention)
    const { data: agreements } = await ctx.db
        .from('customer_agreements')
        .select('*')
        .eq('agreement_number', poBase)
        .in('status', ['ACTIVE', 'AMENDED'])
        .order('agreement_revision', { ascending: false })
        .limit(1);

    const agreement = agreements?.[0] ?? null;

    // Look up parts on the matched agreement
    const { data: parts } = agreement
        ? await ctx.db.from('customer_agreement_parts')
            .select('*').eq('agreement_id', agreement.id).eq('is_active', true)
            .order('line_number')
        : { data: [] };

    // Count available pallets for those parts (in rack, not released).
    // Source: goods_receipt_lines (rack_location_code NOT NULL) ∩
    //         pack_pallets in ARRIVED_AT_3PL / IN_3PL_WAREHOUSE ∩
    //         not in release_pallet_assignments.
    let availablePallets = 0;
    if (agreement && parts && parts.length > 0) {
        const partNumbers = parts.map(p => p.part_number);

        const { data: grLines } = await ctx.db
            .from('goods_receipt_lines')
            .select('pallet_id, part_number, bpa_number')
            .in('part_number', partNumbers)
            .not('rack_location_code', 'is', null);

        const candSet = new Set<string>();
        for (const r of (grLines ?? []) as any[]) {
            if (r.pallet_id) candSet.add(r.pallet_id);
        }
        const candIds = [...candSet];

        if (candIds.length > 0) {
            const { data: ppRows } = await ctx.db
                .from('pack_pallets')
                .select('id')
                .in('id', candIds)
                .in('state', ['ARRIVED_AT_3PL', 'IN_3PL_WAREHOUSE']);
            const stateOk = new Set((ppRows ?? []).map((p: any) => p.id));

            const { data: assigned } = await ctx.db
                .from('release_pallet_assignments')
                .select('pallet_id')
                .in('pallet_id', candIds);
            const released = new Set((assigned ?? []).map((a: any) => a.pallet_id));

            // Agreement scoping: prefer MPL.po_number match; fall back on
            // goods_receipt_lines.bpa_number; allow if either equals agreement_number.
            const { data: mpp } = await ctx.db
                .from('master_packing_list_pallets')
                .select('pallet_id, master_packing_lists!inner(po_number)')
                .in('pallet_id', candIds)
                .eq('status', 'ACTIVE');
            const palletPo = new Map<string, string>();
            for (const r of (mpp ?? []) as any[]) palletPo.set(r.pallet_id, r.master_packing_lists?.po_number);

            const grBpa = new Map<string, string | null>();
            for (const r of (grLines ?? []) as any[]) {
                if (r.pallet_id && !grBpa.has(r.pallet_id)) grBpa.set(r.pallet_id, r.bpa_number ?? null);
            }

            for (const id of candIds) {
                if (!stateOk.has(id) || released.has(id)) continue;
                const po = palletPo.get(id) ?? grBpa.get(id);
                if (!po || po === agreement.agreement_number) availablePallets++;
            }
        }
    }

    // Duplicate-release check
    let duplicateRelease = false;
    if (releaseSequence !== null) {
        const { count } = await ctx.db
            .from('pack_sub_invoices')
            .select('id', { count: 'exact', head: true })
            .eq('customer_bo_base', poBase)
            .eq('release_sequence', releaseSequence);
        duplicateRelease = (count ?? 0) > 0;
    }

    return jsonResponse({
        success:                 true,
        customer_po_number:      poNumber,
        po_base:                 poBase,
        release_sequence:        releaseSequence,
        agreement,
        parts:                   parts ?? [],
        available_pallets_count: availablePallets,
        duplicate_release:       duplicateRelease,
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
