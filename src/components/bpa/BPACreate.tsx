/**
 * BPACreate — "New BPA" modal form.
 *
 * Header + repeating part lines. Calls bpa_create edge function. On
 * success, navigates caller to the freshly-created BPA's detail view.
 */
import React, { useState } from 'react';
import { X, Plus, Trash2, Save } from 'lucide-react';
import { Card } from '../ui/EnterpriseUI';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { createBPA } from './bpaService';
import { emptyAgreementForm, emptyPart } from './types';
import type { AgreementCreateForm, AgreementPartForm, AgreementType } from './types';

interface Props {
    onClose: () => void;
    onCreated: (agreementId: string) => void;
}

export function BPACreate({ onClose, onCreated }: Props) {
    const [form, setForm] = useState<AgreementCreateForm>(emptyAgreementForm());
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const updateField = (k: keyof AgreementCreateForm, v: string) => setForm(f => ({ ...f, [k]: v }));
    const updatePart  = (idx: number, k: keyof AgreementPartForm, v: any) => setForm(f => ({
        ...f, parts: f.parts.map((p, i) => i === idx ? { ...p, [k]: v } : p),
    }));
    const addPart     = () => setForm(f => ({ ...f, parts: [...f.parts, emptyPart()] }));
    const removePart  = (idx: number) => setForm(f => ({
        ...f, parts: f.parts.length > 1 ? f.parts.filter((_, i) => i !== idx) : f.parts,
    }));

    const handleSubmit = async () => {
        setError(null);
        // Client-side guards
        if (!form.agreement_number.trim()) return setError('Agreement number required');
        if (!form.customer_name.trim())    return setError('Customer name required');
        if (form.effective_start_date > form.effective_end_date) return setError('Effective dates inverted');
        for (let i = 0; i < form.parts.length; i++) {
            const p = form.parts[i];
            if (!p.part_number || !p.msn_code || !p.drawing_number || !p.blanket_quantity || !p.unit_price || !p.release_multiple) {
                return setError(`Part #${i + 1}: part_number, msn_code, drawing_number, blanket_quantity, unit_price, release_multiple are required`);
            }
        }

        setSubmitting(true);
        try {
            const res = await createBPA(form);
            onCreated(res.agreement_id);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to create agreement');
        } finally {
            setSubmitting(false);
        }
    };

    const numInput = (v: number | null, onChange: (n: number | null) => void, step = '1') => (
        <Input type="number" step={step} value={v ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
    );

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={onClose}>
            <Card onClick={(e) => e.stopPropagation()} style={{
                width: '95%', maxWidth: '1200px', maxHeight: '90vh', overflow: 'auto', padding: 0,
            }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>New Blanket Purchase Agreement</h2>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                </div>

                <div style={{ padding: '20px' }}>
                    {/* Header */}
                    <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--enterprise-gray-700)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>Agreement Header</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginBottom: '24px' }}>
                        <div><Label>Agreement # *</Label><Input value={form.agreement_number} onChange={(e) => updateField('agreement_number', e.target.value)} placeholder="260067252" /></div>
                        <div><Label>Type</Label>
                            <select value={form.agreement_type} onChange={(e) => updateField('agreement_type', e.target.value as AgreementType)} style={selectStyle}>
                                <option>BPA</option><option>ANNUAL_CONTRACT</option><option>SPOT</option><option>OTHER</option>
                            </select>
                        </div>
                        <div><Label>Title</Label><Input value={form.agreement_title} onChange={(e) => updateField('agreement_title', e.target.value)} placeholder="(optional)" /></div>
                        <div><Label>Customer Code *</Label><Input value={form.customer_code} onChange={(e) => updateField('customer_code', e.target.value)} placeholder="OPW" /></div>
                        <div><Label>Customer Name *</Label><Input value={form.customer_name} onChange={(e) => updateField('customer_name', e.target.value)} placeholder="OPW Fueling Components" /></div>
                        <div><Label>Buyer</Label><Input value={form.buyer_name} onChange={(e) => updateField('buyer_name', e.target.value)} placeholder="Wood, Sherrill" /></div>
                        <div><Label>Buyer Email</Label><Input type="email" value={form.buyer_email} onChange={(e) => updateField('buyer_email', e.target.value)} /></div>
                        <div><Label>Agreement Date</Label><Input type="date" value={form.agreement_date} onChange={(e) => updateField('agreement_date', e.target.value)} /></div>
                        <div><Label>Currency</Label><Input value={form.currency_code} onChange={(e) => updateField('currency_code', e.target.value)} /></div>
                        <div><Label>Effective Start *</Label><Input type="date" value={form.effective_start_date} onChange={(e) => updateField('effective_start_date', e.target.value)} /></div>
                        <div><Label>Effective End *</Label><Input type="date" value={form.effective_end_date} onChange={(e) => updateField('effective_end_date', e.target.value)} /></div>
                        <div><Label>Payment Terms</Label><Input value={form.payment_terms} onChange={(e) => updateField('payment_terms', e.target.value)} placeholder="Net 90" /></div>
                        <div><Label>Incoterms</Label><Input value={form.incoterms} onChange={(e) => updateField('incoterms', e.target.value)} placeholder="DDP WILMINGTON" /></div>
                        <div><Label>Ship Via</Label><Input value={form.ship_via} onChange={(e) => updateField('ship_via', e.target.value)} placeholder="DB SCHENKER" /></div>
                        <div><Label>Delivery Location</Label><Input value={form.delivery_location} onChange={(e) => updateField('delivery_location', e.target.value)} /></div>
                    </div>

                    {/* Parts */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                        <h3 style={{ fontSize: '13px', fontWeight: 600, color: 'var(--enterprise-gray-700)', textTransform: 'uppercase', letterSpacing: '0.5px', margin: 0 }}>
                            Parts ({form.parts.length})
                        </h3>
                        <Button variant="outline" onClick={addPart}><Plus size={14} style={{ marginRight: '6px' }} />Add Part</Button>
                    </div>

                    {form.parts.map((p, idx) => (
                        <Card key={idx} style={{ marginBottom: '12px', position: 'relative' }}>
                            <div style={{ position: 'absolute', top: '8px', right: '8px' }}>
                                {form.parts.length > 1 && (
                                    <button onClick={() => removePart(idx)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}>
                                        <Trash2 size={16} />
                                    </button>
                                )}
                            </div>
                            <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)', marginBottom: '8px' }}>Line #{idx + 1}</p>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                                <div><Label>Part Number *</Label><Input value={p.part_number} onChange={(e) => updatePart(idx, 'part_number', e.target.value)} placeholder="205777" /></div>
                                <div><Label>MSN Code *</Label><Input value={p.msn_code} onChange={(e) => updatePart(idx, 'msn_code', e.target.value)} placeholder="OPW-69" /></div>
                                <div><Label>Customer Part #</Label><Input value={p.customer_part_number} onChange={(e) => updatePart(idx, 'customer_part_number', e.target.value)} /></div>
                                <div><Label>Drawing # *</Label><Input value={p.drawing_number} onChange={(e) => updatePart(idx, 'drawing_number', e.target.value)} /></div>
                                <div><Label>Drawing Rev</Label><Input value={p.drawing_revision} onChange={(e) => updatePart(idx, 'drawing_revision', e.target.value)} /></div>
                                <div><Label>Blanket Qty *</Label>{numInput(p.blanket_quantity, (n) => updatePart(idx, 'blanket_quantity', n))}</div>
                                <div><Label>Unit Price *</Label>{numInput(p.unit_price, (n) => updatePart(idx, 'unit_price', n), '0.01')}</div>
                                <div><Label>REL MULT *</Label>{numInput(p.release_multiple, (n) => updatePart(idx, 'release_multiple', n))}</div>
                                <div><Label>AVG/MO</Label>{numInput(p.avg_monthly_demand, (n) => updatePart(idx, 'avg_monthly_demand', n))}</div>
                                <div><Label>MIN Stock</Label>{numInput(p.min_warehouse_stock, (n) => updatePart(idx, 'min_warehouse_stock', n))}</div>
                                <div><Label>MAX Stock</Label>{numInput(p.max_warehouse_stock, (n) => updatePart(idx, 'max_warehouse_stock', n))}</div>
                                <div><Label>HS Code</Label><Input value={p.hs_code} onChange={(e) => updatePart(idx, 'hs_code', e.target.value)} placeholder="84139190" /></div>
                                <div style={{ gridColumn: 'span 4' }}><Label>Description</Label><Input value={p.customer_description} onChange={(e) => updatePart(idx, 'customer_description', e.target.value)} /></div>
                            </div>
                        </Card>
                    ))}
                </div>

                {error && <div style={{ padding: '12px 20px', background: '#fef2f2', color: '#991b1b', borderTop: '1px solid var(--enterprise-gray-200)' }}>⚠ {error}</div>}

                <div style={{ padding: '12px 20px', borderTop: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
                    <Button onClick={handleSubmit} disabled={submitting}>
                        <Save size={14} style={{ marginRight: '6px' }} />
                        {submitting ? 'Creating…' : 'Create Agreement'}
                    </Button>
                </div>
            </Card>
        </div>
    );
}

const selectStyle: React.CSSProperties = {
    width: '100%', height: '36px', padding: '0 10px',
    border: '1px solid var(--enterprise-gray-300)', borderRadius: '6px',
    fontSize: '13px', background: 'white',
};
