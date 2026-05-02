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
    FileText, CheckCircle, Edit, Clock, AlertCircle, XCircle, X,
    Plus, RefreshCw, Search, ChevronRight, ChevronDown, DollarSign, Package,
    Layers, Calendar, TrendingUp, Loader2,
} from 'lucide-react';
import { Card, ModuleLoader } from '../ui/EnterpriseUI';
import { Badge } from '../ui/badge';
import { LoadingSpinner } from '../ui/EnterpriseUI';
import { listBPAs, cancelBPA, getBPA } from './bpaService';
import type { BPAAggregate, PortfolioTotals, FulfillmentRowRich, BPAGetResponse } from './bpaService';
import type { CustomerAgreement, AgreementStatus } from './types';
import { BPADetail } from './BPADetail';
import { BPACreate } from './BPACreate';
import { CreateRelease } from '../release/CreateRelease';

type CardFilter = 'ALL' | AgreementStatus | 'EXPIRING_SOON' | 'COMPLETED' | 'PENDING_HEAVY';

interface Props {
    userRole?: string;
    userPerms?: Record<string, boolean>;
    onNavigate?: (view: string) => void;
}

// ============================================================================
// Main
// ============================================================================

export function BPAList({ userRole, userPerms = {}, onNavigate }: Props) {
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
    const [detailInitialTab, setDetailInitialTab] = useState<'overview' | 'releases'>('overview');
    const [showCreate, setShowCreate] = useState(false);
    const [createReleaseData, setCreateReleaseData] = useState<BPAGetResponse | null>(null);
    const [showReleaseWizard, setShowReleaseWizard] = useState(false);
    const [releaseCandidates, setReleaseCandidates] = useState<{ agreement_id: string; agreement_number: string; customer_name: string; blanket_quantity: number; status: string }[]>([]);
    const [loadingRelease, setLoadingRelease] = useState(false);

    const handleNewRelease = async (agreementId: string | null, candidates?: typeof releaseCandidates) => {
        if (!agreementId) {
            // Multiple BPAs — open wizard at Step 1 with candidate cards
            setReleaseCandidates(candidates ?? []);
            setShowReleaseWizard(true);
            return;
        }
        setLoadingRelease(true);
        try {
            const bpaData = await getBPA({ agreement_id: agreementId });
            setCreateReleaseData(bpaData);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load BPA for release');
        } finally {
            setLoadingRelease(false);
        }
    };

    const fetchData = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            // Client-side filters: EXPIRING_SOON, COMPLETED, PENDING_HEAVY
            // These are applied after fetching, so pass 'ALL' to the API
            const CLIENT_SIDE_FILTERS: CardFilter[] = ['EXPIRING_SOON', 'COMPLETED', 'PENDING_HEAVY'];
            const statusForApi = CLIENT_SIDE_FILTERS.includes(cardFilter) ? 'ALL' : cardFilter;
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
        // COMPLETED and PENDING_HEAVY are filtered at the partGroups level, not agreements
        if (cardFilter === 'EXPIRING_SOON') {
            const today = new Date();
            const sixtyDaysOut = new Date(today.getTime() + 60 * 86400000);
            return agreements.filter(a => {
                if (!a.effective_end_date) return false;
                if (a.status !== 'ACTIVE' && a.status !== 'AMENDED') return false;
                const end = new Date(a.effective_end_date);
                return end >= today && end <= sixtyDaysOut;
            });
        }
        return agreements;
    }, [agreements, cardFilter]);

    // Group fulfillment rows by part_number, scoped to visible agreements
    const partGroups = useMemo(() => {
        const visibleIds = new Set(visibleAgreements.map(a => a.id));
        type PartGroup = {
            part_number: string;
            msn_code: string;
            part_revision: string | null;
            item_name: string | null;
            total_blanket: number;
            total_released: number;
            total_delivered: number;
            total_pending: number;
            total_in_rack: number;
            pallets_in_rack: number;
            total_value: number;
            released_value: number;
            delivered_value: number;
            in_rack_value: number;
            bpa_rows: FulfillmentRowRich[];
        };
        const map = new Map<string, PartGroup>();
        const agreementRevisionMap = new Map(visibleAgreements.map(a => [a.id, a.agreement_revision]));

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
                    part_revision: r.part_revision || null,
                    total_blanket: 0, total_released: 0, total_delivered: 0, total_pending: 0,
                    total_in_rack: 0, pallets_in_rack: 0, total_value: 0, released_value: 0, delivered_value: 0, in_rack_value: 0,
                    bpa_rows: [],
                };
                map.set(r.part_number, g);
            }
            // Add revision mapping
            r.agreement_revision = agreementRevisionMap.get(r.agreement_id);

            // Always show the BPA in the expanded list (so user can see cancelled
            // context), but EXCLUDE cancelled / expired BPAs from the rolled-up
            // totals — a cancelled contract no longer commits any volume.
            const countsInTotals = r.agreement_status !== 'CANCELLED' && r.agreement_status !== 'EXPIRED';
            if (countsInTotals) {
                const unit = Number(r.unit_price ?? 0);
                g.total_blanket += Number(r.blanket_quantity ?? 0);
                g.total_released += Number(r.released_quantity ?? 0);
                g.total_delivered += Number(r.delivered_quantity ?? 0);
                g.total_pending += Number(r.pending_quantity ?? 0);
                g.total_in_rack += Number(r.qty_in_rack ?? 0);
                g.pallets_in_rack += Number(r.pallets_in_rack ?? 0);
                g.total_value += Number(r.total_value ?? 0);
                g.released_value += Number(r.released_quantity ?? 0) * unit;
                g.delivered_value += Number(r.delivered_quantity ?? 0) * unit;
                g.in_rack_value += Number(r.qty_in_rack ?? 0) * unit;
            }
            g.bpa_rows.push(r);
        }
        // Sort BPA rows: Active → Expiring (≤60d) → Amended → Others → Cancelled/Expired
        const today = new Date();
        const sixtyDaysOut = new Date(today.getTime() + 60 * 86400000);
        for (const g of map.values()) {
            g.bpa_rows.sort((a, b) => {
                const priority = (r: FulfillmentRowRich): number => {
                    if (r.agreement_status === 'CANCELLED') return 5;
                    if (r.agreement_status === 'EXPIRED') return 4;
                    // Active but expiring within 60 days
                    if ((r.agreement_status === 'ACTIVE' || r.agreement_status === 'AMENDED')
                        && r.effective_end_date) {
                        const end = new Date(r.effective_end_date);
                        if (end >= today && end <= sixtyDaysOut) return 1; // expiring soon
                    }
                    if (r.agreement_status === 'ACTIVE') return 0;
                    if (r.agreement_status === 'AMENDED') return 2;
                    return 3;
                };
                const pA = priority(a), pB = priority(b);
                if (pA !== pB) return pA - pB;
                return b.blanket_quantity - a.blanket_quantity;
            });
        }
        let result = Array.from(map.values()).sort((a, b) => b.total_blanket - a.total_blanket);
        // Client-side filtering for COMPLETED and PENDING_HEAVY
        if (cardFilter === 'COMPLETED') {
            result = result.filter(g => g.total_blanket > 0 && g.total_delivered >= g.total_blanket);
        } else if (cardFilter === 'PENDING_HEAVY') {
            result = result.filter(g => g.total_pending > g.total_delivered);
        }
        return result;
    }, [fulfillmentRows, visibleAgreements, search, cardFilter]);

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

            {/* ── Summary Cards (Counts + Portfolio) ─────────────── */}
            <SummarySection
                portfolio={portfolio} counts={counts} partGroups={partGroups}
                cardFilter={cardFilter}
                onFilterChange={(f) => { setCardFilter(f); setPage(0); }}
            />

            {/* ── Search & Actions Toolbar ─────────────────────────── */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18,
                padding: '10px 16px', background: 'white', border: '1px solid var(--enterprise-gray-200)',
                borderRadius: 8,
            }}>
                <div style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0, background: 'var(--enterprise-gray-50)', border: '1px solid var(--enterprise-gray-300)', borderRadius: 6, padding: '8px 12px' }}>
                    <Search size={16} style={{ color: 'var(--enterprise-gray-400)', marginRight: 10, flexShrink: 0 }} />
                    <input
                        type="text"
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                        placeholder="Search by Part No, BPA #, Customer…"
                        style={{ border: 'none', outline: 'none', flex: 1, fontSize: 13, color: 'var(--enterprise-gray-800)', background: 'transparent', minWidth: 180 }}
                    />
                    {search && (
                        <button onClick={() => setSearch('')} style={{ background: 'var(--enterprise-gray-200)', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', borderRadius: 4, marginLeft: 8 }}>
                            <X size={14} style={{ color: 'var(--enterprise-gray-600)' }} />
                        </button>
                    )}
                </div>
                {/* Filter dropdown */}
                <select
                    value={cardFilter}
                    onChange={(e) => { setCardFilter(e.target.value as CardFilter); setPage(0); }}
                    style={{
                        padding: '8px 12px', borderRadius: 6,
                        border: '1px solid var(--enterprise-gray-300)',
                        fontSize: 13, fontWeight: 500, cursor: 'pointer',
                        background: 'white', height: 36,
                    }}
                >
                    <option value="ALL">All BPAs</option>
                    <option value="ACTIVE">Active</option>
                    <option value="AMENDED">Amended</option>
                    <option value="EXPIRING_SOON">Expiring ≤ 60d</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="PENDING_HEAVY">Pending Heavy</option>
                    <option value="EXPIRED">Expired</option>
                    <option value="CANCELLED">Cancelled</option>
                </select>
                <button onClick={fetchData} style={ghostBtnStyle} disabled={loading}>
                    <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : undefined }} /> Refresh
                </button>
                {canCreate && (
                    <button onClick={() => setShowCreate(true)} style={primaryBtnStyle}>
                        <Plus size={13} /> New BPA
                    </button>
                )}
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
                            onOpenBPA={(aid) => { setDetailInitialTab('overview'); setDetailId(aid); }}
                            onNewRelease={handleNewRelease}
                            loadingRelease={loadingRelease}
                            onCancelled={fetchData}
                            onNavigate={onNavigate}
                        />
                    ))}
                </div>
            )}

            {/* ── Pagination ──────────────────────────────────────── */}
            {totalPages > 1 && !['EXPIRING_SOON', 'COMPLETED', 'PENDING_HEAVY'].includes(cardFilter) && (
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
                    onCancelled={() => { setDetailId(null); fetchData(); }}
                    canAmend={canAmend}
                    initialTab={detailInitialTab}
                />
            )}
            {showCreate && (
                <BPACreate
                    onClose={() => setShowCreate(false)}
                    onCreated={(agreementId) => { setShowCreate(false); setDetailId(agreementId); fetchData(); }}
                />
            )}
            {createReleaseData && (
                <CreateRelease
                    prefilledBpa={createReleaseData.agreement}
                    prefilledParts={createReleaseData.parts}
                    onClose={() => setCreateReleaseData(null)}
                    onCreated={() => { setCreateReleaseData(null); fetchData(); }}
                />
            )}
            {showReleaseWizard && (
                <CreateRelease
                    candidateBpas={releaseCandidates}
                    onClose={() => { setShowReleaseWizard(false); setReleaseCandidates([]); }}
                    onCreated={() => { setShowReleaseWizard(false); setReleaseCandidates([]); fetchData(); }}
                />
            )}
        </div>
    );
}

// ============================================================================
// Summary Cards — Unified counts and valuations
// ============================================================================

function SummarySection({ portfolio, counts, partGroups, cardFilter, onFilterChange }: {
    portfolio: PortfolioTotals;
    counts: { active: number; total: number; delivered?: number };
    partGroups: PartGroup[];
    cardFilter: CardFilter;
    onFilterChange: (f: CardFilter) => void;
}) {
    const total = portfolio.portfolio_value || 1;
    const totalDeliveredValue = partGroups.reduce((sum, g) => sum + g.delivered_value, 0);
    const deliveredPct = +((totalDeliveredValue / total) * 100).toFixed(1);
    const inRackPct = +((portfolio.in_rack_value / total) * 100).toFixed(1);

    // Compute counts from partGroups
    const totalDeliveredQty = partGroups.reduce((sum, g) => sum + g.total_delivered, 0);
    const totalInRackQty = partGroups.reduce((sum, g) => sum + g.total_in_rack, 0);

    return (
        <div style={{ marginBottom: 20 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
                <UnifiedSummaryCard
                    icon={<CheckCircle size={16} />} iconBg="#f0fdf4" iconColor="#16a34a"
                    label="Active Portfolio"
                    primaryVal={counts.active.toLocaleString()} primarySub="Active BPAs"
                    secondaryVal={`$${Math.round(portfolio.portfolio_value).toLocaleString()}`} secondarySub="Total Value"
                    isActive={cardFilter === 'ACTIVE'}
                    onClick={() => onFilterChange(cardFilter === 'ACTIVE' ? 'ALL' : 'ACTIVE')}
                />
                <UnifiedSummaryCard
                    icon={<TrendingUp size={16} />} iconBg="#eff6ff" iconColor="#2563eb"
                    label="Delivered"
                    primaryVal={totalDeliveredQty.toLocaleString()} primarySub="Units Delivered"
                    secondaryVal={`$${Math.round(totalDeliveredValue).toLocaleString()}`} secondarySub={`${deliveredPct}% of Value`}
                    isActive={cardFilter === 'COMPLETED'}
                    onClick={() => onFilterChange(cardFilter === 'COMPLETED' ? 'ALL' : 'COMPLETED')}
                    progress={deliveredPct} progressColor="#2563eb"
                />
                <UnifiedSummaryCard
                    icon={<Layers size={16} />} iconBg="#fef3c7" iconColor="#d97706"
                    label="In Rack (Staged)"
                    primaryVal={totalInRackQty.toLocaleString()} primarySub="Units Staged"
                    secondaryVal={`$${Math.round(portfolio.in_rack_value).toLocaleString()}`} secondarySub={`${inRackPct}% of Value`}
                    isActive={cardFilter === 'PENDING_HEAVY'}
                    onClick={() => onFilterChange(cardFilter === 'PENDING_HEAVY' ? 'ALL' : 'PENDING_HEAVY')}
                    progress={inRackPct} progressColor="#d97706"
                />
                <UnifiedSummaryCard
                    icon={<Clock size={16} />} 
                    iconBg={portfolio.expiring_soon > 0 ? '#fee2e2' : '#f8fafc'} 
                    iconColor={portfolio.expiring_soon > 0 ? '#dc2626' : '#64748b'}
                    label="Expiring ≤ 60 Days"
                    primaryVal={portfolio.expiring_soon.toLocaleString()} primarySub={portfolio.expiring_soon === 1 ? "BPA Expiring" : "BPAs Expiring"}
                    secondaryVal={portfolio.expiring_soon === 0 ? "On Track" : "Action Needed"} secondarySub="Status"
                    isActive={cardFilter === 'EXPIRING_SOON'}
                    onClick={() => onFilterChange(cardFilter === 'EXPIRING_SOON' ? 'ALL' : 'EXPIRING_SOON')}
                    alert={portfolio.expiring_soon > 0}
                />
            </div>
        </div>
    );
}

function UnifiedSummaryCard({ 
    icon, iconBg, iconColor, label, 
    primaryVal, primarySub, secondaryVal, secondarySub, 
    isActive, onClick, alert, progress, progressColor 
}: {
    icon: React.ReactNode; iconBg: string; iconColor: string;
    label: string; primaryVal: string; primarySub: string; secondaryVal?: string; secondarySub?: string;
    isActive?: boolean; onClick?: () => void; alert?: boolean; progress?: number; progressColor?: string;
}) {
    return (
        <div
            onClick={onClick}
            style={{
                background: 'white',
                border: isActive ? `2px solid ${iconColor}` : '1px solid var(--enterprise-gray-200)',
                borderRadius: 12, padding: '16px 18px',
                boxShadow: isActive ? `0 0 0 3px ${iconBg}` : '0 1px 2px rgba(0,0,0,0.02)',
                transition: 'all 0.2s ease', cursor: onClick ? 'pointer' : 'default',
                display: 'flex', flexDirection: 'column', justifyContent: 'space-between'
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {label}
                </div>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: iconBg, color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {icon}
                </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16 }}>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 24, fontWeight: 800, color: alert ? '#dc2626' : 'var(--enterprise-gray-900)', lineHeight: 1.1 }}>
                        {primaryVal}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', marginTop: 4, fontWeight: 500 }}>
                        {primarySub}
                    </div>
                </div>
                
                {secondaryVal && (
                    <div style={{ flex: 1, paddingLeft: 16, borderLeft: '1px solid var(--enterprise-gray-200)' }}>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--enterprise-gray-700)', lineHeight: 1.1 }}>
                            {secondaryVal}
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', marginTop: 4, fontWeight: 500 }}>
                            {secondarySub}
                        </div>
                    </div>
                )}
            </div>

            {progress !== undefined && (
                <div style={{ marginTop: 14, height: 4, background: 'var(--enterprise-gray-100)', borderRadius: 2, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, progress)}%`, height: '100%', background: progressColor ?? 'var(--enterprise-primary)', transition: 'width 0.3s ease' }} />
                </div>
            )}
        </div>
    );
}


// ============================================================================
// Status chip
// ============================================================================

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

const ROW_GRID_COLS = 'minmax(0, 1fr) minmax(0, 1.4fr) minmax(0, 0.3fr) minmax(0, 0.7fr) minmax(0, 0.6fr) minmax(0, 0.6fr) minmax(0, 0.7fr) minmax(0, 0.6fr) minmax(0, 1fr) 50px';

// ============================================================================
// PartCard — primary entity. Expands to show BPAs covering this part.
// ============================================================================

type PartGroup = {
    part_number: string;
    msn_code: string;
    part_revision: string | null;
    item_name: string | null;
    total_blanket: number;
    total_released: number;
    total_delivered: number;
    total_pending: number;
    total_in_rack: number;
    pallets_in_rack: number;
    total_value: number;
    released_value: number;
    delivered_value: number;
    in_rack_value: number;
    bpa_rows: FulfillmentRowRich[];
};

function PartCard({ group, onOpenBPA, onNewRelease, loadingRelease, onCancelled, onNavigate }: { group: PartGroup; onOpenBPA: (id: string) => void; onNewRelease: (id: string | null, candidates?: { agreement_id: string; agreement_number: string; customer_name: string; blanket_quantity: number; status: string }[]) => void; loadingRelease: boolean; onCancelled: () => void; onNavigate?: (view: string) => void }) {
    const [expanded, setExpanded] = useState(false);
    // Progress based on Delivered / Blanket
    const pct = group.total_blanket > 0 ? +((group.total_delivered / group.total_blanket) * 100).toFixed(1) : 0;
    const hasInRack = group.pallets_in_rack > 0;
    const currency = 'USD';

    // Check if any BPA is expiring
    const today = new Date();
    const sixtyDaysOut = new Date(today.getTime() + 60 * 86400000);
    const hasExpiringBPA = group.bpa_rows.some(r => {
        if (r.agreement_status !== 'ACTIVE' && r.agreement_status !== 'AMENDED') return false;
        if (!r.effective_end_date) return false;
        const end = new Date(r.effective_end_date);
        return end >= today && end <= sixtyDaysOut;
    });

    return (
        <div style={{
            background: 'white',
            border: expanded ? '1.5px solid var(--enterprise-primary)' : hasExpiringBPA ? '1px solid #fca5a5' : '1px solid var(--enterprise-gray-200)',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: expanded ? '0 8px 24px rgba(0,0,0,0.08)' : '0 1px 2px rgba(0,0,0,0.03)',
            transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
            display: 'flex',
        }}>
            <div style={{ width: 4, background: hasExpiringBPA ? '#dc2626' : 'var(--enterprise-info, #3b82f6)', flexShrink: 0 }} />

            <div style={{ flex: 1, minWidth: 0 }}>
                <div
                    onClick={() => setExpanded(v => !v)}
                    style={{ padding: '16px 20px', cursor: 'pointer' }}
                    onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0,0,0,0.015)'}
                    onMouseLeave={(e) => e.currentTarget.style.background = 'white'}
                >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, minWidth: 0, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: 'monospace', fontSize: 17, fontWeight: 800, color: 'var(--enterprise-info, #3b82f6)', padding: '2px 10px', background: 'rgba(59,130,246,0.1)', borderRadius: 6 }}>
                                {group.part_number}
                            </span>
                            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--enterprise-gray-700)' }}>{group.msn_code}</span>
                            {group.part_revision && <span style={{ fontSize: 11, fontWeight: 700, background: 'var(--enterprise-gray-100)', padding: '2px 6px', borderRadius: 4, color: 'var(--enterprise-gray-600)' }}>Rev {group.part_revision}</span>}
                            {group.item_name && (
                                <span style={{ fontSize: 12, color: 'var(--enterprise-gray-500)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, minWidth: 0 }}>
                                    {group.item_name}
                                </span>
                            )}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                            <ChevronRight size={16} style={{ color: 'var(--enterprise-gray-400)', transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s ease' }} />
                        </div>
                    </div>

                    {/* Evenly spaced KPI row */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr 1fr 160px', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--enterprise-primary)', background: 'rgba(30,58,138,0.08)', padding: '5px 14px', borderRadius: 12, letterSpacing: '0.3px', whiteSpace: 'nowrap' }}>
                            {group.bpa_rows.length} BPA{group.bpa_rows.length !== 1 ? 's' : ''}
                        </span>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <KPIInline label="Total BPA Qty" value={group.total_blanket.toLocaleString()} align="center" />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <KPIInline label="In Rack" value={group.total_in_rack.toLocaleString()} accent={hasInRack ? 'warning' : undefined}
                                sub={hasInRack ? `${group.pallets_in_rack} pallet${group.pallets_in_rack !== 1 ? 's' : ''}` : undefined} align="center" />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            <KPIInline label={`Value (${currency})`} value={`$${Math.round(group.total_value).toLocaleString()}`} mono align="center" />
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'center' }}>
                            {group.bpa_rows.length > 0 && (
                                <button 
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        const activeBpas = group.bpa_rows.filter(r => r.agreement_status === 'ACTIVE' || r.agreement_status === 'AMENDED');
                                        if (activeBpas.length === 1) {
                                            onNewRelease(activeBpas[0].agreement_id);
                                        } else if (activeBpas.length === 0 && group.bpa_rows.length === 1) {
                                            onNewRelease(group.bpa_rows[0].agreement_id);
                                        } else {
                                            // Multiple BPAs — pass them as candidates for Step 1
                                            onNewRelease(null, activeBpas.map(r => ({
                                                agreement_id: r.agreement_id,
                                                agreement_number: r.agreement_number ?? '',
                                                customer_name: r.customer_name ?? '',
                                                blanket_quantity: Number(r.blanket_quantity ?? 0),
                                                status: r.agreement_status ?? '',
                                            })));
                                        }
                                    }}
                                    disabled={loadingRelease}
                                    style={{ padding: '10px 24px', background: 'linear-gradient(135deg, #1e3a8a 0%, #3b82f6 100%)', color: 'white', border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: loadingRelease ? 'wait' : 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 8px rgba(30,58,138,0.2)' }}
                                    onMouseEnter={e => { if (!loadingRelease) e.currentTarget.style.transform = 'translateY(-1px)'; }}
                                    onMouseLeave={e => e.currentTarget.style.transform = 'none'}
                                >
                                    <Plus size={14} /> {loadingRelease ? 'Loading…' : 'New Release'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {expanded && (
                    <div style={{ borderTop: '1px solid var(--enterprise-gray-100)', background: 'linear-gradient(180deg, rgba(59,130,246,0.02) 0%, rgba(59,130,246,0.0) 100%)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '12px 20px 8px', fontSize: 11, fontWeight: 700, color: 'var(--enterprise-info, #3b82f6)', letterSpacing: '0.6px', textTransform: 'uppercase' }}>
                            <FileText size={12} /> Covered by {group.bpa_rows.length} BPA{group.bpa_rows.length !== 1 ? 's' : ''}
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: ROW_GRID_COLS, gap: 8, padding: '8px 20px', background: 'rgba(15,23,42,0.03)', fontSize: 10, fontWeight: 700, color: 'var(--enterprise-gray-500)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                            <div style={{ textAlign: 'center' }}>BPA</div>
                            <div style={{ textAlign: 'center' }}>Customer</div>
                            <div style={{ textAlign: 'center' }}>Rev</div>
                            <div style={{ textAlign: 'center' }}>Blanket</div>
                            <div style={{ textAlign: 'center' }}>Released</div>
                            <div style={{ textAlign: 'center' }}>Delivered</div>
                            <div style={{ textAlign: 'center' }}>Pending</div>
                            <div style={{ textAlign: 'center' }}>Status</div>
                            <div style={{ textAlign: 'center' }}>Progress</div>
                            <div />
                        </div>
                        {group.bpa_rows.map((r, i) => (
                            <BPAUnderPartRow key={r.agreement_id + '-' + i} row={r}
                                onOpen={() => onOpenBPA(r.agreement_id)}
                                onCancelled={onCancelled}
                                onNavigate={onNavigate}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function BPAUnderPartRow({ row, onOpen, onCancelled, onNavigate }: { row: FulfillmentRowRich; onOpen: () => void; onCancelled: () => void; onNavigate?: (view: string) => void }) {
    const isInactive = row.agreement_status === 'CANCELLED' || row.agreement_status === 'EXPIRED';
    const pct = row.blanket_quantity > 0 ? (row.delivered_quantity / row.blanket_quantity) * 100 : 0;
    const done = pct >= 100;

    // Check if this BPA is expiring
    const today = new Date();
    const sixtyDaysOut = new Date(today.getTime() + 60 * 86400000);
    const isExpiring = (row.agreement_status === 'ACTIVE' || row.agreement_status === 'AMENDED')
        && row.effective_end_date
        && (() => { const end = new Date(row.effective_end_date!); return end >= today && end <= sixtyDaysOut; })();

    // Format date range
    const formatDate = (d: string | null) => {
        if (!d) return '—';
        try { return new Date(d).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); } catch { return '—'; }
    };
    const dateRange = `${formatDate(row.effective_start_date)} – ${formatDate(row.effective_end_date)}`;

    return (
        <div
            onClick={onOpen}
            style={{
                display: 'grid',
                gridTemplateColumns: ROW_GRID_COLS,
                gap: 8,
                padding: '12px 20px',
                borderTop: '1px solid var(--enterprise-gray-100)',
                alignItems: 'center',
                fontSize: 12,
                background: isExpiring ? 'rgba(220,38,38,0.03)' : 'white',
                cursor: 'pointer',
                transition: 'background 0.15s ease',
                opacity: isInactive ? 0.6 : 1,
                borderLeft: isExpiring ? '3px solid #dc2626' : '3px solid transparent',
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = isExpiring ? 'rgba(220,38,38,0.06)' : 'var(--enterprise-gray-50)'}
            onMouseLeave={(e) => e.currentTarget.style.background = isExpiring ? 'rgba(220,38,38,0.03)' : 'white'}
        >
            {/* BPA Number */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, minWidth: 0 }}>
                <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--enterprise-gray-900)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.agreement_number}</span>
            </div>
            {/* Customer */}
            <div style={{ minWidth: 0, textAlign: 'center' }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--enterprise-gray-800)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.customer_name}</div>
            </div>
            {/* Revision */}
            <div style={{ textAlign: 'center', fontFamily: 'monospace', color: 'var(--enterprise-gray-600)' }}>
                {row.agreement_revision ?? '—'}
            </div>
            {/* Blanket */}
            <div style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'monospace' }}>{Number(row.blanket_quantity).toLocaleString()}</div>
            {/* Released */}
            <div style={{ textAlign: 'center', fontWeight: 600, fontFamily: 'monospace', color: 'var(--enterprise-gray-700)' }}>{Number(row.released_quantity).toLocaleString()}</div>
            {/* Delivered */}
            <div style={{ textAlign: 'center', fontWeight: 700, fontFamily: 'monospace', color: 'var(--enterprise-success)' }}>{Number(row.delivered_quantity).toLocaleString()}</div>
            {/* Pending */}
            <div style={{ textAlign: 'center', fontWeight: 600, fontFamily: 'monospace', color: '#d97706' }}>{Number(row.pending_quantity).toLocaleString()}</div>
            {/* Status */}
            <div style={{ textAlign: 'center' }}>
                <StatusChip status={row.agreement_status as AgreementStatus} />
            </div>
            {/* Progress */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: 12, paddingRight: 16 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: done ? 'var(--enterprise-success)' : 'var(--enterprise-gray-700)', minWidth: 32, textAlign: 'right' }}>{pct.toFixed(0)}%</span>
                <div style={{ flex: 1, height: 6, background: 'var(--enterprise-gray-200)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: done ? 'var(--enterprise-success)' : 'var(--enterprise-info, #3b82f6)' }} />
                </div>
            </div>
            {/* Action / Arrow */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6, alignItems: 'center' }}>
                <div style={{ color: 'var(--enterprise-gray-400)' }}>
                    <ChevronRight size={14} />
                </div>
            </div>
        </div>
    );
}

function KPIInline({ label, value, sub, accent, mono, align = 'left' }: { label: string; value: string; sub?: string; accent?: 'success' | 'warning'; mono?: boolean; align?: 'left' | 'center' | 'right' }) {
    const color =
        accent === 'success' ? 'var(--enterprise-success)' :
            accent === 'warning' ? '#d97706' :
                'var(--enterprise-gray-900)';
    return (
        <div style={{ textAlign: align }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2 }}>{label}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color, fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</div>
            {sub && <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginTop: 1 }}>{sub}</div>}
        </div>
    );
}

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
