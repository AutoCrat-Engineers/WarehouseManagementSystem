/**
 * ReleaseList — Customer release orders landing page.
 *
 * Shows blanket_releases + two CTA paths:
 *   • "By PO number" → paste Release PO (e.g. 260067252-10)
 *   • "By BPA"       → search BPA, pick pallets manually
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Calendar, CheckCircle, XCircle, Plus, RefreshCw, Package, Clipboard } from 'lucide-react';
import {
    SummaryCard, SummaryCardsGrid, SearchBox, ActionButton, ActionBar, FilterBar,
    sharedThStyle, sharedTdStyle,
} from '../ui/SharedComponents';
import { Card, LoadingSpinner } from '../ui/EnterpriseUI';
import { Badge } from '../ui/badge';
import { listReleases } from './releaseService';
import type { BlanketRelease, ReleaseStatus } from './types';
import { CreateReleaseByPO } from './CreateReleaseByPO';

type CardFilter = 'ALL' | ReleaseStatus;

interface Props {
    userRole?: string;
    userPerms?: Record<string, boolean>;
}

export function ReleaseList({ userRole, userPerms = {} }: Props) {
    const hasPerms = Object.keys(userPerms).length > 0;
    const canCreate = userRole === 'L3' || userRole === 'ADMIN'
        || (hasPerms ? userPerms['releases.create'] === true : userRole === 'L2');

    const [rows, setRows]       = useState<BlanketRelease[]>([]);
    const [counts, setCounts]   = useState({ total: 0, open: 0, fulfilled: 0, cancelled: 0 });
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState<string | null>(null);

    const [page, setPage]       = useState(0);
    const pageSize              = 25;
    const [totalCount, setTotalCount] = useState(0);
    const [filter, setFilter]   = useState<CardFilter>('ALL');
    const [search, setSearch]   = useState('');

    const [showCreate, setShowCreate] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const r = await listReleases({ page, page_size: pageSize, status_filter: filter, search_term: search || undefined });
            setRows(r.releases); setTotalCount(r.total_count);
            setCounts({
                total:     r.counts.total     ?? 0,
                open:      r.counts.open      ?? 0,
                fulfilled: r.counts.fulfilled ?? 0,
                cancelled: r.counts.cancelled ?? 0,
            });
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load');
        } finally {
            setLoading(false);
        }
    }, [page, filter, search]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    return (
        <div style={{ padding: '20px 24px' }}>
            <div style={{ marginBottom: '20px' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Blanket Releases</h1>
                <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-600)', marginTop: '4px' }}>
                    Customer PO releases. Paste a release PO (e.g. <code>260067252-10</code>) to start.
                </p>
            </div>

            <SummaryCardsGrid>
                <SummaryCard label="Total"     value={counts.total}     icon={<Calendar size={20} color="#374151" />}  color="#374151" bgColor="#f3f4f6"
                    isActive={filter === 'ALL'}       onClick={() => { setFilter('ALL'); setPage(0); }} />
                <SummaryCard label="Open"      value={counts.open}      icon={<Clipboard size={20} color="#2563eb" />} color="#2563eb" bgColor="#dbeafe"
                    isActive={filter === 'OPEN'}      onClick={() => { setFilter('OPEN'); setPage(0); }} />
                <SummaryCard label="Fulfilled" value={counts.fulfilled} icon={<CheckCircle size={20} color="#16a34a" />} color="#16a34a" bgColor="#dcfce7"
                    isActive={filter === 'FULFILLED'} onClick={() => { setFilter('FULFILLED'); setPage(0); }} />
                <SummaryCard label="Cancelled" value={counts.cancelled} icon={<XCircle size={20} color="#dc2626" />}   color="#dc2626" bgColor="#fee2e2"
                    isActive={filter === 'CANCELLED'} onClick={() => { setFilter('CANCELLED'); setPage(0); }} />
            </SummaryCardsGrid>

            <ActionBar>
                <SearchBox value={search} onChange={(v: string) => { setSearch(v); setPage(0); }}
                    placeholder="Search by release #, PO base, buyer…" />
                <FilterBar>
                    <ActionButton label="Refresh" icon={<RefreshCw size={14} />} onClick={fetchData} spinning={loading} />
                    {canCreate && (
                        <ActionButton label="New Release" icon={<Plus size={14} />} onClick={() => setShowCreate(true)} variant="primary" />
                    )}
                </FilterBar>
            </ActionBar>

            {error && <Card style={{ background: '#fef2f2', marginBottom: 12 }}><div style={{ color: '#991b1b', fontSize: 13 }}>⚠ {error}</div></Card>}

            <Card style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: 60 }}>
                        <LoadingSpinner size={32} />
                        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--enterprise-gray-600)' }}>Loading releases…</p>
                    </div>
                ) : rows.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: 60 }}>
                        <Package size={32} style={{ color: 'var(--enterprise-gray-400)' }} />
                        <p style={{ marginTop: 12, color: 'var(--enterprise-gray-600)' }}>
                            {search ? 'No releases match your search.' : 'No releases yet. Paste a PO to start.'}
                        </p>
                    </div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: 'var(--enterprise-gray-50)', borderBottom: '1px solid var(--enterprise-gray-200)' }}>
                                    <th style={sharedThStyle}>Release #</th>
                                    <th style={sharedThStyle}>PO Base</th>
                                    <th style={sharedThStyle}>Seq</th>
                                    <th style={sharedThStyle}>Buyer</th>
                                    <th style={sharedThStyle}>Requested Qty</th>
                                    <th style={sharedThStyle}>Need By</th>
                                    <th style={sharedThStyle}>Status</th>
                                    <th style={sharedThStyle}>Created</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(r => (
                                    <tr key={r.id} style={{ borderBottom: '1px solid var(--enterprise-gray-100)' }}>
                                        <td style={{ ...sharedTdStyle, fontWeight: 600 }}>{r.release_number}</td>
                                        <td style={sharedTdStyle}>{r.customer_po_base ?? '—'}</td>
                                        <td style={{ ...sharedTdStyle, textAlign: 'center' }}>{r.release_sequence ?? '—'}</td>
                                        <td style={sharedTdStyle}>{r.buyer_name ?? '—'}</td>
                                        <td style={{ ...sharedTdStyle, textAlign: 'right' }}>{Number(r.requested_quantity).toLocaleString()}</td>
                                        <td style={sharedTdStyle}>{r.need_by_date ? new Date(r.need_by_date).toLocaleDateString() : '—'}</td>
                                        <td style={sharedTdStyle}>
                                            <Badge variant={(r.status === 'FULFILLED' ? 'success' : r.status === 'CANCELLED' ? 'danger' : 'neutral') as any}>{r.status}</Badge>
                                        </td>
                                        <td style={sharedTdStyle}>{new Date(r.created_at).toLocaleDateString()}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, fontSize: 13 }}>
                    <span style={{ color: 'var(--enterprise-gray-600)' }}>
                        Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalCount)} of {totalCount}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <ActionButton label="Prev" icon={<></>} onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} />
                        <span style={{ padding: '8px 12px', color: 'var(--enterprise-gray-600)' }}>Page {page + 1} / {totalPages}</span>
                        <ActionButton label="Next" icon={<></>} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} />
                    </div>
                </div>
            )}

            {showCreate && (
                <CreateReleaseByPO
                    onClose={() => setShowCreate(false)}
                    onCreated={() => { setShowCreate(false); fetchData(); }}
                />
            )}
        </div>
    );
}
