/**
 * submit-movement-request — Edge Function
 *
 * Handles Parts A, B, C, D of handleSubmitRequest:
 *   A) Warehouse ID resolution (server-side, UUIDs never sent to browser)
 *   B) Movement header INSERT (status PENDING_APPROVAL hard-coded, movement number server-generated)
 *   C) Movement line INSERT (atomic with header — no orphaned headers)
 *   D) Supervisor notification (blocking — failure is surfaced to caller)
 *
 * Business logic is UNCHANGED from the client-side original.
 * No RPC used — pure direct table operations via service role client.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { calculatePalletImpactInternal } from '../_shared/palletImpact.ts';

// ── Warehouse code → LocationCode mapping (mirrors DB_CODE_MAP in StockMovement.tsx) ──
const DB_CODE_MAP: Record<string, string> = {
  'WH-PROD-FLOOR': 'PW',
  'WH-INTRANSIT': 'IT',
  'WH-US-TRANSIT': 'US',
};

// Location codes that have internal warehouses in the DB
const INTERNAL_LOCATIONS = new Set(['PW', 'IT', 'US', 'PF']);

// ── Request body shape ──
interface SubmitRequestBody {
  itemCode: string;
  movementType: string;
  fromLocation: string;        // LocationCode or external entity ('PRODUCTION', 'CUSTOMER')
  toLocation: string;
  finalQty: number;
  boxCount?: number;           // PRODUCTION_RECEIPT only — server re-derives finalQty from this
  innerBoxQty?: number;        // PRODUCTION_RECEIPT only — PCS per box, used to build notes string
  stockType: string;
  reasonCode: string;
  note: string;                // raw user note (Issue 3 — was pre-formatted reasonDescription on client)
  routeLabel: string;          // route label for notes format, e.g. "Production → FG Warehouse"
  referenceType: string;       // REQUIRED — not nullable
  referenceDocNumber: string;  // REQUIRED — not nullable (effective id, prefix already stripped)
}

export async function handler(req: Request): Promise<Response> {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── AUTH ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // User client — used only to validate the JWT and extract userId
    const userClient = createClient(supabaseUrl, Deno.env.get('PUBLISHABLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const userId = user.id;

    // Service role client — bypasses RLS for all DB writes
    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── PARSE & VALIDATE BODY ─────────────────────────────────────────────────
    const body: SubmitRequestBody = await req.json();
    const {
      itemCode, movementType, fromLocation, toLocation,
      stockType, reasonCode, note, routeLabel, innerBoxQty,
      referenceType, referenceDocNumber,
    } = body;
    let { finalQty, boxCount } = body;

    if (!itemCode || !movementType || !fromLocation || !toLocation) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── SERVER-SIDE PALLET IMPACT: Derive finalQty for PRODUCTION_RECEIPT ────
    // Client sends boxCount; server recomputes finalQty using the same pallet
    // algorithm — ignores client's finalQty for this movement type to prevent
    // tampered quantities from reaching the database.
    const isProductionReceipt = movementType === 'PRODUCTION_RECEIPT';
    let impact: Awaited<ReturnType<typeof calculatePalletImpactInternal>> | null = null;
    if (isProductionReceipt && boxCount && boxCount > 0) {
      impact = await calculatePalletImpactInternal(db, itemCode, boxCount);
      finalQty = impact.adjustedTotalQty;
    }

    // ── ISSUE 3 MIGRATION: Build reasonDescription + notes server-side ────────
    // Previously built in StockMovement.tsx handleSubmitRequest lines 729-737.
    // Logic is UNCHANGED — same format strings, same conditions.
    const pluralBoxes = (impact?.totalAdjustmentBoxes || 1) > 1 ? 'es' : '';
    const reasonDescription = (isProductionReceipt && impact?.adjustmentBoxIncluded)
      ? `${note.trim()} [Top-off: ${impact.totalAdjustmentBoxes || 1} Box of ${impact.adjustmentBoxQty} PCS]`
      : note.trim();
    const notesStr = isProductionReceipt
      ? (impact?.adjustmentBoxIncluded
        ? `${routeLabel} | Boxes: ${impact.adjustedInnerBoxCount} x ${innerBoxQty || 0} PCS/box + ${impact.totalAdjustmentBoxes || 1} Top-off Box${pluralBoxes} x ${impact.adjustmentBoxQty} PCS = ${finalQty} PCS | Stock Type: ${stockType}`
        : `${routeLabel} | Boxes: ${boxCount} x ${innerBoxQty || 0} PCS/box = ${finalQty} PCS | Stock Type: ${stockType}`)
      : `${routeLabel} | Requested Qty: ${finalQty} | Stock Type: ${stockType}`;
    // ── END ISSUE 3 ───────────────────────────────────────────────────────────

    if (!finalQty || finalQty <= 0) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // referenceType and referenceDocNumber are required — not nullable
    if (!referenceType) {
      return new Response(JSON.stringify({ error: 'Reference Type is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!referenceDocNumber) {
      return new Response(JSON.stringify({ error: 'Reference ID is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── PART A: Warehouse ID Resolution ──────────────────────────────────────
    const { data: warehouses, error: whErr } = await db
      .from('inv_warehouses')
      .select('id, warehouse_code')
      .eq('is_active', true);
    if (whErr) throw whErr;

    const getWhId = (locationCode: string): string | null => {
      const dbCode = Object.entries(DB_CODE_MAP).find(([, v]) => v === locationCode)?.[0];
      return (warehouses as any[])?.find(w => w.warehouse_code === dbCode)?.id || null;
    };

    const srcIsInternal = INTERNAL_LOCATIONS.has(fromLocation);
    const dstIsInternal = INTERNAL_LOCATIONS.has(toLocation);
    const srcId = srcIsInternal ? getWhId(fromLocation) : null;
    const dstId = dstIsInternal ? getWhId(toLocation) : null;

    // DB constraint requires both warehouse IDs to be non-null.
    // For external entities (PRODUCTION, CUSTOMER), use the internal warehouse for both.
    const finalSrcId = srcId || dstId;
    const finalDstId = dstId || srcId;

    // ── ISSUE 5 MIGRATION: Stock availability check at request time ───────────
    // Previously checked client-side using stale warehouseStocks state (lines 707-725).
    // Now uses live DB data at the moment of submission.
    // Logic is UNCHANGED — same external source exclusions, same thresholds.
    const externalSourceTypes = ['PRODUCTION_RECEIPT', 'CUSTOMER_RETURN'];
    if (!externalSourceTypes.includes(movementType) && srcIsInternal && srcId) {
      const { data: stockRecord } = await db
        .from('inv_warehouse_stock')
        .select('quantity_on_hand')
        .eq('warehouse_id', srcId)
        .eq('item_code', itemCode)
        .eq('is_active', true)
        .single();
      const availableQty: number = stockRecord?.quantity_on_hand || 0;
      if (availableQty <= 0) {
        return new Response(JSON.stringify({
          error: `Cannot request movement — source warehouse has 0 stock for this item.`,
          code: 'INSUFFICIENT_STOCK_AT_REQUEST',
          available: 0,
        }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      if (finalQty > availableQty) {
        return new Response(JSON.stringify({
          error: `Requested quantity (${finalQty}) exceeds available stock (${availableQty}).`,
          code: 'INSUFFICIENT_STOCK_AT_REQUEST',
          available: availableQty,
        }), { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
    }
    // ── END ISSUE 5 ───────────────────────────────────────────────────────────

    // ── PART B: Movement Header INSERT ────────────────────────────────────────
    // movement_number is server-generated — eliminates browser Date.now() race condition
    const movNum = `MOV-${Date.now().toString(36).toUpperCase()}`;

    const { data: header, error: hErr } = await db
      .from('inv_movement_headers')
      .insert({
        movement_number: movNum,
        movement_date: new Date().toISOString().split('T')[0],
        movement_type: movementType,
        source_warehouse_id: finalSrcId,
        destination_warehouse_id: finalDstId,
        status: 'PENDING_APPROVAL',        // hard-coded — cannot be tampered by client
        approval_status: 'PENDING',
        reason_code: reasonCode || null,
        reason_description: reasonDescription,         // built server-side (Issue 3)
        reference_document_type: referenceType,        // required, not null
        reference_document_number: referenceDocNumber, // required, not null
        notes: notesStr,                               // built server-side (Issue 3)
        requested_by: userId,
        created_by: userId,
      })
      .select()
      .single();
    if (hErr) throw hErr;

    // ── PART C: Movement Line INSERT ─────────────────────────────────────────
    const { error: lineErr } = await db
      .from('inv_movement_lines')
      .insert({
        header_id: header.id,
        line_number: 1,
        item_code: itemCode,
        requested_quantity: finalQty,
        line_status: 'PENDING_APPROVAL',
        created_by: userId,
      });
    if (lineErr) {
      // Header was inserted but line failed — clean up orphaned header
      await db.from('inv_movement_headers').delete().eq('id', header.id);
      throw lineErr;
    }

    // ── PART D: Supervisor Notification ──────────────────────────────────────
    // Runs as a blocking step — failure is captured and returned to caller.
    await notifyOnRequestCreated(db, movNum, itemCode, finalQty, userId, header.id);

    return new Response(
      JSON.stringify({ movementNumber: movNum, headerId: header.id }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[submit-movement-request] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

if (import.meta.main) Deno.serve(handler);

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION HELPERS  (mirrors notifyOnRequestCreated from notificationService.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function notifyOnRequestCreated(
  db: ReturnType<typeof createClient>,
  movementNumber: string,
  itemCode: string,
  quantity: number,
  createdByUserId: string,
  movementId: string,
): Promise<void> {
  // Get item name for the notification message
  const { data: itemRow } = await db
    .from('items')
    .select('item_name')
    .eq('item_code', itemCode)
    .single();
  const itemName = itemRow?.item_name || itemCode;

  // Get operator's display name
  const { data: profile } = await db
    .from('profiles')
    .select('full_name')
    .eq('id', createdByUserId)
    .single();
  const operatorName = profile?.full_name || 'An operator';

  // Get all L2/L3 users except the creator
  const { data: supervisors } = await db
    .from('profiles')
    .select('id')
    .in('role', ['L2', 'L3'])
    .eq('is_active', true);

  const targetIds = (supervisors || [])
    .map((s: any) => s.id)
    .filter((id: string) => id !== createdByUserId);

  if (targetIds.length === 0) return;

  const rows = targetIds.map((uid: string) => ({
    user_id: uid,
    title: 'New Movement Request',
    message: `${operatorName} submitted ${movementNumber} — ${itemName} × ${quantity}. Awaiting your approval.`,
    type: 'request_created',
    module: 'stock-movements',
    reference_id: movementId,
    created_by: createdByUserId,
  }));

  const { error } = await db.from('notifications').insert(rows);
  if (error) throw error;
}
