/**
 * ReceiveShipmentScreen — Phase B verification wizard.
 *
 * Flow:
 *   1. SEARCH     — Autocomplete proforma / shipment number
 *   2. SHIPMENT   — Show shipment header + MPL cards. Each MPL is
 *                   independently verifiable. Shows verified status per MPL.
 *   3. VERIFY_MPL — For one MPL, pallet checklist with search-by-part,
 *                   per-pallet status, submit creates a sub-GRN for that MPL.
 *
 * Sub-GRN principle: one MPL = one GR. When every MPL has a GR, the
 * shipment is "complete".
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    X, Search, ChevronRight, ChevronLeft, CheckCircle2, AlertCircle, Package,
    Layers, Loader2, Truck, ArrowRight, Check, Cloud, CloudOff, CloudUpload,
    ScanLine, Zap, AlertTriangle, Camera, FileText,
} from 'lucide-react';
import { fetchWithAuth } from '../../utils/supabase/auth';
import { getEdgeFunctionUrl } from '../../utils/supabase/info';
import { generateIdempotencyKey } from '../../utils/idempotency';
import {
    useGrDraftAutosave,
    resolveQrToPallet,
    REASON_CODES,
    type GrDraftPayload, type GrDraftLine, type AutosaveStatus, type ResolveQrResult,
} from './receiveService';
import { useWedgeScanner } from './useWedgeScanner';
import { scanFeedback } from './scanFeedback';
import { CameraScanner } from './CameraScanner';
import { ExceptionSheet, type ExceptionDraft } from './ExceptionSheet';
import { InlineRackPlacer, type InlineRackPlacerLine } from './InlineRackPlacer';
import { useViewport, useOnline } from './useViewport';
import {
    enqueueScan, listQueuedScans, replayQueuedScans, type QueuedScan,
} from './scanQueue';
import {
    printGrn, printPutawayLabels,
    type GrnPrintHeader, type GrnPrintLine, type PutawayLabelPallet,
} from './grnPrint';

// ============================================================================
// Types
// ============================================================================

type Step = 'SEARCH' | 'SCAN_PALLETS' | 'DONE';
type LineStatus = 'RECEIVED' | 'MISSING' | 'DAMAGED' | 'SHORT' | 'QUALITY_HOLD';

interface ProformaMatch {
    id: string; proforma_number: string; shipment_number: string | null;
    customer_name: string | null; dispatched_at: string | null;
    total_mpls: number; total_pallets: number;
    has_existing_gr: boolean; gr_number: string | null;
}
interface Pallet {
    pallet_id: string; pallet_number: string | null;
    part_number: string | null; msn_code: string | null; item_name: string | null;
    quantity: number; container_count: number;
    state: string | null; shipment_sequence: number | null;
    gr_line_status: LineStatus | null; gr_received_qty: number | null;
    rack_location_code: string | null; rack_placed_at: string | null;
    discrepancy_note: string | null;
}
interface MPL {
    mpl_id: string; mpl_number: string; invoice_number: string | null; bpa_number: string | null;
    status: string; dispatched_at: string | null; confirmed_at: string | null;
    pallet_count: number; qty_total: number;
    gr: {
        id: string; gr_number: string; status: string;
        total_pallets_expected: number; total_pallets_received: number;
        total_pallets_missing: number; total_pallets_damaged: number;
        placement_completed_at: string | null; created_at: string;
    } | null;
    pallets: Pallet[];
}
interface ShipmentHeader {
    id: string; proforma_number: string; shipment_number: string | null;
    customer_name: string; stock_moved_at: string | null; status: string;
}

/**
 * Frozen snapshot of a just-committed GR. Used to render the success screen
 * (DONE step) and to drive print outputs without re-querying the server.
 */
interface GrSummary {
    gr_number:    string;
    grn_header:   GrnPrintHeader;
    grn_lines:    GrnPrintLine[];
    label_pallets: PutawayLabelPallet[];
    counts: { received: number; missing: number; damaged: number; expected_qty: number; received_qty: number };
}

interface Props {
    onClose: () => void;
    onCompleted: (grNumber?: string) => void;
    /**
     * Deep-link: open directly to a specific shipment, skipping SEARCH.
     * Used by the inbound dashboard's "Resume" / "Start receiving" affordance.
     */
    initialProformaId?: string;
    /**
     * Optional second-level deep-link: jump straight into VERIFY_MPL for this MPL.
     * Requires `initialProformaId`. Falls back to SHIPMENT step if the MPL isn't
     * found or has already been verified.
     */
    initialMplId?: string;
    /**
     * Optional FIFO quick-pick list shown above the manual search on the SEARCH
     * step. Caller should pass the oldest still-receivable shipments (max ~3).
     */
    quickPickShipments?: QuickPickShipment[];
}

/** Compact subset of Shipment used for quick-pick rendering on the search step. */
export interface QuickPickShipment {
    id:               string;
    proforma_number:  string;
    shipment_number:  string | null;
    dispatched_at:    string | null;
    status:           'IN_TRANSIT' | 'PARTIAL' | 'COMPLETE' | 'DISCREPANCY';
    mpl_count:        number;
    pallets_expected: number;
}

// Map between the GR LineStatus union (server) and the narrowed draft union
// (client). Drafts only persist 4 states; SHORT/QUALITY_HOLD are legacy and
// never written by the new flow but we still tolerate reading them.
function mapStatusToDraft(s: LineStatus): GrDraftLine['line_status'] {
    if (s === 'RECEIVED' || s === 'MISSING' || s === 'DAMAGED') return s;
    return 'DAMAGED';   // SHORT / QUALITY_HOLD collapse into DAMAGED for drafts
}
function mapStatusFromDraft(
    s: GrDraftLine['line_status'],
    expected: number,
    received: number,
): LineStatus {
    if (s === 'PENDING')  return 'RECEIVED';   // PENDING is a future state (Step 3); no UI yet
    if (s === 'RECEIVED') return received < expected ? 'SHORT' : 'RECEIVED';
    return s;
}

// ─── Scan event modeling ─────────────────────────────────────────────────
// ScanEvent normalizes every possible outcome of resolveQrToPallet so the
// UI (banner, history strip, row-flash) has a single discriminated shape
// to render against.
type ScanEvent =
    | { kind: 'matched';        at: number; palletId: string; palletNumber: string | null; partNumber: string | null; expectedQty: number; raw: string }
    | { kind: 'duplicate';      at: number; palletId: string; palletNumber: string | null; raw: string }
    | { kind: 'wrong_mpl';      at: number; palletId: string; palletNumber: string | null; mplNumber: string | null; raw: string }
    | { kind: 'wrong_shipment'; at: number; shipmentNumber: string | null; raw: string }
    | { kind: 'not_found';      at: number; message: string; raw: string }
    | { kind: 'ambiguous';      at: number; message: string; raw: string }
    | { kind: 'invalid';        at: number; message: string; raw: string }
    | { kind: 'queued';         at: number; raw: string }
    | { kind: 'error';          at: number; message: string; raw: string };

function scanEventToLogEntry(ev: ScanEvent): { at: string; pallet_id: string | null; result: 'ok' | 'duplicate' | 'wrong_mpl' | 'unknown' } {
    const at = new Date(ev.at).toISOString();
    if (ev.kind === 'matched')   return { at, pallet_id: ev.palletId, result: 'ok' };
    if (ev.kind === 'duplicate') return { at, pallet_id: ev.palletId, result: 'duplicate' };
    if (ev.kind === 'wrong_mpl') return { at, pallet_id: ev.palletId, result: 'wrong_mpl' };
    return { at, pallet_id: null, result: 'unknown' };
}

function makeScanEvent(
    result: ResolveQrResult,
    activeMpl: MPL,
    tick: Record<string, LineStatus>,
    raw: string,
): ScanEvent {
    const at = Date.now();
    if (result.kind === 'ok') {
        const pid = result.pallet.pallet_id;
        const inThisMpl = activeMpl.pallets.some(p => p.pallet_id === pid);
        if (!inThisMpl) {
            return {
                kind: 'wrong_mpl', at,
                palletId:     pid,
                palletNumber: result.pallet.pallet_number,
                mplNumber:    result.pallet.mpl_number,
                raw,
            };
        }
        // Already in a non-pending verified state? mark as duplicate.
        const existing = tick[pid];
        if (existing === 'RECEIVED') {
            return { kind: 'duplicate', at, palletId: pid, palletNumber: result.pallet.pallet_number, raw };
        }
        return {
            kind: 'matched', at,
            palletId:     pid,
            palletNumber: result.pallet.pallet_number,
            partNumber:   result.pallet.part_number,
            expectedQty:  result.pallet.expected_qty,
            raw,
        };
    }
    if (result.kind === 'wrong_shipment') {
        return { kind: 'wrong_shipment', at, shipmentNumber: result.shipment_number, raw };
    }
    if (result.kind === 'not_found' || result.kind === 'ambiguous' || result.kind === 'invalid') {
        return { kind: result.kind, at, message: result.message, raw };
    }
    return { kind: 'error', at, message: result.message, raw };
}

async function callEdge<T>(name: string, body: unknown): Promise<T> {
    const res = await fetchWithAuth(getEdgeFunctionUrl(name), { method: 'POST', body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok || json?.error) throw new Error(json?.error?.message || json?.error || `Request failed (${res.status})`);
    return json as T;
}

async function resolveWarehouseId(): Promise<string> {
    const { getSupabaseClient } = await import('../../utils/supabase/client');
    const sb = getSupabaseClient();
    const { data: wh3pl } = await sb.from('inv_warehouses').select('id').eq('warehouse_type', '3PL').eq('is_active', true).limit(1);
    if (wh3pl && wh3pl.length > 0) return (wh3pl[0] as any).id;
    const { data: whUs } = await sb.from('inv_warehouses').select('id').ilike('warehouse_code', 'WH-US-%').eq('is_active', true).limit(1);
    if (whUs && whUs.length > 0) return (whUs[0] as any).id;
    const { data: any_wh } = await sb.from('inv_warehouses').select('id').eq('is_active', true).order('created_at', { ascending: true }).limit(1);
    if (any_wh && any_wh.length > 0) return (any_wh[0] as any).id;
    throw new Error('No active warehouse found');
}

// ============================================================================
// Main
// ============================================================================

export function ReceiveShipmentScreen({ onClose, onCompleted, initialProformaId, initialMplId, quickPickShipments }: Props) {
    // Lazy init — deep-link skips SEARCH and lands on SCAN_PALLETS as soon as
    // shipment_detail_get resolves.
    const [step, setStep] = useState<Step>(() =>
        initialProformaId ? 'SCAN_PALLETS' : 'SEARCH'
    );
    const [error, setError] = useState<string | null>(null);

    // SEARCH state
    const [query, setQuery] = useState('');
    const [matches, setMatches] = useState<ProformaMatch[]>([]);
    const [searching, setSearching] = useState(false);

    // SHIPMENT state
    const [shipment, setShipment] = useState<ShipmentHeader | null>(null);
    const [mpls, setMpls] = useState<MPL[]>([]);
    const [loadingDetail, setLoadingDetail] = useState(false);

    // VERIFY_MPL state
    const [activeMplId, setActiveMplId] = useState<string | null>(null);
    const activeMpl = useMemo(() => mpls.find(m => m.mpl_id === activeMplId) ?? null, [mpls, activeMplId]);

    // Verification inputs
    const [tick, setTick]   = useState<Record<string, LineStatus>>({});
    const [rxQty, setRxQty] = useState<Record<string, number>>({});
    const [notes, setNotes] = useState<Record<string, string>>({});
    const [mplNote, setMplNote] = useState('');
    const [submitting, setSubmitting] = useState(false);

    // Per-pallet exception detail (reason code + photo paths). Lives at the
    // screen level so it survives navigation between pallets and feeds the
    // autosave payload + final GR submit.
    const [exceptions, setExceptions] = useState<Record<string, ExceptionDraft>>({});

    // Which pallet currently has the exception sheet open. null = sheet closed.
    const [exceptionTarget, setExceptionTarget] = useState<string | null>(null);

    // ── Responsive layout ────────────────────────────────────────────────
    const viewport = useViewport();

    // ── Scan state ────────────────────────────────────────────────────
    const [lastScan, setLastScan] = useState<ScanEvent | null>(null);
    const [scanHistory, setScanHistory] = useState<ScanEvent[]>([]);
    const [scanResolving, setScanResolving] = useState(false);
    // Resolved pallet currently shown in the "just scanned" panel awaiting
    // the receiver's verify decision. Cleared after Verify · Place Now/Later.
    const [pendingPallet, setPendingPallet] = useState<{ palletId: string; mplId: string } | null>(null);

    /** Look up a pallet by its id across all MPLs. */
    const findPalletAndMpl = useCallback((palletId: string): { mpl: MPL; pallet: Pallet } | null => {
        for (const m of mpls) {
            const p = m.pallets.find(x => x.pallet_id === palletId);
            if (p) return { mpl: m, pallet: p };
        }
        return null;
    }, [mpls]);

    const handleScan = useCallback(async (rawText: string) => {
        if (!shipment || step !== 'SCAN_PALLETS') return;
        const text = rawText.trim();
        if (!text) return;

        setScanResolving(true);
        const result: ResolveQrResult = await resolveQrToPallet({
            qrText:            text,
            proformaInvoiceId: shipment.id,
        });
        setScanResolving(false);

        const at = Date.now();
        if (result.kind === 'ok') {
            const pid = result.pallet.pallet_id;
            const found = findPalletAndMpl(pid);
            if (!found) {
                const ev: ScanEvent = { kind: 'wrong_shipment', at, shipmentNumber: result.pallet.shipment_number, raw: text };
                setLastScan(ev);
                setScanHistory(prev => [ev, ...prev].slice(0, 5));
                scanFeedback.error();
                return;
            }
            // Already verified (server-side) — duplicate.
            if (found.mpl.gr) {
                const ev: ScanEvent = { kind: 'duplicate', at, palletId: pid, palletNumber: result.pallet.pallet_number, raw: text };
                setLastScan(ev);
                setScanHistory(prev => [ev, ...prev].slice(0, 5));
                scanFeedback.duplicate();
                return;
            }
            // Already decided locally → still allow re-opening the panel
            const ev: ScanEvent = { kind: 'matched', at, palletId: pid, palletNumber: result.pallet.pallet_number, partNumber: result.pallet.part_number, expectedQty: result.pallet.expected_qty, raw: text };
            setLastScan(ev);
            setScanHistory(prev => [ev, ...prev].slice(0, 5));
            setPendingPallet({ palletId: pid, mplId: found.mpl.mpl_id });
            scanFeedback.success();
            return;
        }

        // Errors / not-found / wrong-shipment / ambiguous / invalid
        const ev: ScanEvent =
            result.kind === 'wrong_shipment'
                ? { kind: 'wrong_shipment', at, shipmentNumber: result.shipment_number, raw: text }
                : { kind: result.kind === 'ambiguous' ? 'ambiguous' : result.kind === 'not_found' ? 'not_found' : result.kind === 'invalid' ? 'invalid' : 'error', at, message: 'message' in result ? result.message : 'Scan error', raw: text };
        setLastScan(ev);
        setScanHistory(prev => [ev, ...prev].slice(0, 5));
        scanFeedback.error();
    }, [shipment, step, findPalletAndMpl]);

    // Wedge / RF-gun listener — active during the scan step.
    useWedgeScanner(handleScan, {
        disabled: step !== 'SCAN_PALLETS',
        ignoreSelector: '[data-no-scan="true"]',
    });

    /**
     * Pick a status for the pending pallet without committing yet. The
     * receiver still needs to tap "Verify · Place Now/Later" to finalize.
     * For DAMAGED the parent opens the exception sheet (separate flow).
     */
    const pickPendingStatus = useCallback((status: LineStatus) => {
        if (!pendingPallet) return;
        setTick(prev => ({ ...prev, [pendingPallet.palletId]: status }));
    }, [pendingPallet]);

    /**
     * Finalize the pending pallet: requires a status to be chosen first.
     *
     * Place LATER  → records intent, clears pending; auto-commit fires when
     *                every pallet in the MPL is verified.
     * Place NOW    → opens the inline rack placer overlay. The actual GR
     *                line + placement is committed atomically by the picker
     *                via `gr_commit_line_and_place_now`. On success we set
     *                placeIntent='now', stamp the pallet as placed locally,
     *                and return to the scan screen for the next pallet.
     */
    const verifyPendingPallet = useCallback((placeLater: boolean) => {
        if (!pendingPallet) return;
        const pid = pendingPallet.palletId;
        if (tick[pid] === undefined) return;   // no status chosen yet — guard

        if (placeLater) {
            setPlaceIntent(prev => ({ ...prev, [pid]: 'later' }));
            setPendingPallet(null);
            setLastScan(null);
            scanFeedback.success();
            return;
        }

        // Place NOW — open the inline placer; placeIntent will be set after
        // a successful commit-and-place transaction.
        setPlaceNowSession({ palletId: pid, mplId: pendingPallet.mplId });
    }, [pendingPallet, tick]);

    // Debounced search
    useEffect(() => {
        if (step !== 'SEARCH') return;
        if (query.trim().length < 2) { setMatches([]); return; }
        setSearching(true);
        const t = setTimeout(async () => {
            try {
                const r = await callEdge<{ matches: ProformaMatch[] }>('gr_search_proformas', { query: query.trim(), limit: 10 });
                setMatches(r.matches ?? []);
            } catch (e: any) {
                setError(e?.message ?? 'Search failed');
            } finally {
                setSearching(false);
            }
        }, 220);
        return () => clearTimeout(t);
    }, [query, step]);

    const loadShipmentDetail = useCallback(async (piId: string): Promise<MPL[] | null> => {
        setLoadingDetail(true); setError(null);
        try {
            const r = await callEdge<{ shipment: ShipmentHeader; mpls: MPL[] }>('shipment_detail_get', { proforma_invoice_id: piId });
            setShipment(r.shipment);
            const list = r.mpls ?? [];
            setMpls(list);
            // Direct to SCAN_PALLETS — no MPL picker step. Receiver scans pallets;
            // MPL membership is resolved automatically from the QR.
            setStep('SCAN_PALLETS');
            return list;
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load shipment details');
            return null;
        } finally {
            setLoadingDetail(false);
        }
    }, []);

    // ── Deep-link: open directly to a shipment, skipping SEARCH ──────────
    const deepLinkAppliedRef = useRef(false);
    useEffect(() => {
        if (deepLinkAppliedRef.current) return;
        if (!initialProformaId) return;
        deepLinkAppliedRef.current = true;
        void loadShipmentDetail(initialProformaId);
    }, [initialProformaId, loadShipmentDetail]);

    // ── Per-pallet placement intent (place-now vs place-later) ─────────
    // Captured per pallet at verify time. "now" pallets are committed +
    // placed inline via InlineRackPlacer; "later" pallets ride the per-MPL
    // auto-commit and are placed in batch from the dashboard later.
    const [placeIntent, setPlaceIntent] = useState<Record<string, 'now' | 'later'>>({});

    // Active inline place-now session (overlay visible while non-null).
    const [placeNowSession, setPlaceNowSession] = useState<{ palletId: string; mplId: string } | null>(null);

    // Warehouse id, resolved lazily and cached for the lifetime of this screen.
    const warehouseIdRef = useRef<string | null>(null);
    const [warehouseIdReady, setWarehouseIdReady] = useState<string | null>(null);
    useEffect(() => {
        if (!placeNowSession || warehouseIdRef.current) return;
        let cancelled = false;
        (async () => {
            try {
                const wid = await resolveWarehouseId();
                if (cancelled) return;
                warehouseIdRef.current = wid;
                setWarehouseIdReady(wid);
            } catch (e: any) {
                if (!cancelled) setError(e?.message ?? 'Failed to resolve warehouse');
            }
        })();
        return () => { cancelled = true; };
    }, [placeNowSession]);

    // MPLs whose GR has been auto-committed in the background. Set when the
    // last pallet of an MPL gets a status. Prevents double-commit.
    const [committedMpls, setCommittedMpls] = useState<Record<string, { gr_number: string; committed_at: string }>>({});
    const [committingMpls, setCommittingMpls] = useState<Set<string>>(new Set());

    /**
     * Background commit of one MPL using the existing per-MPL RPC. Called
     * automatically when every pallet in the MPL has a status. The user
     * doesn't see a separate "submit" button — verification is the commit.
     */
    const commitMplInBackground = useCallback(async (mpl: MPL) => {
        if (!shipment) return;
        if (committedMpls[mpl.mpl_id]) return;       // already done
        if (committingMpls.has(mpl.mpl_id)) return;  // in flight
        // Also bail if the MPL was already verified server-side (loaded from a
        // prior session). The shipment_detail_get response carries the GR.
        if (mpl.gr) {
            setCommittedMpls(prev => ({ ...prev, [mpl.mpl_id]: { gr_number: mpl.gr!.gr_number, committed_at: mpl.gr!.created_at } }));
            return;
        }

        setCommittingMpls(prev => { const next = new Set(prev); next.add(mpl.mpl_id); return next; });
        try {
            const lines = mpl.pallets.map(p => {
                const s = tick[p.pallet_id] ?? 'RECEIVED';
                const ex = exceptions[p.pallet_id];
                return {
                    pallet_id:        p.pallet_id,
                    pallet_number:    p.pallet_number,
                    part_number:      p.part_number,
                    msn_code:         p.msn_code,
                    invoice_number:   mpl.invoice_number,
                    bpa_number:       mpl.bpa_number,
                    expected_qty:     p.quantity,
                    received_qty:     s === 'MISSING' ? 0 : p.quantity,
                    line_status:      s,
                    discrepancy_note: (s === 'DAMAGED' ? ex?.note : null) ?? notes[p.pallet_id] ?? null,
                    reason_code:      s === 'DAMAGED' ? (ex?.reason_code ?? null) : null,
                    photo_paths:      s === 'DAMAGED' ? (ex?.photo_paths ?? []) : [],
                };
            });

            const warehouseId = await resolveWarehouseId();
            const r: any = await callEdge('gr_confirm_receipt', {
                proforma_invoice_id: shipment.id,
                warehouse_id:        warehouseId,
                mpl_id:              mpl.mpl_id,
                lines,
                notes:               null,
                idempotency_key:     generateIdempotencyKey(),
            });
            setCommittedMpls(prev => ({ ...prev, [mpl.mpl_id]: { gr_number: r.gr_number, committed_at: new Date().toISOString() } }));
        } catch (e: any) {
            // Surface but don't block — the receiver can retry by re-touching a
            // pallet in this MPL or by closing & reopening (which re-fetches
            // shipment_detail_get to see persisted GR rows).
            setError(e?.message ?? `Failed to commit ${mpl.mpl_number}`);
        } finally {
            setCommittingMpls(prev => { const next = new Set(prev); next.delete(mpl.mpl_id); return next; });
        }
    }, [shipment, tick, exceptions, notes, committedMpls, committingMpls]);

    // Auto-commit any MPL whose pallets have all been *verified* — meaning the
    // user clicked "Verify · Place Now/Later" (which sets placeIntent), not
    // just picked a status. Picking RECEIVED alone leaves the pallet pending
    // until the receiver explicitly verifies.
    useEffect(() => {
        if (step !== 'SCAN_PALLETS' || mpls.length === 0) return;
        for (const mpl of mpls) {
            if (committedMpls[mpl.mpl_id] || committingMpls.has(mpl.mpl_id)) continue;
            const allVerified = mpl.pallets.every(p =>
                tick[p.pallet_id] !== undefined && placeIntent[p.pallet_id] !== undefined,
            );
            if (allVerified && mpl.pallets.length > 0) {
                void commitMplInBackground(mpl);
            }
        }
    }, [step, mpls, tick, placeIntent, committedMpls, committingMpls, commitMplInBackground]);

    // When all MPLs are committed, the shipment is done.
    useEffect(() => {
        if (step !== 'SCAN_PALLETS' || mpls.length === 0) return;
        const allCommitted = mpls.every(m => committedMpls[m.mpl_id] || m.gr);
        if (allCommitted) setStep('DONE');
    }, [step, mpls, committedMpls]);

    /**
     * Called from the DONE screen's continue button. With the inline
     * place-now flow each "now" pallet is already placed at the moment of
     * verification, and "later" pallets are placed via the dashboard's
     * pending-placement list. So this just closes the wizard.
     */
    const finishDone = useCallback(() => {
        onCompleted();
    }, [onCompleted]);

    /**
     * Called by InlineRackPlacer after a successful atomic commit + place.
     * Stamps placeIntent='now' and updates the placed pallet's rack info
     * locally so the UI reflects the new state. Returns control to the
     * scan screen for the next pallet.
     *
     * NOTE: we deliberately do NOT mark the MPL as committed here, nor set
     * `mpl.gr` — doing so would (a) trip the "all MPLs committed → DONE"
     * effect when this is the only MPL, prematurely advancing the wizard,
     * and (b) make commitMplInBackground skip the auto-commit, leaving any
     * place-later pallets in this MPL unflushed. The additive
     * confirm_goods_receipt RPC will append the remaining lines to the
     * existing GR when every pallet has been verified.
     */
    const handlePlaceNowSuccess = useCallback((res: { gr_id: string; gr_number: string; rack_location_code: string }) => {
        if (!placeNowSession) return;
        const { palletId, mplId } = placeNowSession;

        setPlaceIntent(prev => ({ ...prev, [palletId]: 'now' }));

        // Stamp just the placed pallet locally so the UI shows it as placed.
        setMpls(prev => prev.map(m => m.mpl_id !== mplId ? m : ({
            ...m,
            pallets: m.pallets.map(p => p.pallet_id !== palletId ? p : ({
                ...p,
                rack_location_code: res.rack_location_code,
                rack_placed_at:     new Date().toISOString(),
            })),
        })));

        setPlaceNowSession(null);
        setPendingPallet(null);
        setLastScan(null);
        scanFeedback.success();
    }, [placeNowSession]);

    const handlePlaceNowCancel = useCallback(() => {
        // User backed out before placing. Leave tick + pendingPallet intact
        // so they can pick "Place Later" or retry — placeIntent stays unset.
        setPlaceNowSession(null);
    }, []);

    /**
     * Build the single-line payload the InlineRackPlacer hands to the edge
     * function. Mirrors the per-line shape used by gr_confirm_receipt so the
     * server-side persistence logic is identical.
     */
    const placeNowLine = useMemo<InlineRackPlacerLine | null>(() => {
        if (!placeNowSession) return null;
        const found = findPalletAndMpl(placeNowSession.palletId);
        if (!found) return null;
        const { mpl, pallet } = found;
        const status = tick[pallet.pallet_id];
        // Place-now requires a non-MISSING status (you can't place a
        // pallet that didn't arrive). Guard rendering.
        if (!status || status === 'MISSING') return null;
        const ex = exceptions[pallet.pallet_id];
        return {
            pallet_id:        pallet.pallet_id,
            pallet_number:    pallet.pallet_number,
            part_number:      pallet.part_number,
            msn_code:         pallet.msn_code,
            invoice_number:   mpl.invoice_number,
            bpa_number:       mpl.bpa_number,
            expected_qty:     pallet.quantity,
            received_qty:     pallet.quantity,
            line_status:      status,
            discrepancy_note: (status === 'DAMAGED' ? ex?.note : null) ?? notes[pallet.pallet_id] ?? null,
            reason_code:      status === 'DAMAGED' ? (ex?.reason_code ?? null) : null,
            photo_paths:      status === 'DAMAGED' ? (ex?.photo_paths ?? []) : [],
        };
    }, [placeNowSession, findPalletAndMpl, tick, exceptions, notes]);

    // On mobile, render full-screen with no backdrop to avoid the "tap-to-dismiss"
    // trap during long verification sessions and to surrender every pixel for
    // gloved finger targets. Desktop keeps the modal-with-backdrop affordance.
    const shellOuterStyle = viewport.isMobile ? mobileShellStyle : backdropStyle;
    const shellInnerStyle = viewport.isMobile ? mobileFrameStyle : modalStyle;
    const shellOnClick    = viewport.isMobile ? undefined : onClose;

    return (
        <div style={shellOuterStyle} onClick={shellOnClick}>
            <div style={shellInnerStyle} onClick={(e) => e.stopPropagation()}>
                <Header step={step} shipment={shipment} onClose={onClose}
                    isMobile={viewport.isMobile}
                    onBack={
                        step === 'SCAN_PALLETS'
                            ? () => { setShipment(null); setMpls([]); setStep('SEARCH'); }
                            : null
                    } />

                {/* Body row: vertical step sidebar (desktop) + main content */}
                <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                    {!viewport.isMobile && <StepSidebar step={step} />}
                    <div style={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
                    {error && (
                        <div style={{ margin: 20, padding: 12, background: '#fef2f2', borderLeft: '3px solid #dc2626', borderRadius: 6, color: '#991b1b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    {step === 'SEARCH' && (
                        <SearchStep
                            query={query} onQueryChange={setQuery}
                            matches={matches} searching={searching}
                            onPick={(pi) => loadShipmentDetail(pi.id)}
                            loading={loadingDetail}
                            quickPick={quickPickShipments ?? []}
                        />
                    )}

                    {/* Deep-link bootstrap — centered loader while the shipment
                        is being fetched (lazy step is SCAN_PALLETS but data
                        hasn't arrived yet). */}
                    {step === 'SCAN_PALLETS' && !shipment && loadingDetail && (
                        <div style={{ textAlign: 'center', padding: 60, color: 'var(--enterprise-gray-500)' }}>
                            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} />
                            <span style={{ marginLeft: 10, fontSize: 13 }}>Loading shipment…</span>
                        </div>
                    )}

                    {step === 'SCAN_PALLETS' && shipment && mpls.length > 0 && (
                        <ScanPalletsStep
                            shipment={shipment}
                            mpls={mpls}
                            tick={tick}
                            exceptions={exceptions}
                            placeIntent={placeIntent}
                            committedMpls={committedMpls}
                            committingMpls={committingMpls}
                            pendingPallet={pendingPallet}
                            findPalletAndMpl={findPalletAndMpl}
                            lastScan={lastScan}
                            scanHistory={scanHistory}
                            scanResolving={scanResolving}
                            onManualScan={handleScan}
                            onPickStatus={pickPendingStatus}
                            onVerifyAndPlace={verifyPendingPallet}
                            onMarkDamaged={(palletId) => setExceptionTarget(palletId)}
                            onCancelPending={() => { setPendingPallet(null); setLastScan(null); }}
                            isMobile={viewport.isMobile}
                        />
                    )}

                    {step === 'DONE' && shipment && (
                        <ShipmentDoneStep
                            shipment={shipment}
                            mpls={mpls}
                            tick={tick}
                            committedMpls={committedMpls}
                            isMobile={viewport.isMobile}
                        />
                    )}

                    {/* Inline rack placer — for "Verify Place Now" */}
                    {placeNowSession && placeNowLine && shipment && warehouseIdReady && (
                        <InlineRackPlacer
                            proformaInvoiceId={shipment.id}
                            warehouseId={warehouseIdReady}
                            mplId={placeNowSession.mplId}
                            line={placeNowLine}
                            onPlaced={handlePlaceNowSuccess}
                            onCancel={handlePlaceNowCancel}
                        />
                    )}

                    {/* Exception capture sheet — for DAMAGED pallets */}
                    {exceptionTarget && shipment && (() => {
                        const found = findPalletAndMpl(exceptionTarget);
                        if (!found) return null;
                        const { mpl, pallet } = found;
                        return (
                            <ExceptionSheet
                                proformaInvoiceId={shipment.id}
                                mplId={mpl.mpl_id}
                                palletId={pallet.pallet_id}
                                palletNumber={pallet.pallet_number}
                                partNumber={pallet.part_number}
                                initial={exceptions[pallet.pallet_id]}
                                onCancel={() => setExceptionTarget(null)}
                                onSubmit={(draft) => {
                                    setExceptions(prev => ({ ...prev, [pallet.pallet_id]: draft }));
                                    setTick(prev => ({ ...prev, [pallet.pallet_id]: 'DAMAGED' }));
                                    if (draft.note) {
                                        setNotes(prev => ({ ...prev, [pallet.pallet_id]: draft.note }));
                                    }
                                    // DAMAGED pallets default to "place later" — they go to the
                                    // pending-placement queue instead of opening the inline placer
                                    // (the receiver still has the option to manually trigger a
                                    // place-now from the dashboard later if needed).
                                    setPlaceIntent(prev => ({ ...prev, [pallet.pallet_id]: prev[pallet.pallet_id] ?? 'later' }));
                                    setPendingPallet(null);
                                    setLastScan(null);
                                    setExceptionTarget(null);
                                }}
                            />
                        );
                    })()}
                    </div>
                </div>

                <Footer
                    step={step}
                    isMobile={viewport.isMobile}
                    submitting={submitting}
                    onCancel={onClose}
                    onCloseSuccess={finishDone}
                />
            </div>
        </div>
    );
}

// ============================================================================
// Chrome
// ============================================================================

function Header({ step, shipment, onClose, onBack, isMobile }: {
    step: Step; shipment: ShipmentHeader | null;
    onClose: () => void; onBack: (() => void) | null;
    isMobile: boolean;
}) {
    const title =
        step === 'SEARCH'        ? 'Receive Shipment'
      : step === 'SCAN_PALLETS'  ? `Scan & Verify · ${shipment?.shipment_number ?? shipment?.proforma_number ?? ''}`
      : 'Shipment Received';
    const subtitle =
        step === 'SEARCH'        ? 'Search by proforma number or shipment number'
      : step === 'SCAN_PALLETS'  ? (shipment?.proforma_number ?? '')
      : '';

    return (
        <div style={{
            padding: isMobile ? 'calc(env(safe-area-inset-top, 0px) + 12px) 14px 12px' : '18px 24px',
            borderBottom: '1px solid var(--enterprise-gray-200)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            background: 'linear-gradient(135deg, #fafbfc 0%, #f1f5f9 100%)',
            flexShrink: 0,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                {onBack && (
                    <button onClick={onBack} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--enterprise-gray-600)', padding: 6, borderRadius: 6 }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--enterprise-gray-100)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                        <ChevronLeft size={18} />
                    </button>
                )}
                <div style={{ minWidth: 0 }}>
                    <h2 style={{ fontSize: isMobile ? 15 : 17, fontWeight: 700, color: 'var(--enterprise-gray-900)', margin: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h2>
                    {subtitle && !isMobile && <p style={{ fontSize: 12, color: 'var(--enterprise-gray-600)', margin: '2px 0 0' }}>{subtitle}</p>}
                </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 6 : 12, flexShrink: 0 }}>
                <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--enterprise-gray-500)', padding: 6, borderRadius: 6 }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'var(--enterprise-gray-100)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                    <X size={20} />
                </button>
            </div>
        </div>
    );
}

function AutosaveIndicator({ status, savedAt, error }: {
    status: AutosaveStatus | null;
    savedAt: string | null;
    error: string | null;
}) {
    if (!status || status === 'idle') return null;

    const relSavedAt = useRelativeTime(savedAt);

    let icon: React.ReactNode = null;
    let label = '';
    let color = 'var(--enterprise-gray-600)';
    let bg    = 'transparent';

    switch (status) {
        case 'loading':
            icon = <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />;
            label = 'Loading draft…';
            break;
        case 'restored':
            icon = <Cloud size={12} />;
            label = `Draft restored${relSavedAt ? ' · ' + relSavedAt : ''}`;
            color = '#15803d';
            break;
        case 'dirty':
            icon = <CloudUpload size={12} />;
            label = 'Unsaved changes';
            color = '#a16207';
            break;
        case 'saving':
            icon = <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />;
            label = 'Saving…';
            break;
        case 'saved':
            icon = <Cloud size={12} />;
            label = relSavedAt ? `Saved ${relSavedAt}` : 'Saved';
            color = '#15803d';
            break;
        case 'conflict':
            icon = <CloudOff size={12} />;
            label = 'Draft conflict — reload';
            color = '#b91c1c';
            bg    = '#fef2f2';
            break;
        case 'error':
            icon = <CloudOff size={12} />;
            label = 'Save failed — retrying';
            color = '#b91c1c';
            bg    = '#fef2f2';
            break;
    }

    return (
        <span title={error ?? label} style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '4px 10px', borderRadius: 999,
            background: bg, color,
            fontSize: 11, fontWeight: 600, letterSpacing: '0.2px',
            border: bg === 'transparent' ? '1px solid var(--enterprise-gray-200)' : '1px solid transparent',
        }}>
            {icon}{label}
        </span>
    );
}

/** Tiny status dot — shown in mobile header where there's no room for the full pill. */
function CompactAutosaveDot({ status }: { status: AutosaveStatus | null }) {
    if (!status || status === 'idle') return null;
    const color =
        status === 'saving' || status === 'loading' || status === 'dirty' ? '#f59e0b'
      : status === 'conflict' || status === 'error'                       ? '#dc2626'
      : '#16a34a';
    const pulse = status === 'saving' || status === 'loading';
    return (
        <span
            title={status}
            aria-label={`Autosave ${status}`}
            style={{
                width: 8, height: 8, borderRadius: '50%',
                background: color, flexShrink: 0,
                animation: pulse ? 'pulse 1.5s ease-in-out infinite' : undefined,
            }}
        />
    );
}

/** Returns a relative-time string ("2s ago") that re-renders every 30s. */
function useRelativeTime(iso: string | null): string | null {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        if (!iso) return;
        const t = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(t);
    }, [iso]);
    if (!iso) return null;
    const diff = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 1000));
    if (diff < 5)    return 'just now';
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
}

function Footer({ step, submitting, onCancel, onCloseSuccess, isMobile }: {
    step: Step; submitting: boolean;
    onCancel: () => void;
    onCloseSuccess: () => void;
    isMobile: boolean;
}) {
    // SCAN_PALLETS step renders its own per-pallet action panel inline.
    // Footer only shows Cancel (mid-flow) or a final close (after DONE).
    return (
        <div style={{
            padding: isMobile ? '10px 14px calc(env(safe-area-inset-bottom, 0px) + 10px)' : '10px 24px',
            borderTop: '1px solid var(--enterprise-gray-200)',
            display: 'flex',
            justifyContent: 'space-between', alignItems: 'center',
            background: 'white',
            flexShrink: 0,
        }}>
            <button onClick={onCancel} disabled={submitting} style={ghostBtn}>
                {step === 'SEARCH' || step === 'SCAN_PALLETS' ? 'Cancel' : 'Close'}
            </button>
            {step === 'DONE' && (
                <button onClick={onCloseSuccess} style={isMobile ? mobilePrimaryBtn : { ...primaryBtn, display: 'flex', alignItems: 'center', gap: 6 }}>
                    Continue <ArrowRight size={isMobile ? 16 : 14} />
                </button>
            )}
        </div>
    );
}

// ============================================================================
// Step 1 — Search
// ============================================================================

function SearchStep({ query, onQueryChange, matches, searching, onPick, loading, quickPick }: {
    query: string; onQueryChange: (s: string) => void;
    matches: ProformaMatch[]; searching: boolean;
    onPick: (pi: ProformaMatch) => void; loading: boolean;
    quickPick: QuickPickShipment[];
}) {
    const isIdle = !loading && !searching && matches.length === 0 && query.length < 2;
    const showHints = isIdle && quickPick.length === 0;
    const showNoMatch = !loading && !searching && matches.length === 0 && query.length >= 2;

    return (
        <div style={{ padding: 28, maxWidth: 760, margin: '0 auto' }}>
            {/* Section header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(30,58,138,0.08)', color: 'var(--enterprise-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <Search size={18} />
                </div>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--enterprise-gray-900)' }}>Match Shipment</div>
                    <div style={{ fontSize: 12, color: 'var(--enterprise-gray-600)' }}>
                        {quickPick.length > 0
                            ? 'Pick one of the oldest below — or search by proforma / shipment / customer.'
                            : 'Search by proforma number, shipment number, or customer.'}
                    </div>
                </div>
            </div>

            {/* Quick-pick — top oldest receivable shipments */}
            {isIdle && quickPick.length > 0 && (
                <div style={{ marginTop: 18, marginBottom: 16 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                        <div style={{ width: 3, height: 14, background: 'var(--enterprise-primary)', borderRadius: 2 }} />
                        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.5px', color: 'var(--enterprise-gray-700)', textTransform: 'uppercase' }}>
                            Available shipments
                        </span>
                        <div style={{ flex: 1, height: 1, background: 'var(--enterprise-gray-200)' }} />
                        <span style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', fontWeight: 600 }}>
                            {quickPick.length} found
                        </span>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        {quickPick.map(s => (
                            <QuickPickCard key={s.id} shipment={s} onPick={() => onPick({
                                id: s.id,
                                proforma_number: s.proforma_number,
                                shipment_number: s.shipment_number,
                                customer_name: null,
                                dispatched_at: s.dispatched_at,
                                total_mpls: s.mpl_count,
                                total_pallets: s.pallets_expected,
                                has_existing_gr: false,
                                gr_number: null,
                            })} />
                        ))}
                    </div>
                </div>
            )}

            {/* "or search manually" divider — only when there's a quick-pick list above */}
            {isIdle && quickPick.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, margin: '20px 0 12px', color: 'var(--enterprise-gray-500)', fontSize: 12 }}>
                    <div style={{ flex: 1, height: 1, background: 'var(--enterprise-gray-200)' }} />
                    <span>or search manually</span>
                    <div style={{ flex: 1, height: 1, background: 'var(--enterprise-gray-200)' }} />
                </div>
            )}
            {/* Search input — taller, monospace, with leading icon and trailing
                spinner / clear affordance. */}
            <div style={{ position: 'relative', marginBottom: 14 }}>
                <Search size={18} style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--enterprise-gray-400)' }} />
                <input autoFocus type="text" value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder="Proforma · Shipment · Customer"
                    style={{
                        width: '100%',
                        padding: '14px 44px 14px 46px',
                        fontSize: 14,
                        border: '1.5px solid var(--enterprise-gray-300)',
                        borderRadius: 10, outline: 'none',
                        fontFamily: 'monospace', boxSizing: 'border-box',
                        background: 'white',
                    }}
                    onFocus={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-primary)'}
                    onBlur={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-gray-300)'} />
                {searching && (
                    <Loader2 size={16} style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--enterprise-gray-400)', animation: 'spin 1s linear infinite' }} />
                )}
                {!searching && query && (
                    <button
                        type="button"
                        onClick={() => onQueryChange('')}
                        aria-label="Clear search"
                        style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--enterprise-gray-400)', padding: 4, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                    >
                        <X size={16} />
                    </button>
                )}
            </div>

            {/* Empty-state helper — light, single line. No oversized banner. */}
            {showHints && (
                <div style={{
                    fontSize: 12, color: 'var(--enterprise-gray-500)',
                    padding: '8px 4px',
                    display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
                }}>
                    <span>Try</span>
                    <span style={hintChipStyle}>PI-XXXX</span>
                    <span style={hintChipStyle}>SHIP-XXXX</span>
                    <span style={hintChipStyle}>customer name</span>
                    <span style={{ color: 'var(--enterprise-gray-400)' }}>· at least 2 characters</span>
                </div>
            )}

            {/* In-flight loader (shipment_detail_get) when a result is picked */}
            {loading && (
                <div style={{ textAlign: 'center', padding: 32, color: 'var(--enterprise-gray-500)', fontSize: 13 }}>
                    <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading shipment…
                </div>
            )}

            {showNoMatch && (
                <div style={{ padding: '24px 4px', color: 'var(--enterprise-gray-500)', fontSize: 13 }}>
                    No dispatched shipments match <span style={{ fontFamily: 'monospace', color: 'var(--enterprise-gray-700)', fontWeight: 600 }}>"{query}"</span>.
                    <div style={{ fontSize: 11, color: 'var(--enterprise-gray-400)', marginTop: 4 }}>
                        Only shipments that have been dispatched from the factory show up here.
                    </div>
                </div>
            )}

            {/* Results — rendered as a tight list with hierarchy: PI/Shipment IDs
                first, then customer + meta. */}
            {!loading && matches.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                    {matches.map(m => (
                        <button key={m.id} onClick={() => onPick(m)}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 16px', background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s ease', font: 'inherit' }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--enterprise-primary)'; e.currentTarget.style.background = 'rgba(30,58,138,0.02)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--enterprise-gray-200)'; e.currentTarget.style.background = 'white'; }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, minWidth: 0 }}>
                                    <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 800, color: 'var(--enterprise-gray-900)' }}>
                                        {m.shipment_number ?? m.proforma_number}
                                    </span>
                                    {m.shipment_number && (
                                        <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--enterprise-gray-700)' }}>
                                            {m.proforma_number}
                                        </span>
                                    )}
                                </div>
                                {m.has_existing_gr && <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '3px 8px', borderRadius: 10 }}>GR ISSUED</span>}
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                                <span>{m.total_mpls} MPL{m.total_mpls !== 1 ? 's' : ''}</span>
                                <span>·</span>
                                <span>{m.total_pallets} pallet{m.total_pallets !== 1 ? 's' : ''}</span>
                                {m.dispatched_at && <><span>·</span><span>Dispatched {new Date(m.dispatched_at).toLocaleDateString()}</span></>}
                            </div>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

const hintChipStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center',
    padding: '2px 8px',
    background: 'var(--enterprise-gray-100, #f1f5f9)',
    color: 'var(--enterprise-gray-700)',
    borderRadius: 999,
    fontFamily: 'monospace',
    fontSize: 11, fontWeight: 600,
};

// ─── Quick-pick card ─────────────────────────────────────────────────────
// FIFO suggestion shown above the manual search input. Clicking selects the
// shipment (same outcome as searching for it manually).
function QuickPickCard({ shipment, onPick }: { shipment: QuickPickShipment; onPick: () => void }) {
    const accent = shipment.status === 'IN_TRANSIT' ? '#2563eb'
                : shipment.status === 'PARTIAL'    ? '#d97706'
                : shipment.status === 'COMPLETE'   ? '#16a34a'
                : '#dc2626';
    const accentBg = `${accent}15`;
    return (
        <button
            type="button"
            onClick={onPick}
            style={{
                display: 'flex', alignItems: 'center', gap: 14,
                width: '100%', textAlign: 'left',
                padding: 0,
                background: 'white',
                border: '1px solid var(--enterprise-gray-200)',
                borderRadius: 12,
                cursor: 'pointer',
                font: 'inherit',
                overflow: 'hidden',
                transition: 'all 0.15s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = accent; e.currentTarget.style.boxShadow = `0 4px 14px rgba(0,0,0,0.06)`; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--enterprise-gray-200)'; e.currentTarget.style.boxShadow = 'none'; }}
        >
            <div style={{ width: 4, alignSelf: 'stretch', background: accent, flexShrink: 0 }} />
            <div style={{ width: 40, height: 40, borderRadius: 10, background: accentBg, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginLeft: 6 }}>
                <FileText size={18} />
            </div>
            <div style={{ flex: 1, minWidth: 0, padding: '12px 0' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 800, color: 'var(--enterprise-gray-900)' }}>
                        {shipment.shipment_number ?? shipment.proforma_number}
                    </span>
                    {shipment.shipment_number && (
                        <span style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--enterprise-gray-700)' }}>
                            {shipment.proforma_number}
                        </span>
                    )}
                    <span style={{
                        fontSize: 9, fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase',
                        padding: '3px 8px', borderRadius: 999, color: accent, background: accentBg,
                    }}>
                        {shipment.status === 'IN_TRANSIT' ? 'In transit' : shipment.status.toLowerCase()}
                    </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', marginTop: 4, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <span>{shipment.mpl_count} MPL{shipment.mpl_count !== 1 ? 's' : ''}</span>
                    <span>·</span>
                    <span>{shipment.pallets_expected} pallet{shipment.pallets_expected !== 1 ? 's' : ''}</span>
                    {shipment.dispatched_at && <><span>·</span><span>Dispatched {new Date(shipment.dispatched_at).toLocaleDateString()}</span></>}
                </div>
            </div>
            <ChevronRight size={18} style={{ color: 'var(--enterprise-gray-400)', marginRight: 14, flexShrink: 0 }} />
        </button>
    );
}

// ─── StepSidebar ─────────────────────────────────────────────────────────
// Vertical step indicator on the left of the modal (desktop only). Shows the
// 5 stages of the receive flow with active highlight + completed checkmarks.
function StepSidebar({ step }: { step: Step }) {
    const stageOrder: Step[] = ['SEARCH', 'SCAN_PALLETS', 'DONE'];
    const currentIdx = stageOrder.indexOf(step);
    const stages: Array<{ key: Step; label: string; sub: string; icon: React.ReactNode }> = [
        { key: 'SEARCH',       label: 'Match Shipment', sub: 'Pick or search PI',  icon: <Search size={14} /> },
        { key: 'SCAN_PALLETS', label: 'Scan & Verify',  sub: 'Scan pallets · mark', icon: <ScanLine size={14} /> },
        { key: 'DONE',         label: 'Done',           sub: 'Shipment received',   icon: <CheckCircle2 size={14} /> },
    ];

    return (
        <aside style={{
            width: 220, flexShrink: 0,
            background: 'var(--enterprise-gray-50, #f8fafc)',
            borderRight: '1px solid var(--enterprise-gray-200)',
            padding: '20px 16px',
            overflowY: 'auto',
        }}>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.6px', textTransform: 'uppercase', color: 'var(--enterprise-gray-500)', marginBottom: 12, paddingLeft: 6 }}>
                Step {Math.max(1, currentIdx + 1)} of {stages.length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                {stages.map((stg, i) => {
                    const state: 'done' | 'active' | 'todo' =
                        i < currentIdx ? 'done' : i === currentIdx ? 'active' : 'todo';
                    const accent = state === 'active' ? 'var(--enterprise-primary)'
                                : state === 'done'   ? '#16a34a'
                                : 'var(--enterprise-gray-400)';
                    return (
                        <div key={stg.key} style={{
                            display: 'flex', alignItems: 'center', gap: 10,
                            padding: '10px 8px', borderRadius: 8,
                            background: state === 'active' ? 'rgba(30,58,138,0.08)' : 'transparent',
                            transition: 'background 0.15s ease',
                        }}>
                            <div style={{
                                width: 28, height: 28, borderRadius: '50%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                background: state === 'active' ? 'var(--enterprise-primary)'
                                          : state === 'done'   ? '#16a34a'
                                          : 'white',
                                color: state === 'todo' ? 'var(--enterprise-gray-400)' : 'white',
                                border: state === 'todo' ? '1px solid var(--enterprise-gray-300)' : 'none',
                                flexShrink: 0,
                            }}>
                                {state === 'done' ? <Check size={14} /> : stg.icon}
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <div style={{
                                    fontSize: 9, fontWeight: 800, letterSpacing: '0.5px',
                                    color: state === 'active' ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-500)',
                                    textTransform: 'uppercase',
                                }}>
                                    Step {i + 1}
                                </div>
                                <div style={{
                                    fontSize: 13, fontWeight: 700,
                                    color: state === 'todo' ? 'var(--enterprise-gray-500)' : 'var(--enterprise-gray-900)',
                                }}>
                                    {stg.label}
                                </div>
                                <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500)' }}>
                                    {stg.sub}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </aside>
    );
}

// ============================================================================
// Step 2 — Scan & Verify (replaces SHIPMENT + VERIFY_MPL)
// ============================================================================
//
// One scan = one pallet's verify decision. Workflow:
//   1. Scan bar pinned at top (RF-gun listener + manual + camera button).
//   2. Scan resolves a pallet → "Pending pallet" panel slides in with the
//      pallet identity + 3 status options + 2 verify CTAs (Place Now / Later).
//   3. User picks status, clicks Verify → state recorded, panel clears, scanner
//      ready for next scan.
//   4. When all pallets in an MPL have status, parent fires the per-MPL GR
//      commit in the background.
//   5. Progress bar shows verified / total across the whole shipment.

function ScanPalletsStep({
    shipment, mpls, tick, exceptions, placeIntent, committedMpls, committingMpls,
    pendingPallet, findPalletAndMpl, lastScan, scanHistory, scanResolving,
    onManualScan, onPickStatus, onVerifyAndPlace, onMarkDamaged, onCancelPending, isMobile,
}: {
    shipment: ShipmentHeader;
    mpls: MPL[];
    tick: Record<string, LineStatus>;
    exceptions: Record<string, ExceptionDraft>;
    placeIntent: Record<string, 'now' | 'later'>;
    committedMpls: Record<string, { gr_number: string; committed_at: string }>;
    committingMpls: Set<string>;
    pendingPallet: { palletId: string; mplId: string } | null;
    findPalletAndMpl: (palletId: string) => { mpl: MPL; pallet: Pallet } | null;
    lastScan: ScanEvent | null;
    scanHistory: ScanEvent[];
    scanResolving: boolean;
    onManualScan: (text: string) => void;
    onPickStatus: (status: LineStatus) => void;
    onVerifyAndPlace: (placeLater: boolean) => void;
    onMarkDamaged: (palletId: string) => void;
    onCancelPending: () => void;
    isMobile: boolean;
}) {
    const [scanInput, setScanInput] = useState('');
    const [cameraOpen, setCameraOpen] = useState(false);
    const inputRef = useRef<HTMLInputElement | null>(null);

    // Aggregate progress across all MPLs in the shipment. A pallet only counts
    // as "verified" once the user has clicked Verify · Place Now/Later (sets
    // placeIntent). Picking just a status doesn't bump the count.
    const totalPallets = useMemo(() => mpls.reduce((s, m) => s + m.pallets.length, 0), [mpls]);
    const verifiedPallets = useMemo(
        () => mpls.reduce((s, m) =>
            s + m.pallets.filter(p => placeIntent[p.pallet_id] !== undefined || m.gr).length, 0),
        [mpls, placeIntent],
    );
    const pct = totalPallets > 0 ? Math.round((verifiedPallets / totalPallets) * 100) : 0;
    const counts = useMemo(() => {
        let received = 0, missing = 0, damaged = 0;
        for (const m of mpls) {
            for (const p of m.pallets) {
                const s = tick[p.pallet_id];
                if (s === 'RECEIVED') received++;
                else if (s === 'MISSING') missing++;
                else if (s === 'DAMAGED') damaged++;
            }
        }
        return { received, missing, damaged };
    }, [mpls, tick]);

    // Refocus the input after each scan resolves so the next wedge scan lands.
    useEffect(() => {
        if (cameraOpen) return;
        const t = setTimeout(() => inputRef.current?.focus(), 50);
        return () => clearTimeout(t);
    }, [lastScan?.at, cameraOpen, pendingPallet]);

    const submitManual = () => {
        const t = scanInput.trim();
        if (!t) return;
        onManualScan(t);
        setScanInput('');
    };

    // The pallet currently awaiting decision (after a successful scan).
    const pending = pendingPallet ? findPalletAndMpl(pendingPallet.palletId) : null;
    const pendingStatus: LineStatus | undefined = pending ? tick[pending.pallet.pallet_id] : undefined;

    // Banner for the most recent scan outcome (matches show in pending panel)
    const showErrorBanner = lastScan && lastScan.kind !== 'matched' && !pending;

    return (
        <div style={{ padding: isMobile ? 14 : 24, maxWidth: 880, margin: '0 auto' }}>
            {/* ── Progress strip ─────────────────────────────────────── */}
            <div style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 8, flexWrap: 'wrap' }}>
                    <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.5px', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase' }}>
                        Shipment progress
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 800, color: 'var(--enterprise-gray-900)', fontVariantNumeric: 'tabular-nums' }}>
                        {verifiedPallets} / {totalPallets} pallets
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: pct === 100 ? '#16a34a' : 'var(--enterprise-primary)' }}>
                        {pct}%
                    </span>
                </div>
                <div style={{ height: 8, background: 'var(--enterprise-gray-200)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                        width: `${pct}%`, height: '100%',
                        background: pct === 100 ? '#16a34a' : 'var(--enterprise-primary)',
                        transition: 'width 0.3s ease',
                    }} />
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 11, color: 'var(--enterprise-gray-600)', flexWrap: 'wrap' }}>
                    <span>✓ {counts.received} received</span>
                    {counts.damaged > 0 && <span style={{ color: '#d97706' }}>⚠ {counts.damaged} damaged</span>}
                    {counts.missing > 0 && <span style={{ color: '#dc2626' }}>✗ {counts.missing} missing</span>}
                    <span style={{ color: 'var(--enterprise-gray-400)' }}>
                        {totalPallets - verifiedPallets > 0 ? `${totalPallets - verifiedPallets} pending` : 'all scanned'}
                    </span>
                </div>
            </div>

            {/* ── Scan bar ───────────────────────────────────────────── */}
            <div style={{
                position: 'sticky', top: 0, zIndex: 5,
                background: 'white',
                padding: '8px 0 12px',
                marginBottom: 4,
                borderBottom: '1px solid var(--enterprise-gray-200)',
            }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                        <ScanLine size={18} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--enterprise-primary)' }} />
                        <input
                            ref={inputRef}
                            type="text" value={scanInput}
                            onChange={(e) => setScanInput(e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submitManual(); } }}
                            placeholder="Scan pallet QR — or type / paste payload + Enter"
                            autoFocus spellCheck={false} autoCorrect="off" autoCapitalize="off"
                            disabled={!!pending}
                            style={{
                                width: '100%',
                                padding: '12px 44px 12px 44px',
                                fontSize: 14, fontFamily: 'monospace',
                                border: '1.5px solid var(--enterprise-primary)',
                                borderRadius: 10, outline: 'none',
                                boxSizing: 'border-box', background: pending ? '#f1f5f9' : '#f8fafc',
                                opacity: pending ? 0.6 : 1,
                            }}
                        />
                        {scanResolving && (
                            <Loader2 size={16} style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--enterprise-primary)', animation: 'spin 1s linear infinite' }} />
                        )}
                        {!scanResolving && (
                            <span title="RF-gun listener active" style={{ position: 'absolute', right: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--enterprise-gray-400)', display: 'inline-flex' }}>
                                <Zap size={14} />
                            </span>
                        )}
                    </div>
                    <button
                        type="button"
                        onClick={() => setCameraOpen(true)}
                        disabled={!!pending}
                        title="Scan with camera"
                        aria-label="Scan with camera"
                        style={{
                            flexShrink: 0, width: 48,
                            background: 'var(--enterprise-primary)', color: 'white',
                            border: 'none', borderRadius: 10,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: pending ? 'not-allowed' : 'pointer',
                            opacity: pending ? 0.6 : 1,
                        }}
                    >
                        <Camera size={18} />
                    </button>
                </div>

                {cameraOpen && (
                    <CameraScanner
                        onScan={(text) => { onManualScan(text); }}
                        onClose={() => setCameraOpen(false)}
                    />
                )}

                {/* Scan-error banner — shown only when no pending panel covers it */}
                {showErrorBanner && lastScan && (
                    <div style={{
                        marginTop: 8, padding: '8px 12px', borderRadius: 8,
                        fontSize: 12, fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: '#fee2e2', color: '#991b1b', border: '1px solid #fca5a5',
                    }}>
                        <AlertCircle size={14} />
                        {lastScan.kind === 'wrong_shipment'
                            ? `Pallet belongs to a different shipment${lastScan.shipmentNumber ? ' (' + lastScan.shipmentNumber + ')' : ''}.`
                          : lastScan.kind === 'duplicate'
                            ? 'Already received.'
                          : 'message' in lastScan
                            ? lastScan.message
                            : 'Scan error.'}
                    </div>
                )}
            </div>

            {/* ── Pending pallet panel ───────────────────────────────── */}
            {pending && (
                <PendingPalletPanel
                    pallet={pending.pallet}
                    mpl={pending.mpl}
                    status={pendingStatus}
                    isMobile={isMobile}
                    exception={exceptions[pending.pallet.pallet_id]}
                    onSetReceived={() => onPickStatus('RECEIVED')}
                    onSetMissing={() => onPickStatus('MISSING')}
                    onSetDamaged={() => onMarkDamaged(pending.pallet.pallet_id)}
                    onPlaceNow={() => onVerifyAndPlace(false)}
                    onPlaceLater={() => onVerifyAndPlace(true)}
                    onCancel={onCancelPending}
                />
            )}

            {/* ── Idle prompt — when there's no pending pallet ──────── */}
            {!pending && pct < 100 && (
                <div style={{
                    marginTop: 16,
                    padding: 24,
                    border: '1.5px dashed var(--enterprise-gray-300)',
                    borderRadius: 12,
                    background: '#f8fafc',
                    textAlign: 'center',
                }}>
                    <div style={{
                        width: 48, height: 48, margin: '0 auto 10px',
                        background: 'rgba(30,58,138,0.08)', color: 'var(--enterprise-primary)',
                        borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        <ScanLine size={22} />
                    </div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--enterprise-gray-800)' }}>
                        Scan the next pallet
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--enterprise-gray-500)', marginTop: 4, lineHeight: 1.5 }}>
                        Aim the RF gun anywhere on this screen, tap the camera button,
                        <br/>or type / paste the QR payload.
                    </div>
                </div>
            )}

            {/* ── Recent scans ──────────────────────────────────────── */}
            {scanHistory.length > 0 && (
                <div style={{ marginTop: 18 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.5px', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', marginBottom: 8 }}>
                        Recent
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {scanHistory.slice(0, 6).map((ev) => (
                            <div key={ev.at} style={{
                                fontSize: 12, color: 'var(--enterprise-gray-700)',
                                padding: '4px 0', display: 'flex', gap: 10, alignItems: 'center',
                            }}>
                                {ev.kind === 'matched' ? <CheckCircle2 size={12} style={{ color: '#16a34a', flexShrink: 0 }} />
                               : ev.kind === 'duplicate' ? <AlertTriangle size={12} style={{ color: '#d97706', flexShrink: 0 }} />
                               : <AlertCircle size={12} style={{ color: '#dc2626', flexShrink: 0 }} />}
                                <span style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 700, color: 'var(--enterprise-gray-800)' }}>
                                    {(ev as any).palletNumber ?? ev.kind.replace('_', ' ')}
                                </span>
                                <span style={{ fontSize: 11, color: 'var(--enterprise-gray-500)' }}>
                                    {new Date(ev.at).toLocaleTimeString()}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* ── Per-MPL progress (subtle, helps user know what's left) ─ */}
            {mpls.length > 1 && (
                <div style={{ marginTop: 22 }}>
                    <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: '0.5px', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', marginBottom: 8 }}>
                        Sub-GR by MPL
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {mpls.map(m => {
                            const verified = m.pallets.filter(p => placeIntent[p.pallet_id] !== undefined).length;
                            const isCommitted = !!committedMpls[m.mpl_id] || !!m.gr;
                            const isCommitting = committingMpls.has(m.mpl_id);
                            const mplPct = m.pallets.length > 0 ? Math.round((verified / m.pallets.length) * 100) : 0;
                            return (
                                <div key={m.mpl_id} style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    padding: '8px 12px',
                                    background: 'white',
                                    border: '1px solid var(--enterprise-gray-200)',
                                    borderRadius: 8,
                                }}>
                                    <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--enterprise-gray-800)', minWidth: 100 }}>
                                        {m.mpl_number}
                                    </span>
                                    <div style={{ flex: 1, height: 4, background: 'var(--enterprise-gray-200)', borderRadius: 2, overflow: 'hidden' }}>
                                        <div style={{ width: `${mplPct}%`, height: '100%', background: isCommitted ? '#16a34a' : 'var(--enterprise-primary)', transition: 'width 0.3s ease' }} />
                                    </div>
                                    <span style={{ fontSize: 11, color: 'var(--enterprise-gray-600)', fontVariantNumeric: 'tabular-nums', minWidth: 40, textAlign: 'right' }}>
                                        {verified}/{m.pallets.length}
                                    </span>
                                    {isCommitting && (
                                        <span style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                            <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} /> Committing
                                        </span>
                                    )}
                                    {isCommitted && (
                                        <span style={{ fontSize: 10, fontWeight: 800, color: '#16a34a', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                            <CheckCircle2 size={11} /> Committed
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── PendingPalletPanel — slides in after a successful scan ─────────────
function PendingPalletPanel({
    pallet, mpl, status, isMobile, exception,
    onSetReceived, onSetMissing, onSetDamaged, onPlaceNow, onPlaceLater, onCancel,
}: {
    pallet: Pallet;
    mpl: MPL;
    status: LineStatus | undefined;
    isMobile: boolean;
    exception: ExceptionDraft | undefined;
    onSetReceived: () => void;
    onSetMissing: () => void;
    onSetDamaged: () => void;
    onPlaceNow: () => void;
    onPlaceLater: () => void;
    onCancel: () => void;
}) {
    const canVerify = status !== undefined;
    return (
        <div style={{
            marginTop: 16,
            background: 'white',
            border: '2px solid var(--enterprise-primary)',
            borderRadius: 14,
            padding: isMobile ? 16 : 20,
            boxShadow: '0 4px 16px rgba(30,58,138,0.12)',
        }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CheckCircle2 size={14} style={{ color: '#16a34a' }} />
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#15803d', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                        Just scanned
                    </span>
                </div>
                <button onClick={onCancel} aria-label="Discard scan" style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    color: 'var(--enterprise-gray-500)', padding: 4,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <X size={16} />
                </button>
            </div>

            {/* Pallet identity */}
            <div style={{ marginBottom: 16 }}>
                <div style={{
                    fontFamily: 'monospace',
                    fontSize: isMobile ? 16 : 18, fontWeight: 800,
                    color: 'var(--enterprise-gray-900)', lineHeight: 1.2,
                }}>
                    {pallet.pallet_number ?? '—'}
                </div>
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    {pallet.part_number && (
                        <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--enterprise-info, #3b82f6)', background: 'rgba(59,130,246,0.1)', padding: '1px 7px', borderRadius: 4 }}>
                            {pallet.part_number}
                        </span>
                    )}
                    {pallet.msn_code && (
                        <span style={{ fontSize: 11, color: 'var(--enterprise-gray-600)' }}>{pallet.msn_code}</span>
                    )}
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--enterprise-gray-700)', fontFamily: 'monospace' }}>
                        {pallet.quantity.toLocaleString()} pcs
                    </span>
                    <span style={{ fontSize: 11, color: 'var(--enterprise-gray-500)' }}>
                        · {mpl.mpl_number}
                    </span>
                </div>
                {status === 'DAMAGED' && exception && (
                    <div style={{
                        marginTop: 10, padding: '8px 12px',
                        background: '#fff7ed', border: '1px solid #fdba74', borderRadius: 8,
                        fontSize: 11, color: '#7c2d12', display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                        <AlertTriangle size={12} style={{ color: '#c2410c', flexShrink: 0 }} />
                        <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                            {exception.reason_code || 'Damaged'}
                        </span>
                        {exception.photo_paths.length > 0 && (
                            <span>· {exception.photo_paths.length} photo{exception.photo_paths.length === 1 ? '' : 's'}</span>
                        )}
                    </div>
                )}
            </div>

            {/* Status options */}
            <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 8 }}>
                    Status
                </div>
                <div style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : 'repeat(3, 1fr)',
                    gap: 8,
                }}>
                    <StatusBigButton
                        label="Received"
                        active={status === 'RECEIVED'}
                        accent="#16a34a"
                        icon={<CheckCircle2 size={isMobile ? 18 : 16} />}
                        onClick={onSetReceived}
                        isMobile={isMobile}
                    />
                    <StatusBigButton
                        label="Missing"
                        active={status === 'MISSING'}
                        accent="#dc2626"
                        icon={<X size={isMobile ? 18 : 16} />}
                        onClick={onSetMissing}
                        isMobile={isMobile}
                    />
                    <StatusBigButton
                        label="Damaged"
                        active={status === 'DAMAGED'}
                        accent="#d97706"
                        icon={<AlertTriangle size={isMobile ? 18 : 16} />}
                        onClick={onSetDamaged}
                        isMobile={isMobile}
                    />
                </div>
            </div>

            {/* Verify CTAs — always visible. Disabled until a status is picked.
                Same two-button pattern regardless of which status was chosen,
                so the receiver always sees the same shape per pallet. */}
            {!canVerify && (
                <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', textAlign: 'center', padding: '6px 0', marginBottom: 8 }}>
                    Pick a status above to enable verify.
                </div>
            )}
            <div style={{
                display: isMobile ? 'flex' : 'grid',
                flexDirection: isMobile ? 'column' : undefined,
                gridTemplateColumns: isMobile ? undefined : '1fr 1fr',
                gap: 8,
            }}>
                <button
                    onClick={onPlaceNow}
                    disabled={!canVerify}
                    style={{
                        ...(isMobile ? mobilePrimaryBtn : { ...primaryBtn, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }),
                        opacity: canVerify ? 1 : 0.5,
                        cursor: canVerify ? 'pointer' : 'not-allowed',
                    }}
                >
                    <ArrowRight size={isMobile ? 16 : 14} /> Verify · Place Now
                </button>
                <button
                    onClick={onPlaceLater}
                    disabled={!canVerify}
                    style={{
                        ...(isMobile ? mobileSecondaryBtn : { ...secondaryBtn, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }),
                        opacity: canVerify ? 1 : 0.5,
                        cursor: canVerify ? 'pointer' : 'not-allowed',
                    }}
                >
                    <Check size={isMobile ? 16 : 14} /> Verify · Place Later
                </button>
            </div>
        </div>
    );
}

function StatusBigButton({ label, active, accent, icon, onClick, isMobile }: {
    label: string; active: boolean; accent: string; icon: React.ReactNode; onClick: () => void; isMobile: boolean;
}) {
    return (
        <button onClick={onClick} style={{
            padding: isMobile ? '14px 8px' : '12px 10px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
            background: active ? `${accent}15` : 'white',
            border: `1.5px solid ${active ? accent : 'var(--enterprise-gray-200)'}`,
            color: active ? accent : 'var(--enterprise-gray-700)',
            borderRadius: 10, cursor: 'pointer',
            fontWeight: 700, fontSize: isMobile ? 12 : 11, letterSpacing: '0.3px',
            minHeight: isMobile ? 64 : undefined,
        }}>
            {icon}
            {label.toUpperCase()}
        </button>
    );
}

// ============================================================================
// Step 3 — Done (shipment-level)
// ============================================================================

function ShipmentDoneStep({ shipment, mpls, tick, committedMpls, isMobile }: {
    shipment: ShipmentHeader;
    mpls: MPL[];
    tick: Record<string, LineStatus>;
    committedMpls: Record<string, { gr_number: string; committed_at: string }>;
    isMobile: boolean;
}) {
    const total = mpls.reduce((s, m) => s + m.pallets.length, 0);
    let received = 0, missing = 0, damaged = 0;
    for (const m of mpls) {
        for (const p of m.pallets) {
            const s = tick[p.pallet_id] ?? (m.gr ? 'RECEIVED' : undefined);
            if (s === 'RECEIVED') received++;
            else if (s === 'MISSING') missing++;
            else if (s === 'DAMAGED') damaged++;
        }
    }
    void committedMpls;   // retained in props for future "main GR" rendering
    const hasIssues = missing > 0 || damaged > 0;

    return (
        <div style={{ padding: isMobile ? 14 : 32, maxWidth: 720, margin: '0 auto' }}>
            <div style={{
                background: hasIssues ? '#fff7ed' : '#f0fdf4',
                border: `1px solid ${hasIssues ? '#fdba74' : '#86efac'}`,
                borderRadius: 14,
                padding: isMobile ? 16 : 24,
                marginBottom: 16,
                display: 'flex', gap: 14, alignItems: 'flex-start',
            }}>
                <div style={{
                    width: 44, height: 44, borderRadius: '50%', flexShrink: 0,
                    background: hasIssues ? '#fb923c' : '#22c55e', color: 'white',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <CheckCircle2 size={26} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.5px', color: hasIssues ? '#9a3412' : '#166534', textTransform: 'uppercase' }}>
                        Shipment received
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 900, fontFamily: 'monospace', color: 'var(--enterprise-gray-900)', marginTop: 2 }}>
                        {shipment.shipment_number ?? shipment.proforma_number}
                    </div>
                    {shipment.shipment_number && (
                        <div style={{ fontSize: 12, fontFamily: 'monospace', color: 'var(--enterprise-gray-700)', marginTop: 4 }}>
                            {shipment.proforma_number}
                        </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--enterprise-gray-600)', marginTop: 6 }}>
                        All {mpls.length} MPL{mpls.length === 1 ? '' : 's'} committed
                    </div>
                </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 18 }}>
                <MiniCount label="Received" value={received} color="#16a34a" />
                <MiniCount label="Missing"  value={missing}  color="#dc2626" />
                <MiniCount label="Damaged"  value={damaged}  color="#d97706" />
            </div>

            <div style={{ marginTop: 14, padding: 10, borderRadius: 8, background: '#f8fafc', border: '1px dashed var(--enterprise-gray-300)', fontSize: 11, color: 'var(--enterprise-gray-600)', lineHeight: 1.5, textAlign: 'center' }}>
                Total {total} pallet{total === 1 ? '' : 's'} · No putaway labels needed — pallets already have QR.
            </div>
        </div>
    );
}

// ─── MiniCount — small KPI tile shared by SCAN_PALLETS + DONE ──────────
function MiniCount({ label, value, color }: { label: string; value: number | string; color?: string }) {
    return (
        <div style={{
            background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 10,
            padding: '10px 14px',
        }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>
                {label}
            </div>
            <div style={{ fontSize: 22, fontWeight: 900, color: color ?? 'var(--enterprise-gray-900)', marginTop: 2, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {value}
            </div>
        </div>
    );
}

// ============================================================================
// Styles
// ============================================================================

const backdropStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
};
const modalStyle: React.CSSProperties = {
    background: 'white', borderRadius: 14,
    width: '100%', maxWidth: 1200,
    minHeight: 520, maxHeight: '88vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 24px 70px rgba(0,0,0,0.3)',
};
const primaryBtn: React.CSSProperties = {
    background: 'var(--enterprise-primary)', color: 'white', border: 'none',
    padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
    background: 'white', color: 'var(--enterprise-gray-700)', border: '1px solid var(--enterprise-gray-300)',
    padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
    background: 'transparent', color: 'var(--enterprise-gray-600)', border: 'none',
    padding: '9px 14px', fontSize: 13, cursor: 'pointer',
};

// ─── Mobile-only shell + button styles ──────────────────────────────────
// Full-viewport, no backdrop. Stays out of the gloves' way and gives every
// pixel to content. No border-radius — would create a useless hairline gap.
const mobileShellStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'white', zIndex: 1000,
    display: 'flex', flexDirection: 'column',
};
const mobileFrameStyle: React.CSSProperties = {
    background: 'white',
    width: '100%', height: '100%',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
};
const mobilePrimaryBtn: React.CSSProperties = {
    width: '100%',
    background: 'var(--enterprise-primary)', color: 'white', border: 'none',
    padding: '14px 18px', borderRadius: 10,
    fontSize: 15, fontWeight: 700, cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 52,
};
const mobileSecondaryBtn: React.CSSProperties = {
    width: '100%',
    background: 'white', color: 'var(--enterprise-gray-800)',
    border: '1.5px solid var(--enterprise-gray-300)',
    padding: '12px 18px', borderRadius: 10,
    fontSize: 14, fontWeight: 600, cursor: 'pointer',
    minHeight: 48,
};
