/**
 * ReleaseList — Customer release orders landing page.
 *
 * Shows blanket_releases + two CTA paths:
 *   • "By PO number" → paste Release PO (e.g. 260067252-10)
 *   • "By BPA"       → search BPA, pick pallets manually
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, CheckCircle, XCircle, Plus, RefreshCw, Package, Clipboard, Truck, ChevronRight, FileText, User, Hash } from 'lucide-react';
import {
    SummaryCard, SummaryCardsGrid, SearchBox, ActionButton, ActionBar, FilterBar,
} from '../ui/SharedComponents';
import { Card, LoadingSpinner, ModuleLoader } from '../ui/EnterpriseUI';
import { Badge } from '../ui/badge';
import { listReleases } from './releaseService';
import type { BlanketRelease, ReleaseStatus } from './types';
import { CreateRelease } from './CreateRelease';

type CardFilter = 'ALL' | ReleaseStatus;

interface Props {
    userRole?: string;
    userPerms?: Record<string, boolean>;
}

export function ReleaseList({ userRole, userPerms = {} }: Props) {
    const hasPerms = Object.keys(userPerms).length > 0;
    const canCreate = userRole === 'L3' || userRole === 'ADMIN'
        || (hasPerms ? userPerms['releases.create'] === true : userRole === 'L2');

    const [rows, setRows]       = useState<BlanketRelease[]>([]);
    const [counts, setCounts]   = useState({ total: 0, open: 0, fulfilled: 0, cancelled: 0 });
    const [loading, setLoading] = useState(false);
    const [error, setError]     = useState<string | null>(null);

    const [page, setPage]       = useState(0);
    const pageSize              = 25;
    const [totalCount, setTotalCount] = useState(0);
    const [filter, setFilter]   = useState<CardFilter>('ALL');
    const [search, setSearch]   = useState('');

    const [showCreate, setShowCreate] = useState(false);

    const fetchData = useCallback(async () => {
        setLoading(true); setError(null);
        try {
            const r = await listReleases({ page, page_size: pageSize, status_filter: filter, search_term: search || undefined });
            setRows(r.releases); setTotalCount(r.total_count);
            setCounts({
                total:     r.counts.total     ?? 0,
                open:      r.counts.open      ?? 0,
                fulfilled: r.counts.fulfilled ?? 0,
                cancelled: r.counts.cancelled ?? 0,
            });
        } catch (e: any) {
            setError(e?.message ?? 'Failed to load');
        } finally {
            setLoading(false);
        }
    }, [page, filter, search]);

    useEffect(() => { fetchData(); }, [fetchData]);

    const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

    // First-load: spinning-icon module loader (matches legacy module pattern)
    if (loading && rows.length === 0) {
        return (
            <ModuleLoader
                moduleName="Blanket Releases"
                icon={<Truck size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />}
            />
        );
    }

    return (
        <div style={{ padding: '20px 24px' }}>
            <div style={{ marginBottom: '20px' }}>
                <h1 style={{ fontSize: '1.5rem', fontWeight: 700 }}>Blanket Releases</h1>
                <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-600)', marginTop: '4px' }}>
                    Drafted releases need fulfillment. Completed releases are delivered against their BPA.
                </p>
            </div>

            <SectionTabs
                filter={filter}
                onFilterChange={(f) => { setFilter(f); setPage(0); }}
                counts={counts}
            />

            <ActionBar>
                <SearchBox value={search} onChange={(v: string) => { setSearch(v); setPage(0); }}
                    placeholder="Search by release #, PO base, buyer…" />
                <FilterBar>
                    <ActionButton label="Refresh" icon={<RefreshCw size={14} />} onClick={fetchData} spinning={loading} />
                    {canCreate && (
                        <ActionButton label="New Release" icon={<Plus size={14} />} onClick={() => setShowCreate(true)} variant="primary" />
                    )}
                </FilterBar>
            </ActionBar>

            {error && <Card style={{ background: '#fef2f2', marginBottom: 12 }}><div style={{ color: '#991b1b', fontSize: 13 }}>⚠ {error}</div></Card>}

            {loading ? (
                <Card style={{ padding: 0, overflow: 'hidden' }}>
                    <div style={{ textAlign: 'center', padding: 60 }}>
                        <LoadingSpinner size={32} />
                        <p style={{ marginTop: 12, fontSize: 13, color: 'var(--enterprise-gray-600)' }}>Loading releases…</p>
                    </div>
                </Card>
            ) : rows.length === 0 ? (
                <Card style={{ padding: 60, textAlign: 'center' }}>
                    <Package size={32} style={{ color: 'var(--enterprise-gray-400)' }} />
                    <p style={{ marginTop: 12, color: 'var(--enterprise-gray-600)' }}>
                        {search ? 'No releases match your search.' : 'No releases yet. Paste a PO to start.'}
                    </p>
                </Card>
            ) : (
                <ReleaseSections rows={rows} filter={filter} />
            )}

            {totalPages > 1 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16, fontSize: 13 }}>
                    <span style={{ color: 'var(--enterprise-gray-600)' }}>
                        Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalCount)} of {totalCount}
                    </span>
                    <div style={{ display: 'flex', gap: 8 }}>
                        <ActionButton label="Prev" icon={<></>} onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0} />
                        <span style={{ padding: '8px 12px', color: 'var(--enterprise-gray-600)' }}>Page {page + 1} / {totalPages}</span>
                        <ActionButton label="Next" icon={<></>} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1} />
                    </div>
                </div>
            )}

            {showCreate && (
                <CreateRelease
                    onClose={() => setShowCreate(false)}
                    onCreated={() => { setShowCreate(false); fetchData(); }}
                />
            )}
        </div>
    );
}

// ============================================================================
// SectionTabs — tab-style filter bar replacing KPI summary cards
// ============================================================================

type TabDef = {
    key: CardFilter;
    label: string;
    count: number;
    color: string;
    bgActive: string;
    bgIdle: string;
    textIdle: string;
    Icon: React.ComponentType<{ size?: number; color?: string }>;
};

function SectionTabs({ filter, onFilterChange, counts }: {
    filter: CardFilter;
    onFilterChange: (f: CardFilter) => void;
    counts: { total: number; open: number; fulfilled: number; cancelled: number };
}) {
    const tabs: TabDef[] = [
        { key: 'OPEN',      label: 'Drafted',   count: counts.open,      color: '#2563eb', bgActive: 'linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%)', bgIdle: '#eff6ff', textIdle: '#1e3a8a', Icon: Clipboard },
        { key: 'FULFILLED', label: 'Completed', count: counts.fulfilled, color: '#16a34a', bgActive: 'linear-gradient(135deg, #16a34a 0%, #14532d 100%)', bgIdle: '#f0fdf4', textIdle: '#14532d', Icon: CheckCircle },
        { key: 'CANCELLED', label: 'Cancelled', count: counts.cancelled, color: '#6b7280', bgActive: 'linear-gradient(135deg, #6b7280 0%, #374151 100%)', bgIdle: '#f3f4f6', textIdle: '#374151', Icon: XCircle },
        { key: 'ALL',       label: 'All',       count: counts.total,     color: '#111827', bgActive: 'linear-gradient(135deg, #111827 0%, #000000 100%)', bgIdle: '#f9fafb', textIdle: '#111827', Icon: Calendar },
    ];

    return (
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '10px',
            marginBottom: '16px',
        }}>
            {tabs.map(t => {
                const active = filter === t.key;
                return (
                    <button
                        key={t.key}
                        onClick={() => onFilterChange(t.key)}
                        style={{
                            border: active ? 'none' : `1px solid var(--enterprise-gray-200)`,
                            borderRadius: 'var(--border-radius-lg)',
                            padding: '14px 16px',
                            background: active ? t.bgActive : t.bgIdle,
                            color: active ? '#fff' : t.textIdle,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
                            boxShadow: active ? '0 4px 14px rgba(0,0,0,0.1)' : '0 1px 2px rgba(0,0,0,0.03)',
                            transform: active ? 'translateY(-1px)' : 'translateY(0)',
                            textAlign: 'left',
                            font: 'inherit',
                        }}
                        onMouseEnter={(e) => { if (!active) e.currentTarget.style.transform = 'translateY(-1px)'; }}
                        onMouseLeave={(e) => { if (!active) e.currentTarget.style.transform = 'translateY(0)'; }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <div style={{
                                width: 32, height: 32, borderRadius: 8,
                                background: active ? 'rgba(255,255,255,0.2)' : '#fff',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: active ? 'none' : '0 1px 2px rgba(0,0,0,0.05)',
                            }}>
                                <t.Icon size={16} color={active ? '#fff' : t.color} />
                            </div>
                            <div>
                                <div style={{ fontSize: 12, fontWeight: 600, opacity: active ? 0.85 : 0.7, textTransform: 'uppercase', letterSpacing: '0.5px' }}>{t.label}</div>
                                <div style={{ fontSize: 22, fontWeight: 800, marginTop: 1 }}>{t.count}</div>
                            </div>
                        </div>
                    </button>
                );
            })}
        </div>
    );
}

// ============================================================================
// ReleaseSections — single-bucket card list (controlled by SectionTabs)
// ============================================================================

function ReleaseSections({ rows, filter }: { rows: BlanketRelease[]; filter: CardFilter }) {
    const drafted   = useMemo(() => rows.filter(r => r.status === 'OPEN'),      [rows]);
    const completed = useMemo(() => rows.filter(r => r.status === 'FULFILLED'), [rows]);
    const cancelled = useMemo(() => rows.filter(r => r.status === 'CANCELLED'), [rows]);

    if (filter === 'ALL') {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                {drafted.length > 0 && (
                    <ReleaseSection
                        title="Drafted · In Progress"
                        subtitle="Releases created and awaiting fulfillment"
                        icon={<Clipboard size={18} color="#fff" />}
                        gradient="linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%)"
                        items={drafted}
                        emptyLabel="No drafted releases."
                        emphasis="open"
                    />
                )}
                {completed.length > 0 && (
                    <ReleaseSection
                        title="Completed Releases"
                        subtitle="Fully released against their BPA"
                        icon={<CheckCircle size={18} color="#fff" />}
                        gradient="linear-gradient(135deg, #16a34a 0%, #14532d 100%)"
                        items={completed}
                        emptyLabel="No completed releases yet."
                        emphasis="done"
                        collapsedByDefault={drafted.length > 0}
                    />
                )}
                {cancelled.length > 0 && (
                    <ReleaseSection
                        title="Cancelled"
                        subtitle="Withdrawn or voided releases"
                        icon={<XCircle size={18} color="#fff" />}
                        gradient="linear-gradient(135deg, #6b7280 0%, #374151 100%)"
                        items={cancelled}
                        emptyLabel="No cancelled releases."
                        emphasis="muted"
                        collapsedByDefault
                    />
                )}
            </div>
        );
    }

    // Single-bucket view — tab controls which
    const bucket =
        filter === 'OPEN'      ? { items: drafted,   emphasis: 'open'  as const, emptyLabel: 'No drafted releases.' } :
        filter === 'FULFILLED' ? { items: completed, emphasis: 'done'  as const, emptyLabel: 'No completed releases yet.' } :
                                 { items: cancelled, emphasis: 'muted' as const, emptyLabel: 'No cancelled releases.' };

    if (bucket.items.length === 0) {
        return (
            <Card style={{ padding: 60, textAlign: 'center' }}>
                <Package size={32} style={{ color: 'var(--enterprise-gray-400)' }} />
                <p style={{ marginTop: 12, color: 'var(--enterprise-gray-600)' }}>{bucket.emptyLabel}</p>
            </Card>
        );
    }

    return (
        <div>
            {bucket.items.map(r => <ReleaseCard key={r.id} release={r} emphasis={bucket.emphasis} />)}
        </div>
    );
}

function ReleaseSection({
    title, subtitle, icon, gradient, items, emptyLabel, emphasis, collapsedByDefault = false,
}: {
    title: string;
    subtitle: string;
    icon: React.ReactNode;
    gradient: string;
    items: BlanketRelease[];
    emptyLabel: string;
    emphasis: 'open' | 'done' | 'muted';
    collapsedByDefault?: boolean;
}) {
    const [sectionOpen, setSectionOpen] = useState(!collapsedByDefault);
    const totalQty = items.reduce((s, r) => s + Number(r.requested_quantity ?? 0), 0);

    return (
        <div style={{ border: '1px solid var(--enterprise-gray-200)', borderRadius: 'var(--border-radius-lg)', overflow: 'hidden', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
            {/* Gradient header */}
            <div
                onClick={() => setSectionOpen(v => !v)}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 18px', background: gradient, color: '#fff', cursor: 'pointer' }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <div style={{ width: '32px', height: '32px', borderRadius: '8px', background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {icon}
                    </div>
                    <div>
                        <div style={{ fontWeight: 700, fontSize: '15px', letterSpacing: '0.2px' }}>{title}</div>
                        <div style={{ fontSize: '11.5px', opacity: 0.85, marginTop: '1px' }}>{subtitle}</div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                    <div style={{ textAlign: 'right', fontSize: '12px' }}>
                        <div style={{ fontWeight: 700, fontSize: '17px' }}>{items.length}</div>
                        <div style={{ opacity: 0.85 }}>{items.length === 1 ? 'release' : 'releases'}</div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '12px', borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '14px' }}>
                        <div style={{ fontWeight: 700, fontSize: '15px', fontFamily: 'monospace' }}>{totalQty.toLocaleString()}</div>
                        <div style={{ opacity: 0.85 }}>total qty</div>
                    </div>
                    <ChevronRight size={20} style={{ transform: sectionOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s ease' }} />
                </div>
            </div>

            {sectionOpen && (
                <div style={{ padding: '14px 14px 6px', background: emphasis === 'muted' ? 'var(--enterprise-gray-50)' : 'white' }}>
                    {items.length === 0 ? (
                        <div style={{ textAlign: 'center', padding: '30px 0', color: 'var(--enterprise-gray-500)', fontSize: 13 }}>{emptyLabel}</div>
                    ) : (
                        items.map(r => <ReleaseCard key={r.id} release={r} emphasis={emphasis} />)
                    )}
                </div>
            )}
        </div>
    );
}

function ReleaseCard({ release: r, emphasis }: { release: BlanketRelease; emphasis: 'open' | 'done' | 'muted' }) {
    const [expanded, setExpanded] = useState(false);
    const fulfilled = r.status === 'FULFILLED';
    const cancelled = r.status === 'CANCELLED';
    const accent = fulfilled ? '#16a34a' : cancelled ? '#6b7280' : 'var(--enterprise-primary)';
    const fulfillmentPct = fulfilled ? 100 : 0; // wire to line_config.released_quantity in Phase 2

    return (
        <div style={{
            border: expanded ? `1.5px solid ${accent}` : '1px solid var(--enterprise-gray-200)',
            borderRadius: 'var(--border-radius-lg)',
            overflow: 'hidden',
            marginBottom: '10px',
            background: 'white',
            boxShadow: expanded ? '0 6px 18px rgba(30,58,138,0.1)' : '0 1px 2px rgba(0,0,0,0.03)',
            transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
            opacity: cancelled ? 0.75 : 1,
        }}>
            <div onClick={() => setExpanded(v => !v)} style={{ display: 'flex', cursor: 'pointer', background: expanded ? 'linear-gradient(135deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.07) 100%)' : 'white', transition: 'background 0.2s ease' }}>
                {/* Chevron strip */}
                <div style={{ width: '36px', minWidth: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--enterprise-gray-100)', background: expanded ? accent : 'var(--enterprise-gray-50)', transition: 'all 0.2s ease' }}>
                    <ChevronRight size={16} style={{ color: expanded ? 'white' : 'var(--enterprise-gray-500)', transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.25s ease' }} />
                </div>

                {/* Content */}
                <div style={{ flex: 1, padding: '12px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                    {/* Row 1 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.1fr 1fr', gap: '16px', marginBottom: '10px' }}>
                        <InfoBlock label="Release #" icon={<Hash size={10} />}>
                            <span style={{ fontFamily: 'monospace', fontWeight: 700, color: accent }}>{r.release_number}</span>
                        </InfoBlock>
                        <InfoBlock label="BPA" icon={<FileText size={10} />}>
                            <span style={{ fontFamily: 'monospace', color: 'var(--enterprise-gray-800)' }}>{r.customer_po_base ?? '—'}</span>
                        </InfoBlock>
                        <InfoBlock label="Part" icon={<Package size={10} />}>
                            {r.part_number ? (
                                <span>
                                    <span style={{ fontFamily: 'monospace', fontWeight: 700, color: 'var(--enterprise-info, #3b82f6)' }}>{r.part_number}</span>
                                    {r.msn_code && <span style={{ color: 'var(--enterprise-gray-600)', fontSize: 12, marginLeft: 4 }}>({r.msn_code})</span>}
                                </span>
                            ) : (
                                <span style={{ color: 'var(--enterprise-gray-400)' }}>—</span>
                            )}
                        </InfoBlock>
                        <InfoBlock label="Buyer" icon={<User size={10} />}>
                            <span style={{ color: 'var(--enterprise-gray-700)' }}>{r.buyer_name ?? '—'}</span>
                        </InfoBlock>
                    </div>

                    {/* Row 2 */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1.1fr 1fr', gap: '16px' }}>
                        <InfoBlock label="Requested Qty">
                            <span style={{ fontWeight: 700, color: 'var(--enterprise-success)' }}>{Number(r.requested_quantity).toLocaleString()}</span>
                        </InfoBlock>
                        <InfoBlock label="Pallets">
                            <span style={{ fontWeight: 600, color: 'var(--enterprise-gray-800)' }}>{r.sub_invoice_pallets ?? '—'}</span>
                        </InfoBlock>
                        <InfoBlock label="Need By" icon={<Calendar size={10} />}>
                            <span style={{ fontWeight: 600, color: r.need_by_date && emphasis === 'open' ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-700)' }}>
                                {r.need_by_date ? new Date(r.need_by_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                            </span>
                        </InfoBlock>
                        <InfoBlock label="Created">
                            <span style={{ color: 'var(--enterprise-gray-700)' }}>{new Date(r.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                        </InfoBlock>
                    </div>
                </div>
            </div>

            {expanded && (
                <div style={{ background: 'linear-gradient(180deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.01) 100%)', borderTop: '1px solid var(--enterprise-gray-200)', padding: '18px 54px', animation: 'slideDown 0.2s ease-out' }}>
                    <p style={{ fontSize: 'var(--font-size-xs)', fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '14px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Package size={14} /> Release Details
                    </p>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '14px' }}>
                        <DetailCard label="Release Sequence" value={r.release_sequence != null ? String(r.release_sequence) : '—'} />
                        <DetailCard label="Sub-Invoice #" value={r.sub_invoice_number ?? '—'} mono />
                        <DetailCard label="Last Updated" value={new Date(r.updated_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} />
                    </div>

                    {/* Released parts breakdown (one card per parent invoice sourced) */}
                    {r.sub_invoice_lines && r.sub_invoice_lines.length > 0 && (
                        <div style={{ marginTop: '18px' }}>
                            <p style={{ fontSize: 10, fontWeight: 700, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: 8 }}>
                                Released Against {r.sub_invoice_lines.length === 1 ? 'Parent Invoice' : `${r.sub_invoice_lines.length} Parent Invoices`}
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                {r.sub_invoice_lines.map((l, i) => (
                                    <div key={i} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr 1fr 1fr', gap: '12px', alignItems: 'center', padding: '10px 14px', background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 'var(--border-radius-md)' }}>
                                        <div>
                                            <p style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginBottom: 2 }}>PARENT INVOICE</p>
                                            <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: 'var(--enterprise-gray-800)' }}>{l.parent_invoice_number ?? '—'}</span>
                                        </div>
                                        <div>
                                            <p style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginBottom: 2 }}>PART</p>
                                            <span style={{ fontFamily: 'monospace', fontWeight: 600, fontSize: 12, color: 'var(--enterprise-info, #3b82f6)' }}>{l.part_number}</span>
                                        </div>
                                        <div>
                                            <p style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginBottom: 2 }}>QTY</p>
                                            <span style={{ fontWeight: 700, fontSize: 12, color: 'var(--enterprise-success)' }}>{Number(l.quantity).toLocaleString()}</span>
                                        </div>
                                        <div>
                                            <p style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginBottom: 2 }}>PALLETS</p>
                                            <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--enterprise-gray-800)' }}>{l.pallet_count}</span>
                                        </div>
                                        <div>
                                            <p style={{ fontSize: 10, color: 'var(--enterprise-gray-500)', marginBottom: 2 }}>UNIT PRICE</p>
                                            <span style={{ fontSize: 12, color: 'var(--enterprise-gray-700)' }}>${Number(l.unit_price ?? 0).toFixed(4)}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {r.notes && (
                        <div style={{ marginTop: '14px', padding: '12px 14px', background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 'var(--border-radius-md)' }}>
                            <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6 }}>Notes</p>
                            <p style={{ fontSize: 13, color: 'var(--enterprise-gray-800)', lineHeight: 1.5 }}>{r.notes}</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── mini building blocks ────────────────────────────────────────────

function InfoBlock({ label, icon, children }: { label: string; icon?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div>
            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                {icon}{label}
            </p>
            <div style={{ fontSize: 13, display: 'flex', alignItems: 'center', minHeight: 18 }}>{children}</div>
        </div>
    );
}

function DetailCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
    return (
        <div style={{ background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 'var(--border-radius-md)', padding: '10px 12px' }}>
            <p style={{ fontSize: 10, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 4 }}>{label}</p>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--enterprise-gray-800)', fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</p>
        </div>
    );
}
