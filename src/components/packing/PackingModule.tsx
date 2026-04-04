/**
 * PackingModule — Sticker Generation Module (v9 — Refactored).
 *
 * PURPOSE: This module now serves SOLELY as a Sticker Generation interface.
 * 
 * REMOVED (v9):
 *   - Individual packing movement
 *   - Add box operation
 *   - Packing progress bar
 *   - Packing status bar
 *   - View button (row click opens detail)
 *
 * WORKFLOW:
 *   1. Stock Movement Module → Supervisor approves → record auto-appears here
 *   2. Click a record → auto-generates boxes based on Box Qty & Inner Qty/Box
 *   3. Print stickers (individual or batch)
 *   4. "Move to FG Warehouse" button enabled after all stickers printed
 *   5. Stock moves only after sticker printing is complete
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Card, ModuleLoader, EmptyState } from '../ui/EnterpriseUI';
import {
    SummaryCard, SummaryCardsGrid,
    FilterBar, ActionBar,
    SearchBox, StatusFilter, DateRangeFilter,
    ExportCSVButton, RefreshButton, Pagination, ClearFiltersButton
} from '../ui/SharedComponents';
import { Printer, CheckCircle2, Clock, PackageOpen, X, XCircle, AlertTriangle, Info } from 'lucide-react';
import { PackingDetail } from './PackingDetail';
import * as svc from './packingService';
import { PACKING_STATUS_CONFIG } from '../../types/packing';
import type { PackingRequest } from '../../types/packing';
import { getSupabaseClient } from '../../utils/supabase/client';

type UserRole = 'L1' | 'L2' | 'L3' | null;

interface PackingModuleProps {
    accessToken: string;
    userRole?: UserRole;
}

// ============================================================================
// STATUS BADGE
// ============================================================================

function StatusBadge({ status }: { status: string }) {
    const cfg = PACKING_STATUS_CONFIG[status as keyof typeof PACKING_STATUS_CONFIG] || {
        color: '#6b7280', bg: '#f3f4f6', label: status,
    };
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: '4px 10px', borderRadius: 12,
            backgroundColor: cfg.bg, color: cfg.color, fontSize: 11,
            fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase',
            border: `1px solid ${cfg.color}30`, minWidth: 95,
        }}>
            {cfg.label}
        </span>
    );
}



// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function PackingModule({ accessToken, userRole }: PackingModuleProps) {
    const supabase = getSupabaseClient();

    const [requests, setRequests] = useState<PackingRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRequest, setSelectedRequest] = useState<PackingRequest | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; title: string; text: string } | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showToast = useCallback((type: 'success' | 'error' | 'warning' | 'info', title: string, text: string, dur = 3000) => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ type, title, text });
        toastTimer.current = setTimeout(() => setToast(null), dur);
    }, []);
    const [statusFilter, setStatusFilter] = useState<string>('ALL');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [currentUserName, setCurrentUserName] = useState('');

    const PAGE_SIZE = 20;
    const [page, setPage] = useState(0);
    const [totalDbCount, setTotalDbCount] = useState(0);
    const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Fetch current user name
    useEffect(() => {
        const fetchUser = async () => {
            try {
                const { data: { session } } = await supabase.auth.getSession();
                if (session?.user?.id) {
                    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', session.user.id).single();
                    if (profile?.full_name) setCurrentUserName(profile.full_name);
                }
            } catch { /* ignore */ }
        };
        fetchUser();
    }, [supabase]);

    // Fetch packing requests — server-side paginated with filters + enrichment
    const fetchRequests = useCallback(async (offset = 0, statusOverride?: string) => {
        setLoading(true);
        try {
            const activeStatus = statusOverride ?? statusFilter;
            const sb = getSupabaseClient();

            // Build count query that respects current status filter
            let countQuery = sb
                .from('packing_requests')
                .select('id', { count: 'exact', head: true })
                .neq('status', 'REJECTED');
            if (activeStatus !== 'ALL') {
                countQuery = countQuery.eq('status', activeStatus);
            }
            const countResult = await countQuery;
            setTotalDbCount(countResult.count ?? 0);

            // Fetch data with server-side status filter
            let dataQuery = sb
                .from('packing_requests')
                .select('*')
                .neq('status', 'REJECTED');
            if (activeStatus !== 'ALL') {
                dataQuery = dataQuery.eq('status', activeStatus);
            }
            const { data, error: fetchErr } = await dataQuery
                .order('created_at', { ascending: false })
                .range(offset, offset + PAGE_SIZE - 1);
            if (fetchErr) throw fetchErr;

            const rows = data || [];
            if (rows.length === 0) { setRequests([]); return; }

            // ── ENRICHMENT: Fetch MSL from items + box counts from packing_boxes ──
            const itemCodes = [...new Set(rows.map((r: any) => r.item_code).filter(Boolean))];
            const requestIds = rows.map((r: any) => r.id);

            const [itemsResult, boxesResult] = await Promise.all([
                itemCodes.length
                    ? sb.from('items').select('item_code, item_name, master_serial_no').in('item_code', itemCodes)
                    : Promise.resolve({ data: [] as any[] }),
                requestIds.length
                    ? sb.from('packing_boxes').select('packing_request_id, box_qty').in('packing_request_id', requestIds)
                    : Promise.resolve({ data: [] as any[] }),
            ]);

            // Build item lookup: item_code → { item_name, master_serial_no }
            const itemMap: Record<string, { item_name: string; master_serial_no: string | null }> = {};
            (itemsResult.data || []).forEach((i: any) => {
                itemMap[i.item_code] = { item_name: i.item_name, master_serial_no: i.master_serial_no };
            });

            // Build box aggregate: packing_request_id → { count }
            const boxAgg: Record<string, number> = {};
            (boxesResult.data || []).forEach((b: any) => {
                boxAgg[b.packing_request_id] = (boxAgg[b.packing_request_id] || 0) + 1;
            });

            // Enrich rows with joined/computed fields
            const enriched = rows.map((r: any) => ({
                ...r,
                item_name: itemMap[r.item_code]?.item_name || r.item_code,
                master_serial_no: itemMap[r.item_code]?.master_serial_no || null,
                boxes_count: boxAgg[r.id] ?? null,
            }));

            setRequests(enriched);
        } catch (err) {
            console.error('Error fetching packing requests:', err);
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { fetchRequests(page * PAGE_SIZE); }, [fetchRequests, page]);
    // Reset to page 0 when status filter changes
    useEffect(() => { setPage(0); }, [statusFilter]);

    // Real-time subscription — debounced to avoid rapid-fire refetches
    useEffect(() => {
        const channel = supabase
            .channel('sticker-gen-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'packing_requests' }, () => {
                if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
                realtimeDebounce.current = setTimeout(() => fetchRequests(page * PAGE_SIZE), 1000);
            })
            .subscribe();
        return () => {
            if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
            supabase.removeChannel(channel);
        };
    }, [supabase, fetchRequests]);

    // ============================================================================
    // SUMMARY COUNTS — Independent backend aggregates (NEVER from paginated array)
    // ============================================================================

    const [summaryCounts, setSummaryCounts] = useState({ total: 0, awaiting: 0, inProgress: 0, completed: 0 });
    const fetchSummaryCounts = useCallback(async () => {
        try {
            const sb = getSupabaseClient();
            const [totalR, awaitingR, inProgressR, completedR] = await Promise.all([
                sb.from('packing_requests').select('id', { count: 'exact', head: true }).neq('status', 'REJECTED'),
                sb.from('packing_requests').select('id', { count: 'exact', head: true }).eq('status', 'APPROVED'),
                sb.from('packing_requests').select('id', { count: 'exact', head: true }).in('status', ['PACKING_IN_PROGRESS', 'PARTIALLY_TRANSFERRED']),
                sb.from('packing_requests').select('id', { count: 'exact', head: true }).eq('status', 'COMPLETED'),
            ]);
            setSummaryCounts({
                total: totalR.count ?? 0,
                awaiting: awaitingR.count ?? 0,
                inProgress: inProgressR.count ?? 0,
                completed: completedR.count ?? 0,
            });
        } catch { /* non-critical */ }
    }, []);
    useEffect(() => { fetchSummaryCounts(); }, [fetchSummaryCounts]);

    // ============================================================================
    // EXCEL EXPORT
    // ============================================================================

    const handleExport = () => {
        import('xlsx').then(XLSX => {
            const headers = ['Movement #', 'Item Code', 'MSN', 'Approved Qty', 'Boxes', 'Status', 'Created'];
            const rows = requests.map(r => ([
                r.movement_number, r.item_code, r.master_serial_no || '',
                r.total_packed_qty, r.boxes_count || 0,
                PACKING_STATUS_CONFIG[r.status]?.label || r.status,
                r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '',
            ]));
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Sticker Generation');
            XLSX.writeFile(wb, `sticker_generation_${new Date().toISOString().split('T')[0]}.xlsx`);
        });
    };

    // ============================================================================
    // DETAIL VIEW — when a request is selected
    // ============================================================================

    if (selectedRequest) {
        return (
            <PackingDetail
                requestId={selectedRequest.id}
                userRole={userRole ?? null}
                onBack={() => { setSelectedRequest(null); fetchRequests(); }}
                currentUserName={currentUserName}
            />
        );
    }

    // ============================================================================
    // TABLE STYLES
    // ============================================================================

    const headerCellStyle: React.CSSProperties = {
        padding: '11px 14px', textAlign: 'left', fontSize: 11,
        fontWeight: 700, color: '#374151', textTransform: 'uppercase',
        letterSpacing: '0.5px', borderBottom: '2px solid #e5e7eb',
        whiteSpace: 'nowrap', background: '#f9fafb',
    };
    const cellStyle: React.CSSProperties = {
        padding: '11px 14px', fontSize: 13, color: '#111827',
        borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap',
    };
    const btnStyle: React.CSSProperties = {
        padding: '6px 14px', borderRadius: 6, border: 'none',
        fontSize: 12, fontWeight: 600, cursor: 'pointer',
        transition: 'all 0.15s ease',
    };

    // ============================================================================
    // RENDER
    // ============================================================================

    // ── FIRST-LOAD: full-page skeleton ──
    if (loading && requests.length === 0) {
        return <ModuleLoader moduleName="Sticker Generation" icon={<Printer size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />;
    }

    return (
        <div style={{ paddingBottom: 40 }}>
            {/* Toast */}
            {toast && (
                <div style={{
                    position: 'fixed', top: '24px', right: '24px', zIndex: 9999,
                    padding: '16px 20px', borderRadius: '14px', maxWidth: '420px', minWidth: '320px',
                    background: toast.type === 'success' ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)'
                        : toast.type === 'error' ? 'linear-gradient(135deg, #fef2f2, #fee2e2)'
                            : toast.type === 'warning' ? 'linear-gradient(135deg, #fffbeb, #fef3c7)'
                                : 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                    border: `1.5px solid ${toast.type === 'success' ? '#86efac' : toast.type === 'error' ? '#fca5a5' : toast.type === 'warning' ? '#fcd34d' : '#93c5fd'}`,
                    boxShadow: '0 10px 40px rgba(0,0,0,0.12)', display: 'flex', alignItems: 'flex-start', gap: '12px',
                    animation: 'slideInDown 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                }}>
                    <div style={{
                        width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
                        background: toast.type === 'success' ? 'linear-gradient(135deg, #16a34a, #15803d)' : toast.type === 'error' ? 'linear-gradient(135deg, #dc2626, #b91c1c)' : toast.type === 'warning' ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        {toast.type === 'success' && <CheckCircle2 size={18} style={{ color: '#fff' }} />}
                        {toast.type === 'error' && <XCircle size={18} style={{ color: '#fff' }} />}
                        {toast.type === 'warning' && <AlertTriangle size={18} style={{ color: '#fff' }} />}
                        {toast.type === 'info' && <Info size={18} style={{ color: '#fff' }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: '13px', fontWeight: 800, color: toast.type === 'success' ? '#14532d' : toast.type === 'error' ? '#7f1d1d' : toast.type === 'warning' ? '#78350f' : '#1e3a5f', marginBottom: '2px' }}>{toast.title}</div>
                        <div style={{ fontSize: '12px', fontWeight: 500, lineHeight: '1.5', color: toast.type === 'success' ? '#166534' : toast.type === 'error' ? '#991b1b' : toast.type === 'warning' ? '#92400e' : '#1e40af' }}>{toast.text}</div>
                    </div>
                    <button onClick={() => { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '6px', display: 'flex', color: 'var(--enterprise-gray-400)' }}><X size={16} /></button>
                </div>
            )}
            {/* SUMMARY CARDS */}
            <SummaryCardsGrid>
                <SummaryCard
                    label="Total Records" value={summaryCounts.total}
                    icon={<PackageOpen size={22} style={{ color: '#1e3a8a' }} />} color="#1e3a8a" bgColor="#eff6ff"
                    isActive={statusFilter === 'ALL'} onClick={() => setStatusFilter('ALL')}
                />
                <SummaryCard
                    label="Awaiting Stickers" value={summaryCounts.awaiting}
                    icon={<Clock size={22} style={{ color: '#dc2626' }} />} color="#dc2626" bgColor="#fef2f2"
                    isActive={statusFilter === 'APPROVED'} onClick={() => setStatusFilter('APPROVED')}
                />
                <SummaryCard
                    label="In Progress" value={summaryCounts.inProgress}
                    icon={<Printer size={22} style={{ color: '#d97706' }} />} color="#d97706" bgColor="#fffbeb"
                    isActive={statusFilter === 'PACKING_IN_PROGRESS'} onClick={() => setStatusFilter('PACKING_IN_PROGRESS')}
                />
                <SummaryCard
                    label="Completed" value={summaryCounts.completed}
                    icon={<CheckCircle2 size={22} style={{ color: '#16a34a' }} />} color="#16a34a" bgColor="#f0fdf4"
                    isActive={statusFilter === 'COMPLETED'} onClick={() => setStatusFilter('COMPLETED')}
                />
            </SummaryCardsGrid>

            {/* FILTER BAR */}
            <FilterBar>
                <SearchBox
                    value={searchTerm}
                    onChange={v => { setSearchTerm(v); setPage(0); }}
                    placeholder="Search movement #, item, part #, MSN..."
                />

                <DateRangeFilter
                    dateFrom={dateFrom} dateTo={dateTo}
                    onDateFromChange={setDateFrom} onDateToChange={setDateTo}
                />

                <StatusFilter
                    value={statusFilter}
                    onChange={v => { setStatusFilter(v); setPage(0); }}
                    options={[
                        { value: 'ALL', label: 'All Status' },
                        { value: 'APPROVED', label: 'Pending' },
                        { value: 'PACKING_IN_PROGRESS', label: 'In Progress' },
                        { value: 'PARTIALLY_TRANSFERRED', label: 'Partial Transfer' },
                        { value: 'COMPLETED', label: 'Completed' },
                    ]}
                />

                <ActionBar>
                    {(statusFilter !== 'ALL' || dateFrom || dateTo) && (
                        <ClearFiltersButton onClick={() => { setStatusFilter('ALL'); setDateFrom(''); setDateTo(''); setPage(0); }} />
                    )}
                    <ExportCSVButton onClick={handleExport} />
                    <RefreshButton onClick={() => { fetchRequests(page * PAGE_SIZE).then(() => showToast('info', 'Refreshed', 'Data refreshed successfully.')); fetchSummaryCounts(); }} loading={loading} />
                </ActionBar>
            </FilterBar>

            {/* TABLE */}
            <Card style={{ padding: 0 }}>
                {loading && requests.length === 0 ? (
                    <ModuleLoader moduleName="Sticker Generation" icon={<Printer size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />
                ) : requests.length === 0 ? (
                    <EmptyState
                        icon={<PackageOpen size={48} style={{ color: 'var(--enterprise-gray-400)' }} />}
                        title="No Sticker Generation Records"
                        description="Approved stock movements will appear here automatically for sticker printing."
                    />
                ) : (
                    <>
                        <div className="table-responsive" style={{ overflowX: 'auto', opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s', pointerEvents: loading ? 'none' : 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                                <colgroup>
                                    <col style={{ width: '14%' }} />
                                    <col style={{ width: '22%' }} />
                                    <col style={{ width: '10%' }} />
                                    <col style={{ width: '14%' }} />
                                    <col style={{ width: '8%' }} />
                                    <col style={{ width: '14%' }} />
                                    <col style={{ width: '12%' }} />
                                </colgroup>
                                <thead>
                                    <tr>
                                        <th style={headerCellStyle}>Movement #</th>
                                        <th style={headerCellStyle}>Item</th>
                                        <th style={headerCellStyle}>MSN</th>
                                        <th style={{ ...headerCellStyle, textAlign: 'right' }}>Approved Qty</th>
                                        <th style={{ ...headerCellStyle, textAlign: 'center' }}>Boxes</th>
                                        <th style={{ ...headerCellStyle, textAlign: 'center' }}>Status</th>
                                        <th style={headerCellStyle}>Created</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {requests.map(r => {
                                        return (
                                            <tr key={r.id}
                                                onClick={() => setSelectedRequest(r)}
                                                style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                                                onMouseLeave={e => (e.currentTarget.style.background = '')}
                                            >
                                                <td style={{ ...cellStyle, fontWeight: 700, color: '#1e3a8a', fontFamily: 'monospace' }}>
                                                    {r.movement_number}
                                                </td>
                                                <td style={{ ...cellStyle, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                    <div style={{ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.item_name || r.item_code}</div>
                                                    <div style={{ fontSize: 11, color: '#6b7280' }}>{r.item_code}</div>
                                                </td>
                                                <td style={{ ...cellStyle, fontFamily: 'monospace', fontSize: 12 }}>
                                                    {r.master_serial_no || '—'}
                                                </td>
                                                <td style={{ ...cellStyle, fontWeight: 700, textAlign: 'right', fontFamily: 'monospace' }}>
                                                    {r.total_packed_qty} PCS
                                                </td>
                                                <td style={{ ...cellStyle, textAlign: 'center', fontWeight: 600 }}>
                                                    {r.boxes_count != null ? r.boxes_count : '—'}
                                                </td>
                                                <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                    <StatusBadge status={r.status} />
                                                </td>
                                                <td style={{ ...cellStyle, fontSize: 12, color: '#6b7280' }}>
                                                    {r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', {
                                                        day: '2-digit', month: 'short', year: 'numeric',
                                                    }) : '—'}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {requests.length > 0 && (
                            <Pagination
                                page={page}
                                pageSize={PAGE_SIZE}
                                totalCount={totalDbCount}
                                onPageChange={setPage}
                            />
                        )}
                    </>
                )}
            </Card>

            {/* Results Summary */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '12px',
                color: 'var(--enterprise-gray-600)',
                marginTop: '16px'
            }}>
                <span>
                    Total Records: {totalDbCount}
                </span>
            </div>

            {/* Spinner CSS */}
            <style>{`
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                @keyframes slideInDown { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
}
