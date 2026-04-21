/**
 * packingUtils.ts — Shared utilities for packing edge functions.
 *
 * CRITICAL: This file is a 1:1 Deno-compatible mirror of the client-side
 * functions in `src/utils/idGenerator.ts`. The logic here MUST remain
 * byte-for-byte identical to the client-side version — this file exists
 * ONLY because edge functions cannot import client-side modules.
 *
 * Business logic, formulas, and algorithms are UNCHANGED. This is a
 * pure migration from client-side to server-side.
 *
 * Mirrored from: src/utils/idGenerator.ts (v0.4.1)
 */

// ============================================================================
// UUID GENERATION
// ============================================================================

/**
 * Generate a v4 UUID using the Web Crypto API.
 * Used to pre-assign IDs before database insertion, enabling
 * packing_id computation before the INSERT call.
 *
 * Deno natively supports `crypto.randomUUID()`.
 */
export function generateUUID(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch (_) { /* ignore */ }

  // Fallback: classic v4 UUID using Math.random — works everywhere
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
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
 */
export function generatePackingId(boxUUID: string): string {
  return 'PKG-' + boxUUID.replace(/-/g, '').substring(0, 8).toUpperCase();
}

// ============================================================================
// NUMBERED ID — used for container_number (CTN-YYYYMMDD-XXXXX) and
//               pallet_number (PLT-YYYYMMDD-XXXXX)
// ============================================================================

/**
 * Generate a prefixed numbered ID.
 * Format: {PREFIX}-{YYYYMMDD}-{RANDOM5}
 *
 * @example generateNumber('CTN') → "CTN-20260420-A7B3C"
 * @example generateNumber('PLT') → "PLT-20260420-X9K2M"
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
// MIXED BATCH ID GENERATION (Multi-Pallet Aware)
// ============================================================================

export interface BoxInsertRecord {
  id: string;
  packing_id: string;
  packing_request_id: string;
  box_number: number;
  box_qty: number;
  created_by: string;
  is_transferred: boolean;
  sticker_printed: boolean;
}

/**
 * Pre-generate a mixed batch of box records with BOTH adjustment and normal boxes.
 *
 * Box ordering: ADJUSTMENT BOXES FIRST, then normal inner boxes, then remainder.
 * This ordering is REQUIRED — processPackingBoxAsContainer processes adj boxes
 * first and routes them to ADJUSTMENT_REQUIRED pallets before filling new ones.
 *
 * @param requestId - Packing request ID
 * @param userId - Creator user ID
 * @param innerBoxQty - Standard inner box quantity (e.g., 200 PCS)
 * @param adjustmentBoxCount - Number of adjustment boxes to create
 * @param adjustmentQty - Quantity per adjustment box (e.g., 100 PCS)
 * @param normalFullBoxes - Number of full normal inner boxes
 * @param normalRemainder - Quantity for the last partial box (0 = no partial)
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
): BoxInsertRecord[] {
  const boxes: BoxInsertRecord[] = [];
  let boxNumber = 1;

  // ── STEP 1: Adjustment boxes FIRST ──
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
