/**
 * PackingModule — FG Packing Workflow (v5 — Movement-first, Per-Box PKG IDs).
 *
 * Shows Movement # as primary identifier.
 * Each box gets its own PKG-XXXXXXXX. No icons. Dense professional table.
 * Stock transfers from Production → Prod WHSE based on packing, not approval.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Card } from '../ui/EnterpriseUI';
import { PackingDetail } from './PackingDetail';
import * as svc from './packingService';
import { PACKING_STATUS_CONFIG } from '../../types/packing';
import type { PackingRequest, PackingRequestStatus } from '../../types/packing';
import { getSupabaseClient } from '../../utils/supabase/client';

type UserRole = 'L1' | 'L2' | 'L3' | null;

interface PackingModuleProps {
    accessToken: string;
    userRole?: UserRole;
}

export function PackingModule({ accessToken, userRole }: PackingModuleProps) {
    const isOperator = userRole === 'L1';
    const supabase = getSupabaseClient();

    const [requests, setRequests] = useState<PackingRequest[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('ALL');
    const [currentUserName, setCurrentUserName] = useState('');
    const [selectedRequest, setSelectedRequest] = useState<PackingRequest | null>(null);

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
        const matchSearch = !searchTerm ||
            r.movement_number.toLowerCase().includes(searchTerm.toLowerCase()) ||
            r.item_code.toLowerCase().includes(searchTerm.toLowerCase()) ||
            (r.item_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
            (r.part_number || '').toLowerCase().includes(searchTerm.toLowerCase());
        const matchStatus = statusFilter === 'ALL' || r.status === statusFilter;
        return matchSearch && matchStatus;
    });

    const counts: Record<string, number> = {
        ALL: requests.length,
        APPROVED: requests.filter(r => r.status === 'APPROVED').length,
        PACKING_IN_PROGRESS: requests.filter(r => r.status === 'PACKING_IN_PROGRESS').length,
        PARTIALLY_TRANSFERRED: requests.filter(r => r.status === 'PARTIALLY_TRANSFERRED').length,
        COMPLETED: requests.filter(r => r.status === 'COMPLETED').length,
        REJECTED: requests.filter(r => r.status === 'REJECTED').length,
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
        padding: '10px 14px', textAlign: 'left' as const, fontSize: 11,
        fontWeight: 700, color: '#374151', textTransform: 'uppercase' as const,
        letterSpacing: '0.5px', background: '#f9fafb', borderBottom: '2px solid #e5e7eb',
    };
    const tdStyle: React.CSSProperties = {
        padding: '10px 14px', fontSize: 13, borderBottom: '1px solid #f0f0f0',
        color: '#111827',
    };

    const tabs: { key: string; label: string; count: number }[] = [
        { key: 'ALL', label: 'All', count: counts.ALL },
        { key: 'APPROVED', label: 'Open', count: counts.APPROVED },
        { key: 'PACKING_IN_PROGRESS', label: 'In Progress', count: counts.PACKING_IN_PROGRESS },
        { key: 'PARTIALLY_TRANSFERRED', label: 'Partial Transfer', count: counts.PARTIALLY_TRANSFERRED },
        { key: 'COMPLETED', label: 'Completed', count: counts.COMPLETED },
        { key: 'REJECTED', label: 'Cancelled', count: counts.REJECTED },
    ];

    return (
        <div>
            {/* Info Note */}
            <div style={{
                padding: '10px 16px', borderRadius: 4, marginBottom: 20,
                background: '#fafafa', border: '1px solid #e5e7eb',
                color: '#374151', fontSize: 13, lineHeight: 1.6,
            }}>
                Packing requests are auto-created when a <b>Production Receipt</b> stock movement is approved.
                Stock remains in <b>Production</b> until the operator packs boxes and explicitly transfers stock to <b>Prod WHSE</b>.
                Partial transfers are supported.
            </div>

            {/* Status Filter Tabs */}
            <div style={{
                display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb',
                marginBottom: 16, flexWrap: 'wrap',
            }}>
                {tabs.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setStatusFilter(tab.key)}
                        style={{
                            padding: '10px 20px', border: 'none', cursor: 'pointer',
                            fontSize: 13, fontWeight: statusFilter === tab.key ? 700 : 500,
                            color: statusFilter === tab.key ? '#1e3a8a' : '#6b7280',
                            borderBottom: statusFilter === tab.key ? '2px solid #1e3a8a' : '2px solid transparent',
                            background: 'none', marginBottom: -2,
                            transition: 'all 0.15s',
                        }}
                    >
                        {tab.label}
                        <span style={{
                            marginLeft: 6, fontSize: 11, fontWeight: 600,
                            padding: '1px 7px', borderRadius: 10,
                            backgroundColor: statusFilter === tab.key ? '#1e3a8a' : '#e5e7eb',
                            color: statusFilter === tab.key ? '#fff' : '#6b7280',
                        }}>
                            {tab.count}
                        </span>
                    </button>
                ))}
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                <input
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search by movement #, item code, part number..."
                    style={{
                        flex: 1, minWidth: 220, padding: '9px 14px', borderRadius: 4,
                        border: '1px solid #d1d5db', fontSize: 13, outline: 'none',
                    }}
                />
                <button
                    onClick={() => loadRequests()}
                    style={{
                        padding: '9px 16px', borderRadius: 4,
                        border: '1px solid #d1d5db', background: '#fff',
                        cursor: 'pointer', fontSize: 13, fontWeight: 600,
                        color: '#374151',
                    }}
                >
                    Refresh
                </button>
            </div>

            {/* Table */}
            <Card style={{ padding: 0 }}>
                {loading ? (
                    <div style={{ padding: 60, textAlign: 'center', color: '#6b7280', fontSize: 14 }}>
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
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    {['Movement #', 'Item', 'Part No', 'Rev', 'Qty', 'Boxes', 'Packed', 'Transferred', 'Status', 'Operator', 'Date', ''].map(h => (
                                        <th key={h} style={thStyle}>{h}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(r => {
                                    const sc = PACKING_STATUS_CONFIG[r.status];
                                    const packedQty = r.boxes_packed_qty || 0;
                                    const xferQty = r.transferred_qty || 0;
                                    return (
                                        <tr key={r.id}
                                            style={{ cursor: 'pointer', transition: 'background 0.1s' }}
                                            onClick={() => setSelectedRequest(r)}
                                            onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                                        >
                                            <td style={{ ...tdStyle, fontWeight: 800, color: '#1e3a8a', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12 }}>
                                                {r.movement_number}
                                            </td>
                                            <td style={tdStyle}>
                                                <div style={{ fontWeight: 500 }}>{r.item_code}</div>
                                                <div style={{ fontSize: 11, color: '#6b7280' }}>{r.item_name || '—'}</div>
                                            </td>
                                            <td style={{ ...tdStyle, fontWeight: 500, whiteSpace: 'nowrap' }}>{r.part_number || '—'}</td>
                                            <td style={{ ...tdStyle, fontWeight: 500, whiteSpace: 'nowrap' }}>{r.revision || '—'}</td>
                                            <td style={{ ...tdStyle, fontWeight: 700, textAlign: 'right' }}>{r.total_packed_qty}</td>
                                            <td style={{ ...tdStyle, textAlign: 'right' }}>{r.status !== 'REJECTED' ? (r.boxes_count || 0) : '—'}</td>
                                            <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 500 }}>
                                                {r.status !== 'REJECTED' ? `${packedQty} / ${r.total_packed_qty}` : '—'}
                                            </td>
                                            <td style={{ ...tdStyle, textAlign: 'right' }}>
                                                {r.status !== 'REJECTED' ? (
                                                    <span style={{
                                                        fontWeight: 600,
                                                        color: xferQty >= r.total_packed_qty ? '#16a34a' : xferQty > 0 ? '#d97706' : '#6b7280',
                                                    }}>
                                                        {xferQty} / {r.total_packed_qty}
                                                    </span>
                                                ) : '—'}
                                            </td>
                                            <td style={tdStyle}>
                                                <span style={{
                                                    padding: '3px 10px', borderRadius: 3, fontSize: 11,
                                                    fontWeight: 700, color: sc.color, backgroundColor: sc.bg,
                                                    whiteSpace: 'nowrap',
                                                }}>
                                                    {sc.label}
                                                </span>
                                            </td>
                                            <td style={{ ...tdStyle, fontSize: 12 }}>{r.created_by_name || '—'}</td>
                                            <td style={{ ...tdStyle, fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
                                                {new Date(r.created_at).toLocaleDateString('en-IN')}
                                            </td>
                                            <td style={tdStyle}>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setSelectedRequest(r); }}
                                                    style={{
                                                        padding: '5px 12px', borderRadius: 3,
                                                        border: '1px solid #d1d5db', background: '#fff',
                                                        cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                                        color: '#374151', whiteSpace: 'nowrap',
                                                    }}
                                                >
                                                    View
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>

            {!loading && filtered.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#9ca3af', textAlign: 'right' }}>
                    Showing {filtered.length} of {requests.length} record{requests.length !== 1 ? 's' : ''}
                </div>
            )}
        </div>
    );
}
