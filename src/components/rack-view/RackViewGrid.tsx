/**
 * RackViewGrid — Inbound Receiving dashboard (Milano 3PL).
 *
 * Shipment-oriented surface: one card per proforma/shipment, with
 * aggregate MPL + GR + placement status. This is the DASHBOARD view.
 * Verification is launched via the "Receive Shipment" button which
 * opens `ReceiveShipmentScreen` (the verification wizard).
 *
 * Phase A: dashboard + shipment cards
 * Phase B: per-MPL sub-GRN verification flow
 * Phase C: shipment detail drilldown page
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Truck, Search, RefreshCw, AlertCircle, ChevronRight, CheckCircle2,
    Clock, Package, Layers, AlertTriangle, FileText, Calendar, Loader2,
    PlayCircle, Users,
} from 'lucide-react';
import { Card, LoadingSpinner, ModuleLoader } from '../ui/EnterpriseUI';
import { fetchWithAuth } from '../../utils/supabase/auth';
import { getEdgeFunctionUrl } from '../../utils/supabase/info';
import { ReceiveShipmentScreen } from './ReceiveShipmentScreen';

// ============================================================================
// Types + fetchers
// ============================================================================

type ShipmentStatus = 'IN_TRANSIT' | 'PARTIAL' | 'COMPLETE' | 'DISCREPANCY';
type Filter = 'ALL' | ShipmentStatus;

interface Shipment {
    id:              string;
    proforma_number: string;
    shipment_number: string | null;
    customer_name:   string;
    bpa_number:      string | null;
    invoice_number:  string | null;
    dispatched_at:   string | null;
    created_at:      string;
    pi_status:       string;
    status:          ShipmentStatus;
    mpl_count:       number;
    pallets_expected: number;
    pallets_received: number;
    pallets_missing:  number;
    pallets_damaged:  number;
    gr_count:         number;
    gr_numbers:       string[];
}

interface Counts {
    total: number; in_transit: number; partial: number; complete: number; discrepancy: number;
}

interface PendingLine {
    line_id:         string;
    gr_id:           string;
    gr_number:       string | null;
    pallet_id:       string;
    pallet_number:   string | null;
    part_number:     string | null;
    msn_code:        string | null;
    item_name:       string | null;
    received_qty:    number;
    current_qty:     number | null;
    line_status:     string;
    shipment_number: string | null;
    proforma_number: string | null;
    mpl_number:      string | null;
    customer_name:   string | null;
    invoice_number:  string | null;
    bpa_number:      string | null;
    received_at:     string | null;
}

async function fetchPendingPlacement(search?: string): Promise<{ lines: PendingLine[]; count: number }> {
    const res = await fetchWithAuth(getEdgeFunctionUrl('pending_placement_list'), {
        method: 'POST', body: JSON.stringify({ search_term: search ?? '', limit: 200 }),
    });
    const json = await res.json();
    if (!res.ok || json?.error) throw new Error(json?.error?.message || json?.error || 'Failed to load pending');
    return json;
}

async function markPlaced(input: { gr_id: string; pallet_id: string; rack_location_code: string }): Promise<any> {
    const res = await fetchWithAuth(getEdgeFunctionUrl('gr_mark_placed'), {
        method: 'POST', body: JSON.stringify(input),
    });
    const json = await res.json();
    if (!res.ok || json?.error) throw new Error(json?.error?.message || json?.error || 'Placement failed');
    return json;
}

async function fetchShipments(input: { status_filter: Filter; search_term?: string; page_size?: number }): Promise<{
    shipments: Shipment[]; counts: Counts; total_count: number;
}> {
    const res = await fetchWithAuth(getEdgeFunctionUrl('shipment_dashboard_list'), {
        method: 'POST', body: JSON.stringify(input),
    });
    const json = await res.json();
    if (!res.ok || json?.error) throw new Error(json?.error?.message || json?.error || 'Failed to load');
    return json;
}

interface InboundOverview {
    kpis: {
        trucks_today:       number;
        in_progress:        number;
        done_today:         number;
        discrepancies_open: number;
    };
    my_drafts: Array<{
        proforma_invoice_id: string;
        mpl_id:              string;
        updated_at:          string;
        version:             number;
        proforma_number:     string | null;
        shipment_number:     string | null;
        mpl_number:          string | null;
    }>;
    active_drafts_by_pi: Record<string, {
        total_drafts: number; my_drafts: number; other_users: number; latest_at: string;
    }>;
}

async function fetchOverview(): Promise<InboundOverview | null> {
    try {
        const res = await fetchWithAuth(getEdgeFunctionUrl('gr_inbound_overview'), {
            method: 'POST', body: '{}',
        });
        const json = await res.json();
        if (!res.ok || json?.error) return null;
        return json as InboundOverview;
    } catch {
        return null;
    }
}

// ============================================================================
// Component
// ============================================================================

interface Props {
    userRole?: string;
    userPerms?: Record<string, boolean>;
    onGrConfirmed?: (grNumber: string) => void;
}

export function RackViewGrid({ userRole, userPerms = {}, onGrConfirmed }: Props) {
    const hasPerms = Object.keys(userPerms).length > 0;
    const canReceive = userRole === 'L3' || userRole === 'ADMIN' || userRole === 'THIRD_PARTY_USER'
        || (hasPerms ? userPerms['rack-view.receive'] === true : userRole === 'L2');

    const [shipments, setShipments] = useState<Shipment[]>([]);
    const [counts, setCounts] = useState<Counts>({ total: 0, in_transit: 0, partial: 0, complete: 0, discrepancy: 0 });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [filter, setFilter] = useState<Filter>('IN_TRANSIT');
    const [search, setSearch] = useState('');
    const [selectedShipment, setSelectedShipment] = useState<Shipment | null>(null);

    // Receive screen launch context — `null` = closed; otherwise the modal is
    // open in either fresh-search mode or deep-linked into a specific PI / MPL.
    const [receiveCtx, setReceiveCtx] = useState<
        | null
        | { mode: 'fresh' }
        | { mode: 'deep'; proformaId: string; mplId?: string }
    >(null);

    // Today-focused overview (KPIs + my drafts + per-PI draft activity).
    // Refreshed alongside the main list — small queries; not worth memoizing.
    const [overview, setOverview] = useState<InboundOverview | null>(null);

    const fetchData = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const [r, ov] = await Promise.all([
                fetchShipments({ status_filter: filter, search_term: search || undefined, page_size: 100 }),
                fetchOverview(),
            ]);
            setShipments(r.shipments);
            setCounts(r.counts);
            setOverview(ov);
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load shipments');
        } finally {
            setLoading(false);
        }
    }, [filter, search]);

    useEffect(() => { fetchData(); }, [fetchData]);

    // First-load module loader
    if (loading && shipments.length === 0) {
        return (
            <ModuleLoader
                moduleName="Inbound Receiving"
                icon={<Truck size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />}
            />
        );
    }

    // If a shipment is selected, render the detail page instead of the dashboard
    if (selectedShipment) {
        return (
            <ShipmentDetailPage
                shipment={selectedShipment}
                onBack={() => { setSelectedShipment(null); fetchData(); }}
            />
        );
    }

    return (
        <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>

            {/* Pending Placement queue (only shown when not empty) */}
            <PendingPlacementSection onPlaced={fetchData} />

            {/* Summary cards — clickable filters. Active card ringed in its accent
                colour; tapping the active card again clears back to ALL. Replaces
                the previous separate KPI strip + filter-chip row (BPA-style). */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 14, marginBottom: 18 }}>
                <UnifiedKPICard
                    icon={<Truck size={16} />} iconBg="#eff6ff" iconColor="#2563eb"
                    label="In Transit" value={counts.in_transit} sub="awaiting verify"
                    isActive={filter === 'IN_TRANSIT'}
                    onClick={() => setFilter(filter === 'IN_TRANSIT' ? 'ALL' : 'IN_TRANSIT')}
                />
                <UnifiedKPICard
                    icon={<Layers size={16} />} iconBg="#fef3c7" iconColor="#d97706"
                    label="Partial" value={counts.partial} sub="some MPLs verified"
                    isActive={filter === 'PARTIAL'}
                    onClick={() => setFilter(filter === 'PARTIAL' ? 'ALL' : 'PARTIAL')}
                />
                <UnifiedKPICard
                    icon={<CheckCircle2 size={16} />} iconBg="#f0fdf4" iconColor="#16a34a"
                    label="Complete" value={counts.complete} sub="all verified"
                    isActive={filter === 'COMPLETE'}
                    onClick={() => setFilter(filter === 'COMPLETE' ? 'ALL' : 'COMPLETE')}
                />
                <UnifiedKPICard
                    icon={<AlertTriangle size={16} />} iconBg="#fee2e2" iconColor="#dc2626"
                    label="Discrepancy" value={counts.discrepancy} sub="missing / damaged"
                    isActive={filter === 'DISCREPANCY'}
                    onClick={() => setFilter(filter === 'DISCREPANCY' ? 'ALL' : 'DISCREPANCY')}
                    alert={counts.discrepancy > 0}
                />
                <UnifiedKPICard
                    icon={<FileText size={16} />} iconBg="#f3f4f6" iconColor="#374151"
                    label="All shipments" value={counts.total} sub="total in-flight"
                    isActive={filter === 'ALL'}
                    onClick={() => setFilter('ALL')}
                />
            </div>

            {/* Search + actions toolbar — search on the left, Refresh + primary
                CTA on the right. One row so the action affordances are always
                visible without scrolling back to the header. */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 18, alignItems: 'stretch' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                    <Search size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--enterprise-gray-400)' }} />
                    <input
                        type="text" value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        placeholder="Search by proforma #, shipment #, or customer…"
                        style={{ width: '100%', padding: '12px 14px 12px 42px', fontSize: 13, border: '1px solid var(--enterprise-gray-200)', borderRadius: 10, outline: 'none', background: 'white', boxShadow: '0 1px 2px rgba(0,0,0,0.02)' }}
                        onFocus={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-primary)'}
                        onBlur={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-gray-200)'}
                    />
                </div>
                <button onClick={fetchData} disabled={loading} style={{ ...ghostBtnStyle, padding: '0 16px' }}>
                    <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : undefined }} /> Refresh
                </button>
                {canReceive && (
                    <button onClick={() => setReceiveCtx({ mode: 'fresh' })} style={{ ...primaryBtnStyle, padding: '0 18px' }}>
                        <Truck size={13} /> Receive Shipment
                    </button>
                )}
            </div>

            {/* Error */}
            {error && (
                <div style={{ padding: '12px 16px', background: '#fef2f2', borderLeft: '3px solid #dc2626', borderRadius: 8, marginBottom: 12, color: '#991b1b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <AlertCircle size={16} /> {error}
                </div>
            )}

            {/* Shipment cards */}
            {loading ? (
                <Card style={{ padding: 0 }}>
                    <div style={{ textAlign: 'center', padding: 60 }}>
                        <LoadingSpinner size={32} />
                        <p style={{ color: 'var(--enterprise-gray-600)', fontSize: 13, marginTop: 12 }}>Loading shipments…</p>
                    </div>
                </Card>
            ) : shipments.length === 0 ? (
                <EmptyState search={search} filter={filter} />
            ) : (() => {
                // FIFO sort — oldest dispatch first so the next-to-receive
                // truck always sits at the top. Falls back to created_at when
                // dispatched_at is missing. Stable: equal timestamps keep
                // server order.
                const sorted = [...shipments].sort((a, b) => {
                    const at = a.dispatched_at ?? a.created_at ?? '';
                    const bt = b.dispatched_at ?? b.created_at ?? '';
                    return at.localeCompare(bt);
                });
                // Only the first card whose status still needs verification gets
                // the inline "Receive Shipment" CTA — enforces FIFO at the UI
                // level. Already-completed shipments at the top (e.g. when
                // viewing the COMPLETE filter) don't get the button.
                const firstReceivableId = sorted.find(s =>
                    s.status === 'IN_TRANSIT' || s.status === 'PARTIAL'
                )?.id;
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {sorted.map(s => (
                            <ShipmentCard
                                key={s.id}
                                shipment={s}
                                onOpen={() => setSelectedShipment(s)}
                                draftActivity={overview?.active_drafts_by_pi[s.id]}
                                showReceiveCta={canReceive && s.id === firstReceivableId}
                                onReceive={() => setReceiveCtx({ mode: 'deep', proformaId: s.id })}
                            />
                        ))}
                    </div>
                );
            })()}

            {/* Receive Shipment modal — fresh search, or deep-linked from a card / "Resume" */}
            {receiveCtx && (
                <ReceiveShipmentScreen
                    onClose={() => setReceiveCtx(null)}
                    onCompleted={(grNumber) => {
                        setReceiveCtx(null);
                        fetchData();
                        if (grNumber) onGrConfirmed?.(grNumber);
                    }}
                    initialProformaId={receiveCtx.mode === 'deep' ? receiveCtx.proformaId : undefined}
                    initialMplId={receiveCtx.mode === 'deep' ? receiveCtx.mplId : undefined}
                    quickPickShipments={
                        // FIFO suggestions on the SEARCH step. Only relevant in fresh
                        // mode (deep-link skips SEARCH). Top-2 oldest still-receivable
                        // shipments — same sort logic the cards below use.
                        receiveCtx.mode === 'fresh'
                            ? [...shipments]
                                .filter(s => s.status === 'IN_TRANSIT' || s.status === 'PARTIAL')
                                .sort((a, b) => {
                                    const at = a.dispatched_at ?? a.created_at ?? '';
                                    const bt = b.dispatched_at ?? b.created_at ?? '';
                                    return at.localeCompare(bt);
                                })
                                .slice(0, 2)
                                .map(s => ({
                                    id: s.id,
                                    proforma_number: s.proforma_number,
                                    shipment_number: s.shipment_number,
                                    dispatched_at: s.dispatched_at,
                                    status: s.status,
                                    mpl_count: s.mpl_count,
                                    pallets_expected: s.pallets_expected,
                                }))
                            : undefined
                    }
                />
            )}
        </div>
    );
}

// ============================================================================
// Unified KPI Card — clickable filter card matching the BPA-list pattern.
// Active card gets a colored border + soft glow ring; tapping clears filter.
// ============================================================================

function UnifiedKPICard({ icon, iconBg, iconColor, label, value, sub, isActive, onClick, alert }: {
    icon: React.ReactNode; iconBg: string; iconColor: string;
    label: string; value: number; sub: string;
    isActive?: boolean; onClick?: () => void; alert?: boolean;
}) {
    return (
        <div
            onClick={onClick}
            style={{
                background: 'white',
                border: isActive ? `2px solid ${iconColor}` : '1px solid var(--enterprise-gray-200)',
                borderRadius: 12, padding: '16px 18px',
                boxShadow: isActive ? `0 0 0 3px ${iconBg}` : '0 1px 2px rgba(0,0,0,0.02)',
                transition: 'all 0.2s ease',
                cursor: onClick ? 'pointer' : 'default',
                display: 'flex', flexDirection: 'column',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                    {label}
                </div>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: iconBg, color: iconColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    {icon}
                </div>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: alert ? '#dc2626' : 'var(--enterprise-gray-900)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
                {value}
            </div>
            <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', marginTop: 4, fontWeight: 500 }}>{sub}</div>
        </div>
    );
}

// ============================================================================
// Shipment Card
// ============================================================================

interface ShipmentDetail {
    shipment: { id: string; proforma_number: string; shipment_number: string | null; customer_name: string; stock_moved_at: string | null; status: string };
    mpls: Array<{
        mpl_id:         string;
        mpl_number:     string;
        invoice_number: string | null;
        bpa_number:     string | null;
        status:         string;
        dispatched_at:  string | null;
        pallet_count:   number;
        qty_total:      number;
        gr: {
            id: string; gr_number: string; status: string;
            total_pallets_expected: number; total_pallets_received: number;
            total_pallets_missing: number; total_pallets_damaged: number;
            placement_completed_at: string | null; created_at: string;
        } | null;
        pallets: Array<{
            pallet_id: string; pallet_number: string | null;
            part_number: string | null; msn_code: string | null; item_name: string | null;
            quantity: number;
            gr_line_status: string | null;
            rack_location_code: string | null; rack_placed_at: string | null;
            discrepancy_note: string | null;
        }>;
    }>;
}

async function fetchShipmentDetail(proformaId: string): Promise<ShipmentDetail> {
    const res = await fetchWithAuth(getEdgeFunctionUrl('shipment_detail_get'), {
        method: 'POST', body: JSON.stringify({ proforma_invoice_id: proformaId }),
    });
    const json = await res.json();
    if (!res.ok || json?.error) throw new Error(json?.error?.message || json?.error || 'Failed to load detail');
    return json;
}

function ShipmentCard({ shipment, onOpen, draftActivity, showReceiveCta, onReceive }: {
    shipment: Shipment;
    onOpen: () => void;
    draftActivity?: { total_drafts: number; my_drafts: number; other_users: number; latest_at: string };
    /** Show the inline "Receive Shipment" CTA. Only the FIFO-first card sets this. */
    showReceiveCta?: boolean;
    onReceive?: () => void;
}) {
    const accent = STATUS_COLOR[shipment.status];
    const total = shipment.pallets_expected;
    const received = shipment.pallets_received;
    const pct = total > 0 ? Math.min(100, Math.round((received / total) * 100)) : 0;
    const hasMyDraft    = (draftActivity?.my_drafts   ?? 0) > 0;
    const hasOtherDraft = (draftActivity?.other_users ?? 0) > 0;

    return (
        <div
            onClick={onOpen}
            style={{
                background: 'white',
                border: '1px solid var(--enterprise-gray-200)',
                borderRadius: 12,
                overflow: 'hidden',
                boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
                transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
                display: 'flex',
                cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = accent;
                e.currentTarget.style.boxShadow = `0 4px 14px rgba(0,0,0,0.08)`;
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--enterprise-gray-200)';
                e.currentTarget.style.boxShadow = '0 1px 2px rgba(0,0,0,0.03)';
            }}
        >
            <div style={{ width: 4, background: accent, flexShrink: 0 }} />

            <div style={{ flex: 1, minWidth: 0, padding: '16px 20px' }}>
                {/* Row 1: shipment# + PI# (equal weight) + status + draft badges
                    · GR# / Receive · chevron */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: 24, minWidth: 0, flexWrap: 'wrap' }}>
                        {shipment.shipment_number && (
                            <span style={{ fontFamily: 'monospace', fontSize: 17, fontWeight: 800, color: 'var(--enterprise-gray-900)' }}>
                                {shipment.shipment_number}
                            </span>
                        )}
                        <span style={{ fontFamily: 'monospace', fontSize: 17, fontWeight: 800, color: 'var(--enterprise-gray-900)' }}>
                            {shipment.proforma_number}
                        </span>
                        <StatusBadge status={shipment.status} />
                        {hasMyDraft && (
                            <span style={draftBadgeMine} title={`Resumable draft last saved ${new Date(draftActivity!.latest_at).toLocaleString()}`}>
                                <PlayCircle size={11} /> My draft
                            </span>
                        )}
                        {hasOtherDraft && !hasMyDraft && (
                            <span style={draftBadgeOther} title={`${draftActivity!.other_users} draft(s) by other users`}>
                                <Users size={11} /> In progress
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {shipment.gr_numbers.length > 0 && (
                            <span style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', display: 'flex', alignItems: 'center', gap: 6 }}>
                                <FileText size={11} />
                                <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--enterprise-gray-800)' }}>
                                    {shipment.gr_numbers[0]}
                                </span>
                                {shipment.gr_numbers.length > 1 && (
                                    <span style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', fontWeight: 600 }}>
                                        +{shipment.gr_numbers.length - 1}
                                    </span>
                                )}
                            </span>
                        )}
                        {showReceiveCta ? (
                            <button
                                onClick={(e) => { e.stopPropagation(); onReceive?.(); }}
                                style={{
                                    background: 'var(--enterprise-primary)', color: 'white', border: 'none',
                                    padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                                    whiteSpace: 'nowrap',
                                    boxShadow: '0 1px 3px rgba(30,58,138,0.25)',
                                }}
                                title="Next in FIFO — receive this shipment"
                            >
                                <Truck size={13} /> Receive
                            </button>
                        ) : (
                            <ChevronRight size={16} style={{ color: 'var(--enterprise-gray-400)' }} />
                        )}
                    </div>
                </div>

                {/* Row 2: KPIs inline. (Customer / part / BPA / INV deliberately
                    omitted at the shipment level — a shipment can mix multiple
                    parts and customers; that detail belongs on the detail page.) */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16, marginBottom: 12 }}>
                    <Inline label="MPLs"     value={shipment.mpl_count.toString()}      icon={<Layers size={12} />} />
                    <Inline label="Expected" value={shipment.pallets_expected.toString()}                                />
                    <Inline label="Received" value={shipment.pallets_received.toString()} accent={received > 0 ? 'success' : undefined} />
                    <Inline label="Missing"  value={String(shipment.pallets_missing + shipment.pallets_damaged)} accent={(shipment.pallets_missing + shipment.pallets_damaged) > 0 ? 'warning' : undefined} />
                    <Inline label="GR"       value={shipment.gr_count === 0 ? 'Not issued' : `${shipment.gr_count} issued`} accent={shipment.gr_count > 0 ? 'success' : undefined} />
                </div>

                {/* Row 4: progress */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: pct === 100 ? 'var(--enterprise-success)' : 'var(--enterprise-gray-700)', minWidth: 40 }}>
                        {pct}%
                    </span>
                    <div style={{ flex: 1, height: 5, background: 'var(--enterprise-gray-200)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{ width: `${pct}%`, height: '100%', background: pct === 100 ? 'var(--enterprise-success)' : accent, transition: 'width 0.3s ease' }} />
                    </div>
                    <span style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', whiteSpace: 'nowrap' }}>verified</span>
                    <span style={{ color: 'var(--enterprise-gray-300)' }}>·</span>
                    <Calendar size={12} style={{ color: 'var(--enterprise-gray-400)' }} />
                    <span style={{ fontSize: 11, color: 'var(--enterprise-gray-600)', whiteSpace: 'nowrap' }}>
                        {shipment.dispatched_at
                            ? `Dispatched ${new Date(shipment.dispatched_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`
                            : 'Not yet dispatched'}
                    </span>
                </div>
            </div>
        </div>
    );
}

function Inline({ label, value, icon, accent }: { label: string; value: string; icon?: React.ReactNode; accent?: 'success' | 'warning' }) {
    const color =
        accent === 'success' ? 'var(--enterprise-success)' :
        accent === 'warning' ? '#d97706' :
        'var(--enterprise-gray-900)';
    return (
        <div>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                {icon}{label}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color }}>{value}</div>
        </div>
    );
}

function ShipmentDetailPage({ shipment, onBack }: { shipment: Shipment; onBack: () => void }) {
    const [detail, setDetail] = useState<ShipmentDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [query, setQuery] = useState('');

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true); setErr(null);
            try {
                const d = await fetchShipmentDetail(shipment.id);
                if (!cancelled) setDetail(d);
            } catch (e: any) {
                if (!cancelled) setErr(e?.message ?? 'Failed to load detail');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [shipment.id]);

    const accent = STATUS_COLOR[shipment.status];

    // Filter MPLs / pallets by query
    const filteredMpls = useMemo(() => {
        if (!detail) return [];
        const q = query.trim().toLowerCase();
        if (!q) return detail.mpls;
        return detail.mpls
            .map(m => ({ ...m, pallets: m.pallets.filter(p =>
                (p.part_number ?? '').toLowerCase().includes(q) ||
                (p.msn_code ?? '').toLowerCase().includes(q) ||
                (p.pallet_number ?? '').toLowerCase().includes(q) ||
                (p.rack_location_code ?? '').toLowerCase().includes(q)
            ) }))
            .filter(m =>
                m.pallets.length > 0 ||
                m.mpl_number.toLowerCase().includes(q) ||
                (m.invoice_number ?? '').toLowerCase().includes(q) ||
                (m.bpa_number ?? '').toLowerCase().includes(q)
            );
    }, [detail, query]);

    return (
        <div style={{ padding: '20px 24px', maxWidth: 1400, margin: '0 auto' }}>
            {/* Back + title */}
            <button onClick={onBack} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--enterprise-gray-600)', fontSize: 12, fontWeight: 600, padding: '4px 8px 4px 0', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 4 }}>
                ← Back to Shipments
            </button>

            {/* Header card */}
            <div style={{ background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 12, overflow: 'hidden', marginBottom: 18, boxShadow: '0 1px 2px rgba(0,0,0,0.03)', display: 'flex' }}>
                <div style={{ width: 4, background: accent }} />
                <div style={{ flex: 1, padding: '18px 22px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                            <span style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 800, color: 'var(--enterprise-gray-900)' }}>
                                {shipment.shipment_number ?? shipment.proforma_number}
                            </span>
                            {shipment.shipment_number && (
                                <span style={{ fontSize: 12, color: 'var(--enterprise-gray-500)' }}>PI {shipment.proforma_number}</span>
                            )}
                            <StatusBadge status={shipment.status} />
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--enterprise-gray-600)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Calendar size={12} />
                            {shipment.dispatched_at ? `Dispatched ${new Date(shipment.dispatched_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}` : 'Not yet dispatched'}
                        </div>
                    </div>
                    <div style={{ fontSize: 14, color: 'var(--enterprise-gray-800)', fontWeight: 600, marginBottom: 14 }}>{shipment.customer_name}</div>

                    {/* Rollup tiles */}
                    {detail && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
                            <MiniTile label="MPLs"        value={`${detail.mpls.filter(m => m.gr).length} / ${detail.mpls.length}`} sub="verified" />
                            <MiniTile label="Expected"    value={detail.mpls.reduce((s, m) => s + m.pallet_count, 0)} sub="pallets" />
                            <MiniTile label="Received"    value={detail.mpls.reduce((s, m) => s + (m.gr?.total_pallets_received ?? 0), 0)} sub="pallets" accent="success" />
                            <MiniTile label="Discrepancy" value={detail.mpls.reduce((s, m) => s + (m.gr?.total_pallets_missing ?? 0) + (m.gr?.total_pallets_damaged ?? 0), 0)} sub="missing / damaged" accent="warning" />
                            <MiniTile label="Placed"      value={`${detail.mpls.flatMap(m => m.pallets).filter(p => !!p.rack_location_code).length} / ${detail.mpls.reduce((s, m) => s + m.pallet_count, 0)}`} sub="in rack" />
                        </div>
                    )}
                </div>
            </div>

            {/* Search within detail */}
            <div style={{ position: 'relative', marginBottom: 14 }}>
                <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--enterprise-gray-400)' }} />
                <input type="text" value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Filter by part #, MSN, pallet #, MPL, invoice, BPA, or rack…"
                    style={{ width: '100%', padding: '10px 12px 10px 38px', fontSize: 13, border: '1px solid var(--enterprise-gray-200)', borderRadius: 8, outline: 'none', background: 'white', boxSizing: 'border-box' }}
                    onFocus={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-primary)'}
                    onBlur={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-gray-200)'} />
            </div>

            {loading && (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--enterprise-gray-500)' }}>
                    <LoadingSpinner size={20} /> Loading MPL breakdown…
                </div>
            )}
            {err && (
                <div style={{ padding: 14, background: '#fef2f2', borderLeft: '3px solid #dc2626', borderRadius: 6, color: '#991b1b', fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <AlertCircle size={14} /> {err}
                </div>
            )}
            {!loading && !err && filteredMpls.length === 0 && query && (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--enterprise-gray-500)', background: 'var(--enterprise-gray-50)', border: '1px dashed var(--enterprise-gray-300)', borderRadius: 10, fontSize: 13 }}>
                    No results matching "{query}".
                </div>
            )}
            {!loading && !err && filteredMpls.length === 0 && !query && (
                <div style={{ padding: 32, textAlign: 'center', color: 'var(--enterprise-gray-500)', background: 'var(--enterprise-gray-50)', border: '1px dashed var(--enterprise-gray-300)', borderRadius: 10, fontSize: 13 }}>
                    No MPLs linked to this shipment.
                </div>
            )}

            {/* MPL blocks */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {filteredMpls.map(m => <MplBlock key={m.mpl_id} mpl={m} defaultOpen={filteredMpls.length === 1} />)}
            </div>
        </div>
    );
}

// (legacy ExpandedSummary kept below only for safety — not referenced anymore)
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _UnusedExpandedSummary({ shipment }: { shipment: Shipment }) {
    const [detail, setDetail] = useState<ShipmentDetail | null>(null);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            setLoading(true); setErr(null);
            try {
                const d = await fetchShipmentDetail(shipment.id);
                if (!cancelled) setDetail(d);
            } catch (e: any) {
                if (!cancelled) setErr(e?.message ?? 'Failed to load detail');
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [shipment.id]);

    if (loading) {
        return (
            <div style={{ borderTop: '1px solid var(--enterprise-gray-100)', padding: '20px', textAlign: 'center', fontSize: 12, color: 'var(--enterprise-gray-500)' }}>
                <LoadingSpinner size={18} /> Loading shipment details…
            </div>
        );
    }
    if (err) {
        return (
            <div style={{ borderTop: '1px solid var(--enterprise-gray-100)', padding: '14px 20px', background: '#fef2f2', color: '#991b1b', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertCircle size={13} /> {err}
            </div>
        );
    }
    if (!detail || detail.mpls.length === 0) {
        return (
            <div style={{ borderTop: '1px solid var(--enterprise-gray-100)', padding: 20, fontSize: 13, color: 'var(--enterprise-gray-500)', fontStyle: 'italic' }}>
                No MPLs linked to this shipment.
            </div>
        );
    }

    // Shipment-level rollup
    const palletsPlaced = detail.mpls.flatMap(m => m.pallets).filter(p => !!p.rack_location_code).length;

    return (
        <div style={{ borderTop: '1px solid var(--enterprise-gray-100)', background: 'linear-gradient(180deg, rgba(30,58,138,0.015) 0%, rgba(30,58,138,0) 100%)', padding: '16px 20px' }}>
            {/* Rollup strip */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 14 }}>
                <MiniTile label="MPLs"        value={`${detail.mpls.filter(m => m.gr).length} / ${detail.mpls.length}`} sub="verified" />
                <MiniTile label="Received"    value={detail.mpls.reduce((s, m) => s + (m.gr?.total_pallets_received ?? 0), 0)} sub="pallets" accent="success" />
                <MiniTile label="Discrepancy" value={detail.mpls.reduce((s, m) => s + (m.gr?.total_pallets_missing ?? 0) + (m.gr?.total_pallets_damaged ?? 0), 0)} sub="missing / damaged" accent="warning" />
                <MiniTile label="Placed"      value={`${palletsPlaced} / ${detail.mpls.reduce((s, m) => s + m.pallet_count, 0)}`} sub="in rack" />
            </div>

            {/* MPL blocks */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 700, color: 'var(--enterprise-gray-500)', letterSpacing: '0.6px', textTransform: 'uppercase', marginBottom: 10 }}>
                <Layers size={12} /> Master Packing Lists
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {detail.mpls.map(m => <MplBlock key={m.mpl_id} mpl={m} />)}
            </div>
        </div>
    );
}

function MplBlock({ mpl, defaultOpen = false }: { mpl: ShipmentDetail['mpls'][number]; defaultOpen?: boolean }) {
    const verified = !!mpl.gr;
    const placed = mpl.pallets.filter(p => !!p.rack_location_code).length;
    const hasDiscrepancy = verified && ((mpl.gr!.total_pallets_missing + mpl.gr!.total_pallets_damaged) > 0);
    const accent = hasDiscrepancy ? '#dc2626' : verified ? '#16a34a' : '#2563eb';
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div style={{ border: '1px solid var(--enterprise-gray-200)', borderRadius: 10, background: 'white', overflow: 'hidden' }}>
            <div onClick={() => setOpen(v => !v)} style={{ display: 'grid', gridTemplateColumns: '4px 1fr 90px 90px 90px 90px 24px', alignItems: 'center', cursor: 'pointer' }}>
                <div style={{ height: '100%', background: accent, minHeight: 48 }} />
                <div style={{ padding: '10px 16px', minWidth: 0 }}>
                    <div style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 12, color: 'var(--enterprise-gray-900)' }}>{mpl.mpl_number}</div>
                    <div style={{ fontSize: 11, color: 'var(--enterprise-gray-600)', marginTop: 2, display: 'flex', gap: 8 }}>
                        {mpl.invoice_number && <span>INV <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{mpl.invoice_number}</span></span>}
                        {mpl.bpa_number && <span>· BPA <span style={{ fontFamily: 'monospace', fontWeight: 600 }}>{mpl.bpa_number}</span></span>}
                    </div>
                </div>
                <TileInline label="Expected"    value={String(mpl.pallet_count)} />
                <TileInline label="Received"    value={verified ? String(mpl.gr!.total_pallets_received) : '—'} accent={verified ? 'success' : undefined} />
                <TileInline label="Issues"      value={verified ? String(mpl.gr!.total_pallets_missing + mpl.gr!.total_pallets_damaged) : '—'} accent={hasDiscrepancy ? 'warning' : undefined} />
                <TileInline label="Placed"      value={verified ? `${placed} / ${mpl.pallet_count}` : '—'} />
                <ChevronRight size={14} style={{ color: 'var(--enterprise-gray-400)', transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s ease', marginRight: 12 }} />
            </div>

            {open && (
                <div style={{ borderTop: '1px solid var(--enterprise-gray-100)', background: 'rgba(15,23,42,0.02)' }}>
                    {/* GR meta */}
                    {verified && (
                        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--enterprise-gray-100)', fontSize: 12, color: 'var(--enterprise-gray-700)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                            <CheckCircle2 size={13} style={{ color: '#16a34a' }} />
                            <span>Sub-GRN</span>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--enterprise-gray-900)' }}>{mpl.gr!.gr_number}</span>
                            <span>· issued {new Date(mpl.gr!.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                            {mpl.gr!.placement_completed_at && <span>· placed {new Date(mpl.gr!.placement_completed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>}
                        </div>
                    )}

                    {/* Pallet rows */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.6fr 0.7fr 0.8fr 0.8fr 1.4fr', gap: 8, padding: '8px 16px', background: 'rgba(15,23,42,0.03)', fontSize: 10, fontWeight: 700, color: 'var(--enterprise-gray-500)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                        <div>Part / Pallet</div>
                        <div style={{ textAlign: 'right' }}>Qty</div>
                        <div>Status</div>
                        <div>Rack</div>
                        <div>Placed</div>
                        <div>Notes</div>
                    </div>
                    {mpl.pallets.map(p => <PalletDetailRow key={p.pallet_id} pallet={p} />)}
                </div>
            )}
        </div>
    );
}

function PalletDetailRow({ pallet }: { pallet: ShipmentDetail['mpls'][number]['pallets'][number] }) {
    const st = pallet.gr_line_status;
    const color =
        st === 'RECEIVED'     ? '#16a34a' :
        st === 'MISSING'      ? '#dc2626' :
        st === 'DAMAGED'      ? '#d97706' :
        st === 'SHORT'        ? '#d97706' :
        st === 'QUALITY_HOLD' ? '#7c3aed' :
        'var(--enterprise-gray-400)';
    const bg =
        st === 'RECEIVED'     ? '#dcfce7' :
        st === 'MISSING'      ? '#fee2e2' :
        st === 'DAMAGED'      ? '#fef3c7' :
        st === 'SHORT'        ? '#fef3c7' :
        st === 'QUALITY_HOLD' ? '#ede9fe' :
        'var(--enterprise-gray-100)';
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 0.6fr 0.7fr 0.8fr 0.8fr 1.4fr', gap: 8, padding: '10px 16px', borderTop: '1px solid var(--enterprise-gray-100)', alignItems: 'center', fontSize: 12, background: 'white' }}>
            <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--enterprise-info, #3b82f6)', fontSize: 11, background: 'rgba(59,130,246,0.1)', padding: '1px 6px', borderRadius: 4 }}>{pallet.part_number ?? '—'}</span>
                    <span style={{ fontSize: 11, color: 'var(--enterprise-gray-600)' }}>{pallet.msn_code ?? ''}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginTop: 2, fontFamily: 'monospace' }}>{pallet.pallet_number ?? '—'}</div>
            </div>
            <div style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{Number(pallet.quantity).toLocaleString()}</div>
            <div>
                {st ? (
                    <span style={{ fontSize: 10, fontWeight: 700, color, background: bg, padding: '2px 6px', borderRadius: 4, letterSpacing: '0.3px' }}>{st.replace('_', ' ')}</span>
                ) : (
                    <span style={{ fontSize: 10, color: 'var(--enterprise-gray-400)', fontWeight: 600 }}>AWAITING</span>
                )}
            </div>
            <div style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 600, color: pallet.rack_location_code ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-400)' }}>
                {pallet.rack_location_code ?? '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--enterprise-gray-600)' }}>
                {pallet.rack_placed_at ? new Date(pallet.rack_placed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
            </div>
            <div style={{ fontSize: 11, color: 'var(--enterprise-gray-600)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {pallet.discrepancy_note ?? ''}
            </div>
        </div>
    );
}

function MiniTile({ label, value, sub, accent }: { label: string; value: string | number; sub?: string; accent?: 'success' | 'warning' }) {
    const color =
        accent === 'success' ? 'var(--enterprise-success)' :
        accent === 'warning' ? '#d97706' :
        'var(--enterprise-gray-900)';
    return (
        <div style={{ background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 8, padding: '10px 12px' }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
            <div style={{ fontSize: 15, fontWeight: 700, color, fontFamily: 'monospace', marginTop: 2 }}>{value}</div>
            {sub && <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginTop: 2 }}>{sub}</div>}
        </div>
    );
}

function TileInline({ label, value, accent }: { label: string; value: string; accent?: 'success' | 'warning' }) {
    const color =
        accent === 'success' ? 'var(--enterprise-success)' :
        accent === 'warning' ? '#d97706' :
        'var(--enterprise-gray-800)';
    return (
        <div style={{ textAlign: 'right', paddingRight: 12 }}>
            <div style={{ fontSize: 9, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
            <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: 'monospace', marginTop: 1 }}>{value}</div>
        </div>
    );
}

// ============================================================================
// Status badge
// ============================================================================

const STATUS_COLOR: Record<ShipmentStatus, string> = {
    IN_TRANSIT:  '#2563eb',
    PARTIAL:     '#d97706',
    COMPLETE:    '#16a34a',
    DISCREPANCY: '#dc2626',
};
const STATUS_BG: Record<ShipmentStatus, string> = {
    IN_TRANSIT:  '#dbeafe',
    PARTIAL:     '#fef3c7',
    COMPLETE:    '#dcfce7',
    DISCREPANCY: '#fee2e2',
};

function StatusBadge({ status }: { status: ShipmentStatus }) {
    return (
        <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.5px', textTransform: 'uppercase',
            padding: '3px 8px', borderRadius: 10,
            color: STATUS_COLOR[status], background: STATUS_BG[status],
        }}>{status.replace('_', ' ')}</span>
    );
}

// ============================================================================
// Empty state
// ============================================================================

function EmptyState({ search, filter }: { search: string; filter: Filter }) {
    return (
        <div style={{ background: 'white', border: '1px dashed var(--enterprise-gray-300)', borderRadius: 12, padding: '60px 24px', textAlign: 'center' }}>
            <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--enterprise-gray-100)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                <Truck size={28} style={{ color: 'var(--enterprise-gray-400)' }} />
            </div>
            <p style={{ color: 'var(--enterprise-gray-700)', fontSize: 15, fontWeight: 600, margin: 0 }}>
                {search ? 'No shipments match your search'
                       : filter === 'IN_TRANSIT' ? 'No shipments awaiting verification'
                       : filter === 'COMPLETE'   ? 'No completed shipments yet'
                       : 'No shipments yet'}
            </p>
            <p style={{ color: 'var(--enterprise-gray-500)', fontSize: 13, marginTop: 6 }}>
                {search ? 'Try a different search or clear the filter chips.'
                       : 'When the factory dispatches a proforma invoice, the shipment shows up here for verification.'}
            </p>
        </div>
    );
}

// ============================================================================
// Pending Placement section (top of dashboard)
// ============================================================================

function PendingPlacementSection({ onPlaced }: { onPlaced: () => void }) {
    const [lines, setLines] = useState<PendingLine[]>([]);
    const [loading, setLoading] = useState(true);
    const [err, setErr] = useState<string | null>(null);
    const [open, setOpen] = useState(true);
    const [placingFor, setPlacingFor] = useState<PendingLine | null>(null);

    const load = useCallback(async () => {
        setLoading(true); setErr(null);
        try {
            const r = await fetchPendingPlacement();
            setLines(r.lines);
        } catch (e: any) {
            setErr(e?.message ?? 'Failed');
        } finally {
            setLoading(false);
        }
    }, []);
    useEffect(() => { load(); }, [load]);

    if (loading && lines.length === 0) return null;
    if (!loading && lines.length === 0 && !err) return null;

    return (
        <div style={{ marginBottom: 16, border: '1px solid #fcd34d', background: 'linear-gradient(135deg, #fffbeb 0%, #fef3c7 100%)', borderRadius: 12, overflow: 'hidden' }}>
            <div onClick={() => setOpen(v => !v)} style={{ padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: '#fef3c7', color: '#92400e', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Package size={16} />
                    </div>
                    <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: '#78350f' }}>Pending Placement</div>
                        <div style={{ fontSize: 11, color: '#92400e', marginTop: 1 }}>
                            {lines.length} pallet{lines.length !== 1 ? 's' : ''} verified but not yet in rack
                        </div>
                    </div>
                </div>
                <ChevronRight size={16} style={{ color: '#92400e', transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s ease' }} />
            </div>

            {open && (
                <div style={{ borderTop: '1px solid #fcd34d', background: 'white' }}>
                    {err && (
                        <div style={{ padding: '10px 18px', color: '#991b1b', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <AlertCircle size={12} /> {err}
                        </div>
                    )}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 0.8fr 0.9fr 1.1fr 0.9fr 110px', gap: 10, padding: '8px 18px', background: 'rgba(15,23,42,0.03)', fontSize: 10, fontWeight: 700, color: 'var(--enterprise-gray-500)', letterSpacing: '0.5px', textTransform: 'uppercase' }}>
                        <div>Part / Pallet</div>
                        <div>GR / MPL</div>
                        <div style={{ textAlign: 'right' }}>Qty</div>
                        <div>Status</div>
                        <div>Shipment</div>
                        <div>Received</div>
                        <div />
                    </div>
                    {lines.map(l => (
                        <PendingRow key={l.line_id} line={l} onPlace={() => setPlacingFor(l)} />
                    ))}
                </div>
            )}

            {placingFor && (
                <RackPickerModal
                    line={placingFor}
                    onClose={() => setPlacingFor(null)}
                    onPlaced={async () => {
                        setPlacingFor(null);
                        await load();
                        onPlaced();
                    }}
                />
            )}
        </div>
    );
}

function PendingRow({ line, onPlace }: { line: PendingLine; onPlace: () => void }) {
    const statusColor =
        line.line_status === 'RECEIVED'     ? '#16a34a' :
        line.line_status === 'DAMAGED'      ? '#d97706' :
        line.line_status === 'SHORT'        ? '#d97706' :
        line.line_status === 'QUALITY_HOLD' ? '#7c3aed' :
        '#6b7280';
    const statusBg =
        line.line_status === 'RECEIVED'     ? '#dcfce7' :
        line.line_status === 'DAMAGED'      ? '#fef3c7' :
        line.line_status === 'SHORT'        ? '#fef3c7' :
        line.line_status === 'QUALITY_HOLD' ? '#ede9fe' :
        '#f3f4f6';
    return (
        <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 0.8fr 0.9fr 1.1fr 0.9fr 110px', gap: 10, padding: '10px 18px', borderTop: '1px solid var(--enterprise-gray-100)', alignItems: 'center', fontSize: 12, background: 'white' }}>
            <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 12, fontWeight: 700, color: 'var(--enterprise-info, #3b82f6)', padding: '1px 6px', background: 'rgba(59,130,246,0.1)', borderRadius: 4 }}>{line.part_number ?? '—'}</span>
                    <span style={{ fontSize: 11, color: 'var(--enterprise-gray-600)' }}>{line.msn_code ?? ''}</span>
                </div>
                <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginTop: 2, fontFamily: 'monospace' }}>{line.pallet_number ?? '—'}</div>
            </div>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 11, fontWeight: 600, color: 'var(--enterprise-gray-800)' }}>{line.gr_number ?? '—'}</div>
                <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginTop: 2, fontFamily: 'monospace' }}>{line.mpl_number ?? '—'}</div>
            </div>
            <div style={{ textAlign: 'right', fontFamily: 'monospace', fontWeight: 700 }}>{Number(line.received_qty).toLocaleString()}</div>
            <div>
                <span style={{ fontSize: 10, fontWeight: 700, color: statusColor, background: statusBg, padding: '2px 6px', borderRadius: 4, letterSpacing: '0.3px' }}>{line.line_status.replace('_', ' ')}</span>
            </div>
            <div style={{ minWidth: 0 }}>
                <div style={{ fontFamily: 'monospace', fontSize: 11, color: 'var(--enterprise-gray-800)' }}>{line.shipment_number ?? line.proforma_number ?? '—'}</div>
                <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginTop: 2 }}>{line.customer_name ?? ''}</div>
            </div>
            <div style={{ fontSize: 11, color: 'var(--enterprise-gray-600)' }}>
                {line.received_at ? new Date(line.received_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}
            </div>
            <button onClick={onPlace}
                style={{ background: 'var(--enterprise-primary)', color: 'white', border: 'none', padding: '6px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, justifyContent: 'center' }}>
                Place <ChevronRight size={12} />
            </button>
        </div>
    );
}

// ============================================================================
// Rack picker (simple code-entry modal)
// ============================================================================

function RackPickerModal({ line, onClose, onPlaced }: {
    line: PendingLine;
    onClose: () => void;
    onPlaced: () => void;
}) {
    const [code, setCode] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [err, setErr] = useState<string | null>(null);
    const normalized = code.trim().toUpperCase();
    const valid = /^[A-Z][0-9]{1,3}$/.test(normalized);

    const submit = async () => {
        if (!valid) return;
        setSubmitting(true); setErr(null);
        try {
            await markPlaced({ gr_id: line.gr_id, pallet_id: line.pallet_id, rack_location_code: normalized });
            onPlaced();
        } catch (e: any) {
            setErr(e?.message ?? 'Placement failed');
            setSubmitting(false);
        }
    };

    return (
        <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
            <div onClick={(e) => e.stopPropagation()} style={{ background: 'white', borderRadius: 12, width: '100%', maxWidth: 460, boxShadow: '0 24px 70px rgba(0,0,0,0.3)' }}>
                <div style={{ padding: '18px 20px', borderBottom: '1px solid var(--enterprise-gray-200)' }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--enterprise-gray-900)' }}>Place Pallet</h3>
                    <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--enterprise-gray-600)' }}>
                        Enter the rack cell code where this pallet has been placed
                    </p>
                </div>

                <div style={{ padding: 20 }}>
                    <div style={{ background: 'var(--enterprise-gray-50)', border: '1px solid var(--enterprise-gray-200)', borderRadius: 8, padding: 12, marginBottom: 14, fontSize: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--enterprise-info, #3b82f6)', padding: '1px 6px', background: 'rgba(59,130,246,0.1)', borderRadius: 4 }}>{line.part_number}</span>
                            <span style={{ color: 'var(--enterprise-gray-600)' }}>{line.msn_code}</span>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', fontFamily: 'monospace' }}>{line.pallet_number} · {Number(line.received_qty).toLocaleString()} pcs</div>
                    </div>

                    <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--enterprise-gray-700)', textTransform: 'uppercase', letterSpacing: '0.4px', display: 'block', marginBottom: 6 }}>
                        Rack Cell Code <span style={{ color: '#dc2626' }}>*</span>
                    </label>
                    <input autoFocus type="text" value={code}
                        onChange={(e) => setCode(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter' && valid) submit(); }}
                        placeholder="e.g., A1, B12, C5"
                        style={{ width: '100%', padding: '12px 14px', fontSize: 18, border: `1.5px solid ${valid || code === '' ? 'var(--enterprise-gray-300)' : '#dc2626'}`, borderRadius: 8, outline: 'none', fontFamily: 'monospace', letterSpacing: '1px', textTransform: 'uppercase', boxSizing: 'border-box' }}
                        onFocus={(e) => e.currentTarget.style.borderColor = 'var(--enterprise-primary)'}
                        onBlur={(e) => e.currentTarget.style.borderColor = valid || code === '' ? 'var(--enterprise-gray-300)' : '#dc2626'} />
                    <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500)', marginTop: 6 }}>
                        Format: letter + number (e.g., A1, B12). This writes <code>rack_location_code</code> on the GR line.
                    </div>

                    {err && (
                        <div style={{ marginTop: 12, padding: 10, background: '#fef2f2', borderLeft: '3px solid #dc2626', borderRadius: 6, color: '#991b1b', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6 }}>
                            <AlertCircle size={13} /> {err}
                        </div>
                    )}
                </div>

                <div style={{ padding: '12px 20px', borderTop: '1px solid var(--enterprise-gray-200)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                    <button onClick={onClose} disabled={submitting} style={{ background: 'transparent', border: 'none', color: 'var(--enterprise-gray-600)', padding: '9px 14px', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                    <button onClick={submit} disabled={!valid || submitting} style={{ background: 'var(--enterprise-primary)', color: 'white', border: 'none', padding: '9px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: valid && !submitting ? 'pointer' : 'not-allowed', opacity: valid && !submitting ? 1 : 0.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {submitting ? <><Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> Placing…</> : <>Place in {normalized || '—'}</>}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ============================================================================
// Styles
// ============================================================================

const primaryBtnStyle: React.CSSProperties = {
    background: 'var(--enterprise-primary)', color: 'white', border: 'none',
    padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
};
const ghostBtnStyle: React.CSSProperties = {
    background: 'white', color: 'var(--enterprise-gray-700)',
    border: '1px solid var(--enterprise-gray-200)',
    padding: '9px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
};

// Draft activity badges — shown on shipment cards. "My draft" is the
// resumable affordance; "In progress" is purely informational (don't trample
// another receiver's session — the version-conflict guard would catch it,
// but the badge prevents the conflict in the first place).
const draftBadgeMine: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 8px', borderRadius: 999,
    background: '#dcfce7', color: '#166534',
    fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase',
};
const draftBadgeOther: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    padding: '3px 8px', borderRadius: 999,
    background: '#fef3c7', color: '#92400e',
    fontSize: 10, fontWeight: 700, letterSpacing: '0.3px', textTransform: 'uppercase',
};

