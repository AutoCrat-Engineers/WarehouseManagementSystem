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
import React, { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import {
    X, FileText, List, Clock, Edit3, Upload, Download, ExternalLink,
    Calendar, User, Mail, Truck, DollarSign, Package, TrendingUp,
    RefreshCw, History, ChevronRight, XCircle, AlertTriangle, Trash2,
    Plus, Hash, Clipboard, CheckCircle, Loader2,
} from 'lucide-react';
import { Button } from '../ui/button';
import { LoadingSpinner } from '../ui/EnterpriseUI';
import { getBPA, uploadBPADocument, createBOFromBPA, cancelBPA } from './bpaService';
import type { BPAGetResponse } from './bpaService';
import { BPAAmend } from './BPAAmend';
import type { AgreementStatus } from './types';
import { listReleases } from '../release/releaseService';
import type { BlanketRelease } from '../release/types';
import { CreateRelease } from '../release/CreateRelease';

interface Props {
    agreementId: string;
    onClose: () => void;
    onAmended?: () => void;
    onCancelled?: () => void;
    canAmend: boolean;
    initialTab?: Tab;
}

type Tab = 'overview' | 'parts' | 'fulfillment' | 'releases' | 'amendments';

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const fmtMoney = (n: number | null | undefined, cur = 'USD') => `${cur} ${Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export function BPADetail({ agreementId, onClose, onAmended, onCancelled, canAmend, initialTab }: Props) {
    const [data, setData] = useState<BPAGetResponse | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [tab, setTab] = useState<Tab>(initialTab ?? 'overview');
    const [showAmend, setShowAmend] = useState(false);
    const [showCancelConfirm, setShowCancelConfirm] = useState(false);
    const [uploading, setUploading] = useState(false);
    const [activatingBO, setActivatingBO] = useState(false);
    const [showCreateRelease, setShowCreateRelease] = useState(false);
    const [releaseCounts, setReleaseCounts] = useState<{ total: number; open: number; fulfilled: number; cancelled: number }>({ total: 0, open: 0, fulfilled: 0, cancelled: 0 });

    // Sliding tab state
    const [activeTabRect, setActiveTabRect] = useState<{ left: number, width: number } | null>(null);
    const tabsContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!tabsContainerRef.current) return;
        const activeBtn = tabsContainerRef.current.querySelector('[aria-selected="true"]') as HTMLElement;
        if (activeBtn) {
            setActiveTabRect({
                left: activeBtn.offsetLeft,
                width: activeBtn.offsetWidth,
            });
        }
    }, [tab, data]); // Re-run if data changes (e.g. counts load)

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

    // Fetch release counts for badge
    useEffect(() => {
        if (!agreementId) return;
        listReleases({ agreement_id: agreementId, page_size: 1 }).then(r => {
            // Use total_count (from the filtered main query) NOT counts.total (global)
            setReleaseCounts({
                total: r.total_count ?? 0,
                open: r.counts.open ?? 0,
                fulfilled: r.counts.fulfilled ?? 0,
                cancelled: r.counts.cancelled ?? 0,
            });
        }).catch(() => {});
    }, [agreementId, showCreateRelease]);

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
        <>
            <div style={{
                position: 'fixed', inset: 0, zIndex: 1000,
                background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(3px)',
                display: (showAmend || showCancelConfirm) ? 'none' : 'flex',
                alignItems: 'center', justifyContent: 'center',
                padding: '40px',
            }} onClick={onClose}>
                <div onClick={(e) => e.stopPropagation()} style={{
                    width: '100%', maxWidth: '1240px', maxHeight: '92vh', overflow: 'hidden',
                background: '#f8fafc', borderRadius: '24px',
                boxShadow: '0 0 0 1px rgba(255,255,255,0.1), 0 40px 80px -20px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column',
                position: 'relative',
            }}>
                {/* ── Hero Header ──────────────────────────────────── */}
                <HeroHeader data={data} loading={loading} onClose={onClose} />

                {error && (
                    <div style={{ padding: '12px 24px', background: '#fef2f2', color: '#991b1b', fontSize: '13px', borderBottom: '1px solid #fecaca' }}>
                        {error}
                    </div>
                )}

                {/* ── KPI Strip ─────────────────────────────────────── */}
                <div style={{ background: 'linear-gradient(180deg, #f0f4ff 0%, #f8fafc 100%)', padding: '0 32px 32px', position: 'relative' }}>
                    {data && kpis && <KpiStrip data={data} kpis={kpis} />}
                </div>

                {/* ── Tabs ──────────────────────────────────────────── */}
                {data && (
                    <div style={{ padding: '0 32px' }}>
                        <div 
                            ref={tabsContainerRef}
                            style={{ 
                                display: 'inline-flex', gap: '4px', padding: '6px', 
                                background: '#fff', border: '1px solid #e2e8f0', 
                                borderRadius: '999px', position: 'relative',
                                boxShadow: '0 2px 4px rgba(0,0,0,0.02)',
                                transform: 'translateY(16px)',
                                zIndex: 10
                            }}
                        >
                            {/* The Sliding Active Background */}
                            {activeTabRect && (
                                <div style={{
                                    position: 'absolute',
                                    top: '6px', bottom: '6px',
                                    left: activeTabRect.left,
                                    width: activeTabRect.width,
                                    background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)',
                                    borderRadius: '999px',
                                    transition: 'all 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)', // Bouncy spring feel
                                    boxShadow: '0 4px 12px rgba(30,58,138,0.25)'
                                }} />
                            )}
                            
                            <TabButton active={tab === 'overview'}    onClick={() => setTab('overview')}    icon={<FileText size={14} />} label="Overview" />
                            <TabButton active={tab === 'parts'}       onClick={() => setTab('parts')}       icon={<List size={14} />}     label="Parts" count={data.parts.length} />
                            <TabButton active={tab === 'fulfillment'} onClick={() => setTab('fulfillment')} icon={<TrendingUp size={14} />} label="Fulfillment" />
                            <TabButton active={tab === 'releases'}    onClick={() => setTab('releases')}    icon={<Truck size={14} />}   label="Releases" count={releaseCounts.total} />
                            <TabButton active={tab === 'amendments'}  onClick={() => setTab('amendments')}  icon={<History size={14} />} label="Amendments" count={data.revisions.length} />
                        </div>
                    </div>
                )}

                {/* ── Body ──────────────────────────────────────────── */}
                <div style={{ flex: 1, overflow: 'auto', background: '#f8fafc' }}>
                    {loading && <div style={{ padding: 80, textAlign: 'center' }}><LoadingSpinner size={32} /></div>}
                    {data && (
                        <div style={{ padding: '32px' }}>
                            {tab === 'overview'    && <OverviewTab data={data} />}
                            {tab === 'parts'       && <PartsTab data={data} />}
                            {tab === 'fulfillment' && <FulfillmentTab data={data} />}
                            {tab === 'releases'    && <ReleasesTab data={data} onNewRelease={() => setShowCreateRelease(true)} />}
                            {tab === 'amendments'  && <AmendmentsTab data={data} />}
                        </div>
                    )}
                </div>

                {/* ── Action Bar ────────────────────────────────────── */}
                {data && (
                    <div style={{
                        padding: '16px 32px', borderTop: '1px solid rgba(0,0,0,0.05)',
                        display: 'flex', alignItems: 'center', gap: '12px',
                        background: '#f8fafc',
                        position: 'sticky', bottom: 0, zIndex: 20,
                    }}>
                        {canAmend && (
                            <button 
                                onClick={() => setShowAmend(true)}
                                style={actionBtnStyle}
                                onMouseEnter={(e) => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.transform = 'none'; }}
                            >
                                <Edit3 size={16} /> Amend BPA
                            </button>
                        )}
                        <label 
                            style={actionBtnStyle}
                            onMouseEnter={(e) => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.transform = 'none'; }}
                        >
                            <Upload size={16} />
                            {uploading ? 'Uploading…' : 'Upload PDF'}
                            <input type="file" accept=".pdf,image/*" style={{ display: 'none' }} onChange={handleUpload} disabled={uploading} />
                        </label>
                        {data.agreement.document_url && (
                            <a 
                                href={data.agreement.document_url} target="_blank" rel="noopener noreferrer" 
                                style={{ ...actionBtnStyle, textDecoration: 'none' }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.transform = 'none'; }}
                            >
                                <ExternalLink size={16} /> View PDF
                            </a>
                        )}
                        {canAmend && (
                            <button 
                                onClick={() => setShowCancelConfirm(true)}
                                style={{ ...actionBtnStyle, color: '#ef4444', background: '#fef2f2' }}
                                onMouseEnter={(e) => { e.currentTarget.style.background = '#fee2e2'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.transform = 'none'; }}
                            >
                                <XCircle size={16} /> Cancel BPA
                            </button>
                        )}
                        <div style={{ flex: 1 }} />
                        <button 
                            onClick={onClose}
                            style={{ ...actionBtnStyle, color: '#475569' }}
                            onMouseEnter={(e) => { e.currentTarget.style.background = '#e2e8f0'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.background = '#f1f5f9'; e.currentTarget.style.transform = 'none'; }}
                        >
                            Close
                        </button>
                    </div>
                )}
            </div>
        </div>

            {showAmend && data && (
                <BPAAmend
                    agreement={data.agreement}
                    parts={data.parts}
                    onClose={() => setShowAmend(false)}
                    onAmended={() => { setShowAmend(false); onAmended?.(); }}
                />
            )}

            {showCancelConfirm && data && (
                <CancelConfirmModal
                    agreement={data.agreement}
                    onClose={() => setShowCancelConfirm(false)}
                    onConfirm={async (reason) => {
                        await cancelBPA(data.agreement.id, reason);
                        onCancelled?.();
                    }}
                />
            )}

            {showCreateRelease && data && (
                <CreateRelease
                    prefilledBpa={data.agreement}
                    prefilledParts={data.parts}
                    onClose={() => setShowCreateRelease(false)}
                    onCreated={() => { setShowCreateRelease(false); load(); }}
                />
            )}
        </>
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
            padding: '32px 32px 24px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
            background: 'linear-gradient(135deg, #f8fafc 0%, #f0f4ff 100%)',
            position: 'relative',
        }}>
            {/* Subtle light flair */}
            <div style={{ position: 'absolute', top: 0, right: 0, width: '300px', height: '100%', background: 'radial-gradient(circle at top right, rgba(59,130,246,0.1) 0%, rgba(255,255,255,0) 70%)', pointerEvents: 'none' }} />
            <div style={{ minWidth: 0, flex: 1, zIndex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap' }}>
                    <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0, color: '#0f172a', letterSpacing: '-0.02em' }}>
                        {loading ? 'Loading…' : (
                            <span style={{ fontFamily: 'Inter, system-ui, sans-serif' }}>
                                {a?.agreement_number}
                            </span>
                        )}
                    </h2>
                    {a && (
                        <>
                            {/* BPA Revision badge */}
                            <span title="Agreement-level revision, bumped on each amendment" style={{
                                display: 'inline-flex', alignItems: 'center', gap: '6px',
                                padding: '4px 12px', borderRadius: '8px',
                                background: '#e0e7ff', color: '#4338ca',
                                fontSize: '12px', fontWeight: 800, letterSpacing: '0.04em', border: '1px solid rgba(67,56,202,0.1)'
                            }}>
                                <History size={12} /> REV {a.agreement_revision}
                            </span>
                            <StatusChip status={a.status as any} />
                            <span style={{ fontSize: '12px', color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                {a.agreement_type}
                            </span>
                        </>
                    )}
                </div>
                {a && (
                    <p style={{ fontSize: '14px', color: '#475569', margin: '12px 0 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 600, color: '#0f172a' }}>{a.customer_name}</span>
                        <span style={{ color: '#cbd5e1' }}>•</span>
                        <span style={{ fontFamily: 'monospace', color: '#64748b', fontWeight: 500 }}>{a.customer_code}</span>
                        {a.agreement_title && (
                            <>
                                <span style={{ color: '#cbd5e1' }}>•</span>
                                <span style={{ color: '#475569', fontWeight: 500 }}>{a.agreement_title}</span>
                            </>
                        )}
                    </p>
                )}
            </div>
            <button onClick={onClose} aria-label="Close" style={{
                background: 'rgba(15,23,42,0.04)', border: '1px solid rgba(15,23,42,0.05)', cursor: 'pointer',
                width: '36px', height: '36px', borderRadius: '10px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: '#64748b', zIndex: 1,
                transition: 'all .2s ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = '#ef4444'; e.currentTarget.style.color = '#fff'; e.currentTarget.style.borderColor = '#ef4444'; e.currentTarget.style.transform = 'scale(1.05)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'rgba(15,23,42,0.04)'; e.currentTarget.style.color = '#64748b'; e.currentTarget.style.borderColor = 'rgba(15,23,42,0.05)'; e.currentTarget.style.transform = 'scale(1)'; }}
            >
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

    const Tile = ({ icon, label, value, sub, accent, glow }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: React.ReactNode; accent?: string; glow?: string }) => (
        <div style={{
            flex: 1, padding: '24px', position: 'relative',
            display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0,
            background: '#fff', borderRadius: '16px',
            boxShadow: '0 10px 30px -10px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.05)',
            border: '1px solid rgba(0,0,0,0.03)',
            overflow: 'hidden',
        }}>
            {/* Top accent glow */}
            <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '4px', background: glow ?? accent ?? 'var(--enterprise-primary)' }} />
            
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', textTransform: 'uppercase', letterSpacing: '0.08em', color: '#64748b', fontWeight: 700 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '8px', background: `${accent}15`, color: accent }}>
                    {icon}
                </div>
                {label}
            </div>
            <div style={{ fontSize: '28px', fontWeight: 800, color: '#0f172a', lineHeight: 1.1, fontFamily: 'Inter, system-ui, sans-serif', marginTop: '4px', letterSpacing: '-0.02em' }}>
                {value}
            </div>
            {sub && <div style={{ fontSize: '13px', color: '#64748b', fontWeight: 500 }}>{sub}</div>}
        </div>
    );

    return (
        <div style={{ display: 'flex', gap: '20px' }}>
            <Tile icon={<DollarSign size={16} />} accent="#3b82f6" glow="linear-gradient(90deg, #3b82f6, #60a5fa)"
                label="Total Blanket Value"
                value={fmtMoney(a.total_blanket_value, a.currency_code)}
                sub={`${a.currency_code}`} />
            <Tile icon={<Package size={16} />} accent="#8b5cf6" glow="linear-gradient(90deg, #8b5cf6, #a78bfa)"
                label="Parts"
                value={kpis.totalParts}
                sub={`${a.total_parts} on agreement`} />
            <Tile icon={<TrendingUp size={16} />} accent={progressColor} glow={`linear-gradient(90deg, ${progressColor}, ${progressColor}aa)`}
                label="Fulfillment"
                value={`${kpis.overallPct.toFixed(1)}%`}
                sub={
                    <div style={{ height: '6px', background: '#f1f5f9', borderRadius: '4px', overflow: 'hidden', marginTop: '6px' }}>
                        <div style={{ width: `${Math.min(100, kpis.overallPct)}%`, height: '100%', background: `linear-gradient(90deg, ${progressColor}, ${progressColor}dd)`, borderRadius: '4px', transition: 'width .6s cubic-bezier(0.4, 0, 0.2, 1)' }} />
                    </div>
                } />
            <Tile icon={<Calendar size={16} />} accent={daysColor} glow={`linear-gradient(90deg, ${daysColor}, ${daysColor}aa)`}
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
        <button 
            onClick={onClick} 
            aria-selected={active}
            style={{
                position: 'relative', zIndex: 1,
                padding: '10px 20px', border: 'none', fontSize: '14px', fontWeight: 600,
                background: 'transparent',
                color: active ? '#fff' : '#64748b',
                cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                borderRadius: '999px',
                transition: 'color 0.2s ease',
            }}
        >
            {icon}{label}
            {count !== undefined && (
                <span style={{
                    padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: 800,
                    background: active ? 'rgba(255,255,255,0.25)' : '#e2e8f0',
                    color: active ? '#fff' : '#475569',
                    transition: 'all 0.2s ease',
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
            <Section title="Customer Details" icon={<User size={14} />}>
                <Row label="Customer" value={<><div style={{ fontWeight: 600 }}>{a.customer_name}</div><div style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)' }}>{a.customer_code}</div></>} />
                <Row label="Buyer" value={a.buyer_name ?? '—'} />
                <Row label="Email" value={a.buyer_email ? <a href={`mailto:${a.buyer_email}`} style={linkStyle}>{a.buyer_email}</a> : '—'} />
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
                <Row label="Ship Via" value={a.ship_via ? <>{a.ship_via}</> : '—'} />
                <Row label="Delivery Location" value={a.delivery_location ?? '—'} />
            </Section>


        </div>
    );
}

function Section({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
    return (
        <div style={{
            background: '#fff', borderRadius: '16px', overflow: 'hidden',
            boxShadow: '0 4px 20px -10px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.02)',
            border: '1px solid rgba(0,0,0,0.04)',
        }}>
            <div style={{
                padding: '16px 20px', borderBottom: '1px solid rgba(0,0,0,0.04)',
                fontSize: '12px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em',
                color: '#0f172a',
                display: 'flex', alignItems: 'center', gap: '10px',
                background: '#fafafa'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', borderRadius: '8px', background: '#f1f5f9', color: '#64748b' }}>
                    {icon}
                </div>
                {title}
            </div>
            <div style={{ padding: '12px 20px' }}>{children}</div>
        </div>
    );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '16px', padding: '12px 0', borderBottom: '1px solid rgba(0,0,0,0.03)', alignItems: 'center', fontSize: '14px' }}>
            <span style={{ color: '#64748b', fontWeight: 600, fontSize: '13px' }}>{label}</span>
            <span style={{ color: '#0f172a', fontWeight: 500 }}>{value}</span>
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
                marginBottom: '12px', padding: '10px 14px', background: 'rgba(59,130,246,0.05)', borderRadius: '6px',
                fontSize: '12px', color: 'var(--enterprise-info, #3b82f6)', display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 500
            }}>
                <FileText size={14} />
                <span><strong>Drawing Rev</strong> refers to the per-part engineering drawing revision supplied by the customer — distinct from the <strong>BPA Rev</strong> shown on the agreement header.</span>
            </div>

            <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '16px', boxShadow: '0 4px 20px -10px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.04)' }}>
                {/* Parts Grid Header */}
                <div style={{ display: 'grid', gridTemplateColumns: '40px minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr)', gap: 8, padding: '16px 12px', background: '#fafafa', fontSize: 11, fontWeight: 800, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                    <div style={{ textAlign: 'center' }}>#</div>
                    <div style={{ textAlign: 'center' }}>MSN</div>
                    <div style={{ textAlign: 'center' }}>Part #</div>
                    <div style={{ textAlign: 'center' }} title="Customer-supplied drawing/spec revision">Draw Rev</div>
                    <div style={{ textAlign: 'center' }}>Blanket Qty</div>
                    <div style={{ textAlign: 'center' }}>Unit Price ({a.currency_code})</div>
                    <div style={{ textAlign: 'center' }}>Total Price ({a.currency_code})</div>
                    <div style={{ textAlign: 'center' }} title="Release multiple">Rel Mult</div>
                    <div style={{ textAlign: 'center' }} title="Min / Max warehouse stock">Min / Max</div>
                    <div style={{ textAlign: 'center' }} title="Avg monthly demand">Avg/Mo</div>
                    <div style={{ textAlign: 'center' }}>Fulfillment</div>
                </div>
                {/* Parts Grid Rows */}
                {data.parts.map((p, idx) => {
                    const f = byPn.get(p.part_number);
                    const pct = f?.fulfillment_pct ?? 0;
                    const barColor = pct >= 80 ? '#16a34a' : pct >= 40 ? '#f59e0b' : '#3b82f6';
                    return (
                        <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '40px minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr)', gap: 8, padding: '12px', background: idx % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid rgba(0,0,0,0.03)', alignItems: 'center', transition: 'background .2s', cursor: 'default' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'} onMouseLeave={(e) => e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#f8fafc'}>
                            <div style={{ textAlign: 'center', fontSize: 13, color: '#94a3b8', fontWeight: 600 }}>{p.line_number}</div>
                            <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                                {p.msn_code}
                                {(p as any).source === 'MIGRATION_INFORMAL' && (
                                    <span title="Informal borrow — this part shipped on another BPA's paperwork; no blanket/price of its own"
                                            style={{ marginLeft: 6, padding: '2px 8px', background: '#fef3c7', color: '#b45309', borderRadius: '6px', fontSize: '10px', fontWeight: 800, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                                        Informal
                                    </span>
                                )}
                            </div>
                            <div style={{ textAlign: 'center', fontSize: 14, color: '#475569', fontWeight: 500 }}>{p.part_number}</div>
                            <div style={{ textAlign: 'center' }}>
                                {p.drawing_revision ? (
                                    <span style={{ padding: '4px 10px', background: '#f1f5f9', color: '#475569', borderRadius: '6px', fontSize: '12px', fontWeight: 700, fontFamily: 'monospace' }}>
                                        {p.drawing_revision}
                                    </span>
                                ) : '—'}
                            </div>
                            <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: '#0f172a' }}>{p.blanket_quantity != null ? Number(p.blanket_quantity).toLocaleString() : '—'}</div>
                            <div style={{ textAlign: 'center', fontSize: 14, fontFamily: 'monospace', color: '#475569' }}>{p.unit_price != null ? '$' + Number(p.unit_price).toFixed(2) : '—'}</div>
                            <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: '#0f172a' }}>{p.total_value != null ? '$' + Number(p.total_value).toLocaleString() : '—'}</div>
                            <div style={{ textAlign: 'center', fontSize: 14, fontFamily: 'monospace', color: '#475569' }}>{p.release_multiple ?? '—'}</div>
                            <div style={{ textAlign: 'center', fontSize: 14, fontFamily: 'monospace', color: '#475569' }}>{Number(p.min_warehouse_stock ?? 0).toLocaleString()} / {Number(p.max_warehouse_stock ?? 0).toLocaleString()}</div>
                            <div style={{ textAlign: 'center', fontSize: 14, fontFamily: 'monospace', color: '#475569' }}>{p.avg_monthly_demand != null ? Number(p.avg_monthly_demand).toFixed(0) : '—'}</div>
                            <div style={{ textAlign: 'center' }}>
                                {f ? (
                                    <span style={{ fontSize: '13px', fontWeight: 800, color: pct === 100 ? '#16a34a' : '#475569' }}>{pct.toFixed(0)}%</span>
                                ) : (
                                    <span style={{ color: '#cbd5e1' }}>—</span>
                                )}
                            </div>
                        </div>
                    );
                })}
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
        <div style={{ overflowX: 'auto', background: '#fff', borderRadius: '16px', boxShadow: '0 4px 20px -10px rgba(0,0,0,0.05), 0 1px 3px rgba(0,0,0,0.02)', border: '1px solid rgba(0,0,0,0.04)' }}>
            {/* Fulfillment Header */}
            <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 8, padding: '16px 12px', background: '#fafafa', fontSize: 11, fontWeight: 800, color: '#475569', letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid rgba(0,0,0,0.05)' }}>
                <div style={{ textAlign: 'center' }}>Shipped</div>
                <div style={{ textAlign: 'center' }}>Released</div>
                <div style={{ textAlign: 'center' }}>Delivered</div>
                <div style={{ textAlign: 'center' }}>Pending</div>
                <div style={{ textAlign: 'center' }}>MSN</div>
                <div style={{ textAlign: 'center' }}>Part #</div>
                <div style={{ textAlign: 'center' }}>Blanket</div>
                <div style={{ textAlign: 'center' }}>In Rack</div>
                <div style={{ textAlign: 'center' }}>Fulfillment</div>
            </div>
            {/* Fulfillment Rows */}
            {data.fulfillment.map((f, idx) => {
                const pct = Number(f.fulfillment_pct ?? 0);
                const barColor = pct >= 80 ? '#16a34a' : pct >= 40 ? '#f59e0b' : '#3b82f6';
                const pending = Number(f.pending_quantity ?? 0);
                const done = pct === 100;
                return (
                    <div key={`${f.agreement_id}-${f.part_number}`} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1.2fr) minmax(0, 1.2fr) minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 8, padding: '12px', background: idx % 2 === 0 ? '#fff' : '#f8fafc', borderBottom: '1px solid rgba(0,0,0,0.03)', alignItems: 'center', transition: 'background .2s', cursor: 'default' }} onMouseEnter={(e) => e.currentTarget.style.background = '#f1f5f9'} onMouseLeave={(e) => e.currentTarget.style.background = idx % 2 === 0 ? '#fff' : '#f8fafc'}>
                        <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, fontFamily: 'monospace', color: '#64748b' }}>{Number(f.shipped_quantity ?? 0).toLocaleString()}</div>
                        <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 600, fontFamily: 'monospace', color: '#64748b' }}>{Number(f.released_quantity ?? 0).toLocaleString()}</div>
                        <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: '#16a34a' }}>{Number(f.delivered_quantity ?? 0).toLocaleString()}</div>
                        <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: pending > 0 ? '#f59e0b' : '#94a3b8' }}>{pending.toLocaleString()}</div>
                        <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#0f172a' }}>{f.msn_code}</div>
                        <div style={{ textAlign: 'center', fontSize: 14, color: '#475569', fontWeight: 500 }}>{f.part_number}</div>
                        <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: '#0f172a' }}>{Number(f.blanket_quantity ?? 0).toLocaleString()}</div>
                        <div style={{ textAlign: 'center', fontSize: 14, fontFamily: 'monospace', color: '#475569', fontWeight: 600 }}>
                            {Number(f.pallets_in_rack ?? 0)} <span style={{ color: '#94a3b8', fontSize: '12px', fontWeight: 500 }}>({Number(f.qty_in_rack ?? 0).toLocaleString()})</span>
                        </div>
                        <div style={{ textAlign: 'center' }}>
                            <span style={{ fontSize: '13px', fontWeight: 800, color: done ? '#16a34a' : '#475569' }}>{pct.toFixed(0)}%</span>
                        </div>
                    </div>
                );
            })}
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
                marginBottom: '16px', padding: '12px 16px', background: 'linear-gradient(135deg, #fef9c3 0%, #fef08a 100%)', borderRadius: '8px',
                fontSize: '12px', color: '#854d0e', display: 'flex', alignItems: 'center', gap: '10px',
                boxShadow: '0 2px 4px rgba(0,0,0,0.02)', border: '1px solid #fde047'
            }}>
                <History size={16} />
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
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', padding: '2px 10px', background: 'linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)', color: '#fff', borderRadius: '6px', fontSize: '11px', fontWeight: 800, boxShadow: '0 2px 6px rgba(59,130,246,0.25)' }}>
                                                Rev {r.revision_from} <ChevronRight size={11} strokeWidth={3} /> Rev {r.revision_to}
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
                                        <div style={{ marginTop: '8px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                            {headerChanges ? (
                                                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                                                    <div style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: '#475569', marginBottom: '8px', letterSpacing: '0.05em' }}>Header changes</div>
                                                    <div style={{ display: 'grid', gap: '8px' }}>
                                                        {Object.entries(r.agreement_changes as Record<string, unknown>).map(([k, v]) => (
                                                            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px' }}>
                                                                <span style={{ fontWeight: 600, color: '#64748b', textTransform: 'uppercase', fontSize: '11px', width: '140px' }}>{k.replace(/_/g, ' ')}</span>
                                                                <span style={{ color: '#0f172a', fontWeight: 500 }}>
                                                                    {typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
                                                                </span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ) : null}
                                            {partChanges ? (
                                                <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px' }}>
                                                    <div style={{ fontSize: '11px', fontWeight: 800, textTransform: 'uppercase', color: '#475569', marginBottom: '8px', letterSpacing: '0.05em' }}>Part changes</div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                        {(r.part_changes as Array<any>).map((pc, idx) => {
                                                            // Handle { new: {...}, old: {...} } format or flat format
                                                            const data = pc.new || pc;
                                                            const partNum = data.part_number || `Item ${idx + 1}`;
                                                            return (
                                                                <div key={idx} style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: '6px', padding: '10px' }}>
                                                                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e3a8a', marginBottom: '6px' }}>Part {partNum}</div>
                                                                    <div style={{ display: 'grid', gap: '6px' }}>
                                                                        {Object.entries(data).filter(([k]) => k !== 'part_number').map(([k, v]) => (
                                                                            <div key={k} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px' }}>
                                                                                <span style={{ fontWeight: 600, color: '#64748b', textTransform: 'uppercase', fontSize: '10px', width: '140px' }}>{k.replace(/_/g, ' ')}</span>
                                                                                <span style={{ color: '#0f172a', fontWeight: 500, background: '#f1f5f9', padding: '2px 6px', borderRadius: '4px' }}>
                                                                                    {typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}
                                                                                </span>
                                                                            </div>
                                                                        ))}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
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

const STATUS_COLORS: Record<string, string> = {
    ACTIVE: '#16a34a',
    AMENDED: '#d97706',
    DRAFT: '#6366f1',
    EXPIRED: '#6b7280',
    CANCELLED: '#dc2626',
};
const STATUS_BG: Record<string, string> = {
    ACTIVE: '#dcfce7',
    AMENDED: '#fef3c7',
    DRAFT: '#e0e7ff',
    EXPIRED: '#f3f4f6',
    CANCELLED: '#fee2e2',
};

function StatusChip({ status }: { status: AgreementStatus }) {
    return (
        <div style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
            padding: '4px 0', borderRadius: 10, width: 72, textAlign: 'center', display: 'inline-block',
            color: STATUS_COLORS[status] ?? '#374151',
            background: STATUS_BG[status] ?? '#f3f4f6',
        }}>{status}</div>
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

const actionBtnStyle: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '8px',
    padding: '10px 20px', height: '42px',
    border: 'none', borderRadius: '8px',
    cursor: 'pointer', fontSize: '14px', fontWeight: 600,
    background: '#f1f5f9', color: '#334155',
    transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
};

const linkStyle: React.CSSProperties = {
    color: 'var(--enterprise-primary, #1e3a8a)', textDecoration: 'none', fontWeight: 500,
};

// ──────────────────────────────────────────────────────────────────────
// Cancel Confirmation Modal
// ──────────────────────────────────────────────────────────────────────
function CancelConfirmModal({ agreement, onClose, onConfirm }: { agreement: any, onClose: () => void, onConfirm: (reason: string) => Promise<void> }) {
    const [confirmText, setConfirmText] = useState('');
    const [reason, setReason] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const isMatch = confirmText === agreement.agreement_number;
    const isValid = isMatch && reason.trim().length > 0;

    const handleSubmit = async () => {
        if (!isValid) return;
        setLoading(true); setError(null);
        try {
            await onConfirm(reason);
        } catch (e: any) {
            setError(e.message ?? 'Failed to cancel agreement');
            setLoading(false);
        }
    };

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 3000, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(15, 23, 42, 0.4)', backdropFilter: 'blur(3px)' }} onClick={onClose}>
            <div style={{ width: '520px', background: '#fff', borderRadius: '16px', boxShadow: '0 20px 40px rgba(0,0,0,0.2)', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
                <div style={{ padding: '24px', borderBottom: '1px solid #e2e8f0' }}>
                    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: '#0f172a' }}>Confirm Item Deletion</h2>
                </div>
                
                <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    {/* Warning Box */}
                    <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '8px', padding: '16px', display: 'flex', gap: '16px' }}>
                        <AlertTriangle color="#ef4444" size={24} strokeWidth={2} style={{ flexShrink: 0, marginTop: '2px' }} />
                        <div>
                            <div style={{ color: '#dc2626', fontWeight: 700, fontSize: '15px', marginBottom: '8px' }}>This action cannot be undone</div>
                            <div style={{ color: '#7f1d1d', fontSize: '14px', lineHeight: 1.5 }}>You will not be able to process any new Blanket Orders or fulfillments against this agreement once it is cancelled.</div>
                        </div>
                    </div>

                    {/* Info Box */}
                    <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '16px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Agreement Number</div>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#1e3a8a', marginTop: '4px', fontFamily: 'monospace' }}>{agreement.agreement_number}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Customer</div>
                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a', marginTop: '4px' }}>{agreement.customer_name}</div>
                        </div>
                    </div>

                    {/* Inputs */}
                    <div>
                        <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>
                            Type Agreement Number to Confirm <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <input 
                            value={confirmText} onChange={e => setConfirmText(e.target.value)}
                            placeholder={`Enter "${agreement.agreement_number}" to confirm`}
                            style={{ width: '100%', padding: '12px 16px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '15px', outline: 'none', boxSizing: 'border-box' }}
                        />
                    </div>

                    <div>
                        <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: '#334155', marginBottom: '8px' }}>
                            Reason for Cancellation <span style={{ color: '#ef4444' }}>*</span>
                        </label>
                        <textarea 
                            value={reason} onChange={e => setReason(e.target.value)}
                            placeholder="Please provide the reason..."
                            rows={3}
                            style={{ width: '100%', padding: '12px 16px', border: '1px solid #cbd5e1', borderRadius: '8px', fontSize: '15px', outline: 'none', resize: 'vertical', boxSizing: 'border-box', fontFamily: 'inherit' }}
                        />
                    </div>

                    {error && <div style={{ color: '#dc2626', fontSize: '14px', fontWeight: 500 }}>{error}</div>}
                </div>

                <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#fff', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px' }}>
                    <button 
                        onClick={onClose} 
                        style={{ padding: '10px 20px', borderRadius: '8px', background: '#f1f5f9', color: '#0f172a', fontWeight: 600, fontSize: '14px', border: 'none', cursor: 'pointer', transition: 'background 0.2s' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#e2e8f0'}
                        onMouseLeave={e => e.currentTarget.style.background = '#f1f5f9'}
                    >
                        Cancel
                    </button>
                    <button 
                        onClick={handleSubmit} disabled={!isValid || loading}
                        style={{ 
                            padding: '10px 20px', borderRadius: '8px', 
                            background: isValid ? '#f87171' : '#fca5a5', 
                            color: '#fff', fontWeight: 600, fontSize: '14px', border: 'none', 
                            cursor: isValid ? 'pointer' : 'not-allowed',
                            display: 'flex', alignItems: 'center', gap: '8px',
                            transition: 'background 0.2s'
                        }}
                    >
                        <Trash2 size={16} />
                        {loading ? 'Cancelling...' : 'Cancel BPA'}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ──────────────────────────────────────────────────────────────────────
// Releases Tab — embedded release list scoped to this BPA
// ──────────────────────────────────────────────────────────────────────

function ReleasesTab({ data, onNewRelease }: { data: BPAGetResponse; onNewRelease: () => void }) {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rows, setRows] = useState<BlanketRelease[]>([]);

    const fetchReleases = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const r = await listReleases({ agreement_id: data.agreement.id, status_filter: 'ALL', page_size: 200 });
            setRows(r.releases);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load releases');
        } finally {
            setLoading(false);
        }
    }, [data.agreement.id]);

    useEffect(() => { fetchReleases(); }, [fetchReleases]);

    if (loading && rows.length === 0) {
        return <div style={{ padding: 60, textAlign: 'center' }}><LoadingSpinner size={28} /><p style={{ marginTop: 12, fontSize: 13, color: '#64748b' }}>Loading releases…</p></div>;
    }

    return (
        <div>
            {/* Action Bar */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 16, gap: 8 }}>
                <button onClick={fetchReleases} style={{ padding: '6px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600, border: '1px solid #e2e8f0', background: '#fff', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <RefreshCw size={13} style={loading ? { animation: 'spin 1s linear infinite' } : {}} /> Refresh
                </button>
                <button onClick={onNewRelease}
                    style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700, border: 'none', background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 8px rgba(30,58,138,0.25)' }}
                >
                    <Plus size={14} /> New Release
                </button>
            </div>

            {error && <div style={{ padding: 12, background: '#fef2f2', borderLeft: '3px solid #dc2626', borderRadius: 8, color: '#991b1b', fontSize: 13, marginBottom: 14 }}>{error}</div>}

            {rows.length === 0 ? (
                <div style={{ padding: 60, textAlign: 'center', border: '1px dashed #cbd5e1', borderRadius: 12, background: '#fafbfc' }}>
                    <Truck size={32} style={{ color: '#94a3b8', marginBottom: 8 }} />
                    <p style={{ color: '#64748b', fontSize: 14, fontWeight: 500, margin: 0 }}>No releases yet for this BPA.</p>
                    <p style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>Click "New Release" to create one.</p>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {rows.map(r => <EmbeddedReleaseCard key={r.id} release={r} />)}
                </div>
            )}
        </div>
    );
}

function EmbeddedReleaseCard({ release: r }: { release: BlanketRelease }) {
    const [expanded, setExpanded] = useState(false);
    const fulfilled = r.status === 'FULFILLED';
    const cancelled = r.status === 'CANCELLED';
    const accent = fulfilled ? '#16a34a' : cancelled ? '#6b7280' : '#2563eb';
    const statusLabel = fulfilled ? 'Completed' : cancelled ? 'Cancelled' : 'Drafted';
    const statusBg = fulfilled ? '#dcfce7' : cancelled ? '#f3f4f6' : '#dbeafe';

    return (
        <div style={{
            border: expanded ? `1.5px solid ${accent}` : '1px solid #e2e8f0',
            borderRadius: 12, overflow: 'hidden', background: '#fff',
            boxShadow: expanded ? '0 6px 18px rgba(30,58,138,0.08)' : '0 1px 2px rgba(0,0,0,0.03)',
            transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
            opacity: cancelled ? 0.75 : 1,
        }}>
            <div onClick={() => setExpanded(v => !v)} style={{ display: 'flex', cursor: 'pointer', transition: 'background 0.2s ease', background: expanded ? 'linear-gradient(135deg, rgba(30,58,138,0.02) 0%, rgba(30,58,138,0.06) 100%)' : '#fff' }}>
                {/* Chevron strip */}
                <div style={{ width: 36, minWidth: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid #f1f5f9', background: expanded ? accent : '#f8fafc', transition: 'all 0.2s ease' }}>
                    <ChevronRight size={15} style={{ color: expanded ? '#fff' : '#94a3b8', transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.25s ease' }} />
                </div>

                {/* Content */}
                <div style={{ flex: 1, padding: '12px 16px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 0.8fr 0.6fr', gap: 14, marginBottom: 8 }}>
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>Release #</div>
                            <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 13, color: accent }}>{r.release_number}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>Part</div>
                            <div style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 13, color: '#1e40af' }}>{r.part_number ?? '—'}
                                {r.msn_code && <span style={{ color: '#64748b', fontSize: 11, marginLeft: 4 }}>({r.msn_code})</span>}
                            </div>
                        </div>
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>Buyer</div>
                            <div style={{ fontSize: 13, color: '#334155' }}>{r.buyer_name ?? '—'}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>Qty</div>
                            <div style={{ fontWeight: 700, fontSize: 13, color: '#16a34a' }}>{Number(r.requested_quantity).toLocaleString()}</div>
                        </div>
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>Status</div>
                            <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, background: statusBg, color: accent }}>{statusLabel}</span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', gap: 20, fontSize: 11, color: '#94a3b8' }}>
                        <span>PO: <span style={{ color: '#475569', fontFamily: 'monospace' }}>{r.customer_po_base ?? '—'}</span></span>
                        <span>Need By: <span style={{ color: '#475569' }}>{r.need_by_date ? fmtDate(r.need_by_date) : '—'}</span></span>
                        <span>Created: <span style={{ color: '#475569' }}>{fmtDate(r.created_at)}</span></span>
                        {r.sub_invoice_number && <span>Sub-Inv: <span style={{ color: '#1e40af', fontFamily: 'monospace' }}>{r.sub_invoice_number}</span></span>}
                    </div>
                </div>
            </div>

            {expanded && (
                <div style={{ background: 'linear-gradient(180deg, rgba(30,58,138,0.02) 0%, rgba(30,58,138,0.01) 100%)', borderTop: '1px solid #e2e8f0', padding: '14px 52px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 14 }}>
                        <ReleaseDetailCard label="Release Sequence" value={r.release_sequence != null ? String(r.release_sequence) : '—'} />
                        <ReleaseDetailCard label="Sub-Invoice #" value={r.sub_invoice_number ?? '—'} mono />
                        <ReleaseDetailCard label="Pallets" value={r.sub_invoice_pallets != null ? String(r.sub_invoice_pallets) : '—'} />
                    </div>
                    {r.sub_invoice_lines && r.sub_invoice_lines.length > 0 && (
                        <div>
                            <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
                                Released Against {r.sub_invoice_lines.length === 1 ? 'Parent Invoice' : `${r.sub_invoice_lines.length} Parent Invoices`}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                                {r.sub_invoice_lines.map((l, i) => (
                                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr', gap: 10, alignItems: 'center', padding: '8px 12px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                                        <div><div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>PARENT INVOICE</div><span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 12 }}>{l.parent_invoice_number ?? '—'}</span></div>
                                        <div><div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>PART</div><span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: '#1e40af' }}>{l.part_number}</span></div>
                                        <div><div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>QTY</div><span style={{ fontWeight: 700, fontSize: 12, color: '#16a34a' }}>{Number(l.quantity).toLocaleString()}</span></div>
                                        <div><div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>PALLETS</div><span style={{ fontWeight: 600, fontSize: 12 }}>{l.pallet_count}</span></div>
                                        <div><div style={{ fontSize: 10, color: '#94a3b8', marginBottom: 2 }}>UNIT PRICE</div><span style={{ fontSize: 12, color: '#475569' }}>${Number(l.unit_price ?? 0).toFixed(4)}</span></div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                    {r.notes && (
                        <div style={{ marginTop: 12, padding: '10px 12px', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                            <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>Notes</div>
                            <p style={{ fontSize: 13, color: '#334155', lineHeight: 1.5, margin: 0 }}>{r.notes}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function ReleaseDetailCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 8, padding: '8px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</div>
        </div>
    );
}

const preStyle: React.CSSProperties = {
    fontSize: '11px', background: 'var(--enterprise-gray-50, #f9fafb)',
    border: '1px solid var(--enterprise-gray-200, #e5e7eb)',
    padding: '10px', borderRadius: '6px', margin: 0, overflow: 'auto',
    maxHeight: '240px', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
};
