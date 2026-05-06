/**
 * sg_transfer-stock — Edge Function
 *
 * 1:1 BEHAVIOURAL PORT of the `transfer_packed_stock` PL/pgSQL function.
 * Every step, every SQL statement, every best-effort-swallow, every status
 * branch is a direct translation of the RPC body — with ONE bug fixed:
 * the `p_idempotency_key` parameter was declared but never used in the
 * RPC; this edge function actually enforces it.
 *
 * WHY AN EDGE FUNCTION (not RPC)
 *   The user is migrating everything client→server to edge functions.
 *   Atomicity is preserved by connecting to Postgres directly via the
 *   wire protocol (deno-postgres) and issuing explicit BEGIN / COMMIT /
 *   ROLLBACK — the Supabase JS client / PostgREST cannot do multi-
 *   statement transactions.
 *
 * WHAT IS 100% IDENTICAL TO THE RPC
 *   • SELECT ... FOR UPDATE on packing_requests (same row lock)
 *   • Allowed statuses:  PACKING_IN_PROGRESS | PARTIALLY_TRANSFERRED | APPROVED
 *   • Destination warehouse lookup   (inv_warehouses × inv_warehouse_types, category='PRODUCTION')
 *   • Box eligibility filter         (sticker_printed && !is_transferred [&& id ANY p_box_ids])
 *   • FOR UPDATE loop + per-box UPDATE (is_transferred=true, transferred_at=now())
 *   • Warehouse stock UPSERT         (UPDATE if exists, INSERT if not)
 *   • Stock-ledger INSERT            (best-effort — swallowed on error, matches RPC's `EXCEPTION WHEN OTHERS THEN NULL`)
 *   • packing_requests status CASE   (COMPLETED when transferred_qty ≥ total_packed_qty, else PARTIALLY_TRANSFERRED)
 *   • Completion count               (total boxes vs transferred boxes)
 *   • Audit log INSERT               (action_type='STOCK_TRANSFERRED', role='L2', best-effort)
 *   • Return shape                   ({ success, transferred_qty, boxes_transferred, is_complete })
 *
 * WHAT CHANGES (behaviour improvement, NOT logic change)
 *   • Idempotency key is now enforced via a dedicated key table.
 *     Replay attacks / network retries with the same key return the
 *     SAME stored result without re-executing the transfer.
 *   • Transient errors (deadlock, serialization failure, connection blip)
 *     auto-retry up to 3 times with exponential backoff (50 / 150 / 450 ms).
 *     User-visible errors (validation, not-found) fail immediately.
 *
 * REQUIRED ONE-TIME DDL (run in Supabase SQL editor):
 *   -- Reuses the existing `public.idempotency_keys` table.  The only
 *   -- missing piece is a unique index enabling atomic claim via
 *   -- INSERT ON CONFLICT:
 *   CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_key_operation_uidx
 *     ON public.idempotency_keys (idempotency_key, operation_type);
 *
 * Uses SUPABASE_DB_URL secret (already present in the project) for the
 * direct Postgres connection.  Pool size is kept small (3) because edge
 * function instances are short-lived — we rely on the Supabase pooler.
 */
import { Pool } from 'https://deno.land/x/postgres@v0.19.3/mod.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders } from '../_shared/cors.ts';
import { requireActiveSession, withTransactionLock } from '../_shared/session.ts';

// ────────────────────────────────────────────────────────────────────────
// Pool (module-level so warm invocations reuse connections)
// ────────────────────────────────────────────────────────────────────────
const DB_URL = Deno.env.get('SUPABASE_DB_URL')!;
const POOL_SIZE = 3;
const pgPool = new Pool(DB_URL, POOL_SIZE, true /* lazy */);

// SQLSTATEs that indicate transient failures safe to retry.
// 40001 = serialization_failure, 40P01 = deadlock_detected,
// 08xxx = connection exceptions.
const RETRYABLE_SQLSTATES = new Set<string>([
  '40001', '40P01', '08000', '08003', '08006', '08001', '08004', '57P03',
]);
const MAX_RETRIES = 3;

// ────────────────────────────────────────────────────────────────────────
// Request/response shapes
// ────────────────────────────────────────────────────────────────────────
interface TransferBody {
  request_id: string;
  box_ids?: string[] | null;
  idempotency_key: string;
}

interface TransferResult {
  success: true;
  transferred_qty: number;
  boxes_transferred: number;
  is_complete: boolean;
}

// ────────────────────────────────────────────────────────────────────────
// Handler
// ────────────────────────────────────────────────────────────────────────
export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── AUTH ─────────────────────────────────────────────────────────
    const session = await requireActiveSession(req);
    if (!session.ok) return session.response;
    const ctx = session.ctx;
    const supabaseClient = ctx.db;
    const user = { id: ctx.userId };
    const userId = ctx.userId;

    // ── BODY ─────────────────────────────────────────────────────────
    const body: TransferBody = await req.json().catch(() => ({} as any));

    return await withTransactionLock(ctx, {
      key:   `transferring_stock:${ctx.sessionId}`,
      label: 'Transferring Stock',
    }, async () => {
    const requestId = body.request_id;
    const idempotencyKey = body.idempotency_key;
    const boxIds =
      Array.isArray(body.box_ids) && body.box_ids.length > 0 ? body.box_ids : null;

    if (!requestId) return json({ error: 'request_id is required' }, 400);
    if (!idempotencyKey) return json({ error: 'idempotency_key is required' }, 400);

    // ── EXECUTE (with auto-retry on transient failures) ──────────────
    const result = await runTransferWithRetry(requestId, boxIds, userId, idempotencyKey);
    return json(result);
    });
  } catch (err: any) {
    console.error('[sg_transfer-stock] Error:', err?.message || err);
    return json({ error: err?.message || 'Internal server error' }, 500);
  }
}

// ────────────────────────────────────────────────────────────────────────
// Retry wrapper — handles transient pg errors only.  Non-transient errors
// (validation, not-found, etc.) propagate immediately.
// ────────────────────────────────────────────────────────────────────────
async function runTransferWithRetry(
  requestId: string,
  boxIds: string[] | null,
  userId: string,
  idempotencyKey: string,
): Promise<TransferResult> {
  let attempt = 0;
  let lastErr: any;
  while (attempt <= MAX_RETRIES) {
    try {
      return await runTransferTx(requestId, boxIds, userId, idempotencyKey);
    } catch (err: any) {
      lastErr = err;
      const code: string | undefined = err?.fields?.code || err?.code;
      if (attempt < MAX_RETRIES && code && RETRYABLE_SQLSTATES.has(code)) {
        const delay = 50 * Math.pow(3, attempt); // 50ms, 150ms, 450ms
        await new Promise((r) => setTimeout(r, delay));
        attempt += 1;
        continue;
      }
      throw err;
    }
  }
  throw lastErr;
}

// ────────────────────────────────────────────────────────────────────────
// Core transaction — exact port of the RPC body.
// All mutations + idempotency row are inside ONE Postgres transaction.
// Any error between BEGIN and COMMIT triggers ROLLBACK, reverting every
// write performed during this attempt.
// ────────────────────────────────────────────────────────────────────────
async function runTransferTx(
  requestId: string,
  boxIds: string[] | null,
  userId: string,
  idempotencyKey: string,
): Promise<TransferResult> {
  const client = await pgPool.connect();
  try {
    await client.queryArray('BEGIN');

    // ── IDEMPOTENCY: claim the key or return the prior result ──────
    // Uses the existing `public.idempotency_keys` table (shared across
    // operations via `operation_type`).  INSERT ON CONFLICT on the
    // (idempotency_key, operation_type) unique index is the atomic claim.
    //
    // Status transitions (all within this one transaction):
    //   new row  → status='PROCESSING'    (we own it; proceed)
    //   conflict & status='SUCCESS'        → return stored result_data
    //   conflict & status='FAILED'         → surface the stored error
    //   conflict & status='PROCESSING'     → another attempt is in-flight;
    //                                        return 409-style conflict and let
    //                                        the caller retry (the in-flight
    //                                        attempt will finish + unblock).
    const claim = await client.queryObject<{ id: string }>({
      text: `INSERT INTO public.idempotency_keys
               (idempotency_key, operation_type, entity_id, status, created_by)
             VALUES ($1::uuid, 'TRANSFER_PACKED_STOCK', $2::uuid, 'PROCESSING', $3::uuid)
             ON CONFLICT (idempotency_key, operation_type) DO NOTHING
             RETURNING id`,
      args: [idempotencyKey, requestId, userId],
    });

    if (claim.rows.length === 0) {
      // Replay — inspect the existing row.
      const existing = await client.queryObject<{
        status: string;
        result_data: TransferResult | null;
        error_message: string | null;
      }>({
        text: `SELECT status, result_data, error_message
               FROM public.idempotency_keys
               WHERE idempotency_key = $1::uuid AND operation_type = $2::text`,
        args: [idempotencyKey, 'TRANSFER_PACKED_STOCK'],
      });
      await client.queryArray('COMMIT');
      const row = existing.rows[0];
      if (!row) {
        // Extremely rare: row was deleted by retention between INSERT conflict
        // and SELECT.  Treat as a fresh request — surface so caller retries.
        throw new Error('Idempotency record vanished — please retry');
      }
      if (row.status === 'SUCCESS' && row.result_data) {
        return row.result_data as TransferResult;
      }
      if (row.status === 'FAILED') {
        throw new Error(row.error_message || 'Previous attempt failed');
      }
      // PROCESSING — another in-flight attempt owns the key.
      throw new Error('Duplicate request in progress — please retry shortly');
    }

    const idempotencyRowId = claim.rows[0].id;

    // ── 1. Lock packing request ─────────────────────────────────────
    const reqRows = await client.queryObject<{
      id: string;
      status: string;
      item_code: string | null;
      transferred_qty: number | null;
      total_packed_qty: number;
      movement_number: string | null;
    }>({
      text: `SELECT id, status, item_code, transferred_qty, total_packed_qty, movement_number
             FROM packing_requests WHERE id = $1::uuid FOR UPDATE`,
      args: [requestId],
    });
    if (reqRows.rows.length === 0) throw new Error('Packing request not found');
    const reqRow = reqRows.rows[0];

    if (!['PACKING_IN_PROGRESS', 'PARTIALLY_TRANSFERRED', 'APPROVED'].includes(reqRow.status)) {
      throw new Error(`Cannot transfer stock from status: ${reqRow.status}`);
    }

    // ── 2. Destination warehouse (category='PRODUCTION') ────────────
    const whRows = await client.queryObject<{ id: string }>({
      text: `SELECT w.id FROM inv_warehouses w
             JOIN inv_warehouse_types wt ON w.warehouse_type_id = wt.id
             WHERE wt.category = 'PRODUCTION' AND w.is_active = true
             LIMIT 1`,
      args: [],
    });
    if (whRows.rows.length === 0) throw new Error('FG/Production Warehouse not found');
    const fgWarehouseId = whRows.rows[0].id;

    // ── 3. Eligible boxes (FOR UPDATE) + per-box mark transferred ───
    const boxesQuery = boxIds
      ? {
          text: `SELECT id, box_qty::integer AS qty FROM packing_boxes
                 WHERE packing_request_id = $1::uuid
                   AND sticker_printed = true
                   AND is_transferred = false
                   AND id = ANY($2::uuid[])
                 ORDER BY box_number FOR UPDATE`,
          args: [requestId, boxIds] as unknown[],
        }
      : {
          text: `SELECT id, box_qty::integer AS qty FROM packing_boxes
                 WHERE packing_request_id = $1::uuid
                   AND sticker_printed = true
                   AND is_transferred = false
                 ORDER BY box_number FOR UPDATE`,
          args: [requestId] as unknown[],
        };
    const eligibleBoxes = await client.queryObject<{ id: string; qty: number }>(boxesQuery);

    let totalQty = 0;
    let boxesCount = 0;
    for (const box of eligibleBoxes.rows) {
      await client.queryArray({
        text: `UPDATE packing_boxes
               SET is_transferred = true, transferred_at = now()
               WHERE id = $1::uuid`,
        args: [box.id],
      });
      totalQty += Number(box.qty);
      boxesCount += 1;
    }

    // ── 4. Credit destination warehouse (UPSERT) + ledger ───────────
    let quantityBefore = 0;
    let quantityAfter = totalQty;
    if (totalQty > 0 && reqRow.item_code) {
      const stockRows = await client.queryObject<{ id: string; quantity_on_hand: number }>({
        text: `SELECT id, quantity_on_hand FROM inv_warehouse_stock
               WHERE warehouse_id = $1::uuid AND item_code = $2::text FOR UPDATE`,
        args: [fgWarehouseId, reqRow.item_code],
      });

      if (stockRows.rows.length > 0) {
        quantityBefore = Number(stockRows.rows[0].quantity_on_hand);
        quantityAfter = quantityBefore + totalQty;
        await client.queryArray({
          text: `UPDATE inv_warehouse_stock
                 SET quantity_on_hand = $1::integer,
                     last_receipt_date = now(),
                     updated_at = now(),
                     updated_by = $2::uuid
                 WHERE id = $3::uuid`,
          args: [quantityAfter, userId, stockRows.rows[0].id],
        });
      } else {
        quantityBefore = 0;
        quantityAfter = totalQty;
        await client.queryArray({
          text: `INSERT INTO inv_warehouse_stock
                 (warehouse_id, item_code, quantity_on_hand,
                  last_receipt_date, created_by, updated_by)
                 VALUES ($1::uuid, $2::text, $3::integer, now(), $4::uuid, $4::uuid)`,
          args: [fgWarehouseId, reqRow.item_code, totalQty, userId],
        });
      }

      // Ledger — best-effort.  Matches RPC's `EXCEPTION WHEN OTHERS THEN NULL`.
      // NB: we use a SAVEPOINT so a ledger failure doesn't abort the whole tx.
      await client.queryArray('SAVEPOINT ledger_sp');
      try {
        await client.queryArray({
          text: `INSERT INTO inv_stock_ledger
                 (warehouse_id, item_code, transaction_type,
                  quantity_change, quantity_before, quantity_after,
                  reference_type, reference_id, notes, created_by)
                 VALUES ($1::uuid, $2::text, 'TRANSFER_IN', $3::integer, $4::integer, $5::integer,
                         'PACKING_TRANSFER', $6::uuid, $7::text, $8::uuid)`,
          args: [
            fgWarehouseId,
            reqRow.item_code,
            totalQty,
            quantityBefore,
            quantityAfter,
            requestId,
            `Packed stock: ${totalQty} units (${boxesCount} boxes) to FG | MOV: ${reqRow.movement_number ?? ''}`,
            userId,
          ],
        });
        await client.queryArray('RELEASE SAVEPOINT ledger_sp');
      } catch (ledgerErr) {
        console.warn('[sg_transfer-stock] ledger insert failed (swallowed):', (ledgerErr as any)?.message);
        await client.queryArray('ROLLBACK TO SAVEPOINT ledger_sp');
      }
    }

    // ── 5. Update packing request status / counters ─────────────────
    const newTransferredQty = Number(reqRow.transferred_qty ?? 0) + totalQty;
    await client.queryArray({
      text: `UPDATE packing_requests SET
               transferred_qty  = $1::integer,
               last_transfer_at = now(),
               status = CASE
                          WHEN $1::integer >= total_packed_qty THEN 'COMPLETED'
                          ELSE 'PARTIALLY_TRANSFERRED'
                        END,
               completed_at = CASE
                          WHEN $1::integer >= total_packed_qty THEN now()
                          ELSE completed_at
                        END
             WHERE id = $2::uuid`,
      args: [newTransferredQty, requestId],
    });

    // ── 6. Completion check (total vs transferred boxes) ────────────
    const totalBoxesR = await client.queryObject<{ cnt: number }>({
      text: `SELECT count(*)::integer AS cnt FROM packing_boxes WHERE packing_request_id = $1::uuid`,
      args: [requestId],
    });
    const transferredBoxesR = await client.queryObject<{ cnt: number }>({
      text: `SELECT count(*)::integer AS cnt FROM packing_boxes
             WHERE packing_request_id = $1::uuid AND is_transferred = true`,
      args: [requestId],
    });
    const allBoxes = Number(totalBoxesR.rows[0].cnt);
    const allTransferred = Number(transferredBoxesR.rows[0].cnt);
    const isComplete = allBoxes === allTransferred && allBoxes > 0;

    // ── 7. Audit log — best-effort (SAVEPOINT same as ledger) ───────
    await client.queryArray('SAVEPOINT audit_sp');
    try {
      await client.queryArray({
        text: `INSERT INTO packing_audit_logs
               (packing_request_id, action_type, performed_by, role, metadata)
               VALUES ($1::uuid, 'STOCK_TRANSFERRED', $2::uuid, 'L2', $3::jsonb)`,
        args: [
          requestId,
          userId,
          JSON.stringify({
            transferred_qty: totalQty,
            boxes_transferred: boxesCount,
            is_complete: isComplete,
            item_code: reqRow.item_code,
          }),
        ],
      });
      await client.queryArray('RELEASE SAVEPOINT audit_sp');
    } catch (auditErr) {
      console.warn('[sg_transfer-stock] audit insert failed (swallowed):', (auditErr as any)?.message);
      await client.queryArray('ROLLBACK TO SAVEPOINT audit_sp');
    }

    // ── 8. Persist result against idempotency key, then COMMIT ──────
    const result: TransferResult = {
      success: true,
      transferred_qty: totalQty,
      boxes_transferred: boxesCount,
      is_complete: isComplete,
    };
    await client.queryArray({
      text: `UPDATE public.idempotency_keys
             SET status = 'SUCCESS',
                 result_data = $1::jsonb,
                 completed_at = now()
             WHERE id = $2::uuid`,
      args: [JSON.stringify(result), idempotencyRowId],
    });

    await client.queryArray('COMMIT');
    return result;
  } catch (err: any) {
    // ROLLBACK the whole transaction — including the PROCESSING claim row
    // so the caller can retry with the same key cleanly.
    try { await client.queryArray('ROLLBACK'); } catch { /* ignore */ }
    throw err;
  } finally {
    client.release();
  }
}

// ────────────────────────────────────────────────────────────────────────
// Tiny helper
// ────────────────────────────────────────────────────────────────────────
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

if (import.meta.main) Deno.serve(handler);
