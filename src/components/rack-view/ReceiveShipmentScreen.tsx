/**
 * ReceiveShipmentScreen — Milano 3PL receive + Goods Receipt (GR) issue.
 *
 * Industry pattern: ASN → GR → Putaway (SAP EWM / Oracle Fusion / GE / CAT).
 *
 *  Step 1 · SELECT     — Autocomplete search for Proforma Invoice.
 *                        Shows PI card with customer, # MPLs, # pallets,
 *                        existing-GR flag.
 *  Step 2 · VERIFY     — Hierarchical tree grouped by item:
 *                          item (part# · MSN · invoice · BPA · expected qty)
 *                            └─ pallets with RECEIVED / MISSING / SHORT /
 *                               DAMAGED / QUALITY_HOLD toggles + discrepancy
 *                               note + optional received_qty for SHORT.
 *                        Sticky summary panel shows running counts + variance.
 *                        Confirm disabled until every pallet has a status and
 *                        every non-RECEIVED line has a note.
 *  Step 3 · GR ISSUED  — Shows GR number, counts, auto-navigates to Legacy
 *                        Rack View after 2-second hold (primary CTA) for
 *                        physical placement.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Search, CheckCircle, Grid3X3, AlertTriangle, Package, Truck } from 'lucide-react';
import { fetchWithAuth } from '../../utils/supabase/auth';
import { getEdgeFunctionUrl } from '../../utils/supabase/info';
import { Card, LoadingSpinner } from '../ui/EnterpriseUI';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';

type LineStatus = 'RECEIVED' | 'MISSING' | 'DAMAGED' | 'SHORT' | 'QUALITY_HOLD';

interface ProformaMatch {
    id:              string;
    proforma_number: string;
    shipment_number: string | null;
    customer_name:   string | null;
    buyer_name:      string | null;
    dispatched_at:   string | null;
    status:          string;
    total_mpls:      number;
    total_pallets:   number;
    has_existing_gr: boolean;
    gr_number:       string | null;
    gr_status:       string | null;
}
interface PalletExpected {
    pallet_id:     string;
    pallet_number: string | null;
    current_qty:   number;
    state:         string | null;
    expected_qty:  number;
    mpl_id:        string;
}
interface ItemGroup {
    item_code:          string;
    part_number:        string;
    msn_code:           string | null;
    item_name:          string;
    invoice_number:     string | null;
    bpa_number:         string | null;
    total_expected_qty: number;
    pallet_count:       number;
    pallets:            PalletExpected[];
}

interface Props {
    onClose:     () => void;
    onCompleted: (grNumber?: string) => void;   // called with GR# on success
}

async function callEdge<T>(name: string, body: unknown): Promise<T> {
    const res = await fetchWithAuth(getEdgeFunctionUrl(name), { method: 'POST', body: JSON.stringify(body) });
    const json = await res.json();
    if (!res.ok || json?.error) throw new Error(json?.error?.message || json?.error || `Request failed (${res.status})`);
    return json as T;
}

type Step = 'SELECT' | 'VERIFY' | 'DONE';

export function ReceiveShipmentScreen({ onClose, onCompleted }: Props) {
    const [step, setStep]       = useState<Step>('SELECT');
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState<string | null>(null);

    // Step 1
    const [query, setQuery]               = useState('');
    const [matches, setMatches]           = useState<ProformaMatch[]>([]);
    const [searching, setSearching]       = useState(false);
    const [selectedPi, setSelectedPi]     = useState<ProformaMatch | null>(null);

    // Step 2
    const [items, setItems]               = useState<ItemGroup[]>([]);
    const [tick, setTick]                 = useState<Record<string, LineStatus>>({});
    const [rxQty, setRxQty]               = useState<Record<string, number>>({});
    const [notes, setNotes]               = useState<Record<string, string>>({});
    const [receiveNotes, setReceiveNotes] = useState('');

    // Step 3
    const [result, setResult]             = useState<{ gr_number: string; pallets_received: number; pallets_missing: number; pending_placement: number } | null>(null);
    const [autoNavigateIn, setAutoNavigateIn] = useState<number>(0);

    // ── Step 1: debounced search ─────────────────────────────────────
    useEffect(() => {
        if (step !== 'SELECT') return;
        if (query.trim().length < 2) { setMatches([]); return; }
        setSearching(true);
        const t = setTimeout(async () => {
            try {
                const r: any = await callEdge('gr_search_proformas', { query: query.trim(), limit: 10 });
                setMatches(r.matches ?? []);
            } catch (e: any) {
                setError(e?.message ?? 'Search failed');
            } finally {
                setSearching(false);
            }
        }, 300);
        return () => clearTimeout(t);
    }, [query, step]);

    const pickProforma = async (pi: ProformaMatch) => {
        if (pi.has_existing_gr && pi.gr_status === 'COMPLETED') {
            setError(`${pi.proforma_number} already received as ${pi.gr_number} (COMPLETED).`);
            return;
        }
        setError(null); setLoading(true);
        try {
            const r: any = await callEdge('gr_get_proforma_breakdown', { proforma_invoice_id: pi.id });
            if (!r.items || r.items.length === 0) {
                setError('No pallets found for this proforma. Cannot receive an empty shipment.');
                return;
            }
            setSelectedPi(pi);
            setItems(r.items);
            // Default all pallets to RECEIVED
            const initTick: Record<string, LineStatus> = {};
            const initRx:   Record<string, number>    = {};
            for (const it of r.items as ItemGroup[]) {
                for (const p of it.pallets) {
                    initTick[p.pallet_id] = 'RECEIVED';
                    initRx[p.pallet_id]   = p.expected_qty;
                }
            }
            setTick(initTick);
            setRxQty(initRx);
            setStep('VERIFY');
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load shipment details');
        } finally {
            setLoading(false);
        }
    };

    // ── Step 2: derived counters ─────────────────────────────────────
    const totals = useMemo(() => {
        let expected = 0, received = 0, missing = 0, damaged = 0, short = 0, hold = 0;
        let qtyExp = 0, qtyRx = 0;
        for (const it of items) {
            for (const p of it.pallets) {
                expected++;
                qtyExp += p.expected_qty;
                const s = tick[p.pallet_id];
                const rx = rxQty[p.pallet_id] ?? 0;
                switch (s) {
                    case 'RECEIVED':    received++; qtyRx += rx; break;
                    case 'MISSING':     missing++;                break;
                    case 'DAMAGED':     damaged++;  qtyRx += rx;  break;
                    case 'SHORT':       short++;    qtyRx += rx;  break;
                    case 'QUALITY_HOLD': hold++;    qtyRx += rx;  break;
                }
            }
        }
        return { expected, received, missing, damaged, short, hold, qtyExp, qtyRx, variance: qtyRx - qtyExp };
    }, [items, tick, rxQty]);

    const needsNoteForNonRecv = useMemo(() => {
        for (const it of items) {
            for (const p of it.pallets) {
                const s = tick[p.pallet_id];
                if (!s) return true;
                if (s !== 'RECEIVED' && !(notes[p.pallet_id] ?? '').trim()) return true;
            }
        }
        return false;
    }, [items, tick, notes]);

    const setStatus = (palletId: string, status: LineStatus, expectedQty: number) => {
        setTick(t => ({ ...t, [palletId]: status }));
        // When flipping to RECEIVED, auto-reset received_qty to expected
        if (status === 'RECEIVED') setRxQty(q => ({ ...q, [palletId]: expectedQty }));
        // When flipping to MISSING, zero the qty
        if (status === 'MISSING')  setRxQty(q => ({ ...q, [palletId]: 0 }));
    };

    // ── Step 2: submit ───────────────────────────────────────────────
    const confirm = async () => {
        if (!selectedPi) return;
        setError(null); setLoading(true);
        try {
            const lines: any[] = [];
            for (const it of items) {
                for (const p of it.pallets) {
                    const s = tick[p.pallet_id] ?? 'RECEIVED';
                    // Auto-derive SHORT if RECEIVED but qty < expected
                    const actualStatus = (s === 'RECEIVED' && (rxQty[p.pallet_id] ?? 0) < p.expected_qty) ? 'SHORT' : s;
                    lines.push({
                        pallet_id:        p.pallet_id,
                        pallet_number:    p.pallet_number,
                        part_number:      it.part_number,
                        msn_code:         it.msn_code,
                        invoice_number:   it.invoice_number,
                        bpa_number:       it.bpa_number,
                        expected_qty:     p.expected_qty,
                        received_qty:     s === 'MISSING' ? 0 : (rxQty[p.pallet_id] ?? p.expected_qty),
                        line_status:      actualStatus,
                        discrepancy_note: notes[p.pallet_id] ?? null,
                    });
                }
            }

            const warehouseId = await resolveWarehouseId();
            const r: any = await callEdge('gr_confirm_receipt', {
                proforma_invoice_id: selectedPi.id,
                warehouse_id:        warehouseId,
                lines,
                notes:               receiveNotes || null,
                idempotency_key:     crypto.randomUUID(),
            });

            setResult({
                gr_number:          r.gr_number,
                pallets_received:   r.pallets_received,
                pallets_missing:    r.pallets_missing,
                pending_placement:  r.pending_placement,
            });
            setStep('DONE');
            // Start auto-navigate countdown
            setAutoNavigateIn(3);
        } catch (e: any) {
            setError(e?.message ?? 'Confirm failed');
        } finally {
            setLoading(false);
        }
    };

    // Resolve the destination warehouse (Milano 3PL). Priority:
    //   1. Any inv_warehouses row with warehouse_type = '3PL'
    //   2. Warehouse whose code looks like US-transit (WH-US-*)
    //   3. Any active warehouse (fallback — better to proceed than block)
    const resolveWarehouseId = useCallback(async (): Promise<string> => {
        const { getSupabaseClient } = await import('../../utils/supabase/client');
        const sb = getSupabaseClient();

        // Priority 1: 3PL type
        const { data: wh3pl } = await sb
            .from('inv_warehouses')
            .select('id')
            .eq('warehouse_type', '3PL')
            .eq('is_active', true)
            .limit(1);
        if (wh3pl && wh3pl.length > 0) return (wh3pl[0] as any).id;

        // Priority 2: US transit
        const { data: whUs } = await sb
            .from('inv_warehouses')
            .select('id')
            .ilike('warehouse_code', 'WH-US-%')
            .eq('is_active', true)
            .limit(1);
        if (whUs && whUs.length > 0) return (whUs[0] as any).id;

        // Priority 3: any active warehouse
        const { data: any_wh } = await sb
            .from('inv_warehouses')
            .select('id')
            .eq('is_active', true)
            .order('created_at', { ascending: true })
            .limit(1);
        if (any_wh && any_wh.length > 0) return (any_wh[0] as any).id;

        throw new Error('No active warehouse found. Ask admin to configure one.');
    }, []);

    // ── Step 3: auto-navigate countdown ──────────────────────────────
    useEffect(() => {
        if (step !== 'DONE' || !autoNavigateIn || !result) return;
        if (autoNavigateIn <= 0) {
            onCompleted(result.gr_number);
            return;
        }
        const t = setTimeout(() => setAutoNavigateIn(n => n - 1), 1000);
        return () => clearTimeout(t);
    }, [autoNavigateIn, step, result, onCompleted]);

    const stepIndex = step === 'SELECT' ? 1 : step === 'VERIFY' ? 2 : 3;

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Card style={{ width: '96%', maxWidth: 1280, maxHeight: '92vh', overflow: 'hidden', padding: 0, display: 'flex', flexDirection: 'column' }}>
                <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <Truck size={18} color="#1e3a8a" />
                        <h2 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
                            Receive Shipment · Step {stepIndex} of 3
                        </h2>
                        {selectedPi && step !== 'SELECT' && (
                            <Badge variant="neutral">{selectedPi.proforma_number}</Badge>
                        )}
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                </div>

                {/* Content */}
                <div style={{ flex: 1, overflow: 'auto' }}>
                    {step === 'SELECT' && (
                        <SelectStep
                            query={query} onQueryChange={setQuery}
                            matches={matches} searching={searching}
                            onPick={pickProforma} loading={loading}
                        />
                    )}
                    {step === 'VERIFY' && selectedPi && (
                        <VerifyStep
                            pi={selectedPi} items={items}
                            tick={tick} rxQty={rxQty} notes={notes}
                            setStatus={setStatus}
                            setRxQty={(pid, v) => setRxQty(q => ({ ...q, [pid]: v }))}
                            setNote={(pid, v)  => setNotes(n => ({ ...n, [pid]: v }))}
                            receiveNotes={receiveNotes} onReceiveNotesChange={setReceiveNotes}
                            totals={totals}
                        />
                    )}
                    {step === 'DONE' && result && (
                        <DoneStep result={result} autoIn={autoNavigateIn} />
                    )}
                </div>

                {error && <div style={{ padding: '10px 20px', background: '#fef2f2', color: '#991b1b', borderTop: '1px solid #fecaca' }}>⚠ {error}</div>}

                {/* Footer */}
                <div style={{ padding: '12px 20px', borderTop: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between', background: '#f8fafc' }}>
                    <Button variant="outline" onClick={onClose} disabled={loading}>
                        {step === 'DONE' ? 'Close' : 'Cancel'}
                    </Button>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        {step === 'VERIFY' && <Button variant="outline" onClick={() => { setStep('SELECT'); setSelectedPi(null); }} disabled={loading}>Back</Button>}
                        {step === 'VERIFY' && (
                            <Button onClick={confirm} disabled={loading || needsNoteForNonRecv}>
                                {loading ? 'Issuing GR…' : 'Confirm & Issue GR'}
                            </Button>
                        )}
                        {step === 'DONE' && result && (
                            <Button onClick={() => onCompleted(result.gr_number)}>
                                <Grid3X3 size={14} style={{ marginRight: 6 }} />
                                Place Now {autoNavigateIn > 0 && `(${autoNavigateIn})`}
                            </Button>
                        )}
                    </div>
                </div>
            </Card>
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// SelectStep
// ──────────────────────────────────────────────────────────────────────────
function SelectStep({ query, onQueryChange, matches, searching, onPick, loading }: {
    query: string; onQueryChange: (v: string) => void;
    matches: ProformaMatch[]; searching: boolean;
    onPick: (pi: ProformaMatch) => void; loading: boolean;
}) {
    return (
        <div style={{ padding: 20 }}>
            <p style={{ fontSize: 13, color: 'var(--enterprise-gray-600)', marginBottom: 12 }}>
                Search for a proforma invoice. Only shipments that have been dispatched (<strong>STOCK_MOVED</strong>) appear.
            </p>
            <div style={{ position: 'relative', marginBottom: 16 }}>
                <Search size={16} color="#6b7280" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
                <Input
                    value={query}
                    onChange={(e) => onQueryChange(e.target.value)}
                    placeholder="Type proforma #, shipment #, customer or buyer name…"
                    style={{ paddingLeft: 38, fontSize: 14 }}
                    autoFocus
                />
            </div>

            {searching && <div style={{ textAlign: 'center', padding: 20 }}><LoadingSpinner size={24} /></div>}

            {!searching && query.trim().length >= 2 && matches.length === 0 && (
                <p style={{ textAlign: 'center', color: 'var(--enterprise-gray-500)', padding: 20 }}>No matching shipments.</p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {matches.map(pi => {
                    const blocked = pi.has_existing_gr && pi.gr_status === 'COMPLETED';
                    return (
                        <Card
                            key={pi.id}
                            onClick={() => !blocked && !loading && onPick(pi)}
                            style={{
                                padding: 14, cursor: blocked || loading ? 'not-allowed' : 'pointer',
                                borderLeft: blocked ? '3px solid #9ca3af' : '3px solid #2563eb',
                                opacity: blocked ? 0.6 : 1,
                                transition: 'all 0.12s',
                            }}
                        >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                                <div>
                                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 6 }}>
                                        <strong style={{ fontFamily: 'monospace', color: '#1e3a8a', fontSize: 15 }}>{pi.proforma_number}</strong>
                                        {pi.shipment_number && <span style={{ fontSize: 11, color: '#6b7280' }}>· {pi.shipment_number}</span>}
                                        <Badge variant="neutral">{pi.status}</Badge>
                                        {pi.has_existing_gr && (
                                            <Badge variant={(pi.gr_status === 'COMPLETED' ? 'success' : 'warning') as any}>
                                                {pi.gr_status === 'COMPLETED' ? `Received (${pi.gr_number})` : `GR in progress (${pi.gr_number})`}
                                            </Badge>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 12, color: '#4b5563', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                                        <span>Customer: <strong>{pi.customer_name ?? '—'}</strong></span>
                                        <span>Buyer: {pi.buyer_name ?? '—'}</span>
                                        <span>Dispatched: {pi.dispatched_at ? new Date(pi.dispatched_at).toLocaleDateString() : '—'}</span>
                                    </div>
                                </div>
                                <div style={{ textAlign: 'right', fontSize: 12, color: '#6b7280' }}>
                                    <div><strong style={{ color: '#111827', fontSize: 16 }}>{pi.total_pallets}</strong> pallets</div>
                                    <div>{pi.total_mpls} MPL{pi.total_mpls !== 1 ? 's' : ''}</div>
                                </div>
                            </div>
                        </Card>
                    );
                })}
            </div>
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────────
// VerifyStep
// ──────────────────────────────────────────────────────────────────────────
function VerifyStep({ pi, items, tick, rxQty, notes, setStatus, setRxQty, setNote, receiveNotes, onReceiveNotesChange, totals }: {
    pi: ProformaMatch; items: ItemGroup[];
    tick: Record<string, LineStatus>; rxQty: Record<string, number>; notes: Record<string, string>;
    setStatus: (palletId: string, status: LineStatus, expectedQty: number) => void;
    setRxQty: (palletId: string, v: number) => void;
    setNote:  (palletId: string, v: string) => void;
    receiveNotes: string; onReceiveNotesChange: (v: string) => void;
    totals: ReturnType<typeof Object> & any;
}) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 280px', gap: 16, padding: 16 }}>
            {/* LEFT — hierarchical tree */}
            <div>
                <Card style={{ padding: 12, background: '#f8fafc', marginBottom: 12 }}>
                    <div style={{ fontSize: 12, color: '#4b5563', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                        <div><strong style={{ color: '#111827' }}>{pi.proforma_number}</strong><div style={{ fontSize: 11 }}>Proforma</div></div>
                        <div><strong style={{ color: '#111827' }}>{pi.shipment_number ?? '—'}</strong><div style={{ fontSize: 11 }}>Shipment</div></div>
                        <div><strong style={{ color: '#111827' }}>{pi.customer_name ?? '—'}</strong><div style={{ fontSize: 11 }}>Customer</div></div>
                        <div><strong style={{ color: '#111827' }}>{pi.buyer_name ?? '—'}</strong><div style={{ fontSize: 11 }}>Buyer</div></div>
                    </div>
                </Card>

                {items.map((it, idx) => (
                    <Card key={idx} style={{ marginBottom: 12, padding: 0, overflow: 'hidden' }}>
                        <div style={{ padding: '10px 14px', background: '#eff6ff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #dbeafe' }}>
                            <div>
                                <div style={{ fontWeight: 700, color: '#1e3a8a', fontSize: 14 }}>
                                    <Package size={13} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                                    {it.msn_code ?? '—'} · <span style={{ fontFamily: 'monospace' }}>{it.part_number}</span>
                                </div>
                                <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
                                    {it.item_name}
                                </div>
                            </div>
                            <div style={{ fontSize: 11, color: '#475569', textAlign: 'right' }}>
                                <div>Invoice: <strong style={{ fontFamily: 'monospace', color: '#111827' }}>{it.invoice_number ?? '—'}</strong></div>
                                <div>BPA: <strong style={{ fontFamily: 'monospace', color: '#111827' }}>{it.bpa_number ?? '—'}</strong></div>
                                <div><strong>{it.total_expected_qty.toLocaleString()}</strong> pcs · {it.pallet_count} pallets</div>
                            </div>
                        </div>

                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                            <thead>
                                <tr style={{ background: '#f8fafc' }}>
                                    <th style={th}>Pallet #</th>
                                    <th style={th}>Expected</th>
                                    <th style={th}>Received</th>
                                    <th style={th}>Status</th>
                                    <th style={th}>Note</th>
                                </tr>
                            </thead>
                            <tbody>
                                {it.pallets.map(p => {
                                    const s = tick[p.pallet_id];
                                    const rx = rxQty[p.pallet_id] ?? p.expected_qty;
                                    return (
                                        <tr key={p.pallet_id} style={{ borderTop: '1px solid #f1f5f9' }}>
                                            <td style={td}><strong style={{ fontFamily: 'monospace' }}>{p.pallet_number ?? '—'}</strong></td>
                                            <td style={{ ...td, textAlign: 'right', color: '#6b7280' }}>{p.expected_qty.toLocaleString()}</td>
                                            <td style={td}>
                                                <Input
                                                    type="number"
                                                    value={s === 'MISSING' ? '' : rx}
                                                    onChange={(e) => setRxQty(p.pallet_id, Number(e.target.value || 0))}
                                                    disabled={s === 'MISSING'}
                                                    style={{ width: 100, padding: '4px 6px', fontSize: 12 }}
                                                />
                                            </td>
                                            <td style={td}>
                                                <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                                                    {(['RECEIVED','SHORT','DAMAGED','QUALITY_HOLD','MISSING'] as LineStatus[]).map(opt => (
                                                        <button key={opt}
                                                            onClick={() => setStatus(p.pallet_id, opt, p.expected_qty)}
                                                            style={statusBtn(s === opt, opt)}>
                                                            {statusLabel(opt)}
                                                        </button>
                                                    ))}
                                                </div>
                                            </td>
                                            <td style={td}>
                                                {s && s !== 'RECEIVED' && (
                                                    <Input
                                                        value={notes[p.pallet_id] ?? ''}
                                                        onChange={(e) => setNote(p.pallet_id, e.target.value)}
                                                        placeholder={s === 'MISSING' ? 'Why missing?' : s === 'DAMAGED' ? 'Damage details' : s === 'SHORT' ? 'Short by X' : 'QC reason'}
                                                        style={{ fontSize: 12, padding: '4px 8px' }}
                                                    />
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </Card>
                ))}

                <div style={{ marginTop: 12 }}>
                    <Label>GR Notes (optional)</Label>
                    <Input value={receiveNotes} onChange={(e) => onReceiveNotesChange(e.target.value)} placeholder="e.g. Seal intact, truck late 2 hrs" />
                </div>
            </div>

            {/* RIGHT — sticky summary */}
            <div style={{ position: 'sticky', top: 0, alignSelf: 'flex-start' }}>
                <Card style={{ padding: 14, background: '#f8fafc' }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#475569', marginBottom: 8, letterSpacing: 0.5 }}>Summary</div>
                    <div style={{ display: 'grid', gap: 8, fontSize: 13 }}>
                        <SummaryRow label="Expected"   value={`${totals.expected} pallets / ${totals.qtyExp.toLocaleString()} pcs`} />
                        <SummaryRow label="Received"   value={`${totals.received}`} color="#059669" />
                        {totals.short    > 0 && <SummaryRow label="Short"      value={`${totals.short}`}    color="#d97706" />}
                        {totals.damaged  > 0 && <SummaryRow label="Damaged"    value={`${totals.damaged}`}  color="#dc2626" />}
                        {totals.hold     > 0 && <SummaryRow label="Qual. Hold" value={`${totals.hold}`}     color="#7c3aed" />}
                        {totals.missing  > 0 && <SummaryRow label="Missing"    value={`${totals.missing}`}  color="#dc2626" />}
                        <div style={{ borderTop: '1px solid #e2e8f0', margin: '6px 0' }} />
                        <SummaryRow
                            label="Qty variance"
                            value={`${totals.variance >= 0 ? '+' : ''}${totals.variance.toLocaleString()} pcs`}
                            color={totals.variance === 0 ? '#059669' : '#dc2626'}
                        />
                    </div>
                    {totals.variance !== 0 && (
                        <div style={{ marginTop: 10, padding: 8, background: '#fef3c7', borderRadius: 6, fontSize: 11, color: '#92400e', display: 'flex', gap: 6 }}>
                            <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
                            Variance will be logged on the GR for reconciliation.
                        </div>
                    )}
                </Card>
            </div>
        </div>
    );
}

function SummaryRow({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
    return (
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ color: '#6b7280' }}>{label}</span>
            <strong style={{ color: color ?? '#111827' }}>{value}</strong>
        </div>
    );
}

const statusLabel = (s: LineStatus): string =>
    s === 'RECEIVED' ? '✓ Received'
    : s === 'SHORT'     ? 'Short'
    : s === 'DAMAGED'   ? 'Damaged'
    : s === 'QUALITY_HOLD' ? 'QC Hold'
    : '✗ Missing';

const statusBtn = (active: boolean, s: LineStatus): React.CSSProperties => {
    const colors: Record<LineStatus, string> = {
        RECEIVED:     '#16a34a',
        SHORT:        '#d97706',
        DAMAGED:      '#dc2626',
        QUALITY_HOLD: '#7c3aed',
        MISSING:      '#dc2626',
    };
    const c = colors[s];
    return {
        padding: '3px 8px', fontSize: 10, fontWeight: 600, borderRadius: 4, cursor: 'pointer',
        border: `1px solid ${active ? c : '#d1d5db'}`,
        background: active ? c : 'white',
        color: active ? 'white' : '#374151',
        whiteSpace: 'nowrap',
    };
};

const th: React.CSSProperties = { padding: '8px 10px', textAlign: 'left', fontSize: 11, textTransform: 'uppercase', color: '#475569', fontWeight: 700, letterSpacing: 0.3 };
const td: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'top' };

// ──────────────────────────────────────────────────────────────────────────
// DoneStep
// ──────────────────────────────────────────────────────────────────────────
function DoneStep({ result, autoIn }: {
    result: { gr_number: string; pallets_received: number; pallets_missing: number; pending_placement: number };
    autoIn: number;
}) {
    return (
        <div style={{ padding: 28, maxWidth: 560, margin: '0 auto' }}>
            <div style={{ textAlign: 'center', marginBottom: 16 }}>
                <CheckCircle size={40} color="#16a34a" />
                <h3 style={{ fontSize: 20, fontWeight: 700, margin: '10px 0 4px', color: '#065f46' }}>Goods Receipt Issued</h3>
                <p style={{ fontSize: 13, color: '#475569' }}>
                    Immutable legal receipt for finance + customs.
                </p>
            </div>
            <Card style={{ background: '#f0fdf4', borderLeft: '3px solid #16a34a', marginBottom: 14 }}>
                <div style={{ fontSize: 11, color: '#065f46', marginBottom: 4, textTransform: 'uppercase', fontWeight: 700, letterSpacing: 0.5 }}>GR Number</div>
                <div style={{ fontSize: 20, fontFamily: 'monospace', fontWeight: 800, color: '#064e3b', marginBottom: 10 }}>{result.gr_number}</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, fontSize: 13 }}>
                    <div><strong>{result.pallets_received}</strong><div style={{ fontSize: 11, color: '#475569' }}>Received</div></div>
                    <div><strong>{result.pallets_missing}</strong><div style={{ fontSize: 11, color: '#475569' }}>Missing</div></div>
                    <div><strong>{result.pending_placement}</strong><div style={{ fontSize: 11, color: '#475569' }}>To place</div></div>
                </div>
            </Card>
            <Card style={{ background: '#eff6ff', borderLeft: '3px solid #2563eb' }}>
                <div style={{ display: 'flex', gap: 10 }}>
                    <Grid3X3 size={20} color="#2563eb" style={{ flexShrink: 0, marginTop: 2 }} />
                    <div style={{ fontSize: 13 }}>
                        <p style={{ fontWeight: 600, margin: '0 0 4px', color: '#1e3a8a' }}>Next — place pallets on racks</p>
                        <p style={{ margin: 0, color: '#1e40af' }}>
                            Auto-navigating to <strong>Rack View</strong> with this GR pre-loaded in{' '}
                            <strong>{autoIn}s</strong>… or click <em>Place Now</em>.
                        </p>
                    </div>
                </div>
            </Card>
        </div>
    );
}
