/**
 * bo_create_from_bpa — Edge Function
 *
 * When a BPA becomes ACTIVE, create the operational blanket_orders row (if
 * not already exists) + blanket_order_line_configs rows (one per BPA part).
 * These are the "working copies" that carry running totals during fulfillment.
 *
 * Idempotent: safe to call multiple times; uses ON CONFLICT / existence checks.
 *
 * INPUT (JSON):
 *   { agreement_id: uuid }
 *
 * OUTPUT:
 *   { success, blanket_order_id, line_configs_created, line_configs_existing }
 */
import { withMutationGuard } from '../_shared/session.ts';
import { jsonResponse, errorResponse, withErrorHandler } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler((req) => withMutationGuard(req, { label: 'Creating Blanket Order from BPA' }, async (ctx) => {
    const origin = req.headers.get('origin') ?? undefined;
    const body = await parseBody(req);
    const v = validate(body, { agreement_id: 'uuid' });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    // ── Fetch agreement + parts ──────────────────────────────────────
    const { data: agreement, error: aErr } = await ctx.db
        .from('customer_agreements').select('*').eq('id', body.agreement_id).single();
    if (aErr || !agreement) return errorResponse('NOT_FOUND', 'Agreement not found', { origin });

    const { data: parts, error: pErr } = await ctx.db
        .from('customer_agreement_parts').select('*')
        .eq('agreement_id', body.agreement_id).eq('is_active', true)
        .order('line_number');
    if (pErr) return errorResponse('INTERNAL_ERROR', pErr.message, { origin });
    if (!parts || parts.length === 0) {
        return errorResponse('VALIDATION_FAILED', 'Agreement has no active parts', { origin });
    }

    // ── Resolve or create blanket_orders row ─────────────────────────
    let { data: bo } = await ctx.db
        .from('blanket_orders').select('*')
        .eq('order_number', agreement.agreement_number).maybeSingle();

    if (!bo) {
        const { data: created, error: boErr } = await ctx.db
            .from('blanket_orders').insert({
                order_number:  agreement.agreement_number,
                agreement_id:  agreement.id,
                status:        'ACTIVE',
                start_date:    agreement.effective_start_date,
                end_date:      agreement.effective_end_date,
                source:        'MANUAL',
            }).select('*').single();
        if (boErr) return errorResponse('INTERNAL_ERROR', `Failed to create BO: ${boErr.message}`, { origin });
        bo = created;
    } else if (!bo.agreement_id) {
        // Link existing BO to the agreement
        await ctx.db.from('blanket_orders')
            .update({ agreement_id: agreement.id })
            .eq('id', bo.id);
    }

    // ── Create line configs (skip ones that already exist) ───────────
    const { data: existing } = await ctx.db
        .from('blanket_order_line_configs').select('part_number')
        .eq('blanket_order_id', bo.id);
    const existingPns = new Set((existing ?? []).map(r => r.part_number));

    const rowsToInsert = parts
        .filter(p => !existingPns.has(p.part_number))
        .map((p, idx) => ({
            blanket_order_id:     bo.id,
            agreement_id:         agreement.id,
            agreement_part_id:    p.id,
            part_number:          p.part_number,
            item_id:              p.item_id,
            msn_code:             p.msn_code,
            customer_part_number: p.customer_part_number,
            drawing_number:       p.drawing_number,
            drawing_revision:     p.drawing_revision,
            blanket_quantity:     p.blanket_quantity,
            unit_price:           p.unit_price,
            release_multiple:     p.release_multiple,
            min_warehouse_stock:  p.min_warehouse_stock,
            max_warehouse_stock:  p.max_warehouse_stock,
            line_number:          idx + 1,
            is_active:            true,
            source:               'MANUAL',
        }));

    let inserted = 0;
    if (rowsToInsert.length > 0) {
        const { data: newRows, error: iErr } = await ctx.db
            .from('blanket_order_line_configs').insert(rowsToInsert).select('id');
        if (iErr) return errorResponse('INTERNAL_ERROR', iErr.message, { origin });
        inserted = newRows?.length ?? 0;
    }

    await ctx.db.from('release_audit_log').insert({
        entity_type:   'BLANKET_ORDER',
        entity_id:     bo.id,
        entity_number: bo.order_number,
        action:        'CREATED',
        metadata: {
            source:                 'bo_create_from_bpa',
            agreement_id:           agreement.id,
            agreement_number:       agreement.agreement_number,
            line_configs_created:   inserted,
            line_configs_existing:  existingPns.size,
        },
        performed_by:  ctx.userId,
    });

    return jsonResponse({
        success:                 true,
        blanket_order_id:        bo.id,
        blanket_order_number:    bo.order_number,
        line_configs_created:    inserted,
        line_configs_existing:   existingPns.size,
    }, { origin });
}));

if (import.meta.main) Deno.serve(handler);
