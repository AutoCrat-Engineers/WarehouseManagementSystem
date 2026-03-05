/**
 * PackingListManager — View, confirm, and manage packing lists
 * InvoiceProformaManager — Invoice & proforma lifecycle
 *
 * Combined into a single tab-based view for the dispatch workflow:
 *   Tab 1: Packing Lists
 *   Tab 2: Invoices
 *   Tab 3: Proforma Invoices
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
    FileText, CheckCircle2, Loader2, Search, Package, Receipt,
    Truck, AlertTriangle, Plus, Eye, DollarSign, X,
} from 'lucide-react';
import { Card, Modal, EmptyState, ModuleLoader } from '../ui/EnterpriseUI';
import {
    SummaryCard, SummaryCardsGrid, SearchBox, FilterBar, ActionBar,
    ActionButton, RefreshButton, StatusFilter,
} from '../ui/SharedComponents';
import * as svc from './packingEngineService';
import type { PackingList, PackInvoice, ProformaInvoice } from './packingEngineService';
import { getSupabaseClient } from '../../utils/supabase/client';

type UserRole = 'L1' | 'L2' | 'L3' | null;

interface PackingListManagerProps {
    accessToken: string;
    userRole?: UserRole;
    userPerms?: Record<string, boolean>;
}

type TabKey = 'packing-lists' | 'invoices' | 'proforma';

// ============================================================================
// STATUS BADGE
// ============================================================================

function StatusBadge({ status }: { status: string }) {
    const cfg: Record<string, { color: string; bg: string }> = {
        DRAFT: { color: '#6b7280', bg: '#f3f4f6' },
        CONFIRMED: { color: '#16a34a', bg: '#f0fdf4' },
        INVOICED: { color: '#7c3aed', bg: '#f5f3ff' },
        PROFORMA_LINKED: { color: '#0891b2', bg: '#ecfeff' },
        STOCK_MOVED: { color: '#d97706', bg: '#fffbeb' },
        CANCELLED: { color: '#9ca3af', bg: '#f9fafb' },
    };
    const c = cfg[status] || cfg.DRAFT;
    return (
        <span style={{
            padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
            background: c.bg, color: c.color, border: `1px solid ${c.color}30`,
            textTransform: 'uppercase', letterSpacing: '0.3px',
        }}>
            {status.replace(/_/g, ' ')}
        </span>
    );
}

// ============================================================================
// MAIN
// ============================================================================

export function PackingListManager({ accessToken, userRole, userPerms = {} }: PackingListManagerProps) {
    const supabase = getSupabaseClient();
    const hasPerms = Object.keys(userPerms).length > 0;
    const canConfirm = userRole === 'L3' || (hasPerms ? userPerms['dispatch.edit'] === true : userRole === 'L2');

    const [tab, setTab] = useState<TabKey>('packing-lists');
    const [packingLists, setPackingLists] = useState<PackingList[]>([]);
    const [invoices, setInvoices] = useState<PackInvoice[]>([]);
    const [proformas, setProformas] = useState<ProformaInvoice[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [actionLoading, setActionLoading] = useState<string | null>(null);

    // Invoice selection for proforma
    const [showProformaModal, setShowProformaModal] = useState(false);
    const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());
    const [creating, setCreating] = useState(false);

    const fetchAll = useCallback(async () => {
        setLoading(true);
        try {
            const [pl, inv, pi] = await Promise.all([
                svc.fetchPackingLists(),
                svc.fetchInvoices(),
                svc.fetchProformaInvoices(),
            ]);
            setPackingLists(pl);
            setInvoices(inv);
            setProformas(pi);
        } catch (err) { console.error(err); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchAll(); }, [fetchAll]);

    // ─── Actions ───
    const handleConfirmPL = async (plId: string) => {
        setActionLoading(plId);
        try {
            await svc.confirmPackingList(plId);
            fetchAll();
        } catch (err: any) { alert(err.message); }
        finally { setActionLoading(null); }
    };

    const handleGenerateInvoice = async (plId: string) => {
        setActionLoading(plId);
        try {
            await svc.createInvoice(plId);
            fetchAll();
        } catch (err: any) { alert(err.message); }
        finally { setActionLoading(null); }
    };

    const handleConfirmInvoice = async (invId: string) => {
        setActionLoading(invId);
        try {
            const userId = (await supabase.auth.getSession()).data.session?.user?.id;
            await supabase.from('pack_invoices').update({
                status: 'CONFIRMED', confirmed_at: new Date().toISOString(),
                confirmed_by: userId, updated_at: new Date().toISOString(),
            }).eq('id', invId);
            fetchAll();
        } catch (err: any) { alert(err.message); }
        finally { setActionLoading(null); }
    };

    const handleCreateProforma = async () => {
        if (selectedInvoiceIds.size === 0) return;
        setCreating(true);
        try {
            await svc.createProforma(Array.from(selectedInvoiceIds));
            setShowProformaModal(false);
            setSelectedInvoiceIds(new Set());
            fetchAll();
        } catch (err: any) { alert(err.message); }
        finally { setCreating(false); }
    };

    const handleConfirmProforma = async (piId: string) => {
        setActionLoading(piId);
        try {
            const userId = (await supabase.auth.getSession()).data.session?.user?.id;
            await supabase.from('pack_proforma_invoices').update({
                status: 'CONFIRMED', confirmed_at: new Date().toISOString(),
                confirmed_by: userId, updated_at: new Date().toISOString(),
            }).eq('id', piId);
            fetchAll();
        } catch (err: any) { alert(err.message); }
        finally { setActionLoading(null); }
    };

    const confirmedInvoices = invoices.filter(i => i.status === 'CONFIRMED');

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
    const tabBtn = (key: TabKey, icon: React.ReactNode, label: string, count: number) => (
        <button key={key} onClick={() => setTab(key)} style={{
            display: 'flex', alignItems: 'center', gap: 6, padding: '10px 18px',
            borderRadius: '8px 8px 0 0', border: 'none', cursor: 'pointer',
            fontWeight: 600, fontSize: 13, transition: 'all 0.2s',
            background: tab === key ? 'white' : 'transparent',
            color: tab === key ? '#1e3a8a' : '#6b7280',
            borderBottom: tab === key ? '2px solid #1e3a8a' : '2px solid transparent',
        }}>
            {icon} {label}
            <span style={{
                padding: '2px 8px', borderRadius: 10, fontSize: 11, fontWeight: 700,
                background: tab === key ? '#eff6ff' : '#f3f4f6',
                color: tab === key ? '#1e3a8a' : '#9ca3af',
            }}>{count}</span>
        </button>
    );

    return (
        <div style={{ paddingBottom: 40 }}>
            {/* TAB BAR */}
            <div style={{ display: 'flex', gap: 4, marginBottom: -1, paddingLeft: 4 }}>
                {tabBtn('packing-lists', <FileText size={14} />, 'Packing Lists', packingLists.length)}
                {tabBtn('invoices', <Receipt size={14} />, 'Invoices', invoices.length)}
                {tabBtn('proforma', <DollarSign size={14} />, 'Proforma', proformas.length)}
            </div>

            <FilterBar>
                <SearchBox value={searchTerm} onChange={setSearchTerm} placeholder="Search..." />
                <ActionBar>
                    {tab === 'proforma' && canConfirm && confirmedInvoices.length > 0 && (
                        <ActionButton label="New Proforma" icon={<Plus size={14} />}
                            onClick={() => { setSelectedInvoiceIds(new Set()); setShowProformaModal(true); }}
                            variant="primary" />
                    )}
                    <RefreshButton onClick={fetchAll} loading={loading} />
                </ActionBar>
            </FilterBar>

            <Card style={{ padding: 0 }}>
                {loading ? (
                    <ModuleLoader moduleName="Loading..." icon={<Loader2 size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />
                ) : (
                    <div style={{ overflowX: 'auto' }}>
                        {/* ── PACKING LISTS TAB ── */}
                        {tab === 'packing-lists' && (
                            packingLists.length === 0 ? (
                                <EmptyState icon={<FileText size={48} style={{ color: 'var(--enterprise-gray-400)' }} />}
                                    title="No Packing Lists" description="Generate packing lists from the Dispatch Selection view." />
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr>
                                            <th style={th}>PL #</th>
                                            <th style={th}>Customer</th>
                                            <th style={{ ...th, textAlign: 'center' }}>Pallets</th>
                                            <th style={{ ...th, textAlign: 'center' }}>Containers</th>
                                            <th style={{ ...th, textAlign: 'right' }}>Total Qty</th>
                                            <th style={{ ...th, textAlign: 'center' }}>Status</th>
                                            <th style={th}>Created</th>
                                            <th style={{ ...th, textAlign: 'center' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {packingLists.map(pl => (
                                            <tr key={pl.id}
                                                style={{ transition: 'background 0.15s' }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                                                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                                <td style={{ ...td, fontWeight: 700, color: '#1e3a8a', fontFamily: 'monospace' }}>{pl.packing_list_number}</td>
                                                <td style={td}>{pl.customer_name || '—'}</td>
                                                <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{pl.total_pallets}</td>
                                                <td style={{ ...td, textAlign: 'center' }}>{pl.total_containers}</td>
                                                <td style={{ ...td, textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{pl.total_quantity.toLocaleString()}</td>
                                                <td style={{ ...td, textAlign: 'center' }}><StatusBadge status={pl.status} /></td>
                                                <td style={{ ...td, fontSize: 12, color: '#6b7280' }}>
                                                    {new Date(pl.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                </td>
                                                <td style={{ ...td, textAlign: 'center' }}>
                                                    <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
                                                        {pl.status === 'DRAFT' && canConfirm && (
                                                            <button onClick={() => handleConfirmPL(pl.id)} disabled={actionLoading === pl.id}
                                                                style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#16a34a', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                                                                {actionLoading === pl.id ? '...' : 'Confirm'}
                                                            </button>
                                                        )}
                                                        {pl.status === 'CONFIRMED' && canConfirm && (
                                                            <button onClick={() => handleGenerateInvoice(pl.id)} disabled={actionLoading === pl.id}
                                                                style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#1e3a8a', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                                                                {actionLoading === pl.id ? '...' : 'Gen Invoice'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )
                        )}

                        {/* ── INVOICES TAB ── */}
                        {tab === 'invoices' && (
                            invoices.length === 0 ? (
                                <EmptyState icon={<Receipt size={48} style={{ color: 'var(--enterprise-gray-400)' }} />}
                                    title="No Invoices" description="Invoices are generated from confirmed packing lists." />
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr>
                                            <th style={th}>Invoice #</th>
                                            <th style={th}>PL #</th>
                                            <th style={th}>Customer</th>
                                            <th style={{ ...th, textAlign: 'center' }}>Pallets</th>
                                            <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                                            <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                                            <th style={{ ...th, textAlign: 'center' }}>Status</th>
                                            <th style={{ ...th, textAlign: 'center' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {invoices.map(inv => (
                                            <tr key={inv.id}
                                                style={{ transition: 'background 0.15s' }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                                                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                                <td style={{ ...td, fontWeight: 700, color: '#1e3a8a', fontFamily: 'monospace' }}>{inv.invoice_number}</td>
                                                <td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{inv.packing_list_number || '—'}</td>
                                                <td style={td}>{inv.customer_name || '—'}</td>
                                                <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{inv.total_pallets}</td>
                                                <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{inv.total_quantity.toLocaleString()}</td>
                                                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                                                    {inv.currency_code} {Number(inv.total_amount).toLocaleString()}
                                                </td>
                                                <td style={{ ...td, textAlign: 'center' }}><StatusBadge status={inv.status} /></td>
                                                <td style={{ ...td, textAlign: 'center' }}>
                                                    {inv.status === 'DRAFT' && canConfirm && (
                                                        <button onClick={() => handleConfirmInvoice(inv.id)} disabled={actionLoading === inv.id}
                                                            style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#16a34a', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                                                            {actionLoading === inv.id ? '...' : 'Confirm'}
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )
                        )}

                        {/* ── PROFORMA TAB ── */}
                        {tab === 'proforma' && (
                            proformas.length === 0 ? (
                                <EmptyState icon={<DollarSign size={48} style={{ color: 'var(--enterprise-gray-400)' }} />}
                                    title="No Proforma Invoices" description="Create proformas by grouping confirmed invoices." />
                            ) : (
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr>
                                            <th style={th}>Proforma #</th>
                                            <th style={th}>Customer</th>
                                            <th style={{ ...th, textAlign: 'center' }}>Invoices</th>
                                            <th style={{ ...th, textAlign: 'center' }}>Pallets</th>
                                            <th style={{ ...th, textAlign: 'right' }}>Qty</th>
                                            <th style={{ ...th, textAlign: 'right' }}>Amount</th>
                                            <th style={{ ...th, textAlign: 'center' }}>Status</th>
                                            <th style={th}>Created</th>
                                            <th style={{ ...th, textAlign: 'center' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {proformas.map(pi => (
                                            <tr key={pi.id}
                                                style={{ transition: 'background 0.15s' }}
                                                onMouseEnter={e => (e.currentTarget.style.background = '#f0f4ff')}
                                                onMouseLeave={e => (e.currentTarget.style.background = '')}>
                                                <td style={{ ...td, fontWeight: 700, color: '#1e3a8a', fontFamily: 'monospace' }}>{pi.proforma_number}</td>
                                                <td style={td}>{pi.customer_name || '—'}</td>
                                                <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{pi.total_invoices}</td>
                                                <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{pi.total_pallets}</td>
                                                <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{pi.total_quantity.toLocaleString()}</td>
                                                <td style={{ ...td, textAlign: 'right', fontWeight: 600 }}>
                                                    {pi.currency_code} {Number(pi.total_amount).toLocaleString()}
                                                </td>
                                                <td style={{ ...td, textAlign: 'center' }}><StatusBadge status={pi.status} /></td>
                                                <td style={{ ...td, fontSize: 12, color: '#6b7280' }}>
                                                    {new Date(pi.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                                                </td>
                                                <td style={{ ...td, textAlign: 'center' }}>
                                                    {pi.status === 'DRAFT' && canConfirm && (
                                                        <button onClick={() => handleConfirmProforma(pi.id)} disabled={actionLoading === pi.id}
                                                            style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#16a34a', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer' }}>
                                                            {actionLoading === pi.id ? '...' : 'Confirm'}
                                                        </button>
                                                    )}
                                                    {pi.status === 'CONFIRMED' && canConfirm && (
                                                        <button onClick={() => alert('Stock transfer execution — coming soon')}
                                                            style={{ padding: '4px 10px', borderRadius: 6, border: 'none', background: '#dc2626', color: 'white', fontSize: 11, fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                            <Truck size={12} /> Move Stock
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            )
                        )}
                    </div>
                )}
            </Card>

            {/* PROFORMA CREATION MODAL */}
            {showProformaModal && (
                <Modal isOpen={showProformaModal} title="Create Proforma Invoice" onClose={() => setShowProformaModal(false)}>
                    <div style={{ padding: '16px 0' }}>
                        <div style={{ fontSize: 13, color: '#374151', marginBottom: 12 }}>
                            Select confirmed invoices to group into a proforma:
                        </div>
                        {confirmedInvoices.length === 0 ? (
                            <div style={{ color: '#9ca3af', fontSize: 13, padding: 16, textAlign: 'center' }}>No confirmed invoices available.</div>
                        ) : (
                            confirmedInvoices.map(inv => (
                                <div key={inv.id} onClick={() => {
                                    const next = new Set(selectedInvoiceIds);
                                    next.has(inv.id) ? next.delete(inv.id) : next.add(inv.id);
                                    setSelectedInvoiceIds(next);
                                }} style={{
                                    display: 'flex', alignItems: 'center', gap: 12,
                                    padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
                                    background: selectedInvoiceIds.has(inv.id) ? '#eff6ff' : 'white',
                                    border: `1px solid ${selectedInvoiceIds.has(inv.id) ? '#2563eb' : '#e5e7eb'}`,
                                    marginBottom: 6,
                                }}>
                                    <div style={{
                                        width: 20, height: 20, borderRadius: 4,
                                        border: `2px solid ${selectedInvoiceIds.has(inv.id) ? '#2563eb' : '#d1d5db'}`,
                                        background: selectedInvoiceIds.has(inv.id) ? '#2563eb' : 'white',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        {selectedInvoiceIds.has(inv.id) && <CheckCircle2 size={12} color="white" />}
                                    </div>
                                    <span style={{ fontFamily: 'monospace', fontWeight: 600, color: '#1e3a8a' }}>{inv.invoice_number}</span>
                                    <span>{inv.customer_name || '—'}</span>
                                    <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{inv.currency_code} {Number(inv.total_amount).toLocaleString()}</span>
                                </div>
                            ))
                        )}
                        <button onClick={handleCreateProforma} disabled={creating || selectedInvoiceIds.size === 0}
                            style={{
                                width: '100%', padding: '10px 20px', borderRadius: 8, marginTop: 16,
                                background: creating || selectedInvoiceIds.size === 0 ? '#9ca3af' : '#1e3a8a',
                                color: 'white', border: 'none', fontWeight: 700, fontSize: 14,
                                cursor: creating || selectedInvoiceIds.size === 0 ? 'not-allowed' : 'pointer',
                            }}>
                            {creating ? 'Creating...' : `Create Proforma (${selectedInvoiceIds.size} invoices)`}
                        </button>
                    </div>
                </Modal>
            )}

            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
}
