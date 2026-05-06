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
    if (!body.pi_id || typeof body.pi_id !== 'string' || !body.pi_id.trim())
      return j({ error: 'pi_id is required' }, 400);
    if (!body.reason || typeof body.reason !== 'string' || !body.reason.trim())
      return j({ error: 'reason is required and must be a non-empty string' }, 400);

    const piId: string = body.pi_id;
    const reason: string = body.reason;
    const now = new Date().toISOString();

    return await withTransactionLock(ctx, {
      key:   `dis_proforma_inv_cancel:${piId}`,
      label: 'Cancelling Proforma Invoice',
    }, async () => {

    // ── Fetch PI and validate ──────────────────────────────────────────────────
    const { data: pi, error: piFetchErr } = await db
      .from('pack_proforma_invoices')
      .select('id, proforma_number, status')
      .eq('id', piId)
      .single();

    if (piFetchErr || !pi) return j({ error: 'Proforma Invoice not found' }, 404);
    if ((pi as any).status !== 'DRAFT')
      return j({ error: `Only DRAFT PIs can be cancelled (current: ${(pi as any).status})` }, 422);

    // ── Snapshot: fetch pi_mpls for snapshot enrichment ────────────────────────
    const { data: piMpls, error: piMplsErr } = await db
      .from('proforma_invoice_mpls')
      .select('*')
      .eq('proforma_id', piId)
      .order('line_number');

    if (!piMplsErr && piMpls && (piMpls as any[]).length > 0) {
      const mplIds = (piMpls as any[]).map((p: any) => p.mpl_id);

      const { data: mpls } = await db
        .from('master_packing_lists')
        .select('*')
        .in('id', mplIds);

      const mplMap: Record<string, any> = Object.fromEntries(
        ((mpls || []) as any[]).map((m: any) => [m.id, m])
      );

      const itemCodes = [...new Set(((mpls || []) as any[]).map((m: any) => m.item_code).filter(Boolean))];
      let itemMap: Record<string, any> = {};
      if (itemCodes.length > 0) {
        const { data: items } = await db
          .from('items')
          .select('part_number, master_serial_no')
          .in('part_number', itemCodes);
        itemMap = Object.fromEntries(((items || []) as any[]).map((i: any) => [i.part_number, i]));
      }

      const snapshots = (piMpls as any[]).map((pm: any, idx: number) => {
        const mpl = mplMap[pm.mpl_id] || {};
        const item = itemMap[mpl.item_code] || {};
        return {
          proforma_id: piId,
          mpl_id: pm.mpl_id,
          line_number: pm.line_number || idx + 1,
          mpl_number: mpl.mpl_number,
          item_code: mpl.item_code,
          master_serial_no: item.master_serial_no,
          part_number: item.part_number,
          total_pallets: mpl.total_pallets,
          total_quantity: mpl.total_quantity,
          snapshot_data: pm,
        };
      });

      // Non-fatal — snapshot failure must not block cancellation
      const { error: snapshotErr } = await db
        .from('proforma_invoice_mpl_snapshots')
        .insert(snapshots);
      if (snapshotErr) console.error('[dis_proforma_inv_cancel] snapshot insert error:', snapshotErr);
    }

    // ── Collect linked MPLs ────────────────────────────────────────────────────
    const { data: linkedMpls } = await db
      .from('proforma_invoice_mpls')
      .select('mpl_id, mpl_number')
      .eq('proforma_id', piId);

    const mplIds = ((linkedMpls || []) as any[]).map((m: any) => m.mpl_id);
    const mplNumbers = ((linkedMpls || []) as any[]).map((m: any) => m.mpl_number);

    // ── Unlink MPLs ────────────────────────────────────────────────────────────
    if (mplIds.length > 0) {
      await db.from('master_packing_lists')
        .update({ proforma_invoice_id: null })
        .in('id', mplIds);
    }

    // ── Delete junction rows ───────────────────────────────────────────────────
    await db.from('proforma_invoice_mpls').delete().eq('proforma_id', piId);

    // ── Cancel PI ─────────────────────────────────────────────────────────────
    await db.from('pack_proforma_invoices').update({
      status: 'CANCELLED',
      cancelled_at: now,
    }).eq('id', piId);

    // ── Audit log ─────────────────────────────────────────────────────────────
    await db.from('dispatch_audit_log').insert({
      entity_type: 'PROFORMA_INVOICE',
      entity_id: piId,
      entity_number: (pi as any).proforma_number,
      action: 'CANCELLED',
      from_status: (pi as any).status,
      to_status: 'CANCELLED',
      performed_by: user.id,
      metadata: {
        reason,
        unlinked_mpls: mplNumbers,
      },
    });

    return j({ success: true, data: { success: true, proforma_number: (pi as any).proforma_number } });
    });

  } catch (err: any) {
    console.error('[dis_proforma_inv_cancel]', err?.message ?? err);
    return j({ error: err?.message || 'Internal server error' }, 500);
  }
});
