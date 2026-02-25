/**
 * PackingListSubInvoice — Packing List Against Sub Invoice page.
 *
 * ERP-standard layout: breadcrumb, search/filter, table, add/create, status column.
 */
import React, { useState } from 'react';
import { Card } from '../ui/EnterpriseUI';

type UserRole = 'L1' | 'L2' | 'L3' | null;

interface PackingListSubInvoiceProps {
    accessToken: string;
    userRole?: UserRole;
    onNavigate?: (view: string) => void;
}

// Sample data for demonstration
const SAMPLE_DATA = [
    { id: 'PKL-SI-001', subInvoiceNo: 'SI-2026-0101', parentInvoice: 'INV-2026-0451', customer: 'Tata Motors Ltd.', items: 4, totalQty: 1500, packedQty: 1500, boxes: 15, status: 'Completed', date: '2026-02-23', operator: 'Prajeeth P' },
    { id: 'PKL-SI-002', subInvoiceNo: 'SI-2026-0102', parentInvoice: 'INV-2026-0451', customer: 'Tata Motors Ltd.', items: 3, totalQty: 1000, packedQty: 600, boxes: 10, status: 'In Progress', date: '2026-02-22', operator: 'Arun K' },
    { id: 'PKL-SI-003', subInvoiceNo: 'SI-2026-0103', parentInvoice: 'INV-2026-0452', customer: 'Mahindra & Mahindra', items: 2, totalQty: 800, packedQty: 0, boxes: 0, status: 'Open', date: '2026-02-22', operator: '—' },
    { id: 'PKL-SI-004', subInvoiceNo: 'SI-2026-0098', parentInvoice: 'INV-2026-0448', customer: 'Bajaj Auto', items: 5, totalQty: 2100, packedQty: 2100, boxes: 21, status: 'Completed', date: '2026-02-21', operator: 'Prajeeth P' },
    { id: 'PKL-SI-005', subInvoiceNo: 'SI-2026-0099', parentInvoice: 'INV-2026-0448', customer: 'Bajaj Auto', items: 6, totalQty: 2500, packedQty: 2500, boxes: 25, status: 'Completed', date: '2026-02-21', operator: 'Prajeeth P' },
    { id: 'PKL-SI-006', subInvoiceNo: 'SI-2026-0100', parentInvoice: 'INV-2026-0449', customer: 'Hero MotoCorp', items: 1, totalQty: 400, packedQty: 0, boxes: 0, status: 'Cancelled', date: '2026-02-20', operator: '—' },
    { id: 'PKL-SI-007', subInvoiceNo: 'SI-2026-0095', parentInvoice: 'INV-2026-0445', customer: 'Maruti Suzuki', items: 8, totalQty: 3200, packedQty: 3200, boxes: 32, status: 'Completed', date: '2026-02-19', operator: 'Arun K' },
    { id: 'PKL-SI-008', subInvoiceNo: 'SI-2026-0096', parentInvoice: 'INV-2026-0445', customer: 'Maruti Suzuki', items: 4, totalQty: 1800, packedQty: 900, boxes: 18, status: 'In Progress', date: '2026-02-19', operator: 'Prajeeth P' },
];

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
    'Open': { color: '#2563eb', bg: '#eff6ff' },
    'In Progress': { color: '#d97706', bg: '#fffbeb' },
    'Completed': { color: '#16a34a', bg: '#f0fdf4' },
    'Cancelled': { color: '#dc2626', bg: '#fef2f2' },
};

export function PackingListSubInvoice({ accessToken, userRole, onNavigate }: PackingListSubInvoiceProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('All Statuses');
    const [showCreateModal, setShowCreateModal] = useState(false);

    const filtered = SAMPLE_DATA.filter(row => {
        const matchSearch = !searchTerm ||
            row.subInvoiceNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
            row.parentInvoice.toLowerCase().includes(searchTerm.toLowerCase()) ||
            row.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
            row.id.toLowerCase().includes(searchTerm.toLowerCase());
        const matchStatus = statusFilter === 'All Statuses' || row.status === statusFilter;
        return matchSearch && matchStatus;
    });

    const counts = {
        total: SAMPLE_DATA.length,
        open: SAMPLE_DATA.filter(r => r.status === 'Open').length,
        inProgress: SAMPLE_DATA.filter(r => r.status === 'In Progress').length,
        completed: SAMPLE_DATA.filter(r => r.status === 'Completed').length,
        cancelled: SAMPLE_DATA.filter(r => r.status === 'Cancelled').length,
    };

    const thStyle: React.CSSProperties = {
        padding: '10px 14px', textAlign: 'left', fontSize: 11,
        fontWeight: 700, color: '#374151', textTransform: 'uppercase',
        letterSpacing: '0.5px', background: '#f9fafb', borderBottom: '2px solid #e5e7eb',
    };
    const tdStyle: React.CSSProperties = {
        padding: '10px 14px', fontSize: 13, borderBottom: '1px solid #f0f0f0',
        color: '#111827',
    };

    return (
        <div>
            {/* Breadcrumb */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20,
                fontSize: 13, color: '#6b7280',
            }}>
                <span
                    style={{ cursor: 'pointer', color: '#1e3a8a', fontWeight: 500 }}
                    onClick={() => onNavigate?.('dashboard')}
                >Home</span>
                <span style={{ color: '#9ca3af' }}>›</span>
                <span
                    style={{ cursor: 'pointer', color: '#1e3a8a', fontWeight: 500 }}
                    onClick={() => onNavigate?.('packing')}
                >Packing</span>
                <span style={{ color: '#9ca3af' }}>›</span>
                <span style={{ cursor: 'pointer', color: '#1e3a8a', fontWeight: 500 }}>Packing List</span>
                <span style={{ color: '#9ca3af' }}>›</span>
                <span style={{ fontWeight: 600, color: '#111827' }}>Against Sub Invoice</span>
            </div>

            {/* Summary Cards */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 16, marginBottom: 24,
            }}>
                {[
                    { label: 'Total Records', value: counts.total, icon: '📋', color: '#1e3a8a' },
                    { label: 'Open', value: counts.open, icon: '⊕', color: '#2563eb' },
                    { label: 'In Progress', value: counts.inProgress, icon: '⏳', color: '#d97706' },
                    { label: 'Completed', value: counts.completed, icon: '✓', color: '#16a34a' },
                    { label: 'Cancelled', value: counts.cancelled, icon: '✗', color: '#dc2626' },
                ].map(card => (
                    <Card key={card.label} style={{ padding: '16px 20px' }}>
                        <div style={{ fontSize: 12, color: '#6b7280', fontWeight: 500, marginBottom: 4 }}>{card.label}</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 28, fontWeight: 800, color: card.color }}>{card.value}</span>
                            <span style={{ fontSize: 20 }}>{card.icon}</span>
                        </div>
                    </Card>
                ))}
            </div>

            {/* Info Note */}
            <div style={{
                padding: '10px 16px', borderRadius: 4, marginBottom: 20,
                background: '#fafafa', border: '1px solid #e5e7eb',
                color: '#374151', fontSize: 13, lineHeight: 1.6,
            }}>
                Sub-invoice packing lists allow partial packing against sub-invoices (split shipments).
                Each sub-invoice record is linked to a parent invoice and tracks packing for a specific shipment batch.
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 16 }}>🔍</span>
                    <input
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        placeholder="Search by sub-invoice #, parent invoice, customer..."
                        style={{
                            width: '100%', padding: '9px 14px 9px 36px', borderRadius: 4,
                            border: '1px solid #d1d5db', fontSize: 13, outline: 'none',
                            boxSizing: 'border-box',
                        }}
                    />
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span style={{ fontSize: 13, color: '#6b7280' }}>From</span>
                    <input type="date" style={{
                        padding: '8px 12px', borderRadius: 4, border: '1px solid #d1d5db',
                        fontSize: 13, color: '#374151',
                    }} />
                    <span style={{ fontSize: 13, color: '#6b7280' }}>To</span>
                    <input type="date" style={{
                        padding: '8px 12px', borderRadius: 4, border: '1px solid #d1d5db',
                        fontSize: 13, color: '#374151',
                    }} />
                </div>
                <select
                    value={statusFilter}
                    onChange={e => setStatusFilter(e.target.value)}
                    style={{
                        padding: '9px 14px', borderRadius: 4,
                        border: '1px solid #d1d5db', fontSize: 13,
                        color: '#374151', background: '#fff', cursor: 'pointer',
                    }}
                >
                    <option>All Statuses</option>
                    <option>Open</option>
                    <option>In Progress</option>
                    <option>Completed</option>
                    <option>Cancelled</option>
                </select>
                <button
                    style={{
                        padding: '9px 16px', borderRadius: 4,
                        border: '1px solid #d1d5db', background: '#fff',
                        cursor: 'pointer', fontSize: 13, fontWeight: 600,
                        color: '#374151',
                    }}
                >
                    Export CSV
                </button>
                <button
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

            {/* Create Button */}
            <div style={{ marginBottom: 16 }}>
                <button
                    onClick={() => setShowCreateModal(true)}
                    style={{
                        padding: '10px 20px', borderRadius: 4,
                        border: 'none', background: '#1e3a8a',
                        cursor: 'pointer', fontSize: 13, fontWeight: 700,
                        color: '#fff', transition: 'background 0.15s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#1e40af')}
                    onMouseLeave={e => (e.currentTarget.style.background = '#1e3a8a')}
                >
                    + Create Packing List (Sub Invoice)
                </button>
            </div>

            {/* Table */}
            <Card style={{ padding: 0 }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                {['Packing List #', 'Sub-Invoice No', 'Parent Invoice', 'Customer', 'Items', 'Total Qty', 'Packed Qty', 'Boxes', 'Status', 'Operator', 'Date', ''].map(h => (
                                    <th key={h} style={thStyle}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={12} style={{ padding: 60, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
                                        No records match your search criteria.
                                    </td>
                                </tr>
                            ) : filtered.map(row => {
                                const sc = STATUS_COLORS[row.status] || STATUS_COLORS['Open'];
                                return (
                                    <tr key={row.id}
                                        style={{ cursor: 'pointer', transition: 'background 0.1s' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                                    >
                                        <td style={{ ...tdStyle, fontWeight: 800, color: '#1e3a8a', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12 }}>
                                            {row.id}
                                        </td>
                                        <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap', color: '#7c3aed' }}>{row.subInvoiceNo}</td>
                                        <td style={{ ...tdStyle, fontWeight: 500, whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12 }}>{row.parentInvoice}</td>
                                        <td style={tdStyle}>{row.customer}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 600 }}>{row.items}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right', fontWeight: 700 }}>{row.totalQty.toLocaleString()}</td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>
                                            <span style={{
                                                fontWeight: 600,
                                                color: row.packedQty >= row.totalQty ? '#16a34a' : row.packedQty > 0 ? '#d97706' : '#6b7280',
                                            }}>
                                                {row.packedQty.toLocaleString()} / {row.totalQty.toLocaleString()}
                                            </span>
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'right' }}>{row.boxes}</td>
                                        <td style={tdStyle}>
                                            <span style={{
                                                padding: '3px 10px', borderRadius: 3, fontSize: 11,
                                                fontWeight: 700, color: sc.color, backgroundColor: sc.bg,
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {row.status}
                                            </span>
                                        </td>
                                        <td style={{ ...tdStyle, fontSize: 12 }}>{row.operator}</td>
                                        <td style={{ ...tdStyle, fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}>
                                            {new Date(row.date).toLocaleDateString('en-IN')}
                                        </td>
                                        <td style={tdStyle}>
                                            <button style={{
                                                padding: '5px 12px', borderRadius: 3,
                                                border: '1px solid #d1d5db', background: '#fff',
                                                cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                                color: '#374151', whiteSpace: 'nowrap',
                                            }}>
                                                👁 View
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Card>

            {filtered.length > 0 && (
                <div style={{ marginTop: 8, fontSize: 12, color: '#9ca3af', textAlign: 'right' }}>
                    Showing {filtered.length} of {SAMPLE_DATA.length} record{SAMPLE_DATA.length !== 1 ? 's' : ''}
                </div>
            )}

            {/* Create Modal */}
            {showCreateModal && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{
                        background: '#fff', borderRadius: 8, padding: 28,
                        maxWidth: 500, width: '95%',
                        boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
                    }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#111827', marginBottom: 20 }}>
                            Create Packing List (Against Sub Invoice)
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Parent Invoice Number *</label>
                                <input placeholder="e.g. INV-2026-0451" style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                                }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Sub Invoice Number *</label>
                                <input placeholder="e.g. SI-2026-0110" style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                                }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Customer Name *</label>
                                <input placeholder="e.g. Tata Motors Ltd." style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                                }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Remarks</label>
                                <textarea rows={3} placeholder="Optional remarks..." style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, resize: 'vertical', boxSizing: 'border-box',
                                }} />
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 10, marginTop: 20, justifyContent: 'flex-end' }}>
                            <button onClick={() => setShowCreateModal(false)} style={{
                                padding: '10px 20px', borderRadius: 4,
                                border: '1px solid #d1d5db', background: '#fff',
                                fontWeight: 600, cursor: 'pointer', fontSize: 13, color: '#374151',
                            }}>Cancel</button>
                            <button onClick={() => setShowCreateModal(false)} style={{
                                padding: '10px 20px', borderRadius: 4,
                                border: 'none', background: '#1e3a8a',
                                fontWeight: 700, cursor: 'pointer', fontSize: 13, color: '#fff',
                            }}>Create Packing List</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
