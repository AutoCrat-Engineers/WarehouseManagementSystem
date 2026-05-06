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
    if (!body.pi_id) return j({ error: 'pi_id is required' }, 400);

    const piId: string = body.pi_id;

    return await withTransactionLock(ctx, {
      key:   `dis_proforma_inv_approve:${piId}`,
      label: 'Approving Proforma Invoice (stock dispatch)',
      ttlSeconds: 120,
    }, async () => {
    const idempotencyKey: string = body.idempotency_key || crypto.randomUUID();
    const now = new Date().toISOString();

    // ── 1. Fetch and validate PI ──────────────────────────────────────────────
    const { data: pi, error: piFetchErr } = await db
      .from('pack_proforma_invoices')
      .select('id, proforma_number, status')
      .eq('id', piId)
      .single();

    if (piFetchErr || !pi) return j({ error: 'Proforma Invoice not found' }, 404);

    // Idempotency guard — already processed
    if (['STOCK_MOVED', 'DISPATCHED'].includes((pi as any).status)) {
      return j({ success: true, data: { success: true, already_processed: true } });
    }
    if (!['DRAFT', 'CONFIRMED'].includes((pi as any).status)) {
      return j({ error: `Cannot approve PI in ${(pi as any).status} status` }, 422);
    }

    // ── 2. Resolve warehouse IDs ───────────────────────────────────────────────
    const [fgWhRes, transitWhRes] = await Promise.all([
      db.from('inv_warehouses')
        .select('id, inv_warehouse_types!inner(category)')
        .eq('inv_warehouse_types.category', 'PRODUCTION')
        .eq('is_active', true)
        .limit(1)
        .single(),
      db.from('inv_warehouses')
        .select('id, inv_warehouse_types!inner(category)')
        .eq('inv_warehouse_types.category', 'IN_TRANSIT')
        .eq('is_active', true)
        .limit(1)
        .single(),
    ]);

    const fgWhId: string | null = (fgWhRes.data as any)?.id ?? null;
    const transitWhId: string | null = (transitWhRes.data as any)?.id ?? null;

    if (!fgWhId || !transitWhId) {
      return j({ error: 'Required warehouses (PRODUCTION / IN_TRANSIT) not found' }, 422);
    }

    // ── 3. Aggregate qty per item_code from active pallet junction ─────────────
    const { data: mplPalletRows } = await db
      .from('master_packing_list_pallets')
      .select('item_code, quantity, proforma_invoice_mpls!inner(proforma_id)')
      .eq('proforma_invoice_mpls.proforma_id', piId)
      .eq('status', 'ACTIVE');

    // Group by item_code
    const itemQtyMap: Record<string, number> = {};
    for (const row of (mplPalletRows || []) as any[]) {
      itemQtyMap[row.item_code] = (itemQtyMap[row.item_code] ?? 0) + (row.quantity ?? 0);
    }

    // ── 4. Stock movements per item ────────────────────────────────────────────
    for (const [itemCode, qty] of Object.entries(itemQtyMap)) {
      // ── DEDUCT from FG (Production) warehouse ──
      const { data: fgStock } = await db
        .from('inv_warehouse_stock')
        .select('id, quantity_on_hand')
        .eq('warehouse_id', fgWhId)
        .eq('item_code', itemCode)
        .maybeSingle();

      if (fgStock) {
        const newQty = ((fgStock as any).quantity_on_hand ?? 0) - qty;
        await db.from('inv_warehouse_stock').update({
          quantity_on_hand: newQty,
          last_issue_date: now,
          updated_at: now,
          updated_by: user.id,
        }).eq('id', (fgStock as any).id);

        try {
          await db.from('inv_stock_ledger').insert({
            warehouse_id: fgWhId,
            item_code: itemCode,
            transaction_type: 'TRANSFER_OUT',
            quantity_change: -qty,
            quantity_before: (fgStock as any).quantity_on_hand,
            quantity_after: newQty,
            reference_type: 'PROFORMA_INVOICE',
            reference_id: piId,
            source_warehouse_id: fgWhId,
            destination_warehouse_id: transitWhId,
            notes: `PI Dispatch: ${qty} units from FG → Transit | ${(pi as any).proforma_number}`,
            created_by: user.id,
          });
        } catch { /* non-fatal */ }
      } else {
        const newQty = -qty;
        await db.from('inv_warehouse_stock').insert({
          warehouse_id: fgWhId,
          item_code: itemCode,
          quantity_on_hand: newQty,
          last_issue_date: now,
          created_by: user.id,
          updated_by: user.id,
        });
        try {
          await db.from('inv_stock_ledger').insert({
            warehouse_id: fgWhId,
            item_code: itemCode,
            transaction_type: 'TRANSFER_OUT',
            quantity_change: -qty,
            quantity_before: 0,
            quantity_after: newQty,
            reference_type: 'PROFORMA_INVOICE',
            reference_id: piId,
            source_warehouse_id: fgWhId,
            destination_warehouse_id: transitWhId,
            notes: `PI Dispatch: ${qty} units from FG → Transit | ${(pi as any).proforma_number}`,
            created_by: user.id,
          });
        } catch { /* non-fatal */ }
      }

      // ── CREDIT to IN_TRANSIT warehouse ──
      const { data: transitStock } = await db
        .from('inv_warehouse_stock')
        .select('id, quantity_on_hand')
        .eq('warehouse_id', transitWhId)
        .eq('item_code', itemCode)
        .maybeSingle();

      if (transitStock) {
        const newQty = ((transitStock as any).quantity_on_hand ?? 0) + qty;
        await db.from('inv_warehouse_stock').update({
          quantity_on_hand: newQty,
          last_receipt_date: now,
          updated_at: now,
          updated_by: user.id,
        }).eq('id', (transitStock as any).id);

        try {
          await db.from('inv_stock_ledger').insert({
            warehouse_id: transitWhId,
            item_code: itemCode,
            transaction_type: 'TRANSFER_IN',
            quantity_change: qty,
            quantity_before: (transitStock as any).quantity_on_hand,
            quantity_after: newQty,
            reference_type: 'PROFORMA_INVOICE',
            reference_id: piId,
            source_warehouse_id: fgWhId,
            destination_warehouse_id: transitWhId,
            notes: `PI Dispatch: ${qty} units received in Transit | ${(pi as any).proforma_number}`,
            created_by: user.id,
          });
        } catch { /* non-fatal */ }
      } else {
        await db.from('inv_warehouse_stock').insert({
          warehouse_id: transitWhId,
          item_code: itemCode,
          quantity_on_hand: qty,
          last_receipt_date: now,
          created_by: user.id,
          updated_by: user.id,
        });
        try {
          await db.from('inv_stock_ledger').insert({
            warehouse_id: transitWhId,
            item_code: itemCode,
            transaction_type: 'TRANSFER_IN',
            quantity_change: qty,
            quantity_before: 0,
            quantity_after: qty,
            reference_type: 'PROFORMA_INVOICE',
            reference_id: piId,
            source_warehouse_id: fgWhId,
            destination_warehouse_id: transitWhId,
            notes: `PI Dispatch: ${qty} units received in Transit | ${(pi as any).proforma_number}`,
            created_by: user.id,
          });
        } catch { /* non-fatal */ }
      }
    }

    // ── 5. Update PI → STOCK_MOVED ────────────────────────────────────────────
    await db.from('pack_proforma_invoices').update({
      status: 'STOCK_MOVED',
      stock_moved_at: now,
      stock_moved_by: user.id,
      updated_at: now,
    }).eq('id', piId);

    // ── 6. Update linked MPLs → DISPATCHED ───────────────────────────────────
    const { data: linkedMplRows } = await db
      .from('proforma_invoice_mpls')
      .select('mpl_id')
      .eq('proforma_id', piId);

    const mplIds = ((linkedMplRows || []) as any[]).map((r: any) => r.mpl_id);

    if (mplIds.length > 0) {
      await db.from('master_packing_lists').update({
        status: 'DISPATCHED',
        dispatched_at: now,
        dispatched_by: user.id,
        updated_at: now,
        updated_by: user.id,
      })
        .in('id', mplIds)
        .neq('status', 'CANCELLED');
    }

    // ── 7. Cascade pallets → DISPATCHED ──────────────────────────────────────
    // Fetch active pallet IDs from junction
    const { data: activePalletRows } = await db
      .from('master_packing_list_pallets')
      .select('pallet_id')
      .in('mpl_id', mplIds)
      .eq('status', 'ACTIVE');

    const activePalletIds = ((activePalletRows || []) as any[]).map((r: any) => r.pallet_id);
    let palletsDispatched = 0;

    if (activePalletIds.length > 0) {
      const { data: updatedPallets } = await db.from('pack_pallets').update({
        state: 'DISPATCHED',
        dispatched_at: now,
        updated_at: now,
        updated_by: user.id,
        current_warehouse_id: transitWhId,
      })
        .in('id', activePalletIds)
        .in('state', ['LOCKED', 'READY'])
        .select('id');

      palletsDispatched = (updatedPallets || []).length;
    }

    // ── 8. Audit log ──────────────────────────────────────────────────────────
    try {
      await db.from('dispatch_audit_log').insert({
        entity_type: 'PROFORMA_INVOICE',
        entity_id: piId,
        entity_number: (pi as any).proforma_number,
        action: 'APPROVED',
        from_status: (pi as any).status,
        to_status: 'STOCK_MOVED',
        performed_by: user.id,
        metadata: {
          idempotency_key: idempotencyKey,
          pallets_dispatched: palletsDispatched,
        },
      });
    } catch { /* non-fatal */ }

    return j({
      success: true,
      data: {
        success: true,
        proforma_number: (pi as any).proforma_number,
        pallets_dispatched: palletsDispatched,
      },
    });
    });

  } catch (err: any) {
    console.error('[dis_proforma_inv_approve]', err?.message ?? err);
    return j({ error: err?.message || 'Internal server error' }, 500);
  }
});
