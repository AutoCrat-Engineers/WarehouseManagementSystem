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
import { Search, Truck, CheckCircle2, Package, Plus, Loader2, XCircle, Eye, AlertCircle, AlertTriangle, RefreshCw, ChevronLeft, ChevronRight, Hash, ArrowRight, Mail, Send, FileText, ShieldCheck, Anchor, Printer, ChevronDown, X, Settings, Stamp } from 'lucide-react';
import { getSupabaseClient } from '../../utils/supabase/client';
import { fetchMasterPackingLists, createPerformaInvoice, approvePerformaInvoice, cancelPerformaInvoice } from './mplService';
import type { MasterPackingList } from './mplService';
import { Card, ModuleLoader } from '../ui/EnterpriseUI';
import {
    SummaryCardsGrid, SummaryCard, FilterBar, SearchBox, ActionBar, AddButton,
    RefreshButton, DateRangeFilter,
    sharedThStyle, sharedTdStyle,
} from '../ui/SharedComponents';

type UserRole = 'L1' | 'L2' | 'L3' | null;
interface Props { accessToken?: string; userRole?: UserRole; userPerms?: Record<string, boolean>; onNavigate?: (view: string) => void; }

interface PIRecord { id: string; proforma_number: string; shipment_number: string | null; customer_name: string | null; status: string; total_invoices: number; total_pallets: number; total_quantity: number; total_gross_weight_kg?: number; stock_movement_id: string | null; stock_moved_at: string | null; cancelled_at?: string | null; created_at: string; created_by_name?: string; }
interface PickedMpl { mpl: MasterPackingList; verified: boolean; }

type PIStep = 'LIST' | 'SHIPMENT' | 'SEARCH_PICK' | 'REVIEW_PI' | 'APPROVE' | 'DETAIL';

export function PerformaInvoice({ userRole, userPerms = {}, onNavigate }: Props) {
    const supabase = getSupabaseClient();
    const canCreate = userRole === 'L3' || userRole === 'L2';
    const canApprove = userRole === 'L3';

    const [step, setStep] = useState<PIStep>('LIST');
    const [pis, setPis] = useState<PIRecord[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMsg, setSuccessMsg] = useState<string | null>(null);

    // List search & filter
    const [searchTerm, setSearchTerm] = useState('');
    type StatusFilterType = 'ALL' | 'DRAFT' | 'CONFIRMED' | 'STOCK_MOVED';
    const [statusFilter, setStatusFilter] = useState<StatusFilterType>('ALL');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

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
        if (dateFrom) result = result.filter(p => p.created_at >= dateFrom);
        if (dateTo) result = result.filter(p => p.created_at <= dateTo + 'T23:59:59');
        if (searchTerm.trim()) {
            const s = searchTerm.toLowerCase();
            result = result.filter(p =>
                p.proforma_number.toLowerCase().includes(s) ||
                (p.shipment_number || '').toLowerCase().includes(s) ||
                (p.customer_name || '').toLowerCase().includes(s)
            );
        }
        return result;
    }, [pis, statusFilter, searchTerm, dateFrom, dateTo]);

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

    // Cancel flow (type-to-confirm)
    const [cancelTarget, setCancelTarget] = useState<PIRecord | null>(null);
    const [cancelReason, setCancelReason] = useState('');
    const [cancelConfirmInput, setCancelConfirmInput] = useState('');
    const [cancelling, setCancelling] = useState(false);

    // Detail
    const [selectedPI, setSelectedPI] = useState<PIRecord | null>(null);
    const [piMpls, setPiMpls] = useState<any[]>([]);
    const [detailLoading, setDetailLoading] = useState(false);
    const [expandedMpls, setExpandedMpls] = useState<Set<string>>(new Set());
    const [mplPalletDetails, setMplPalletDetails] = useState<Record<string, any[]>>({});
    const [reviewPalletDetails, setReviewPalletDetails] = useState<Record<string, any[]>>({});
    const [reviewLoading, setReviewLoading] = useState(false);

    // Inspect MPL before picking
    const [inspectMplId, setInspectMplId] = useState<string | null>(null);
    const [inspectPallets, setInspectPallets] = useState<any[]>([]);
    const [inspectLoading, setInspectLoading] = useState(false);

    // Load PIs (isRefresh avoids full-screen loading)
    const loadPIs = useCallback(async (isRefresh = false) => {
        if (isRefresh) setRefreshing(true); else setLoading(true);
        try {
            const { data, error: piErr } = await supabase.from('pack_proforma_invoices').select('*, profiles!pack_proforma_invoices_created_by_fkey (full_name)').order('created_at', { ascending: false }).limit(100);
            if (piErr) throw piErr;
            const piList = (data || []).map((d: any) => ({ ...d, created_by_name: d.profiles?.full_name || '—' }));

            // Enrich DRAFT PIs with live active MPL counts (stale total_invoices fix)
            const draftPiIds = piList.filter((p: any) => p.status === 'DRAFT').map((p: any) => p.id);
            if (draftPiIds.length > 0) {
                const { data: junctionRows } = await supabase
                    .from('proforma_invoice_mpls')
                    .select('proforma_id, mpl_id')
                    .in('proforma_id', draftPiIds);
                if (junctionRows && junctionRows.length > 0) {
                    const allMplIds = [...new Set(junctionRows.map((j: any) => j.mpl_id))];
                    const { data: mplStatuses } = await supabase
                        .from('master_packing_lists')
                        .select('id, status')
                        .in('id', allMplIds);
                    const cancelledMplIds = new Set((mplStatuses || []).filter((m: any) => m.status === 'CANCELLED').map((m: any) => m.id));
                    // Count active MPLs per PI
                    const activeCounts: Record<string, number> = {};
                    for (const j of junctionRows) {
                        if (!cancelledMplIds.has(j.mpl_id)) {
                            activeCounts[j.proforma_id] = (activeCounts[j.proforma_id] || 0) + 1;
                        }
                    }
                    // Override total_invoices with real active count
                    for (const pi of piList) {
                        if (pi.status === 'DRAFT') {
                            pi.total_invoices = activeCounts[pi.id] || 0;
                        }
                    }
                }
            }

            setPis(piList);
        } catch (err: any) { setError(err.message); } finally { setLoading(false); setRefreshing(false); }
    }, [supabase]);

    useEffect(() => { loadPIs(); }, [loadPIs]);

    const handleRefresh = () => loadPIs(true);

    // Step 1: Enter shipment number
    const handleStartCreate = () => { setStep('SHIPMENT'); setShipmentNumber(''); setPickedMpls([]); setSearchResults([]); setSearchQuery(''); };

    const handleShipmentSubmit = () => {
        if (!shipmentNumber.trim()) { setError('Shipment number is required'); return; }
        setError(null); setStep('SEARCH_PICK');
    };

    // Step 2: Search by Invoice/PO
    const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const executeSearch = useCallback(async (query: string) => {
        if (!query.trim()) { setSearchResults([]); return; }
        setSearching(true); setError(null);
        try {
            const { data } = await fetchMasterPackingLists({ search: query.trim(), limit: 50 });
            // Filter: only CONFIRMED/PRINTED, not already picked, not already in a PI
            const alreadyPickedIds = new Set(pickedMpls.map(p => p.mpl.id));
            const eligible = data.filter(m => (m.status === 'CONFIRMED' || m.status === 'PRINTED') && !m.proforma_invoice_id && !alreadyPickedIds.has(m.id));
            setSearchResults(eligible);
            if (eligible.length === 0 && data.length > 0) setError('All matching MPLs are already picked or in another PI');
        } catch (err: any) { setError(err.message); } finally { setSearching(false); }
    }, [pickedMpls]);

    const handleSearch = () => executeSearch(searchQuery);

    // Auto-search as user types (debounced, min 2 chars)
    useEffect(() => {
        if (step !== 'SEARCH_PICK') return;
        if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
        if (!searchQuery.trim()) { setSearchResults([]); return; }
        if (searchQuery.trim().length < 2) return;
        searchDebounceRef.current = setTimeout(() => {
            executeSearch(searchQuery);
        }, 300);
        return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
    }, [searchQuery, step, executeSearch]);

    // Pick an MPL
    const handlePickMpl = (mpl: MasterPackingList) => {
        setPickedMpls(prev => [...prev, { mpl, verified: true }]);
        setSearchResults(prev => prev.filter(m => m.id !== mpl.id));
        setSearchQuery(''); setInspectMplId(null); setInspectPallets([]);
    };

    const handleVerifyMpl = (mplId: string) => { setPickedMpls(prev => prev.map(p => p.mpl.id === mplId ? { ...p, verified: true } : p)); };
    const handleRemoveMpl = (mplId: string) => { setPickedMpls(prev => prev.filter(p => p.mpl.id !== mplId)); };

    // Inspect MPL — fetch pallets for preview before picking
    const handleInspectMpl = async (mplId: string) => {
        if (inspectMplId === mplId) { setInspectMplId(null); setInspectPallets([]); return; }
        setInspectMplId(mplId); setInspectLoading(true);
        try {
            const { data } = await supabase.from('master_packing_list_pallets').select('*').eq('mpl_id', mplId).eq('status', 'ACTIVE').order('line_number');
            setInspectPallets(data || []);
        } catch { setInspectPallets([]); } finally { setInspectLoading(false); }
    };

    // Step 3: Review & Generate — fetch pallet details for review
    const handleGeneratePI = async () => {
        if (pickedMpls.length === 0) { setError('Pick at least one MPL'); return; }
        setStep('REVIEW_PI'); setReviewLoading(true); setReviewPalletDetails({});
        try {
            const mplIds = pickedMpls.map(p => p.mpl.id);
            const { data: mplPallets } = await supabase
                .from('master_packing_list_pallets')
                .select('*')
                .in('mpl_id', mplIds)
                .eq('status', 'ACTIVE')
                .order('line_number');

            if (mplPallets && mplPallets.length > 0) {
                const palletIds = [...new Set(mplPallets.map((p: any) => p.pallet_id))];
                const { data: pallets } = await supabase.from('pack_pallets').select('id, pallet_number, item_code, state, current_qty, container_count').in('id', palletIds);
                const palletMap = new Map((pallets || []).map((p: any) => [p.id, p]));

                const itemCodes = [...new Set(mplPallets.map((p: any) => p.item_code).filter(Boolean))];
                const { data: items } = await supabase.from('items').select('item_code, item_name, part_number, master_serial_no, revision, weight').in('item_code', itemCodes);
                const itemMap = new Map((items || []).map((i: any) => [i.item_code, i]));

                const { data: plPalletDetails } = await supabase.from('pack_packing_list_pallet_details').select('*').in('pallet_id', palletIds);
                const plDetailMap = new Map((plPalletDetails || []).map((d: any) => [d.pallet_id, d]));

                const grouped: Record<string, any[]> = {};
                for (const mp of mplPallets) {
                    const palletInfo = palletMap.get(mp.pallet_id) || {};
                    const itemInfo = itemMap.get(mp.item_code) || {};
                    const plDetail = plDetailMap.get(mp.pallet_id) || {};
                    if (!grouped[mp.mpl_id]) grouped[mp.mpl_id] = [];
                    grouped[mp.mpl_id].push({
                        ...mp,
                        pallet_number: palletInfo.pallet_number || mp.pallet_number || '—',
                        pallet_state: palletInfo.state || '—',
                        part_number: plDetail.part_number || itemInfo.part_number || '—',
                        master_serial_no: plDetail.master_serial_no || itemInfo.master_serial_no || '—',
                        revision: plDetail.part_revision || itemInfo.revision || '—',
                        item_description: itemInfo.item_name || mp.item_name || '—',
                        hts_code: plDetail.hts_code || '—',
                        pallet_dims: plDetail.pallet_length_cm ? `${plDetail.pallet_length_cm}×${plDetail.pallet_width_cm}×${plDetail.pallet_height_cm} cm` : '—',
                        carton_number: plDetail.carton_number || '—',
                    });
                }
                setReviewPalletDetails(grouped);
            }
        } catch (err: any) { console.error('Failed to load review pallets', err); }
        finally { setReviewLoading(false); }
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
        setExpandedMpls(new Set()); setMplPalletDetails({});
        try {
            const { data, error: err } = await supabase.from('proforma_invoice_mpls').select('*').eq('proforma_id', pi.id).order('line_number');
            if (err) throw err;
            const mpls = data || [];
            setPiMpls(mpls);

            // Fetch pallet details for all MPLs in parallel
            const mplIds = mpls.map((m: any) => m.mpl_id).filter(Boolean);
            if (mplIds.length > 0) {
                const { data: mplPallets } = await supabase
                    .from('master_packing_list_pallets')
                    .select('*')
                    .in('mpl_id', mplIds)
                    .eq('status', 'ACTIVE')
                    .order('line_number');

                if (mplPallets && mplPallets.length > 0) {
                    // Fetch pallet numbers
                    const palletIds = [...new Set(mplPallets.map((p: any) => p.pallet_id))];
                    const { data: pallets } = await supabase.from('pack_pallets').select('id, pallet_number, item_code, state, current_qty, container_count').in('id', palletIds);
                    const palletMap = new Map((pallets || []).map((p: any) => [p.id, p]));

                    // Fetch item details (part_number, master_serial_no, revision)
                    const itemCodes = [...new Set(mplPallets.map((p: any) => p.item_code).filter(Boolean))];
                    const { data: items } = await supabase.from('items').select('item_code, item_name, part_number, master_serial_no, revision, weight').in('item_code', itemCodes);
                    const itemMap = new Map((items || []).map((i: any) => [i.item_code, i]));

                    // Fetch packing list pallet details (for extra info like hts_code, dimensions)
                    const { data: plPalletDetails } = await supabase.from('pack_packing_list_pallet_details').select('*').in('pallet_id', palletIds);
                    const plDetailMap = new Map((plPalletDetails || []).map((d: any) => [d.pallet_id, d]));

                    // Group by MPL ID
                    const grouped: Record<string, any[]> = {};
                    for (const mp of mplPallets) {
                        const palletInfo = palletMap.get(mp.pallet_id) || {};
                        const itemInfo = itemMap.get(mp.item_code) || {};
                        const plDetail = plDetailMap.get(mp.pallet_id) || {};
                        if (!grouped[mp.mpl_id]) grouped[mp.mpl_id] = [];
                        grouped[mp.mpl_id].push({
                            ...mp,
                            pallet_number: palletInfo.pallet_number || mp.pallet_number || '—',
                            pallet_state: palletInfo.state || '—',
                            part_number: plDetail.part_number || itemInfo.part_number || '—',
                            master_serial_no: plDetail.master_serial_no || itemInfo.master_serial_no || '—',
                            revision: plDetail.part_revision || itemInfo.revision || '—',
                            item_description: itemInfo.item_name || mp.item_name || '—',
                            hts_code: plDetail.hts_code || '—',
                            pallet_dims: plDetail.pallet_length_cm ? `${plDetail.pallet_length_cm}×${plDetail.pallet_width_cm}×${plDetail.pallet_height_cm} cm` : '—',
                            carton_number: plDetail.carton_number || '—',
                            batch_number: plDetail.batch_number || '—',
                            invoice_number_pl: plDetail.invoice_number || '—',
                            po_number_pl: plDetail.po_number || '—',
                            unit_weight: itemInfo.weight || null,
                        });
                    }
                    setMplPalletDetails(grouped);
                    // Auto-expand all MPLs
                    setExpandedMpls(new Set(mplIds));
                }
            }
        } catch (err: any) { setError(err.message); } finally { setDetailLoading(false); }
    };

    const toggleMplExpand = (mplId: string) => {
        setExpandedMpls(prev => {
            const next = new Set(prev);
            if (next.has(mplId)) next.delete(mplId); else next.add(mplId);
            return next;
        });
    };



    // Cancel PI (type-to-confirm) — unlinks MPLs so they can be reused
    const handleCancelPI = async () => {
        if (!cancelTarget) return;
        if (cancelConfirmInput.trim() !== cancelTarget.proforma_number) return;
        if (!cancelReason.trim()) return;
        setCancelling(true);
        try {
            await cancelPerformaInvoice(cancelTarget.id, cancelReason.trim());
            showToast('success', 'PI Cancelled', `${cancelTarget.proforma_number} has been cancelled — linked MPLs are available for reuse`);
            setCancelTarget(null); setCancelReason(''); setCancelConfirmInput(''); loadPIs(true);
        } catch (err: any) { showToast('error', 'Cancel Failed', err.message); } finally { setCancelling(false); }
    };

    // Step: Approve with emails — validate MPLs exist at runtime
    const handleOpenApprove = async (pi: PIRecord) => {
        // Live check: count active MPLs still linked to this PI
        const { data: activeMpls, error: mplErr } = await supabase
            .from('proforma_invoice_mpls')
            .select('mpl_id')
            .eq('proforma_id', pi.id);
        if (mplErr || !activeMpls || activeMpls.length === 0) {
            showToast('error', 'Cannot Approve', 'This Proforma Invoice has no linked MPLs. It may need to be cancelled and recreated.');
            return;
        }
        // Also verify the linked MPLs are not themselves cancelled
        const mplIds = activeMpls.map((m: any) => m.mpl_id);
        const { data: mplRecords } = await supabase
            .from('master_packing_lists')
            .select('id, status')
            .in('id', mplIds)
            .neq('status', 'CANCELLED');
        if (!mplRecords || mplRecords.length === 0) {
            showToast('error', 'Cannot Approve', 'All linked MPLs have been cancelled. Cancel this Proforma Invoice and create a new one.');
            return;
        }
        setApproveTarget(pi); setApprovalEmails(''); setStep('APPROVE');
    };

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

            // Fetch part_number and standard_cost from items table
            const uniqueItemCodes = [...new Set((mplPallets || []).map((p: any) => p.item_code))];
            let itemsLookup: Record<string, { part_number: string; standard_cost: number }> = {};
            if (uniqueItemCodes.length > 0) {
                const { data: itemsData } = await supabase
                    .from('items')
                    .select('item_code, part_number, standard_cost')
                    .in('item_code', uniqueItemCodes);
                for (const itm of (itemsData || [])) {
                    itemsLookup[itm.item_code] = {
                        part_number: itm.part_number || itm.item_code,
                        standard_cost: itm.standard_cost || 0,
                    };
                }
            }

            // Build item rows from pallet details using items lookup
            const itemRows: Array<{ po: string; partNo: string; desc: string; qty: number; rate: number; amount: number }> = [];
            for (const p of (mplPallets || [])) {
                const mpl = mplFull?.find((m: any) => m.id === p.mpl_id);
                const itemInfo = itemsLookup[p.item_code] || { part_number: p.item_code, standard_cost: 0 };
                const rate = itemInfo.standard_cost;
                const amount = rate * p.quantity;
                itemRows.push({ po: mpl?.po_number || '', partNo: itemInfo.part_number, desc: p.item_name || p.item_code, qty: p.quantity, rate, amount });
            }
            const totalAmount = itemRows.reduce((s, r) => s + r.amount, 0);
            const totalQtyAll = itemRows.reduce((s, r) => s + r.qty, 0);
            const piDate = new Date(pi.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
            const invNo = plData?.invoice_number || mplFull?.[0]?.invoice_number || '';
            const poNo = plData?.purchase_order_number || mplFull?.[0]?.po_number || '';
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
                let w = 'USD : ' + convert(intPart);
                if (decPart > 0) w += ' and ' + convert(decPart) + ' Cents';
                return w + ' Only';
            };
            // Build rows HTML
            const rowsHtml = itemRows.map((r, i) => `<tr><td class="br c4 ctr" style="padding:2px 4px">${i + 1}</td><td class="br c4" style="padding:2px 4px">${r.po}</td><td class="br c4" style="font-size:11px;font-weight:700;padding:2px 4px">${r.partNo}</td><td class="br c4" style="padding:2px 4px"><div style="font-size:14px">${r.desc}</div></td><td class="br c4 rgt mono" style="padding:2px 4px">${r.qty.toLocaleString()}<br/><span class="sm">Nos</span></td><td class="br c4 rgt mono" style="padding:2px 4px">${r.rate.toFixed(2)}</td><td class="c4 rgt mono" style="padding:2px 4px"><b>${r.amount.toFixed(2)}</b></td></tr>`).join('');
            // Pad empty rows to fill at least 5 rows
            const emptyRowsNeeded = Math.max(0, 5 - itemRows.length);
            const emptyRowsHtml = Array(emptyRowsNeeded).fill('<tr><td class="br c4 ctr">&nbsp;</td><td class="br c4"></td><td class="br c4"></td><td class="br c4"></td><td class="c4"></td></tr>').join('');
            const nowStr = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' }) + ', ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
            const totalRate = itemRows.reduce((s, r) => s + r.rate, 0);

            const w = window.open('', '_blank', 'width=900,height=1100');
            if (!w) { alert('Please allow popups'); return; }
            w.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Proforma Invoice ${pi.proforma_number}</title>
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
<td class="c4 ctr" style="font-size:9px">PI-${pi.proforma_number}</td>
<td class="c4 rgt" style="font-size:9px"></td>
</tr></table>

<div class="outer">

<!-- ═══ LOGO + TITLE ═══ -->
<table><tr style="position:relative">
<td class="bb c4" style="padding:6px 8px;width:30%"><img src="/logo.png" alt="AUTOCRAT ENGINEERS" style="height:34px;object-fit:contain" onerror="this.outerHTML='<span style=font-size:11px;font-weight:800>AUTOCRAT<br>ENGINEERS</span>'" /></td>
<td class="bb c4" style="padding:8px;width:70%"><div style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);text-align:center;pointer-events:none"><span style="font-size:20px;font-weight:800;letter-spacing:5px;text-transform:uppercase;font-style:italic">PROFORMA INVOICE</span></div></td>
</tr></table>

<!-- ═══ COMPANY + CODES ═══ -->
<table>
<colgroup><col style="width:40%"/><col style="width:20%"/><col style="width:40%"/></colgroup>
<tr>
<td class="bb br c4" rowspan="4" style="vertical-align:top;padding:4px 6px">
<div style="display:flex;justify-content:space-between;align-items:baseline;padding:2px 0">
<span style="font-size:12px;font-weight:700">Exporter</span>
<span style="font-size:11px;font-weight:700">Vendor No : 114395</span>
</div>
<div style="padding:3px 0;line-height:1.5">
<div style="font-size:13px;font-weight:800">AUTOCRAT ENGINEERS</div>
<div style="font-size:12px">NO. 21 & 22, Export Promotion Industrial Park, Phase - I,</div>
<div style="font-size:12px">Whitefield, Bangalore-560066,</div>
<div style="font-size:12px">KARNATAKA - INDIA</div>
<div style="font-size:12px">GSTIN : 29ABLPK6831H1ZB</div>
</div>
</td>
<td class="bb br c4" style="font-size:12px;font-weight:700;padding:4px 6px">Proforma Invoice No & Date :</td>
<td class="bb c4" style="padding:4px 6px"><div style="font-size:13px;font-weight:700">${pi.proforma_number}</div><div style="font-size:12px;color:#333;margin-top:1px">${piDate}</div></td>
</tr>
<tr>
<td class="bb br c4" style="font-size:12px;font-weight:700;padding:4px 6px">IEC Code No :</td>
<td class="bb c4" style="font-size:13px;padding:4px 6px;font-family:'Courier New',monospace">0702002747</td>
</tr>
<tr>
<td class="bb br c4" style="font-size:12px;font-weight:700;padding:4px 6px">AD Code No :</td>
<td class="bb c4" style="font-size:13px;padding:4px 6px;font-family:'Courier New',monospace">6361504-8400009</td>
</tr>
<tr>
<td class="bb br c4" style="font-size:12px;font-weight:700;padding:4px 6px">Terms of Delivery & Payment :</td>
<td class="bb c4" style="font-size:13px;padding:4px 6px">DDP</td>
</tr>

<!-- ═══ CONSIGNEE + BUYER ═══ -->
<tr>
<td class="bb br c4" rowspan="2" style="vertical-align:top;padding:4px 6px">
<div style="font-size:12px;font-weight:700;padding:2px 0">Consignee</div>
<div style="padding:3px 0;line-height:1.5">
<div style="font-size:13px;font-weight:700">OPW FUELING COMPONENTS, LLC</div>
<div style="font-size:11px">MILANO MILLWORKS, LLC OF 9223</div>
<div style="font-size:11px">INDUSTRIAL BLVD NE,</div>
<div style="font-size:11px">LELAND NC 28451 USA</div>
</div>
</td>
<td class="bb br c4" style="font-size:12px;font-weight:700;padding:4px 6px">Buyer Details:</td>
<td class="bb c4" style="font-size:13px;padding:4px 6px"><div style="font-weight:700">PASSLER, DAVID</div><div style="font-size:11px;color:#333;margin-top:2px">+1 919-271-7169</div><div style="font-size:11px;color:#333;margin-top:1px">DAVIDPASSLER@OPWGLOBAL.COM</div></td>
</tr>
<tr>
<td class="bb br c4" style="font-size:12px;font-weight:700;padding:4px 6px">Bill To :</td>
<td class="bb c4" style="font-size:12px;padding:4px 6px">OPW FUELING COMPONENTS LLC <br>3250 US HIGHWAY 70, SMITHFIELD 275577, USA</td>
</tr>
</table>

<!-- ═══ TRANSPORT ROW ═══ -->
<table>
<colgroup><col style="width:20%"/><col style="width:20%"/><col style="width:20%"/><col style="width:20%"/><col style="width:20%"/></colgroup>
<tr>
<td class="bb br c4" style="padding:5px 6px"><span style="font-size:12px;font-weight:700">Freight Forwarder</span><br/><span style="font-size:13px;font-weight:700">WEISS ROHLING INDIA</span></td>
<td class="bb br c4" style="padding:5px 6px"><span style="font-size:12px;font-weight:700">Mode of Transport</span><br/><span style="font-size:13px;font-weight:700">SEA</span></td>
<td class="bb br c4" style="padding:5px 6px"><span style="font-size:12px;font-weight:700">Port of Discharge</span><br/><span style="font-size:13px;font-weight:700">CHARLESTON</span></td>
<td class="bb br c4" style="padding:5px 6px"><span style="font-size:12px;font-weight:700">Country of Origin</span><br/><span style="font-size:13px;font-weight:700">INDIA</span></td>
<td class="bb c4" style="padding:5px 6px"><span style="font-size:12px;font-weight:700">Final Destination</span><br/><span style="font-size:13px;font-weight:700">UNITED STATES</span></td>
</tr>
</table>

<!-- ═══ DESCRIPTION HEADER ═══ -->
<table><tr><td class="bb c4 ctr" style="padding:3px;font-weight:800;font-size:12px;text-transform:uppercase;letter-spacing:1px">PRECISION MACHINED COMPONENTS<br/><span style="font-weight:700;font-size:10px">(OTHERS FUELING COMPONENTS)</span></td></tr></table>

<!-- ═══ ITEMS TABLE ═══ -->
<div class="grow" style="overflow:hidden;display:flex;flex-direction:column;border-bottom:1px solid #000">
<table>
<colgroup><col style="width:5%"/><col style="width:10%"/><col style="width:12%"/><col style="width:33%"/><col style="width:12%"/><col style="width:12%"/><col style="width:16%"/></colgroup>
<tr style="background:#f5f5f5;line-height:1.5">
<td class="bb br ctr" style="font-size:13px;font-weight:700;padding:1px 2px;vertical-align:middle">SL NO</td>
<td class="bb br ctr" style="font-size:13px;font-weight:700;padding:1px 2px;vertical-align:middle">PO#</td>
<td class="bb br ctr" style="font-size:13px;font-weight:700;padding:1px 2px;vertical-align:middle">PART NO</td>
<td class="bb br ctr" style="font-size:13px;font-weight:700;padding:1px 2px;vertical-align:middle">DESCRIPTION</td>
<td class="bb br ctr" style="font-size:13px;font-weight:700;padding:1px 2px;vertical-align:middle">QTY (NOS)</td>
<td class="bb br ctr" style="font-size:13px;font-weight:700;padding:1px 2px;vertical-align:middle">RATE USD</td>
<td class="bb ctr" style="font-size:13px;font-weight:700;padding:1px 2px;vertical-align:middle">AMOUNT USD</td>
</tr>
${rowsHtml}
</table>
<div style="flex:1;display:flex">
<div style="width:5%;border-right:1px solid #000"></div>
<div style="width:10%;border-right:1px solid #000"></div>
<div style="width:12%;border-right:1px solid #000"></div>
<div style="width:33%;border-right:1px solid #000"></div>
<div style="width:12%;border-right:1px solid #000"></div>
<div style="width:12%;border-right:1px solid #000"></div>
<div style="width:16%"></div>
</div>
</div>

<!-- ═══ TOTAL ROW ═══ -->
<table>
<colgroup><col style="width:5%"/><col style="width:10%"/><col style="width:12%"/><col style="width:33%"/><col style="width:12%"/><col style="width:12%"/><col style="width:16%"/></colgroup>
<tr style="font-weight:700">
<td class="bb br c4" colspan="4" style="font-size:12px;padding:5px 6px"><b>Total</b>&nbsp;&nbsp;&mdash;&nbsp;&nbsp;<span style="font-weight:600;font-size:11px;color:#333">${numToWords(totalAmount)}</span></td>
<td class="bb br c4 rgt mono" style="font-size:12px;padding:5px 6px"></td>
<td class="bb br c4 rgt mono" style="font-size:12px;padding:5px 6px"></td>
<td class="bb c4 rgt mono" style="font-size:12px;padding:5px 6px"><b>${totalAmount.toFixed(2)}</b></td>
</tr>
</table>

<!-- ═══ CODES + NOTES + DECLARATION + SIGNATORY (single section) ═══ -->
<table>
<colgroup><col style="width:60%"/><col style="width:40%"/></colgroup>
<tr>
<td class="bt c4" style="padding:4px 6px;vertical-align:top">
<div style="font-size:11px"><b>ITC HS CODE:</b> 84139190</div>
<div style="font-size:11px"><b>HTS Code :</b> 8413919085</div>
<div style="font-size:11px"><b>DBK CODE :</b> 8413B</div>
<div style="margin-top:6px;font-size:10px;color:#c00;font-weight:700">NOTE :</div>
<div style="font-size:10px">1. NON-TAXABLE</div>
<div style="font-size:10px">2. BANK A/C NO: 912030016364407</div>
<div style="font-size:10px">3. REMIT TO: AXIS BANK LTD, BANGALORE, 560 001 KARNATAKA, INDIA</div>
<div style="margin-top:6px;font-size:10px;color:#c00;font-weight:700">DECLARATION :</div>
<div style="font-size:10px">WE DECLARE THAT THIS INVOICE SHOWS THE ACTUAL PRICE OF THE GOODS DESCRIBED AND THAT ALL PARTICULARS ARE TRUE AND CORRECT.</div>
</td>
<td class="c4 rgt" style="padding:4px 6px;vertical-align:bottom">
<div style="font-size:12px;font-weight:700">for AUTOCRAT ENGINEERS</div>
<div style="font-size:10px;font-weight:400;font-style:italic">Authorised Signatory</div>
</td>
</tr>
</table>

</div><!-- /outer -->

<!-- ═══ FOOTER ═══ -->
<table style="margin-top:3px"><tr>
<td class="c4" style="font-size:8px;color:#777">PI#: ${pi.proforma_number}</td>
<td class="c4 ctr" style="font-size:8px;color:#777">Printed: ${nowStr}</td>
<td class="c4 rgt" style="font-size:8px;color:#777">System-generated proforma invoice</td>
</tr></table>

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
        return <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4, padding: '4px 12px', borderRadius: 12, fontSize: 11, fontWeight: 700, backgroundColor: s.bg, color: s.color, letterSpacing: '0.3px', minWidth: 90, textAlign: 'center' as const, whiteSpace: 'nowrap' as const }}>{s.label}</span>;
    };

    const th = sharedThStyle;
    const td = sharedTdStyle;

    if (loading && step === 'LIST') return <ModuleLoader moduleName="Proforma Invoices" icon={<Stamp size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />;

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
                        <DateRangeFilter
                            dateFrom={dateFrom}
                            dateTo={dateTo}
                            onDateFromChange={setDateFrom}
                            onDateToChange={setDateTo}
                        />
                        <ActionBar>
                            <RefreshButton onClick={handleRefresh} loading={refreshing} />
                            {step === 'LIST' && canCreate && <AddButton label="Create Proforma Invoice" onClick={handleStartCreate} />}
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
                                            {/* Actions — context-aware main button + dropdown */}
                                            <td style={{ ...td, textAlign: 'center', padding: '8px 12px', position: 'relative' }} onClick={e => e.stopPropagation()}>
                                                <div ref={activeDropdown === pi.id ? dropdownRef : null} style={{ display: 'inline-flex', alignItems: 'center', gap: 0, position: 'relative' }}>
                                                    {/* Main button: Approve (DRAFT with MPLs) / View (other) */}
                                                    {pi.status === 'DRAFT' && canApprove && pi.total_invoices > 0 ? (
                                                        <button onClick={() => handleOpenApprove(pi)} style={{ height: 34, minWidth: 80, padding: '0 14px', borderRadius: '8px 0 0 8px', border: '1px solid #059669', borderRight: 'none', backgroundColor: '#059669', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 600, color: '#fff', transition: 'all 0.15s ease', whiteSpace: 'nowrap' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#047857'} onMouseLeave={e => e.currentTarget.style.backgroundColor = '#059669'}>
                                                            <ShieldCheck size={15} /> Approve
                                                        </button>
                                                    ) : (
                                                        <button onClick={() => handleViewDetail(pi)} style={{ height: 34, minWidth: 80, padding: '0 14px', borderRadius: '8px 0 0 8px', border: '1px solid #e5e7eb', borderRight: 'none', backgroundColor: 'white', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13, fontWeight: 500, color: '#374151', transition: 'all 0.15s ease', whiteSpace: 'nowrap' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'white'}>
                                                            <Eye size={15} /> View
                                                        </button>
                                                    )}
                                                    {/* Dropdown toggle */}
                                                    <button onClick={(e) => { e.stopPropagation(); if (activeDropdown === pi.id) { setActiveDropdown(null); } else { const rect = e.currentTarget.getBoundingClientRect(); setDropdownDirection(window.innerHeight - rect.bottom < 200 ? 'up' : 'down'); setActiveDropdown(pi.id); } }} style={{ height: 34, padding: '0 8px', border: `1px solid ${pi.status === 'DRAFT' && canApprove && pi.total_invoices > 0 ? '#059669' : '#e5e7eb'}`, borderRadius: '0 8px 8px 0', backgroundColor: pi.status === 'DRAFT' && canApprove && pi.total_invoices > 0 ? '#059669' : 'white', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', color: pi.status === 'DRAFT' && canApprove && pi.total_invoices > 0 ? '#fff' : '#374151', transition: 'all 0.15s ease' }} onMouseEnter={e => e.currentTarget.style.opacity = '0.85'} onMouseLeave={e => e.currentTarget.style.opacity = '1'}>
                                                        <ChevronDown size={14} style={{ transition: 'transform 0.2s', transform: activeDropdown === pi.id ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                                                    </button>
                                                    {/* Dropdown menu */}
                                                    {activeDropdown === pi.id && (
                                                        <div style={{ position: 'absolute', ...(dropdownDirection === 'up' ? { bottom: '100%', marginBottom: 4 } : { top: '100%', marginTop: 4 }), right: 0, zIndex: 9999, width: 200, backgroundColor: 'white', borderRadius: 12, boxShadow: '0 10px 40px rgba(0,0,0,0.15)', border: '1px solid #e5e7eb', overflow: 'hidden' }}>
                                                            {/* View Details — only when main button is NOT View */}
                                                            {(pi.status === 'DRAFT' || pi.status === 'CONFIRMED') && (
                                                                <button onClick={() => { handleViewDetail(pi); setActiveDropdown(null); }} style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, textAlign: 'left', color: '#374151' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                                    <Eye size={16} /> View Details
                                                                </button>)}
                                                            {/* Print — always */}
                                                            <div style={{ borderTop: '1px solid #f3f4f6' }} />
                                                            <button onClick={() => { handlePrintPI(pi); setActiveDropdown(null); }} style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, textAlign: 'left', color: '#059669' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#f0fdf4'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                                <Printer size={16} /> Print
                                                            </button>
                                                            {/* Cancel (DRAFT or CONFIRMED) */}
                                                            {(pi.status === 'DRAFT' || pi.status === 'CONFIRMED') && canCreate && (<><div style={{ borderTop: '1px solid #f3f4f6' }} /><button onClick={() => { setCancelTarget(pi); setCancelReason(''); setCancelConfirmInput(''); setActiveDropdown(null); }} style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 10, border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: 14, textAlign: 'left', color: '#dc2626' }} onMouseEnter={e => e.currentTarget.style.backgroundColor = '#fef2f2'} onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}>
                                                                <XCircle size={16} /> Cancel PI
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

            {/* ═══ WIZARD STEP HEADER (visible for all create steps) ═══ */}
            {(step === 'SHIPMENT' || step === 'SEARCH_PICK' || step === 'REVIEW_PI') && (
                <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0 }}>
                    {[{ num: 1, label: 'Shipment', key: 'SHIPMENT' }, { num: 2, label: 'Search & Inspect', key: 'SEARCH_PICK' }, { num: 3, label: 'Review & Create', key: 'REVIEW_PI' }].map((s, i) => {
                        const isActive = step === s.key;
                        const isDone = (s.key === 'SHIPMENT' && (step === 'SEARCH_PICK' || step === 'REVIEW_PI')) || (s.key === 'SEARCH_PICK' && step === 'REVIEW_PI');
                        return (
                            <React.Fragment key={s.key}>
                                {i > 0 && <div style={{ width: 60, height: 2, background: isDone || isActive ? '#1e3a8a' : '#e5e7eb', borderRadius: 1, margin: '0 8px' }} />}
                                <div style={{ display: 'flex', alignItems: 'center', gap: 10, opacity: isActive || isDone ? 1 : 0.4 }}>
                                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: isDone ? '#059669' : isActive ? '#1e3a8a' : '#e5e7eb', color: isDone || isActive ? '#fff' : '#9ca3af', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>
                                        {isDone ? <CheckCircle2 size={16} /> : s.num}
                                    </div>
                                    <span style={{ fontSize: 13, fontWeight: isActive ? 700 : 500, color: isActive ? '#111827' : isDone ? '#059669' : '#9ca3af', whiteSpace: 'nowrap' }}>{s.label}</span>
                                </div>
                            </React.Fragment>
                        );
                    })}
                </div>
            )}

            {/* ═══ STEP 1: SHIPMENT NUMBER ═══ */}
            {step === 'SHIPMENT' && (
                <div style={{ backgroundColor: '#fff', borderRadius: 12, border: '1px solid #e5e7eb', padding: 40, maxWidth: 520, margin: '0 auto' }}>
                    <div style={{ textAlign: 'center', marginBottom: 28 }}>
                        <div style={{ width: 72, height: 72, borderRadius: 20, background: 'linear-gradient(135deg, #dbeafe, #ede9fe)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', boxShadow: '0 8px 24px rgba(30,58,138,0.12)' }}><Anchor size={34} style={{ color: '#1e3a8a' }} /></div>
                        <h3 style={{ fontSize: 20, fontWeight: 800, color: '#111827', marginBottom: 6 }}>Shipment Identification</h3>
                        <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.5 }}>Enter the shipment number to begin building your Proforma Invoice.<br />A PI number will be auto-generated after MPL selection.</p>
                    </div>
                    <div style={{ marginBottom: 24 }}>
                        <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Shipment Number <span style={{ color: '#dc2626' }}>*</span></label>
                        <input value={shipmentNumber} onChange={e => setShipmentNumber(e.target.value)} placeholder="e.g. SHIP-2026-001" style={{ width: '100%', padding: '14px 18px', border: '2px solid #d1d5db', borderRadius: 10, fontSize: 17, fontFamily: 'monospace', fontWeight: 700, textAlign: 'center', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.2s, box-shadow 0.2s' }} onFocus={e => { e.target.style.borderColor = '#3b82f6'; e.target.style.boxShadow = '0 0 0 3px rgba(59,130,246,0.1)'; }} onBlur={e => { e.target.style.borderColor = '#d1d5db'; e.target.style.boxShadow = 'none'; }} onKeyDown={e => { if (e.key === 'Enter') handleShipmentSubmit(); }} />
                    </div>
                    <button onClick={handleShipmentSubmit} disabled={!shipmentNumber.trim()} style={{ width: '100%', padding: '14px 32px', borderRadius: 10, border: 'none', background: shipmentNumber.trim() ? 'linear-gradient(135deg, #1e3a8a, #1d4ed8)' : '#e5e7eb', color: shipmentNumber.trim() ? '#fff' : '#9ca3af', fontWeight: 700, fontSize: 15, cursor: shipmentNumber.trim() ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s', boxShadow: shipmentNumber.trim() ? '0 4px 16px rgba(30,58,138,0.25)' : 'none' }}>Continue to MPL Selection <ArrowRight size={16} /></button>
                </div>
            )}

            {/* ═══ STEP 2: SEARCH & PICK ═══ */}
            {step === 'SEARCH_PICK' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Header bar */}
                    <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                                <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg, #dbeafe, #e0e7ff)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><Anchor size={18} style={{ color: '#1e3a8a' }} /></div>
                                <div>
                                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#111827' }}>Shipment: <span style={{ color: '#1e3a8a', fontFamily: 'monospace' }}>{shipmentNumber}</span></h3>
                                    <p style={{ margin: 0, fontSize: 12, color: '#6b7280' }}>Inspect MPLs before adding them to the PI</p>
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            {pickedMpls.length > 0 && <button onClick={handleGeneratePI} style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #059669, #047857)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 12px rgba(5,150,105,0.25)' }}><CheckCircle2 size={16} /> Review PI ({pickedMpls.length} MPLs)</button>}
                        </div>
                    </div>

                    {/* Search section */}
                    <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', padding: 20 }}>
                        <FilterBar>
                            <SearchBox value={searchQuery} onChange={(val) => { setSearchQuery(val); if (!val) setSearchResults([]); }} placeholder="Start typing Invoice #, PO #, Item Code, or MPL Number…" />
                            {searching && <Loader2 size={16} style={{ color: '#3b82f6', animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
                        </FilterBar>
                        {/* Live search hint */}
                        {searchQuery.trim().length > 0 && searchQuery.trim().length < 2 && (
                            <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                                <AlertCircle size={12} /> Type at least 2 characters to auto-search
                            </div>
                        )}

                        {/* Search Results with Inspect */}
                        {searchResults.length > 0 && (
                            <div>
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 10 }}>Search Results ({searchResults.length})</div>
                                {searchResults.map(mpl => (
                                    <div key={mpl.id} style={{ border: `1px solid ${inspectMplId === mpl.id ? '#93c5fd' : '#e5e7eb'}`, borderRadius: 10, marginBottom: 8, overflow: 'hidden', transition: 'all 0.2s', background: inspectMplId === mpl.id ? '#f0f9ff' : '#fff' }}>
                                        <div style={{ padding: '14px 18px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                                                <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #eff6ff, #dbeafe)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><Package size={18} style={{ color: '#1e3a8a' }} /></div>
                                                <div>
                                                    <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e3a8a', fontSize: 14 }}>{mpl.mpl_number}</div>
                                                    <div style={{ fontSize: 12, color: '#6b7280', display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                                                        <span style={{ background: '#f3f4f6', padding: '1px 6px', borderRadius: 4, fontFamily: 'monospace', fontSize: 11 }}>{mpl.item_code}</span>
                                                        <span>Inv: <strong>{mpl.invoice_number || '—'}</strong></span>
                                                        <span>PO: <strong>{mpl.po_number || '—'}</strong></span>
                                                        <span><strong>{mpl.total_pallets}</strong> pallets</span>
                                                        <span><strong>{mpl.total_quantity.toLocaleString()}</strong> pcs</span>
                                                    </div>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', gap: 6 }}>
                                                <button onClick={() => handleInspectMpl(mpl.id)} style={{ padding: '7px 14px', borderRadius: 6, border: `1px solid ${inspectMplId === mpl.id ? '#3b82f6' : '#d1d5db'}`, background: inspectMplId === mpl.id ? '#dbeafe' : '#fff', color: inspectMplId === mpl.id ? '#1d4ed8' : '#374151', fontWeight: 600, fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}><Eye size={13} /> {inspectMplId === mpl.id ? 'Hide' : 'Inspect'}</button>
                                            </div>
                                        </div>
                                        {/* Expandable Inspection Panel */}
                                        {inspectMplId === mpl.id && (
                                            <div style={{ borderTop: '1px solid #bfdbfe', padding: 16, background: '#f8faff' }}>
                                                {inspectLoading ? (
                                                    <div style={{ textAlign: 'center', padding: 16, color: '#6b7280' }}><Loader2 size={18} style={{ animation: 'spin 0.8s linear infinite', marginRight: 8 }} />Loading pallet details...</div>
                                                ) : inspectPallets.length === 0 ? (
                                                    <div style={{ textAlign: 'center', padding: 12, color: '#9ca3af', fontSize: 13 }}>No pallet details found</div>
                                                ) : (
                                                    <>
                                                        <div style={{ fontSize: 11, fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>Pallet Breakdown ({inspectPallets.length} pallets)</div>
                                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                                            <thead><tr style={{ background: '#e0e7ff' }}>
                                                                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: '#374151' }}>#</th>
                                                                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: '#374151' }}>Pallet</th>
                                                                <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600, fontSize: 11, color: '#374151' }}>Item</th>
                                                                <th style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 600, fontSize: 11, color: '#374151' }}>Boxes</th>
                                                                <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, fontSize: 11, color: '#374151' }}>Qty</th>
                                                                <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, fontSize: 11, color: '#374151' }}>Net Wt</th>
                                                                <th style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 600, fontSize: 11, color: '#374151' }}>Gross Wt</th>
                                                            </tr></thead>
                                                            <tbody>{inspectPallets.map((p: any, i: number) => (
                                                                <tr key={p.id} style={{ borderBottom: '1px solid #e5e7eb', background: i % 2 === 0 ? '#fff' : '#f8fafc' }}>
                                                                    <td style={{ padding: '6px 10px', color: '#9ca3af' }}>{i + 1}</td>
                                                                    <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontWeight: 600, color: '#1e3a8a' }}>{p.pallet_number}</td>
                                                                    <td style={{ padding: '6px 10px', fontFamily: 'monospace', fontSize: 11 }}>{p.item_code}</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'center', fontWeight: 600 }}>{p.container_count}</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600 }}>{p.quantity.toLocaleString()}</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{Number(p.net_weight_kg || 0).toFixed(2)}</td>
                                                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{Number(p.gross_weight_kg || 0).toFixed(2)}</td>
                                                                </tr>
                                                            ))}</tbody>
                                                            <tfoot><tr style={{ background: '#e0e7ff', fontWeight: 700 }}>
                                                                <td colSpan={3} style={{ padding: '6px 10px', fontSize: 11 }}>TOTAL</td>
                                                                <td style={{ padding: '6px 10px', textAlign: 'center' }}>{inspectPallets.reduce((s: number, p: any) => s + (p.container_count || 0), 0)}</td>
                                                                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace' }}>{inspectPallets.reduce((s: number, p: any) => s + p.quantity, 0).toLocaleString()}</td>
                                                                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{inspectPallets.reduce((s: number, p: any) => s + Number(p.net_weight_kg || 0), 0).toFixed(2)}</td>
                                                                <td style={{ padding: '6px 10px', textAlign: 'right', fontFamily: 'monospace', fontSize: 11 }}>{inspectPallets.reduce((s: number, p: any) => s + Number(p.gross_weight_kg || 0), 0).toFixed(2)}</td>
                                                            </tr></tfoot>
                                                        </table>
                                                        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end' }}>
                                                            <button onClick={() => handlePickMpl(mpl)} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #1e3a8a, #1d4ed8)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 2px 10px rgba(30,58,138,0.25)', transition: 'all 0.15s' }} onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(30,58,138,0.35)'; }} onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(30,58,138,0.25)'; }}><Plus size={14} /> Add to PI</button>
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Picked MPLs Section */}
                    {pickedMpls.length > 0 && (
                        <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', padding: 20 }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                                <div style={{ fontSize: 11, fontWeight: 700, color: '#059669', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Picked MPLs ({pickedMpls.length})</div>
                                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#6b7280' }}>
                                    <span><strong style={{ color: '#111827' }}>{totalPickedPallets}</strong> pallets</span>
                                    <span><strong style={{ color: '#111827' }}>{totalPickedQty.toLocaleString()}</strong> pcs</span>
                                    <span><strong style={{ color: '#111827' }}>{totalPickedWeight.toFixed(2)}</strong> Kg</span>
                                </div>
                            </div>
                            {pickedMpls.map(({ mpl }) => (
                                <div key={mpl.id} style={{ padding: '12px 16px', borderRadius: 8, border: '1px solid #86efac', backgroundColor: '#f0fdf4', marginBottom: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', transition: 'all 0.2s' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                                        <div style={{ width: 32, height: 32, borderRadius: 8, background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                            <CheckCircle2 size={16} style={{ color: '#16a34a' }} />
                                        </div>
                                        <div>
                                            <div style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e3a8a', fontSize: 14 }}>{mpl.mpl_number}</div>
                                            <div style={{ fontSize: 12, color: '#6b7280' }}>{mpl.item_code} · {mpl.total_pallets} plt · {mpl.total_quantity.toLocaleString()} pcs</div>
                                        </div>
                                    </div>
                                    <button onClick={() => handleRemoveMpl(mpl.id)} style={{ padding: '6px 14px', borderRadius: 6, border: '1px solid #fecaca', background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#dc2626', transition: 'all 0.15s' }} onMouseEnter={e => { e.currentTarget.style.background = '#fef2f2'; e.currentTarget.style.borderColor = '#f87171'; }} onMouseLeave={e => { e.currentTarget.style.background = '#fff'; e.currentTarget.style.borderColor = '#fecaca'; }}><XCircle size={14} /> Remove</button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* ═══ STEP 3: REVIEW PI ═══ */}
            {step === 'REVIEW_PI' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    {/* Summary Stats */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                        {[{ label: 'Shipment', value: shipmentNumber, color: '#1e3a8a', bg: 'linear-gradient(135deg, #eff6ff, #dbeafe)', icon: <Anchor size={20} /> },
                        { label: 'MPLs', value: pickedMpls.length, color: '#7c3aed', bg: 'linear-gradient(135deg, #f5f3ff, #ede9fe)', icon: <Package size={20} /> },
                        { label: 'Pallets / Qty', value: `${totalPickedPallets} / ${totalPickedQty.toLocaleString()}`, color: '#059669', bg: 'linear-gradient(135deg, #f0fdf4, #dcfce7)', icon: <CheckCircle2 size={20} /> },
                        { label: 'Gross Weight', value: `${totalPickedWeight.toFixed(2)} Kg`, color: '#d97706', bg: 'linear-gradient(135deg, #fffbeb, #fef3c7)', icon: <Truck size={20} /> }
                        ].map((c, i) => (
                            <div key={i} style={{ padding: 18, borderRadius: 12, background: c.bg, border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{c.label}</span>
                                    <span style={{ color: c.color, opacity: 0.6 }}>{c.icon}</span>
                                </div>
                                <div style={{ fontSize: 18, fontWeight: 800, color: c.color, fontFamily: 'monospace' }}>{c.value}</div>
                            </div>
                        ))}
                    </div>

                    {/* MPL Accordion with Pallet Breakdown */}
                    <div style={{ background: 'white', borderRadius: 12, border: '1px solid #e5e7eb', padding: 20 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#111827', display: 'flex', alignItems: 'center', gap: 8 }}><Package size={16} style={{ color: '#1e3a8a' }} /> Master Packing Lists ({pickedMpls.length})</h4>
                            <span style={{ fontSize: 12, color: '#6b7280' }}>{pickedMpls.length} items</span>
                        </div>
                        {reviewLoading ? <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}><Loader2 size={20} style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginRight: 8 }} />Loading pallet details…</div> :
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                {pickedMpls.map(({ mpl }, idx) => {
                                    const pallets = reviewPalletDetails[mpl.id] || [];
                                    const isExpanded = true; // Always expanded in review
                                    return (
                                        <div key={mpl.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
                                            {/* MPL header */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '14px 18px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
                                                <span style={{ fontSize: 12, fontWeight: 600, color: '#9ca3af', minWidth: 20 }}>{idx + 1}</span>
                                                <span style={{ fontFamily: 'monospace', fontWeight: 700, fontSize: 14, color: '#1e3a8a' }}>{mpl.mpl_number}</span>
                                                <div style={{ display: 'flex', gap: 20, flex: 1, fontSize: 12, color: '#6b7280' }}>
                                                    <span>Part No: <strong style={{ color: '#374151', fontFamily: 'monospace' }}>{pallets[0]?.part_number || '—'}</strong></span>
                                                    <span>Item: <strong style={{ color: '#374151', fontFamily: 'monospace' }}>{mpl.item_code}</strong></span>
                                                    <span>Invoice: <strong style={{ color: '#374151' }}>{mpl.invoice_number || '—'}</strong></span>
                                                    <span>PO: <strong style={{ color: '#374151' }}>{mpl.po_number || '—'}</strong></span>
                                                </div>
                                                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: '#6b7280', flexShrink: 0 }}>
                                                    <span>Pallets: <strong style={{ color: '#111827' }}>{mpl.total_pallets}</strong></span>
                                                    <span>Qty: <strong style={{ color: '#111827', fontFamily: 'monospace' }}>{mpl.total_quantity?.toLocaleString()}</strong></span>
                                                    <span>Wt: <strong style={{ color: '#111827', fontFamily: 'monospace' }}>{Number(mpl.total_gross_weight_kg || 0).toFixed(2)} kg</strong></span>
                                                </div>
                                            </div>

                                            {/* Pallet breakdown table */}
                                            <div style={{ padding: '0 18px 18px' }}>
                                                {pallets.length === 0 ? (
                                                    <div style={{ padding: '16px 0', textAlign: 'center', color: '#9ca3af', fontSize: 13 }}>No pallet details available</div>
                                                ) : (
                                                    <div style={{ overflowX: 'auto', marginTop: 12 }}>
                                                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                                            <thead>
                                                                <tr style={{ background: '#f0f4ff' }}>
                                                                    <th style={{ ...th, fontSize: 11, padding: '8px 10px', color: '#1e3a8a' }}>Pallet ID</th>
                                                                    <th style={{ ...th, fontSize: 11, padding: '8px 10px', color: '#1e3a8a' }}>Part Number</th>
                                                                    <th style={{ ...th, fontSize: 11, padding: '8px 10px', color: '#1e3a8a' }}>Description</th>
                                                                    <th style={{ ...th, fontSize: 11, padding: '8px 10px', color: '#1e3a8a' }}>MSN</th>
                                                                    <th style={{ ...th, fontSize: 11, padding: '8px 10px', color: '#1e3a8a' }}>Rev</th>
                                                                    <th style={{ ...th, fontSize: 11, padding: '8px 10px', textAlign: 'center', color: '#1e3a8a' }}>Inner Boxes</th>
                                                                    <th style={{ ...th, fontSize: 11, padding: '8px 10px', textAlign: 'right', color: '#1e3a8a' }}>Qty</th>
                                                                    <th style={{ ...th, fontSize: 11, padding: '8px 10px', textAlign: 'right', color: '#1e3a8a' }}>Net Wt (kg)</th>
                                                                    <th style={{ ...th, fontSize: 11, padding: '8px 10px', textAlign: 'right', color: '#1e3a8a' }}>Gross Wt (kg)</th>
                                                                    <th style={{ ...th, fontSize: 11, padding: '8px 10px', color: '#1e3a8a' }}>Dimensions</th>

                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {pallets.map((p: any, pidx: number) => (
                                                                    <tr key={p.id || pidx} style={{ borderBottom: '1px solid #f3f4f6', transition: 'background 0.1s' }}
                                                                        onMouseEnter={e => e.currentTarget.style.background = '#fafbff'}
                                                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                                                    >
                                                                        <td style={{ ...td, fontFamily: 'monospace', fontWeight: 600, color: '#1e3a8a', fontSize: 12, padding: '8px 10px' }}>{p.pallet_number}</td>
                                                                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 12, padding: '8px 10px' }}>{p.part_number}</td>
                                                                        <td style={{ ...td, fontSize: 12, padding: '8px 10px', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={p.item_description}>{p.item_description}</td>
                                                                        <td style={{ ...td, fontFamily: 'monospace', fontSize: 12, padding: '8px 10px', color: '#7c3aed' }}>{p.master_serial_no}</td>
                                                                        <td style={{ ...td, fontSize: 12, padding: '8px 10px' }}>{p.revision}</td>
                                                                        <td style={{ ...td, textAlign: 'center', fontWeight: 600, fontSize: 12, padding: '8px 10px' }}>{p.container_count}</td>
                                                                        <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, fontSize: 12, padding: '8px 10px' }}>{p.quantity?.toLocaleString()}</td>
                                                                        <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '8px 10px' }}>{Number(p.net_weight_kg || 0).toFixed(2)}</td>
                                                                        <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace', fontSize: 12, padding: '8px 10px' }}>{Number(p.gross_weight_kg || 0).toFixed(2)}</td>
                                                                        <td style={{ ...td, fontSize: 11, padding: '8px 10px', color: '#6b7280' }}>{p.pallet_dims}</td>

                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                            <tfoot>
                                                                <tr style={{ background: '#f8fafc', fontWeight: 700, borderTop: '2px solid #e5e7eb' }}>
                                                                    <td style={{ padding: '8px 10px', fontSize: 11, color: '#374151' }} colSpan={5}>Totals ({pallets.length} pallet{pallets.length !== 1 ? 's' : ''})</td>
                                                                    <td style={{ padding: '8px 10px', textAlign: 'center', fontSize: 12, fontFamily: 'monospace' }}>{pallets.reduce((s: number, p: any) => s + (p.container_count || 0), 0)}</td>
                                                                    <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, fontFamily: 'monospace' }}>{pallets.reduce((s: number, p: any) => s + (p.quantity || 0), 0).toLocaleString()}</td>
                                                                    <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, fontFamily: 'monospace' }}>{pallets.reduce((s: number, p: any) => s + Number(p.net_weight_kg || 0), 0).toFixed(2)}</td>
                                                                    <td style={{ padding: '8px 10px', textAlign: 'right', fontSize: 12, fontFamily: 'monospace' }}>{pallets.reduce((s: number, p: any) => s + Number(p.gross_weight_kg || 0), 0).toFixed(2)}</td>
                                                                    <td colSpan={2}></td>
                                                                </tr>
                                                            </tfoot>
                                                        </table>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Grand totals */}
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 20, padding: '12px 18px', background: '#f0f9ff', borderRadius: 8, border: '1px solid #bfdbfe', fontSize: 13, fontWeight: 700 }}>
                                    <span style={{ color: '#6b7280' }}>Grand Total:</span>
                                    <span style={{ color: '#111827' }}>{totalPickedPallets} pallets</span>
                                    <span style={{ color: '#111827', fontFamily: 'monospace' }}>{totalPickedQty.toLocaleString()} pcs</span>
                                    <span style={{ color: '#111827', fontFamily: 'monospace' }}>{totalPickedWeight.toFixed(2)} kg</span>
                                </div>
                            </div>
                        }
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <button onClick={() => setStep('SEARCH_PICK')} style={{ padding: '12px 24px', borderRadius: 8, background: 'white', color: '#374151', border: '1px solid #d1d5db', fontWeight: 600, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}><ChevronLeft size={16} /> Back to Search</button>
                        <button onClick={handleCreatePI} disabled={creating} style={{ padding: '12px 28px', borderRadius: 10, border: 'none', background: creating ? '#9ca3af' : 'linear-gradient(135deg, #059669, #047857)', color: '#fff', fontWeight: 700, fontSize: 15, cursor: creating ? 'wait' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: creating ? 'none' : '0 4px 16px rgba(5,150,105,0.3)', transition: 'all 0.2s' }}>{creating ? <><Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> Creating...</> : <><CheckCircle2 size={16} /> Create Performa Invoice</>}</button>
                    </div>
                </div>
            )}

            {/* ═══ APPROVE with Emails — Premium Redesign ═══ */}
            {step === 'APPROVE' && approveTarget && (
                <div style={{ maxWidth: 680, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {/* Hero Header */}
                    <div style={{
                        background: 'linear-gradient(135deg, #064e3b 0%, #065f46 30%, #047857 60%, #059669 100%)',
                        borderRadius: '16px 16px 0 0',
                        padding: '36px 32px 28px',
                        position: 'relative',
                        overflow: 'hidden',
                    }}>
                        {/* Decorative circles */}
                        <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', background: 'rgba(255,255,255,0.06)' }} />
                        <div style={{ position: 'absolute', bottom: -20, left: -20, width: 80, height: 80, borderRadius: '50%', background: 'rgba(255,255,255,0.04)' }} />
                        <div style={{ position: 'absolute', top: 20, right: 60, width: 40, height: 40, borderRadius: '50%', background: 'rgba(255,255,255,0.05)' }} />

                        <div style={{ display: 'flex', alignItems: 'center', gap: 20, position: 'relative', zIndex: 1 }}>
                            <div style={{
                                width: 72, height: 72, borderRadius: 20,
                                background: 'rgba(255,255,255,0.15)',
                                backdropFilter: 'blur(8px)',
                                border: '1px solid rgba(255,255,255,0.2)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                animation: 'approveIconPulse 2s ease-in-out infinite',
                                flexShrink: 0,
                            }}>
                                <ShieldCheck size={36} style={{ color: '#fff' }} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 24, fontWeight: 800, color: '#fff', margin: '0 0 4px', letterSpacing: '-0.3px' }}>
                                    Approve & Dispatch
                                </h3>
                                <div style={{
                                    display: 'inline-flex', alignItems: 'center', gap: 6,
                                    background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(4px)',
                                    border: '1px solid rgba(255,255,255,0.2)',
                                    padding: '5px 14px', borderRadius: 8,
                                }}>
                                    <FileText size={13} style={{ color: 'rgba(255,255,255,0.8)' }} />
                                    <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: '#fff', letterSpacing: '0.5px' }}>
                                        {approveTarget.proforma_number}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Main Content Card */}
                    <div style={{
                        backgroundColor: '#fff',
                        borderRadius: '0 0 16px 16px',
                        border: '1px solid #e5e7eb',
                        borderTop: 'none',
                        padding: '0',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.06)',
                    }}>
                        {/* Workflow Strip */}
                        <div style={{
                            padding: '20px 28px',
                            background: 'linear-gradient(to right, #f0fdf4, #ecfdf5, #f0f9ff)',
                            borderBottom: '1px solid #e5e7eb',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0,
                        }}>
                            {[
                                { icon: <ShieldCheck size={16} />, label: 'Approve PI', color: '#059669' },
                                { icon: <Truck size={16} />, label: 'Move to Transit', color: '#0284c7' },
                                { icon: <Send size={16} />, label: 'Email Notify', color: '#7c3aed' },
                            ].map((s, i) => (
                                <React.Fragment key={i}>
                                    {i > 0 && (
                                        <div style={{ display: 'flex', alignItems: 'center', margin: '0 6px' }}>
                                            <div style={{ width: 32, height: 2, background: 'linear-gradient(to right, #bbf7d0, #93c5fd)', borderRadius: 1 }} />
                                            <ArrowRight size={14} style={{ color: '#9ca3af', margin: '0 -2px' }} />
                                            <div style={{ width: 32, height: 2, background: 'linear-gradient(to right, #93c5fd, #c4b5fd)', borderRadius: 1 }} />
                                        </div>
                                    )}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 8, background: 'rgba(255,255,255,0.8)', border: '1px solid #e5e7eb' }}>
                                        <div style={{
                                            width: 28, height: 28, borderRadius: 8,
                                            background: `${s.color}14`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: s.color,
                                        }}>
                                            {s.icon}
                                        </div>
                                        <span style={{ fontSize: 12, fontWeight: 600, color: '#374151', whiteSpace: 'nowrap' }}>{s.label}</span>
                                    </div>
                                </React.Fragment>
                            ))}
                        </div>

                        {/* Stats Grid */}
                        <div style={{ padding: '24px 28px 0' }}>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
                                {[
                                    { label: 'Shipment', value: approveTarget.shipment_number || '—', icon: <Anchor size={18} />, gradient: 'linear-gradient(135deg, #eff6ff, #dbeafe)', accentColor: '#1e3a8a', borderColor: '#bfdbfe' },
                                    { label: 'MPLs', value: approveTarget.total_invoices, icon: <Package size={18} />, gradient: 'linear-gradient(135deg, #f5f3ff, #ede9fe)', accentColor: '#7c3aed', borderColor: '#c4b5fd' },
                                    { label: 'Pallets', value: approveTarget.total_pallets, icon: <Package size={18} />, gradient: 'linear-gradient(135deg, #fef3c7, #fde68a33)', accentColor: '#d97706', borderColor: '#fde68a' },
                                    { label: 'Total Qty', value: approveTarget.total_quantity.toLocaleString(), icon: <CheckCircle2 size={18} />, gradient: 'linear-gradient(135deg, #d1fae5, #a7f3d033)', accentColor: '#059669', borderColor: '#86efac' },
                                ].map((stat, i) => (
                                    <div key={i} style={{
                                        padding: '16px 14px',
                                        borderRadius: 12,
                                        background: stat.gradient,
                                        border: `1px solid ${stat.borderColor}`,
                                        position: 'relative',
                                        overflow: 'hidden',
                                        transition: 'transform 0.2s, box-shadow 0.2s',
                                    }}
                                        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.06)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                            <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{stat.label}</span>
                                            <span style={{ color: stat.accentColor, opacity: 0.5 }}>{stat.icon}</span>
                                        </div>
                                        <div style={{ fontSize: 20, fontWeight: 800, color: stat.accentColor, fontFamily: stat.label === 'Shipment' ? 'monospace' : 'inherit' }}>
                                            {stat.value}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Email Section */}
                        <div style={{ padding: '24px 28px' }}>
                            <div style={{
                                border: '1px solid #e5e7eb',
                                borderRadius: 12,
                                overflow: 'hidden',
                                transition: 'border-color 0.2s, box-shadow 0.2s',
                                ...(approvalEmails.trim() ? { borderColor: '#86efac', boxShadow: '0 0 0 3px rgba(134,239,172,0.15)' } : {}),
                            }}>
                                <div style={{
                                    padding: '12px 16px',
                                    background: '#f9fafb',
                                    borderBottom: '1px solid #e5e7eb',
                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                        <div style={{
                                            width: 30, height: 30, borderRadius: 8,
                                            background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        }}>
                                            <Mail size={15} style={{ color: '#1e3a8a' }} />
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 13, fontWeight: 700, color: '#111827' }}>Notification Recipients</div>
                                            <div style={{ fontSize: 11, color: '#9ca3af' }}>Dispatch approval emails will be sent</div>
                                        </div>
                                    </div>
                                    {approvalEmails.trim() && (
                                        <span style={{
                                            fontSize: 11, fontWeight: 700, color: '#059669',
                                            background: '#dcfce7', padding: '3px 10px', borderRadius: 6,
                                        }}>
                                            {approvalEmails.split(',').filter(e => e.trim()).length} recipient{approvalEmails.split(',').filter(e => e.trim()).length !== 1 ? 's' : ''}
                                        </span>
                                    )}
                                </div>
                                <div style={{ padding: '16px' }}>
                                    <textarea
                                        value={approvalEmails}
                                        onChange={e => setApprovalEmails(e.target.value)}
                                        placeholder={"Enter email addresses separated by commas\ne.g. manager@company.com, logistics@company.com"}
                                        rows={3}
                                        style={{
                                            width: '100%', padding: '12px 14px',
                                            border: '1px solid #e5e7eb', borderRadius: 8,
                                            fontSize: 14, resize: 'vertical',
                                            outline: 'none', boxSizing: 'border-box',
                                            fontFamily: 'var(--font-family-primary)',
                                            transition: 'border-color 0.15s',
                                            lineHeight: 1.6,
                                        }}
                                        onFocus={e => { e.currentTarget.style.borderColor = '#059669'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(5,150,105,0.08)'; }}
                                        onBlur={e => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.boxShadow = 'none'; }}
                                    />
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8 }}>
                                        <AlertCircle size={12} style={{ color: '#9ca3af' }} />
                                        <span style={{ fontSize: 11, color: '#9ca3af' }}>Separate multiple emails with commas</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div style={{
                            padding: '0 28px 28px',
                            display: 'flex', gap: 12, justifyContent: 'flex-end',
                        }}>
                            <button
                                onClick={() => { setApproveTarget(null); setStep('LIST'); }}
                                style={{
                                    padding: '12px 28px', borderRadius: 10,
                                    border: '1px solid #d1d5db', backgroundColor: '#fff',
                                    cursor: 'pointer', fontWeight: 600, fontSize: 14,
                                    color: '#374151', transition: 'all 0.15s',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                }}
                                onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f9fafb'; e.currentTarget.style.borderColor = '#9ca3af'; }}
                                onMouseLeave={e => { e.currentTarget.style.backgroundColor = '#fff'; e.currentTarget.style.borderColor = '#d1d5db'; }}
                            >
                                <X size={15} /> Cancel
                            </button>
                            <button
                                onClick={handleApproveSubmit}
                                disabled={approving || !approvalEmails.trim()}
                                style={{
                                    padding: '12px 32px', borderRadius: 10,
                                    border: 'none',
                                    background: (approving || !approvalEmails.trim())
                                        ? '#d1d5db'
                                        : 'linear-gradient(135deg, #059669, #047857)',
                                    color: (approving || !approvalEmails.trim()) ? '#9ca3af' : '#fff',
                                    fontWeight: 700, fontSize: 15,
                                    cursor: approving ? 'wait' : (approvalEmails.trim() ? 'pointer' : 'not-allowed'),
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    boxShadow: (approving || !approvalEmails.trim())
                                        ? 'none'
                                        : '0 4px 20px rgba(5,150,105,0.35)',
                                    transition: 'all 0.2s',
                                    letterSpacing: '0.2px',
                                }}
                                onMouseEnter={e => {
                                    if (!approving && approvalEmails.trim()) {
                                        e.currentTarget.style.boxShadow = '0 6px 28px rgba(5,150,105,0.4)';
                                        e.currentTarget.style.transform = 'translateY(-1px)';
                                    }
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.boxShadow = (approving || !approvalEmails.trim()) ? 'none' : '0 4px 20px rgba(5,150,105,0.35)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                }}
                            >
                                {approving ? (
                                    <><Loader2 size={17} style={{ animation: 'spin 1s linear infinite' }} /> Approving…</>
                                ) : (
                                    <><Send size={17} /> Approve & Dispatch</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}



            {/* ═══ DETAIL — Premium View (matches Review step style) ═══ */}
            {step === 'DETAIL' && selectedPI && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                    {/* Stat Cards — matching review step */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 20 }}>
                        {[
                            { label: 'SHIPMENT', value: selectedPI.shipment_number || '—', icon: <Anchor size={18} />, gradient: 'linear-gradient(135deg, #eff6ff, #dbeafe)', accentColor: '#1e3a8a', borderColor: '#93c5fd' },
                            { label: 'MPLS', value: piMpls.length, icon: <Package size={18} />, gradient: 'linear-gradient(135deg, #f5f3ff, #ede9fe)', accentColor: '#7c3aed', borderColor: '#c4b5fd' },
                            { label: 'PALLETS / QTY', value: `${selectedPI.total_pallets} / ${selectedPI.total_quantity.toLocaleString()}`, icon: <CheckCircle2 size={18} />, gradient: 'linear-gradient(135deg, #ecfdf5, #d1fae5)', accentColor: '#059669', borderColor: '#86efac' },
                            { label: 'GROSS WEIGHT', value: `${Number(selectedPI.total_gross_weight_kg || piMpls.reduce((s: number, m: any) => s + Number(m.total_gross_weight_kg || 0), 0)).toFixed(2)} Kg`, icon: <Truck size={18} />, gradient: 'linear-gradient(135deg, #fefce8, #fef3c7)', accentColor: '#d97706', borderColor: '#fde68a' },
                        ].map((stat, i) => (
                            <div key={i} style={{
                                padding: '18px 20px', borderRadius: 14, background: stat.gradient,
                                border: `1.5px solid ${stat.borderColor}`, position: 'relative', overflow: 'hidden',
                                transition: 'transform 0.2s, box-shadow 0.2s',
                            }} onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.06)'; }} onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                    <span style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{stat.label}</span>
                                    <span style={{ color: stat.accentColor, opacity: 0.4 }}>{stat.icon}</span>
                                </div>
                                <div style={{ fontSize: 22, fontWeight: 800, color: stat.accentColor, fontFamily: 'monospace' }}>{stat.value}</div>
                            </div>
                        ))}
                    </div>

                    {/* Status banner */}
                    {selectedPI.status === 'STOCK_MOVED' && <div style={{ padding: '12px 16px', borderRadius: 10, background: 'linear-gradient(135deg, #d1fae5, #ecfdf5)', border: '1px solid #86efac', color: '#065f46', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, marginBottom: 16 }}><Truck size={16} />Stock dispatched — moved to In Transit at {selectedPI.stock_moved_at ? new Date(selectedPI.stock_moved_at).toLocaleString() : '—'}</div>}
                    {selectedPI.status === 'CANCELLED' && <div style={{ padding: '12px 16px', borderRadius: 10, background: 'linear-gradient(135deg, #fee2e2, #fef2f2)', border: '1px solid #fca5a5', color: '#991b1b', display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600, marginBottom: 16 }}><XCircle size={16} />This Proforma Invoice has been cancelled{selectedPI.cancelled_at ? ` on ${new Date(selectedPI.cancelled_at).toLocaleString()}` : ''}</div>}

                    {/* Master Packing Lists — clean table */}
                    <div style={{ backgroundColor: '#fff', borderRadius: 14, border: '1px solid #e5e7eb', overflow: 'hidden', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: '1px solid #f3f4f6' }}>
                            <h4 style={{ fontSize: 15, fontWeight: 700, color: '#111827', margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}><Package size={16} style={{ color: '#1e3a8a' }} /> Master Packing Lists</h4>
                            <span style={{ fontSize: 12, color: '#6b7280' }}>{piMpls.length} item{piMpls.length !== 1 ? 's' : ''}</span>
                        </div>
                        {detailLoading ? <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}><Loader2 size={20} style={{ animation: 'spin 1s linear infinite', display: 'inline-block', marginRight: 8 }} />Loading pallet details…</div> : (
                            <div style={{ overflowX: 'auto' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                                    <thead>
                                        <tr style={{ background: '#fafbfc', borderBottom: '2px solid #e5e7eb' }}>
                                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>#</th>
                                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>MPL #</th>
                                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>PART #</th>
                                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>ITEM CODE</th>
                                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>MSN</th>
                                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>INVOICE #</th>
                                            <th style={{ padding: '10px 16px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>PO #</th>
                                            <th style={{ padding: '10px 16px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>PALLETS</th>
                                            <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>QTY</th>
                                            <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>NET WT</th>
                                            <th style={{ padding: '10px 16px', textAlign: 'right', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>GROSS WT</th>
                                            <th style={{ padding: '10px 16px', textAlign: 'center', fontSize: 11, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.3px' }}>STATUS</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {piMpls.map((m: any, idx: number) => {
                                            const palletsMap = mplPalletDetails[m.mpl_id] || [];
                                            const partNo = palletsMap.length > 0 ? palletsMap[0].part_number : '—';
                                            const msn = palletsMap.length > 0 ? palletsMap[0].master_serial_no : '—';
                                            const netWt = palletsMap.reduce((s: number, p: any) => s + Number(p.net_weight_kg || p.unit_weight * p.quantity || 0), 0);
                                            return (
                                                <tr key={m.id} style={{ borderBottom: '1px solid #f3f4f6', transition: 'background 0.1s' }} onMouseEnter={e => e.currentTarget.style.background = '#fafbff'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                                    <td style={{ padding: '12px 16px', color: '#9ca3af', fontSize: 13 }}>{idx + 1}</td>
                                                    <td style={{ padding: '12px 16px' }}><span style={{ fontFamily: 'monospace', fontWeight: 700, color: '#1e3a8a', fontSize: 13 }}>{m.mpl_number}</span></td>
                                                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: '#374151', fontSize: 13 }}>{partNo}</td>
                                                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: '#374151', fontSize: 13 }}>{m.item_code}</td>
                                                    <td style={{ padding: '12px 16px', fontFamily: 'monospace', color: '#7c3aed', fontSize: 13 }}>{msn}</td>
                                                    <td style={{ padding: '12px 16px', color: '#374151', fontSize: 13 }}>{m.invoice_number || '—'}</td>
                                                    <td style={{ padding: '12px 16px', color: '#374151', fontSize: 13 }}>{m.po_number || '—'}</td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#059669', fontSize: 13 }}>{m.total_pallets}</td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 600, fontSize: 13 }}>{m.total_quantity?.toLocaleString()}</td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{netWt.toFixed(2)}</td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', fontSize: 13 }}>{Number(m.total_gross_weight_kg || 0).toFixed(2)}</td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'center' }}>
                                                        <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: m.status === 'CANCELLED' ? '#fee2e2' : '#dcfce7', color: m.status === 'CANCELLED' ? '#991b1b' : '#065f46' }}>
                                                            {m.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE'}
                                                        </span>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                    <tfoot>
                                        <tr style={{ background: '#f8fafc', borderTop: '2px solid #e5e7eb' }}>
                                            <td colSpan={7} style={{ padding: '12px 16px', fontSize: 13, fontWeight: 700, color: '#374151' }}>TOTAL</td>
                                            <td style={{ padding: '12px 16px', textAlign: 'center', fontWeight: 700, color: '#059669', fontSize: 13 }}>{piMpls.reduce((s: number, m: any) => s + (m.total_pallets || 0), 0)}</td>
                                            <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{piMpls.reduce((s: number, m: any) => s + (m.total_quantity || 0), 0).toLocaleString()}</td>
                                            <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>
                                                {piMpls.reduce((s: number, m: any) => {
                                                    const palletsMap = mplPalletDetails[m.mpl_id] || [];
                                                    return s + palletsMap.reduce((ns: number, p: any) => ns + Number(p.net_weight_kg || p.unit_weight * p.quantity || 0), 0);
                                                }, 0).toFixed(2)}
                                            </td>
                                            <td style={{ padding: '12px 16px', textAlign: 'right', fontFamily: 'monospace', fontWeight: 700, fontSize: 13 }}>{piMpls.reduce((s: number, m: any) => s + Number(m.total_gross_weight_kg || 0), 0).toFixed(2)}</td>
                                            <td></td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                        )}
                    </div>

                    {/* Action buttons */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginTop: 16, gap: 10 }}>
                        <button onClick={() => handlePrintPI(selectedPI)} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, color: '#374151' }} onMouseEnter={e => e.currentTarget.style.background = '#f9fafb'} onMouseLeave={e => e.currentTarget.style.background = '#fff'}><Printer size={15} /> Print</button>
                        {selectedPI.status === 'DRAFT' && canApprove && piMpls.length > 0 && (
                            <button onClick={() => handleOpenApprove(selectedPI)} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg, #059669, #047857)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8, boxShadow: '0 4px 16px rgba(5,150,105,0.3)', transition: 'all 0.2s' }} onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(5,150,105,0.4)'; }} onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 4px 16px rgba(5,150,105,0.3)'; }}><ShieldCheck size={16} /> Approve & Dispatch</button>
                        )}
                    </div>
                </div>
            )}

            {/* ═══ CANCEL CONFIRMATION MODAL ═══ */}
            {cancelTarget && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 10001, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }} onClick={() => setCancelTarget(null)}>
                    <div style={{ background: '#fff', borderRadius: 16, padding: '28px 32px', maxWidth: 480, width: '90%', boxShadow: '0 20px 60px rgba(0,0,0,0.2)', animation: 'slideInDown 0.3s cubic-bezier(0.16,1,0.3,1)' }} onClick={e => e.stopPropagation()}>
                        {/* Header */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
                            <div style={{ width: 40, height: 40, borderRadius: 10, background: 'linear-gradient(135deg, #fee2e2, #fef2f2)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <AlertTriangle size={22} style={{ color: '#dc2626' }} />
                            </div>
                            <div>
                                <h3 style={{ fontSize: 17, fontWeight: 700, color: '#111827', margin: 0 }}>Cancel Proforma Invoice</h3>
                                <p style={{ fontSize: 13, color: '#6b7280', margin: '2px 0 0' }}>This will cancel <strong>{cancelTarget.proforma_number}</strong> and release linked MPLs for reuse. MPL data and pallet allocations will remain intact.</p>
                            </div>
                        </div>

                        {/* Info Cards */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '16px 0 20px', padding: 16, background: '#f9fafb', borderRadius: 10, border: '1px solid #e5e7eb' }}>
                            <div><div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 }}>PI NUMBER</div><div style={{ fontSize: 14, fontWeight: 700, color: '#1e3a8a', fontFamily: 'monospace' }}>{cancelTarget.proforma_number}</div></div>
                            <div><div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 }}>STATUS</div><StatusBadge status={cancelTarget.status} /></div>
                            <div><div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 }}>PALLETS</div><div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{cancelTarget.total_pallets}</div></div>
                            <div><div style={{ fontSize: 10, fontWeight: 700, color: '#6b7280', textTransform: 'uppercase', marginBottom: 2 }}>TOTAL QTY</div><div style={{ fontSize: 14, fontWeight: 700, color: '#111827' }}>{cancelTarget.total_quantity.toLocaleString()} PCS</div></div>
                        </div>

                        {/* Type to confirm */}
                        <div style={{ marginBottom: 14 }}>
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Type PI Number to confirm <span style={{ color: '#dc2626' }}>*</span></label>
                            <input value={cancelConfirmInput} onChange={e => setCancelConfirmInput(e.target.value)} onPaste={e => e.preventDefault()} onDrop={e => e.preventDefault()} placeholder={`Enter "${cancelTarget.proforma_number}" to confirm`} style={{ width: '100%', padding: 10, border: `2px solid ${cancelConfirmInput === cancelTarget.proforma_number ? '#16a34a' : '#fca5a5'}`, borderRadius: 8, fontSize: 14, fontFamily: 'monospace', fontWeight: 700, textAlign: 'center', outline: 'none', boxSizing: 'border-box', transition: 'border-color 0.15s' }} />
                            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>Must match exactly: <strong style={{ color: '#374151' }}>{cancelTarget.proforma_number}</strong></p>
                        </div>

                        {/* Reason */}
                        <div style={{ marginBottom: 20 }}>
                            <label style={{ fontSize: 12, fontWeight: 600, color: '#374151', display: 'block', marginBottom: 6 }}>Reason for cancellation <span style={{ color: '#dc2626' }}>*</span></label>
                            <textarea value={cancelReason} onChange={e => setCancelReason(e.target.value)} placeholder="Please provide the reason for cancelling this proforma invoice..." rows={3} style={{ width: '100%', padding: 10, border: '1px solid #d1d5db', borderRadius: 8, fontSize: 13, resize: 'vertical', outline: 'none', boxSizing: 'border-box' }} onFocus={e => e.currentTarget.style.borderColor = '#6b7280'} onBlur={e => e.currentTarget.style.borderColor = '#d1d5db'} />
                        </div>

                        {/* Buttons */}
                        <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                            <button onClick={() => setCancelTarget(null)} style={{ padding: '10px 28px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontWeight: 600, fontSize: 14, cursor: 'pointer', color: '#374151' }}>Keep</button>
                            <button onClick={handleCancelPI} disabled={cancelling || cancelConfirmInput.trim() !== cancelTarget.proforma_number || !cancelReason.trim()} style={{ padding: '10px 28px', borderRadius: 8, border: 'none', background: (cancelling || cancelConfirmInput.trim() !== cancelTarget.proforma_number || !cancelReason.trim()) ? '#e5e7eb' : '#dc2626', color: (cancelling || cancelConfirmInput.trim() !== cancelTarget.proforma_number || !cancelReason.trim()) ? '#9ca3af' : '#fff', fontWeight: 700, fontSize: 14, cursor: (cancelling || cancelConfirmInput.trim() !== cancelTarget.proforma_number || !cancelReason.trim()) ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 8, transition: 'all 0.15s' }}>{cancelling ? <>Cancelling...</> : <><XCircle size={16} /> Cancel Proforma Invoice</>}</button>
                        </div>
                    </div>
                </div>
            )}
            <style>{`@keyframes spin{to{transform:rotate(360deg)}} @keyframes slideInDown{from{opacity:0;transform:translateY(-16px)}to{opacity:1;transform:translateY(0)}} @keyframes approveIconPulse{0%,100%{transform:scale(1);box-shadow:0 0 0 0 rgba(255,255,255,0.2)}50%{transform:scale(1.05);box-shadow:0 0 0 8px rgba(255,255,255,0)}}`}</style>
        </div>
    );
}
