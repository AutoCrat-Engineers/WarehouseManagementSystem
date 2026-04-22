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

    // Count available pallets for those parts (in rack, not reserved)
    let availablePallets = 0;
    if (agreement && parts && parts.length > 0) {
        const partNumbers = parts.map(p => p.part_number);
        const { count } = await ctx.db
            .from('mv_rack_view')
            .select('rack_location_id', { count: 'exact', head: true })
            .eq('agreement_id', agreement.id)
            .in('part_number', partNumbers)
            .eq('is_available', true);
        availablePallets = count ?? 0;
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
