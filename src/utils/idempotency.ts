/**
 * idempotency.ts — Safe idempotency key generation for critical operations
 *
 * Every critical operation (PI approval, PI creation, stock transfer) should
 * generate an idempotency key BEFORE calling the RPC. The key is sent to the
 * server and stored in the `idempotency_keys` table. If the same key is sent
 * again (e.g., on retry), the server returns the original result instead of
 * re-executing the operation.
 *
 * Usage:
 *   const key = generateIdempotencyKey();
 *   const result = await supabase.rpc('approve_proforma_invoice', {
 *       p_pi_id: piId,
 *       p_user_id: userId,
 *       p_idempotency_key: key,
 *   });
 */

/**
 * Generate a cryptographically random UUID for use as an idempotency key.
 * Falls back to Math.random-based UUID for environments without crypto.
 */
export function generateIdempotencyKey(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Fallback: RFC4122 v4 UUID using Math.random
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Helper to extract a user-friendly error from an RPC JSONB response or error.
 */
export function extractRpcError(error: any, data: any): string | null {
    if (error) {
        // Supabase wraps PG exceptions in error.message
        const msg = error.message || error.details || 'Unknown RPC error';
        // Strip PG function context noise
        return msg.replace(/^ERROR:\s*/i, '').split('\nCONTEXT:')[0].trim();
    }
    if (data && typeof data === 'object' && data.success === false) {
        return data.error || 'Operation failed';
    }
    return null;
}
