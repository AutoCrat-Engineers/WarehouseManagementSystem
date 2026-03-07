/**
 * PalletDashboard — Real-time pallet readiness overview
 *
 * Shows:
 *   - Summary cards (ready, filling, adjustment needed, dispatched)
 *   - Dispatch readiness by item
 *   - Expandable pallet list with container drill-down
 *   - Operator instruction panel
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Package, CheckCircle2, AlertTriangle, Truck, Layers, Box,
    ChevronDown, ChevronRight, Search, RefreshCw, Eye, Info, Clock,
    ArrowRightLeft, Loader2,
} from 'lucide-react';
import { Card, Modal, EmptyState, ModuleLoader, Button } from '../ui/EnterpriseUI';
import {
    SummaryCard, SummaryCardsGrid, SearchBox, FilterBar, ActionBar,
    StatusFilter, RefreshButton, ExportCSVButton, DateRangeFilter, ClearFiltersButton,
} from '../ui/SharedComponents';
import * as svc from './packingEngineService';
import type { Pallet, PalletState, PackContainer } from './packingEngineService';
import { getSupabaseClient } from '../../utils/supabase/client';

type UserRole = 'L1' | 'L2' | 'L3' | null;

interface PalletDashboardProps {
    accessToken: string;
    userRole?: UserRole;
    userPerms?: Record<string, boolean>;
}

// ============================================================================
// STATE BADGE
// ============================================================================

const STATE_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
    OPEN: { color: '#6b7280', bg: '#f3f4f6', label: 'Open' },
    FILLING: { color: '#2563eb', bg: '#eff6ff', label: 'Filling' },
    ADJUSTMENT_REQUIRED: { color: '#dc2626', bg: '#fef2f2', label: 'Adjustment Req.' },
    READY: { color: '#16a34a', bg: '#f0fdf4', label: 'Ready' },
    LOCKED: { color: '#7c3aed', bg: '#f5f3ff', label: 'Locked' },
    DISPATCHED: { color: '#0891b2', bg: '#ecfeff', label: 'Dispatched' },
    IN_TRANSIT: { color: '#d97706', bg: '#fffbeb', label: 'In Transit' },
    CANCELLED: { color: '#9ca3af', bg: '#f9fafb', label: 'Cancelled' },
};

function StateBadge({ state }: { state: string }) {
    const cfg = STATE_CONFIG[state] || STATE_CONFIG.OPEN;
    return (
        <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            padding: '4px 10px', borderRadius: 12,
            backgroundColor: cfg.bg, color: cfg.color, fontSize: 11,
            fontWeight: 600, letterSpacing: '0.3px', textTransform: 'uppercase',
            border: `1px solid ${cfg.color}30`, minWidth: 90,
        }}>
            {cfg.label}
        </span>
    );
}

// ============================================================================
// FILL BAR
// ============================================================================

function FillBar({ current, target }: { current: number; target: number }) {
    const pct = target > 0 ? Math.min(100, Math.round((current / target) * 100)) : 0;
    const color = pct >= 100 ? '#16a34a' : pct >= 80 ? '#d97706' : '#2563eb';
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
                flex: 1, height: 8, borderRadius: 4, background: '#f3f4f6',
                overflow: 'hidden', minWidth: 80,
            }}>
                <div style={{
                    width: `${pct}%`, height: '100%', borderRadius: 4,
                    background: color, transition: 'width 0.3s ease',
                }} />
            </div>
            <span style={{ fontSize: 11, fontWeight: 600, color, minWidth: 36, textAlign: 'right' }}>
                {pct}%
            </span>
        </div>
    );
}

// ============================================================================
// MAIN
// ============================================================================

export function PalletDashboard({ accessToken, userRole, userPerms = {} }: PalletDashboardProps) {
    const supabase = getSupabaseClient();
    const [pallets, setPallets] = useState<Pallet[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [stateFilter, setStateFilter] = useState('ALL');
    const [expandedPallet, setExpandedPallet] = useState<string | null>(null);
    const [palletContainers, setPalletContainers] = useState<PackContainer[]>([]);
    const [loadingContainers, setLoadingContainers] = useState(false);
    const [selectedPallet, setSelectedPallet] = useState<Pallet | null>(null);
    const [displayCount, setDisplayCount] = useState(20);
    const ITEMS_PER_PAGE = 20;

    // Date range filter
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    // Cache all container packing IDs for search
    const [allContainerMap, setAllContainerMap] = useState<Record<string, string[]>>({});

    // ────── Fetch ──────
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const data = await svc.fetchPallets();
            setPallets(data);

            // Pre-fetch all container packing IDs for search
            const palletIds = data.map((p: Pallet) => p.id);
            if (palletIds.length > 0) {
                const { data: pcData } = await supabase
                    .from('pack_pallet_containers')
                    .select('pallet_id, pack_containers(container_number, packing_boxes:packing_box_id(packing_id))')
                    .in('pallet_id', palletIds);
                const map: Record<string, string[]> = {};
                (pcData || []).forEach((row: any) => {
                    const pid = row.pallet_id;
                    const ctn = row.pack_containers?.container_number || '';
                    const pkgId = row.pack_containers?.packing_boxes?.packing_id || '';
                    if (!map[pid]) map[pid] = [];
                    if (ctn) map[pid].push(ctn.toLowerCase());
                    if (pkgId) map[pid].push(pkgId.toLowerCase());
                });
                setAllContainerMap(map);
            }
        } catch (err) {
            console.error('Fetch pallets error:', err);
        } finally {
            setLoading(false);
        }
    }, [supabase]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // Real-time
    useEffect(() => {
        const ch = supabase
            .channel('pallet-dashboard-rt')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'pack_pallets' }, () => fetchData())
            .subscribe();
        return () => { supabase.removeChannel(ch); };
    }, [supabase, fetchData]);

    // ────── Expand pallet ──────
    const handleExpand = async (palletId: string) => {
        if (expandedPallet === palletId) {
            setExpandedPallet(null);
            return;
        }
        setExpandedPallet(palletId);
        setLoadingContainers(true);
        try {
            const containers = await svc.fetchPalletContainers(palletId);
            setPalletContainers(containers);
        } catch (err) {
            console.error('Fetch containers error:', err);
        } finally {
            setLoadingContainers(false);
        }
    };

    // ────── Filter ──────
    const filtered = useMemo(() => {
        return pallets.filter(p => {
            const term = searchTerm.toLowerCase();
            const matchSearch = !searchTerm ||
                p.pallet_number.toLowerCase().includes(term) ||
                p.item_code.toLowerCase().includes(term) ||
                (p.item_name || '').toLowerCase().includes(term) ||
                (p.master_serial_no || '').toLowerCase().includes(term) ||
                (p.part_number || '').toLowerCase().includes(term) ||
                // Search through inner box packing IDs / container numbers
                (allContainerMap[p.id] || []).some(id => id.includes(term));
            const matchState = stateFilter === 'ALL' || p.state === stateFilter;

            // Date range filter on created_at
            let matchDate = true;
            if (dateFrom || dateTo) {
                const palletDate = p.created_at ? p.created_at.split('T')[0] : '';
                if (dateFrom && palletDate < dateFrom) matchDate = false;
                if (dateTo && palletDate > dateTo) matchDate = false;
            }

            return matchSearch && matchState && matchDate;
        });
    }, [pallets, searchTerm, stateFilter, allContainerMap, dateFrom, dateTo]);

    // Reset display count when search/filter changes
    useEffect(() => { setDisplayCount(ITEMS_PER_PAGE); }, [searchTerm, stateFilter, dateFrom, dateTo]);

    const visiblePallets = useMemo(() => filtered.slice(0, displayCount), [filtered, displayCount]);
    const hasMore = displayCount < filtered.length;

    // ────── Counts ──────
    const counts = useMemo(() => ({
        total: pallets.length,
        ready: pallets.filter(p => p.state === 'READY').length,
        filling: pallets.filter(p => ['OPEN', 'FILLING'].includes(p.state)).length,
        adjustment: pallets.filter(p => p.state === 'ADJUSTMENT_REQUIRED').length,
        dispatched: pallets.filter(p => ['DISPATCHED', 'IN_TRANSIT'].includes(p.state)).length,
    }), [pallets]);

    // ────── Table styles ──────
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

    // ────── Export ──────
    const handleExport = () => {
        import('xlsx').then(XLSX => {
            const rows = filtered.map(p => ([
                p.pallet_number, p.item_code, p.item_name, p.master_serial_no || '',
                p.target_qty, p.current_qty, p.container_count, p.state,
                p.ready_at ? new Date(p.ready_at).toLocaleDateString('en-IN') : '',
                p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN') : '',
            ]));
            const headers = ['Pallet #', 'Item Code', 'Item Name', 'MSN', 'Target Qty', 'Current Qty', 'Containers', 'State', 'Ready At', 'Created'];
            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
            const wb = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(wb, ws, 'Pallets');
            XLSX.writeFile(wb, `pallets_${new Date().toISOString().split('T')[0]}.xlsx`);
        });
    };

    // ════════════════════════════════════════════════════════════════════
    // RENDER
    // ════════════════════════════════════════════════════════════════════

    return (
        <div style={{ paddingBottom: 40 }}>
            {/* SUMMARY CARDS */}
            <SummaryCardsGrid>
                <SummaryCard
                    label="Total Pallets" value={counts.total}
                    icon={<Layers size={22} style={{ color: '#1e3a8a' }} />}
                    color="#1e3a8a" bgColor="#eff6ff"
                    isActive={stateFilter === 'ALL'} onClick={() => setStateFilter('ALL')}
                />
                <SummaryCard
                    label="Ready" value={counts.ready}
                    icon={<CheckCircle2 size={22} style={{ color: '#16a34a' }} />}
                    color="#16a34a" bgColor="#f0fdf4"
                    isActive={stateFilter === 'READY'} onClick={() => setStateFilter('READY')}
                />
                <SummaryCard
                    label="Filling" value={counts.filling}
                    icon={<Box size={22} style={{ color: '#2563eb' }} />}
                    color="#2563eb" bgColor="#eff6ff"
                    isActive={stateFilter === 'FILLING'} onClick={() => setStateFilter('FILLING')}
                />
                <SummaryCard
                    label="Adjustment Req." value={counts.adjustment}
                    icon={<AlertTriangle size={22} style={{ color: '#dc2626' }} />}
                    color="#dc2626" bgColor="#fef2f2"
                    isActive={stateFilter === 'ADJUSTMENT_REQUIRED'} onClick={() => setStateFilter('ADJUSTMENT_REQUIRED')}
                />
                <SummaryCard
                    label="Dispatched" value={counts.dispatched}
                    icon={<Truck size={22} style={{ color: '#0891b2' }} />}
                    color="#0891b2" bgColor="#ecfeff"
                    isActive={stateFilter === 'DISPATCHED'} onClick={() => setStateFilter('DISPATCHED')}
                />
            </SummaryCardsGrid>

            {/* FILTER BAR */}
            <FilterBar>
                <SearchBox
                    value={searchTerm}
                    onChange={v => setSearchTerm(v)}
                    placeholder="Search pallet #, part number, inner box ID, MSN..."
                />
                <StatusFilter
                    value={stateFilter}
                    onChange={v => setStateFilter(v)}
                    options={[
                        { value: 'ALL', label: 'All States' },
                        { value: 'OPEN', label: 'Open' },
                        { value: 'FILLING', label: 'Filling' },
                        { value: 'ADJUSTMENT_REQUIRED', label: 'Adjustment Req.' },
                        { value: 'READY', label: 'Ready' },
                        { value: 'LOCKED', label: 'Locked' },
                        { value: 'DISPATCHED', label: 'Dispatched' },
                        { value: 'IN_TRANSIT', label: 'In Transit' },
                    ]}
                />

                {/* Date Range Filter */}
                <DateRangeFilter
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    onDateFromChange={setDateFrom}
                    onDateToChange={setDateTo}
                />

                <ActionBar>
                    {(searchTerm || stateFilter !== 'ALL' || dateFrom || dateTo) && (
                        <ClearFiltersButton onClick={() => { setSearchTerm(''); setStateFilter('ALL'); setDateFrom(''); setDateTo(''); }} />
                    )}
                    <ExportCSVButton onClick={handleExport} />
                    <RefreshButton onClick={fetchData} loading={loading} />
                </ActionBar>
            </FilterBar>

            {/* TABLE */}
            <Card style={{ padding: 0 }}>
                {loading ? (
                    <ModuleLoader moduleName="Pallet Dashboard" icon={<Layers size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />
                ) : filtered.length === 0 ? (
                    <EmptyState
                        icon={<Layers size={48} style={{ color: 'var(--enterprise-gray-400)' }} />}
                        title="No Pallets Found"
                        description="Once contract configs are set and containers are created, pallets will appear here automatically."
                    />
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={{ ...th, width: 36 }} />
                                    <th style={th}>Pallet #</th>
                                    <th style={th}>Item</th>
                                    <th style={th}>MSN</th>
                                    <th style={{ ...th, textAlign: 'center' }}>Progress</th>
                                    <th style={{ ...th, textAlign: 'center' }}>Qty</th>
                                    <th style={{ ...th, textAlign: 'center' }}>Inner Boxes</th>
                                    <th style={{ ...th, textAlign: 'center' }}>State</th>
                                    <th style={th}>Created</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visiblePallets.map(p => (
                                    <React.Fragment key={p.id}>
                                        <tr
                                            style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                                            onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                                            onClick={() => handleExpand(p.id)}
                                        >
                                            <td style={{ ...td, textAlign: 'center', padding: '11px 8px' }}>
                                                {expandedPallet === p.id
                                                    ? <ChevronDown size={16} style={{ color: '#6b7280' }} />
                                                    : <ChevronRight size={16} style={{ color: '#6b7280' }} />
                                                }
                                            </td>
                                            <td style={{ ...td, fontWeight: 700, color: '#1e3a8a', fontFamily: 'monospace' }}>
                                                {p.pallet_number}
                                            </td>
                                            <td style={td}>
                                                <div style={{ fontWeight: 500 }}>{p.item_name || p.item_code}</div>
                                                <div style={{ fontSize: 11, color: '#6b7280' }}>{p.part_number || p.item_code}</div>
                                            </td>
                                            <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>
                                                {p.master_serial_no || '—'}
                                            </td>
                                            <td style={{ ...td, minWidth: 120 }}>
                                                <FillBar current={p.current_qty} target={p.target_qty} />
                                            </td>
                                            <td style={{ ...td, textAlign: 'center', fontWeight: 600, fontFamily: 'monospace' }}>
                                                {p.current_qty.toLocaleString()} / {p.target_qty.toLocaleString()}
                                            </td>
                                            <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>
                                                {p.container_count}
                                            </td>
                                            <td style={{ ...td, textAlign: 'center' }}>
                                                <StateBadge state={p.state} />
                                            </td>
                                            <td style={{ ...td, fontSize: 12, color: '#6b7280' }}>
                                                {p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN', {
                                                    day: '2-digit', month: 'short', year: 'numeric',
                                                }) : '—'}
                                            </td>
                                        </tr>

                                        {/* EXPANDED: Container list */}
                                        {expandedPallet === p.id && (
                                            <tr>
                                                <td colSpan={9} style={{ padding: 0, background: '#f8fafc' }}>
                                                    <div style={{ padding: '12px 24px 0 48px' }}>
                                                        {p.state === 'ADJUSTMENT_REQUIRED' && (
                                                            <div style={{
                                                                display: 'flex', alignItems: 'center', gap: 8,
                                                                padding: '10px 14px', borderRadius: 8,
                                                                background: '#fef2f2', border: '1px solid #fca5a5',
                                                                marginBottom: 12, fontSize: 13, color: '#dc2626', fontWeight: 600,
                                                            }}>
                                                                <AlertTriangle size={16} />
                                                                Generate Adjustment Container of {p.target_qty - p.current_qty} pcs
                                                            </div>
                                                        )}

                                                        <div style={{ fontSize: 12, fontWeight: 700, color: '#374151', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                            Inner Boxes ({palletContainers.length})
                                                        </div>

                                                        {loadingContainers ? (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 13 }}>
                                                                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                                                                Loading containers...
                                                            </div>
                                                        ) : palletContainers.length === 0 ? (
                                                            <div style={{ color: '#9ca3af', fontSize: 13 }}>No containers assigned to this pallet</div>
                                                        ) : (
                                                            <div style={{ maxHeight: 400, overflowY: 'auto', borderRadius: 6, border: '1px solid #e5e7eb' }}>
                                                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                                    <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                                                                        <tr>
                                                                            <th style={{ ...th, fontSize: 10 }}>Packing ID</th>
                                                                            <th style={{ ...th, fontSize: 10 }}>Type</th>
                                                                            <th style={{ ...th, fontSize: 10, textAlign: 'center' }}>Qty</th>
                                                                            <th style={{ ...th, fontSize: 10 }}>Movement #</th>
                                                                            <th style={{ ...th, fontSize: 10 }}>Operator</th>
                                                                            <th style={{ ...th, fontSize: 10, textAlign: 'center' }}>Sticker</th>
                                                                            <th style={{ ...th, fontSize: 10, textAlign: 'center' }}>Created</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody>
                                                                        {palletContainers.map(c => (
                                                                            <tr key={c.id}>
                                                                                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12, fontWeight: 600 }}>
                                                                                    {(c as any).packing_id || c.container_number}
                                                                                </td>
                                                                                <td style={td}>
                                                                                    {c.is_adjustment ? (
                                                                                        <span style={{ color: '#dc2626', fontWeight: 600, fontSize: 11 }}>ADJUSTMENT</span>
                                                                                    ) : (
                                                                                        <span style={{ color: '#6b7280', fontSize: 11 }}>INNER BOX</span>
                                                                                    )}
                                                                                </td>
                                                                                <td style={{ ...td, textAlign: 'center', fontWeight: 600, fontFamily: 'monospace' }}>
                                                                                    {c.quantity.toLocaleString()} pcs
                                                                                </td>
                                                                                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12, color: '#1e3a8a' }}>
                                                                                    {c.movement_number}
                                                                                </td>
                                                                                <td style={{ ...td, fontSize: 12 }}>
                                                                                    {c.operator_name || '—'}
                                                                                </td>
                                                                                <td style={{ ...td, textAlign: 'center', verticalAlign: 'middle' }}>
                                                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                                                        <CheckCircle2 size={20} style={{ color: '#16a34a' }} />
                                                                                    </div>
                                                                                </td>
                                                                                <td style={{ ...td, fontSize: 11, color: '#6b7280', textAlign: 'center' }}>
                                                                                    {new Date(c.created_at).toLocaleDateString('en-IN', {
                                                                                        day: '2-digit', month: 'short',
                                                                                    })}
                                                                                </td>
                                                                            </tr>
                                                                        ))}
                                                                    </tbody>
                                                                </table>
                                                            </div>
                                                        )}
                                                    </div>
                                                    {/* Collapse button — always visible at bottom */}
                                                    <div style={{
                                                        display: 'flex', justifyContent: 'center',
                                                        padding: '10px 0', background: '#f8fafc',
                                                        borderTop: '1px solid #e5e7eb',
                                                    }}>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); setExpandedPallet(null); }}
                                                            style={{
                                                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                                                padding: '6px 20px', borderRadius: 6,
                                                                border: '1px solid #d1d5db', background: 'white',
                                                                color: '#374151', fontSize: 12, fontWeight: 600,
                                                                cursor: 'pointer', transition: 'all 0.15s ease',
                                                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                                                            }}
                                                            onMouseEnter={e => { e.currentTarget.style.background = '#f3f4f6'; e.currentTarget.style.borderColor = '#9ca3af'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.background = 'white'; e.currentTarget.style.borderColor = '#d1d5db'; }}
                                                        >
                                                            <ChevronDown size={14} style={{ transform: 'rotate(180deg)' }} />
                                                            Collapse Inner Boxes
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>

                        {/* Load More Button - Outside scrollable area */}
                        {hasMore && (
                            <div style={{
                                padding: '20px',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: '12px',
                                borderTop: '1px solid var(--table-border, #e5e7eb)',
                                position: 'relative',
                                zIndex: 10,
                                backgroundColor: 'white',
                            }}>
                                <p style={{
                                    fontSize: '13px',
                                    color: 'var(--enterprise-gray-500, #6b7280)',
                                    margin: 0,
                                }}>
                                    Showing {visiblePallets.length} of {filtered.length} pallets
                                </p>
                                <Button
                                    variant="primary"
                                    onClick={() => setDisplayCount(prev => prev + ITEMS_PER_PAGE)}
                                >
                                    Load More ({Math.min(ITEMS_PER_PAGE, filtered.length - displayCount)} more)
                                </Button>
                            </div>
                        )}

                        {/* Show total when all loaded */}
                        {!hasMore && visiblePallets.length > 0 && (
                            <div style={{
                                padding: '16px',
                                textAlign: 'center',
                                borderTop: '1px solid var(--table-border, #e5e7eb)',
                            }}>
                                <p style={{
                                    fontSize: '13px',
                                    color: 'var(--enterprise-gray-500, #6b7280)',
                                }}>
                                    Showing all {filtered.length} pallets
                                </p>
                            </div>
                        )}
                    </div>
                )}
            </Card>

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
