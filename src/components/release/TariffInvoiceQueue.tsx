/**
 * TariffInvoiceQueue — Finance queue for tariff invoices.
 *
 * Shows DRAFT / SUBMITTED / CLAIMED / PAID tabs with per-row Compute + Submit
 * actions. Freezes rates into calculation_snapshot on compute (audit-safe).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { FileText, CheckCircle, Clock, DollarSign, XCircle, RefreshCw, Calculator, Send } from 'lucide-react';
import {
    SummaryCard, SummaryCardsGrid, SearchBox, ActionButton, ActionBar, FilterBar,
    sharedThStyle, sharedTdStyle,
} from '../ui/SharedComponents';
import { Card, LoadingSpinner } from '../ui/EnterpriseUI';
import { Badge } from '../ui/badge';
import { Button } from '../ui/button';
import { listTariffInvoices, computeTariff, submitTariff } from './releaseService';
import type { TariffInvoice, TariffStatus } from './types';

type CardFilter = 'ALL' | TariffStatus;

interface Props {
    userRole?: string;
    userPerms?: Record<string, boolean>;
}

export function TariffInvoiceQueue({ userRole, userPerms = {} }: Props) {
    const hasPerms = Object.keys(userPerms).length > 0;
    const canSubmit = userRole === 'L3' || userRole === 'ADMIN' || userRole === 'FINANCE'
        || (hasPerms ? userPerms['tariff.submit'] === true : false);

    const [rows, setRows] = useState<TariffInvoice[]>([]);
    const [counts, setCounts] = useState({ total: 0, draft: 0, submitted: 0, claimed: 0, paid: 0 });
    const [pageTotal, setPageTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [filter, setFilter] = useState<CardFilter>('DRAFT');
    const [search, setSearch] = useState('');
    const [page, setPage] = useState(0);
    const pageSize = 25;
    const [totalCount, setTotalCount] = useState(0);

    const [busy, setBusy] = useState<Record<string, boolean>>({});

    const fetchData = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const r = await listTariffInvoices({ page, page_size: pageSize, status_filter: filter, search_term: search || undefined });
            setRows(r.tariffs); setTotalCount(r.total_count); setPageTotal(r.page_total_value ?? 0);
            setCounts({
                total:     r.counts.total     ?? 0,
                draft:     r.counts.draft     ?? 0,
                submitted: r.counts.submitted ?? 0,
                claimed:   r.counts.claimed   ?? 0,
                paid:      r.counts.paid      ?? 0,
            });
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load');
        } finally {
            setLoading(false);
        }
    }, [filter, page, search]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const setRowBusy = (id: string, v: boolean) => setBusy(b => ({ ...b, [id]: v }));

    const onCompute = async (t: TariffInvoice) => {
        setRowBusy(t.id, true);
        try {
            await computeTariff({ tariff_invoice_id: t.id });
            await fetchData();
        } catch (e: any) {
            alert(e?.message ?? 'Compute failed');
        } finally { setRowBusy(t.id, false); }
    };

    const onAdvance = async (t: TariffInvoice, target: 'SUBMITTED' | 'CLAIMED' | 'PAID' | 'CANCELLED') => {
        if (!canSubmit) return alert('Finance / ADMIN role required');
        setRowBusy(t.id, true);
        try {
            await submitTariff({ tariff_invoice_id: t.id, target_status: target, expected_row_version: t.row_version });
            await fetchData();
        } catch (e: any) {
            alert(e?.message ?? 'Action failed');
        } finally { setRowBusy(t.id, false); }
    };

    const badge = (s: TariffStatus) => {
        const variant = s === 'PAID' ? 'success' : s === 'CLAIMED' ? 'success' : s === 'SUBMITTED' ? 'warning' : s === 'CANCELLED' ? 'danger' : 'neutral';
        return <Badge variant={variant as any}>{s}</Badge>;
    };

    const nextActionFor = (t: TariffInvoice): { target: 'SUBMITTED' | 'CLAIMED' | 'PAID' | 'CANCELLED'; label: string } | null => {
        switch (t.status) {
            case 'DRAFT':     return { target: 'SUBMITTED', label: 'Submit to Broker' };
            case 'SUBMITTED': return { target: 'CLAIMED',   label: 'Mark Claimed' };
            case 'CLAIMED':   return { target: 'PAID',      label: 'Mark Paid' };
            default:          return null;
        }
    };

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    return (
        <div style={{ padding: '20px 24px' }}>
            <div style={{ marginBottom: 20 }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Tariff Invoices</h1>
                <p style={{ fontSize: 13, color: 'var(--enterprise-gray-600)', marginTop: 4 }}>
                    US tariff claims per sub-invoice. Compute rates, submit to broker, track through to PAID.
                </p>
            </div>

            <SummaryCardsGrid>
                <SummaryCard label="All"       value={counts.total}     icon={<FileText size={20} color="#374151" />}  color="#374151" bgColor="#f3f4f6"
                    isActive={filter === 'ALL'}       onClick={() => { setFilter('ALL'); setPage(0); }} />
                <SummaryCard label="Draft"     value={counts.draft}     icon={<Clock size={20} color="#6366f1" />}     color="#6366f1" bgColor="#e0e7ff"
                    isActive={filter === 'DRAFT'}     onClick={() => { setFilter('DRAFT'); setPage(0); }} />
                <SummaryCard label="Submitted" value={counts.submitted} icon={<Send size={20} color="#d97706" />}      color="#d97706" bgColor="#fef3c7"
                    isActive={filter === 'SUBMITTED'} onClick={() => { setFilter('SUBMITTED'); setPage(0); }} />
                <SummaryCard label="Claimed"   value={counts.claimed}   icon={<CheckCircle size={20} color="#2563eb" />} color="#2563eb" bgColor="#dbeafe"
                    isActive={filter === 'CLAIMED'}   onClick={() => { setFilter('CLAIMED'); setPage(0); }} />
                <SummaryCard label="Paid"      value={counts.paid}      icon={<DollarSign size={20} color="#16a34a" />} color="#16a34a" bgColor="#dcfce7"
                    isActive={filter === 'PAID'}      onClick={() => { setFilter('PAID'); setPage(0); }} />
                <SummaryCard label="Cancelled" value={(counts.total - counts.draft - counts.submitted - counts.claimed - counts.paid) || 0} icon={<XCircle size={20} color="#dc2626" />} color="#dc2626" bgColor="#fee2e2" />
            </SummaryCardsGrid>

            <ActionBar>
                <SearchBox value={search} onChange={(v: string) => { setSearch(v); setPage(0); }} placeholder="Search by tariff # / sub-invoice # / part…" />
                <FilterBar>
                    <ActionButton label="Refresh" icon={<RefreshCw size={14} />} onClick={fetchData} spinning={loading} />
                </FilterBar>
            </ActionBar>

            {error && <Card style={{ background: '#fef2f2', color: '#991b1b', marginBottom: 12 }}>⚠ {error}</Card>}

            <Card style={{ padding: 0, overflow: 'hidden' }}>
                {loading ? (
                    <div style={{ padding: 60, textAlign: 'center' }}><LoadingSpinner size={32} /></div>
                ) : rows.length === 0 ? (
                    <div style={{ padding: 60, textAlign: 'center', color: 'var(--enterprise-gray-500)' }}>No tariff invoices in scope.</div>
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr style={{ background: 'var(--enterprise-gray-50)' }}>
                                    <th style={sharedThStyle}>Tariff #</th>
                                    <th style={sharedThStyle}>Sub-Invoice #</th>
                                    <th style={sharedThStyle}>Part</th>
                                    <th style={sharedThStyle}>Date</th>
                                    <th style={sharedThStyle}>Qty</th>
                                    <th style={sharedThStyle}>Invoice Value</th>
                                    <th style={sharedThStyle}>Unit Tariff</th>
                                    <th style={sharedThStyle}>Total Tariff</th>
                                    <th style={sharedThStyle}>Status</th>
                                    <th style={sharedThStyle}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {rows.map(t => {
                                    const next = nextActionFor(t);
                                    const rowBusy = busy[t.id];
                                    return (
                                        <tr key={t.id} style={{ borderBottom: '1px solid var(--enterprise-gray-100)' }}>
                                            <td style={{ ...sharedTdStyle, fontWeight: 600 }}>{t.tariff_invoice_number}</td>
                                            <td style={sharedTdStyle}>{t.sub_invoice_number ?? '—'}</td>
                                            <td style={sharedTdStyle}>{t.msn_code} <span style={{ color: 'var(--enterprise-gray-500)' }}>({t.part_number})</span></td>
                                            <td style={sharedTdStyle}>{new Date(t.tariff_invoice_date).toLocaleDateString()}</td>
                                            <td style={{ ...sharedTdStyle, textAlign: 'right' }}>{t.quantity.toLocaleString()}</td>
                                            <td style={{ ...sharedTdStyle, textAlign: 'right' }}>{t.currency_code} {Number(t.invoice_value).toLocaleString()}</td>
                                            <td style={{ ...sharedTdStyle, textAlign: 'right' }}>{t.unit_tariff != null ? Number(t.unit_tariff).toFixed(4) : '—'}</td>
                                            <td style={{ ...sharedTdStyle, textAlign: 'right', fontWeight: 600 }}>{t.total_tariff != null ? Number(t.total_tariff).toLocaleString() : '—'}</td>
                                            <td style={sharedTdStyle}>{badge(t.status)}</td>
                                            <td style={{ ...sharedTdStyle, display: 'flex', gap: 4 }}>
                                                {t.status === 'DRAFT' && (
                                                    <Button variant="outline" onClick={() => onCompute(t)} disabled={rowBusy}>
                                                        <Calculator size={12} style={{ marginRight: 4 }} />
                                                        {rowBusy ? '…' : 'Compute'}
                                                    </Button>
                                                )}
                                                {next && (
                                                    <Button onClick={() => onAdvance(t, next.target)} disabled={rowBusy || !canSubmit}>
                                                        {rowBusy ? '…' : next.label}
                                                    </Button>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, fontSize: 13 }}>
                <span style={{ color: 'var(--enterprise-gray-600)' }}>
                    Page total: <strong>{pageTotal.toLocaleString()}</strong>
                </span>
                {totalPages > 1 && (
                    <div style={{ display: 'flex', gap: 8 }}>
                        <ActionButton label="Prev" icon={<></>} onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} />
                        <span style={{ padding: '8px 12px', color: 'var(--enterprise-gray-600)' }}>Page {page + 1} / {totalPages}</span>
                        <ActionButton label="Next" icon={<></>} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} />
                    </div>
                )}
            </div>
        </div>
    );
}
