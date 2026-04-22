/**
 * BPAList — Customer Agreement (BPA) list page.
 *
 * Follows the enterprise-UI pattern used across the app: SummaryCardsGrid +
 * ActionBar (SearchBox + FilterBar) + DataTable + Detail modal.
 *
 * Reads via `bpa_list` edge function. Write actions delegate to the
 * Create / Detail / Amend modals.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    FileText, CheckCircle, Edit, Clock, AlertCircle, XCircle,
    Plus, RefreshCw, Search,
} from 'lucide-react';
import {
    SummaryCard, SummaryCardsGrid, SearchBox, ActionButton, ActionBar, FilterBar,
    sharedThStyle, sharedTdStyle,
} from '../ui/SharedComponents';
import { Card } from '../ui/EnterpriseUI';
import { Badge } from '../ui/badge';
import { LoadingSpinner } from '../ui/EnterpriseUI';
import { listBPAs } from './bpaService';
import type { CustomerAgreement, AgreementStatus } from './types';
import { BPADetail } from './BPADetail';
import { BPACreate } from './BPACreate';

type CardFilter = 'ALL' | AgreementStatus;

interface Props {
    userRole?: string;
    userPerms?: Record<string, boolean>;
}

export function BPAList({ userRole, userPerms = {} }: Props) {
    const hasPerms = Object.keys(userPerms).length > 0;
    const canCreate = userRole === 'L3' || userRole === 'ADMIN'
        || (hasPerms ? userPerms['bpa.create'] === true : userRole === 'L2');

    const [agreements, setAgreements] = useState<CustomerAgreement[]>([]);
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
            const res = await listBPAs({
                page, page_size: pageSize,
                status_filter: cardFilter,
                search_term: search || undefined,
            });
            setAgreements(res.agreements);
            setTotalCount(res.total_count);
            setCounts(res.counts);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load BPAs');
        } finally {
            setLoading(false);
        }
    }, [page, pageSize, cardFilter, search]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    const statusBadge = (status: AgreementStatus) => {
        const variant = status === 'ACTIVE'    ? 'success'
                     : status === 'AMENDED'   ? 'warning'
                     : status === 'DRAFT'     ? 'neutral'
                     : status === 'EXPIRED'   ? 'neutral'
                     : 'danger';
        return <Badge variant={variant as any}>{status}</Badge>;
    };

    return (
        <div style={{ padding: '20px 24px' }}>
            {/* ── Page header ─────────────────────────────────────── */}
            <div style={{ marginBottom: '20px' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--enterprise-gray-900)' }}>
                    Blanket Purchase Agreements
                </h1>
                <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-600)', marginTop: '4px' }}>
                    Customer BPAs with blanket qty / MIN / MAX / REL MULT per part. Click a row to view details.
                </p>
            </div>

            {/* ── Summary cards ───────────────────────────────────── */}
            <SummaryCardsGrid>
                <SummaryCard label="Total"    value={counts.total}    icon={<FileText size={20} color="#6b7280" />}  color="#374151" bgColor="#f3f4f6"
                    isActive={cardFilter === 'ALL'}       onClick={() => { setCardFilter('ALL'); setPage(0); }} />
                <SummaryCard label="Active"   value={counts.active}   icon={<CheckCircle size={20} color="#16a34a" />} color="#16a34a" bgColor="#dcfce7"
                    isActive={cardFilter === 'ACTIVE'}    onClick={() => { setCardFilter('ACTIVE'); setPage(0); }} />
                <SummaryCard label="Amended"  value={counts.amended}  icon={<Edit size={20} color="#d97706" />}        color="#d97706" bgColor="#fef3c7"
                    isActive={cardFilter === 'AMENDED'}   onClick={() => { setCardFilter('AMENDED'); setPage(0); }} />
                <SummaryCard label="Draft"    value={counts.draft}    icon={<Clock size={20} color="#6366f1" />}       color="#6366f1" bgColor="#e0e7ff"
                    isActive={cardFilter === 'DRAFT'}     onClick={() => { setCardFilter('DRAFT'); setPage(0); }} />
                <SummaryCard label="Expired"  value={counts.expired}  icon={<AlertCircle size={20} color="#9ca3af" />} color="#6b7280" bgColor="#f3f4f6"
                    isActive={cardFilter === 'EXPIRED'}   onClick={() => { setCardFilter('EXPIRED'); setPage(0); }} />
                <SummaryCard label="Cancelled" value={counts.cancelled} icon={<XCircle size={20} color="#dc2626" />}   color="#dc2626" bgColor="#fee2e2"
                    isActive={cardFilter === 'CANCELLED'} onClick={() => { setCardFilter('CANCELLED'); setPage(0); }} />
            </SummaryCardsGrid>

            {/* ── Action bar ──────────────────────────────────────── */}
            <ActionBar>
                <SearchBox
                    value={search}
                    onChange={(v: string) => { setSearch(v); setPage(0); }}
                    placeholder="Search by agreement #, customer, buyer…"
                />
                <FilterBar>
                    <ActionButton label="Refresh" icon={<RefreshCw size={14} />} onClick={fetchData} spinning={loading} />
                    {canCreate && (
                        <ActionButton label="New BPA" icon={<Plus size={14} />} onClick={() => setShowCreate(true)} variant="primary" />
                    )}
                </FilterBar>
            </ActionBar>

            {/* ── Error banner ────────────────────────────────────── */}
            {error && (
                <Card style={{ background: '#fef2f2', borderLeft: '3px solid #dc2626', marginBottom: '12px' }}>
                    <div style={{ color: '#991b1b', fontSize: '13px' }}>⚠ {error}</div>
                </Card>
            )}

            {/* ── Table ───────────────────────────────────────────── */}
            <Card style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '60px' }}>
                        <LoadingSpinner size={32} />
                        <p style={{ color: 'var(--enterprise-gray-600)', fontSize: '13px', marginTop: '12px' }}>Loading agreements…</p>
                    </div>
                ) : agreements.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '60px' }}>
                        <Search size={32} style={{ color: 'var(--enterprise-gray-400)' }} />
                        <p style={{ marginTop: '12px', color: 'var(--enterprise-gray-600)' }}>
                            {search ? 'No agreements match your search.' : 'No agreements yet. Create the first one.'}
                        </p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: 'var(--enterprise-gray-50)', borderBottom: '1px solid var(--enterprise-gray-200)' }}>
                                    <th style={sharedThStyle}>Agreement #</th>
                                    <th style={sharedThStyle}>Rev</th>
                                    <th style={sharedThStyle}>Customer</th>
                                    <th style={sharedThStyle}>Buyer</th>
                                    <th style={sharedThStyle}>Effective</th>
                                    <th style={sharedThStyle}>Parts</th>
                                    <th style={sharedThStyle}>Value</th>
                                    <th style={sharedThStyle}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {agreements.map(a => (
                                    <tr key={a.id}
                                        style={{ borderBottom: '1px solid var(--enterprise-gray-100)', cursor: 'pointer' }}
                                        onClick={() => setDetailId(a.id)}
                                        onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--enterprise-gray-50)')}
                                        onMouseLeave={(e) => (e.currentTarget.style.background = 'white')}
                                    >
                                        <td style={{ ...sharedTdStyle, fontWeight: 600 }}>{a.agreement_number}</td>
                                        <td style={sharedTdStyle}>{a.agreement_revision}</td>
                                        <td style={sharedTdStyle}>{a.customer_name}</td>
                                        <td style={sharedTdStyle}>{a.buyer_name ?? '—'}</td>
                                        <td style={sharedTdStyle}>
                                            {new Date(a.effective_start_date).toLocaleDateString()} – {new Date(a.effective_end_date).toLocaleDateString()}
                                        </td>
                                        <td style={{ ...sharedTdStyle, textAlign: 'right' }}>{a.total_parts}</td>
                                        <td style={{ ...sharedTdStyle, textAlign: 'right' }}>
                                            {a.currency_code} {Number(a.total_blanket_value ?? 0).toLocaleString()}
                                        </td>
                                        <td style={sharedTdStyle}>{statusBadge(a.status)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {/* ── Pagination ──────────────────────────────────────── */}
            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', fontSize: '13px' }}>
                    <span style={{ color: 'var(--enterprise-gray-600)' }}>
                        Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalCount)} of {totalCount}
                    </span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <ActionButton label="Prev" icon={<></>} onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} />
                        <span style={{ padding: '8px 12px', color: 'var(--enterprise-gray-600)' }}>Page {page + 1} / {totalPages}</span>
                        <ActionButton label="Next" icon={<></>} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} />
                    </div>
                </div>
            )}

            {/* ── Modals ──────────────────────────────────────────── */}
            {detailId && (
                <BPADetail
                    agreementId={detailId}
                    onClose={() => setDetailId(null)}
                    onAmended={() => { setDetailId(null); fetchData(); }}
                    canAmend={userRole === 'L3' || userRole === 'ADMIN' || userRole === 'FINANCE' || userPerms['bpa.amend'] === true}
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
