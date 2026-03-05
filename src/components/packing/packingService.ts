/**
 * packingService.ts — Packing workflow service (v5).
 *
 * ARCHITECTURE (v5):
 *   - Movement ID = primary reference for packing request
 *   - On supervisor approval: packing request created, NO stock movement
 *   - Each BOX gets its own unique Packing ID (PKG-XXXXXXXX)
 *   - Stock moves PRODUCTION → FG Warehouse only when operator explicitly triggers:
 *       a) "Move Packed Stock" — partial transfer of completed boxes
 *       b) "Complete Packing" → confirms final stock transfer
 *   - Supports partial packing + partial stock transfer (like SAP MIGO partial GR)
 */
import { getSupabaseClient } from '../../utils/supabase/client';
import { isValidTransition, generatePackingId } from '../../types/packing';
import type {
    PackingRequest, PackingBox, PackingAuditLog,
    PackingRequestStatus, PackingAuditAction,
} from '../../types/packing';
import { processPackingBoxAsContainer } from '../packing-engine/packingEngineService';

const supabase = getSupabaseClient();

// ============================================================================
// HELPERS
// ============================================================================

async function getCurrentUserId(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) throw new Error('Not authenticated');
    return session.user.id;
}

async function getUserRole(userId: string): Promise<string> {
    const { data } = await supabase.from('profiles').select('role').eq('id', userId).single();
    return data?.role || 'L1';
}

/** Fetch userId and role in a single parallel call — used by most functions */
async function getAuthContext(): Promise<{ userId: string; role: string }> {
    const userId = await getCurrentUserId();
    const role = await getUserRole(userId);
    return { userId, role };
}

async function logAudit(
    requestId: string, action: PackingAuditAction,
    userId: string, role: string, metadata: Record<string, any> = {}
) {
    await supabase.from('packing_audit_logs').insert({
        packing_request_id: requestId, action_type: action,
        performed_by: userId, role, metadata,
    });
}

// ============================================================================
// AUTO-CREATE FROM STOCK MOVEMENT APPROVAL (NO stock movement on approval)
// ============================================================================

export async function createPackingFromMovementApproval(
    movementHeaderId: string,
    movementNumber: string,
    itemCode: string,
    approvedQty: number,
    operatorId: string,
    supervisorId: string,
    supervisorRemarks: string,
    reasonDescription: string | null,
): Promise<void> {
    const { data, error } = await supabase.from('packing_requests').insert({
        movement_header_id: movementHeaderId,
        movement_number: movementNumber,
        item_code: itemCode,
        total_packed_qty: approvedQty,
        status: 'APPROVED',
        created_by: operatorId,
        approved_by: supervisorId,
        approved_at: new Date().toISOString(),
        supervisor_remarks: supervisorRemarks,
        operator_remarks: reasonDescription,
        transferred_qty: 0,
    }).select().single();
    if (error) throw error;

    // Audit — clean metadata, no internal IDs
    await logAudit(data.id, 'PACKING_CREATED', supervisorId, 'L2', {
        item_code: itemCode,
        approved_qty: approvedQty,
        movement_number: movementNumber,
    });
}

export async function createPackingFromMovementRejection(
    movementHeaderId: string,
    movementNumber: string,
    itemCode: string,
    requestedQty: number,
    operatorId: string,
    supervisorId: string,
    supervisorRemarks: string,
    reasonDescription: string | null,
): Promise<void> {
    const { data, error } = await supabase.from('packing_requests').insert({
        movement_header_id: movementHeaderId,
        movement_number: movementNumber,
        item_code: itemCode,
        total_packed_qty: requestedQty,
        status: 'REJECTED',
        created_by: operatorId,
        approved_by: supervisorId,
        rejected_at: new Date().toISOString(),
        supervisor_remarks: supervisorRemarks,
        operator_remarks: reasonDescription,
        transferred_qty: 0,
    }).select().single();
    if (error) throw error;

    await logAudit(data.id, 'PACKING_REJECTED', supervisorId, 'L2', {
        item_code: itemCode,
        requested_qty: requestedQty,
        movement_number: movementNumber,
        rejection_reason: supervisorRemarks,
    });
}

// ============================================================================
// FETCH
// ============================================================================

export async function fetchPackingRequests(onlyMine: boolean = false): Promise<PackingRequest[]> {
    const userId = await getCurrentUserId();
    let query = supabase
        .from('packing_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

    if (onlyMine) query = query.eq('created_by', userId);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];

    // Collect IDs for parallel enrichment
    const userIds = [...new Set(rows.flatMap((r: any) => [r.created_by, r.approved_by].filter(Boolean)))];
    const itemCodes = [...new Set(rows.map((r: any) => r.item_code).filter(Boolean))];
    const requestIds = rows.map((r: any) => r.id);

    // ── PARALLEL ENRICHMENT — all 3 queries run simultaneously ──
    const [profilesResult, itemsResult, boxesResult] = await Promise.all([
        userIds.length
            ? supabase.from('profiles').select('id, full_name').in('id', userIds)
            : Promise.resolve({ data: [] as any[] }),
        itemCodes.length
            ? supabase.from('items').select('item_code, item_name, part_number, master_serial_no, revision').in('item_code', itemCodes)
            : Promise.resolve({ data: [] as any[] }),
        requestIds.length
            ? supabase.from('packing_boxes').select('packing_request_id, box_qty, sticker_printed, is_transferred').in('packing_request_id', requestIds)
            : Promise.resolve({ data: [] as any[] }),
    ]);

    const nameMap: Record<string, string> = {};
    (profilesResult.data || []).forEach((p: any) => { nameMap[p.id] = p.full_name; });

    const itemMap: Record<string, { item_name: string; part_number: string | null; master_serial_no: string | null; revision: string | null }> = {};
    (itemsResult.data || []).forEach((i: any) => {
        itemMap[i.item_code] = {
            item_name: i.item_name,
            part_number: i.part_number,
            master_serial_no: i.master_serial_no,
            revision: i.revision || null,
        };
    });

    const boxAgg: Record<string, { sum: number; count: number; allPrinted: boolean; transferredSum: number }> = {};
    (boxesResult.data || []).forEach((b: any) => {
        if (!boxAgg[b.packing_request_id]) boxAgg[b.packing_request_id] = { sum: 0, count: 0, allPrinted: true, transferredSum: 0 };
        boxAgg[b.packing_request_id].sum += Number(b.box_qty);
        boxAgg[b.packing_request_id].count += 1;
        if (!b.sticker_printed) boxAgg[b.packing_request_id].allPrinted = false;
        if (b.is_transferred) boxAgg[b.packing_request_id].transferredSum += Number(b.box_qty);
    });

    return rows.map((r: any) => ({
        ...r,
        created_by_name: nameMap[r.created_by] || undefined,
        approved_by_name: r.approved_by ? nameMap[r.approved_by] : undefined,
        item_name: itemMap[r.item_code]?.item_name || r.item_code,
        part_number: itemMap[r.item_code]?.part_number || null,
        master_serial_no: itemMap[r.item_code]?.master_serial_no || null,
        revision: itemMap[r.item_code]?.revision || null,
        boxes_packed_qty: boxAgg[r.id]?.sum || 0,
        boxes_count: boxAgg[r.id]?.count || 0,
        all_stickers_printed: boxAgg[r.id]?.allPrinted ?? true,
        // Use actual transferred qty from boxes (source of truth), not the stored field
        transferred_qty: boxAgg[r.id]?.transferredSum ?? (r.transferred_qty || 0),
    }));
}

export async function fetchBoxesForRequest(requestId: string): Promise<PackingBox[]> {
    const { data, error } = await supabase.from('packing_boxes')
        .select('*')
        .eq('packing_request_id', requestId)
        .order('box_number', { ascending: true });
    if (error) throw error;

    const userIds = [...new Set((data || []).map((b: any) => b.created_by).filter(Boolean))];
    let nameMap: Record<string, string> = {};
    if (userIds.length) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
        (profiles || []).forEach((p: any) => { nameMap[p.id] = p.full_name; });
    }

    return (data || []).map((b: any) => ({
        ...b,
        packing_id: b.packing_id || generatePackingId(b.id),
        is_transferred: b.is_transferred || false,
        transferred_at: b.transferred_at || null,
        created_by_name: nameMap[b.created_by] || undefined,
    }));
}

export async function fetchAuditLogs(requestId: string): Promise<PackingAuditLog[]> {
    const { data, error } = await supabase.from('packing_audit_logs')
        .select('*')
        .eq('packing_request_id', requestId)
        .order('created_at', { ascending: true });
    if (error) throw error;

    const userIds = [...new Set((data || []).map((l: any) => l.performed_by).filter(Boolean))];
    let nameMap: Record<string, string> = {};
    if (userIds.length) {
        const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', userIds);
        (profiles || []).forEach((p: any) => { nameMap[p.id] = p.full_name; });
    }

    return (data || []).map((l: any) => ({ ...l, performed_by_name: nameMap[l.performed_by] || undefined }));
}

// ============================================================================
// WORKFLOW — Start Packing
// ============================================================================

export async function startPacking(requestId: string) {
    // Parallel: auth + fetch status
    const [authCtx, currentResult] = await Promise.all([
        getAuthContext(),
        supabase.from('packing_requests').select('status, movement_number').eq('id', requestId).single(),
    ]);

    const { userId, role } = authCtx;
    const current = currentResult.data;
    if (!current) throw new Error('Packing request not found');
    if (!isValidTransition(current.status as PackingRequestStatus, 'PACKING_IN_PROGRESS')) {
        throw new Error(`Cannot start packing from status: ${current.status}`);
    }

    // Parallel: update status + audit
    const [updateResult] = await Promise.all([
        supabase.from('packing_requests').update({
            status: 'PACKING_IN_PROGRESS', started_at: new Date().toISOString(),
        }).eq('id', requestId),
        logAudit(requestId, 'PACKING_STARTED', userId, role, {
            movement_number: current.movement_number,
        }),
    ]);
    if (updateResult.error) throw updateResult.error;
}

// ============================================================================
// BOX MANAGEMENT — Each box gets a unique Packing ID (PKG-XXXXXXXX)
// ============================================================================

export async function addBox(requestId: string, boxQty: number): Promise<PackingBox> {
    if (boxQty <= 0) throw new Error('Box quantity must be > 0');
    const userId = await getCurrentUserId();
    const role = await getUserRole(userId);

    const { data: req } = await supabase.from('packing_requests')
        .select('status, total_packed_qty, item_code, movement_header_id, movement_number').eq('id', requestId).single();
    if (!req || !['PACKING_IN_PROGRESS', 'PARTIALLY_TRANSFERRED'].includes(req.status)) {
        throw new Error('Can only add boxes when packing is in progress');
    }

    // Get next box number
    const { data: existing } = await supabase.from('packing_boxes')
        .select('box_number').eq('packing_request_id', requestId)
        .order('box_number', { ascending: false }).limit(1);
    const nextBox = existing && existing.length > 0 ? existing[0].box_number + 1 : 1;

    // Validate total won't exceed
    const { data: allBoxes } = await supabase.from('packing_boxes')
        .select('box_qty').eq('packing_request_id', requestId);
    const currentSum = (allBoxes || []).reduce((s: number, b: any) => s + Number(b.box_qty), 0);
    if (currentSum + boxQty > Number(req.total_packed_qty)) {
        throw new Error(`Adding ${boxQty} would exceed total (${req.total_packed_qty}). Already packed: ${currentSum}`);
    }

    // Create box — packing_id will be generated from UUID after insert
    const { data, error } = await supabase.from('packing_boxes').insert({
        packing_request_id: requestId, box_number: nextBox,
        box_qty: boxQty, created_by: userId,
        is_transferred: false,
    }).select().single();
    if (error) throw error;

    // Generate the packing ID from the box UUID and update it
    const packingId = generatePackingId(data.id);
    await supabase.from('packing_boxes').update({ packing_id: packingId }).eq('id', data.id);

    // ── PACKING ENGINE: Create container + assign to pallet ──
    try {
        // Get item_id from items table
        const { data: itemData } = await supabase.from('items')
            .select('id').eq('item_code', req.item_code).single();
        if (itemData) {
            const result = await processPackingBoxAsContainer({
                movement_header_id: req.movement_header_id,
                movement_number: req.movement_number,
                packing_request_id: requestId,
                packing_box_id: data.id,
                item_id: itemData.id,
                item_code: req.item_code,
                box_qty: boxQty,
            });
            console.log(`[PackingEngine] Container ${result.container.container_number} → Pallet ${result.pallet.pallet_number} (${result.pallet.state})`);
        }
    } catch (engineErr: any) {
        console.warn('[PackingEngine] Container/pallet creation failed (non-blocking):', engineErr.message);
    }

    // Audit — with packing ID, no internal UUID
    await logAudit(requestId, 'BOX_CREATED', userId, role, {
        box_number: nextBox, box_qty: boxQty, packing_id: packingId,
    });
    return { ...data, packing_id: packingId };
}

export async function deleteBox(requestId: string, boxId: string) {
    const userId = await getCurrentUserId();
    const role = await getUserRole(userId);

    const { data: box } = await supabase.from('packing_boxes')
        .select('*').eq('id', boxId).eq('packing_request_id', requestId).single();
    if (!box) throw new Error('Box not found');
    if (box.sticker_printed) throw new Error('Cannot delete a box after its sticker has been printed');
    if (box.is_transferred) throw new Error('Cannot delete a box that has already been transferred to FG Warehouse');

    const packingId = box.packing_id || generatePackingId(box.id);

    const { error } = await supabase.from('packing_boxes').delete().eq('id', boxId);
    if (error) throw error;

    // Audit — with packing ID, no internal UUID
    await logAudit(requestId, 'BOX_DELETED', userId, role, {
        box_number: box.box_number, box_qty: box.box_qty, packing_id: packingId,
    });
}

// ============================================================================
// AUTO-GENERATE BOXES — Creates all boxes automatically from packing spec
// Called when opening a sticker generation detail view.
// If boxes already exist, returns them without re-creating.
// ============================================================================

export async function autoGenerateBoxes(requestId: string): Promise<PackingBox[]> {
    const { userId, role } = await getAuthContext();

    // Parallel: fetch request + check existing boxes
    const [reqResult, existingBoxes] = await Promise.all([
        supabase.from('packing_requests')
            .select('status, total_packed_qty, item_code, movement_number, movement_header_id')
            .eq('id', requestId).single(),
        fetchBoxesForRequest(requestId),
    ]);
    const req = reqResult.data;
    if (!req) throw new Error('Packing request not found');
    if (existingBoxes.length > 0) return existingBoxes;

    if (req.status !== 'APPROVED') {
        throw new Error('Can only auto-generate boxes for APPROVED requests');
    }

    // Fetch packing specification for the item
    const { data: packingSpec } = await supabase.from('packing_specifications')
        .select('inner_box_quantity')
        .eq('item_code', req.item_code)
        .eq('is_active', true)
        .single();

    if (!packingSpec || !packingSpec.inner_box_quantity || packingSpec.inner_box_quantity <= 0) {
        throw new Error('No valid packing specification found for this item. Please add one in Packing Details first.');
    }

    const innerBoxQty = packingSpec.inner_box_quantity;
    const totalQty = Number(req.total_packed_qty);
    const fullBoxes = Math.floor(totalQty / innerBoxQty);
    const remainder = totalQty % innerBoxQty;
    const totalBoxes = fullBoxes + (remainder > 0 ? 1 : 0);

    if (totalBoxes <= 0) throw new Error('Cannot generate boxes — total quantity is 0');

    // Parallel: status transition + audit
    await Promise.all([
        supabase.from('packing_requests').update({
            status: 'PACKING_IN_PROGRESS',
            started_at: new Date().toISOString(),
        }).eq('id', requestId),
        logAudit(requestId, 'PACKING_STARTED', userId, role, {
            movement_number: req.movement_number,
            auto_generated: true,
            total_boxes: totalBoxes,
            inner_box_qty: innerBoxQty,
        }),
    ]);

    // Create all boxes
    const boxInserts = [];
    for (let i = 0; i < totalBoxes; i++) {
        const isLastPartialBox = (i === totalBoxes - 1 && remainder > 0);
        boxInserts.push({
            packing_request_id: requestId,
            box_number: i + 1,
            box_qty: isLastPartialBox ? remainder : innerBoxQty,
            created_by: userId,
            is_transferred: false,
            sticker_printed: false,
        });
    }

    const { data: insertedBoxes, error: insertError } = await supabase
        .from('packing_boxes')
        .insert(boxInserts)
        .select();
    if (insertError) throw insertError;

    // BATCH: Generate packing IDs for all boxes in parallel (not one-at-a-time)
    const createdBoxes: PackingBox[] = [];
    const updatePromises = (insertedBoxes || []).map(box => {
        const packingId = generatePackingId(box.id);
        createdBoxes.push({ ...box, packing_id: packingId });
        return supabase.from('packing_boxes').update({ packing_id: packingId }).eq('id', box.id);
    });
    await Promise.all(updatePromises);

    // ── PACKING ENGINE: Create containers + assign to pallets for all boxes ──
    try {
        const { data: itemData } = await supabase.from('items')
            .select('id').eq('item_code', req.item_code).single();
        if (itemData) {
            for (const box of createdBoxes) {
                try {
                    const result = await processPackingBoxAsContainer({
                        movement_header_id: req.movement_header_id || '',
                        movement_number: req.movement_number,
                        packing_request_id: requestId,
                        packing_box_id: box.id,
                        item_id: itemData.id,
                        item_code: req.item_code,
                        box_qty: Number(box.box_qty),
                    });
                    console.log(`[PackingEngine] Box #${box.box_number} → Container ${result.container.container_number} → Pallet ${result.pallet.pallet_number} (${result.pallet.state})`);
                } catch (boxErr: any) {
                    console.warn(`[PackingEngine] Box #${box.box_number} engine failed:`, boxErr.message);
                }
            }
        }
    } catch (engineErr: any) {
        console.warn('[PackingEngine] Batch container/pallet creation failed (non-blocking):', engineErr.message);
    }

    // Audit — log auto-generation
    await logAudit(requestId, 'BOX_CREATED', userId, role, {
        auto_generated: true,
        total_boxes: totalBoxes,
        inner_box_qty: innerBoxQty,
        total_qty: totalQty,
        movement_number: req.movement_number,
    });

    return createdBoxes;
}

// ============================================================================
// BATCH STICKER PRINT — Mark all unprinted stickers as printed
// ============================================================================

export async function markAllStickersPrinted(requestId: string): Promise<number> {
    // Parallel: auth + fetch unprinted boxes
    const [authCtx, unprintedResult] = await Promise.all([
        getAuthContext(),
        supabase.from('packing_boxes')
            .select('id, box_number, box_qty, packing_id')
            .eq('packing_request_id', requestId)
            .eq('sticker_printed', false),
    ]);
    const { userId, role } = authCtx;
    const unprintedBoxes = unprintedResult.data;

    if (!unprintedBoxes || unprintedBoxes.length === 0) {
        return 0;
    }

    const now = new Date().toISOString();
    const boxIds = unprintedBoxes.map(b => b.id);

    // Parallel: batch update + audit
    const [updateResult] = await Promise.all([
        supabase.from('packing_boxes')
            .update({ sticker_printed: true, sticker_printed_at: now })
            .in('id', boxIds),
        logAudit(requestId, 'STICKER_PRINTED', userId, role, {
            batch_print: true,
            boxes_printed: unprintedBoxes.length,
            packing_ids: unprintedBoxes.map(b => b.packing_id || generatePackingId(b.id)).join(', '),
        }),
    ]);
    if (updateResult.error) throw updateResult.error;

    return unprintedBoxes.length;
}

// ============================================================================
// STICKER MANAGEMENT — includes box-level packing_id in audit
// ============================================================================

export async function markStickerPrinted(requestId: string, boxId: string) {
    const now = new Date().toISOString();

    // Parallel: auth + fetch box + update box (update doesn't depend on box data)
    const [authCtx, boxResult, updateResult] = await Promise.all([
        getAuthContext(),
        supabase.from('packing_boxes')
            .select('box_number, box_qty, packing_id').eq('id', boxId).single(),
        supabase.from('packing_boxes').update({
            sticker_printed: true, sticker_printed_at: now,
        }).eq('id', boxId).eq('packing_request_id', requestId),
    ]);
    if (updateResult.error) throw updateResult.error;

    const { userId, role } = authCtx;
    const box = boxResult.data;
    const packingId = box?.packing_id || generatePackingId(boxId);

    // Fire audit (non-blocking for UI, but we still await for integrity)
    await logAudit(requestId, 'STICKER_PRINTED', userId, role, {
        box_number: box?.box_number ?? '—',
        qty: box?.box_qty ?? '—',
        packing_id: packingId,
    });
}

// ============================================================================
// STOCK TRANSFER — Move packed stock from PRODUCTION → FG Warehouse
// This is the core of v5: stock moves based on packing, not on approval.
// ============================================================================

/**
 * Transfer packed (and printed) boxes' stock from Production to FG Warehouse.
 * Can be called for partial transfers (some boxes) or full transfer (all boxes).
 * @param requestId - Packing request ID
 * @param boxIds - Optional array of specific box IDs to transfer. If empty, transfers ALL untransferred printed boxes.
 */
export async function transferPackedStock(
    requestId: string,
    boxIds?: string[]
): Promise<{ transferredQty: number; boxesTransferred: number; isComplete: boolean }> {
    // ── PHASE 1: Parallel fetch — auth + request + eligible boxes ──
    let boxQuery = supabase.from('packing_boxes')
        .select('*')
        .eq('packing_request_id', requestId)
        .eq('sticker_printed', true)
        .eq('is_transferred', false);
    if (boxIds && boxIds.length > 0) {
        boxQuery = boxQuery.in('id', boxIds);
    }

    const [authCtx, reqResult, boxResult] = await Promise.all([
        getAuthContext(),
        supabase.from('packing_requests')
            .select('*, movement_header_id, movement_number, item_code, total_packed_qty, status, transferred_qty')
            .eq('id', requestId).single(),
        boxQuery,
    ]);

    const { userId, role } = authCtx;
    const req = reqResult.data;
    if (!req) throw new Error('Packing request not found');
    if (!['PACKING_IN_PROGRESS', 'PARTIALLY_TRANSFERRED'].includes(req.status)) {
        throw new Error('Can only transfer stock when packing is in progress');
    }

    const eligibleBoxes = boxResult.data;
    if (!eligibleBoxes || eligibleBoxes.length === 0) {
        throw new Error('No eligible boxes to transfer. Boxes must have stickers printed and not already transferred.');
    }

    const transferQty = eligibleBoxes.reduce((sum: number, b: any) => sum + Number(b.box_qty), 0);

    // ── PHASE 2: Parallel fetch — movement header (needed for warehouse IDs) ──
    const { data: movementHeader } = await supabase.from('inv_movement_headers')
        .select('source_warehouse_id, destination_warehouse_id')
        .eq('id', req.movement_header_id).single();
    if (!movementHeader) throw new Error('Movement header not found');

    const dstId = movementHeader.destination_warehouse_id;
    const itemCode = req.item_code;
    const now = new Date().toISOString();

    // ── PHASE 3: Stock update + BATCH box update — all in parallel ──
    const eligibleBoxIds = eligibleBoxes.map((b: any) => b.id);

    // Build stock operations (Supabase query builders are thenable)
    const stockOps: any[] = [];

    if (dstId && itemCode) {
        const { data: ds } = await supabase.from('inv_warehouse_stock')
            .select('id, quantity_on_hand').eq('warehouse_id', dstId)
            .eq('item_code', itemCode).eq('is_active', true).single();

        if (ds) {
            const nq = ds.quantity_on_hand + transferQty;
            // Parallel: update stock + insert ledger
            stockOps.push(
                supabase.from('inv_warehouse_stock').update({
                    quantity_on_hand: nq,
                    last_receipt_date: now,
                    updated_by: userId,
                }).eq('id', ds.id),
                supabase.from('inv_stock_ledger').insert({
                    warehouse_id: dstId, item_code: itemCode,
                    transaction_type: 'TRANSFER_IN',
                    quantity_change: transferQty,
                    quantity_before: ds.quantity_on_hand,
                    quantity_after: nq,
                    reference_type: 'PACKING_TRANSFER',
                    reference_id: requestId,
                    notes: `IN: ${transferQty} units | Packing transfer — ${eligibleBoxes.length} box(es) | Movement: ${req.movement_number}`,
                    created_by: userId,
                }),
            );
        } else {
            stockOps.push(
                supabase.from('inv_warehouse_stock').insert({
                    warehouse_id: dstId, item_code: itemCode,
                    quantity_on_hand: transferQty,
                    last_receipt_date: now,
                    created_by: userId,
                }),
                supabase.from('inv_stock_ledger').insert({
                    warehouse_id: dstId, item_code: itemCode,
                    transaction_type: 'TRANSFER_IN',
                    quantity_change: transferQty,
                    quantity_before: 0,
                    quantity_after: transferQty,
                    reference_type: 'PACKING_TRANSFER',
                    reference_id: requestId,
                    notes: `IN: ${transferQty} units | Packing transfer — ${eligibleBoxes.length} box(es) | Movement: ${req.movement_number}`,
                    created_by: userId,
                }),
            );
        }
    }

    // BATCH: Mark ALL boxes as transferred in ONE query (not one-at-a-time loop!)
    await Promise.all([
        ...stockOps,
        supabase.from('packing_boxes').update({
            is_transferred: true,
            transferred_at: now,
        }).in('id', eligibleBoxIds),
    ]);

    // ── PHASE 4: Compute completion + update status + audit — parallel ──
    const { data: allBoxes } = await supabase.from('packing_boxes')
        .select('box_qty, is_transferred').eq('packing_request_id', requestId);
    const totalBoxQty = (allBoxes || []).reduce((s: number, b: any) => s + Number(b.box_qty), 0);
    const allTransferred = (allBoxes || []).every((b: any) => b.is_transferred);
    const cumulativeTransferredQty = (allBoxes || [])
        .filter((b: any) => b.is_transferred)
        .reduce((s: number, b: any) => s + Number(b.box_qty), 0);
    const isComplete = allTransferred && totalBoxQty >= Number(req.total_packed_qty);
    const newTotalTransferred = cumulativeTransferredQty;

    const newStatus = isComplete ? 'COMPLETED' : 'PARTIALLY_TRANSFERRED';
    const packingIds = eligibleBoxes.map((b: any) => b.packing_id || generatePackingId(b.id));
    const auditAction: PackingAuditAction = isComplete ? 'STOCK_FULL_TRANSFER' : 'STOCK_PARTIAL_TRANSFER';

    // Parallel: update request status + audit log(s)
    const finalOps: any[] = [
        supabase.from('packing_requests').update({
            transferred_qty: newTotalTransferred,
            last_transfer_at: now,
            status: newStatus,
            ...(isComplete ? { completed_at: now } : {}),
        }).eq('id', requestId),
        logAudit(requestId, auditAction, userId, role, {
            transferred_qty: transferQty,
            total_transferred: newTotalTransferred,
            boxes_transferred: eligibleBoxes.length,
            remaining_qty: Number(req.total_packed_qty) - newTotalTransferred,
            movement_number: req.movement_number,
            packing_ids: packingIds.join(', '),
        }),
    ];
    if (isComplete) {
        finalOps.push(logAudit(requestId, 'PACKING_COMPLETED', userId, role, {
            total_packed_qty: Number(req.total_packed_qty),
            boxes_count: (allBoxes || []).length,
            movement_number: req.movement_number,
        }));
    }
    await Promise.all(finalOps);

    return {
        transferredQty: transferQty,
        boxesTransferred: eligibleBoxes.length,
        isComplete,
    };
}

// ============================================================================
// COMPLETE PACKING — Validate all packed + transferred, then finalize
// ============================================================================

export async function completePacking(requestId: string) {
    // Parallel: auth + request + boxes
    const [authCtx, reqResult, boxesResult] = await Promise.all([
        getAuthContext(),
        supabase.from('packing_requests').select('*').eq('id', requestId).single(),
        supabase.from('packing_boxes').select('*').eq('packing_request_id', requestId),
    ]);

    const { userId, role } = authCtx;
    const req = reqResult.data;
    if (!req) throw new Error('Packing request not found');
    if (!['PACKING_IN_PROGRESS', 'PARTIALLY_TRANSFERRED'].includes(req.status)) {
        throw new Error('Can only complete when packing is in progress');
    }

    const boxes = boxesResult.data;
    if (!boxes || boxes.length === 0) throw new Error('No boxes found. Add boxes first.');

    const totalBoxQty = boxes.reduce((s: number, b: any) => s + Number(b.box_qty), 0);
    if (totalBoxQty !== Number(req.total_packed_qty)) {
        throw new Error(`Box total (${totalBoxQty}) does not equal request total (${req.total_packed_qty}).`);
    }

    const unprintedCount = boxes.filter((b: any) => !b.sticker_printed).length;
    if (unprintedCount > 0) {
        throw new Error(`${unprintedCount} box(es) have unprinted stickers. Print all stickers before completing.`);
    }

    // Check for untransferred boxes — if any, transfer them now
    const untransferred = boxes.filter((b: any) => !b.is_transferred);
    if (untransferred.length > 0) {
        await transferPackedStock(requestId, untransferred.map((b: any) => b.id));
    } else {
        // All already transferred — parallel: mark complete + audit
        const actualTransferredQty = boxes.reduce((s: number, b: any) => s + Number(b.box_qty), 0);
        await Promise.all([
            supabase.from('packing_requests').update({
                status: 'COMPLETED',
                completed_at: new Date().toISOString(),
                transferred_qty: actualTransferredQty,
            }).eq('id', requestId),
            logAudit(requestId, 'PACKING_COMPLETED', userId, role, {
                total_packed_qty: Number(req.total_packed_qty),
                boxes_count: boxes.length,
                movement_number: req.movement_number,
            }),
        ]);
    }
}
