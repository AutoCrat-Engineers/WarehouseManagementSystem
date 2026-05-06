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
    const reason: string = body.reason || 'No reason provided';
    const now = new Date().toISOString();

    return await withTransactionLock(ctx, {
      key:   `dis_packing_list_cancel:${mplId}`,
      label: 'Cancelling Master Packing List',
    }, async () => {

    // ── Fetch and validate MPL ─────────────────────────────────────────────────
    const { data: mpl, error: mplErr } = await db
      .from('master_packing_lists')
      .select('id, mpl_number, status, proforma_invoice_id')
      .eq('id', mplId)
      .single();

    if (mplErr || !mpl) return j({ error: 'MPL not found' }, 404);

    if (!['DRAFT', 'CONFIRMED', 'PRINTED'].includes((mpl as any).status)) {
      return j({ error: `Cannot cancel MPL in ${(mpl as any).status} status` }, 422);
    }

    // ── Guard: linked PI must be CANCELLED ────────────────────────────────────
    if ((mpl as any).proforma_invoice_id) {
      const { data: pi } = await db
        .from('pack_proforma_invoices')
        .select('id, proforma_number, status')
        .eq('id', (mpl as any).proforma_invoice_id)
        .single();

      if (pi && (pi as any).status !== 'CANCELLED') {
        return j({
          error: `MPL is linked to active Proforma Invoice ${(pi as any).proforma_number}. Cancel the PI first.`,
        }, 422);
      }
    }

    // ── Fetch locked pallets via junction table ────────────────────────────────
    const { data: mplPallets } = await db
      .from('master_packing_list_pallets')
      .select('pallet_id, pack_pallets!master_packing_list_pallets_pallet_id_fkey(id, pallet_number, state)')
      .eq('mpl_id', mplId);

    const lockedPallets = ((mplPallets || []) as any[]).filter(
      (mp: any) => mp.pack_pallets?.state === 'LOCKED'
    );

    // ── Release each LOCKED pallet → READY ────────────────────────────────────
    for (const mp of lockedPallets) {
      const palletId = mp.pallet_id;

      await db.from('pack_pallets').update({
        state: 'READY',
        locked_at: null,
        packing_list_id: null,
      }).eq('id', palletId);

      await db.from('pack_pallet_state_log').insert({
        pallet_id: palletId,
        from_state: 'LOCKED',
        to_state: 'READY',
        trigger_type: 'CANCELLED',
        metadata: {
          mpl_number: (mpl as any).mpl_number,
          reason,
          source: 'cancel_mpl',
        },
        performed_by: user.id,
      });
    }

    // ── Cancel MPL ────────────────────────────────────────────────────────────
    await db.from('master_packing_lists').update({
      status: 'CANCELLED',
      cancelled_at: now,
      cancelled_by: user.id,
      cancellation_reason: reason,
    }).eq('id', mplId);

    // ── Audit log ─────────────────────────────────────────────────────────────
    await db.from('dispatch_audit_log').insert({
      entity_type: 'MASTER_PACKING_LIST',
      entity_id: mplId,
      entity_number: (mpl as any).mpl_number,
      action: 'CANCELLED',
      from_status: (mpl as any).status,
      to_status: 'CANCELLED',
      performed_by: user.id,
      metadata: {
        reason,
        pallets_released: lockedPallets.length,
      },
    });

    return j({
      success: true,
      data: { success: true, mpl_number: (mpl as any).mpl_number, status: 'CANCELLED' },
    });
    });

  } catch (err: any) {
    console.error('[dis_packing_list_cancel]', err?.message ?? err);
    return j({ error: err?.message || 'Internal server error' }, 500);
  }
});
