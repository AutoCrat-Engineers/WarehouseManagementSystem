import React, { useState, useEffect, useMemo } from 'react';
import {
    AlertTriangle, CheckCircle, XCircle, TrendingUp, TrendingDown,
    Package, BarChart3, Shield, Clock, ChevronDown, ChevronUp,
    Activity, Zap, Target, Search, Warehouse, Truck,
    ArrowUpRight, ArrowDownRight, CalendarClock, X
} from 'lucide-react';

/* ═══════════════════════════════════════════════════════════ */
/*  TYPES                                                     */
/* ═══════════════════════════════════════════════════════════ */

interface WarehouseStock {
    warehouse_code: string; warehouse_name: string; warehouse_type: string;
    on_hand: number; allocated: number; reserved: number;
    in_transit: number; available: number;
}

interface Release {
    release_number: string; requested_delivery_date: string;
    requested_quantity: number; delivered_quantity: number; status: string;
    outstanding_qty: number; days_until_delivery: number;
    is_overdue: boolean; qty_reserved_from_stock: number;
}

interface MonthlyActivity {
    activity_month: string; inbound_qty: number; outbound_qty: number;
    net_change: number; transaction_count: number; ending_balance: number;
}

interface PlanningItem {
    item_code: string; item_name: string; order_number: string;
    customer_name: string; uom: string; lead_time_days: number;
    monthly_usage: number; bo_quantity: number; annual_qty: number;
    min_stock: number; max_stock: number; safety_stock: number;
    order_multiple: number | null; packing_multiple: number | null;
    total_on_hand: number; total_allocated: number; total_reserved: number;
    total_in_transit: number; total_available: number;
    warehouse_stock: WarehouseStock[];
    total_delivered: number; remaining_annual: number; remaining_bo: number;
    months_coverage: number | null; production_allowed: number;
    pending_release_qty: number; reserved_for_releases: number;
    effective_available: number; releases: Release[];
    stock_status: string; bo_fulfillment_pct: number; annual_fulfillment_pct: number;
    months_remaining_in_bo: number; required_monthly_rate: number;
    bo_start_date: string; bo_end_date: string;
    monthly_activity: MonthlyActivity[];
}

interface Alert { title: string; message: string; type: string; priority: string; item_code: string; item_name: string; }
interface ForecastEntry { item_code: string; forecast_date: string; forecasted_quantity: number; lower_bound: number; upper_bound: number; }
interface PlanningData {
    run_date: string; engine_version: string; mode: string;
    summary: { total_bo_lines: number; processed: number; alerts_generated: number; forecasts_generated: number; };
    items: PlanningItem[]; alerts: Alert[]; forecasts: ForecastEntry[];
}

/* ═══════════════════════════════════════════════════════════ */
/*  CONSTANTS                                                 */
/* ═══════════════════════════════════════════════════════════ */

const STATUS_CFG: Record<string, { color: string; bg: string; border: string; icon: React.ElementType; label: string }> = {
    LOW_STOCK: { color: '#dc2626', bg: '#fef2f2', border: '#fecaca', icon: AlertTriangle, label: 'Low Stock' },
    BO_CONSUMED: { color: '#7c3aed', bg: '#f5f3ff', border: '#ddd6fe', icon: XCircle, label: 'BO Consumed' },
    COMMITMENT_LOW: { color: '#d97706', bg: '#fffbeb', border: '#fde68a', icon: Shield, label: 'Commitment Low' },
    MAX_STOCK: { color: '#2563eb', bg: '#eff6ff', border: '#bfdbfe', icon: Package, label: 'Max Stock' },
    HEALTHY: { color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', icon: CheckCircle, label: 'Healthy' },
};

const PRI_CFG: Record<string, { color: string; bg: string }> = {
    CRITICAL: { color: '#dc2626', bg: '#fef2f2' }, HIGH: { color: '#d97706', bg: '#fffbeb' },
    MEDIUM: { color: '#2563eb', bg: '#eff6ff' }, LOW: { color: '#16a34a', bg: '#f0fdf4' },
};

/* ═══════════════════════════════════════════════════════════ */
/*  PRIMITIVES                                                */
/* ═══════════════════════════════════════════════════════════ */

const Card = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
    <div style={{ backgroundColor: 'var(--card-background,#fff)', borderRadius: 12, border: '1px solid var(--border-color,#e5e7eb)', boxShadow: '0 1px 3px rgba(0,0,0,.08)', ...style }}>{children}</div>
);

const ProgressBar = ({ value, max, color, h = 8 }: { value: number; max: number; color: string; h?: number }) => {
    const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
    return (
        <div style={{ width: '100%', height: h, backgroundColor: '#e5e7eb', borderRadius: h, overflow: 'hidden' }}>
            <div style={{ width: `${pct}%`, height: '100%', backgroundColor: color, borderRadius: h, transition: 'width 500ms cubic-bezier(.4,0,.2,1)' }} />
        </div>
    );
};

const Metric = ({ label, value, sub, color }: { label: string; value: string | number; sub?: string; color?: string }) => (
    <div style={{ textAlign: 'center', padding: '12px 8px' }}>
        <div style={{ fontSize: 11, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.5px' }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 700, color: color || '#111827', marginTop: 2, fontVariantNumeric: 'tabular-nums' }}>{typeof value === 'number' ? value.toLocaleString() : value}</div>
        {sub && <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{sub}</div>}
    </div>
);

/* ═══════════════════════════════════════════════════════════ */
/*  MAIN COMPONENT                                            */
/* ═══════════════════════════════════════════════════════════ */

export function PlanningDashboard() {
    const [data, setData] = useState<PlanningData | null>(null);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedItem, setSelectedItem] = useState<string | null>(null);
    const [showDropdown, setShowDropdown] = useState(false);

    useEffect(() => {
        fetch('/planning_demo.json')
            .then(r => r.ok ? r.json() : Promise.reject('Failed'))
            .then((d: PlanningData) => { setData(d); setLoading(false); })
            .catch(() => setLoading(false));
    }, []);

    // Search filtering
    const filteredItems = useMemo(() => {
        if (!data) return [];
        const q = searchQuery.toLowerCase().trim();
        if (!q) return data.items;
        return data.items.filter(i =>
            i.item_code.toLowerCase().includes(q) ||
            i.item_name.toLowerCase().includes(q) ||
            i.customer_name.toLowerCase().includes(q)
        );
    }, [data, searchQuery]);

    const selectedItemData = useMemo(() => data?.items.find(i => i.item_code === selectedItem), [data, selectedItem]);
    const selectedForecasts = useMemo(() => data?.forecasts.filter(f => f.item_code === selectedItem) || [], [data, selectedItem]);

    if (loading) return (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 400, gap: 12 }}>
            <Activity size={24} style={{ color: '#1e3a8a', animation: 'spin 1s linear infinite' }} />
            <span style={{ color: '#6b7280' }}>Loading planning engine...</span>
        </div>
    );

    if (!data) return (
        <div style={{ padding: 32, textAlign: 'center' }}>
            <AlertTriangle size={48} style={{ color: '#d97706', margin: '0 auto 16px' }} />
            <h3 style={{ color: '#111827' }}>Run <code style={{ backgroundColor: '#f3f4f6', padding: '2px 8px', borderRadius: 4 }}>python -m planning_engine.demo</code></h3>
        </div>
    );

    const critCount = data.items.filter(i => ['LOW_STOCK', 'BO_CONSUMED'].includes(i.stock_status)).length;
    const healthyCount = data.items.filter(i => i.stock_status === 'HEALTHY').length;
    const totalProd = data.items.reduce((s, i) => s + i.production_allowed, 0);

    return (
        <div style={{ padding: 0, maxWidth: '100%' }}>

            {/* ═══ HEADER ═══ */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#111827' }}>Supply Chain Alert Engine</h2>
                    <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>
                        Run: {data.run_date} • Engine v{data.engine_version}
                    </p>
                </div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 20, backgroundColor: '#dbeafe', color: '#1e40af', fontSize: 12, fontWeight: 600 }}>
                    <Zap size={14} /> MOCK DATA
                </div>
            </div>

            {/* ═══ SEARCH BAR ═══ */}
            <div style={{ position: 'relative', marginBottom: 20 }}>
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 16px', borderRadius: 10,
                    border: '2px solid', borderColor: showDropdown ? '#3b82f6' : 'var(--border-color,#e5e7eb)',
                    backgroundColor: 'var(--card-background,#fff)', transition: 'border-color 200ms',
                    boxShadow: showDropdown ? '0 0 0 3px rgba(59,130,246,.15)' : 'none',
                }}>
                    <Search size={18} style={{ color: '#9ca3af', flexShrink: 0 }} />
                    <input
                        type="text"
                        placeholder="Search by item code, name, or customer..."
                        value={searchQuery}
                        onChange={e => { setSearchQuery(e.target.value); setShowDropdown(true); }}
                        onFocus={() => setShowDropdown(true)}
                        style={{
                            flex: 1, border: 'none', outline: 'none', fontSize: 14, color: '#111827',
                            backgroundColor: 'transparent', fontFamily: 'inherit',
                        }}
                    />
                    {searchQuery && (
                        <button onClick={() => { setSearchQuery(''); setSelectedItem(null); setShowDropdown(false); }}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex' }}>
                            <X size={16} style={{ color: '#9ca3af' }} />
                        </button>
                    )}
                </div>

                {/* Dropdown search results */}
                {showDropdown && searchQuery && filteredItems.length > 0 && (
                    <div style={{
                        position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                        backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: 10,
                        boxShadow: '0 10px 25px rgba(0,0,0,.12)', marginTop: 4, maxHeight: 300, overflowY: 'auto',
                    }}>
                        {filteredItems.map(item => {
                            const s = STATUS_CFG[item.stock_status] || STATUS_CFG.HEALTHY;
                            return (
                                <button key={item.item_code}
                                    onClick={() => { setSelectedItem(item.item_code); setSearchQuery(item.item_code); setShowDropdown(false); }}
                                    style={{
                                        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                                        padding: '10px 16px', border: 'none', borderBottom: '1px solid #f3f4f6',
                                        backgroundColor: selectedItem === item.item_code ? '#eff6ff' : '#fff',
                                        cursor: 'pointer', textAlign: 'left', transition: 'background 100ms',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f9fafb'}
                                    onMouseLeave={e => e.currentTarget.style.backgroundColor = selectedItem === item.item_code ? '#eff6ff' : '#fff'}
                                >
                                    <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: s.color, flexShrink: 0 }} />
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ fontSize: 13, fontWeight: 600, color: '#111827' }}>{item.item_code}</div>
                                        <div style={{ fontSize: 11, color: '#6b7280', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.item_name}</div>
                                    </div>
                                    <div style={{ fontSize: 11, color: s.color, fontWeight: 600 }}>{s.label}</div>
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* ═══ STAT CARDS ═══ */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14, marginBottom: 20 }}>
                {[
                    { icon: Package, label: 'Items', value: data.summary.processed, sub: `${data.summary.total_bo_lines} BO lines`, color: '#1e3a8a' },
                    { icon: AlertTriangle, label: 'Alerts', value: data.summary.alerts_generated, sub: `${critCount} critical`, color: '#dc2626' },
                    { icon: CheckCircle, label: 'Healthy', value: healthyCount, sub: `of ${data.items.length}`, color: '#16a34a' },
                    { icon: Target, label: 'Prod. Allowed', value: totalProd.toLocaleString(), sub: 'Units', color: '#7c3aed' },
                ].map((c, i) => (
                    <Card key={i} style={{ padding: '16px 18px', display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ width: 38, height: 38, borderRadius: 9, backgroundColor: `${c.color}12`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <c.icon size={18} style={{ color: c.color }} />
                        </div>
                        <div>
                            <div style={{ fontSize: 11, fontWeight: 500, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.4px' }}>{c.label}</div>
                            <div style={{ fontSize: 22, fontWeight: 700, color: '#111827' }}>{c.value}</div>
                            {c.sub && <div style={{ fontSize: 11, color: '#9ca3af' }}>{c.sub}</div>}
                        </div>
                    </Card>
                ))}
            </div>

            {/* ═══ ALERTS ═══ */}
            {data.alerts.length > 0 && (
                <Card style={{ marginBottom: 20 }}>
                    <div style={{ padding: '14px 18px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}>
                        <AlertTriangle size={16} style={{ color: '#dc2626' }} />
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#111827' }}>Active Alerts ({data.alerts.length})</span>
                    </div>
                    <div style={{ padding: '12px 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {data.alerts.map((a, i) => {
                            const p = PRI_CFG[a.priority] || PRI_CFG.MEDIUM;
                            return (
                                <div key={i} onClick={() => { setSelectedItem(a.item_code); setSearchQuery(a.item_code); }}
                                    style={{
                                        padding: '10px 14px', borderRadius: 8, border: `1px solid ${p.color}25`,
                                        backgroundColor: p.bg, display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer',
                                    }}>
                                    <span style={{ padding: '3px 8px', borderRadius: 10, fontSize: 10, fontWeight: 700, backgroundColor: p.color, color: '#fff', textTransform: 'uppercase', flexShrink: 0 }}>{a.priority}</span>
                                    <div style={{ flex: 1 }}>
                                        <div style={{ fontSize: 12, fontWeight: 600, color: '#111827' }}>{a.title}</div>
                                        <div style={{ fontSize: 11, color: '#4b5563', marginTop: 2 }}>{a.message}</div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </Card>
            )}

            {/* ═══ ITEMS TABLE ═══ */}
            <Card style={{ marginBottom: 20, overflow: 'hidden' }}>
                <div style={{ padding: '14px 18px', borderBottom: '1px solid #f3f4f6' }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600, color: '#111827' }}>Item Planning Status</h3>
                    <p style={{ margin: '2px 0 0', fontSize: 11, color: '#6b7280' }}>Click a row to drill into analytics</p>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                        <thead>
                            <tr style={{ backgroundColor: '#f9fafb' }}>
                                {['Status', 'Item', 'Customer', 'MU/mo', 'On Hand', 'Allocated', 'Reserved', 'In Transit', 'Available', 'Min', 'Max', 'Remaining', 'Coverage', 'Production', 'BO %'].map(h => (
                                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '.5px', borderBottom: '1px solid #e5e7eb', whiteSpace: 'nowrap' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {(searchQuery && !selectedItem ? filteredItems : data.items).map(item => {
                                const s = STATUS_CFG[item.stock_status] || STATUS_CFG.HEALTHY;
                                const Icon = s.icon;
                                const sel = selectedItem === item.item_code;
                                return (
                                    <tr key={item.item_code}
                                        onClick={() => { setSelectedItem(sel ? null : item.item_code); if (!sel) setSearchQuery(item.item_code); }}
                                        style={{ cursor: 'pointer', backgroundColor: sel ? '#eff6ff' : undefined, borderBottom: '1px solid #f3f4f6', transition: 'background 100ms' }}
                                        onMouseEnter={e => { if (!sel) e.currentTarget.style.backgroundColor = '#f9fafb'; }}
                                        onMouseLeave={e => { if (!sel) e.currentTarget.style.backgroundColor = ''; }}
                                    >
                                        <td style={{ padding: '10px 12px' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600, backgroundColor: s.bg, color: s.color, border: `1px solid ${s.border}`, whiteSpace: 'nowrap' }}>
                                                <Icon size={11} /> {s.label}
                                            </span>
                                        </td>
                                        <td style={{ padding: '10px 12px' }}>
                                            <div style={{ fontWeight: 600, color: '#111827', fontSize: 12 }}>{item.item_code}</div>
                                            <div style={{ fontSize: 10, color: '#6b7280', maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.item_name}</div>
                                        </td>
                                        <td style={{ padding: '10px 12px', color: '#4b5563', whiteSpace: 'nowrap', fontSize: 11 }}>{item.customer_name}</td>
                                        <td style={{ padding: '10px 12px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{item.monthly_usage.toLocaleString()}</td>
                                        <td style={{ padding: '10px 12px', fontWeight: 600, color: s.color, fontVariantNumeric: 'tabular-nums' }}>{item.total_on_hand.toLocaleString()}</td>
                                        <td style={{ padding: '10px 12px', color: item.total_allocated > 0 ? '#d97706' : '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>{item.total_allocated.toLocaleString()}</td>
                                        <td style={{ padding: '10px 12px', color: item.total_reserved > 0 ? '#7c3aed' : '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>{item.total_reserved.toLocaleString()}</td>
                                        <td style={{ padding: '10px 12px', color: item.total_in_transit > 0 ? '#2563eb' : '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>{item.total_in_transit.toLocaleString()}</td>
                                        <td style={{ padding: '10px 12px', fontWeight: 600, color: '#111827', fontVariantNumeric: 'tabular-nums' }}>{item.total_available.toLocaleString()}</td>
                                        <td style={{ padding: '10px 12px', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{item.min_stock.toLocaleString()}</td>
                                        <td style={{ padding: '10px 12px', color: '#6b7280', fontVariantNumeric: 'tabular-nums' }}>{item.max_stock.toLocaleString()}</td>
                                        <td style={{ padding: '10px 12px', fontWeight: 600, color: item.remaining_annual <= 0 ? '#dc2626' : '#111827', fontVariantNumeric: 'tabular-nums' }}>{item.remaining_annual.toLocaleString()}</td>
                                        <td style={{ padding: '10px 12px', whiteSpace: 'nowrap' }}>
                                            <span style={{ fontWeight: 600, color: item.months_coverage !== null ? (item.months_coverage < 2 ? '#dc2626' : item.months_coverage < 4 ? '#d97706' : '#16a34a') : '#9ca3af' }}>
                                                {item.months_coverage !== null ? `${item.months_coverage} mo` : '∞'}
                                            </span>
                                        </td>
                                        <td style={{ padding: '10px 12px', fontWeight: 700, color: item.production_allowed > 0 ? '#16a34a' : '#9ca3af', fontVariantNumeric: 'tabular-nums' }}>
                                            {item.production_allowed > 0 ? item.production_allowed.toLocaleString() : '—'}
                                        </td>
                                        <td style={{ padding: '10px 12px', minWidth: 80 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                <ProgressBar value={item.bo_fulfillment_pct} max={100} color={item.bo_fulfillment_pct >= 100 ? '#7c3aed' : '#1e3a8a'} h={5} />
                                                <span style={{ fontSize: 10, fontWeight: 600, color: '#6b7280' }}>{item.bo_fulfillment_pct}%</span>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </Card>

            {/* ═══════════════════════════════════════════════════════════ */}
            {/* ITEM DEEP ANALYTICS (shown when an item is selected)      */}
            {/* ═══════════════════════════════════════════════════════════ */}

            {selectedItemData && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

                    {/* Item Header */}
                    <Card style={{ padding: '18px 20px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: '#111827' }}>{selectedItemData.item_code}</h3>
                                    {(() => {
                                        const s = STATUS_CFG[selectedItemData.stock_status] || STATUS_CFG.HEALTHY; const I = s.icon; return (
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 14, fontSize: 11, fontWeight: 600, backgroundColor: s.bg, color: s.color, border: `1px solid ${s.border}` }}><I size={12} /> {s.label}</span>
                                        );
                                    })()}
                                </div>
                                <p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>{selectedItemData.item_name} • {selectedItemData.customer_name} • {selectedItemData.order_number}</p>
                            </div>
                            <button onClick={() => { setSelectedItem(null); setSearchQuery(''); }}
                                style={{ background: '#f3f4f6', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, cursor: 'pointer', fontWeight: 500, color: '#6b7280' }}>
                                Clear Selection
                            </button>
                        </div>
                    </Card>

                    {/* Key Metrics Row */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 14 }}>
                        <Card><Metric label="MU / Month" value={selectedItemData.monthly_usage} color="#1e3a8a" /></Card>
                        <Card><Metric label="On Hand" value={selectedItemData.total_on_hand} sub={`Available: ${selectedItemData.total_available.toLocaleString()}`} color={STATUS_CFG[selectedItemData.stock_status]?.color} /></Card>
                        <Card><Metric label="Allocated" value={selectedItemData.total_allocated} sub="For releases" color="#d97706" /></Card>
                        <Card><Metric label="Reserved" value={selectedItemData.total_reserved} sub={`From stock: ${selectedItemData.reserved_for_releases.toLocaleString()}`} color="#7c3aed" /></Card>
                        <Card><Metric label="In Transit" value={selectedItemData.total_in_transit} sub="En route" color="#2563eb" /></Card>
                        <Card><Metric label="Production" value={selectedItemData.production_allowed} sub="Allowed" color="#16a34a" /></Card>
                    </div>

                    {/* Commitment + Warehouse side by side */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>

                        {/* Commitment Tracker */}
                        <Card style={{ padding: '16px 18px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                                <Target size={16} style={{ color: '#1e3a8a' }} />
                                <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#111827' }}>Commitment Tracker</h4>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                                        <span style={{ color: '#6b7280' }}>BO Fulfillment</span>
                                        <span style={{ fontWeight: 600 }}>{selectedItemData.total_delivered.toLocaleString()} / {selectedItemData.bo_quantity.toLocaleString()} ({selectedItemData.bo_fulfillment_pct}%)</span>
                                    </div>
                                    <ProgressBar value={selectedItemData.bo_fulfillment_pct} max={100} color={selectedItemData.bo_fulfillment_pct >= 100 ? '#7c3aed' : '#1e3a8a'} />
                                </div>
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 4 }}>
                                        <span style={{ color: '#6b7280' }}>Annual Commitment</span>
                                        <span style={{ fontWeight: 600 }}>{selectedItemData.total_delivered.toLocaleString()} / {selectedItemData.annual_qty.toLocaleString()} ({selectedItemData.annual_fulfillment_pct}%)</span>
                                    </div>
                                    <ProgressBar value={selectedItemData.annual_fulfillment_pct} max={100} color="#16a34a" />
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 4 }}>
                                    <div style={{ padding: '8px 10px', backgroundColor: '#f9fafb', borderRadius: 8 }}>
                                        <div style={{ fontSize: 10, color: '#6b7280' }}>Remaining Annual</div>
                                        <div style={{ fontSize: 15, fontWeight: 700, color: selectedItemData.remaining_annual <= 0 ? '#dc2626' : '#111827' }}>{selectedItemData.remaining_annual.toLocaleString()}</div>
                                    </div>
                                    <div style={{ padding: '8px 10px', backgroundColor: '#f9fafb', borderRadius: 8 }}>
                                        <div style={{ fontSize: 10, color: '#6b7280' }}>Months Left in BO</div>
                                        <div style={{ fontSize: 15, fontWeight: 700, color: '#111827' }}>{selectedItemData.months_remaining_in_bo}</div>
                                    </div>
                                    <div style={{ padding: '8px 10px', backgroundColor: '#f9fafb', borderRadius: 8 }}>
                                        <div style={{ fontSize: 10, color: '#6b7280' }}>Required/Month</div>
                                        <div style={{ fontSize: 15, fontWeight: 700, color: selectedItemData.required_monthly_rate > selectedItemData.monthly_usage ? '#dc2626' : '#111827' }}>{selectedItemData.required_monthly_rate.toLocaleString()}</div>
                                    </div>
                                    <div style={{ padding: '8px 10px', backgroundColor: '#f9fafb', borderRadius: 8 }}>
                                        <div style={{ fontSize: 10, color: '#6b7280' }}>Coverage</div>
                                        <div style={{ fontSize: 15, fontWeight: 700, color: (selectedItemData.months_coverage || 0) < 2 ? '#dc2626' : '#16a34a' }}>{selectedItemData.months_coverage ?? '∞'} mo</div>
                                    </div>
                                </div>
                            </div>
                        </Card>

                        {/* Warehouse Stock Breakdown */}
                        <Card style={{ padding: '16px 18px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                                <Warehouse size={16} style={{ color: '#1e3a8a' }} />
                                <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#111827' }}>Stock by Warehouse</h4>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                                        {['Warehouse', 'On Hand', 'Alloc', 'Rsrvd', 'Transit', 'Avail'].map(h => (
                                            <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {selectedItemData.warehouse_stock.map((wh, i) => (
                                        <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                                            <td style={{ padding: '8px', fontWeight: 600, color: '#111827' }}>
                                                <div>{wh.warehouse_code}</div>
                                                <div style={{ fontSize: 10, color: '#9ca3af', fontWeight: 400 }}>{wh.warehouse_type}</div>
                                            </td>
                                            <td style={{ padding: '8px', fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{wh.on_hand.toLocaleString()}</td>
                                            <td style={{ padding: '8px', color: wh.allocated > 0 ? '#d97706' : '#d1d5db', fontVariantNumeric: 'tabular-nums' }}>{wh.allocated.toLocaleString()}</td>
                                            <td style={{ padding: '8px', color: wh.reserved > 0 ? '#7c3aed' : '#d1d5db', fontVariantNumeric: 'tabular-nums' }}>{wh.reserved.toLocaleString()}</td>
                                            <td style={{ padding: '8px', color: wh.in_transit > 0 ? '#2563eb' : '#d1d5db', fontVariantNumeric: 'tabular-nums' }}>{wh.in_transit.toLocaleString()}</td>
                                            <td style={{ padding: '8px', fontWeight: 600, color: '#16a34a', fontVariantNumeric: 'tabular-nums' }}>{wh.available.toLocaleString()}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Card>
                    </div>

                    {/* Release Schedule */}
                    {selectedItemData.releases.length > 0 && (
                        <Card style={{ padding: '16px 18px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                                <CalendarClock size={16} style={{ color: '#1e3a8a' }} />
                                <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#111827' }}>Release Schedule</h4>
                            </div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                                <thead>
                                    <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
                                        {['Release #', 'Due Date', 'Status', 'Requested', 'Outstanding', 'Reserved from Stock', 'Days'].map(h => (
                                            <th key={h} style={{ padding: '6px 10px', textAlign: 'left', fontSize: 10, fontWeight: 600, color: '#6b7280', textTransform: 'uppercase' }}>{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {selectedItemData.releases.map((r, i) => (
                                        <tr key={i} style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: r.is_overdue ? '#fef2f2' : undefined }}>
                                            <td style={{ padding: '8px 10px', fontWeight: 600, color: '#111827' }}>{r.release_number}</td>
                                            <td style={{ padding: '8px 10px', color: r.is_overdue ? '#dc2626' : '#4b5563', fontWeight: r.is_overdue ? 600 : 400 }}>
                                                {r.requested_delivery_date} {r.is_overdue && <span style={{ fontSize: 9, fontWeight: 700, color: '#dc2626', marginLeft: 4 }}>OVERDUE</span>}
                                            </td>
                                            <td style={{ padding: '8px 10px' }}>
                                                <span style={{
                                                    padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600,
                                                    backgroundColor: r.status === 'CONFIRMED' ? '#dbeafe' : r.status === 'DELIVERED' ? '#dcfce7' : '#fef3c7',
                                                    color: r.status === 'CONFIRMED' ? '#1e40af' : r.status === 'DELIVERED' ? '#166534' : '#92400e',
                                                }}>{r.status}</span>
                                            </td>
                                            <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>{r.requested_quantity.toLocaleString()}</td>
                                            <td style={{ padding: '8px 10px', fontWeight: 600, color: r.outstanding_qty > 0 ? '#dc2626' : '#16a34a', fontVariantNumeric: 'tabular-nums' }}>{r.outstanding_qty.toLocaleString()}</td>
                                            <td style={{ padding: '8px 10px', fontVariantNumeric: 'tabular-nums' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                    <span>{r.qty_reserved_from_stock.toLocaleString()}</span>
                                                    {r.qty_reserved_from_stock > 0 && r.qty_reserved_from_stock >= r.outstanding_qty && <CheckCircle size={12} style={{ color: '#16a34a' }} />}
                                                </div>
                                            </td>
                                            <td style={{ padding: '8px 10px', fontWeight: 600, color: r.days_until_delivery < 0 ? '#dc2626' : r.days_until_delivery < 7 ? '#d97706' : '#6b7280' }}>
                                                {r.days_until_delivery < 0 ? `${Math.abs(r.days_until_delivery)}d late` : `${r.days_until_delivery}d`}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </Card>
                    )}

                    {/* Forecast + Activity side by side */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 16 }}>

                        {/* 12-Month Forecast */}
                        {selectedForecasts.length > 0 && (
                            <Card style={{ padding: '16px 18px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                                    <TrendingUp size={16} style={{ color: '#1e3a8a' }} />
                                    <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>12-Month Demand Forecast</h4>
                                </div>
                                <p style={{ margin: '-8px 0 12px', fontSize: 11, color: '#6b7280' }}>Commitment-capped (total ≤ remaining annual)</p>
                                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 160 }}>
                                    {selectedForecasts.map((f, i) => {
                                        const maxQ = Math.max(...selectedForecasts.map(x => x.forecasted_quantity), 1);
                                        const h = (f.forecasted_quantity / maxQ) * 130;
                                        const mo = new Date(f.forecast_date).toLocaleDateString('en-US', { month: 'short' });
                                        const zero = f.forecasted_quantity === 0;
                                        return (
                                            <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                                                <span style={{ fontSize: 9, fontWeight: 600, color: zero ? '#d1d5db' : '#1e3a8a' }}>
                                                    {zero ? '0' : f.forecasted_quantity.toLocaleString()}
                                                </span>
                                                <div style={{ width: '100%', maxWidth: 32, height: Math.max(h, 2), backgroundColor: zero ? '#e5e7eb' : '#3b82f6', borderRadius: '3px 3px 0 0', opacity: zero ? .4 : 1, transition: 'height 400ms cubic-bezier(.4,0,.2,1)' }} />
                                                <span style={{ fontSize: 9, color: '#6b7280' }}>{mo}</span>
                                            </div>
                                        );
                                    })}
                                </div>
                            </Card>
                        )}

                        {/* Monthly Activity Trend */}
                        {selectedItemData.monthly_activity.length > 0 && (
                            <Card style={{ padding: '16px 18px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                                    <BarChart3 size={16} style={{ color: '#1e3a8a' }} />
                                    <h4 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>Monthly Activity (Ledger)</h4>
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 10, fontSize: 10 }}>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#16a34a' }} /> Inbound</span>
                                    <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: '#dc2626' }} /> Outbound</span>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    {selectedItemData.monthly_activity.map((m, i) => {
                                        const maxV = Math.max(...selectedItemData.monthly_activity.map(x => Math.max(x.inbound_qty, x.outbound_qty)), 1);
                                        const mo = new Date(m.activity_month).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
                                        return (
                                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ width: 48, fontSize: 10, color: '#6b7280', textAlign: 'right', flexShrink: 0 }}>{mo}</span>
                                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                                                    <div style={{ height: 8, borderRadius: 4, backgroundColor: '#16a34a', width: `${(m.inbound_qty / maxV) * 100}%`, transition: 'width 400ms' }} />
                                                    <div style={{ height: 8, borderRadius: 4, backgroundColor: '#dc2626', width: `${(m.outbound_qty / maxV) * 100}%`, opacity: .7, transition: 'width 400ms' }} />
                                                </div>
                                                <div style={{ width: 50, fontSize: 10, fontVariantNumeric: 'tabular-nums', textAlign: 'right', color: m.net_change >= 0 ? '#16a34a' : '#dc2626', fontWeight: 600 }}>
                                                    {m.net_change >= 0 ? '+' : ''}{m.net_change.toLocaleString()}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </Card>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
