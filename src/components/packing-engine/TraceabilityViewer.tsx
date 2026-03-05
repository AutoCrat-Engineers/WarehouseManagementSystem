/**
 * TraceabilityViewer — Full backward trace with drill-down
 *
 * Invoice → Packing List → Pallet → Container → Movement → Operator → Source Document
 * One-click drill-down at every level.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Search, Eye, Package, Layers, FileText, AlertTriangle,
    ChevronDown, ChevronRight, CheckCircle2, Clock, Box,
    ArrowRight, User, Hash, Loader2,
} from 'lucide-react';
import { Card, Modal, EmptyState, ModuleLoader } from '../ui/EnterpriseUI';
import {
    SummaryCard, SummaryCardsGrid, SearchBox, FilterBar, ActionBar,
    RefreshButton, ExportCSVButton,
} from '../ui/SharedComponents';
import * as svc from './packingEngineService';
import type { TraceRecord } from './packingEngineService';
import { getSupabaseClient } from '../../utils/supabase/client';

type UserRole = 'L1' | 'L2' | 'L3' | null;

interface TraceabilityViewerProps {
    accessToken: string;
    userRole?: UserRole;
    userPerms?: Record<string, boolean>;
}

// ============================================================================
// TRACE CHAIN VISUALIZATION
// ============================================================================

function TraceChain({ record }: { record: TraceRecord }) {
    const steps = [
        { label: 'Container', value: record.container_number, active: true },
        { label: 'Pallet', value: record.pallet_number, active: !!record.pallet_number },
        { label: 'PL', value: record.packing_list_number, active: !!record.packing_list_number },
        { label: 'Invoice', value: record.invoice_number, active: !!record.invoice_number },
        { label: 'Proforma', value: record.proforma_number, active: !!record.proforma_number },
    ];

    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap' }}>
            {steps.map((step, idx) => (
                <React.Fragment key={step.label}>
                    {idx > 0 && (
                        <ArrowRight size={12} style={{ color: step.active ? '#2563eb' : '#d1d5db' }} />
                    )}
                    <div style={{
                        padding: '3px 8px', borderRadius: 6, fontSize: 10,
                        fontWeight: 600, fontFamily: 'monospace',
                        background: step.active ? '#eff6ff' : '#f3f4f6',
                        color: step.active ? '#1e3a8a' : '#9ca3af',
                        border: `1px solid ${step.active ? '#bfdbfe' : '#e5e7eb'}`,
                    }}>
                        <span style={{ fontSize: 9, color: step.active ? '#6b7280' : '#d1d5db' }}>{step.label}: </span>
                        {step.value || '—'}
                    </div>
                </React.Fragment>
            ))}
        </div>
    );
}

// ============================================================================
// MAIN
// ============================================================================

export function TraceabilityViewer({ accessToken, userRole, userPerms = {} }: TraceabilityViewerProps) {
    const [records, setRecords] = useState<TraceRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [itemFilter, setItemFilter] = useState('');
    const [expandedContainer, setExpandedContainer] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const data = await svc.fetchFullTrace({
                item_code: itemFilter || undefined,
            });
            setRecords(data);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    }, [itemFilter]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const filtered = useMemo(() => records.filter(r => {
        if (!searchTerm) return true;
        const s = searchTerm.toLowerCase();
        return r.container_number.toLowerCase().includes(s) ||
            (r.pallet_number || '').toLowerCase().includes(s) ||
            (r.invoice_number || '').toLowerCase().includes(s) ||
            (r.packing_list_number || '').toLowerCase().includes(s) ||
            r.item_code.toLowerCase().includes(s) ||
            r.item_name.toLowerCase().includes(s) ||
            r.operator_name.toLowerCase().includes(s) ||
            r.movement_number.toLowerCase().includes(s) ||
            (r.proforma_number || '').toLowerCase().includes(s);
    }), [records, searchTerm]);

    // Unique items for filter
    const uniqueItems = useMemo(() => {
        const map = new Map<string, string>();
        records.forEach(r => map.set(r.item_code, r.item_name));
        return Array.from(map.entries());
    }, [records]);

    // Counts
    const counts = useMemo(() => ({
        total: records.length,
        withInvoice: records.filter(r => r.invoice_number).length,
        adjustment: records.filter(r => r.is_adjustment).length,
        dispatched: records.filter(r => r.dispatch_timestamp).length,
    }), [records]);

    const handleExport = () => {
        import('xlsx').then(XLSX => {
            const rows = filtered.map(r => ([
                r.container_number, r.container_type, r.container_qty,
                r.item_code, r.item_name, r.movement_number,
                r.operator_name, r.operator_employee_id || '',
                r.pallet_number || '', r.pallet_state || '',
                r.packing_list_number || '', r.invoice_number || '',
                r.proforma_number || '', r.dispatch_timestamp || '',
                r.reference_doc_type || '', r.reference_doc_number || '',
            ]));
            const headers = ['Container#', 'Type', 'Qty', 'Item', 'Name', 'Movement#', 'Operator', 'EmpID',
                'Pallet#', 'PalletState', 'PL#', 'Invoice#', 'Proforma#', 'Dispatched', 'RefDocType', 'RefDoc#'];
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Traceability');
            XLSX.writeFile(wb, `traceability_${new Date().toISOString().split('T')[0]}.xlsx`);
        });
    };

    const th: React.CSSProperties = {
        padding: '11px 14px', textAlign: 'left', fontSize: 11,
        fontWeight: 700, color: '#374151', textTransform: 'uppercase',
        letterSpacing: '0.5px', borderBottom: '2px solid #e5e7eb',
        whiteSpace: 'nowrap', background: '#f9fafb',
    };
    const td: React.CSSProperties = {
        padding: '11px 14px', fontSize: 13, color: '#111827',
        borderBottom: '1px solid #f3f4f6', whiteSpace: 'nowrap',
    };

    return (
        <div style={{ paddingBottom: 40 }}>
            <SummaryCardsGrid>
                <SummaryCard label="Total Containers" value={counts.total}
                    icon={<Box size={22} style={{ color: '#1e3a8a' }} />}
                    color="#1e3a8a" bgColor="#eff6ff" />
                <SummaryCard label="Invoiced" value={counts.withInvoice}
                    icon={<FileText size={22} style={{ color: '#16a34a' }} />}
                    color="#16a34a" bgColor="#f0fdf4" />
                <SummaryCard label="Adjustments" value={counts.adjustment}
                    icon={<AlertTriangle size={22} style={{ color: '#dc2626' }} />}
                    color="#dc2626" bgColor="#fef2f2" />
                <SummaryCard label="Dispatched" value={counts.dispatched}
                    icon={<CheckCircle2 size={22} style={{ color: '#7c3aed' }} />}
                    color="#7c3aed" bgColor="#f5f3ff" />
            </SummaryCardsGrid>

            <FilterBar>
                <SearchBox value={searchTerm} onChange={setSearchTerm}
                    placeholder="Search container, pallet, invoice, operator..." />
                <select value={itemFilter} onChange={e => setItemFilter(e.target.value)} style={{
                    padding: '8px 12px', borderRadius: 8, border: '1px solid var(--enterprise-border)',
                    fontSize: 13, background: 'white', minWidth: 160,
                }}>
                    <option value="">All Items</option>
                    {uniqueItems.map(([code, name]) => (
                        <option key={code} value={code}>{code} — {name}</option>
                    ))}
                </select>
                <ActionBar>
                    <ExportCSVButton onClick={handleExport} />
                    <RefreshButton onClick={fetchData} loading={loading} />
                </ActionBar>
            </FilterBar>

            <Card style={{ padding: 0 }}>
                {loading ? (
                    <ModuleLoader moduleName="Traceability" icon={<Eye size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />
                ) : filtered.length === 0 ? (
                    <EmptyState icon={<Eye size={48} style={{ color: 'var(--enterprise-gray-400)' }} />}
                        title="No Trace Records" description="Trace records appear once containers are created." />
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={{ ...th, width: 36 }} />
                                    <th style={th}>Container</th>
                                    <th style={th}>Item</th>
                                    <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                                    <th style={th}>Movement</th>
                                    <th style={th}>Operator</th>
                                    <th style={th}>Trace Chain</th>
                                    <th style={th}>Created</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(r => (
                                    <React.Fragment key={r.container_number}>
                                        <tr
                                            style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                                            onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                                            onClick={() => setExpandedContainer(
                                                expandedContainer === r.container_number ? null : r.container_number
                                            )}
                                        >
                                            <td style={{ ...td, textAlign: 'center', padding: '11px 8px' }}>
                                                {expandedContainer === r.container_number
                                                    ? <ChevronDown size={16} style={{ color: '#6b7280' }} />
                                                    : <ChevronRight size={16} style={{ color: '#6b7280' }} />
                                                }
                                            </td>
                                            <td style={{ ...td, fontWeight: 700, fontFamily: 'monospace', color: '#1e3a8a' }}>
                                                {r.container_number}
                                                {r.is_adjustment && (
                                                    <span style={{
                                                        marginLeft: 6, padding: '2px 6px', borderRadius: 4,
                                                        background: '#fef2f2', color: '#dc2626', fontSize: 10, fontWeight: 700,
                                                    }}>ADJ</span>
                                                )}
                                            </td>
                                            <td style={td}>
                                                <div style={{ fontWeight: 500 }}>{r.item_name}</div>
                                                <div style={{ fontSize: 11, color: '#6b7280' }}>{r.item_code}</div>
                                            </td>
                                            <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>
                                                {r.container_qty.toLocaleString()}
                                            </td>
                                            <td style={{ ...td, fontFamily: 'monospace', fontSize: 12, color: '#1e3a8a' }}>
                                                {r.movement_number}
                                            </td>
                                            <td style={td}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <User size={12} style={{ color: '#6b7280' }} />
                                                    <span style={{ fontSize: 12 }}>{r.operator_name}</span>
                                                </div>
                                                {r.operator_employee_id && (
                                                    <div style={{ fontSize: 11, color: '#9ca3af', fontFamily: 'monospace' }}>
                                                        {r.operator_employee_id}
                                                    </div>
                                                )}
                                            </td>
                                            <td style={td}>
                                                <TraceChain record={r} />
                                            </td>
                                            <td style={{ ...td, fontSize: 12, color: '#6b7280' }}>
                                                {new Date(r.container_created).toLocaleDateString('en-IN', {
                                                    day: '2-digit', month: 'short', year: 'numeric',
                                                })}
                                            </td>
                                        </tr>

                                        {/* EXPANDED: Full trace details */}
                                        {expandedContainer === r.container_number && (
                                            <tr>
                                                <td colSpan={8} style={{ padding: 0, background: '#f8fafc' }}>
                                                    <div style={{
                                                        padding: '16px 24px 20px 48px',
                                                        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16,
                                                    }}>
                                                        {/* Container */}
                                                        <div style={{ background: 'white', borderRadius: 8, padding: 14, border: '1px solid #e5e7eb' }}>
                                                            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>Container</div>
                                                            <div style={{ fontSize: 13 }}>
                                                                <div><strong>Number:</strong> <code>{r.container_number}</code></div>
                                                                <div><strong>Type:</strong> {r.container_type}</div>
                                                                <div><strong>Qty:</strong> {r.container_qty.toLocaleString()} pcs</div>
                                                                <div><strong>Sticker:</strong> {r.sticker_printed ? '✅ Printed' : '⏳ Pending'}</div>
                                                            </div>
                                                        </div>
                                                        {/* Movement */}
                                                        <div style={{ background: 'white', borderRadius: 8, padding: 14, border: '1px solid #e5e7eb' }}>
                                                            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>Stock Movement</div>
                                                            <div style={{ fontSize: 13 }}>
                                                                <div><strong>Movement #:</strong> <code>{r.movement_number}</code></div>
                                                                <div><strong>Operator:</strong> {r.operator_name}</div>
                                                                {r.operator_employee_id && <div><strong>Emp ID:</strong> {r.operator_employee_id}</div>}
                                                                {r.reference_doc_type && <div><strong>Ref:</strong> {r.reference_doc_type} — {r.reference_doc_number}</div>}
                                                            </div>
                                                        </div>
                                                        {/* Pallet */}
                                                        <div style={{ background: 'white', borderRadius: 8, padding: 14, border: '1px solid #e5e7eb' }}>
                                                            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>Pallet</div>
                                                            <div style={{ fontSize: 13 }}>
                                                                <div><strong>Number:</strong> {r.pallet_number || '—'}</div>
                                                                <div><strong>State:</strong> {r.pallet_state || '—'}</div>
                                                                {r.pallet_target && <div><strong>Fill:</strong> {r.pallet_actual?.toLocaleString()} / {r.pallet_target?.toLocaleString()}</div>}
                                                            </div>
                                                        </div>
                                                        {/* Document Chain */}
                                                        <div style={{ background: 'white', borderRadius: 8, padding: 14, border: '1px solid #e5e7eb' }}>
                                                            <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>Document Chain</div>
                                                            <div style={{ fontSize: 13 }}>
                                                                <div><strong>Packing List:</strong> {r.packing_list_number || '—'}</div>
                                                                <div><strong>Invoice:</strong> {r.invoice_number || '—'}</div>
                                                                <div><strong>Proforma:</strong> {r.proforma_number || '—'}</div>
                                                                {r.dispatch_timestamp && <div><strong>Dispatched:</strong> {new Date(r.dispatch_timestamp).toLocaleString('en-IN')}</div>}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}
