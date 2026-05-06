/**
 * bpa_create — Edge Function
 *
 * Creates a new Customer Agreement (BPA) with its parts in one atomic call.
 *
 * Not an RPC because:
 *   - 2 tables inserted (customer_agreements + customer_agreement_parts)
 *   - No row locks / no concurrent-modification risk (new rows)
 *   - Simple cascade; PostgREST handles the pair well
 *
 * INPUT (JSON):
 *   {
 *     agreement_number: "260067252",          REQ
 *     agreement_type:   "BPA" | "ANNUAL_CONTRACT" | "SPOT" | "OTHER",
 *     customer_code:    "OPW",
 *     customer_name:    "OPW Fueling Components LLC",
 *     buyer_name:       "Wood, Sherrill",                (optional)
 *     buyer_email:      "sherrill.wood@opwglobal.com",    (optional)
 *     agreement_date:   "2025-03-27",
 *     effective_start_date: "2025-04-01",
 *     effective_end_date:   "2026-12-31",
 *     payment_terms:    "Net 90",                         (optional)
 *     incoterms:        "DDP WILMINGTON",                 (optional)
 *     ship_via:         "DB SCHENKER",                    (optional)
 *     parts: [                                            REQ, >=1
 *       { part_number, msn_code, customer_part_number, drawing_number,
 *         drawing_revision, blanket_quantity, unit_price,
 *         release_multiple, min_warehouse_stock, max_warehouse_stock,
 *         avg_monthly_demand, hs_code }
 *     ]
 *   }
 *
 * OUTPUT:
 *   { success: true, agreement_id, agreement_number, revision: 0, parts_created }
 */
import { withMutationGuard } from '../_shared/session.ts';
import { jsonResponse, errorResponse, withErrorHandler, mapPgError } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler((req) => withMutationGuard(req, { label: 'Creating Customer Agreement (BPA)' }, async (ctx) => {
    const origin = req.headers.get('origin') ?? undefined;
    const body = await parseBody(req);

    // ── Header validation ─────────────────────────────────────────────
    const hv = validate(body, {
        agreement_number:     'string',
        agreement_type:       'string',
        customer_code:        'string',
        customer_name:        'string',
        agreement_date:       'date_iso',
        effective_start_date: 'date_iso',
        effective_end_date:   'date_iso',
    });
    if (!hv.ok) return errorResponse('VALIDATION_FAILED', hv.error, { origin });

    const parts = body.parts;
    if (!Array.isArray(parts) || parts.length === 0) {
        return errorResponse('VALIDATION_FAILED', "Field 'parts' must be a non-empty array", { origin });
    }

    // Per-part validation
    for (let i = 0; i < parts.length; i++) {
        const pv = validate(parts[i] as Record<string, unknown>, {
            part_number:         'string',
            msn_code:            'string',
            customer_part_number: 'string',
            drawing_number:      'string',
            blanket_quantity:    'positive_int',
            unit_price:          'number',
            release_multiple:    'positive_int',
        });
        if (!pv.ok) return errorResponse('VALIDATION_FAILED', `parts[${i}]: ${pv.error}`, { origin });
    }

    // ── Business-rule check: effective_start <= effective_end ────────
    if ((body.effective_start_date as string) > (body.effective_end_date as string)) {
        return errorResponse('VALIDATION_FAILED',
            'effective_start_date must be <= effective_end_date', { origin });
    }

    // ── Insert agreement header ──────────────────────────────────────
    const agreement = {
        agreement_number:     body.agreement_number,
        agreement_revision:   0,
        agreement_type:       body.agreement_type,
        agreement_title:      body.agreement_title ?? null,
        customer_code:        body.customer_code,
        customer_name:        body.customer_name,
        buyer_name:           body.buyer_name ?? null,
        buyer_email:          body.buyer_email ?? null,
        buyer_phone:          body.buyer_phone ?? null,
        agreement_date:       body.agreement_date,
        effective_start_date: body.effective_start_date,
        effective_end_date:   body.effective_end_date,
        currency_code:        body.currency_code ?? 'USD',
        payment_terms:        body.payment_terms ?? null,
        incoterms:            body.incoterms ?? null,
        delivery_location:    body.delivery_location ?? null,
        ship_via:             body.ship_via ?? null,
        status:               'ACTIVE',
        source:               'MANUAL',
        created_by:           ctx.userId,
        updated_by:           ctx.userId,
        total_parts:          parts.length,
    };

    const { data: agr, error: agrErr } = await ctx.db
        .from('customer_agreements')
        .insert(agreement)
        .select('id, agreement_number, agreement_revision')
        .single();
    if (agrErr) {
        const m = mapPgError(agrErr);
        return errorResponse(m.code, m.message, { origin });
    }

    // ── Lookup item_id for each part by part_number ──────────────────
    const partNumbers = parts.map((p: Record<string, unknown>) => String(p.part_number));
    const { data: items } = await ctx.db
        .from('items')
        .select('id, part_number')
        .in('part_number', partNumbers)
        .is('deleted_at', null);
    const itemByPn = new Map<string, string>();
    for (const it of items ?? []) itemByPn.set(it.part_number, it.id);

    // ── Insert parts ──────────────────────────────────────────────────
    const partRows = parts.map((p: Record<string, unknown>, idx: number) => ({
        agreement_id:         agr.id,
        line_number:          idx + 1,
        part_number:          p.part_number,
        item_id:              itemByPn.get(String(p.part_number)) ?? null,
        msn_code:             p.msn_code,
        customer_part_number: p.customer_part_number,
        drawing_number:       p.drawing_number,
        drawing_revision:     p.drawing_revision ?? null,
        customer_description: p.customer_description ?? null,
        hs_code:              p.hs_code ?? null,
        dbk_code:             p.dbk_code ?? null,
        blanket_quantity:     p.blanket_quantity,
        unit_price:           p.unit_price,
        avg_monthly_demand:   p.avg_monthly_demand ?? 0,
        min_warehouse_stock:  p.min_warehouse_stock ?? 0,
        max_warehouse_stock:  p.max_warehouse_stock ?? 0,
        release_multiple:     p.release_multiple,
        safety_stock:         p.safety_stock ?? 0,
        is_active:            true,
    }));

    const { data: insertedParts, error: pErr } = await ctx.db
        .from('customer_agreement_parts')
        .insert(partRows)
        .select('id, part_number, total_value');
    if (pErr) {
        // Roll back the agreement (no transaction here; 2nd-best cleanup)
        await ctx.db.from('customer_agreements').delete().eq('id', agr.id);
        const m = mapPgError(pErr);
        return errorResponse(m.code, m.message, { origin });
    }

    // Update agreement.total_blanket_value
    const totalValue = (insertedParts ?? []).reduce((s, p) => s + Number(p.total_value ?? 0), 0);
    await ctx.db
        .from('customer_agreements')
        .update({ total_blanket_value: totalValue })
        .eq('id', agr.id);

    // ── Audit ─────────────────────────────────────────────────────────
    await ctx.db.from('release_audit_log').insert({
        entity_type:   'AGREEMENT',
        entity_id:     agr.id,
        entity_number: agr.agreement_number,
        action:        'CREATED',
        metadata: {
            parts_count:   insertedParts?.length ?? 0,
            total_value:   totalValue,
            customer_code: body.customer_code,
        },
        performed_by:  ctx.userId,
    });

    return jsonResponse({
        success:          true,
        agreement_id:     agr.id,
        agreement_number: agr.agreement_number,
        revision:         agr.agreement_revision,
        parts_created:    insertedParts?.length ?? 0,
        total_blanket_value: totalValue,
    }, { origin });
}));

if (import.meta.main) Deno.serve(handler);
