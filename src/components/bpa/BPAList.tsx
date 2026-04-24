/**
 * BPAList — Customer Agreement (BPA) list page.
 *
 * Modern contract-management surface:
 *   • Portfolio Strip — 4 dollar-denominated KPIs at the top
 *   • Natural-language filter chips (status + exception slices)
 *   • Contract Cards — one full-width expandable card per BPA, with
 *     progress bar + expiry indicator on the face and a parts grid
 *     on expansion
 *
 * Reads via `bpa_list` which now returns per-BPA fulfillment aggregates.
 * Full detail still opens in the BPADetail modal.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    FileText, CheckCircle, Edit, Clock, AlertCircle, XCircle,
    Plus, RefreshCw, Search, ChevronRight, DollarSign, Package,
    Layers, Calendar, TrendingUp, Loader2,
} from 'lucide-react';
import { Card, ModuleLoader } from '../ui/EnterpriseUI';
import { Badge } from '../ui/badge';
import { LoadingSpinner } from '../ui/EnterpriseUI';
import { listBPAs, cancelBPA } from './bpaService';
import type { BPAAggregate, PortfolioTotals, FulfillmentRowRich } from './bpaService';
import type { CustomerAgreement, AgreementStatus } from './types';
import { BPADetail } from './BPADetail';
import { BPACreate } from './BPACreate';

type CardFilter = 'ALL' | AgreementStatus | 'EXPIRING_SOON';

interface Props {
    userRole?: string;
    userPerms?: Record<string, boolean>;
}

// ============================================================================
// Main
// ============================================================================

export function BPAList({ userRole, userPerms = {} }: Props) {
    const hasPerms = Object.keys(userPerms).length > 0;
    const canCreate = userRole === 'L3' || userRole === 'ADMIN'
        || (hasPerms ? userPerms['bpa.create'] === true : userRole === 'L2');
    const canAmend = userRole === 'L3' || userRole === 'ADMIN' || userRole === 'FINANCE' || userPerms['bpa.amend'] === true;

    const [agreements, setAgreements] = useState<CustomerAgreement[]>([]);
    const [aggregates, setAggregates] = useState<Record<string, BPAAggregate>>({});
    const [fulfillmentRows, setFulfillmentRows] = useState<FulfillmentRowRich[]>([]);
    const [portfolio, setPortfolio] = useState<PortfolioTotals>({ portfolio_value: 0, released_value: 0, in_rack_value: 0, expiring_soon: 0 });
    const [counts, setCounts] = useState({ total: 0, active: 0, draft: 0, amended: 0, expired: 0, cancelled: 0 });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [page, setPage] = useState(0);
    const [pageSize] = useState(25);
    const [totalCount, setTotalCount] = useState(0);
    const [cardFilter, setCardFilter] = useState<CardFilter>('ALL');
    const [search, setSearch] = useState('');

    const [detailId, setDetailId] = useState<string | null>(null);
    const [showCreate, setShowCreate] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            // The "EXPIRING_SOON" filter is applied client-side because it's
            // computed from effective_end_date + today
            const statusForApi = cardFilter === 'EXPIRING_SOON' ? 'ALL' : cardFilter;
            const res = await listBPAs({
                page, page_size: pageSize,
                status_filter: statusForApi,
                search_term: search || undefined,
            });
            setAgreements(res.agreements);
            setTotalCount(res.total_count);
            setCounts(res.counts);
            setAggregates(res.aggregates ?? {});
            setFulfillmentRows(res.fulfillment_rows ?? []);
            setPortfolio(res.portfolio ?? { portfolio_value: 0, released_value: 0, in_rack_value: 0, expiring_soon: 0 });
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load BPAs');
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, cardFilter, search]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const visibleAgreements = useMemo(() => {
        if (cardFilter !== 'EXPIRING_SOON') return agreements;
        const today = new Date();
        const sixtyDaysOut = new Date(today.getTime() + 60 * 86400000);
        return agreements.filter(a => {
            if (!a.effective_end_date) return false;
            if (a.status !== 'ACTIVE' && a.status !== 'AMENDED') return false;
            const end = new Date(a.effective_end_date);
            return end >= today && end <= sixtyDaysOut;
        });
    }, [agreements, cardFilter]);

    // Group fulfillment rows by part_number, scoped to visible agreements
    const partGroups = useMemo(() => {
        const visibleIds = new Set(visibleAgreements.map(a => a.id));
        type PartGroup = {
            part_number: string;
            msn_code:    string;
            item_name:   string | null;
            total_blanket:   number;
            total_released:  number;
            total_delivered: number;
            total_pending:   number;
            total_in_rack:   number;
            pallets_in_rack: number;
            total_value:     number;
            released_value:  number;
            in_rack_value:   number;
            bpa_rows:        FulfillmentRowRich[];
        };
        const map = new Map<string, PartGroup>();
        for (const r of fulfillmentRows) {
            if (!visibleIds.has(r.agreement_id)) continue;
            const q = search.trim().toLowerCase();
            if (q && !(
                (r.part_number ?? '').toLowerCase().includes(q) ||
                (r.msn_code ?? '').toLowerCase().includes(q) ||
                (r.item_name ?? '').toLowerCase().includes(q) ||
                (r.agreement_number ?? '').toLowerCase().includes(q) ||
                (r.customer_name ?? '').toLowerCase().includes(q)
            )) continue;
            let g = map.get(r.part_number);
            if (!g) {
                g = {
                    part_number: r.part_number, msn_code: r.msn_code, item_name: r.item_name,
                    total_blanket: 0, total_released: 0, total_delivered: 0, total_pending: 0,
                    total_in_rack: 0, pallets_in_rack: 0, total_value: 0, released_value: 0, in_rack_value: 0,
                    bpa_rows: [],
                };
                map.set(r.part_number, g);
            }
            // Always show the BPA in the expanded list (so user can see cancelled
            // context), but EXCLUDE cancelled / expired BPAs from the rolled-up
            // totals — a cancelled contract no longer commits any volume.
            const countsInTotals = r.agreement_status !== 'CANCELLED' && r.agreement_status !== 'EXPIRED';
            if (countsInTotals) {
                const unit = Number(r.unit_price ?? 0);
                g.total_blanket   += Number(r.blanket_quantity ?? 0);
                g.total_released  += Number(r.released_quantity ?? 0);
                g.total_delivered += Number(r.delivered_quantity ?? 0);
                g.total_pending   += Number(r.pending_quantity ?? 0);
                g.total_in_rack   += Number(r.qty_in_rack ?? 0);
                g.pallets_in_rack += Number(r.pallets_in_rack ?? 0);
                g.total_value     += Number(r.total_value ?? 0);
                g.released_value  += Number(r.released_quantity ?? 0) * unit;
                g.in_rack_value   += Number(r.qty_in_rack ?? 0) * unit;
            }
            g.bpa_rows.push(r);
        }
        // Sort: highest blanket qty first, cancelled/expired rows drop to the bottom of bpa_rows
        for (const g of map.values()) {
            g.bpa_rows.sort((a, b) => {
                const aActive = a.agreement_status === 'ACTIVE' || a.agreement_status === 'AMENDED' ? 0 : 1;
                const bActive = b.agreement_status === 'ACTIVE' || b.agreement_status === 'AMENDED' ? 0 : 1;
                if (aActive !== bActive) return aActive - bActive;
                return b.blanket_quantity - a.blanket_quantity;
            });
        }
        return Array.from(map.values()).sort((a, b) => b.total_blanket - a.total_blanket);
    }, [fulfillmentRows, visibleAgreements, search]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    // ── First-load: spinning-icon module loader ─────────────────────────
    if (loading && agreements.length === 0) {
        return (
            <ModuleLoader
                moduleName="Blanket Purchase Agreements"
                icon={<FileText size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />}
            />
        );
    }

    return (
        <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>
            {/* ── Page header ─────────────────────────────────────── */}
            <div style={{ marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                    <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--enterprise-gray-900)', margin: 0 }}>
                        Blanket Purchase Agreements
                    </h1>
                    <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-600)', marginTop: '4px', margin: '4px 0 0' }}>
                        Long-term customer commitments. Track fulfillment, plan releases, manage amendments.
                    </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={fetchData} style={ghostBtnStyle} disabled={loading}>
                        <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : undefined }} /> Refresh
                    </button>
                    {canCreate && (
                        <button onClick={() => setShowCreate(true)} style={primaryBtnStyle}>
                            <Plus size={13} /> New BPA
                        </button>
                    )}
                </div>
            </div>

            {/* ── Portfolio Strip ─────────────────────────────────── */}
            <PortfolioStrip portfolio={portfolio} counts={counts} />

            {/* ── Filter chips ────────────────────────────────────── */}
            <FilterChips
                filter={cardFilter}
                onChange={(f) => { setCardFilter(f); setPage(0); }}
                counts={counts}
                expiringSoon={portfolio.expiring_soon}
            />

            {/* ── Search row ──────────────────────────────────────── */}
            <div style={{ position: 'relative', marginBottom: 18 }}>
                <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--enterprise-gray-400)' }} />
                <input
                    type="text"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                    placeholder="Search by agreement #, customer, buyer…"
                    style={{ width: '100%', padding: '12px 14px 12px 42px', fontSize: 13, border: '1px solid var(--enterprise-gray-200)', borderRadius: 10, outline: 'none', background: 'white', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}
                    onFocus={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-primary)'}
                    onBlur={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-gray-200)'}
                />
            </div>

            {/* ── Error banner ────────────────────────────────────── */}
            {error && (
                <div style={{ padding: '12px 16px', background: '#fef2f2', borderLeft: '3px solid #dc2626', borderRadius: 8, marginBottom: 12, color: '#991b1b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            {/* ── Part Cards ──────────────────────────────────────── */}
            {loading ? (
                <Card style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ textAlign: 'center', padding: 60 }}>
                        <LoadingSpinner size={32} />
                        <p style={{ color: 'var(--enterprise-gray-600)', fontSize: '13px', marginTop: '12px' }}>Loading parts…</p>
                    </div>
                </Card>
            ) : partGroups.length === 0 ? (
                <EmptyState search={search} />
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {partGroups.map(g => (
                        <PartCard
                            key={g.part_number}
                            group={g}
                            onOpenBPA={(aid) => setDetailId(aid)}
                            onCancelled={fetchData}
                        />
                    ))}
                </div>
            )}

            {/* ── Pagination ──────────────────────────────────────── */}
            {totalPages > 1 && cardFilter !== 'EXPIRING_SOON' && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16, fontSize: 13, color: 'var(--enterprise-gray-600)' }}>
                    <span>Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalCount)} of {totalCount}</span>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} style={pagerBtnStyle(page === 0)}>Prev</button>
                        <span>Page {page + 1} / {totalPages}</span>
                        <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} style={pagerBtnStyle(page >= totalPages - 1)}>Next</button>
                    </div>
                </div>
            )}

            {/* ── Modals ──────────────────────────────────────────── */}
            {detailId && (
                <BPADetail
                    agreementId={detailId}
                    onClose={() => setDetailId(null)}
                    onAmended={() => { setDetailId(null); fetchData(); }}
                    canAmend={canAmend}
                />
            )}
            {showCreate && (
                <BPACreate
                    onClose={() => setShowCreate(false)}
                    onCreated={(agreementId) => { setShowCreate(false); setDetailId(agreementId); fetchData(); }}
                />
            )}
        </div>
    );
}

// ============================================================================
// Portfolio Strip
// ============================================================================

function PortfolioStrip({ portfolio, counts }: { portfolio: PortfolioTotals; counts: { active: number; total: number } }) {
    const total = portfolio.portfolio_value || 1;
    const releasedPct = +((portfolio.released_value / total) * 100).toFixed(1);
    const inRackPct = +((portfolio.in_rack_value / total) * 100).toFixed(1);

    return (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 16 }}>
            <PortfolioCard
                icon={<DollarSign size={16} />}
                iconBg="#eff6ff" iconColor="#2563eb"
                label="Portfolio Value"
                primary={`$${Math.round(portfolio.portfolio_value).toLocaleString()}`}
                secondary={`${counts.active} active BPA${counts.active !== 1 ? 's' : ''}`}
            />
            <PortfolioCard
                icon={<CheckCircle size={16} />}
                iconBg="#f0fdf4" iconColor="#16a34a"
                label="Released"
                primary={`$${Math.round(portfolio.released_value).toLocaleString()}`}
                secondary={`${releasedPct}% of portfolio`}
                progress={releasedPct}
                progressColor="#16a34a"
            />
            <PortfolioCard
                icon={<Layers size={16} />}
                iconBg="#fef3c7" iconColor="#d97706"
                label="In Rack"
                primary={`$${Math.round(portfolio.in_rack_value).toLocaleString()}`}
                secondary={`${inRackPct}% of portfolio staged`}
                progress={inRackPct}
                progressColor="#d97706"
            />
            <PortfolioCard
                icon={<Clock size={16} />}
                iconBg={portfolio.expiring_soon > 0 ? '#fee2e2' : '#f0fdf4'}
                iconColor={portfolio.expiring_soon > 0 ? '#dc2626' : '#16a34a'}
                label="Expiring ≤ 60 days"
                primary={portfolio.expiring_soon === 0 ? '0' : String(portfolio.expiring_soon)}
                secondary={portfolio.expiring_soon === 0 ? 'All BPAs on track' : `${portfolio.expiring_soon} need attention`}
            />
        </div>
    );
}

function PortfolioCard({ icon, iconBg, iconColor, label, primary, secondary, progress, progressColor }: {
    icon: React.ReactNode; iconBg: string; iconColor: string;
    label: string; primary: string; secondary: string;
    progress?: number; progressColor?: string;
}) {
    return (
        <div style={{ background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 12, padding: '16px 18px', boxShadow: '0 1px 2px rgba(0,0,0,0.02)', transition: 'all 0.2s ease' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {label}
                </div>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: iconBg, color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {icon}
                </div>
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--enterprise-gray-900)', lineHeight: 1.1 }}>{primary}</div>
            <div style={{ fontSize: 12, color: 'var(--enterprise-gray-600)', marginTop: 4 }}>{secondary}</div>
            {progress !== undefined && (
                <div style={{ marginTop: 10, height: 4, background: 'var(--enterprise-gray-200)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, progress)}%`, height: '100%', background: progressColor ?? 'var(--enterprise-primary)', transition: 'width 0.3s ease' }} />
                </div>
            )}
        </div>
    );
}

// ============================================================================
// Filter chips
// ============================================================================

function FilterChips({ filter, onChange, counts, expiringSoon }: {
    filter: CardFilter;
    onChange: (f: CardFilter) => void;
    counts: { total: number; active: number; draft: number; amended: number; expired: number; cancelled: number };
    expiringSoon: number;
}) {
    const chips: Array<{ key: CardFilter; label: string; count: number; color?: string }> = [
        { key: 'ALL',            label: 'All',             count: counts.total },
        { key: 'ACTIVE',         label: 'Active',          count: counts.active,    color: '#16a34a' },
        { key: 'AMENDED',        label: 'Amended',         count: counts.amended,   color: '#d97706' },
        { key: 'EXPIRING_SOON',  label: 'Expiring ≤ 60d',  count: expiringSoon,     color: '#dc2626' },
        { key: 'EXPIRED',        label: 'Expired',         count: counts.expired,   color: '#6b7280' },
        { key: 'CANCELLED',      label: 'Cancelled',       count: counts.cancelled, color: '#9ca3af' },
    ];

    return (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
            {chips.map(c => {
                const active = filter === c.key;
                return (
                    <button
                        key={c.key}
                        onClick={() => onChange(c.key)}
                        style={{
                            padding: '7px 14px',
                            border: active ? 'none' : '1px solid var(--enterprise-gray-200)',
                            borderRadius: 999,
                            background: active
                                ? c.key === 'ALL'
                                    ? 'linear-gradient(135deg, #1e3a8a 0%, #1e40af 100%)'
                                    : `linear-gradient(135deg, ${c.color ?? '#1e3a8a'} 0%, ${shade(c.color ?? '#1e3a8a')} 100%)`
                                : 'white',
                            color: active ? '#fff' : 'var(--enterprise-gray-700)',
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.15s ease',
                            boxShadow: active ? '0 2px 8px rgba(0,0,0,0.12)' : 'none',
                            display: 'flex', alignItems: 'center', gap: 6,
                        }}
                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.background = 'var(--enterprise-gray-50)'; }}
                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.background = 'white'; }}
                    >
                        <span>{c.label}</span>
                        <span style={{
                            background: active ? 'rgba(255,255,255,0.25)' : 'var(--enterprise-gray-100)',
                            color: active ? '#fff' : 'var(--enterprise-gray-600)',
                            padding: '1px 7px',
                            borderRadius: 10,
                            fontSize: 11,
                            fontWeight: 700,
                            minWidth: 18,
                            textAlign: 'center',
                        }}>{c.count}</span>
                    </button>
                );
            })}
        </div>
    );
}

function shade(hex: string): string {
    // Darker variant — used for gradient end-stop. Simple half-alpha darken.
    const map: Record<string, string> = {
        '#16a34a': '#166534',
        '#d97706': '#78350f',
        '#6366f1': '#3730a3',
        '#dc2626': '#991b1b',
        '#6b7280': '#374151',
        '#9ca3af': '#6b7280',
    };
    return map[hex] ?? '#1e3a8a';
}


// ============================================================================
// Status chip
// ============================================================================

const STATUS_COLORS: Record<string, string> = {
    ACTIVE:    '#16a34a',
    AMENDED:   '#d97706',
    DRAFT:     '#6366f1',
    EXPIRED:   '#6b7280',
    CANCELLED: '#dc2626',
};
const STATUS_BG: Record<string, string> = {
    ACTIVE:    '#dcfce7',
    AMENDED:   '#fef3c7',
    DRAFT:     '#e0e7ff',
    EXPIRED:   '#f3f4f6',
    CANCELLED: '#fee2e2',
};

// ============================================================================
// PartCard — primary entity. Expands to show BPAs covering this part.
// ============================================================================

type PartGroup = {
    part_number: string;
    msn_code:    string;
    item_name:   string | null;
    total_blanket:   number;
    total_released:  number;
    total_delivered: number;
    total_pending:   number;
    total_in_rack:   number;
    pallets_in_rack: number;
    total_value:     number;
    released_value:  number;
    in_rack_value:   number;
    bpa_rows:        FulfillmentRowRich[];
};

function PartCard({ group, onOpenBPA, onCancelled }: { group: PartGroup; onOpenBPA: (id: string) => void; onCancelled: () => void }) {
    const [expanded, setExpanded] = useState(false);
    const pct = group.total_blanket > 0 ? +((group.total_released / group.total_blanket) * 100).toFixed(1) : 0;
    const hasInRack = group.pallets_in_rack > 0;
    const currency = 'USD';

    return (
        <div style={{
            background: 'white',
            border: expanded ? '1.5px solid var(--enterprise-primary)' : '1px solid var(--enterprise-gray-200)',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: expanded ? '0 8px 24px rgba(0,0,0,0.08)' : '0 1px 2px rgba(0,0,0,0.03)',
            transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
            display: 'flex',
        }}>
            <div style={{ width: 4, background: 'var(--enterprise-info, #3b82f6)', flexShrink: 0 }} />

            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    onClick={() => setExpanded(v => !v)}
                    style={{ padding: '16px 20px', cursor: 'pointer' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.015)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0 }}>
                            <span style={{ fontFamily: 'monospace', fontSize: 17, fontWeight: 800, color: 'var(--enterprise-info, #3b82f6)', padding: '2px 10px', background: 'rgba(59,130,246,0.1)', borderRadius: 6 }}>
                                {group.part_number}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--enterprise-gray-700)' }}>{group.msn_code}</span>
                            {group.item_name && (
                                <span style={{ fontSize: 12, color: 'var(--enterprise-gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                                    {group.item_name}
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--enterprise-primary)', background: 'rgba(30,58,138,0.08)', padding: '3px 10px', borderRadius: 12, letterSpacing: '0.3px' }}>
                                {group.bpa_rows.length} BPA{group.bpa_rows.length !== 1 ? 's' : ''}
                            </span>
                            <ChevronRight size={16} style={{ color: 'var(--enterprise-gray-400)', transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s ease' }} />
                        </div>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 12 }}>
                        <KPIInline label="Blanket"   value={group.total_blanket.toLocaleString()} />
                        <KPIInline label="Released"  value={group.total_released.toLocaleString()}  accent="success" />
                        <KPIInline label="Pending"   value={group.total_pending.toLocaleString()}   accent="warning" />
                        <KPIInline label="In Rack"   value={group.total_in_rack.toLocaleString()}   accent={hasInRack ? 'warning' : undefined}
                            sub={hasInRack ? `${group.pallets_in_rack} pallet${group.pallets_in_rack !== 1 ? 's' : ''}` : undefined} />
                        <KPIInline label="Committed Value" value={`${currency} $${Math.round(group.total_value).toLocaleString()}`} mono />
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: pct >= 100 ? 'var(--enterprise-success)' : 'var(--enterprise-gray-700)', minWidth: 40 }}>
                            {pct}%
                        </span>
                        <div style={{ flex: 1, height: 5, background: 'var(--enterprise-gray-200)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: pct >= 100 ? 'var(--enterprise-success)' : 'var(--enterprise-info, #3b82f6)', transition: 'width 0.3s ease' }} />
                        </div>
                        <span style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', whiteSpace: 'nowrap' }}>fulfillment</span>
                    </div>
                </div>

                {expanded && (
                    <div style={{ borderTop: '1px solid var(--enterprise-gray-100)', background: 'linear-gradient(180deg, rgba(59,130,246,0.02) 0%, rgba(59,130,246,0.0) 100%)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 20px 8px', fontSize: 11, fontWeight: 700, color: 'var(--enterprise-info, #3b82f6)', letterSpacing: '0.6px', textTransform: 'uppercase' }}>
                            <FileText size={12} /> Covered by {group.bpa_rows.length} BPA{group.bpa_rows.length !== 1 ? 's' : ''}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 0.9fr 0.9fr 0.9fr 0.9fr 1fr auto 28px', gap: 10, padding: '8px 20px', background: 'rgba(15,23,42,0.03)', fontSize: 10, fontWeight: 700, color: 'var(--enterprise-gray-500)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                            <div>BPA</div>
                            <div>Customer / Buyer</div>
                            <div style={{ textAlign: 'right' }}>Blanket</div>
                            <div style={{ textAlign: 'right' }}>Released</div>
                            <div style={{ textAlign: 'right' }}>Pending</div>
                            <div style={{ textAlign: 'right' }}>REL MULT</div>
                            <div>Progress</div>
                            <div />
                            <div />
                        </div>
                        {group.bpa_rows.map((r, i) => (
                            <BPAUnderPartRow key={r.agreement_id + '-' + i} row={r}
                                onOpen={() => onOpenBPA(r.agreement_id)}
                                onCancelled={onCancelled}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function BPAUnderPartRow({ row, onOpen, onCancelled }: { row: FulfillmentRowRich; onOpen: () => void; onCancelled: () => void }) {
    const pct = row.fulfillment_pct ?? 0;
    const done = pct >= 100;
    const [cancelling, setCancelling] = useState(false);
    const [cancelErr, setCancelErr] = useState<string | null>(null);
    const canCancel = row.agreement_status !== 'CANCELLED' && row.agreement_status !== 'EXPIRED';
    const isInactive = row.agreement_status === 'CANCELLED' || row.agreement_status === 'EXPIRED';

    const doCancel = async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm(`Cancel BPA ${row.agreement_number}? This cannot be undone.`)) return;
        setCancelling(true); setCancelErr(null);
        try {
            await cancelBPA(row.agreement_id);
            onCancelled();
        } catch (e: any) {
            setCancelErr(e?.message ?? 'Cancel failed');
        } finally {
            setCancelling(false);
        }
    };

    return (
        <>
        <div
            onClick={onOpen}
            style={{
                display: 'grid',
                gridTemplateColumns: '1.3fr 1fr 0.9fr 0.9fr 0.9fr 0.9fr 1fr auto 28px',
                gap: 10,
                padding: '12px 20px',
                borderTop: '1px solid var(--enterprise-gray-100)',
                alignItems: 'center',
                fontSize: 12,
                background: 'white',
                cursor: 'pointer',
                transition: 'background 0.15s ease',
                opacity: isInactive ? 0.6 : 1,
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--enterprise-gray-50)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--enterprise-gray-900)' }}>{row.agreement_number}</span>
                <StatusChip status={row.agreement_status as AgreementStatus} />
            </div>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--enterprise-gray-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.customer_name}</div>
                {row.buyer_name && <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', marginTop: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.buyer_name}</div>}
            </div>
            <div style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'monospace' }}>{Number(row.blanket_quantity).toLocaleString()}</div>
            <div style={{ textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', color: 'var(--enterprise-success)' }}>{Number(row.released_quantity).toLocaleString()}</div>
            <div style={{ textAlign: 'right', fontWeight: 600, fontFamily: 'monospace', color: 'var(--enterprise-warning)' }}>{Number(row.pending_quantity).toLocaleString()}</div>
            <div style={{ textAlign: 'right', fontFamily: 'monospace', color: 'var(--enterprise-gray-700)' }}>{row.release_multiple ? Number(row.release_multiple).toLocaleString() : '—'}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: done ? 'var(--enterprise-success)' : 'var(--enterprise-gray-700)', minWidth: 36 }}>{pct.toFixed(1)}%</span>
                <div style={{ flex: 1, height: 4, background: 'var(--enterprise-gray-200)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: done ? 'var(--enterprise-success)' : 'var(--enterprise-info, #3b82f6)' }} />
                </div>
            </div>
            <div>
                {canCancel ? (
                    <button
                        onClick={doCancel}
                        disabled={cancelling}
                        title="Cancel this BPA"
                        style={{ background: 'transparent', border: 'none', cursor: cancelling ? 'wait' : 'pointer', color: '#dc2626', padding: '4px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}
                        onMouseEnter={(e) => e.currentTarget.style.background = '#fee2e2'}
                        onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                        {cancelling ? <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} /> : <XCircle size={12} />}
                        {cancelling ? 'Cancelling…' : 'Cancel'}
                    </button>
                ) : (
                    <span style={{ fontSize: 10, color: 'var(--enterprise-gray-400)' }}>—</span>
                )}
            </div>
            <div style={{ color: 'var(--enterprise-gray-400)', justifySelf: 'end' }}>
                <ChevronRight size={14} />
            </div>
        </div>
        {cancelErr && (
            <div style={{ padding: '8px 20px', background: '#fef2f2', borderTop: '1px solid #fecaca', color: '#991b1b', fontSize: 11, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertCircle size={12} /> {cancelErr}
            </div>
        )}
        </>
    );
}

function KPIInline({ label, value, sub, accent, mono }: { label: string; value: string; sub?: string; accent?: 'success' | 'warning'; mono?: boolean }) {
    const color =
        accent === 'success' ? 'var(--enterprise-success)' :
        accent === 'warning' ? '#d97706' :
        'var(--enterprise-gray-900)';
    return (
        <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</div>
            {sub && <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginTop: 1 }}>{sub}</div>}
        </div>
    );
}

function StatusChip({ status }: { status: AgreementStatus }) {
    return (
        <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
            padding: '3px 8px', borderRadius: 10,
            color: STATUS_COLORS[status] ?? '#374151',
            background: STATUS_BG[status] ?? '#f3f4f6',
        }}>{status}</span>
    );
}

// ============================================================================
// Empty state
// ============================================================================

function EmptyState({ search }: { search: string }) {
    return (
        <div style={{ background: 'white', border: '1px dashed var(--enterprise-gray-300)', borderRadius: 12, padding: '60px 24px', textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--enterprise-gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <FileText size={28} style={{ color: 'var(--enterprise-gray-400)' }} />
            </div>
            <p style={{ color: 'var(--enterprise-gray-700)', fontSize: 15, fontWeight: 600, margin: 0 }}>
                {search ? 'No agreements match your search' : 'No agreements yet'}
            </p>
            <p style={{ color: 'var(--enterprise-gray-500)', fontSize: 13, marginTop: 6 }}>
                {search ? 'Try a different search term or clear filters.' : 'Create your first BPA to start tracking customer commitments.'}
            </p>
        </div>
    );
}

// ============================================================================
// Styles
// ============================================================================

const primaryBtnStyle: React.CSSProperties = {
    background: 'var(--enterprise-primary)', color: 'white', border: 'none',
    padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
};
const ghostBtnStyle: React.CSSProperties = {
    background: 'white', color: 'var(--enterprise-gray-700)',
    border: '1px solid var(--enterprise-gray-200)',
    padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
};
const pagerBtnStyle = (disabled: boolean): React.CSSProperties => ({
    background: 'white', color: disabled ? 'var(--enterprise-gray-400)' : 'var(--enterprise-gray-700)',
    border: '1px solid var(--enterprise-gray-200)',
    padding: '6px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer',
});
