/**
 * scanQueue — Offline scan persistence + replay.
 *
 * Receivers on a dock often have unreliable WiFi. Rather than failing a scan
 * when the network blips, we:
 *   1. Optimistically push the scan into IndexedDB.
 *   2. Render whatever we can locally (the QR string itself plus any prior
 *      "match" the page already has — see `replayQueuedScans`).
 *   3. When connectivity returns, replay every queued scan through
 *      `resolveQrToPallet`, mark each as resolved (or failed), and emit the
 *      results to the page so it can re-mark pallets as RECEIVED.
 *
 * Why IndexedDB and not localStorage:
 *   - Survives larger payloads (raw QR text can be ~200B; a 50-scan session
 *     stays well under any quota, but localStorage can be ~5MB total per
 *     origin and is shared with everything else in the app).
 *   - Async, doesn't block the main thread when the receiver is rapid-firing
 *     scans on a phone.
 *
 * This module talks to IndexedDB directly (no `idb-keyval` dep) so the PWA
 * surface stays small. The store is per-(user, proforma_invoice, mpl), keyed
 * by an autoincrement id; ordered replay is preserved by `id ASC`.
 */

const DB_NAME    = 'wms-scan-queue';
const DB_VERSION = 1;
const STORE      = 'scans';

export interface QueuedScan {
    id?:                 number;        // autoincrement; assigned by the store
    qr_text:             string;
    proforma_invoice_id: string;
    mpl_id:              string | null;
    queued_at:           number;        // Date.now()
    /** Number of replay attempts that have failed so far. */
    attempts:            number;
}

// ─── Open / migrate the DB ────────────────────────────────────────────

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB not available'));
            return;
        }
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                const s = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
                s.createIndex('by_pi',  'proforma_invoice_id', { unique: false });
                s.createIndex('by_mpl', 'mpl_id',              { unique: false });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror   = () => reject(req.error);
    });
    return dbPromise;
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => Promise<T> | T): Promise<T> {
    const db = await openDb();
    return await new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const s  = tx.objectStore(STORE);
        Promise.resolve()
            .then(() => fn(s))
            .then((value) => {
                tx.oncomplete = () => resolve(value);
                tx.onerror    = () => reject(tx.error);
                tx.onabort    = () => reject(tx.error);
            })
            .catch(reject);
    });
}

function reqAsync<T>(req: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        req.onsuccess = () => resolve(req.result as T);
        req.onerror   = () => reject(req.error);
    });
}

// ─── Public API ───────────────────────────────────────────────────────

/** Append a scan to the offline queue. Returns the assigned id. */
export async function enqueueScan(scan: Omit<QueuedScan, 'id' | 'attempts' | 'queued_at'> & { queued_at?: number }): Promise<number> {
    const row: QueuedScan = {
        qr_text:             scan.qr_text,
        proforma_invoice_id: scan.proforma_invoice_id,
        mpl_id:              scan.mpl_id ?? null,
        queued_at:           scan.queued_at ?? Date.now(),
        attempts:            0,
    };
    return withStore('readwrite', async (s) => {
        const id = await reqAsync<IDBValidKey>(s.add(row));
        return Number(id);
    });
}

/** Read the queue scoped to a specific (proforma, mpl). Sorted oldest-first. */
export async function listQueuedScans(scope: { proformaInvoiceId: string; mplId?: string | null }): Promise<QueuedScan[]> {
    return withStore('readonly', async (s) => {
        const all = await reqAsync<QueuedScan[]>(s.getAll());
        return all
            .filter(r =>
                r.proforma_invoice_id === scope.proformaInvoiceId &&
                (scope.mplId === undefined || r.mpl_id === scope.mplId))
            .sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    });
}

/** Total queued count across all scopes. Cheap; used for the global indicator. */
export async function queuedScanCount(): Promise<number> {
    try {
        return await withStore('readonly', async (s) => reqAsync<number>(s.count()));
    } catch {
        return 0;
    }
}

/** Remove a single queued scan after successful replay. */
export async function removeQueuedScan(id: number): Promise<void> {
    await withStore('readwrite', async (s) => { await reqAsync(s.delete(id)); });
}

/** Bump the attempts counter for an entry that failed to replay. */
export async function bumpQueuedScanAttempts(id: number): Promise<void> {
    await withStore('readwrite', async (s) => {
        const row = await reqAsync<QueuedScan | undefined>(s.get(id));
        if (!row) return;
        row.attempts = (row.attempts ?? 0) + 1;
        await reqAsync(s.put(row));
    });
}

/**
 * Drain the queue for a given scope by replaying each entry through the
 * provided resolver. Resolver outcomes are returned in order so the caller
 * can apply each to local state (mark RECEIVED, log error, etc.).
 *
 * `replay` should be the same function the live scan path uses — typically
 * a thin wrapper around `resolveQrToPallet`. It returns one of:
 *   { ok: true,  apply?: () => void }   → entry removed from queue
 *   { ok: false, retry: true }          → kept; attempts++; we'll try again
 *   { ok: false, retry: false }         → removed; treated as permanently failed
 */
export interface ReplayOutcome {
    ok:    boolean;
    retry: boolean;
}

export async function replayQueuedScans(
    scope: { proformaInvoiceId: string; mplId?: string | null },
    replay: (scan: QueuedScan) => Promise<ReplayOutcome>,
    onProgress?: (done: number, total: number) => void,
): Promise<{ replayed: number; failed: number; remaining: number }> {
    const queue = await listQueuedScans(scope);
    if (queue.length === 0) return { replayed: 0, failed: 0, remaining: 0 };

    let replayed = 0;
    let failed   = 0;
    for (let i = 0; i < queue.length; i++) {
        const entry = queue[i];
        try {
            const result = await replay(entry);
            if (result.ok) {
                if (entry.id != null) await removeQueuedScan(entry.id);
                replayed++;
            } else if (result.retry) {
                if (entry.id != null) await bumpQueuedScanAttempts(entry.id);
                failed++;
            } else {
                if (entry.id != null) await removeQueuedScan(entry.id);
                failed++;
            }
        } catch {
            if (entry.id != null) await bumpQueuedScanAttempts(entry.id);
            failed++;
        }
        onProgress?.(i + 1, queue.length);
    }

    const remaining = (await listQueuedScans(scope)).length;
    return { replayed, failed, remaining };
}
