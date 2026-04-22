/**
 * tariff_rates_upsert — Edge Function (Admin)
 *
 * Manage the `tariff_rates` reference table. Supports:
 *   - LIST    : fetch currently active rates
 *   - UPSERT  : insert new rate OR extend existing (closes current via effective_to = new.effective_from - 1 day, inserts new row)
 *   - RETIRE  : set effective_to = today on an active rate
 *
 * INPUT:
 *   { action: 'LIST' }                                               → everyone can read
 *   { action: 'UPSERT', rate: {...} }                                → ADMIN only
 *   { action: 'RETIRE', rate_id: uuid, effective_to?: iso_date }     → ADMIN only
 *
 * For UPSERT, if a currently-active rate with same (tariff_type, hs_code_prefix,
 * origin_country, destination_country) exists, it's automatically retired.
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, forbidden, withErrorHandler } from '../_shared/errors.ts';
import { parseBody } from '../_shared/schemas.ts';

const ALLOWED_TYPES = ['RECIP_PCT','SECTION_232','RU_IN_EO','RECIP_IN','ANTI_DUMPING','OTHER'];

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const body = await parseBody(req);
    const action = (body.action ?? 'LIST') as 'LIST' | 'UPSERT' | 'RETIRE';

    // LIST: any authenticated user
    if (action === 'LIST') {
        const ctx = await authenticateRequest(req);
        if (!ctx) return unauthorized(origin);
        const { data, error } = await ctx.db
            .from('tariff_rates')
            .select('*')
            .order('tariff_type')
            .order('effective_from', { ascending: false });
        if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });
        return jsonResponse({ success: true, rates: data ?? [] }, { origin });
    }

    // Admin-only operations
    const ctx = await authenticateRequest(req, { requireRoles: ['ADMIN'] });
    if (!ctx) return forbidden(origin, 'tariff_rates management requires ADMIN role.');

    if (action === 'UPSERT') {
        const rate = body.rate as Record<string, unknown> | undefined;
        if (!rate) return errorResponse('VALIDATION_FAILED', 'rate is required for UPSERT', { origin });

        const tariffType   = String(rate.tariff_type ?? '');
        const tariffLabel  = String(rate.tariff_label ?? tariffType);
        const ratePct      = Number(rate.rate_pct ?? 0);
        const hsCodePrefix = (rate.hs_code_prefix as string | null) ?? null;
        const originCountry = String(rate.origin_country ?? 'IN');
        const destCountry   = String(rate.destination_country ?? 'US');
        const effectiveFrom = String(rate.effective_from ?? new Date().toISOString().slice(0,10));

        if (!ALLOWED_TYPES.includes(tariffType)) {
            return errorResponse('VALIDATION_FAILED',
                `tariff_type must be one of ${ALLOWED_TYPES.join(', ')}`, { origin });
        }
        if (!Number.isFinite(ratePct) || ratePct < 0) {
            return errorResponse('VALIDATION_FAILED', 'rate_pct must be non-negative', { origin });
        }

        // Retire any currently-active matching rate
        await ctx.db.from('tariff_rates')
            .update({ effective_to: effectiveFrom })
            .eq('tariff_type', tariffType)
            .eq('origin_country', originCountry)
            .eq('destination_country', destCountry)
            .is('hs_code_prefix', hsCodePrefix as unknown as null)
            .is('effective_to', null);

        const { data, error } = await ctx.db.from('tariff_rates').insert({
            tariff_type:        tariffType,
            tariff_label:       tariffLabel,
            rate_pct:           ratePct,
            hs_code_prefix:     hsCodePrefix,
            origin_country:     originCountry,
            destination_country: destCountry,
            effective_from:     effectiveFrom,
            notes:              rate.notes as string | null ?? null,
        }).select('*').single();

        if (error) return errorResponse('INTERNAL_ERROR', error.message, { origin });
        return jsonResponse({ success: true, rate: data }, { origin });
    }

    if (action === 'RETIRE') {
        if (!body.rate_id) return errorResponse('VALIDATION_FAILED', 'rate_id required', { origin });
        const effectiveTo = (body.effective_to as string) ?? new Date().toISOString().slice(0,10);

        const { data, error } = await ctx.db
            .from('tariff_rates')
            .update({ effective_to: effectiveTo })
            .eq('id', body.rate_id)
            .is('effective_to', null)
            .select('*').single();

        if (error) return errorResponse('CONFLICT',
            'Rate not found or already retired', { origin });
        return jsonResponse({ success: true, rate: data }, { origin });
    }

    return errorResponse('VALIDATION_FAILED',
        "action must be 'LIST', 'UPSERT', or 'RETIRE'", { origin });
});

if (import.meta.main) Deno.serve(handler);
