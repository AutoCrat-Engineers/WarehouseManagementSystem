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
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    X, Search, ChevronRight, ChevronLeft, CheckCircle2, AlertCircle, Package,
    Layers, Loader2, Truck, ArrowRight, Check,
} from 'lucide-react';
import { fetchWithAuth } from '../../utils/supabase/auth';
import { getEdgeFunctionUrl } from '../../utils/supabase/info';
import { generateIdempotencyKey } from '../../utils/idempotency';

// ============================================================================
// Types
// ============================================================================

type Step = 'SEARCH' | 'SHIPMENT' | 'VERIFY_MPL' | 'DONE';
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

interface Props {
    onClose: () => void;
    onCompleted: (grNumber?: string) => void;
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

export function ReceiveShipmentScreen({ onClose, onCompleted }: Props) {
    const [step, setStep] = useState<Step>('SEARCH');
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
    const [verifyFilter, setVerifyFilter] = useState('');

    // DONE
    const [lastGrNumber, setLastGrNumber] = useState<string | null>(null);

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

    const loadShipmentDetail = useCallback(async (piId: string) => {
        setLoadingDetail(true); setError(null);
        try {
            const r = await callEdge<{ shipment: ShipmentHeader; mpls: MPL[] }>('shipment_detail_get', { proforma_invoice_id: piId });
            setShipment(r.shipment);
            setMpls(r.mpls ?? []);
            setStep('SHIPMENT');
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load shipment details');
        } finally {
            setLoadingDetail(false);
        }
    }, []);

    const startVerifyMpl = (mpl: MPL) => {
        if (mpl.gr) return; // already verified
        setActiveMplId(mpl.mpl_id);
        // Default every pallet to RECEIVED with full expected qty
        const initTick: Record<string, LineStatus> = {};
        const initQty:  Record<string, number> = {};
        for (const p of mpl.pallets) {
            initTick[p.pallet_id] = 'RECEIVED';
            initQty[p.pallet_id]  = p.quantity;
        }
        setTick(initTick);
        setRxQty(initQty);
        setNotes({});
        setMplNote('');
        setVerifyFilter('');
        setStep('VERIFY_MPL');
    };

    const submitMplVerification = async (placeLater: boolean) => {
        if (!shipment || !activeMpl) return;
        setSubmitting(true); setError(null);
        try {
            const lines: any[] = activeMpl.pallets.map(p => {
                const s = tick[p.pallet_id] ?? 'RECEIVED';
                const qty = rxQty[p.pallet_id] ?? p.quantity;
                const actualStatus: LineStatus = (s === 'RECEIVED' && qty < p.quantity) ? 'SHORT' : s;
                return {
                    pallet_id:        p.pallet_id,
                    pallet_number:    p.pallet_number,
                    part_number:      p.part_number,
                    msn_code:         p.msn_code,
                    invoice_number:   activeMpl.invoice_number,
                    bpa_number:       activeMpl.bpa_number,
                    expected_qty:     p.quantity,
                    received_qty:     s === 'MISSING' ? 0 : qty,
                    line_status:      actualStatus,
                    discrepancy_note: notes[p.pallet_id] ?? null,
                };
            });

            const warehouseId = await resolveWarehouseId();
            const r: any = await callEdge('gr_confirm_receipt', {
                proforma_invoice_id: shipment.id,
                warehouse_id:        warehouseId,
                mpl_id:              activeMpl.mpl_id,
                lines,
                notes:               mplNote || null,
                idempotency_key:     generateIdempotencyKey(),
            });

            setLastGrNumber(r.gr_number);

            if (placeLater) {
                // Stay in wizard; refresh detail so the MPL shows verified
                await loadShipmentDetail(shipment.id);
                setActiveMplId(null);
                setStep('SHIPMENT');
            } else {
                // Place Now → close wizard and hand GR # to parent
                setStep('DONE');
                onCompleted(r.gr_number);
            }
        } catch (e: any) {
            setError(e?.message ?? 'GR submission failed');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={backdropStyle} onClick={onClose}>
            <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
                <Header step={step} shipment={shipment} activeMpl={activeMpl} onClose={onClose} onBack={
                    step === 'SHIPMENT' ? () => { setShipment(null); setMpls([]); setStep('SEARCH'); }
                    : step === 'VERIFY_MPL' ? () => { setActiveMplId(null); setStep('SHIPMENT'); }
                    : null
                } />

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
                        />
                    )}

                    {step === 'SHIPMENT' && shipment && (
                        <ShipmentStep
                            shipment={shipment} mpls={mpls}
                            onVerifyMpl={startVerifyMpl}
                        />
                    )}

                    {step === 'VERIFY_MPL' && activeMpl && (
                        <VerifyMplStep
                            mpl={activeMpl}
                            tick={tick} onTickChange={(pid, s) => setTick(prev => ({ ...prev, [pid]: s }))}
                            rxQty={rxQty} onRxQtyChange={(pid, q) => setRxQty(prev => ({ ...prev, [pid]: q }))}
                            notes={notes} onNotesChange={(pid, n) => setNotes(prev => ({ ...prev, [pid]: n }))}
                            mplNote={mplNote} onMplNoteChange={setMplNote}
                            filter={verifyFilter} onFilterChange={setVerifyFilter}
                        />
                    )}
                </div>

                <Footer
                    step={step}
                    shipmentHasMpls={mpls.length > 0}
                    submitting={submitting}
                    onCancel={onClose}
                    onSubmitVerify={submitMplVerification}
                    onCloseSuccess={() => onCompleted(lastGrNumber ?? undefined)}
                />
            </div>
        </div>
    );
}

// ============================================================================
// Chrome
// ============================================================================

function Header({ step, shipment, activeMpl, onClose, onBack }: {
    step: Step; shipment: ShipmentHeader | null; activeMpl: MPL | null;
    onClose: () => void; onBack: (() => void) | null;
}) {
    const title =
        step === 'SEARCH'      ? 'Receive Shipment'
      : step === 'SHIPMENT'    ? `Shipment · ${shipment?.shipment_number ?? shipment?.proforma_number ?? ''}`
      : step === 'VERIFY_MPL' ? `Verify MPL · ${activeMpl?.mpl_number ?? ''}`
      : 'Goods Receipt Issued';
    const subtitle =
        step === 'SEARCH'      ? 'Search by proforma number or shipment number'
      : step === 'SHIPMENT'    ? `${shipment?.customer_name ?? ''}`
      : step === 'VERIFY_MPL' ? `${activeMpl?.pallet_count ?? 0} pallets to verify`
      : '';

    return (
        <div style={{ padding: '18px 24px', borderBottom: '1px solid var(--enterprise-gray-200)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(135deg, #fafbfc 0%, #f1f5f9 100%)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {onBack && (
                    <button onClick={onBack} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--enterprise-gray-600)', padding: 6, borderRadius: 6 }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--enterprise-gray-100)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                        <ChevronLeft size={18} />
                    </button>
                )}
                <div>
                    <h2 style={{ fontSize: 17, fontWeight: 700, color: 'var(--enterprise-gray-900)', margin: 0 }}>{title}</h2>
                    {subtitle && <p style={{ fontSize: 12, color: 'var(--enterprise-gray-600)', margin: '2px 0 0' }}>{subtitle}</p>}
                </div>
            </div>
            <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--enterprise-gray-500)', padding: 6, borderRadius: 6 }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--enterprise-gray-100)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <X size={20} />
            </button>
        </div>
    );
}

function Footer({ step, submitting, onCancel, onSubmitVerify, onCloseSuccess }: {
    step: Step; shipmentHasMpls: boolean; submitting: boolean;
    onCancel: () => void;
    onSubmitVerify: (placeLater: boolean) => void;
    onCloseSuccess: () => void;
}) {
    return (
        <div style={{ padding: '12px 24px', borderTop: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'white' }}>
            <button onClick={onCancel} style={ghostBtn}>Cancel</button>
            <div style={{ display: 'flex', gap: 8 }}>
                {step === 'VERIFY_MPL' && (
                    <>
                        <button onClick={() => onSubmitVerify(true)} disabled={submitting} style={{ ...secondaryBtn, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {submitting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
                            Verify · Place Later
                        </button>
                        <button onClick={() => onSubmitVerify(false)} disabled={submitting} style={{ ...primaryBtn, display: 'flex', alignItems: 'center', gap: 6 }}>
                            {submitting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <ArrowRight size={14} />}
                            Verify · Place Now
                        </button>
                    </>
                )}
                {step === 'DONE' && (
                    <button onClick={onCloseSuccess} style={primaryBtn}>Done</button>
                )}
            </div>
        </div>
    );
}

// ============================================================================
// Step 1 — Search
// ============================================================================

function SearchStep({ query, onQueryChange, matches, searching, onPick, loading }: {
    query: string; onQueryChange: (s: string) => void;
    matches: ProformaMatch[]; searching: boolean;
    onPick: (pi: ProformaMatch) => void; loading: boolean;
}) {
    return (
        <div style={{ padding: 28, maxWidth: 760, margin: '0 auto' }}>
            <div style={{ position: 'relative', marginBottom: 20 }}>
                <Search size={18} style={{ position: 'absolute', left: 14, top: 18, color: 'var(--enterprise-gray-400)' }} />
                <input autoFocus type="text" value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder="e.g., PI-20260315-045 or shipment number…"
                    style={{ width: '100%', padding: '16px 16px 16px 44px', fontSize: 15, border: '1.5px solid var(--enterprise-gray-300)', borderRadius: 10, outline: 'none', fontFamily: 'monospace', boxSizing: 'border-box' }}
                    onFocus={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-primary)'}
                    onBlur={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-gray-300)'} />
                {searching && <Loader2 size={16} style={{ position: 'absolute', right: 14, top: 19, color: 'var(--enterprise-gray-400)', animation: 'spin 1s linear infinite' }} />}
            </div>

            {loading && (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--enterprise-gray-500)' }}>
                    <Loader2 size={18} style={{ animation: 'spin 1s linear infinite', verticalAlign: 'middle' }} /> Loading shipment…
                </div>
            )}

            {!loading && matches.length === 0 && query.length >= 2 && !searching && (
                <div style={{ textAlign: 'center', padding: 40, color: 'var(--enterprise-gray-500)', fontSize: 13 }}>
                    No dispatched shipments match "{query}".
                </div>
            )}

            {!loading && matches.length === 0 && query.length < 2 && (
                <div style={{ padding: 32, textAlign: 'center', background: 'rgba(30,58,138,0.03)', border: '1px dashed rgba(30,58,138,0.15)', borderRadius: 10 }}>
                    <Truck size={28} style={{ color: 'var(--enterprise-primary)', opacity: 0.5 }} />
                    <p style={{ color: 'var(--enterprise-gray-700)', fontWeight: 600, fontSize: 14, marginTop: 10, marginBottom: 4 }}>Start by searching</p>
                    <p style={{ color: 'var(--enterprise-gray-500)', fontSize: 12, margin: 0 }}>Type a proforma number, shipment number, or customer name.</p>
                </div>
            )}

            {!loading && matches.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {matches.map(m => (
                        <button key={m.id} onClick={() => onPick(m)}
                            style={{ display: 'block', width: '100%', textAlign: 'left', padding: '14px 16px', background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 10, cursor: 'pointer', transition: 'all 0.15s ease', font: 'inherit' }}
                            onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--enterprise-primary)'; e.currentTarget.style.background = 'rgba(30,58,138,0.02)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--enterprise-gray-200)'; e.currentTarget.style.background = 'white'; }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                                    <span style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: 'var(--enterprise-primary)' }}>
                                        {m.shipment_number ?? m.proforma_number}
                                    </span>
                                    {m.shipment_number && <span style={{ fontSize: 11, color: 'var(--enterprise-gray-500)' }}>PI {m.proforma_number}</span>}
                                </div>
                                {m.has_existing_gr && <span style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', background: '#dcfce7', padding: '3px 8px', borderRadius: 10 }}>GR ISSUED</span>}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--enterprise-gray-700)', marginBottom: 4 }}>{m.customer_name ?? '—'}</div>
                            <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', display: 'flex', gap: 10 }}>
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

// ============================================================================
// Step 2 — Shipment (MPL list)
// ============================================================================

function ShipmentStep({ shipment, mpls, onVerifyMpl }: { shipment: ShipmentHeader; mpls: MPL[]; onVerifyMpl: (m: MPL) => void }) {
    const verifiedCount = mpls.filter(m => m.gr).length;
    return (
        <div style={{ padding: 24, maxWidth: 960, margin: '0 auto' }}>
            {/* Shipment summary card */}
            <div style={{ background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 12, padding: 18, marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                    <div>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--enterprise-gray-500)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Shipment</div>
                        <div style={{ fontFamily: 'monospace', fontSize: 20, fontWeight: 800, color: 'var(--enterprise-gray-900)', marginTop: 2 }}>
                            {shipment.shipment_number ?? shipment.proforma_number}
                        </div>
                        {shipment.shipment_number && (
                            <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', marginTop: 2 }}>PI {shipment.proforma_number}</div>
                        )}
                    </div>
                    <div style={{ textAlign: 'right', fontSize: 13 }}>
                        <div style={{ color: 'var(--enterprise-gray-800)', fontWeight: 600 }}>{shipment.customer_name}</div>
                        {shipment.stock_moved_at && (
                            <div style={{ color: 'var(--enterprise-gray-500)', fontSize: 11, marginTop: 2 }}>Dispatched {new Date(shipment.stock_moved_at).toLocaleDateString()}</div>
                        )}
                    </div>
                </div>

                {/* Progress */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: verifiedCount === mpls.length ? 'var(--enterprise-success)' : 'var(--enterprise-gray-700)', minWidth: 60 }}>
                        {verifiedCount} / {mpls.length} MPLs
                    </span>
                    <div style={{ flex: 1, height: 5, background: 'var(--enterprise-gray-200)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${mpls.length === 0 ? 0 : (verifiedCount / mpls.length) * 100}%`, height: '100%', background: verifiedCount === mpls.length ? 'var(--enterprise-success)' : 'var(--enterprise-primary)', transition: 'width 0.3s ease' }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--enterprise-gray-500)' }}>verified</span>
                </div>
            </div>

            {/* MPL cards */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {mpls.map(m => <MPLCard key={m.mpl_id} mpl={m} onVerify={() => onVerifyMpl(m)} />)}
            </div>
        </div>
    );
}

function MPLCard({ mpl, onVerify }: { mpl: MPL; onVerify: () => void }) {
    const verified = !!mpl.gr;
    const hasDiscrepancy = verified && ((mpl.gr!.total_pallets_missing + mpl.gr!.total_pallets_damaged) > 0);
    const accent = hasDiscrepancy ? '#dc2626' : verified ? '#16a34a' : '#2563eb';

    return (
        <div style={{ border: '1px solid var(--enterprise-gray-200)', borderRadius: 10, background: 'white', overflow: 'hidden', display: 'flex', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
            <div style={{ width: 4, background: accent }} />
            <div style={{ flex: 1, padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, flex: 1, minWidth: 0 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: `${accent}15`, color: accent, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Layers size={16} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--enterprise-gray-900)' }}>{mpl.mpl_number}</div>
                        <div style={{ fontSize: 11, color: 'var(--enterprise-gray-600)', marginTop: 2, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            {mpl.invoice_number && <span>INV <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{mpl.invoice_number}</span></span>}
                            {mpl.bpa_number && <span>· BPA <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{mpl.bpa_number}</span></span>}
                            <span>· {mpl.pallet_count} pallet{mpl.pallet_count !== 1 ? 's' : ''} · {mpl.qty_total.toLocaleString()} pcs</span>
                        </div>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                    {verified ? (
                        <>
                            <div style={{ textAlign: 'right', fontSize: 11 }}>
                                <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--enterprise-gray-800)' }}>{mpl.gr!.gr_number}</div>
                                <div style={{ color: 'var(--enterprise-gray-500)', marginTop: 2 }}>
                                    {mpl.gr!.total_pallets_received} received
                                    {(mpl.gr!.total_pallets_missing + mpl.gr!.total_pallets_damaged) > 0 &&
                                        <span style={{ color: '#dc2626', fontWeight: 600 }}>
                                            {' '}· {mpl.gr!.total_pallets_missing + mpl.gr!.total_pallets_damaged} issue{mpl.gr!.total_pallets_missing + mpl.gr!.total_pallets_damaged !== 1 ? 's' : ''}
                                        </span>}
                                </div>
                            </div>
                            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase', padding: '5px 10px', borderRadius: 10, color: hasDiscrepancy ? '#991b1b' : '#166534', background: hasDiscrepancy ? '#fee2e2' : '#dcfce7', display: 'flex', alignItems: 'center', gap: 4 }}>
                                <CheckCircle2 size={11} /> Verified
                            </span>
                        </>
                    ) : (
                        <button onClick={onVerify} style={{ ...primaryBtn, display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px' }}>
                            Verify <ChevronRight size={14} />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// Step 3 — Verify MPL
// ============================================================================

function VerifyMplStep({ mpl, tick, onTickChange, rxQty, onRxQtyChange, notes, onNotesChange, mplNote, onMplNoteChange, filter, onFilterChange }: {
    mpl: MPL;
    tick: Record<string, LineStatus>; onTickChange: (pid: string, s: LineStatus) => void;
    rxQty: Record<string, number>; onRxQtyChange: (pid: string, q: number) => void;
    notes: Record<string, string>; onNotesChange: (pid: string, n: string) => void;
    mplNote: string; onMplNoteChange: (s: string) => void;
    filter: string; onFilterChange: (s: string) => void;
}) {
    // Running counts
    const rxCount = Object.entries(tick).filter(([, s]) => s === 'RECEIVED').length;
    const missCount = Object.entries(tick).filter(([, s]) => s === 'MISSING').length;
    const damCount = Object.entries(tick).filter(([, s]) => s === 'DAMAGED' || s === 'SHORT' || s === 'QUALITY_HOLD').length;

    const f = filter.trim().toLowerCase();
    const visible = f
        ? mpl.pallets.filter(p => (p.part_number ?? '').toLowerCase().includes(f) || (p.msn_code ?? '').toLowerCase().includes(f) || (p.pallet_number ?? '').toLowerCase().includes(f))
        : mpl.pallets;

    return (
        <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>
            {/* MPL summary + counts strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10, marginBottom: 14 }}>
                <MiniCount label="Total"     value={mpl.pallets.length} />
                <MiniCount label="Received"  value={rxCount}  color="#16a34a" />
                <MiniCount label="Missing"   value={missCount} color="#dc2626" />
                <MiniCount label="Discrepancy" value={damCount} color="#d97706" />
                <MiniCount label="Qty"       value={mpl.qty_total.toLocaleString()} />
            </div>

            {/* Search */}
            <div style={{ position: 'relative', marginBottom: 14 }}>
                <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--enterprise-gray-400)' }} />
                <input type="text" value={filter}
                    onChange={(e) => onFilterChange(e.target.value)}
                    placeholder="Filter by part #, MSN, or pallet #…"
                    style={{ width: '100%', padding: '10px 12px 10px 36px', fontSize: 13, border: '1px solid var(--enterprise-gray-200)', borderRadius: 8, outline: 'none', boxSizing: 'border-box' }}
                    onFocus={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-primary)'}
                    onBlur={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-gray-200)'} />
            </div>

            {/* Pallet list */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visible.map(p => (
                    <PalletRow key={p.pallet_id} pallet={p}
                        status={tick[p.pallet_id] ?? 'RECEIVED'}
                        rxQty={rxQty[p.pallet_id] ?? p.quantity}
                        note={notes[p.pallet_id] ?? ''}
                        onStatusChange={(s) => onTickChange(p.pallet_id, s)}
                        onQtyChange={(q) => onRxQtyChange(p.pallet_id, q)}
                        onNoteChange={(n) => onNotesChange(p.pallet_id, n)}
                    />
                ))}
            </div>

            {/* Overall MPL note */}
            <div style={{ marginTop: 18 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--enterprise-gray-700)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6, display: 'block' }}>
                    MPL Note (optional)
                </label>
                <textarea value={mplNote} onChange={(e) => onMplNoteChange(e.target.value)}
                    placeholder="Overall notes for this MPL's Goods Receipt…"
                    rows={2}
                    style={{ width: '100%', padding: '10px 12px', fontSize: 13, border: '1px solid var(--enterprise-gray-200)', borderRadius: 8, outline: 'none', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit' }}
                    onFocus={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-primary)'}
                    onBlur={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-gray-200)'} />
            </div>
        </div>
    );
}

function PalletRow({ pallet, status, rxQty, note, onStatusChange, onQtyChange, onNoteChange }: {
    pallet: Pallet; status: LineStatus; rxQty: number; note: string;
    onStatusChange: (s: LineStatus) => void; onQtyChange: (q: number) => void; onNoteChange: (n: string) => void;
}) {
    const accent = status === 'RECEIVED' ? '#16a34a' : status === 'MISSING' ? '#dc2626' : '#d97706';
    const showNote = status !== 'RECEIVED';
    return (
        <div style={{ border: '1px solid var(--enterprise-gray-200)', borderRadius: 8, padding: '10px 12px', background: 'white' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1.3fr', gap: 12, alignItems: 'center' }}>
                <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--enterprise-info, #3b82f6)', background: 'rgba(59,130,246,0.1)', padding: '1px 7px', borderRadius: 4 }}>{pallet.part_number}</span>
                        <span style={{ fontSize: 11, color: 'var(--enterprise-gray-600)' }}>{pallet.msn_code}</span>
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginTop: 2, fontFamily: 'monospace' }}>{pallet.pallet_number}</div>
                </div>
                <div>
                    <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Expected</div>
                    <div style={{ fontSize: 13, fontWeight: 700, fontFamily: 'monospace', marginTop: 2 }}>{pallet.quantity.toLocaleString()}</div>
                </div>
                <div>
                    <label style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 2 }}>Received Qty</label>
                    <input type="number" min={0} max={pallet.quantity}
                        value={status === 'MISSING' ? 0 : rxQty}
                        disabled={status === 'MISSING'}
                        onChange={(e) => onQtyChange(Math.max(0, Number(e.target.value) || 0))}
                        style={{ width: '100%', padding: '6px 8px', fontSize: 13, border: '1px solid var(--enterprise-gray-200)', borderRadius: 6, outline: 'none', fontFamily: 'monospace', boxSizing: 'border-box' }} />
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                    {(['RECEIVED','MISSING','DAMAGED','SHORT','QUALITY_HOLD'] as LineStatus[]).map(s => {
                        const active = status === s;
                        const label = s === 'QUALITY_HOLD' ? 'Q. HOLD' : s;
                        return (
                            <button key={s} onClick={() => onStatusChange(s)}
                                style={{
                                    flex: 1, padding: '6px 4px', fontSize: 10, fontWeight: 700, letterSpacing: '0.3px',
                                    border: active ? `1.5px solid ${accent}` : '1px solid var(--enterprise-gray-200)',
                                    background: active ? `${accent}15` : 'white',
                                    color: active ? accent : 'var(--enterprise-gray-600)',
                                    borderRadius: 6, cursor: 'pointer',
                                }}>
                                {label}
                            </button>
                        );
                    })}
                </div>
            </div>
            {showNote && (
                <div style={{ marginTop: 8 }}>
                    <input type="text" value={note} onChange={(e) => onNoteChange(e.target.value)}
                        placeholder="Discrepancy note (required for non-RECEIVED status)…"
                        style={{ width: '100%', padding: '6px 10px', fontSize: 12, border: '1px solid var(--enterprise-gray-300)', borderRadius: 6, outline: 'none', boxSizing: 'border-box' }} />
                </div>
            )}
        </div>
    );
}

function MiniCount({ label, value, color }: { label: string; value: number | string; color?: string }) {
    return (
        <div style={{ background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: color ?? 'var(--enterprise-gray-900)', marginTop: 2 }}>{value}</div>
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
