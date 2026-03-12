/**
 * PerformaInvoice.tsx — Shipment-based Performa Invoice Module
 *
 * Flow:
 *   1. Enter Shipment Number → PI number is generated
 *   2. Search by Invoice # or PO # → auto-fetch MPL details
 *   3. Verify and Pick MPLs one by one
 *   4. Generate Performa Invoice from picked MPLs
 *   5. Review full PI details
 *   6. Approve → Enter email addresses → Send approval notification → Stock movement FG→Transit
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Search, Truck, CheckCircle2, Package, Plus, Loader2, XCircle, Eye, AlertCircle, RefreshCw, ChevronLeft, ChevronRight, Hash, ArrowRight, Mail, Send, FileText, ShieldCheck, Anchor, Printer, ChevronDown, X, Settings } from 'lucide-react';
import { getSupabaseClient } from '../../utils/supabase/client';
import { fetchMasterPackingLists, createPerformaInvoice, approvePerformaInvoice } from './mplService';
import type { MasterPackingList } from './mplService';
import {
    SummaryCardsGrid, SummaryCard, FilterBar, SearchBox, ActionBar, AddButton,
    sharedThStyle, sharedTdStyle,
} from '../ui/SharedComponents';

type UserRole = 'L1' | 'L2' | 'L3' | null;
interface Props { accessToken?: string; userRole?: UserRole; userPerms?: Record<string, boolean>; onNavigate?: (view: string) => void; }

interface PIRecord { id: string; proforma_number: string; shipment_number: string | null; customer_name: string | null; status: string; total_invoices: number; total_pallets: number; total_quantity: number; stock_movement_id: string | null; stock_moved_at: string | null; created_at: string; created_by_name?: string; }
interface PickedMpl { mpl: MasterPackingList; verified: boolean; }

type PIStep = 'LIST' | 'SHIPMENT' | 'SEARCH_PICK' | 'REVIEW_PI' | 'APPROVE' | 'DETAIL';

export function PerformaInvoice({ userRole, userPerms = {}, onNavigate }: Props) {
    const supabase = getSupabaseClient();
    const canCreate = userRole === 'L3' || userRole === 'L2';
    const canApprove = userRole === 'L3';

    const [step, setStep] = useState<PIStep>('LIST');
    const [pis, setPis] = useState<PIRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // List search & filter
    const [searchTerm, setSearchTerm] = useState('');
    type StatusFilter = 'ALL' | 'DRAFT' | 'CONFIRMED' | 'STOCK_MOVED';
    const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');

    // Toast notification
    const [toast, setToast] = useState<{ type: 'success' | 'error'; title: string; text: string } | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const showToast = useCallback((type: 'success' | 'error', title: string, text: string) => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        setToast({ type, title, text });
        toastTimer.current = setTimeout(() => setToast(null), 5000);
    }, []);

    // Actions dropdown
    const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
    const [dropdownDirection, setDropdownDirection] = useState<'up' | 'down'>('down');
    const dropdownRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (activeDropdown && dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) setActiveDropdown(null);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [activeDropdown]);

    // Stats
    const stats = useMemo(() => ({
        total: pis.length,
        draft: pis.filter(p => p.status === 'DRAFT').length,
        confirmed: pis.filter(p => p.status === 'CONFIRMED').length,
        dispatched: pis.filter(p => p.status === 'STOCK_MOVED').length,
    }), [pis]);

    // Filtered PIs
    const filteredPIs = useMemo(() => {
        let result = pis;
        if (statusFilter !== 'ALL') result = result.filter(p => p.status === statusFilter);
        if (searchTerm.trim()) {
            const s = searchTerm.toLowerCase();
            result = result.filter(p =>
                p.proforma_number.toLowerCase().includes(s) ||
                (p.shipment_number || '').toLowerCase().includes(s) ||
                (p.customer_name || '').toLowerCase().includes(s)
            );
        }
        return result;
    }, [pis, statusFilter, searchTerm]);

    // Create flow
    const [shipmentNumber, setShipmentNumber] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<MasterPackingList[]>([]);
    const [searching, setSearching] = useState(false);
    const [pickedMpls, setPickedMpls] = useState<PickedMpl[]>([]);
    const [creating, setCreating] = useState(false);

    // Approve flow
    const [approveTarget, setApproveTarget] = useState<PIRecord | null>(null);
    const [approvalEmails, setApprovalEmails] = useState('');
    const [approving, setApproving] = useState(false);

    // Detail
    const [selectedPI, setSelectedPI] = useState<PIRecord | null>(null);
    const [piMpls, setPiMpls] = useState<any[]>([]);
    const [detailLoading, setDetailLoading] = useState(false);

    // Load PIs
    const loadPIs = useCallback(async () => {
        setLoading(true);
        try {
            const { data, error: piErr } = await supabase.from('pack_proforma_invoices').select('*, profiles!pack_proforma_invoices_created_by_fkey (full_name)').order('created_at', { ascending: false }).limit(100);
            if (piErr) throw piErr;
            setPis((data || []).map((d: any) => ({ ...d, created_by_name: d.profiles?.full_name || '—' })));
        } catch (err: any) { setError(err.message); } finally { setLoading(false); }
    }, [supabase]);

    useEffect(() => { loadPIs(); }, [loadPIs]);

    // Step 1: Enter shipment number
    const handleStartCreate = () => { setStep('SHIPMENT'); setShipmentNumber(''); setPickedMpls([]); setSearchResults([]); setSearchQuery(''); };

    const handleShipmentSubmit = () => {
        if (!shipmentNumber.trim()) { setError('Shipment number is required'); return; }
        setError(null); setStep('SEARCH_PICK');
    };

    // Step 2: Search by Invoice/PO
    const handleSearch = async () => {
        if (!searchQuery.trim()) return;
        setSearching(true); setError(null);
        try {
            const { data } = await fetchMasterPackingLists({ search: searchQuery.trim(), limit: 50 });
            // Filter: only CONFIRMED/PRINTED, not already picked, not already in a PI
            const alreadyPickedIds = new Set(pickedMpls.map(p => p.mpl.id));
            const eligible = data.filter(m => (m.status === 'CONFIRMED' || m.status === 'PRINTED') && !m.proforma_invoice_id && !alreadyPickedIds.has(m.id));
            setSearchResults(eligible);
            if (eligible.length === 0 && data.length > 0) setError('All matching MPLs are already picked or in another PI');
        } catch (err: any) { setError(err.message); } finally { setSearching(false); }
    };

    // Pick an MPL
    const handlePickMpl = (mpl: MasterPackingList) => {
        setPickedMpls(prev => [...prev, { mpl, verified: false }]);
        setSearchResults(prev => prev.filter(m => m.id !== mpl.id));
        setSearchQuery('');
    };

    const handleVerifyMpl = (mplId: string) => { setPickedMpls(prev => prev.map(p => p.mpl.id === mplId ? { ...p, verified: true } : p)); };
    const handleRemoveMpl = (mplId: string) => { setPickedMpls(prev => prev.filter(p => p.mpl.id !== mplId)); };

    // Step 3: Review & Generate
    const handleGeneratePI = () => {
        if (pickedMpls.length === 0) { setError('Pick at least one MPL'); return; }
        const unverified = pickedMpls.filter(p => !p.verified);
        if (unverified.length > 0) { setError(`Please verify all picked MPLs (${unverified.length} unverified)`); return; }
        setStep('REVIEW_PI');
    };

    const handleCreatePI = async () => {
        setCreating(true); setError(null);
        try {
            const pi = await createPerformaInvoice(pickedMpls.map(p => p.mpl.id), { customer_name: pickedMpls[0]?.mpl.item_name || undefined });
            // Update shipment number on the PI
            await supabase.from('pack_proforma_invoices').update({ shipment_number: shipmentNumber, updated_at: new Date().toISOString() }).eq('id', pi.id);
            setSuccessMsg(`Performa Invoice ${pi.proforma_number} created for shipment ${shipmentNumber}`);
            setStep('LIST'); setPickedMpls([]); await loadPIs();
            setTimeout(() => setSuccessMsg(null), 5000);
        } catch (err: any) { setError(err.message); } finally { setCreating(false); }
    };

    // View detail
    const handleViewDetail = async (pi: PIRecord) => {
        setSelectedPI(pi); setStep('DETAIL'); setDetailLoading(true);
        try {
            const { data, error: err } = await supabase.from('proforma_invoice_mpls').select('*').eq('proforma_id', pi.id).order('line_number');
            if (err) throw err;
            setPiMpls(data || []);
        } catch (err: any) { setError(err.message); } finally { setDetailLoading(false); }
    };

    // Confirm PI
    const handleConfirmPI = async (pi: PIRecord) => {
        try {
            await supabase.from('pack_proforma_invoices').update({ status: 'CONFIRMED', updated_at: new Date().toISOString() }).eq('id', pi.id);
            setSuccessMsg(`${pi.proforma_number} confirmed`); loadPIs(); setTimeout(() => setSuccessMsg(null), 3000);
        } catch (err: any) { setError(err.message); }
    };

    // Step: Approve with emails
    const handleOpenApprove = (pi: PIRecord) => { setApproveTarget(pi); setApprovalEmails(''); setStep('APPROVE'); };

    const handleApproveSubmit = async () => {
        if (!approveTarget) return;
        if (!approvalEmails.trim()) { setError('Please enter at least one email address'); return; }
        setApproving(true); setError(null);
        try {
            // 1. Approve PI & move stock (this is the critical path)
            await approvePerformaInvoice(approveTarget.id);

            // 2. Fetch MPL details for the email template
            const emails = approvalEmails.split(',').map(e => e.trim()).filter(Boolean);
            let mplDetails: any[] = [];
            try {
                const { data: piMplData } = await supabase
                    .from('proforma_invoice_mpls')
                    .select('mpl_number, item_code, invoice_number, po_number, total_pallets, total_quantity')
                    .eq('proforma_id', approveTarget.id)
                    .order('line_number');
                mplDetails = piMplData || [];
            } catch { /* non-blocking */ }

            // 3. Send dispatch email via Edge Function (non-blocking)
            let emailSent = false;
            try {
                const { data: { session } } = await supabase.auth.getSession();
                const res = await fetch(
                    `https://sugvmurszfcneaeyoagv.supabase.co/functions/v1/send-dispatch-email`,
                    {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${session?.access_token || ''}`,
                        },
                        body: JSON.stringify({
                            to: emails,
                            proforma_number: approveTarget.proforma_number,
                            shipment_number: approveTarget.shipment_number || '',
                            total_pallets: approveTarget.total_pallets,
                            total_quantity: approveTarget.total_quantity,
                            total_invoices: approveTarget.total_invoices,
                            mpls: mplDetails.map(m => ({
                                mpl_number: m.mpl_number,
                                item_code: m.item_code,
                                invoice_number: m.invoice_number || '',
                                po_number: m.po_number || '',
                                total_pallets: m.total_pallets || 0,
                                total_quantity: m.total_quantity || 0,
                            })),
                        }),
                    }
                );
                const result = await res.json();
                emailSent = result.success === true;
                if (!emailSent) console.warn('Email send failed:', result.error);
            } catch (emailErr: any) {
                console.warn('Email dispatch failed (non-blocking):', emailErr.message);
            }

            const emailMsg = emailSent
                ? ` — Email sent to ${emails.length} recipient(s)`
                : ` — Email notification pending (check Resend setup)`;
            setSuccessMsg(`${approveTarget.proforma_number} approved — Stock moved to In Transit${emailMsg}`);
            setApproveTarget(null); setStep('LIST'); loadPIs();
            setTimeout(() => setSuccessMsg(null), 6000);
        } catch (err: any) { setError(err.message); } finally { setApproving(false); }
    };

    const totalPickedPallets = pickedMpls.reduce((s, p) => s + p.mpl.total_pallets, 0);
    const totalPickedQty = pickedMpls.reduce((s, p) => s + p.mpl.total_quantity, 0);
    const totalPickedWeight = pickedMpls.reduce((s, p) => s + Number(p.mpl.total_gross_weight_kg || 0), 0);

    // ─── PRINT PI (exact match to enterprise document) ───
    const handlePrintPI = async (pi: PIRecord) => {
        try {
            // Fetch PI MPLs with pallet-level items
            const { data: piMplData } = await supabase.from('proforma_invoice_mpls').select('*').eq('proforma_id', pi.id).order('line_number');
            // Fetch packing list data for first MPL (for header info)
            const mplIds = (piMplData || []).map((m: any) => m.mpl_id);
            const { data: mplFull } = await supabase.from('master_packing_lists').select('*, pack_packing_lists!master_packing_lists_packing_list_id_fkey (packing_list_number)').in('id', mplIds);
            // Fetch pallet details for all MPLs
            const { data: mplPallets } = await supabase.from('master_packing_list_pallets').select('*').in('mpl_id', mplIds).eq('status', 'ACTIVE').order('line_number');
            // Get packing list data for invoice/PO header info
            const plId = mplFull?.[0]?.packing_list_id;
            let plData: any = null;
            if (plId) { const { data: pld } = await supabase.from('pack_packing_list_data').select('*').eq('packing_list_id', plId).single(); plData = pld; }
            // Build item rows from pallet details
            const itemRows: Array<{ po: string; partNo: string; desc: string; qty: number; rate: number; amount: number }> = [];
            for (const p of (mplPallets || [])) {
                const mpl = mplFull?.find((m: any) => m.id === p.mpl_id);
                itemRows.push({ po: mpl?.po_number || '', partNo: p.item_code, desc: p.item_name || p.item_code, qty: p.quantity, rate: 0, amount: 0 });
            }
            const totalAmount = itemRows.reduce((s, r) => s + r.amount, 0);
            const totalQtyAll = itemRows.reduce((s, r) => s + r.qty, 0);
            const piDate = new Date(pi.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
            const invDate = plData?.invoice_date ? new Date(plData.invoice_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : piDate;
            const shipVia = plData?.ship_via || pi.shipment_number || 'SEAHORSE';
            const invNo = plData?.invoice_number || mplFull?.[0]?.invoice_number || '';
            const poNo = plData?.purchase_order_number || mplFull?.[0]?.po_number || '';
            const vendorNo = plData?.vendor_number || '';
            // Number to words (basic)
            const numToWords = (n: number): string => {
                const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
                const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
                if (n === 0) return 'Zero';
                const convert = (num: number): string => {
                    if (num < 20) return ones[num];
                    if (num < 100) return tens[Math.floor(num / 10)] + (num % 10 ? ' ' + ones[num % 10] : '');
                    if (num < 1000) return ones[Math.floor(num / 100)] + ' Hundred' + (num % 100 ? ' ' + convert(num % 100) : '');
                    if (num < 100000) return convert(Math.floor(num / 1000)) + ' Thousand' + (num % 1000 ? ' ' + convert(num % 1000) : '');
                    if (num < 10000000) return convert(Math.floor(num / 100000)) + ' Lakh' + (num % 100000 ? ' ' + convert(num % 100000) : '');
                    return convert(Math.floor(num / 10000000)) + ' Crore' + (num % 10000000 ? ' ' + convert(num % 10000000) : '');
                };
                const intPart = Math.floor(n);
                const decPart = Math.round((n - intPart) * 100);
                let w = 'USD: ' + convert(intPart);
                if (decPart > 0) w += ' and ' + convert(decPart) + ' Cent';
                return w + ' Only';
            };
            // Build rows HTML
            const rowsHtml = itemRows.map((r, i) => `<tr><td class="bc">${i + 1}</td><td class="bl">${r.po}</td><td class="bl">${r.partNo}</td><td class="bl">${r.desc}</td><td class="br">${r.qty.toLocaleString()}</td><td class="br">${r.rate > 0 ? r.rate.toFixed(2) : ''}</td><td class="br">${r.amount > 0 ? r.amount.toFixed(2) : ''}</td></tr>`).join('');
            const w = window.open('', '_blank', 'width=900,height=1100');
            if (!w) { alert('Please allow popups'); return; }
            w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Proforma Invoice ${pi.proforma_number}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{font-family:Arial,Helvetica,sans-serif;font-size:11px;color:#000;padding:15px}
  table{width:100%;border-collapse:collapse}
  .bdr{border:1px solid #000}
  .bdr td,.bdr th{border:1px solid #000;padding:4px 6px;vertical-align:top}
  .bc{text-align:center}.bl{text-align:left}.br{text-align:right}
  .fw7{font-weight:700}.f9{font-size:9px}.f10{font-size:10px}.f11{font-size:11px}.f12{font-size:12px}.f14{font-size:14px}.f16{font-size:16px}
  .hdr-tbl td{border:1px solid #000;padding:5px 8px;vertical-align:top}
  .items-tbl th{border:1px solid #000;padding:5px 6px;font-size:10px;font-weight:700;background:#f0f0f0;text-align:center}
  .items-tbl td{border:1px solid #000;padding:3px 6px;font-size:10px}
  .total-row{font-weight:700;background:#f9f9f9}
  @media print{body{padding:0}button{display:none!important}.no-print{display:none!important}}
</style></head><body>
<!-- HEADER -->
<table class="bdr" style="margin-bottom:0">
  <tr>
    <td rowspan="3" style="width:50%;border-bottom:none">
      <div style="font-size:16px;font-weight:800;color:#1e3a8a;margin-bottom:2px">AUTOCRAT ENGINEERS</div>
      <div class="f9"># 21 & 22, Export Promotion Industrial Park,</div>
      <div class="f9">Phase I, Whitefield, Bangalore-560066</div>
      <div class="f9">E mail : dispatch@autocratengineers.in</div>
      <div class="f9" style="margin-top:2px">GSTIN : 29AABPK6831H1ZB</div>
    </td>
    <td colspan="2" style="text-align:center;font-size:18px;font-weight:800;border-bottom:1px solid #000">PROFORMA INVOICE</td>
  </tr>
  <tr>
    <td class="f10"><b>Proforma Invoice No. & Date</b><br/>${pi.proforma_number} &nbsp; DATE: ${piDate}</td>
    <td class="f10"><b>Exporter's Ref</b><br/>-NIL-</td>
  </tr>
  <tr>
    <td colspan="2" class="f10"><b>Ship Via Consignees :</b>${shipVia}</td>
  </tr>
</table>

<!-- CONSIGNEE + BUYER -->
<table class="bdr" style="border-top:none">
  <tr>
    <td style="width:50%;vertical-align:top;padding:6px 8px">
      <div class="f9 fw7" style="margin-bottom:2px">Consignee</div>
      <div class="f10 fw7">OPW Fueling Components, LLC</div>
      <div class="f9">Milano Millerworks, LLC of 5223</div>
      <div class="f9">Industrial Blvd NE,</div>
      <div class="f9">Leland NC 28451</div>
      <div class="f9">USA</div>
    </td>
    <td style="vertical-align:top;padding:6px 8px">
      <div class="f9"><b>Buyer :</b> Passler, David</div>
      <div class="f9"><b>Phone :</b> 919-271-7169</div>
      <div class="f9"><b>E-Mail :</b> david.passler@opwglobal.com</div>
      <div class="f9" style="margin-top:4px"><b>Bill to :</b></div>
      <div class="f10 fw7">OPW FUELING COMPONENTS LLC</div>
      <div class="f9">6265 US Highway 70, SMITHFIELD, 27577, USA</div>
    </td>
  </tr>
</table>

<!-- SHIPPING INFO -->
<table class="bdr" style="border-top:none">
  <tr>
    <td class="f9"><b>Pre-Carriage by</b></td>
    <td class="f9"><b>Place of Receipt of Pre-Carrier:</b><br/>BANGALORE</td>
    <td class="f9"><b>Country of Origin of Goods</b><br/>INDIA</td>
    <td class="f9"><b>Country of Final Destination</b><br/>UNITED STATES</td>
  </tr>
  <tr>
    <td class="f9"><b>Vessel/Flight No.</b></td>
    <td class="f9"><b>Port of Loading</b><br/>CHENNAI</td>
    <td class="f9"><b>Terms of Delivery & Payment</b><br/>Net-30</td>
    <td class="f9">Days from the date of Invoice</td>
  </tr>
  <tr>
    <td class="f9"><b>Port of Discharge</b><br/>CHARLETON</td>
    <td class="f9"><b>Final Destination</b><br/>UNITED STATES</td>
    <td class="f9"><b>Mode of Transport</b><br/>Sea</td>
    <td class="f9"><b>IEC Code No :</b><br/>07020032747<br/><b>AD Code No:</b><br/>8361504-8400009</td>
  </tr>
</table>

<!-- DESCRIPTION HEADER -->
<table class="bdr" style="border-top:none">
  <tr><td colspan="7" style="text-align:center;font-weight:700;font-size:11px;padding:4px">PRECISION MACHINED COMPONENTS<br/>(OTHERS FUELING COMPONENTS)</td></tr>
</table>

<!-- ITEMS TABLE -->
<table class="items-tbl bdr" style="border-top:none">
  <thead><tr><th style="width:5%">SL NO</th><th style="width:12%">PO#</th><th style="width:10%">Part No</th><th>Description of Goods</th><th style="width:10%">Quantity<br/>in Nos</th><th style="width:8%">Rate<br/>USD</th><th style="width:10%">Amount<br/>USD</th></tr></thead>
  <tbody>${rowsHtml}
    <tr class="total-row"><td colspan="4"></td><td class="br">${totalQtyAll.toLocaleString()}</td><td></td><td class="br">${totalAmount > 0 ? totalAmount.toFixed(2) : ''}</td></tr>
  </tbody>
</table>

<!-- TOTAL IN WORDS -->
<table class="bdr" style="border-top:none">
  <tr><td class="f10 fw7" style="padding:6px 8px">${numToWords(totalAmount)}</td><td class="br f12 fw7" style="width:18%;padding:6px 8px">${totalAmount > 0 ? totalAmount.toFixed(2) : ''}</td></tr>
</table>

<!-- CODES -->
<table class="bdr" style="border-top:none">
  <tr><td class="f9" style="padding:4px 8px"><b>ITC HS CODE :</b> 84139190</td></tr>
  <tr><td class="f9" style="padding:4px 8px"><b>OKR CODE :</b> 8413B</td></tr>
</table>

<!-- NOTES + DECLARATION -->
<table class="bdr" style="border-top:none">
  <tr>
    <td style="width:60%;vertical-align:top;padding:6px 8px">
      <div class="f9 fw7" style="margin-bottom:4px">Note:</div>
      <div class="f9">1.NON - TAXABLE</div>
      <div class="f9">2.BANK A/C No:912030016364407</div>
      <div class="f9">3.REMIT TO: AXIS BANK LTD, BANGALORE, 560 001.</div>
      <div class="f9">KARNATAKA, INDIA</div>
      <div style="margin-top:10px">
        <div class="f9 fw7">Declaration:</div>
        <div class="f9">We declare that this invoice shows the actual price</div>
        <div class="f9">of the goods described and that all particulars are true and correct.</div>
      </div>
    </td>
    <td style="vertical-align:top;text-align:center;padding:10px 8px">
      <div style="font-size:14px;font-weight:800;color:#1e3a8a;margin-bottom:4px">AUTOCRAT ENGINEERS</div>
      <div style="height:50px"></div>
      <div style="border-top:1px solid #000;padding-top:4px;font-size:10px;font-weight:700">AUTHORISED SIGNATORY</div>
    </td>
  </tr>
</table>

<div style="margin-top:16px;text-align:center" class="no-print">
  <button onclick="window.print()" style="padding:10px 32px;font-size:14px;font-weight:700;background:#1e3a8a;color:#fff;border:none;border-radius:8px;cursor:pointer">Print</button>
</div>
</body></html>`);
            w.document.close();
        } catch (err: any) { setError(err.message); }
    };

    const StatusBadge = ({ status }: { status: string }) => {
        const styles: Record<string, { bg: string; color: string; label: string }> = { DRAFT: { bg: '#fef3c7', color: '#92400e', label: 'DRAFT' }, CONFIRMED: { bg: '#dbeafe', color: '#1d4ed8', label: 'CONFIRMED' }, STOCK_MOVED: { bg: '#d1fae5', color: '#059669', label: 'DISPATCHED' }, CANCELLED: { bg: '#fee2e2', color: '#dc2626', label: 'CANCELLED' } };
        const s = styles[status] || styles.DRAFT;
        return <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, backgroundColor: s.bg, color: s.color }}>{s.label}</span>;
    };

    const th = sharedThStyle;
    const td = sharedTdStyle;

    if (loading && step === 'LIST') return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 24px', gap: 16 }}>
            <Loader2 size={32} style={{ color: 'var(--enterprise-primary)', animation: 'spin 0.8s linear infinite' }} />
            <p style={{ color: 'var(--enterprise-gray-600)', fontWeight: 500 }}>Loading Performa Invoices…</p>
        </div>
    );

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            {/* ═══ FLOATING TOAST ═══ */}
            {toast && (
                <div style={{
                    position: 'fixed', top: 24, right: 24, zIndex: 10000, minWidth: 360, maxWidth: 440,
                    padding: '16px 20px', borderRadius: 14,
                    background: toast.type === 'success' ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)' : 'linear-gradient(135deg, #fef2f2, #fee2e2)',
                    border: `1.5px solid ${toast.type === 'success' ? '#86efac' : '#fca5a5'}`,
                    boxShadow: '0 10px 40px rgba(0,0,0,0.12)', display: 'flex', alignItems: 'flex-start', gap: 12,
                }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, flexShrink: 0, background: toast.type === 'success' ? 'linear-gradient(135deg, #16a34a, #15803d)' : 'linear-gradient(135deg, #dc2626, #b91c1c)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        {toast.type === 'success' ? <CheckCircle2 size={18} style={{ color: '#fff' }} /> : <XCircle size={18} style={{ color: '#fff' }} />}
                    </div>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 800, color: toast.type === 'success' ? '#14532d' : '#7f1d1d', marginBottom: 2 }}>{toast.title}</div>
                        <div style={{ fontSize: 12, fontWeight: 500, color: toast.type === 'success' ? '#166534' : '#991b1b' }}>{toast.text}</div>
                    </div>
                    <button onClick={() => { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 4, color: toast.type === 'success' ? '#16a34a' : '#dc2626' }}><X size={16} /></button>
                </div>
            )}

            {error && <div style={{ padding: '12px 16px', borderRadius: 'var(--border-radius-md)', backgroundColor: 'var(--enterprise-error-bg, #fee2e2)', border: '1px solid var(--enterprise-error, #dc2626)', color: 'var(--enterprise-error, #dc2626)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}><AlertCircle size={16} /> {error}<button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}><XCircle size={16} /></button></div>}

            {/* Back button for non-LIST steps */}
            {step !== 'LIST' && (
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={() => setStep('LIST')} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #d1d5db', backgroundColor: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s ease' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.backgroundColor = '#fff'}><ChevronLeft size={16} /> Back to List</button>
                </div>
            )}

            {/* ═══ SUMMARY CARDS ═══ */}
            {step === 'LIST' && (
                <>
                    <SummaryCardsGrid>
                        <SummaryCard label="Total Invoices" value={stats.total} icon={<FileText size={22} style={{ color: 'var(--enterprise-primary)' }} />} color="var(--enterprise-primary)" bgColor="rgba(30,58,138,0.1)" isActive={statusFilter === 'ALL'} onClick={() => setStatusFilter('ALL')} />
                        <SummaryCard label="Draft" value={stats.draft} icon={<Hash size={22} style={{ color: '#d97706' }} />} color="#d97706" bgColor="rgba(217,119,6,0.1)" isActive={statusFilter === 'DRAFT'} onClick={() => setStatusFilter(statusFilter === 'DRAFT' ? 'ALL' : 'DRAFT')} />
                        <SummaryCard label="Confirmed" value={stats.confirmed} icon={<CheckCircle2 size={22} style={{ color: '#1d4ed8' }} />} color="#1d4ed8" bgColor="rgba(29,78,216,0.1)" isActive={statusFilter === 'CONFIRMED'} onClick={() => setStatusFilter(statusFilter === 'CONFIRMED' ? 'ALL' : 'CONFIRMED')} />
                        <SummaryCard label="Dispatched" value={stats.dispatched} icon={<Truck size={22} style={{ color: '#059669' }} />} color="#059669" bgColor="rgba(5,150,105,0.1)" isActive={statusFilter === 'STOCK_MOVED'} onClick={() => setStatusFilter(statusFilter === 'STOCK_MOVED' ? 'ALL' : 'STOCK_MOVED')} />
                    </SummaryCardsGrid>

                    {/* ═══ FILTER BAR ═══ */}
                    <FilterBar>
                        <SearchBox value={searchTerm} onChange={setSearchTerm} placeholder="Search by PI number, shipment, customer…" />
                        <ActionBar>
                            {step === 'LIST' && canCreate && <AddButton label="New PI" onClick={handleStartCreate} />}
                        </ActionBar>
                    </FilterBar>

                    {/* ═══ TABLE ═══ */}
                    <div style={{ backgroundColor: 'var(--card-background, #fff)', borderRadius: 'var(--border-radius-lg, 12px)', border: '1px solid var(--border-color, #e5e7eb)', overflow: 'hidden', boxShadow: 'var(--shadow-sm)' }}>
                        {filteredPIs.length === 0 ? (
                            <div style={{ padding: '60px 24px', textAlign: 'center' }}>
                                <FileText size={48} style={{ color: 'var(--enterprise-gray-300)', marginBottom: 12 }} />
                                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--enterprise-gray-600)', marginBottom: 4 }}>{searchTerm || statusFilter !== 'ALL' ? 'No Matching Invoices' : 'No Performa Invoices'}</h3>
                                <p style={{ fontSize: 13, color: 'var(--enterprise-gray-500)' }}>{searchTerm || statusFilter !== 'ALL' ? 'Try adjusting your search or filter' : 'Create your first Performa Invoice to get started'}</p>
                            </div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead>
                                        <tr style={{ backgroundColor: 'var(--table-header-bg, #f9fafb)', borderBottom: '2px solid var(--table-border, #e5e7eb)' }}>
                                            <th style={th}>PI Number</th>
                                            <th style={th}>Shipment #</th>
                                            <th style={{ ...th, textAlign: 'center' }}>MPLs</th>
                                            <th style={{ ...th, textAlign: 'center' }}>Pallets</th>
                                            <th style={{ ...th, textAlign: 'right' }}>Quantity</th>
                                            <th style={{ ...th, textAlign: 'center' }}>Status</th>
                                            <th style={th}>Created</th>
                                            <th style={{ ...th, textAlign: 'center' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>{filteredPIs.map((pi, idx) => (
                                        <tr key={pi.id}
                                            style={{ backgroundColor: idx % 2 === 0 ? 'white' : 'var(--table-stripe, #fafbfc)', borderBottom: '1px solid var(--table-border, #f3f4f6)', transition: 'background-color var(--transition-fast, 150ms)', cursor: 'pointer' }}
                                            onClick={() => handleViewDetail(pi)}
                                            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--table-hover, #eff6ff)'}
                                            onMouseLeave={e => e.currentTarget.style.backgroundColor = idx % 2 === 0 ? 'white' : 'var(--table-stripe, #fafbfc)'}
                                        >
                                            <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600, color: 'var(--enterprise-primary)' }}>{pi.proforma_number}</td>
                                            <td style={{ ...td, fontWeight: 600, color: 'var(--enterprise-gray-700)' }}>{pi.shipment_number || <span style={{ color: 'var(--enterprise-gray-300)' }}>—</span>}</td>
                                            <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{pi.total_invoices}</td>
                                            <td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{pi.total_pallets}</td>
                                            <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{pi.total_quantity.toLocaleString()}</td>
                                            <td style={{ ...td, textAlign: 'center' }}><StatusBadge status={pi.status} /></td>
                                            <td style={{ ...td, fontSize: 12, color: 'var(--enterprise-gray-600)', whiteSpace: 'nowrap' }}>{new Date(pi.created_at).toLocaleDateString()}</td>
                                            {/* Actions dropdown */}
                                            <td style={{ ...td, textAlign: 'center', padding: '8px 12px', position: 'relative' }} onClick={e => e.stopPropagation()}>
                                                <div ref={activeDropdown === pi.id ? dropdownRef : null} style={{ display: 'inline-flex', alignItems: 'center', gap: 0, position: 'relative' }}>
                                                    <button onClick={() => handleViewDetail(pi)} style={{ height: 34, minWidth: 80, padding: '0 14px', borderRadius: '8px 0 0 8px', border: '1px solid #e5e7eb', borderRight: 'none', backgroundColor: 'white', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#374151', transition: 'all 0.15s ease', whiteSpace: 'nowrap' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}>
                                                        <Eye size={15} /> View
                                                    </button>
                                                    <button onClick={(e) => { e.stopPropagation(); if (activeDropdown === pi.id) { setActiveDropdown(null); } else { const rect = e.currentTarget.getBoundingClientRect(); setDropdownDirection(window.innerHeight - rect.bottom < 200 ? 'up' : 'down'); setActiveDropdown(pi.id); } }} style={{ height: 34, padding: '0 8px', border: '1px solid #e5e7eb', borderRadius: '0 8px 8px 0', backgroundColor: 'white', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', color: '#374151', transition: 'all 0.15s ease' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}>
                                                        <ChevronDown size={14} style={{ transition: 'transform 0.2s', transform: activeDropdown === pi.id ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                                                    </button>
                                                    {activeDropdown === pi.id && (
                                                        <div style={{ position: 'absolute', ...(dropdownDirection === 'up' ? { bottom: '100%', marginBottom: 4 } : { top: '100%', marginTop: 4 }), right: 0, zIndex: 9999, width: 200, backgroundColor: 'white', borderRadius: 12, boxShadow: '0 10px 40px rgba(0,0,0,0.15)', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                                                            <button onClick={() => { handlePrintPI(pi); setActiveDropdown(null); }} style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, textAlign: 'left', color: '#059669' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0fdf4'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                                <Printer size={16} /> Print
                                                            </button>
                                                            {pi.status === 'DRAFT' && canCreate && (<><div style={{ borderTop: '1px solid #f3f4f6' }} /><button onClick={() => { handleConfirmPI(pi); setActiveDropdown(null); }} style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, textAlign: 'left', color: '#1e3a8a' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#eff6ff'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                                <CheckCircle2 size={16} /> Confirm
                                                            </button></>)}
                                                            {pi.status === 'CONFIRMED' && canApprove && (<><div style={{ borderTop: '1px solid #f3f4f6' }} /><button onClick={() => { handleOpenApprove(pi); setActiveDropdown(null); }} style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, textAlign: 'left', color: '#059669' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0fdf4'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                                <ShieldCheck size={16} /> Approve & Dispatch
                                                            </button></>)}
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}</tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </>
            )}

            {/* ═══ STEP 1: SHIPMENT NUMBER ═══ */}
            {step === 'SHIPMENT' && (
                <div style={{ backgroundColor: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 32, maxWidth: 500, margin: '0 auto', textAlign: 'center' }}>
                    <div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg, #dbeafe, #ede9fe)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}><Anchor size={32} style={{ color: '#1e3a8a' }} /></div>
                    <h3 style={{ fontSize: 18, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Enter Shipment Number</h3>
                    <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 20 }}>A Performa Invoice number will be generated automatically after you pick MPLs.</p>
                    <input value={shipmentNumber} onChange={e => setShipmentNumber(e.target.value)} placeholder="e.g. SHIP-2026-001" style={{ width: '100%', padding: '12px 16px', border: '2px solid #d1d5db', borderRadius: 10, fontSize: 16, fontFamily: 'monospace', fontWeight: 700, textAlign: 'center', outline: 'none', boxSizing: 'border-box', marginBottom: 20 }} onFocus={e => e.target.style.borderColor = '#3b82f6'} onBlur={e => e.target.style.borderColor = '#d1d5db'} onKeyDown={e => { if (e.key === 'Enter') handleShipmentSubmit(); }} />
                    <button onClick={handleShipmentSubmit} disabled={!shipmentNumber.trim()} style={{ padding: '12px 32px', borderRadius: 8, border: 'none', background: shipmentNumber.trim() ? '#1e3a8a' : '#9ca3af', color: '#fff', fontWeight: 700, fontSize: 15, cursor: shipmentNumber.trim() ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center', gap: 8 }}>Continue <ArrowRight size={16} /></button>
                </div>
            )}

            {/* ═══ STEP 2: SEARCH & PICK ═══ */}
            {step === 'SEARCH_PICK' && (
                <div style={{ backgroundColor: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                        <div><h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>Shipment: <span style={{ color: '#1e3a8a', fontFamily: 'monospace' }}>{shipmentNumber}</span></h3><p style={{ margin: '4px 0 0', fontSize: 13, color: '#6b7280' }}>Search by Invoice # or PO # to find and pick MPLs</p></div>
                        {pickedMpls.length > 0 && <button onClick={handleGeneratePI} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}><CheckCircle2 size={16} /> Generate PI ({pickedMpls.length} MPLs)</button>}
                    </div>

                    {/* Search bar */}
                    <div style={{ display: 'flex', gap: 8, marginBottom: 20 }}>
                        <div style={{ position: 'relative', flex: 1 }}><Search size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} /><input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }} placeholder="Enter Invoice # or PO # and press Enter..." style={{ width: '100%', padding: '10px 12px 10px 36px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, outline: 'none', boxSizing: 'border-box' }} /></div>
                        <button onClick={handleSearch} disabled={searching || !searchQuery.trim()} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: '#1e3a8a', color: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', whiteSpace: 'nowrap' }}>{searching ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <><Search size={14} /> Search</>}</button>
                    </div>

                    {/* Search Results */}
                    {searchResults.length > 0 && (
                        <div style={{ marginBottom: 24 }}>
                            <h4 style={{ fontSize: 13, fontWeight: 700, color: '#374151', marginBottom: 8, textTransform: 'uppercase' }}>Search Results ({searchResults.length})</h4>
                            {searchResults.map(mpl => (
                                <div key={mpl.id} style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid #e5e7eb', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 150ms' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0f9ff'} onMouseLeave={e => e.currentTarget.style.backgroundColor = '#fff'}>
                                    <div><div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e3a8a', fontSize: 14 }}>{mpl.mpl_number}</div><div style={{ fontSize: 12, color: '#6b7280' }}>{mpl.item_code} · Inv: {mpl.invoice_number || '—'} · PO: {mpl.po_number || '—'} · {mpl.total_pallets} pallets · {mpl.total_quantity.toLocaleString()} pcs</div></div>
                                    <button onClick={() => handlePickMpl(mpl)} style={{ padding: '6px 16px', borderRadius: 6, border: 'none', backgroundColor: '#1e3a8a', color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><Plus size={14} /> Pick</button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Picked MPLs */}
                    {pickedMpls.length > 0 && (
                        <div>
                            <h4 style={{ fontSize: 13, fontWeight: 700, color: '#059669', marginBottom: 8, textTransform: 'uppercase' }}>Picked MPLs ({pickedMpls.length}) — Total: {totalPickedPallets} pallets, {totalPickedQty.toLocaleString()} pcs, {totalPickedWeight.toFixed(2)} Kg</h4>
                            {pickedMpls.map(({ mpl, verified }) => (
                                <div key={mpl.id} style={{ padding: '12px 16px', borderRadius: 8, border: `1px solid ${verified ? '#86efac' : '#fbbf24'}`, backgroundColor: verified ? '#f0fdf4' : '#fffbee', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        {verified ? <CheckCircle2 size={20} style={{ color: '#16a34a' }} /> : <AlertCircle size={20} style={{ color: '#f59e0b' }} />}
                                        <div><div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e3a8a', fontSize: 14 }}>{mpl.mpl_number}</div><div style={{ fontSize: 12, color: '#6b7280' }}>{mpl.item_code} · Inv: {mpl.invoice_number || '—'} · PO: {mpl.po_number || '—'} · {mpl.total_pallets} plt · {mpl.total_quantity.toLocaleString()} pcs</div></div>
                                    </div>
                                    <div style={{ display: 'flex', gap: 6 }}>
                                        {!verified && <button onClick={() => handleVerifyMpl(mpl.id)} style={{ padding: '6px 14px', borderRadius: 6, border: 'none', backgroundColor: '#16a34a', color: '#fff', fontWeight: 600, fontSize: 12, cursor: 'pointer' }}>✓ Verify</button>}
                                        <button onClick={() => handleRemoveMpl(mpl.id)} style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #fecaca', backgroundColor: '#fff', cursor: 'pointer' }}><XCircle size={14} style={{ color: '#dc2626' }} /></button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ═══ STEP 3: REVIEW PI ═══ */}
            {step === 'REVIEW_PI' && (
                <div style={{ backgroundColor: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 24 }}>
                    <h3 style={{ margin: '0 0 16px', fontSize: 16, fontWeight: 700, color: '#111827' }}>Performa Invoice Review — Shipment: <span style={{ color: '#1e3a8a', fontFamily: 'monospace' }}>{shipmentNumber}</span></h3>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 20 }}>
                        {[{ label: 'MPLs', value: pickedMpls.length, color: '#1e3a8a' }, { label: 'Pallets', value: totalPickedPallets, color: '#059669' }, { label: 'Quantity', value: totalPickedQty.toLocaleString() + ' PCS', color: '#7c3aed' }, { label: 'Gross Wt', value: totalPickedWeight.toFixed(2) + ' Kg', color: '#d97706' }].map((c, i) => (
                            <div key={i} style={{ padding: 14, borderRadius: 10, background: '#f8fafc', border: '1px solid #e5e7eb' }}><div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>{c.label}</div><div style={{ fontSize: 18, fontWeight: 800, color: c.color, fontFamily: 'monospace' }}>{c.value}</div></div>
                        ))}
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
                        <thead><tr style={{ background: '#f9fafb' }}><th style={th}>#</th><th style={th}>MPL #</th><th style={th}>Item Code</th><th style={th}>Invoice #</th><th style={th}>PO #</th><th style={{ ...th, textAlign: 'center' }}>Pallets</th><th style={{ ...th, textAlign: 'right' }}>Qty</th><th style={{ ...th, textAlign: 'right' }}>Gross Wt</th></tr></thead>
                        <tbody>{pickedMpls.map(({ mpl }, idx) => (
                            <tr key={mpl.id} style={{ borderBottom: '1px solid #f3f4f6' }}><td style={{ ...td, textAlign: 'center', color: '#9ca3af' }}>{idx + 1}</td><td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#1e3a8a' }}>{mpl.mpl_number}</td><td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{mpl.item_code}</td><td style={td}>{mpl.invoice_number || '—'}</td><td style={td}>{mpl.po_number || '—'}</td><td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{mpl.total_pallets}</td><td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{mpl.total_quantity.toLocaleString()}</td><td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{Number(mpl.total_gross_weight_kg || 0).toFixed(2)}</td></tr>
                        ))}</tbody>
                    </table>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <button onClick={() => setStep('SEARCH_PICK')} style={{ padding: '10px 24px', borderRadius: 8, background: 'white', color: '#374151', border: '1px solid #d1d5db', fontWeight: 600, fontSize: 14, cursor: 'pointer' }}><ChevronLeft size={16} /> Back</button>
                        <button onClick={handleCreatePI} disabled={creating} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: creating ? '#9ca3af' : '#059669', color: '#fff', fontWeight: 700, fontSize: 14, cursor: creating ? 'wait' : 'pointer' }}>{creating ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Creating...</> : <><CheckCircle2 size={16} /> Create Performa Invoice</>}</button>
                    </div>
                </div>
            )}

            {/* ═══ APPROVE with Emails ═══ */}
            {step === 'APPROVE' && approveTarget && (
                <div style={{ backgroundColor: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 32, maxWidth: 550, margin: '0 auto' }}>
                    <div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg, #d1fae5, #dbeafe)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}><ShieldCheck size={32} style={{ color: '#059669' }} /></div>
                    <h3 style={{ fontSize: 18, fontWeight: 700, color: '#111827', textAlign: 'center', marginBottom: 4 }}>Approve & Dispatch</h3>
                    <p style={{ fontSize: 14, color: '#1e3a8a', fontFamily: 'monospace', fontWeight: 700, textAlign: 'center', marginBottom: 4 }}>{approveTarget.proforma_number}</p>
                    <p style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', marginBottom: 20 }}>This will move stock from FG Warehouse to In Transit and send approval emails.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginBottom: 20 }}>
                        <div style={{ padding: 10, borderRadius: 8, background: '#f8fafc', border: '1px solid #e5e7eb', textAlign: 'center' }}><div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280' }}>SHIPMENT</div><div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{approveTarget.shipment_number || '—'}</div></div>
                        <div style={{ padding: 10, borderRadius: 8, background: '#f8fafc', border: '1px solid #e5e7eb', textAlign: 'center' }}><div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280' }}>PALLETS</div><div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{approveTarget.total_pallets}</div></div>
                        <div style={{ padding: 10, borderRadius: 8, background: '#f8fafc', border: '1px solid #e5e7eb', textAlign: 'center' }}><div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280' }}>QUANTITY</div><div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{approveTarget.total_quantity.toLocaleString()}</div></div>
                    </div>
                    <div style={{ marginBottom: 20 }}>
                        <label style={{ fontSize: 13, fontWeight: 600, color: '#374151', display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}><Mail size={14} /> Email Addresses *</label>
                        <textarea value={approvalEmails} onChange={e => setApprovalEmails(e.target.value)} placeholder="Enter email addresses separated by commas&#10;e.g. manager@company.com, logistics@company.com" rows={3} style={{ width: '100%', padding: 12, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 14, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} />
                        <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Separate multiple emails with commas</p>
                    </div>
                    <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
                        <button onClick={() => { setApproveTarget(null); setStep('LIST'); }} style={{ padding: '10px 24px', borderRadius: 8, border: '1px solid #d1d5db', backgroundColor: '#fff', cursor: 'pointer', fontWeight: 500, fontSize: 14 }}>Cancel</button>
                        <button onClick={handleApproveSubmit} disabled={approving || !approvalEmails.trim()} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: (approving || !approvalEmails.trim()) ? '#9ca3af' : '#059669', color: '#fff', fontWeight: 700, fontSize: 14, cursor: approving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>{approving ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Approving...</> : <><Send size={16} /> Approve & Send</>}</button>
                    </div>
                </div>
            )}

            {/* ═══ DETAIL ═══ */}
            {step === 'DETAIL' && selectedPI && (
                <div style={{ backgroundColor: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                        <div><h3 style={{ margin: '0 0 6px', fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: '#111827' }}>{selectedPI.proforma_number}</h3><StatusBadge status={selectedPI.status} /></div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <button onClick={() => handlePrintPI(selectedPI)} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}><Printer size={14} /> Print</button>
                            {selectedPI.status === 'DRAFT' && canCreate && <button onClick={() => handleConfirmPI(selectedPI)} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#1e3a8a', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Confirm</button>}
                            {selectedPI.status === 'CONFIRMED' && canApprove && <button onClick={() => handleOpenApprove(selectedPI)} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#059669', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Approve & Dispatch</button>}
                        </div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12, padding: 16, backgroundColor: '#f9fafb', borderRadius: 10, marginBottom: 20, fontSize: 13 }}>
                        <div><span style={{ color: '#6b7280' }}>Shipment:</span> <strong>{selectedPI.shipment_number || '—'}</strong></div>
                        <div><span style={{ color: '#6b7280' }}>MPLs:</span> <strong>{selectedPI.total_invoices}</strong></div>
                        <div><span style={{ color: '#6b7280' }}>Pallets:</span> <strong>{selectedPI.total_pallets}</strong></div>
                        <div><span style={{ color: '#6b7280' }}>Qty:</span> <strong>{selectedPI.total_quantity.toLocaleString()}</strong></div>
                    </div>
                    {selectedPI.status === 'STOCK_MOVED' && <div style={{ padding: '12px 16px', borderRadius: 8, marginBottom: 16, backgroundColor: '#d1fae5', color: '#065f46', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}><Truck size={16} />Stock dispatched — moved to In Transit at {selectedPI.stock_moved_at ? new Date(selectedPI.stock_moved_at).toLocaleString() : '—'}</div>}
                    <h4 style={{ fontSize: 14, fontWeight: 700, color: '#111827', marginBottom: 10 }}>Master Packing Lists</h4>
                    {detailLoading ? <div style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>Loading...</div> :
                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead><tr style={{ background: '#f9fafb' }}><th style={th}>#</th><th style={th}>MPL #</th><th style={th}>Item</th><th style={th}>Invoice</th><th style={th}>PO</th><th style={{ ...th, textAlign: 'center' }}>Pallets</th><th style={{ ...th, textAlign: 'right' }}>Qty</th><th style={{ ...th, textAlign: 'right' }}>Gross Wt</th></tr></thead>
                            <tbody>{piMpls.map((m: any) => (
                                <tr key={m.id} style={{ borderBottom: '1px solid #f3f4f6' }}><td style={{ ...td, textAlign: 'center', color: '#9ca3af' }}>{m.line_number}</td><td style={{ ...td, fontFamily: 'monospace', fontWeight: 700, color: '#1e3a8a' }}>{m.mpl_number}</td><td style={{ ...td, fontFamily: 'monospace', fontSize: 12 }}>{m.item_code}</td><td style={td}>{m.invoice_number || '—'}</td><td style={td}>{m.po_number || '—'}</td><td style={{ ...td, textAlign: 'center', fontWeight: 600 }}>{m.total_pallets}</td><td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{m.total_quantity.toLocaleString()}</td><td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{Number(m.total_gross_weight_kg || 0).toFixed(2)}</td></tr>
                            ))}</tbody>
                        </table>}
                </div>
            )}
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
    );
}
