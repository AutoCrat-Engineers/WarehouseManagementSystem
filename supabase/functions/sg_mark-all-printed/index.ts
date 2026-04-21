/**
 * sg_mark-all-printed — Edge Function
 *
 * Migrates the post-print "mark all stickers printed" loop from the browser
 * to the server.
 *
 * WHY: The original client-side code looped over every printed box and called
 * `markStickerPrinted(requestId, boxId)` sequentially. For 50 boxes that is
 * ~100 serial DB round trips from the browser (~15 seconds of latency after
 * the print dialog closes). The server-side equivalent collapses this into
 * ONE batch UPDATE + ONE audit INSERT.
 *
 * BUSINESS LOGIC IS UNCHANGED. The UPDATE payload, audit-log action type,
 * audit-log metadata shape, and idempotency semantics are all ports of
 * `markAllStickersPrinted()` from src/components/packing/packingService.ts.
 *
 * Optimisations (zero-semantic-change):
 *   1) packing_id is deterministic from the box UUID (generatePackingId),
 *      so we skip the pre-UPDATE SELECT on packing_boxes.
 *   2) profile fetch runs in parallel with the UPDATE + audit INSERT
 *      (the audit log INSERT waits on role; UPDATE does not, so the two
 *      overlap).
 *   Net: auth call + one parallel DB round-trip, down from 4 serial trips.
 *
 * No RPC is used — pure direct table operations via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders } from '../_shared/cors.ts';
import { generatePackingId } from '../_shared/packingUtils.ts';

// ── Request body shape ──
interface MarkAllPrintedBody {
  packing_request_id: string;
  box_ids: string[];
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── AUTH ──────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, Deno.env.get('PUBLISHABLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = user.id;

    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── PARSE & VALIDATE BODY ─────────────────────────────────────────────
    const body: MarkAllPrintedBody = await req.json();
    const { packing_request_id: requestId, box_ids: boxIds } = body;

    if (!requestId) {
      return new Response(JSON.stringify({ error: 'packing_request_id is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!Array.isArray(boxIds) || boxIds.length === 0) {
      return new Response(JSON.stringify({ error: 'box_ids must be a non-empty array' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toISOString();
    // packing_id is a pure function of the UUID — no DB lookup required.
    const packingIds = boxIds.map((id) => generatePackingId(id));

    // ── Parallel: UPDATE boxes + profile fetch ─────────────────────────
    // The UPDATE is independent of role so it overlaps with the profile
    // lookup. The audit-log INSERT needs role and waits for profile.
    // UPDATE is scoped by BOTH request id AND box ids — prevents a caller
    // from marking boxes that don't belong to the claimed request.
    // .select('id') returns the affected rows in the same round-trip so we
    // can report the true marked count without a follow-up SELECT.
    const [updateResult, profileResult] = await Promise.all([
      db.from('packing_boxes')
        .update({ sticker_printed: true, sticker_printed_at: now })
        .eq('packing_request_id', requestId)
        .in('id', boxIds)
        .select('id'),
      db.from('profiles').select('role').eq('id', userId).single(),
    ]);

    if (updateResult.error) throw updateResult.error;
    const role: string = (profileResult.data as any)?.role || 'L1';

    // ── Audit log INSERT (needs role) ───────────────────────────────────
    const { error: auditErr } = await db.from('packing_audit_logs').insert({
      packing_request_id: requestId,
      action_type: 'STICKER_PRINTED',
      performed_by: userId,
      role,
      metadata: {
        batch_print: true,
        boxes_printed: boxIds.length,
        packing_ids: packingIds.join(', '),
      },
    });
    if (auditErr) throw auditErr;

    const actuallyMarked = (updateResult.data as any[] | null)?.length ?? 0;

    return new Response(
      JSON.stringify({
        success: true,
        boxes_marked: actuallyMarked,
        packing_ids: packingIds,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[sg_mark-all-printed] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

if (import.meta.main) Deno.serve(handler);
