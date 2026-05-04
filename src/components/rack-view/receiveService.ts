/**
 * receiveService — client wrappers for the inbound-receiving edge functions.
 *
 * Surfaces:
 *   - resolveQrToPallet                     scan-driven verification (Step 1)
 *   - loadDraft / saveDraft / discardDraft  draft autosave (Step 2)
 *   - useGrDraftAutosave                    React hook for the autosave loop
 *   - REASON_CODES + uploadExceptionPhoto + getPhotoSignedUrl  exception capture (3b.2)
 *
 * One module so the Receive screen has a single import surface.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchWithAuth } from '../../utils/supabase/auth';
import { getEdgeFunctionUrl } from '../../utils/supabase/info';
import { getSupabaseClient } from '../../utils/supabase/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedPallet {
    pallet_id:        string;
    pallet_number:    string | null;
    mpl_id:           string | null;
    mpl_number:       string | null;
    shipment_id:      string | null;
    shipment_number:  string | null;
    part_number:      string | null;
    item_name:        string | null;
    msn_code:         string | null;
    expected_qty:     number;
    container_count:  number;
    state:            string | null;
    payload_version:  1 | 2;
}

/**
 * Discriminated result for QR resolution. The Verify UI branches on `kind`
 * to render scan feedback (success beep, ambiguity prompt, wrong-shipment
 * toast, unparseable error) without parsing edge-function error codes.
 */
export type ResolveQrResult =
    | { kind: 'ok';              pallet: ResolvedPallet }
    | { kind: 'not_found';       message: string }
    | { kind: 'wrong_shipment';  message: string; shipment_id: string | null; shipment_number: string | null }
    | { kind: 'ambiguous';       message: string; candidate_count: number }
    | { kind: 'invalid';         message: string }
    | { kind: 'error';           message: string };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface EdgeError {
    code?: string;
    message?: string;
    details?: any;
}

async function postEdge(name: string, body: unknown): Promise<{ status: number; json: any }> {
    const res = await fetchWithAuth(getEdgeFunctionUrl(name), {
        method: 'POST',
        body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
}

// ---------------------------------------------------------------------------
// resolveQrToPallet
// ---------------------------------------------------------------------------

export interface ResolveQrParams {
    /** Raw scanner output. Pass exactly what the scanner returned — newlines preserved. */
    qrText: string;
    /** Optional: scope to the active receive session. Wrong-shipment scans become a typed result. */
    proformaInvoiceId?: string;
}

/**
 * Resolve a scanned QR string to a pallet record + receive context.
 * Never throws for expected scan errors (not-found, wrong-shipment, ambiguous,
 * unparseable). Only throws on network / 5xx failures.
 */
export async function resolveQrToPallet(params: ResolveQrParams): Promise<ResolveQrResult> {
    const trimmed = params.qrText?.trim() ?? '';
    if (!trimmed) {
        return { kind: 'invalid', message: 'Empty scan.' };
    }

    let result: { status: number; json: any };
    try {
        result = await postEdge('pallet_resolve_qr', {
            qr_text:             trimmed,
            proforma_invoice_id: params.proformaInvoiceId ?? null,
        });
    } catch (e: any) {
        return { kind: 'error', message: e?.message ?? 'Network error during scan resolution.' };
    }

    const { status, json } = result;

    if (status === 200 && json?.pallet) {
        return { kind: 'ok', pallet: json.pallet as ResolvedPallet };
    }

    const err: EdgeError = json?.error ?? {};
    const message = err.message || 'Could not resolve scan.';

    switch (err.code) {
        case 'NOT_FOUND':
            return { kind: 'not_found', message };
        case 'CONFLICT':
            return {
                kind: 'ambiguous',
                message,
                candidate_count: Number(err.details?.candidate_count ?? 0),
            };
        case 'INVALID_STATE_TRANSITION':
            return {
                kind: 'wrong_shipment',
                message,
                shipment_id:     err.details?.scanned_shipment_id ?? null,
                shipment_number: err.details?.scanned_shipment_number ?? null,
            };
        case 'VALIDATION_FAILED':
            return { kind: 'invalid', message };
        default:
            return { kind: 'error', message };
    }
}

// ---------------------------------------------------------------------------
// Drafts (autosave) — Step 2
// ---------------------------------------------------------------------------

/**
 * Wire-format payload of a draft. The receive screen owns the schema; the
 * server only persists/returns it. Keep additive — old clients should ignore
 * unknown keys without crashing.
 */
export interface GrDraftPayload {
    /** Per-pallet verification state. Keyed by pallet_id, not array, so
     *  partial updates are easy and order-independent. */
    lines: Record<string, GrDraftLine>;
    /** Free-text MPL note. */
    notes: string;
    /** Append-only scan log; bounded client-side to avoid unbounded growth. */
    scan_log?: GrDraftScanEntry[];
}

export interface GrDraftLine {
    line_status:      'PENDING' | 'RECEIVED' | 'MISSING' | 'DAMAGED';
    received_qty:     number;
    discrepancy_note: string | null;
    reason_code:      string | null;
    photo_urls:       string[];
}

export interface GrDraftScanEntry {
    at:        string;                                   // ISO timestamp
    pallet_id: string | null;
    result:    'ok' | 'duplicate' | 'wrong_mpl' | 'unknown';
}

export interface GrDraftRecord {
    id:           string;
    version:      number;
    payload:      GrDraftPayload;
    updated_at:   string;
    warehouse_id: string | null;
}

export interface DraftScope {
    proformaInvoiceId: string;
    mplId:             string;
}

export async function loadDraft(scope: DraftScope): Promise<GrDraftRecord | null> {
    const { status, json } = await postEdge('gr_draft_load', {
        proforma_invoice_id: scope.proformaInvoiceId,
        mpl_id:              scope.mplId,
    });
    if (status === 200) return (json?.draft ?? null) as GrDraftRecord | null;
    throw new Error(json?.error?.message || `gr_draft_load failed (${status})`);
}

export interface SaveDraftParams extends DraftScope {
    /** Last version received from the server. Use 0 for the very first save. */
    expectedVersion: number;
    payload:         GrDraftPayload;
    warehouseId?:    string | null;
}

export interface SaveDraftSuccess {
    kind:       'ok';
    id:         string;
    version:    number;
    updated_at: string;
}
export interface SaveDraftConflict {
    kind:            'conflict';
    message:         string;
    current_version: number | null;
}
export interface SaveDraftError {
    kind:    'error';
    message: string;
}
export type SaveDraftResult = SaveDraftSuccess | SaveDraftConflict | SaveDraftError;

export async function saveDraft(params: SaveDraftParams): Promise<SaveDraftResult> {
    let result: { status: number; json: any };
    try {
        result = await postEdge('gr_draft_save', {
            proforma_invoice_id: params.proformaInvoiceId,
            mpl_id:              params.mplId,
            warehouse_id:        params.warehouseId ?? null,
            payload:             params.payload,
            expected_version:    params.expectedVersion,
        });
    } catch (e: any) {
        return { kind: 'error', message: e?.message ?? 'Network error during draft save.' };
    }

    const { status, json } = result;
    if (status === 200 && json?.draft) {
        return {
            kind:       'ok',
            id:         json.draft.id,
            version:    Number(json.draft.version),
            updated_at: String(json.draft.updated_at),
        };
    }
    const err: EdgeError = json?.error ?? {};
    if (err.code === 'CONCURRENT_MODIFICATION') {
        return {
            kind:            'conflict',
            message:         err.message ?? 'Draft was modified elsewhere.',
            current_version: err.details?.current_version ?? null,
        };
    }
    return { kind: 'error', message: err.message || `gr_draft_save failed (${status})` };
}

export async function discardDraft(scope: DraftScope): Promise<boolean> {
    const { status, json } = await postEdge('gr_draft_discard', {
        proforma_invoice_id: scope.proformaInvoiceId,
        mpl_id:              scope.mplId,
    });
    if (status !== 200) {
        throw new Error(json?.error?.message || `gr_draft_discard failed (${status})`);
    }
    return Boolean(json?.discarded);
}

// ---------------------------------------------------------------------------
// useGrDraftAutosave — React hook
// ---------------------------------------------------------------------------

export type AutosaveStatus =
    | 'idle'        // no scope yet
    | 'loading'     // initial load in flight
    | 'restored'    // initial load returned an existing draft
    | 'saving'      // save request in flight
    | 'saved'       // save succeeded; nothing pending
    | 'dirty'       // local changes pending debounce
    | 'conflict'    // version race; UI should prompt to reload
    | 'error';      // transient network / server error

export interface UseGrDraftAutosaveOptions {
    scope: DraftScope | null;
    /** Current payload from the screen state. Pass a stable reference each render. */
    payload: GrDraftPayload | null;
    /** Debounce window before flushing to the server. Default 800ms. */
    debounceMs?: number;
    /** Persist warehouse id alongside draft (so resume on a different machine knows). */
    warehouseId?: string | null;
    /** Skip autosave entirely (e.g. while initial load is still pending). */
    enabled?: boolean;
}

export interface UseGrDraftAutosaveReturn {
    status:        AutosaveStatus;
    /** ISO timestamp from the last successful save, for the "Saved 2s ago" label. */
    lastSavedAt:   string | null;
    /** Restored draft, if any, surfaced once on initial load. Cleared after consume. */
    restored:      GrDraftRecord | null;
    consumeRestored: () => void;
    /** Force a flush right now (e.g. on submit, before discarding). */
    flush:         () => Promise<void>;
    /** Discard server-side draft (called after successful confirm). */
    discard:       () => Promise<void>;
    /** Last error message, if status === 'error' or 'conflict'. */
    error:         string | null;
}

/**
 * Manages: initial load → expose `restored` once → debounced autosave on
 * payload change → conflict / error reporting → manual flush + discard.
 *
 * Concurrency: serializes saves. If a save is in flight when payload changes
 * again, the next save uses the version returned by the in-flight save —
 * so the version chain stays correct even under rapid edits.
 */
export function useGrDraftAutosave(opts: UseGrDraftAutosaveOptions): UseGrDraftAutosaveReturn {
    const { scope, payload, warehouseId = null } = opts;
    const debounceMs = opts.debounceMs ?? 800;
    const enabled = opts.enabled !== false;

    const [status, setStatus] = useState<AutosaveStatus>('idle');
    const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
    const [restored, setRestored] = useState<GrDraftRecord | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Refs we don't want to re-render on
    const versionRef = useRef<number>(0);
    const inFlightRef = useRef<Promise<void> | null>(null);
    const pendingPayloadRef = useRef<GrDraftPayload | null>(null);
    const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const scopeKeyRef = useRef<string | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        mountedRef.current = true;
        return () => {
            mountedRef.current = false;
            if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        };
    }, []);

    // ── Initial load on scope change ───────────────────────────────────────
    useEffect(() => {
        if (!scope) {
            scopeKeyRef.current = null;
            versionRef.current = 0;
            setStatus('idle');
            setRestored(null);
            setLastSavedAt(null);
            setError(null);
            return;
        }
        const key = `${scope.proformaInvoiceId}::${scope.mplId}`;
        if (scopeKeyRef.current === key) return;
        scopeKeyRef.current = key;

        let cancelled = false;
        setStatus('loading');
        setError(null);
        loadDraft(scope)
            .then((d) => {
                if (cancelled || !mountedRef.current) return;
                if (d) {
                    versionRef.current = d.version;
                    setRestored(d);
                    setLastSavedAt(d.updated_at);
                    setStatus('restored');
                } else {
                    versionRef.current = 0;
                    setRestored(null);
                    setStatus('saved');   // empty state == nothing to save
                }
            })
            .catch((e: any) => {
                if (cancelled || !mountedRef.current) return;
                setError(e?.message ?? 'Failed to load draft.');
                setStatus('error');
            });
        return () => { cancelled = true; };
    }, [scope?.proformaInvoiceId, scope?.mplId]);

    // ── Save runner ────────────────────────────────────────────────────────
    const runSave = useCallback(async () => {
        if (!scope) return;
        const payloadToSave = pendingPayloadRef.current;
        if (!payloadToSave) return;
        pendingPayloadRef.current = null;

        setStatus('saving');
        const result = await saveDraft({
            proformaInvoiceId: scope.proformaInvoiceId,
            mplId:             scope.mplId,
            warehouseId:       warehouseId,
            payload:           payloadToSave,
            expectedVersion:   versionRef.current,
        });
        if (!mountedRef.current) return;

        if (result.kind === 'ok') {
            versionRef.current = result.version;
            setLastSavedAt(result.updated_at);
            setError(null);
            // If more edits queued during the save, mark dirty + schedule.
            if (pendingPayloadRef.current) {
                setStatus('dirty');
                scheduleFlush();
            } else {
                setStatus('saved');
            }
            return;
        }
        if (result.kind === 'conflict') {
            setError(result.message);
            setStatus('conflict');
            return;
        }
        setError(result.message);
        setStatus('error');
    }, [scope?.proformaInvoiceId, scope?.mplId, warehouseId]);

    const flushNow = useCallback(async () => {
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        if (inFlightRef.current) {
            await inFlightRef.current;
        }
        if (!pendingPayloadRef.current) return;
        const p = runSave();
        inFlightRef.current = p.finally(() => { inFlightRef.current = null; });
        await inFlightRef.current;
    }, [runSave]);

    const scheduleFlush = useCallback(() => {
        if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = setTimeout(() => {
            debounceTimerRef.current = null;
            void flushNow();
        }, debounceMs);
    }, [debounceMs, flushNow]);

    // ── Watch payload → mark dirty + debounce ──────────────────────────────
    useEffect(() => {
        if (!enabled || !scope || !payload) return;
        if (status === 'loading') return;       // wait for initial load
        if (status === 'conflict') return;      // hold writes until resolved
        pendingPayloadRef.current = payload;
        setStatus('dirty');
        scheduleFlush();
    }, [payload, enabled, scope?.proformaInvoiceId, scope?.mplId, scheduleFlush, status]);

    const consumeRestored = useCallback(() => setRestored(null), []);

    const discard = useCallback(async () => {
        if (!scope) return;
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
            debounceTimerRef.current = null;
        }
        pendingPayloadRef.current = null;
        try {
            await discardDraft(scope);
            if (!mountedRef.current) return;
            versionRef.current = 0;
            setStatus('idle');
            setLastSavedAt(null);
            setError(null);
        } catch (e: any) {
            if (!mountedRef.current) return;
            setError(e?.message ?? 'Failed to discard draft.');
            setStatus('error');
        }
    }, [scope?.proformaInvoiceId, scope?.mplId]);

    return {
        status,
        lastSavedAt,
        restored,
        consumeRestored,
        flush: flushNow,
        discard,
        error,
    };
}

// ---------------------------------------------------------------------------
// Exception capture (3b.2) — reason codes + photo storage
// ---------------------------------------------------------------------------

/**
 * Org-configurable in a future slice (table `gr_reason_codes`); kept inline
 * for now so the UI works without a round-trip. Order matters — first item
 * is shown highest in the dropdown.
 */
export interface ReasonCode {
    code:        string;        // stable identifier persisted on the GR line
    label:       string;        // shown in the dropdown
    description: string;        // help text; explains when to pick this
    category:    'PHYSICAL' | 'QUALITY' | 'OTHER';
}

export const REASON_CODES: readonly ReasonCode[] = [
    { code: 'CRUSHED',          label: 'Crushed',           description: 'Visible compression — boxes flattened, pallet collapsed.',  category: 'PHYSICAL' },
    { code: 'TORN',             label: 'Torn / Punctured',  description: 'Outer wrap or carton torn; contents may be exposed.',       category: 'PHYSICAL' },
    { code: 'WET',              label: 'Wet / Water Damage',description: 'Water staining, mildew smell, or saturated packaging.',     category: 'PHYSICAL' },
    { code: 'CONTAMINATION',    label: 'Contamination',     description: 'Oil, dirt, foreign material on or inside the packaging.',   category: 'QUALITY' },
    { code: 'TEMPERATURE',      label: 'Temperature Excursion', description: 'Cold-chain breach — indicator strip tripped or melted.', category: 'QUALITY' },
    { code: 'WRONG_ITEM',       label: 'Wrong Item Inside', description: 'Pallet markings differ from contents (open & inspect).',    category: 'QUALITY' },
    { code: 'OTHER',            label: 'Other',             description: 'Free-text note required when no other code fits.',          category: 'OTHER'    },
] as const;

export function getReasonCode(code: string | null | undefined): ReasonCode | null {
    if (!code) return null;
    return REASON_CODES.find(r => r.code === code) ?? null;
}

const PHOTO_BUCKET = 'gr-exception-photos';
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

export interface UploadPhotoParams {
    proformaInvoiceId: string;
    mplId:             string;
    palletId:          string;
    file:              File | Blob;
    /** Original filename for extension-derivation. Required when `file` is a Blob. */
    filename?:         string;
}

export type UploadPhotoResult =
    | { kind: 'ok';           path: string }
    | { kind: 'too_large';    message: string }
    | { kind: 'unsupported';  message: string }
    | { kind: 'error';        message: string };

const ALLOWED_PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);

/**
 * Direct browser → Storage upload. Bucket RLS gates the write to authenticated
 * users; path is opaque (no user input concatenated unsanitized).
 *
 * Path layout: `<proforma_id>/<mpl_id>/<pallet_id>/<ts>_<rand>.<ext>`
 *   — partitioned so a future cleanup job can prune by proforma/mpl/pallet.
 */
export async function uploadExceptionPhoto(params: UploadPhotoParams): Promise<UploadPhotoResult> {
    const { file, proformaInvoiceId, mplId, palletId } = params;
    const size = (file as File).size ?? (file as Blob).size ?? 0;
    if (size > MAX_PHOTO_BYTES) {
        return { kind: 'too_large', message: `Photo exceeds 10 MB (${Math.round(size / 1024 / 1024)} MB).` };
    }

    const type = (file as File).type || (file as Blob).type || '';
    if (type && !ALLOWED_PHOTO_TYPES.has(type)) {
        return { kind: 'unsupported', message: `File type "${type}" not allowed. Use JPG / PNG / WebP / HEIC.` };
    }

    const ext = inferExtension(type, params.filename ?? (file as File).name ?? '');
    const ts = Date.now();
    const rand = Math.random().toString(36).slice(2, 8);
    const path = `${proformaInvoiceId}/${mplId}/${palletId}/${ts}_${rand}.${ext}`;

    try {
        const sb = getSupabaseClient();
        const { data, error } = await sb.storage.from(PHOTO_BUCKET).upload(path, file, {
            contentType: type || 'image/jpeg',
            upsert:      false,
            cacheControl: '3600',
        });
        if (error) return { kind: 'error', message: error.message };
        return { kind: 'ok', path: data.path };
    } catch (e: any) {
        return { kind: 'error', message: e?.message ?? 'Upload failed.' };
    }
}

/**
 * Mints a signed URL for displaying a stored photo. URLs are short-lived
 * (default 5 min) so a leaked screenshot of the URL doesn't grant ongoing
 * access. Caller can re-mint as needed.
 */
export async function getPhotoSignedUrl(path: string, expiresInSeconds = 300): Promise<string | null> {
    try {
        const sb = getSupabaseClient();
        const { data, error } = await sb.storage.from(PHOTO_BUCKET).createSignedUrl(path, expiresInSeconds);
        if (error || !data?.signedUrl) return null;
        return data.signedUrl;
    } catch {
        return null;
    }
}

/**
 * Best-effort delete of a not-yet-committed photo. After GR confirm, the path
 * is referenced from goods_receipt_lines.photo_paths and should not be
 * deleted; UI must call this only against draft photos.
 */
export async function deleteExceptionPhoto(path: string): Promise<boolean> {
    try {
        const sb = getSupabaseClient();
        const { error } = await sb.storage.from(PHOTO_BUCKET).remove([path]);
        return !error;
    } catch {
        return false;
    }
}

function inferExtension(mime: string, filename: string): string {
    const fromName = filename.match(/\.([a-zA-Z0-9]{2,5})$/)?.[1]?.toLowerCase();
    if (fromName) return fromName;
    if (mime === 'image/jpeg') return 'jpg';
    if (mime === 'image/png')  return 'png';
    if (mime === 'image/webp') return 'webp';
    if (mime === 'image/heic') return 'heic';
    if (mime === 'image/heif') return 'heif';
    return 'jpg';
}
