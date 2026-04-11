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
 *
 * @version v0.4.1 — Performance optimized (batch ID generation, parallel fetches)
 */
import { getSupabaseClient } from '../../utils/supabase/client';
import { isValidTransition, generatePackingId } from '../../types/packing';
import { generateIdempotencyKey, extractRpcError } from '../../utils/idempotency';
import type {
    PackingRequest, PackingBox, PackingAuditLog,
    PackingRequestStatus, PackingAuditAction,
} from '../../types/packing';
import { processPackingBoxAsContainer } from '../packing-engine/packingEngineService';
import { generateBoxBatch, generateMixedBoxBatch } from '../../utils/idGenerator';
import { logInfo, logWarn, logError, withTiming } from '../../utils/auditLogger';
import { getCurrentUserId, getUserRole, getAuthContext } from '../../utils/auth';

const supabase = getSupabaseClient();

// ============================================================================
// HELPERS
// ============================================================================


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

export async function fetchPackingRequests(onlyMine: boolean = false, pageSize: number = 200, offset: number = 0): Promise<PackingRequest[]> {
    const userId = await getCurrentUserId();
    let query = supabase
        .from('packing_requests')
        .select('*')
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1);

    if (onlyMine) query = query.eq('created_by', userId);
    const { data, error } = await query;
    if (error) throw error;
    const rows = data || [];

    // Collect IDs for parallel enrichment
    const userIds = [...new Set(rows.flatMap((r: any) => [r.created_by, r.approved_by].filter(Boolean)))];
    const itemCodes = [...new Set(rows.map((r: any) => r.item_code).filter(Boolean))];
    const requestIds = rows.map((r: any) => r.id);
    const movementHeaderIds = [...new Set(rows.map((r: any) => r.movement_header_id).filter(Boolean))];

    // ── PARALLEL ENRICHMENT — all 5 queries run simultaneously ──
    const [profilesResult, itemsResult, boxesResult, specsResult, headersResult] = await Promise.all([
        userIds.length
            ? supabase.from('profiles').select('id, full_name').in('id', userIds)
            : Promise.resolve({ data: [] as any[] }),
        itemCodes.length
            ? supabase.from('items').select('item_code, item_name, part_number, master_serial_no, revision').in('item_code', itemCodes)
            : Promise.resolve({ data: [] as any[] }),
        requestIds.length
            ? supabase.from('packing_boxes').select('packing_request_id, box_qty, sticker_printed, is_transferred').in('packing_request_id', requestIds)
            : Promise.resolve({ data: [] as any[] }),
        itemCodes.length
            ? supabase.from('packing_specifications').select('item_code, inner_box_quantity').eq('is_active', true).in('item_code', itemCodes)
            : Promise.resolve({ data: [] as any[] }),
        movementHeaderIds.length
            ? supabase.from('inv_movement_headers').select('id, notes').in('id', movementHeaderIds)
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

    // Packing spec map — inner_box_quantity per item_code
    const specMap: Record<string, number> = {};
    (specsResult.data || []).forEach((s: any) => {
        if (s.inner_box_quantity && s.inner_box_quantity > 0) {
            specMap[s.item_code] = s.inner_box_quantity;
        }
    });

    const boxAgg: Record<string, { sum: number; count: number; allPrinted: boolean; transferredSum: number }> = {};
    (boxesResult.data || []).forEach((b: any) => {
        if (!boxAgg[b.packing_request_id]) boxAgg[b.packing_request_id] = { sum: 0, count: 0, allPrinted: true, transferredSum: 0 };
        boxAgg[b.packing_request_id].sum += Number(b.box_qty);
        boxAgg[b.packing_request_id].count += 1;
        if (!b.sticker_printed) boxAgg[b.packing_request_id].allPrinted = false;
        if (b.is_transferred) boxAgg[b.packing_request_id].transferredSum += Number(b.box_qty);
    });

    const headerNotesMap: Record<string, string> = {};
    (headersResult.data || []).forEach((h: any) => {
        if (h.notes) headerNotesMap[h.id] = h.notes;
    });

    return rows.map((r: any) => {
        // Use actual box count from packing_boxes if available,
        // otherwise calculate expected count from movement notes or total / inner_qty
        const actualBoxCount = boxAgg[r.id]?.count ?? 0;
        const innerBoxQty = specMap[r.item_code];

        let expectedBoxes = 0;
        const notes = headerNotesMap[r.movement_header_id];
        if (notes) {
            const adjMatch = notes.match(/Boxes:\s*(\d+)\s*[x×]\s*\d+\s*PCS\/box\s*\+\s*(\d+)\s*(?:Adj|Top-off)\s*Box/i);
            if (adjMatch) {
                expectedBoxes = parseInt(adjMatch[1], 10) + parseInt(adjMatch[2], 10);
            } else {
                const boxMatch = notes.match(/Boxes:\s*(\d+)\s*[x×]\s*\d+\s*PCS\/box\s*=/i);
                if (boxMatch) {
                    expectedBoxes = parseInt(boxMatch[1], 10);
                }
            }
        }

        let calculatedBoxCount = expectedBoxes;
        if (calculatedBoxCount === 0) {
            calculatedBoxCount = innerBoxQty && innerBoxQty > 0
                ? Math.floor(Number(r.total_packed_qty) / innerBoxQty) + (Number(r.total_packed_qty) % innerBoxQty > 0 ? 1 : 0)
                : 0;
        }

        const boxesCount = actualBoxCount > 0 ? actualBoxCount : calculatedBoxCount;

        return {
            ...r,
            created_by_name: nameMap[r.created_by] || undefined,
            approved_by_name: r.approved_by ? nameMap[r.approved_by] : undefined,
            item_name: itemMap[r.item_code]?.item_name || r.item_code,
            part_number: itemMap[r.item_code]?.part_number || null,
            master_serial_no: itemMap[r.item_code]?.master_serial_no || null,
            revision: itemMap[r.item_code]?.revision || null,
            boxes_packed_qty: boxAgg[r.id]?.sum || 0,
            boxes_count: boxesCount,
            all_stickers_printed: boxAgg[r.id]?.allPrinted ?? true,
            // Use actual transferred qty from boxes (source of truth), not the stored field
            transferred_qty: boxAgg[r.id]?.transferredSum ?? (r.transferred_qty || 0),
        };
    });
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

    return withTiming('autoGenerateBoxes', 'PACKING', userId, requestId, async () => {
        // ── PHASE 1: Parallel fetch — auth context already fetched, now get request + boxes + spec ──
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

        // ── PHASE 1b: Fetch FULL packing spec (both inner AND outer qty) ──
        // CRITICAL: We need outer_box_quantity to calculate adjustment boxes
        const { data: packingSpec } = await supabase.from('packing_specifications')
            .select('inner_box_quantity, outer_box_quantity')
            .eq('item_code', req.item_code)
            .eq('is_active', true)
            .single();

        if (!packingSpec || !packingSpec.inner_box_quantity || packingSpec.inner_box_quantity <= 0) {
            throw new Error('No valid packing specification found for this item. Please add one in Packing Details first.');
        }

        const innerBoxQty = packingSpec.inner_box_quantity;
        const outerBoxQty = packingSpec.outer_box_quantity || 0;
        let adjustmentQty = outerBoxQty > 0 ? outerBoxQty % innerBoxQty : 0;
        const totalQty = Number(req.total_packed_qty);

        // ── PHASE 1c: Query for ADJUSTMENT_REQUIRED pallets ──
        // This is the CRITICAL multi-pallet awareness step.
        // We must know how many existing pallets need adjustment boxes
        // BEFORE we create the box batch — otherwise all boxes will be
        // created as inner boxes (200 PCS) and no adjustment boxes (100 PCS)
        // will ever be produced.
        let adjPalletsNeedingCompletion = 0;
        if (adjustmentQty > 0) {
            const { data: adjPallets } = await supabase
                .from('pack_pallets')
                .select('id')
                .eq('item_code', req.item_code)
                .eq('state', 'ADJUSTMENT_REQUIRED');
            adjPalletsNeedingCompletion = adjPallets?.length || 0;
        }

        // ── PHASE 2: Calculate the CORRECT box mix ──
        let explicitNormalFullBoxes = 0;
        let explicitAdjustmentBoxCount = 0;
        let explicitAdjustmentQty = 0;
        let hasExplicitOverrides = false;

        if (req.movement_header_id) {
            const { data: hData } = await supabase.from('inv_movement_headers').select('notes').eq('id', req.movement_header_id).single();
            if (hData && hData.notes) {
                const adjMatch = hData.notes.match(/Boxes:\s*(\d+)\s*[x×]\s*\d+\s*PCS\/box\s*\+\s*(\d+)\s*(?:Adj|Top-off)\s*Box(?:es)?\s*[x×]\s*(\d+)\s*PCS/i);
                if (adjMatch) {
                    explicitNormalFullBoxes = parseInt(adjMatch[1], 10);
                    explicitAdjustmentBoxCount = parseInt(adjMatch[2], 10);
                    explicitAdjustmentQty = parseInt(adjMatch[3], 10);
                    hasExplicitOverrides = true;
                } else {
                    const boxMatch = hData.notes.match(/Boxes:\s*(\d+)\s*[x×]\s*\d+\s*PCS\/box\s*=/i);
                    if (boxMatch) {
                        explicitNormalFullBoxes = parseInt(boxMatch[1], 10);
                        hasExplicitOverrides = true;
                    }
                }
            }
        }

        let adjustmentBoxCount = 0;
        let normalFullBoxes = 0;
        let normalRemainder = 0;

        if (hasExplicitOverrides) {
            adjustmentBoxCount = explicitAdjustmentBoxCount;
            if (explicitAdjustmentQty > 0) adjustmentQty = explicitAdjustmentQty;
            normalFullBoxes = explicitNormalFullBoxes;

            const calculatedExplicitTotal = (adjustmentBoxCount * adjustmentQty) + (normalFullBoxes * innerBoxQty);
            if (totalQty > calculatedExplicitTotal) {
                normalRemainder = totalQty - calculatedExplicitTotal;
            }
        } else {
            adjustmentBoxCount = Math.min(
                adjPalletsNeedingCompletion,
                adjustmentQty > 0 ? Math.floor(totalQty / adjustmentQty) : 0,
            );
            const adjustmentTotal = adjustmentBoxCount * adjustmentQty;
            const remainingQty = totalQty - adjustmentTotal;
            normalFullBoxes = Math.floor(remainingQty / innerBoxQty);
            normalRemainder = remainingQty % innerBoxQty;
        }

        const totalBoxes = adjustmentBoxCount + normalFullBoxes + (normalRemainder > 0 ? 1 : 0);

        if (totalBoxes <= 0) throw new Error('Cannot generate boxes — total quantity is 0');

        logInfo('PACKING', 'boxMixCalculated', userId, requestId, {
            totalQty, innerBoxQty, outerBoxQty, adjustmentQty,
            adjPalletsNeedingCompletion, adjustmentBoxCount,
            normalFullBoxes, normalRemainder, totalBoxes,
        });

        // ── PHASE 3: Status transition + audit (parallel) ──
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
                adjustment_boxes: adjustmentBoxCount,
                adjustment_qty: adjustmentQty,
            }),
        ]);

        // ── PHASE 4: BATCH INSERT with correct box mix ──
        // Creates adjustment boxes FIRST (so they are processed first in Phase 5),
        // then normal inner boxes, then any remainder box.
        const boxInserts = generateMixedBoxBatch(
            requestId, userId, innerBoxQty,
            adjustmentBoxCount, adjustmentQty,
            normalFullBoxes, normalRemainder,
        );

        const { data: insertedBoxes, error: insertError } = await supabase
            .from('packing_boxes')
            .insert(boxInserts)
            .select();
        if (insertError) throw insertError;

        // Map inserted boxes with packing IDs (already computed)
        const createdBoxes: PackingBox[] = (insertedBoxes || []).map((box: any, idx: number) => ({
            ...box,
            packing_id: boxInserts[idx]?.packing_id || generatePackingId(box.id),
        }));

        logInfo('PACKING', 'batchBoxInsert', userId, requestId, {
            total_boxes: totalBoxes,
            inner_box_qty: innerBoxQty,
            adjustment_boxes: adjustmentBoxCount,
        });

        // ── PHASE 5: PACKING ENGINE — Create containers + assign to pallets ──
        // Boxes are ordered: adjustment boxes FIRST, then normal.
        // processPackingBoxAsContainer detects adjustment boxes by their qty
        // (box_qty !== innerQty && box_qty === adjustmentQty) and routes them
        // to ADJUSTMENT_REQUIRED pallets.
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
                        logInfo('CONTAINER', 'containerAssigned', userId, box.id, {
                            box_number: box.box_number,
                            box_qty: box.box_qty,
                            is_adjustment: box.box_qty === adjustmentQty && adjustmentQty > 0,
                            container: result.container.container_number,
                            pallet: result.pallet.pallet_number,
                            pallet_state: result.pallet.state,
                        });
                    } catch (boxErr: any) {
                        logWarn('CONTAINER', 'containerFailed', userId, box.id, {
                            box_number: box.box_number,
                            box_qty: box.box_qty,
                            error: boxErr.message,
                        });
                    }
                }
            }
        } catch (engineErr: any) {
            logError('PACKING', 'batchContainerCreation', userId, requestId, {
                error: engineErr.message,
            });
        }

        // Audit — log auto-generation
        await logAudit(requestId, 'BOX_CREATED', userId, role, {
            auto_generated: true,
            total_boxes: totalBoxes,
            adjustment_boxes: adjustmentBoxCount,
            inner_box_qty: innerBoxQty,
            adjustment_qty: adjustmentQty,
            total_qty: totalQty,
            movement_number: req.movement_number,
        });

        return createdBoxes;
    });
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
/**
 * Transfer packed (and printed) boxes' stock from Production to FG Warehouse.
 * Can be called for partial transfers (some boxes) or full transfer (all boxes).
 *
 * ═══ PRODUCTION-GRADE ═══
 * Now uses atomic RPC: transfer_packed_stock
 * All stock credits, box marking, completion detection, and audit logging
 * happen inside a single Postgres transaction with SELECT FOR UPDATE locking.
 *
 * @param requestId - Packing request ID
 * @param boxIds - Optional array of specific box IDs to transfer. If empty, transfers ALL untransferred printed boxes.
 */
export async function transferPackedStock(
    requestId: string,
    boxIds?: string[]
): Promise<{ transferredQty: number; boxesTransferred: number; isComplete: boolean }> {
    const { userId } = await getAuthContext();
    const idempotencyKey = generateIdempotencyKey();

    const { data, error } = await supabase.rpc('transfer_packed_stock', {
        p_request_id: requestId,
        p_box_ids: boxIds && boxIds.length > 0 ? boxIds : null,
        p_user_id: userId,
        p_idempotency_key: idempotencyKey,
    });

    const rpcError = extractRpcError(error, data);
    if (rpcError) throw new Error(rpcError);

    return {
        transferredQty: data.transferred_qty,
        boxesTransferred: data.boxes_transferred,
        isComplete: data.is_complete,
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
