/**
 * PackingModule — FG Packing Workflow (v8 — Standardized UI + Export CSV + Pagination + MSN Search).
 *
 * Matches the card pattern used by StockMovement, ItemMaster, InventoryGrid.
 * Summary cards at top, filter bar with date pickers, responsive table.
 * Only the View button navigates — row click disabled.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/EnterpriseUI';
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
// SUMMARY CARD (same pattern as StockMovement / ItemMaster / InventoryGrid)
// ============================================================================

interface SummaryCardProps {
    label: string;
    value: number;
    icon: React.ReactNode;
    color: string;
    bgColor: string;
    isActive?: boolean;
    onClick?: () => void;
}

function SummaryCard({ label, value, icon, color, bgColor, isActive = false, onClick }: SummaryCardProps) {
    return (
        <div onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default', transition: 'all 0.2s ease' }}>
            <Card style={{
                border: isActive ? `2px solid ${color}` : '1px solid var(--enterprise-gray-200)',
                boxShadow: isActive ? `0 0 0 3px ${bgColor}` : 'var(--shadow-sm)',
            }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div>
                        <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-600)', fontWeight: 500, marginBottom: '6px' }}>
                            {label}
                        </p>
                        <p style={{ fontSize: '1.75rem', fontWeight: 700, color }}>{value}</p>
                    </div>
                    <div style={{
                        width: '44px', height: '44px', borderRadius: '8px', backgroundColor: bgColor,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        {icon}
                    </div>
                </div>
            </Card>
        </div>
    );
}

// Simple SVG icons
const IconAll = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#1e3a8a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
    </svg>
);
const IconOpen = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#2563eb" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
    </svg>
);
const IconProgress = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 2v4m0 12v4M4.93 4.93l2.83 2.83m8.48 8.48 2.83 2.83M2 12h4m12 0h4M4.93 19.07l2.83-2.83m8.48-8.48 2.83-2.83" />
    </svg>
);
const IconCompleted = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
);
const IconPartial = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
);
const IconEye = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
    </svg>
);
const IconCancelled = () => (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
);

// ============================================================================
// CONSTANTS
// ============================================================================
const PAGE_SIZE = 20;

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function PackingModule({ accessToken, userRole }: PackingModuleProps) {
    const isOperator = userRole === 'L1';
    const supabase = getSupabaseClient();

    const [requests, setRequests] = useState<PackingRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('ALL');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [currentUserName, setCurrentUserName] = useState('');
    const [selectedRequest, setSelectedRequest] = useState<PackingRequest | null>(null);

    // Pagination
    const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

    const loadRequests = useCallback(async () => {
        setLoading(true);
        try {
            const data = await svc.fetchPackingRequests(isOperator);
            setRequests(data);
        } catch (err: any) { console.error('Failed to load packing requests:', err); }
        finally { setLoading(false); }
    }, [isOperator]);

    useEffect(() => { loadRequests(); }, [loadRequests]);

    useEffect(() => {
        const fetchUser = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user?.id) {
                const { data: p } = await supabase.from('profiles').select('full_name').eq('id', session.user.id).single();
                if (p?.full_name) setCurrentUserName(p.full_name);
            }
        };
        fetchUser();
    }, [supabase]);

    const filtered = requests.filter(r => {
        const term = searchTerm.toLowerCase();
        const matchSearch = !searchTerm ||
            r.movement_number.toLowerCase().includes(term) ||
            r.item_code.toLowerCase().includes(term) ||
            (r.item_name || '').toLowerCase().includes(term) ||
            (r.part_number || '').toLowerCase().includes(term) ||
            (r.master_serial_no || '').toLowerCase().includes(term);
        const matchStatus = statusFilter === 'ALL' || r.status === statusFilter;
        // Date filter
        let matchDate = true;
        if (dateFrom || dateTo) {
            const createdDate = new Date(r.created_at).toISOString().split('T')[0];
            if (dateFrom && createdDate < dateFrom) matchDate = false;
            if (dateTo && createdDate > dateTo) matchDate = false;
        }
        return matchSearch && matchStatus && matchDate;
    });

    // Reset pagination when filters change
    useEffect(() => {
        setDisplayCount(PAGE_SIZE);
    }, [searchTerm, statusFilter, dateFrom, dateTo]);

    // Paginated results
    const displayedRequests = filtered.slice(0, displayCount);
    const hasMore = displayCount < filtered.length;

    const counts = {
        ALL: requests.length,
        APPROVED: requests.filter(r => r.status === 'APPROVED').length,
        PACKING_IN_PROGRESS: requests.filter(r => r.status === 'PACKING_IN_PROGRESS').length,
        PARTIALLY_TRANSFERRED: requests.filter(r => r.status === 'PARTIALLY_TRANSFERRED').length,
        COMPLETED: requests.filter(r => r.status === 'COMPLETED').length,
        REJECTED: requests.filter(r => r.status === 'REJECTED').length,
    };

    // Export CSV handler
    const handleExportCSV = () => {
        const header = 'Movement #,MSL No,Rev,Qty,Boxes,Packed,Transferred,Status,Operator,Date\n';
        const rows = filtered.map(r => {
            const sc = PACKING_STATUS_CONFIG[r.status];
            const packedQty = r.boxes_packed_qty || 0;
            const xferQty = r.transferred_qty || 0;
            return [
                r.movement_number,
                r.master_serial_no || '',
                r.revision || '',
                r.total_packed_qty,
                r.status !== 'REJECTED' ? (r.boxes_count || 0) : '',
                r.status !== 'REJECTED' ? `${packedQty} / ${r.total_packed_qty}` : '',
                r.status !== 'REJECTED' ? `${xferQty} / ${r.total_packed_qty}` : '',
                sc.label,
                r.created_by_name || '',
                new Date(r.created_at).toLocaleDateString('en-IN'),
            ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
        }).join('\n');
        const blob = new Blob([header + rows], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `packing_export_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    if (selectedRequest) {
        return (
            <PackingDetail
                requestId={selectedRequest.id}
                userRole={userRole || null}
                onBack={() => { setSelectedRequest(null); loadRequests(); }}
                currentUserName={currentUserName}
            />
        );
    }

    const thStyle: React.CSSProperties = {
        padding: '10px 8px', textAlign: 'left' as const,
        fontSize: 11, fontWeight: 600,
        color: 'var(--enterprise-gray-700, #374151)',
        textTransform: 'uppercase' as const, letterSpacing: '0.5px',
        whiteSpace: 'nowrap',
    };
    const tdStyle: React.CSSProperties = {
        padding: '10px 8px',
        fontSize: 13,
        color: 'var(--enterprise-gray-800, #111827)',
        verticalAlign: 'middle',
    };


    const CalendarIcon = () => (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, pointerEvents: 'none' }}>
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
    );

    return (
        <div>
            {/* ─── SUMMARY CARDS ─── */}
            <div className="summary-cards-grid" style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: '16px', marginBottom: '20px',
            }}>
                <SummaryCard
                    label="Total Requests" value={counts.ALL}
                    icon={<IconAll />}
                    color="#1e3a8a" bgColor="rgba(30,58,138,0.1)"
                    isActive={statusFilter === 'ALL'} onClick={() => setStatusFilter('ALL')}
                />
                <SummaryCard
                    label="Open" value={counts.APPROVED}
                    icon={<IconOpen />}
                    color="#2563eb" bgColor="rgba(37,99,235,0.1)"
                    isActive={statusFilter === 'APPROVED'} onClick={() => setStatusFilter('APPROVED')}
                />
                <SummaryCard
                    label="In Progress" value={counts.PACKING_IN_PROGRESS + counts.PARTIALLY_TRANSFERRED}
                    icon={<IconProgress />}
                    color="#d97706" bgColor="rgba(217,119,6,0.1)"
                    isActive={statusFilter === 'PACKING_IN_PROGRESS'} onClick={() => setStatusFilter('PACKING_IN_PROGRESS')}
                />
                <SummaryCard
                    label="Completed" value={counts.COMPLETED}
                    icon={<IconCompleted />}
                    color="#16a34a" bgColor="rgba(22,163,74,0.1)"
                    isActive={statusFilter === 'COMPLETED'} onClick={() => setStatusFilter('COMPLETED')}
                />
                <SummaryCard
                    label="Cancelled" value={counts.REJECTED}
                    icon={<IconCancelled />}
                    color="#dc2626" bgColor="rgba(220,38,38,0.1)"
                    isActive={statusFilter === 'REJECTED'} onClick={() => setStatusFilter('REJECTED')}
                />
            </div>

            {/* ─── INFO NOTE ─── */}
            <div style={{
                padding: '10px 16px', borderRadius: 6, marginBottom: 16,
                background: 'var(--enterprise-gray-50, #fafafa)',
                border: '1px solid var(--enterprise-gray-200, #e5e7eb)',
                color: 'var(--enterprise-gray-700, #374151)', fontSize: 13, lineHeight: 1.6,
            }}>
                Packing requests are auto-created when a <b>Production Receipt</b> stock movement is approved.
                Stock remains in <b>Production</b> until the operator packs boxes and explicitly transfers stock to <b>Prod WHSE</b>.
                Partial transfers are supported.
            </div>

            {/* ─── FILTER BAR ─── */}
            <div className="filter-bar" style={{
                display: 'flex', alignItems: 'center', marginBottom: '16px', gap: '12px', flexWrap: 'wrap',
                background: 'white', padding: '10px 16px', borderRadius: '8px',
                border: '1px solid var(--enterprise-gray-200, #e5e7eb)',
            }}>
                {/* Search — includes MSN */}
                <div style={{
                    display: 'flex', alignItems: 'center',
                    background: 'var(--enterprise-gray-50, #f9fafb)',
                    border: '1px solid var(--enterprise-gray-300, #d1d5db)',
                    borderRadius: '6px', padding: '8px 12px', flex: 1, minWidth: '260px',
                }}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--enterprise-gray-400, #9ca3af)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: 10, flexShrink: 0 }}>
                        <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                    <input
                        type="text" placeholder="Search by movement #, part number, MSN, item..."
                        value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                        style={{
                            border: 'none', outline: 'none', flex: 1, fontSize: '13px',
                            color: 'var(--enterprise-gray-800, #111827)', background: 'transparent', minWidth: '180px',
                        }}
                    />
                    {searchTerm && (
                        <button onClick={() => setSearchTerm('')} style={{
                            background: 'var(--enterprise-gray-200, #e5e7eb)', border: 'none',
                            cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center',
                            borderRadius: '4px', marginLeft: '8px',
                        }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--enterprise-gray-600, #4b5563)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    )}
                </div>

                {/* Date Range — Combined pill (matches StockMovement reference) */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: '0px',
                    height: '36px', borderRadius: '6px',
                    border: `1px solid ${(dateFrom || dateTo) ? '#93c5fd' : 'var(--enterprise-gray-300, #d1d5db)'}`,
                    background: (dateFrom || dateTo) ? '#eff6ff' : 'white',
                    transition: 'background 0.2s, border-color 0.2s',
                    flexShrink: 0, overflow: 'hidden',
                }}>
                    {/* From date */}
                    <div
                        style={{
                            position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '5px',
                            padding: '0 12px', height: '100%', cursor: 'pointer',
                            transition: 'background 0.15s ease',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = dateFrom ? '#dbeafe' : '#f3f4f6'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                        <CalendarIcon />
                        <span style={{ fontSize: '13px', fontWeight: 500, color: dateFrom ? 'var(--enterprise-gray-700, #374151)' : 'var(--enterprise-gray-500, #6b7280)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                            {dateFrom ? new Date(dateFrom + 'T00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'From'}
                        </span>
                        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                            title="From date"
                            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                        />
                    </div>
                    <div style={{ width: '1px', height: '18px', background: '#d1d5db', flexShrink: 0 }} />
                    {/* To date */}
                    <div
                        style={{
                            position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '5px',
                            padding: '0 12px', height: '100%', cursor: 'pointer',
                            transition: 'background 0.15s ease',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.background = dateTo ? '#dbeafe' : '#f3f4f6'; }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                    >
                        <CalendarIcon />
                        <span style={{ fontSize: '13px', fontWeight: 500, color: dateTo ? 'var(--enterprise-gray-700, #374151)' : 'var(--enterprise-gray-500, #6b7280)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                            {dateTo ? new Date(dateTo + 'T00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : 'To'}
                        </span>
                        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                            title="To date"
                            style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
                        />
                    </div>
                    {(dateFrom || dateTo) && (
                        <button
                            onClick={() => { setDateFrom(''); setDateTo(''); }}
                            style={{
                                background: 'none', border: 'none', cursor: 'pointer', padding: '0 10px',
                                display: 'flex', alignItems: 'center', borderRadius: '0', flexShrink: 0,
                                height: '100%', transition: 'background 0.15s ease',
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = '#fee2e2'; }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                            title="Clear date filter"
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                        </button>
                    )}
                </div>

                {/* Status dropdown — same height/style */}
                <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    style={{
                        padding: '8px 32px 8px 12px', borderRadius: '6px',
                        border: '1px solid var(--enterprise-gray-300, #d1d5db)', fontSize: '13px',
                        fontWeight: 500,
                        color: 'var(--enterprise-gray-800, #111827)',
                        background: 'white',
                        cursor: 'pointer', outline: 'none',
                        appearance: 'none' as const,
                        backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%236b7280\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E")',
                        backgroundRepeat: 'no-repeat', backgroundPosition: 'right 10px center',
                    }}
                >
                    <option value="ALL">All Statuses</option>
                    <option value="APPROVED">Open</option>
                    <option value="PACKING_IN_PROGRESS">In Progress</option>
                    <option value="PARTIALLY_TRANSFERRED">Partial Transfer</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="REJECTED">Cancelled</option>
                </select>

                {/* Clear filters — only when active */}
                {(searchTerm || statusFilter !== 'ALL' || dateFrom || dateTo) && (
                    <button
                        onClick={() => { setSearchTerm(''); setStatusFilter('ALL'); setDateFrom(''); setDateTo(''); }}
                        style={{
                            padding: '8px 12px', borderRadius: '6px',
                            border: '1px solid #dc2626',
                            background: 'white', color: '#dc2626', fontSize: '13px',
                            fontWeight: 500, cursor: 'pointer',
                            display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap',
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
                        </svg>
                        Clear
                    </button>
                )}

                {/* Export CSV */}
                <button
                    onClick={handleExportCSV}
                    style={{
                        padding: '8px 14px', borderRadius: '6px',
                        border: '1px solid var(--enterprise-gray-300, #d1d5db)',
                        background: 'white', cursor: 'pointer', fontSize: '13px',
                        fontWeight: 500,
                        color: 'var(--enterprise-gray-700, #374151)',
                        display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap',
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    Export CSV
                </button>

                {/* Refresh */}
                <button
                    onClick={() => loadRequests()}
                    style={{
                        padding: '8px 14px', borderRadius: '6px',
                        border: '1px solid var(--enterprise-gray-300, #d1d5db)',
                        background: 'white', cursor: 'pointer', fontSize: '13px',
                        fontWeight: 500,
                        color: 'var(--enterprise-gray-700, #374151)',
                        display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap',
                    }}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }}>
                        <polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" />
                        <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                    </svg>
                    Refresh
                </button>
            </div>

            {/* ─── TABLE ─── */}
            <Card style={{ padding: 0 }}>
                {loading ? (
                    <div style={{ padding: 60, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ animation: 'spin 1s linear infinite', display: 'block', margin: '0 auto 12px' }}>
                            <path d="M21 12a9 9 0 1 1-6.219-8.56" />
                        </svg>
                        Loading packing requests...
                    </div>
                ) : filtered.length === 0 ? (
                    <div style={{ padding: 60, textAlign: 'center', color: '#9ca3af' }}>
                        <p style={{ fontSize: 14, fontWeight: 500, margin: 0 }}>
                            {requests.length === 0
                                ? 'No packing requests. Create a Production Receipt in Stock Movements to generate one.'
                                : 'No requests match your filter.'}
                        </p>
                    </div>
                ) : (
                    <>
                        <div className="table-responsive" style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{
                                        background: 'var(--enterprise-gray-50, #f9fafb)',
                                        borderBottom: '2px solid var(--enterprise-gray-200, #e5e7eb)',
                                    }}>
                                        <th style={{ ...thStyle, paddingLeft: 16 }}>Movement #</th>
                                        <th style={thStyle}>MSL No</th>
                                        <th style={thStyle}>Rev</th>
                                        <th style={{ ...thStyle, textAlign: 'center' }}>Qty</th>
                                        <th style={{ ...thStyle, textAlign: 'center' }}>Boxes</th>
                                        <th style={{ ...thStyle, textAlign: 'center' }}>Packed</th>
                                        <th style={{ ...thStyle, textAlign: 'center' }}>Transferred</th>
                                        <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                                        <th style={thStyle}>Operator</th>
                                        <th style={thStyle}>Date</th>
                                        <th style={{ ...thStyle, textAlign: 'center', width: 70, paddingRight: 16 }}></th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {displayedRequests.map(r => {
                                        const sc = PACKING_STATUS_CONFIG[r.status];
                                        const packedQty = r.boxes_packed_qty || 0;
                                        const xferQty = r.transferred_qty || 0;
                                        return (
                                            <tr key={r.id}
                                                style={{
                                                    transition: 'background 0.15s',
                                                    borderBottom: '1px solid var(--enterprise-gray-100, #f0f0f0)',
                                                }}
                                                onMouseEnter={e => (e.currentTarget.style.background = 'var(--enterprise-gray-50, #f8fafc)')}
                                                onMouseLeave={e => (e.currentTarget.style.background = '')}
                                            >
                                                <td style={{ ...tdStyle, fontWeight: 800, color: '#1e3a8a', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12, paddingLeft: 16 }}>
                                                    {r.movement_number}
                                                </td>
                                                <td style={{ ...tdStyle, maxWidth: 180 }}>
                                                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.master_serial_no || '—'}</div>
                                                </td>
                                                <td style={{ ...tdStyle, fontWeight: 500 }}>{r.revision || '—'}</td>
                                                <td style={{ ...tdStyle, fontWeight: 700, textAlign: 'center' }}>{r.total_packed_qty}</td>
                                                <td style={{ ...tdStyle, textAlign: 'center' }}>{r.status !== 'REJECTED' ? (r.boxes_count || 0) : '—'}</td>
                                                <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 500, whiteSpace: 'nowrap' }}>
                                                    {r.status !== 'REJECTED' ? `${packedQty} / ${r.total_packed_qty}` : '—'}
                                                </td>
                                                <td style={{ ...tdStyle, textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                    {r.status !== 'REJECTED' ? (
                                                        <span style={{
                                                            fontWeight: 600,
                                                            color: xferQty >= r.total_packed_qty ? '#16a34a' : xferQty > 0 ? '#d97706' : '#6b7280',
                                                        }}>
                                                            {xferQty} / {r.total_packed_qty}
                                                        </span>
                                                    ) : '—'}
                                                </td>
                                                <td style={{ ...tdStyle, textAlign: 'center' }}>
                                                    <span style={{
                                                        padding: '4px 10px', borderRadius: '12px', fontSize: 11,
                                                        fontWeight: 600, color: sc.color, backgroundColor: sc.bg,
                                                        border: `1px solid ${sc.color}30`,
                                                        whiteSpace: 'nowrap', display: 'inline-flex',
                                                        alignItems: 'center', justifyContent: 'center',
                                                        minWidth: '95px',
                                                    }}>
                                                        {sc.label}
                                                    </span>
                                                </td>
                                                <td style={{ ...tdStyle, fontSize: 12, whiteSpace: 'nowrap' }}>{r.created_by_name || '—'}</td>
                                                <td style={{ ...tdStyle, fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
                                                    {new Date(r.created_at).toLocaleDateString('en-IN')}
                                                </td>
                                                <td style={{ ...tdStyle, textAlign: 'center', paddingRight: 16 }}>
                                                    <button
                                                        onClick={() => setSelectedRequest(r)}
                                                        style={{
                                                            padding: '4px 8px', borderRadius: 4,
                                                            border: '1px solid var(--enterprise-gray-300, #d1d5db)',
                                                            background: 'white', cursor: 'pointer', fontSize: 11,
                                                            fontWeight: 600, color: '#1e3a8a',
                                                            whiteSpace: 'nowrap', transition: 'all 0.15s',
                                                            display: 'inline-flex', alignItems: 'center', gap: 3,
                                                        }}
                                                    >
                                                        <IconEye /> View
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Load More Button — outside scrollable area */}
                        {hasMore && (
                            <div style={{
                                padding: '20px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '10px',
                                borderTop: '1px solid var(--enterprise-gray-200, #e5e7eb)',
                                background: 'white',
                            }}>
                                <p style={{
                                    fontSize: '13px',
                                    color: 'var(--enterprise-gray-500, #6b7280)',
                                    margin: 0,
                                }}>
                                    Showing {displayedRequests.length} of {filtered.length} records
                                </p>
                                <button
                                    className="load-more-btn"
                                    onClick={() => setDisplayCount(prev => prev + PAGE_SIZE)}
                                >
                                    Load More ({Math.min(PAGE_SIZE, filtered.length - displayCount)} more)
                                </button>
                            </div>
                        )}

                        {/* Show total when all loaded */}
                        {!hasMore && displayedRequests.length > 0 && (
                            <div style={{
                                padding: '14px',
                                textAlign: 'center',
                                borderTop: '1px solid var(--enterprise-gray-200, #e5e7eb)',
                            }}>
                                <p style={{
                                    fontSize: '13px',
                                    color: 'var(--enterprise-gray-500, #6b7280)',
                                    margin: 0,
                                }}>
                                    Showing all {filtered.length} records
                                </p>
                            </div>
                        )}
                    </>
                )}
            </Card>

            {/* CSS for spinner animation */}
            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
        </div>
    );
}
