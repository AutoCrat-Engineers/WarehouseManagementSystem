/**
 * packingService.ts — Sticker Generation workflow service (v9).
 *
 * After the sticker-generation migration all of the old v5 workflow
 * helpers (packing-request creation, fetching, start/add/delete box,
 * complete packing) moved fully to edge functions or are no longer
 * reachable from the v9 UI.  The only client-side wrapper that remains
 * is `transferPackedStock`, which is a thin shim over the server-side
 * `sg_transfer-stock` edge function.
 *
 * Business logic, status transitions, and transfer atomicity live
 * server-side.  The browser only makes the single edge function call.
 */
import { generateIdempotencyKey } from '../../utils/idempotency';
import { fetchWithAuth } from '../../utils/supabase/auth';
import { getEdgeFunctionUrl } from '../../utils/supabase/info';

/**
 * Transfer packed (and printed) boxes' stock from Production to FG
 * Warehouse via the `sg_transfer-stock` edge function.  The edge function
 * owns:
 *   - atomic multi-table transaction (BEGIN / COMMIT / ROLLBACK)
 *   - SELECT ... FOR UPDATE row locking
 *   - idempotency enforcement (public.idempotency_keys)
 *   - retry of transient pg errors
 *   - audit logging
 *
 * @param requestId  Packing request ID.
 * @param boxIds     Optional subset of boxes; when empty the function
 *                   transfers ALL untransferred printed boxes.
 * @returns          transferredQty / boxesTransferred / isComplete.
 */
export async function transferPackedStock(
    requestId: string,
    boxIds?: string[],
): Promise<{ transferredQty: number; boxesTransferred: number; isComplete: boolean }> {
    const idempotencyKey = generateIdempotencyKey();

    const res = await fetchWithAuth(getEdgeFunctionUrl('sg_transfer-stock'), {
        method: 'POST',
        body: JSON.stringify({
            request_id: requestId,
            box_ids: boxIds && boxIds.length > 0 ? boxIds : null,
            idempotency_key: idempotencyKey,
        }),
    });
    const data = await res.json();
    if (!res.ok || !data?.success) {
        throw new Error(data?.error || 'Failed to transfer packed stock');
    }

    return {
        transferredQty: data.transferred_qty,
        boxesTransferred: data.boxes_transferred,
        isComplete: data.is_complete,
    };
}
