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

    return await withTransactionLock(ctx, {
      key:   `marking_packing_list_printed:${body.mpl_id ?? 'unknown'}`,
      label: 'Marking Packing List Printed',
    }, async () => {

    if (!body.mpl_id) return j({ error: 'mpl_id is required' }, 400);

    const now = new Date().toISOString();

    // ── Fetch MPL ──────────────────────────────────────────────────────────────
    const { data: mpl, error: mplErr } = await db
      .from('master_packing_lists')
      .select('id, mpl_number, status, print_count')
      .eq('id', body.mpl_id)
      .single();

    if (mplErr || !mpl) return j({ error: 'MPL not found' }, 404);

    if (!['CONFIRMED', 'PRINTED', 'DISPATCHED'].includes((mpl as any).status)) {
      return j({ error: `Cannot print MPL in ${(mpl as any).status} status` }, 422);
    }

    // Determine new status: CONFIRMED/PRINTED → PRINTED; DISPATCHED stays DISPATCHED
    const newStatus = ['CONFIRMED', 'PRINTED'].includes((mpl as any).status) ? 'PRINTED' : (mpl as any).status;
    const newPrintCount = ((mpl as any).print_count ?? 0) + 1;

    // ── Atomic increment update ────────────────────────────────────────────────
    await db.from('master_packing_lists').update({
      status: newStatus,
      printed_at: now,
      printed_by: user.id,
      print_count: newPrintCount,
    }).eq('id', body.mpl_id);

    // ── Audit log ──────────────────────────────────────────────────────────────
    await db.from('dispatch_audit_log').insert({
      entity_type: 'MASTER_PACKING_LIST',
      entity_id: body.mpl_id,
      entity_number: (mpl as any).mpl_number,
      action: 'PRINTED',
      from_status: (mpl as any).status,
      to_status: newStatus,
      performed_by: user.id,
      metadata: { print_count: newPrintCount },
    });

    const result = { success: true, mpl_number: (mpl as any).mpl_number, print_count: newPrintCount, status: newStatus };
    return j({ success: true, data: result });

    });
  } catch (err: any) {
    console.error('[dis_packing_list_mark_printed]', err?.message ?? err);
    return j({ error: err?.message || 'Internal server error' }, 500);
  }
});
