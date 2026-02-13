/**
 * Stock Movement – Main Page + New Movement Modal + Supervisor Review
 *
 * Flow: Operator creates PENDING request → Supervisor reviews → Stock moves only on approval
 * Uses EnterpriseUI components for consistent styling.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  ArrowDownCircle,
  Search,
  Loader2,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ArrowRight,
  Warehouse,
  Truck,
  MapPin,
  ChevronDown,
  X,
  Info,
  Plus,
  Download,
  ArrowRightLeft,
  RefreshCw,
  Clock,
  FileText,
  Shield,
  Eye,
} from 'lucide-react';
import { Card, Button, Badge, Modal, LoadingSpinner, EmptyState } from './ui/EnterpriseUI';
import { getSupabaseClient } from '../utils/supabase/client';

// ============================================================================
// TYPES
// ============================================================================

interface StockMovementProps {
  accessToken: string;
}

interface ItemResult {
  id: string;
  item_code: string;
  item_name: string;
  part_number: string | null;
  master_serial_no: string | null;
  uom: string;
}

interface MovementRecord {
  id: string;
  movement_number: string;
  movement_date: string;
  movement_type: string;
  status: string;
  reason_description: string | null;
  notes: string | null;
  created_at: string;
  source_warehouse: string | null;
  destination_warehouse: string | null;
  source_warehouse_id: string | null;
  destination_warehouse_id: string | null;
  item_code: string | null;
  item_name: string | null;
  part_number: string | null;
  master_serial_no: string | null;
  quantity: number | null;
  requested_quantity: number | null;
  approved_quantity: number | null;
  rejected_quantity: number | null;
  supervisor_note: string | null;
  requested_by: string | null;
  reason_code: string | null;
  reference_document_type: string | null;
  reference_document_number: string | null;
}

interface ReasonCode {
  id: string;
  reason_code: string;
  category: string;
  description: string | null;
}

type LocationCode = 'PW' | 'IT' | 'SV' | 'US';
type ExternalEntity = 'PRODUCTION' | 'CUSTOMER';
type Endpoint = LocationCode | ExternalEntity;
type StockType = 'STOCK_IN' | 'REJECTION' | '';

type MovementType =
  | 'PRODUCTION_RECEIPT'
  | 'DISPATCH_TO_TRANSIT'
  | 'TRANSFER_TO_WAREHOUSE'
  | 'CUSTOMER_SALE'
  | 'CUSTOMER_RETURN'
  | 'RETURN_TO_PRODUCTION_FLOW'
  | 'RETURN_TO_PRODUCTION';

interface MovementRoute {
  from: Endpoint;
  to: Endpoint;
  movementType: MovementType;
  flow: 'FORWARD' | 'REVERSE';
  label: string;
}

interface WarehouseStock {
  warehouse_code: string;
  warehouse_name: string;
  quantity_on_hand: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const LOCATIONS: Record<LocationCode, { name: string; icon: React.ElementType; color: string }> = {
  PW: { name: 'Production Warehouse', icon: Warehouse, color: '#6366f1' },
  IT: { name: 'In-Transit', icon: Truck, color: '#f59e0b' },
  SV: { name: 'S&V Warehouse', icon: MapPin, color: '#10b981' },
  US: { name: 'US Warehouse', icon: MapPin, color: '#3b82f6' },
};

const VALID_ROUTES: MovementRoute[] = [
  { from: 'PRODUCTION', to: 'PW', movementType: 'PRODUCTION_RECEIPT', flow: 'FORWARD', label: 'Production → PW' },
  { from: 'PW', to: 'IT', movementType: 'DISPATCH_TO_TRANSIT', flow: 'FORWARD', label: 'PW → In-Transit' },
  { from: 'IT', to: 'SV', movementType: 'TRANSFER_TO_WAREHOUSE', flow: 'FORWARD', label: 'In-Transit → S&V' },
  { from: 'IT', to: 'US', movementType: 'TRANSFER_TO_WAREHOUSE', flow: 'FORWARD', label: 'In-Transit → US' },
  { from: 'SV', to: 'CUSTOMER', movementType: 'CUSTOMER_SALE', flow: 'FORWARD', label: 'S&V → Customer' },
  { from: 'US', to: 'CUSTOMER', movementType: 'CUSTOMER_SALE', flow: 'FORWARD', label: 'US → Customer' },
  { from: 'CUSTOMER', to: 'SV', movementType: 'CUSTOMER_RETURN', flow: 'REVERSE', label: 'Customer → S&V' },
  { from: 'CUSTOMER', to: 'US', movementType: 'CUSTOMER_RETURN', flow: 'REVERSE', label: 'Customer → US' },
  { from: 'SV', to: 'IT', movementType: 'RETURN_TO_PRODUCTION_FLOW', flow: 'REVERSE', label: 'S&V → In-Transit' },
  { from: 'US', to: 'IT', movementType: 'RETURN_TO_PRODUCTION_FLOW', flow: 'REVERSE', label: 'US → In-Transit' },
  { from: 'IT', to: 'PW', movementType: 'RETURN_TO_PRODUCTION_FLOW', flow: 'REVERSE', label: 'In-Transit → PW' },
  { from: 'PW', to: 'PRODUCTION', movementType: 'RETURN_TO_PRODUCTION', flow: 'REVERSE', label: 'PW → Production' },
];

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  PRODUCTION_RECEIPT: 'Production Receipt',
  DISPATCH_TO_TRANSIT: 'Dispatch to Transit',
  TRANSFER_TO_WAREHOUSE: 'Transfer to Warehouse',
  CUSTOMER_SALE: 'Customer Sale',
  CUSTOMER_RETURN: 'Customer Return',
  RETURN_TO_PRODUCTION_FLOW: 'Return to Production Flow',
  RETURN_TO_PRODUCTION: 'Return to Production',
};

// Reverse-flow movement types = Rejection; everything else = Stock In
const REVERSE_MOVEMENT_TYPES = ['CUSTOMER_RETURN', 'RETURN_TO_PRODUCTION_FLOW', 'RETURN_TO_PRODUCTION'];
const getStockType = (movementType: string): 'STOCK_IN' | 'REJECTION' =>
  REVERSE_MOVEMENT_TYPES.includes(movementType) ? 'REJECTION' : 'STOCK_IN';

const DB_CODE_MAP: Record<string, LocationCode> = {
  'WH-PROD-FLOOR': 'PW',
  'WH-INTRANSIT': 'IT',
  'WH-SNV-MAIN': 'SV',
  'WH-US-TRANSIT': 'US',
};

const REFERENCE_TYPES = [
  { value: 'DELIVERY_NOTE', label: 'Delivery Note' },
  { value: 'RETURN_NOTE', label: 'Return Note' },
  { value: 'PRODUCTION_ORDER', label: 'Production Order' },
  { value: 'TRANSFER_ORDER', label: 'Transfer Order' },
  { value: 'ADJUSTMENT_MEMO', label: 'Adjustment Memo' },
];

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  DRAFT: { color: '#6b7280', bg: '#f9fafb', label: 'Draft' },
  PENDING_APPROVAL: { color: '#d97706', bg: '#fffbeb', label: 'Pending' },
  APPROVED: { color: '#16a34a', bg: '#f0fdf4', label: 'Completed' },  // legacy records
  IN_PROGRESS: { color: '#2563eb', bg: '#eff6ff', label: 'In Progress' },
  PARTIALLY_APPROVED: { color: '#2563eb', bg: '#eff6ff', label: 'Partial' },
  REJECTED: { color: '#dc2626', bg: '#fef2f2', label: 'Rejected' },
  CANCELLED: { color: '#6b7280', bg: '#f9fafb', label: 'Cancelled' },
  COMPLETED: { color: '#16a34a', bg: '#f0fdf4', label: 'Completed' },
};

function getRoutesForWarehouse(warehouse: LocationCode, stockType: StockType): MovementRoute[] {
  if (stockType === 'STOCK_IN') {
    return VALID_ROUTES.filter(r => r.to === warehouse && r.flow === 'FORWARD');
  }
  return VALID_ROUTES.filter(r => r.to === warehouse && r.flow === 'REVERSE');
}

function getWarehousesForStockType(stockType: StockType): LocationCode[] {
  const whs = new Set<LocationCode>();
  VALID_ROUTES.forEach(r => {
    if ((stockType === 'STOCK_IN' && r.flow === 'FORWARD') || (stockType === 'REJECTION' && r.flow === 'REVERSE')) {
      if (r.to in LOCATIONS) whs.add(r.to as LocationCode);
    }
  });
  return Array.from(whs);
}

/** Can this route be partially approved? Only normal forward (not PRODUCTION_RECEIPT) */
function canPartialApprove(movementType: string): boolean {
  return ['DISPATCH_TO_TRANSIT', 'TRANSFER_TO_WAREHOUSE'].includes(movementType);
}

// ============================================================================
// SHARED STYLES
// ============================================================================

const thStyle: React.CSSProperties = {
  padding: '12px 16px',
  textAlign: 'left',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-semibold)' as any,
  color: 'var(--enterprise-gray-700)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: 'var(--font-size-base)',
  color: 'var(--enterprise-gray-800)',
};

// ============================================================================
// SUMMARY CARD (same pattern as ItemMaster)
// ============================================================================

interface SummaryCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  bgColor: string;
  isActive?: boolean;
  onClick?: () => void;
}

function SummaryCard({ label, value, icon, color, bgColor, isActive = false, onClick }: SummaryCardProps) {
  return (
    <div onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default', transition: 'all 0.2s ease' }}>
      <Card style={{
        border: isActive ? `2px solid ${color}` : '1px solid var(--enterprise-gray-200)',
        boxShadow: isActive ? `0 0 0 3px ${bgColor}` : 'var(--shadow-sm)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-600)', fontWeight: 500, marginBottom: '6px' }}>
              {label}
            </p>
            <p style={{ fontSize: '1.75rem', fontWeight: 700, color }}>{value}</p>
          </div>
          <div style={{
            width: '44px', height: '44px', borderRadius: '8px', backgroundColor: bgColor,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {icon}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export function StockMovement({ accessToken }: StockMovementProps) {
  const supabase = getSupabaseClient();

  // Main page state
  const [movements, setMovements] = useState<MovementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterStockType, setFilterStockType] = useState<string>('ALL');
  const [showModal, setShowModal] = useState(false);

  // Modal form state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ItemResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedItem, setSelectedItem] = useState<ItemResult | null>(null);
  const [warehouseStocks, setWarehouseStocks] = useState<WarehouseStock[]>([]);
  const [loadingStocks, setLoadingStocks] = useState(false);
  const [stockType, setStockType] = useState<StockType>('');
  const [selectedWarehouse, setSelectedWarehouse] = useState<LocationCode | ''>('');
  const [selectedRoute, setSelectedRoute] = useState<MovementRoute | null>(null);
  const [availableRoutes, setAvailableRoutes] = useState<MovementRoute[]>([]);
  const [quantity, setQuantity] = useState<number>(0);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formMessage, setFormMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // Reason codes (category-driven)
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  // Reference fields (user-typed)
  const [referenceType, setReferenceType] = useState<string>('');
  const [referenceId, setReferenceId] = useState<string>('');

  // Supervisor review modal state
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewMovement, setReviewMovement] = useState<MovementRecord | null>(null);
  const [supervisorNote, setSupervisorNote] = useState('');
  const [approvedQty, setApprovedQty] = useState<number>(0);
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewReasonCode, setReviewReasonCode] = useState<ReasonCode | null>(null);

  const searchRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 20;
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  // ============================================================================
  // FETCH MOVEMENTS FOR MAIN PAGE
  // ============================================================================

  const fetchMovements = useCallback(async () => {
    setLoading(true);
    try {
      const { data: headers, error: headErr } = await supabase
        .from('inv_movement_headers')
        .select(`
          id, movement_number, movement_date, movement_type, status,
          reason_code, reason_description, notes, created_at,
          requested_by, approval_status,
          reference_document_type, reference_document_number,
          source_warehouse_id, destination_warehouse_id,
          source_warehouse:source_warehouse_id ( warehouse_name ),
          destination_warehouse:destination_warehouse_id ( warehouse_name )
        `)
        .order('created_at', { ascending: false })
        .limit(200);
      if (headErr) throw headErr;

      const headerIds = (headers || []).map((h: any) => h.id);
      let linesMap: Record<string, { item_code: string; actual_quantity: number; requested_quantity: number; approved_quantity: number }> = {};
      if (headerIds.length > 0) {
        const { data: lines } = await supabase
          .from('inv_movement_lines')
          .select('header_id, item_code, actual_quantity, requested_quantity, approved_quantity')
          .in('header_id', headerIds);
        (lines || []).forEach((l: any) => {
          if (!linesMap[l.header_id]) linesMap[l.header_id] = {
            item_code: l.item_code,
            actual_quantity: l.actual_quantity || 0,
            requested_quantity: l.requested_quantity || 0,
            approved_quantity: l.approved_quantity || 0,
          };
        });
      }

      const itemCodes = [...new Set(Object.values(linesMap).map(l => l.item_code))];
      let itemInfoMap: Record<string, { item_name: string; part_number: string | null; master_serial_no: string | null }> = {};
      if (itemCodes.length > 0) {
        const { data: items } = await supabase.from('items').select('item_code, item_name, part_number, master_serial_no').in('item_code', itemCodes);
        (items || []).forEach((i: any) => {
          itemInfoMap[i.item_code] = {
            item_name: i.item_name,
            part_number: i.part_number || null,
            master_serial_no: i.master_serial_no || null,
          };
        });
      }

      const records: MovementRecord[] = (headers || []).map((h: any) => {
        const line = linesMap[h.id];
        const reqQty = line?.requested_quantity || 0;
        const apprQty = line?.approved_quantity || 0;

        // Smart status correction:
        // - If DB says APPROVED but approved < requested → it's actually PARTIALLY_APPROVED
        // - If DB says APPROVED and approved >= requested → it's COMPLETED (full approval)
        let correctedStatus = h.status;
        if (h.status === 'APPROVED') {
          if (apprQty > 0 && reqQty > 0 && apprQty < reqQty) {
            correctedStatus = 'PARTIALLY_APPROVED';
          } else {
            correctedStatus = 'COMPLETED';
          }
        }

        return {
          id: h.id, movement_number: h.movement_number, movement_date: h.movement_date,
          movement_type: h.movement_type, status: correctedStatus,
          reason_description: h.reason_description, notes: h.notes, created_at: h.created_at,
          source_warehouse: h.source_warehouse?.warehouse_name || null,
          destination_warehouse: h.destination_warehouse?.warehouse_name || null,
          source_warehouse_id: h.source_warehouse_id || null,
          destination_warehouse_id: h.destination_warehouse_id || null,
          item_code: line?.item_code || null,
          item_name: line ? (itemInfoMap[line.item_code]?.item_name || line.item_code) : null,
          part_number: line ? (itemInfoMap[line.item_code]?.part_number || null) : null,
          master_serial_no: line ? (itemInfoMap[line.item_code]?.master_serial_no || null) : null,
          quantity: line?.actual_quantity || null,
          requested_quantity: reqQty || null,
          approved_quantity: apprQty || null,
          rejected_quantity: reqQty > 0 && apprQty > 0 ? reqQty - apprQty : null,
          supervisor_note: null,
          requested_by: h.requested_by || null,
          reason_code: h.reason_code || null,
          reference_document_type: h.reference_document_type || null,
          reference_document_number: h.reference_document_number || null,
        };
      });
      setMovements(records);
    } catch (err) { console.error('Error fetching movements:', err); }
    finally { setLoading(false); }
  }, [supabase]);

  useEffect(() => { fetchMovements(); }, [fetchMovements]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) setShowDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Update routes when warehouse/stockType changes
  useEffect(() => {
    if (selectedWarehouse) {
      const routes = getRoutesForWarehouse(selectedWarehouse, stockType);
      setAvailableRoutes(routes);
      setSelectedRoute(routes.length === 1 ? routes[0] : null);
    } else {
      setAvailableRoutes([]);
      setSelectedRoute(null);
    }
  }, [selectedWarehouse, stockType]);

  // Fetch reason codes on mount (category-driven)
  const fetchReasonCodes = useCallback(async () => {
    try {
      const { data } = await supabase
        .from('inv_reason_codes')
        .select('id, reason_code, category:reason_category, description')
        .eq('is_active', true)
        .order('created_at');
      setReasonCodes(data || []);
    } catch { setReasonCodes([]); }
  }, [supabase]);

  useEffect(() => { fetchReasonCodes(); }, [fetchReasonCodes]);

  // ============================================================================
  // MODAL FORM LOGIC
  // ============================================================================

  const handleSearch = useCallback(async (query: string) => {
    setSearchQuery(query);
    if (query.length < 2) { setSearchResults([]); setShowDropdown(false); return; }
    setSearching(true); setShowDropdown(true);
    try {
      const { data, error } = await supabase.from('items')
        .select('id, item_code, item_name, part_number, master_serial_no, uom')
        .or(`item_code.ilike.%${query}%,part_number.ilike.%${query}%,master_serial_no.ilike.%${query}%`)
        .eq('is_active', true).limit(10);
      if (error) throw error;
      setSearchResults(data || []);
    } catch { setSearchResults([]); }
    finally { setSearching(false); }
  }, [supabase]);

  const fetchWarehouseStocks = useCallback(async (itemCode: string) => {
    setLoadingStocks(true);
    try {
      const { data, error } = await supabase.from('inv_warehouse_stock')
        .select('quantity_on_hand, inv_warehouses!inner ( warehouse_code, warehouse_name )')
        .eq('item_code', itemCode).eq('is_active', true);
      if (error) throw error;
      setWarehouseStocks((data || []).map((r: any) => ({
        warehouse_code: r.inv_warehouses?.warehouse_code || '',
        warehouse_name: r.inv_warehouses?.warehouse_name || '',
        quantity_on_hand: r.quantity_on_hand || 0,
      })));
    } catch { setWarehouseStocks([]); }
    finally { setLoadingStocks(false); }
  }, [supabase]);

  const handleSelectItem = (item: ItemResult) => {
    setSelectedItem(item);
    setSearchQuery(item.part_number || item.item_code);
    setShowDropdown(false);
    fetchWarehouseStocks(item.item_code);
    setSelectedWarehouse(''); setStockType(''); setSelectedRoute(null);
    setQuantity(0); setNote(''); setFormMessage(null);
    setSelectedCategory(''); setReferenceType(''); setReferenceId('');
  };

  const getStockForLocation = (locCode: LocationCode): number => {
    const dbCode = Object.entries(DB_CODE_MAP).find(([, v]) => v === locCode)?.[0];
    if (!dbCode) return 0;
    return warehouseStocks.find(s => s.warehouse_code === dbCode)?.quantity_on_hand || 0;
  };

  const handleCategoryChange = (cat: string) => {
    setSelectedCategory(cat);
    const rc = reasonCodes.find(r => r.category === cat);
    // Auto-fill note with description (acts as a base template)
    setNote(rc?.description || '');
  };

  const resetForm = () => {
    setSearchQuery(''); setSearchResults([]); setSelectedItem(null);
    setWarehouseStocks([]); setSelectedWarehouse(''); setStockType('');
    setSelectedRoute(null); setAvailableRoutes([]); setQuantity(0);
    setNote(''); setFormMessage(null);
    setSelectedCategory(''); setReferenceType(''); setReferenceId('');
  };

  const openModal = () => { resetForm(); setShowModal(true); };
  const closeModal = () => { setShowModal(false); resetForm(); };

  // ============================================================================
  // SUBMIT REQUEST (PENDING — No Stock Movement)
  // ============================================================================

  const handleSubmitRequest = async () => {
    if (!selectedItem || !stockType || !selectedWarehouse || !selectedRoute || quantity <= 0) {
      setFormMessage({ type: 'error', text: 'Please fill all required fields.' }); return;
    }
    if (!selectedCategory) {
      setFormMessage({ type: 'error', text: 'Please select a reason category.' }); return;
    }
    if (!note.trim()) {
      setFormMessage({ type: 'error', text: 'Note is required.' }); return;
    }

    setSubmitting(true); setFormMessage(null);
    try {
      const { data: warehouses } = await supabase.from('inv_warehouses').select('id, warehouse_code').eq('is_active', true);
      const getWhId = (code: LocationCode): string | null => {
        const dbCode = Object.entries(DB_CODE_MAP).find(([, v]) => v === code)?.[0];
        return warehouses?.find((w: any) => w.warehouse_code === dbCode)?.id || null;
      };
      const srcIsInternal = Object.keys(LOCATIONS).includes(selectedRoute.from);
      const dstIsInternal = Object.keys(LOCATIONS).includes(selectedRoute.to);
      const srcId = srcIsInternal ? getWhId(selectedRoute.from as LocationCode) : null;
      const dstId = dstIsInternal ? getWhId(selectedRoute.to as LocationCode) : null;

      // DB constraint requires both warehouse IDs to be non-null.
      // For external entities (PRODUCTION, CUSTOMER), use the internal warehouse for both.
      const finalSrcId = srcId || dstId;
      const finalDstId = dstId || srcId;

      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;
      const movNum = `MOV-${Date.now().toString(36).toUpperCase()}`;

      // Create PENDING header — NO stock updates
      const { data: header, error: hErr } = await supabase.from('inv_movement_headers').insert({
        movement_number: movNum,
        movement_date: new Date().toISOString().split('T')[0],
        movement_type: selectedRoute.movementType,
        source_warehouse_id: finalSrcId,
        destination_warehouse_id: finalDstId,
        status: 'PENDING_APPROVAL',
        approval_status: 'PENDING',
        reason_code: selectedCategory || null,
        reason_description: note,
        reference_document_type: referenceType || null,
        reference_document_number: referenceId || null,
        notes: `${selectedRoute.label} | Requested Qty: ${quantity} | Stock Type: ${stockType}`,
        requested_by: userId,
        created_by: userId,
      }).select().single();
      if (hErr) throw hErr;

      // Create movement line
      await supabase.from('inv_movement_lines').insert({
        header_id: header.id, line_number: 1, item_code: selectedItem.item_code,
        requested_quantity: quantity, line_status: 'PENDING_APPROVAL', created_by: userId,
      });

      setFormMessage({ type: 'success', text: `Request ${movNum} submitted for approval.` });
      fetchMovements();
      setTimeout(() => closeModal(), 1500);
    } catch (err: any) {
      console.error('Submit error:', err);
      setFormMessage({ type: 'error', text: err.message || 'Failed to submit request.' });
    } finally { setSubmitting(false); }
  };

  // ============================================================================
  // SUPERVISOR REVIEW — Open review modal
  // ============================================================================

  const handleOpenReview = async (m: MovementRecord) => {
    setReviewMovement(m);
    setApprovedQty(m.requested_quantity || 0);
    setSupervisorNote('');
    setReviewReasonCode(null);

    // Look up reason code from cached data by matching reason_code string
    if (m.reason_code) {
      const rc = reasonCodes.find(r => r.category === m.reason_code);
      if (rc) {
        setReviewReasonCode(rc);
      } else {
        // Fallback: fetch from DB by reason_category
        const { data } = await supabase
          .from('inv_reason_codes')
          .select('id, reason_code, category:reason_category, description')
          .eq('reason_category', m.reason_code)
          .single();
        if (data) setReviewReasonCode(data as any);
      }
    }
    setShowReviewModal(true);
  };

  // ============================================================================
  // SUPERVISOR APPROVAL — Stock moves only here
  // ============================================================================

  const handleApproval = async (action: 'APPROVED' | 'PARTIALLY_APPROVED' | 'REJECTED') => {
    if (!reviewMovement) return;
    if (!supervisorNote.trim()) { alert('Supervisor reason is mandatory.'); return; }

    const reqQty = reviewMovement.requested_quantity || 0;
    const finalApproved = action === 'REJECTED' ? 0 : (action === 'PARTIALLY_APPROVED' ? approvedQty : reqQty);
    const finalRejected = reqQty - finalApproved;

    if (action === 'PARTIALLY_APPROVED' && !canPartialApprove(reviewMovement.movement_type)) {
      alert('Partial approval is not allowed for this movement type.'); return;
    }
    if (action === 'PARTIALLY_APPROVED' && (finalApproved <= 0 || finalApproved >= reqQty)) {
      alert('Partial quantity must be between 1 and ' + (reqQty - 1)); return;
    }

    setReviewSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      // Write DB-valid status values (the fetchMovements smart correction
      // handles display: APPROVED with partial qty → "Partial", full qty → "Completed")
      // DB only accepts: APPROVED, PENDING_APPROVAL, REJECTED (not PARTIALLY_APPROVED or COMPLETED)
      const headerStatus = action === 'REJECTED' ? 'REJECTED' : 'APPROVED';

      // Update header (only columns that exist on inv_movement_headers)
      await supabase.from('inv_movement_headers').update({
        status: headerStatus,
        approval_status: headerStatus,
        approved_by: userId,
        approved_at: new Date().toISOString(),
      }).eq('id', reviewMovement.id);

      // Update movement line
      await supabase.from('inv_movement_lines').update({
        approved_quantity: finalApproved,
        actual_quantity: finalApproved,
        line_status: headerStatus,
      }).eq('header_id', reviewMovement.id);

      // Create approval audit record
      await supabase.from('inv_movement_approvals').insert({
        movement_header_id: reviewMovement.id,
        action, requested_quantity: reqQty,
        approved_quantity: finalApproved, rejected_quantity: finalRejected,
        supervisor_note: supervisorNote, approved_by: userId,
      });

      // STOCK UPDATES — only if approved (fully or partially)
      if (action !== 'REJECTED' && finalApproved > 0) {
        const srcId = reviewMovement.source_warehouse_id;
        const dstId = reviewMovement.destination_warehouse_id;
        const itemCode = reviewMovement.item_code;
        const qty = finalApproved;

        // Decrement source
        if (srcId && itemCode) {
          const { data: ss } = await supabase.from('inv_warehouse_stock')
            .select('id, quantity_on_hand').eq('warehouse_id', srcId)
            .eq('item_code', itemCode).eq('is_active', true).single();
          if (ss) {
            const nq = Math.max(0, ss.quantity_on_hand - qty);
            await supabase.from('inv_warehouse_stock').update({ quantity_on_hand: nq, last_issue_date: new Date().toISOString(), updated_by: userId }).eq('id', ss.id);
            await supabase.from('inv_stock_ledger').insert({ warehouse_id: srcId, item_code: itemCode, transaction_type: 'TRANSFER_OUT', quantity_change: -qty, quantity_before: ss.quantity_on_hand, quantity_after: nq, reference_type: reviewMovement.movement_type, reference_id: reviewMovement.id, notes: `OUT: ${qty} units | ${supervisorNote}`, created_by: userId });
          }
        }
        // Increment destination
        if (dstId && itemCode) {
          const { data: ds } = await supabase.from('inv_warehouse_stock')
            .select('id, quantity_on_hand').eq('warehouse_id', dstId)
            .eq('item_code', itemCode).eq('is_active', true).single();
          if (ds) {
            const nq = ds.quantity_on_hand + qty;
            await supabase.from('inv_warehouse_stock').update({ quantity_on_hand: nq, last_receipt_date: new Date().toISOString(), updated_by: userId }).eq('id', ds.id);
            await supabase.from('inv_stock_ledger').insert({ warehouse_id: dstId, item_code: itemCode, transaction_type: 'TRANSFER_IN', quantity_change: qty, quantity_before: ds.quantity_on_hand, quantity_after: nq, reference_type: reviewMovement.movement_type, reference_id: reviewMovement.id, notes: `IN: ${qty} units | ${supervisorNote}`, created_by: userId });
          } else {
            await supabase.from('inv_warehouse_stock').insert({ warehouse_id: dstId, item_code: itemCode, quantity_on_hand: qty, last_receipt_date: new Date().toISOString(), created_by: userId });
            await supabase.from('inv_stock_ledger').insert({ warehouse_id: dstId, item_code: itemCode, transaction_type: 'TRANSFER_IN', quantity_change: qty, quantity_before: 0, quantity_after: qty, reference_type: reviewMovement.movement_type, reference_id: reviewMovement.id, notes: `IN: ${qty} units | ${supervisorNote}`, created_by: userId });
          }
        }
      }

      setShowReviewModal(false);
      fetchMovements();
    } catch (err: any) {
      console.error('Approval error:', err);
      alert(err.message || 'Approval failed.');
    } finally { setReviewSubmitting(false); }
  };

  // ============================================================================
  // FILTER / SEARCH
  // ============================================================================

  const filteredMovements = movements.filter(m => {
    const matchesSearch = !searchTerm ||
      m.movement_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.part_number?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.master_serial_no?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.item_code?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.source_warehouse?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      m.destination_warehouse?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesFilter = filterType === 'ALL' || m.movement_type === filterType;
    const matchesStatus = filterStatus === 'ALL' ||
      (filterStatus === 'COMPLETED' ? ['COMPLETED', 'APPROVED'].includes(m.status) : m.status === filterStatus);
    const matchesStockType = filterStockType === 'ALL' || getStockType(m.movement_type) === filterStockType;
    return matchesSearch && matchesFilter && matchesStatus && matchesStockType;
  });

  const displayedMovements = filteredMovements.slice(0, displayCount);
  const hasMore = displayCount < filteredMovements.length;

  // Summary counts
  const totalMovements = movements.length;
  const pendingCount = movements.filter(m => m.status === 'PENDING_APPROVAL').length;
  const completedCount = movements.filter(m => ['APPROVED', 'COMPLETED'].includes(m.status)).length;
  const rejectedCount = movements.filter(m => m.status === 'REJECTED').length;

  // All active reason codes (no reason_type filtering needed)
  const filteredReasonCodes = reasonCodes;

  // ============================================================================
  // CSV EXPORT
  // ============================================================================

  const handleExport = () => {
    const headers = ['Movement #', 'Date', 'Type', 'Status', 'Part Number', 'MSN', 'Qty', 'From', 'To', 'Reason'];
    const rows = filteredMovements.map(m => [
      m.movement_number, m.movement_date, MOVEMENT_TYPE_LABELS[m.movement_type] || m.movement_type,
      m.status, m.part_number || m.item_code || '', m.master_serial_no || '', m.quantity ?? '', m.source_warehouse || '—',
      m.destination_warehouse || '—', m.reason_description || '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(c => typeof c === 'string' && c.includes(',') ? `"${c}"` : c).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `stock_movements_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  // ============================================================================
  // MOVEMENT TYPE BADGE
  // ============================================================================

  const getTypeBadge = (type: string) => {
    const isReverse = REVERSE_MOVEMENT_TYPES.includes(type);
    return (
      <Badge variant={isReverse ? 'warning' : 'info'} style={{
        fontSize: '11px', width: '100%', justifyContent: 'center',
        whiteSpace: 'nowrap', padding: '5px 6px', boxSizing: 'border-box',
      }}>
        {MOVEMENT_TYPE_LABELS[type] || type}
      </Badge>
    );
  };

  const getStatusBadge = (status: string, movement?: MovementRecord) => {
    const cfg = STATUS_CONFIG[status] || { color: '#6b7280', bg: '#f9fafb', label: status };
    return (
      <button
        onClick={movement ? () => handleOpenReview(movement) : undefined}
        style={{
          padding: '4px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: 600,
          border: `1px solid ${cfg.color}30`, background: cfg.bg, color: cfg.color,
          cursor: movement ? 'pointer' : 'default', display: 'inline-flex', alignItems: 'center',
          justifyContent: 'center', gap: '4px', minWidth: '95px',
        }}
      >
        <Eye size={12} /> {cfg.label}
      </button>
    );
  };

  // Modal input style
  const mInputStyle: React.CSSProperties = {
    width: '100%', padding: '10px 14px', border: '1px solid var(--border-color, #d1d5db)',
    borderRadius: '8px', fontSize: '14px', outline: 'none', transition: 'border-color 0.2s, box-shadow 0.2s',
    backgroundColor: '#fff',
  };

  const mLabelStyle: React.CSSProperties = {
    display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--enterprise-gray-700, #374151)', marginBottom: '6px',
  };

  const mSelectStyle: React.CSSProperties = {
    ...mInputStyle, cursor: 'pointer', appearance: 'none' as const,
    backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%236b7280\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E")',
    backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
  };

  // ============================================================================
  // RENDER: MAIN PAGE
  // ============================================================================

  return (
    <div>
      {/* ─── SUMMARY CARDS ─── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
        <SummaryCard
          label="Total Movements" value={totalMovements}
          icon={<ArrowRightLeft size={22} style={{ color: '#1e3a8a' }} />}
          color="#1e3a8a" bgColor="rgba(30,58,138,0.1)"
          isActive={filterStatus === 'ALL'} onClick={() => setFilterStatus('ALL')}
        />
        <SummaryCard
          label="Pending" value={pendingCount}
          icon={<Clock size={22} style={{ color: '#d97706' }} />}
          color="#d97706" bgColor="rgba(217,119,6,0.1)"
          isActive={filterStatus === 'PENDING_APPROVAL'} onClick={() => setFilterStatus('PENDING_APPROVAL')}
        />
        <SummaryCard
          label="Completed" value={completedCount}
          icon={<CheckCircle2 size={22} style={{ color: '#16a34a' }} />}
          color="#16a34a" bgColor="rgba(22,163,74,0.1)"
          isActive={filterStatus === 'COMPLETED'} onClick={() => setFilterStatus('COMPLETED')}
        />
        <SummaryCard
          label="Rejected" value={rejectedCount}
          icon={<XCircle size={22} style={{ color: '#dc2626' }} />}
          color="#dc2626" bgColor="rgba(220,38,38,0.1)"
          isActive={filterStatus === 'REJECTED'} onClick={() => setFilterStatus('REJECTED')}
        />
      </div>

      {/* ─── FILTER BAR ─── */}
      <div style={{
        display: 'flex', alignItems: 'center', marginBottom: '16px', gap: '12px', flexWrap: 'wrap',
        background: 'white', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--enterprise-gray-200)',
      }}>
        {/* Search */}
        <div style={{
          display: 'flex', alignItems: 'center', background: 'var(--enterprise-gray-50)',
          border: '1px solid var(--enterprise-gray-300)', borderRadius: '6px', padding: '8px 12px', flex: 1, minWidth: '260px',
        }}>
          <Search size={18} style={{ color: 'var(--enterprise-gray-400)', marginRight: '10px', flexShrink: 0 }} />
          <input
            type="text" placeholder="Search by movement #, part number, MSN, warehouse..."
            value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
            style={{ border: 'none', outline: 'none', flex: 1, fontSize: '13px', color: 'var(--enterprise-gray-800)', background: 'transparent', minWidth: '180px' }}
          />
          {searchTerm && (
            <button onClick={() => setSearchTerm('')} style={{ background: 'var(--enterprise-gray-200)', border: 'none', cursor: 'pointer', padding: '4px', display: 'flex', alignItems: 'center', borderRadius: '4px', marginLeft: '8px' }}>
              <X size={14} style={{ color: 'var(--enterprise-gray-600)' }} />
            </button>
          )}
        </div>

        {/* Status Filter */}
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{
          padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--enterprise-gray-300)',
          fontSize: '13px', fontWeight: 500, cursor: 'pointer', background: 'white',
        }}>
          <option value="ALL">All Status</option>
          <option value="PENDING_APPROVAL">Pending</option>
          <option value="PARTIALLY_APPROVED">Partial</option>
          <option value="COMPLETED">Completed</option>
          <option value="REJECTED">Rejected</option>
        </select>

        {/* Stock Type Filter */}
        <select value={filterStockType} onChange={e => setFilterStockType(e.target.value)} style={{
          padding: '8px 12px', borderRadius: '6px', border: '1px solid var(--enterprise-gray-300)',
          fontSize: '13px', fontWeight: 500, cursor: 'pointer', background: 'white',
        }}>
          <option value="ALL">All Stock Type</option>
          <option value="STOCK_IN">Stock In</option>
          <option value="REJECTION">Rejection</option>
        </select>

        {/* Right actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {(searchTerm || filterType !== 'ALL' || filterStatus !== 'ALL' || filterStockType !== 'ALL') && (
            <button onClick={() => { setSearchTerm(''); setFilterType('ALL'); setFilterStatus('ALL'); setFilterStockType('ALL'); }} style={{
              padding: '0 12px', height: '36px', borderRadius: '6px', border: '1px solid #dc2626',
              background: 'white', color: '#dc2626', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
              display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap',
            }}>
              <XCircle size={16} /> Clear
            </button>
          )}
          <button onClick={handleExport} style={{
            padding: '0 14px', height: '36px', borderRadius: '6px', border: '1px solid var(--enterprise-gray-300)',
            background: 'white', color: 'var(--enterprise-gray-700)', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap',
          }}>
            <Download size={14} /> Export CSV
          </button>
          <button onClick={openModal} style={{
            padding: '0 14px', height: '36px', borderRadius: '6px', border: 'none', background: '#1e3a8a',
            color: 'white', fontSize: '13px', fontWeight: 500, cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap',
          }}>
            <Plus size={14} /> New Movement
          </button>
        </div>
      </div>

      {/* ─── MOVEMENT RECORDS TABLE ─── */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: '60px' }}><LoadingSpinner /></div>
      ) : filteredMovements.length === 0 ? (
        <EmptyState
          icon={<ArrowRightLeft size={48} style={{ color: 'var(--enterprise-gray-400)' }} />}
          title="No Stock Movements"
          description={searchTerm || filterType !== 'ALL' || filterStockType !== 'ALL' ? 'No movements match your filters.' : 'Click "New Movement" to record your first stock movement.'}
          action={{ label: 'New Movement', onClick: openModal }}
        />
      ) : (
        <>
          <div style={{
            background: 'white', borderRadius: '8px', border: '1px solid var(--enterprise-gray-200)',
            overflow: 'hidden', boxShadow: 'var(--shadow-sm)',
          }}>
            <div style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '18%' }} />
                  <col style={{ width: '16%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '9%' }} />
                </colgroup>
                <thead style={{ position: 'sticky', top: 0, zIndex: 2, background: 'var(--enterprise-gray-50)' }}>
                  <tr>
                    <th style={thStyle}>Movement #</th>
                    <th style={thStyle}>Date</th>
                    <th style={thStyle}>Type</th>
                    <th style={thStyle}>Item</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Req Qty</th>
                    <th style={thStyle}>From</th>
                    <th style={thStyle}>To</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedMovements.map(m => (
                    <tr key={m.id}>
                      <td style={{ ...tdStyle, fontWeight: 600, fontFamily: 'monospace', color: 'var(--enterprise-primary, #1e3a8a)', fontSize: '13px' }}>
                        {m.movement_number}
                      </td>
                      <td style={{ ...tdStyle, fontSize: '13px', whiteSpace: 'nowrap' }}>
                        {m.movement_date ? new Date(m.movement_date).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td style={{ ...tdStyle, padding: '12px 8px' }}>{getTypeBadge(m.movement_type)}</td>
                      <td style={tdStyle}>
                        <div style={{ fontSize: '13px', fontWeight: 600 }}>{m.part_number || m.item_code || '—'}</div>
                        {m.master_serial_no && <div style={{ fontSize: '11px', color: 'var(--enterprise-gray-500)' }}>MSN: {m.master_serial_no}</div>}
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'monospace', fontSize: '14px' }}>
                        <div style={{ fontWeight: 700 }}>{(m.requested_quantity ?? m.quantity ?? 0).toLocaleString()}</div>
                        {m.approved_quantity != null && m.status !== 'PENDING_APPROVAL' && (
                          <div style={{ fontSize: '11px', color: '#16a34a' }}>Moved: {m.approved_quantity.toLocaleString()}</div>
                        )}
                      </td>
                      <td style={{ ...tdStyle, fontSize: '13px' }}>{m.source_warehouse || '—'}</td>
                      <td style={{ ...tdStyle, fontSize: '13px' }}>{m.destination_warehouse || '—'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{getStatusBadge(m.status, m)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Load More */}
          {hasMore && (
            <div style={{ textAlign: 'center', marginTop: '16px' }}>
              <button className="load-more-btn" onClick={() => setDisplayCount(prev => prev + PAGE_SIZE)}>
                Load More ({filteredMovements.length - displayCount} remaining)
              </button>
            </div>
          )}
        </>
      )}

      {/* ─── NEW MOVEMENT MODAL ─── */}
      <Modal isOpen={showModal} onClose={closeModal} title="New Stock Movement" maxWidth="780px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>

          {/* Form Message */}
          {formMessage && (
            <div style={{
              padding: '10px 14px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px',
              backgroundColor: formMessage.type === 'success' ? '#ecfdf5' : '#fef2f2',
              border: `1px solid ${formMessage.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
              color: formMessage.type === 'success' ? '#065f46' : '#991b1b', fontSize: '13px', fontWeight: 500,
            }}>
              {formMessage.type === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {formMessage.text}
            </div>
          )}

          {/* Search Item */}
          <div ref={searchRef} style={{ position: 'relative' }}>
            {!selectedItem && (
              <label style={mLabelStyle}>
                <Search size={14} style={{ display: 'inline', marginRight: '6px', verticalAlign: 'middle' }} />
                Search Item (Part Number, MSN, or Item Code)
              </label>
            )}
            <div style={{ position: 'relative' }}>
              <input type="text" value={searchQuery} onChange={e => handleSearch(e.target.value)}
                onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
                placeholder="Type to search..." style={{ ...mInputStyle, paddingLeft: '38px' }} />
              <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
              {searching && <Loader2 size={16} style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: '#3b82f6', animation: 'spin 1s linear infinite' }} />}
              {showDropdown && searchResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 10px 25px rgba(0,0,0,0.12)', marginTop: '4px', maxHeight: '200px', overflowY: 'auto' }}>
                  {searchResults.map(item => (
                    <button key={item.id} onClick={() => handleSelectItem(item)} style={{
                      width: '100%', padding: '8px 14px', border: 'none', background: 'none', textAlign: 'left',
                      cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '1px',
                      borderBottom: '1px solid #f3f4f6', transition: 'background 0.15s',
                    }}
                      onMouseEnter={e => { e.currentTarget.style.backgroundColor = '#f0f9ff'; }}
                      onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                    >
                      <span style={{ fontWeight: 600, fontSize: '13px', color: '#111827' }}>{item.part_number || item.item_code}</span>
                      <span style={{ fontSize: '11px', color: '#6b7280' }}>
                        {item.master_serial_no ? `MSN: ${item.master_serial_no} | ` : ''}{item.item_code} — {item.item_name}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Item Details + Stock (after selection) */}
          {selectedItem && (
            <>
              {/* Item Info */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px', background: 'var(--enterprise-gray-50)', padding: '12px 16px', borderRadius: '8px' }}>
                {[
                  { label: 'Part Number', value: selectedItem.part_number || '—' },
                  { label: 'MSN', value: selectedItem.master_serial_no || '—' },
                  { label: 'Item Code', value: selectedItem.item_code },
                  { label: 'Description', value: selectedItem.item_name },
                ].map(f => (
                  <div key={f.label}>
                    <div style={{ fontSize: '10px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{f.label}</div>
                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>{f.value}</div>
                  </div>
                ))}
              </div>

              {/* Stock Across Warehouses — On-Hand */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                {(Object.entries(LOCATIONS) as [LocationCode, typeof LOCATIONS[LocationCode]][]).map(([code, loc]) => {
                  const stock = getStockForLocation(code);
                  const Icon = loc.icon;
                  return (
                    <div key={code} style={{
                      padding: '10px', borderRadius: '8px', border: '1px solid #e5e7eb',
                      background: `${loc.color}08`, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
                    }}>
                      <Icon size={16} style={{ color: loc.color }} />
                      <div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280', textAlign: 'center' }}>{loc.name}</div>
                      <div style={{ fontSize: '18px', fontWeight: 800, color: loc.color }}>{loadingStocks ? '...' : stock.toLocaleString()}</div>
                      <div style={{ fontSize: '10px', color: '#9ca3af' }}>On-Hand ({selectedItem.uom})</div>
                    </div>
                  );
                })}
              </div>

              {/* ── LAYOUT 1: Stock Type Selection ── */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'end' }}>
                <div>
                  <label style={mLabelStyle}>Stock Type *</label>
                  <select value={stockType} onChange={e => { setStockType(e.target.value as StockType); setSelectedWarehouse(''); setSelectedRoute(null); setAvailableRoutes([]); }} style={mSelectStyle}>
                    <option value="">Select stock type...</option>
                    <option value="STOCK_IN">Stock In</option>
                    <option value="REJECTION">From Rejection</option>
                  </select>
                </div>
                {stockType && (
                  <div style={{
                    padding: '8px 16px', borderRadius: '8px', fontWeight: 700, fontSize: '13px',
                    display: 'flex', alignItems: 'center', gap: '6px', height: '42px',
                    background: stockType === 'STOCK_IN' ? '#ecfdf5' : '#fef2f2',
                    color: stockType === 'STOCK_IN' ? '#065f46' : '#991b1b',
                    border: `2px solid ${stockType === 'STOCK_IN' ? '#10b981' : '#ef4444'}`,
                  }}>
                    {stockType === 'STOCK_IN' ? <><ArrowDownCircle size={16} /> IN</> : <><RefreshCw size={16} /> REJECTION</>}
                  </div>
                )}
              </div>
            </>
          )}

          {/* ── LAYOUT 2: Movement Entry Form (appears after stock type is selected) ── */}
          {selectedItem && stockType && (
            <>
              {/* Divider */}
              <div style={{ borderTop: '1px dashed #d1d5db', margin: '4px 0' }} />

              {/* Row 1: Warehouse + Route */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={mLabelStyle}>Select Warehouse *</label>
                  <select value={selectedWarehouse} onChange={e => setSelectedWarehouse(e.target.value as LocationCode)} style={mSelectStyle}>
                    <option value="">Choose warehouse...</option>
                    {getWarehousesForStockType(stockType).map(code => (
                      <option key={code} value={code}>{LOCATIONS[code].name} ({code})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label style={mLabelStyle}>Movement Route</label>
                  {selectedWarehouse && availableRoutes.length > 0 ? (
                    availableRoutes.length === 1 ? (
                      <div style={{
                        padding: '10px 14px', borderRadius: '8px', fontSize: '13px', fontWeight: 600,
                        background: selectedRoute?.flow === 'REVERSE' ? '#fffbeb' : '#eff6ff',
                        color: selectedRoute?.flow === 'REVERSE' ? '#92400e' : '#1e40af',
                        border: `1px solid ${selectedRoute?.flow === 'REVERSE' ? '#fde68a' : '#bfdbfe'}`,
                        display: 'flex', alignItems: 'center', gap: '6px',
                      }}>
                        <ArrowRight size={14} /> {selectedRoute?.label}
                      </div>
                    ) : (
                      <select value={availableRoutes.indexOf(selectedRoute!) >= 0 ? availableRoutes.indexOf(selectedRoute!).toString() : ''} onChange={e => setSelectedRoute(availableRoutes[parseInt(e.target.value)])} style={mSelectStyle}>
                        <option value="">Select route...</option>
                        {availableRoutes.map((r, i) => <option key={i} value={i.toString()}>{r.label}</option>)}
                      </select>
                    )
                  ) : selectedWarehouse ? (
                    <div style={{ padding: '10px', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#991b1b', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <XCircle size={14} /> No valid routes
                    </div>
                  ) : (
                    <div style={{ padding: '10px 14px', borderRadius: '8px', border: '1px dashed #d1d5db', color: '#9ca3af', fontSize: '13px' }}>Select warehouse first</div>
                  )}
                </div>
              </div>

              {/* Info badge for movement type */}
              {selectedRoute && (
                <div style={{
                  padding: '6px 10px', borderRadius: '6px', fontSize: '11px',
                  backgroundColor: selectedRoute.flow === 'REVERSE' ? '#fffbeb' : '#eff6ff',
                  color: selectedRoute.flow === 'REVERSE' ? '#92400e' : '#1e40af',
                  border: `1px solid ${selectedRoute.flow === 'REVERSE' ? '#fde68a' : '#bfdbfe'}`,
                  display: 'flex', alignItems: 'center', gap: '6px',
                }}>
                  <Info size={12} /> <strong>{MOVEMENT_TYPE_LABELS[selectedRoute.movementType]}</strong>
                </div>
              )}

              {/* Row 2: Reference Type + Reference ID */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={mLabelStyle}>Reference Type</label>
                  <select value={referenceType} onChange={e => setReferenceType(e.target.value)} style={mSelectStyle}>
                    <option value="">Select type...</option>
                    {REFERENCE_TYPES.map(rt => <option key={rt.value} value={rt.value}>{rt.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={mLabelStyle}>Reference ID</label>
                  <input type="text" value={referenceId} onChange={e => setReferenceId(e.target.value)}
                    placeholder="Enter reference ID..." style={mInputStyle} />
                </div>
              </div>

              {/* Row 3: Reason Code + Quantity */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={mLabelStyle}>Reason Code *</label>
                  <select value={selectedCategory} onChange={e => handleCategoryChange(e.target.value)} style={mSelectStyle}>
                    <option value="">Select reason code...</option>
                    {filteredReasonCodes.map(rc => <option key={rc.id} value={rc.category}>{rc.reason_code.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div>
                  <label style={mLabelStyle}>Quantity ({selectedItem.uom}) *</label>
                  <input type="number" min={1} value={quantity || ''} onChange={e => setQuantity(parseInt(e.target.value) || 0)}
                    placeholder="Enter quantity" style={mInputStyle} />
                </div>
              </div>

              {/* Row 4: Note (full width) */}
              <div>
                <label style={mLabelStyle}>Note *</label>
                <textarea value={note} onChange={e => setNote(e.target.value)} rows={3}
                  placeholder="Auto-filled from reason category. You may add additional notes."
                  style={{ ...mInputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
              </div>
            </>
          )}

          {/* Row 5: Action Buttons */}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', borderTop: '1px solid var(--enterprise-gray-200)', paddingTop: '16px' }}>
            <Button variant="tertiary" onClick={closeModal}>Cancel</Button>
            <Button
              variant="primary"
              onClick={handleSubmitRequest}
              disabled={submitting || !selectedRoute || quantity <= 0 || !selectedCategory || !note.trim()}
              icon={submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Shield size={16} />}
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ═══════════════ SUPERVISOR REVIEW MODAL ═══════════════ */}
      <Modal isOpen={showReviewModal} onClose={() => setShowReviewModal(false)} title="Movement Review" maxWidth="680px">
        {reviewMovement && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {/* Status Banner */}
            <div style={{
              padding: '12px 16px', borderRadius: '8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              background: STATUS_CONFIG[reviewMovement.status]?.bg || '#f9fafb',
              border: `1px solid ${STATUS_CONFIG[reviewMovement.status]?.color || '#6b7280'}30`,
            }}>
              <span style={{ fontWeight: 700, fontSize: '14px', color: STATUS_CONFIG[reviewMovement.status]?.color }}>
                {STATUS_CONFIG[reviewMovement.status]?.label || reviewMovement.status}
              </span>
              <span style={{ fontSize: '12px', color: '#6b7280' }}>{reviewMovement.movement_number}</span>
            </div>

            {/* Movement Details Grid */}
            <div style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', padding: '14px',
              borderRadius: '8px', background: '#f9fafb', border: '1px solid #e5e7eb',
            }}>
              {[
                { label: 'Movement Type', value: MOVEMENT_TYPE_LABELS[reviewMovement.movement_type] || reviewMovement.movement_type },
                { label: 'Stock Type', value: reviewMovement.movement_type.includes('RETURN') || reviewMovement.movement_type === 'CUSTOMER_RETURN' ? 'From Rejection' : 'Stock In' },
                { label: 'From', value: reviewMovement.source_warehouse || 'External' },
                { label: 'To', value: reviewMovement.destination_warehouse || 'External' },
                { label: 'Item', value: `${reviewMovement.item_code} — ${reviewMovement.item_name}` },
                { label: 'Requested Qty', value: (reviewMovement.requested_quantity ?? reviewMovement.quantity ?? 0).toLocaleString() },
                { label: 'Reason Code', value: reviewReasonCode?.reason_code?.replace(/_/g, ' ') || reviewMovement.reason_code?.replace(/_/g, ' ') || '—' },
                { label: 'Reference', value: reviewMovement.reference_document_number ? `${reviewMovement.reference_document_type?.replace(/_/g, ' ') || ''} — ${reviewMovement.reference_document_number}` : '—' },
                { label: 'Created', value: reviewMovement.created_at ? new Date(reviewMovement.created_at).toLocaleString('en-IN') : '—' },
              ].map(f => (
                <div key={f.label}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' }}>{f.label}</div>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: '#111827', marginTop: '2px' }}>{f.value}</div>
                </div>
              ))}
            </div>

            {/* Category Description */}
            {reviewReasonCode?.description && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#fffbeb', border: '1px solid #fde68a', fontSize: '12px', color: '#92400e' }}>
                <strong>Category Description:</strong> {reviewReasonCode.description}
              </div>
            )}

            {/* Operator Note */}
            {reviewMovement.reason_description && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#f0f9ff', border: '1px solid #bae6fd', fontSize: '12px', color: '#0c4a6e' }}>
                <strong>Operator Note:</strong> {reviewMovement.reason_description}
              </div>
            )}

            {/* Supervisor Note (if already reviewed) */}
            {reviewMovement.supervisor_note && (
              <div style={{ padding: '10px 14px', borderRadius: '8px', background: '#f5f3ff', border: '1px solid #c4b5fd', fontSize: '12px', color: '#5b21b6' }}>
                <strong>Supervisor Note:</strong> {reviewMovement.supervisor_note}
              </div>
            )}

            {/* Moved/Rejected Quantities */}
            {reviewMovement.status !== 'PENDING_APPROVAL' && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px' }}>
                <div style={{ padding: '10px', borderRadius: '8px', background: '#f0fdf4', border: '1px solid #bbf7d0', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280' }}>MOVED</div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#16a34a' }}>{(reviewMovement.approved_quantity ?? 0).toLocaleString()}</div>
                </div>
                <div style={{ padding: '10px', borderRadius: '8px', background: '#fef2f2', border: '1px solid #fecaca', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280' }}>REJECTED</div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#dc2626' }}>{(reviewMovement.rejected_quantity ?? 0).toLocaleString()}</div>
                </div>
                <div style={{ padding: '10px', borderRadius: '8px', background: '#eff6ff', border: '1px solid #bfdbfe', textAlign: 'center' }}>
                  <div style={{ fontSize: '10px', fontWeight: 600, color: '#6b7280' }}>REQUESTED</div>
                  <div style={{ fontSize: '18px', fontWeight: 800, color: '#2563eb' }}>{(reviewMovement.requested_quantity ?? 0).toLocaleString()}</div>
                </div>
              </div>
            )}

            {/* Supervisor Actions — Only for PENDING_APPROVAL */}
            {reviewMovement.status === 'PENDING_APPROVAL' && (
              <>
                <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: '14px' }}>
                  <label style={mLabelStyle}>Supervisor Reason *</label>
                  <textarea value={supervisorNote} onChange={e => setSupervisorNote(e.target.value)} rows={2}
                    placeholder="Enter reason for your decision..." style={{ ...mInputStyle, resize: 'vertical', fontFamily: 'inherit' }} />
                </div>

                {/* Partial Approval Input — only for eligible types */}
                {canPartialApprove(reviewMovement.movement_type) && (
                  <div>
                    <label style={mLabelStyle}>Quantity to Move (for partial)</label>
                    <input type="number" min={1} max={(reviewMovement.requested_quantity ?? 1) - 1} value={approvedQty || ''}
                      onChange={e => setApprovedQty(parseInt(e.target.value) || 0)}
                      style={mInputStyle} placeholder={`Max: ${(reviewMovement.requested_quantity ?? 0) - 1}`} />
                  </div>
                )}

                <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end', borderTop: '1px solid #e5e7eb', paddingTop: '14px' }}>
                  <button onClick={() => handleApproval('REJECTED')} disabled={reviewSubmitting || !supervisorNote.trim()} style={{
                    padding: '8px 18px', borderRadius: '8px', fontWeight: 600, fontSize: '13px',
                    border: '1px solid #dc2626', background: '#fef2f2', color: '#dc2626',
                    cursor: !supervisorNote.trim() ? 'not-allowed' : 'pointer', opacity: !supervisorNote.trim() ? 0.5 : 1,
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}>
                    <XCircle size={14} /> Reject
                  </button>

                  {canPartialApprove(reviewMovement.movement_type) && (
                    <button onClick={() => handleApproval('PARTIALLY_APPROVED')} disabled={reviewSubmitting || !supervisorNote.trim() || approvedQty <= 0 || approvedQty >= (reviewMovement.requested_quantity ?? 0)} style={{
                      padding: '8px 18px', borderRadius: '8px', fontWeight: 600, fontSize: '13px',
                      border: '1px solid #2563eb', background: '#eff6ff', color: '#2563eb',
                      cursor: !supervisorNote.trim() ? 'not-allowed' : 'pointer', opacity: !supervisorNote.trim() ? 0.5 : 1,
                      display: 'flex', alignItems: 'center', gap: '6px',
                    }}>
                      <Shield size={14} /> Partial
                    </button>
                  )}

                  <button onClick={() => handleApproval('APPROVED')} disabled={reviewSubmitting || !supervisorNote.trim()} style={{
                    padding: '8px 18px', borderRadius: '8px', fontWeight: 600, fontSize: '13px',
                    border: 'none', background: '#16a34a', color: '#fff',
                    cursor: !supervisorNote.trim() ? 'not-allowed' : 'pointer', opacity: !supervisorNote.trim() ? 0.5 : 1,
                    display: 'flex', alignItems: 'center', gap: '6px',
                  }}>
                    <CheckCircle2 size={14} /> Complete
                  </button>
                </div>
              </>
            )}

            {/* Close button for non-PENDING_APPROVAL */}
            {reviewMovement.status !== 'PENDING_APPROVAL' && (
              <div style={{ display: 'flex', justifyContent: 'flex-end', borderTop: '1px solid #e5e7eb', paddingTop: '14px' }}>
                <Button variant="tertiary" onClick={() => setShowReviewModal(false)}>Close</Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}