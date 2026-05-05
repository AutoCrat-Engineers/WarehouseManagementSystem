/**
 * InlineRackPlacer — single-pallet inline placement overlay used by the
 * "Verify · Place Now" flow inside ReceiveShipmentScreen. Loads the rack
 * grid, lets the user tap an empty cell, and atomically commits the GR
 * line + places it via the gr_commit_line_and_place_now edge function.
 *
 * Unlike the legacy RackView grMode (which batches an already-committed
 * GR's pending lines), this component handles ONE pallet that has not yet
 * been committed. The edge fn upserts the GR for (PI, MPL) and inserts
 * this single line already marked placed in one transaction.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, MapPin, Package, Loader2, Truck, AlertCircle } from 'lucide-react';
import { fetchWithAuth } from '../../utils/supabase/auth';
import { getEdgeFunctionUrl } from '../../utils/supabase/info';
import { generateIdempotencyKey } from '../../utils/idempotency';
import { useViewport } from './useViewport';

type LineStatus = 'RECEIVED' | 'DAMAGED' | 'SHORT' | 'QUALITY_HOLD';

export interface InlineRackPlacerLine {
    pallet_id:        string;
    pallet_number:    string | null;
    part_number:      string | null;
    msn_code:         string | null;
    invoice_number:   string | null;
    bpa_number:       string | null;
    expected_qty:     number;
    received_qty?:    number;
    line_status:      LineStatus;
    discrepancy_note?: string | null;
    reason_code?:     string | null;
    photo_paths?:     string[];
}

export interface InlineRackPlacerProps {
    proformaInvoiceId: string;
    warehouseId:       string;
    mplId:             string;
    line:              InlineRackPlacerLine;
    /** Called after the pallet is committed + placed. */
    onPlaced: (result: { gr_id: string; gr_number: string; rack_location_code: string }) => void;
    /** Called when the user backs out without placing. */
    onCancel: () => void;
}

interface RackPlacement {
    rack_location_code: string;
    pallet_id:          string;
    pallet_number:      string | null;
    msn_code:           string | null;
    part_number:        string | null;
    item_name:          string | null;
    quantity:           number;
}

const RACK_COLORS: Record<string, { border: string; text: string; fill: string; fb: string; bg: string }> = {
    A: { border: '#22c55e', text: '#15803d', fill: 'rgba(34,197,94,0.12)', fb: 'rgba(34,197,94,0.35)', bg: 'rgba(34,197,94,0.06)' },
    B: { border: '#3b82f6', text: '#1d4ed8', fill: 'rgba(59,130,246,0.12)', fb: 'rgba(59,130,246,0.35)', bg: 'rgba(59,130,246,0.06)' },
    C: { border: '#a855f7', text: '#7e22ce', fill: 'rgba(168,85,247,0.12)', fb: 'rgba(168,85,247,0.35)', bg: 'rgba(168,85,247,0.06)' },
    D: { border: '#eab308', text: '#a16207', fill: 'rgba(234,179,8,0.12)', fb: 'rgba(234,179,8,0.35)', bg: 'rgba(234,179,8,0.06)' },
    E: { border: '#ef4444', text: '#b91c1c', fill: 'rgba(239,68,68,0.12)', fb: 'rgba(239,68,68,0.35)', bg: 'rgba(239,68,68,0.06)' },
};
const FALLBACK_COLOR = { border: '#6b7280', text: '#374151', fill: 'rgba(107,114,128,0.12)', fb: 'rgba(107,114,128,0.35)', bg: 'rgba(107,114,128,0.06)' };
const rackColor = (r: string) => RACK_COLORS[r] || FALLBACK_COLOR;

// Default rack capacity — matches the legacy RackView seed. The edge fn
// returns only OCCUPIED cells, so we generate the empty grid client-side.
const DEFAULT_LOC_COUNTS: Record<string, number> = { A: 150, B: 155, C: 159 };

export function InlineRackPlacer({
    proformaInvoiceId, warehouseId, mplId, line, onPlaced, onCancel,
}: InlineRackPlacerProps) {
    const viewport = useViewport();
    const isMobile = viewport.isMobile;

    const [placements, setPlacements] = useState<RackPlacement[]>([]);
    const [loading, setLoading]       = useState(true);
    const [error, setError]           = useState<string | null>(null);
    const [activeRack, setActiveRack] = useState('A');
    const [placing, setPlacing]       = useState(false);

    // Load current rack occupancy so we know which cells are empty.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const res = await fetchWithAuth(getEdgeFunctionUrl('rack_load_storage'), {
                    method: 'POST', body: JSON.stringify({}),
                });
                const json = await res.json();
                if (!res.ok || json?.error) throw new Error(json?.error?.message || json?.error || 'Load failed');
                if (cancelled) return;
                setPlacements((json.placements ?? []) as RackPlacement[]);
            } catch (e: any) {
                if (!cancelled) setError(e?.message ?? 'Failed to load rack layout');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Group occupancy by rack letter
    const occupancy = useMemo(() => {
        const map: Record<string, Set<string>> = {};
        for (const p of placements) {
            if (!p.rack_location_code) continue;
            const r = p.rack_location_code.charAt(0);
            if (!map[r]) map[r] = new Set<string>();
            map[r].add(p.rack_location_code);
        }
        return map;
    }, [placements]);

    // Discover which rack letters exist (default + any seen in placements)
    const rackKeys = useMemo(() => {
        const ks = new Set<string>(Object.keys(DEFAULT_LOC_COUNTS));
        for (const p of placements) {
            if (p.rack_location_code) ks.add(p.rack_location_code.charAt(0));
        }
        return Array.from(ks).sort();
    }, [placements]);

    // Build cell list for the active rack
    const allLocs = useMemo(() => {
        const count = DEFAULT_LOC_COUNTS[activeRack] ?? 150;
        const occ = occupancy[activeRack] ?? new Set<string>();
        const list: { loc: string; occupied: boolean }[] = [];
        for (let i = 1; i <= count; i++) {
            const loc = `${activeRack}${i}`;
            list.push({ loc, occupied: occ.has(loc) });
        }
        return list;
    }, [activeRack, occupancy]);

    const handleCellClick = useCallback(async (loc: string, occupied: boolean) => {
        if (occupied || placing) return;
        setPlacing(true); setError(null);
        try {
            const res = await fetchWithAuth(getEdgeFunctionUrl('gr_commit_line_and_place_now'), {
                method: 'POST',
                body: JSON.stringify({
                    proforma_invoice_id: proformaInvoiceId,
                    warehouse_id:        warehouseId,
                    mpl_id:              mplId,
                    line:                line,
                    rack_location_code:  loc,
                    idempotency_key:     generateIdempotencyKey(),
                }),
            });
            const json = await res.json();
            if (!res.ok || json?.error) throw new Error(json?.error?.message || json?.error || `Request failed (${res.status})`);
            onPlaced({
                gr_id:              json.gr_id,
                gr_number:          json.gr_number,
                rack_location_code: loc,
            });
        } catch (e: any) {
            setError(e?.message ?? 'Placement failed');
            setPlacing(false);
        }
    }, [placing, proformaInvoiceId, warehouseId, mplId, line, onPlaced]);

    const c = rackColor(activeRack);

    return (
        <div
            data-no-scan="true"
            style={{
                position: 'fixed', inset: 0,
                background: 'rgba(15, 23, 42, 0.55)',
                zIndex: 200,
                display: 'flex', alignItems: 'stretch', justifyContent: 'center',
                padding: isMobile ? 0 : 24,
            }}
            onClick={(e) => { if (e.target === e.currentTarget && !placing) onCancel(); }}
        >
            <div
                onClick={(e) => e.stopPropagation()}
                style={{
                    background: 'white',
                    borderRadius: isMobile ? 0 : 12,
                    width: isMobile ? '100%' : 'min(960px, 100%)',
                    maxHeight: isMobile ? '100%' : 'calc(100vh - 48px)',
                    display: 'flex', flexDirection: 'column',
                    overflow: 'hidden',
                    boxShadow: '0 20px 50px rgba(0,0,0,0.25)',
                }}
            >
                {/* Header banner */}
                <div style={{
                    background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                    borderBottom: '2px solid #2563eb',
                    padding: isMobile ? '12px 14px' : '14px 20px',
                    display: 'flex', alignItems: 'center', gap: 12,
                }}>
                    <div style={{ width: 40, height: 40, borderRadius: 10, background: '#2563eb', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <Truck size={20} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 10, fontWeight: 800, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            Place pallet now
                        </div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <span style={{ color: '#1e3a8a', fontFamily: 'monospace' }}>{line.pallet_number ?? line.pallet_id.slice(0, 8)}</span>
                            {' · '}<strong>{(line.received_qty ?? line.expected_qty).toLocaleString()}</strong> pcs
                            {line.part_number && <span style={{ color: '#475569', fontWeight: 500 }}> · {line.part_number}</span>}
                        </div>
                        <div style={{ fontSize: 11, color: '#475569', marginTop: 3 }}>
                            {isMobile ? 'Tap an empty cell to place' : 'Click an empty cell on the grid below to place this pallet'}
                        </div>
                    </div>
                    <button
                        onClick={() => !placing && onCancel()}
                        disabled={placing}
                        aria-label="Cancel"
                        style={{
                            width: 36, height: 36, borderRadius: 8,
                            background: 'white', border: '1px solid #cbd5e1', color: '#475569',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            cursor: placing ? 'not-allowed' : 'pointer',
                            opacity: placing ? 0.5 : 1,
                            flexShrink: 0,
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

                {error && (
                    <div style={{ margin: 12, padding: 10, background: '#fef2f2', borderLeft: '3px solid #dc2626', borderRadius: 6, color: '#991b1b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AlertCircle size={16} /> {error}
                    </div>
                )}

                {/* Rack tabs */}
                <div style={{ display: 'flex', borderBottom: '2px solid var(--enterprise-gray-200)', background: 'var(--enterprise-gray-50)', overflowX: 'auto' }}>
                    {rackKeys.map(r => {
                        const act = activeRack === r;
                        const cl = rackColor(r);
                        const occCount = (occupancy[r]?.size) ?? 0;
                        const total = DEFAULT_LOC_COUNTS[r] ?? 150;
                        return (
                            <button
                                key={r}
                                onClick={() => setActiveRack(r)}
                                style={{
                                    flex: isMobile ? 1 : undefined,
                                    padding: isMobile ? '10px 6px' : '12px 24px',
                                    border: 'none',
                                    borderBottom: act ? `3px solid ${cl.border}` : '3px solid transparent',
                                    background: act ? cl.bg : 'transparent',
                                    color: act ? cl.text : 'var(--enterprise-gray-500)',
                                    cursor: 'pointer',
                                    fontWeight: act ? 700 : 500,
                                    fontSize: isMobile ? 12 : 14,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    whiteSpace: 'nowrap',
                                }}
                            >
                                Rack {r}
                                <span style={{ background: act ? cl.border : 'var(--enterprise-gray-300)', color: 'white', fontSize: 10, fontWeight: 700, padding: '2px 7px', borderRadius: 10 }}>
                                    {total - occCount}
                                </span>
                            </button>
                        );
                    })}
                </div>

                {/* Grid */}
                <div style={{ flex: 1, overflowY: 'auto', padding: isMobile ? 12 : 20, minHeight: 200 }}>
                    {loading ? (
                        <div style={{ textAlign: 'center', padding: 60, color: 'var(--enterprise-gray-500)' }}>
                            <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} />
                            <span style={{ marginLeft: 10, fontSize: 13 }}>Loading rack layout…</span>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(auto-fill, minmax(58px, 1fr))' : 'repeat(auto-fill, minmax(72px, 72px))', gap: 8 }}>
                            {allLocs.map(({ loc, occupied }) => (
                                <div
                                    key={loc}
                                    onClick={() => handleCellClick(loc, occupied)}
                                    style={{
                                        aspectRatio: '1 / 1',
                                        minHeight: isMobile ? 58 : 72,
                                        borderRadius: 10,
                                        background: occupied ? c.fill : 'white',
                                        border: occupied ? `1.5px solid ${c.fb}` : `2px solid ${c.border}`,
                                        boxShadow: occupied ? 'none' : `0 0 0 2px ${c.border}22`,
                                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                                        cursor: occupied || placing ? 'not-allowed' : 'pointer',
                                        opacity: occupied ? 0.45 : 1,
                                        userSelect: 'none',
                                        transition: 'transform 0.12s, box-shadow 0.12s',
                                    }}
                                    onMouseEnter={e => { if (!isMobile && !occupied && !placing) { e.currentTarget.style.transform = 'scale(1.05)'; e.currentTarget.style.boxShadow = `0 3px 10px ${c.fb}`; } }}
                                    onMouseLeave={e => { if (!isMobile && !occupied && !placing) { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.boxShadow = `0 0 0 2px ${c.border}22`; } }}
                                    title={occupied ? `${loc} (occupied)` : `Place at ${loc}`}
                                >
                                    {occupied ? (
                                        <Package size={isMobile ? 14 : 16} style={{ color: c.text, opacity: 0.6 }} />
                                    ) : (
                                        <MapPin size={isMobile ? 14 : 16} style={{ color: c.border }} />
                                    )}
                                    <span style={{ fontSize: isMobile ? 10 : 11, fontFamily: 'monospace', fontWeight: 700, color: occupied ? c.text : c.text, marginTop: 2 }}>
                                        {loc}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {placing && (
                    <div style={{ padding: '10px 16px', borderTop: '1px solid var(--enterprise-gray-100)', background: '#f8fafc', fontSize: 13, color: 'var(--enterprise-gray-700)', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Committing GR + placing pallet…
                    </div>
                )}
            </div>
        </div>
    );
}
