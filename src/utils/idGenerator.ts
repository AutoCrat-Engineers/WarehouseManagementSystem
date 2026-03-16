/**
 * ID Generation Utilities
 *
 * Centralized ID generation for packing, containers, pallets, and
 * other entities. Supports client-side UUID generation for batch
 * insert optimization (eliminates N+1 update pattern).
 *
 * @version v0.4.1
 */

// ============================================================================
// UUID GENERATION
// ============================================================================

/**
 * Generate a v4 UUID using the Web Crypto API.
 * Used to pre-assign IDs before database insertion, enabling
 * packing_id computation before the INSERT call.
 */
export function generateUUID(): string {
    // Prefer native crypto.randomUUID when available (secure contexts)
    try {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
    } catch (_) { /* ignore */ }

    // Fallback: classic v4 UUID using Math.random — works everywhere
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// ============================================================================
// PACKING ID
// ============================================================================

/**
 * Generate a packing ID from a box UUID.
 * Format: PKG-XXXXXXXX (first 8 hex chars of UUID, uppercase).
 *
 * Note: This is a re-export of the function from types/packing.ts
 * but kept here for module-boundary clarity.
 */
export function generatePackingId(boxUUID: string): string {
    return 'PKG-' + boxUUID.replace(/-/g, '').substring(0, 8).toUpperCase();
}

// ============================================================================
// NUMBERED ID
// ============================================================================

/**
 * Generate a prefixed numbered ID.
 * Format: {PREFIX}-{YYYYMMDD}-{RANDOM5}
 *
 * @example generateNumber('PL')  → "PL-20260306-A7B3C"
 * @example generateNumber('INV') → "INV-20260306-X9K2M"
 */
export function generateNumber(prefix: string): string {
    const d = new Date();
    const date = d.getFullYear().toString() +
        (d.getMonth() + 1).toString().padStart(2, '0') +
        d.getDate().toString().padStart(2, '0');
    const rand = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `${prefix}-${date}-${rand}`;
}

// ============================================================================
// BATCH ID GENERATION
// ============================================================================

/**
 * Pre-generate a batch of box records with UUIDs and packing IDs.
 * Eliminates the N+1 update pattern where boxes are inserted first,
 * then each is updated individually with its packing_id.
 *
 * @param count - Number of boxes to generate
 * @param requestId - Packing request ID
 * @param userId - Creator user ID
 * @param innerBoxQty - Standard box quantity
 * @param remainder - Quantity for the last partial box (0 = no partial)
 *
 * @returns Array of box records ready for bulk INSERT
 */
export function generateBoxBatch(
    count: number,
    requestId: string,
    userId: string,
    innerBoxQty: number,
    remainder: number,
): Array<{
    id: string;
    packing_id: string;
    packing_request_id: string;
    box_number: number;
    box_qty: number;
    created_by: string;
    is_transferred: boolean;
    sticker_printed: boolean;
}> {
    const boxes = [];
    for (let i = 0; i < count; i++) {
        const boxId = generateUUID();
        const isLastPartialBox = (i === count - 1 && remainder > 0);
        boxes.push({
            id: boxId,
            packing_id: generatePackingId(boxId),
            packing_request_id: requestId,
            box_number: i + 1,
            box_qty: isLastPartialBox ? remainder : innerBoxQty,
            created_by: userId,
            is_transferred: false,
            sticker_printed: false,
        });
    }
    return boxes;
}

// ============================================================================
// MIXED BATCH ID GENERATION (Multi-Pallet Aware)
// ============================================================================

/**
 * Pre-generate a mixed batch of box records with BOTH adjustment and normal boxes.
 *
 * CRITICAL: This function replaces generateBoxBatch for the packing engine.
 * The old function naively created boxes all at the same innerBoxQty, which
 * meant ZERO adjustment boxes were ever created when multiple pallets needed
 * completion.
 *
 * Box ordering: ADJUSTMENT BOXES FIRST, then normal inner boxes.
 * This ensures processPackingBoxAsContainer processes adj boxes first
 * and routes them to ADJUSTMENT_REQUIRED pallets before filling new ones.
 *
 * @param requestId - Packing request ID
 * @param userId - Creator user ID
 * @param innerBoxQty - Standard inner box quantity (e.g., 200 PCS)
 * @param adjustmentBoxCount - Number of adjustment boxes to create (for existing ADJUSTMENT_REQUIRED pallets)
 * @param adjustmentQty - Quantity per adjustment box (e.g., 100 PCS)
 * @param normalFullBoxes - Number of full normal inner boxes to create
 * @param normalRemainder - Quantity for the last partial box (0 = no partial)
 *
 * @example
 * // 2 pallets needing adjustment (100 PCS each) + 3 normal boxes (200 PCS each)
 * generateMixedBoxBatch('req-1', 'usr-1', 200, 2, 100, 3, 0)
 * // → [
 * //     { box_number: 1, box_qty: 100 },  // ADJ box for pallet 1
 * //     { box_number: 2, box_qty: 100 },  // ADJ box for pallet 2
 * //     { box_number: 3, box_qty: 200 },  // Normal inner box
 * //     { box_number: 4, box_qty: 200 },  // Normal inner box
 * //     { box_number: 5, box_qty: 200 },  // Normal inner box
 * //   ]
 *
 * @returns Array of box records ready for bulk INSERT
 */
export function generateMixedBoxBatch(
    requestId: string,
    userId: string,
    innerBoxQty: number,
    adjustmentBoxCount: number,
    adjustmentQty: number,
    normalFullBoxes: number,
    normalRemainder: number,
): Array<{
    id: string;
    packing_id: string;
    packing_request_id: string;
    box_number: number;
    box_qty: number;
    created_by: string;
    is_transferred: boolean;
    sticker_printed: boolean;
}> {
    const boxes = [];
    let boxNumber = 1;

    // ── STEP 1: Adjustment boxes FIRST ──
    // These will be processed first by processPackingBoxAsContainer,
    // which detects them by qty (box_qty !== innerQty && box_qty === adjustmentQty)
    // and routes them to ADJUSTMENT_REQUIRED pallets.
    for (let i = 0; i < adjustmentBoxCount; i++) {
        const boxId = generateUUID();
        boxes.push({
            id: boxId,
            packing_id: generatePackingId(boxId),
            packing_request_id: requestId,
            box_number: boxNumber++,
            box_qty: adjustmentQty,
            created_by: userId,
            is_transferred: false,
            sticker_printed: false,
        });
    }

    // ── STEP 2: Normal inner boxes ──
    for (let i = 0; i < normalFullBoxes; i++) {
        const boxId = generateUUID();
        boxes.push({
            id: boxId,
            packing_id: generatePackingId(boxId),
            packing_request_id: requestId,
            box_number: boxNumber++,
            box_qty: innerBoxQty,
            created_by: userId,
            is_transferred: false,
            sticker_printed: false,
        });
    }

    // ── STEP 3: Remainder box (if any) ──
    if (normalRemainder > 0) {
        const boxId = generateUUID();
        boxes.push({
            id: boxId,
            packing_id: generatePackingId(boxId),
            packing_request_id: requestId,
            box_number: boxNumber++,
            box_qty: normalRemainder,
            created_by: userId,
            is_transferred: false,
            sticker_printed: false,
        });
    }

    return boxes;
}
