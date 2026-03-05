/**
 * MasterPackingListHome.tsx — MPL Central Hub (integrated PL Print wizard)
 *
 * MPLs are ONLY created from DispatchSelection. No "Create MPL" button here.
 * Each MPL row has: View, Print (enabled after PO+Invoice filled).
 * Clicking a PENDING MPL opens inline wizard: Review → Weights → Invoice/PO Entry.
 * No container_number shown — only Packing Box ID.
 */
import React, { useState, useEffect, useCallback } from 'react';
import { Search, Printer, Eye, XCircle, ChevronLeft, ChevronRight, Package, FileText, Truck, AlertCircle, CheckCircle2, Clock, RefreshCw, Hash, Box, Loader2, Scale, Edit3 } from 'lucide-react';
import { fetchMasterPackingLists, confirmMpl, markMplPrinted, cancelMpl, fetchMplPallets, fetchDispatchAuditLog } from './mplService';
import type { MasterPackingList, MplPallet, MplStatus, DispatchAuditEntry } from './mplService';
import { getSupabaseClient } from '../../utils/supabase/client';
import * as svc from './packingEngineService';
import type { PackingSpec } from './packingEngineService';

type UserRole = 'L1' | 'L2' | 'L3' | null;
interface Props { accessToken?: string; userRole?: UserRole; userPerms?: Record<string, boolean>; onNavigate?: (view: string, data?: any) => void; }

interface EnrichedPallet {
    id: string; pallet_number: string; item_code: string; item_name: string;
    part_number: string; master_serial_no: string; state: string;
    current_qty: number; target_qty: number; container_count: number;
    spec: PackingSpec | null;
    containers: Array<{ packing_id: string; quantity: number; container_type: string; is_adjustment: boolean; operator: string }>;
    gross_weight_kg: number;
}

type WizardStep = 'REVIEW' | 'WEIGHTS' | 'DISPATCH';

export function MasterPackingListHome({ userRole, userPerms = {}, onNavigate }: Props) {
    const supabase = getSupabaseClient();
    const canEdit = userRole === 'L3' || userRole === 'L2';
    const canDelete = userRole === 'L3';

    // Dashboard state
    const [mpls, setMpls] = useState<MasterPackingList[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<MplStatus | 'ALL'>('ALL');
    const [page, setPage] = useState(0);
    const pageSize = 25;

    // Detail panel
    const [selectedMpl, setSelectedMpl] = useState<MasterPackingList | null>(null);
    const [selectedPallets, setSelectedPallets] = useState<MplPallet[]>([]);
    const [auditLog, setAuditLog] = useState<DispatchAuditEntry[]>([]);
    const [detailLoading, setDetailLoading] = useState(false);
    const [showDetail, setShowDetail] = useState(false);

    // Cancel
    const [cancelTarget, setCancelTarget] = useState<MasterPackingList | null>(null);
    const [cancelReason, setCancelReason] = useState('');
    const [cancelling, setCancelling] = useState(false);

    // Inline wizard state
    const [wizardMpl, setWizardMpl] = useState<MasterPackingList | null>(null);
    const [wizardStep, setWizardStep] = useState<WizardStep>('REVIEW');
    const [enrichedPallets, setEnrichedPallets] = useState<EnrichedPallet[]>([]);
    const [palletDetails, setPalletDetails] = useState<any[]>([]);
    const [plData, setPlData] = useState<any>(null);
    const [dispatchForm, setDispatchForm] = useState({ invoice_number: '', invoice_date: '', purchase_order_number: '', purchase_order_date: '', ship_via: '', vendor_number: '' });
    const [wizardLoading, setWizardLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // Summary
    const [summary, setSummary] = useState({ total: 0, pending: 0, printed: 0, dispatched: 0 });

    // ─── Load MPLs ───
    const loadMpls = useCallback(async () => {
        try {
            setLoading(true); setError(null);
            const { data, count } = await fetchMasterPackingLists({ status: statusFilter === 'ALL' ? undefined : statusFilter, search: search || undefined, limit: pageSize, offset: page * pageSize });
            setMpls(data); setTotalCount(count);
        } catch (err: any) { setError(err.message); } finally { setLoading(false); }
    }, [statusFilter, search, page]);

    const loadSummary = useCallback(async () => {
        try {
            const [all, draft, printed, dispatched] = await Promise.all([
                fetchMasterPackingLists({ limit: 0 }), fetchMasterPackingLists({ status: 'DRAFT', limit: 0 }),
                fetchMasterPackingLists({ status: 'PRINTED', limit: 0 }), fetchMasterPackingLists({ status: 'DISPATCHED', limit: 0 }),
            ]);
            setSummary({ total: all.count, pending: draft.count, printed: printed.count, dispatched: dispatched.count });
        } catch { }
    }, []);

    useEffect(() => { loadMpls(); }, [loadMpls]);
    useEffect(() => { loadSummary(); }, [loadSummary]);

    // ─── Open inline wizard for a PENDING MPL ───
    const handleOpenWizard = async (mpl: MasterPackingList) => {
        setWizardMpl(mpl); setWizardStep('REVIEW'); setWizardLoading(true);
        try {
            const plId = mpl.packing_list_id;
            let data = await svc.fetchPackingListData(plId);
            if (!data) { data = await svc.upsertPackingListData(plId, {}); await svc.autoPopulatePalletDetails(plId, data.id); }
            setPlData(data);
            setDispatchForm({ invoice_number: data.invoice_number || '', invoice_date: data.invoice_date || '', purchase_order_number: data.purchase_order_number || '', purchase_order_date: data.purchase_order_date || '', ship_via: data.ship_via || '', vendor_number: data.vendor_number || '' });
            const details = await svc.fetchPackingListPalletDetails(data.id);
            setPalletDetails(details);
            const { data: plItems } = await supabase.from('pack_packing_list_items').select('pallet_id').eq('packing_list_id', plId);
            const palletIds = (plItems || []).map((i: any) => i.pallet_id);
            if (palletIds.length > 0) {
                const { data: pallets } = await supabase.from('pack_pallets').select('*, items!pack_pallets_item_id_fkey (item_name, master_serial_no, part_number)').in('id', palletIds);
                const { data: pcJoin } = await supabase.from('pack_pallet_containers').select(`pallet_id, position_sequence, pack_containers!inner (quantity, container_type, is_adjustment, packing_box_id, profiles!pack_containers_created_by_fkey (full_name), packing_boxes:packing_box_id (packing_id))`).in('pallet_id', palletIds).order('position_sequence');
                const itemCodes = [...new Set((pallets || []).map((p: any) => p.item_code))];
                const specMap: Record<string, PackingSpec> = {};
                for (const ic of itemCodes) { const spec = await svc.getPackingSpecForItem(ic); if (spec) specMap[ic] = spec; }
                const enriched: EnrichedPallet[] = (pallets || []).map((p: any) => {
                    const pContainers = (pcJoin || []).filter((pc: any) => pc.pallet_id === p.id);
                    const detail = details.find((d: any) => d.pallet_id === p.id);
                    return {
                        id: p.id, pallet_number: p.pallet_number, item_code: p.item_code,
                        item_name: p.items?.item_name || p.item_code, part_number: p.items?.part_number || '', master_serial_no: p.items?.master_serial_no || '',
                        state: p.state, current_qty: p.current_qty, target_qty: p.target_qty, container_count: p.container_count,
                        spec: specMap[p.item_code] || null,
                        containers: pContainers.map((pc: any) => ({ packing_id: pc.pack_containers?.packing_boxes?.packing_id || '—', quantity: pc.pack_containers?.quantity || 0, container_type: pc.pack_containers?.container_type || '', is_adjustment: pc.pack_containers?.is_adjustment || false, operator: pc.pack_containers?.profiles?.full_name || '—' })),
                        gross_weight_kg: Number(detail?.gross_weight_kg || 0),
                    };
                });
                setEnrichedPallets(enriched);
            }
        } catch (err: any) { setError(err.message); } finally { setWizardLoading(false); }
    };

    const handleWeightChange = (palletId: string, weight: number) => { setEnrichedPallets(prev => prev.map(p => p.id === palletId ? { ...p, gross_weight_kg: weight } : p)); };

    // Save PO/Invoice + weights → confirm MPL
    const handleSaveAndConfirm = async () => {
        if (!wizardMpl || !plData) return;
        if (!dispatchForm.invoice_number || !dispatchForm.purchase_order_number) { setError('Invoice Number and PO Number are required'); return; }
        setSaving(true); setError(null);
        try {
            await svc.upsertPackingListData(wizardMpl.packing_list_id, { ...dispatchForm, is_finalized: true });
            for (const ep of enrichedPallets) {
                const detail = palletDetails.find((d: any) => d.pallet_id === ep.id);
                if (detail) await svc.updatePalletDetail(detail.id, { gross_weight_kg: ep.gross_weight_kg, invoice_number: dispatchForm.invoice_number, po_number: dispatchForm.purchase_order_number });
            }
            // Update MPL with invoice/PO
            await supabase.from('master_packing_lists').update({ invoice_number: dispatchForm.invoice_number, po_number: dispatchForm.purchase_order_number, total_gross_weight_kg: enrichedPallets.reduce((s, p) => s + p.gross_weight_kg, 0), updated_at: new Date().toISOString() }).eq('id', wizardMpl.id);
            await confirmMpl(wizardMpl.id);
            setSuccessMsg(`${wizardMpl.mpl_number} details saved & confirmed — Print is now enabled`);
            setWizardMpl(null); loadMpls(); loadSummary();
            setTimeout(() => setSuccessMsg(null), 4000);
        } catch (err: any) { setError(err.message); } finally { setSaving(false); }
    };

    // Print MPL
    const handlePrintMpl = async (mpl: MasterPackingList) => {
        try {
            const bt = await svc.getPackingListFullBacktrack(mpl.packing_list_id);
            openMasterPLPrint(bt, mpl);
            await markMplPrinted(mpl.id);
            setSuccessMsg(`${mpl.mpl_number} printed`); loadMpls(); loadSummary();
            setTimeout(() => setSuccessMsg(null), 3000);
        } catch (err: any) { setError(err.message); }
    };

    const openMasterPLPrint = (bt: any, mpl: MasterPackingList) => {
        const hd = bt.headerData; const details = bt.palletDetails;
        const ts = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
        const invDate = hd?.invoice_date ? new Date(hd.invoice_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
        const totalNet = details.reduce((s: number, d: any) => s + Number(d.net_weight_kg || 0), 0);
        const totalGross = details.reduce((s: number, d: any) => s + Number(d.gross_weight_kg || 0), 0);
        const totalQty = details.reduce((s: number, d: any) => s + (d.qty_per_pallet || 0), 0);
        const w = window.open('', '_blank', 'width=900,height=700');
        if (!w) { alert('Please allow popups'); return; }
        w.document.write(`<html><head><title>MPL ${mpl.mpl_number}</title><style>body{font-family:Arial;margin:20px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #333;padding:6px 8px;font-size:12px}th{background:#1e3a8a;color:white}@media print{button{display:none}}</style></head><body>`);
        w.document.write(`<h2 style="text-align:center">MASTER PACKING LIST</h2><p style="text-align:center;font-size:18px;font-weight:bold">${mpl.mpl_number}</p>`);
        w.document.write(`<table><tr><td><b>Invoice:</b> ${hd?.invoice_number || '—'}</td><td><b>Date:</b> ${invDate}</td><td><b>PO:</b> ${hd?.purchase_order_number || '—'}</td><td><b>Ship Via:</b> ${hd?.ship_via || '—'}</td></tr></table><br>`);
        w.document.write(`<table><thead><tr><th>#</th><th>Pallet</th><th>Item</th><th>Qty</th><th>Boxes</th><th>Net Wt</th><th>Gross Wt</th></tr></thead><tbody>`);
        details.forEach((d: any, i: number) => { w.document.write(`<tr><td>${i + 1}</td><td>${d.pallet_number || '—'}</td><td>${d.item_code || '—'}</td><td style="text-align:right">${(d.qty_per_pallet || 0).toLocaleString()}</td><td style="text-align:right">${d.containers_per_pallet || 0}</td><td style="text-align:right">${Number(d.net_weight_kg || 0).toFixed(2)}</td><td style="text-align:right">${Number(d.gross_weight_kg || 0).toFixed(2)}</td></tr>`); });
        w.document.write(`<tr style="font-weight:bold;background:#f0f0f0"><td colspan="3">TOTAL</td><td style="text-align:right">${totalQty.toLocaleString()}</td><td></td><td style="text-align:right">${totalNet.toFixed(2)}</td><td style="text-align:right">${totalGross.toFixed(2)}</td></tr>`);
        w.document.write(`</tbody></table><p style="font-size:10px;color:#666;margin-top:20px">Generated: ${ts}</p><button onclick="window.print()" style="margin-top:10px;padding:8px 16px">Print</button></body></html>`);
        w.document.close();
    };

    // View Detail
    const handleViewDetail = async (mpl: MasterPackingList) => {
        setSelectedMpl(mpl); setShowDetail(true); setDetailLoading(true);
        try {
            const [pallets, audit] = await Promise.all([fetchMplPallets(mpl.id), fetchDispatchAuditLog(mpl.id, 'MASTER_PACKING_LIST')]);
            setSelectedPallets(pallets); setAuditLog(audit);
        } catch (err: any) { setError(err.message); } finally { setDetailLoading(false); }
    };

    const handleCancelConfirm = async () => {
        if (!cancelTarget) return;
        try { setCancelling(true); await cancelMpl(cancelTarget.id, cancelReason || undefined); setCancelTarget(null); setCancelReason(''); setSuccessMsg(`${cancelTarget.mpl_number} cancelled`); loadMpls(); loadSummary(); setTimeout(() => setSuccessMsg(null), 4000); } catch (err: any) { setError(err.message); } finally { setCancelling(false); }
    };

    const isMplReady = (mpl: MasterPackingList) => !!(mpl.invoice_number && mpl.po_number);
    const totalPages = Math.ceil(totalCount / pageSize);

    const StatusBadge = ({ status }: { status: string }) => {
        const s: Record<string, { bg: string; color: string; label: string }> = { DRAFT: { bg: '#fef3c7', color: '#92400e', label: 'PENDING' }, CONFIRMED: { bg: '#dbeafe', color: '#1d4ed8', label: 'CONFIRMED' }, PRINTED: { bg: '#d1fae5', color: '#059669', label: 'PRINTED' }, DISPATCHED: { bg: '#ede9fe', color: '#7c3aed', label: 'DISPATCHED' }, CANCELLED: { bg: '#fee2e2', color: '#dc2626', label: 'CANCELLED' } };
        const st = s[status] || s.DRAFT;
        return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, backgroundColor: st.bg, color: st.color }}>{st.label}</span>;
    };

    const thS: React.CSSProperties = { padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase', borderBottom: '2px solid #e5e7eb', whiteSpace: 'nowrap' };
    const tdS: React.CSSProperties = { padding: '8px 12px', fontSize: 13, borderBottom: '1px solid #f3f4f6' };
    const inp: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' };
    const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 };

    // ═══════════════════════════════════════════════════════════════
    // RENDER — INLINE WIZARD (takes over when wizardMpl is set)
    // ═══════════════════════════════════════════════════════════════
    if (wizardMpl) {
        return (
            <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
                    <button onClick={() => setWizardMpl(null)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6 }}><ChevronLeft size={16} /> Back to Dashboard</button>
                    <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#1e3a8a' }}>{wizardMpl.mpl_number}</h2>
                    <StatusBadge status={wizardMpl.status} />
                </div>
                {error && <div style={{ padding: '12px 16px', marginBottom: 16, borderRadius: 8, backgroundColor: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}><AlertCircle size={16} />{error}<button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}><XCircle size={16} /></button></div>}

                {/* Step tabs */}
                <div style={{ display: 'flex', gap: 4, backgroundColor: '#f3f4f6', borderRadius: 8, padding: 3, marginBottom: 20, width: 'fit-content' }}>
                    {([['REVIEW', 'Review Pallets'], ['WEIGHTS', 'Gross Weights'], ['DISPATCH', 'Invoice & PO']] as [WizardStep, string][]).map(([key, label]) => (
                        <button key={key} onClick={() => setWizardStep(key)} style={{ padding: '8px 20px', borderRadius: 6, border: 'none', fontSize: 13, fontWeight: 600, cursor: 'pointer', backgroundColor: wizardStep === key ? '#fff' : 'transparent', color: wizardStep === key ? '#1e3a8a' : '#6b7280', boxShadow: wizardStep === key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>{label}</button>
                    ))}
                </div>

                {wizardLoading ? <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}><Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} /> Loading...</div> : <>
                    {/* REVIEW */}
                    {wizardStep === 'REVIEW' && (
                        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 20 }}>
                            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: '#111827' }}>Pallet & Packing Box Breakdown</h3>
                            {enrichedPallets.map(p => (
                                <div key={p.id} style={{ marginBottom: 12, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#f0f9ff', borderBottom: '1px solid #e5e7eb' }}>
                                        <div><span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e3a8a', fontSize: 13 }}>{p.pallet_number}</span><span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>{p.current_qty.toLocaleString()} PCS · {p.container_count} boxes</span></div>
                                        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: p.state === 'READY' ? '#f0fdf4' : '#fffbeb', color: p.state === 'READY' ? '#16a34a' : '#d97706' }}>{p.state}</span>
                                    </div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead><tr><th style={{ ...thS, width: 40 }}>#</th><th style={thS}>Packing Box ID</th><th style={thS}>Type</th><th style={{ ...thS, textAlign: 'right' }}>Qty</th><th style={thS}>Adj?</th><th style={thS}>Packed By</th></tr></thead>
                                        <tbody>{p.containers.map((c, i) => (
                                            <tr key={i}><td style={{ ...tdS, textAlign: 'center' }}>{i + 1}</td><td style={{ ...tdS, fontFamily: 'monospace', fontWeight: 700, color: '#7c3aed' }}>{c.packing_id}</td><td style={tdS}>{c.container_type}</td><td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{c.quantity.toLocaleString()}</td><td style={tdS}>{c.is_adjustment ? <span style={{ color: '#d97706', fontWeight: 600 }}>ADJ</span> : ''}</td><td style={tdS}>{c.operator}</td></tr>
                                        ))}</tbody>
                                    </table>
                                </div>
                            ))}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button onClick={() => setWizardStep('WEIGHTS')} style={{ padding: '10px 24px', borderRadius: 8, background: '#1e3a8a', color: 'white', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Next: Gross Weights <ChevronRight size={16} /></button></div>
                        </div>
                    )}

                    {/* WEIGHTS */}
                    {wizardStep === 'WEIGHTS' && (
                        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 20 }}>
                            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: '#111827' }}>Enter Gross Weight per Pallet (KGs)</h3>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead><tr><th style={thS}>Pallet</th><th style={thS}>Item</th><th style={{ ...thS, textAlign: 'right' }}>Qty</th><th style={{ ...thS, textAlign: 'right' }}>Boxes</th><th style={{ ...thS, textAlign: 'right' }}>Net Wt</th><th style={{ ...thS, textAlign: 'right', background: '#fffbeb' }}>Gross Wt *</th></tr></thead>
                                <tbody>{enrichedPallets.map(p => {
                                    const detail = palletDetails.find((d: any) => d.pallet_id === p.id);
                                    return (<tr key={p.id}><td style={{ ...tdS, fontFamily: 'monospace', fontWeight: 700, color: '#1e3a8a' }}>{p.pallet_number}</td><td style={tdS}><div style={{ fontWeight: 600 }}>{p.item_name}</div><div style={{ fontSize: 11, color: '#6b7280' }}>{p.item_code}</div></td><td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{p.current_qty.toLocaleString()}</td><td style={{ ...tdS, textAlign: 'right' }}>{p.container_count}</td><td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace' }}>{Number(detail?.net_weight_kg || 0).toFixed(2)}</td><td style={{ ...tdS, textAlign: 'right', background: '#fffbeb' }}><input type="number" step="0.01" value={p.gross_weight_kg || ''} onChange={e => handleWeightChange(p.id, parseFloat(e.target.value) || 0)} style={{ ...inp, width: 120, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, padding: '6px 10px' }} placeholder="0.00" /></td></tr>);
                                })}</tbody>
                            </table>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
                                <button onClick={() => setWizardStep('REVIEW')} style={{ padding: '10px 24px', borderRadius: 8, background: 'white', color: '#374151', border: '1px solid #d1d5db', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}><ChevronLeft size={16} /> Back</button>
                                <button onClick={() => setWizardStep('DISPATCH')} style={{ padding: '10px 24px', borderRadius: 8, background: '#1e3a8a', color: 'white', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>Next: Invoice & PO <ChevronRight size={16} /></button>
                            </div>
                        </div>
                    )}

                    {/* DISPATCH — Invoice & PO */}
                    {wizardStep === 'DISPATCH' && (
                        <div style={{ background: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 20 }}>
                            <h3 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12, color: '#111827' }}>Invoice & PO Details (SAP References)</h3>
                            <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Enter the SAP references. Both Invoice Number and PO Number are required to enable Print.</p>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                                <div><label style={lbl}>Invoice Number (SAP) *</label><input value={dispatchForm.invoice_number} onChange={e => setDispatchForm({ ...dispatchForm, invoice_number: e.target.value })} style={{ ...inp, borderColor: !dispatchForm.invoice_number ? '#fca5a5' : '#d1d5db' }} placeholder="INV/E/ 252602774" /></div>
                                <div><label style={lbl}>Invoice Date</label><input type="date" value={dispatchForm.invoice_date} onChange={e => setDispatchForm({ ...dispatchForm, invoice_date: e.target.value })} style={inp} /></div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                                <div><label style={lbl}>Purchase Order Number (SAP) *</label><input value={dispatchForm.purchase_order_number} onChange={e => setDispatchForm({ ...dispatchForm, purchase_order_number: e.target.value })} style={{ ...inp, borderColor: !dispatchForm.purchase_order_number ? '#fca5a5' : '#d1d5db' }} placeholder="260067798" /></div>
                                <div><label style={lbl}>PO Date</label><input type="date" value={dispatchForm.purchase_order_date} onChange={e => setDispatchForm({ ...dispatchForm, purchase_order_date: e.target.value })} style={inp} /></div>
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
                                <div><label style={lbl}>Ship Via</label><input value={dispatchForm.ship_via} onChange={e => setDispatchForm({ ...dispatchForm, ship_via: e.target.value })} style={inp} placeholder="SEAHORSE" /></div>
                                <div><label style={lbl}>Vendor Number</label><input value={dispatchForm.vendor_number} onChange={e => setDispatchForm({ ...dispatchForm, vendor_number: e.target.value })} style={inp} placeholder="114395" /></div>
                            </div>
                            {/* Summary */}
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
                                {[{ label: 'Pallets', value: enrichedPallets.length, color: '#1e3a8a' }, { label: 'Total Qty', value: enrichedPallets.reduce((s, p) => s + p.current_qty, 0).toLocaleString() + ' PCS', color: '#059669' }, { label: 'Total Gross Wt', value: enrichedPallets.reduce((s, p) => s + p.gross_weight_kg, 0).toFixed(2) + ' Kg', color: '#d97706' }, { label: 'Boxes', value: enrichedPallets.reduce((s, p) => s + p.container_count, 0), color: '#7c3aed' }].map((c, i) => (
                                    <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e5e7eb' }}><div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 }}>{c.label}</div><div style={{ fontSize: 15, fontWeight: 700, color: c.color, fontFamily: 'monospace' }}>{c.value}</div></div>
                                ))}
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                <button onClick={() => setWizardStep('WEIGHTS')} style={{ padding: '10px 24px', borderRadius: 8, background: 'white', color: '#374151', border: '1px solid #d1d5db', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}><ChevronLeft size={16} /> Back</button>
                                <button onClick={handleSaveAndConfirm} disabled={saving || !dispatchForm.invoice_number || !dispatchForm.purchase_order_number} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: (saving || !dispatchForm.invoice_number || !dispatchForm.purchase_order_number) ? '#9ca3af' : '#16a34a', color: 'white', fontWeight: 700, fontSize: 14, cursor: saving ? 'wait' : 'pointer' }}>
                                    {saving ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</> : <><CheckCircle2 size={16} /> Save & Confirm</>}
                                </button>
                            </div>
                        </div>
                    )}
                </>}
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
            </div>
        );
    }

    // ═══════════════════════════════════════════════════════════════
    // RENDER — DASHBOARD
    // ═══════════════════════════════════════════════════════════════
    return (
        <div style={{ padding: 24, maxWidth: 1400, margin: '0 auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                <div><h1 style={{ fontSize: 24, fontWeight: 800, color: '#111827', margin: '0 0 4px' }}>MPL Home</h1><p style={{ fontSize: 14, color: '#6b7280', margin: 0 }}>Master Packing List — View, manage, print, and track all dispatch packing lists</p></div>
            </div>

            {successMsg && <div style={{ padding: '12px 16px', marginBottom: 16, borderRadius: 8, backgroundColor: '#d1fae5', color: '#065f46', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600 }}><CheckCircle2 size={16} />{successMsg}</div>}
            {error && !wizardMpl && <div style={{ padding: '12px 16px', marginBottom: 16, borderRadius: 8, backgroundColor: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}><AlertCircle size={16} />{error}<button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}><XCircle size={16} /></button></div>}

            {/* Summary Cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 16, marginBottom: 24 }}>
                {[{ label: 'Total MPLs', value: summary.total, icon: FileText, color: '#3b82f6', bg: '#dbeafe' }, { label: 'Pending', value: summary.pending, icon: Clock, color: '#f59e0b', bg: '#fef3c7' }, { label: 'Printed', value: summary.printed, icon: Printer, color: '#10b981', bg: '#d1fae5' }, { label: 'Dispatched', value: summary.dispatched, icon: Truck, color: '#8b5cf6', bg: '#ede9fe' }].map(card => {
                    const CI = card.icon;
                    return (<div key={card.label} style={{ padding: 20, borderRadius: 12, backgroundColor: '#fff', border: '1px solid #e5e7eb', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', alignItems: 'center', gap: 16 }}><div style={{ width: 44, height: 44, borderRadius: 10, backgroundColor: card.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CI size={22} style={{ color: card.color }} /></div><div><p style={{ fontSize: 26, fontWeight: 800, color: '#111827', margin: 0 }}>{card.value}</p><p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>{card.label}</p></div></div>);
                })}
            </div>

            {/* Search + Filters */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 280 }}><Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} /><input type="text" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} placeholder="Search MPL #, PO, Invoice, Item Code..." style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none' }} /></div>
                <div style={{ display: 'flex', gap: 4, backgroundColor: '#f3f4f6', borderRadius: 8, padding: 3 }}>
                    {[{ key: 'ALL', label: 'All' }, { key: 'DRAFT', label: 'Pending' }, { key: 'CONFIRMED', label: 'Confirmed' }, { key: 'PRINTED', label: 'Printed' }, { key: 'DISPATCHED', label: 'Dispatched' }].map(s => (
                        <button key={s.key} onClick={() => { setStatusFilter(s.key as any); setPage(0); }} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', backgroundColor: statusFilter === s.key ? '#fff' : 'transparent', color: statusFilter === s.key ? '#1e3a8a' : '#6b7280', boxShadow: statusFilter === s.key ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>{s.label}</button>
                    ))}
                </div>
                <button onClick={() => { loadMpls(); loadSummary(); }} style={{ padding: 10, borderRadius: 8, border: '1px solid #d1d5db', backgroundColor: '#fff', cursor: 'pointer' }} title="Refresh"><RefreshCw size={16} style={{ color: '#6b7280' }} /></button>
            </div>

            {/* Data Table */}
            <div style={{ backgroundColor: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}>
                {loading ? <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}><RefreshCw size={24} style={{ animation: 'spin 1s linear infinite' }} /><p>Loading...</p></div> :
                    mpls.length === 0 ? <div style={{ padding: 48, textAlign: 'center', color: '#9ca3af' }}><Package size={32} style={{ marginBottom: 8, opacity: 0.5 }} /><p style={{ fontWeight: 600 }}>No Master Packing Lists</p><p style={{ fontSize: 13 }}>Generate packing lists from Dispatch Selection first.</p></div> :
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                <thead><tr style={{ backgroundColor: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                                    {['MPL #', 'Item Code', 'PO Number', 'Invoice #', 'Pallets', 'Qty', 'Status', 'Created', 'Actions'].map(h => (<th key={h} style={thS}>{h}</th>))}
                                </tr></thead>
                                <tbody>{mpls.map((mpl, idx) => (
                                    <tr key={mpl.id} style={{ borderBottom: '1px solid #f3f4f6', backgroundColor: idx % 2 === 0 ? '#fff' : '#fafbfc', cursor: 'pointer', transition: 'background 150ms' }} onClick={() => handleViewDetail(mpl)} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#eff6ff'} onMouseLeave={e => e.currentTarget.style.backgroundColor = idx % 2 === 0 ? '#fff' : '#fafbfc'}>
                                        <td style={{ padding: '10px 16px', fontWeight: 700, color: '#1e3a8a', fontFamily: 'monospace' }}>{mpl.mpl_number}</td>
                                        <td style={{ padding: '10px 16px', fontFamily: 'monospace', fontSize: 12 }}>{mpl.item_code}</td>
                                        <td style={{ padding: '10px 16px', color: '#4b5563' }}>{mpl.po_number || <span style={{ color: '#d1d5db' }}>—</span>}</td>
                                        <td style={{ padding: '10px 16px', color: '#4b5563' }}>{mpl.invoice_number || <span style={{ color: '#d1d5db' }}>—</span>}</td>
                                        <td style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'center' }}>{mpl.total_pallets}</td>
                                        <td style={{ padding: '10px 16px', fontWeight: 600, textAlign: 'center' }}>{mpl.total_quantity.toLocaleString()}</td>
                                        <td style={{ padding: '10px 16px' }}><StatusBadge status={mpl.status} /></td>
                                        <td style={{ padding: '10px 16px', color: '#6b7280', fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(mpl.created_at).toLocaleDateString()}</td>
                                        <td style={{ padding: '10px 16px' }} onClick={e => e.stopPropagation()}>
                                            <div style={{ display: 'flex', gap: 4 }}>
                                                {mpl.status === 'DRAFT' && canEdit && <button onClick={() => handleOpenWizard(mpl)} title="Enter Details (Review, Weights, Invoice)" style={{ padding: '6px 12px', borderRadius: 6, border: 'none', backgroundColor: '#1e3a8a', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 11, display: 'flex', alignItems: 'center', gap: 4 }}><Edit3 size={13} />Enter Details</button>}
                                                <button onClick={() => handleViewDetail(mpl)} title="View" style={{ padding: 6, borderRadius: 6, border: '1px solid #e5e7eb', backgroundColor: '#fff', cursor: 'pointer' }}><Eye size={14} style={{ color: '#3b82f6' }} /></button>
                                                {isMplReady(mpl) && mpl.status !== 'CANCELLED' && <button onClick={() => handlePrintMpl(mpl)} title="Print Master Packing List" style={{ padding: 6, borderRadius: 6, border: '1px solid #e5e7eb', backgroundColor: '#fff', cursor: 'pointer' }}><Printer size={14} style={{ color: '#059669' }} /></button>}
                                                {!isMplReady(mpl) && mpl.status !== 'CANCELLED' && mpl.status !== 'DISPATCHED' && <button disabled title="Fill Invoice & PO first to enable print" style={{ padding: 6, borderRadius: 6, border: '1px solid #f3f4f6', backgroundColor: '#f9fafb', cursor: 'not-allowed', opacity: 0.4 }}><Printer size={14} style={{ color: '#9ca3af' }} /></button>}
                                                {mpl.status !== 'DISPATCHED' && mpl.status !== 'CANCELLED' && canDelete && <button onClick={() => setCancelTarget(mpl)} title="Cancel" style={{ padding: 6, borderRadius: 6, border: '1px solid #fecaca', backgroundColor: '#fff', cursor: 'pointer' }}><XCircle size={14} style={{ color: '#dc2626' }} /></button>}
                                            </div>
                                        </td>
                                    </tr>
                                ))}</tbody>
                            </table>
                        </div>}
                {totalPages > 1 && <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderTop: '1px solid #e5e7eb', fontSize: 13, color: '#6b7280' }}><span>Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, totalCount)} of {totalCount}</span><div style={{ display: 'flex', gap: 4 }}><button onClick={() => setPage(Math.max(0, page - 1))} disabled={page === 0} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', backgroundColor: page === 0 ? '#f9fafb' : '#fff', cursor: page === 0 ? 'default' : 'pointer', opacity: page === 0 ? 0.5 : 1 }}><ChevronLeft size={14} /></button><span style={{ padding: '6px 12px', fontWeight: 600 }}>{page + 1} / {totalPages}</span><button onClick={() => setPage(Math.min(totalPages - 1, page + 1))} disabled={page >= totalPages - 1} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #d1d5db', backgroundColor: page >= totalPages - 1 ? '#f9fafb' : '#fff', cursor: page >= totalPages - 1 ? 'default' : 'pointer', opacity: page >= totalPages - 1 ? 0.5 : 1 }}><ChevronRight size={14} /></button></div></div>}
            </div>

            {/* Cancel Modal */}
            {cancelTarget && <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}><div style={{ backgroundColor: '#fff', borderRadius: 16, padding: 24, width: 450, maxWidth: '90vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 18, fontWeight: 700 }}>Cancel {cancelTarget.mpl_number}?</h3>
                <p style={{ margin: '0 0 16px', fontSize: 14, color: '#6b7280' }}>This will release {cancelTarget.total_pallets} pallet(s) back to READY state.</p>
                <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Reason (optional)..." rows={3} style={{ width: '100%', padding: 10, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, resize: 'vertical', outline: 'none', boxSizing: 'border-box', marginBottom: 16 }} />
                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}><button onClick={() => { setCancelTarget(null); setCancelReason(''); }} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', backgroundColor: '#fff', cursor: 'pointer', fontWeight: 500, fontSize: 14 }}>Keep</button><button onClick={handleCancelConfirm} disabled={cancelling} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', backgroundColor: '#dc2626', color: '#fff', cursor: cancelling ? 'wait' : 'pointer', fontWeight: 600, fontSize: 14, opacity: cancelling ? 0.7 : 1 }}>{cancelling ? 'Cancelling...' : 'Cancel MPL'}</button></div>
            </div></div>}

            {/* Detail Slideout */}
            {showDetail && selectedMpl && <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end', zIndex: 999 }} onClick={e => { if (e.target === e.currentTarget) setShowDetail(false); }}><div style={{ width: 600, maxWidth: '90vw', backgroundColor: '#fff', height: '100vh', overflowY: 'auto', padding: 24, boxShadow: '-4px 0 20px rgba(0,0,0,0.15)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}><div><h2 style={{ fontSize: 20, fontWeight: 800, color: '#111827', margin: '0 0 6px' }}>{selectedMpl.mpl_number}</h2><StatusBadge status={selectedMpl.status} /></div><button onClick={() => setShowDetail(false)} style={{ padding: 8, borderRadius: 8, border: '1px solid #e5e7eb', backgroundColor: '#fff', cursor: 'pointer' }}><XCircle size={18} style={{ color: '#6b7280' }} /></button></div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 16, backgroundColor: '#f9fafb', borderRadius: 10, marginBottom: 20, fontSize: 13 }}>
                    <div><span style={{ color: '#6b7280' }}>Item Code:</span> <strong>{selectedMpl.item_code}</strong></div>
                    <div><span style={{ color: '#6b7280' }}>PO #:</span> <strong>{selectedMpl.po_number || '—'}</strong></div>
                    <div><span style={{ color: '#6b7280' }}>Invoice #:</span> <strong>{selectedMpl.invoice_number || '—'}</strong></div>
                    <div><span style={{ color: '#6b7280' }}>Pallets:</span> <strong>{selectedMpl.total_pallets}</strong></div>
                    <div><span style={{ color: '#6b7280' }}>Qty:</span> <strong>{selectedMpl.total_quantity.toLocaleString()}</strong></div>
                    <div><span style={{ color: '#6b7280' }}>Gross Wt:</span> <strong>{Number(selectedMpl.total_gross_weight_kg).toFixed(2)} kg</strong></div>
                </div>
                <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 10 }}>Pallet Breakdown</h3>
                {detailLoading ? <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>Loading...</div> : selectedPallets.map(p => (
                    <div key={p.id} style={{ border: '1px solid #e5e7eb', borderRadius: 8, marginBottom: 12, overflow: 'hidden' }}>
                        <div style={{ padding: '10px 14px', backgroundColor: '#f0f4ff', display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600 }}><span style={{ color: '#1e3a8a' }}>{p.pallet_number}</span><span style={{ color: '#4b5563' }}>{p.container_count} boxes · {p.quantity.toLocaleString()} PCS</span></div>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ backgroundColor: '#fafbfc' }}><th style={{ padding: '6px 10px', textAlign: 'left', color: '#6b7280' }}>Packing Box ID</th><th style={{ padding: '6px 10px', textAlign: 'right', color: '#6b7280' }}>Qty</th><th style={{ padding: '6px 10px', textAlign: 'left', color: '#6b7280' }}>Type</th><th style={{ padding: '6px 10px', textAlign: 'left', color: '#6b7280' }}>Operator</th></tr></thead>
                            <tbody>{(p.inner_box_details || []).map((box: any, bi: number) => (
                                <tr key={bi} style={{ borderTop: '1px solid #f3f4f6' }}><td style={{ padding: '5px 10px', fontFamily: 'monospace', fontWeight: 700, color: '#7c3aed' }}>{box.packing_id || '—'}</td><td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 600 }}>{box.quantity.toLocaleString()}</td><td style={{ padding: '5px 10px' }}><span style={{ padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600, backgroundColor: box.is_adjustment ? '#fef3c7' : '#d1fae5', color: box.is_adjustment ? '#92400e' : '#065f46' }}>{box.is_adjustment ? 'ADJ' : 'STD'}</span></td><td style={{ padding: '5px 10px', color: '#6b7280' }}>{box.operator}</td></tr>
                            ))}</tbody></table>
                    </div>
                ))}
                {auditLog.length > 0 && <><h3 style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: '20px 0 10px' }}>Audit Trail</h3><div style={{ fontSize: 12 }}>{auditLog.map(a => (<div key={a.id} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #f3f4f6', alignItems: 'center' }}><span style={{ color: '#9ca3af', minWidth: 100, whiteSpace: 'nowrap', fontSize: 11 }}>{new Date(a.performed_at).toLocaleString()}</span><span style={{ fontWeight: 600, color: '#374151' }}>{a.action}</span>{a.from_status && a.to_status && <span style={{ color: '#6b7280' }}>{a.from_status} → {a.to_status}</span>}<span style={{ color: '#9ca3af', marginLeft: 'auto' }}>{a.performer_name}</span></div>))}</div></>}
            </div></div>}

            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
    );
}
