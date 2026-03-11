/**
 * DispatchSelection — Dispatch team selects READY pallets for shipment
 *
 * Workflow:
 *   1. Search by item code
 *   2. View READY + partial pallets per item
 *   3. Multi-select READY pallets
 *   4. Generate packing list
 *   5. Confirm → generates picking draft for packers
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    Truck, CheckCircle2, Package, Search, Layers, Box, AlertTriangle,
    ChevronDown, ChevronRight, FileText, Loader2, Check, Plus, XCircle, Info, X,
} from 'lucide-react';
import { Card, Modal, EmptyState, ModuleLoader } from '../ui/EnterpriseUI';
import {
    SummaryCard, SummaryCardsGrid, SearchBox, FilterBar, ActionBar,
    ActionButton, RefreshButton,
} from '../ui/SharedComponents';
import * as svc from './packingEngineService';
import type { Pallet, DispatchReadiness, PackingList } from './packingEngineService';
import { createMasterPackingList } from './mplService';
import { getSupabaseClient } from '../../utils/supabase/client';

type UserRole = 'L1' | 'L2' | 'L3' | null;

interface DispatchSelectionProps {
    accessToken: string;
    userRole?: UserRole;
    userPerms?: Record<string, boolean>;
    onNavigate?: (view: string) => void;
}

const STATE_COLORS: Record<string, { color: string; bg: string }> = {
    READY: { color: '#16a34a', bg: '#f0fdf4' },
    FILLING: { color: '#2563eb', bg: '#eff6ff' },
    ADJUSTMENT_REQUIRED: { color: '#dc2626', bg: '#fef2f2' },
    OPEN: { color: '#6b7280', bg: '#f3f4f6' },
};

export function DispatchSelection({ accessToken, userRole, userPerms = {}, onNavigate }: DispatchSelectionProps) {
    const supabase = getSupabaseClient();

    // RBAC
    const hasPerms = Object.keys(userPerms).length > 0;
    const canCreate = userRole === 'L3' || (hasPerms ? userPerms['dispatch.create'] === true : userRole === 'L2');

    const [readiness, setReadiness] = useState<DispatchReadiness[]>([]);
    const [pallets, setPallets] = useState<Pallet[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [expandedItem, setExpandedItem] = useState<string | null>(null);
    const [loadingPallets, setLoadingPallets] = useState(false);
    const [selectedPalletIds, setSelectedPalletIds] = useState<Set<string>>(new Set());
    const [generating, setGenerating] = useState(false);

    // Card filter state for click-to-filter (Item Master pattern)
    type DispatchCardFilter = 'ALL' | 'HAS_READY' | 'HAS_PARTIAL';
    const [cardFilter, setCardFilter] = useState<DispatchCardFilter>('ALL');

    // Toast notification (same pattern as other components)
    const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; title: string; text: string } | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showToast = useCallback((type: 'success' | 'error' | 'warning' | 'info', title: string, text: string, duration = 5000) => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ type, title, text });
        toastTimer.current = setTimeout(() => setToast(null), duration);
    }, []);
    const [refreshing, setRefreshing] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const data = await svc.fetchDispatchReadiness();
            console.log('[DispatchSelection] readiness data:', data.length, 'items', data);
            setReadiness(data);
        } catch (err) {
            console.error('Fetch dispatch readiness error:', err);
        } finally {
            setLoading(false);
        }
    }, []);

    // Explicit refresh handler with toast
    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            const data = await svc.fetchDispatchReadiness();
            setReadiness(data);
            showToast('info', 'Refreshed', 'Dispatch data refreshed successfully.');
        } catch (err) {
            console.error('Refresh error:', err);
        } finally {
            setRefreshing(false);
        }
    }, [showToast]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const handleExpandItem = async (itemCode: string) => {
        if (expandedItem === itemCode) {
            setExpandedItem(null);
            return;
        }
        setExpandedItem(itemCode);
        setLoadingPallets(true);
        setSelectedPalletIds(new Set());
        try {
            const data = await svc.fetchPallets({
                item_code: itemCode,
                state: ['READY', 'OPEN', 'FILLING', 'ADJUSTMENT_REQUIRED'],
            });
            setPallets(data);
        } catch (err) {
            console.error('Fetch item pallets error:', err);
        } finally {
            setLoadingPallets(false);
        }
    };

    const togglePallet = (id: string) => {
        const next = new Set(selectedPalletIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedPalletIds(next);
    };

    const selectAllReady = () => {
        const readyIds = pallets.filter(p => p.state === 'READY').map(p => p.id);
        setSelectedPalletIds(new Set(readyIds));
    };

    const readyPallets = pallets.filter(p => p.state === 'READY');
    const partialPallets = pallets.filter(p => ['OPEN', 'FILLING', 'ADJUSTMENT_REQUIRED'].includes(p.state));

    const handleGenerate = async () => {
        if (selectedPalletIds.size === 0) return;
        setGenerating(true);
        try {
            const item = readiness.find(r => r.item_code === expandedItem);
            const pl = await svc.createPackingList(
                Array.from(selectedPalletIds),
                { customer_name: item?.customer_name || undefined }
            );
            // Create MPL directly in the database (no localStorage)
            const mpl = await createMasterPackingList({ packing_list_id: pl.id });
            setSelectedPalletIds(new Set());
            fetchData();
            // Redirect to MPL Home — MPL already exists in DB
            if (onNavigate) {
                onNavigate('pe-mpl-home');
            } else {
                alert(`Packing List ${pl.packing_list_number} created! MPL ${mpl.mpl_number} is ready in MPL Home.`);
            }
        } catch (err: any) {
            alert('Error generating packing list: ' + (err.message || err));
        } finally {
            setGenerating(false);
        }
    };

    const filtered = useMemo(() => readiness.filter(r => {
        // Apply card filter first
        if (cardFilter === 'HAS_READY' && r.ready_pallets === 0) return false;
        if (cardFilter === 'HAS_PARTIAL' && r.partial_pallets === 0) return false;
        // Then apply search
        if (!searchTerm) return true;
        const s = searchTerm.toLowerCase();
        return r.item_code.toLowerCase().includes(s) ||
            r.item_name.toLowerCase().includes(s) ||
            (r.master_serial_no || '').toLowerCase().includes(s) ||
            (r.customer_name || '').toLowerCase().includes(s);
    }), [readiness, searchTerm, cardFilter]);

    const totalReady = readiness.reduce((s, r) => s + r.ready_pallets, 0);
    const totalPartial = readiness.reduce((s, r) => s + r.partial_pallets, 0);
    const totalReadyQty = readiness.reduce((s, r) => s + r.ready_qty, 0);

    // Reactive selected count
    const selectedCount = selectedPalletIds.size;
    const selectedQty = useMemo(() => {
        return pallets.filter(p => selectedPalletIds.has(p.id)).reduce((s, p) => s + p.current_qty, 0);
    }, [pallets, selectedPalletIds]);

    const th: React.CSSProperties = {
        padding: '10px 12px', textAlign: 'left', fontSize: 11,
        fontWeight: 700, color: '#374151', textTransform: 'uppercase',
        letterSpacing: '0.5px', borderBottom: '2px solid #e5e7eb',
        whiteSpace: 'nowrap', background: '#f9fafb',
    };
    const td: React.CSSProperties = {
        padding: '10px 12px', fontSize: 13, color: '#111827',
        borderBottom: '1px solid #f3f4f6',
    };

    // ── FIRST-LOAD: full-page skeleton ──
    if (loading && readiness.length === 0) {
        return <ModuleLoader moduleName="Dispatch Selection" icon={<Truck size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />;
    }

    return (
        <div style={{ paddingBottom: 40 }}>
            {/* Toast notification */}
            {toast && (
                <div style={{
                    position: 'fixed', top: 24, right: 24, zIndex: 10000,
                    minWidth: 360, maxWidth: 440,
                    padding: '16px 20px', borderRadius: 14,
                    background: toast.type === 'success' ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)'
                        : toast.type === 'error' ? 'linear-gradient(135deg, #fef2f2, #fee2e2)'
                            : toast.type === 'warning' ? 'linear-gradient(135deg, #fffbeb, #fef3c7)'
                                : 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                    border: `1.5px solid ${toast.type === 'success' ? '#86efac' : toast.type === 'error' ? '#fca5a5' : toast.type === 'warning' ? '#fcd34d' : '#93c5fd'}`,
                    boxShadow: '0 10px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)',
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                    animation: 'slideInDown 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
                }}>
                    <div style={{
                        width: 36, height: 36, borderRadius: 10, flexShrink: 0,
                        background: toast.type === 'success' ? 'linear-gradient(135deg, #16a34a, #15803d)' : toast.type === 'error' ? 'linear-gradient(135deg, #dc2626, #b91c1c)' : toast.type === 'warning' ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                        {toast.type === 'success' && <CheckCircle2 size={18} style={{ color: '#fff' }} />}
                        {toast.type === 'error' && <XCircle size={18} style={{ color: '#fff' }} />}
                        {toast.type === 'warning' && <AlertTriangle size={18} style={{ color: '#fff' }} />}
                        {toast.type === 'info' && <Info size={18} style={{ color: '#fff' }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: toast.type === 'success' ? '#14532d' : toast.type === 'error' ? '#7f1d1d' : toast.type === 'warning' ? '#78350f' : '#1e3a5f', marginBottom: 2, letterSpacing: '-0.2px' }}>{toast.title}</div>
                        <div style={{ fontSize: 12, fontWeight: 500, lineHeight: 1.5, color: toast.type === 'success' ? '#166534' : toast.type === 'error' ? '#991b1b' : toast.type === 'warning' ? '#92400e' : '#1e40af' }}>{toast.text}</div>
                    </div>
                    <button onClick={() => { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: toast.type === 'success' ? '#16a34a' : toast.type === 'error' ? '#dc2626' : toast.type === 'warning' ? '#d97706' : '#2563eb', borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><X size={16} /></button>
                </div>
            )}

            <SummaryCardsGrid>
                <SummaryCard
                    label="Items with Configs" value={readiness.length}
                    icon={<Package size={22} style={{ color: '#1e3a8a' }} />}
                    color="#1e3a8a" bgColor="#eff6ff"
                    isActive={cardFilter === 'ALL'}
                    onClick={() => setCardFilter(p => p === 'ALL' ? 'ALL' : 'ALL')}
                />
                <SummaryCard
                    label="Ready Pallets" value={totalReady}
                    icon={<CheckCircle2 size={22} style={{ color: '#16a34a' }} />}
                    color="#16a34a" bgColor="#f0fdf4"
                    isActive={cardFilter === 'HAS_READY'}
                    onClick={() => setCardFilter(p => p === 'HAS_READY' ? 'ALL' : 'HAS_READY')}
                />
                <SummaryCard
                    label="Partial Pallets" value={totalPartial}
                    icon={<AlertTriangle size={22} style={{ color: '#d97706' }} />}
                    color="#d97706" bgColor="#fffbeb"
                    isActive={cardFilter === 'HAS_PARTIAL'}
                    onClick={() => setCardFilter(p => p === 'HAS_PARTIAL' ? 'ALL' : 'HAS_PARTIAL')}
                />
                <SummaryCard
                    label={selectedCount > 0 ? `Selected (${selectedCount})` : 'Ready Qty'}
                    value={selectedCount > 0 ? selectedQty : totalReadyQty}
                    icon={<Layers size={22} style={{ color: selectedCount > 0 ? '#2563eb' : '#7c3aed' }} />}
                    color={selectedCount > 0 ? '#2563eb' : '#7c3aed'}
                    bgColor={selectedCount > 0 ? '#eff6ff' : '#f5f3ff'}
                />
            </SummaryCardsGrid>

            <FilterBar>
                <SearchBox value={searchTerm} onChange={setSearchTerm} placeholder="Search item code, name, MSN, customer..." />
                <ActionBar>
                    <RefreshButton onClick={handleRefresh} loading={refreshing} />
                </ActionBar>
            </FilterBar>

            <Card style={{ padding: 0 }}>
                {loading && filtered.length === 0 && readiness.length === 0 ? (
                    <ModuleLoader moduleName="Dispatch Selection" icon={<Truck size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />
                ) : filtered.length === 0 ? (
                    <EmptyState
                        icon={<Truck size={48} style={{ color: 'var(--enterprise-gray-400)' }} />}
                        title="No Dispatch Data"
                        description="Configure contract packing rules first, then containers & pallets will appear here."
                    />
                ) : (
                    <div style={{ overflowX: 'auto', opacity: refreshing ? 0.5 : 1, transition: 'opacity 0.2s', pointerEvents: refreshing ? 'none' : 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={{ ...th, width: 32, padding: '10px 6px' }} />
                                    <th style={th}>Item</th>
                                    <th style={th}>MSN</th>
                                    <th style={{ ...th, textAlign: 'center' }}>Pallet Qty / Inner Box Qty</th>
                                    <th style={{ ...th, textAlign: 'center' }}>Ready</th>
                                    <th style={{ ...th, textAlign: 'center' }}>Partial</th>
                                    <th style={{ ...th, textAlign: 'center' }}>Ready Qty</th>
                                    <th style={{ ...th, textAlign: 'center' }}>Inner Box Qty</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filtered.map(r => (
                                    <React.Fragment key={r.item_code}>
                                        <tr
                                            style={{ cursor: 'pointer', transition: 'background 0.15s' }}
                                            onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                                            onMouseLeave={e => (e.currentTarget.style.background = '')}
                                            onClick={() => handleExpandItem(r.item_code)}
                                        >
                                            <td style={{ ...td, textAlign: 'center', padding: '10px 6px' }}>
                                                {expandedItem === r.item_code
                                                    ? <ChevronDown size={16} style={{ color: '#6b7280' }} />
                                                    : <ChevronRight size={16} style={{ color: '#6b7280' }} />
                                                }
                                            </td>
                                            <td style={{ ...td, maxWidth: 220 }}>
                                                <div style={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.item_name}</div>
                                                <div style={{ fontSize: 11, color: '#6b7280' }}>{r.item_code}</div>
                                            </td>
                                            <td style={{ ...td, fontFamily: 'monospace', fontSize: 12, whiteSpace: 'nowrap' }}>{r.master_serial_no || '—'}</td>
                                            <td style={{ ...td, textAlign: 'center', fontWeight: 600, fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
                                                {r.contract_outer_qty.toLocaleString()} / {r.inner_box_qty}
                                            </td>
                                            <td style={{ ...td, textAlign: 'center' }}>
                                                <span style={{
                                                    padding: '3px 10px', borderRadius: 10,
                                                    background: r.ready_pallets > 0 ? '#f0fdf4' : '#f3f4f6',
                                                    color: r.ready_pallets > 0 ? '#16a34a' : '#9ca3af',
                                                    fontWeight: 700, fontSize: 13,
                                                }}>
                                                    {r.ready_pallets}
                                                </span>
                                            </td>
                                            <td style={{ ...td, textAlign: 'center' }}>
                                                <span style={{
                                                    padding: '3px 10px', borderRadius: 10,
                                                    background: r.partial_pallets > 0 ? '#fffbeb' : '#f3f4f6',
                                                    color: r.partial_pallets > 0 ? '#d97706' : '#9ca3af',
                                                    fontWeight: 700, fontSize: 13,
                                                }}>
                                                    {r.partial_pallets}
                                                </span>
                                            </td>
                                            <td style={{ ...td, textAlign: 'center', fontWeight: 600, fontFamily: 'monospace' }}>
                                                {r.ready_qty.toLocaleString()}
                                            </td>
                                            <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{r.total_containers}</td>
                                        </tr>

                                        {/* EXPANDED: Pallet selection */}
                                        {expandedItem === r.item_code && (
                                            <tr>
                                                <td colSpan={8} style={{ padding: 0, background: '#f8fafc' }}>
                                                    <div style={{ padding: '12px 24px 16px 48px' }}>
                                                        {loadingPallets ? (
                                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: '#6b7280', fontSize: 13, padding: 16 }}>
                                                                <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} />
                                                                Loading pallets...
                                                            </div>
                                                        ) : (
                                                            <>
                                                                {/* Action bar */}
                                                                {canCreate && readyPallets.length > 0 && (
                                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                                                                        <button
                                                                            onClick={selectAllReady}
                                                                            style={{
                                                                                padding: '6px 14px', borderRadius: 6, fontSize: 12,
                                                                                fontWeight: 600, cursor: 'pointer', border: '1px solid #e5e7eb',
                                                                                background: 'white', color: '#374151',
                                                                            }}
                                                                        >
                                                                            Select All Ready ({readyPallets.length})
                                                                        </button>
                                                                        {selectedPalletIds.size > 0 && (
                                                                            <button
                                                                                onClick={handleGenerate}
                                                                                disabled={generating}
                                                                                style={{
                                                                                    padding: '6px 14px', borderRadius: 6, fontSize: 12,
                                                                                    fontWeight: 600, cursor: generating ? 'not-allowed' : 'pointer', border: 'none',
                                                                                    background: generating ? '#9ca3af' : '#1e3a8a', color: 'white',
                                                                                    display: 'flex', alignItems: 'center', gap: 6,
                                                                                }}
                                                                            >
                                                                                {generating ? (
                                                                                    <><Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> Creating...</>
                                                                                ) : (
                                                                                    <><FileText size={14} /> Generate Packing List ({selectedPalletIds.size})</>
                                                                                )}
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {/* ═══ ALL PALLETS — Pallet Cage Cards ═══ */}
                                                                {(readyPallets.length > 0 || partialPallets.length > 0) && (
                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 28, padding: '8px 0' }}>
                                                                        {[...readyPallets, ...partialPallets].map(p => {
                                                                            const isReady = p.state === 'READY';
                                                                            const isSelected = selectedPalletIds.has(p.id);
                                                                            const pct = p.target_qty > 0 ? Math.round((p.current_qty / p.target_qty) * 100) : 0;
                                                                            const normalBoxes = p.container_count - (p.adjustment_container_count || 0);
                                                                            const topOffBoxes = p.adjustment_container_count || 0;
                                                                            const innerBoxQty = r.inner_box_qty || 0;
                                                                            const topOffQty = p.current_qty - (normalBoxes * innerBoxQty);

                                                                            /* ── COLORS ── */
                                                                            const interiorBg = isSelected ? '#dbeafe' : isReady ? '#f0fdf4' : '#fefce8';
                                                                            const statusColor = isSelected ? '#2563eb' : isReady ? '#16a34a' : '#d97706';
                                                                            const statusBg = isSelected ? '#bfdbfe' : isReady ? '#bbf7d0' : '#fde68a';
                                                                            const borderColor = isSelected ? '#2563eb' : isReady ? '#86efac' : '#fcd34d';

                                                                            return (
                                                                                <div
                                                                                    key={p.id}
                                                                                    onClick={() => canCreate && isReady && togglePallet(p.id)}
                                                                                    style={{
                                                                                        width: 200,
                                                                                        cursor: canCreate && isReady ? 'pointer' : 'default',
                                                                                        transition: 'transform 0.15s ease, box-shadow 0.15s ease',
                                                                                        transform: isSelected ? 'translateY(-3px)' : 'none',
                                                                                        opacity: !isReady ? 0.85 : 1,
                                                                                    }}
                                                                                >
                                                                                    <div style={{
                                                                                        background: interiorBg,
                                                                                        border: `2px solid ${borderColor}`,
                                                                                        borderRadius: 8,
                                                                                        padding: '10px 12px',
                                                                                        position: 'relative',
                                                                                        boxShadow: isSelected
                                                                                            ? '0 4px 12px rgba(37,99,235,0.2)'
                                                                                            : '0 1px 4px rgba(0,0,0,0.06)',
                                                                                    }}>
                                                                                        {/* Checkbox */}
                                                                                        {canCreate && isReady && (
                                                                                            <div style={{
                                                                                                position: 'absolute', top: 6, right: 6,
                                                                                                width: 16, height: 16, borderRadius: 3,
                                                                                                border: `2px solid ${isSelected ? '#2563eb' : '#cbd5e1'}`,
                                                                                                background: isSelected ? '#2563eb' : '#fff',
                                                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                                                zIndex: 2,
                                                                                            }}>
                                                                                                {isSelected && <Check size={10} color="white" strokeWidth={3} />}
                                                                                            </div>
                                                                                        )}

                                                                                        {/* Pallet # */}
                                                                                        <div style={{ fontFamily: 'monospace', fontWeight: 800, fontSize: 13, color: statusColor, marginBottom: 4 }}>
                                                                                            {p.pallet_number}
                                                                                        </div>

                                                                                        {/* Qty */}
                                                                                        <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', fontFamily: 'monospace', lineHeight: 1.1 }}>
                                                                                            {p.current_qty.toLocaleString()}
                                                                                            {!isReady && (
                                                                                                <span style={{ fontSize: 10, fontWeight: 500, color: '#94a3b8' }}>
                                                                                                    {' '}/ {p.target_qty.toLocaleString()}
                                                                                                </span>
                                                                                            )}
                                                                                            <span style={{ fontSize: 8.5, fontWeight: 600, color: '#94a3b8', marginLeft: 2 }}>PCS</span>
                                                                                        </div>

                                                                                        {/* Progress (partial) */}
                                                                                        {!isReady && (
                                                                                            <div style={{ height: 3, borderRadius: 2, background: '#e2e8f0', marginTop: 4, marginBottom: 2, overflow: 'hidden' }}>
                                                                                                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: statusColor, transition: 'width 0.3s' }} />
                                                                                            </div>
                                                                                        )}

                                                                                        <div style={{ borderTop: `1px solid ${statusBg}`, margin: '6px 0' }} />

                                                                                        {/* Data grid */}
                                                                                        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '4px 6px' }}>
                                                                                            <div>
                                                                                                <div style={{ color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', fontSize: 7.5, letterSpacing: '0.4px' }}>Inner Boxes</div>
                                                                                                <div style={{ fontWeight: 700, color: '#334155', fontSize: 10.5, fontFamily: 'monospace' }}>
                                                                                                    {normalBoxes} <span style={{ fontSize: 8, color: '#94a3b8', fontWeight: 500 }}>× {innerBoxQty}</span>
                                                                                                </div>
                                                                                            </div>
                                                                                            <div>
                                                                                                <div style={{ color: '#94a3b8', fontWeight: 700, textTransform: 'uppercase', fontSize: 7.5, letterSpacing: '0.4px' }}>Top-off</div>
                                                                                                <div style={{ fontWeight: 700, color: topOffBoxes > 0 ? '#b45309' : '#94a3b8', fontSize: 10.5, fontFamily: 'monospace' }}>
                                                                                                    {topOffBoxes > 0 ? `${topOffBoxes} × ${topOffQty > 0 ? topOffQty : '—'}` : '—'}
                                                                                                </div>
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}

                                                                {readyPallets.length === 0 && partialPallets.length === 0 && (
                                                                    <div style={{ color: '#9ca3af', fontSize: 13, padding: 16 }}>No pallets for this item yet.</div>
                                                                )}
                                                            </>
                                                        )}
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



            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                @keyframes slideInDown { from { opacity: 0; transform: translateY(-16px); } to { opacity: 1; transform: translateY(0); } }`}</style>
        </div>
    );
}
