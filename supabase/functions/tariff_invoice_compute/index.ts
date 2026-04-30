/**
 * tariff_invoice_compute — Edge Function
 *
 * Computes tariff amounts for a DRAFT tariff invoice using the
 * `tariff_rates` reference table. Freezes rates into `calculation_snapshot`
 * JSONB so retroactive rate changes don't rewrite history.
 *
 * Lookup rule:
 *   For each active tariff_type on effective_from <= tariff_invoice_date,
 *   matching origin_country + destination_country, optionally HS-code-scoped.
 *   Amount = quantity * unit_price * (rate_pct / 100)
 *   OR     = quantity * unit_tariff  (if per-unit rate supplied).
 *
 * INPUT (JSON):
 *   {
 *     tariff_invoice_id: uuid,      REQ
 *     hs_code?: string,             (override snapshot)
 *     manual_rates?: [              (optional: override auto-lookup)
 *       { tariff_type, rate_pct, label }
 *     ]
 *   }
 *
 * OUTPUT:
 *   {
 *     success: true,
 *     tariff_invoice_id,
 *     calculation: {
 *       rates: [{ type, label, rate_pct, amount }],
 *       unit_tariff, total_tariff, invoice_value
 *     }
 *   }
 *
 * Can only be called on status='DRAFT'. Otherwise rejects with CONFLICT.
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

interface RateRow {
    tariff_type:  string;
    tariff_label: string;
    rate_pct:     number;
    hs_code_prefix: string | null;
    origin_country: string;
    destination_country: string;
}

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const v = validate(body, { tariff_invoice_id: 'uuid' });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    // ── Load tariff invoice ──────────────────────────────────────────
    const { data: ti, error: tiErr } = await ctx.db
        .from('tariff_invoices').select('*').eq('id', body.tariff_invoice_id).single();
    if (tiErr || !ti) return errorResponse('NOT_FOUND', 'Tariff invoice not found', { origin });
    if (ti.status !== 'DRAFT') {
        return errorResponse('CONFLICT',
            `Cannot recompute: status is ${ti.status} (only DRAFT is recomputable).`, { origin });
    }

    const hsCode = (body.hs_code as string) ?? (ti.calculation_snapshot?.hs_code ?? '');
    const invoiceValue = Number(ti.invoice_value ?? 0);
    const quantity     = Number(ti.quantity ?? 0);
    const unitPrice    = Number(ti.unit_price ?? 0);
    const asOfDate     = ti.tariff_invoice_date;

    // ── Lookup applicable rates ──────────────────────────────────────
    type CalcRow = { type: string; label: string; rate_pct: number; amount: number };
    let rates: CalcRow[] = [];

    if (Array.isArray(body.manual_rates)) {
        // Manual override path
        rates = (body.manual_rates as Array<Record<string, unknown>>).map(m => ({
            type:     String(m.tariff_type),
            label:    String(m.label ?? m.tariff_type),
            rate_pct: Number(m.rate_pct ?? 0),
            amount:   0,
        }));
    } else {
        const { data: rateRows, error: rErr } = await ctx.db
            .from('tariff_rates')
            .select('tariff_type, tariff_label, rate_pct, hs_code_prefix, origin_country, destination_country')
            .lte('effective_from', asOfDate)
            .or(`effective_to.is.null,effective_to.gt.${asOfDate}`);
        if (rErr) return errorResponse('INTERNAL_ERROR', rErr.message, { origin });

        // Filter: match origin=IN + dest=US + HS prefix (if specified)
        const applicable = (rateRows as RateRow[] ?? []).filter(r => {
            if (r.origin_country !== 'IN' || r.destination_country !== 'US') return false;
            if (r.hs_code_prefix) {
                // "7216%" → matches hsCode starting with 7216
                const prefix = r.hs_code_prefix.replace(/%+$/, '');
                return hsCode.startsWith(prefix);
            }
            return true;
        });

        rates = applicable.map(r => ({
            type:     r.tariff_type,
            label:    r.tariff_label,
            rate_pct: Number(r.rate_pct),
            amount:   0,
        }));
    }

    // ── Compute amounts ──────────────────────────────────────────────
    for (const r of rates) r.amount = +(invoiceValue * r.rate_pct / 100).toFixed(2);
    const totalTariff = +rates.reduce((s, r) => s + r.amount, 0).toFixed(2);
    const unitTariff  = quantity > 0 ? +(totalTariff / quantity).toFixed(4) : 0;

    // ── Freeze snapshot + update totals ──────────────────────────────
    const snapshot = {
        pending_calculation: false,
        computed_at:         new Date().toISOString(),
        hs_code:             hsCode,
        invoice_value:       invoiceValue,
        unit_price:          unitPrice,
        quantity:            quantity,
        rates_applied:       rates,
    };

    const { error: upErr } = await ctx.db.from('tariff_invoices').update({
        unit_tariff:          unitTariff,
        tariff_invoice_value: totalTariff,
        total_tariff:         totalTariff,
        calculation_snapshot: snapshot,
    }).eq('id', body.tariff_invoice_id);

    if (upErr) return errorResponse('INTERNAL_ERROR', upErr.message, { origin });

    await ctx.db.from('release_audit_log').insert({
        entity_type:   'TARIFF_INVOICE',
        entity_id:     body.tariff_invoice_id,
        entity_number: ti.tariff_invoice_number,
        action:        'UPDATED',
        metadata:      { action: 'computed', total_tariff: totalTariff, rates },
        performed_by:  ctx.userId,
    });

    return jsonResponse({
        success:           true,
        tariff_invoice_id: body.tariff_invoice_id,
        calculation: {
            rates,
            unit_tariff:  unitTariff,
            total_tariff: totalTariff,
            invoice_value: invoiceValue,
        },
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
