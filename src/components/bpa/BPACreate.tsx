/**
 * BPACreate — 4-step wizard for creating a Blanket Purchase Agreement.
 *
 * Sections (progressive disclosure, avoids asking for duplicate info):
 *   1. BPA Core       — Order No, Order Date, Effective End
 *   2. Customer + Buyer — who issues the agreement
 *   3. Terms          — currency / payment / incoterms / ship via (defaults)
 *   4. Parts          — part autocomplete against Item Master; only
 *                       blanket qty, REL MULT, MIN/MAX, AVG/MO are asked.
 *                       Unit price, MSN, drawing, HS code auto-fill from item.
 *
 * Drops fields the old form asked for but the PDF never carries:
 *   - Type, Title, Customer Part #, Drawing #, Drawing Rev, Description,
 *     DBK Code, Safety Stock, Delivery Location, Buyer Email/Phone (opt),
 *     Agreement Date (same as Order Date)
 * Those are still posted to the backend with safe defaults so bpa_create
 * stays compatible.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    X, ChevronRight, ChevronLeft, Check, Loader2, Plus, Trash2, FileText,
    User, Settings, Package, CheckCircle2, Search, AlertCircle, Calendar,
} from 'lucide-react';
import { createBPA } from './bpaService';
import { emptyAgreementForm, emptyPart } from './types';
import type { AgreementCreateForm, AgreementPartForm } from './types';
import { fetchWithAuth } from '../../utils/supabase/auth';
import { getEdgeFunctionUrl } from '../../utils/supabase/info';

interface Props {
    onClose: () => void;
    onCreated: (agreementId: string) => void;
}

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS = ['BPA Core', 'Customer & Buyer', 'Terms', 'Parts'];
const STEP_ICONS  = [FileText, User, Settings, Package];

// ============================================================================

export function BPACreate({ onClose, onCreated }: Props) {
    const [step, setStep] = useState<Step>(1);
    const [form, setForm] = useState<AgreementCreateForm>(emptyAgreementForm());
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const patch  = (p: Partial<AgreementCreateForm>) => setForm(f => ({ ...f, ...p }));
    const patchPart = (idx: number, p: Partial<AgreementPartForm>) =>
        setForm(f => ({ ...f, parts: f.parts.map((pt, i) => i === idx ? { ...pt, ...p } : pt) }));

    // Keep agreement_date in lockstep with effective_start_date — the PDF
    // shows one date; we derive the other.
    useEffect(() => { patch({ agreement_date: form.effective_start_date }); /* eslint-disable-next-line */ }, [form.effective_start_date]);

    const isStepValid = useCallback((s: Step) => {
        if (s === 1) return !!form.agreement_number.trim() && !!form.effective_start_date && !!form.effective_end_date && form.effective_start_date <= form.effective_end_date;
        if (s === 2) return !!form.customer_code.trim() && !!form.customer_name.trim() && !!form.buyer_name.trim();
        if (s === 3) return !!form.currency_code && !!form.payment_terms;
        if (s === 4) return form.parts.length > 0 && form.parts.every(p =>
            p.part_number && p.msn_code && p.blanket_quantity && p.unit_price && p.release_multiple);
        return true;
    }, [form]);

    const maxAllowedStep = useMemo(() => {
        if (!isStepValid(1)) return 1;
        if (!isStepValid(2)) return 2;
        if (!isStepValid(3)) return 3;
        return 4;
    }, [isStepValid]);

    const canGoNext = isStepValid(step);

    const submit = async () => {
        setError(null); setSubmitting(true);
        try {
            // Safe defaults for dropped fields
            const payload: AgreementCreateForm = {
                ...form,
                agreement_type:       form.agreement_type || 'BPA',
                agreement_title:      form.agreement_title || '',
                delivery_location:    form.delivery_location || '',
                parts: form.parts.map(p => ({
                    ...p,
                    customer_part_number: p.customer_part_number || p.part_number,
                    drawing_number:       p.drawing_number || p.part_number,
                    drawing_revision:     p.drawing_revision || '',
                    customer_description: p.customer_description || '',
                    hs_code:              p.hs_code || '',
                    dbk_code:             p.dbk_code || '',
                    safety_stock:         p.safety_stock ?? 0,
                })),
            };
            const res = await createBPA(payload);
            onCreated(res.agreement_id);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to create agreement');
            setSubmitting(false);
        }
    };

    return (
        <div style={backdropStyle} onClick={onClose}>
            <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
                <Header step={step} onClose={onClose} />

                <div style={{ flex: 1, overflow: 'auto', display: 'flex' }}>
                    <Stepper step={step} maxAllowedStep={maxAllowedStep} setStep={setStep} />
                    <div style={{ flex: 1, padding: '28px 32px', minWidth: 0 }}>
                        {step === 1 && <Step1Core form={form} patch={patch} />}
                        {step === 2 && <Step2CustomerBuyer form={form} patch={patch} />}
                        {step === 3 && <Step3Terms form={form} patch={patch} />}
                        {step === 4 && <Step4Parts form={form} patchPart={patchPart}
                            addPart={() => patch({ parts: [...form.parts, emptyPart()] })}
                            removePart={(i) => patch({ parts: form.parts.length > 1 ? form.parts.filter((_, idx) => idx !== i) : form.parts })}
                            error={error}
                            onSubmit={submit} submitting={submitting}
                        />}
                    </div>
                </div>

                <Footer
                    step={step}
                    canGoNext={canGoNext}
                    onBack={() => step > 1 && setStep((step - 1) as Step)}
                    onNext={() => step < 4 && canGoNext && setStep((step + 1) as Step)}
                    onCancel={onClose}
                    onSubmit={submit}
                    submitting={submitting}
                />
            </div>
        </div>
    );
}

// ============================================================================
// Chrome
// ============================================================================

function Header({ step, onClose }: { step: Step; onClose: () => void }) {
    return (
        <div style={{ padding: '24px 32px', borderBottom: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff' }}>
            <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, color: '#0f172a', margin: 0, letterSpacing: '-0.3px' }}>New Blanket Order & Release</h2>
                <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0', fontWeight: 500 }}>
                    Step {step} of 4 · {STEP_LABELS[step - 1]}
                </p>
            </div>
            <button onClick={onClose} style={closeBtnStyle}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#0f172a'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b'; }}>
                <X size={20} strokeWidth={2.5} />
            </button>
        </div>
    );
}

function Stepper({ step, maxAllowedStep, setStep }: { step: Step; maxAllowedStep: number; setStep: (s: Step) => void }) {
    return (
        <div style={{ width: 220, minWidth: 220, borderRight: '1px solid rgba(0,0,0,0.05)', padding: '32px 0', background: '#f8fafc' }}>
            {STEP_LABELS.map((label, idx) => {
                const n = (idx + 1) as Step;
                const active = n === step;
                const done = n < step;
                const disabled = n > maxAllowedStep && n !== step;
                const Icon = STEP_ICONS[idx];
                return (
                    <div key={n} 
                        onClick={() => { if (!disabled) setStep(n); }}
                        style={{ 
                            padding: '12px 24px', display: 'flex', alignItems: 'center', gap: 14, position: 'relative',
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            opacity: disabled ? 0.4 : 1,
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => { if (!disabled && !active) e.currentTarget.style.background = 'rgba(0,0,0,0.02)'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
                    >
                        {active && <div style={{ position: 'absolute', left: 0, top: 8, bottom: 8, width: 4, background: '#2563eb', borderRadius: '0 4px 4px 0' }} />}
                        <div style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: done ? '#10b981' : active ? '#2563eb' : '#e2e8f0',
                            color: (done || active) ? '#fff' : '#64748b',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                            boxShadow: active ? '0 4px 12px rgba(37,99,235,0.25)' : 'none',
                            transition: 'all 0.3s'
                        }}>
                            {done ? <Check size={16} strokeWidth={3} /> : <Icon size={16} />}
                        </div>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Step {n}</div>
                            <div style={{ fontSize: 14, fontWeight: active ? 700 : 500, color: active ? '#1e293b' : done ? '#334155' : '#64748b', transition: 'color 0.2s' }}>
                                {label}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function Footer({ step, canGoNext, onBack, onNext, onCancel, onSubmit, submitting }: {
    step: Step; canGoNext: boolean; onBack: () => void; onNext: () => void;
    onCancel: () => void; onSubmit: () => void; submitting: boolean;
}) {
    return (
        <div style={{ padding: '20px 32px', borderTop: '1px solid rgba(0,0,0,0.05)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#fff' }}>
            <button onClick={onCancel} style={ghostBtn}
                onMouseEnter={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.color = '#0f172a'; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#64748b'; }}>
                Cancel
            </button>
            <div style={{ display: 'flex', gap: 12 }}>
                {step > 1 && <button onClick={onBack} disabled={submitting} style={{ ...secondaryBtn, display: 'flex', alignItems: 'center', gap: 6 }}
                    onMouseEnter={(e) => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={(e) => e.currentTarget.style.background = '#fff'}>
                    <ChevronLeft size={16} /> Back
                </button>}
                {step < 4 && <button onClick={onNext} disabled={!canGoNext}
                    style={{ ...primaryBtn, display: 'flex', alignItems: 'center', gap: 6, opacity: canGoNext ? 1 : 0.5, cursor: canGoNext ? 'pointer' : 'not-allowed' }}
                    onMouseEnter={(e) => { if(canGoNext) e.currentTarget.style.transform = 'translateY(-1px)'; }}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
                    Next Step <ChevronRight size={16} />
                </button>}
                {step === 4 && <button onClick={onSubmit} disabled={!canGoNext || submitting}
                    style={{ ...primaryBtn, padding: '12px 28px', display: 'flex', alignItems: 'center', gap: 8, opacity: (canGoNext && !submitting) ? 1 : 0.6 }}
                    onMouseEnter={(e) => { if(canGoNext && !submitting) e.currentTarget.style.transform = 'translateY(-1px)'; }}
                    onMouseLeave={(e) => e.currentTarget.style.transform = 'translateY(0)'}>
                    {submitting ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Creating…</> : <><Check size={16} strokeWidth={3} /> Create BPA</>}
                </button>}
            </div>
        </div>
    );
}

// ============================================================================
// Step 1 — BPA Core
// ============================================================================

function Step1Core({ form, patch }: { form: AgreementCreateForm; patch: (p: Partial<AgreementCreateForm>) => void }) {
    const orderDate = form.effective_start_date;
    const endDate   = form.effective_end_date;
    const days = orderDate && endDate ? Math.max(0, Math.floor((new Date(endDate).getTime() - new Date(orderDate).getTime()) / 86400000)) : 0;

    return (
        <div style={{ maxWidth: 680 }}>
            <SectionTitle title="BPA Core" subtitle="The essentials from the Order header — everything else derives from this." icon={<FileText size={18} />} />

            <div style={{ marginTop: 22 }}>
                <Field label="Order No" required hint="The BPA number from the customer's document">
                    <input type="text" value={form.agreement_number}
                        onChange={(e) => patch({ agreement_number: e.target.value })}
                        placeholder="e.g., 260067299"
                        style={{ ...inputStyle, fontFamily: 'monospace', fontSize: 15, letterSpacing: '0.3px' }} autoFocus />
                </Field>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 14 }}>
                <Field label="Order Date" required hint="Used as both agreement date and effective start">
                    <input type="date" value={form.effective_start_date}
                        onChange={(e) => patch({ effective_start_date: e.target.value, agreement_date: e.target.value })}
                        style={inputStyle} />
                </Field>
                <Field label="Effective End" required hint={days ? `${days.toLocaleString()} days coverage` : ''}>
                    <input type="date" value={form.effective_end_date}
                        onChange={(e) => patch({ effective_end_date: e.target.value })}
                        style={inputStyle} />
                </Field>
            </div>

            <TipCard
                title="On amendments"
                body="Creating an amendment? Don't start here — open the existing BPA's detail and use the Amend action. It captures what changed and bumps the revision automatically."
            />
        </div>
    );
}

// ============================================================================
// Step 2 — Customer + Buyer
// ============================================================================

function Step2CustomerBuyer({ form, patch }: { form: AgreementCreateForm; patch: (p: Partial<AgreementCreateForm>) => void }) {
    return (
        <div style={{ maxWidth: 780 }}>
            <SectionTitle title="Customer & Buyer" subtitle="Who issues this agreement on the customer side." icon={<User size={18} />} />

            <div style={{ marginTop: 22 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Customer</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 16 }}>
                    <Field label="Customer Code" required>
                        <input type="text" value={form.customer_code}
                            onChange={(e) => patch({ customer_code: e.target.value })}
                            placeholder="e.g., OPW" style={inputStyle} />
                    </Field>
                    <Field label="Customer Name" required>
                        <input type="text" value={form.customer_name}
                            onChange={(e) => patch({ customer_name: e.target.value })}
                            placeholder="e.g., OPW Fueling Components" style={inputStyle} />
                    </Field>
                </div>
            </div>

            <div style={{ marginTop: 24 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 12 }}>Buyer (person who approved the BPA)</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
                    <Field label="Buyer Name" required>
                        <input type="text" value={form.buyer_name}
                            onChange={(e) => patch({ buyer_name: e.target.value })}
                            placeholder="e.g., Potter, Vida" style={inputStyle} />
                    </Field>
                    <Field label="Email">
                        <input type="email" value={form.buyer_email}
                            onChange={(e) => patch({ buyer_email: e.target.value })}
                            placeholder="name@customer.com" style={inputStyle} />
                    </Field>
                    <Field label="Phone">
                        <input type="tel" value={form.buyer_phone}
                            onChange={(e) => patch({ buyer_phone: e.target.value })}
                            placeholder="919-209-2405" style={inputStyle} />
                    </Field>
                </div>
            </div>

            <TipCard
                title="Two different people"
                body="The buyer on a BPA (who commits the yearly volume) is often NOT the same person who sends each release PO. Each release in this system captures its own buyer separately, so enter whoever signed this Agreement."
            />
        </div>
    );
}

// ============================================================================
// Step 3 — Terms
// ============================================================================

function Step3Terms({ form, patch }: { form: AgreementCreateForm; patch: (p: Partial<AgreementCreateForm>) => void }) {
    return (
        <div style={{ maxWidth: 780 }}>
            <SectionTitle title="Commercial & Shipping Terms" subtitle="Pre-filled with your common defaults — override only when different." icon={<Settings size={18} />} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 22 }}>
                <Field label="Currency" required>
                    <select value={form.currency_code} onChange={(e) => patch({ currency_code: e.target.value })} style={inputStyle}>
                        <option value="USD">USD — US Dollar</option>
                        <option value="EUR">EUR — Euro</option>
                        <option value="GBP">GBP — British Pound</option>
                        <option value="INR">INR — Indian Rupee</option>
                    </select>
                </Field>
                <Field label="Payment Terms" required>
                    <select value={form.payment_terms} onChange={(e) => patch({ payment_terms: e.target.value })} style={inputStyle}>
                        <option value="Net 30">Net 30</option>
                        <option value="Net 60">Net 60</option>
                        <option value="Net 90">Net 90</option>
                        <option value="Net 120">Net 120</option>
                        <option value="Due on receipt">Due on receipt</option>
                    </select>
                </Field>
                <Field label="Incoterms">
                    <select value={form.incoterms} onChange={(e) => patch({ incoterms: e.target.value })} style={inputStyle}>
                        <option value="DDP">DDP — Delivered Duty Paid</option>
                        <option value="DAP">DAP — Delivered At Place</option>
                        <option value="FOB">FOB — Free On Board</option>
                        <option value="CIF">CIF — Cost, Insurance & Freight</option>
                        <option value="EXW">EXW — Ex Works</option>
                    </select>
                </Field>
                <Field label="Ship Via" hint="Freight carrier / forwarder">
                    <input type="text" value={form.ship_via}
                        onChange={(e) => patch({ ship_via: e.target.value })}
                        placeholder="e.g., DB SCHENKER" style={inputStyle} />
                </Field>
            </div>

            <TipCard
                title="Why these defaults"
                body="Most BPAs from the same customer share the same commercial terms. Defaults save typing — change them only when the document says otherwise."
            />
        </div>
    );
}

// ============================================================================
// Step 4 — Parts (with Item-Master autocomplete)
// ============================================================================

function Step4Parts({ form, patchPart, addPart, removePart, error, onSubmit, submitting }: {
    form: AgreementCreateForm;
    patchPart: (i: number, p: Partial<AgreementPartForm>) => void;
    addPart: () => void;
    removePart: (i: number) => void;
    error: string | null;
    onSubmit: () => void;
    submitting: boolean;
}) {
    const totalValue = form.parts.reduce((s, p) => s + Number(p.blanket_quantity ?? 0) * Number(p.unit_price ?? 0), 0);
    return (
        <div style={{ maxWidth: 980 }}>
            <SectionTitle title="Parts" subtitle="Pick parts from your Item Master. MSN, drawing, and unit price auto-fill. You only enter the blanket commitment." icon={<Package size={18} />} />

            <div style={{ marginTop: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {form.parts.map((p, idx) => (
                    <PartCard key={idx} idx={idx} part={p}
                        patch={(x) => patchPart(idx, x)}
                        onRemove={form.parts.length > 1 ? () => removePart(idx) : undefined}
                    />
                ))}
            </div>

            <button onClick={addPart} style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 6, padding: '10px 14px', border: '1px dashed var(--enterprise-gray-300)', background: 'white', borderRadius: 8, cursor: 'pointer', color: 'var(--enterprise-gray-700)', fontSize: 13, fontWeight: 600, width: '100%', justifyContent: 'center' }}>
                <Plus size={14} /> Add another part
            </button>

            {/* Totals strip */}
            <div style={{ marginTop: 16, padding: '14px 18px', background: 'linear-gradient(135deg, rgba(30,58,138,0.04) 0%, rgba(30,58,138,0.08) 100%)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Blanket Value</div>
                    <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--enterprise-gray-900)', fontFamily: 'monospace', marginTop: 2 }}>
                        {form.currency_code} ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </div>
                </div>
                <div style={{ fontSize: 12, color: 'var(--enterprise-gray-600)' }}>
                    {form.parts.length} part{form.parts.length !== 1 ? 's' : ''} · {form.customer_name || '—'} · Valid {form.effective_start_date} → {form.effective_end_date}
                </div>
            </div>

            {error && (
                <div style={{ marginTop: 14, padding: 12, background: '#fef2f2', borderLeft: '3px solid #dc2626', borderRadius: 6, color: '#991b1b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertCircle size={16} /> {error}
                </div>
            )}
        </div>
    );
}

function PartCard({ idx, part, patch, onRemove }: {
    idx: number; part: AgreementPartForm; patch: (p: Partial<AgreementPartForm>) => void; onRemove?: () => void;
}) {
    return (
        <div style={{ border: '1px solid var(--enterprise-gray-200)', borderRadius: 10, padding: 16, background: 'white', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--enterprise-primary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>Line {idx + 1}</div>
                {onRemove && (
                    <button onClick={onRemove} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#dc2626', padding: 4, borderRadius: 4, display: 'flex', alignItems: 'center', gap: 4, fontSize: 12 }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#fee2e2'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                        <Trash2 size={13} /> Remove
                    </button>
                )}
            </div>

            {/* Row 1 — part picker, auto-fills */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: 14, marginBottom: 14 }}>
                <Field label="Part No" required hint="Search by MSN, part #, or desc">
                    <PartAutocomplete
                        value={part.part_number}
                        onPick={(i) => patch({
                            part_number:          i.part_number,
                            msn_code:             i.master_serial_no ?? '',
                            customer_description: i.item_name ?? '',
                            drawing_number:       i.part_number,
                            drawing_revision:     i.revision ?? '',
                            unit_price:           i.unit_price ?? null,
                        })}
                    />
                </Field>
                <Field label="MSN" required>
                    <input type="text" value={part.msn_code}
                        onChange={(e) => patch({ msn_code: e.target.value })}
                        style={{ ...inputStyle, fontFamily: 'monospace' }} />
                </Field>
                <Field label="Rev">
                    <input type="text" value={part.drawing_revision || ''}
                        onChange={(e) => patch({ drawing_revision: e.target.value })}
                        style={{ ...inputStyle, fontFamily: 'monospace', textAlign: 'center' }} />
                </Field>
                <Field label="Unit Price" required>
                    <input type="number" step="0.0001" value={part.unit_price ?? ''}
                        onChange={(e) => patch({ unit_price: e.target.value === '' ? null : Number(e.target.value) })}
                        style={{ ...inputStyle, fontFamily: 'monospace' }} />
                </Field>
            </div>

            {/* Row 2 — Description */}
            <div style={{ marginBottom: 14 }}>
                <Field label="Complete Description">
                    <input type="text" value={part.customer_description || ''}
                        onChange={(e) => patch({ customer_description: e.target.value })}
                        style={inputStyle} />
                </Field>
            </div>

            {/* Row 3 — commitment numbers */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 1fr', gap: 14 }}>
                <NumField label="Blanket Qty" required value={part.blanket_quantity} onChange={(v) => patch({ blanket_quantity: v })} />
                <NumField label="REL MULT"    required value={part.release_multiple} onChange={(v) => patch({ release_multiple: v })} />
                <NumField label="MIN Stock"   value={part.min_warehouse_stock} onChange={(v) => patch({ min_warehouse_stock: v })} />
                <NumField label="MAX Stock"   value={part.max_warehouse_stock} onChange={(v) => patch({ max_warehouse_stock: v })} />
                <NumField label="AVG / Month" value={part.avg_monthly_demand}  onChange={(v) => patch({ avg_monthly_demand: v })} />
            </div>

            {/* Row 4 — Notes */}
            <div style={{ marginTop: 14 }}>
                <Field label="Notes">
                    <input type="text" value={part.notes || ''}
                        onChange={(e) => patch({ notes: e.target.value })}
                        placeholder="Optional notes for this part"
                        style={inputStyle} />
                </Field>
            </div>
        </div>
    );
}

// ============================================================================
// Part autocomplete (Item Master lookup)
// ============================================================================

interface ItemResult {
    id: string;
    part_number: string;
    master_serial_no: string | null;
    item_name: string | null;
    unit_price: number | null;
    revision: string | null;
}

function PartAutocomplete({ value, onPick }: { value: string; onPick: (i: ItemResult) => void }) {
    const [query, setQuery] = useState(value);
    const [items, setItems] = useState<ItemResult[]>([]);
    const [open, setOpen]   = useState(false);
    const [loading, setLoading] = useState(false);
    useEffect(() => { setQuery(value); }, [value]);

    const search = useCallback(async (q: string) => {
        if (!q.trim() || q.length < 2) { setItems([]); return; }
        setLoading(true);
        try {
            const res = await fetchWithAuth(getEdgeFunctionUrl('im_list-items'), {
                method: 'POST',
                body: JSON.stringify({ search_term: q.trim(), page_size: 10 }),
            });
            const json = await res.json();
            setItems((json?.items ?? []) as ItemResult[]);
        } catch {
            setItems([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        const t = setTimeout(() => search(query), 220);
        return () => clearTimeout(t);
    }, [query, search]);

    return (
        <div style={{ position: 'relative' }}>
            <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--enterprise-gray-400)' }} />
                <input type="text" value={query}
                    onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setTimeout(() => setOpen(false), 150)}
                    placeholder="e.g., 205777 or OPW-69"
                    style={{ ...inputStyle, paddingLeft: 34, fontFamily: 'monospace' }} />
                {loading && <Loader2 size={13} style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--enterprise-gray-400)', animation: 'spin 1s linear infinite' }} />}
            </div>
            {open && items.length > 0 && (
                <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 8, boxShadow: '0 12px 28px rgba(0,0,0,0.12)', maxHeight: 280, overflow: 'auto', zIndex: 100 }}>
                    {items.map(i => (
                        <button key={i.id} type="button"
                            onMouseDown={(e) => { e.preventDefault(); onPick(i); setQuery(i.part_number); setOpen(false); }}
                            style={{ display: 'block', width: '100%', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--enterprise-gray-100)', padding: '10px 14px', background: 'white', cursor: 'pointer' }}
                            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--enterprise-gray-50)'}
                            onMouseLeave={(e) => e.currentTarget.style.background = 'white'}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                                <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--enterprise-primary)' }}>{i.part_number}</span>
                                {i.master_serial_no && <span style={{ fontSize: 11, color: 'var(--enterprise-gray-600)' }}>{i.master_serial_no}</span>}
                            </div>
                            {i.item_name && <div style={{ fontSize: 12, color: 'var(--enterprise-gray-700)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.item_name}</div>}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

// ============================================================================
// Helpers
// ============================================================================

function SectionTitle({ title, subtitle, icon }: { title: string; subtitle?: string; icon: React.ReactNode }) {
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, rgba(30,58,138,0.08) 0%, rgba(30,58,138,0.15) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--enterprise-primary)' }}>{icon}</div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--enterprise-gray-900)' }}>{title}</h3>
            </div>
            {subtitle && <p style={{ margin: '8px 0 0 42px', fontSize: 13, color: 'var(--enterprise-gray-600)', lineHeight: 1.5 }}>{subtitle}</p>}
        </div>
    );
}

function TipCard({ title, body }: { title: string; body: string }) {
    return (
        <div style={{ marginTop: 22, padding: '14px 16px', background: 'linear-gradient(135deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.06) 100%)', border: '1px solid rgba(30,58,138,0.1)', borderRadius: 10, display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ width: 24, height: 24, borderRadius: 6, background: 'rgba(30,58,138,0.12)', color: 'var(--enterprise-primary)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0, marginTop: 1 }}>
                i
            </div>
            <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--enterprise-primary)', marginBottom: 3, letterSpacing: '0.2px' }}>{title}</div>
                <div style={{ fontSize: 12, color: 'var(--enterprise-gray-700)', lineHeight: 1.55 }}>{body}</div>
            </div>
        </div>
    );
}

function Field({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column' }}>
            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--enterprise-gray-700)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>
                {label}{required && <span style={{ color: '#dc2626', marginLeft: 3 }}>*</span>}
            </label>
            {children}
            {hint && <span style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', marginTop: 4, lineHeight: 1.4 }}>{hint}</span>}
        </div>
    );
}

function NumField({ label, required, value, onChange }: { label: string; required?: boolean; value: number | null; onChange: (v: number | null) => void }) {
    return (
        <Field label={label} required={required}>
            <input type="number" min={0} step="1" value={value ?? ''}
                onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
                style={{ ...inputStyle, fontFamily: 'monospace' }} />
        </Field>
    );
}

// ============================================================================
// Styles
// ============================================================================

const backdropStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(3px)', zIndex: 1000,
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
};
const modalStyle: React.CSSProperties = {
    background: 'white', borderRadius: 24,
    width: '100%', maxWidth: 1100,
    minHeight: 520, maxHeight: '88vh',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
    boxShadow: '0 25px 50px -12px rgba(0,0,0,0.25)',
};
const inputStyle: React.CSSProperties = {
    padding: '12px 16px', fontSize: 14, border: '1px solid #e2e8f0', color: '#0f172a',
    borderRadius: 12, outline: 'none', background: 'white', width: '100%', boxSizing: 'border-box',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)', transition: 'all 0.2s',
};
const primaryBtn: React.CSSProperties = {
    background: 'linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%)', color: 'white', border: 'none',
    padding: '12px 24px', borderRadius: '8px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(37,99,235,0.25)', transition: 'all 0.2s',
};
const secondaryBtn: React.CSSProperties = {
    background: 'white', color: '#334155', border: '1px solid #cbd5e1',
    padding: '12px 24px', borderRadius: '8px', fontSize: 14, fontWeight: 600, cursor: 'pointer',
    boxShadow: '0 1px 2px rgba(0,0,0,0.05)', transition: 'all 0.2s',
};
const ghostBtn: React.CSSProperties = {
    background: 'transparent', color: '#64748b', border: 'none',
    padding: '12px 24px', fontSize: 14, fontWeight: 500, cursor: 'pointer', borderRadius: '8px',
    transition: 'all 0.2s'
};
const closeBtnStyle: React.CSSProperties = {
    border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b',
    padding: 8, borderRadius: '8px', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center'
};
