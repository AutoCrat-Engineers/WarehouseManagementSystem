/**
 * sg_get-detail — Edge Function
 *
 * Server-side consolidation of the Sticker Generation DETAIL page load
 * (PackingDetail.tsx loadData). Replaces 5 sequential / partly-parallel
 * browser→DB calls with ONE edge-function call.
 *
 * WHAT IT REPLACES (client-side):
 *   - PackingDetail.tsx loadData()
 *       SELECT packing_requests (single)
 *       SELECT items
 *       SELECT profiles (created_by, approved_by)
 *       svc.fetchBoxesForRequest() → SELECT packing_boxes + SELECT profiles
 *       svc.fetchAuditLogs()       → SELECT packing_audit_logs + SELECT profiles
 *
 * BUSINESS LOGIC IS UNCHANGED. Enrichment maps (packing_id, created_by_name,
 * approved_by_name, performed_by_name) are 1:1 ports of the client helpers.
 * The only optimisation is collapsing the separate profile lookups (for
 * request / box / audit author names) into a single IN() query.
 *
 * No RPC is used — pure direct table operations via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders } from '../_shared/cors.ts';
import { generatePackingId } from '../_shared/packingUtils.ts';

interface GetDetailBody {
  request_id: string;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── AUTH ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, Deno.env.get('PUBLISHABLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── BODY ──────────────────────────────────────────────────────────
    const body: GetDetailBody = await req.json().catch(() => ({} as any));
    const requestId = body.request_id;
    if (!requestId) return json({ error: 'request_id is required' }, 400);

    // ── PHASE 1: Fetch the request row (needed to derive item_code + author IDs) ──
    const { data: reqData, error: reqErr } = await db
      .from('packing_requests')
      .select('*')
      .eq('id', requestId)
      .single();
    if (reqErr || !reqData) return json({ error: 'Packing request not found' }, 404);

    // ── PHASE 2: Parallel fetch — item, boxes, audit logs ──────────────
    const [itemResult, boxesResult, auditResult] = await Promise.all([
      db.from('items')
        .select('item_name, part_number, master_serial_no, revision')
        .eq('item_code', (reqData as any).item_code)
        .single(),
      db.from('packing_boxes')
        .select('*')
        .eq('packing_request_id', requestId)
        .order('box_number', { ascending: true }),
      db.from('packing_audit_logs')
        .select('*')
        .eq('packing_request_id', requestId)
        .order('created_at', { ascending: true }),
    ]);

    const boxes = (boxesResult.data || []) as any[];
    const auditLogs = (auditResult.data || []) as any[];
    const itemData = (itemResult.data as any) || null;

    // ── PHASE 3: Single profile lookup covering every author we need ──
    // Union of: request.created_by, request.approved_by, box.created_by (per box),
    // log.performed_by (per log) — deduplicated.
    const req_ = reqData as any;
    const userIdSet = new Set<string>();
    if (req_.created_by) userIdSet.add(req_.created_by);
    if (req_.approved_by) userIdSet.add(req_.approved_by);
    for (const b of boxes) if (b.created_by) userIdSet.add(b.created_by);
    for (const l of auditLogs) if (l.performed_by) userIdSet.add(l.performed_by);

    const nameMap: Record<string, string> = {};
    if (userIdSet.size > 0) {
      const { data: profiles } = await db
        .from('profiles')
        .select('id, full_name')
        .in('id', Array.from(userIdSet));
      ((profiles || []) as any[]).forEach((p: any) => {
        nameMap[p.id] = p.full_name;
      });
    }

    // ── ENRICHMENT ────────────────────────────────────────────────────
    const enrichedRequest = {
      ...req_,
      item_name: itemData?.item_name || req_.item_code,
      part_number: itemData?.part_number || null,
      master_serial_no: itemData?.master_serial_no || null,
      revision: itemData?.revision || null,
      created_by_name: nameMap[req_.created_by] || undefined,
      approved_by_name: req_.approved_by ? nameMap[req_.approved_by] : undefined,
    };

    const enrichedBoxes = boxes.map((b: any) => ({
      ...b,
      packing_id: b.packing_id || generatePackingId(b.id),
      is_transferred: b.is_transferred || false,
      transferred_at: b.transferred_at || null,
      created_by_name: nameMap[b.created_by] || undefined,
    }));

    const enrichedAudit = auditLogs.map((l: any) => ({
      ...l,
      performed_by_name: nameMap[l.performed_by] || undefined,
    }));

    return json({
      success: true,
      request: enrichedRequest,
      boxes: enrichedBoxes,
      audit_logs: enrichedAudit,
    });
  } catch (err: any) {
    console.error('[sg_get-detail] Error:', err);
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
