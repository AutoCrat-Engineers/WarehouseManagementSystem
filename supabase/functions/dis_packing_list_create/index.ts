import { getCorsHeaders } from '../_shared/cors.ts';
import { requireActiveSession, withTransactionLock } from '../_shared/session.ts';
import { nextSequenceValue, formatMplNumber } from '../_shared/seq.ts';

Deno.serve(async (req) => {
  const cors = getCorsHeaders(req.headers.get('origin') ?? '');
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });

  try {
    const session = await requireActiveSession(req);
    if (!session.ok) return session.response;
    const ctx = session.ctx;
    const user = { id: ctx.userId };
    const db = ctx.db;
    const body = await req.json().catch(() => ({}));

    return await withTransactionLock(ctx, {
      key:   `creating_master_packing_list:${ctx.sessionId}`,
      label: 'Creating Master Packing List',
    }, async () => {

    // Validate required fields
    if (!body.packing_list_id) {
      return new Response(JSON.stringify({ error: 'packing_list_id is required' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // 1. Idempotency check
    const { data: existing } = await db
      .from('master_packing_lists')
      .select('*')
      .eq('packing_list_id', body.packing_list_id)
      .neq('status', 'CANCELLED')
      .limit(1);

    if (existing && existing.length > 0) {
      return new Response(JSON.stringify({ success: true, data: existing[0], already_exists: true }), {
        status: 200,
        headers: { ...cors, 'Content-Type': 'application/json' },
      });
    }

    // 2. Generate MPL number via sequence
    const seq = await nextSequenceValue('mpl_number_seq');
    const mplNumber = formatMplNumber(seq);

    // 3. Fetch packing list
    const { data: pl } = await db
      .from('pack_packing_lists')
      .select('*')
      .eq('id', body.packing_list_id)
      .single();

    // 4. Fetch packing list data
    const { data: plData } = await db
      .from('pack_packing_list_data')
      .select('*')
      .eq('packing_list_id', body.packing_list_id)
      .single();

    // 5. Fetch PL items
    const { data: plItems } = await db
      .from('pack_packing_list_items')
      .select('pallet_id, item_code, item_name, quantity, container_count, gross_weight_kg, net_weight_kg, line_number')
      .eq('packing_list_id', body.packing_list_id)
      .order('line_number');

    // 6. For each pallet, fetch containers + spec + weight details in parallel
    const palletIds = (plItems || []).map((i: any) => i.pallet_id);

    const [containersResult, palletsResult] = await Promise.all([
      db
        .from('pack_pallet_containers')
        .select(
          'pallet_id, position_sequence, pack_containers!inner (container_number, quantity, container_type, is_adjustment, created_at, packing_box_id, profiles!pack_containers_created_by_fkey (full_name), packing_boxes:packing_box_id (packing_id))',
        )
        .in('pallet_id', palletIds)
        .order('position_sequence'),
      db
        .from('pack_pallets')
        .select('packing_spec_id, item_code')
        .in('id', palletIds),
    ]);

    const specIds = [
      ...new Set(
        ((palletsResult.data || []) as any[])
          .map((p: any) => p.packing_spec_id)
          .filter(Boolean),
      ),
    ];

    const [specsResult, palletWeightsResult] = await Promise.all([
      specIds.length > 0
        ? db
            .from('packing_specifications')
            .select('id, inner_box_quantity, outer_box_quantity')
            .in('id', specIds)
        : Promise.resolve({ data: [] }),
      plData
        ? db
            .from('pack_packing_list_pallet_details')
            .select('net_weight_kg, gross_weight_kg, pallet_id')
            .eq('packing_list_data_id', (plData as any).id)
        : Promise.resolve({ data: [] }),
    ]);

    const specMap = Object.fromEntries(
      ((specsResult.data || []) as any[]).map((s: any) => [s.id, s]),
    );
    const weightMap = Object.fromEntries(
      ((palletWeightsResult.data || []) as any[]).map((w: any) => [w.pallet_id, w]),
    );
    const palletSpecMap = Object.fromEntries(
      ((palletsResult.data || []) as any[]).map((p: any) => [p.item_code, p.packing_spec_id]),
    );

    // 7. Lock pallets (READY → LOCKED)
    const now = new Date().toISOString();
    for (const palletId of palletIds) {
      await db
        .from('pack_pallets')
        .update({ state: 'LOCKED', locked_at: now, updated_at: now, updated_by: user.id })
        .eq('id', palletId)
        .in('state', ['READY', 'LOCKED']);

      await db.from('pack_pallet_state_log').insert({
        pallet_id: palletId,
        from_state: 'READY',
        to_state: 'LOCKED',
        trigger_type: 'MPL_CREATE',
        performed_by: user.id,
        metadata: { mpl_number: mplNumber, packing_list_id: body.packing_list_id },
      });
    }

    // 8. Fetch pallet numbers
    const { data: palletNumbers } = await db
      .from('pack_pallets')
      .select('id, pallet_number')
      .in('id', palletIds);

    const palletNumberMap = Object.fromEntries(
      ((palletNumbers || []) as any[]).map((p: any) => [p.id, p.pallet_number]),
    );

    // 9. Build MPL payload and create
    const containersByPallet: Record<string, any[]> = {};
    for (const c of (containersResult.data || []) as any[]) {
      if (!containersByPallet[c.pallet_id]) containersByPallet[c.pallet_id] = [];
      containersByPallet[c.pallet_id].push(c);
    }

    const palletLines = ((plItems || []) as any[]).map((plItem: any, idx: number) => {
      const containers = containersByPallet[plItem.pallet_id] || [];
      const spec = specMap[palletSpecMap[plItem.item_code]] || {};
      const weights = weightMap[plItem.pallet_id] || {};
      return {
        line_number: plItem.line_number || idx + 1,
        pallet_id: plItem.pallet_id,
        pallet_number: palletNumberMap[plItem.pallet_id],
        item_code: plItem.item_code,
        item_name: plItem.item_name,
        quantity: plItem.quantity,
        container_count: plItem.container_count,
        gross_weight_kg: weights.gross_weight_kg || null,
        net_weight_kg: weights.net_weight_kg || null,
        inner_box_quantity: spec.inner_box_quantity || null,
        outer_box_quantity: spec.outer_box_quantity || null,
        containers: containers.map((c: any) => c.pack_containers).filter(Boolean),
      };
    });

    const mplPayload = {
      mpl_number: mplNumber,
      packing_list_id: body.packing_list_id,
      status: 'DRAFT',
      customer_name: body.customer_name,
      customer_code: body.customer_code,
      po_number: body.po_number,
      invoice_number: body.invoice_number,
      invoice_date: body.invoice_date,
      ship_via: body.ship_via,
      mode_of_transport: body.mode_of_transport,
      item_code: body.item_code,
      total_pallets: palletIds.length,
      total_quantity: ((plItems || []) as any[]).reduce((s: number, i: any) => s + (i.quantity || 0), 0),
      total_containers: ((plItems || []) as any[]).reduce((s: number, i: any) => s + (i.container_count || 0), 0),
      pallet_lines: palletLines,
      created_by: user.id,
    };

    const { data: mpl, error: mplErr } = await db
      .from('master_packing_lists')
      .insert(mplPayload)
      .select()
      .single();

    if (mplErr) throw mplErr;

    // 10. Create junction records
    const junctionRows = palletIds.map((pid: string, idx: number) => ({
      mpl_id: (mpl as any).id,
      pallet_id: pid,
      line_number: idx + 1,
      status: 'ACTIVE',
    }));
    await db.from('master_packing_list_pallets').insert(junctionRows);

    // 11. Audit log
    await db.from('dispatch_audit_log').insert({
      entity_type: 'MASTER_PACKING_LIST',
      entity_id: (mpl as any).id,
      entity_number: mplNumber,
      action: 'CREATE',
      to_status: 'DRAFT',
      performed_by: user.id,
      correlation_id: body.correlation_id || null,
      metadata: { packing_list_id: body.packing_list_id, pallet_count: palletIds.length },
    });

    return new Response(JSON.stringify({ success: true, data: mpl }), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }
});
