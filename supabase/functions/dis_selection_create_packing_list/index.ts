import { getCorsHeaders } from '../_shared/cors.ts';
import { requireActiveSession, withTransactionLock } from '../_shared/session.ts';
import { nextSequenceValue, formatMplNumber } from '../_shared/seq.ts';

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
      key:   `creating_packing_list_from_selection:${ctx.sessionId}`,
      label: 'Creating Packing List from Selection',
    }, async () => {

    if (!Array.isArray(body.pallet_ids) || body.pallet_ids.length === 0)
      return j({ error: 'pallet_ids must be a non-empty array' }, 400);
    if (!body.idempotency_key)
      return j({ error: 'idempotency_key is required' }, 400);

    const palletIds: string[] = body.pallet_ids;
    const idempotencyKey: string = body.idempotency_key;
    const customerName: string | null = body.customer_name || null;
    const customerCode: string | null = body.customer_code || null;
    const dispatchDate: string | null = body.dispatch_date || null;
    const vehicleNumber: string | null = body.vehicle_number || null;
    const invoiceNumber: string | null = body.invoice_number || null;
    const poNumber: string | null = body.po_number || null;
    const now = new Date().toISOString();

    // ══ PHASE 1: Idempotency check ═══════════════════════════════════════════
    const { data: existingKey } = await db
      .from('idempotency_keys')
      .select('status, result_data')
      .eq('idempotency_key', idempotencyKey)
      .eq('operation_type', 'CREATE_DISPATCH_PL')
      .maybeSingle();

    if (existingKey?.status === 'SUCCESS') {
      return j({ success: true, data: existingKey.result_data });
    }

    await db.from('idempotency_keys')
      .delete()
      .eq('idempotency_key', idempotencyKey)
      .eq('operation_type', 'CREATE_DISPATCH_PL');

    await db.from('idempotency_keys').insert({
      idempotency_key: idempotencyKey,
      operation_type: 'CREATE_DISPATCH_PL',
      created_by: user.id,
    });

    try {
      // ══ PHASE 2: Validate pallets — all must be READY ════════════════════════
      const { data: pallets, error: palletsErr } = await db
        .from('pack_pallets')
        .select('id, pallet_number, item_id, item_code, current_qty, container_count, state, packing_spec_id, items!pack_pallets_item_id_fkey(item_name)')
        .in('id', palletIds)
        .order('created_at');

      if (palletsErr || !pallets) throw new Error('Failed to fetch pallets');

      let totalContainers = 0, totalQty = 0;
      let itemCode = '', itemName = '';

      for (const p of pallets as any[]) {
        if (p.state !== 'READY') {
          throw new Error(`Pallet ${p.pallet_number} is not READY (current state: ${p.state}). Cannot dispatch.`);
        }
        totalContainers += p.container_count ?? 0;
        totalQty += p.current_qty ?? 0;
        itemCode = p.item_code;
        itemName = p.items?.item_name ?? p.item_code;
      }

      const totalPallets = palletIds.length;

      // ══ PHASE 3: Create Packing List ═════════════════════════════════════════
      const rnd = Math.random().toString(36).substring(2, 7).toUpperCase();
      const plNumber = `PL-${now.slice(0, 10).replace(/-/g, '')}-${rnd}`;

      const { data: pl, error: plErr } = await db
        .from('pack_packing_lists')
        .insert({
          packing_list_number: plNumber,
          customer_code: customerCode,
          customer_name: customerName,
          status: 'DRAFT',
          total_pallets: totalPallets,
          total_containers: totalContainers,
          total_quantity: totalQty,
          dispatch_date: dispatchDate,
          vehicle_number: vehicleNumber,
          created_by: user.id,
        })
        .select('id')
        .single();

      if (plErr || !pl) throw new Error(`Failed to create packing list: ${plErr?.message}`);
      const plId: string = (pl as any).id;

      // PL line items
      await db.from('pack_packing_list_items').insert(
        (pallets as any[]).map((p, idx) => ({
          packing_list_id: plId,
          pallet_id: p.id,
          item_code: p.item_code,
          item_name: p.items?.item_name ?? p.item_code,
          quantity: p.current_qty ?? 0,
          container_count: p.container_count ?? 0,
          line_number: idx + 1,
        }))
      );

      // Lock pallets READY → LOCKED
      await db.from('pack_pallets')
        .update({ state: 'LOCKED', locked_at: now, packing_list_id: plId })
        .in('id', palletIds)
        .eq('state', 'READY');

      // Pallet state log — batch insert
      await db.from('pack_pallet_state_log').insert(
        palletIds.map((pid) => ({
          pallet_id: pid,
          from_state: 'READY',
          to_state: 'LOCKED',
          trigger_type: 'PALLET_LOCKED',
          metadata: { packing_list_number: plNumber },
          performed_by: user.id,
        }))
      );

      // ══ PHASE 3.5: MPL idempotency guard ═════════════════════════════════════
      const { data: existingMpl } = await db
        .from('master_packing_lists')
        .select('id, mpl_number')
        .eq('packing_list_id', plId)
        .neq('status', 'CANCELLED')
        .limit(1)
        .maybeSingle();

      let mplId: string, mplNumber: string;

      if (existingMpl) {
        mplId = (existingMpl as any).id;
        mplNumber = (existingMpl as any).mpl_number;
      } else {
        // ══ PHASE 4: Create Master Packing List ════════════════════════════════

        // Generate MPL number directly from Postgres sequence — no RPC
        const seq = await nextSequenceValue('mpl_number_seq');
        mplNumber = formatMplNumber(seq);

        // Fetch packing list data header (if exists)
        const { data: plDataRow } = await db
          .from('pack_packing_list_data')
          .select('id')
          .eq('packing_list_id', plId)
          .maybeSingle();
        const plDataId: string | null = (plDataRow as any)?.id ?? null;

        // Insert MPL header (weights = 0, updated after junction rows are built)
        const { data: mplRow, error: mplErr } = await db
          .from('master_packing_lists')
          .insert({
            mpl_number: mplNumber,
            packing_list_id: plId,
            packing_list_data_id: plDataId,
            invoice_number: invoiceNumber,
            po_number: poNumber,
            total_pallets: totalPallets,
            total_containers: totalContainers,
            total_quantity: totalQty,
            total_net_weight_kg: 0,
            total_gross_weight_kg: 0,
            item_code: itemCode,
            item_name: itemName,
            status: 'DRAFT',
            created_by: user.id,
          })
          .select('id')
          .single();

        if (mplErr || !mplRow) throw new Error(`Failed to create MPL: ${mplErr?.message}`);
        mplId = (mplRow as any).id;

        // Fetch packing specs for inner/outer qty
        const specIds = [...new Set((pallets as any[]).map((p: any) => p.packing_spec_id).filter(Boolean))];
        const palletSpecMap: Record<string, string> = Object.fromEntries(
          (pallets as any[]).map((p: any) => [p.id, p.packing_spec_id])
        );

        const [specsRes, plItemsRes] = await Promise.all([
          specIds.length > 0
            ? db.from('packing_specifications').select('id, inner_box_quantity, outer_box_quantity').in('id', specIds)
            : Promise.resolve({ data: [] }),
          db.from('pack_packing_list_items')
            .select('pallet_id, item_code, item_name, quantity, container_count, gross_weight_kg, net_weight_kg, line_number')
            .eq('packing_list_id', plId)
            .order('line_number'),
        ]);

        const specMap: Record<string, any> = Object.fromEntries(
          ((specsRes.data || []) as any[]).map((s: any) => [s.id, s])
        );

        // Pallet weights from pallet_details (if plData exists)
        let weightMap: Record<string, any> = {};
        if (plDataId) {
          const { data: wds } = await db
            .from('pack_packing_list_pallet_details')
            .select('pallet_id, net_weight_kg, gross_weight_kg')
            .eq('packing_list_data_id', plDataId);
          weightMap = Object.fromEntries(((wds || []) as any[]).map((w: any) => [w.pallet_id, w]));
        }

        // Inner box container details per pallet
        const { data: pcRows } = await db
          .from('pack_pallet_containers')
          .select('pallet_id, position_sequence, pack_containers!inner(container_type, is_adjustment, quantity, created_at, packing_box_id, profiles!pack_containers_created_by_fkey(full_name), packing_boxes:packing_box_id(packing_id))')
          .in('pallet_id', palletIds)
          .order('position_sequence');

        const containersByPallet: Record<string, any[]> = {};
        for (const row of (pcRows || []) as any[]) {
          if (!containersByPallet[row.pallet_id]) containersByPallet[row.pallet_id] = [];
          containersByPallet[row.pallet_id].push(row);
        }

        const palletById: Record<string, any> = Object.fromEntries(
          (pallets as any[]).map((p: any) => [p.id, p])
        );

        let totalNet = 0, totalGross = 0;

        const junctionRows = ((plItemsRes.data || []) as any[]).map((plItem: any, idx: number) => {
          const spec = specMap[palletSpecMap[plItem.pallet_id]] ?? {};
          const wd = weightMap[plItem.pallet_id] ?? {};
          const netWt = Number(wd.net_weight_kg ?? 0);
          const grossWt = Number(wd.gross_weight_kg ?? 0);
          totalNet += netWt;
          totalGross += grossWt;

          const innerBoxDetails = (containersByPallet[plItem.pallet_id] ?? []).map((pc: any) => ({
            packing_id: pc.pack_containers?.packing_boxes?.packing_id ?? '—',
            quantity: pc.pack_containers?.quantity ?? 0,
            type: pc.pack_containers?.container_type ?? 'INNER_BOX',
            is_adjustment: pc.pack_containers?.is_adjustment ?? false,
            operator: pc.pack_containers?.profiles?.full_name ?? '—',
            created_at: pc.pack_containers?.created_at,
          }));

          return {
            mpl_id: mplId,
            pallet_id: plItem.pallet_id,
            pallet_number: palletById[plItem.pallet_id]?.pallet_number,
            item_code: plItem.item_code,
            item_name: plItem.item_name,
            quantity: plItem.quantity,
            container_count: plItem.container_count,
            net_weight_kg: netWt,
            gross_weight_kg: grossWt,
            inner_box_details: innerBoxDetails,
            inner_box_qty: spec.inner_box_quantity ?? null,
            contract_outer_qty: spec.outer_box_quantity ?? null,
            line_number: idx + 1,
          };
        });

        await db.from('master_packing_list_pallets').insert(junctionRows);

        // Update MPL aggregate weights now that we have them
        await db.from('master_packing_lists')
          .update({ total_net_weight_kg: totalNet, total_gross_weight_kg: totalGross })
          .eq('id', mplId);
      }

      // ══ PHASE 5: Audit + idempotency success ═════════════════════════════════
      await db.from('dispatch_audit_log').insert({
        entity_type: 'MASTER_PACKING_LIST',
        entity_id: mplId,
        entity_number: mplNumber,
        action: 'CREATED',
        to_status: 'DRAFT',
        performed_by: user.id,
        metadata: {
          packing_list_id: plId,
          packing_list_number: body.pl_number ?? null,
          total_pallets: totalPallets,
          total_quantity: totalQty,
          workflow: 'dispatch_selection_generate',
        },
      });

      const result = {
        success: true,
        pl_id: plId,
        mpl_id: mplId,
        mpl_number: mplNumber,
        total_pallets: totalPallets,
        total_containers: totalContainers,
        total_quantity: totalQty,
      };

      await db.from('idempotency_keys')
        .update({ status: 'SUCCESS', completed_at: now, entity_id: mplId, result_data: result })
        .eq('idempotency_key', idempotencyKey)
        .eq('operation_type', 'CREATE_DISPATCH_PL');

      return j({ success: true, data: result });

    } catch (innerErr: any) {
      await db.from('idempotency_keys')
        .update({ status: 'FAILED', completed_at: new Date().toISOString(), error_message: innerErr?.message })
        .eq('idempotency_key', idempotencyKey)
        .eq('operation_type', 'CREATE_DISPATCH_PL');
      throw innerErr;
    }

    });
  } catch (err: any) {
    console.error('[dis_selection_create_packing_list]', err?.message ?? err);
    return j({ error: err?.message || 'Internal server error' }, 500);
  }
});
