/**
 * BPAAmend — Modal for amending an existing BPA.
 *
 * Shows BEFORE values alongside editable NEW values. Only fields that
 * actually changed are sent to the `amend_bpa` RPC, which snapshots the
 * previous state and cascades to blanket_order_line_configs.
 */
import React, { useMemo, useState } from 'react';
import { X, Save, AlertTriangle } from 'lucide-react';
import { Card } from '../ui/EnterpriseUI';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { amendBPA } from './bpaService';
import type { CustomerAgreement, CustomerAgreementPart } from './types';

interface Props {
    agreement: CustomerAgreement;
    parts:     CustomerAgreementPart[];
    onClose:   () => void;
    onAmended: () => void;
}

export function BPAAmend({ agreement, parts, onClose, onAmended }: Props) {
    // editable copies
    const [header, setHeader] = useState({
        effective_end_date: agreement.effective_end_date,
        payment_terms:      agreement.payment_terms ?? '',
        incoterms:          agreement.incoterms ?? '',
        buyer_name:         agreement.buyer_name ?? '',
        buyer_email:        agreement.buyer_email ?? '',
        delivery_location:  agreement.delivery_location ?? '',
        ship_via:           agreement.ship_via ?? '',
    });

    const [editedParts, setEditedParts] = useState(
        parts.map(p => ({
            part_number:         p.part_number,
            unit_price:          p.unit_price,
            blanket_quantity:    p.blanket_quantity,
            release_multiple:    p.release_multiple,
            min_warehouse_stock: p.min_warehouse_stock,
            max_warehouse_stock: p.max_warehouse_stock,
            avg_monthly_demand:  p.avg_monthly_demand,
            drawing_revision:    p.drawing_revision ?? '',
            customer_description: p.customer_description ?? '',
            is_active:           p.is_active ?? true,
        })),
    );

    const [reason, setReason]     = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [error, setError]       = useState<string | null>(null);

    const updatePart = (idx: number, k: keyof (typeof editedParts)[0], v: any) =>
        setEditedParts(eps => eps.map((ep, i) => i === idx ? { ...ep, [k]: v } : ep));

    // Build minimal diff
    const diff = useMemo(() => {
        const headerChanges: Record<string, unknown> = {};
        if (header.effective_end_date !== agreement.effective_end_date) headerChanges.effective_end_date = header.effective_end_date;
        if (header.payment_terms     !== (agreement.payment_terms ?? ''))  headerChanges.payment_terms = header.payment_terms;
        if (header.incoterms         !== (agreement.incoterms ?? ''))      headerChanges.incoterms = header.incoterms;
        if (header.buyer_name        !== (agreement.buyer_name ?? ''))     headerChanges.buyer_name = header.buyer_name;
        if (header.buyer_email       !== (agreement.buyer_email ?? ''))    headerChanges.buyer_email = header.buyer_email;
        if (header.delivery_location !== (agreement.delivery_location ?? '')) headerChanges.delivery_location = header.delivery_location;
        if (header.ship_via          !== (agreement.ship_via ?? ''))       headerChanges.ship_via = header.ship_via;

        const partDiffs: Array<Record<string, unknown>> = [];
        editedParts.forEach((ep, i) => {
            const orig = parts[i];
            const d: Record<string, unknown> = { part_number: ep.part_number };
            let changed = false;
            if (Number(ep.unit_price) !== Number(orig.unit_price)) { d.unit_price = ep.unit_price; changed = true; }
            if (Number(ep.blanket_quantity) !== Number(orig.blanket_quantity)) { d.blanket_quantity = ep.blanket_quantity; changed = true; }
            if (Number(ep.release_multiple) !== Number(orig.release_multiple)) { d.release_multiple = ep.release_multiple; changed = true; }
            if (Number(ep.min_warehouse_stock) !== Number(orig.min_warehouse_stock)) { d.min_warehouse_stock = ep.min_warehouse_stock; changed = true; }
            if (Number(ep.max_warehouse_stock) !== Number(orig.max_warehouse_stock)) { d.max_warehouse_stock = ep.max_warehouse_stock; changed = true; }
            if (Number(ep.avg_monthly_demand) !== Number(orig.avg_monthly_demand)) { d.avg_monthly_demand = ep.avg_monthly_demand; changed = true; }
            if (ep.drawing_revision !== (orig.drawing_revision ?? '')) { d.drawing_revision = ep.drawing_revision; changed = true; }
            if (ep.customer_description !== (orig.customer_description ?? '')) { d.customer_description = ep.customer_description; changed = true; }
            if (ep.is_active !== (orig.is_active ?? true)) { d.is_active = ep.is_active; changed = true; }
            if (changed) partDiffs.push(d);
        });

        return { header: headerChanges, parts: partDiffs };
    }, [header, editedParts, agreement, parts]);

    const hasChanges = Object.keys(diff.header).length > 0 || diff.parts.length > 0;

    const submit = async () => {
        if (!reason.trim()) return setError('Revision reason is required');
        if (!hasChanges)    return setError('No changes detected');

        setSubmitting(true); setError(null);
        try {
            await amendBPA({
                agreement_id:         agreement.id,
                expected_row_version: agreement.row_version,
                revision_reason:      reason.trim(),
                changes:              diff,
                idempotency_key:      crypto.randomUUID(),
            });
            onAmended();
        } catch (e: any) {
            setError(e?.message ?? 'Amendment failed');
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(3px)', padding: '40px' }} onClick={onClose}>
            <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: '1200px', maxHeight: '92vh', background: '#fff', borderRadius: '20px', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                
                {/* ── Header ──────────────────────────────────────────── */}
                <div style={{ padding: '24px 32px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(180deg, #f8fafc 0%, #fff 100%)' }}>
                    <div>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
                            Amend Agreement
                        </div>
                        <h2 style={{ fontSize: '24px', fontWeight: 800, margin: 0, color: '#0f172a', letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {agreement.agreement_number}
                            <span style={{ fontSize: '13px', padding: '6px 14px', background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)', color: '#fff', borderRadius: '999px', fontWeight: 700, letterSpacing: '0.02em', boxShadow: '0 4px 12px rgba(30,58,138,0.25)' }}>
                                Rev {agreement.agreement_revision} → {agreement.agreement_revision + 1}
                            </span>
                        </h2>
                    </div>
                    <button 
                        onClick={onClose} 
                        style={{ width: '36px', height: '36px', borderRadius: '8px', background: '#f1f5f9', border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#64748b', cursor: 'pointer', transition: 'all 0.2s' }}
                        onMouseEnter={e => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.color = '#0f172a'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#64748b'; }}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* ── Warning Banner ──────────────────────────────────── */}
                <div style={{ padding: '16px 32px', background: '#fffbeb', borderBottom: '1px solid #fde68a', display: 'flex', gap: '12px', alignItems: 'center' }}>
                    <AlertTriangle size={20} color="#d97706" />
                    <span style={{ fontSize: '14px', fontWeight: 500, color: '#92400e' }}>
                        Existing invoices and sub-invoices keep their ORIGINAL prices. Only new documents will use the amended values.
                    </span>
                </div>

                {/* ── Content ─────────────────────────────────────────── */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '32px', background: '#f8fafc', display: 'flex', flexDirection: 'column', gap: '32px' }}>
                    
                    {/* Header Changes */}
                    <div>
                        <h3 style={{ fontSize: '14px', fontWeight: 700, textTransform: 'uppercase', color: '#475569', letterSpacing: '0.05em', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '4px', height: '14px', background: '#3b82f6', borderRadius: '2px' }} /> Header Changes
                        </h3>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '20px', background: '#fff', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
                            <div><Label style={{ color: '#334155', fontWeight: 600, marginBottom: '6px', display: 'block' }}>Effective End Date</Label><Input type="date" value={header.effective_end_date} onChange={(e) => setHeader({ ...header, effective_end_date: e.target.value })} style={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} /></div>
                            <div><Label style={{ color: '#334155', fontWeight: 600, marginBottom: '6px', display: 'block' }}>Payment Terms</Label><Input value={header.payment_terms} onChange={(e) => setHeader({ ...header, payment_terms: e.target.value })} style={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} /></div>
                            <div><Label style={{ color: '#334155', fontWeight: 600, marginBottom: '6px', display: 'block' }}>Incoterms</Label><Input value={header.incoterms} onChange={(e) => setHeader({ ...header, incoterms: e.target.value })} style={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} /></div>
                            <div><Label style={{ color: '#334155', fontWeight: 600, marginBottom: '6px', display: 'block' }}>Ship Via</Label><Input value={header.ship_via} onChange={(e) => setHeader({ ...header, ship_via: e.target.value })} style={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} /></div>
                            <div><Label style={{ color: '#334155', fontWeight: 600, marginBottom: '6px', display: 'block' }}>Buyer Name</Label><Input value={header.buyer_name} onChange={(e) => setHeader({ ...header, buyer_name: e.target.value })} style={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} /></div>
                            <div><Label style={{ color: '#334155', fontWeight: 600, marginBottom: '6px', display: 'block' }}>Buyer Email</Label><Input value={header.buyer_email} onChange={(e) => setHeader({ ...header, buyer_email: e.target.value })} style={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} /></div>
                        </div>
                    </div>

                    {/* Part Changes */}
                    <div>
                        <h3 style={{ fontSize: '14px', fontWeight: 700, textTransform: 'uppercase', color: '#475569', letterSpacing: '0.05em', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '4px', height: '14px', background: '#8b5cf6', borderRadius: '2px' }} /> Part Changes
                        </h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            {editedParts.map((p, i) => {
                                const orig = parts[i];
                                const isChanged = Number(p.unit_price) !== Number(orig.unit_price) || Number(p.blanket_quantity) !== Number(orig.blanket_quantity) || Number(p.release_multiple) !== Number(orig.release_multiple) || p.drawing_revision !== orig.drawing_revision || p.customer_description !== (orig.customer_description ?? '') || Number(p.min_warehouse_stock) !== Number(orig.min_warehouse_stock) || Number(p.max_warehouse_stock) !== Number(orig.max_warehouse_stock) || Number(p.avg_monthly_demand) !== Number(orig.avg_monthly_demand) || p.is_active !== (orig.is_active ?? true);
                                
                                return (
                                    <div key={orig.id} style={{ background: !p.is_active ? '#f1f5f9' : '#fff', padding: '24px', borderRadius: '12px', border: `1px solid ${!p.is_active ? '#cbd5e1' : '#e2e8f0'}`, boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)', transition: 'all 0.2s ease', opacity: !p.is_active ? 0.75 : 1 }}>
                                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <span style={{ padding: '4px 8px', background: '#e2e8f0', borderRadius: '6px', fontSize: '12px', color: '#475569' }}>{orig.msn_code}</span>
                                            <span style={{ textDecoration: !p.is_active ? 'line-through' : 'none' }}>Part {orig.part_number}</span>
                                            <div style={{ flex: 1 }} />
                                            <button 
                                                onClick={() => updatePart(i, 'is_active', !p.is_active)}
                                                style={{ padding: '6px 14px', borderRadius: '6px', fontSize: '12px', fontWeight: 700, border: 'none', cursor: 'pointer', background: p.is_active ? '#ef4444' : '#10b981', color: '#fff', transition: 'all 0.2s', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}
                                                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 6px rgba(0,0,0,0.15)'; }}
                                                onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)'; }}
                                            >
                                                {p.is_active ? 'Cancel Part' : 'Restore Part'}
                                            </button>
                                        </div>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '20px', pointerEvents: !p.is_active ? 'none' : 'auto' }}>
                                            <div style={{ gridColumn: 'span 4' }}>
                                                <Label style={{ color: '#334155', fontWeight: 600, marginBottom: '6px', display: 'block', fontSize: '12px' }}>Description <span style={{ color: '#94a3b8', fontWeight: 400 }}>(was {orig.customer_description ?? '—'})</span></Label>
                                                <Input value={p.customer_description} onChange={(e) => updatePart(i, 'customer_description', e.target.value)} style={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                                            </div>
                                            <div><Label style={{ color: '#334155', fontWeight: 600, marginBottom: '6px', display: 'block', fontSize: '12px' }}>Unit Price <span style={{ color: '#94a3b8', fontWeight: 400 }}>(was {orig.unit_price})</span></Label>
                                                <Input type="number" step="0.01" value={p.unit_price} onChange={(e) => updatePart(i, 'unit_price', Number(e.target.value))} style={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                                            </div>
                                            <div><Label style={{ color: '#334155', fontWeight: 600, marginBottom: '6px', display: 'block', fontSize: '12px' }}>Blanket Qty <span style={{ color: '#94a3b8', fontWeight: 400 }}>(was {orig.blanket_quantity})</span></Label>
                                                <Input type="number" value={p.blanket_quantity} onChange={(e) => updatePart(i, 'blanket_quantity', Number(e.target.value))} style={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                                            </div>
                                            <div><Label style={{ color: '#334155', fontWeight: 600, marginBottom: '6px', display: 'block', fontSize: '12px' }}>REL MULT <span style={{ color: '#94a3b8', fontWeight: 400 }}>(was {orig.release_multiple})</span></Label>
                                                <Input type="number" value={p.release_multiple} onChange={(e) => updatePart(i, 'release_multiple', Number(e.target.value))} style={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                                            </div>
                                            <div><Label style={{ color: '#334155', fontWeight: 600, marginBottom: '6px', display: 'block', fontSize: '12px' }}>Drawing Rev <span style={{ color: '#94a3b8', fontWeight: 400 }}>(was {orig.drawing_revision ?? '—'})</span></Label>
                                                <Input value={p.drawing_revision} onChange={(e) => updatePart(i, 'drawing_revision', e.target.value)} style={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                                            </div>
                                            <div><Label style={{ color: '#334155', fontWeight: 600, marginBottom: '6px', display: 'block', fontSize: '12px' }}>MIN <span style={{ color: '#94a3b8', fontWeight: 400 }}>(was {orig.min_warehouse_stock})</span></Label>
                                                <Input type="number" value={p.min_warehouse_stock} onChange={(e) => updatePart(i, 'min_warehouse_stock', Number(e.target.value))} style={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                                            </div>
                                            <div><Label style={{ color: '#334155', fontWeight: 600, marginBottom: '6px', display: 'block', fontSize: '12px' }}>MAX <span style={{ color: '#94a3b8', fontWeight: 400 }}>(was {orig.max_warehouse_stock})</span></Label>
                                                <Input type="number" value={p.max_warehouse_stock} onChange={(e) => updatePart(i, 'max_warehouse_stock', Number(e.target.value))} style={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                                            </div>
                                            <div style={{ gridColumn: 'span 2' }}><Label style={{ color: '#334155', fontWeight: 600, marginBottom: '6px', display: 'block', fontSize: '12px' }}>AVG/MO <span style={{ color: '#94a3b8', fontWeight: 400 }}>(was {orig.avg_monthly_demand})</span></Label>
                                                <Input type="number" value={p.avg_monthly_demand} onChange={(e) => updatePart(i, 'avg_monthly_demand', Number(e.target.value))} style={{ borderRadius: '8px', border: '1px solid #cbd5e1' }} />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>

                    {/* Reason */}
                    <div>
                        <h3 style={{ fontSize: '14px', fontWeight: 700, textTransform: 'uppercase', color: '#475569', letterSpacing: '0.05em', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <div style={{ width: '4px', height: '14px', background: '#10b981', borderRadius: '2px' }} /> Revision Reason
                        </h3>
                        <div style={{ background: '#fff', padding: '24px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)' }}>
                            <Label style={{ color: '#334155', fontWeight: 600, marginBottom: '8px', display: 'block' }}>Reason for Amendment <span style={{ color: '#ef4444' }}>*</span></Label>
                            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer amendment letter dated 2026-04-15" style={{ borderRadius: '8px', border: '1px solid #cbd5e1', padding: '12px 16px', fontSize: '15px' }} />
                        </div>
                    </div>
                </div>

                {/* ── Footer ──────────────────────────────────────────── */}
                {error && <div style={{ padding: '12px 32px', background: '#fef2f2', color: '#dc2626', fontWeight: 500, fontSize: '14px', borderTop: '1px solid #fecaca' }}>⚠ {error}</div>}
                
                <div style={{ padding: '24px 32px', borderTop: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fff' }}>
                    <div style={{ fontSize: '14px', color: '#64748b', fontWeight: 500 }}>
                        {!hasChanges ? 'No changes detected yet.' : 'Please review your changes before submitting.'}
                    </div>
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button 
                            onClick={onClose} disabled={submitting}
                            style={{ padding: '10px 24px', height: '42px', borderRadius: '8px', background: '#f1f5f9', color: '#334155', fontWeight: 600, fontSize: '14px', border: 'none', cursor: submitting ? 'not-allowed' : 'pointer', transition: 'all 0.2s', opacity: submitting ? 0.7 : 1 }}
                            onMouseEnter={e => { if(!submitting) { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.transform = 'translateY(-1px)'; } }}
                            onMouseLeave={e => { if(!submitting) { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.transform = 'none'; } }}
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={submit} disabled={submitting || !hasChanges || !reason.trim()}
                            style={{ 
                                padding: '10px 24px', height: '42px', borderRadius: '8px', 
                                background: (hasChanges && reason.trim()) ? 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)' : '#94a3b8', 
                                color: '#fff', fontWeight: 600, fontSize: '14px', border: 'none', 
                                cursor: (submitting || !hasChanges || !reason.trim()) ? 'not-allowed' : 'pointer', 
                                display: 'flex', alignItems: 'center', gap: '8px',
                                boxShadow: (hasChanges && reason.trim()) ? '0 4px 12px rgba(30,58,138,0.25)' : 'none',
                                transition: 'all 0.2s', opacity: submitting ? 0.7 : 1
                            }}
                            onMouseEnter={e => { if(!submitting && hasChanges && reason.trim()) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 16px rgba(30,58,138,0.35)'; } }}
                            onMouseLeave={e => { if(!submitting && hasChanges && reason.trim()) { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 4px 12px rgba(30,58,138,0.25)'; } }}
                        >
                            <Save size={16} />
                            {submitting ? 'Submitting…' : 'Submit'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
