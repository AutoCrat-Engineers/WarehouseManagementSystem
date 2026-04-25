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
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1100, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
            <Card onClick={(e) => e.stopPropagation()} style={{ width: '95%', maxWidth: '1200px', maxHeight: '90vh', overflow: 'auto', padding: 0 }}>
                <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h2 style={{ fontSize: '1.2rem', fontWeight: 700, margin: 0 }}>
                            Amend {agreement.agreement_number}
                        </h2>
                        <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)', margin: 0 }}>
                            Current revision: {agreement.agreement_revision} → new: {agreement.agreement_revision + 1}
                        </p>
                    </div>
                    <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                </div>

                <div style={{ padding: '16px 20px', background: '#fffbeb', borderBottom: '1px solid #fbbf24', display: 'flex', gap: '8px' }}>
                    <AlertTriangle size={18} color="#d97706" />
                    <span style={{ fontSize: '13px', color: '#92400e' }}>
                        Existing invoices and sub-invoices keep their ORIGINAL prices. Only new documents use the amended values.
                    </span>
                </div>

                <div style={{ padding: '20px' }}>
                    <h3 style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--enterprise-gray-700)', marginBottom: '12px' }}>Header changes</h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px', marginBottom: '20px' }}>
                        <div><Label>Effective End Date</Label><Input type="date" value={header.effective_end_date} onChange={(e) => setHeader({ ...header, effective_end_date: e.target.value })} /></div>
                        <div><Label>Payment Terms</Label><Input value={header.payment_terms} onChange={(e) => setHeader({ ...header, payment_terms: e.target.value })} /></div>
                        <div><Label>Incoterms</Label><Input value={header.incoterms} onChange={(e) => setHeader({ ...header, incoterms: e.target.value })} /></div>
                        <div><Label>Ship Via</Label><Input value={header.ship_via} onChange={(e) => setHeader({ ...header, ship_via: e.target.value })} /></div>
                        <div><Label>Buyer Name</Label><Input value={header.buyer_name} onChange={(e) => setHeader({ ...header, buyer_name: e.target.value })} /></div>
                        <div><Label>Buyer Email</Label><Input value={header.buyer_email} onChange={(e) => setHeader({ ...header, buyer_email: e.target.value })} /></div>
                    </div>

                    <h3 style={{ fontSize: '13px', fontWeight: 600, textTransform: 'uppercase', color: 'var(--enterprise-gray-700)', marginBottom: '12px' }}>Part changes</h3>
                    {editedParts.map((p, i) => {
                        const orig = parts[i];
                        const priceChanged = Number(p.unit_price) !== Number(orig.unit_price);
                        const qtyChanged   = Number(p.blanket_quantity) !== Number(orig.blanket_quantity);
                        return (
                            <Card key={orig.id} style={{ marginBottom: '10px', background: (priceChanged || qtyChanged) ? '#fef3c7' : 'white' }}>
                                <p style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px' }}>
                                    {orig.msn_code} · Part {orig.part_number} · Drawing Rev {orig.drawing_revision ?? '—'}
                                </p>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                                    <div><Label>Unit Price <span style={{ color: 'var(--enterprise-gray-400)', fontWeight: 400 }}>(was {orig.unit_price})</span></Label>
                                        <Input type="number" step="0.01" value={p.unit_price} onChange={(e) => updatePart(i, 'unit_price', Number(e.target.value))} />
                                    </div>
                                    <div><Label>Blanket Qty <span style={{ color: 'var(--enterprise-gray-400)', fontWeight: 400 }}>(was {orig.blanket_quantity})</span></Label>
                                        <Input type="number" value={p.blanket_quantity} onChange={(e) => updatePart(i, 'blanket_quantity', Number(e.target.value))} />
                                    </div>
                                    <div><Label>REL MULT (was {orig.release_multiple})</Label>
                                        <Input type="number" value={p.release_multiple} onChange={(e) => updatePart(i, 'release_multiple', Number(e.target.value))} />
                                    </div>
                                    <div><Label>Drawing Rev (was {orig.drawing_revision ?? '—'})</Label>
                                        <Input value={p.drawing_revision} onChange={(e) => updatePart(i, 'drawing_revision', e.target.value)} />
                                    </div>
                                    <div><Label>MIN (was {orig.min_warehouse_stock})</Label>
                                        <Input type="number" value={p.min_warehouse_stock} onChange={(e) => updatePart(i, 'min_warehouse_stock', Number(e.target.value))} />
                                    </div>
                                    <div><Label>MAX (was {orig.max_warehouse_stock})</Label>
                                        <Input type="number" value={p.max_warehouse_stock} onChange={(e) => updatePart(i, 'max_warehouse_stock', Number(e.target.value))} />
                                    </div>
                                    <div><Label>AVG/MO (was {orig.avg_monthly_demand})</Label>
                                        <Input type="number" value={p.avg_monthly_demand} onChange={(e) => updatePart(i, 'avg_monthly_demand', Number(e.target.value))} />
                                    </div>
                                </div>
                            </Card>
                        );
                    })}

                    <div style={{ marginTop: '20px' }}>
                        <Label>Revision Reason *</Label>
                        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer amendment letter dated 2026-04-15" />
                    </div>
                </div>

                {error && <div style={{ padding: '12px 20px', background: '#fef2f2', color: '#991b1b', borderTop: '1px solid var(--enterprise-gray-200)' }}>⚠ {error}</div>}
                {!hasChanges && <div style={{ padding: '12px 20px', background: '#f3f4f6', color: 'var(--enterprise-gray-600)', fontSize: '13px' }}>No changes yet — edit a field above.</div>}

                <div style={{ padding: '12px 20px', borderTop: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                    <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
                    <Button onClick={submit} disabled={submitting || !hasChanges || !reason.trim()}>
                        <Save size={14} style={{ marginRight: '6px' }} />
                        {submitting ? 'Amending…' : 'Submit Amendment'}
                    </Button>
                </div>
            </Card>
        </div>
    );
}
