/**
 * PackingList — Packing List page.
 *
 * Shows box size, item qty, inner box qty, and other packing specifications.
 * ERP-standard layout: breadcrumb, search/filter, table, add/create, status column.
 */
import React, { useState, useMemo, useEffect } from 'react';
import { Card } from '../ui/EnterpriseUI';
import { Pagination } from '../ui/SharedComponents';

type UserRole = 'L1' | 'L2' | 'L3' | null;

interface PackingListProps {
    accessToken: string;
    userRole?: UserRole;
    onNavigate?: (view: string) => void;
}

// Sample data demonstrating packing list details
const SAMPLE_DATA = [
    { id: 'PKL-001', partNo: 'FG-BRK-001', partName: 'Brake Assembly LH', customer: 'Tata Motors Ltd.', boxType: 'Corrugated Box', boxSize: '600 × 400 × 300 mm', outerQty: 24, innerBoxSize: '150 × 100 × 80 mm', innerBoxQty: 6, itemsPerInner: 4, totalQty: 24, netWeight: '12.5 kg', grossWeight: '14.2 kg', status: 'Active', lastUpdated: '2026-02-23' },
    { id: 'PKL-002', partNo: 'FG-BRK-002', partName: 'Brake Assembly RH', customer: 'Tata Motors Ltd.', boxType: 'Corrugated Box', boxSize: '600 × 400 × 300 mm', outerQty: 24, innerBoxSize: '150 × 100 × 80 mm', innerBoxQty: 6, itemsPerInner: 4, totalQty: 24, netWeight: '12.5 kg', grossWeight: '14.2 kg', status: 'Active', lastUpdated: '2026-02-23' },
    { id: 'PKL-003', partNo: 'FG-CLT-010', partName: 'Clutch Plate Assembly', customer: 'Mahindra & Mahindra', boxType: 'Wooden Crate', boxSize: '800 × 600 × 500 mm', outerQty: 48, innerBoxSize: '200 × 150 × 100 mm', innerBoxQty: 12, itemsPerInner: 4, totalQty: 48, netWeight: '38.0 kg', grossWeight: '45.0 kg', status: 'Active', lastUpdated: '2026-02-22' },
    { id: 'PKL-004', partNo: 'FG-GER-005', partName: 'Gear Shaft 5th', customer: 'Bajaj Auto', boxType: 'Plastic Crate', boxSize: '500 × 350 × 250 mm', outerQty: 30, innerBoxSize: '—', innerBoxQty: 0, itemsPerInner: 0, totalQty: 30, netWeight: '22.0 kg', grossWeight: '24.5 kg', status: 'Active', lastUpdated: '2026-02-21' },
    { id: 'PKL-005', partNo: 'FG-FLW-008', partName: 'Flywheel Ring Gear', customer: 'Hero MotoCorp', boxType: 'Corrugated Box', boxSize: '450 × 450 × 200 mm', outerQty: 16, innerBoxSize: '110 × 110 × 50 mm', innerBoxQty: 4, itemsPerInner: 4, totalQty: 16, netWeight: '15.0 kg', grossWeight: '16.8 kg', status: 'Active', lastUpdated: '2026-02-20' },
    { id: 'PKL-006', partNo: 'FG-SPR-012', partName: 'Suspension Spring Set', customer: 'Maruti Suzuki', boxType: 'Metal Bin', boxSize: '700 × 500 × 400 mm', outerQty: 20, innerBoxSize: '—', innerBoxQty: 0, itemsPerInner: 0, totalQty: 20, netWeight: '32.0 kg', grossWeight: '35.5 kg', status: 'Draft', lastUpdated: '2026-02-19' },
    { id: 'PKL-007', partNo: 'FG-BRG-003', partName: 'Wheel Bearing LH', customer: 'Tata Motors Ltd.', boxType: 'Corrugated Box', boxSize: '400 × 300 × 200 mm', outerQty: 50, innerBoxSize: '80 × 80 × 40 mm', innerBoxQty: 10, itemsPerInner: 5, totalQty: 50, netWeight: '8.0 kg', grossWeight: '9.5 kg', status: 'Inactive', lastUpdated: '2026-02-18' },
    { id: 'PKL-008', partNo: 'FG-EXH-015', partName: 'Exhaust Manifold', customer: 'Bajaj Auto', boxType: 'Wooden Crate', boxSize: '900 × 600 × 400 mm', outerQty: 8, innerBoxSize: '—', innerBoxQty: 0, itemsPerInner: 0, totalQty: 8, netWeight: '28.0 kg', grossWeight: '35.0 kg', status: 'Active', lastUpdated: '2026-02-17' },
];

const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
    'Active': { color: '#16a34a', bg: '#f0fdf4' },
    'Draft': { color: '#d97706', bg: '#fffbeb' },
    'Inactive': { color: '#6b7280', bg: '#f3f4f6' },
};

export function PackingList({ accessToken, userRole, onNavigate }: PackingListProps) {
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('All Statuses');
    const [page, setPage] = useState(0);
    const [showCreateModal, setShowCreateModal] = useState(false);

    const filtered = useMemo(() => SAMPLE_DATA.filter(row => {
        const matchSearch = !searchTerm ||
            row.partNo.toLowerCase().includes(searchTerm.toLowerCase()) ||
            row.partName.toLowerCase().includes(searchTerm.toLowerCase()) ||
            row.customer.toLowerCase().includes(searchTerm.toLowerCase()) ||
            row.id.toLowerCase().includes(searchTerm.toLowerCase());
        const matchStatus = statusFilter === 'All Statuses' || row.status === statusFilter;
        return matchSearch && matchStatus;
    }), [searchTerm, statusFilter]);

    useEffect(() => {
        setPage(0);
    }, [searchTerm, statusFilter]);

    const displayedRecords = useMemo(() => {
        return filtered.slice(page * 20, (page + 1) * 20);
    }, [filtered, page]);

    const counts = {
        total: SAMPLE_DATA.length,
        active: SAMPLE_DATA.filter(r => r.status === 'Active').length,
        draft: SAMPLE_DATA.filter(r => r.status === 'Draft').length,
        inactive: SAMPLE_DATA.filter(r => r.status === 'Inactive').length,
    };

    const thStyle: React.CSSProperties = {
        padding: '10px 12px', textAlign: 'left', fontSize: 11,
        fontWeight: 700, color: '#374151', textTransform: 'uppercase',
        letterSpacing: '0.5px', background: '#f9fafb', borderBottom: '2px solid #e5e7eb',
        whiteSpace: 'nowrap',
    };
    const tdStyle: React.CSSProperties = {
        padding: '10px 12px', fontSize: 13, borderBottom: '1px solid #f0f0f0',
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
                <span style={{ fontWeight: 600, color: '#111827' }}>Packing List</span>
            </div>

            {/* Page Title */}
            <div style={{ marginBottom: 20 }}>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#111827', margin: 0 }}>
                    Packing List — Specifications
                </h2>
                <p style={{ fontSize: 13, color: '#6b7280', marginTop: 4 }}>
                    Define packing standards: box type &amp; size, item quantity per box, inner box details, and weight specifications for each finished goods part.
                </p>
            </div>

            {/* Summary Cards */}
            <div style={{
                display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                gap: 16, marginBottom: 24,
            }}>
                {[
                    { label: 'Total Specifications', value: counts.total, icon: '📋', color: '#1e3a8a' },
                    { label: 'Active', value: counts.active, icon: '✓', color: '#16a34a' },
                    { label: 'Draft', value: counts.draft, icon: '✏️', color: '#d97706' },
                    { label: 'Inactive', value: counts.inactive, icon: '—', color: '#6b7280' },
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
                Each row defines the packing specification for a finished goods part — box type, outer box dimensions, inner box configuration, and weight limits.
                These specifications are referenced during the packing workflow.
            </div>

            {/* Toolbar */}
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16, flexWrap: 'wrap' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 220 }}>
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af', fontSize: 16 }}>🔍</span>
                    <input
                        value={searchTerm}
                        onChange={e => setSearchTerm(e.target.value)}
                        placeholder="Search by part no, part name, customer..."
                        style={{
                            width: '100%', padding: '9px 14px 9px 36px', borderRadius: 4,
                            border: '1px solid #d1d5db', fontSize: 13, outline: 'none',
                            boxSizing: 'border-box',
                        }}
                    />
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
                    <option>Active</option>
                    <option>Draft</option>
                    <option>Inactive</option>
                </select>
                <button
                    style={{
                        padding: '9px 16px', borderRadius: 4,
                        border: '1px solid #d1d5db', background: '#fff',
                        cursor: 'pointer', fontSize: 13, fontWeight: 600,
                        color: '#374151',
                    }}
                >
                    Export Excel
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
                    + Add Packing Specification
                </button>
            </div>

            {/* Table */}
            <Card style={{ padding: 0 }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr>
                                {['ID', 'Part No', 'Part Name', 'Customer', 'Box Type', 'Box Size (L×W×H)', 'Outer Qty', 'Inner Box Size', 'Inner Boxes', 'Items/Inner', 'Net Wt', 'Gross Wt', 'Status', ''].map(h => (
                                    <th key={h} style={thStyle}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 ? (
                                <tr>
                                    <td colSpan={14} style={{ padding: 60, textAlign: 'center', color: '#9ca3af', fontSize: 14 }}>
                                        No records match your search criteria.
                                    </td>
                                </tr>
                            ) : displayedRecords.map(row => {
                                const sc = STATUS_COLORS[row.status] || STATUS_COLORS['Active'];
                                return (
                                    <tr key={row.id}
                                        style={{ cursor: 'pointer', transition: 'background 0.1s' }}
                                        onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                        onMouseLeave={e => (e.currentTarget.style.background = '')}
                                    >
                                        <td style={{ ...tdStyle, fontWeight: 700, color: '#1e3a8a', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12 }}>
                                            {row.id}
                                        </td>
                                        <td style={{ ...tdStyle, fontWeight: 600, whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12 }}>{row.partNo}</td>
                                        <td style={{ ...tdStyle, fontWeight: 500 }}>{row.partName}</td>
                                        <td style={{ ...tdStyle, fontSize: 12, color: '#6b7280' }}>{row.customer}</td>
                                        <td style={{ ...tdStyle, fontSize: 12 }}>{row.boxType}</td>
                                        <td style={{ ...tdStyle, fontSize: 12, fontFamily: 'monospace', whiteSpace: 'nowrap', fontWeight: 600 }}>{row.boxSize}</td>
                                        <td style={{ ...tdStyle, textAlign: 'center', fontWeight: 700 }}>{row.outerQty}</td>
                                        <td style={{ ...tdStyle, fontSize: 12, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                            {row.innerBoxSize}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            {row.innerBoxQty > 0 ? row.innerBoxQty : '—'}
                                        </td>
                                        <td style={{ ...tdStyle, textAlign: 'center' }}>
                                            {row.itemsPerInner > 0 ? row.itemsPerInner : '—'}
                                        </td>
                                        <td style={{ ...tdStyle, fontSize: 12, whiteSpace: 'nowrap' }}>{row.netWeight}</td>
                                        <td style={{ ...tdStyle, fontSize: 12, whiteSpace: 'nowrap' }}>{row.grossWeight}</td>
                                        <td style={tdStyle}>
                                            <span style={{
                                                padding: '3px 10px', borderRadius: 3, fontSize: 11,
                                                fontWeight: 700, color: sc.color, backgroundColor: sc.bg,
                                                whiteSpace: 'nowrap',
                                            }}>
                                                {row.status}
                                            </span>
                                        </td>
                                        <td style={tdStyle}>
                                            <button style={{
                                                padding: '5px 12px', borderRadius: 3,
                                                border: '1px solid #d1d5db', background: '#fff',
                                                cursor: 'pointer', fontSize: 12, fontWeight: 600,
                                                color: '#374151', whiteSpace: 'nowrap',
                                            }}>
                                                Edit
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            {displayedRecords.length > 0 && (
                <Pagination
                    page={page}
                    pageSize={20}
                    totalCount={filtered.length}
                    onPageChange={setPage}
                />
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
                Showing {filtered.length} items
            </span>
        </div>

            {/* Create Modal */}
            {showCreateModal && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 10000,
                    backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{
                        background: '#fff', borderRadius: 8, padding: 28,
                        maxWidth: 600, width: '95%',
                        boxShadow: '0 25px 50px rgba(0,0,0,0.25)',
                        maxHeight: '90vh', overflowY: 'auto',
                    }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: '#111827', marginBottom: 20 }}>
                            Add Packing Specification
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Part Number *</label>
                                <input placeholder="e.g. FG-BRK-001" style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                                }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Part Name *</label>
                                <input placeholder="e.g. Brake Assembly LH" style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                                }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Customer *</label>
                                <input placeholder="e.g. Tata Motors Ltd." style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                                }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Box Type *</label>
                                <select style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box', background: '#fff',
                                }}>
                                    <option value="">Select box type</option>
                                    <option>Corrugated Box</option>
                                    <option>Wooden Crate</option>
                                    <option>Plastic Crate</option>
                                    <option>Metal Bin</option>
                                    <option>HDPE Bag</option>
                                </select>
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Box Size (L × W × H mm) *</label>
                                <input placeholder="e.g. 600 × 400 × 300" style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                                }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Outer Box Qty *</label>
                                <input type="number" placeholder="e.g. 24" style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                                }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Inner Box Size (L × W × H mm)</label>
                                <input placeholder="e.g. 150 × 100 × 80 (or leave blank)" style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                                }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Inner Boxes Per Outer</label>
                                <input type="number" placeholder="e.g. 6" style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                                }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Items Per Inner Box</label>
                                <input type="number" placeholder="e.g. 4" style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                                }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Net Weight (kg)</label>
                                <input placeholder="e.g. 12.5" style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                                }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Gross Weight (kg)</label>
                                <input placeholder="e.g. 14.2" style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box',
                                }} />
                            </div>
                            <div>
                                <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 }}>Status</label>
                                <select style={{
                                    width: '100%', padding: '9px 14px', borderRadius: 4,
                                    border: '1px solid #d1d5db', fontSize: 13, boxSizing: 'border-box', background: '#fff',
                                }}>
                                    <option>Active</option>
                                    <option>Draft</option>
                                    <option>Inactive</option>
                                </select>
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
                            }}>Save Specification</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
