/**
 * CreateReleaseByPO — "Paste PO" entry point.
 *
 * Flow:
 *  1. User types/pastes customer PO number (e.g. "260067252-10")
 *  2. `release_parse_po_number` auto-resolves → BPA + parts + availability
 *  3. User selects the part + confirms qty
 *  4. `release_fifo_suggest` auto-suggests pallets
 *  5. User reviews selection, can adjust, then submits
 *  6. Three atomic operations, chained:
 *     a. `release_create` → blanket_releases row
 *     b. `sub_invoice_create` → RPC creates sub-invoice + tariff DRAFT + knock-off
 *  7. Result modal shows both numbers.
 */
import React, { useState } from 'react';
import { X, Search, ChevronRight, AlertCircle, CheckCircle, Zap } from 'lucide-react';
import { Card, LoadingSpinner } from '../ui/EnterpriseUI';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { parsePONumber, createRelease, fifoSuggest, listAvailablePallets, createSubInvoice } from './releaseService';
import type { ParsedPO, AvailablePallet, FifoSuggestion } from './types';

interface Props {
    onClose:   () => void;
    onCreated: () => void;
}

type Step = 'PASTE' | 'PICK' | 'REVIEW' | 'DONE';

export function CreateReleaseByPO({ onClose, onCreated }: Props) {
    const [step, setStep]         = useState<Step>('PASTE');
    const [loading, setLoading]   = useState(false);
    const [error, setError]       = useState<string | null>(null);

    // Step 1
    const [poNumber, setPoNumber] = useState('');
    const [parsed, setParsed]     = useState<ParsedPO | null>(null);

    // Step 2
    const [selectedPartNumber, setSelectedPartNumber] = useState<string>('');
    const [selectedPart, setSelectedPart]             = useState<Record<string, unknown> | null>(null);
    const [requestedQty, setRequestedQty]             = useState<number | ''>('');
    const [buyerName, setBuyerName]                   = useState('');
    const [needByDate, setNeedByDate]                 = useState<string>('');

    // Step 3 (pallets)
    const [suggestion, setSuggestion] = useState<FifoSuggestion | null>(null);
    const [pallets, setPallets]       = useState<AvailablePallet[]>([]);
    const [selectedPalletIds, setSelectedPalletIds] = useState<Set<string>>(new Set());

    // Step 4
    const [result, setResult] = useState<{ release_number: string; sub_invoice_number: string; tariff_invoice_number: string; total_amount: number; pallet_count: number } | null>(null);

    const safeStringProp = (o: Record<string, unknown> | null, k: string): string =>
        o ? String(o[k] ?? '') : '';

    const onLookup = async () => {
        setError(null);
        if (!poNumber.trim()) return setError('Paste a customer PO number');
        setLoading(true);
        try {
            const p: any = await parsePONumber(poNumber.trim());
            setParsed(p);
            if (!p.agreement) return setError(`No active BPA found for PO base ${p.po_base}`);
            if (p.duplicate_release) return setError(`Release ${poNumber} already exists — use the existing release instead`);
            if (p.parts.length === 1) {
                setSelectedPartNumber(String(p.parts[0].part_number));
                setSelectedPart(p.parts[0]);
                setRequestedQty(Number(p.parts[0].release_multiple ?? 0));
            }
            if (p.agreement?.buyer_name) setBuyerName(String(p.agreement.buyer_name));
            setStep('PICK');
        } catch (e: any) {
            setError(e?.message ?? 'Lookup failed');
        } finally {
            setLoading(false);
        }
    };

    const onAutoPickFifo = async () => {
        if (!selectedPartNumber || !requestedQty) return;
        setError(null); setLoading(true);
        try {
            const [fRes, pRes] = await Promise.all([
                fifoSuggest({
                    part_number: selectedPartNumber,
                    required_quantity: Number(requestedQty),
                    agreement_id: parsed?.agreement ? String((parsed.agreement as any).id) : undefined,
                }),
                listAvailablePallets({
                    part_number: selectedPartNumber,
                    agreement_id: parsed?.agreement ? String((parsed.agreement as any).id) : undefined,
                    limit: 100,
                }),
            ]);
            setSuggestion(fRes.suggestion);
            setPallets(pRes.pallets);
            setSelectedPalletIds(new Set(fRes.suggestion.pallet_ids));
            setStep('REVIEW');
        } catch (e: any) {
            setError(e?.message ?? 'FIFO suggestion failed');
        } finally {
            setLoading(false);
        }
    };

    const togglePallet = (id: string) =>
        setSelectedPalletIds(s => {
            const n = new Set(s);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });

    const selectedTotal = Array.from(selectedPalletIds).reduce((s, id) => {
        const p = pallets.find(x => x.pallet_id === id); return s + (p?.quantity ?? 0);
    }, 0);

    const onSubmit = async () => {
        if (!parsed?.agreement || !selectedPart || !requestedQty || !suggestion?.parent_invoice_line_id) {
            return setError('Missing required fields — go back a step');
        }
        if (selectedPalletIds.size === 0) return setError('Select at least one pallet');

        setError(null); setLoading(true);
        try {
            // 1. Create release row
            const rel = await createRelease({
                customer_po_number: poNumber.trim(),
                agreement_id:       String((parsed.agreement as any).id),
                blanket_order_id:   undefined,
                part_number:        selectedPartNumber,
                requested_quantity: Number(requestedQty),
                need_by_date:       needByDate || undefined,
                buyer_name:         buyerName || undefined,
            });

            // 2. Create sub-invoice (atomic RPC — 7 tables)
            const si = await createSubInvoice({
                parent_invoice_line_id: suggestion.parent_invoice_line_id,
                blanket_release_id:     rel.release_id,
                pallet_ids:             Array.from(selectedPalletIds),
                quantity:               Number(requestedQty),
                customer_po_number:     poNumber.trim(),
                buyer_name:             buyerName || undefined,
                idempotency_key:        crypto.randomUUID(),
            });

            setResult({
                release_number:        rel.release_number,
                sub_invoice_number:    si.sub_invoice_number,
                tariff_invoice_number: si.tariff_invoice_number,
                total_amount:          si.total_amount,
                pallet_count:          si.pallet_count,
            });
            setStep('DONE');
        } catch (e: any) {
            setError(e?.message ?? 'Submission failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
            <Card onClick={(e) => e.stopPropagation()} style={{ width: '95%', maxWidth: '1100px', maxHeight: '92vh', overflow: 'auto', padding: 0 }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
                        New Release — Step {step === 'PASTE' ? 1 : step === 'PICK' ? 2 : step === 'REVIEW' ? 3 : 4} of 4
                    </h2>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                </div>

                <div style={{ padding: '20px' }}>
                    {/* Step 1: PASTE */}
                    {step === 'PASTE' && (
                        <>
                            <p style={{ fontSize: 13, color: 'var(--enterprise-gray-600)', marginBottom: 16 }}>
                                Paste the customer Release PO number — format <code>260067252-10</code> (PO base + "-" + release sequence).
                            </p>
                            <Label>Customer PO Number *</Label>
                            <Input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} placeholder="260067252-10" autoFocus />
                            <p style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', marginTop: 6 }}>
                                We'll auto-detect the BPA, parts, buyer, and available pallets.
                            </p>
                        </>
                    )}

                    {/* Step 2: PICK part + qty */}
                    {step === 'PICK' && parsed && (
                        <>
                            <Card style={{ background: '#f0f9ff', borderLeft: '3px solid #2563eb', marginBottom: 16 }}>
                                <div style={{ display: 'flex', gap: 10 }}>
                                    <CheckCircle size={18} color="#2563eb" />
                                    <div style={{ fontSize: 13 }}>
                                        Matched BPA <strong>{safeStringProp(parsed.agreement, 'agreement_number')}</strong>
                                        {' · '}Customer <strong>{safeStringProp(parsed.agreement, 'customer_name')}</strong>
                                        {' · '}{parsed.parts.length} part(s)
                                        {' · '}<strong>{parsed.available_pallets_count}</strong> pallet(s) available in rack
                                    </div>
                                </div>
                            </Card>

                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
                                <div style={{ gridColumn: 'span 3' }}>
                                    <Label>Part *</Label>
                                    <select value={selectedPartNumber} onChange={(e) => {
                                        setSelectedPartNumber(e.target.value);
                                        const p = parsed.parts.find((x: any) => String(x.part_number) === e.target.value) ?? null;
                                        setSelectedPart(p);
                                        if (p) setRequestedQty(Number((p as any).release_multiple ?? 0));
                                    }} style={selectStyle}>
                                        <option value="">— pick a part —</option>
                                        {parsed.parts.map((p: any) => (
                                            <option key={p.id ?? p.part_number} value={p.part_number}>
                                                {p.msn_code} · {p.part_number} · REL MULT {p.release_multiple} · Price {p.unit_price}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <Label>Quantity *</Label>
                                    <Input type="number" value={requestedQty} onChange={(e) => setRequestedQty(e.target.value === '' ? '' : Number(e.target.value))} />
                                    {selectedPart && Number(requestedQty) % Number((selectedPart as any).release_multiple) !== 0 && (
                                        <p style={{ fontSize: 11, color: '#d97706', marginTop: 4 }}>
                                            ⚠ Not a multiple of REL MULT ({(selectedPart as any).release_multiple}). Will proceed with warning.
                                        </p>
                                    )}
                                </div>
                                <div><Label>Buyer</Label><Input value={buyerName} onChange={(e) => setBuyerName(e.target.value)} /></div>
                                <div><Label>Need By</Label><Input type="date" value={needByDate} onChange={(e) => setNeedByDate(e.target.value)} /></div>
                            </div>
                        </>
                    )}

                    {/* Step 3: REVIEW pallets */}
                    {step === 'REVIEW' && suggestion && (
                        <>
                            {suggestion.warnings.length > 0 && (
                                <Card style={{ background: '#fffbeb', borderLeft: '3px solid #d97706', marginBottom: 12 }}>
                                    <div style={{ display: 'flex', gap: 8 }}>
                                        <AlertCircle size={18} color="#d97706" />
                                        <div style={{ fontSize: 13 }}>
                                            {suggestion.warnings.map((w, i) => <div key={i}>{w}</div>)}
                                        </div>
                                    </div>
                                </Card>
                            )}
                            <Card style={{ background: '#f0fdf4', borderLeft: '3px solid #16a34a', marginBottom: 12 }}>
                                <div style={{ fontSize: 13 }}>
                                    <strong>FIFO suggestion:</strong> {suggestion.pallet_count} pallet(s) · {suggestion.total_quantity.toLocaleString()} pcs
                                    {' · '}Parent invoice <strong>{suggestion.parent_invoice_number ?? '—'}</strong>
                                    {' · '}<span style={{ color: 'var(--enterprise-gray-600)' }}>{suggestion.pending_on_parent.toLocaleString()} pcs remaining on it</span>
                                </div>
                            </Card>

                            <div style={{ marginBottom: 12, fontSize: 13 }}>
                                <strong>Selected:</strong> {selectedPalletIds.size} pallet(s) · <strong>{selectedTotal.toLocaleString()}</strong> pcs
                                {' '}<span style={{ color: selectedTotal === Number(requestedQty) ? '#16a34a' : '#d97706' }}>
                                    (requested {Number(requestedQty).toLocaleString()})
                                </span>
                            </div>

                            <div style={{ maxHeight: 400, overflowY: 'auto', border: '1px solid var(--enterprise-gray-200)', borderRadius: 6 }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                    <thead>
                                        <tr style={{ background: 'var(--enterprise-gray-50)', position: 'sticky', top: 0 }}>
                                            <th style={{ padding: 8, width: 30 }}></th>
                                            <th style={headStyle}>Pallet</th>
                                            <th style={headStyle}>Cell</th>
                                            <th style={headStyle}>Qty</th>
                                            <th style={headStyle}>Shipment</th>
                                            <th style={headStyle}>Days in Rack</th>
                                            <th style={headStyle}>From Invoice</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {pallets.map(p => (
                                            <tr key={p.pallet_id}
                                                onClick={() => togglePallet(p.pallet_id)}
                                                style={{
                                                    borderBottom: '1px solid var(--enterprise-gray-100)',
                                                    background: p.is_oldest_shipment ? '#fef9c3' : 'white',
                                                    cursor: 'pointer',
                                                }}>
                                                <td style={{ padding: 8 }}>
                                                    <input type="checkbox" checked={selectedPalletIds.has(p.pallet_id)} onChange={() => togglePallet(p.pallet_id)} />
                                                </td>
                                                <td style={cellStyle}><strong>{p.pallet_number}</strong></td>
                                                <td style={cellStyle}>{p.location_code}</td>
                                                <td style={{ ...cellStyle, textAlign: 'right' }}>{p.quantity}</td>
                                                <td style={cellStyle}>S{p.shipment_sequence ?? '—'} {p.is_oldest_shipment && <Badge variant="warning">OLDEST</Badge>}</td>
                                                <td style={{ ...cellStyle, textAlign: 'right' }}>{p.days_in_rack ?? '—'}</td>
                                                <td style={cellStyle}>{p.parent_invoice_number ?? '—'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </>
                    )}

                    {/* Step 4: DONE */}
                    {step === 'DONE' && result && (
                        <Card style={{ background: '#f0fdf4', borderLeft: '3px solid #16a34a' }}>
                            <div style={{ display: 'flex', gap: 12 }}>
                                <CheckCircle size={24} color="#16a34a" />
                                <div style={{ fontSize: 14 }}>
                                    <p style={{ fontWeight: 600, marginBottom: 6 }}>Release created successfully.</p>
                                    <p>Release <strong>{result.release_number}</strong></p>
                                    <p>Sub-Invoice <strong>{result.sub_invoice_number}</strong></p>
                                    <p>Tariff Invoice <strong>{result.tariff_invoice_number}</strong> (DRAFT — compute rates next)</p>
                                    <p>Pallets assigned: {result.pallet_count} · Amount: {result.total_amount.toLocaleString()}</p>
                                </div>
                            </div>
                        </Card>
                    )}
                </div>

                {error && <div style={{ padding: '12px 20px', background: '#fef2f2', color: '#991b1b' }}>⚠ {error}</div>}

                <div style={{ padding: '12px 20px', borderTop: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between' }}>
                    <Button variant="outline" onClick={onClose} disabled={loading}>
                        {step === 'DONE' ? 'Close' : 'Cancel'}
                    </Button>
                    <div style={{ display: 'flex', gap: 8 }}>
                        {step === 'PICK'   && <Button variant="outline" onClick={() => setStep('PASTE')} disabled={loading}>Back</Button>}
                        {step === 'REVIEW' && <Button variant="outline" onClick={() => setStep('PICK')}  disabled={loading}>Back</Button>}

                        {step === 'PASTE'  && <Button onClick={onLookup} disabled={loading}>{loading ? 'Looking up…' : <><Search size={14} style={{ marginRight: 6 }} />Look up</>}</Button>}
                        {step === 'PICK'   && <Button onClick={onAutoPickFifo} disabled={loading || !selectedPartNumber || !requestedQty}>
                            {loading ? 'Picking…' : <><Zap size={14} style={{ marginRight: 6 }} />Auto-pick FIFO</>}
                        </Button>}
                        {step === 'REVIEW' && <Button onClick={onSubmit} disabled={loading || selectedPalletIds.size === 0}>
                            {loading ? 'Creating…' : <><ChevronRight size={14} style={{ marginRight: 6 }} />Create Release</>}
                        </Button>}
                        {step === 'DONE'   && <Button onClick={onCreated}>Done</Button>}
                    </div>
                </div>
            </Card>
        </div>
    );
}

const selectStyle: React.CSSProperties = {
    width: '100%', height: 36, padding: '0 10px',
    border: '1px solid var(--enterprise-gray-300)', borderRadius: 6,
    fontSize: 13, background: 'white',
};
const headStyle: React.CSSProperties = { padding: 8, textAlign: 'left', fontSize: 11, textTransform: 'uppercase', color: 'var(--enterprise-gray-700)', fontWeight: 600 };
const cellStyle: React.CSSProperties = { padding: 8 };
