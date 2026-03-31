/**
 * ContractConfigManager — Shows packing specs from `packing_specifications` table
 *
 * The outer_box_quantity and inner_box_quantity already exist in packing_specifications
 * (managed by Packing Details). This view shows them with live container/adjustment calculation.
 * No manual "New Contract Config" needed — data comes from Packing Details.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Settings, Box, Package, RefreshCw, AlertTriangle,
    Calculator, Layers, Hash, Info, CheckCircle2,
} from 'lucide-react';
import { Card, EmptyState, ModuleLoader } from '../ui/EnterpriseUI';
import {
    SummaryCard, SummaryCardsGrid, SearchBox, FilterBar,
    ActionBar, RefreshButton, ExportCSVButton,
} from '../ui/SharedComponents';
import { fetchPackingSpecs } from './packingEngineService';
import type { PackingSpec } from './packingEngineService';

type UserRole = 'L1' | 'L2' | 'L3' | null;

interface ContractConfigManagerProps {
    accessToken: string;
    userRole?: UserRole;
    userPerms?: Record<string, boolean>;
}

// ============================================================================
// CALCULATION PREVIEW (pure function)
// ============================================================================
function calcContainerBreakdown(outerQty: number, innerQty: number) {
    if (!outerQty || !innerQty || innerQty <= 0) return { full: 0, adjustment: 0, total: 0 };
    const full = Math.floor(outerQty / innerQty);
    const adjustment = outerQty % innerQty;
    return { full, adjustment, total: outerQty };
}

// ============================================================================
// MAIN
// ============================================================================
export function ContractConfigManager({ accessToken, userRole, userPerms = {} }: ContractConfigManagerProps) {
    const [specs, setSpecs] = useState<PackingSpec[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedItem, setExpandedItem] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const data = await fetchPackingSpecs();
            setSpecs(data);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchData(); }, [fetchData]);

    const filtered = useMemo(() => specs.filter(s => {
        if (!searchTerm) return true;
        const q = searchTerm.toLowerCase();
        return s.item_code.toLowerCase().includes(q) ||
            (s.item_name || '').toLowerCase().includes(q) ||
            (s.master_serial_no || '').toLowerCase().includes(q);
    }), [specs, searchTerm]);

    // Summary
    const configured = specs.filter(s => s.outer_box_quantity > 0 && s.inner_box_quantity > 0).length;
    const missing = specs.filter(s => s.outer_box_quantity <= 0 || s.inner_box_quantity <= 0).length;

    const handleExport = () => {
        import('xlsx').then(XLSX => {
            const rows = filtered.map(s => {
                const b = calcContainerBreakdown(s.outer_box_quantity, s.inner_box_quantity);
                return [s.item_code, s.item_name || '', s.master_serial_no || '',
                s.outer_box_quantity, s.inner_box_quantity, b.full, b.adjustment,
                s.inner_box_net_weight_kg, s.outer_box_gross_weight_kg];
            });
            const headers = ['Item Code', 'Item Name', 'Serial No', 'Outer Qty', 'Inner Qty',
                'Full Containers', 'Adjustment', 'Inner Net Wt (kg)', 'Outer Gross Wt (kg)'];
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'PackingSpecs');
            XLSX.writeFile(wb, `packing_specs_${new Date().toISOString().split('T')[0]}.xlsx`);
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

    // ── FIRST-LOAD: full-page skeleton ──
    if (loading && specs.length === 0) {
        return <ModuleLoader moduleName="Packing Specifications" icon={<Settings size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />;
    }

    return (
        <div style={{ paddingBottom: 40 }}>
            <SummaryCardsGrid>
                <SummaryCard label="Total Items" value={specs.length}
                    icon={<Package size={22} style={{ color: '#1e3a8a' }} />}
                    color="#1e3a8a" bgColor="#eff6ff" />
                <SummaryCard label="Configured" value={configured}
                    icon={<CheckCircle2 size={22} style={{ color: '#16a34a' }} />}
                    color="#16a34a" bgColor="#f0fdf4" />
                <SummaryCard label="Missing Qty" value={missing}
                    icon={<AlertTriangle size={22} style={{ color: '#dc2626' }} />}
                    color="#dc2626" bgColor="#fef2f2" />
            </SummaryCardsGrid>

            {/* Info banner */}
            <div style={{
                padding: '12px 20px', borderRadius: 10, marginBottom: 16,
                background: 'linear-gradient(135deg, #eff6ff, #f0f4ff)',
                border: '1px solid #bfdbfe', display: 'flex', alignItems: 'center', gap: 10,
            }}>
                <Info size={18} style={{ color: '#1e3a8a', flexShrink: 0 }} />
                <span style={{ fontSize: 13, color: '#1e40af' }}>
                    Outer and inner box quantities come from <strong>Packing Details</strong>.
                    Update them there — contract calculations are shown here automatically.
                </span>
            </div>

            <FilterBar>
                <SearchBox value={searchTerm} onChange={setSearchTerm}
                    placeholder="Search item code, name, serial..." />
                <ActionBar>
                    <ExportCSVButton onClick={handleExport} />
                    <RefreshButton onClick={fetchData} loading={loading} />
                </ActionBar>
            </FilterBar>

            <Card style={{ padding: 0 }}>
                {loading && specs.length === 0 ? (
                    <ModuleLoader moduleName="Packing Specifications" icon={<Settings size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />
                ) : filtered.length === 0 ? (
                    <EmptyState icon={<Settings size={48} style={{ color: 'var(--enterprise-gray-400)' }} />}
                        title="No Packing Specifications"
                        description="Add packing specifications in Packing Details first." />
                ) : (
                    <div style={{ overflowX: 'auto', opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s', pointerEvents: loading ? 'none' : 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={th}>Item</th>
                                    <th style={{ ...th, textAlign: 'right' }}>Outer Box Qty</th>
                                    <th style={{ ...th, textAlign: 'right' }}>Inner Box Qty</th>
                                    <th style={{ ...th, textAlign: 'center' }}>Full Containers</th>
                                    <th style={{ ...th, textAlign: 'center' }}>Top-off</th>
                                    <th style={{ ...th, textAlign: 'center' }}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(s => {
                                    const b = calcContainerBreakdown(s.outer_box_quantity, s.inner_box_quantity);
                                    const isValid = s.outer_box_quantity > 0 && s.inner_box_quantity > 0;
                                    const isExpanded = expandedItem === s.item_code;

                                    return (
                                        <React.Fragment key={s.id}>
                                            <tr
                                                style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                                                onMouseLeave={e => (e.currentTarget.style.background = '')}
                                                onClick={() => setExpandedItem(isExpanded ? null : s.item_code)}
                                            >
                                                <td style={td}>
                                                    <div style={{ fontWeight: 600 }}>{s.item_name || s.item_code}</div>
                                                    <div style={{ fontSize: 11, color: '#6b7280', fontFamily: 'monospace' }}>
                                                        {s.item_code}
                                                        {s.master_serial_no && <span> | {s.master_serial_no}</span>}
                                                    </div>
                                                </td>
                                                <td style={{ ...td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', fontSize: 14 }}>
                                                    {s.outer_box_quantity > 0 ? s.outer_box_quantity.toLocaleString() : '—'}
                                                </td>
                                                <td style={{ ...td, textAlign: 'right', fontWeight: 700, fontFamily: 'monospace', fontSize: 14 }}>
                                                    {s.inner_box_quantity > 0 ? s.inner_box_quantity.toLocaleString() : '—'}
                                                </td>
                                                <td style={{ ...td, textAlign: 'center' }}>
                                                    {isValid ? (
                                                        <span style={{
                                                            padding: '3px 10px', borderRadius: 6, fontWeight: 700,
                                                            fontSize: 13, fontFamily: 'monospace',
                                                            background: '#eff6ff', color: '#1e3a8a',
                                                        }}>{b.full}</span>
                                                    ) : '—'}
                                                </td>
                                                <td style={{ ...td, textAlign: 'center' }}>
                                                    {isValid && b.adjustment > 0 ? (
                                                        <span style={{
                                                            padding: '3px 10px', borderRadius: 6, fontWeight: 700,
                                                            fontSize: 13, fontFamily: 'monospace',
                                                            background: '#fef3c7', color: '#92400e',
                                                        }}>{b.adjustment} pcs</span>
                                                    ) : isValid ? (
                                                        <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 600 }}>Clean</span>
                                                    ) : '—'}
                                                </td>
                                                <td style={{ ...td, textAlign: 'center' }}>
                                                    {isValid ? (
                                                        <span style={{
                                                            padding: '3px 10px', borderRadius: 12, fontWeight: 700,
                                                            fontSize: 10, textTransform: 'uppercase',
                                                            background: '#f0fdf4', color: '#16a34a',
                                                        }}>Ready</span>
                                                    ) : (
                                                        <span style={{
                                                            padding: '3px 10px', borderRadius: 12, fontWeight: 700,
                                                            fontSize: 10, textTransform: 'uppercase',
                                                            background: '#fef2f2', color: '#dc2626',
                                                        }}>Incomplete</span>
                                                    )}
                                                </td>
                                            </tr>

                                            {/* Expanded: calculation visual */}
                                            {isExpanded && isValid && (
                                                <tr>
                                                    <td colSpan={6} style={{ padding: 0, background: '#f8fafc' }}>
                                                        <div style={{
                                                            padding: '16px 24px 20px',
                                                            display: 'flex', flexWrap: 'wrap', gap: 16,
                                                        }}>
                                                            <div style={{
                                                                flex: 1, minWidth: 220, background: 'white',
                                                                borderRadius: 10, padding: 16, border: '1px solid #e5e7eb',
                                                            }}>
                                                                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>
                                                                    <Calculator size={12} style={{ marginRight: 4 }} />Container Calculation
                                                                </div>
                                                                <div style={{ fontSize: 13, lineHeight: 2 }}>
                                                                    <div>{b.full} full containers × {s.inner_box_quantity} pcs = <strong>{b.full * s.inner_box_quantity}</strong> pcs</div>
                                                                    {b.adjustment > 0 && (
                                                                        <div>+ 1 Top-off Box = <strong>{b.adjustment}</strong> pcs</div>
                                                                    )}
                                                                    <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 4, marginTop: 4 }}>
                                                                        Total: <strong style={{ color: '#1e3a8a' }}>{s.outer_box_quantity.toLocaleString()}</strong> pcs per pallet
                                                                    </div>
                                                                </div>
                                                            </div>
                                                            <div style={{
                                                                flex: 1, minWidth: 220, background: 'white',
                                                                borderRadius: 10, padding: 16, border: '1px solid #e5e7eb',
                                                            }}>
                                                                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 8 }}>
                                                                    <Box size={12} style={{ marginRight: 4 }} />Box Dimensions
                                                                </div>
                                                                <div style={{ fontSize: 13, lineHeight: 2 }}>
                                                                    <div><strong>Inner:</strong> {s.inner_box_length_mm}×{s.inner_box_width_mm}×{s.inner_box_height_mm} mm</div>
                                                                    <div><strong>Outer:</strong> {s.outer_box_length_mm}×{s.outer_box_width_mm}×{s.outer_box_height_mm} mm</div>
                                                                    <div><strong>Net Wt:</strong> {s.inner_box_net_weight_kg} kg | <strong>Gross:</strong> {s.outer_box_gross_weight_kg} kg</div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
            </Card>
        </div>
    );
}
