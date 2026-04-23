/**
 * release_create — Edge Function
 *
 * Creates a blanket_releases row from a customer PO. Single-table insert;
 * does NOT yet pick pallets or issue a sub-invoice (that's sub_invoice_create).
 *
 * INPUT (JSON):
 *   {
 *     customer_po_number: "260067252-10",     REQ
 *     agreement_id:       uuid,               REQ
 *     blanket_order_id?:  uuid,               optional (resolved from agreement if absent)
 *     line_config_id?:    uuid,               optional (resolved from agreement_id + part_number)
 *     part_number?:       "HW-LS-0022",
 *     requested_quantity: integer,            REQ
 *     need_by_date?:      iso_date,
 *     buyer_name?:        "Wood, Sherrill",
 *     notes?:             string
 *   }
 *
 * OUTPUT:
 *   { success, release_id, release_number, release_sequence, po_base }
 */
import { authenticateRequest } from '../_shared/auth.ts';
import { jsonResponse, errorResponse, unauthorized, withErrorHandler, mapPgError } from '../_shared/errors.ts';
import { parseBody, validate } from '../_shared/schemas.ts';

export const handler = withErrorHandler(async (req) => {
    const origin = req.headers.get('origin') ?? undefined;
    const ctx = await authenticateRequest(req);
    if (!ctx) return unauthorized(origin);

    const body = await parseBody(req);
    const v = validate(body, {
        customer_po_number: 'string',
        agreement_id:       'uuid',
        requested_quantity: 'positive_int',
    });
    if (!v.ok) return errorResponse('VALIDATION_FAILED', v.error, { origin });

    // Parse PO
    const poInput = String(body.customer_po_number).trim();
    let poBase = poInput;
    let releaseSeq: number | null = null;
    if (poInput.includes('-')) {
        const [b, s] = poInput.split('-');
        poBase = b;
        releaseSeq = s ? Number(s) : null;
    }

    // Auto-generate sequence when user only pastes the BPA number (no -N suffix).
    // Convention: <bpa>-<next_seq>, where next_seq = max(existing) + 1 per po_base.
    if (releaseSeq === null) {
        const { data: existing } = await ctx.db
            .from('blanket_releases')
            .select('release_sequence')
            .eq('customer_po_base', poBase)
            .order('release_sequence', { ascending: false, nullsFirst: false })
            .limit(1);
        const prev = existing?.[0]?.release_sequence ?? 0;
        releaseSeq = Number(prev) + 1;
    } else {
        // Explicit sequence — duplicate guard
        const { count } = await ctx.db
            .from('blanket_releases')
            .select('id', { count: 'exact', head: true })
            .eq('customer_po_base', poBase)
            .eq('release_sequence', releaseSeq);
        if ((count ?? 0) > 0) {
            return errorResponse('CONFLICT',
                `Release ${poBase}-${releaseSeq} already exists`, { origin });
        }
    }

    const poNumber = `${poBase}-${releaseSeq}`;

    // Resolve line_config_id if part_number supplied but line_config_id not
    let lineConfigId = body.line_config_id as string | null;
    if (!lineConfigId && body.part_number) {
        const { data } = await ctx.db
            .from('blanket_order_line_configs')
            .select('id, blanket_order_id')
            .eq('agreement_id', body.agreement_id)
            .eq('part_number', body.part_number)
            .eq('is_active', true)
            .maybeSingle();
        if (data) {
            lineConfigId = data.id;
            if (!body.blanket_order_id) body.blanket_order_id = data.blanket_order_id;
        }
    }

    // Insert release
    const insertRow: Record<string, unknown> = {
        blanket_order_id: body.blanket_order_id ?? null,
        agreement_id:     body.agreement_id,
        line_config_id:   lineConfigId,
        release_number:   poNumber,
        release_sequence: releaseSeq,
        customer_po_base: poBase,
        buyer_name:       body.buyer_name ?? null,
        requested_quantity: body.requested_quantity,
        need_by_date:     body.need_by_date ?? null,
        status:           'OPEN',
        notes:            body.notes ?? null,
        source:           'MANUAL',
    };

    const { data: rel, error } = await ctx.db
        .from('blanket_releases')
        .insert(insertRow)
        .select('id, release_number, release_sequence, customer_po_base')
        .single();

    if (error) {
        const m = mapPgError(error);
        return errorResponse(m.code, m.message, { origin, details: { pg_code: error.code } });
    }

    await ctx.db.from('release_audit_log').insert({
        entity_type:   'RELEASE',
        entity_id:     rel.id,
        entity_number: rel.release_number,
        action:        'CREATED',
        metadata: {
            po_base:            rel.customer_po_base,
            release_sequence:   rel.release_sequence,
            agreement_id:       body.agreement_id,
            requested_quantity: body.requested_quantity,
        },
        performed_by:  ctx.userId,
    });

    return jsonResponse({
        success:          true,
        release_id:       rel.id,
        release_number:   rel.release_number,
        release_sequence: rel.release_sequence,
        po_base:          rel.customer_po_base,
    }, { origin });
});

if (import.meta.main) Deno.serve(handler);
