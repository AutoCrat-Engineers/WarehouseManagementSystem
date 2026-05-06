/**
 * sg_mark-printed — Edge Function
 *
 * Server-side migration of the individual-row "Print Sticker" button.
 * Replaces the direct browser→DB writes that previously ran from
 * packingService.markStickerPrinted().
 *
 * WHAT IT REPLACES (client-side):
 *   - packingService.markStickerPrinted(requestId, boxId)
 *       SELECT packing_boxes (for audit metadata)
 *       UPDATE packing_boxes (sticker_printed / sticker_printed_at)
 *       SELECT profiles.role (via getAuthContext)
 *       INSERT packing_audit_logs (STICKER_PRINTED)
 *
 * BUSINESS LOGIC IS UNCHANGED. Same UPDATE scope (eq id AND eq request),
 * same audit action + metadata shape, same generatePackingId() fallback.
 *
 * No RPC is used — pure direct table operations via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders } from '../_shared/cors.ts';
import { requireActiveSession, withTransactionLock } from '../_shared/session.ts';
import { generatePackingId } from '../_shared/packingUtils.ts';

interface MarkPrintedBody {
  packing_request_id: string;
  box_id: string;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── AUTH ──────────────────────────────────────────────────────────
    const session = await requireActiveSession(req);
    if (!session.ok) return session.response;
    const ctx = session.ctx;
    const supabaseClient = ctx.db;
    const user = { id: ctx.userId };
    const userId = ctx.userId;

    const db = ctx.db;

    // ── BODY ──────────────────────────────────────────────────────────
    const body: MarkPrintedBody = await req.json().catch(() => ({} as any));

    return await withTransactionLock(ctx, {
      key:   `marking_sticker_printed:${ctx.sessionId}`,
      label: 'Marking Sticker Printed',
    }, async () => {
    const { packing_request_id: requestId, box_id: boxId } = body;
    if (!requestId) return json({ error: 'packing_request_id is required' }, 400);
    if (!boxId) return json({ error: 'box_id is required' }, 400);

    const now = new Date().toISOString();

    // ── Parallel: fetch box (audit metadata) + UPDATE sticker + profile role ──
    // The UPDATE is independent of the SELECT result, so they overlap.
    // profile fetch resolves the role needed for the audit INSERT.
    const [boxResult, updateResult, profileResult] = await Promise.all([
      db.from('packing_boxes')
        .select('box_number, box_qty, packing_id')
        .eq('id', boxId)
        .single(),
      db.from('packing_boxes')
        .update({ sticker_printed: true, sticker_printed_at: now })
        .eq('id', boxId)
        .eq('packing_request_id', requestId),
      db.from('profiles').select('role').eq('id', userId).single(),
    ]);

    if (updateResult.error) throw updateResult.error;

    const role: string = (profileResult.data as any)?.role || 'L1';
    const box = (boxResult.data as any) || null;
    const packingId: string = box?.packing_id || generatePackingId(boxId);

    const { error: auditErr } = await db.from('packing_audit_logs').insert({
      packing_request_id: requestId,
      action_type: 'STICKER_PRINTED',
      performed_by: userId,
      role,
      metadata: {
        box_number: box?.box_number ?? '—',
        qty: box?.box_qty ?? '—',
        packing_id: packingId,
      },
    });
    if (auditErr) throw auditErr;

    return json({ success: true, packing_id: packingId });
    });
  } catch (err: any) {
    console.error('[sg_mark-printed] Error:', err);
    return json({ error: err.message || 'Internal server error' }, 500);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

if (import.meta.main) Deno.serve(handler);
