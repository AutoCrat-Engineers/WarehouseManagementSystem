/**
 * MasterPackingListHome.tsx — Packing List (integrated PL Print wizard)
 *
 * MPLs are ONLY created from DispatchSelection. No "Create MPL" button here.
 * Each MPL row has: View, Print (enabled after PO+Invoice filled).
 * Clicking a PENDING MPL opens inline wizard: Review → Weights → Invoice/PO Entry.
 * No container_number shown — only Packing Box ID.
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Search, Printer, Eye, XCircle, ChevronLeft, ChevronRight, ChevronDown, Package, FileText, Truck, AlertCircle, CheckCircle2, Clock, RefreshCw, Hash, Box, Loader2, Scale, Edit3, AlertTriangle, Settings, X, Info, ClipboardList } from 'lucide-react';
import { fetchMasterPackingLists, cancelMpl, fetchMplPallets, fetchDispatchAuditLog } from './mplService';
import { generateIdempotencyKey, extractRpcError } from '../../utils/idempotency';
import type { MasterPackingList, MplPallet, MplStatus, DispatchAuditEntry } from './mplService';
import { getSupabaseClient } from '../../utils/supabase/client';
import * as svc from './packingEngineService';
import QRCode from 'qrcode';
import type { PackingSpec } from './packingEngineService';
import { Card, Button, Badge, EmptyState, ModuleLoader, Modal, Label, Input } from '../ui/EnterpriseUI';
import {
    SummaryCard, SummaryCardsGrid,
    FilterBar as SharedFilterBar, ActionBar,
    SearchBox, RefreshButton, StatusFilter, DateRangeFilter,
    ExportCSVButton, Pagination, ClearFiltersButton,
} from '../ui/SharedComponents';

type UserRole = 'L1' | 'L2' | 'L3' | null;
interface Props { accessToken?: string; userRole?: UserRole; userPerms?: Record<string, boolean>; onNavigate?: (view: string, data?: any) => void; }

interface EnrichedPallet {
    id: string; pallet_number: string; item_code: string; item_name: string;
    part_number: string; master_serial_no: string; revision: string; state: string;
    current_qty: number; target_qty: number; container_count: number;
    spec: PackingSpec | null;
    containers: Array<{ packing_id: string; quantity: number; container_type: string; is_adjustment: boolean; operator: string }>;
    gross_weight_kg: number;
    net_weight_kg: number;
    item_weight: number;
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
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [search, setSearch] = useState('');
    const [statusFilter, setStatusFilter] = useState<MplStatus | 'ALL'>('ALL');
    const [cardFilter, setCardFilter] = useState<MplStatus | 'ALL'>('ALL');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');
    const [page, setPage] = useState(0);
    const pageSize = 20;

    // Toast notification (same pattern as ItemMaster/StockMovement)
    const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; title: string; text: string } | null>(null);
    const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const toastKeyRef = useRef(0);
    const showToast = useCallback((type: 'success' | 'error' | 'warning' | 'info', title: string, text: string, duration = 5000) => {
        if (toastTimer.current) clearTimeout(toastTimer.current);
        toastKeyRef.current += 1;
        setToast({ type, title, text });
        toastTimer.current = setTimeout(() => setToast(null), duration);
    }, []);

    // Detail panel
    const [selectedMpl, setSelectedMpl] = useState<MasterPackingList | null>(null);
    const [selectedPallets, setSelectedPallets] = useState<MplPallet[]>([]);
    const [auditLog, setAuditLog] = useState<DispatchAuditEntry[]>([]);
    const [detailLoading, setDetailLoading] = useState(false);
    const [showDetail, setShowDetail] = useState(false);

    // Cancel (type-to-confirm pattern)
    const [cancelTarget, setCancelTarget] = useState<MasterPackingList | null>(null);
    const [cancelReason, setCancelReason] = useState('');
    const [cancelConfirmInput, setCancelConfirmInput] = useState('');
    const [cancelling, setCancelling] = useState(false);

    // Inline wizard state
    const [wizardMpl, setWizardMpl] = useState<MasterPackingList | null>(null);
    const [wizardStep, setWizardStep] = useState<WizardStep>('REVIEW');
    const [enrichedPallets, setEnrichedPallets] = useState<EnrichedPallet[]>([]);
    const [palletDetails, setPalletDetails] = useState<any[]>([]);
    const [plData, setPlData] = useState<any>(null);
    const [dispatchForm, setDispatchForm] = useState({ invoice_number: '', invoice_date: '', purchase_order_number: '', purchase_order_date: '', ship_via: '', mode_of_transport: '' });
    const [wizardLoading, setWizardLoading] = useState(false);
    const [saving, setSaving] = useState(false);

    // BPA auto-suggestion (filtered, sorted by earliest expiry → creation date)
    // Pre-fills purchase_order_number when the wizard opens if field is empty.
    interface BpaSuggestion {
        agreement_id:     string;
        agreement_number: string;
        revision:         number;
        status:           string;
        agreement_date:   string;
        effective_end_date: string;
        pending_quantity: number;
        blanket_quantity: number;
        part_number:      string;
    }
    const [bpaSuggestions, setBpaSuggestions] = useState<BpaSuggestion[]>([]);
    const [bpaDropdownOpen, setBpaDropdownOpen] = useState(false);

    // Summary
    const [summary, setSummary] = useState({ total: 0, pending: 0, printed: 0, dispatched: 0 });


    const updateDispatchField = useCallback((field: string, value: string) => {
        setDispatchForm(prev => ({ ...prev, [field]: value }));
    }, []);

    // Actions dropdown
    const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
    const [dropdownDirection, setDropdownDirection] = useState<'up' | 'down'>('down');
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setActiveDropdown(null);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // ─── Load MPLs ───
    const loadMpls = useCallback(async (isRefresh = false) => {
        try {
            if (!isRefresh && mpls.length === 0) setLoading(true); else setRefreshing(true);
            setError(null);
            const { data, count } = await fetchMasterPackingLists({ status: statusFilter === 'ALL' ? undefined : statusFilter, search: search || undefined, limit: pageSize, offset: page * pageSize });
            setMpls(data); setTotalCount(count);
        } catch (err: any) { setError(err.message); } finally { setLoading(false); setRefreshing(false); }
    }, [statusFilter, search, page]);

    const loadSummary = useCallback(async () => {
        try {
            // BACKEND AGGREGATES: parallel HEAD queries (count-only, no data transfer)
            const sb = getSupabaseClient();
            const [totalR, pendingR, printedR, dispatchedR] = await Promise.all([
                sb.from('master_packing_lists').select('id', { count: 'exact', head: true }),
                sb.from('master_packing_lists').select('id', { count: 'exact', head: true }).eq('status', 'DRAFT'),
                sb.from('master_packing_lists').select('id', { count: 'exact', head: true }).eq('status', 'PRINTED'),
                sb.from('master_packing_lists').select('id', { count: 'exact', head: true }).eq('status', 'DISPATCHED'),
            ]);
            setSummary({
                total: totalR.count ?? 0,
                pending: pendingR.count ?? 0,
                printed: printedR.count ?? 0,
                dispatched: dispatchedR.count ?? 0,
            });
        } catch (err) {
            console.error('[PackingList Summary Error]', err);
        }
    }, []);

    // Explicit refresh handler — shows toast on completion (matching InventoryGrid pattern)
    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        try {
            await Promise.all([
                loadMpls(true),
                loadSummary(),
            ]);
            showToast('info', 'Refreshed', 'Packing list data refreshed successfully.');
        } catch { } finally {
            setRefreshing(false);
        }
    }, [loadMpls, loadSummary, showToast]);

    useEffect(() => { loadMpls(); }, [loadMpls]);
    useEffect(() => { loadSummary(); }, [loadSummary]);



    // ─── Open inline wizard for a PENDING MPL ───
    const handleOpenWizard = async (mpl: MasterPackingList) => {
        setActiveDropdown(null);
        setWizardMpl(mpl); setWizardStep('REVIEW'); setWizardLoading(true);
        try {
            const plId = mpl.packing_list_id;
            let data = await svc.fetchPackingListData(plId);
            if (!data) { data = await svc.upsertPackingListData(plId, {}); await svc.autoPopulatePalletDetails(plId, data.id); }
            setPlData(data);
            const mot = data.mode_of_transport || ''; setDispatchForm({ invoice_number: data.invoice_number || '', invoice_date: data.invoice_date || '', purchase_order_number: data.purchase_order_number || '', purchase_order_date: data.purchase_order_date || '', ship_via: data.ship_via || '', mode_of_transport: mot === 'OCEAN' ? 'SEA' : mot });
            let details = await svc.fetchPackingListPalletDetails(data.id);
            if (details.length === 0) {
                details = await svc.autoPopulatePalletDetails(plId, data.id);
            }
            setPalletDetails(details);
            const { data: plItems } = await supabase.from('pack_packing_list_items').select('pallet_id').eq('packing_list_id', plId);
            const palletIds = (plItems || []).map((i: any) => i.pallet_id);
            if (palletIds.length > 0) {
                const { data: pallets } = await supabase.from('pack_pallets').select('*, items!pack_pallets_item_id_fkey (item_name, master_serial_no, part_number, revision, weight)').in('id', palletIds);
                const { data: pcJoin } = await supabase.from('pack_pallet_containers').select(`pallet_id, position_sequence, pack_containers!inner (quantity, container_type, is_adjustment, packing_box_id, profiles!pack_containers_created_by_fkey (full_name), packing_boxes:packing_box_id (packing_id))`).in('pallet_id', palletIds).order('position_sequence');
                const itemCodes = [...new Set((pallets || []).map((p: any) => p.item_code))];
                const specMap: Record<string, PackingSpec> = {};
                for (const ic of itemCodes) { const spec = await svc.getPackingSpecForItem(ic); if (spec) specMap[ic] = spec; }
                const enriched: EnrichedPallet[] = (pallets || []).map((p: any) => {
                    const pContainers = (pcJoin || []).filter((pc: any) => pc.pallet_id === p.id);
                    const detail = details.find((d: any) => d.pallet_id === p.id);
                    return {
                        id: p.id, pallet_number: p.pallet_number, item_code: p.item_code,
                        item_name: p.items?.item_name || p.item_code, part_number: p.items?.part_number || '', master_serial_no: p.items?.master_serial_no || '', revision: p.items?.revision || '',
                        state: p.state, current_qty: p.current_qty, target_qty: p.target_qty, container_count: p.container_count,
                        spec: specMap[p.item_code] || null,
                        containers: pContainers.map((pc: any) => ({ packing_id: pc.pack_containers?.packing_boxes?.packing_id || '—', quantity: pc.pack_containers?.quantity || 0, container_type: pc.pack_containers?.container_type || '', is_adjustment: pc.pack_containers?.is_adjustment || false, operator: pc.pack_containers?.profiles?.full_name || '—' })),
                        item_weight: Number(p.items?.weight || 0),
                        net_weight_kg: (Number(p.items?.weight || 0) * (p.current_qty || 0)) / 1000,
                        gross_weight_kg: 0,
                    };
                });
                setEnrichedPallets(enriched);

                // ── BPA auto-suggestion ──────────────────────────────────────
                // For the distinct part_numbers on this MPL, find eligible BPAs:
                //   status in ACTIVE / AMENDED, not expired, pending qty > 0.
                // Sort: effective_end_date ASC (expiring first), then
                // created_at ASC (oldest first). Pre-fill the BPA input with
                // the first suggestion if it's currently empty.
                try {
                    const partNumbers = [...new Set(
                        (enriched || []).map((p) => p.part_number || p.item_code).filter(Boolean)
                    )];
                    if (partNumbers.length > 0) {
                        const today = new Date().toISOString().slice(0, 10);
                        const { data: agrParts } = await supabase
                            .from('customer_agreement_parts')
                            .select(`
                                part_number,
                                blanket_quantity,
                                agreement:customer_agreements!inner (
                                    id, agreement_number, agreement_revision,
                                    status, agreement_date, effective_end_date, created_at
                                )
                            `)
                            .in('part_number', partNumbers)
                            .eq('is_active', true);

                        const agreementIds = [...new Set(
                            (agrParts || []).map((r: any) => r.agreement?.id).filter(Boolean)
                        )];
                        // Also fetch line config for pending_quantity (per agreement × part)
                        const { data: lcs } = agreementIds.length > 0 ? await supabase
                            .from('blanket_order_line_configs')
                            .select('agreement_id, part_number, pending_quantity')
                            .in('agreement_id', agreementIds)
                            .in('part_number', partNumbers)
                            : { data: [] as any[] };
                        const pendingMap = new Map<string, number>();
                        for (const lc of (lcs || [])) {
                            pendingMap.set(`${lc.agreement_id}|${lc.part_number}`, lc.pending_quantity ?? 0);
                        }

                        const suggestions: BpaSuggestion[] = ((agrParts || []) as any[])
                            .map((r: any) => {
                                const a = r.agreement || {};
                                // Fallback pending = full blanket qty if no line config yet
                                const pending = pendingMap.has(`${a.id}|${r.part_number}`)
                                    ? pendingMap.get(`${a.id}|${r.part_number}`)!
                                    : (r.blanket_quantity ?? 0);
                                return {
                                    agreement_id:       a.id,
                                    agreement_number:   a.agreement_number,
                                    revision:           a.agreement_revision ?? 0,
                                    status:             a.status,
                                    agreement_date:     a.agreement_date,
                                    effective_end_date: a.effective_end_date,
                                    pending_quantity:   pending,
                                    blanket_quantity:   r.blanket_quantity ?? 0,
                                    part_number:        r.part_number,
                                };
                            })
                            // Filter: eligible to ship against
                            .filter((s) =>
                                ['ACTIVE', 'AMENDED'].includes(s.status) &&
                                s.effective_end_date >= today &&
                                s.pending_quantity > 0
                            )
                            // Sort: soonest to expire, then oldest agreement first
                            .sort((a, b) => {
                                if (a.effective_end_date !== b.effective_end_date) {
                                    return a.effective_end_date < b.effective_end_date ? -1 : 1;
                                }
                                return a.agreement_date.localeCompare(b.agreement_date);
                            });

                        setBpaSuggestions(suggestions);

                        // Pre-fill if field is empty and we have a top suggestion
                        if (suggestions.length > 0) {
                            setDispatchForm((prev) => ({
                                ...prev,
                                purchase_order_number: prev.purchase_order_number
                                    || suggestions[0].agreement_number,
                                purchase_order_date: prev.purchase_order_date
                                    || suggestions[0].agreement_date,
                            }));
                        }
                    } else {
                        setBpaSuggestions([]);
                    }
                } catch (bpaErr) {
                    // Non-critical — BPA field stays manual
                    console.warn('[BPA suggestions] fetch failed:', bpaErr);
                    setBpaSuggestions([]);
                }
            }
        } catch (err: any) { setError(err.message); } finally { setWizardLoading(false); }
    };

    const handleWeightChange = (palletId: string, weight: number) => {
        setEnrichedPallets(prev => prev.map(p => p.id === palletId ? { ...p, gross_weight_kg: weight } : p));
    };

    // Save PO/Invoice + weights → confirm MPL
    const handleSaveAndConfirm = async () => {
        if (!wizardMpl || !plData) return;
        if (!dispatchForm.invoice_number || !dispatchForm.purchase_order_number) { setError('Invoice Number and BPA Number are required'); return; }
        setSaving(true); setError(null);
        try {
            const idempotencyKey = generateIdempotencyKey();
            const palletWeights = enrichedPallets.map(ep => ({
                pallet_id: ep.id,
                net_weight_kg: ep.net_weight_kg,
                gross_weight_kg: ep.gross_weight_kg,
            }));

            // ═══ PRODUCTION-GRADE ═══
            // Single atomic RPC: saves PL data + pallet weights + MPL update + confirm
            // All within one Postgres transaction. If anything fails, everything rolls back.
            const { data, error } = await supabase.rpc('confirm_mpl_with_data', {
                p_mpl_id: wizardMpl.id,
                p_user_id: (await supabase.auth.getUser()).data.user?.id,
                p_invoice_number: dispatchForm.invoice_number,
                p_invoice_date: dispatchForm.invoice_date || null,
                p_purchase_order_number: dispatchForm.purchase_order_number,
                p_purchase_order_date: dispatchForm.purchase_order_date || null,
                p_ship_via: dispatchForm.ship_via || null,
                p_mode_of_transport: dispatchForm.mode_of_transport || null,
                p_pallet_weights: palletWeights,
                p_idempotency_key: idempotencyKey,
            });

            const rpcError = extractRpcError(error, data);
            if (rpcError) throw new Error(rpcError);

            showToast('success', 'Packing List Confirmed', `${wizardMpl.mpl_number} details saved & confirmed — Print is now enabled`);
            setWizardMpl(null); loadMpls(true); loadSummary();
        } catch (err: any) { showToast('error', 'Save Failed', err.message); } finally { setSaving(false); }
    };

    // Print MPL
    const handlePrintMpl = async (mpl: MasterPackingList) => {
        try {
            const bt = await svc.getPackingListFullBacktrack(mpl.packing_list_id);
            // ═══ PRODUCTION-GRADE ═══
            // Atomic RPC: marks printed + increments print_count in single SQL statement
            // Fixes read-modify-write race condition on print_count
            const { data, error } = await supabase.rpc('mark_mpl_printed', {
                p_mpl_id: mpl.id,
                p_user_id: (await supabase.auth.getUser()).data.user?.id,
            });
            const rpcError = extractRpcError(error, data);
            if (rpcError) throw new Error(rpcError);

            // Execute all network requests BEFORE opening the print popup
            await loadMpls(true);
            await loadSummary();
            showToast('success', 'Printed', `${mpl.mpl_number} has been printed`);

            await openMasterPLPrint(bt, mpl);
        } catch (err: any) { showToast('error', 'Print Failed', err.message); }
    };

    const openMasterPLPrint = async (bt: any, mpl: MasterPackingList) => {
        const hd = bt.headerData;
        const details = bt.palletDetails;
        const ts = new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
        const nowStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ', ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
        const invDate = hd?.invoice_date ? new Date(hd.invoice_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
        const poDate = hd?.purchase_order_date ? new Date(hd.purchase_order_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
        const totalNet = details.reduce((s: number, d: any) => s + Number(d.net_weight_kg || 0), 0);
        const totalGross = details.reduce((s: number, d: any) => s + Number(d.gross_weight_kg || 0), 0);
        const totalQty = details.reduce((s: number, d: any) => s + (d.qty_per_pallet || 0), 0);
        const totalPkgs = details.length;

        const D = {
            expName: hd?.exporter_name || 'AUTOCRAT ENGINEERS',
            expAddr: hd?.exporter_address || '264 KIADB Hi tech Defence Aerospace Park, Phase-2,\nRoad No 10& 17, Polanahalli,\nDevanahalli-562135',
            expPhone: hd?.exporter_phone || 'PH 91 80 43330127',
            expEmail: hd?.exporter_email || 'dispatch@autocratengineers.in',
            expGstin: hd?.exporter_gstin || '29ABLPK6831H1ZB',
            expRef: hd?.exporter_ref || '-NIL-',
            expIec: hd?.exporter_iec_code || '0702002747',
            expAd: hd?.exporter_ad_code || '6361504-8400009',
            vendorNo: hd?.vendor_number || '114395',
            conName: hd?.consignee_name || 'Milano Millworks, LLC',
            conAddr: (hd?.consignee_address || '9223 Industrial Blvd NE Leland\nNC 28451 USA').replace('8223', '9223'),
            conPhone: hd?.consignee_phone || '(910) 443-3075',
            buyName: hd?.buyer_name || 'Brown, Sherry',
            buyPhone: hd?.buyer_phone || '919-209-2411',
            buyEmail: hd?.buyer_email || 'sherry.brown@opwglobal.com',
            billName: hd?.bill_to_name || 'OPW Fueling Components, LLC',
            billAddr: hd?.bill_to_address || '3250 US Highway 70 Business West\nSmithfield, NC 27577\nUnited States',
            preCarr: (hd?.pre_carriage_by || 'ROAD').toUpperCase(),
            receipt: (hd?.place_of_receipt || 'BANGALORE, INDIA').toUpperCase(),
            origin: (hd?.country_of_origin || 'INDIA').toUpperCase(),
            dest: (hd?.country_of_destination || 'UNITED STATES').toUpperCase(),
            portLoad: (hd?.port_of_loading || 'BANGALORE, INDIA').replace(/BANGALORE, ICD/i, 'BANGALORE, INDIA').toUpperCase(),
            delivery: hd?.terms_of_delivery || 'DDP',
            payment: hd?.payment_terms || 'Net-30',
            portDisc: (hd?.port_of_discharge || 'CHARLESTON, USA').toUpperCase(),
            finalDest: (hd?.final_destination && hd.final_destination.toUpperCase() !== 'CHARLESTON') ? hd.final_destination.toUpperCase() : 'UNITED STATES',
            transport: (() => { const t = hd?.mode_of_transport || 'SEA'; return (t === 'OCEAN' ? 'SEA' : t).toUpperCase(); })(),
            itemHdr: hd?.item_description_header || 'PRECISION MACHINED COMPONENTS',
            itemSub: hd?.item_description_sub_header || '(OTHERS FUELING COMPONENTS)',
        };

        const formatDescText = (text: string, extMsn: string) => {
            let out = text;
            const match = out.match(/\s*(\([^)]+\))\s*$/);
            if (match) {
                const safeStr = match[1].replace(/-/g, '&#8209;');
                out = out.replace(/\s*(\([^)]+\))\s*$/, ` <span class="mono" style="white-space:nowrap;display:inline-block">${safeStr}</span>`);
            }
            if (extMsn) {
                const safeExt = extMsn.replace(/-/g, '&#8209;');
                out += ` <span class="mono" style="white-space:nowrap;display:inline-block">(${safeExt})</span>`;
            }
            return out;
        };

        const itemRows = details.map((d: any, idx: number) => {
            const dim = d.pallet_length_cm && d.pallet_width_cm && d.pallet_height_cm
                ? `${Math.round(d.pallet_length_cm)} X ${Math.round(d.pallet_width_cm)} X ${Math.round(d.pallet_height_cm)}` : '\u2014';
            return `<tr>
<td class="br c4 ctr">${idx + 1}</td>
<td class="br c4">${d.pallet_number || ''}</td>
<td class="br c4"><div style="font-size:14px;font-weight:800">${d.part_number || ''}</div><div style="font-size:12px">${formatDescText(d.item_name || d.item_code || '', d.master_serial_no)}</div></td>

<td class="br c4 ctr">${dim}</td>
<td class="br c4 ctr">${d.part_revision || '\u2014'}</td>
<td class="br c4 rgt mono">${(d.qty_per_pallet || 0).toLocaleString()}</td>
<td class="br c4 rgt mono">${Number(d.net_weight_kg || 0).toFixed(2)}</td>
<td class="c4 rgt mono"><b>${Number(d.gross_weight_kg || 0).toFixed(2)}</b></td></tr>`;
        }).join('');

        const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>PL-${mpl.mpl_number}</title>
<style>
@page{size:A4 portrait;margin:6mm}
*{margin:0;padding:0;box-sizing:border-box}
html,body{font-family:Calibri,'Segoe UI',Verdana,Geneva,sans-serif;color:#000;font-size:11px;line-height:1.2;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;height:100%}
b{font-weight:700}
table{border-collapse:collapse;width:100%}
td,th{vertical-align:top}
.outer{border:1.5px solid #000;display:flex;flex-direction:column;height:calc(100vh - 10mm)}
.grow{flex:1}
.bb{border-bottom:1px solid #000}
.br{border-right:1px solid #000}
.bt{border-top:1px solid #000}
.c4{padding:3px 5px}
.ctr{text-align:center}
.rgt{text-align:right}
.sm{font-size:9px;color:#555}
.lbl{font-size:11px;font-weight:700}
.mono{font-family:'Courier New',monospace}
.wm{position:fixed;top:46%;left:50%;transform:translate(-50%,-50%) rotate(-35deg);font-size:56px;font-weight:900;color:rgba(0,0,0,.035);letter-spacing:10px;text-transform:uppercase;pointer-events:none;z-index:0;white-space:nowrap}
@media print{.no-print{display:none!important}@page{size:A4 portrait;margin:6mm}}
</style></head><body>
<div class="wm">AUTOCRAT ENGINEERS</div>

<table><tr>
<td class="c4" style="font-size:9px">${nowStr}</td>
<td class="c4 ctr" style="font-size:9px">PL-${mpl.mpl_number}</td>
<td class="c4 rgt" style="font-size:9px"></td>
</tr></table>

<div class="outer">

<table><tr style="position:relative"><td class="bb c4" style="padding:6px 8px;width:30%"><img src="/logo.png" alt="AUTOCRAT ENGINEERS" style="height:34px;object-fit:contain" onerror="this.outerHTML='<span style=font-size:11px;font-weight:800>AUTOCRAT<br>ENGINEERS</span>'" /></td><td class="bb c4" style="padding:8px;width:70%"><div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;pointer-events:none"><span style="font-size:20px;font-weight:800;letter-spacing:5px;text-transform:uppercase;font-style:italic">PACKING LIST</span></div></td></tr></table>

<table>
<colgroup><col style="width:40%"/><col style="width:20%"/><col style="width:40%"/></colgroup>
<tr>
<td class="bb br c4" rowspan="5" style="vertical-align:top;padding:4px 6px">
<div style="display:flex;justify-content:space-between;align-items:baseline;padding:2px 0">
<span style="font-size:12px;font-weight:700">Exporter</span>
<span style="font-size:11px;font-weight:700;color:#555; font-family:'Courier New'">Vendor No : <span style="font-size:12px;font-weight:700;color:#555;font-family:'Courier New'">${D.vendorNo}</span></span>
</div>
<div style="padding:3px 0;line-height:1.5">
<div style="font-size:13px;font-weight:800">${D.expName}</div>
<div style="font-size:12px">264 KIADB Hi tech Defence Aerospace Park, Phase-2,</div>
<div style="font-size:12px">Road No 10&amp; 17, Polanahalli,</div>
<div style="font-size:12px">Devanahalli-562135</div>
<div style="font-size:12px">GSTIN : ${D.expGstin}</div>
</div>
</td>
<td class="bb br c4" style="font-size:12px;font-weight:700;padding:4px 6px">BPA Number & Date :</td>
<td class="bb c4" style="padding:4px 6px"><div style="font-size:13px;font-weight:700">${hd?.purchase_order_number || ''}</div><div style="font-size:12px;color:#333;margin-top:1px">${poDate || ''}</div></td>
</tr>
<tr>
<td class="bb br c4" style="font-size:12px;font-weight:700;padding:4px 6px">Invoice No. & Date :</td>
<td class="bb c4" style="padding:4px 6px"><div style="font-size:13px;font-weight:700">${hd?.invoice_number || ''}</div><div style="font-size:12px;color:#333;margin-top:1px">${invDate || ''}</div></td>
</tr>
<tr>
<td class="bb br c4" style="font-size:12px;font-weight:700;padding:4px 6px">AD Code No :</td>
<td class="bb c4" style="font-size:13px;padding:4px 6px;font-family:'Courier New',monospace">${D.expAd}</td>
</tr>
<tr>
<td class="bb br c4" style="font-size:12px;font-weight:700;padding:4px 6px">IEC Code No :</td>
<td class="bb c4" style="font-size:13px;padding:4px 6px;font-family:'Courier New',monospace">${D.expIec}</td>
</tr>
<tr>
<td class="bb br c4" style="font-size:12px;font-weight:700;padding:4px 6px">Terms of Delivery & Payment :</td>
<td class="bb c4" style="font-size:13px;padding:4px 6px">${D.delivery}</td>
</tr>
<tr>
<td class="bb br c4" style="vertical-align:top;padding:4px 6px">
<div style="font-size:12px;font-weight:700;padding:2px 0">Consignee</div>
<div style="padding:3px 0;line-height:1.5">
<div style="font-size:13px;font-weight:700">${D.conName}</div>
<div style="font-size:11px">${D.conAddr.replace(/\n/g, '<br/>')}</div>
<div style="font-size:11px">Telephone: +1 ${D.conPhone}</div>
</div>
</td>
<td class="bb br c4" style="font-size:12px;font-weight:700;padding:4px 6px;vertical-align:top">Buyer Details :</td>
<td class="bb c4" style="font-size:13px;padding:4px 6px;vertical-align:top"><div style="font-weight:700">${D.buyName}</div><div style="font-size:11px;color:#333;margin-top:2px">+1 ${D.buyPhone}</div><div style="font-size:11px;color:#333;margin-top:1px">${D.buyEmail}</div></td>
</tr>
</table>

<table>
<colgroup><col style="width:20%"/><col style="width:20%"/><col style="width:20%"/><col style="width:20%"/><col style="width:20%"/></colgroup>
<tr>
<td class="bb br c4" style="padding:5px 6px"><span style="font-size:12px;font-weight:700">Freight Forwarder</span><br/><span style="font-size:13px;font-weight:700">${hd?.ship_via || 'WEISS ROHLING INDIA'}</span></td>
<td class="bb br c4" style="padding:5px 6px"><span style="font-size:12px;font-weight:700">Mode of Transport</span><br/><span style="font-size:13px;font-weight:700">${D.transport}</span></td>
<td class="bb br c4" style="padding:5px 6px"><span style="font-size:12px;font-weight:700">Country of Origin</span><br/><span style="font-size:13px;font-weight:700">${D.origin}</span></td>
<td class="bb br c4" style="padding:5px 6px"><span style="font-size:12px;font-weight:700">Port of Loading</span><br/><span style="font-size:13px;font-weight:700">${D.portLoad}</span></td>
<td class="bb c4" style="padding:5px 6px"><span style="font-size:12px;font-weight:700">Port of Discharge</span><br/><span style="font-size:13px;font-weight:700">${D.portDisc}</span></td>
</tr>
</table>

<table><tr><td class="bb c4 ctr" style="padding:5px;font-weight:800;font-size:10px;text-transform:uppercase;letter-spacing:1px">${D.itemHdr}<br/><span style="font-weight:700;font-size:9px">${D.itemSub}</span></td></tr></table>

<div class="grow" style="overflow:hidden;border-bottom:1px solid #000">
<table style="table-layout:fixed;width:100%">
<colgroup><col style="width:5%"/><col style="width:15%"/><col style="width:22%"/><col style="width:14%"/><col style="width:6%"/><col style="width:12%"/><col style="width:12%"/><col style="width:14%"/></colgroup>
<tr style="background:#f5f5f5">
<th class="bb br c4 lbl ctr">SL NO</th>
<th class="bb br c4 lbl" style="text-align:left">Box No.</th>
<th class="bb br c4 lbl" style="text-align:left">Part No. & Description</th>

<th class="bb br c4 lbl ctr">Dimensions (cm)</th>
<th class="bb br c4 lbl ctr">Part Rev</th>
<th class="bb br c4 lbl rgt" style="white-space:nowrap">Qty in pallet (Nos)</th>
<th class="bb br c4 lbl rgt">Net Wt (kg)</th>
<th class="bb c4 lbl rgt">Gross Wt (kg)</th>
</tr>
${itemRows}
<tr><td class="br" style="height:2000px"></td><td class="br"></td><td class="br"></td><td class="br"></td><td class="br"></td><td class="br"></td><td class="br"></td><td></td></tr>
</table>
</div>


<table style="table-layout:fixed;width:100%">
<colgroup><col style="width:5%"/><col style="width:15%"/><col style="width:22%"/><col style="width:14%"/><col style="width:6%"/><col style="width:12%"/><col style="width:12%"/><col style="width:14%"/></colgroup>
<tr style="background:#f5f5f5">
<td class="bt br c4"></td>
<td class="bt br c4" colspan="2" style="font-weight:800;font-size:12px">Total</td>
<td class="bt br c4 ctr mono" style="font-weight:800">${String(totalPkgs).padStart(2, '0')}</td>
<td class="bt br c4"></td>
<td class="bt br c4 rgt mono" style="font-weight:800">${totalQty.toLocaleString()}</td>
<td class="bt br c4 rgt mono" style="font-weight:800">${totalNet.toFixed(2)}</td>
<td class="bt c4 rgt mono" style="font-weight:800">${totalGross.toFixed(2)}</td>
</tr>
</table>

<table style="border-top:1.5px solid #000">
<colgroup><col style="width:50%"/><col style="width:50%"/></colgroup>
<tr>
<td class="bb c4" style="font-size:11px;font-weight:700;padding:5px 6px;vertical-align:top">ITC HS CODE: <span class="mono" style="font-weight:800">84139190</span><br/>HTS US Code : <span class="mono" style="font-weight:800">8413919085</span></td>
<td class="bb c4 rgt" style="vertical-align:top;padding:4px 5px">
<div style="font-size:10px;font-weight:700">for AUTOCRAT ENGINEERS</div>
<div style="margin-top:12px;font-size:9px;font-style:italic">Authorised Signatory</div>
</td>
</tr>
<tr>
<td class="c4 ctr" colspan="2" style="padding:6px 5px">
<div style="font-size:9px;text-align:center;color:#c00;font-weight:700;margin-top:2px">The Supply is under EPCG License No: 0731011353 Date 24/05/2024</div>
<div style="font-size:9px;text-align:center;font-weight:700;margin-top:2px">SUPPLY MEANT FOR EXPORT UNDER LETTER OF UNDERTAKING WITHOUT PAYMENT OF INTEGRATED TAX(IGST) LUT</div>
<div style="font-size:9px;text-align:center;margin-top:2px">No.AD2903251644306 Dated 29/03/2025</div>
</td>
</tr>
</table>

</div>

<table style="margin-top:4px"><tr>
<td class="c4" style="font-size:9px;color:#666;width:33%">MPL#: ${mpl.mpl_number}</td>
<td class="c4 ctr" style="font-size:9px;color:#666;width:34%">Printed: ${ts}</td>
<td class="c4 rgt" style="font-size:9px;color:#666;width:33%">System-generated packing list \u2014 dispatch audit record</td>
</tr></table>

<script>window.onload=function(){window.print();}<\/script></body></html>`;

        // ── Generate QR codes for each pallet ──
        // Payload v2: line-delimited tokens. PALLET:<uuid> is the first line so it
        // survives scanner truncation. Edge function `pallet_resolve_qr` parses this.
        // Legacy pipe format (`mpl|pn|name|msn|qty`) is still resolvable server-side
        // by best-effort field match for stickers printed before this change.
        const containerTrace = bt.containerTrace || [];
        const barcodeMap: Record<string, string> = {};
        for (const d of details) {
            const palletId = d.pallet_id || d.id || '';
            const palletNumber = d.pallet_number || '';
            const qrData = [
                `PALLET:${palletId}`,
                `MPL:${mpl.mpl_number}`,
                `PN:${palletNumber}`,
                `PART:${d.part_number || ''}`,
                `ITEM:${d.item_name || d.item_code || ''}`,
                `MSN:${d.master_serial_no || ''}`,
                `QTY:${d.qty_per_pallet || 0}`,
                `V:2`,
            ].join('\n');
            try {
                barcodeMap[palletId] = await QRCode.toDataURL(qrData, {
                    width: 150,
                    margin: 1,
                    errorCorrectionLevel: 'M',
                    color: { dark: '#000000', light: '#ffffff' },
                });
            } catch { barcodeMap[palletId] = ''; }
        }

        // ── Build pallet slip pages ──
        const palletSlips = details.map((d: any, idx: number) => {
            const palletId = d.pallet_id || d.id || '';
            const barcodeImg = barcodeMap[palletId] || '';
            const dim = d.pallet_length_cm && d.pallet_width_cm && d.pallet_height_cm
                ? `${Math.round(d.pallet_length_cm)} X ${Math.round(d.pallet_width_cm)} X ${Math.round(d.pallet_height_cm)}` : '';
            const palletNum = d.pallet_number || '';
            return `
<div style="page-break-before:always;padding:24px 28px;font-family:Calibri,'Segoe UI',Arial,sans-serif;font-size:18px;color:#000;height:calc(100vh - 10mm);display:flex;flex-direction:column;box-sizing:border-box">

<div style="display:flex;justify-content:space-between;align-items:flex-end;padding-bottom:14px;position:relative">
<img src="/logo.png" alt="AE" style="height:50px" onerror="this.style.display='none'" />
<div style="text-align:right">
<div style="font-size:36px;font-weight:900;letter-spacing:4px;color:#000;line-height:1">PALLET SLIP</div>
</div>
</div>

<div style="display:flex;padding:10px 0;border-top:2px solid #ddd;border-bottom:2px solid #ddd;margin-bottom:14px">
<div style="flex:1;padding-right:20px">
<div style="font-weight:800;font-size:16px;text-transform:uppercase;color:#888;margin-bottom:4px">FROM</div>
<div style="font-weight:800;font-size:18px">${D.expName}</div>
<div style="font-size:15px;line-height:1.5;color:#333">${D.expAddr.replace(/\\n|\n/g, '<br/>')}</div>
</div>
<div style="flex:1;padding-left:20px">
<div style="font-weight:800;font-size:16px;text-transform:uppercase;color:#888;margin-bottom:4px">TO</div>
<div style="font-weight:800;font-size:18px">${D.billName}</div>
<div style="font-size:15px;line-height:1.5;color:#333">${D.conName}<br/>${D.conAddr.replace(/\\n|\n/g, '<br/>')}</div>
</div>
</div>

<div style="text-align:center;padding:14px 0 10px;border-bottom:2px solid #ddd;margin-bottom:14px">
<div style="font-size:56px;font-weight:900;letter-spacing:1px">${d.part_number || ''} ${d.part_revision ? '(Rev-' + d.part_revision + ')' : ''}</div>
<div style="font-size:28px;color:#333;margin-top:4px">${d.item_name || d.item_code || ''} &middot; ${d.master_serial_no ? '[' + d.master_serial_no + ']' : ''}</div>
</div>

<div style="background:#f2f2f2;border:2px solid #ddd;padding:20px 22px;flex:1;display:flex;flex-direction:column;justify-content:space-between;margin-bottom:14px">
<div style="display:flex;margin-bottom:16px">
<div style="flex:1">
<div style="font-weight:700;font-size:20px;text-transform:uppercase;color:#888">INVOICE & DATE</div>
<div style="font-size:40px;font-weight:900;margin-top:4px">${hd?.invoice_number || ''}</div>
<div style="font-size:22px;font-weight:500;color:#555;margin-top:2px">${invDate || ''}</div>
</div>
<div style="flex:1;text-align:right">
<div style="font-weight:700;font-size:20px;text-transform:uppercase;color:#888">BPA NO. & DATE</div>
<div style="font-size:40px;font-weight:900;margin-top:4px">${hd?.purchase_order_number || ''}</div>
<div style="font-size:22px;font-weight:500;color:#555;margin-top:2px">${poDate || ''}</div>
</div>
</div>
<div style="text-align:center;margin-bottom:16px">
<div style="font-weight:700;font-size:20px;text-transform:uppercase;color:#888">QTY in No's</div>
<div style="font-size:80px;font-weight:900;margin-top:4px;line-height:1">${(d.qty_per_pallet || 0).toLocaleString()}</div>
</div>
<div style="display:flex;margin-bottom:14px">
<div style="flex:1">
<div style="font-weight:700;font-size:20px;text-transform:uppercase;color:#888">NET WEIGHT</div>
<div style="font-size:36px;font-weight:800;margin-top:4px">${Number(d.net_weight_kg || 0).toFixed(2)} Kgs</div>
</div>
<div style="flex:1;text-align:right">
<div style="font-weight:700;font-size:20px;text-transform:uppercase;color:#888">GROSS WEIGHT</div>
<div style="font-size:36px;font-weight:800;margin-top:4px">${Number(d.gross_weight_kg || 0).toFixed(2)} Kgs</div>
</div>
</div>
<div style="display:flex;padding-top:12px;border-top:2px solid #ddd">
<div style="flex:1">
<div style="font-weight:700;font-size:20px;text-transform:uppercase;color:#888">ORIGIN</div>
<div style="font-size:28px;font-weight:800;margin-top:3px">${D.origin}</div>
</div>
<div style="flex:1;text-align:center">
<div style="font-weight:700;font-size:20px;text-transform:uppercase;color:#888">HTS US CODE</div>
<div style="font-size:28px;font-weight:800;margin-top:3px">${(d.hts_code || '8413919085').replace(/^84139190$/, '8413919085')}</div>
</div>
<div style="flex:1;text-align:right">
<div style="font-weight:700;font-size:20px;text-transform:uppercase;color:#888">LOGISTICS</div>
<div style="font-size:28px;font-weight:800;margin-top:3px">${hd?.ship_via || 'SEAHORSE BY SEA'}</div>
</div>
</div>
</div>

<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:8px 0">
${barcodeImg ? '<img src="' + barcodeImg + '" style="width:120px;height:120px" />' : ''}
<div style="font-size:24px;font-weight:900;color:#000;margin-top:6px;letter-spacing:1px">${palletNum}</div>
</div>

<div style="display:flex;justify-content:space-between;align-items:flex-end;font-size:12px;color:#aaa;padding-top:4px;border-top:1px solid #eee;margin-top:auto">
<div>Slip ${idx + 1} of ${details.length}</div>
<div style="text-align:right">
<div style="font-weight:700;font-size:13px;color:#555;text-transform:uppercase">WWW.AUTOCRATENGINEERS.IN</div>
</div>
</div>

</div>`;
        }).join('');

        // ── Combine: Packing List + Pallet Slips ──
        const fullHtml = html.replace('</body></html>', palletSlips + '<script>window.onload=function(){setTimeout(function(){window.print();}, 500);}<\\/script></body></html>');
        // Remove the first script tag (already in packing list html)
        const cleanHtml = fullHtml.replace(/<script>window\.onload=function\(\)\{window\.print\(\);\}<\\\/script>/, '');

        const w = window.open('', '_blank', 'width=900,height=1100');
        if (w) { w.document.write(cleanHtml); w.document.close(); }
    };


    // View Detail
    const handleViewDetail = async (mpl: MasterPackingList) => {
        setActiveDropdown(null);
        setSelectedMpl(mpl); setShowDetail(true); setDetailLoading(true);
        try {
            const [pallets, audit] = await Promise.all([fetchMplPallets(mpl.id), fetchDispatchAuditLog(mpl.id, 'MASTER_PACKING_LIST')]);
            setSelectedPallets(pallets); setAuditLog(audit);
        } catch (err: any) { setError(err.message); } finally { setDetailLoading(false); }
    };

    const handleCancelConfirm = async () => {
        if (!cancelTarget) return;
        if (cancelConfirmInput.trim() !== cancelTarget.mpl_number) return;
        if (!cancelReason.trim()) return;
        try { setCancelling(true); await cancelMpl(cancelTarget.id, cancelReason || undefined); setCancelTarget(null); setCancelReason(''); setCancelConfirmInput(''); showToast('success', 'Packing List Cancelled', `${cancelTarget.mpl_number} has been cancelled successfully`); loadMpls(true); loadSummary(); } catch (err: any) { showToast('error', 'Cancel Failed', err.message); } finally { setCancelling(false); }
    };

    const isMplReady = (mpl: MasterPackingList) => !!(mpl.invoice_number && mpl.po_number);
    const totalPages = Math.ceil(totalCount / pageSize);

    const StatusBadge = ({ status }: { status: string }) => {
        const s: Record<string, { bg: string; color: string; label: string }> = { DRAFT: { bg: '#fef3c7', color: '#92400e', label: 'PENDING' }, CONFIRMED: { bg: '#dbeafe', color: '#1d4ed8', label: 'CONFIRMED' }, PRINTED: { bg: '#d1fae5', color: '#059669', label: 'PRINTED' }, DISPATCHED: { bg: '#ede9fe', color: '#7c3aed', label: 'DISPATCHED' }, CANCELLED: { bg: '#fee2e2', color: '#dc2626', label: 'CANCELLED' } };
        const st = s[status] || s.DRAFT;
        return <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '4px 10px', borderRadius: 12, fontSize: 11, fontWeight: 700, backgroundColor: st.bg, color: st.color, minWidth: 90, textAlign: 'center', whiteSpace: 'nowrap', letterSpacing: '0.3px' }}>{st.label}</span>;
    };

    const thS: React.CSSProperties = { padding: '12px 16px', textAlign: 'left', fontSize: 12, fontWeight: 600, color: 'var(--enterprise-gray-700)', textTransform: 'uppercase', letterSpacing: '0.5px', whiteSpace: 'nowrap' };
    const tdS: React.CSSProperties = { padding: '12px 16px', fontSize: 13, color: 'var(--enterprise-gray-800)' };
    const inp: React.CSSProperties = { width: '100%', padding: '8px 12px', border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, outline: 'none' };
    const lbl: React.CSSProperties = { fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 4 };

    // Expanded pallets in wizard review (collapsible like pallet dashboard)
    const [expandedWizardPallets, setExpandedWizardPallets] = useState<Set<string>>(new Set());
    const toggleWizardPallet = (id: string) => setExpandedWizardPallets(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });

    // ═══════════════════════════════════════════════════════════════
    // RENDER — INLINE WIZARD (takes over when wizardMpl is set)
    // ═══════════════════════════════════════════════════════════════
    if (wizardMpl) {
        const steps: { key: WizardStep; label: string }[] = [
            { key: 'REVIEW', label: 'Review Pallets' },
            { key: 'WEIGHTS', label: 'Gross Weights' },
            { key: 'DISPATCH', label: 'Invoice & PO' },
        ];
        const currentStepIdx = steps.findIndex(s => s.key === wizardStep);

        return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 28 }}>
                    <button onClick={() => setWizardMpl(null)} style={{ padding: '8px 16px', borderRadius: 10, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13, display: 'flex', alignItems: 'center', gap: 6, color: '#374151', transition: 'all 0.15s ease', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.backgroundColor = '#fff'}><ChevronLeft size={16} /> Back to Packing List</button>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: '#1e3a8a', fontFamily: 'monospace' }}>{wizardMpl.mpl_number}</h2>
                        <StatusBadge status={wizardMpl.status} />
                    </div>
                </div>

                {error && <div style={{ padding: '12px 16px', marginBottom: 16, borderRadius: 10, backgroundColor: '#fee2e2', color: '#dc2626', display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, border: '1px solid #fecaca' }}><AlertCircle size={16} />{error}<button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}><X size={16} /></button></div>}

                {/* Step Progress Bar */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28, background: '#f8fafc', borderRadius: 14, padding: '12px 20px', border: '1px solid #e5e7eb' }}>
                    {steps.map((step, idx) => (
                        <React.Fragment key={step.key}>
                            <button onClick={() => {
                                // Block jumping to DISPATCH if gross weights are invalid
                                if (step.key === 'DISPATCH') {
                                    const hasWeightErrors = enrichedPallets.some(p => !p.gross_weight_kg || p.gross_weight_kg <= 0 || p.gross_weight_kg < p.net_weight_kg);
                                    if (hasWeightErrors) return;
                                }
                                setWizardStep(step.key);
                            }} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 10, border: 'none', cursor: 'pointer', background: idx === currentStepIdx ? 'linear-gradient(135deg, var(--enterprise-primary), #2563eb)' : idx < currentStepIdx ? '#e0f2fe' : 'transparent', color: idx === currentStepIdx ? '#fff' : idx < currentStepIdx ? '#1e3a8a' : '#9ca3af', fontWeight: 600, fontSize: 13, transition: 'all 0.2s ease', whiteSpace: 'nowrap' }}>
                                <span style={{ width: 22, height: 22, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, flexShrink: 0, background: idx === currentStepIdx ? 'rgba(255,255,255,0.25)' : idx < currentStepIdx ? '#1e3a8a' : '#d1d5db', color: idx === currentStepIdx ? '#fff' : idx < currentStepIdx ? '#fff' : '#6b7280' }}>{idx < currentStepIdx ? '✓' : idx + 1}</span>
                                {step.label}
                            </button>
                            {idx < steps.length - 1 && <div style={{ flex: 1, height: 2, background: idx < currentStepIdx ? '#1e3a8a' : '#d1d5db', margin: '0 8px', borderRadius: 1, minWidth: 20 }} />}
                        </React.Fragment>
                    ))}
                </div>

                {wizardLoading ? <div style={{ padding: 64, textAlign: 'center', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 14, background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb' }}><Loader2 size={32} style={{ animation: 'spin 1s linear infinite', color: '#1e3a8a' }} /><p style={{ fontWeight: 700, fontSize: 15, margin: 0, color: '#1e3a8a' }}>Loading pallet data...</p><p style={{ fontSize: 13, margin: 0, color: '#9ca3af' }}>Fetching pallets, containers, and weights</p></div> : <>
                    {/* ═══════ STEP 1: REVIEW PALLETS ═══════ */}
                    {wizardStep === 'REVIEW' && (() => {
                        const refPallet = enrichedPallets[0];
                        const allContainers = enrichedPallets.flatMap(p => p.containers);
                        const totalStdBoxes = allContainers.filter(c => !c.is_adjustment).length;
                        const totalAdjBoxes = allContainers.filter(c => c.is_adjustment).length;
                        const totalAdjQty = allContainers.filter(c => c.is_adjustment).reduce((s, c) => s + c.quantity, 0);
                        const totalBoxes = allContainers.length;
                        const detailLabelStyle: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.3px', marginBottom: 3 };
                        const detailValueStyle: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: '#111827', fontFamily: 'monospace' };
                        return (<div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                            {/* ── SECTION 1: Item Details ── */}
                            <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                                <div style={{ padding: '14px 24px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Info size={16} style={{ color: '#1e3a8a' }} />
                                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#111827' }}>Item Details</h3>
                                </div>
                                {refPallet && (
                                    <div style={{ padding: '16px 24px' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 16 }}>
                                            <div><div style={detailLabelStyle}>MSN</div><div style={detailValueStyle}>{refPallet.master_serial_no || '—'}</div></div>
                                            <div><div style={detailLabelStyle}>Part Number</div><div style={detailValueStyle}>{refPallet.part_number || '—'}</div></div>
                                            <div><div style={detailLabelStyle}>Item Code</div><div style={detailValueStyle}>{refPallet.item_code}</div></div>
                                            <div><div style={detailLabelStyle}>Revision</div><div style={detailValueStyle}>{refPallet.revision || '—'}</div></div>
                                            <div><div style={detailLabelStyle}>Description</div><div style={{ ...detailValueStyle, fontFamily: 'inherit', fontSize: 12 }}>{refPallet.item_name || '—'}</div></div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* ── SECTION 2: Packing Details ── */}
                            <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                                <div style={{ padding: '14px 24px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc', display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Package size={16} style={{ color: '#7c3aed' }} />
                                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#111827' }}>Packing Details</h3>
                                </div>
                                {refPallet && (
                                    <div style={{ padding: '16px 24px' }}>
                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
                                            {/* Inner Box */}
                                            <div style={{ padding: '12px 14px', borderRadius: 12, background: '#f5f3ff', border: '1px solid #ede9fe' }}>
                                                <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', marginBottom: 4 }}>Inner Box Size</div>
                                                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: '#111827' }}>{refPallet.spec ? `${refPallet.spec.inner_box_length_mm}×${refPallet.spec.inner_box_width_mm}×${refPallet.spec.inner_box_height_mm}` : '—'}</div>
                                                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>mm (L×W×H)</div>
                                            </div>
                                            <div style={{ padding: '12px 14px', borderRadius: 12, background: '#f5f3ff', border: '1px solid #ede9fe' }}>
                                                <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', marginBottom: 4 }}>Inner Box Qty</div>
                                                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: '#7c3aed' }}>{refPallet.spec?.inner_box_quantity ?? '—'}</div>
                                                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>PCS per box</div>
                                            </div>
                                            {/* Outer Box */}
                                            <div style={{ padding: '12px 14px', borderRadius: 12, background: '#eff6ff', border: '1px solid #dbeafe' }}>
                                                <div style={{ fontSize: 10, fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', marginBottom: 4 }}>Outer Box Size</div>
                                                <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: '#111827' }}>{refPallet.spec ? `${refPallet.spec.outer_box_length_mm}×${refPallet.spec.outer_box_width_mm}×${refPallet.spec.outer_box_height_mm}` : '—'}</div>
                                                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>mm (L×W×H)</div>
                                            </div>
                                            <div style={{ padding: '12px 14px', borderRadius: 12, background: '#eff6ff', border: '1px solid #dbeafe' }}>
                                                <div style={{ fontSize: 10, fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', marginBottom: 4 }}>Outer Box Qty</div>
                                                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: '#1e3a8a' }}>{refPallet.spec?.outer_box_quantity ?? '—'}</div>
                                                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>inner boxes per outer</div>
                                            </div>
                                            {/* Top-off / Adjustment */}
                                            {totalAdjBoxes > 0 && (
                                                <div style={{ padding: '12px 14px', borderRadius: 12, background: '#fffbeb', border: '1px solid #fef3c7' }}>
                                                    <div style={{ fontSize: 10, fontWeight: 700, color: '#d97706', textTransform: 'uppercase', marginBottom: 4 }}>Top-off Boxes</div>
                                                    <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: '#d97706' }}>{totalAdjBoxes} <span style={{ fontSize: 11, fontWeight: 400, color: '#92400e' }}>box{totalAdjBoxes !== 1 ? 'es' : ''}</span></div>
                                                    <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{totalAdjQty.toLocaleString()} PCS total</div>
                                                </div>
                                            )}
                                            {/* Actual Box Count */}
                                            <div style={{ padding: '12px 14px', borderRadius: 12, background: '#f0fdf4', border: '1px solid #dcfce7' }}>
                                                <div style={{ fontSize: 10, fontWeight: 700, color: '#16a34a', textTransform: 'uppercase', marginBottom: 4 }}>Actual Box Count</div>
                                                <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: '#16a34a' }}>{totalBoxes}</div>
                                                <div style={{ fontSize: 10, color: '#6b7280', marginTop: 2 }}>{totalStdBoxes} std{totalAdjBoxes > 0 ? ` + ${totalAdjBoxes} adj` : ''}</div>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* ── SECTION 3: Pallets ── */}
                            <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                                <div style={{ padding: '14px 24px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <Box size={16} style={{ color: '#1e3a8a' }} />
                                        <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#111827' }}>Pallets</h3>
                                    </div>
                                    <span style={{ fontSize: 12, color: '#6b7280', fontWeight: 500 }}>{enrichedPallets.length} pallet{enrichedPallets.length !== 1 ? 's' : ''} · Click to expand boxes</span>
                                </div>
                                <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {enrichedPallets.map(p => {
                                        const isExpanded = expandedWizardPallets.has(p.id);
                                        return (
                                            <div key={p.id} style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', transition: 'box-shadow 0.2s', boxShadow: isExpanded ? '0 2px 8px rgba(0,0,0,0.06)' : 'none' }}>
                                                <button onClick={() => toggleWizardPallet(p.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: isExpanded ? 'linear-gradient(135deg, #f0f9ff, #e0f2fe)' : '#fafbfc', border: 'none', cursor: 'pointer', transition: 'all 0.15s ease' }} onMouseEnter={e => { if (!isExpanded) e.currentTarget.style.background = '#f0f9ff'; }} onMouseLeave={e => { if (!isExpanded) e.currentTarget.style.background = isExpanded ? 'linear-gradient(135deg, #f0f9ff, #e0f2fe)' : '#fafbfc'; }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'linear-gradient(135deg, #1e3a8a, #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Box size={16} style={{ color: '#fff' }} /></div>
                                                        <div style={{ textAlign: 'left' }}>
                                                            <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e3a8a', fontSize: 13 }}>{p.pallet_number}</div>
                                                            <div style={{ fontSize: 11, color: '#6b7280' }}>{p.item_name || p.item_code}</div>
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                                        <div style={{ textAlign: 'right' }}>
                                                            <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', fontFamily: 'monospace' }}>{p.current_qty.toLocaleString()} <span style={{ fontWeight: 400, fontSize: 11, color: '#6b7280' }}>PCS</span></div>
                                                            <div style={{ fontSize: 11, color: '#6b7280' }}>{p.container_count} boxes</div>
                                                        </div>
                                                        <span style={{ padding: '3px 10px', borderRadius: 8, fontSize: 10, fontWeight: 700, background: p.state === 'READY' ? '#dcfce7' : '#fef3c7', color: p.state === 'READY' ? '#16a34a' : '#d97706', border: `1px solid ${p.state === 'READY' ? '#bbf7d0' : '#fde68a'}` }}>{p.state}</span>
                                                        <ChevronDown size={16} style={{ color: '#9ca3af', transition: 'transform 0.2s', transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                                                    </div>
                                                </button>
                                                {isExpanded && (
                                                    <div style={{ borderTop: '1px solid #e5e7eb' }}>
                                                        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                                            <thead><tr style={{ background: '#f8fafc' }}>
                                                                <th style={{ ...thS, width: 40, padding: '8px 12px', fontSize: 11 }}>#</th>
                                                                <th style={{ ...thS, padding: '8px 12px', fontSize: 11 }}>Packing Box ID</th>
                                                                <th style={{ ...thS, padding: '8px 12px', fontSize: 11 }}>Type</th>
                                                                <th style={{ ...thS, padding: '8px 12px', fontSize: 11, textAlign: 'right' }}>Qty</th>
                                                                <th style={{ ...thS, padding: '8px 12px', fontSize: 11, textAlign: 'center' }}>Adj?</th>
                                                                <th style={{ ...thS, padding: '8px 12px', fontSize: 11 }}>Packed By</th>
                                                            </tr></thead>
                                                            <tbody>{p.containers.map((c, i) => (
                                                                <tr key={i} style={{ borderTop: '1px solid #f3f4f6', background: i % 2 === 0 ? '#fff' : '#fafbfc' }}>
                                                                    <td style={{ ...tdS, textAlign: 'center', padding: '8px 12px', fontSize: 12 }}>{i + 1}</td>
                                                                    <td style={{ ...tdS, fontFamily: 'monospace', fontWeight: 600, color: '#7c3aed', padding: '8px 12px', fontSize: 12 }}>{c.packing_id}</td>
                                                                    <td style={{ ...tdS, padding: '8px 12px', fontSize: 12 }}><span style={{ padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 600, background: c.container_type === 'INNER_BOX' ? '#ede9fe' : '#fef3c7', color: c.container_type === 'INNER_BOX' ? '#7c3aed' : '#92400e' }}>{c.container_type.replace('_', ' ')}</span></td>
                                                                    <td style={{ ...tdS, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, padding: '8px 12px', fontSize: 12 }}>{c.quantity.toLocaleString()}</td>
                                                                    <td style={{ ...tdS, textAlign: 'center', padding: '8px 12px', fontSize: 12 }}>{c.is_adjustment ? <span style={{ padding: '2px 6px', borderRadius: 4, fontSize: 9, fontWeight: 700, background: '#fef3c7', color: '#d97706' }}>ADJ</span> : <span style={{ color: '#d1d5db' }}>—</span>}</td>
                                                                    <td style={{ ...tdS, padding: '8px 12px', fontSize: 12, color: '#6b7280' }}>{c.operator}</td>
                                                                </tr>
                                                            ))}</tbody>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                                <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'flex-end' }}>
                                    <button onClick={() => setWizardStep('WEIGHTS')} style={{ padding: '10px 24px', borderRadius: 10, background: 'linear-gradient(135deg, var(--enterprise-primary), #2563eb)', color: 'white', border: 'none', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 2px 8px rgba(30,58,138,0.2)', transition: 'all 0.15s ease' }}>Next: Gross Weights <ChevronRight size={16} /></button>
                                </div>
                            </div>
                        </div>);
                    })()}

                    {/* ═══════ STEP 2: GROSS WEIGHTS ═══════ */}
                    {wizardStep === 'WEIGHTS' && (() => {
                        // Validation
                        const weightErrors: Record<string, string> = {};
                        enrichedPallets.forEach(p => {
                            if (!p.gross_weight_kg || p.gross_weight_kg <= 0) {
                                weightErrors[p.id] = 'Gross weight is required';
                            } else if (p.gross_weight_kg < p.net_weight_kg) {
                                weightErrors[p.id] = `Gross weight (${p.gross_weight_kg.toFixed(2)}) cannot be less than net weight (${p.net_weight_kg.toFixed(2)})`;
                            }
                        });
                        const hasErrors = Object.keys(weightErrors).length > 0;
                        const emptyCount = enrichedPallets.filter(p => !p.gross_weight_kg || p.gross_weight_kg <= 0).length;
                        const belowNetCount = enrichedPallets.filter(p => p.gross_weight_kg > 0 && p.gross_weight_kg < p.net_weight_kg).length;

                        return (
                            <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                                <div style={{ padding: '18px 24px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc', display: 'flex', alignItems: 'center', gap: 10 }}>
                                    <Scale size={18} style={{ color: '#1e3a8a' }} />
                                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#111827' }}>Enter Gross Weight per Pallet</h3>

                                </div>



                                <div style={{ padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                                    {enrichedPallets.map(p => {
                                        const error = weightErrors[p.id];
                                        return (
                                            <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto auto auto', gap: 16, alignItems: 'center', padding: '14px 16px', borderRadius: 12, border: '1px solid #e5e7eb', background: '#fafbfc', transition: 'all 0.15s ease' }} onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'} onMouseLeave={e => e.currentTarget.style.background = '#fafbfc'}>
                                                <div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                                        <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #1e3a8a, #2563eb)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Box size={17} style={{ color: '#fff' }} /></div>
                                                        <div>
                                                            <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e3a8a', fontSize: 13 }}>{p.pallet_number}</div>
                                                            <div style={{ fontSize: 11, color: '#6b7280' }}>{p.master_serial_no || p.item_name} · <span style={{ color: '#9ca3af' }}>{p.item_code}</span></div>
                                                        </div>
                                                    </div>
                                                    {error && <div style={{ marginTop: 6, marginLeft: 48, fontSize: 11, color: '#dc2626', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}><AlertTriangle size={12} /> {error}</div>}
                                                </div>
                                                <div style={{ textAlign: 'center', padding: '0 8px' }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 2 }}>Qty (Nos)</div>
                                                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: '#111827' }}>{p.current_qty.toLocaleString()}</div>
                                                </div>
                                                <div style={{ textAlign: 'center', padding: '0 8px' }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 2 }}>Boxes (Nos)</div>
                                                    <div style={{ fontSize: 14, fontWeight: 700, fontFamily: 'monospace', color: '#111827' }}>{p.container_count}</div>
                                                </div>
                                                <div style={{ textAlign: 'center', padding: '0 8px' }}>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', marginBottom: 2 }}>Net Wt (kg)</div>
                                                    <div style={{ fontSize: 14, fontWeight: 600, fontFamily: 'monospace', color: '#6b7280' }}>{p.net_weight_kg.toFixed(2)}</div>
                                                </div>
                                                <div>
                                                    <div style={{ fontSize: 10, fontWeight: 600, color: '#d97706', textTransform: 'uppercase', marginBottom: 2 }}>Gross Wt (kg) *</div>
                                                    <input type="number" step="0.01" value={p.gross_weight_kg || ''} onChange={e => handleWeightChange(p.id, parseFloat(e.target.value) || 0)} style={{ width: 110, padding: '8px 12px', border: '2px solid #fbbf24', borderRadius: 10, fontSize: 14, fontFamily: 'monospace', fontWeight: 700, outline: 'none', textAlign: 'right', background: '#fffbeb', transition: 'border-color 0.15s', boxSizing: 'border-box' }} placeholder="0.00" onFocus={e => e.currentTarget.style.borderColor = '#1e3a8a'} onBlur={e => e.currentTarget.style.borderColor = '#fbbf24'} />
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <button onClick={() => setWizardStep('REVIEW')} style={{ padding: '10px 24px', borderRadius: 10, background: 'white', color: '#374151', border: '1px solid #d1d5db', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s ease' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.backgroundColor = '#fff'}><ChevronLeft size={16} /> Back</button>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        {hasErrors && <span style={{ fontSize: 12, color: '#dc2626', fontWeight: 600 }}>Add Gross Weight for     above to continue</span>}
                                        <button onClick={() => { if (!hasErrors) setWizardStep('DISPATCH'); }} disabled={hasErrors} style={{ padding: '10px 24px', borderRadius: 10, background: hasErrors ? '#9ca3af' : 'linear-gradient(135deg, var(--enterprise-primary), #2563eb)', color: 'white', border: 'none', fontWeight: 700, fontSize: 14, cursor: hasErrors ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: hasErrors ? 'none' : '0 2px 8px rgba(30,58,138,0.2)', transition: 'all 0.15s ease', opacity: hasErrors ? 0.7 : 1 }}>Next: Invoice & BPA <ChevronRight size={16} /></button>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* ═══════ STEP 3: INVOICE & PO ═══════ */}
                    {wizardStep === 'DISPATCH' && (
                        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
                            <div style={{ padding: '18px 24px', borderBottom: '1px solid #e5e7eb', background: '#f8fafc', display: 'flex', alignItems: 'center', gap: 10 }}>
                                <FileText size={18} style={{ color: '#1e3a8a' }} />
                                <div>
                                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#111827' }}>Invoice & BPA Details</h3>
                                    <p style={{ fontSize: 12, color: '#6b7280', margin: 0 }}>Enter the SAP references. Both Invoice # and BPA # are required to enable Print.</p>
                                </div>
                            </div>
                            <div style={{ padding: '20px 24px' }}>
                                {/* Invoice Section */}
                                <div style={{ marginBottom: 20 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}><Hash size={12} /> Invoice Details</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                                        <div>
                                            <label style={{ ...lbl, color: '#374151' }}>Invoice Number (SAP) <span style={{ color: '#ef4444' }}>*</span></label>
                                            <input value={dispatchForm.invoice_number} onChange={e => updateDispatchField('invoice_number', e.target.value)} style={{ ...inp, borderColor: !dispatchForm.invoice_number ? '#fca5a5' : '#d1d5db', borderRadius: 10, padding: '10px 14px', borderWidth: 2, transition: 'border-color 0.15s' }} placeholder="INV/E/ 252602774" onFocus={e => e.currentTarget.style.borderColor = '#1e3a8a'} onBlur={e => e.currentTarget.style.borderColor = !dispatchForm.invoice_number ? '#fca5a5' : '#d1d5db'} />
                                        </div>
                                        <div>
                                            <label style={{ ...lbl, color: '#374151' }}>Invoice Date</label>
                                            <input type="date" value={dispatchForm.invoice_date} onChange={e => updateDispatchField('invoice_date', e.target.value)} style={{ ...inp, borderRadius: 10, padding: '10px 14px', borderWidth: 2 }} />
                                        </div>
                                    </div>
                                </div>
                                {/* PO Section */}
                                <div style={{ marginBottom: 20 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}><FileText size={12} /> Blanket Order & Release Details</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                                        <div style={{ position: 'relative' }}>
                                            <label style={{ ...lbl, color: '#374151', display: 'flex', alignItems: 'center', gap: 8 }}>
                                                BPA Number (SAP) <span style={{ color: '#ef4444' }}>*</span>
                                                {bpaSuggestions.length > 0 && (
                                                    <span style={{ fontSize: 10, fontWeight: 600, color: '#059669', background: '#dcfce7', padding: '2px 6px', borderRadius: 4 }}>
                                                        {bpaSuggestions.length} suggested
                                                    </span>
                                                )}
                                            </label>
                                            <div style={{ position: 'relative' }}>
                                                <input
                                                    value={dispatchForm.purchase_order_number}
                                                    onChange={e => updateDispatchField('purchase_order_number', e.target.value)}
                                                    onFocus={(e) => { e.currentTarget.style.borderColor = '#1e3a8a'; if (bpaSuggestions.length > 0) setBpaDropdownOpen(true); }}
                                                    onBlur={(e) => { e.currentTarget.style.borderColor = !dispatchForm.purchase_order_number ? '#fca5a5' : '#d1d5db'; setTimeout(() => setBpaDropdownOpen(false), 200); }}
                                                    style={{ ...inp, borderColor: !dispatchForm.purchase_order_number ? '#fca5a5' : '#d1d5db', borderRadius: 10, padding: '10px 36px 10px 14px', borderWidth: 2, transition: 'border-color 0.15s', width: '100%' }}
                                                    placeholder="260067798"
                                                />
                                                {bpaSuggestions.length > 0 && (
                                                    <button
                                                        type="button"
                                                        onMouseDown={(e) => { e.preventDefault(); setBpaDropdownOpen((o) => !o); }}
                                                        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', padding: 4, display: 'flex', alignItems: 'center', color: '#6b7280' }}
                                                        title="Show suggested BPAs"
                                                    >
                                                        <ChevronDown size={16} />
                                                    </button>
                                                )}
                                                {bpaDropdownOpen && bpaSuggestions.length > 0 && (
                                                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: 'white', border: '1px solid #d1d5db', borderRadius: 10, boxShadow: '0 8px 16px rgba(0,0,0,0.08)', maxHeight: 280, overflowY: 'auto', zIndex: 10 }}>
                                                        <div style={{ padding: '8px 12px', fontSize: 11, color: '#6b7280', borderBottom: '1px solid #e5e7eb', background: '#f9fafb' }}>
                                                            Sorted by earliest expiry • showing BPAs with pending qty
                                                        </div>
                                                        {bpaSuggestions.map((s, idx) => {
                                                            const isSelected = dispatchForm.purchase_order_number === s.agreement_number;
                                                            return (
                                                                <div
                                                                    key={s.agreement_id}
                                                                    onMouseDown={(e) => {
                                                                        e.preventDefault();
                                                                        setDispatchForm((prev) => ({
                                                                            ...prev,
                                                                            purchase_order_number: s.agreement_number,
                                                                            purchase_order_date: s.agreement_date || prev.purchase_order_date,
                                                                        }));
                                                                        setBpaDropdownOpen(false);
                                                                    }}
                                                                    style={{
                                                                        padding: '10px 12px',
                                                                        cursor: 'pointer',
                                                                        borderBottom: idx < bpaSuggestions.length - 1 ? '1px solid #f3f4f6' : 'none',
                                                                        background: isSelected ? '#eff6ff' : 'white',
                                                                        transition: 'background 0.1s',
                                                                    }}
                                                                    onMouseEnter={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = '#f9fafb'; }}
                                                                    onMouseLeave={(e) => { if (!isSelected) (e.currentTarget as HTMLDivElement).style.background = 'white'; }}
                                                                >
                                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                                                                        <div style={{ fontWeight: 700, color: '#1e3a8a', fontFamily: 'monospace', fontSize: 13 }}>
                                                                            {s.agreement_number}
                                                                            <span style={{ fontWeight: 400, color: '#6b7280', marginLeft: 4, fontSize: 11 }}>rev {s.revision}</span>
                                                                        </div>
                                                                        {idx === 0 && <span style={{ fontSize: 10, fontWeight: 600, color: '#059669', background: '#dcfce7', padding: '2px 6px', borderRadius: 4 }}>DEFAULT</span>}
                                                                        {isSelected && idx > 0 && <span style={{ fontSize: 10, color: '#1e3a8a' }}>✓ selected</span>}
                                                                    </div>
                                                                    <div style={{ fontSize: 11, color: '#6b7280', display: 'flex', gap: 12 }}>
                                                                        <span>{s.pending_quantity.toLocaleString()} / {s.blanket_quantity.toLocaleString()} pending</span>
                                                                        <span>· expires {new Date(s.effective_end_date).toLocaleDateString()}</span>
                                                                        <span style={{ color: s.status === 'AMENDED' ? '#d97706' : '#059669', fontWeight: 600 }}>{s.status}</span>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                            </div>
                                            {bpaSuggestions.length === 0 && dispatchForm.purchase_order_number === '' && (
                                                <p style={{ fontSize: 11, color: '#d97706', marginTop: 4 }}>
                                                    ⚠ No active BPA found for these part(s). Enter manually or add a BPA in BPA Management.
                                                </p>
                                            )}
                                        </div>
                                        <div>
                                            <label style={{ ...lbl, color: '#374151' }}>PO Date</label>
                                            <input type="date" value={dispatchForm.purchase_order_date} onChange={e => updateDispatchField('purchase_order_date', e.target.value)} style={{ ...inp, borderRadius: 10, padding: '10px 14px', borderWidth: 2 }} />
                                        </div>
                                    </div>
                                </div>
                                {/* Shipping */}
                                <div style={{ marginBottom: 20 }}>
                                    <div style={{ fontSize: 11, fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}><Truck size={12} /> Shipping Details</div>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                                        <div><label style={{ ...lbl, color: '#374151' }}>Flight Forwarder</label><input value={dispatchForm.ship_via} onChange={e => updateDispatchField('ship_via', e.target.value)} style={{ ...inp, borderRadius: 10, padding: '10px 14px', borderWidth: 2 }} placeholder="SEAHORSE" /></div>
                                        <div><label style={{ ...lbl, color: '#374151' }}>Mode of Transport</label><input value={dispatchForm.mode_of_transport} onChange={e => updateDispatchField('mode_of_transport', e.target.value)} style={{ ...inp, borderRadius: 10, padding: '10px 14px', borderWidth: 2 }} placeholder="SEA / AIR / ROAD" /></div>
                                    </div>
                                </div>
                                {/* Summary Cards */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, padding: 16, background: '#f8fafc', borderRadius: 12, border: '1px solid #e5e7eb' }}>
                                    {[{ label: 'Pallets', value: String(enrichedPallets.length), color: '#1e3a8a' }, { label: 'Total Qty', value: enrichedPallets.reduce((s, p) => s + p.current_qty, 0).toLocaleString() + ' PCS', color: '#059669' }, { label: 'Total Gross Wt', value: enrichedPallets.reduce((s, p) => s + p.gross_weight_kg, 0).toFixed(2) + ' Kg', color: '#d97706' }, { label: 'Boxes', value: String(enrichedPallets.reduce((s, p) => s + p.container_count, 0)), color: '#7c3aed' }].map((c, i) => (
                                        <div key={i} style={{ padding: '12px 14px', borderRadius: 10, background: '#fff', border: '1px solid #e5e7eb' }}>
                                            <div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4 }}>{c.label}</div>
                                            <div style={{ fontSize: 16, fontWeight: 800, color: c.color, fontFamily: 'monospace' }}>{c.value}</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div style={{ padding: '16px 24px', borderTop: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between' }}>
                                <button onClick={() => setWizardStep('WEIGHTS')} style={{ padding: '10px 24px', borderRadius: 10, background: 'white', color: '#374151', border: '1px solid #d1d5db', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.15s ease' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.backgroundColor = '#fff'}><ChevronLeft size={16} /> Back</button>
                                <button onClick={handleSaveAndConfirm} disabled={saving || !dispatchForm.invoice_number || !dispatchForm.purchase_order_number} style={{ padding: '10px 24px', borderRadius: 10, border: 'none', background: (saving || !dispatchForm.invoice_number || !dispatchForm.purchase_order_number) ? '#d1d5db' : 'linear-gradient(135deg, #16a34a, #15803d)', color: 'white', fontWeight: 700, fontSize: 14, cursor: saving ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: (saving || !dispatchForm.invoice_number || !dispatchForm.purchase_order_number) ? 'none' : '0 2px 8px rgba(22,163,74,0.25)', transition: 'all 0.15s ease', opacity: (saving || !dispatchForm.invoice_number || !dispatchForm.purchase_order_number) ? 0.7 : 1 }}>
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
    if (loading) return <ModuleLoader moduleName="Packing List" icon={<ClipboardList size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {error && (
                <div style={{ backgroundColor: 'var(--enterprise-error-bg)', border: '1px solid var(--enterprise-error)', borderRadius: 'var(--border-radius-md)', padding: '12px' }}>
                    <p style={{ color: 'var(--enterprise-error)', fontSize: 'var(--font-size-sm)' }}>{error}</p>
                </div>
            )}

            {/* ═══════════════ FLOATING TOAST NOTIFICATION ═══════════════ */}
            {toast && (
                <div key={toastKeyRef.current} style={{
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
                        boxShadow: `0 2px 8px ${toast.type === 'success' ? 'rgba(22,163,74,0.3)' : toast.type === 'error' ? 'rgba(220,38,38,0.3)' : toast.type === 'warning' ? 'rgba(245,158,11,0.3)' : 'rgba(37,99,235,0.3)'}`,
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

            {/* Summary Cards — Click-to-filter (same as Item Master) */}
            <SummaryCardsGrid>
                <SummaryCard label="Total Packing Lists" value={summary.total} icon={<FileText size={22} style={{ color: 'var(--enterprise-primary)' }} />} color="var(--enterprise-primary)" bgColor="rgba(30, 58, 138, 0.1)" isActive={cardFilter === 'ALL'} onClick={() => { const next = cardFilter === 'ALL' ? 'ALL' : 'ALL'; setCardFilter(next); setStatusFilter(next); setPage(0); }} />
                <SummaryCard label="Pending" value={summary.pending} icon={<Clock size={22} style={{ color: '#f59e0b' }} />} color="#f59e0b" bgColor="rgba(245, 158, 11, 0.1)" isActive={cardFilter === 'DRAFT'} onClick={() => { const next = cardFilter === 'DRAFT' ? 'ALL' : 'DRAFT'; setCardFilter(next); setStatusFilter(next); setPage(0); }} />
                <SummaryCard label="Printed" value={summary.printed} icon={<Printer size={22} style={{ color: 'var(--enterprise-success)' }} />} color="var(--enterprise-success)" bgColor="rgba(34, 197, 94, 0.1)" isActive={cardFilter === 'PRINTED'} onClick={() => { const next = cardFilter === 'PRINTED' ? 'ALL' : 'PRINTED'; setCardFilter(next); setStatusFilter(next); setPage(0); }} />
                <SummaryCard label="Dispatched" value={summary.dispatched} icon={<Truck size={22} style={{ color: '#8b5cf6' }} />} color="#8b5cf6" bgColor="rgba(139, 92, 246, 0.1)" isActive={cardFilter === 'DISPATCHED'} onClick={() => { const next = cardFilter === 'DISPATCHED' ? 'ALL' : 'DISPATCHED'; setCardFilter(next); setStatusFilter(next); setPage(0); }} />
            </SummaryCardsGrid>

            {/* Filter Bar — StatusFilter dropdown + DateRangeFilter + RefreshButton */}
            <SharedFilterBar>
                <SearchBox value={search} onChange={(v) => { setSearch(v); setPage(0); }} placeholder="Search MPL #, PO, Invoice, MSN..." />
                <StatusFilter
                    value={statusFilter}
                    onChange={v => { const val = v as MplStatus | 'ALL'; setStatusFilter(val); setCardFilter(val); setPage(0); }}
                    options={[
                        { value: 'ALL', label: 'All Statuses' },
                        { value: 'DRAFT', label: 'Pending' },
                        { value: 'CONFIRMED', label: 'Confirmed' },
                        { value: 'PRINTED', label: 'Printed' },
                        { value: 'DISPATCHED', label: 'Dispatched' },
                        { value: 'CANCELLED', label: 'Cancelled' },
                    ]}
                />
                <DateRangeFilter
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    onDateFromChange={setDateFrom}
                    onDateToChange={setDateTo}
                />
                <ActionBar>
                    {(statusFilter !== 'ALL' || dateFrom || dateTo) && (
                        <ClearFiltersButton onClick={() => { setStatusFilter('ALL'); setCardFilter('ALL'); setDateFrom(''); setDateTo(''); setPage(0); }} />
                    )}
                    <ExportCSVButton onClick={async () => {
                        try {
                            // Fetch ALL records (no pagination) for export
                            const { data: allMpls } = await fetchMasterPackingLists({
                                status: statusFilter === 'ALL' ? undefined : statusFilter,
                                search: search || undefined,
                                limit: 10000,
                                offset: 0,
                            });
                            const XLSX = await import('xlsx');
                            const headers = ['MPL #', 'MSN', 'Item Code', 'Item Name', 'BPA #', 'Invoice #', 'Pallets', 'Quantity', 'Net Weight (kg)', 'Gross Weight (kg)', 'Status', 'Created'];
                            const rows = allMpls.map(m => [
                                m.mpl_number,
                                (m as any).master_serial_no || '',
                                m.item_code || '',
                                m.item_name || '',
                                m.po_number || '',
                                m.invoice_number || '',
                                m.total_pallets,
                                m.total_quantity,
                                m.total_net_weight_kg || 0,
                                m.total_gross_weight_kg || 0,
                                m.status,
                                new Date(m.created_at).toLocaleDateString(),
                            ]);
                            const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
                            ws['!cols'] = headers.map((h, i) => ({ wch: Math.max(h.length, ...rows.map(r => String(r[i]).length)) + 2 }));
                            const wb = XLSX.utils.book_new();
                            XLSX.utils.book_append_sheet(wb, ws, 'Packing Lists');
                            XLSX.writeFile(wb, `packing_lists_${new Date().toISOString().split('T')[0]}.xlsx`);
                        } catch (err: any) {
                            console.error('[MPL Export] Error:', err);
                        }
                    }} />
                    <RefreshButton onClick={handleRefresh} loading={refreshing} />
                </ActionBar>
            </SharedFilterBar>

            {/* Data Table — Wrapped in Card like Item Master */}
            <Card style={{ padding: 0, overflow: activeDropdown ? 'visible' : undefined }}>
                {mpls.length === 0 ? (
                    <EmptyState icon={<Package size={48} />} title="No Packing Lists" description="Generate packing lists from Dispatch Selection first." />
                ) : (
                    <>
                        <div style={{ overflowX: activeDropdown ? 'visible' : 'auto', overflowY: activeDropdown ? 'visible' : undefined, opacity: refreshing ? 0.5 : 1, transition: 'opacity 0.2s', pointerEvents: refreshing ? 'none' : 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ backgroundColor: 'var(--table-header-bg)', borderBottom: '2px solid var(--table-border)' }}>
                                        <th style={{ ...thS, minWidth: 120 }}>MPL #</th>
                                        <th style={{ ...thS, minWidth: 100 }}>MSN</th>
                                        <th style={{ ...thS, minWidth: 100 }}>BPA #</th>
                                        <th style={{ ...thS, minWidth: 100 }}>Invoice #</th>
                                        <th style={{ ...thS, textAlign: 'center', minWidth: 70 }}>Pallets (Nos)</th>
                                        <th style={{ ...thS, textAlign: 'center', minWidth: 70 }}>Qty (Nos)</th>
                                        <th style={{ ...thS, textAlign: 'center', minWidth: 90 }}>Status</th>
                                        <th style={{ ...thS, minWidth: 90 }}>Created</th>
                                        <th style={{ ...thS, textAlign: 'center', minWidth: 150 }}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>{mpls.map((mpl, idx) => (
                                    <tr key={mpl.id} style={{ backgroundColor: idx % 2 === 0 ? 'white' : 'var(--table-stripe)', borderBottom: '1px solid var(--table-border)', transition: 'background-color var(--transition-fast)' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--table-hover)'} onMouseLeave={e => e.currentTarget.style.backgroundColor = idx % 2 === 0 ? 'white' : 'var(--table-stripe)'}>
                                        <td style={{ ...tdS, fontWeight: 600, color: 'var(--enterprise-primary)', fontFamily: 'monospace' }}>{mpl.mpl_number}</td>
                                        <td style={{ ...tdS, fontFamily: 'monospace', fontSize: '0.85em', color: 'var(--enterprise-gray-600)' }}>{(mpl as any).master_serial_no || <span style={{ color: 'var(--enterprise-gray-300)' }}>—</span>}</td>
                                        <td style={{ ...tdS, color: 'var(--enterprise-gray-700)' }}>{mpl.po_number || <span style={{ color: 'var(--enterprise-gray-300)' }}>—</span>}</td>
                                        <td style={{ ...tdS, color: 'var(--enterprise-gray-700)' }}>{mpl.invoice_number || <span style={{ color: 'var(--enterprise-gray-300)' }}>—</span>}</td>
                                        <td style={{ ...tdS, textAlign: 'center', fontWeight: 600 }}>{mpl.total_pallets}</td>
                                        <td style={{ ...tdS, textAlign: 'center', fontWeight: 600 }}>{mpl.total_quantity.toLocaleString()}</td>
                                        <td style={{ ...tdS, textAlign: 'center' }}><StatusBadge status={mpl.status} /></td>
                                        <td style={{ ...tdS, color: 'var(--enterprise-gray-600)', fontSize: 12, whiteSpace: 'nowrap' }}>{new Date(mpl.created_at).toLocaleDateString()}</td>
                                        {/* Single Actions column: Primary button + dropdown */}
                                        <td style={{ ...tdS, textAlign: 'center', padding: '8px 12px', position: 'relative' }}>
                                            <div ref={activeDropdown === mpl.id ? dropdownRef : null} style={{ display: 'inline-flex', alignItems: 'center', gap: 0, position: 'relative' }}>
                                                {/* Primary action: Continue (DRAFT) or View */}
                                                {mpl.status === 'DRAFT' && canEdit ? (
                                                    <button onClick={(e) => { e.stopPropagation(); handleOpenWizard(mpl); }} style={{ height: 34, minWidth: 100, padding: '0 14px', border: 'none', borderRadius: '8px 0 0 8px', background: 'linear-gradient(135deg, var(--enterprise-primary), #2563eb)', color: '#fff', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 600, boxShadow: '0 2px 8px rgba(30,58,138,0.18)', transition: 'all 0.15s ease', whiteSpace: 'nowrap', boxSizing: 'border-box' }}>
                                                        <ChevronRight size={15} /> Continue
                                                    </button>
                                                ) : (
                                                    <button onClick={() => handleViewDetail(mpl)} style={{ height: 34, minWidth: mpl.status === 'CANCELLED' ? 130 : 100, padding: '0 14px', borderRadius: mpl.status === 'CANCELLED' ? '8px' : '8px 0 0 8px', border: '1px solid #e5e7eb', borderRight: mpl.status === 'CANCELLED' ? '1px solid #e5e7eb' : 'none', backgroundColor: 'white', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#374151', transition: 'all 0.15s ease', whiteSpace: 'nowrap', boxSizing: 'border-box' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}>
                                                        <Eye size={15} /> View
                                                    </button>
                                                )}
                                                {/* Dropdown trigger - hide for CANCELLED since no dropdown items exist */}
                                                {mpl.status !== 'CANCELLED' && (
                                                    <button onClick={(e) => { e.stopPropagation(); if (activeDropdown === mpl.id) { setActiveDropdown(null); } else { const rect = e.currentTarget.getBoundingClientRect(); setDropdownDirection(window.innerHeight - rect.bottom < 200 ? 'up' : 'down'); setActiveDropdown(mpl.id); } }} style={{ height: 34, padding: '0 8px', border: mpl.status === 'DRAFT' && canEdit ? 'none' : '1px solid #e5e7eb', borderLeft: mpl.status === 'DRAFT' && canEdit ? '1px solid rgba(255,255,255,0.3)' : '1px solid #e5e7eb', borderRadius: '0 8px 8px 0', backgroundColor: mpl.status === 'DRAFT' && canEdit ? '#1e40af' : 'white', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', color: mpl.status === 'DRAFT' && canEdit ? '#fff' : '#374151', transition: 'all 0.15s ease', boxSizing: 'border-box' }} onMouseEnter={e => { if (!(mpl.status === 'DRAFT' && canEdit)) e.currentTarget.style.backgroundColor = '#f8fafc'; }} onMouseLeave={e => { if (!(mpl.status === 'DRAFT' && canEdit)) e.currentTarget.style.backgroundColor = 'white'; }}>
                                                        <ChevronDown size={14} style={{ transition: 'transform 0.2s', transform: activeDropdown === mpl.id ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                                                    </button>
                                                )}
                                                {/* Dropdown menu */}
                                                {activeDropdown === mpl.id && (
                                                    <div style={{ position: 'absolute', ...(dropdownDirection === 'up' ? { bottom: '100%', marginBottom: 4 } : { top: '100%', marginTop: 4 }), right: 0, zIndex: 9999, width: 200, backgroundColor: 'white', borderRadius: 12, boxShadow: dropdownDirection === 'up' ? '0 -10px 40px rgba(0,0,0,0.15)' : '0 10px 40px rgba(0,0,0,0.15)', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                                                        {/* View Details - only show in dropdown when main button is Continue */}
                                                        {(mpl.status === 'DRAFT' && canEdit) && (
                                                            <button onClick={() => { handleViewDetail(mpl); setActiveDropdown(null); }} style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, textAlign: 'left', color: '#374151' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                                <Eye size={16} /> View Details
                                                            </button>
                                                        )}
                                                        {/* Print */}
                                                        {isMplReady(mpl) && mpl.status !== 'CANCELLED' && (
                                                            <><div style={{ borderTop: '1px solid #f3f4f6' }} /><button onClick={() => { handlePrintMpl(mpl); setActiveDropdown(null); }} style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, textAlign: 'left', color: '#059669' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0fdf4'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                                <Printer size={16} /> Print
                                                            </button></>
                                                        )}
                                                        {!isMplReady(mpl) && mpl.status !== 'CANCELLED' && mpl.status !== 'DISPATCHED' && (
                                                            <><div style={{ borderTop: '1px solid #f3f4f6' }} /><button disabled style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, border: 'none', backgroundColor: 'transparent', cursor: 'not-allowed', fontSize: 14, textAlign: 'left', color: '#9ca3af', opacity: 0.6 }}>
                                                                <Printer size={16} /> Print (fill PO/INV)
                                                            </button></>
                                                        )}
                                                        {/* Cancel */}
                                                        {mpl.status !== 'DISPATCHED' && mpl.status !== 'CANCELLED' && canDelete && (
                                                            <><div style={{ borderTop: '1px solid #f3f4f6' }} /><button onClick={() => { setCancelTarget(mpl); setCancelConfirmInput(''); setCancelReason(''); setActiveDropdown(null); }} style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, textAlign: 'left', color: '#ef4444' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#fef2f2'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                                <XCircle size={16} /> Cancel
                                                            </button></>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                    </tr>
                                ))}</tbody>
                            </table>
                        </div>
                        {mpls.length > 0 && (
                            <Pagination
                                page={page}
                                pageSize={pageSize}
                                totalCount={totalCount}
                                onPageChange={setPage}
                            />
                        )}
                    </>
                )
                }
            </Card>

            {/* Results Summary */}
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '12px',
                color: 'var(--enterprise-gray-600)',
                marginTop: '16px'
            }}>
                <span>
                    Total Records: {totalCount}
                </span>
            </div>

            {/* Cancel Modal — Type-to-confirm (matches delete pattern) */}
            {cancelTarget && (
                <Modal isOpen={!!cancelTarget} onClose={() => { setCancelTarget(null); setCancelReason(''); setCancelConfirmInput(''); }} title="Cancel Packing List" maxWidth="500px">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', userSelect: 'none' }} onCopy={e => e.preventDefault()}>
                        {/* Warning Banner */}
                        <div style={{
                            background: 'linear-gradient(135deg, rgba(220,38,38,0.05) 0%, rgba(220,38,38,0.1) 100%)',
                            border: '1px solid rgba(220,38,38,0.2)',
                            borderRadius: 'var(--border-radius-md)',
                            padding: '16px',
                            display: 'flex',
                            gap: '12px',
                            alignItems: 'flex-start',
                        }}>
                            <AlertTriangle size={24} style={{ color: 'var(--enterprise-error)', flexShrink: 0 }} />
                            <div>
                                <p style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-error)', marginBottom: '4px' }}>
                                    This action cannot be undone
                                </p>
                                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-600)' }}>
                                    This will cancel <strong>{cancelTarget.mpl_number}</strong> and release <strong>{cancelTarget.total_pallets} pallet(s)</strong> back to READY state.
                                </p>
                            </div>
                        </div>

                        {/* MPL Info */}
                        <div style={{
                            background: 'var(--enterprise-gray-50)',
                            borderRadius: 'var(--border-radius-md)',
                            padding: '16px',
                        }}>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
                                <div>
                                    <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', marginBottom: '4px' }}>MPL Number</p>
                                    <p style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-primary)', fontFamily: 'monospace' }}>{cancelTarget.mpl_number}</p>
                                </div>
                                <div>
                                    <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', marginBottom: '4px' }}>Status</p>
                                    <div><StatusBadge status={cancelTarget.status} /></div>
                                </div>
                                <div>
                                    <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', marginBottom: '4px' }}>Pallets</p>
                                    <p style={{ fontWeight: 'var(--font-weight-semibold)' }}>{cancelTarget.total_pallets}</p>
                                </div>
                                <div>
                                    <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', marginBottom: '4px' }}>Total Qty</p>
                                    <p style={{ fontWeight: 'var(--font-weight-semibold)' }}>{cancelTarget.total_quantity.toLocaleString()} PCS</p>
                                </div>
                            </div>
                        </div>

                        {/* Type MPL Number to confirm */}
                        <div>
                            <Label required>Type MPL Number to confirm</Label>
                            <input 
                                type="text" 
                                value={cancelConfirmInput} 
                                onChange={e => setCancelConfirmInput(e.target.value)} 
                                placeholder={`Enter "${cancelTarget.mpl_number}" to confirm`} 
                                onPaste={e => e.preventDefault()} 
                                onCopy={e => e.preventDefault()} 
                                onCut={e => e.preventDefault()} 
                                onDrop={e => e.preventDefault()} 
                                onContextMenu={e => e.preventDefault()} 
                                autoComplete="off" 
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    fontSize: 'var(--font-size-base)',
                                    fontWeight: 'var(--font-weight-normal)',
                                    color: 'var(--foreground)',
                                    backgroundColor: 'var(--background)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--border-radius-md)',
                                    outline: 'none',
                                    transition: 'all var(--transition-fast)',
                                    boxSizing: 'border-box'
                                }} 
                            />
                            <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '6px' }}>
                                Must match exactly: <strong>{cancelTarget.mpl_number}</strong>
                            </p>
                        </div>

                        {/* Reason */}
                        <div>
                            <Label required>Reason for cancellation</Label>
                            <textarea 
                                value={cancelReason} 
                                onChange={e => setCancelReason(e.target.value)} 
                                placeholder="Please provide the reason for cancelling this packing list..." 
                                rows={3} 
                                style={{
                                    width: '100%',
                                    padding: '8px 12px',
                                    fontSize: 'var(--font-size-base)',
                                    color: 'var(--foreground)',
                                    backgroundColor: 'var(--background)',
                                    border: '1px solid var(--border-color)',
                                    borderRadius: 'var(--border-radius-md)',
                                    outline: 'none',
                                    resize: 'vertical',
                                    fontFamily: 'inherit',
                                    transition: 'all var(--transition-fast)',
                                    boxSizing: 'border-box'
                                }} 
                            />
                        </div>

                        {/* Actions */}
                        <div style={{ display: 'flex', justifyContent: 'center', gap: '12px', marginTop: '8px' }}>
                            <Button 
                                variant="secondary" 
                                onClick={() => { setCancelTarget(null); setCancelReason(''); setCancelConfirmInput(''); }} 
                                style={{ flex: 1 }}
                            >
                                Keep
                            </Button>
                            <Button 
                                variant="danger" 
                                disabled={cancelling || cancelConfirmInput.trim() !== cancelTarget.mpl_number || !cancelReason.trim()}
                                onClick={handleCancelConfirm} 
                                style={{ flex: 1, gap: '8px' }}
                            >
                                {cancelling ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Cancelling...</> : <><XCircle size={16} /> Cancel Packing List</>}
                            </Button>
                        </div>
                    </div>
                </Modal>
            )}

            {/* Detail Slideout */}
            {
                showDetail && selectedMpl && <div style={{ position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'flex-end', zIndex: 999 }} onClick={e => { if (e.target === e.currentTarget) setShowDetail(false); }}><div style={{ width: 640, maxWidth: '90vw', backgroundColor: '#fff', height: '100vh', overflowY: 'auto', padding: 28, boxShadow: '-8px 0 30px rgba(0,0,0,0.15)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}><div><h2 style={{ fontSize: 22, fontWeight: 800, color: '#111827', margin: '0 0 8px' }}>{selectedMpl.mpl_number}</h2><StatusBadge status={selectedMpl.status} /></div><button onClick={() => setShowDetail(false)} style={{ padding: 8, borderRadius: 8, border: '1px solid #e5e7eb', backgroundColor: '#fff', cursor: 'pointer' }}><XCircle size={18} style={{ color: '#6b7280' }} /></button></div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, padding: 16, backgroundColor: '#f9fafb', borderRadius: 12, marginBottom: 24, fontSize: 13 }}>
                        <div><span style={{ color: '#6b7280', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.3px' }}>MSN</span><div style={{ fontWeight: 600, marginTop: 2 }}>{selectedMpl.item_code}</div></div>
                        <div><span style={{ color: '#6b7280', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.3px' }}>BPA #</span><div style={{ fontWeight: 600, marginTop: 2 }}>{selectedMpl.po_number || '—'}</div></div>
                        <div><span style={{ color: '#6b7280', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.3px' }}>Invoice #</span><div style={{ fontWeight: 600, marginTop: 2 }}>{selectedMpl.invoice_number || '—'}</div></div>
                        <div><span style={{ color: '#6b7280', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.3px' }}>Pallets (Nos)</span><div style={{ fontWeight: 700, marginTop: 2, color: '#1e3a8a' }}>{selectedMpl.total_pallets}</div></div>
                        <div><span style={{ color: '#6b7280', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.3px' }}>Qty (Nos)</span><div style={{ fontWeight: 700, marginTop: 2, fontFamily: 'monospace' }}>{selectedMpl.total_quantity.toLocaleString()}</div></div>
                        <div><span style={{ color: '#6b7280', fontSize: 10, textTransform: 'uppercase', fontWeight: 700, letterSpacing: '0.3px' }}>Gross Wt</span><div style={{ fontWeight: 700, marginTop: 2, fontFamily: 'monospace' }}>{Number(selectedMpl.total_gross_weight_kg).toFixed(2)} kg</div></div>
                    </div>
                    <h3 style={{ fontSize: 15, fontWeight: 700, color: '#111827', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}><Package size={16} style={{ color: '#1e3a8a' }} />Pallet Breakdown</h3>
                    {detailLoading ? <div style={{ padding: 32, textAlign: 'center', color: '#9ca3af', display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 8 }}><Loader2 size={22} style={{ animation: 'spin 1s linear infinite', color: '#1e3a8a' }} /><span style={{ fontSize: 13 }}>Loading pallets...</span></div> : selectedPallets.map(p => (
                        <div key={p.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, marginBottom: 12, overflow: 'hidden' }}>
                            <div style={{ padding: '10px 16px', background: 'linear-gradient(135deg, #eff6ff, #f0f4ff)', display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600, borderBottom: '1px solid #e5e7eb' }}><span style={{ color: '#1e3a8a', fontFamily: 'monospace' }}>{p.pallet_number}</span><span style={{ color: '#4b5563' }}>{p.container_count} boxes · {p.quantity.toLocaleString()} PCS</span></div>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}><thead><tr style={{ backgroundColor: '#fafbfc' }}><th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.3px' }}>Packing Box ID</th><th style={{ padding: '8px 12px', textAlign: 'right', color: '#6b7280', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>Qty</th><th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>Type</th><th style={{ padding: '8px 12px', textAlign: 'left', color: '#6b7280', fontWeight: 700, fontSize: 10, textTransform: 'uppercase' }}>Operator</th></tr></thead>
                                <tbody>{(p.inner_box_details || []).map((box: any, bi: number) => (
                                    <tr key={bi} style={{ borderTop: '1px solid #f3f4f6' }}><td style={{ padding: '6px 12px', fontFamily: 'monospace', fontWeight: 700, color: '#7c3aed' }}>{box.packing_id || '—'}</td><td style={{ padding: '6px 12px', textAlign: 'right', fontWeight: 600, fontFamily: 'monospace' }}>{box.quantity.toLocaleString()}</td><td style={{ padding: '6px 12px' }}><span style={{ padding: '2px 8px', borderRadius: 8, fontSize: 10, fontWeight: 700, backgroundColor: box.is_adjustment ? '#fef3c7' : '#d1fae5', color: box.is_adjustment ? '#92400e' : '#065f46' }}>{box.is_adjustment ? 'ADJ' : 'STD'}</span></td><td style={{ padding: '6px 12px', color: '#6b7280' }}>{box.operator}</td></tr>
                                ))}</tbody></table>
                        </div>
                    ))}
                    {auditLog.length > 0 && <><h3 style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: '24px 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}><Clock size={16} style={{ color: '#1e3a8a' }} />Audit Trail</h3><div style={{ fontSize: 12 }}>{auditLog.map(a => (<div key={a.id} style={{ display: 'flex', gap: 12, padding: '10px 0', borderBottom: '1px solid #f3f4f6', alignItems: 'center' }}><span style={{ color: '#9ca3af', minWidth: 110, whiteSpace: 'nowrap', fontSize: 11, fontFamily: 'monospace' }}>{new Date(a.performed_at).toLocaleString()}</span><span style={{ fontWeight: 700, color: '#374151' }}>{a.action}</span>{a.from_status && a.to_status && <span style={{ color: '#6b7280', display: 'flex', alignItems: 'center', gap: 4 }}>{a.from_status} <ChevronRight size={12} /> {a.to_status}</span>}<span style={{ color: '#9ca3af', marginLeft: 'auto', fontSize: 11 }}>{a.performer_name}</span></div>))}</div></>}
                </div></div>
            }

            <style>{`
                @keyframes spin{to{transform:rotate(360deg)}}
                @keyframes slideInDown{from{opacity:0;transform:translateY(-16px)}to{opacity:1;transform:translateY(0)}}
            `}</style>
        </div >
    );
}
