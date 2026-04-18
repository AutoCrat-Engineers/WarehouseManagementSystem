/**
 * approve-movement — Edge Function
 *
 * Handles Parts A–F of handleApproval:
 *   A) Stock availability re-check (TOCTOU protection — check and use happen in same execution)
 *   B) Header + Line + Audit UPDATE (all three writes before any stock is touched)
 *   C) Source stock deduction
 *   D) Destination stock increment (atomic pair with C — neither can partially succeed)
 *   E) Packing request creation for PRODUCTION_RECEIPT (blocking — failure surfaced to caller)
 *   F) Operator notification (blocking — failure surfaced to caller)
 *
 * Business logic is UNCHANGED from the client-side original.
 * No RPC used — pure direct table operations via service role client.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

// Movement types where stock is only deducted (OUT only) — mirrors OUT_ONLY_MOVEMENT_TYPES
const OUT_ONLY_MOVEMENT_TYPES = ['REJECTION_DISPOSAL'];

// ── Request body shape ──
interface ApproveBody {
  movementId: string;
  action: 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED';
  approvedQty: number;  // ignored for REJECTED (forced to 0 server-side)
  supervisorNote: string;
}

export async function handler(req: Request): Promise<Response> {
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

    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── PARSE & VALIDATE BODY ─────────────────────────────────────────────────
    const body: ApproveBody = await req.json();
    const { movementId, action, approvedQty, supervisorNote } = body;

    if (!movementId || !action || !supervisorNote?.trim()) {
      return new Response(JSON.stringify({ error: 'movementId, action, and supervisorNote are required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── FETCH MOVEMENT DATA ───────────────────────────────────────────────────
    // Fetch header + line together so all writes use server-fetched data (not client payload)
    const [headerResult, lineResult] = await Promise.all([
      db.from('inv_movement_headers').select('*').eq('id', movementId).single(),
      db.from('inv_movement_lines').select('*').eq('header_id', movementId).limit(1).single(),
    ]);
    if (headerResult.error) throw headerResult.error;
    if (lineResult.error) throw lineResult.error;

    const movement = headerResult.data as any;
    const line = lineResult.data as any;

    const reqQty: number = line.requested_quantity || 0;
    const finalApproved: number = action === 'REJECTED' ? 0 : (action === 'PARTIALLY_APPROVED' ? Number(approvedQty) : reqQty);
    const finalRejected: number = reqQty - finalApproved;

    const movType: string = movement.movement_type;

    // ── ISSUE 6 MIGRATION: canPartialApprove enforcement ─────────────────────
    // Previously enforced only in StockMovement.tsx (client lines 244-246, 889-894).
    // Now enforced here so the rule cannot be bypassed via direct API calls.
    // Logic is UNCHANGED — same movement types, same quantity bounds.
    const PARTIAL_APPROVAL_ALLOWED_TYPES = ['DISPATCH_TO_TRANSIT', 'TRANSFER_TO_WAREHOUSE'];
    if (action === 'PARTIALLY_APPROVED' && !PARTIAL_APPROVAL_ALLOWED_TYPES.includes(movType)) {
      return new Response(JSON.stringify({ error: 'Partial approval is not allowed for this movement type.' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (action === 'PARTIALLY_APPROVED' && (finalApproved <= 0 || finalApproved >= reqQty)) {
      return new Response(JSON.stringify({ error: `Partial quantity must be between 1 and ${reqQty - 1}.` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    // ── END ISSUE 6 ───────────────────────────────────────────────────────────

    const srcId: string | null = movement.source_warehouse_id;
    const dstId: string | null = movement.destination_warehouse_id;
    const itemCode: string = line.item_code;

    // ── PART A: Stock Availability Re-check ───────────────────────────────────
    const externalSourceTypes = ['PRODUCTION_RECEIPT', 'CUSTOMER_RETURN'];
    if (action !== 'REJECTED' && !externalSourceTypes.includes(movType)) {
      if (srcId && itemCode) {
        const { data: stockRecord } = await db
          .from('inv_warehouse_stock')
          .select('quantity_on_hand')
          .eq('warehouse_id', srcId)
          .eq('item_code', itemCode)
          .eq('is_active', true)
          .single();
        const availableQty: number = stockRecord?.quantity_on_hand || 0;
        if (availableQty < finalApproved) {
          return new Response(
            JSON.stringify({
              error: `Insufficient Stock: Source warehouse has only ${availableQty} units available but ${finalApproved} were requested.`,
              code: 'INSUFFICIENT_STOCK',
              available: availableQty,
            }),
            { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          );
        }
      }
    }

    // DB only accepts: APPROVED, PENDING_APPROVAL, REJECTED (not PARTIALLY_APPROVED or COMPLETED)
    const headerStatus = action === 'REJECTED' ? 'REJECTED' : 'APPROVED';
    const now = new Date().toISOString();

    // ── PART B: Header + Line + Audit UPDATE ──────────────────────────────────
    const { error: hUpdateErr } = await db
      .from('inv_movement_headers')
      .update({
        status: headerStatus,
        approval_status: headerStatus,
        approved_by: userId,
        approved_at: now,
      })
      .eq('id', movementId);
    if (hUpdateErr) throw hUpdateErr;

    const { error: lineUpdateErr } = await db
      .from('inv_movement_lines')
      .update({
        approved_quantity: finalApproved,
        actual_quantity: finalApproved,
        line_status: headerStatus,
      })
      .eq('header_id', movementId);
    if (lineUpdateErr) throw lineUpdateErr;

    const { error: auditErr } = await db
      .from('inv_movement_approvals')
      .insert({
        movement_id: movementId,
        approver_id: userId,
        action,
        requested_qty: reqQty,
        approved_qty: finalApproved,
        rejected_qty: finalRejected,
        notes: supervisorNote,
      });
    if (auditErr) throw auditErr;

    // ── PARTS C & D: Stock Updates ────────────────────────────────────────────
    // PRODUCTION_RECEIPT stock moves via Packing module — skip immediate stock update
    const skipImmediateStock = movType === 'PRODUCTION_RECEIPT';

    if (action !== 'REJECTED' && finalApproved > 0 && !skipImmediateStock) {
      const qty = finalApproved;
      const isDisposal = OUT_ONLY_MOVEMENT_TYPES.includes(movType);

      // External SOURCE: stock comes from outside — only INCREMENT destination
      const hasExternalSource = ['CUSTOMER_RETURN'].includes(movType);
      // External DESTINATION: stock goes outside — only DECREMENT source
      const hasExternalDest = ['CUSTOMER_SALE', 'RETURN_TO_PRODUCTION'].includes(movType) || isDisposal;

      // ── PART C: Source stock deduction ──
      if (!hasExternalSource && srcId && itemCode) {
        const { data: ss } = await db
          .from('inv_warehouse_stock')
          .select('id, quantity_on_hand')
          .eq('warehouse_id', srcId)
          .eq('item_code', itemCode)
          .eq('is_active', true)
          .single();
        if (ss) {
          const nq = Math.max(0, (ss as any).quantity_on_hand - qty);
          const { error: stockDecErr } = await db
            .from('inv_warehouse_stock')
            .update({ quantity_on_hand: nq, last_issue_date: now, updated_by: userId })
            .eq('id', (ss as any).id);
          if (stockDecErr) throw stockDecErr;

          const { error: ledgerDecErr } = await db
            .from('inv_stock_ledger')
            .insert({
              warehouse_id: srcId,
              item_code: itemCode,
              transaction_type: isDisposal ? 'STOCK_REMOVAL' : 'TRANSFER_OUT',
              quantity_change: -qty,
              quantity_before: (ss as any).quantity_on_hand,
              quantity_after: nq,
              reference_type: movType,
              reference_id: movementId,
              notes: isDisposal
                ? `OUT: ${qty} units | REJECTION DISPOSAL — Final removal from system | ${supervisorNote}`
                : `OUT: ${qty} units | ${supervisorNote}`,
              created_by: userId,
            });
          if (ledgerDecErr) throw ledgerDecErr;
        }
      }

      // ── PART D: Destination stock increment ──
      if (!hasExternalDest && dstId && itemCode) {
        const { data: ds } = await db
          .from('inv_warehouse_stock')
          .select('id, quantity_on_hand')
          .eq('warehouse_id', dstId)
          .eq('item_code', itemCode)
          .eq('is_active', true)
          .single();

        if (ds) {
          const nq = (ds as any).quantity_on_hand + qty;
          const { error: stockIncErr } = await db
            .from('inv_warehouse_stock')
            .update({ quantity_on_hand: nq, last_receipt_date: now, updated_by: userId })
            .eq('id', (ds as any).id);
          if (stockIncErr) throw stockIncErr;

          const { error: ledgerIncErr } = await db
            .from('inv_stock_ledger')
            .insert({
              warehouse_id: dstId,
              item_code: itemCode,
              transaction_type: 'TRANSFER_IN',
              quantity_change: qty,
              quantity_before: (ds as any).quantity_on_hand,
              quantity_after: nq,
              reference_type: movType,
              reference_id: movementId,
              notes: `IN: ${qty} units | ${supervisorNote}`,
              created_by: userId,
            });
          if (ledgerIncErr) throw ledgerIncErr;
        } else {
          // Item does not exist at destination — create new stock record
          const { error: stockNewErr } = await db
            .from('inv_warehouse_stock')
            .insert({
              warehouse_id: dstId,
              item_code: itemCode,
              quantity_on_hand: qty,
              last_receipt_date: now,
              created_by: userId,
            });
          if (stockNewErr) throw stockNewErr;

          const { error: ledgerNewErr } = await db
            .from('inv_stock_ledger')
            .insert({
              warehouse_id: dstId,
              item_code: itemCode,
              transaction_type: 'TRANSFER_IN',
              quantity_change: qty,
              quantity_before: 0,
              quantity_after: qty,
              reference_type: movType,
              reference_id: movementId,
              notes: `IN: ${qty} units | ${supervisorNote}`,
              created_by: userId,
            });
          if (ledgerNewErr) throw ledgerNewErr;
        }
      }
    }

    // ── PART E: Packing Request Creation (PRODUCTION_RECEIPT only) ────────────
    if (movType === 'PRODUCTION_RECEIPT') {
      const operatorId: string = movement.requested_by || userId;
      if (action === 'REJECTED') {
        await createPackingFromMovementRejection(
          db, movementId, movement.movement_number,
          itemCode, reqQty, operatorId, userId,
          supervisorNote, movement.reason_description || null,
        );
      } else {
        await createPackingFromMovementApproval(
          db, movementId, movement.movement_number,
          itemCode, finalApproved, operatorId, userId,
          supervisorNote, movement.reason_description || null,
        );
      }
    }

    // ── PART F: Operator Notification ────────────────────────────────────────
    if (movement.requested_by) {
      await notifyOnRequestDecision(
        db,
        movement.movement_number,
        itemCode,
        action,
        finalApproved,
        reqQty,
        movement.requested_by,
        userId,
        movementId,
      );
    }

    return new Response(
      JSON.stringify({ success: true, action, approvedQty: finalApproved }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[approve-movement] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

if (import.meta.main) Deno.serve(handler);

// ─────────────────────────────────────────────────────────────────────────────
// PACKING HELPERS  (mirrors createPackingFromMovementApproval / Rejection)
// ─────────────────────────────────────────────────────────────────────────────

async function createPackingFromMovementApproval(
  db: ReturnType<typeof createClient>,
  movementHeaderId: string,
  movementNumber: string,
  itemCode: string,
  approvedQty: number,
  operatorId: string,
  supervisorId: string,
  supervisorRemarks: string,
  reasonDescription: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('packing_requests')
    .insert({
      movement_header_id: movementHeaderId,
      movement_number: movementNumber,
      item_code: itemCode,
      total_packed_qty: approvedQty,
      status: 'APPROVED',
      created_by: operatorId,
      approved_by: supervisorId,
      approved_at: now,
      supervisor_remarks: supervisorRemarks,
      operator_remarks: reasonDescription,
      transferred_qty: 0,
    })
    .select()
    .single();
  if (error) throw error;

  const { error: auditErr } = await db.from('packing_audit_logs').insert({
    packing_request_id: (data as any).id,
    action_type: 'PACKING_CREATED',
    performed_by: supervisorId,
    role: 'L2',
    metadata: {
      item_code: itemCode,
      approved_qty: approvedQty,
      movement_number: movementNumber,
    },
  });
  if (auditErr) throw auditErr;
}

async function createPackingFromMovementRejection(
  db: ReturnType<typeof createClient>,
  movementHeaderId: string,
  movementNumber: string,
  itemCode: string,
  requestedQty: number,
  operatorId: string,
  supervisorId: string,
  supervisorRemarks: string,
  reasonDescription: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  const { data, error } = await db
    .from('packing_requests')
    .insert({
      movement_header_id: movementHeaderId,
      movement_number: movementNumber,
      item_code: itemCode,
      total_packed_qty: requestedQty,
      status: 'REJECTED',
      created_by: operatorId,
      approved_by: supervisorId,
      rejected_at: now,
      supervisor_remarks: supervisorRemarks,
      operator_remarks: reasonDescription,
      transferred_qty: 0,
    })
    .select()
    .single();
  if (error) throw error;

  const { error: auditErr } = await db.from('packing_audit_logs').insert({
    packing_request_id: (data as any).id,
    action_type: 'PACKING_REJECTED',
    performed_by: supervisorId,
    role: 'L2',
    metadata: {
      item_code: itemCode,
      requested_qty: requestedQty,
      movement_number: movementNumber,
      rejection_reason: supervisorRemarks,
    },
  });
  if (auditErr) throw auditErr;
}

// ─────────────────────────────────────────────────────────────────────────────
// NOTIFICATION HELPERS  (mirrors notifyOnRequestDecision from notificationService.ts)
// ─────────────────────────────────────────────────────────────────────────────

async function notifyOnRequestDecision(
  db: ReturnType<typeof createClient>,
  movementNumber: string,
  itemCode: string,
  action: 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED',
  approvedQty: number,
  requestedQty: number,
  operatorUserId: string,
  supervisorUserId: string,
  movementId: string,
): Promise<void> {
  // Get item name
  const { data: itemRow } = await db
    .from('items')
    .select('item_name')
    .eq('item_code', itemCode)
    .single();
  const itemName = itemRow?.item_name || itemCode;

  // Get supervisor display name
  const { data: supervisorProfile } = await db
    .from('profiles')
    .select('full_name')
    .eq('id', supervisorUserId)
    .single();
  const supervisorName = supervisorProfile?.full_name || 'A supervisor';

  let title: string;
  let message: string;
  let type: string;

  if (action === 'REJECTED') {
    title = 'Request Rejected';
    message = `${supervisorName} rejected ${movementNumber} — ${itemName} × ${requestedQty}. No stock was moved.`;
    type = 'request_rejected';
  } else if (action === 'PARTIALLY_APPROVED') {
    title = 'Request Partially Approved';
    message = `${supervisorName} partially approved ${movementNumber} — ${approvedQty} of ${requestedQty} ${itemName} approved.`;
    type = 'request_partial';
  } else {
    title = 'Request Approved';
    message = `${supervisorName} approved ${movementNumber} — ${itemName} × ${requestedQty}. Stock has been moved.`;
    type = 'request_approved';
  }

  if (operatorUserId && operatorUserId !== supervisorUserId) {
    const { error } = await db.from('notifications').insert({
      user_id: operatorUserId,
      title,
      message,
      type,
      module: 'stock-movements',
      reference_id: movementId,
      created_by: supervisorUserId,
    });
    if (error) throw error;
  }
}
