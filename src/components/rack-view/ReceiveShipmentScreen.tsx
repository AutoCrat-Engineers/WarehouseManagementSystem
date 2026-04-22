/**
 * ReceiveShipmentScreen — Milano's "Receive Shipment" flow.
 *
 * Step 1: Enter proforma (or invoice) # → system lists expected pallets.
 * Step 2: Tick received pallets; mark discrepancies with notes.
 * Step 3: Confirm → pallets move to state ARRIVED_AT_3PL.
 * Step 4: Optionally — place each received pallet on an empty rack cell
 *         (delegates to pallet_place RPC; can also be done later from
 *         the rack grid UI).
 */
import React, { useState } from 'react';
import { X, Search, CheckCircle, MapPin } from 'lucide-react';
import { Card } from '../ui/EnterpriseUI';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Badge } from '../ui/badge';
import { LoadingSpinner } from '../ui/EnterpriseUI';
import { listExpectedPallets, confirmReceipt, placePallet, getRackView } from './rackService';
import type { ExpectedPallet, RackCell } from './types';

interface Props {
    onClose: () => void;
    onCompleted: () => void;
}

type Step = 'LOOKUP' | 'TICK' | 'PLACE';

export function ReceiveShipmentScreen({ onClose, onCompleted }: Props) {
    const [step, setStep] = useState<Step>('LOOKUP');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Step 1 inputs
    const [proformaNo, setProformaNo] = useState('');
    const [invoiceNo, setInvoiceNo] = useState('');

    // Step 2 state
    const [expected, setExpected] = useState<ExpectedPallet[]>([]);
    const [tickState, setTickState] = useState<Record<string, 'RECEIVED' | 'MISSING' | null>>({});
    const [discrepancyNotes, setDiscrepancyNotes] = useState<Record<string, string>>({});

    // Step 3 state (place)
    const [receivedPallets, setReceivedPallets] = useState<Array<{ id: string; pallet_number: string }>>([]);
    const [emptyCells, setEmptyCells] = useState<RackCell[]>([]);
    const [placeMap, setPlaceMap] = useState<Record<string, string>>({});  // palletId -> cellId
    const [warehouseId, setWarehouseId] = useState<string | null>(null);

    const lookup = async () => {
        setError(null);
        if (!proformaNo.trim() && !invoiceNo.trim()) {
            return setError('Enter a proforma or invoice number');
        }
        setLoading(true);
        try {
            const params: any = proformaNo.trim()
                ? { proforma_invoice_number: proformaNo.trim() }
                : { invoice_number: invoiceNo.trim() };
            const res = await listExpectedPallets(params);
            if (res.expected_pallets.length === 0) {
                return setError('No pallets found for that reference.');
            }
            setExpected(res.expected_pallets);
            const init: Record<string, 'RECEIVED' | 'MISSING' | null> = {};
            for (const p of res.expected_pallets) init[p.id] = 'RECEIVED';  // default all received
            setTickState(init);
            setStep('TICK');
        } catch (e: any) {
            setError(e?.message ?? 'Lookup failed');
        } finally {
            setLoading(false);
        }
    };

    const confirm = async () => {
        setError(null);
        const receivedIds = Object.keys(tickState).filter(id => tickState[id] === 'RECEIVED');
        if (receivedIds.length === 0) return setError('Tick at least one received pallet');

        const missingIds = Object.keys(tickState).filter(id => tickState[id] === 'MISSING');
        const notes: Record<string, string> = {};
        for (const id of missingIds) {
            notes[id] = discrepancyNotes[id] || 'Missing';
        }

        setLoading(true);
        try {
            const res = await confirmReceipt({
                pallet_ids: [...receivedIds, ...missingIds],
                discrepancy_notes: notes,
            });
            setReceivedPallets(res.pallets.filter(p => receivedIds.includes(p.id)));

            // Load empty cells to optionally place pallets
            const rackRes = await getRackView({ status_filter: 'EMPTY' });
            setEmptyCells(rackRes.cells);
            if (rackRes.cells.length > 0) setWarehouseId(rackRes.cells[0].warehouse_id);
            setStep('PLACE');
        } catch (e: any) {
            setError(e?.message ?? 'Confirm failed');
        } finally {
            setLoading(false);
        }
    };

    const finishPlacement = async () => {
        setError(null);
        const placements = Object.entries(placeMap);
        if (placements.length === 0) {
            // Skip placement; Milano can place later from main grid
            return onCompleted();
        }
        setLoading(true);
        try {
            for (const [palletId, cellId] of placements) {
                const cell = emptyCells.find(c => c.rack_location_id === cellId);
                if (!cell) continue;
                await placePallet({
                    pallet_id:       palletId,
                    warehouse_id:    cell.warehouse_id,
                    rack:            cell.rack,
                    location_number: cell.location_number,
                    idempotency_key: crypto.randomUUID(),
                });
            }
            onCompleted();
        } catch (e: any) {
            setError(e?.message ?? 'Placement failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Card style={{ width: '95%', maxWidth: '980px', maxHeight: '90vh', overflow: 'auto', padding: 0 }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>Receive Shipment — Step {step === 'LOOKUP' ? 1 : step === 'TICK' ? 2 : 3} of 3</h2>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                </div>

                {/* Step 1: LOOKUP */}
                {step === 'LOOKUP' && (
                    <div style={{ padding: '20px' }}>
                        <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-600)', marginBottom: '16px' }}>
                            Enter the proforma invoice # (preferred) or shipping invoice # to see expected pallets.
                        </p>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                            <div><Label>Proforma Invoice #</Label><Input value={proformaNo} onChange={(e) => setProformaNo(e.target.value)} /></div>
                            <div><Label>OR Invoice #</Label><Input value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></div>
                        </div>
                    </div>
                )}

                {/* Step 2: TICK */}
                {step === 'TICK' && (
                    <div style={{ padding: '20px' }}>
                        <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-600)', marginBottom: '10px' }}>
                            <strong>{expected.length}</strong> pallet(s) expected. Mark received / missing below.
                        </p>
                        <div style={{ overflowX: 'auto', maxHeight: '420px', overflowY: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{ background: 'var(--enterprise-gray-50)', position: 'sticky', top: 0 }}>
                                        <th style={cellHead}>Pallet #</th>
                                        <th style={cellHead}>State</th>
                                        <th style={cellHead}>Qty</th>
                                        <th style={cellHead}>Action</th>
                                        <th style={cellHead}>Note (if missing)</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {expected.map(p => {
                                        const ts = tickState[p.id];
                                        return (
                                            <tr key={p.id} style={{ borderBottom: '1px solid var(--enterprise-gray-100)' }}>
                                                <td style={cellBody}><strong>{p.pallet_number}</strong></td>
                                                <td style={cellBody}><Badge variant="neutral">{p.state}</Badge></td>
                                                <td style={{ ...cellBody, textAlign: 'right' }}>{p.current_qty}</td>
                                                <td style={cellBody}>
                                                    <div style={{ display: 'flex', gap: '4px' }}>
                                                        <button
                                                            onClick={() => setTickState(s => ({ ...s, [p.id]: 'RECEIVED' }))}
                                                            style={tickBtn(ts === 'RECEIVED', '#16a34a')}>✓ Received</button>
                                                        <button
                                                            onClick={() => setTickState(s => ({ ...s, [p.id]: 'MISSING' }))}
                                                            style={tickBtn(ts === 'MISSING', '#dc2626')}>✗ Missing</button>
                                                    </div>
                                                </td>
                                                <td style={cellBody}>
                                                    {ts === 'MISSING' && (
                                                        <Input
                                                            value={discrepancyNotes[p.id] ?? ''}
                                                            onChange={(e) => setDiscrepancyNotes(n => ({ ...n, [p.id]: e.target.value }))}
                                                            placeholder="Damage / short / wrong part…"
                                                        />
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Step 3: PLACE */}
                {step === 'PLACE' && (
                    <div style={{ padding: '20px' }}>
                        <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-600)', marginBottom: '10px' }}>
                            <CheckCircle size={14} style={{ verticalAlign: 'middle', color: '#16a34a', marginRight: '4px' }} />
                            <strong>{receivedPallets.length}</strong> pallet(s) received. Assign each to a rack cell, or skip and place later.
                        </p>
                        {receivedPallets.length === 0 ? (
                            <p style={{ color: 'var(--enterprise-gray-500)' }}>No pallets to place.</p>
                        ) : (
                            <div style={{ maxHeight: '380px', overflowY: 'auto' }}>
                                {receivedPallets.map(p => {
                                    const selCell = placeMap[p.id];
                                    return (
                                        <div key={p.id} style={{ padding: '8px 10px', border: '1px solid var(--enterprise-gray-200)', borderRadius: '6px', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <MapPin size={14} color="#6b7280" />
                                            <div style={{ flex: 1 }}><strong>{p.pallet_number}</strong></div>
                                            <select
                                                value={selCell ?? ''}
                                                onChange={(e) => setPlaceMap(m => ({ ...m, [p.id]: e.target.value }))}
                                                style={{
                                                    padding: '6px 8px', fontSize: '13px',
                                                    border: '1px solid var(--enterprise-gray-300)', borderRadius: '4px',
                                                    minWidth: '160px',
                                                }}>
                                                <option value="">— Skip (place later) —</option>
                                                {emptyCells.map(c => (
                                                    <option key={c.rack_location_id} value={c.rack_location_id}>
                                                        {c.location_code}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {error && <div style={{ padding: '12px 20px', background: '#fef2f2', color: '#991b1b' }}>⚠ {error}</div>}

                <div style={{ padding: '12px 20px', borderTop: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between' }}>
                    <Button variant="outline" onClick={onClose} disabled={loading}>Cancel</Button>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        {step === 'TICK' && <Button variant="outline" onClick={() => setStep('LOOKUP')} disabled={loading}>Back</Button>}
                        {step === 'PLACE' && <Button variant="outline" onClick={onCompleted} disabled={loading}>Skip & Finish</Button>}

                        {step === 'LOOKUP' && <Button onClick={lookup} disabled={loading}>{loading ? 'Looking up…' : <><Search size={14} style={{ marginRight: '6px' }} />Look up</>}</Button>}
                        {step === 'TICK'   && <Button onClick={confirm} disabled={loading}>{loading ? 'Confirming…' : 'Confirm Receipt'}</Button>}
                        {step === 'PLACE'  && <Button onClick={finishPlacement} disabled={loading}>{loading ? 'Placing…' : 'Place Pallets & Finish'}</Button>}
                    </div>
                </div>
            </Card>
        </div>
    );
}

const cellHead: React.CSSProperties = { padding: '10px', textAlign: 'left', fontSize: '11px', textTransform: 'uppercase', color: 'var(--enterprise-gray-700)', fontWeight: 600, borderBottom: '1px solid var(--enterprise-gray-200)' };
const cellBody: React.CSSProperties = { padding: '8px 10px' };
const tickBtn = (active: boolean, activeColor: string): React.CSSProperties => ({
    padding: '4px 8px', fontSize: '11px', fontWeight: 600, borderRadius: '4px', cursor: 'pointer',
    border: `1px solid ${active ? activeColor : '#d1d5db'}`,
    background: active ? activeColor : 'white',
    color: active ? 'white' : '#374151',
});
