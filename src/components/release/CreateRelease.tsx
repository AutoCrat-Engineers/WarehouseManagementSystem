/**
 * CreateRelease — 5-step wizard for issuing a customer release against a BPA.
 *
 * Steps:
 *   1. Match BPA           — autocomplete search, live dropdown
 *   2. Release Header      — release PO, revision, dates, buyer (fresh input), notes
 *   3. Part + Qty          — pick part from the BPA, enter requested quantity
 *   4. Pallet Pick         — pallets grouped by parent invoice, multi-select
 *                            with real-time knock-off preview
 *   5. Review & Submit     — document preview, confirm, fire release_create + sub_invoice_create
 *
 * Creates a blanket_release row first, then a sub-invoice that carries the
 * per-invoice allocation knock-off.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    X, Search, ChevronRight, ChevronLeft, Check, Loader2, Package, Calendar,
    User, FileText, Hash, AlertCircle, CheckCircle2, Info, ClipboardList,
    ChevronDown, ChevronUp, Printer,
} from 'lucide-react';
import { listBPAs, getBPA } from '../bpa/bpaService';
import type { CustomerAgreement, CustomerAgreementPart } from '../bpa/types';
import {
    listAvailablePallets, createRelease, createSubInvoice, allocateReleasePallets,
    listReleases,
} from './releaseService';
import type { Allocation } from './releaseService';
import type { AvailablePallet } from './types';
import { matchPallets, type MatcherResult } from './palletMatcher';
import { printPickingList, printAmendmentDraft } from './releasePrints';

// ============================================================================
// Types
// ============================================================================

interface Props {
    onClose:   () => void;
    onCreated: (result: { release_id: string; release_number: string; sub_invoice_number: string } | any) => void;
    /** When provided, auto-populates the BPA and skips Step 1 */
    prefilledBpa?:   CustomerAgreement;
    prefilledParts?: CustomerAgreementPart[];
    /** When provided, shows these BPAs as clickable options in Step 1 */
    candidateBpas?: { agreement_id: string; agreement_number: string; customer_name: string; blanket_quantity: number; status: string }[];
}

type Step = 1 | 2 | 3 | 4 | 5;

interface WizardState {
    // Step 1
    bpa:       CustomerAgreement | null;
    parts:     CustomerAgreementPart[];
    // Step 2
    releasePo:     string;

    orderDate:     string;    // customer's release order date
    needByDate:    string;
    buyerName:     string;
    // Step 3
    partNumber:        string;
    requestedQuantity: number;
    /** What the customer originally asked for. Stays untouched if Step 4 amends. */
    customerRequestedQuantity: number;
    /** How requestedQuantity ended up (NONE = exact match, UP/DOWN = amended, MANUAL = user picked). */
    adjustmentType: 'NONE' | 'UP' | 'DOWN' | 'MANUAL';
    // Step 4
    selectedPallets: Map<string, number>; // pallet_id → qty selected against that pallet
}

const todayISO = () => new Date().toISOString().slice(0, 10);

// ============================================================================
// Main
// ============================================================================

export function CreateRelease({ onClose, onCreated, prefilledBpa, prefilledParts, candidateBpas }: Props) {
    const isPrefilled = !!prefilledBpa;
    const minStep: Step = isPrefilled ? 2 : 1;
    const [step, setStep] = useState<Step>(minStep);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState<string | null>(null);

    const [state, setState] = useState<WizardState>({
        bpa: prefilledBpa ?? null,
        parts: prefilledParts ?? [],
        releasePo: '',

        orderDate: todayISO(),
        needByDate: '',
        buyerName: '',
        partNumber: '',
        requestedQuantity: 0,
        customerRequestedQuantity: 0,
        adjustmentType: 'NONE',
        selectedPallets: new Map(),
    });

    const patch = (p: Partial<WizardState>) => setState(s => ({ ...s, ...p }));

    // ── Computed ────────────────────────────────────────────────────────
    const canGoNext = useMemo(() => {
        if (step === 1) return !!state.bpa;
        if (step === 2) return !!state.releasePo && !!state.needByDate && !!state.buyerName.trim();
        if (step === 3) return !!state.partNumber && state.customerRequestedQuantity > 0;
        if (step === 4) {
            const sel = Array.from(state.selectedPallets.values()).reduce((a, b) => a + b, 0);
            // Auto-match flow keeps requestedQuantity in sync with selection.
            // Require at least one pallet picked + sum equals current requestedQuantity.
            return sel > 0 && sel === state.requestedQuantity;
        }
        return true;
    }, [step, state]);

    const goNext = () => step < 5 && canGoNext && setStep((step + 1) as Step);
    const goBack = () => step > minStep && setStep((step - 1) as Step);

    const handleSubmit = async (pallets: AvailablePallet[]) => {
        if (!state.bpa) return;
        setSubmitting(true); setSubmitError(null);
        try {
            // 1. Create release header
            const release = await createRelease({
                customer_po_number: state.releasePo,
                agreement_id:       state.bpa.id,
                part_number:        state.partNumber,
                requested_quantity: state.requestedQuantity,
                need_by_date:       state.needByDate,
                buyer_name:         state.buyerName.trim(),
            });

            // 2. Build allocations from selected pallets
            const allocations: Allocation[] = [];
            for (const [palletId, qty] of state.selectedPallets) {
                const p = pallets.find(pp => pp.pallet_id === palletId);
                if (!p?.parent_invoice_line_id) {
                    throw new Error(`Pallet ${p?.pallet_number ?? palletId} is missing parent invoice binding`);
                }
                allocations.push({
                    pallet_id: palletId,
                    parent_invoice_line_id: p.parent_invoice_line_id,
                    quantity: qty,
                });
            }

            // 2b. Allocate pallet holds on the drafted release. Pallets on
            // this release become ALLOCATED; if another release already holds
            // them, they queue as RESERVED (priority = need_by_date).
            await allocateReleasePallets({
                release_id: release.release_id,
                pallets: Array.from(state.selectedPallets.entries()).map(([palletId, qty]) => {
                    const p = pallets.find(pp => pp.pallet_id === palletId);
                    return {
                        pallet_id:    palletId,
                        part_number:  state.partNumber,
                        quantity:     qty,
                        warehouse_id: (p as any)?.warehouse_id,
                    };
                }),
            });

            // 3. Create sub-invoice with multi-invoice allocations
            const sub = await createSubInvoice({
                allocations,
                blanket_release_id: release.release_id,
                customer_po_number: release.release_number,
                buyer_name:         state.buyerName.trim(),
                sub_invoice_date:   state.orderDate,
                idempotency_key:    crypto.randomUUID(),
            });

            onCreated({
                release_id:     release.release_id,
                release_number: release.release_number,
                sub_invoice_number: sub.sub_invoice_number,
            });
        } catch (e: any) {
            setSubmitError(e?.message ?? 'Failed to create release');
            setSubmitting(false);
        }
    };

    return (
        <div style={backdropStyle} onClick={onClose}>
            <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
                <Header step={step} onClose={onClose} isPrefilled={isPrefilled} />

                <div style={{ flex: 1, overflow: 'auto', display: 'flex' }}>
                    <Stepper step={step} isPrefilled={isPrefilled} onStepClick={(s) => { if (s < step && s >= minStep) setStep(s); }} />
                    <div style={{ flex: 1, padding: '28px 32px', minWidth: 0 }}>
                        {step === 1 && <Step1Match state={state} patch={patch} candidateBpas={candidateBpas} />}
                        {step === 2 && <Step2Header state={state} patch={patch} />}
                        {step === 3 && <Step3Part state={state} patch={patch} />}
                        {step === 4 && <Step4Pallets state={state} patch={patch} onSubmit={handleSubmit} submitting={submitting} />}
                        {step === 5 && <Step5Review state={state} onSubmit={handleSubmit} submitting={submitting} error={submitError} />}
                    </div>
                </div>

                <Footer
                    step={step}
                    canGoNext={canGoNext}
                    onBack={goBack}
                    onNext={goNext}
                    onCancel={onClose}
                    submitting={submitting}
                />
            </div>
        </div>
    );
}

// ============================================================================
// Layout chrome
// ============================================================================

function Header({ step, onClose, isPrefilled }: { step: Step; onClose: () => void; isPrefilled?: boolean }) {
    const displayStep = isPrefilled ? step - 1 : step;
    const totalSteps = isPrefilled ? 4 : 5;
    return (
        <div style={{ padding: '20px 28px', borderBottom: '1px solid var(--enterprise-gray-200)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'linear-gradient(135deg, #fafbfc 0%, #f1f5f9 100%)' }}>
            <div>
                <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--enterprise-gray-900)', margin: 0 }}>New Blanket Release</h2>
                <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-600)', margin: '2px 0 0', letterSpacing: '0.3px' }}>
                    Step {displayStep} of {totalSteps} · {STEP_LABELS[step - 1]}
                </p>
            </div>
            <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--enterprise-gray-500)', padding: 6, borderRadius: 6 }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--enterprise-gray-100)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                <X size={20} />
            </button>
        </div>
    );
}

const STEP_LABELS = ['Match BPA', 'Release Header', 'Part & Quantity', 'Pallet Pick', 'Review & Submit'];
const STEP_ICONS  = [Search, FileText, Package, ClipboardList, CheckCircle2];

function Stepper({ step, isPrefilled, onStepClick }: { step: Step; isPrefilled?: boolean; onStepClick?: (s: Step) => void }) {
    return (
        <div style={{ width: 200, minWidth: 200, borderRight: '1px solid var(--enterprise-gray-200)', padding: '24px 0', background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)' }}>
            {STEP_LABELS.map((label, idx) => {
                const n = (idx + 1) as Step;
                // Hide Step 1 when BPA is pre-filled
                if (isPrefilled && n === 1) return null;
                const active = n === step;
                const done   = n < step;
                const Icon   = STEP_ICONS[idx];
                const displayN = isPrefilled ? n - 1 : n;
                const clickable = done && onStepClick;
                return (
                    <div
                        key={n}
                        onClick={() => clickable && onStepClick?.(n)}
                        style={{
                            padding: '12px 20px', display: 'flex', alignItems: 'center', gap: 12, position: 'relative',
                            cursor: clickable ? 'pointer' : 'default',
                            transition: 'background 0.15s ease',
                        }}
                        onMouseEnter={e => { if (clickable) e.currentTarget.style.background = 'rgba(59,130,246,0.06)'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                        {active && <div style={{ position: 'absolute', left: 0, top: 6, bottom: 6, width: 3, background: 'var(--enterprise-primary)', borderRadius: '0 2px 2px 0' }} />}
                        <div style={{
                            width: 30, height: 30, borderRadius: '50%',
                            background: done ? 'var(--enterprise-success)' : active ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-200)',
                            color: (done || active) ? '#fff' : 'var(--enterprise-gray-600)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            flexShrink: 0,
                            transition: 'all 0.2s ease',
                            boxShadow: active ? '0 2px 8px rgba(30,58,138,0.3)' : done ? '0 1px 4px rgba(22,163,74,0.2)' : 'none',
                        }}>
                            {done ? <Check size={14} /> : <Icon size={13} />}
                        </div>
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>Step {displayN}</div>
                            <div style={{ fontSize: 13, fontWeight: active ? 700 : 500, color: active ? 'var(--enterprise-primary)' : done ? 'var(--enterprise-gray-800)' : 'var(--enterprise-gray-500)' }}>
                                {label}
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function Footer({ step, canGoNext, onBack, onNext, onCancel, submitting }: {
    step: Step; canGoNext: boolean; onBack: () => void; onNext: () => void; onCancel: () => void; submitting: boolean;
}) {
    return (
        <div style={{ padding: '14px 28px', borderTop: '1px solid var(--enterprise-gray-200)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white' }}>
            <button onClick={onCancel} style={ghostBtn}>Cancel</button>
            <div style={{ display: 'flex', gap: 8 }}>
                {step > 1 && <button onClick={onBack} style={{ ...secondaryBtn, display: 'flex', alignItems: 'center', gap: 6 }} disabled={submitting}>
                    <ChevronLeft size={14} /> Back
                </button>}
                {step < 5 && <button
                    onClick={onNext}
                    disabled={!canGoNext}
                    style={{ ...primaryBtn, display: 'flex', alignItems: 'center', gap: 6, opacity: canGoNext ? 1 : 0.5, cursor: canGoNext ? 'pointer' : 'not-allowed' }}
                >
                    Next <ChevronRight size={14} />
                </button>}
            </div>
        </div>
    );
}

// ============================================================================
// Step 1 — Match BPA (autocomplete)
// ============================================================================

function Step1Match({ state, patch, candidateBpas }: { state: WizardState; patch: (p: Partial<WizardState>) => void; candidateBpas?: Props['candidateBpas'] }) {
    const [query, setQuery] = useState(state.bpa?.agreement_number ?? '');
    const [results, setResults] = useState<CustomerAgreement[]>([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (!query.trim() || query.length < 2) { setResults([]); return; }
        let cancelled = false;
        const t = setTimeout(async () => {
            setLoading(true);
            try {
                const r = await listBPAs({ search_term: query.trim(), page_size: 20 });
                if (!cancelled) setResults(r.agreements);
            } catch {
                if (!cancelled) setResults([]);
            } finally {
                if (!cancelled) setLoading(false);
            }
        }, 220);
        return () => { cancelled = true; clearTimeout(t); };
    }, [query]);

    const pick = async (bpa: CustomerAgreement) => {
        setQuery(bpa.agreement_number);
        setResults([]);
        // Fetch full BPA (parts)
        try {
            const full = await getBPA({ agreement_id: bpa.id });
            patch({ bpa: full.agreement, parts: full.parts ?? [] });
        } catch {
            patch({ bpa, parts: [] });
        }
    };

    const pickById = async (agreementId: string) => {
        try {
            const full = await getBPA({ agreement_id: agreementId });
            setQuery(full.agreement.agreement_number);
            setResults([]);
            patch({ bpa: full.agreement, parts: full.parts ?? [] });
        } catch (e: any) {
            // fallback
        }
    };

    return (
        <div style={{ maxWidth: 800 }}>
            <SectionTitle title="Match Customer BPA" subtitle="Select a BPA below or search by agreement number." icon={<Search size={18} />} />

            {/* Candidate BPA cards — shown when multiple BPAs are available */}
            {candidateBpas && candidateBpas.length > 0 && !state.bpa && (
                <div style={{ marginTop: 24, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                        <div style={{ width: 20, height: 2, background: 'linear-gradient(90deg, #1e3a8a, #3b82f6)', borderRadius: 2 }} />
                        <span style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.8px' }}>Available Agreements</span>
                        <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
                        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500 }}>{candidateBpas.length} found</span>
                    </div>
                    {candidateBpas.map((c, idx) => (
                        <button
                            key={c.agreement_id}
                            onClick={() => pickById(c.agreement_id)}
                            style={{
                                display: 'flex', alignItems: 'center', gap: 14,
                                width: '100%', padding: '16px 20px', textAlign: 'left',
                                border: '1px solid #e2e8f0', borderRadius: 12, background: '#fff',
                                cursor: 'pointer', transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
                                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                                borderLeft: `3px solid ${c.status === 'ACTIVE' ? '#22c55e' : c.status === 'AMENDED' ? '#f59e0b' : '#94a3b8'}`,
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.borderColor = '#93c5fd';
                                e.currentTarget.style.borderLeftColor = c.status === 'ACTIVE' ? '#22c55e' : c.status === 'AMENDED' ? '#f59e0b' : '#94a3b8';
                                e.currentTarget.style.background = 'linear-gradient(135deg, #f8faff 0%, #eef2ff 100%)';
                                e.currentTarget.style.boxShadow = '0 4px 12px rgba(59,130,246,0.1)';
                                e.currentTarget.style.transform = 'translateY(-1px)';
                            }}
                            onMouseLeave={e => {
                                e.currentTarget.style.borderColor = '#e2e8f0';
                                e.currentTarget.style.borderLeftColor = c.status === 'ACTIVE' ? '#22c55e' : c.status === 'AMENDED' ? '#f59e0b' : '#94a3b8';
                                e.currentTarget.style.background = '#fff';
                                e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.04)';
                                e.currentTarget.style.transform = 'none';
                            }}
                        >
                            {/* Icon */}
                            <div style={{
                                width: 40, height: 40, borderRadius: 10, flexShrink: 0,
                                background: c.status === 'ACTIVE' ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)' : 'linear-gradient(135deg, #fffbeb, #fef3c7)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <FileText size={18} style={{ color: c.status === 'ACTIVE' ? '#16a34a' : '#d97706' }} />
                            </div>
                            {/* Info */}
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 800, color: '#1e293b', letterSpacing: '0.3px' }}>{c.agreement_number}</span>
                                    <span style={{
                                        fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.5px',
                                        background: c.status === 'ACTIVE' ? '#dcfce7' : c.status === 'AMENDED' ? '#fef3c7' : '#f3f4f6',
                                        color: c.status === 'ACTIVE' ? '#15803d' : c.status === 'AMENDED' ? '#b45309' : '#374151',
                                    }}>{c.status}</span>
                                </div>
                                <div style={{ fontSize: 12, color: '#64748b', marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.customer_name}</div>
                            </div>
                            {/* Qty + Arrow */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                                <div style={{ textAlign: 'right' }}>
                                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: '#1e293b' }}>{Number(c.blanket_quantity).toLocaleString()}</div>
                                    <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 500 }}>blanket qty</div>
                                </div>
                                <div style={{
                                    width: 28, height: 28, borderRadius: 8, background: '#f1f5f9',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <ChevronRight size={14} style={{ color: '#64748b' }} />
                                </div>
                            </div>
                        </button>
                    ))}
                    {/* Divider */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 6, marginBottom: 2 }}>
                        <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
                        <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 500, whiteSpace: 'nowrap' }}>or search manually</span>
                        <div style={{ flex: 1, height: 1, background: '#e2e8f0' }} />
                    </div>
                </div>
            )}

            {!state.bpa && (
            <div style={{ position: 'relative', marginTop: candidateBpas && candidateBpas.length > 0 && !state.bpa ? 0 : 20 }}>
                <Search size={18} style={{ position: 'absolute', left: 14, top: 18, color: 'var(--enterprise-gray-400)' }} />
                <input
                    autoFocus={!candidateBpas || candidateBpas.length === 0}
                    type="text"
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); if (state.bpa) patch({ bpa: null, parts: [] }); }}
                    placeholder="e.g., 260067251"
                    style={{ width: '100%', padding: '16px 16px 16px 44px', fontSize: 15, border: '1.5px solid var(--enterprise-gray-300)', borderRadius: 10, outline: 'none', fontFamily: 'monospace', letterSpacing: '0.5px' }}
                    onFocus={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-primary)'}
                    onBlur={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-gray-300)'}
                />
                {loading && <Loader2 size={16} className="animate-spin" style={{ position: 'absolute', right: 14, top: 19, color: 'var(--enterprise-gray-400)', animation: 'spin 1s linear infinite' }} />}

                {results.length > 0 && !state.bpa && (
                    <div style={{ position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.12)', maxHeight: 360, overflow: 'auto', zIndex: 10 }}>
                        {results.map(r => (
                            <button
                                key={r.id}
                                onClick={() => pick(r)}
                                style={{ display: 'block', width: '100%', padding: '12px 16px', textAlign: 'left', border: 'none', borderBottom: '1px solid var(--enterprise-gray-100)', background: 'white', cursor: 'pointer' }}
                                onMouseEnter={(e) => e.currentTarget.style.background = 'var(--enterprise-gray-50)'}
                                onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                            >
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div>
                                        <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--enterprise-primary)', fontSize: 14 }}>{r.agreement_number}</div>
                                        <div style={{ fontSize: 12, color: 'var(--enterprise-gray-600)', marginTop: 2 }}>{r.customer_name}</div>
                                    </div>
                                    <div style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: r.status === 'ACTIVE' ? '#dcfce7' : '#f3f4f6', color: r.status === 'ACTIVE' ? '#166534' : '#374151', fontWeight: 600 }}>
                                        {r.status}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>
            )}

            {state.bpa && (
                <div style={{ marginTop: 28, padding: 24, border: '1.5px solid var(--enterprise-primary)', borderRadius: 12, background: 'linear-gradient(135deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.07) 100%)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{ width: 28, height: 28, borderRadius: 8, background: 'linear-gradient(135deg, #1e3a8a, #3b82f6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Check size={14} style={{ color: '#fff' }} />
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--enterprise-primary)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>BPA Matched</span>
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20 }}>
                        <KeyVal label="BPA Number" value={state.bpa.agreement_number} mono bold accent />
                        <KeyVal label="Customer"   value={state.bpa.customer_name} />
                        <KeyVal label="Status"     value={state.bpa.status} />
                        <KeyVal label="Parts"      value={String(state.parts.length)} />
                        <KeyVal label="Valid"      value={state.bpa.effective_end_date ? new Date(state.bpa.effective_end_date).toLocaleDateString() : '—'} />
                    </div>
                </div>
            )}
        </div>
    );
}

// ============================================================================
// Step 2 — Release Header
// ============================================================================

function Step2Header({ state, patch }: { state: WizardState; patch: (p: Partial<WizardState>) => void }) {
    const bpaNumber = state.bpa?.agreement_number ?? '';
    const agreementId = state.bpa?.id ?? '';

    const [seqLoading, setSeqLoading] = useState(false);
    const [nextSeq, setNextSeq]       = useState<number | null>(null);
    const [existingCount, setExistingCount] = useState<number>(0);
    const [seqError, setSeqError]     = useState<string | null>(null);
    const [edited, setEdited]         = useState(false);

    // On BPA change: fetch existing releases for this agreement, derive next sequence
    useEffect(() => {
        if (!agreementId || !bpaNumber) return;
        let cancelled = false;
        setSeqLoading(true);
        setSeqError(null);
        listReleases({ agreement_id: agreementId, page_size: 500, status_filter: 'ALL' })
            .then(res => {
                if (cancelled) return;
                const releases = res.releases ?? [];
                let maxSeq = 0;
                for (const r of releases) {
                    const fromCol = r.release_sequence ?? 0;
                    // fallback: parse trailing number from release_number if release_sequence is null
                    let fromName = 0;
                    if (!fromCol && r.release_number) {
                        const m = /-(\d+)$/.exec(r.release_number);
                        if (m) fromName = parseInt(m[1], 10);
                    }
                    const seq = Math.max(fromCol, fromName);
                    if (seq > maxSeq) maxSeq = seq;
                }
                const next = maxSeq + 1;
                setNextSeq(next);
                setExistingCount(releases.length);
                // Only auto-fill if user hasn't edited and current value is empty or stale default
                if (!edited) {
                    patch({ releasePo: `${bpaNumber}-${next}` });
                }
            })
            .catch(err => {
                if (cancelled) return;
                console.error('Failed to load existing releases:', err);
                setSeqError('Could not auto-detect sequence — enter manually');
                if (!edited && !state.releasePo) {
                    patch({ releasePo: `${bpaNumber}-1` });
                }
            })
            .finally(() => { if (!cancelled) setSeqLoading(false); });
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [agreementId, bpaNumber]);

    const suggested = nextSeq != null ? `${bpaNumber}-${nextSeq}` : '';
    const isSuggested = !!suggested && state.releasePo === suggested;

    return (
        <div style={{ maxWidth: 720 }}>
            <SectionTitle title="Release Header" subtitle="Capture what's on the customer's Release document — PO number, dates, and buyer." icon={<FileText size={18} />} />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 24 }}>
                <Field label="Release PO #" required>
                    <div style={{ position: 'relative' }}>
                        <input
                            value={state.releasePo}
                            onChange={(e) => { setEdited(true); patch({ releasePo: e.target.value }); }}
                            placeholder={`${bpaNumber}-N`}
                            style={{
                                ...inputStyle,
                                fontFamily: 'monospace',
                                paddingRight: 84,
                                borderColor: isSuggested ? '#16a34a' : (inputStyle as any).borderColor,
                            }}
                        />
                        {seqLoading && (
                            <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--enterprise-gray-500)' }}>
                                <Loader2 size={12} className="spin" /> detecting…
                            </span>
                        )}
                        {!seqLoading && isSuggested && (
                            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: '#f0fdf4', color: '#15803d', fontSize: 10, fontWeight: 700, letterSpacing: '0.3px' }}>
                                <CheckCircle2 size={11} /> AUTO
                            </span>
                        )}
                    </div>
                    <div style={{ marginTop: 4, fontSize: 11, color: 'var(--enterprise-gray-500)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        {seqError ? (
                            <span style={{ color: '#b45309' }}>{seqError}</span>
                        ) : nextSeq != null ? (
                            <>
                                <span>
                                    {existingCount === 0
                                        ? 'First release for this BPA'
                                        : `${existingCount} existing release${existingCount === 1 ? '' : 's'} · next sequence`}
                                    : <strong style={{ color: 'var(--enterprise-gray-700)', fontFamily: 'monospace' }}>-{nextSeq}</strong>
                                </span>
                                {!isSuggested && (
                                    <button
                                        type="button"
                                        onClick={() => { setEdited(false); patch({ releasePo: suggested }); }}
                                        style={{ background: 'transparent', border: 'none', color: 'var(--enterprise-primary)', cursor: 'pointer', padding: 0, fontSize: 11, fontWeight: 600 }}
                                    >
                                        Reset to {suggested} →
                                    </button>
                                )}
                            </>
                        ) : null}
                    </div>
                </Field>

                <Field label="Order Date" required hint="Date on the customer's release document">
                    <input type="date" value={state.orderDate} onChange={(e) => patch({ orderDate: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Need By Date" required hint="Deliver-by date from the release">
                    <input type="date" value={state.needByDate} onChange={(e) => patch({ needByDate: e.target.value })} style={inputStyle} />
                </Field>
                <Field label="Buyer Name" required hint="Person on the customer side who issued THIS release (often differs from BPA buyer)">
                    <input type="text" value={state.buyerName} onChange={(e) => patch({ buyerName: e.target.value })}
                        placeholder="e.g., Wood, Sherrill"
                        style={inputStyle} />
                    {state.bpa?.buyer_name && state.bpa.buyer_name !== state.buyerName && (
                        <button onClick={() => patch({ buyerName: state.bpa!.buyer_name ?? '' })}
                            style={{ marginTop: 4, fontSize: 11, background: 'transparent', border: 'none', color: 'var(--enterprise-primary)', cursor: 'pointer', padding: 0 }}>
                            Use BPA buyer ({state.bpa.buyer_name}) →
                        </button>
                    )}
                </Field>

            </div>
        </div>
    );
}

// ============================================================================
// Step 3 — Part + Quantity
// ============================================================================

function Step3Part({ state, patch }: { state: WizardState; patch: (p: Partial<WizardState>) => void }) {
    const parts = state.parts;
    const selected = parts.find(p => p.part_number === state.partNumber);
    const relMult = selected?.release_multiple ?? 1;
    const mismatchRelMult = !!(selected && state.customerRequestedQuantity > 0 && state.customerRequestedQuantity % relMult !== 0);

    return (
        <div style={{ maxWidth: 820 }}>
            <SectionTitle title="Part & Quantity" subtitle="Pick the part being released and the quantity requested." icon={<Package size={18} />} />

            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 22 }}>
                {parts.length === 0 && (
                    <div style={{ padding: 30, textAlign: 'center', color: 'var(--enterprise-gray-500)', fontSize: 13, border: '1px dashed var(--enterprise-gray-300)', borderRadius: 10 }}>
                        No parts on this BPA.
                    </div>
                )}
                {parts.map(p => {
                    const active = p.part_number === state.partNumber;
                    return (
                        <button
                            key={p.id}
                            onClick={() => patch({ partNumber: p.part_number })}
                            style={{
                                display: 'grid',
                                gridTemplateColumns: '40px 1.2fr 1fr 1fr 1fr',
                                gap: 14,
                                alignItems: 'center',
                                padding: '14px 16px',
                                background: active ? 'linear-gradient(135deg, rgba(30,58,138,0.05) 0%, rgba(30,58,138,0.09) 100%)' : 'white',
                                border: active ? '1.5px solid var(--enterprise-primary)' : '1px solid var(--enterprise-gray-200)',
                                borderRadius: 10,
                                cursor: 'pointer',
                                textAlign: 'left',
                                font: 'inherit',
                                transition: 'all 0.15s ease',
                            }}
                        >
                            <div style={{
                                width: 22, height: 22, borderRadius: '50%',
                                border: `2px solid ${active ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-300)'}`,
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                {active && <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--enterprise-primary)' }} />}
                            </div>
                            <div>
                                <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{p.msn_code}</div>
                                <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--enterprise-gray-900)', marginTop: 1 }}>{p.part_number}</div>
                            </div>
                            <MiniStat label="Blanket"      value={Number(p.blanket_quantity).toLocaleString()} />
                            <MiniStat label="BPA Number"   value={state.bpa?.agreement_number ?? '—'} />
                            <MiniStat label="Unit Price"   value={`$${Number(p.unit_price ?? 0).toFixed(2)}`} />
                        </button>
                    );
                })}
            </div>

            {selected && (
                <div style={{ marginTop: 24, padding: 18, background: 'var(--enterprise-gray-50)', borderRadius: 10 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', columnGap: 14, alignItems: 'start' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--enterprise-gray-700)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>
                                Requested Quantity<span style={{ color: '#dc2626', marginLeft: 3 }}>*</span>
                            </label>
                            <input type="number" min={0}
                                value={state.customerRequestedQuantity || ''}
                                onChange={(e) => {
                                    const v = Math.max(0, Number(e.target.value) || 0);
                                    patch({
                                        customerRequestedQuantity: v,
                                        requestedQuantity: v,
                                        adjustmentType: 'NONE',
                                        selectedPallets: new Map(),
                                    });
                                }}
                                style={{ ...inputStyle, fontSize: 18, fontWeight: 700, height: 44 }} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--enterprise-gray-700)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>
                                Total Release Value
                            </label>
                            <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: 'var(--enterprise-gray-900)' }}>
                                {state.customerRequestedQuantity > 0
                                    ? `$${(state.customerRequestedQuantity * (selected.unit_price || 0)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                                    : '—'}
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', textAlign: 'right' }}>
                            <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--enterprise-gray-700)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>
                                BPA REL MULT (hint)
                            </label>
                            <div style={{ height: 44, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', fontSize: 18, fontWeight: 700, color: 'var(--enterprise-gray-900)' }}>
                                {Number(relMult).toLocaleString()}
                            </div>
                        </div>
                    </div>
                    {mismatchRelMult && (
                        <div style={{ marginTop: 10, padding: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 8, fontSize: 12, color: '#1e3a8a', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Info size={14} /> Customer asked for a quantity that isn't a multiple of the BPA's REL MULT ({relMult.toLocaleString()}). That's fine — actual pallet outer-quantities vary per shipment. The next step will find the best whole-pallet combination.
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ============================================================================
// Step 4 — Pallet Allocation (intelligent matcher with manual override)
// ============================================================================

function Step4Pallets({ state, patch, onSubmit, submitting }: {
    state: WizardState; patch: (p: Partial<WizardState>) => void;
    onSubmit: (pallets: AvailablePallet[]) => void; submitting: boolean;
}) {
    const [pallets, setPallets] = useState<AvailablePallet[]>([]);
    const [loading, setLoading] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const [manualMode, setManualMode] = useState(false);

    useEffect(() => {
        if (!state.partNumber || !state.bpa) return;
        let cancelled = false;
        (async () => {
            setLoading(true); setErr(null);
            try {
                const r = await listAvailablePallets({
                    part_number: state.partNumber,
                    agreement_id: state.bpa!.id,
                    limit: 500,
                });
                if (!cancelled) setPallets(r.pallets);
            } catch (e: any) {
                if (!cancelled) setErr(e?.message ?? 'Failed to load pallets');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [state.partNumber, state.bpa]);

    // ── Run matcher whenever pallets / customer ask change ──────────────
    const matcher: MatcherResult | null = useMemo(() => {
        if (!pallets.length || !state.customerRequestedQuantity) return null;
        const ranked = pallets.map(p => ({
            id:        p.pallet_id,
            qty:       Number(p.quantity) || 0,
            fifoOrder: (p.shipment_sequence ?? 9999) * 1e13
                       + (p.placed_at ? new Date(p.placed_at).getTime() : 0),
        }));
        return matchPallets(ranked, state.customerRequestedQuantity);
    }, [pallets, state.customerRequestedQuantity]);

    // ── Auto-apply EXACT match on first compute (don't clobber user edits) ──
    useEffect(() => {
        if (manualMode) return;
        if (!matcher || !matcher.exact) return;
        if (state.adjustmentType === 'MANUAL') return;
        // Only apply if not already matching the exact set
        const exactIds = new Set(matcher.exact.pallets.map(p => p.id));
        const currentIds = new Set(state.selectedPallets.keys());
        const sameSize = exactIds.size === currentIds.size;
        const sameSet = sameSize && [...exactIds].every(id => currentIds.has(id));
        if (sameSet && state.requestedQuantity === matcher.exact.totalQty) return;
        const next = new Map<string, number>();
        for (const p of matcher.exact.pallets) next.set(p.id, p.qty);
        patch({
            selectedPallets: next,
            requestedQuantity: matcher.exact.totalQty,
            adjustmentType: 'NONE',
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [matcher, manualMode]);

    const applySelection = (sel: { pallets: { id: string; qty: number }[]; totalQty: number }, adjustment: 'NONE' | 'UP' | 'DOWN' | 'MANUAL') => {
        const next = new Map<string, number>();
        for (const p of sel.pallets) next.set(p.id, p.qty);
        patch({
            selectedPallets: next,
            requestedQuantity: sel.totalQty,
            adjustmentType: adjustment,
        });
    };

    // Build view-model rows for a given pallet set
    const palletRows = (ids: string[]) =>
        ids.map(id => pallets.find(p => p.pallet_id === id)).filter((p): p is AvailablePallet => !!p);

    if (loading) {
        return (
            <div style={{ padding: 60, textAlign: 'center', color: 'var(--enterprise-gray-500)' }}>
                <Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} />
                <div style={{ marginTop: 8, fontSize: 13 }}>Analyzing rack inventory…</div>
            </div>
        );
    }
    if (err) return <div style={{ padding: 14, background: '#fef2f2', borderLeft: '3px solid #dc2626', color: '#991b1b', fontSize: 13 }}>{err}</div>;

    if (!pallets.length) {
        return (
            <div style={{ padding: 40, textAlign: 'center', border: '1px dashed var(--enterprise-gray-300)', borderRadius: 10, color: 'var(--enterprise-gray-500)' }}>
                No pallets available in rack for this part on this BPA.
            </div>
        );
    }

    if (manualMode) {
        return <Step4Manual state={state} patch={patch} pallets={pallets} onExitManual={() => setManualMode(false)} />;
    }

    if (!matcher) return null;

    const customerAsk = state.customerRequestedQuantity;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <SectionTitle
                title="Pallet Allocation"
                subtitle="Auto-matching whole pallets in FIFO order to fulfill the customer's quantity exactly."
                icon={<ClipboardList size={18} />}
            />

            <AllocationSummary
                customerAsk={customerAsk}
                availableTotal={matcher.availableTotal}
                palletsAvailable={pallets.length}
            />

            {matcher.exact ? (
                <ExactMatchCard
                    selection={matcher.exact}
                    via={matcher.exactVia!}
                    customerAsk={customerAsk}
                    palletRows={palletRows(matcher.exact.pallets.map(p => p.id))}
                />
            ) : matcher.insufficient ? (
                <InsufficientStockCard
                    customerAsk={customerAsk}
                    available={matcher.availableTotal}
                    below={matcher.below}
                    palletRows={palletRows((matcher.below?.pallets ?? []).map(p => p.id))}
                    onAccept={() => matcher.below && applySelection(matcher.below, 'DOWN')}
                    selectedTotal={state.requestedQuantity}
                    isSelected={state.adjustmentType === 'DOWN' && state.requestedQuantity === matcher.below?.totalQty}
                />
            ) : (
                <NoExactMatchPanel
                    customerAsk={customerAsk}
                    above={matcher.above}
                    below={matcher.below}
                    palletRowsFor={palletRows}
                    selected={state.adjustmentType}
                    selectedTotal={state.requestedQuantity}
                    onPickUp={() => matcher.above && applySelection(matcher.above, 'UP')}
                    onPickDown={() => matcher.below && applySelection(matcher.below, 'DOWN')}
                    customerName={state.bpa?.customer_name ?? 'the customer'}
                    releasePo={state.releasePo}
                />
            )}

            <button
                type="button"
                onClick={() => setManualMode(true)}
                style={{ alignSelf: 'flex-start', background: 'transparent', border: 'none', color: 'var(--enterprise-gray-500)', fontSize: 12, cursor: 'pointer', textDecoration: 'underline', padding: 0 }}
            >
                Override and pick pallets manually →
            </button>
        </div>
    );
}

// ── Sub-components for Step 4 ─────────────────────────────────────────────

function AllocationSummary({ customerAsk, availableTotal, palletsAvailable }: { customerAsk: number; availableTotal: number; palletsAvailable: number }) {
    const enough = availableTotal >= customerAsk;
    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            <KpiTile label="Customer Asked"   value={customerAsk.toLocaleString()}     unit="pcs" tint="#1e3a8a" />
            <KpiTile label="Available in Rack" value={availableTotal.toLocaleString()} unit={`${palletsAvailable} pallets`} tint={enough ? '#16a34a' : '#dc2626'} />
            <KpiTile label="Stock Coverage"   value={enough ? '✓ Sufficient' : '⚠ Short'} unit={enough ? '' : `${(customerAsk - availableTotal).toLocaleString()} short`} tint={enough ? '#16a34a' : '#dc2626'} />
        </div>
    );
}

function KpiTile({ label, value, unit, tint }: { label: string; value: string; unit?: string; tint: string }) {
    return (
        <div style={{ background: 'white', border: '1px solid var(--enterprise-gray-100)', borderLeft: `3px solid ${tint}`, borderRadius: 10, padding: '12px 14px' }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.6px', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: tint, marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
            {unit && <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', marginTop: 2 }}>{unit}</div>}
        </div>
    );
}

function ExactMatchCard({ selection, via, customerAsk, palletRows }: { selection: { pallets: { id: string; qty: number }[]; totalQty: number }; via: 'FIFO_PREFIX' | 'SUBSET_SEARCH'; customerAsk: number; palletRows: AvailablePallet[] }) {
    const [expanded, setExpanded] = useState(false);
    const shipments = new Set(palletRows.map(p => p.shipment_sequence).filter(s => s != null));
    return (
        <div style={{ background: 'linear-gradient(180deg, #f0fdf4 0%, #ecfdf5 100%)', border: '1.5px solid #86efac', borderRadius: 14, overflow: 'hidden', boxShadow: '0 2px 10px rgba(34,197,94,0.08)' }}>
            <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ width: 44, height: 44, borderRadius: 12, background: 'linear-gradient(135deg, #22c55e 0%, #16a34a 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 4px 10px rgba(22,163,74,0.25)' }}>
                        <CheckCircle2 size={22} color="white" />
                    </div>
                    <div>
                        <div style={{ fontSize: 11, fontWeight: 800, color: '#15803d', letterSpacing: '0.6px', textTransform: 'uppercase' }}>
                            {via === 'FIFO_PREFIX' ? 'Perfect FIFO Match' : 'Exact Match Found'}
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: '#14532d', marginTop: 2 }}>
                            {selection.pallets.length} pallets · {customerAsk.toLocaleString()} pcs
                            {shipments.size > 0 && <span style={{ color: '#15803d', fontWeight: 500 }}> · across {shipments.size} shipment{shipments.size === 1 ? '' : 's'}</span>}
                        </div>
                        <div style={{ fontSize: 12, color: '#166534', marginTop: 4 }}>
                            {via === 'FIFO_PREFIX'
                                ? 'Oldest shipments fulfill the request exactly. No customer amendment needed.'
                                : 'No FIFO prefix matched, but a combination of pallets sums exactly to the requested quantity. No amendment needed.'}
                        </div>
                    </div>
                </div>
                <button onClick={() => setExpanded(!expanded)} style={{ background: 'white', border: '1px solid #86efac', color: '#15803d', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {expanded ? 'Hide' : 'Show'} pallets
                </button>
            </div>
            {expanded && <PalletList rows={palletRows} accent="#16a34a" />}
        </div>
    );
}

function NoExactMatchPanel({ customerAsk, above, below, palletRowsFor, selected, selectedTotal, onPickUp, onPickDown, customerName, releasePo }: {
    customerAsk: number;
    above: { pallets: { id: string; qty: number }[]; totalQty: number } | null;
    below: { pallets: { id: string; qty: number }[]; totalQty: number } | null;
    palletRowsFor: (ids: string[]) => AvailablePallet[];
    selected: 'NONE' | 'UP' | 'DOWN' | 'MANUAL';
    selectedTotal: number;
    onPickUp: () => void;
    onPickDown: () => void;
    customerName: string;
    releasePo: string;
}) {
    return (
        <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <OptionCard
                    kind="up"
                    target={above?.totalQty ?? null}
                    delta={above ? above.totalQty - customerAsk : null}
                    pallets={above ? above.pallets.length : 0}
                    palletRows={above ? palletRowsFor(above.pallets.map(p => p.id)) : []}
                    isSelected={selected === 'UP' && !!above && selectedTotal === above.totalQty}
                    onSelect={onPickUp}
                    customerAsk={customerAsk}
                    customerName={customerName}
                    releasePo={releasePo}
                />
                <OptionCard
                    kind="down"
                    target={below?.totalQty ?? null}
                    delta={below ? customerAsk - below.totalQty : null}
                    pallets={below ? below.pallets.length : 0}
                    palletRows={below ? palletRowsFor(below.pallets.map(p => p.id)) : []}
                    isSelected={selected === 'DOWN' && !!below && selectedTotal === below.totalQty}
                    onSelect={onPickDown}
                    customerAsk={customerAsk}
                    customerName={customerName}
                    releasePo={releasePo}
                />
            </div>
        </>
    );
}

function OptionCard({ kind, target, delta, pallets, palletRows, isSelected, onSelect, customerAsk, customerName, releasePo }: {
    kind: 'up' | 'down';
    target: number | null;
    delta: number | null;
    pallets: number;
    palletRows: AvailablePallet[];
    isSelected: boolean;
    onSelect: () => void;
    customerAsk: number;
    customerName: string;
    releasePo: string;
}) {
    const [showDetail, setShowDetail] = useState(false);
    const accent = kind === 'up' ? '#d97706' : '#2563eb';
    const tint   = kind === 'up' ? '#fffbeb' : '#eff6ff';
    const border = kind === 'up' ? '#fcd34d' : '#93c5fd';
    const label  = kind === 'up' ? 'Round Up' : 'Round Down';
    const dirArrow = kind === 'up' ? '▲' : '▼';

    if (target == null || delta == null) {
        return (
            <div style={{ padding: 16, background: '#fafafa', border: '1px dashed var(--enterprise-gray-300)', borderRadius: 12, color: 'var(--enterprise-gray-400)', fontSize: 13, textAlign: 'center' }}>
                {label}: not available
            </div>
        );
    }

    const customerScript = kind === 'up'
        ? `Hi ${customerName}, on release ${releasePo} we have whole-pallet stock that totals ${target.toLocaleString()} pcs (the closest above your ask of ${customerAsk.toLocaleString()}). Please confirm an amendment to ${target.toLocaleString()} pcs (+${delta.toLocaleString()}) so we can dispatch.`
        : `Hi ${customerName}, on release ${releasePo} our whole-pallet stock totals ${target.toLocaleString()} pcs (the closest below your ask of ${customerAsk.toLocaleString()}). Please confirm an amendment to ${target.toLocaleString()} pcs (−${delta.toLocaleString()}) so we can dispatch.`;

    return (
        <div style={{
            background: isSelected ? 'white' : tint,
            border: `${isSelected ? '2px' : '1px'} solid ${isSelected ? accent : border}`,
            borderRadius: 12,
            overflow: 'hidden',
            transition: 'all 0.15s ease',
            boxShadow: isSelected ? `0 6px 18px ${accent}22` : 'none',
        }}>
            {/* Header row — full-width horizontal layout */}
            <div style={{ display: 'flex', alignItems: 'stretch' }}>
                <button
                    type="button"
                    onClick={onSelect}
                    style={{
                        flex: 1, padding: '14px 18px', background: 'transparent', border: 'none',
                        cursor: 'pointer', textAlign: 'left', font: 'inherit',
                        display: 'flex', alignItems: 'center', gap: 18,
                    }}
                >
                    {/* Radio */}
                    <div style={{
                        width: 22, height: 22, borderRadius: '50%',
                        border: `2px solid ${isSelected ? accent : 'var(--enterprise-gray-300)'}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                    }}>
                        {isSelected && <div style={{ width: 10, height: 10, borderRadius: '50%', background: accent }} />}
                    </div>
                    {/* Label + headline value */}
                    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 800, letterSpacing: '0.5px', color: accent, textTransform: 'uppercase' }}>
                            <span>{dirArrow}</span> {label} to
                        </div>
                        <div style={{ fontSize: 26, fontWeight: 800, color: 'var(--enterprise-gray-900)', fontVariantNumeric: 'tabular-nums', marginTop: 2, lineHeight: 1.1 }}>
                            {target.toLocaleString()} <span style={{ fontSize: 13, color: 'var(--enterprise-gray-500)', fontWeight: 500 }}>pcs</span>
                        </div>
                    </div>
                    {/* Spacer */}
                    <div style={{ flex: 1 }} />
                    {/* Meta stats — pallets count + delta */}
                    <div style={{ display: 'flex', gap: 24, alignItems: 'center', flexShrink: 0 }}>
                        <MetaStat label="Pallets" value={pallets.toString()} />
                        <MetaStat
                            label="Δ vs Ask"
                            value={`${kind === 'up' ? '+' : '−'}${delta.toLocaleString()}`}
                            tone={accent}
                        />
                    </div>
                </button>
                {/* Expand toggle (separate so radio click doesn't conflict) */}
                <button
                    type="button"
                    onClick={() => setShowDetail(!showDetail)}
                    aria-label={showDetail ? 'Hide details' : 'Show details'}
                    style={{
                        padding: '0 18px', background: 'transparent', border: 'none', borderLeft: `1px solid ${border}`,
                        color: accent, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 11, fontWeight: 700, letterSpacing: '0.4px', textTransform: 'uppercase',
                    }}
                >
                    {showDetail ? <ChevronUp size={14} /> : <ChevronDown size={14} />} {showDetail ? 'Hide' : 'Details'}
                </button>
            </div>

            {/* Expanded detail — 2-col on wide screens, scrolls if overflowing */}
            {showDetail && (
                <div style={{ borderTop: `1px solid ${border}`, padding: 14, background: 'rgba(255,255,255,0.7)', display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 14, alignItems: 'stretch' }}>
                    {/* Pallets list */}
                    <div style={{ background: 'white', border: '1px solid var(--enterprise-gray-100)', borderRadius: 8, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ padding: '8px 12px', fontSize: 10, fontWeight: 700, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', borderBottom: '1px solid var(--enterprise-gray-100)', background: 'var(--enterprise-gray-50)', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Pallets in this option</span>
                            <span style={{ color: accent }}>{pallets} pallet{pallets === 1 ? '' : 's'} · {target.toLocaleString()} pcs</span>
                        </div>
                        <div style={{ maxHeight: 220, overflowY: 'auto' }}>
                            <PalletList rows={palletRows} accent={accent} dense />
                        </div>
                    </div>
                    {/* Customer message */}
                    <div style={{ background: '#f8fafc', borderRadius: 8, border: '1px dashed var(--enterprise-gray-300)', padding: 12, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 6 }}>Suggested message to customer</div>
                        <div style={{ fontSize: 12, color: 'var(--enterprise-gray-700)', lineHeight: 1.55, whiteSpace: 'pre-wrap', wordBreak: 'break-word', overflowY: 'auto', maxHeight: 220, flex: 1 }}>
                            {customerScript}
                        </div>
                        <button
                            type="button"
                            onClick={() => { try { navigator.clipboard?.writeText(customerScript); } catch { /* ignore */ } }}
                            style={{ marginTop: 10, alignSelf: 'flex-start', background: 'white', border: `1px solid ${border}`, color: accent, borderRadius: 6, padding: '4px 10px', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}
                        >
                            Copy message
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function MetaStat({ label, value, tone }: { label: string; value: string; tone?: string }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: tone ?? 'var(--enterprise-gray-900)', fontVariantNumeric: 'tabular-nums', marginTop: 2 }}>{value}</div>
        </div>
    );
}

function InsufficientStockCard({ customerAsk, available, below, palletRows, onAccept, isSelected }: {
    customerAsk: number;
    available: number;
    below: { pallets: { id: string; qty: number }[]; totalQty: number } | null;
    palletRows: AvailablePallet[];
    onAccept: () => void;
    selectedTotal: number;
    isSelected: boolean;
}) {
    const short = customerAsk - available;
    return (
        <div style={{ background: '#fef2f2', border: '1.5px solid #fca5a5', borderRadius: 14, overflow: 'hidden' }}>
            <div style={{ padding: 18, display: 'flex', alignItems: 'flex-start', gap: 14 }}>
                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #ef4444, #dc2626)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <AlertCircle size={20} color="white" />
                </div>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.5px', color: '#991b1b', textTransform: 'uppercase' }}>Insufficient Stock</div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: '#7f1d1d', marginTop: 2 }}>
                        Customer asked {customerAsk.toLocaleString()} · only {available.toLocaleString()} in rack ({short.toLocaleString()} short)
                    </div>
                    <div style={{ fontSize: 12, color: '#991b1b', marginTop: 6, lineHeight: 1.5 }}>
                        You can ship the available {available.toLocaleString()} pcs as a partial fulfillment (release will need to be amended), or wait for stock and revisit.
                    </div>
                    {below && below.totalQty > 0 && (
                        <button
                            type="button"
                            onClick={onAccept}
                            style={{ marginTop: 12, padding: '8px 16px', background: isSelected ? '#dc2626' : 'white', border: `1.5px solid ${isSelected ? '#dc2626' : '#fca5a5'}`, color: isSelected ? 'white' : '#991b1b', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                        >
                            {isSelected ? '✓ Selected — partial fulfillment' : `Accept partial · ship ${available.toLocaleString()} pcs`}
                        </button>
                    )}
                </div>
            </div>
            {palletRows.length > 0 && <PalletList rows={palletRows} accent="#dc2626" />}
        </div>
    );
}

function PalletList({ rows, accent, dense = false }: { rows: AvailablePallet[]; accent: string; dense?: boolean }) {
    return (
        <div style={{ background: 'rgba(255,255,255,0.6)', borderTop: '1px solid rgba(0,0,0,0.05)' }}>
            {rows.map(p => (
                <div key={p.pallet_id} style={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1.8fr) auto minmax(0, 1.1fr) minmax(0, 1.1fr)',
                    padding: dense ? '8px 14px' : '10px 18px',
                    alignItems: 'center', columnGap: 14,
                    borderBottom: '1px solid rgba(0,0,0,0.04)',
                    fontSize: dense ? 11 : 12,
                }}>
                    {/* Pallet ID + rack — full flex, no wrapping */}
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--enterprise-gray-900)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.pallet_number}>
                            {p.pallet_number}
                        </div>
                        <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginTop: 1 }}>Rack {p.location_code ?? '—'}</div>
                    </div>
                    {/* Qty as compact badge — sits right next to pallet id */}
                    <div style={{
                        padding: '4px 10px',
                        borderRadius: 999,
                        background: `${accent}15`,
                        color: accent,
                        fontFamily: 'monospace', fontWeight: 700,
                        fontSize: dense ? 11 : 12,
                        whiteSpace: 'nowrap',
                    }}>
                        {Number(p.quantity).toLocaleString()} pcs
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--enterprise-gray-500)', letterSpacing: '0.4px', textTransform: 'uppercase' }}>Shipment</div>
                        <div style={{ color: 'var(--enterprise-gray-700)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={String(p.shipment_number ?? p.shipment_sequence ?? '—')}>
                            {p.shipment_number ?? p.shipment_sequence ?? '—'}
                        </div>
                    </div>
                    <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--enterprise-gray-500)', letterSpacing: '0.4px', textTransform: 'uppercase' }}>Invoice</div>
                        <div style={{ fontFamily: 'monospace', color: 'var(--enterprise-gray-700)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={p.parent_invoice_number ?? '—'}>
                            {p.parent_invoice_number ?? '—'}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
}

// ── Manual override (legacy grouped picker) ───────────────────────────────
function Step4Manual({ state, patch, pallets, onExitManual }: {
    state: WizardState; patch: (p: Partial<WizardState>) => void; pallets: AvailablePallet[]; onExitManual: () => void;
}) {

    // Group by invoice_number
    const groups = useMemo(() => {
        const byInv = new Map<string, { invoice_number: string; invoice_date: string | null; pending_qty: number | null; pallets: AvailablePallet[] }>();
        for (const p of pallets) {
            const k = p.parent_invoice_number ?? '(unlinked)';
            if (!byInv.has(k)) byInv.set(k, {
                invoice_number: k,
                invoice_date:   p.parent_invoice_date,
                pending_qty:    p.parent_pending_qty,
                pallets: [],
            });
            byInv.get(k)!.pallets.push(p);
        }
        return Array.from(byInv.values()).sort((a, b) => {
            const ad = a.invoice_date ? new Date(a.invoice_date).getTime() : 0;
            const bd = b.invoice_date ? new Date(b.invoice_date).getTime() : 0;
            return ad - bd;
        });
    }, [pallets]);

    const selectedQty = useMemo(
        () => Array.from(state.selectedPallets.values()).reduce((a, b) => a + b, 0),
        [state.selectedPallets],
    );
    const remaining = state.requestedQuantity - selectedQty;

    const knockOffByInvoice = useMemo(() => {
        const m = new Map<string, number>();
        for (const [pid, qty] of state.selectedPallets) {
            const p = pallets.find(x => x.pallet_id === pid);
            if (!p) continue;
            const k = p.parent_invoice_number ?? '(unlinked)';
            m.set(k, (m.get(k) ?? 0) + qty);
        }
        return m;
    }, [state.selectedPallets, pallets]);

    const togglePallet = (p: AvailablePallet) => {
        const next = new Map(state.selectedPallets);
        if (next.has(p.pallet_id)) {
            next.delete(p.pallet_id);
        } else {
            next.set(p.pallet_id, p.quantity);
        }
        const total = Array.from(next.values()).reduce((a, b) => a + b, 0);
        patch({ selectedPallets: next, requestedQuantity: total, adjustmentType: 'MANUAL' });
    };

    const autoPickFIFO = () => {
        const next = new Map<string, number>();
        let need = state.customerRequestedQuantity;
        const flat = groups.flatMap(g => g.pallets).sort((a, b) => {
            const ad = a.placed_at ? new Date(a.placed_at).getTime() : 0;
            const bd = b.placed_at ? new Date(b.placed_at).getTime() : 0;
            return ad - bd;
        });
        for (const p of flat) {
            if (need <= 0) break;
            next.set(p.pallet_id, p.quantity);
            need -= p.quantity;
        }
        const total = Array.from(next.values()).reduce((a, b) => a + b, 0);
        patch({ selectedPallets: next, requestedQuantity: total, adjustmentType: 'MANUAL' });
    };

    const pct = Math.min(100, (selectedQty / Math.max(1, state.requestedQuantity)) * 100);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
                <SectionTitle title="Manual Pallet Pick" subtitle={`Grouped by parent invoice · ${pallets.length} available for ${state.partNumber}`} icon={<ClipboardList size={18} />} />
                <button type="button" onClick={onExitManual} style={{ background: 'transparent', border: '1px solid var(--enterprise-gray-300)', color: 'var(--enterprise-gray-700)', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    ← Back to auto-match
                </button>
            </div>

            {/* Top: Selection Progress Bar & FIFO */}
            <div style={{ position: 'sticky', top: -28, zIndex: 10, padding: '16px 20px', background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(8px)', border: '1px solid var(--enterprise-gray-200)', borderRadius: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                            <span style={{ fontSize: 24, fontWeight: 800, color: 'var(--enterprise-gray-900)' }}>
                                {selectedQty.toLocaleString()}
                            </span>
                            <span style={{ fontSize: 13, color: 'var(--enterprise-gray-500)' }}>pcs selected · customer asked {state.customerRequestedQuantity.toLocaleString()}</span>
                        </div>
                        {remaining > 0 && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--enterprise-warning)' }}>{remaining.toLocaleString()} more needed</span>}
                        {remaining < 0 && <span style={{ fontSize: 13, fontWeight: 600, color: '#dc2626' }}>Over by {Math.abs(remaining).toLocaleString()} pcs</span>}
                        {remaining === 0 && <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--enterprise-success)' }}>Matches customer ask</span>}
                    </div>
                    <button onClick={autoPickFIFO} style={{ fontSize: 12, padding: '8px 14px', border: '1px solid var(--enterprise-primary)', color: 'var(--enterprise-primary)', background: 'white', borderRadius: 6, cursor: 'pointer', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
                        onMouseEnter={(e) => e.currentTarget.style.background = 'var(--enterprise-gray-50)'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                    >
                        Auto-pick FIFO
                    </button>
                </div>

                <div style={{ height: 6, background: 'var(--enterprise-gray-200)', borderRadius: 3, overflow: 'hidden', marginTop: 12 }}>
                    <div style={{
                        width: `${pct}%`,
                        height: '100%',
                        background: selectedQty === state.customerRequestedQuantity ? 'var(--enterprise-success)' : 'var(--enterprise-primary)',
                        transition: 'width 0.2s ease, background 0.2s ease',
                    }} />
                </div>

                {knockOffByInvoice.size > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--enterprise-gray-500)', display: 'flex', alignItems: 'center' }}>DRAWING FROM:</div>
                        {Array.from(knockOffByInvoice.entries()).map(([inv, qty]) => (
                            <div key={inv} style={{ fontSize: 11, padding: '4px 8px', background: 'var(--enterprise-gray-100)', color: 'var(--enterprise-gray-700)', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--enterprise-gray-200)' }}>
                                <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{inv}</span>
                                <span>{qty.toLocaleString()} pcs</span>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {groups.length === 0 && (
                <div style={{ padding: 40, textAlign: 'center', border: '1px dashed var(--enterprise-gray-300)', borderRadius: 10, color: 'var(--enterprise-gray-500)' }}>
                    No pallets available in rack for this part on this BPA.
                </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {groups.map((g, idx) => (
                    <InvoiceGroup key={g.invoice_number} group={g} selected={state.selectedPallets} togglePallet={togglePallet} initiallyExpanded={idx === 0} />
                ))}
            </div>
        </div>
    );
}

function InvoiceGroup({ group, selected, togglePallet, initiallyExpanded = false }: {
    group: { invoice_number: string; invoice_date: string | null; pending_qty: number | null; pallets: AvailablePallet[] };
    selected: Map<string, number>;
    togglePallet: (p: AvailablePallet) => void;
    initiallyExpanded?: boolean;
}) {
    const selectedCount = group.pallets.filter(p => selected.has(p.pallet_id)).length;
    const [expanded, setExpanded] = useState(initiallyExpanded);

    return (
        <div style={{ border: '1px solid var(--enterprise-gray-200)', borderRadius: 10, overflow: 'hidden' }}>
            <div 
                onClick={() => setExpanded(!expanded)}
                style={{ 
                    padding: '12px 16px', background: 'linear-gradient(135deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.06) 100%)', 
                    borderBottom: expanded ? '1px solid var(--enterprise-gray-200)' : 'none', 
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    cursor: 'pointer', transition: 'background 0.2s'
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = 'linear-gradient(135deg, rgba(30,58,138,0.05) 0%, rgba(30,58,138,0.08) 100%)'}
                onMouseLeave={(e) => e.currentTarget.style.background = 'linear-gradient(135deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.06) 100%)'}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ color: 'var(--enterprise-gray-500)', display: 'flex', alignItems: 'center' }}>
                        {expanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </div>
                    <div>
                        <div style={{ fontFamily: 'monospace', fontSize: 14, fontWeight: 700, color: 'var(--enterprise-gray-900)' }}>{group.invoice_number}</div>
                        <div style={{ fontSize: 11, color: 'var(--enterprise-gray-600)', marginTop: 2 }}>
                            {group.invoice_date ? new Date(group.invoice_date).toLocaleDateString() : '—'}
                            {group.pending_qty != null && <> · {group.pending_qty.toLocaleString()} pending</>}
                        </div>
                    </div>
                </div>
                <div style={{ fontSize: 12, fontWeight: 600, color: selectedCount > 0 ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-500)' }}>
                    {selectedCount} / {group.pallets.length} selected
                </div>
            </div>
            
            {expanded && (
                <div style={{ maxHeight: 280, overflowY: 'auto' }}>
                    {group.pallets.map(p => {
                        const sel = selected.has(p.pallet_id);
                        return (
                            <button
                                key={p.pallet_id}
                                onClick={() => togglePallet(p)}
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns: '22px 1fr 1fr 1fr 1fr',
                                    gap: 12,
                                    width: '100%',
                                    padding: '10px 14px',
                                    alignItems: 'center',
                                    background: sel ? 'rgba(30,58,138,0.04)' : 'white',
                                    border: 'none',
                                    borderBottom: '1px solid var(--enterprise-gray-100)',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    font: 'inherit',
                                }}
                                onMouseEnter={(e) => { if (!sel) e.currentTarget.style.background = 'var(--enterprise-gray-50)'; }}
                                onMouseLeave={(e) => { if (!sel) e.currentTarget.style.background = 'white'; }}
                            >
                                <div style={{
                                    width: 16, height: 16, borderRadius: 4,
                                    background: sel ? 'var(--enterprise-primary)' : 'white',
                                    border: `1.5px solid ${sel ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-300)'}`,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    {sel && <Check size={11} color="white" />}
                                </div>
                            <div>
                                <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--enterprise-gray-900)' }}>{p.pallet_number}</div>
                                <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginTop: 1 }}>Rack {p.location_code ?? '—'}</div>
                            </div>
                            <div style={{ fontSize: 12 }}>
                                <div style={{ color: 'var(--enterprise-gray-500)', fontSize: 10 }}>QTY</div>
                                <div style={{ fontWeight: 700, color: 'var(--enterprise-success)' }}>{Number(p.quantity).toLocaleString()}</div>
                            </div>
                            <div style={{ fontSize: 12 }}>
                                <div style={{ color: 'var(--enterprise-gray-500)', fontSize: 10 }}>PLACED</div>
                                <div style={{ color: 'var(--enterprise-gray-700)' }}>{p.placed_at ? new Date(p.placed_at).toLocaleDateString() : '—'}</div>
                            </div>
                            <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500)' }}>
                                {p.days_in_rack != null && `${p.days_in_rack}d in rack`}
                            </div>
                        </button>
                    );
                })}
            </div>
        )}
        </div>
    );
}

// ============================================================================
// Step 5 — Review & Submit
// ============================================================================

function Step5Review({ state, onSubmit, submitting, error }: {
    state: WizardState;
    onSubmit: (pallets: AvailablePallet[]) => void;
    submitting: boolean;
    error: string | null;
}) {
    // We need the pallet list to submit — fetch again for source of truth
    const [pallets, setPallets] = useState<AvailablePallet[]>([]);
    const [loading, setLoading] = useState(true);
    useEffect(() => {
        if (!state.bpa || !state.partNumber) return;
        (async () => {
            try {
                const r = await listAvailablePallets({ part_number: state.partNumber, agreement_id: state.bpa!.id, limit: 500 });
                setPallets(r.pallets);
            } finally {
                setLoading(false);
            }
        })();
    }, [state.bpa, state.partNumber]);

    const part = state.parts.find(p => p.part_number === state.partNumber);
    const unitPrice = Number(part?.unit_price ?? 0);
    const extendedPrice = state.requestedQuantity * unitPrice;
    const selectedPallets = pallets.filter(p => state.selectedPallets.has(p.pallet_id));
    const invoiceBreakdown = new Map<string, { qty: number; shipment_number: string | null }>();
    for (const [pid, qty] of state.selectedPallets) {
        const p = pallets.find(x => x.pallet_id === pid);
        if (!p) continue;
        const k = p.parent_invoice_number ?? '(unlinked)';
        const shipmentStr = p.shipment_number || p.packing_list_number || null;
        const prev = invoiceBreakdown.get(k) ?? { qty: 0, shipment_number: shipmentStr };
        invoiceBreakdown.set(k, { qty: prev.qty + qty, shipment_number: prev.shipment_number || shipmentStr });
    }

    const adjustment = state.adjustmentType;
    const customerAsk = state.customerRequestedQuantity;
    const adjusted = customerAsk > 0 && customerAsk !== state.requestedQuantity;

    const canPrint = !!state.bpa && !!part && selectedPallets.length > 0;
    const buildPrintData = () => ({
        bpa: state.bpa!,
        part: part!,
        releasePo: state.releasePo,
        orderDate: state.orderDate,
        needByDate: state.needByDate,
        buyerName: state.buyerName,
        customerRequestedQuantity: state.customerRequestedQuantity || state.requestedQuantity,
        requestedQuantity: state.requestedQuantity,
        adjustmentType: state.adjustmentType,
        pallets: selectedPallets,
    });

    return (
        <div style={{ maxWidth: 820 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <SectionTitle title="Review & Submit" subtitle="Final check before the release is created. Splits across parent invoices are highlighted." icon={<CheckCircle2 size={18} />} />
                {canPrint && (
                    <div style={{ display: 'flex', gap: 8, flexShrink: 0, marginTop: 4 }}>
                        <button
                            type="button"
                            onClick={() => printPickingList(buildPrintData())}
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: 'white', border: '1px solid #1e3a8a', color: '#1e3a8a', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                            title="Print warehouse picking list (Milan)"
                        >
                            <Printer size={14} /> Picking List
                        </button>
                        {adjusted && (
                            <button
                                type="button"
                                onClick={() => printAmendmentDraft(buildPrintData())}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 14px', background: adjustment === 'UP' ? '#fef3c7' : adjustment === 'DOWN' ? '#dbeafe' : '#f1f5f9', border: `1px solid ${adjustment === 'UP' ? '#d97706' : adjustment === 'DOWN' ? '#2563eb' : '#64748b'}`, color: adjustment === 'UP' ? '#92400e' : adjustment === 'DOWN' ? '#1e3a8a' : '#475569', borderRadius: 8, fontSize: 12, fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}
                                title="Print customer amendment draft for confirmation"
                            >
                                <Printer size={14} /> Amendment Draft
                            </button>
                        )}
                    </div>
                )}
            </div>

            {adjusted && (
                <div style={{
                    marginTop: 16, padding: '12px 16px',
                    background: adjustment === 'UP' ? '#fffbeb' : adjustment === 'DOWN' ? '#eff6ff' : '#f8fafc',
                    border: `1px solid ${adjustment === 'UP' ? '#fcd34d' : adjustment === 'DOWN' ? '#bfdbfe' : '#e2e8f0'}`,
                    borderRadius: 10, display: 'flex', alignItems: 'center', gap: 12,
                }}>
                    <AlertCircle size={16} color={adjustment === 'UP' ? '#d97706' : adjustment === 'DOWN' ? '#2563eb' : '#475569'} />
                    <div style={{ fontSize: 12.5, color: '#0f172a', flex: 1 }}>
                        <strong>Customer amendment required:</strong> customer asked <strong>{customerAsk.toLocaleString()}</strong> · this release will ship <strong>{state.requestedQuantity.toLocaleString()}</strong> pcs ({adjustment === 'UP' ? '+' : '−'}{Math.abs(state.requestedQuantity - customerAsk).toLocaleString()}). Send the customer the amended release for confirmation before dispatch.
                    </div>
                </div>
            )}

            <div style={{ marginTop: 22, background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 12, overflow: 'hidden' }}>
                <div style={{ padding: '16px 20px', background: 'linear-gradient(135deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.07) 100%)', borderBottom: '1px solid var(--enterprise-gray-200)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--enterprise-primary)', letterSpacing: '0.8px', textTransform: 'uppercase' }}>Blanket Release</div>
                            <div style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 800, color: 'var(--enterprise-gray-900)', marginTop: 2 }}>{state.releasePo}</div>
                        </div>
                        {adjusted && (
                            <span style={{ padding: '4px 10px', borderRadius: 999, background: adjustment === 'UP' ? '#fef3c7' : adjustment === 'DOWN' ? '#dbeafe' : '#f1f5f9', color: adjustment === 'UP' ? '#92400e' : adjustment === 'DOWN' ? '#1e3a8a' : '#475569', fontSize: 10, fontWeight: 800, letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                                {adjustment === 'UP' ? '▲ Amended Up' : adjustment === 'DOWN' ? '▼ Amended Down' : '✎ Manual'}
                            </span>
                        )}
                    </div>
                </div>

                <div style={{ padding: 20, display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
                    <KeyVal label="BPA"         value={state.bpa?.agreement_number ?? '—'} mono />
                    <KeyVal label="Revision"    value={String(state.bpa?.agreement_revision ?? 0)} />
                    <KeyVal label="Status"      value="DRAFT" />
                    <KeyVal label="Customer"    value={state.bpa?.customer_name ?? '—'} />
                    <KeyVal label="Buyer"       value={state.buyerName} />
                    <KeyVal label="Order Date"  value={new Date(state.orderDate).toLocaleDateString()} />
                    <KeyVal label="Need By"     value={state.needByDate ? new Date(state.needByDate).toLocaleDateString() : '—'} />
                    <KeyVal label="Part"        value={state.partNumber} mono />
                    <KeyVal label="MSN"         value={part?.msn_code ?? '—'} />
                    <KeyVal label={adjusted ? 'Customer Asked' : 'Quantity'}    value={(adjusted ? customerAsk : state.requestedQuantity).toLocaleString()} bold />
                    {adjusted && <KeyVal label="Releasing" value={`${state.requestedQuantity.toLocaleString()} pcs`} bold accent />}
                    {!adjusted && <KeyVal label="Unit Price"  value={`$${unitPrice.toFixed(4)}`} />}
                    <KeyVal label="Release Value" value={`$${extendedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} bold />
                </div>

                <div style={{ padding: '16px 20px', borderTop: '1px solid var(--enterprise-gray-200)', background: 'var(--enterprise-gray-50)' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--enterprise-gray-500)', letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 10 }}>
                        Pallet Allocation ({selectedPallets.length} pallet{selectedPallets.length !== 1 ? 's' : ''})
                    </div>
                    {invoiceBreakdown.size > 1 && (
                        <div style={{ padding: 10, background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: 6, fontSize: 12, color: '#1e3a8a', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Info size={14} /> This release draws from <strong>{invoiceBreakdown.size} parent invoices</strong>. Knock-off will be split per source.
                        </div>
                    )}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {Array.from(invoiceBreakdown.entries()).map(([inv, data]) => (
                            <div key={inv} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', fontSize: 13, padding: '12px 16px', background: 'white', borderRadius: 8, border: '1px solid var(--enterprise-gray-200)', alignItems: 'center' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <span style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Shipment Number</span>
                                    <span style={{ fontFamily: 'monospace', color: 'var(--enterprise-gray-900)', fontWeight: 600 }}>{data.shipment_number ?? '—'}</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    <span style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Invoice Number</span>
                                    <span style={{ fontFamily: 'monospace', color: 'var(--enterprise-gray-900)', fontWeight: 600 }}>{inv}</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end' }}>
                                    <span style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Release Qty</span>
                                    <span style={{ fontWeight: 800, color: 'var(--enterprise-primary)', fontSize: 14 }}>{data.qty.toLocaleString()} pcs</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {error && (
                <div style={{ marginTop: 14, padding: 12, background: '#fef2f2', borderLeft: '3px solid #dc2626', borderRadius: 6, color: '#991b1b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            <div style={{ marginTop: 20, display: 'flex', justifyContent: 'flex-end' }}>
                <button
                    onClick={() => onSubmit(pallets)}
                    disabled={submitting || loading}
                    style={{ ...primaryBtn, padding: '12px 28px', fontSize: 15, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}
                >
                    {submitting ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Submitting…</> : <><Check size={16} /> Submit Release</>}
                </button>
            </div>
        </div>
    );
}

// ============================================================================
// Mini UI helpers
// ============================================================================

function SectionTitle({ title, subtitle, icon }: { title: string; subtitle?: string; icon?: React.ReactNode }) {
    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, rgba(30,58,138,0.08) 0%, rgba(30,58,138,0.15) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--enterprise-primary)' }}>
                    {icon}
                </div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--enterprise-gray-900)' }}>{title}</h3>
            </div>
            {subtitle && <p style={{ margin: '8px 0 0 42px', fontSize: 13, color: 'var(--enterprise-gray-600)', lineHeight: 1.5 }}>{subtitle}</p>}
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

function KeyVal({ label, value, mono, bold, accent }: { label: string; value: string; mono?: boolean; bold?: boolean; accent?: boolean }) {
    return (
        <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</div>
            <div style={{
                fontSize: 13,
                fontWeight: bold ? 700 : 500,
                fontFamily: mono ? 'monospace' : 'inherit',
                color: accent ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-900)',
            }}>{value}</div>
        </div>
    );
}

function MiniStat({ label, value }: { label: string; value: string }) {
    return (
        <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--enterprise-gray-900)', marginTop: 2 }}>{value}</div>
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
const inputStyle: React.CSSProperties = {
    padding: '10px 12px', fontSize: 13, border: '1px solid var(--enterprise-gray-300)',
    borderRadius: 8, outline: 'none', background: 'white',
};
const primaryBtn: React.CSSProperties = {
    background: 'var(--enterprise-primary)', color: 'white', border: 'none',
    padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer',
};
const secondaryBtn: React.CSSProperties = {
    background: 'white', color: 'var(--enterprise-gray-700)',
    border: '1px solid var(--enterprise-gray-300)',
    padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer',
};
const ghostBtn: React.CSSProperties = {
    background: 'transparent', color: 'var(--enterprise-gray-600)', border: 'none',
    padding: '9px 14px', fontSize: 13, cursor: 'pointer',
};
