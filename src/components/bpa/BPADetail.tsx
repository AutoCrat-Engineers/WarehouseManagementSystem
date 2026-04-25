/**
 * BPADetail — Modal showing a single BPA with tabs:
 *    1. Overview    — agreement metadata, grouped
 *    2. Parts       — per-part config (drawing rev, pricing, stock rules)
 *    3. Fulfillment — qty progress per part
 *    4. Amendments  — BPA revision history (agreement-level)
 *
 * Revision terminology used throughout:
 *   • "BPA Rev"     — agreement-level revision, bumped by amendments
 *   • "Drawing Rev" — per-part drawing/spec revision supplied by customer
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
    X, FileText, List, Clock, Edit3, Upload, Download, ExternalLink,
    Calendar, User, Mail, Truck, DollarSign, Package, TrendingUp,
    RefreshCw, History, ChevronRight,
} from 'lucide-react';
import { Button } from '../ui/button';
import { LoadingSpinner } from '../ui/EnterpriseUI';
import { getBPA, uploadBPADocument, createBOFromBPA } from './bpaService';
import type { BPAGetResponse } from './bpaService';
import { BPAAmend } from './BPAAmend';

interface Props {
    agreementId: string;
    onClose: () => void;
    onAmended?: () => void;
    canAmend: boolean;
}

type Tab = 'overview' | 'parts' | 'fulfillment' | 'amendments';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtMoney = (n: number | null | undefined, cur = 'USD') => `${cur} ${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function BPADetail({ agreementId, onClose, onAmended, canAmend }: Props) {
    const [data, setData] = useState<BPAGetResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>('overview');
    const [showAmend, setShowAmend] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [activatingBO, setActivatingBO] = useState(false);

    const load = async () => {
        setLoading(true); setError(null);
        try {
            setData(await getBPA({ agreement_id: agreementId }));
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); /* eslint-disable-next-line */ }, [agreementId]);

    const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !data) return;
        setUploading(true);
        try {
            await uploadBPADocument(data.agreement.id, file);
            await load();
        } catch (err: any) {
            setError(err?.message ?? 'Upload failed');
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const handleActivateBO = async () => {
        if (!data) return;
        setActivatingBO(true);
        try {
            const res = await createBOFromBPA(data.agreement.id);
            alert(`Blanket Order ${res.blanket_order_number} ready. ${res.line_configs_created} new line config(s) created (${res.line_configs_existing} already existed).`);
        } catch (err: any) {
            setError(err?.message ?? 'Failed to create BO');
        } finally {
            setActivatingBO(false);
        }
    };

    // ── Summary KPIs ────────────────────────────────────────────────
    const kpis = useMemo(() => {
        if (!data) return null;
        const a = data.agreement;
        const totalBlanket = data.fulfillment.reduce((s, f) => s + f.blanket_quantity, 0);
        const totalDelivered = data.fulfillment.reduce((s, f) => s + f.delivered_quantity, 0);
        const overallPct = totalBlanket > 0 ? (totalDelivered / totalBlanket) * 100 : 0;
        const end = new Date(a.effective_end_date).getTime();
        const today = Date.now();
        const daysRemaining = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
        return { overallPct, daysRemaining, totalParts: data.parts.length };
    }, [data]);

    return (
        <div style={{
            position: 'fixed', inset: 0, background: 'rgba(15, 23, 42, 0.55)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(2px)', padding: '24px',
        }} onClick={onClose}>
            <div onClick={(e) => e.stopPropagation()} style={{
                width: '100%', maxWidth: '1180px', maxHeight: '92vh', overflow: 'hidden',
                background: 'var(--enterprise-surface, #fff)', borderRadius: '12px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)', display: 'flex', flexDirection: 'column',
            }}>
                {/* ── Hero Header ──────────────────────────────────── */}
                <HeroHeader data={data} loading={loading} onClose={onClose} />

                {error && (
                    <div style={{ padding: '12px 24px', background: '#fef2f2', color: '#991b1b', fontSize: '13px', borderBottom: '1px solid #fecaca' }}>
                        {error}
                    </div>
                )}

                {/* ── KPI Strip ─────────────────────────────────────── */}
                {data && kpis && <KpiStrip data={data} kpis={kpis} />}

                {/* ── Tabs ──────────────────────────────────────────── */}
                {data && (
                    <div style={{
                        padding: '0 24px', borderBottom: '1px solid var(--enterprise-gray-200, #e5e7eb)',
                        display: 'flex', gap: '4px', background: 'var(--enterprise-gray-50, #f9fafb)',
                    }}>
                        <TabButton active={tab === 'overview'}    onClick={() => setTab('overview')}    icon={<FileText size={14} />} label="Overview" />
                        <TabButton active={tab === 'parts'}       onClick={() => setTab('parts')}       icon={<List size={14} />}     label="Parts" count={data.parts.length} />
                        <TabButton active={tab === 'fulfillment'} onClick={() => setTab('fulfillment')} icon={<TrendingUp size={14} />} label="Fulfillment" />
                        <TabButton active={tab === 'amendments'}  onClick={() => setTab('amendments')}  icon={<History size={14} />} label="Amendments" count={data.revisions.length} />
                    </div>
                )}

                {/* ── Body ──────────────────────────────────────────── */}
                <div style={{ flex: 1, overflow: 'auto', background: '#fff' }}>
                    {loading && <div style={{ padding: 80, textAlign: 'center' }}><LoadingSpinner size={32} /></div>}
                    {data && (
                        <div style={{ padding: '24px' }}>
                            {tab === 'overview'    && <OverviewTab data={data} />}
                            {tab === 'parts'       && <PartsTab data={data} />}
                            {tab === 'fulfillment' && <FulfillmentTab data={data} />}
                            {tab === 'amendments'  && <AmendmentsTab data={data} />}
                        </div>
                    )}
                </div>

                {/* ── Action Bar ────────────────────────────────────── */}
                {data && (
                    <div style={{
                        padding: '14px 24px', borderTop: '1px solid var(--enterprise-gray-200, #e5e7eb)',
                        display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--enterprise-gray-50, #f9fafb)',
                    }}>
                        {canAmend && (
                            <Button variant="outline" onClick={() => setShowAmend(true)}>
                                <Edit3 size={14} style={{ marginRight: '6px' }} />Amend BPA
                            </Button>
                        )}
                        <Button variant="outline" onClick={handleActivateBO} disabled={activatingBO}>
                            <RefreshCw size={14} style={{ marginRight: '6px' }} />
                            {activatingBO ? 'Activating…' : 'Activate / Refresh BO'}
                        </Button>
                        <label style={fileButtonStyle}>
                            <Upload size={14} />
                            {uploading ? 'Uploading…' : 'Upload PDF'}
                            <input type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={handleUpload} disabled={uploading} />
                        </label>
                        {data.agreement.document_url && (
                            <a href={data.agreement.document_url} target="_blank" rel="noopener noreferrer" style={{ ...fileButtonStyle, textDecoration: 'none' }}>
                                <Download size={14} /> View Document
                            </a>
                        )}
                        <div style={{ flex: 1 }} />
                        <Button variant="outline" onClick={onClose}>Close</Button>
                    </div>
                )}
            </div>

            {showAmend && data && (
                <BPAAmend
                    agreement={data.agreement}
                    parts={data.parts}
                    onClose={() => setShowAmend(false)}
                    onAmended={() => { setShowAmend(false); onAmended?.(); }}
                />
            )}
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────
// Hero Header
// ──────────────────────────────────────────────────────────────────────
function HeroHeader({ data, loading, onClose }: { data: BPAGetResponse | null; loading: boolean; onClose: () => void }) {
    const a = data?.agreement;
    const statusTone: Record<string, { bg: string; fg: string }> = {
        ACTIVE:    { bg: '#d1fae5', fg: '#065f46' },
        AMENDED:   { bg: '#fef3c7', fg: '#92400e' },
        DRAFT:     { bg: '#e0e7ff', fg: '#3730a3' },
        EXPIRED:   { bg: '#fee2e2', fg: '#991b1b' },
        CANCELLED: { bg: '#f3f4f6', fg: '#4b5563' },
    };
    const tone = a ? statusTone[a.status] ?? statusTone.DRAFT : statusTone.DRAFT;

    return (
        <div style={{
            padding: '20px 24px', borderBottom: '1px solid var(--enterprise-gray-200, #e5e7eb)',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            background: 'linear-gradient(180deg, #fafbff 0%, #ffffff 100%)',
        }}>
            <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: '1.35rem', fontWeight: 700, margin: 0, color: 'var(--enterprise-gray-900, #111827)' }}>
                        {loading ? 'Loading…' : a?.agreement_number}
                    </h2>
                    {a && (
                        <>
                            {/* BPA Revision badge — explicitly labeled */}
                            <span title="Agreement-level revision, bumped on each amendment" style={{
                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                padding: '3px 10px', borderRadius: '999px',
                                background: '#eef2ff', color: '#4338ca',
                                fontSize: '11px', fontWeight: 600, letterSpacing: '0.02em',
                            }}>
                                <History size={11} /> BPA Rev {a.agreement_revision}
                            </span>
                            <span style={{
                                padding: '3px 10px', borderRadius: '999px',
                                background: tone.bg, color: tone.fg,
                                fontSize: '11px', fontWeight: 700, letterSpacing: '0.04em',
                            }}>
                                {a.status}
                            </span>
                            <span style={{ fontSize: '12px', color: 'var(--enterprise-gray-500, #6b7280)', fontWeight: 500 }}>
                                {a.agreement_type}
                            </span>
                        </>
                    )}
                </div>
                {a && (
                    <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-600, #4b5563)', margin: '6px 0 0' }}>
                        <span style={{ fontWeight: 600 }}>{a.customer_name}</span>
                        <span style={{ margin: '0 6px', color: 'var(--enterprise-gray-400)' }}>·</span>
                        <span>{a.customer_code}</span>
                        {a.agreement_title && (
                            <>
                                <span style={{ margin: '0 6px', color: 'var(--enterprise-gray-400)' }}>·</span>
                                <span>{a.agreement_title}</span>
                            </>
                        )}
                    </p>
                )}
            </div>
            <button onClick={onClose} aria-label="Close" style={{
                background: 'none', border: 'none', cursor: 'pointer',
                width: '32px', height: '32px', borderRadius: '6px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--enterprise-gray-500, #6b7280)',
            }}>
                <X size={20} />
            </button>
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────
// KPI Strip
// ──────────────────────────────────────────────────────────────────────
function KpiStrip({ data, kpis }: { data: BPAGetResponse; kpis: { overallPct: number; daysRemaining: number; totalParts: number } }) {
    const a = data.agreement;
    const progressColor = kpis.overallPct >= 80 ? '#16a34a' : kpis.overallPct >= 40 ? '#d97706' : '#6366f1';
    const daysColor = kpis.daysRemaining < 0 ? '#dc2626' : kpis.daysRemaining < 30 ? '#d97706' : '#16a34a';

    const Tile = ({ icon, label, value, sub, accent }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string }) => (
        <div style={{
            flex: 1, padding: '14px 16px',
            borderRight: '1px solid var(--enterprise-gray-200, #e5e7eb)',
            display: 'flex', flexDirection: 'column', gap: '4px', minWidth: 0,
        }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--enterprise-gray-500, #6b7280)', fontWeight: 600 }}>
                <span style={{ color: accent ?? 'var(--enterprise-gray-400)' }}>{icon}</span>
                {label}
            </div>
            <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--enterprise-gray-900, #111827)', lineHeight: 1.2 }}>
                {value}
            </div>
            {sub && <div style={{ fontSize: '11px', color: 'var(--enterprise-gray-500, #6b7280)' }}>{sub}</div>}
        </div>
    );

    return (
        <div style={{ display: 'flex', background: '#fff', borderBottom: '1px solid var(--enterprise-gray-200, #e5e7eb)' }}>
            <Tile icon={<DollarSign size={13} />} accent="#1e3a8a"
                label="Total Blanket Value"
                value={fmtMoney(a.total_blanket_value, a.currency_code)}
                sub={`${a.currency_code}`} />
            <Tile icon={<Package size={13} />} accent="#4338ca"
                label="Parts"
                value={kpis.totalParts}
                sub={`${a.total_parts} on agreement`} />
            <Tile icon={<TrendingUp size={13} />} accent={progressColor}
                label="Fulfillment"
                value={`${kpis.overallPct.toFixed(1)}%`}
                sub={
                    <div style={{ height: '4px', background: 'var(--enterprise-gray-200, #e5e7eb)', borderRadius: '2px', overflow: 'hidden', marginTop: '4px' }}>
                        <div style={{ width: `${Math.min(100, kpis.overallPct)}%`, height: '100%', background: progressColor, transition: 'width .3s' }} />
                    </div>
                } />
            <Tile icon={<Calendar size={13} />} accent={daysColor}
                label="Term"
                value={kpis.daysRemaining < 0 ? 'Expired' : `${kpis.daysRemaining} days`}
                sub={`Until ${fmtDate(a.effective_end_date)}`} />
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────
// Tab Button
// ──────────────────────────────────────────────────────────────────────
function TabButton({ active, onClick, icon, label, count }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; count?: number }) {
    return (
        <button onClick={onClick} style={{
            padding: '12px 16px', border: 'none', fontSize: '13px', fontWeight: 600,
            background: 'transparent',
            color: active ? 'var(--enterprise-primary, #1e3a8a)' : 'var(--enterprise-gray-600, #4b5563)',
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: '6px',
            borderBottom: active ? '2px solid var(--enterprise-primary, #1e3a8a)' : '2px solid transparent',
            marginBottom: '-1px', transition: 'color .15s',
        }}>
            {icon}{label}
            {count !== undefined && (
                <span style={{
                    padding: '1px 7px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
                    background: active ? 'var(--enterprise-primary, #1e3a8a)' : 'var(--enterprise-gray-200, #e5e7eb)',
                    color: active ? '#fff' : 'var(--enterprise-gray-700, #374151)',
                }}>{count}</span>
            )}
        </button>
    );
}

// ──────────────────────────────────────────────────────────────────────
// Overview Tab — grouped sections
// ──────────────────────────────────────────────────────────────────────
function OverviewTab({ data }: { data: BPAGetResponse }) {
    const a = data.agreement;

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '16px' }}>
            <Section title="Customer & Buyer" icon={<User size={14} />}>
                <Row label="Customer" value={<><div style={{ fontWeight: 600 }}>{a.customer_name}</div><div style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)' }}>{a.customer_code}</div></>} />
                <Row label="Buyer" value={a.buyer_name ?? '—'} />
                <Row label="Email" value={a.buyer_email ? <a href={`mailto:${a.buyer_email}`} style={linkStyle}><Mail size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />{a.buyer_email}</a> : '—'} />
                <Row label="Phone" value={a.buyer_phone ?? '—'} />
            </Section>

            <Section title="Timeline" icon={<Calendar size={14} />}>
                <Row label="Agreement Date" value={fmtDate(a.agreement_date)} />
                <Row label="Effective From" value={fmtDate(a.effective_start_date)} />
                <Row label="Effective Until" value={fmtDate(a.effective_end_date)} />
                <Row label="Last Updated" value={fmtDateTime(a.updated_at)} />
            </Section>

            <Section title="Commercial Terms" icon={<DollarSign size={14} />}>
                <Row label="Payment Terms" value={a.payment_terms ?? '—'} />
                <Row label="Incoterms" value={a.incoterms ?? '—'} />
                <Row label="Currency" value={a.currency_code} />
                <Row label="Ship Via" value={a.ship_via ? <><Truck size={12} style={{ marginRight: 4, verticalAlign: 'middle' }} />{a.ship_via}</> : '—'} />
                <Row label="Delivery Location" value={a.delivery_location ?? '—'} />
            </Section>

            <Section title="Totals" icon={<Package size={14} />}>
                <Row label="Total Parts" value={a.total_parts} />
                <Row label="Total Blanket Value" value={<span style={{ fontWeight: 700 }}>{fmtMoney(a.total_blanket_value, a.currency_code)}</span>} />
                <Row label="Agreement Value" value={a.agreement_value != null ? fmtMoney(a.agreement_value, a.currency_code) : '—'} />
                <Row label="BPA Revision" value={
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', background: '#eef2ff', color: '#4338ca', borderRadius: '4px', fontSize: '12px', fontWeight: 600 }}>
                        <History size={11} /> Rev {a.agreement_revision}
                    </span>
                } />
                <Row label="Source" value={<span style={{ textTransform: 'uppercase', fontSize: '11px', fontWeight: 600, color: 'var(--enterprise-gray-600)' }}>{a.source}</span>} />
            </Section>
        </div>
    );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <div style={{
            border: '1px solid var(--enterprise-gray-200, #e5e7eb)', borderRadius: '8px', background: '#fff', overflow: 'hidden',
        }}>
            <div style={{
                padding: '10px 14px', background: 'var(--enterprise-gray-50, #f9fafb)',
                borderBottom: '1px solid var(--enterprise-gray-200, #e5e7eb)',
                fontSize: '12px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                color: 'var(--enterprise-gray-700, #374151)',
                display: 'flex', alignItems: 'center', gap: '6px',
            }}>
                {icon}{title}
            </div>
            <div style={{ padding: '6px 14px' }}>{children}</div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '12px', padding: '8px 0', borderBottom: '1px dashed var(--enterprise-gray-100, #f3f4f6)', alignItems: 'start', fontSize: '13px' }}>
            <span style={{ color: 'var(--enterprise-gray-500, #6b7280)', fontWeight: 500 }}>{label}</span>
            <span style={{ color: 'var(--enterprise-gray-800, #1f2937)' }}>{value}</span>
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────
// Parts Tab
// ──────────────────────────────────────────────────────────────────────
function PartsTab({ data }: { data: BPAGetResponse }) {
    const byPn = new Map(data.fulfillment.map(r => [r.part_number, r]));
    const a = data.agreement;

    return (
        <div>
            <div style={{
                marginBottom: '12px', padding: '10px 14px', background: '#eff6ff', borderRadius: '6px',
                fontSize: '12px', color: '#1e40af', display: 'flex', alignItems: 'center', gap: '8px',
            }}>
                <FileText size={14} />
                <span><strong>Drawing Rev</strong> refers to the per-part engineering drawing revision supplied by the customer — distinct from the <strong>BPA Rev</strong> shown on the agreement header.</span>
            </div>

            <div style={{ overflowX: 'auto', border: '1px solid var(--enterprise-gray-200, #e5e7eb)', borderRadius: '8px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                    <thead>
                        <tr style={{ background: 'var(--enterprise-gray-50, #f9fafb)' }}>
                            <th style={th}>#</th>
                            <th style={th}>MSN</th>
                            <th style={th}>Part #</th>
                            <th style={th}>Drawing</th>
                            <th style={th} title="Customer-supplied drawing/spec revision">Drawing Rev</th>
                            <th style={{ ...th, textAlign: 'right' }}>Blanket Qty</th>
                            <th style={{ ...th, textAlign: 'right' }}>Unit Price</th>
                            <th style={{ ...th, textAlign: 'right' }}>Total</th>
                            <th style={{ ...th, textAlign: 'right' }} title="Release multiple">Rel Mult</th>
                            <th style={th} title="Min / Max warehouse stock">Min / Max</th>
                            <th style={{ ...th, textAlign: 'right' }} title="Avg monthly demand">Avg/Mo</th>
                            <th style={th}>Fulfillment</th>
                        </tr>
                    </thead>
                    <tbody>
                        {data.parts.map((p, idx) => {
                            const f = byPn.get(p.part_number);
                            const pct = f?.fulfillment_pct ?? 0;
                            const barColor = pct >= 80 ? '#16a34a' : pct >= 40 ? '#d97706' : '#6366f1';
                            return (
                                <tr key={p.id} style={{ background: idx % 2 === 0 ? '#fff' : '#fafbfc', borderTop: '1px solid var(--enterprise-gray-100, #f3f4f6)' }}>
                                    <td style={td}>{p.line_number}</td>
                                    <td style={{ ...td, fontWeight: 600, color: 'var(--enterprise-primary, #1e3a8a)' }}>
                                        {p.msn_code}
                                        {(p as any).source === 'MIGRATION_INFORMAL' && (
                                            <span title="Informal borrow — this part shipped on another BPA's paperwork; no blanket/price of its own"
                                                  style={{ marginLeft: 6, padding: '1px 6px', background: '#fef3c7', color: '#92400e', borderRadius: '4px', fontSize: '10px', fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase' }}>
                                                Informal
                                            </span>
                                        )}
                                    </td>
                                    <td style={td}>{p.part_number}</td>
                                    <td style={td}>{p.drawing_number}</td>
                                    <td style={td}>
                                        {p.drawing_revision ? (
                                            <span style={{ padding: '2px 8px', background: '#f3f4f6', color: '#374151', borderRadius: '4px', fontSize: '12px', fontWeight: 600, fontFamily: 'ui-monospace, monospace' }}>
                                                {p.drawing_revision}
                                            </span>
                                        ) : '—'}
                                    </td>
                                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.blanket_quantity != null ? Number(p.blanket_quantity).toLocaleString() : '—'}</td>
                                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.unit_price != null ? Number(p.unit_price).toFixed(2) : '—'}</td>
                                    <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{p.total_value != null ? fmtMoney(p.total_value, a.currency_code) : '—'}</td>
                                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.release_multiple ?? '—'}</td>
                                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{Number(p.min_warehouse_stock ?? 0).toLocaleString()} / {Number(p.max_warehouse_stock ?? 0).toLocaleString()}</td>
                                    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{p.avg_monthly_demand != null ? Number(p.avg_monthly_demand).toFixed(0) : '—'}</td>
                                    <td style={td}>
                                        {f ? (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: '110px' }}>
                                                <div style={{ flex: 1, height: '5px', background: 'var(--enterprise-gray-200)', borderRadius: '3px', overflow: 'hidden' }}>
                                                    <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: barColor }} />
                                                </div>
                                                <span style={{ fontSize: '11px', fontWeight: 600, minWidth: '36px', textAlign: 'right', color: barColor }}>{pct.toFixed(0)}%</span>
                                            </div>
                                        ) : '—'}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────
// Fulfillment Tab
// ──────────────────────────────────────────────────────────────────────
function FulfillmentTab({ data }: { data: BPAGetResponse }) {
    if (data.fulfillment.length === 0) {
        return (
            <div style={{ padding: 40, textAlign: 'center', border: '1px dashed var(--enterprise-gray-300)', borderRadius: '8px', background: '#fafbfc' }}>
                <Clock size={32} style={{ color: 'var(--enterprise-gray-400)', marginBottom: 8 }} />
                <p style={{ color: 'var(--enterprise-gray-600)', fontSize: '14px', margin: 0 }}>No fulfillment data yet.</p>
                <p style={{ color: 'var(--enterprise-gray-500)', fontSize: '12px', marginTop: 4 }}>Activate the BO from the footer to start tracking.</p>
            </div>
        );
    }
    return (
        <div style={{ overflowX: 'auto', border: '1px solid var(--enterprise-gray-200)', borderRadius: '8px' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                <thead>
                    <tr style={{ background: 'var(--enterprise-gray-50)' }}>
                        <th style={th}>MSN</th>
                        <th style={th}>Part #</th>
                        <th style={{ ...th, textAlign: 'right' }}>Blanket</th>
                        <th style={{ ...th, textAlign: 'right' }}>Released</th>
                        <th style={{ ...th, textAlign: 'right' }}>Shipped</th>
                        <th style={{ ...th, textAlign: 'right' }}>Delivered</th>
                        <th style={{ ...th, textAlign: 'right' }}>Pending</th>
                        <th style={{ ...th, textAlign: 'right' }}>In Rack</th>
                        <th style={{ ...th, minWidth: '170px' }}>Fulfillment</th>
                    </tr>
                </thead>
                <tbody>
                    {data.fulfillment.map((f, idx) => {
                        const pct = Number(f.fulfillment_pct ?? 0);
                        const barColor = pct >= 80 ? '#16a34a' : pct >= 40 ? '#d97706' : '#6366f1';
                        const pending = Number(f.pending_quantity ?? 0);
                        return (
                            <tr key={`${f.agreement_id}-${f.part_number}`} style={{ background: idx % 2 === 0 ? '#fff' : '#fafbfc', borderTop: '1px solid var(--enterprise-gray-100)' }}>
                                <td style={{ ...td, fontWeight: 600, color: 'var(--enterprise-primary)' }}>{f.msn_code}</td>
                                <td style={td}>{f.part_number}</td>
                                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(f.blanket_quantity ?? 0).toLocaleString()}</td>
                                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(f.released_quantity ?? 0).toLocaleString()}</td>
                                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(f.shipped_quantity ?? 0).toLocaleString()}</td>
                                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(f.delivered_quantity ?? 0).toLocaleString()}</td>
                                <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: pending > 0 ? '#d97706' : 'inherit' }}>{pending.toLocaleString()}</td>
                                <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{Number(f.pallets_in_rack ?? 0)} <span style={{ color: 'var(--enterprise-gray-500)', fontSize: '11px' }}>({Number(f.qty_in_rack ?? 0).toLocaleString()})</span></td>
                                <td style={td}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <div style={{ flex: 1, height: '6px', background: 'var(--enterprise-gray-200)', borderRadius: '3px', overflow: 'hidden' }}>
                                            <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: barColor, transition: 'width .3s' }} />
                                        </div>
                                        <span style={{ fontSize: '12px', fontWeight: 600, minWidth: '40px', textAlign: 'right', color: barColor }}>{pct.toFixed(0)}%</span>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────
// Amendments Tab
// ──────────────────────────────────────────────────────────────────────
function AmendmentsTab({ data }: { data: BPAGetResponse }) {
    if (data.revisions.length === 0) {
        return (
            <div style={{ padding: 40, textAlign: 'center', border: '1px dashed var(--enterprise-gray-300)', borderRadius: '8px', background: '#fafbfc' }}>
                <History size={32} style={{ color: 'var(--enterprise-gray-400)', marginBottom: 8 }} />
                <p style={{ color: 'var(--enterprise-gray-600)', fontSize: '14px', margin: 0 }}>No amendments yet.</p>
                <p style={{ color: 'var(--enterprise-gray-500)', fontSize: '12px', marginTop: 4 }}>This BPA is still at its original revision.</p>
            </div>
        );
    }

    // Sort newest first
    const sorted = [...data.revisions].sort((a, b) => b.revision_to - a.revision_to);

    return (
        <div>
            <div style={{
                marginBottom: '16px', padding: '10px 14px', background: '#fef9c3', borderRadius: '6px',
                fontSize: '12px', color: '#854d0e', display: 'flex', alignItems: 'center', gap: '8px',
            }}>
                <History size={14} />
                <span>These are <strong>BPA revisions</strong> (agreement-level amendments). Per-part <strong>drawing revisions</strong> are shown on the Parts tab.</span>
            </div>

            <div style={{ position: 'relative', paddingLeft: '24px' }}>
                {/* Timeline spine */}
                <div style={{ position: 'absolute', left: '9px', top: '8px', bottom: '8px', width: '2px', background: 'var(--enterprise-gray-200)' }} />

                {sorted.map((r) => {
                    const headerChanges = r.agreement_changes && Object.keys(r.agreement_changes).length;
                    const partChanges = Array.isArray(r.part_changes) ? r.part_changes.length : 0;
                    return (
                        <div key={r.id} style={{ position: 'relative', marginBottom: '14px' }}>
                            {/* Dot */}
                            <div style={{
                                position: 'absolute', left: '-20px', top: '14px',
                                width: '12px', height: '12px', borderRadius: '50%',
                                background: '#d97706', border: '2px solid #fff',
                                boxShadow: '0 0 0 2px #d97706',
                            }} />
                            <div style={{
                                border: '1px solid var(--enterprise-gray-200)', borderRadius: '8px',
                                background: '#fff', overflow: 'hidden',
                            }}>
                                <div style={{ padding: '12px 14px', background: '#fffbeb', borderBottom: '1px solid #fde68a', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                    <div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontSize: '13px', fontWeight: 700, color: '#1f2937' }}>
                                                BPA Amendment
                                            </span>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 8px', background: '#fef3c7', color: '#92400e', borderRadius: '4px', fontSize: '11px', fontWeight: 700 }}>
                                                Rev {r.revision_from} <ChevronRight size={11} /> Rev {r.revision_to}
                                            </span>
                                        </div>
                                        <p style={{ fontSize: '11px', color: 'var(--enterprise-gray-500)', margin: '3px 0 0' }}>
                                            {fmtDateTime(r.revision_date)}
                                        </p>
                                    </div>
                                    {r.amendment_document_url && (
                                        <a href={r.amendment_document_url} target="_blank" rel="noopener noreferrer" style={{ ...linkStyle, fontSize: '12px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
                                            <ExternalLink size={12} /> Amendment PDF
                                        </a>
                                    )}
                                </div>
                                <div style={{ padding: '12px 14px' }}>
                                    {r.revision_reason && (
                                        <p style={{ fontSize: '13px', margin: '0 0 10px', color: 'var(--enterprise-gray-700)', lineHeight: 1.5 }}>
                                            <span style={{ fontSize: '11px', textTransform: 'uppercase', color: 'var(--enterprise-gray-500)', fontWeight: 600, marginRight: 6 }}>Reason:</span>
                                            {r.revision_reason}
                                        </p>
                                    )}
                                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                        <ChangeChip label="Header changes" count={headerChanges || 0} />
                                        <ChangeChip label="Part changes" count={partChanges} />
                                    </div>
                                    <details>
                                        <summary style={{ cursor: 'pointer', fontSize: '12px', color: 'var(--enterprise-primary)', fontWeight: 600, padding: '4px 0' }}>
                                            View change details
                                        </summary>
                                        <div style={{ marginTop: '8px', display: 'grid', gap: '10px' }}>
                                            {headerChanges ? (
                                                <div>
                                                    <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--enterprise-gray-600)', marginBottom: '4px' }}>Header changes</div>
                                                    <pre style={preStyle}>{JSON.stringify(r.agreement_changes, null, 2)}</pre>
                                                </div>
                                            ) : null}
                                            {partChanges ? (
                                                <div>
                                                    <div style={{ fontSize: '11px', fontWeight: 700, textTransform: 'uppercase', color: 'var(--enterprise-gray-600)', marginBottom: '4px' }}>Part changes</div>
                                                    <pre style={preStyle}>{JSON.stringify(r.part_changes, null, 2)}</pre>
                                                </div>
                                            ) : null}
                                        </div>
                                    </details>
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

function ChangeChip({ label, count }: { label: string; count: number }) {
    const active = count > 0;
    return (
        <span style={{
            padding: '3px 10px', borderRadius: '999px', fontSize: '11px', fontWeight: 600,
            background: active ? '#eef2ff' : 'var(--enterprise-gray-100, #f3f4f6)',
            color: active ? '#4338ca' : 'var(--enterprise-gray-500, #6b7280)',
            border: `1px solid ${active ? '#c7d2fe' : 'var(--enterprise-gray-200, #e5e7eb)'}`,
        }}>
            {label}: {count}
        </span>
    );
}

// ──────────────────────────────────────────────────────────────────────
// Shared styles
// ──────────────────────────────────────────────────────────────────────
const th: React.CSSProperties = {
    padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.04em',
    color: 'var(--enterprise-gray-600, #4b5563)',
    borderBottom: '1px solid var(--enterprise-gray-200, #e5e7eb)',
    whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
    padding: '10px 12px', color: 'var(--enterprise-gray-800, #1f2937)', fontSize: '13px',
};

const fileButtonStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '6px',
    padding: '6px 14px', height: '36px',
    border: '1px solid var(--enterprise-gray-300, #d1d5db)', borderRadius: '6px',
    cursor: 'pointer', fontSize: '13px', fontWeight: 500,
    background: 'white', color: 'var(--enterprise-gray-700, #374151)',
};

const linkStyle: React.CSSProperties = {
    color: 'var(--enterprise-primary, #1e3a8a)', textDecoration: 'none', fontWeight: 500,
};

const preStyle: React.CSSProperties = {
    fontSize: '11px', background: 'var(--enterprise-gray-50, #f9fafb)',
    border: '1px solid var(--enterprise-gray-200, #e5e7eb)',
    padding: '10px', borderRadius: '6px', margin: 0, overflow: 'auto',
    maxHeight: '240px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};
