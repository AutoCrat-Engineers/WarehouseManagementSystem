import { getCorsHeaders } from '../_shared/cors.ts';
import { requireActiveSession, withTransactionLock } from '../_shared/session.ts';
import { nextSequenceValue, formatPiNumber } from '../_shared/seq.ts';

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req.headers.get('origin') ?? '');
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  const j = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

  try {
    const session = await requireActiveSession(req);
    if (!session.ok) return session.response;
    const ctx = session.ctx;
    const user = { id: ctx.userId };
    const db = ctx.db;
    const body = await req.json().catch(() => ({}));

    return await withTransactionLock(ctx, {
      key:   `creating_proforma_invoice:${ctx.sessionId}`,
      label: 'Creating Proforma Invoice',
    }, async () => {

    if (!Array.isArray(body.mpl_ids) || body.mpl_ids.length === 0)
      return j({ error: 'mpl_ids is required and must be a non-empty array' }, 400);
    if (!body.customer_name || !body.customer_name.trim())
      return j({ error: 'customer_name is required' }, 400);
    if (!body.idempotency_key)
      return j({ error: 'idempotency_key is required' }, 400);

    const mplIds: string[] = body.mpl_ids;
    const idempotencyKey: string = body.idempotency_key;
    const now = new Date().toISOString();

    // ── Idempotency check ──────────────────────────────────────────────────────
    const { data: ik } = await db
      .from('idempotency_keys')
      .select('status, result_data')
      .eq('idempotency_key', idempotencyKey)
      .eq('operation_type', 'CREATE_PI')
      .maybeSingle();

    if (ik?.status === 'SUCCESS') return j({ success: true, data: ik.result_data });

    await db.from('idempotency_keys').delete()
      .eq('idempotency_key', idempotencyKey).eq('operation_type', 'CREATE_PI');
    await db.from('idempotency_keys').insert({
      idempotency_key: idempotencyKey,
      operation_type: 'CREATE_PI',
      created_by: user.id,
    });

    try {
      // ── Validate MPLs ──────────────────────────────────────────────────────
      const { data: mpls, error: mplsErr } = await db
        .from('master_packing_lists')
        .select('id, mpl_number, status, proforma_invoice_id, invoice_number, po_number, item_code, item_name, total_pallets, total_quantity, total_gross_weight_kg')
        .in('id', mplIds)
        .order('mpl_number');

      if (mplsErr || !mpls) throw new Error('Failed to fetch MPLs');

      for (const m of mpls as any[]) {
        if (!['CONFIRMED', 'PRINTED'].includes(m.status)) {
          throw new Error(`MPL ${m.mpl_number} is not in CONFIRMED/PRINTED status (current: ${m.status})`);
        }
        if (m.proforma_invoice_id) {
          throw new Error(`MPL ${m.mpl_number} is already linked to another Proforma Invoice`);
        }
      }

      // ── Generate PI number from sequence — no RPC ─────────────────────────
      const seq = await nextSequenceValue('pi_number_seq');
      const piNumber = formatPiNumber(seq);

      // ── Aggregate totals ───────────────────────────────────────────────────
      const mplCount = (mpls as any[]).length;
      const totalPallets = (mpls as any[]).reduce((s: number, m: any) => s + (m.total_pallets ?? 0), 0);
      const totalQty = (mpls as any[]).reduce((s: number, m: any) => s + (m.total_quantity ?? 0), 0);
      const totalGross = (mpls as any[]).reduce((s: number, m: any) => s + Number(m.total_gross_weight_kg ?? 0), 0);

      // ── Resolve customer name ──────────────────────────────────────────────
      const customerName: string = body.customer_name || (mpls as any[])[0]?.item_name || '';

      // ── Create PI header ───────────────────────────────────────────────────
      const { data: pi, error: piErr } = await db
        .from('pack_proforma_invoices')
        .insert({
          proforma_number: piNumber,
          customer_name: customerName,
          customer_code: body.customer_code || null,
          total_amount: 0,
          currency_code: 'USD',
          status: 'DRAFT',
          total_invoices: mplCount,
          total_pallets: totalPallets,
          total_quantity: totalQty,
          shipment_number: body.shipment_number || null,
          created_by: user.id,
        })
        .select('id')
        .single();

      if (piErr || !pi) throw new Error(`Failed to create PI: ${piErr?.message}`);
      const piId: string = (pi as any).id;

      // ── Create junction records + link MPLs ───────────────────────────────
      let lineNum = 0;
      for (const m of mpls as any[]) {
        lineNum++;
        await db.from('proforma_invoice_mpls').insert({
          proforma_id: piId,
          mpl_id: m.id,
          mpl_number: m.mpl_number,
          invoice_number: m.invoice_number,
          po_number: m.po_number,
          item_code: m.item_code,
          total_pallets: m.total_pallets,
          total_quantity: m.total_quantity,
          total_gross_weight_kg: Number(m.total_gross_weight_kg ?? 0),
          line_number: lineNum,
        });

        await db.from('master_packing_lists')
          .update({ proforma_invoice_id: piId })
          .eq('id', m.id);
      }

      // ── Audit log ──────────────────────────────────────────────────────────
      await db.from('dispatch_audit_log').insert({
        entity_type: 'PROFORMA_INVOICE',
        entity_id: piId,
        entity_number: piNumber,
        action: 'CREATED',
        to_status: 'DRAFT',
        performed_by: user.id,
        metadata: {
          mpl_count: mplCount,
          total_pallets: totalPallets,
          total_quantity: totalQty,
          shipment_number: body.shipment_number || null,
        },
      });

      // ── ship_via update (non-fatal) ────────────────────────────────────────
      if (body.freight_forwarder && Array.isArray(body.packing_list_ids) && body.packing_list_ids.length > 0) {
        const { error: svErr } = await db
          .from('pack_packing_list_data')
          .update({ ship_via: body.freight_forwarder })
          .in('packing_list_id', body.packing_list_ids);
        if (svErr) console.error('[dis_proforma_inv_create] ship_via update error:', svErr);
      }

      const result = { success: true, id: piId, proforma_number: piNumber, total_pallets: totalPallets, total_quantity: totalQty, mpl_count: mplCount };

      await db.from('idempotency_keys').update({
        status: 'SUCCESS',
        completed_at: now,
        entity_id: piId,
        result_data: result,
      }).eq('idempotency_key', idempotencyKey).eq('operation_type', 'CREATE_PI');

      return j({ success: true, data: result });

    } catch (innerErr: any) {
      await db.from('idempotency_keys').update({
        status: 'FAILED',
        completed_at: new Date().toISOString(),
        error_message: innerErr?.message,
      }).eq('idempotency_key', idempotencyKey).eq('operation_type', 'CREATE_PI');
      throw innerErr;
    }

    });
  } catch (err: any) {
    console.error('[dis_proforma_inv_create]', err?.message ?? err);
    return j({ error: err?.message || 'Internal server error' }, 500);
  }
});
