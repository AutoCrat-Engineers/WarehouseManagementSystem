/**
 * RackView v5 — Digital Rack Setup for US Warehouse On-Hand Tracking
 *
 * Features:
 *   - Pre-initialized racks: A(150), B(155), C(159) locations
 *   - Dynamic scaling: Add/reduce locations per rack
 *   - ALL locations displayed (occupied=filled, empty=dashed)
 *   - Switchable Rack Tabs (A, B, C)
 *   - Search filters cells + shows distribution summary
 *   - Right side panel on cell click (Inventix style)
 *   - US warehouse on-hand allocation cap
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Plus, Minus, MapPin, Trash2, AlertTriangle, X, Search, Grid3X3, ChevronDown, Info, Layers, Box, ArrowRightLeft, CheckCircle, Package, Truck, SkipForward as SkipForwardIcon } from 'lucide-react';
const SkipForward = SkipForwardIcon;
import { Card, Modal, Label, EmptyState, LoadingSpinner } from './ui/EnterpriseUI';
import { SummaryCard, SummaryCardsGrid, SearchBox, ActionButton, ActionBar, FilterBar } from './ui/SharedComponents';
import { getSupabaseClient } from '../utils/supabase/client';
import { useAllItemsStockDashboard } from '../hooks/useInventory';
import { fetchWithAuth } from '../utils/supabase/auth';
import { getEdgeFunctionUrl } from '../utils/supabase/info';

type UserRole = 'L1' | 'L2' | 'L3' | null;

interface RackViewProps {
    userRole?: UserRole;
    userPerms?: Record<string, boolean>;
    /** When set, enter GR putaway mode — shows banner + click-to-place. */
    grNumber?: string;
    /** Called after the final pallet in the GR is placed (or user cancels). */
    onGrPlacementDone?: () => void;
}

// ── GR putaway types ────────────────────────────────────────────────────
interface GrPendingLine {
    id:                 string;
    pallet_id:          string;
    pallet_number:      string | null;
    part_number:        string | null;
    msn_code:           string | null;
    received_qty:       number;
    line_status:        string;
    rack_placed_at:     string | null;
    rack_location_code: string | null;
}
interface GrHeader {
    id:               string;
    gr_number:        string;
    proforma_number:  string | null;
    shipment_number:  string | null;
    status:           string;
    total_pallets_received: number;
}

interface RackEntry { id: string; location: string; rack: string; msn: string; itemName: string; partNumber: string; qty: number; }
type RackData = Record<string, RackEntry[]>;
interface MsnItem { id: string; master_serial_no: string; item_name: string; item_code: string; part_number: string | null; }

const RC: Record<string, { border: string; text: string; fill: string; fb: string; bg: string }> = {
    A: { border: '#22c55e', text: '#15803d', fill: 'rgba(34,197,94,0.12)', fb: 'rgba(34,197,94,0.35)', bg: 'rgba(34,197,94,0.06)' },
    B: { border: '#3b82f6', text: '#1d4ed8', fill: 'rgba(59,130,246,0.12)', fb: 'rgba(59,130,246,0.35)', bg: 'rgba(59,130,246,0.06)' },
    C: { border: '#a855f7', text: '#7e22ce', fill: 'rgba(168,85,247,0.12)', fb: 'rgba(168,85,247,0.35)', bg: 'rgba(168,85,247,0.06)' },
    D: { border: '#eab308', text: '#a16207', fill: 'rgba(234,179,8,0.12)', fb: 'rgba(234,179,8,0.35)', bg: 'rgba(234,179,8,0.06)' },
    E: { border: '#ef4444', text: '#b91c1c', fill: 'rgba(239,68,68,0.12)', fb: 'rgba(239,68,68,0.35)', bg: 'rgba(239,68,68,0.06)' },
};
const DRC = { border: '#6b7280', text: '#374151', fill: 'rgba(107,114,128,0.12)', fb: 'rgba(107,114,128,0.35)', bg: 'rgba(107,114,128,0.06)' };
function rc(r: string) { return RC[r] || DRC; }

function valLoc(loc: string): { valid: boolean; error?: string; rack?: string } {
    if (!loc || loc.length < 2) return { valid: false, error: 'Min 2 chars' };
    const f = loc.charAt(0), rest = loc.substring(1);
    if (!/^[A-Z]$/.test(f)) return { valid: false, error: 'First char must be A-Z' };
    if (!/^[0-9]+$/.test(rest)) return { valid: false, error: 'After letter, numeric only' };
    if (rest.length > 1 && rest.startsWith('0')) return { valid: false, error: 'No leading zeros' };
    return { valid: true, rack: f };
}

// ── Pallet back-chain drawer helpers ────────────────────────────────────
function BackChainSection({ title, color, children }: { title: string; color: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 16, borderLeft: `3px solid ${color}`, paddingLeft: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color, marginBottom: 6, letterSpacing: 0.4 }}>{title}</div>
            <div>{children}</div>
        </div>
    );
}
function BackChainRow({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, fontSize: 13, padding: '3px 0' }}>
            <span style={{ color: '#6b7280', fontSize: 11 }}>{label}</span>
            <span style={{ color: '#111827' }}>{value}</span>
        </div>
    );
}

export function RackView({ userRole, userPerms = {}, grNumber, onGrPlacementDone }: RackViewProps) {
    // RBAC helpers — granular permissions with role-based fallback
    const hasPerms = Object.keys(userPerms).length > 0;
    const canCreate = userRole === 'L3' || (hasPerms ? userPerms['rack-view.create'] === true : userRole === 'L2');
    const canEdit = userRole === 'L3' || (hasPerms ? userPerms['rack-view.edit'] === true : false);
    const canDelete = userRole === 'L3' || (hasPerms ? userPerms['rack-view.delete'] === true : false);
    const [rackData, setRackData] = useState<RackData>({ A: [], B: [], C: [] });
    const [locCounts, setLocCounts] = useState<Record<string, number>>({ A: 150, B: 155, C: 159 });
    const [activeRack, setActiveRack] = useState('A');
    const [showAddModal, setShowAddModal] = useState(false);
    const [showMoveModal, setShowMoveModal] = useState(false);
    const [showScaleModal, setShowScaleModal] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState<RackEntry | null>(null);
    const [selectedLoc, setSelectedLoc] = useState<string | null>(null);
    const [scaleMode, setScaleMode] = useState<'add' | 'reduce'>('add');
    const [scaleCount, setScaleCount] = useState<number | ''>('');
    const [scaleError, setScaleError] = useState('');
    const [formLoc, setFormLoc] = useState('');
    const [formMsn, setFormMsn] = useState('');
    const [formQty, setFormQty] = useState<number | ''>('');
    const [formError, setFormError] = useState('');
    const [formSuccess, setFormSuccess] = useState('');
    const [moveSrc, setMoveSrc] = useState<RackEntry | null>(null);
    const [moveDst, setMoveDst] = useState('');
    const [moveQty, setMoveQty] = useState<number | ''>('');
    const [moveErr, setMoveErr] = useState('');
    const [moveOk, setMoveOk] = useState('');
    const [msnItems, setMsnItems] = useState<MsnItem[]>([]);
    const [msnLoading, setMsnLoading] = useState(false);
    const [msnSearch, setMsnSearch] = useState('');
    const [msnOpen, setMsnOpen] = useState(false);
    const [globalSearch, setGlobalSearch] = useState('');

    // ── GR putaway state ────────────────────────────────────────────
    const [grHeader, setGrHeader]       = useState<GrHeader | null>(null);
    const [grPending, setGrPending]     = useState<GrPendingLine[]>([]);
    const [grIdx, setGrIdx]             = useState(0);
    const [grPlacing, setGrPlacing]     = useState(false);
    const [grErr, setGrErr]             = useState<string | null>(null);

    // ── Pallet back-chain drawer ────────────────────────────────────
    const [palletDetailId, setPalletDetailId]     = useState<string | null>(null);
    const [palletDetail, setPalletDetail]         = useState<any>(null);
    const [palletDetailLoading, setPalletDetailLoading] = useState(false);
    const [palletDetailErr, setPalletDetailErr]   = useState<string | null>(null);

    useEffect(() => {
        if (!palletDetailId) { setPalletDetail(null); setPalletDetailErr(null); return; }
        setPalletDetailLoading(true); setPalletDetailErr(null);
        (async () => {
            try {
                const res = await fetchWithAuth(getEdgeFunctionUrl('pallet_get_back_chain'), {
                    method: 'POST',
                    body: JSON.stringify({ pallet_id: palletDetailId }),
                });
                const json = await res.json();
                if (!res.ok || json?.error) throw new Error(json?.error?.message || json?.error);
                setPalletDetail(json);
            } catch (e: any) {
                setPalletDetailErr(e?.message ?? 'Failed to load pallet details');
            } finally {
                setPalletDetailLoading(false);
            }
        })();
    }, [palletDetailId]);
    const grMode = Boolean(grNumber);
    const currentGrLine: GrPendingLine | null = grMode && grPending.length > 0 && grIdx < grPending.length ? grPending[grIdx] : null;

    // Load GR pending lines when grNumber prop is set
    useEffect(() => {
        if (!grNumber) { setGrHeader(null); setGrPending([]); setGrIdx(0); return; }
        (async () => {
            try {
                const res = await fetchWithAuth(getEdgeFunctionUrl('gr_list_pending_placement'), {
                    method: 'POST',
                    body: JSON.stringify({ gr_number: grNumber }),
                });
                const json = await res.json();
                if (!res.ok || json?.error) throw new Error(json?.error?.message || json?.error);
                setGrHeader(json.gr as GrHeader);
                setGrPending(json.pending_lines ?? []);
                setGrIdx(0);
                if ((json.pending_lines ?? []).length === 0) {
                    setGrErr(`All pallets on ${grNumber} already placed.`);
                }
            } catch (e: any) {
                setGrErr(e?.message ?? 'Failed to load GR');
            }
        })();
    }, [grNumber]);

    // Click on an empty rack cell while in GR mode → place current pallet
    const placeCurrentGrLineAt = useCallback(async (location: string) => {
        if (!grHeader || !currentGrLine) return;
        if (grPlacing) return;
        setGrPlacing(true); setGrErr(null);
        try {
            // 1. Add to local rack grid (keeps existing UX)
            setRackData(prev => {
                const rackLetter = location.charAt(0);
                const existing = (prev[rackLetter] ?? []).filter(e => e.location !== location);
                return {
                    ...prev,
                    [rackLetter]: [...existing, {
                        id: currentGrLine.pallet_id,
                        location,
                        rack: rackLetter,
                        msn: currentGrLine.msn_code ?? '—',
                        itemName: currentGrLine.pallet_number ?? '',
                        partNumber: currentGrLine.part_number ?? '',
                        qty: currentGrLine.received_qty,
                    }],
                };
            });
            // 2. Mark placed in DB via edge fn
            const res = await fetchWithAuth(getEdgeFunctionUrl('gr_mark_placed'), {
                method: 'POST',
                body: JSON.stringify({
                    gr_id:              grHeader.id,
                    pallet_id:          currentGrLine.pallet_id,
                    rack_location_code: location,
                }),
            });
            const json = await res.json();
            if (!res.ok || json?.error) throw new Error(json?.error?.message || json?.error);

            // 3. Advance to next pallet
            const next = grIdx + 1;
            if (next >= grPending.length) {
                // Done — last pallet placed
                setTimeout(() => onGrPlacementDone?.(), 300);
            } else {
                setGrIdx(next);
            }
        } catch (e: any) {
            setGrErr(e?.message ?? 'Placement failed');
        } finally {
            setGrPlacing(false);
        }
    }, [grHeader, currentGrLine, grPlacing, grIdx, grPending.length, onGrPlacementDone]);

    const skipCurrentGrLine = () => {
        const next = grIdx + 1;
        if (next >= grPending.length) onGrPlacementDone?.();
        else setGrIdx(next);
    };

    const { items: dashItems } = useAllItemsStockDashboard();
    const ohMap = useMemo(() => { const m = new Map<string, number>(); for (const i of dashItems) { if (i.masterSerialNo) m.set(i.masterSerialNo, i.usTransitStock ?? 0); } return m; }, [dashItems]);
    const allocMap = useMemo(() => { const m = new Map<string, number>(); for (const es of Object.values(rackData)) for (const e of es) m.set(e.msn, (m.get(e.msn) || 0) + e.qty); return m; }, [rackData]);

    useEffect(() => { (async () => { setMsnLoading(true); try { const sb = getSupabaseClient(); const { data } = await sb.from('items').select('id, master_serial_no, item_name, part_number, item_code:part_number').eq('is_active', true).not('master_serial_no', 'is', null).order('master_serial_no', { ascending: true }); setMsnItems((data || []).filter((i: any) => i.master_serial_no) as MsnItem[]); } catch { } finally { setMsnLoading(false); } })(); }, []);

    // ── Hydrate rack placements from DB on mount ─────────────────────
    // Rebuilds local rackData from goods_receipt_lines (the persistent
    // placement ledger). Called once on mount + after GR placements finish
    // so moving away / coming back preserves the grid.
    const loadPlacements = useCallback(async () => {
        try {
            const res = await fetchWithAuth(getEdgeFunctionUrl('rack_load_storage'), {
                method: 'POST',
                body: JSON.stringify({}),
            });
            const json = await res.json();
            if (!res.ok || json?.error) throw new Error(json?.error?.message || json?.error);
            // Rebuild rackData grouped by rack letter
            const grouped: RackData = {};
            const seenRacks = new Set<string>();
            for (const p of (json.placements ?? []) as any[]) {
                const loc = p.rack_location_code;
                if (!loc) continue;
                const rackLetter = loc.charAt(0);
                seenRacks.add(rackLetter);
                if (!grouped[rackLetter]) grouped[rackLetter] = [];
                grouped[rackLetter].push({
                    id:         p.pallet_id,
                    location:   loc,
                    rack:       rackLetter,
                    msn:        p.msn_code ?? p.part_number ?? '—',
                    itemName:   p.item_name ?? p.pallet_number ?? '',
                    partNumber: p.part_number ?? '',
                    qty:        Number(p.quantity ?? 0),
                });
            }
            // Preserve default A/B/C even if empty
            for (const k of ['A','B','C']) if (!grouped[k]) grouped[k] = [];
            setRackData(grouped);
        } catch (err) {
            console.warn('[RackView] failed to hydrate placements:', err);
        }
    }, []);

    useEffect(() => { loadPlacements(); }, [loadPlacements]);

    // Refresh after GR placement flow finishes
    useEffect(() => {
        if (!grMode && grHeader === null) {
            // Post-GR handoff: when grNumber cleared, reload to pick up new placements
            loadPlacements();
        }
    }, [grMode, grHeader, loadPlacements]);

    const rackKeys = useMemo(() => Object.keys(locCounts).sort(), [locCounts]);
    useEffect(() => { setRackData(prev => { const u = { ...prev }; for (const k of Object.keys(locCounts)) { if (!u[k]) u[k] = []; } return u; }); }, [locCounts]);

    const stats = useMemo(() => {
        const all = Object.values(rackData).flat();
        const rs: Record<string, { total: number; occ: number; qty: number }> = {};
        for (const k of rackKeys) { const e = rackData[k] || []; rs[k] = { total: locCounts[k] || 0, occ: new Set(e.map(x => x.location)).size, qty: e.reduce((s, x) => s + x.qty, 0) }; }
        return { totalRacks: rackKeys.length, totalLocs: Object.values(locCounts).reduce((s, c) => s + c, 0), totalItems: new Set(all.map(e => e.msn)).size, totalQty: all.reduce((s, e) => s + e.qty, 0), rack: rs };
    }, [rackData, rackKeys, locCounts]);

    const filtMsn = useMemo(() => { if (!msnSearch) return msnItems; const s = msnSearch.toLowerCase(); return msnItems.filter(i => i.master_serial_no.toLowerCase().includes(s) || i.item_name.toLowerCase().includes(s) || i.item_code.toLowerCase().includes(s) || (i.part_number && i.part_number.toLowerCase().includes(s))); }, [msnItems, msnSearch]);

    const searchDist = useMemo(() => { const s = globalSearch.trim().toLowerCase(); if (!s) return null; const r: { rack: string; locs: number; qty: number }[] = []; for (const rack of rackKeys) { const es = (rackData[rack] || []).filter(e => e.msn.toLowerCase().includes(s) || e.itemName.toLowerCase().includes(s) || e.location.toLowerCase().includes(s) || e.partNumber.toLowerCase().includes(s)); if (es.length > 0) r.push({ rack, locs: new Set(es.map(e => e.location)).size, qty: es.reduce((a, e) => a + e.qty, 0) }); } return r; }, [globalSearch, rackData, rackKeys]);

    const allLocs = useMemo(() => {
        const count = locCounts[activeRack] || 0;
        const es = rackData[activeRack] || [];
        const s = globalSearch.trim().toLowerCase();
        const map = new Map<string, RackEntry[]>();
        for (const e of es) { if (!map.has(e.location)) map.set(e.location, []); map.get(e.location)!.push(e); }
        const result: { loc: string; entries: RackEntry[]; match: boolean }[] = [];
        for (let i = 1; i <= count; i++) { const loc = `${activeRack}${i}`; const ents = map.get(loc) || []; const match = !s ? true : ents.some(e => e.msn.toLowerCase().includes(s) || e.itemName.toLowerCase().includes(s) || e.location.toLowerCase().includes(s) || e.partNumber.toLowerCase().includes(s)) || loc.toLowerCase().includes(s); result.push({ loc, entries: ents, match }); }
        return result;
    }, [rackData, activeRack, globalSearch, locCounts]);

    const selEntries = useMemo(() => { if (!selectedLoc) return []; return (rackData[activeRack] || []).filter(e => e.location === selectedLoc); }, [selectedLoc, rackData, activeRack]);
    const allEntries = useMemo(() => Object.values(rackData).flat(), [rackData]);

    const handleScale = useCallback(() => {
        setScaleError('');
        const n = typeof scaleCount === 'number' ? scaleCount : 0;
        if (n <= 0) { setScaleError('Enter a number > 0'); return; }
        const cur = locCounts[activeRack] || 0;
        if (scaleMode === 'add') { setLocCounts(p => ({ ...p, [activeRack]: cur + n })); setShowScaleModal(false); setScaleCount(''); }
        else {
            const es = rackData[activeRack] || [];
            const occNums = new Set(es.map(e => parseInt(e.location.substring(1))));
            const hi = occNums.size > 0 ? Math.max(...occNums) : 0;
            const nc = cur - n;
            if (nc < 0) { setScaleError(`Only ${cur} locations exist`); return; }
            if (nc < hi) { setScaleError(`Cannot reduce below ${hi} — ${activeRack}${hi} has stock`); return; }
            setLocCounts(p => ({ ...p, [activeRack]: nc })); setShowScaleModal(false); setScaleCount('');
        }
    }, [scaleMode, scaleCount, activeRack, locCounts, rackData]);

    const handleAdd = useCallback(() => {
        setFormError(''); setFormSuccess('');
        const loc = formLoc.trim().toUpperCase(); const v = valLoc(loc);
        if (!v.valid) { setFormError(v.error!); return; }
        const rack = v.rack!; const locNum = parseInt(loc.substring(1)); const max = locCounts[rack] || 0;
        if (locNum < 1 || locNum > max) { setFormError(`${loc} doesn't exist. Rack ${rack}: ${rack}1–${rack}${max}`); return; }
        if (!formMsn) { setFormError('Select an MSN'); return; }
        const qty = typeof formQty === 'number' ? formQty : 0;
        if (qty <= 0) { setFormError('Qty must be > 0'); return; }
        const oh = ohMap.get(formMsn);
        if (oh !== undefined) { const c = allocMap.get(formMsn) || 0; if (c + qty > oh) { setFormError(`Exceeds US on-hand. OH: ${oh.toLocaleString()}, Alloc: ${c.toLocaleString()}, Rem: ${(oh - c).toLocaleString()}`); return; } }
        const sel = msnItems.find(i => i.master_serial_no === formMsn);
        const entry: RackEntry = { id: `${rack}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`, location: loc, rack, msn: formMsn, itemName: sel?.item_name || '', partNumber: sel?.part_number || '', qty };
        setRackData(p => { const u = { ...p }; if (!u[rack]) u[rack] = []; u[rack] = [...u[rack], entry]; return u; });
        setActiveRack(rack); setFormSuccess(`✓ ${loc} → Rack ${rack}`); setFormLoc(''); setFormMsn(''); setFormQty(''); setMsnSearch('');
        setTimeout(() => setFormSuccess(''), 3000);
    }, [formLoc, formMsn, formQty, msnItems, ohMap, allocMap, locCounts]);

    const handleMove = useCallback(() => {
        setMoveErr(''); setMoveOk('');
        if (!moveSrc) { setMoveErr('Select source'); return; }
        const dst = moveDst.trim().toUpperCase(); const v = valLoc(dst);
        if (!v.valid) { setMoveErr(v.error!); return; }
        const qty = typeof moveQty === 'number' ? moveQty : 0;
        if (qty <= 0) { setMoveErr('Qty > 0'); return; }
        if (qty > moveSrc.qty) { setMoveErr(`Only ${moveSrc.qty} pcs`); return; }
        if (dst === moveSrc.location) { setMoveErr('Same location'); return; }
        const dr = v.rack!;
        setRackData(p => {
            const u = { ...p };
            u[moveSrc.rack] = (u[moveSrc.rack] || []).map(e => { if (e.id === moveSrc.id) return qty >= e.qty ? null : { ...e, qty: e.qty - qty }; return e; }).filter(Boolean) as RackEntry[];
            if (!u[dr]) u[dr] = [];
            u[dr] = [...u[dr], { id: `${dr}-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`, location: dst, rack: dr, msn: moveSrc.msn, itemName: moveSrc.itemName, partNumber: moveSrc.partNumber, qty }];
            return u;
        });
        setMoveOk(`✓ ${qty} pcs → ${dst}`); setMoveSrc(null); setMoveDst(''); setMoveQty('');
        setTimeout(() => setMoveOk(''), 3000);
    }, [moveSrc, moveDst, moveQty]);

    const handleDel = useCallback((e: RackEntry) => {
        setRackData(p => { const u = { ...p }; u[e.rack] = (u[e.rack] || []).filter(x => x.id !== e.id); return u; });
        setDeleteTarget(null);
        if (selectedLoc === e.location) { const rem = (rackData[e.rack] || []).filter(x => x.location === e.location && x.id !== e.id); if (rem.length === 0) setSelectedLoc(null); }
    }, [rackData, selectedLoc]);

    const resetAdd = () => { setFormLoc(''); setFormMsn(''); setFormQty(''); setFormError(''); setFormSuccess(''); setMsnSearch(''); setMsnOpen(false); };
    const c = rc(activeRack); const rs = stats.rack[activeRack];

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* GR PUTAWAY BANNER */}
            {grMode && grHeader && (
                <Card style={{ padding: 0, background: 'linear-gradient(135deg, #eff6ff, #dbeafe)', border: '2px solid #2563eb', overflow: 'hidden' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 20px' }}>
                        <div style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 12, background: '#2563eb', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Truck size={22} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                                Placing pallets from {grHeader.gr_number}
                            </div>
                            <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', marginTop: 2 }}>
                                {currentGrLine ? (
                                    <>
                                        <span style={{ color: '#1e3a8a', fontFamily: 'monospace' }}>{currentGrLine.pallet_number ?? '—'}</span>
                                        {' · '}{currentGrLine.msn_code ?? '—'}
                                        {' · '}<strong>{currentGrLine.received_qty.toLocaleString()}</strong> pcs
                                        <span style={{ marginLeft: 10, color: '#6b7280', fontWeight: 500 }}>
                                            {grIdx + 1} of {grPending.length}
                                        </span>
                                    </>
                                ) : 'All pallets placed'}
                            </div>
                            <div style={{ fontSize: 12, color: '#475569', marginTop: 3 }}>
                                Click an <strong>empty cell</strong> on the grid below to place. Ref: {grHeader.proforma_number ?? ''}
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {currentGrLine && (
                                <ActionButton label="Skip" icon={<SkipForward size={14} />} onClick={skipCurrentGrLine} disabled={grPlacing} />
                            )}
                            <ActionButton label="Exit GR mode" icon={<X size={14} />} onClick={() => onGrPlacementDone?.()} variant="secondary" />
                        </div>
                    </div>
                    {grErr && (
                        <div style={{ padding: '8px 20px', background: '#fef2f2', color: '#991b1b', fontSize: 13, borderTop: '1px solid #fecaca' }}>
                            ⚠ {grErr}
                        </div>
                    )}
                </Card>
            )}

            {/* SUMMARY */}
            <SummaryCardsGrid columns={4}>
                <SummaryCard label="Total Racks" value={stats.totalRacks} icon={<Layers size={22} style={{ color: 'var(--enterprise-primary)' }} />} color="var(--enterprise-primary)" bgColor="rgba(30,58,138,0.1)" />
                <SummaryCard label="Total Locations" value={stats.totalLocs} icon={<MapPin size={22} style={{ color: 'var(--enterprise-success)' }} />} color="var(--enterprise-success)" bgColor="rgba(34,197,94,0.1)" />
                <SummaryCard label="Unique Items" value={stats.totalItems} icon={<Package size={22} style={{ color: '#a855f7' }} />} color="#a855f7" bgColor="rgba(168,85,247,0.1)" />
                <SummaryCard label="Total Quantity" value={stats.totalQty} icon={<Box size={22} style={{ color: '#ea580c' }} />} color="#ea580c" bgColor="rgba(234,88,12,0.1)" />
            </SummaryCardsGrid>

            {/* FILTER BAR */}
            <FilterBar>
                <SearchBox value={globalSearch} onChange={setGlobalSearch} placeholder="Search by MSN, part number, location, item name…" />
                <ActionBar>
                    {canEdit && <ActionButton label="Move" icon={<ArrowRightLeft size={14} />} onClick={() => { setMoveErr(''); setMoveOk(''); setMoveSrc(null); setMoveDst(''); setMoveQty(''); setShowMoveModal(true); }} variant="secondary" />}
                    {canCreate && <ActionButton label="Add Stock" icon={<Plus size={14} />} onClick={() => { resetAdd(); setShowAddModal(true); }} variant="primary" />}
                </ActionBar>
            </FilterBar>

            {/* SEARCH SUMMARY */}
            {searchDist && searchDist.length > 0 && (
                <Card style={{ padding: '14px 18px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '13px' }}>
                        <Search size={14} style={{ color: 'var(--enterprise-primary)' }} />
                        <span style={{ color: 'var(--enterprise-gray-600)', fontWeight: 500 }}>"{globalSearch}" found in:</span>
                        {searchDist.map(d => {
                            const cl = rc(d.rack); return (
                                <button key={d.rack} onClick={() => setActiveRack(d.rack)} style={{ padding: '4px 12px', borderRadius: '6px', border: `1.5px solid ${activeRack === d.rack ? cl.border : cl.fb}`, background: activeRack === d.rack ? cl.fill : 'white', cursor: 'pointer', fontWeight: activeRack === d.rack ? 700 : 500, fontSize: '12px', color: cl.text, transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                    <strong>Rack {d.rack}</strong> <span style={{ color: 'var(--enterprise-gray-500)' }}>{d.locs} loc{d.locs !== 1 ? 's' : ''}</span> <span style={{ color: cl.text, fontWeight: 700 }}>{d.qty.toLocaleString()} pcs</span>
                                </button>
                            );
                        })}
                    </div>
                </Card>
            )}
            {searchDist && searchDist.length === 0 && globalSearch && <div style={{ fontSize: '13px', color: 'var(--enterprise-gray-500)' }}>No results for "{globalSearch}"</div>}

            {/* MAIN */}
            <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                    <Card style={{ padding: 0, overflow: 'hidden' }}>
                        {/* TABS */}
                        <div style={{ display: 'flex', borderBottom: '2px solid var(--enterprise-gray-200)', background: 'var(--enterprise-gray-50)', overflowX: 'auto' }}>
                            {rackKeys.map(r => {
                                const act = activeRack === r; const cl = rc(r); const hasHits = searchDist ? searchDist.some(d => d.rack === r) : false; return (
                                    <button key={r} onClick={() => { setActiveRack(r); setSelectedLoc(null); }}
                                        style={{ padding: '14px 28px', border: 'none', borderBottom: act ? `3px solid ${cl.border}` : '3px solid transparent', background: act ? cl.bg : 'transparent', color: act ? cl.text : 'var(--enterprise-gray-500)', cursor: 'pointer', fontWeight: act ? 700 : 500, fontSize: '14px', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: '10px', whiteSpace: 'nowrap' }}
                                        onMouseEnter={e => { if (!act) e.currentTarget.style.background = 'var(--enterprise-gray-100)'; }}
                                        onMouseLeave={e => { if (!act) e.currentTarget.style.background = 'transparent'; }}
                                    >
                                        <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: act ? cl.border : (hasHits && globalSearch ? cl.border : 'var(--enterprise-gray-300)') }} />
                                        Rack {r}
                                        <span style={{ background: act ? cl.border : 'var(--enterprise-gray-300)', color: 'white', fontSize: '11px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px' }}>{locCounts[r] || 0}</span>
                                    </button>
                                );
                            })}
                        </div>
                        {/* SUB-HEADER */}
                        <div style={{ padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px', borderBottom: '1px solid var(--enterprise-gray-100)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: c.text }}>Rack {activeRack}</h3>
                                <span style={{ fontSize: '13px', color: 'var(--enterprise-gray-500)' }}>{locCounts[activeRack] || 0} locations · {rs?.occ || 0} occupied · {(rs?.qty || 0).toLocaleString()} pcs</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                {canEdit && <button onClick={() => { setScaleMode('add'); setScaleCount(''); setScaleError(''); setShowScaleModal(true); }} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 12px', borderRadius: '6px', border: `1px solid ${c.fb}`, background: c.fill, color: c.text, cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}><Plus size={13} /> Add Locs</button>}
                                {canEdit && <button onClick={() => { setScaleMode('reduce'); setScaleCount(''); setScaleError(''); setShowScaleModal(true); }} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 12px', borderRadius: '6px', border: '1px solid var(--enterprise-gray-300)', background: 'white', color: 'var(--enterprise-gray-600)', cursor: 'pointer', fontSize: '12px', fontWeight: 600 }}><Minus size={13} /> Reduce</button>}
                                <div style={{ width: '1px', height: '20px', background: 'var(--enterprise-gray-200)', margin: '0 4px' }} />
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--enterprise-gray-400)' }}><span style={{ width: '12px', height: '12px', borderRadius: '6px', background: c.fill, border: `1.5px solid ${c.fb}`, display: 'inline-block' }} /> Occupied</span>
                                <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '12px', color: 'var(--enterprise-gray-400)' }}><span style={{ width: '12px', height: '12px', borderRadius: '6px', background: 'var(--enterprise-gray-50)', border: '1.5px dashed var(--enterprise-gray-300)', display: 'inline-block' }} /> Empty</span>
                            </div>
                        </div>
                        {/* GRID */}
                        <div style={{ padding: '20px', minHeight: '200px', maxHeight: '520px', overflowY: 'auto' }}>
                            {allLocs.length === 0 ? <EmptyState icon={<MapPin size={48} style={{ color: c.border, opacity: 0.5 }} />} title="No Locations" description={`Rack ${activeRack} has 0 locations.`} /> : (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                    {allLocs.map(({ loc, entries, match }) => {
                                        const occ = entries.length > 0; const multi = entries.length > 1; const tq = entries.reduce((s, e) => s + e.qty, 0);
                                        const sel = selectedLoc === loc; const dim = globalSearch && !match;
                                        return (
                                            <div key={loc} onClick={() => {
                                                // GR putaway mode: click an EMPTY cell to place current pallet
                                                if (grMode && !occ && currentGrLine && !grPlacing) {
                                                    placeCurrentGrLineAt(loc);
                                                    return;
                                                }
                                                if (occ) setSelectedLoc(sel ? null : loc);
                                            }}
                                                style={{ width: '78px', height: '78px', borderRadius: '12px', background: dim ? 'var(--enterprise-gray-50)' : sel ? `${c.border}18` : occ ? c.fill : 'white', border: dim ? '1.5px dashed var(--enterprise-gray-200)' : sel ? `2.5px solid ${c.border}` : occ ? `1.5px solid ${c.fb}` : (grMode && !occ ? `2px solid ${c.border}` : '1.5px dashed #d1d5db'), display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: (occ || (grMode && !occ)) ? 'pointer' : 'default', transition: 'all 0.15s', position: 'relative', opacity: dim ? 0.3 : 1, boxShadow: sel ? `0 0 10px ${c.border}30` : (grMode && !occ ? `0 0 0 2px ${c.border}22` : 'none') }}
                                                onMouseEnter={e => { if ((occ && !sel) || (grMode && !occ)) { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = `0 3px 10px ${c.fb}`; } }}
                                                onMouseLeave={e => { if ((occ && !sel) || (grMode && !occ)) { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = grMode && !occ ? `0 0 0 2px ${c.border}22` : 'none'; } }}
                                            >
                                                <span style={{ fontSize: '12px', fontWeight: occ ? 700 : 500, color: occ ? c.text : 'var(--enterprise-gray-400)', fontFamily: 'monospace' }}>{loc}</span>
                                                {occ && <span style={{ fontSize: '10px', color: 'var(--enterprise-gray-500)', marginTop: '2px' }}>{tq.toLocaleString()}</span>}
                                                {sel && <CheckCircle size={10} style={{ position: 'absolute', bottom: '4px', color: c.border }} />}
                                                {multi && <span style={{ position: 'absolute', top: '-5px', right: '-5px', background: c.border, color: 'white', fontSize: '8px', fontWeight: 700, width: '17px', height: '17px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid white' }}>+{entries.length}</span>}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--enterprise-gray-100)', display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: 'var(--enterprise-gray-500)' }}>
                            <span>{locCounts[activeRack] || 0} total · {rs?.occ || 0} occupied{globalSearch ? ' (search active)' : ''}</span>
                            <span>Stock: <strong style={{ color: c.text }}>{(rs?.qty || 0).toLocaleString()}</strong> pcs</span>
                        </div>
                    </Card>
                </div>

                {/* SIDE PANEL */}
                {selectedLoc && selEntries.length > 0 && (
                    <div style={{ width: '320px', flexShrink: 0, position: 'sticky', top: '20px' }}>
                        <Card style={{ padding: 0, overflow: 'hidden' }}>
                            <div style={{ padding: '16px 18px', borderBottom: '1px solid var(--enterprise-gray-100)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <span style={{ width: '40px', height: '40px', borderRadius: '10px', background: c.fill, border: `1.5px solid ${c.fb}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '13px', fontFamily: 'monospace', color: c.text }}>{selectedLoc}</span>
                                <div style={{ flex: 1 }}>
                                    <p style={{ fontWeight: 700, fontSize: '15px', color: 'var(--enterprise-gray-800)', margin: 0 }}>Rack {selectedLoc.charAt(0)}</p>
                                    <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)', margin: 0 }}>{selEntries.length} item{selEntries.length !== 1 ? 's' : ''} · {selEntries.reduce((s, e) => s + e.qty, 0).toLocaleString()} pcs</p>
                                </div>
                                <button onClick={() => setSelectedLoc(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--enterprise-gray-400)', padding: '4px' }}><X size={16} /></button>
                            </div>
                            <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                                {selEntries.map((entry, idx) => {
                                    const oh = ohMap.get(entry.msn);
                                    // Heuristic: entry.id is a UUID when placed via GR (real pallet),
                                    // otherwise a local-generated string. Only UUID entries get back-chain.
                                    const isPalletUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.id);
                                    return (
                                        <div key={entry.id}
                                            onClick={() => isPalletUuid && setPalletDetailId(entry.id)}
                                            style={{
                                                padding: '14px 18px',
                                                borderBottom: idx < selEntries.length - 1 ? '1px solid var(--enterprise-gray-50)' : 'none',
                                                cursor: isPalletUuid ? 'pointer' : 'default',
                                                transition: 'background 0.1s',
                                            }}
                                            onMouseEnter={(e) => { if (isPalletUuid) e.currentTarget.style.background = 'var(--enterprise-gray-50)'; }}
                                            onMouseLeave={(e) => { if (isPalletUuid) e.currentTarget.style.background = 'transparent'; }}
                                            title={isPalletUuid ? 'Click for pallet back-chain' : undefined}
                                        >
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                                                <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: c.fill, border: `1px solid ${c.fb}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Package size={18} style={{ color: c.text }} /></div>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <p style={{ fontWeight: 600, fontSize: '13px', color: 'var(--enterprise-gray-800)', margin: '0 0 2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={entry.itemName}>{entry.itemName || entry.msn}</p>
                                                    <p style={{ fontSize: '11px', color: 'var(--enterprise-gray-500)', margin: '0 0 4px' }}>{entry.msn}{entry.partNumber ? ` · PN: ${entry.partNumber}` : ''}</p>
                                                    <p style={{ fontSize: '12px', margin: 0 }}>
                                                        <span style={{ color: c.text, fontWeight: 600 }}>{entry.qty.toLocaleString()} pcs</span>
                                                        {oh !== undefined && <span style={{ color: 'var(--enterprise-gray-400)', marginLeft: '8px' }}>OH: {oh.toLocaleString()}</span>}
                                                        {isPalletUuid && <span style={{ color: 'var(--enterprise-primary)', marginLeft: '8px', fontSize: '10px' }}>▸ details</span>}
                                                    </p>
                                                </div>
                                                {(canEdit || canDelete) && <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                                    {canEdit && <button onClick={e => { e.stopPropagation(); setMoveSrc(entry); setMoveDst(''); setMoveQty(entry.qty); setMoveErr(''); setMoveOk(''); setShowMoveModal(true); }} title="Move" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--enterprise-gray-400)', padding: '4px' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--enterprise-primary)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--enterprise-gray-400)'; }}><ArrowRightLeft size={14} /></button>}
                                                    {canDelete && <button onClick={e => { e.stopPropagation(); setDeleteTarget(entry); }} title="Delete" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--enterprise-gray-400)', padding: '4px' }} onMouseEnter={e => { e.currentTarget.style.color = 'var(--enterprise-error)'; }} onMouseLeave={e => { e.currentTarget.style.color = 'var(--enterprise-gray-400)'; }}><Trash2 size={14} /></button>}
                                                </div>}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </Card>
                    </div>
                )}
            </div>

            {/* INFO */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', padding: '14px 18px', background: 'rgba(30,58,138,0.04)', border: '1px solid rgba(30,58,138,0.1)', borderRadius: '8px', fontSize: '13px', color: 'var(--enterprise-gray-600)' }}>
                <Info size={16} style={{ color: 'var(--enterprise-primary)', flexShrink: 0, marginTop: '2px' }} />
                <div><strong>Rules:</strong> Multiple pallets per cell allowed. Click a cell → pallet list. Click a pallet → full back-chain (Invoice · BPA · Shipment · GR).</div>
            </div>

            {/* PALLET BACK-CHAIN DRAWER */}
            {palletDetailId && (
                <div onClick={() => setPalletDetailId(null)}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
                    <div onClick={(e) => e.stopPropagation()}
                        style={{ width: 520, maxWidth: '96vw', height: '100%', background: 'white', boxShadow: '-4px 0 16px rgba(0,0,0,0.12)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
                            <div>
                                <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#111827' }}>Pallet Back-Chain</h3>
                                <p style={{ fontSize: 11, color: '#6b7280', margin: '2px 0 0' }}>
                                    Full traceability · Invoice · BPA · Shipment · GR
                                </p>
                            </div>
                            <button onClick={() => setPalletDetailId(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#6b7280' }}><X size={20} /></button>
                        </div>

                        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                            {palletDetailLoading && <div style={{ textAlign: 'center', padding: 40 }}><LoadingSpinner size={28} /></div>}
                            {palletDetailErr && <div style={{ color: '#991b1b', background: '#fef2f2', padding: 10, borderRadius: 6 }}>{palletDetailErr}</div>}
                            {palletDetail && (
                                <>
                                    <BackChainSection title="Pallet" color="#1e3a8a">
                                        <BackChainRow label="Pallet #"      value={<strong style={{ fontFamily: 'monospace' }}>{palletDetail.pallet?.pallet_number ?? '—'}</strong>} />
                                        <BackChainRow label="State"         value={palletDetail.pallet?.state ?? '—'} />
                                        <BackChainRow label="Quantity"      value={`${(palletDetail.pallet?.current_qty ?? 0).toLocaleString()} pcs`} />
                                        <BackChainRow label="Containers"    value={palletDetail.pallet?.container_count ?? 0} />
                                        <BackChainRow label="Shipment #"    value={palletDetail.pallet?.shipment_sequence ?? '—'} />
                                    </BackChainSection>

                                    {palletDetail.item && (
                                        <BackChainSection title="Item" color="#059669">
                                            <BackChainRow label="MSN"          value={<strong>{palletDetail.item.master_serial_no ?? '—'}</strong>} />
                                            <BackChainRow label="Part Number"  value={palletDetail.item.part_number ?? '—'} />
                                            <BackChainRow label="Description"  value={palletDetail.item.item_name ?? '—'} />
                                            <BackChainRow label="Revision"     value={palletDetail.item.revision ?? '—'} />
                                        </BackChainSection>
                                    )}

                                    {palletDetail.packing_list && (
                                        <BackChainSection title="Packing List" color="#7c3aed">
                                            <BackChainRow label="PL Number"   value={<strong style={{ fontFamily: 'monospace' }}>{palletDetail.packing_list.packing_list_number ?? '—'}</strong>} />
                                            <BackChainRow label="Status"      value={palletDetail.packing_list.status ?? '—'} />
                                            <BackChainRow label="Confirmed"   value={palletDetail.packing_list.confirmed_at ? new Date(palletDetail.packing_list.confirmed_at).toLocaleString() : '—'} />
                                        </BackChainSection>
                                    )}

                                    <BackChainSection title="Invoice & BPA" color="#d97706">
                                        <BackChainRow label="Invoice #"   value={<strong style={{ fontFamily: 'monospace' }}>{palletDetail.invoice_number ?? '—'}</strong>} />
                                        <BackChainRow label="BPA #"       value={<strong style={{ fontFamily: 'monospace' }}>{palletDetail.bpa_number ?? '—'}</strong>} />
                                        <BackChainRow label="MPL #"       value={palletDetail.mpl?.mpl_number ?? '—'} />
                                        <BackChainRow label="MPL Status"  value={palletDetail.mpl?.status ?? '—'} />
                                    </BackChainSection>

                                    {palletDetail.shipment && (
                                        <BackChainSection title="Shipment (Proforma)" color="#0891b2">
                                            <BackChainRow label="PI Number"     value={<strong style={{ fontFamily: 'monospace' }}>{palletDetail.shipment.proforma_number ?? '—'}</strong>} />
                                            <BackChainRow label="Shipment #"    value={palletDetail.shipment.shipment_number ?? '—'} />
                                            <BackChainRow label="Customer"      value={palletDetail.shipment.customer_name ?? '—'} />
                                            <BackChainRow label="Status"        value={palletDetail.shipment.status ?? '—'} />
                                            <BackChainRow label="Dispatched"    value={palletDetail.shipment.stock_moved_at ? new Date(palletDetail.shipment.stock_moved_at).toLocaleString() : '—'} />
                                        </BackChainSection>
                                    )}

                                    {palletDetail.gr && (
                                        <BackChainSection title="Goods Receipt" color="#16a34a">
                                            <BackChainRow label="GR Number"         value={<strong style={{ fontFamily: 'monospace' }}>{palletDetail.gr.gr_number}</strong>} />
                                            <BackChainRow label="Receipt Date"      value={palletDetail.gr.gr_date ? new Date(palletDetail.gr.gr_date).toLocaleDateString() : '—'} />
                                            <BackChainRow label="Line Status"       value={palletDetail.gr.line_status} />
                                            <BackChainRow label="Received Qty"      value={`${(palletDetail.gr.received_qty ?? 0).toLocaleString()} pcs`} />
                                            {palletDetail.gr.rack_location_code && (
                                                <BackChainRow label="Placed At"     value={`${palletDetail.gr.rack_location_code} · ${new Date(palletDetail.gr.rack_placed_at).toLocaleString()}`} />
                                            )}
                                        </BackChainSection>
                                    )}

                                    {palletDetail.cartons && palletDetail.cartons.length > 0 && (
                                        <BackChainSection title={`Inner Boxes (${palletDetail.cartons.length})`} color="#6366f1">
                                            <details>
                                                <summary style={{ cursor: 'pointer', fontSize: 12, color: 'var(--enterprise-primary)' }}>Show all</summary>
                                                <ul style={{ fontSize: 12, marginTop: 6, paddingLeft: 18 }}>
                                                    {palletDetail.cartons.map((c: any, i: number) => (
                                                        <li key={i} style={{ marginBottom: 3 }}>
                                                            <strong>{c.pack_containers?.container_number ?? '—'}</strong>
                                                            {' · '}qty {c.pack_containers?.quantity ?? '—'}
                                                            {c.pack_containers?.is_adjustment && <span style={{ color: '#d97706', marginLeft: 6 }}>(adj)</span>}
                                                        </li>
                                                    ))}
                                                </ul>
                                            </details>
                                        </BackChainSection>
                                    )}
                                </>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* ADD STOCK MODAL */}
            <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title="Add Stock to Location" maxWidth="520px">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <Label required>Location Code</Label>
                        <input type="text" value={formLoc} onChange={e => { setFormLoc(e.target.value.toUpperCase()); setFormError(''); }} placeholder="e.g. A1, B12" maxLength={10}
                            style={{ width: '100%', padding: '10px 14px', fontSize: '15px', border: '1px solid var(--border-color)', borderRadius: '6px', fontFamily: 'monospace', fontWeight: 600, letterSpacing: '1px', outline: 'none' }}
                            onFocus={e => { e.target.style.borderColor = 'var(--enterprise-primary)'; e.target.style.boxShadow = '0 0 0 3px rgba(30,58,138,0.1)'; }}
                            onBlur={e => { e.target.style.borderColor = 'var(--border-color)'; e.target.style.boxShadow = 'none'; }} />
                        {formLoc && (() => { const v = valLoc(formLoc); return v.valid ? <p style={{ fontSize: '12px', color: 'var(--enterprise-success)', marginTop: '4px' }}>✓ Rack {v.rack} (max: {v.rack}{locCounts[v.rack!] || 0})</p> : null; })()}
                    </div>
                    <div style={{ position: 'relative' }}>
                        <Label required>MSN (Master Serial No)</Label>
                        <div onClick={() => setMsnOpen(!msnOpen)} style={{ width: '100%', padding: '10px 14px', fontSize: '14px', border: '1px solid var(--border-color)', borderRadius: '6px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--background)', minHeight: '40px' }}>
                            <span style={{ color: formMsn ? 'var(--foreground)' : 'var(--enterprise-gray-400)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{formMsn ? (() => { const i = msnItems.find(x => x.master_serial_no === formMsn); return i ? `${i.master_serial_no} — ${i.item_name}` : formMsn; })() : 'Select MSN...'}</span>
                            <ChevronDown size={16} style={{ color: 'var(--enterprise-gray-400)', transform: msnOpen ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                        </div>
                        {formMsn && (() => {
                            const oh = ohMap.get(formMsn); const al = allocMap.get(formMsn) || 0; if (oh === undefined) return null; const rem = oh - al; return (
                                <div style={{ marginTop: '6px', padding: '8px 12px', background: rem <= 0 ? 'rgba(220,38,38,0.06)' : 'rgba(34,197,94,0.06)', border: `1px solid ${rem <= 0 ? 'rgba(220,38,38,0.2)' : 'rgba(34,197,94,0.2)'}`, borderRadius: '6px', fontSize: '12px', display: 'flex', gap: '16px' }}>
                                    <span>US On-Hand: <strong>{oh.toLocaleString()}</strong></span>
                                    <span>Allocated: <strong>{al.toLocaleString()}</strong></span>
                                    <span style={{ color: rem <= 0 ? 'var(--enterprise-error)' : 'var(--enterprise-success)' }}>Remaining: <strong>{rem.toLocaleString()}</strong></span>
                                </div>
                            );
                        })()}
                        {msnOpen && (
                            <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: 'white', border: '1px solid var(--border-color)', borderRadius: '6px', marginTop: '4px', boxShadow: 'var(--shadow-lg)', maxHeight: '240px', display: 'flex', flexDirection: 'column' }}>
                                <div style={{ padding: '8px', borderBottom: '1px solid var(--enterprise-gray-100)' }}>
                                    <input type="text" value={msnSearch} onChange={e => setMsnSearch(e.target.value)} placeholder="Search MSN, part number…" autoFocus style={{ width: '100%', padding: '7px 10px', fontSize: '13px', border: '1px solid var(--enterprise-gray-200)', borderRadius: '4px', outline: 'none', background: 'var(--enterprise-gray-50)' }} onClick={e => e.stopPropagation()} />
                                </div>
                                <div style={{ overflowY: 'auto', flex: 1 }}>
                                    {msnLoading ? <div style={{ padding: '20px', textAlign: 'center' }}><LoadingSpinner size={20} /></div>
                                        : filtMsn.length === 0 ? <div style={{ padding: '16px', textAlign: 'center', fontSize: '13px', color: 'var(--enterprise-gray-400)' }}>No MSN found</div>
                                            : filtMsn.map(item => (
                                                <div key={item.id} onClick={e => { e.stopPropagation(); setFormMsn(item.master_serial_no); setMsnOpen(false); setMsnSearch(''); setFormError(''); }}
                                                    style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--enterprise-gray-50)', background: formMsn === item.master_serial_no ? 'rgba(30,58,138,0.06)' : 'transparent', transition: 'background 0.1s' }}
                                                    onMouseEnter={e => { e.currentTarget.style.background = 'var(--enterprise-gray-50)'; }}
                                                    onMouseLeave={e => { e.currentTarget.style.background = formMsn === item.master_serial_no ? 'rgba(30,58,138,0.06)' : 'transparent'; }}
                                                >
                                                    <p style={{ fontSize: '13px', fontWeight: 600, color: 'var(--enterprise-primary)', margin: '0 0 2px' }}>{item.master_serial_no}</p>
                                                    <p style={{ fontSize: '11px', color: 'var(--enterprise-gray-500)', margin: 0 }}>{item.item_name} <span style={{ color: 'var(--enterprise-gray-400)' }}>({item.item_code}){item.part_number ? ` • PN: ${item.part_number}` : ''}</span></p>
                                                </div>
                                            ))}
                                </div>
                            </div>
                        )}
                    </div>
                    <div>
                        <Label required>Quantity</Label>
                        <input type="number" value={formQty} onChange={e => { setFormQty(e.target.value === '' ? '' : parseInt(e.target.value) || 0); setFormError(''); }} placeholder="Enter qty" min="1" style={{ width: '100%', padding: '10px 14px', fontSize: '14px', border: '1px solid var(--border-color)', borderRadius: '6px', outline: 'none' }} onFocus={e => { e.target.style.borderColor = 'var(--enterprise-primary)'; e.target.style.boxShadow = '0 0 0 3px rgba(30,58,138,0.1)'; }} onBlur={e => { e.target.style.borderColor = 'var(--border-color)'; e.target.style.boxShadow = 'none'; }} />
                    </div>
                    {formError && <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: '6px', padding: '10px 14px', color: 'var(--enterprise-error)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}><AlertTriangle size={15} />{formError}</div>}
                    {formSuccess && <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '6px', padding: '10px 14px', color: 'var(--enterprise-success)', fontSize: '13px' }}>{formSuccess}</div>}
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                        <ActionButton label="Cancel" icon={<X size={14} />} onClick={() => setShowAddModal(false)} variant="secondary" />
                        <ActionButton label="Add to Rack" icon={<Plus size={14} />} onClick={handleAdd} variant="primary" disabled={!formLoc || !formMsn || !formQty} />
                    </div>
                </div>
            </Modal>

            {/* MOVE MODAL */}
            <Modal isOpen={showMoveModal} onClose={() => setShowMoveModal(false)} title="Move Stock" maxWidth="520px">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <Label required>Source Entry</Label>
                        {moveSrc ? (
                            <div style={{ padding: '10px 14px', background: 'var(--enterprise-gray-50)', borderRadius: '8px', border: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <div><span style={{ fontWeight: 700, fontFamily: 'monospace', color: rc(moveSrc.rack).text }}>{moveSrc.location}</span><span style={{ marginLeft: '10px', fontSize: '13px', color: 'var(--enterprise-gray-600)' }}>{moveSrc.msn} — {moveSrc.qty.toLocaleString()} pcs</span></div>
                                <button onClick={() => setMoveSrc(null)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--enterprise-gray-400)' }}><X size={14} /></button>
                            </div>
                        ) : (
                            <div style={{ maxHeight: '160px', overflowY: 'auto', border: '1px solid var(--enterprise-gray-200)', borderRadius: '8px' }}>
                                {allEntries.length === 0 ? <p style={{ padding: '12px', textAlign: 'center', color: 'var(--enterprise-gray-400)', fontSize: '13px' }}>No entries</p>
                                    : allEntries.map(e => (
                                        <div key={e.id} onClick={() => { setMoveSrc(e); setMoveQty(e.qty); }} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--enterprise-gray-50)', transition: 'background 0.1s' }} onMouseEnter={ev => { ev.currentTarget.style.background = 'var(--enterprise-gray-50)'; }} onMouseLeave={ev => { ev.currentTarget.style.background = 'transparent'; }}>
                                            <span style={{ fontWeight: 600, fontFamily: 'monospace', color: rc(e.rack).text, marginRight: '8px' }}>{e.location}</span>
                                            <span style={{ fontSize: '12px', color: 'var(--enterprise-gray-600)' }}>{e.msn} — {e.qty.toLocaleString()} pcs</span>
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>
                    <div>
                        <Label required>Destination Location</Label>
                        <input type="text" value={moveDst} onChange={e => { setMoveDst(e.target.value.toUpperCase()); setMoveErr(''); }} placeholder="e.g. B5" maxLength={10} style={{ width: '100%', padding: '10px 14px', fontSize: '15px', border: '1px solid var(--border-color)', borderRadius: '6px', fontFamily: 'monospace', fontWeight: 600, outline: 'none' }} onFocus={e => { e.target.style.borderColor = 'var(--enterprise-primary)'; }} onBlur={e => { e.target.style.borderColor = 'var(--border-color)'; }} />
                    </div>
                    <div>
                        <Label required>Quantity to Move</Label>
                        <input type="number" value={moveQty} onChange={e => { setMoveQty(e.target.value === '' ? '' : parseInt(e.target.value) || 0); setMoveErr(''); }} min="1" max={moveSrc?.qty} style={{ width: '100%', padding: '10px 14px', fontSize: '14px', border: '1px solid var(--border-color)', borderRadius: '6px', outline: 'none' }} onFocus={e => { e.target.style.borderColor = 'var(--enterprise-primary)'; }} onBlur={e => { e.target.style.borderColor = 'var(--border-color)'; }} />
                        {moveSrc && <p style={{ fontSize: '11px', color: 'var(--enterprise-gray-400)', marginTop: '4px' }}>Available: {moveSrc.qty.toLocaleString()} pcs</p>}
                    </div>
                    {moveErr && <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: '6px', padding: '10px 14px', color: 'var(--enterprise-error)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}><AlertTriangle size={15} />{moveErr}</div>}
                    {moveOk && <div style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)', borderRadius: '6px', padding: '10px 14px', color: 'var(--enterprise-success)', fontSize: '13px' }}>{moveOk}</div>}
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                        <ActionButton label="Cancel" icon={<X size={14} />} onClick={() => setShowMoveModal(false)} variant="secondary" />
                        <ActionButton label="Move" icon={<ArrowRightLeft size={14} />} onClick={handleMove} variant="primary" disabled={!moveSrc || !moveDst || !moveQty} />
                    </div>
                </div>
            </Modal>

            {/* DELETE MODAL */}
            <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Remove Entry" maxWidth="420px">
                {deleteTarget && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                        <div style={{ background: 'rgba(220,38,38,0.05)', border: '1px solid rgba(220,38,38,0.15)', borderRadius: '8px', padding: '14px', display: 'flex', gap: '10px' }}>
                            <AlertTriangle size={20} style={{ color: 'var(--enterprise-error)', flexShrink: 0 }} />
                            <div><p style={{ fontWeight: 600, color: 'var(--enterprise-error)', margin: '0 0 4px' }}>Remove this entry?</p><p style={{ fontSize: '13px', color: 'var(--enterprise-gray-600)', margin: 0 }}><strong>{deleteTarget.msn}</strong> ({deleteTarget.qty.toLocaleString()} pcs) from <strong>{deleteTarget.location}</strong></p></div>
                        </div>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                            <ActionButton label="Cancel" icon={<X size={14} />} onClick={() => setDeleteTarget(null)} variant="secondary" />
                            <ActionButton label="Remove" icon={<Trash2 size={14} />} onClick={() => handleDel(deleteTarget)} variant="danger" />
                        </div>
                    </div>
                )}
            </Modal>

            {/* SCALE MODAL */}
            <Modal isOpen={showScaleModal} onClose={() => setShowScaleModal(false)} title={scaleMode === 'add' ? `Add Locations — Rack ${activeRack}` : `Reduce Locations — Rack ${activeRack}`} maxWidth="420px">
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div style={{ padding: '10px 14px', background: c.fill, border: `1px solid ${c.fb}`, borderRadius: '8px', fontSize: '13px', color: c.text }}>
                        Rack {activeRack} currently has <strong>{locCounts[activeRack] || 0}</strong> locations ({activeRack}1 – {activeRack}{locCounts[activeRack] || 0})
                    </div>
                    <div>
                        <Label required>Number of locations to {scaleMode === 'add' ? 'add' : 'remove'}</Label>
                        <input type="number" value={scaleCount} onChange={e => { setScaleCount(e.target.value === '' ? '' : parseInt(e.target.value) || 0); setScaleError(''); }} min="1" placeholder={scaleMode === 'add' ? 'e.g. 10' : 'e.g. 5'} style={{ width: '100%', padding: '10px 14px', fontSize: '15px', border: '1px solid var(--border-color)', borderRadius: '6px', fontFamily: 'monospace', fontWeight: 600, outline: 'none' }} onFocus={e => { e.target.style.borderColor = c.border; }} onBlur={e => { e.target.style.borderColor = 'var(--border-color)'; }} />
                        {scaleMode === 'add' && typeof scaleCount === 'number' && scaleCount > 0 && <p style={{ fontSize: '12px', color: 'var(--enterprise-success)', marginTop: '4px' }}>New range: {activeRack}1 – {activeRack}{(locCounts[activeRack] || 0) + scaleCount}</p>}
                        {scaleMode === 'reduce' && typeof scaleCount === 'number' && scaleCount > 0 && <p style={{ fontSize: '12px', color: '#d97706', marginTop: '4px' }}>Will remove {activeRack}{(locCounts[activeRack] || 0) - scaleCount + 1} – {activeRack}{locCounts[activeRack] || 0} (only if empty)</p>}
                    </div>
                    {scaleError && <div style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', borderRadius: '6px', padding: '10px 14px', color: 'var(--enterprise-error)', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}><AlertTriangle size={15} />{scaleError}</div>}
                    <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                        <ActionButton label="Cancel" icon={<X size={14} />} onClick={() => setShowScaleModal(false)} variant="secondary" />
                        <ActionButton label={scaleMode === 'add' ? 'Add Locations' : 'Reduce Locations'} icon={scaleMode === 'add' ? <Plus size={14} /> : <Minus size={14} />} onClick={handleScale} variant={scaleMode === 'add' ? 'primary' : 'danger'} disabled={!scaleCount} />
                    </div>
                </div>
            </Modal>
        </div>
    );
}

export default RackView;
