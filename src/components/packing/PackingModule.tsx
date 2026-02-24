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
import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/EnterpriseUI';
import {
    SummaryCard, SummaryCardsGrid,
    FilterBar, ActionBar,
    SearchBox, StatusFilter, DateRangeFilter,
    ExportCSVButton, RefreshButton,
} from '../ui/SharedComponents';
import { Printer, CheckCircle2, Clock, Package } from 'lucide-react';
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
    const [statusFilter, setStatusFilter] = useState<string>('ALL');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [currentUserName, setCurrentUserName] = useState('');

    const PAGE_SIZE = 20;
    const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

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

    // Fetch packing requests
    const fetchRequests = useCallback(async () => {
        setLoading(true);
        try {
            const data = await svc.fetchPackingRequests(false);
            // Filter out REJECTED — only show actionable records
            setRequests(data.filter(r => r.status !== 'REJECTED'));
        } catch (err) {
            console.error('Error fetching packing requests:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchRequests(); }, [fetchRequests]);

    // Real-time subscription
    useEffect(() => {
        const channel = supabase
            .channel('sticker-gen-realtime')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'packing_requests' }, () => fetchRequests())
            .subscribe();
        return () => { supabase.removeChannel(channel); };
    }, [supabase, fetchRequests]);

    // ============================================================================
    // FILTERING
    // ============================================================================

    const filtered = requests.filter(r => {
        const matchSearch = !searchTerm ||
            r.movement_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.item_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.item_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.part_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.master_serial_no?.toLowerCase().includes(searchTerm.toLowerCase());
        const matchStatus = statusFilter === 'ALL' || r.status === statusFilter;
        const matchDateFrom = !dateFrom || (r.created_at && r.created_at >= dateFrom);
        const matchDateTo = !dateTo || (r.created_at && r.created_at <= dateTo + 'T23:59:59');
        return matchSearch && matchStatus && matchDateFrom && matchDateTo;
    });

    const displayedRequests = filtered.slice(0, displayCount);
    const hasMore = displayCount < filtered.length;

    // ============================================================================
    // SUMMARY COUNTS
    // ============================================================================

    const awaitingStickerCount = requests.filter(r => r.status === 'APPROVED').length;
    const inProgressCount = requests.filter(r => ['PACKING_IN_PROGRESS', 'PARTIALLY_TRANSFERRED'].includes(r.status)).length;
    const completedCount = requests.filter(r => r.status === 'COMPLETED').length;
    const totalCount = requests.length;

    // ============================================================================
    // CSV EXPORT
    // ============================================================================

    const handleExport = () => {
        const headers = ['Movement #', 'Item Code', 'MSN', 'Approved Qty', 'Boxes', 'Status', 'Created'];
        const rows = filtered.map(r => [
            r.movement_number, r.item_code, r.master_serial_no || '',
            r.total_packed_qty, r.boxes_count || 0,
            PACKING_STATUS_CONFIG[r.status]?.label || r.status,
            r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '',
        ]);
        const csv = [headers.join(','), ...rows.map(r => r.map(c => typeof c === 'string' && c.includes(',') ? `"${c}"` : c).join(','))].join('\n');
        const blob = new Blob([csv], { type: 'text/csv' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `sticker_generation_${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
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

    return (
        <div>
            {/* SUMMARY CARDS */}
            <SummaryCardsGrid>
                <SummaryCard
                    label="Total Records" value={totalCount}
                    icon={<Package size={22} style={{ color: '#1e3a8a' }} />} color="#1e3a8a" bgColor="#eff6ff"
                    isActive={statusFilter === 'ALL'} onClick={() => setStatusFilter('ALL')}
                />
                <SummaryCard
                    label="Awaiting Stickers" value={awaitingStickerCount}
                    icon={<Clock size={22} style={{ color: '#dc2626' }} />} color="#dc2626" bgColor="#fef2f2"
                    isActive={statusFilter === 'APPROVED'} onClick={() => setStatusFilter('APPROVED')}
                />
                <SummaryCard
                    label="In Progress" value={inProgressCount}
                    icon={<Printer size={22} style={{ color: '#d97706' }} />} color="#d97706" bgColor="#fffbeb"
                    isActive={statusFilter === 'PACKING_IN_PROGRESS'} onClick={() => setStatusFilter('PACKING_IN_PROGRESS')}
                />
                <SummaryCard
                    label="Completed" value={completedCount}
                    icon={<CheckCircle2 size={22} style={{ color: '#16a34a' }} />} color="#16a34a" bgColor="#f0fdf4"
                    isActive={statusFilter === 'COMPLETED'} onClick={() => setStatusFilter('COMPLETED')}
                />
            </SummaryCardsGrid>

            {/* FILTER BAR */}
            <FilterBar>
                <SearchBox
                    value={searchTerm}
                    onChange={v => { setSearchTerm(v); setDisplayCount(PAGE_SIZE); }}
                    placeholder="Search movement #, item, part #, MSN..."
                />

                <DateRangeFilter
                    dateFrom={dateFrom} dateTo={dateTo}
                    onDateFromChange={setDateFrom} onDateToChange={setDateTo}
                />

                <StatusFilter
                    value={statusFilter}
                    onChange={v => { setStatusFilter(v); setDisplayCount(PAGE_SIZE); }}
                    options={[
                        { value: 'ALL', label: 'All Status' },
                        { value: 'APPROVED', label: 'Pending' },
                        { value: 'PACKING_IN_PROGRESS', label: 'In Progress' },
                        { value: 'PARTIALLY_TRANSFERRED', label: 'Partial Transfer' },
                        { value: 'COMPLETED', label: 'Completed' },
                    ]}
                />

                <ActionBar>
                    <ExportCSVButton onClick={handleExport} />
                    <RefreshButton onClick={fetchRequests} loading={loading} />
                </ActionBar>
            </FilterBar>

            {/* TABLE */}
            <Card style={{ padding: 0 }}>
                {loading ? (
                    <div style={{ padding: 48, textAlign: 'center' }}>
                        <div style={{
                            width: 32, height: 32, border: '3px solid #e5e7eb', borderTopColor: '#1e3a8a',
                            borderRadius: '50%', animation: 'spin 0.8s linear infinite', margin: '0 auto 12px',
                        }} />
                        <div style={{ fontSize: 13, color: '#6b7280' }}>Loading sticker records...</div>
                    </div>
                ) : filtered.length === 0 ? (
                    <div style={{ padding: 48, textAlign: 'center' }}>
                        <div style={{ fontSize: 40, marginBottom: 8 }}>🏷️</div>
                        <div style={{ fontSize: 14, fontWeight: 600, color: '#374151', marginBottom: 4 }}>
                            No sticker generation records found
                        </div>
                        <div style={{ fontSize: 12, color: '#9ca3af' }}>
                            Approved stock movements will appear here automatically.
                        </div>
                    </div>
                ) : (
                    <>
                        <div className="table-responsive" style={{ overflowX: 'auto' }}>
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
                                    {displayedRequests.map(r => {
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
                                                    {r.boxes_count || '—'}
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

                        {/* Load More */}
                        {hasMore && (
                            <div style={{ padding: 16, textAlign: 'center', borderTop: '1px solid #f3f4f6' }}>
                                <button onClick={() => setDisplayCount(c => c + PAGE_SIZE)} style={{
                                    ...btnStyle, background: '#f3f4f6', color: '#374151', border: '1px solid #e5e7eb',
                                    padding: '8px 24px',
                                }}>
                                    Show More ({filtered.length - displayCount} remaining)
                                </button>
                            </div>
                        )}
                        {!hasMore && displayedRequests.length > 0 && (
                            <div style={{ padding: 10, textAlign: 'center', fontSize: 12, color: '#9ca3af', borderTop: '1px solid #f3f4f6' }}>
                                Showing all {displayedRequests.length} record{displayedRequests.length !== 1 ? 's' : ''}
                            </div>
                        )}
                    </>
                )}
            </Card>

            {/* Spinner CSS */}
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
