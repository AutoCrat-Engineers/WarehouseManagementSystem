/**
 * PackingListPrint — Enterprise Multi-Step Packing List Wizard
 *
 * Step 1: REVIEW  — Item details, packing specs, pallet + container breakdown
 * Step 2: WEIGHTS — Per-pallet gross weight capture
 * Step 3: DISPATCH — Invoice # (SAP), Invoice Date, PO # (SAP), PO Date, Ship Via
 * Step 4: GENERATE — Master PL generation + two prints (Master PL + Packing Ref Sheet)
 *
 * Invoice/PO are external SAP documents — WMS only captures reference numbers.
 * Header data (exporter, consignee, etc.) comes from pack_packing_list_data defaults.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
    FileText, Save, Printer, RefreshCw, ChevronRight, ChevronLeft,
    Loader2, CheckCircle2, Package, Edit3, Truck, Eye, Layers,
    AlertTriangle, X, Box, ClipboardList, Weight, Hash,
} from 'lucide-react';
import { Card, Modal, EmptyState, ModuleLoader } from '../ui/EnterpriseUI';
import {
    SummaryCard, SummaryCardsGrid, SearchBox, FilterBar, ActionBar, RefreshButton,
} from '../ui/SharedComponents';
import * as svc from './packingEngineService';
import type { PackingList, PackingListData, PackingListPalletDetail, PackingSpec } from './packingEngineService';
import { getSupabaseClient } from '../../utils/supabase/client';

type UserRole = 'L1' | 'L2' | 'L3' | null;
interface Props { accessToken: string; userRole?: UserRole; userPerms?: Record<string, boolean>; }

// Styles
const lbl: React.CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 4 };
const inp: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 13, outline: 'none' };
const secHdr: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: '#1e3a8a', marginBottom: 10, marginTop: 16, textTransform: 'uppercase' as const, letterSpacing: '0.5px', borderBottom: '2px solid #e5e7eb', paddingBottom: 6 };
const thS: React.CSSProperties = { padding: '8px 12px', textAlign: 'left' as const, fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase' as const, letterSpacing: '0.5px', borderBottom: '2px solid #e5e7eb', background: '#f9fafb' };
const tdS: React.CSSProperties = { padding: '8px 12px', fontSize: 13, color: '#111827', borderBottom: '1px solid #f3f4f6' };
const STATUS_COLORS: Record<string, { color: string; bg: string }> = {
    DRAFT: { color: '#d97706', bg: '#fffbeb' }, CONFIRMED: { color: '#16a34a', bg: '#f0fdf4' },
    INVOICED: { color: '#2563eb', bg: '#eff6ff' }, CANCELLED: { color: '#dc2626', bg: '#fef2f2' },
};

type WizardStep = 'SELECT' | 'REVIEW' | 'WEIGHTS' | 'DISPATCH' | 'GENERATE';
const STEPS: { key: WizardStep; label: string; icon: React.ElementType }[] = [
    { key: 'SELECT', label: 'Select PL', icon: FileText },
    { key: 'REVIEW', label: 'Review Details', icon: Eye },
    { key: 'WEIGHTS', label: 'Gross Weights', icon: Package },
    { key: 'DISPATCH', label: 'Invoice & Shipping', icon: Truck },
    { key: 'GENERATE', label: 'Generate & Print', icon: Printer },
];

// Enriched pallet info for review
interface EnrichedPallet {
    id: string; pallet_number: string; item_code: string; item_name: string;
    part_number: string; master_serial_no: string; state: string;
    current_qty: number; target_qty: number; container_count: number;
    spec: PackingSpec | null;
    containers: Array<{ packing_id: string; quantity: number; container_type: string; is_adjustment: boolean; created_at: string; operator: string }>;
    gross_weight_kg: number; // user input
}

export function PackingListPrint({ accessToken, userRole, userPerms = {} }: Props) {
    const supabase = getSupabaseClient();
    const canEdit = userRole === 'L3' || userRole === 'L2';

    const [packingLists, setPackingLists] = useState<PackingList[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [step, setStep] = useState<WizardStep>('SELECT');

    // Selected PL
    const [selectedPL, setSelectedPL] = useState<PackingList | null>(null);
    const [plData, setPlData] = useState<PackingListData | null>(null);
    const [palletDetails, setPalletDetails] = useState<PackingListPalletDetail[]>([]);
    const [enrichedPallets, setEnrichedPallets] = useState<EnrichedPallet[]>([]);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [saving, setSaving] = useState(false);

    // Step 3: Dispatch form
    const [dispatchForm, setDispatchForm] = useState({
        invoice_number: '', invoice_date: '', purchase_order_number: '',
        purchase_order_date: '', ship_via: '', vendor_number: '',
    });

    // Step 4: Generated
    const [generated, setGenerated] = useState(false);

    const fetchPLs = useCallback(async () => {
        setLoading(true);
        try { setPackingLists(await svc.fetchPackingLists()); }
        catch (err) { console.error(err); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { fetchPLs(); }, [fetchPLs]);

    // Auto-select PL if redirected from Dispatch Selection
    useEffect(() => {
        const savedPlId = localStorage.getItem('wms_last_created_pl_id');
        if (savedPlId && packingLists.length > 0) {
            const pl = packingLists.find(p => p.id === savedPlId);
            if (pl) {
                localStorage.removeItem('wms_last_created_pl_id');
                localStorage.removeItem('wms_last_created_pl_number');
                handleSelectPL(pl);
            }
        }
    }, [packingLists]);

    // ─── SELECT PL → load enriched data ───
    const handleSelectPL = async (pl: PackingList) => {
        setSelectedPL(pl);
        setLoadingDetail(true);
        setStep('REVIEW');
        setGenerated(false);
        try {
            // 1. Ensure PL data exists
            let data = await svc.fetchPackingListData(pl.id);
            if (!data) {
                data = await svc.upsertPackingListData(pl.id, {});
                await svc.autoPopulatePalletDetails(pl.id, data.id);
            }
            setPlData(data);

            // Pre-populate dispatch form from existing data
            setDispatchForm({
                invoice_number: data.invoice_number || '',
                invoice_date: data.invoice_date || '',
                purchase_order_number: data.purchase_order_number || '',
                purchase_order_date: data.purchase_order_date || '',
                ship_via: data.ship_via || '',
                vendor_number: data.vendor_number || '',
            });

            // 2. Fetch pallet details
            const details = await svc.fetchPackingListPalletDetails(data.id);
            setPalletDetails(details);

            // 3. Fetch full pallet + container data for review
            const { data: plItems } = await supabase
                .from('pack_packing_list_items')
                .select('pallet_id').eq('packing_list_id', pl.id);
            const palletIds = (plItems || []).map((i: any) => i.pallet_id);

            if (palletIds.length > 0) {
                const { data: pallets } = await supabase
                    .from('pack_pallets')
                    .select('*, items!pack_pallets_item_id_fkey (item_name, master_serial_no, part_number)')
                    .in('id', palletIds);

                // Fetch containers per pallet
                const { data: pcJoin } = await supabase
                    .from('pack_pallet_containers')
                    .select(`pallet_id, position_sequence, pack_containers!inner (container_number, quantity, container_type, is_adjustment, created_at, packing_box_id, profiles!pack_containers_created_by_fkey (full_name), packing_boxes:packing_box_id (packing_id))`)
                    .in('pallet_id', palletIds)
                    .order('position_sequence');

                // Fetch packing specs
                const itemCodes = [...new Set((pallets || []).map((p: any) => p.item_code))];
                const specMap: Record<string, PackingSpec> = {};
                for (const ic of itemCodes) {
                    const spec = await svc.getPackingSpecForItem(ic);
                    if (spec) specMap[ic] = spec;
                }

                // Build enriched pallets
                const enriched: EnrichedPallet[] = (pallets || []).map((p: any) => {
                    const pContainers = (pcJoin || []).filter((pc: any) => pc.pallet_id === p.id);
                    const detail = details.find(d => d.pallet_id === p.id);
                    return {
                        id: p.id, pallet_number: p.pallet_number, item_code: p.item_code,
                        item_name: p.items?.item_name || p.item_code,
                        part_number: p.items?.part_number || '',
                        master_serial_no: p.items?.master_serial_no || '',
                        state: p.state, current_qty: p.current_qty, target_qty: p.target_qty,
                        container_count: p.container_count,
                        spec: specMap[p.item_code] || null,
                        containers: pContainers.map((pc: any) => ({
                            packing_id: pc.pack_containers?.packing_boxes?.packing_id || '—',
                            quantity: pc.pack_containers?.quantity || 0,
                            container_type: pc.pack_containers?.container_type || '',
                            is_adjustment: pc.pack_containers?.is_adjustment || false,
                            created_at: pc.pack_containers?.created_at || '',
                            operator: pc.pack_containers?.profiles?.full_name || '—',
                        })),
                        gross_weight_kg: Number(detail?.gross_weight_kg || 0),
                    };
                });
                setEnrichedPallets(enriched);
            }
        } catch (err) { console.error(err); }
        finally { setLoadingDetail(false); }
    };

    // ─── STEP 2: Update gross weight ───
    const handleWeightChange = (palletId: string, weight: number) => {
        setEnrichedPallets(prev => prev.map(p => p.id === palletId ? { ...p, gross_weight_kg: weight } : p));
    };

    // ─── STEP 3 → 4: Save all data and generate ───
    const handleGenerateMasterPL = async () => {
        if (!selectedPL || !plData) return;
        setSaving(true);
        try {
            // Save dispatch info (Invoice/PO are SAP references captured here)
            await svc.upsertPackingListData(selectedPL.id, {
                ...dispatchForm,
                is_finalized: true,
            });

            // Save per-pallet gross weights
            for (const ep of enrichedPallets) {
                const detail = palletDetails.find(d => d.pallet_id === ep.id);
                if (detail) {
                    await svc.updatePalletDetail(detail.id, {
                        gross_weight_kg: ep.gross_weight_kg,
                        invoice_number: dispatchForm.invoice_number,
                        po_number: dispatchForm.purchase_order_number,
                    });
                }
            }
            setGenerated(true);
            setStep('GENERATE');
        } catch (err: any) { alert('Error: ' + (err.message || err)); }
        finally { setSaving(false); }
    };

    // ─── PRINT: Master Packing List ───
    const handlePrintMasterPL = async () => {
        if (!selectedPL) return;
        try {
            const bt = await svc.getPackingListFullBacktrack(selectedPL.id);
            openMasterPLPrint(bt);
        } catch (err: any) { alert('Error: ' + (err.message || err)); }
    };

    // ─── PRINT: Packing Reference Sheet ───
    const handlePrintPackingRef = () => {
        openPackingRefPrint(enrichedPallets, selectedPL!);
    };

    const openMasterPLPrint = (bt: Awaited<ReturnType<typeof svc.getPackingListFullBacktrack>>) => {
        const hd = bt.headerData;
        const pl = bt.packingList;
        const details = bt.palletDetails;
        const ts = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
        const nowStr = new Date().toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ', ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
        const invDate = hd?.invoice_date ? new Date(hd.invoice_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
        const poDate = hd?.purchase_order_date ? new Date(hd.purchase_order_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
        const totalNet = details.reduce((s, d) => s + Number(d.net_weight_kg || 0), 0);
        const totalGross = details.reduce((s, d) => s + Number(d.gross_weight_kg || 0), 0);
        const totalQty = details.reduce((s, d) => s + (d.qty_per_pallet || 0), 0);
        const totalPkgs = details.length;

        /* ── hardcoded defaults (override from hd when available) ── */
        const D = {
            expName: hd?.exporter_name || 'AUTOCRAT ENGINEERS',
            expAddr: hd?.exporter_address || 'NO. 21 & 22, Export Promotion Industrial Park, Phase - I, Whitefield,\nBangalore-560066, KARNATAKA - INDIA',
            expPhone: hd?.exporter_phone || 'PH 91 80 43330127',
            expEmail: hd?.exporter_email || 'dispatch@autocratengineers.in',
            expGstin: hd?.exporter_gstin || '29ABLPK6831H1ZB',
            expRef: hd?.exporter_ref || '-NIL-',
            expIec: hd?.exporter_iec_code || '0702002747',
            expAd: hd?.exporter_ad_code || '6361504-8400009',
            vendorNo: hd?.vendor_number || '',
            conName: hd?.consignee_name || 'Milano Millworks, LLC',
            conAddr: (hd?.consignee_address || '9223 Industrial Blvd NE Leland\nNC 28451 USA').replace('8223', '9223'),
            conPhone: hd?.consignee_phone || '(910) 443-3075', buyName: hd?.buyer_name || 'Brown, Sherry',
            buyPhone: hd?.buyer_phone || '919-209-2411',
            buyEmail: hd?.buyer_email || 'sherry.brown@opwglobal.com',
            billName: hd?.bill_to_name || 'OPW Fueling Components, LLC',
            billAddr: hd?.bill_to_address || '3250 US Highway 70 Business West\nSmithfield, NC 27577\nUnited States',
            preCarr: hd?.pre_carriage_by || 'Road',
            receipt: hd?.place_of_receipt || 'BANGALORE',
            origin: hd?.country_of_origin || 'INDIA',
            dest: hd?.country_of_destination || 'UNITED STATES',
            portLoad: hd?.port_of_loading || 'BANGALORE, ICD',
            delivery: hd?.terms_of_delivery || 'DDP',
            payment: hd?.payment_terms || 'Net-30',
            portDisc: hd?.port_of_discharge || 'CHARLESTON',
            finalDest: hd?.final_destination || 'UNITED STATES',
            transport: hd?.mode_of_transport || 'Sea',
            itemHdr: hd?.item_description_header || 'PRECISION MACHINED COMPONENTS',
            itemSub: hd?.item_description_sub_header || '(OTHERS FUELING COMPONENTS)',
        };

        /* ── item rows ── */
        const itemRows = details.map((d, idx) => {
            const dim = d.pallet_length_cm && d.pallet_width_cm && d.pallet_height_cm
                ? `${d.pallet_length_cm} X ${d.pallet_width_cm} X ${d.pallet_height_cm}` : '\u2014';
            return `<tr>
<td class="bb br c4 ctr">${idx + 1}</td>
<td class="bb br c4">${d.pallet_number || ''}</td>
<td class="bb br c4"><b>${d.master_serial_no ? '[' + d.master_serial_no + ']' : ''}</b><br/>${d.part_number || ''}<br/>${d.item_name || d.item_code || ''}${d.hts_code ? '<br/><span class="sm">HTS CODE: ' + d.hts_code.replace(/^84139190$/, '8413919085') + '</span>' : ''}</td>
<td class="bb br c4 ctr">${d.num_pallets || 1}</td>
<td class="bb br c4 ctr">${dim}</td>
<td class="bb br c4 ctr">${d.part_revision || '\u2014'}</td>
<td class="bb br c4 rgt mono">${(d.qty_per_pallet || 0).toLocaleString()}<br/><span class="sm">Nos</span></td>
<td class="bb br c4 rgt mono">${Number(d.net_weight_kg || 0).toFixed(2)}</td>
<td class="bb c4 rgt mono"><b>${Number(d.gross_weight_kg || 0).toFixed(2)}</b></td></tr>`;
        }).join('');

        /* ── full HTML ── */
        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PL-${pl.packing_list_number}</title>
<style>
@page{size:A4 portrait;margin:6mm}
*{margin:0;padding:0;box-sizing:border-box}
html,body{font-family:Arial,Helvetica,sans-serif;color:#000;font-size:9px;line-height:1.25;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;height:100%}
b{font-weight:700}
table{border-collapse:collapse;width:100%}
td,th{vertical-align:top}
.outer{border:1.5px solid #000;display:flex;flex-direction:column;min-height:calc(100vh - 12mm)}
.grow{flex:1}
.bb{border-bottom:1px solid #000}
.br{border-right:1px solid #000}
.bt{border-top:1px solid #000}
.c4{padding:3px 5px}
.ctr{text-align:center}
.rgt{text-align:right}
.sm{font-size:7.5px;color:#555}
.lbl{font-size:8px;font-weight:700}
.mono{font-family:'Courier New',monospace}
.wm{position:fixed;top:46%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:56px;font-weight:900;color:rgba(0,0,0,.035);letter-spacing:10px;text-transform:uppercase;pointer-events:none;z-index:0;white-space:nowrap}
@media print{.no-print{display:none!important}@page{size:A4 portrait;margin:6mm}}
</style></head><body>
<div class="wm">AUTOCRAT ENGINEERS</div>

<!-- DATE BAR -->
<table><tr>
<td class="c4" style="font-size:9px">${nowStr}</td>
<td class="c4 ctr" style="font-size:9px">PL-${pl.packing_list_number}</td>
<td class="c4 rgt" style="font-size:9px"></td>
</tr></table>

<div class="outer">

<!-- ═══ HEADER: PACKING LIST ═══ -->
<table><tr style="position:relative"><td class="bb c4" style="padding:6px 8px;width:30%"><img src="/logo.png" alt="AUTOCRAT ENGINEERS" style="height:34px;object-fit:contain" onerror="this.outerHTML='<span style=font-size:11px;font-weight:800>AUTOCRAT<br>ENGINEERS</span>'" /></td><td class="bb c4" style="padding:8px;width:70%"><div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;pointer-events:none"><span style="font-size:20px;font-weight:800;letter-spacing:5px;text-transform:uppercase;font-style:italic">PACKING LIST</span></div></td></tr></table>

<!-- ═══ EXPORTER + INVOICE/PO/SHIP + REF ═══ -->
<table>
<colgroup><col style="width:40%"/><col style="width:18%"/><col style="width:22%"/><col style="width:20%"/></colgroup>
<tr>
<td class="bb br c4 lbl" rowspan="5" style="vertical-align:top">
<div class="bb" style="padding:2px 5px;font-size:8px">Exporter</div>
<div style="padding:4px 5px;line-height:1.5">
<div style="font-size:10px;font-weight:800">${D.expName}</div>
<div style="font-size:8px">${D.expAddr.replace(/\n/g, '<br/>')}</div>
<div style="font-size:8px">${D.expPhone}</div>
<div style="font-size:8px">E mail : ${D.expEmail}</div>
<div style="font-size:8px">GSTIN : ${D.expGstin}</div>
</div>
</td>
<td class="bb br c4 lbl">Invoice No. & Date</td>
<td class="bb br c4 mono" style="font-weight:700">${hd?.invoice_number || ''} ${invDate ? 'DT.' + invDate : ''}</td>
<td class="bb c4" rowspan="5" style="vertical-align:top;padding:4px 5px">
<div class="lbl">Exporter's Ref</div><div>${D.expRef}</div>
<div class="lbl" style="margin-top:8px">VENDOR NO:</div><div style="font-size:13px;font-weight:800">${D.vendorNo}</div>
</td>
</tr>
<tr><td class="bb br c4 lbl">Purchase Order No. & Date :</td><td class="bb br c4 mono" style="font-weight:700">${hd?.purchase_order_number || ''} ${poDate ? 'DT.' + poDate : ''}</td></tr>
<tr><td class="bb br c4 lbl">Ship Via :</td><td class="bb br c4" style="font-weight:700">${hd?.ship_via || ''}</td></tr>
<tr><td class="bb br c4 lbl">Others Reference(s) :</td><td class="bb br c4"></td></tr>
</table>

<!-- ═══ CONSIGNEE + BUYER/BILL TO ═══ -->
<table>
<colgroup><col style="width:40%"/><col style="width:18%"/><col style="width:42%"/></colgroup>
<tr>
<td class="bb br c4" rowspan="4" style="vertical-align:top">
<div class="bb" style="padding:2px 5px;font-size:8px;font-weight:700">Consignee</div>
<div style="padding:4px 5px;line-height:1.5">
<div style="font-weight:700">${D.conName}</div>
<div style="font-size:8px">${D.conAddr.replace(/\n/g, '<br/>')}</div>
<div style="font-size:8px">Telephone: ${D.conPhone}</div>
</div>
</td>
<td class="bb br c4 lbl">Buyer</td><td class="bb c4">: ${D.buyName}</td>
</tr>
<tr><td class="bb br c4 lbl">Phone No</td><td class="bb c4">${D.buyPhone}</td></tr>
<tr><td class="bb br c4 lbl">E-Mail ID</td><td class="bb c4">${D.buyEmail}</td></tr>
<tr><td class="bb br c4 lbl" style="vertical-align:top">Bill To :</td><td class="bb c4" style="font-size:8px;line-height:1.5">${D.billName}<br/>${D.billAddr.replace(/\n/g, '<br/>')}</td></tr>
</table>

<!-- ═══ SHIPPING DETAILS ═══ -->
<table>
<colgroup><col style="width:16%"/><col style="width:18%"/><col style="width:18%"/><col style="width:16%"/><col style="width:16%"/><col style="width:16%"/></colgroup>
<tr>
<td class="bb br c4 lbl">Pre-Carriage by<br/><span style="font-weight:400">${D.preCarr}</span></td>
<td class="bb br c4 lbl">Place of Receipt of Pre-Carrier<br/><span style="font-weight:700">${D.receipt}</span></td>
<td class="bb br c4 lbl" colspan="2">Country of Origin of Goods<br/><span style="font-weight:700">${D.origin}</span></td>
<td class="bb c4 lbl" colspan="2">Country of Final Destination<br/><span style="font-weight:700">${D.dest}</span></td>
</tr>
<tr>
<td class="bb br c4 lbl">Vessel/Flight No.</td>
<td class="bb br c4 lbl">Port of Loading<br/><span style="font-weight:700">${D.portLoad}</span></td>
<td class="bb br c4 lbl" colspan="2">Terms of Delivery & Payment<br/><span style="font-weight:400">${D.delivery}</span><br/><span style="font-weight:400">${D.payment}</span></td>
<td class="bb c4" colspan="2" style="font-size:8px">Days from the date of Invoice</td>
</tr>
<tr>
<td class="bb br c4 lbl">Mode of Transport<br/><span style="font-weight:400">${D.transport}</span></td>
<td class="bb br c4 lbl">Freight Forwarder<br/><span style="font-weight:700">WEISS ROHLING INDIA</span></td>
<td class="bb br c4 lbl">Port of Discharge<br/><span style="font-weight:700">${D.portDisc}</span></td>
<td class="bb br c4 lbl">Final Destination<br/><span style="font-weight:700">${D.finalDest}</span></td>
<td class="bb br c4 lbl">IEC Code No :<br/><span class="mono" style="font-weight:400">${D.expIec}</span></td>
<td class="bb c4 lbl">AD Code No:<br/><span class="mono" style="font-weight:400">${D.expAd}</span></td>
</tr>
</table>

<!-- ═══ ITEM DESCRIPTION ═══ -->
<table><tr><td class="bb c4 ctr" style="padding:5px;font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:1px">${D.itemHdr}<br/><span style="font-weight:700;font-size:9px">${D.itemSub}</span></td></tr></table>

<!-- ═══ ITEMS TABLE ═══ -->
<table>
<colgroup><col style="width:5%"/><col style="width:14%"/><col style="width:20%"/><col style="width:6%"/><col style="width:11%"/><col style="width:6%"/><col style="width:11%"/><col style="width:12%"/><col style="width:15%"/></colgroup>
<tr style="background:#f5f5f5">
<th class="bb br c4 lbl ctr">SL NO</th>
<th class="bb br c4 lbl" style="text-align:left">Pallet No. & Batch No.</th>
<th class="bb br c4 lbl" style="text-align:left">Part No. & Description with P.O No.</th>
<th class="bb br c4 lbl ctr">No. of Pallet</th>
<th class="bb br c4 lbl ctr">Dimensions in cm</th>
<th class="bb br c4 lbl ctr">Part Rev</th>
<th class="bb br c4 lbl rgt">Qty Per Pallet</th>
<th class="bb br c4 lbl rgt">Net Wt in KGs</th>
<th class="bb c4 lbl rgt">Gross Wt in KGs</th>
</tr>
${itemRows}
</table>

<!-- ═══ SPACER (pushes totals to bottom) ═══ -->
<div class="grow"></div>

<!-- ═══ TOTALS ═══ -->
<table>
<colgroup><col style="width:5%"/><col style="width:14%"/><col style="width:20%"/><col style="width:6%"/><col style="width:11%"/><col style="width:6%"/><col style="width:11%"/><col style="width:12%"/><col style="width:15%"/></colgroup>
<tr style="background:#f5f5f5">
<td class="bt br c4"></td>
<td class="bt br c4" colspan="2" style="font-weight:800;font-size:9px">Total No of Pkgs. ${String(totalPkgs).padStart(2, '0')}<br/>Net. Wt.in Kgs. ${totalNet.toFixed(2)}<br/>in kgs ${totalGross.toFixed(2)}</td>
<td class="bt br c4 ctr lbl">Total<br/>Total<br/>Gross</td>
<td class="bt br c4 ctr mono" style="font-weight:800">${String(totalPkgs).padStart(2, '0')}</td>
<td class="bt br c4"></td>
<td class="bt br c4 rgt mono" style="font-weight:800">${totalQty.toLocaleString()}</td>
<td class="bt br c4 rgt mono" style="font-weight:800">${totalNet.toFixed(2)}<br/><span class="sm">Kgs</span></td>
<td class="bt c4 rgt mono" style="font-weight:800">${totalGross.toFixed(2)}<br/><span class="sm">Kgs</span></td>
</tr>
</table>

<!-- ═══ ITC HS CODE ═══ -->
<table><tr><td class="bt c4" style="font-size:9px;font-weight:700;padding:4px 5px">ITC HS CODE: <span class="mono">84139190</span></td></tr></table>

<!-- ═══ EPCG / LUT + SIGNATORY ═══ -->
<table style="border-top:1px solid #000">
<colgroup><col style="width:65%"/><col style="width:35%"/></colgroup>
<tr>
<td class="c4" style="padding:6px 5px;vertical-align:top">
<div style="font-size:8px;text-align:center;color:#c00;font-weight:700;margin-top:2px">The Supply is under EPCG License No: 0731011353 Date 24/05/2024</div>
<div style="font-size:8px;text-align:center;font-weight:700;margin-top:3px">SUPPLYMEANT FOR EXPORT UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX(IGST) LUT</div>
<div style="font-size:8px;text-align:center;margin-top:2px">No.AD2903251644306 Dated 29/03/2025</div>
</td>
<td class="c4 rgt" style="vertical-align:top;padding:6px 5px">
<img src="/logo.png" alt="" style="height:24px;margin-bottom:3px;display:block;margin-left:auto" onerror="this.style.display='none'" />
<div style="font-size:9px;font-weight:700">for AUTOCRAT ENGINEERS</div>
<div style="margin-top:22px;font-size:8px;font-style:italic">Authorised Signatory</div>
</td>
</tr>
</table>

</div><!-- end .outer -->

<!-- ═══ BOTTOM INFO BAR ═══ -->
<table style="margin-top:3px"><tr>
<td class="c4" style="font-size:8px;color:#666;width:33%">MPL#: ${pl.packing_list_number}</td>
<td class="c4 ctr" style="font-size:8px;color:#666;width:34%">Printed: ${ts}</td>
<td class="c4 rgt" style="font-size:8px;color:#666;width:33%">System-generated packing list \u2014 dispatch audit record</td>
</tr></table>

<script>window.onload=function(){window.print();}<\/script></body></html>`;

        const w = window.open('', '_blank', 'width=900,height=1100');
        if (w) { w.document.write(html); w.document.close(); }
    };

    // ─── PACKING REFERENCE SHEET (for packing team) ───
    const openPackingRefPrint = (pallets: EnrichedPallet[], pl: PackingList) => {
        const ts = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
        const palletRows = pallets.map(p => {
            const spec = p.spec;
            const innerQty = spec?.inner_box_quantity || 0;
            const outerQty = spec?.outer_box_quantity || 0;
            const innerDim = spec ? `${spec.inner_box_length_mm}×${spec.inner_box_width_mm}×${spec.inner_box_height_mm}mm` : '—';
            const outerDim = spec ? `${spec.outer_box_length_mm}×${spec.outer_box_width_mm}×${spec.outer_box_height_mm}mm` : '—';
            const ctnRows = p.containers.map((c, i) => `<tr><td class="b br p f9 tc">${i + 1}</td><td class="b br p f9 mono" style="color:#7c3aed;font-weight:700">${c.packing_id}</td><td class="b br p f9 tc">${c.container_type}</td><td class="b br p f9 tr mono fw6">${c.quantity.toLocaleString()}</td><td class="b br p f9 tc">${c.is_adjustment ? '✓ ADJ' : ''}</td><td class="b p f9">${c.operator}</td></tr>`).join('');
            return `<div style="page-break-inside:avoid;margin-bottom:12px">
<table class="bdr" style="margin-bottom:2px"><tr><td class="p" style="background:#1e3a8a;color:#fff"><div class="f11 fw8">${p.pallet_number}</div><div class="f8" style="opacity:.8">${p.item_name} (${p.item_code}) · ${p.master_serial_no}</div></td><td class="p tr" style="background:#1e3a8a;color:#fff;width:30%"><div class="f10 fw7">${p.current_qty.toLocaleString()} / ${p.target_qty.toLocaleString()} PCS</div><div class="f8" style="opacity:.8">${p.container_count} containers</div></td></tr></table>
<table class="bdr" style="border-top:none"><tr><td class="b br p f8 fw7" style="width:20%">Inner Box Qty</td><td class="b br p f9 mono fw6" style="width:13%">${innerQty.toLocaleString()} PCS</td><td class="b br p f8 fw7" style="width:20%">Inner Box Dims</td><td class="b br p f9" style="width:14%">${innerDim}</td><td class="b br p f8 fw7" style="width:16%">Outer/Pallet Qty</td><td class="b p f9 mono fw6" style="width:17%">${outerQty.toLocaleString()} PCS</td></tr>
<tr><td class="br p f8 fw7">Outer Box Dims</td><td class="br p f9">${outerDim}</td><td class="br p f8 fw7">Net Wt/Box</td><td class="br p f9">${spec?.inner_box_net_weight_kg || '—'} kg</td><td class="br p f8 fw7">Gross Wt/Box</td><td class="p f9">${spec?.outer_box_gross_weight_kg || '—'} kg</td></tr></table>
<table class="bdr" style="border-top:none"><tr style="background:#f9fafb"><th class="b br p f8 fw7 tc" style="width:6%">#</th><th class="b br p f8 fw7 tl" style="width:22%">Packing Box ID</th><th class="b br p f8 fw7 tc" style="width:12%">Type</th><th class="b br p f8 fw7 tr" style="width:15%">Quantity</th><th class="b br p f8 fw7 tc" style="width:10%">Adjust?</th><th class="b p f8 fw7 tl" style="width:35%">Packed By</th></tr>${ctnRows}</table></div>`;
        }).join('');

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Packing Reference - ${pl.packing_list_number}</title>
<style>@page{size:A4 portrait;margin:8mm}*{margin:0;padding:0;box-sizing:border-box}html,body{font-family:Arial,sans-serif;color:#000;font-size:9px;line-height:1.3;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}table{border-collapse:collapse;width:100%}.bdr{border:1px solid #000}.b{border-bottom:1px solid #000}.br{border-right:1px solid #000}.p{padding:3px 6px}.tc{text-align:center}.tr{text-align:right}.tl{text-align:left}.vt{vertical-align:top}.vm{vertical-align:middle}.fw8{font-weight:800}.fw7{font-weight:700}.fw6{font-weight:600}.f8{font-size:8px}.f9{font-size:9px}.f10{font-size:10px}.f11{font-size:11px}.f14{font-size:14px}.g6{color:#666}.mono{font-family:'Courier New',monospace}@media print{@page{size:A4 portrait;margin:8mm}}</style></head><body>
<table class="bdr"><tr><td class="tc" style="padding:6px"><div class="f14 fw8" style="letter-spacing:2px">PACKING REFERENCE SHEET</div><div class="f9 g6">${pl.packing_list_number} · ${ts}</div></td></tr></table>
<div style="margin-top:8px">${palletRows}</div>
<table style="margin-top:8px;border-top:1.5px solid #000;width:100%"><tr><td class="p f8 g6 tl">PL#: ${pl.packing_list_number}</td><td class="p f8 g6 tc">Total: ${pallets.length} pallets · ${pallets.reduce((s, p) => s + p.container_count, 0)} containers · ${pallets.reduce((s, p) => s + p.current_qty, 0).toLocaleString()} PCS</td><td class="p f8 g6 tr">for AUTOCRAT ENGINEERS</td></tr></table>
<script>window.onload=function(){window.print();}<\/script></body></html>`;
        const w = window.open('', '_blank', 'width=900,height=1100');
        if (w) { w.document.write(html); w.document.close(); }
    };

    // ─── Filtered PLs ───
    const filtered = packingLists.filter(pl => {
        if (!searchTerm) return true;
        const s = searchTerm.toLowerCase();
        return pl.packing_list_number.toLowerCase().includes(s) || (pl.customer_name || '').toLowerCase().includes(s);
    });

    const stepIndex = STEPS.findIndex(s => s.key === step);

    // ═══════════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════════

    return (
        <div style={{ paddingBottom: 40 }}>
            {/* STEP INDICATOR */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 20, padding: '16px 20px', background: 'white', borderRadius: 12, border: '1px solid #e5e7eb' }}>
                {STEPS.map((s, i) => {
                    const Icon = s.icon;
                    const isActive = s.key === step;
                    const isDone = stepIndex > i;
                    return (
                        <React.Fragment key={s.key}>
                            {i > 0 && <div style={{ flex: '0 0 32px', height: 2, background: isDone ? '#1e3a8a' : '#e5e7eb', borderRadius: 1 }} />}
                            <div onClick={() => { if (isDone || isActive) setStep(s.key); }} style={{
                                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 8, cursor: isDone || isActive ? 'pointer' : 'default',
                                background: isActive ? '#1e3a8a' : isDone ? '#eff6ff' : '#f9fafb', color: isActive ? '#fff' : isDone ? '#1e3a8a' : '#9ca3af',
                                transition: 'all 0.2s', fontWeight: isActive || isDone ? 700 : 500, fontSize: 12, whiteSpace: 'nowrap',
                            }}>
                                {isDone ? <CheckCircle2 size={16} /> : <Icon size={16} />}
                                <span>{s.label}</span>
                            </div>
                        </React.Fragment>
                    );
                })}
            </div>

            {/* ═══ STEP: SELECT ═══ */}
            {step === 'SELECT' && (
                <Card>
                    <FilterBar><SearchBox value={searchTerm} onChange={setSearchTerm} placeholder="Search PL number..." /><ActionBar><RefreshButton onClick={fetchPLs} loading={loading} /></ActionBar></FilterBar>
                    {loading ? <ModuleLoader moduleName="Packing Lists" icon={<FileText size={24} style={{ color: '#1e3a8a' }} />} /> :
                        filtered.length === 0 ? <EmptyState icon={<FileText size={48} style={{ color: '#d1d5db' }} />} title="No Packing Lists" description="Generate packing lists from Dispatch Selection first." /> :
                            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
                                {filtered.map(pl => {
                                    const sc = STATUS_COLORS[pl.status] || STATUS_COLORS.DRAFT;
                                    return (
                                        <div key={pl.id} onClick={() => handleSelectPL(pl)} style={{ padding: '14px 16px', cursor: 'pointer', borderBottom: '1px solid #f3f4f6', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                                            onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                                            <div>
                                                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: '#1e3a8a' }}>{pl.packing_list_number}</span>
                                                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{pl.total_pallets} pallets · {pl.total_containers} ctns · {pl.total_quantity.toLocaleString()} pcs</div>
                                                {pl.customer_name && <div style={{ fontSize: 11, color: '#9ca3af' }}>{pl.customer_name}</div>}
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                <span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700, background: sc.bg, color: sc.color }}>{pl.status}</span>
                                                <ChevronRight size={16} style={{ color: '#9ca3af' }} />
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>}
                </Card>
            )}

            {/* ═══ STEP: REVIEW ═══ */}
            {step === 'REVIEW' && (
                <Card>
                    {loadingDetail ? <div style={{ padding: 48, textAlign: 'center', color: '#6b7280' }}><Loader2 size={24} style={{ animation: 'spin 1s linear infinite' }} /> Loading pallet details...</div> : (
                        <div>
                            <div style={{ ...secHdr }}>Item & Packing Details</div>
                            {enrichedPallets.length > 0 && enrichedPallets[0].spec && (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
                                    {[
                                        { label: 'Item', value: enrichedPallets[0].item_name, sub: enrichedPallets[0].item_code },
                                        { label: 'Inner Box Qty', value: `${enrichedPallets[0].spec.inner_box_quantity.toLocaleString()} PCS` },
                                        { label: 'Outer/Pallet Qty', value: `${enrichedPallets[0].spec.outer_box_quantity.toLocaleString()} PCS` },
                                        { label: 'Part / MSN', value: `${enrichedPallets[0].part_number} / ${enrichedPallets[0].master_serial_no}` },
                                    ].map((c, i) => (
                                        <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e5e7eb' }}>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 }}>{c.label}</div>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: '#1e3a8a' }}>{c.value}</div>
                                            {c.sub && <div style={{ fontSize: 11, color: '#9ca3af' }}>{c.sub}</div>}
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div style={{ ...secHdr }}>Pallet & Container Breakdown</div>
                            {enrichedPallets.map(p => (
                                <div key={p.id} style={{ marginBottom: 12, border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: '#f0f9ff', borderBottom: '1px solid #e5e7eb' }}>
                                        <div><span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e3a8a', fontSize: 13 }}>{p.pallet_number}</span><span style={{ fontSize: 11, color: '#6b7280', marginLeft: 8 }}>{p.current_qty.toLocaleString()} / {p.target_qty.toLocaleString()} PCS · {p.container_count} containers</span></div>
                                        <span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: p.state === 'READY' ? '#f0fdf4' : '#fffbeb', color: p.state === 'READY' ? '#16a34a' : '#d97706' }}>{p.state}</span>
                                    </div>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead><tr>
                                            <th style={{ ...thS, width: 40 }}>#</th><th style={thS}>Packing Box ID</th><th style={thS}>Type</th>
                                            <th style={{ ...thS, textAlign: 'right' }}>Qty</th><th style={thS}>Adj?</th><th style={thS}>Packed By</th>
                                        </tr></thead>
                                        <tbody>{p.containers.map((c, i) => (
                                            <tr key={i}><td style={{ ...tdS, textAlign: 'center' }}>{i + 1}</td><td style={{ ...tdS, fontFamily: 'monospace', fontWeight: 700, color: '#7c3aed' }}>{c.packing_id}</td><td style={tdS}>{c.container_type}</td>
                                                <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{c.quantity.toLocaleString()}</td>
                                                <td style={tdS}>{c.is_adjustment ? <span style={{ color: '#d97706', fontWeight: 600 }}>ADJ</span> : ''}</td><td style={tdS}>{c.operator}</td></tr>
                                        ))}</tbody>
                                    </table>
                                </div>
                            ))}
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
                                <button onClick={() => setStep('WEIGHTS')} style={{ padding: '10px 24px', borderRadius: 8, background: '#1e3a8a', color: 'white', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    Next: Gross Weights <ChevronRight size={16} />
                                </button>
                            </div>
                        </div>)}
                </Card>
            )}

            {/* ═══ STEP: WEIGHTS ═══ */}
            {step === 'WEIGHTS' && (
                <Card>
                    <div style={{ ...secHdr }}>Enter Gross Weight per Pallet (KGs)</div>
                    <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>Enter the gross weight for each pallet. Net weight is auto-calculated from packing specs.</p>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead><tr>
                            <th style={thS}>Pallet</th><th style={thS}>Item</th><th style={{ ...thS, textAlign: 'right' }}>Qty (PCS)</th>
                            <th style={{ ...thS, textAlign: 'right' }}>Containers</th><th style={{ ...thS, textAlign: 'right' }}>Net Wt (Kg)</th>
                            <th style={{ ...thS, textAlign: 'right', background: '#fffbeb' }}>Gross Wt (Kg) *</th>
                        </tr></thead>
                        <tbody>{enrichedPallets.map(p => {
                            const detail = palletDetails.find(d => d.pallet_id === p.id);
                            const netWt = Number(detail?.net_weight_kg || 0);
                            return (
                                <tr key={p.id}>
                                    <td style={{ ...tdS, fontFamily: 'monospace', fontWeight: 700, color: '#1e3a8a' }}>{p.pallet_number}</td>
                                    <td style={tdS}><div style={{ fontWeight: 600 }}>{p.item_name}</div><div style={{ fontSize: 11, color: '#6b7280' }}>{p.item_code}</div></td>
                                    <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{p.current_qty.toLocaleString()}</td>
                                    <td style={{ ...tdS, textAlign: 'right' }}>{p.container_count}</td>
                                    <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace' }}>{netWt.toFixed(2)}</td>
                                    <td style={{ ...tdS, textAlign: 'right', background: '#fffbeb' }}>
                                        <input type="number" step="0.01" value={p.gross_weight_kg || ''} onChange={e => handleWeightChange(p.id, parseFloat(e.target.value) || 0)}
                                            style={{ ...inp, width: 120, textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, padding: '6px 10px' }} placeholder="0.00" />
                                    </td>
                                </tr>
                            );
                        })}</tbody>
                    </table>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
                        <button onClick={() => setStep('REVIEW')} style={{ padding: '10px 24px', borderRadius: 8, background: 'white', color: '#374151', border: '1px solid #d1d5db', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <ChevronLeft size={16} /> Back
                        </button>
                        <button onClick={() => setStep('DISPATCH')} style={{ padding: '10px 24px', borderRadius: 8, background: '#1e3a8a', color: 'white', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                            Next: Invoice & Shipping <ChevronRight size={16} />
                        </button>
                    </div>
                </Card>
            )}

            {/* ═══ STEP: DISPATCH (SAP references captured here) ═══ */}
            {step === 'DISPATCH' && (
                <Card>
                    <div style={{ ...secHdr }}>Invoice & PO Details (SAP References)</div>
                    <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>These are created in SAP — enter the reference numbers to link with this packing list.</p>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                        <div><label style={lbl}>Invoice Number (SAP)</label><input value={dispatchForm.invoice_number} onChange={e => setDispatchForm({ ...dispatchForm, invoice_number: e.target.value })} style={inp} placeholder="INV/E/ 252602774" /></div>
                        <div><label style={lbl}>Invoice Date</label><input type="date" value={dispatchForm.invoice_date} onChange={e => setDispatchForm({ ...dispatchForm, invoice_date: e.target.value })} style={inp} /></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                        <div><label style={lbl}>Purchase Order Number (SAP)</label><input value={dispatchForm.purchase_order_number} onChange={e => setDispatchForm({ ...dispatchForm, purchase_order_number: e.target.value })} style={inp} placeholder="260067798" /></div>
                        <div><label style={lbl}>PO Date</label><input type="date" value={dispatchForm.purchase_order_date} onChange={e => setDispatchForm({ ...dispatchForm, purchase_order_date: e.target.value })} style={inp} /></div>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                        <div><label style={lbl}>Ship Via</label><input value={dispatchForm.ship_via} onChange={e => setDispatchForm({ ...dispatchForm, ship_via: e.target.value })} style={inp} placeholder="SEAHORSE" /></div>
                        <div><label style={lbl}>Vendor Number</label><input value={dispatchForm.vendor_number} onChange={e => setDispatchForm({ ...dispatchForm, vendor_number: e.target.value })} style={inp} placeholder="114395" /></div>
                    </div>

                    {/* Summary */}
                    <div style={{ ...secHdr }}>Summary</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 10, marginBottom: 16 }}>
                        {[
                            { label: 'Pallets', value: enrichedPallets.length, color: '#1e3a8a' },
                            { label: 'Total Qty', value: enrichedPallets.reduce((s, p) => s + p.current_qty, 0).toLocaleString() + ' PCS', color: '#059669' },
                            { label: 'Total Gross Wt', value: enrichedPallets.reduce((s, p) => s + p.gross_weight_kg, 0).toFixed(2) + ' Kg', color: '#d97706' },
                            { label: 'Containers', value: enrichedPallets.reduce((s, p) => s + p.container_count, 0), color: '#7c3aed' },
                        ].map((c, i) => (
                            <div key={i} style={{ padding: '10px 12px', borderRadius: 8, background: '#f8fafc', border: '1px solid #e5e7eb' }}>
                                <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 }}>{c.label}</div>
                                <div style={{ fontSize: 15, fontWeight: 700, color: c.color, fontFamily: 'monospace' }}>{c.value}</div>
                            </div>
                        ))}
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 16 }}>
                        <button onClick={() => setStep('WEIGHTS')} style={{ padding: '10px 24px', borderRadius: 8, background: 'white', color: '#374151', border: '1px solid #d1d5db', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8 }}>
                            <ChevronLeft size={16} /> Back
                        </button>
                        <button onClick={handleGenerateMasterPL} disabled={saving} style={{
                            padding: '10px 24px', borderRadius: 8, background: saving ? '#9ca3af' : '#16a34a', color: 'white',
                            border: 'none', fontWeight: 700, fontSize: 14, cursor: saving ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                        }}>
                            {saving ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Saving...</> : <><CheckCircle2 size={16} /> Finalize & Generate</>}
                        </button>
                    </div>
                </Card>
            )}

            {/* ═══ STEP: GENERATE ═══ */}
            {step === 'GENERATE' && selectedPL && (
                <Card>
                    <div style={{ textAlign: 'center', padding: '32px 24px' }}>
                        <div style={{ width: 64, height: 64, borderRadius: 16, background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px' }}>
                            <CheckCircle2 size={32} style={{ color: '#16a34a' }} />
                        </div>
                        <h2 style={{ color: '#111827', marginBottom: 4 }}>Master Packing List Ready!</h2>
                        <p style={{ fontFamily: 'monospace', fontSize: 18, fontWeight: 800, color: '#1e3a8a', marginBottom: 4 }}>{selectedPL.packing_list_number}</p>
                        <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
                            Invoice: {dispatchForm.invoice_number || '—'} · PO: {dispatchForm.purchase_order_number || '—'} · Ship Via: {dispatchForm.ship_via || '—'}
                        </p>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, maxWidth: 500, margin: '0 auto' }}>
                            <button onClick={handlePrintMasterPL} style={{
                                padding: '16px 20px', borderRadius: 10, background: '#1e3a8a', color: 'white',
                                border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                            }}>
                                <Printer size={24} />
                                <span>Print Master Packing List</span>
                                <span style={{ fontSize: 11, opacity: 0.8 }}>Formal document for dispatch</span>
                            </button>
                            <button onClick={handlePrintPackingRef} style={{
                                padding: '16px 20px', borderRadius: 10, background: '#7c3aed', color: 'white',
                                border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
                            }}>
                                <ClipboardList size={24} />
                                <span>Print Packing Reference</span>
                                <span style={{ fontSize: 11, opacity: 0.8 }}>Inner box packing guide</span>
                            </button>
                        </div>

                        <button onClick={() => { setStep('SELECT'); setSelectedPL(null); setGenerated(false); }} style={{
                            marginTop: 24, padding: '10px 24px', borderRadius: 8, background: 'white', color: '#374151',
                            border: '1px solid #d1d5db', fontWeight: 600, fontSize: 13, cursor: 'pointer',
                        }}>
                            ← Back to Packing List Selection
                        </button>
                    </div>
                </Card>
            )}

            <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
        </div>
    );
}
