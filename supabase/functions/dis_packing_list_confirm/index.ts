import { getCorsHeaders } from '../_shared/cors.ts';
import { requireActiveSession, withTransactionLock } from '../_shared/session.ts';

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
    if (!body.mpl_id) return j({ error: 'mpl_id is required' }, 400);

    const mplId: string = body.mpl_id;
    const userId: string = user.id;

    return await withTransactionLock(ctx, {
      key:   `dis_packing_list_confirm:${mplId}`,
      label: 'Confirming Master Packing List',
    }, async () => {
    const idempotencyKey: string | null = body.idempotency_key ?? null;
    const now = new Date().toISOString();

    // ── Idempotency check ──────────────────────────────────────────────────────
    if (idempotencyKey) {
      const { data: ik } = await db
        .from('idempotency_keys')
        .select('status, result_data')
        .eq('idempotency_key', idempotencyKey)
        .eq('operation_type', 'CONFIRM_MPL')
        .maybeSingle();

      if (ik?.status === 'SUCCESS') return j({ success: true, data: ik.result_data });

      await db.from('idempotency_keys').delete()
        .eq('idempotency_key', idempotencyKey).eq('operation_type', 'CONFIRM_MPL');
      await db.from('idempotency_keys').insert({
        idempotency_key: idempotencyKey,
        operation_type: 'CONFIRM_MPL',
        entity_id: mplId,
        created_by: userId,
      });
    }

    try {
      // ── Fetch and validate MPL ─────────────────────────────────────────────
      const { data: mpl, error: mplFetchErr } = await db
        .from('master_packing_lists')
        .select('id, mpl_number, status, packing_list_id, packing_list_data_id')
        .eq('id', mplId)
        .single();

      if (mplFetchErr || !mpl) throw new Error('MPL not found');

      // Idempotent: already confirmed
      if (['CONFIRMED', 'PRINTED', 'DISPATCHED'].includes((mpl as any).status)) {
        const result = { success: true, already_confirmed: true, mpl_number: (mpl as any).mpl_number };
        return j({ success: true, data: result });
      }
      if ((mpl as any).status !== 'DRAFT') {
        throw new Error(`Cannot confirm MPL in ${(mpl as any).status} status`);
      }

      // ── Step 1: Upsert pack_packing_list_data ─────────────────────────────
      const invoiceDate = body.invoice_date ? body.invoice_date : null;
      const poDate = body.purchase_order_date ? body.purchase_order_date : null;

      let plDataId: string | null = (mpl as any).packing_list_data_id ?? null;

      const { data: existingPlData } = await db
        .from('pack_packing_list_data')
        .select('id')
        .eq('packing_list_id', (mpl as any).packing_list_id)
        .maybeSingle();

      if (existingPlData) {
        plDataId = (existingPlData as any).id;
        await db.from('pack_packing_list_data').update({
          invoice_number: body.invoice_number ?? undefined,
          invoice_date: invoiceDate,
          purchase_order_number: body.purchase_order_number ?? undefined,
          purchase_order_date: poDate,
          ship_via: body.ship_via ?? undefined,
          mode_of_transport: body.mode_of_transport ?? undefined,
          is_finalized: true,
          updated_by: userId,
          updated_at: now,
        }).eq('id', plDataId);
      } else {
        const { data: newPlData, error: insertErr } = await db
          .from('pack_packing_list_data')
          .insert({
            packing_list_id: (mpl as any).packing_list_id,
            invoice_number: body.invoice_number ?? null,
            invoice_date: invoiceDate,
            purchase_order_number: body.purchase_order_number ?? null,
            purchase_order_date: poDate,
            ship_via: body.ship_via ?? null,
            mode_of_transport: body.mode_of_transport ?? null,
            is_finalized: true,
            created_by: userId,
          })
          .select('id')
          .single();

        if (insertErr || !newPlData) throw new Error(`Failed to create packing list data: ${insertErr?.message}`);
        plDataId = (newPlData as any).id;

        // Link to MPL
        await db.from('master_packing_lists')
          .update({ packing_list_data_id: plDataId })
          .eq('id', mplId);
      }

      // ── Step 2: Update pallet detail weights ──────────────────────────────
      const palletWeights: Array<{ pallet_id: string; net_weight_kg: number; gross_weight_kg: number }> =
        Array.isArray(body.pallet_weights) ? body.pallet_weights : [];

      let totalGross = 0;
      for (const pw of palletWeights) {
        totalGross += Number(pw.gross_weight_kg ?? 0);
        await db.from('pack_packing_list_pallet_details').update({
          net_weight_kg: pw.net_weight_kg ?? undefined,
          gross_weight_kg: pw.gross_weight_kg ?? undefined,
          invoice_number: body.invoice_number ?? undefined,
          po_number: body.purchase_order_number ?? undefined,
          updated_at: now,
        })
          .eq('packing_list_data_id', plDataId!)
          .eq('pallet_id', pw.pallet_id);
      }

      // ── Step 3: Update MPL → CONFIRMED ────────────────────────────────────
      await db.from('master_packing_lists').update({
        invoice_number: body.invoice_number ?? null,
        po_number: body.purchase_order_number ?? null,
        total_gross_weight_kg: totalGross,
        status: 'CONFIRMED',
        confirmed_at: now,
        confirmed_by: userId,
      }).eq('id', mplId);

      // ── Step 4: Audit log ─────────────────────────────────────────────────
      await db.from('dispatch_audit_log').insert({
        entity_type: 'MASTER_PACKING_LIST',
        entity_id: mplId,
        entity_number: (mpl as any).mpl_number,
        action: 'CONFIRMED',
        from_status: 'DRAFT',
        to_status: 'CONFIRMED',
        performed_by: userId,
        metadata: {
          invoice_number: body.invoice_number,
          po_number: body.purchase_order_number,
          total_gross_weight_kg: totalGross,
        },
      });

      const result = { success: true, mpl_number: (mpl as any).mpl_number, status: 'CONFIRMED' };

      if (idempotencyKey) {
        await db.from('idempotency_keys').update({
          status: 'SUCCESS',
          completed_at: now,
          result_data: result,
        }).eq('idempotency_key', idempotencyKey).eq('operation_type', 'CONFIRM_MPL');
      }

      return j({ success: true, data: result });

    } catch (innerErr: any) {
      if (idempotencyKey) {
        await db.from('idempotency_keys').update({
          status: 'FAILED',
          completed_at: new Date().toISOString(),
          error_message: innerErr?.message,
        }).eq('idempotency_key', idempotencyKey).eq('operation_type', 'CONFIRM_MPL');
      }
      throw innerErr;
    }
    });

  } catch (err: any) {
    console.error('[dis_packing_list_confirm]', err?.message ?? err);
    return j({ error: err?.message || 'Internal server error' }, 500);
  }
});
