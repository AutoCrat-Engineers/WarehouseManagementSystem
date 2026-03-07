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

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    Truck, CheckCircle2, Package, Search, Layers, Box, AlertTriangle,
    ChevronDown, ChevronRight, FileText, Loader2, Check, Plus,
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

    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const data = await svc.fetchDispatchReadiness();
            setReadiness(data);
        } catch (err) {
            console.error('Fetch dispatch readiness error:', err);
        } finally {
            setLoading(false);
        }
    }, []);

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
        if (!searchTerm) return true;
        const s = searchTerm.toLowerCase();
        return r.item_code.toLowerCase().includes(s) ||
            r.item_name.toLowerCase().includes(s) ||
            (r.master_serial_no || '').toLowerCase().includes(s) ||
            (r.customer_name || '').toLowerCase().includes(s);
    }), [readiness, searchTerm]);

    const totalReady = readiness.reduce((s, r) => s + r.ready_pallets, 0);
    const totalPartial = readiness.reduce((s, r) => s + r.partial_pallets, 0);
    const totalReadyQty = readiness.reduce((s, r) => s + r.ready_qty, 0);

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
                <SummaryCard
                    label="Items with Configs" value={readiness.length}
                    icon={<Package size={22} style={{ color: '#1e3a8a' }} />}
                    color="#1e3a8a" bgColor="#eff6ff"
                />
                <SummaryCard
                    label="Ready Pallets" value={totalReady}
                    icon={<CheckCircle2 size={22} style={{ color: '#16a34a' }} />}
                    color="#16a34a" bgColor="#f0fdf4"
                />
                <SummaryCard
                    label="Partial Pallets" value={totalPartial}
                    icon={<AlertTriangle size={22} style={{ color: '#d97706' }} />}
                    color="#d97706" bgColor="#fffbeb"
                />
                <SummaryCard
                    label="Ready Qty" value={totalReadyQty}
                    icon={<Layers size={22} style={{ color: '#7c3aed' }} />}
                    color="#7c3aed" bgColor="#f5f3ff"
                />
            </SummaryCardsGrid>

            <FilterBar>
                <SearchBox value={searchTerm} onChange={setSearchTerm} placeholder="Search item code, name, MSN, customer..." />
                <ActionBar>
                    <RefreshButton onClick={fetchData} loading={loading} />
                </ActionBar>
            </FilterBar>

            <Card style={{ padding: 0 }}>
                {loading ? (
                    <ModuleLoader moduleName="Dispatch Selection" icon={<Truck size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />
                ) : filtered.length === 0 ? (
                    <EmptyState
                        icon={<Truck size={48} style={{ color: 'var(--enterprise-gray-400)' }} />}
                        title="No Dispatch Data"
                        description="Configure contract packing rules first, then containers & pallets will appear here."
                    />
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                                <tr>
                                    <th style={{ ...th, width: 36 }} />
                                    <th style={th}>Item</th>
                                    <th style={th}>MSN</th>
                                    <th style={th}>Customer</th>
                                    <th style={{ ...th, textAlign: 'right' }}>Contract Qty</th>
                                    <th style={{ ...th, textAlign: 'center' }}>Ready</th>
                                    <th style={{ ...th, textAlign: 'center' }}>Partial</th>
                                    <th style={{ ...th, textAlign: 'right' }}>Ready Qty</th>
                                    <th style={{ ...th, textAlign: 'center' }}>Containers</th>
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
                                            <td style={{ ...td, textAlign: 'center', padding: '11px 8px' }}>
                                                {expandedItem === r.item_code
                                                    ? <ChevronDown size={16} style={{ color: '#6b7280' }} />
                                                    : <ChevronRight size={16} style={{ color: '#6b7280' }} />
                                                }
                                            </td>
                                            <td style={td}>
                                                <div style={{ fontWeight: 600 }}>{r.item_name}</div>
                                                <div style={{ fontSize: 11, color: '#6b7280' }}>{r.item_code}</div>
                                            </td>
                                            <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{r.master_serial_no || '—'}</td>
                                            <td style={td}>{r.customer_name || '—'}</td>
                                            <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>
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
                                            <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>
                                                {r.ready_qty.toLocaleString()}
                                            </td>
                                            <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{r.total_containers}</td>
                                        </tr>

                                        {/* EXPANDED: Pallet selection */}
                                        {expandedItem === r.item_code && (
                                            <tr>
                                                <td colSpan={9} style={{ padding: 0, background: '#f8fafc' }}>
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

                                                                {/* ═══ ALL PALLETS — Crate-on-Pallet Cards ═══ */}
                                                                {(readyPallets.length > 0 || partialPallets.length > 0) && (
                                                                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 24, padding: '4px 0' }}>
                                                                        {[...readyPallets, ...partialPallets].map(p => {
                                                                            const isReady = p.state === 'READY';
                                                                            const isSelected = selectedPalletIds.has(p.id);
                                                                            const pct = p.target_qty > 0 ? Math.round((p.current_qty / p.target_qty) * 100) : 0;
                                                                            const normalBoxes = p.container_count - (p.adjustment_container_count || 0);
                                                                            const topOffBoxes = p.adjustment_container_count || 0;
                                                                            const innerBoxQty = r.inner_box_qty || 0;
                                                                            const topOffQty = p.current_qty - (normalBoxes * innerBoxQty);

                                                                            // Colors
                                                                            const accent = isSelected ? '#2563eb' : isReady ? '#16a34a' : '#d97706';
                                                                            const accentLight = isSelected ? '#dbeafe' : isReady ? '#dcfce7' : '#fef3c7';
                                                                            const palletColor = isSelected ? '#1e3a8a' : '#1f2937';
                                                                            const stateLabel = isSelected ? 'SELECTED' : isReady ? 'READY' : p.state === 'ADJUSTMENT_REQUIRED' ? 'ADJ REQ' : p.state;

                                                                            return (
                                                                                <div
                                                                                    key={p.id}
                                                                                    onClick={() => canCreate && isReady && togglePallet(p.id)}
                                                                                    style={{
                                                                                        width: 230,
                                                                                        cursor: canCreate && isReady ? 'pointer' : 'default',
                                                                                        transition: 'transform 0.15s ease',
                                                                                        transform: isSelected ? 'translateY(-3px)' : 'none',
                                                                                        opacity: !isReady ? 0.85 : 1,
                                                                                    }}
                                                                                >
                                                                                    {/* ══ CRATE — box sitting on pallet ══ */}
                                                                                    <div style={{
                                                                                        border: `4px solid ${accent}`,
                                                                                        borderRadius: '10px 10px 0 0',
                                                                                        borderBottom: 'none',
                                                                                        background: '#ffffff',
                                                                                        position: 'relative',
                                                                                        marginLeft: 14,
                                                                                        marginRight: 14,
                                                                                        padding: '10px 12px 10px',
                                                                                    }}>
                                                                                        {/* Checkbox (ready only) */}
                                                                                        {canCreate && isReady && (
                                                                                            <div style={{
                                                                                                position: 'absolute', top: 8, right: 8,
                                                                                                width: 18, height: 18, borderRadius: 3,
                                                                                                border: `2px solid ${isSelected ? '#2563eb' : '#cbd5e1'}`,
                                                                                                background: isSelected ? '#2563eb' : '#fff',
                                                                                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                                                zIndex: 2,
                                                                                            }}>
                                                                                                {isSelected && <Check size={12} color="white" strokeWidth={3} />}
                                                                                            </div>
                                                                                        )}

                                                                                        {/* Pallet # */}
                                                                                        <div style={{
                                                                                            fontFamily: 'monospace', fontWeight: 700, fontSize: 11,
                                                                                            color: accent, marginBottom: 2,
                                                                                        }}>
                                                                                            {p.pallet_number}
                                                                                        </div>

                                                                                        {/* MSN */}
                                                                                        {p.master_serial_no && (
                                                                                            <div style={{ fontSize: 9.5, color: '#64748b', fontFamily: 'monospace', fontWeight: 600, marginBottom: 4 }}>
                                                                                                MSN: {p.master_serial_no}
                                                                                            </div>
                                                                                        )}

                                                                                        {/* Total Qty — big number */}
                                                                                        <div style={{
                                                                                            fontSize: 22, fontWeight: 800, color: '#0f172a',
                                                                                            fontFamily: 'monospace', lineHeight: 1.1,
                                                                                        }}>
                                                                                            {p.current_qty.toLocaleString()}
                                                                                            {!isReady && (
                                                                                                <span style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8' }}>
                                                                                                    {' '}/ {p.target_qty.toLocaleString()}
                                                                                                </span>
                                                                                            )}
                                                                                            <span style={{ fontSize: 9, fontWeight: 500, color: '#94a3b8', marginLeft: 2 }}>PCS</span>
                                                                                        </div>

                                                                                        {/* Progress bar (partial only) */}
                                                                                        {!isReady && (
                                                                                            <div style={{ height: 3, borderRadius: 2, background: '#e2e8f0', marginTop: 4, marginBottom: 2, overflow: 'hidden' }}>
                                                                                                <div style={{ width: `${pct}%`, height: '100%', borderRadius: 2, background: accent, transition: 'width 0.3s' }} />
                                                                                            </div>
                                                                                        )}

                                                                                        {/* Divider */}
                                                                                        <div style={{ borderTop: `1px solid ${accentLight}`, margin: '5px 0' }} />

                                                                                        {/* Data grid 2×2 */}
                                                                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '3px 6px' }}>
                                                                                            <div>
                                                                                                <div style={{ color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', fontSize: 8.5, letterSpacing: '0.4px' }}>Inner Boxes</div>
                                                                                                <div style={{ fontWeight: 700, color: '#334155', fontSize: 11.5, fontFamily: 'monospace' }}>
                                                                                                    {normalBoxes} <span style={{ fontSize: 8.5, color: '#94a3b8', fontWeight: 500 }}>× {innerBoxQty}</span>
                                                                                                </div>
                                                                                            </div>
                                                                                            <div>
                                                                                                <div style={{ color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', fontSize: 8.5, letterSpacing: '0.4px' }}>Top-off</div>
                                                                                                <div style={{ fontWeight: 700, color: topOffBoxes > 0 ? '#b45309' : '#94a3b8', fontSize: 11.5, fontFamily: 'monospace' }}>
                                                                                                    {topOffBoxes > 0 ? `${topOffBoxes} × ${topOffQty > 0 ? topOffQty : '—'}` : '—'}
                                                                                                </div>
                                                                                            </div>
                                                                                            <div>
                                                                                                <div style={{ color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', fontSize: 8.5, letterSpacing: '0.4px' }}>Total Boxes</div>
                                                                                                <div style={{ fontWeight: 700, color: '#334155', fontSize: 11.5, fontFamily: 'monospace' }}>{p.container_count}</div>
                                                                                            </div>
                                                                                            <div>
                                                                                                <div style={{ color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', fontSize: 8.5, letterSpacing: '0.4px' }}>Status</div>
                                                                                                <span style={{
                                                                                                    display: 'inline-block', fontSize: 9, fontWeight: 700,
                                                                                                    color: accent, background: accentLight,
                                                                                                    padding: '1px 6px', borderRadius: 3,
                                                                                                    textTransform: 'uppercase', letterSpacing: '0.4px',
                                                                                                }}>
                                                                                                    {stateLabel}
                                                                                                </span>
                                                                                            </div>
                                                                                        </div>
                                                                                    </div>

                                                                                    {/* ── Bottom edge of crate (sits on pallet) ── */}
                                                                                    <div style={{
                                                                                        height: 4, marginLeft: 14, marginRight: 14,
                                                                                        background: accent,
                                                                                    }} />

                                                                                    {/* ══ PALLET — wider flat deck + 3 block feet ══ */}
                                                                                    {/* Deck — full width, flat slab */}
                                                                                    <div style={{
                                                                                        height: 10,
                                                                                        background: palletColor,
                                                                                        borderRadius: '2px 2px 0 0',
                                                                                        marginTop: 0,
                                                                                    }} />
                                                                                    {/* 3 block feet with gaps */}
                                                                                    <div style={{
                                                                                        display: 'flex',
                                                                                        justifyContent: 'space-between',
                                                                                        padding: '0 8px',
                                                                                    }}>
                                                                                        {[0, 1, 2].map(i => (
                                                                                            <div key={i} style={{
                                                                                                width: 50,
                                                                                                height: 14,
                                                                                                background: palletColor,
                                                                                                borderRadius: '0 0 4px 4px',
                                                                                            }} />
                                                                                        ))}
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



            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
