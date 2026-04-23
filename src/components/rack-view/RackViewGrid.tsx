/**
 * RackViewGrid — DB-backed rewrite of the legacy local-state RackView.
 *
 * Hydrates from `mv_rack_view` via `rack_view_get` edge function. Cells
 * are colour-coded by shipment (matches xlsx legend). Click a cell →
 * RackCellDrawer shows full back-chain.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Grid3X3, Search, RefreshCw, Package, AlertCircle, Truck } from 'lucide-react';
import {
    SummaryCard, SummaryCardsGrid, SearchBox, ActionButton, ActionBar, FilterBar,
} from '../ui/SharedComponents';
import { Card } from '../ui/EnterpriseUI';
import { LoadingSpinner } from '../ui/EnterpriseUI';
import { getRackView, refreshRackView } from './rackService';
import type { RackCell, RackSummary, RackStatusFilter } from './types';
import { RackCellDrawer } from './RackCellDrawer';
import { ReceiveShipmentScreen } from './ReceiveShipmentScreen';

// Colour palette keyed by shipment_sequence — matches the Tariff xlsx.
const SHIPMENT_COLORS: Record<string, { bg: string; border: string }> = {
    '1': { bg: '#FFFF00', border: '#eab308' },     // yellow
    '2': { bg: '#C2F1C8', border: '#16a34a' },     // mint
    '3': { bg: '#F2CFEE', border: '#a21caf' },     // pink
    '4': { bg: '#DCEAF7', border: '#2563eb' },     // blue
    '5': { bg: '#FBE3D6', border: '#ea580c' },     // peach
    '6': { bg: '#CCC6FC', border: '#4f46e5' },     // lilac
};

interface Props {
    userRole?: string;
    userPerms?: Record<string, boolean>;
    /** Fired after a Goods Receipt is confirmed; App redirects to legacy
     *  RackView with this GR number to drive physical placement. */
    onGrConfirmed?: (grNumber: string) => void;
}

export function RackViewGrid({ userRole, userPerms = {}, onGrConfirmed }: Props) {
    const hasPerms = Object.keys(userPerms).length > 0;
    const canReceive = userRole === 'L3' || userRole === 'ADMIN' || userRole === 'THIRD_PARTY_USER'
        || (hasPerms ? userPerms['rack-view.receive'] === true : userRole === 'L2');

    const [cells, setCells]       = useState<RackCell[]>([]);
    const [summary, setSummary]   = useState<RackSummary | null>(null);
    const [loading, setLoading]   = useState(false);
    const [error, setError]       = useState<string | null>(null);

    const [activeRack, setActiveRack] = useState<string>('A');
    const [statusFilter, setStatusFilter] = useState<RackStatusFilter>('ALL');
    const [search, setSearch] = useState('');

    const [selectedCellId, setSelectedCellId] = useState<string | null>(null);
    const [showReceive, setShowReceive] = useState(false);

    const fetchCells = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const res = await getRackView({ status_filter: statusFilter });
            setCells(res.cells); setSummary(res.summary);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load rack view');
        } finally {
            setLoading(false);
        }
    }, [statusFilter]);

    useEffect(() => { fetchCells(); }, [fetchCells]);

    const refresh = async () => {
        try { await refreshRackView(); } catch { /* non-blocking */ }
        await fetchCells();
    };

    // Group cells by rack
    const rackKeys = useMemo(() => {
        const s = new Set(cells.map(c => c.rack));
        return Array.from(s).sort();
    }, [cells]);

    // Cells in the active rack, filtered by search
    const filteredCells = useMemo(() => {
        const q = search.toLowerCase().trim();
        return cells
            .filter(c => c.rack === activeRack)
            .filter(c => {
                if (!q) return true;
                return (c.part_number ?? '').toLowerCase().includes(q)
                    || (c.msn_code ?? '').toLowerCase().includes(q)
                    || (c.pallet_number ?? '').toLowerCase().includes(q)
                    || (c.agreement_number ?? '').toLowerCase().includes(q)
                    || (c.location_code ?? '').toLowerCase().includes(q);
            })
            .sort((a, b) => a.location_number - b.location_number);
    }, [cells, activeRack, search]);

    const rackCellCount = useMemo(() => {
        const counts: Record<string, number> = {};
        for (const c of cells) counts[c.rack] = (counts[c.rack] ?? 0) + 1;
        return counts;
    }, [cells]);

    return (
        <div style={{ padding: '20px 24px' }}>
            <div style={{ marginBottom: '20px' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Inbound Receiving — Milano 3PL</h1>
                <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-600)', marginTop: '4px' }}>
                    Verify arriving shipments, issue Goods Receipts, and trace pallets through the full back-chain.
                </p>
            </div>

            {/* Summary */}
            <SummaryCardsGrid>
                <SummaryCard label="Total Cells" value={summary?.total_cells ?? 0} icon={<Grid3X3 size={20} color="#6b7280" />} color="#374151" bgColor="#f3f4f6"
                    isActive={statusFilter === 'ALL'} onClick={() => setStatusFilter('ALL')} />
                <SummaryCard label="Occupied" value={summary?.occupied ?? 0} icon={<Package size={20} color="#16a34a" />} color="#16a34a" bgColor="#dcfce7"
                    isActive={statusFilter === 'OCCUPIED'} onClick={() => setStatusFilter('OCCUPIED')} />
                <SummaryCard label="Empty" value={summary?.empty ?? 0} icon={<Grid3X3 size={20} color="#9ca3af" />} color="#6b7280" bgColor="#f3f4f6"
                    isActive={statusFilter === 'EMPTY'} onClick={() => setStatusFilter('EMPTY')} />
                <SummaryCard label="Available" value={summary?.available ?? 0} icon={<Package size={20} color="#2563eb" />} color="#2563eb" bgColor="#dbeafe"
                    isActive={statusFilter === 'AVAILABLE'} onClick={() => setStatusFilter('AVAILABLE')} />
                <SummaryCard label="Reserved" value={summary?.reserved ?? 0} icon={<AlertCircle size={20} color="#d97706" />} color="#d97706" bgColor="#fef3c7"
                    isActive={statusFilter === 'RESERVED'} onClick={() => setStatusFilter('RESERVED')} />
                <SummaryCard label="Parts" value={summary?.parts_distinct ?? 0} icon={<Package size={20} color="#7c3aed" />} color="#7c3aed" bgColor="#ede9fe" />
            </SummaryCardsGrid>

            {/* Actions */}
            <ActionBar>
                <SearchBox
                    value={search}
                    onChange={(v: string) => setSearch(v)}
                    placeholder="Search by part, MSN, pallet, cell code…"
                />
                <FilterBar>
                    <ActionButton label="Refresh" icon={<RefreshCw size={14} />} onClick={refresh} spinning={loading} />
                    {canReceive && (
                        <ActionButton label="Receive Shipment" icon={<Truck size={14} />} onClick={() => setShowReceive(true)} variant="primary" />
                    )}
                </FilterBar>
            </ActionBar>

            {error && <Card style={{ background: '#fef2f2', color: '#991b1b', marginBottom: '12px' }}>⚠ {error}</Card>}

            {/* Rack tabs */}
            <div style={{ display: 'flex', gap: '4px', marginBottom: '12px' }}>
                {rackKeys.length === 0 ? (
                    <span style={{ fontSize: '13px', color: 'var(--enterprise-gray-500)' }}>No racks configured yet.</span>
                ) : rackKeys.map(k => (
                    <button key={k} onClick={() => setActiveRack(k)}
                        style={{
                            padding: '10px 20px',
                            border: 'none',
                            background: activeRack === k ? 'var(--enterprise-primary)' : 'white',
                            color: activeRack === k ? 'white' : 'var(--enterprise-gray-700)',
                            borderRadius: '6px 6px 0 0',
                            fontWeight: 600, fontSize: '13px', cursor: 'pointer',
                            borderBottom: activeRack === k ? 'none' : '1px solid var(--enterprise-gray-300)',
                        }}>
                        Rack {k} <span style={{ fontWeight: 400, opacity: 0.8, marginLeft: '6px' }}>({rackCellCount[k] ?? 0})</span>
                    </button>
                ))}
            </div>

            {/* Legend */}
            <Card style={{ padding: '10px', marginBottom: '12px' }}>
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center', fontSize: '12px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 600, color: 'var(--enterprise-gray-700)' }}>Shipment:</span>
                    {Object.entries(SHIPMENT_COLORS).map(([k, c]) => (
                        <span key={k} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <span style={{ width: '14px', height: '14px', border: `1px solid ${c.border}`, background: c.bg, borderRadius: '3px' }} />
                            #{k}
                        </span>
                    ))}
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '12px' }}>
                        <span style={{ width: '14px', height: '14px', border: '1px dashed #9ca3af', background: 'white', borderRadius: '3px' }} />
                        Empty
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <span style={{ width: '14px', height: '14px', border: '2px solid #d97706', background: '#fef3c7', borderRadius: '3px' }} />
                        Reserved
                    </span>
                </div>
            </Card>

            {/* Grid */}
            <Card>
                {loading ? (
                    <div style={{ textAlign: 'center', padding: '60px' }}>
                        <LoadingSpinner size={32} />
                        <p style={{ marginTop: '12px', color: 'var(--enterprise-gray-600)' }}>Loading rack view…</p>
                    </div>
                ) : filteredCells.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '60px' }}>
                        <Search size={32} style={{ color: 'var(--enterprise-gray-400)' }} />
                        <p style={{ marginTop: '12px', color: 'var(--enterprise-gray-500)' }}>
                            {search ? 'No cells match your search.' : `Rack ${activeRack} has no cells yet.`}
                        </p>
                    </div>
                ) : (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
                        gap: '6px',
                    }}>
                        {filteredCells.map(cell => {
                            const shipmentKey = cell.shipment_sequence != null ? String(cell.shipment_sequence) : '';
                            const colors = SHIPMENT_COLORS[shipmentKey];
                            const isEmpty = cell.is_empty;
                            const style: React.CSSProperties = {
                                padding: '8px',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontSize: '11px',
                                minHeight: '74px',
                                display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                                transition: 'transform 0.12s ease, box-shadow 0.12s ease',
                                background: isEmpty ? 'white' : (colors?.bg ?? '#f3f4f6'),
                                border: isEmpty
                                    ? '1px dashed #9ca3af'
                                    : cell.is_reserved
                                        ? '2px solid #d97706'
                                        : `1px solid ${colors?.border ?? '#d1d5db'}`,
                            };
                            return (
                                <div key={cell.rack_location_id}
                                    style={style}
                                    onClick={() => setSelectedCellId(cell.rack_location_id)}
                                    onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 4px 10px rgba(0,0,0,0.08)'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none'; }}
                                >
                                    <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
                                        <span>{cell.location_code}</span>
                                        {shipmentKey && <span style={{ opacity: 0.6 }}>S{shipmentKey}</span>}
                                    </div>
                                    {isEmpty ? (
                                        <div style={{ textAlign: 'center', color: '#9ca3af', fontStyle: 'italic' }}>empty</div>
                                    ) : (
                                        <>
                                            <div style={{ fontWeight: 600, fontSize: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {cell.msn_code ?? cell.part_number ?? '—'}
                                            </div>
                                            <div style={{ fontSize: '10px', color: 'var(--enterprise-gray-700)' }}>
                                                {cell.pallet_number ?? '—'} · {cell.pallet_quantity ?? 0}
                                            </div>
                                        </>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </Card>

            {/* Drawer */}
            {selectedCellId && (
                <RackCellDrawer
                    rackLocationId={selectedCellId}
                    onClose={() => setSelectedCellId(null)}
                    onChanged={() => { setSelectedCellId(null); refresh(); }}
                    canMove={userRole === 'L3' || userRole === 'ADMIN' || userRole === 'THIRD_PARTY_USER' || userPerms['rack-view.move'] === true}
                />
            )}

            {/* Receive flow — on GR confirm, hand off to App → legacy RackView */}
            {showReceive && (
                <ReceiveShipmentScreen
                    onClose={() => setShowReceive(false)}
                    onCompleted={(grNumber?: string) => {
                        setShowReceive(false);
                        if (grNumber && onGrConfirmed) {
                            onGrConfirmed(grNumber);
                        } else {
                            refresh();
                        }
                    }}
                />
            )}
        </div>
    );
}
