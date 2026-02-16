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
  CalendarDays,
  Printer,
} from 'lucide-react';
import { Card, Button, Badge, Modal, LoadingSpinner, EmptyState } from './ui/EnterpriseUI';
import { getSupabaseClient } from '../utils/supabase/client';

// ============================================================================
// TYPES
// ============================================================================

type UserRole = 'L1' | 'L2' | 'L3' | null;

interface StockMovementProps {
  accessToken: string;
  userRole?: UserRole;
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

type LocationCode = 'PW' | 'IT' | 'SV' | 'US' | 'PF';
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
  | 'RETURN_TO_PRODUCTION'
  | 'REJECTION_DISPOSAL';

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
  PF: { name: 'Production Floor', icon: ArrowDownCircle, color: '#dc2626' },
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
  { from: 'PW', to: 'PF', movementType: 'REJECTION_DISPOSAL', flow: 'REVERSE', label: 'PW → Production Floor (Disposal)' },
];

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  PRODUCTION_RECEIPT: 'Production Receipt',
  DISPATCH_TO_TRANSIT: 'Dispatch to Transit',
  TRANSFER_TO_WAREHOUSE: 'Transfer to Warehouse',
  CUSTOMER_SALE: 'Customer Sale',
  CUSTOMER_RETURN: 'Customer Return',
  RETURN_TO_PRODUCTION_FLOW: 'Return to Production Flow',
  RETURN_TO_PRODUCTION: 'Return to Production',
  REJECTION_DISPOSAL: 'Rejection Disposal (Final Removal)',
};

// Reverse-flow movement types = Rejection; everything else = Stock In
const REVERSE_MOVEMENT_TYPES = ['CUSTOMER_RETURN', 'RETURN_TO_PRODUCTION_FLOW', 'RETURN_TO_PRODUCTION', 'REJECTION_DISPOSAL'];
const getStockType = (movementType: string): 'STOCK_IN' | 'REJECTION' =>
  REVERSE_MOVEMENT_TYPES.includes(movementType) ? 'REJECTION' : 'STOCK_IN';

/** Movement types where stock is only deducted (OUT only), no destination increment */
const OUT_ONLY_MOVEMENT_TYPES = ['REJECTION_DISPOSAL'];

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

export function StockMovement({ accessToken, userRole }: StockMovementProps) {
  // RBAC helpers
  const isOperator = userRole === 'L1';
  const canApprove = userRole === 'L2' || userRole === 'L3'; // Supervisor or Manager
  const supabase = getSupabaseClient();

  // Main page state
  const [movements, setMovements] = useState<MovementRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [filterStockType, setFilterStockType] = useState<string>('ALL');
  const [filterDateFrom, setFilterDateFrom] = useState<string>('');
  const [filterDateTo, setFilterDateTo] = useState<string>('');
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
  const [notePrefix, setNotePrefix] = useState('');  // Non-removable auto-message prefix
  const noteRef = useRef<HTMLTextAreaElement>(null);
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

  // Toast notification state
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; title: string; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: 'success' | 'error' | 'warning' | 'info', title: string, text: string, duration = 5000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, title, text });
    toastTimer.current = setTimeout(() => setToast(null), duration);
  }, []);

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
          rejected_quantity: h.status === 'REJECTED' ? reqQty : (reqQty > 0 && apprQty > 0 ? reqQty - apprQty : 0),
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

  const handleCategoryChange = (reasonCode: string) => {
    setSelectedCategory(reasonCode);
    const rc = reasonCodes.find(r => r.reason_code === reasonCode);
    // Auto-fill note with format: "Reason Code Description" - 
    const desc = rc?.description || rc?.reason_code?.replace(/_/g, ' ') || '';
    const prefix = desc ? `"${desc}" - ` : '';
    setNotePrefix(prefix);
    setNote(prefix);
    // Place cursor after the dash+space
    setTimeout(() => {
      if (noteRef.current) {
        noteRef.current.focus();
        noteRef.current.setSelectionRange(prefix.length, prefix.length);
      }
    }, 50);
  };

  const resetForm = () => {
    setSearchQuery(''); setSearchResults([]); setSelectedItem(null);
    setWarehouseStocks([]); setSelectedWarehouse(''); setStockType('');
    setSelectedRoute(null); setAvailableRoutes([]); setQuantity(0);
    setNote(''); setNotePrefix(''); setFormMessage(null);
    setSelectedCategory(''); setReferenceType(''); setReferenceId('');
  };

  const openModal = () => { resetForm(); setShowModal(true); };
  const closeModal = () => { setShowModal(false); resetForm(); };

  // ============================================================================
  // SUBMIT REQUEST (PENDING — No Stock Movement) or IMMEDIATE for REJECTION_DISPOSAL
  // ============================================================================

  const handleSubmitRequest = async () => {
    if (!selectedItem || !stockType || !selectedWarehouse || !selectedRoute || quantity <= 0) {
      setFormMessage({ type: 'error', text: 'Please fill all required fields.' });
      showToast('error', 'Validation Error', 'Please fill all required fields.'); return;
    }
    if (!selectedCategory) {
      setFormMessage({ type: 'error', text: 'Please select a reason category.' });
      showToast('error', 'Validation Error', 'Please select a reason category.'); return;
    }
    if (!note.trim()) {
      setFormMessage({ type: 'error', text: 'Note is required.' });
      showToast('error', 'Validation Error', 'Note is required.'); return;
    }

    // STOCK VALIDATION at request time — block if source warehouse has no/insufficient stock
    // Skip for external sources (PRODUCTION, CUSTOMER) since stock enters the system for those
    const externalSourceTypes = ['PRODUCTION_RECEIPT', 'CUSTOMER_RETURN'];
    if (!externalSourceTypes.includes(selectedRoute.movementType)) {
      const srcIsInternal = Object.keys(LOCATIONS).includes(selectedRoute.from);
      if (srcIsInternal) {
        const availableStock = getStockForLocation(selectedRoute.from as LocationCode);
        if (availableStock <= 0) {
          setFormMessage({ type: 'error', text: `Cannot request movement — source warehouse "${LOCATIONS[selectedRoute.from as LocationCode]?.name}" has 0 stock for this item.` });
          showToast('error', 'Insufficient Stock', `Source warehouse "${LOCATIONS[selectedRoute.from as LocationCode]?.name}" has 0 stock for this item.`);
          return;
        }
        if (quantity > availableStock) {
          setFormMessage({ type: 'error', text: `Requested quantity (${quantity}) exceeds available stock (${availableStock}) in "${LOCATIONS[selectedRoute.from as LocationCode]?.name}".` });
          showToast('warning', 'Stock Warning', `Requested quantity (${quantity}) exceeds available stock (${availableStock}) in "${LOCATIONS[selectedRoute.from as LocationCode]?.name}".`);
          return;
        }
      }
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

      // Create PENDING header — NO stock updates (all movements go through approval)
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
      showToast('success', 'Request Submitted', `Movement ${movNum} has been submitted for supervisor approval.`);
      fetchMovements();
      setTimeout(() => closeModal(), 1500);
    } catch (err: any) {
      console.error('Submit error:', err);
      setFormMessage({ type: 'error', text: err.message || 'Failed to submit request.' });
      showToast('error', 'Submission Failed', err.message || 'Failed to submit the movement request.');
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
      const rc = reasonCodes.find(r => r.reason_code === m.reason_code);
      if (rc) {
        setReviewReasonCode(rc);
      } else {
        // Fallback: fetch from DB by reason_code
        const { data } = await supabase
          .from('inv_reason_codes')
          .select('id, reason_code, category:reason_category, description')
          .eq('reason_code', m.reason_code)
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
    if (!supervisorNote.trim()) { showToast('warning', 'Missing Information', 'Supervisor reason is mandatory. Please provide a reason before proceeding.'); return; }

    const reqQty = reviewMovement.requested_quantity || 0;
    const finalApproved = action === 'REJECTED' ? 0 : (action === 'PARTIALLY_APPROVED' ? approvedQty : reqQty);
    const finalRejected = reqQty - finalApproved;

    if (action === 'PARTIALLY_APPROVED' && !canPartialApprove(reviewMovement.movement_type)) {
      showToast('warning', 'Not Allowed', 'Partial approval is not allowed for this movement type.'); return;
    }
    if (action === 'PARTIALLY_APPROVED' && (finalApproved <= 0 || finalApproved >= reqQty)) {
      showToast('warning', 'Invalid Quantity', 'Partial quantity must be between 1 and ' + (reqQty - 1) + '.'); return;
    }

    setReviewSubmitting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const userId = session?.user?.id;

      // STOCK VALIDATION — check if source has enough stock before approving
      // Skip for routes where stock comes from external sources (production/customer returns)
      const externalSourceTypes = ['PRODUCTION_RECEIPT', 'CUSTOMER_RETURN'];
      if (action !== 'REJECTED' && !externalSourceTypes.includes(reviewMovement.movement_type)) {
        const srcId = reviewMovement.source_warehouse_id;
        const itemCode = reviewMovement.item_code;
        if (srcId && itemCode) {
          const { data: stockRecord } = await supabase.from('inv_warehouse_stock')
            .select('quantity_on_hand').eq('warehouse_id', srcId)
            .eq('item_code', itemCode).eq('is_active', true).single();
          const availableQty = stockRecord?.quantity_on_hand || 0;
          if (availableQty < finalApproved) {
            setReviewSubmitting(false);
            showToast('error', 'Insufficient Stock', `Source warehouse has only ${availableQty} units available but ${finalApproved} were requested. Please reduce the quantity or reject this movement.`, 8000);
            return;
          }
        }
      }

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
        const movType = reviewMovement.movement_type;
        const isDisposal = OUT_ONLY_MOVEMENT_TYPES.includes(movType);

        // Determine which sides are external (no stock operations needed for external entities)
        // External SOURCE: stock comes from outside — only INCREMENT destination, no source deduction
        const hasExternalSource = ['PRODUCTION_RECEIPT', 'CUSTOMER_RETURN'].includes(movType);
        // External DESTINATION: stock goes outside — only DECREMENT source, no destination increment
        const hasExternalDest = ['CUSTOMER_SALE', 'RETURN_TO_PRODUCTION'].includes(movType) || isDisposal;

        // Decrement source — SKIP if source is external (stock comes from outside)
        if (!hasExternalSource && srcId && itemCode) {
          const { data: ss } = await supabase.from('inv_warehouse_stock')
            .select('id, quantity_on_hand').eq('warehouse_id', srcId)
            .eq('item_code', itemCode).eq('is_active', true).single();
          if (ss) {
            const nq = Math.max(0, ss.quantity_on_hand - qty);
            await supabase.from('inv_warehouse_stock').update({ quantity_on_hand: nq, last_issue_date: new Date().toISOString(), updated_by: userId }).eq('id', ss.id);
            await supabase.from('inv_stock_ledger').insert({
              warehouse_id: srcId, item_code: itemCode,
              transaction_type: isDisposal ? 'STOCK_REMOVAL' : 'TRANSFER_OUT',
              quantity_change: -qty, quantity_before: ss.quantity_on_hand, quantity_after: nq,
              reference_type: movType, reference_id: reviewMovement.id,
              notes: isDisposal
                ? `OUT: ${qty} units | REJECTION DISPOSAL — Final removal from system | ${supervisorNote}`
                : `OUT: ${qty} units | ${supervisorNote}`,
              created_by: userId,
            });
          }
        }
        // Increment destination — SKIP if destination is external (stock goes outside)
        if (!hasExternalDest && dstId && itemCode) {
          const { data: ds } = await supabase.from('inv_warehouse_stock')
            .select('id, quantity_on_hand').eq('warehouse_id', dstId)
            .eq('item_code', itemCode).eq('is_active', true).single();
          if (ds) {
            const nq = ds.quantity_on_hand + qty;
            await supabase.from('inv_warehouse_stock').update({ quantity_on_hand: nq, last_receipt_date: new Date().toISOString(), updated_by: userId }).eq('id', ds.id);
            await supabase.from('inv_stock_ledger').insert({ warehouse_id: dstId, item_code: itemCode, transaction_type: 'TRANSFER_IN', quantity_change: qty, quantity_before: ds.quantity_on_hand, quantity_after: nq, reference_type: movType, reference_id: reviewMovement.id, notes: `IN: ${qty} units | ${supervisorNote}`, created_by: userId });
          } else {
            await supabase.from('inv_warehouse_stock').insert({ warehouse_id: dstId, item_code: itemCode, quantity_on_hand: qty, last_receipt_date: new Date().toISOString(), created_by: userId });
            await supabase.from('inv_stock_ledger').insert({ warehouse_id: dstId, item_code: itemCode, transaction_type: 'TRANSFER_IN', quantity_change: qty, quantity_before: 0, quantity_after: qty, reference_type: movType, reference_id: reviewMovement.id, notes: `IN: ${qty} units | ${supervisorNote}`, created_by: userId });
          }
        }
      }

      setShowReviewModal(false);
      fetchMovements();

      // Show success toast with action-specific message
      const movNum = reviewMovement.movement_number;
      if (action === 'REJECTED') {
        showToast('error', 'Movement Rejected', `Movement ${movNum} has been rejected. No stock has been moved.`);
      } else if (action === 'PARTIALLY_APPROVED') {
        showToast('info', 'Partially Approved', `Movement ${movNum} partially approved — ${approvedQty} units moved, ${(reviewMovement.requested_quantity ?? 0) - approvedQty} units rejected.`);
      } else {
        showToast('success', 'Movement Completed', `Movement ${movNum} fully approved — ${reviewMovement.requested_quantity ?? 0} units moved successfully.`);
      }
    } catch (err: any) {
      console.error('Approval error:', err);
      showToast('error', 'Approval Failed', err.message || 'Failed to process the approval action.');
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
    const matchesDateFrom = !filterDateFrom || (m.movement_date && m.movement_date >= filterDateFrom);
    const matchesDateTo = !filterDateTo || (m.movement_date && m.movement_date <= filterDateTo);
    return matchesSearch && matchesFilter && matchesStatus && matchesStockType && matchesDateFrom && matchesDateTo;
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
  // PRINT SLIP
  // ============================================================================

  const handlePrintSlip = (
    m: MovementRecord,
    statusCfg: { color: string; bg: string; label: string },
    stockTypeLabel: string,
    fromLabel: string,
    toLabel: string,
  ) => {
    const statusColor = m.status === 'COMPLETED' ? '#16a34a'
      : m.status === 'PARTIALLY_APPROVED' ? '#ea580c'
        : '#dc2626';
    const statusLabel = m.status === 'COMPLETED' ? 'Completed'
      : m.status === 'PARTIALLY_APPROVED' ? 'Partially Approved'
        : 'Rejected';
    const movedQty = m.approved_quantity ?? 0;
    const rejectedQty = m.rejected_quantity ?? 0;
    const requestedQty = m.requested_quantity ?? m.quantity ?? 0;
    const movementTypeLabel = MOVEMENT_TYPE_LABELS[m.movement_type] || m.movement_type;
    const stockTypeDisplay = stockTypeLabel === 'REJECTION' ? 'From Rejection' : 'Stock In';
    const printDate = new Date().toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
    const movementDate = m.movement_date
      ? new Date(m.movement_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—';
    const createdDate = m.created_at
      ? new Date(m.created_at).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
      })
      : '—';

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>Stock Movement Slip - ${m.movement_number}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', 'Helvetica Neue', Arial, sans-serif; color: #1e293b; font-size: 12px; line-height: 1.5; background: #fff; }
  .page { max-width: 760px; margin: 0 auto; padding: 20px; }

  /* Header */
  .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 3px solid #1e3a8a; padding-bottom: 14px; margin-bottom: 20px; }
  .header-left { display: flex; align-items: center; gap: 14px; }
  .header-left img { width: 56px; height: 56px; object-fit: contain; }
  .org-name { font-size: 20px; font-weight: 800; color: #1e3a8a; letter-spacing: -0.3px; }
  .org-sub { font-size: 11px; color: #64748b; font-weight: 500; margin-top: 2px; }
  .slip-title { font-size: 16px; font-weight: 700; color: #334155; text-align: right; }
  .slip-subtitle { font-size: 11px; color: #94a3b8; text-align: right; margin-top: 2px; }

  /* Status Banner */
  .status-banner { display: flex; align-items: center; justify-content: space-between; padding: 12px 18px; border-radius: 8px; margin-bottom: 18px; border: 2px solid ${statusColor}30; background: ${statusColor}08; }
  .status-label { font-size: 15px; font-weight: 800; color: ${statusColor}; display: flex; align-items: center; gap: 8px; }
  .status-dot { width: 10px; height: 10px; border-radius: 50%; background: ${statusColor}; }
  .movement-id { font-size: 13px; font-weight: 700; color: #475569; font-family: 'Courier New', monospace; background: #f1f5f9; padding: 4px 10px; border-radius: 4px; border: 1px solid #e2e8f0; }

  /* Details Table */
  .details-section { margin-bottom: 18px; }
  .section-header { font-size: 11px; font-weight: 700; color: #475569; text-transform: uppercase; letter-spacing: 0.8px; padding: 8px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-bottom: none; border-radius: 6px 6px 0 0; }
  .details-grid { border: 1px solid #e2e8f0; border-radius: 0 0 6px 6px; overflow: hidden; }
  .detail-row { display: flex; border-bottom: 1px solid #f1f5f9; }
  .detail-row:last-child { border-bottom: none; }
  .detail-label { width: 170px; padding: 8px 12px; font-size: 11px; font-weight: 600; color: #64748b; background: #fafbfc; border-right: 1px solid #f1f5f9; flex-shrink: 0; }
  .detail-value { flex: 1; padding: 8px 12px; font-size: 12px; font-weight: 600; color: #1e293b; }

  /* Quantities */
  .qty-section { display: flex; gap: 12px; margin-bottom: 18px; }
  .qty-card { flex: 1; text-align: center; padding: 14px 10px; border-radius: 8px; border: 1px solid; }
  .qty-card.moved { background: #f0fdf4; border-color: #bbf7d0; }
  .qty-card.rejected { background: #fef2f2; border-color: #fecaca; }
  .qty-card.requested { background: #eff6ff; border-color: #bfdbfe; }
  .qty-label { font-size: 10px; font-weight: 700; color: #6b7280; letter-spacing: 0.5px; margin-bottom: 4px; }
  .qty-value { font-size: 22px; font-weight: 800; letter-spacing: -0.5px; }
  .qty-card.moved .qty-value { color: #16a34a; }
  .qty-card.rejected .qty-value { color: #dc2626; }
  .qty-card.requested .qty-value { color: #2563eb; }

  /* Notes */
  .note-box { padding: 10px 14px; border-radius: 6px; margin-bottom: 12px; border: 1px solid; }
  .note-box.operator { background: #f0f9ff; border-color: #bae6fd; }
  .note-box.supervisor { background: #f5f3ff; border-color: #c4b5fd; }
  .note-label { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
  .note-box.operator .note-label { color: #0369a1; }
  .note-box.supervisor .note-label { color: #6d28d9; }
  .note-text { font-size: 12px; color: #334155; line-height: 1.5; }

  /* Footer */
  .footer { margin-top: 30px; padding-top: 16px; border-top: 2px solid #e2e8f0; }
  .sig-section { display: flex; justify-content: space-between; margin-bottom: 30px; }
  .sig-block { width: 45%; }
  .sig-line { border-bottom: 1px solid #94a3b8; margin-bottom: 6px; height: 40px; }
  .sig-label { font-size: 11px; color: #64748b; font-weight: 600; }
  .footer-meta { display: flex; justify-content: space-between; align-items: center; font-size: 10px; color: #94a3b8; }
  .system-gen { font-style: italic; }

  /* Badge-like elements */
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 700; }
  .badge-green { background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; }
  .badge-red { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
  .badge-blue { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
  .badge-orange { background: #fff7ed; color: #c2410c; border: 1px solid #fed7aa; }

  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .page { padding: 0; }
    .no-print { display: none !important; }
  }
</style>
</head><body>
<div class="page">

  <!-- HEADER -->
  <div class="header">
    <div class="header-left">
      <img src="/logo.png" alt="Logo" onerror="this.style.display='none'" />
      <div>
        <div class="org-name">Autocrat Engineers</div>
        <div class="org-sub">Warehouse Management System</div>
      </div>
    </div>
    <div>
      <div class="slip-title">Stock Movement Action Slip</div>
      <div class="slip-subtitle">Printed: ${printDate}</div>
    </div>
  </div>

  <!-- STATUS BANNER -->
  <div class="status-banner">
    <div class="status-label">
      <div class="status-dot"></div>
      ${statusLabel}
    </div>
    <div class="movement-id">${m.movement_number}</div>
  </div>

  <!-- MOVEMENT DETAILS -->
  <div class="details-section">
    <div class="section-header">Movement Details</div>
    <div class="details-grid">
      <div class="detail-row">
        <div class="detail-label">Movement ID</div>
        <div class="detail-value" style="font-family: 'Courier New', monospace;">${m.movement_number}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Movement Date</div>
        <div class="detail-value">${movementDate}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Created At</div>
        <div class="detail-value">${createdDate}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Movement Type</div>
        <div class="detail-value"><span class="badge ${stockTypeLabel === 'STOCK_IN' ? 'badge-green' : 'badge-red'}">${movementTypeLabel}</span></div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Stock Type</div>
        <div class="detail-value"><span class="badge ${stockTypeLabel === 'STOCK_IN' ? 'badge-blue' : 'badge-orange'}">${stockTypeDisplay}</span></div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Final Status</div>
        <div class="detail-value" style="font-weight: 800; color: ${statusColor};">${statusLabel}</div>
      </div>
    </div>
  </div>

  <!-- ITEM DETAILS -->
  <div class="details-section">
    <div class="section-header">Item Details</div>
    <div class="details-grid">
      <div class="detail-row">
        <div class="detail-label">MSN</div>
        <div class="detail-value">${m.master_serial_no || '—'}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Part Number</div>
        <div class="detail-value" style="font-weight: 700;">${m.part_number || '—'}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Description</div>
        <div class="detail-value">${m.item_name || '—'}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Item Code</div>
        <div class="detail-value" style="font-family: 'Courier New', monospace;">${m.item_code || '—'}</div>
      </div>
    </div>
  </div>

  <!-- ROUTE & REFERENCE -->
  <div class="details-section">
    <div class="section-header">Route & Reference</div>
    <div class="details-grid">
      <div class="detail-row">
        <div class="detail-label">From Warehouse</div>
        <div class="detail-value">${fromLabel}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">To Warehouse</div>
        <div class="detail-value">${toLabel}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Reference Type</div>
        <div class="detail-value">${m.reference_document_type?.replace(/_/g, ' ') || '—'}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Reference ID</div>
        <div class="detail-value">${m.reference_document_number || '—'}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Reason Code</div>
        <div class="detail-value"><span class="badge" style="background:#f1f5f9;color:#334155;border:1px solid #e2e8f0;font-family:monospace;">${m.reason_code?.replace(/_/g, ' ') || '—'}</span></div>
      </div>
    </div>
  </div>

  <!-- QUANTITIES -->
  <div class="qty-section">
    <div class="qty-card requested">
      <div class="qty-label">REQUESTED</div>
      <div class="qty-value">${requestedQty.toLocaleString()}</div>
    </div>
    <div class="qty-card moved">
      <div class="qty-label">MOVED / APPROVED</div>
      <div class="qty-value">${movedQty.toLocaleString()}</div>
    </div>
    <div class="qty-card rejected">
      <div class="qty-label">REJECTED</div>
      <div class="qty-value">${rejectedQty.toLocaleString()}</div>
    </div>
  </div>

  <!-- PERSONNEL -->
  <div class="details-section">
    <div class="section-header">Personnel</div>
    <div class="details-grid">
      <div class="detail-row">
        <div class="detail-label">Requested By</div>
        <div class="detail-value">${m.requested_by || 'Operator'}</div>
      </div>
      <div class="detail-row">
        <div class="detail-label">Action Taken By</div>
        <div class="detail-value">Supervisor / Manager</div>
      </div>
    </div>
  </div>

  <!-- NOTES -->
  ${m.reason_description ? `
  <div class="note-box operator">
    <div class="note-label">Operator Note</div>
    <div class="note-text">${m.reason_description}</div>
  </div>` : ''}

  ${m.supervisor_note ? `
  <div class="note-box supervisor">
    <div class="note-label">Supervisor Note</div>
    <div class="note-text">${m.supervisor_note}</div>
  </div>` : ''}

  <!-- FOOTER -->
  <div class="footer">
    <div class="sig-section">
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-label">Authorized Signature (Supervisor / Manager)</div>
      </div>
      <div class="sig-block">
        <div class="sig-line"></div>
        <div class="sig-label">Received By</div>
      </div>
    </div>
    <div class="footer-meta">
      <span class="system-gen">System Generated Slip — Autocrat Engineers WMS</span>
      <span>Printed: ${printDate}</span>
    </div>
  </div>

</div>

<script>
  window.onload = function() { window.print(); };
<\/script>
</body></html>`;

    const printWindow = window.open('', '_blank', 'width=850,height=1100');
    if (printWindow) {
      printWindow.document.write(html);
      printWindow.document.close();
    }
  };


  const getTypeBadge = (type: string) => {
    const isReverse = REVERSE_MOVEMENT_TYPES.includes(type);
    return (
      <Badge variant={isReverse ? 'warning' : 'info'} style={{
        fontSize: '10px', width: '100%', justifyContent: 'center',
        whiteSpace: 'nowrap', padding: '5px 4px', boxSizing: 'border-box',
        overflow: 'hidden', textOverflow: 'ellipsis', display: 'inline-flex',
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
      <div className="summary-cards-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '20px' }}>
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
      <div className="filter-bar" style={{
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

        {/* Date Range Filter */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '0px',
          height: '36px', borderRadius: '6px',
          border: `1px solid ${(filterDateFrom || filterDateTo) ? '#93c5fd' : 'var(--enterprise-gray-300)'}`,
          background: (filterDateFrom || filterDateTo) ? '#eff6ff' : 'white',
          transition: 'background 0.2s, border-color 0.2s',
          flexShrink: 0, overflow: 'hidden',
        }}>
          {/* From date */}
          <div
            style={{
              position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '0 12px', height: '100%', cursor: 'pointer',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = filterDateFrom ? '#dbeafe' : '#f3f4f6'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <CalendarDays size={14} style={{ color: filterDateFrom ? '#2563eb' : '#9ca3af', flexShrink: 0, pointerEvents: 'none' }} />
            <span style={{ fontSize: '13px', fontWeight: 500, color: filterDateFrom ? 'var(--enterprise-gray-700)' : 'var(--enterprise-gray-500)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
              {filterDateFrom ? filterDateFrom.split('-').reverse().join('-') : 'From'}
            </span>
            <input
              type="date" value={filterDateFrom}
              onChange={e => setFilterDateFrom(e.target.value)}
              title="From date"
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
            />
          </div>
          <div style={{ width: '1px', height: '18px', background: '#d1d5db', flexShrink: 0 }} />
          {/* To date */}
          <div
            style={{
              position: 'relative', display: 'inline-flex', alignItems: 'center', gap: '5px',
              padding: '0 12px', height: '100%', cursor: 'pointer',
              transition: 'background 0.15s ease',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = filterDateTo ? '#dbeafe' : '#f3f4f6'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            <CalendarDays size={14} style={{ color: filterDateTo ? '#2563eb' : '#9ca3af', flexShrink: 0, pointerEvents: 'none' }} />
            <span style={{ fontSize: '13px', fontWeight: 500, color: filterDateTo ? 'var(--enterprise-gray-700)' : 'var(--enterprise-gray-500)', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
              {filterDateTo ? filterDateTo.split('-').reverse().join('-') : 'To'}
            </span>
            <input
              type="date" value={filterDateTo}
              onChange={e => setFilterDateTo(e.target.value)}
              title="To date"
              style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer', width: '100%', height: '100%' }}
            />
          </div>
          {(filterDateFrom || filterDateTo) && (
            <button
              onClick={() => { setFilterDateFrom(''); setFilterDateTo(''); }}
              style={{
                background: 'none', border: 'none', cursor: 'pointer', padding: '6px 10px',
                display: 'flex', alignItems: 'center', borderRadius: '0', flexShrink: 0,
                height: '100%', transition: 'background 0.15s ease',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = '#fee2e2'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
              title="Clear date filter"
            >
              <X size={14} style={{ color: '#dc2626' }} />
            </button>
          )}
        </div>

        {/* Right actions */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
          {(searchTerm || filterType !== 'ALL' || filterStatus !== 'ALL' || filterStockType !== 'ALL' || filterDateFrom || filterDateTo) && (
            <button onClick={() => { setSearchTerm(''); setFilterType('ALL'); setFilterStatus('ALL'); setFilterStockType('ALL'); setFilterDateFrom(''); setFilterDateTo(''); }} style={{
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
      ) : movements.length === 0 ? (
        <EmptyState
          icon={<ArrowRightLeft size={48} style={{ color: 'var(--enterprise-gray-400)' }} />}
          title="No Stock Movements"
          description={'Click "New Movement" to record your first stock movement.'}
          action={{ label: 'New Movement', onClick: openModal }}
        />
      ) : (
        <>
          <div style={{
            background: 'white', borderRadius: '8px', border: '1px solid var(--enterprise-gray-200)',
            overflow: 'hidden', boxShadow: 'var(--shadow-sm)',
          }}>
            <div className="table-responsive" style={{ overflowX: 'auto', maxHeight: 'calc(100vh - 380px)', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                <colgroup>
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '10%' }} />
                  <col style={{ width: '17%' }} />
                  <col style={{ width: '15%' }} />
                  <col style={{ width: '9%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '11%' }} />
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
                  {displayedMovements.length === 0 ? (
                    <tr>
                      <td colSpan={8} style={{ padding: '48px 16px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
                          <Search size={32} style={{ color: 'var(--enterprise-gray-300)' }} />
                          <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--enterprise-gray-500)' }}>No movements found</div>
                          <div style={{ fontSize: '12px', color: 'var(--enterprise-gray-400)' }}>
                            {(filterDateFrom || filterDateTo)
                              ? `No movements found for the selected date range${filterDateFrom ? ' from ' + new Date(filterDateFrom + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}${filterDateTo ? ' to ' + new Date(filterDateTo + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : ''}.`
                              : 'Try adjusting your search or filter criteria.'}
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    displayedMovements.map(m => (
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
                        <td style={{ ...tdStyle, fontSize: '13px' }}>
                          {m.movement_type === 'REJECTION_DISPOSAL' ? 'Production Warehouse'
                            : m.movement_type === 'PRODUCTION_RECEIPT' ? 'Production'
                              : m.movement_type === 'CUSTOMER_RETURN' ? 'Customer'
                                : (m.source_warehouse || '—')}
                        </td>
                        <td style={{ ...tdStyle, fontSize: '13px' }}>
                          {m.movement_type === 'REJECTION_DISPOSAL' ? 'Production Floor (Disposal)'
                            : m.movement_type === 'PRODUCTION_RECEIPT' ? 'Production Warehouse'
                              : m.movement_type === 'CUSTOMER_SALE' ? 'Customer'
                                : (m.destination_warehouse || '—')}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{getStatusBadge(m.status, m)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {/* Load More — inside the scrollable area so it only shows at the bottom */}
              {hasMore && (
                <div style={{
                  padding: '20px',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '10px',
                  borderTop: '1px solid var(--enterprise-gray-200)',
                  background: 'white',
                }}>
                  <p style={{
                    fontSize: '13px',
                    color: 'var(--enterprise-gray-500)',
                    margin: 0,
                  }}>
                    Showing {displayedMovements.length} of {filteredMovements.length} movements
                  </p>
                  <button className="load-more-btn" onClick={() => setDisplayCount(prev => prev + PAGE_SIZE)}>
                    Load More ({Math.min(PAGE_SIZE, filteredMovements.length - displayCount)} more)
                  </button>
                </div>
              )}

              {/* Show total when all loaded */}
              {!hasMore && displayedMovements.length > 0 && (
                <div style={{
                  padding: '14px',
                  textAlign: 'center',
                  borderTop: '1px solid var(--enterprise-gray-200)',
                }}>
                  <p style={{
                    fontSize: '13px',
                    color: 'var(--enterprise-gray-500)',
                    margin: 0,
                  }}>
                    Showing all {filteredMovements.length} movements
                  </p>
                </div>
              )}
            </div>
          </div>
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

              {/* Stock Across Warehouses — On-Hand (exclude PF which is not a real warehouse) */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
                {(Object.entries(LOCATIONS) as [LocationCode, typeof LOCATIONS[LocationCode]][]).filter(([code]) => code !== 'PF').map(([code, loc]) => {
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
                    {filteredReasonCodes.map(rc => <option key={rc.id} value={rc.reason_code}>{rc.reason_code.replace(/_/g, ' ')}</option>)}
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
                <textarea
                  ref={noteRef}
                  value={note}
                  onChange={e => {
                    const val = e.target.value;
                    // Protect the auto-message prefix — if user tries to delete it, restore it
                    if (notePrefix && !val.startsWith(notePrefix)) {
                      setNote(notePrefix);
                      setTimeout(() => {
                        if (noteRef.current) {
                          noteRef.current.setSelectionRange(notePrefix.length, notePrefix.length);
                        }
                      }, 0);
                    } else {
                      setNote(val);
                    }
                  }}
                  onKeyDown={e => {
                    // Prevent backspace/delete from modifying the prefix
                    if (notePrefix && noteRef.current) {
                      const cursorPos = noteRef.current.selectionStart || 0;
                      const selEnd = noteRef.current.selectionEnd || 0;
                      if (e.key === 'Backspace' && cursorPos <= notePrefix.length && cursorPos === selEnd) {
                        e.preventDefault();
                      }
                      if (e.key === 'Delete' && cursorPos < notePrefix.length) {
                        e.preventDefault();
                      }
                    }
                  }}
                  onClick={() => {
                    // If user clicks inside the prefix area, move cursor to after prefix
                    if (notePrefix && noteRef.current) {
                      const cursorPos = noteRef.current.selectionStart || 0;
                      if (cursorPos < notePrefix.length) {
                        setTimeout(() => {
                          noteRef.current?.setSelectionRange(notePrefix.length, notePrefix.length);
                        }, 0);
                      }
                    }
                  }}
                  rows={3}
                  placeholder={notePrefix ? 'Add your notes after the dash...' : 'Auto-filled from reason code. You may add additional notes.'}
                  style={{ ...mInputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                />
                {notePrefix && (
                  <div style={{ fontSize: '11px', color: '#6b7280', marginTop: '4px', fontStyle: 'italic' }}>
                    💡 Auto-message from reason code is locked. Add your notes after the dash.
                  </div>
                )}
              </div>
            </>
          )}

          {/* Rejection Disposal Info Banner */}
          {selectedRoute && OUT_ONLY_MOVEMENT_TYPES.includes(selectedRoute.movementType) && (
            <div style={{
              padding: '10px 14px', borderRadius: '8px', display: 'flex', alignItems: 'flex-start', gap: '10px',
              background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e',
            }}>
              <Info size={18} style={{ flexShrink: 0, marginTop: '1px' }} />
              <div style={{ fontSize: '12px', lineHeight: '1.5' }}>
                <strong>Rejection Disposal:</strong> On approval, stock will be deducted from PW and removed from the system.
                No stock will be added to Production Floor. Ledger entry will be OUT only.
              </div>
            </div>
          )}

          {/* Form Message — near submit button for visibility */}
          {formMessage && (
            <div style={{
              padding: '10px 14px', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '8px',
              backgroundColor: formMessage.type === 'success' ? '#ecfdf5' : '#fef2f2',
              border: `1px solid ${formMessage.type === 'success' ? '#a7f3d0' : '#fecaca'}`,
              color: formMessage.type === 'success' ? '#065f46' : '#991b1b', fontSize: '13px', fontWeight: 500,
              animation: 'fadeIn 0.3s ease',
            }}>
              {formMessage.type === 'success' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
              {formMessage.text}
              <button onClick={() => setFormMessage(null)} style={{
                marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer',
                color: formMessage.type === 'success' ? '#065f46' : '#991b1b', padding: '2px',
              }}><X size={14} /></button>
            </div>
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
      <Modal isOpen={showReviewModal} onClose={() => setShowReviewModal(false)} title="" maxWidth="780px">
        {reviewMovement && (() => {
          const statusCfg = STATUS_CONFIG[reviewMovement.status] || { color: '#6b7280', bg: '#f9fafb', label: reviewMovement.status };
          const isPending = reviewMovement.status === 'PENDING_APPROVAL';
          const stockType = getStockType(reviewMovement.movement_type);
          const fromLabel =
            reviewMovement.movement_type === 'REJECTION_DISPOSAL' ? 'Production Warehouse'
              : reviewMovement.movement_type === 'PRODUCTION_RECEIPT' ? 'Production'
                : reviewMovement.movement_type === 'CUSTOMER_RETURN' ? 'Customer'
                  : (reviewMovement.source_warehouse || 'External');
          const toLabel =
            reviewMovement.movement_type === 'REJECTION_DISPOSAL' ? 'Production Floor (Disposal)'
              : reviewMovement.movement_type === 'PRODUCTION_RECEIPT' ? 'Production Warehouse'
                : reviewMovement.movement_type === 'CUSTOMER_SALE' ? 'Customer'
                  : (reviewMovement.destination_warehouse || 'External');
          const routeLabel = `${fromLabel} → ${toLabel}`;

          // Detail field renderer
          const DetailField = ({ label, value, span = 1 }: { label: string; value: React.ReactNode; span?: number }) => (
            <div style={{ gridColumn: span > 1 ? `span ${span}` : undefined }}>
              <div style={{
                fontSize: '10px', fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase',
                letterSpacing: '0.5px', marginBottom: '4px',
              }}>{label}</div>
              <div style={{
                fontSize: '13px', fontWeight: 600, color: '#1e293b', lineHeight: '1.4',
                wordBreak: 'break-word',
              }}>{value || '—'}</div>
            </div>
          );

          return (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0px' }}>

              {/* ── ROW 1: HEADER SECTION ── */}
              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '14px 20px', borderRadius: '12px',
                background: `linear-gradient(135deg, ${statusCfg.bg}, ${statusCfg.color}08)`,
                border: `1.5px solid ${statusCfg.color}25`,
                marginBottom: '16px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{
                    width: '10px', height: '10px', borderRadius: '50%', background: statusCfg.color,
                    boxShadow: `0 0 8px ${statusCfg.color}40`,
                  }} />
                  <span style={{
                    fontWeight: 800, fontSize: '15px', color: statusCfg.color,
                    letterSpacing: '-0.2px',
                  }}>
                    {statusCfg.label}
                  </span>
                </div>
                <span style={{
                  fontSize: '12px', fontWeight: 600, color: '#64748b',
                  fontFamily: 'monospace', background: '#f1f5f9',
                  padding: '4px 10px', borderRadius: '6px', border: '1px solid #e2e8f0',
                }}>
                  {reviewMovement.movement_number}
                </span>
              </div>

              {/* ── ROWS 2–7: MOVEMENT DETAILS CARD ── */}
              <div style={{
                borderRadius: '12px', border: '1px solid #e2e8f0',
                background: '#fff', overflow: 'hidden', marginBottom: '16px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
              }}>
                {/* Card Header */}
                <div style={{
                  padding: '10px 18px',
                  background: 'linear-gradient(135deg, #f8fafc, #f1f5f9)',
                  borderBottom: '1px solid #e2e8f0',
                  display: 'flex', alignItems: 'center', gap: '8px',
                }}>
                  <FileText size={14} style={{ color: '#475569' }} />
                  <span style={{
                    fontSize: '12px', fontWeight: 700, color: '#475569',
                    textTransform: 'uppercase', letterSpacing: '0.6px',
                  }}>Movement Details</span>
                </div>

                <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '16px' }}>

                  {/* Row 2: Item Details */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '12px',
                    padding: '12px 14px', borderRadius: '8px',
                    background: '#f8fafc', border: '1px solid #f1f5f9',
                  }}>
                    <DetailField label="MSN" value={reviewMovement.master_serial_no || '—'} />
                    <DetailField label="Part Number" value={reviewMovement.part_number || '—'} />
                    <DetailField label="Description" value={reviewMovement.item_name} />
                    <DetailField label="Item Code" value={reviewMovement.item_code} />
                  </div>

                  {/* Row 3: Movement Classification */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <DetailField
                      label="Movement Type"
                      value={
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '6px',
                          padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700,
                          background: stockType === 'STOCK_IN' ? '#ecfdf5' : '#fef2f2',
                          color: stockType === 'STOCK_IN' ? '#065f46' : '#991b1b',
                          border: `1px solid ${stockType === 'STOCK_IN' ? '#a7f3d0' : '#fecaca'}`,
                        }}>
                          {MOVEMENT_TYPE_LABELS[reviewMovement.movement_type] || reviewMovement.movement_type}
                        </span>
                      }
                    />
                    <DetailField
                      label="Stock Type"
                      value={
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '3px 10px', borderRadius: '6px', fontSize: '12px', fontWeight: 700,
                          background: stockType === 'STOCK_IN' ? '#eff6ff' : '#fff7ed',
                          color: stockType === 'STOCK_IN' ? '#1d4ed8' : '#c2410c',
                          border: `1px solid ${stockType === 'STOCK_IN' ? '#bfdbfe' : '#fed7aa'}`,
                        }}>
                          {stockType === 'REJECTION' ? '↩ From Rejection' : '📥 Stock In'}
                        </span>
                      }
                    />
                  </div>

                  {/* Row 4: Requested By */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <DetailField
                      label="Requested By"
                      value={
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                          <div style={{
                            width: '22px', height: '22px', borderRadius: '50%',
                            background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '10px', fontWeight: 700, color: '#fff',
                          }}>
                            {(reviewMovement.requested_by || 'O')[0].toUpperCase()}
                          </div>
                          <span style={{ fontSize: '12px', color: '#475569' }}>
                            {reviewMovement.requested_by ? reviewMovement.requested_by.split('@')[0] : 'Operator'}
                          </span>
                        </span>
                      }
                    />
                    <DetailField
                      label="Created"
                      value={reviewMovement.created_at ? new Date(reviewMovement.created_at).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', hour12: true,
                      }) : '—'}
                    />
                  </div>

                  {/* Row 5: Reference Information */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <DetailField
                      label="Reference Type"
                      value={reviewMovement.reference_document_type?.replace(/_/g, ' ') || '—'}
                    />
                    <DetailField
                      label="Reference ID"
                      value={reviewMovement.reference_document_number || '—'}
                    />
                  </div>

                  {/* Row 6: Reason Details */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                    <DetailField
                      label="Reason Code"
                      value={
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', gap: '4px',
                          padding: '2px 8px', borderRadius: '4px', fontSize: '12px', fontWeight: 700,
                          background: '#f1f5f9', color: '#334155', border: '1px solid #e2e8f0',
                          fontFamily: 'monospace',
                        }}>
                          {reviewReasonCode?.reason_code?.replace(/_/g, ' ') || reviewMovement.reason_code?.replace(/_/g, ' ') || '—'}
                        </span>
                      }
                    />
                    <DetailField
                      label="Description"
                      value={reviewReasonCode?.description || '—'}
                    />
                  </div>

                  {/* Row 7: Quantity & Route */}
                  <div style={{
                    display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px',
                    padding: '12px 14px', borderRadius: '8px',
                    background: 'linear-gradient(135deg, #fafafa, #f5f5f5)',
                    border: '1px solid #e5e7eb',
                  }}>
                    <DetailField
                      label="Quantity Requested"
                      value={
                        <span style={{
                          fontSize: '20px', fontWeight: 800, color: '#1e293b',
                          letterSpacing: '-0.5px',
                        }}>
                          {(reviewMovement.requested_quantity ?? reviewMovement.quantity ?? 0).toLocaleString()}
                        </span>
                      }
                    />
                    <DetailField
                      label="Movement Route"
                      value={
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                          <span style={{
                            padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                            background: '#e0e7ff', color: '#3730a3', border: '1px solid #c7d2fe',
                          }}>{fromLabel}</span>
                          <ArrowRight size={14} style={{ color: '#94a3b8', flexShrink: 0 }} />
                          <span style={{
                            padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                            background: '#dbeafe', color: '#1e40af', border: '1px solid #bfdbfe',
                          }}>{toLabel}</span>
                        </div>
                      }
                    />
                  </div>
                </div>
              </div>

              {/* ── ROW 8: OPERATOR NOTE ── */}
              {reviewMovement.reason_description && (
                <div style={{
                  padding: '12px 16px', borderRadius: '10px', marginBottom: '12px',
                  background: 'linear-gradient(135deg, #f0f9ff, #e0f2fe)',
                  border: '1px solid #bae6fd',
                  display: 'flex', alignItems: 'flex-start', gap: '10px',
                }}>
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0,
                    background: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <FileText size={14} style={{ color: '#fff' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#0369a1', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>
                      Operator Note
                    </div>
                    <div style={{ fontSize: '13px', color: '#0c4a6e', lineHeight: '1.5', fontWeight: 500 }}>
                      {reviewMovement.reason_description}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Moved/Rejected Quantities (for already-reviewed) ── */}
              {!isPending && (
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '10px', marginBottom: '12px' }}>
                  <div style={{
                    padding: '12px', borderRadius: '10px', textAlign: 'center',
                    background: 'linear-gradient(135deg, #f0fdf4, #dcfce7)',
                    border: '1px solid #bbf7d0',
                  }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#6b7280', letterSpacing: '0.5px' }}>MOVED</div>
                    <div style={{ fontSize: '22px', fontWeight: 800, color: '#16a34a', letterSpacing: '-0.5px' }}>{(reviewMovement.approved_quantity ?? 0).toLocaleString()}</div>
                  </div>
                  <div style={{
                    padding: '12px', borderRadius: '10px', textAlign: 'center',
                    background: 'linear-gradient(135deg, #fef2f2, #fee2e2)',
                    border: '1px solid #fecaca',
                  }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#6b7280', letterSpacing: '0.5px' }}>REJECTED</div>
                    <div style={{ fontSize: '22px', fontWeight: 800, color: '#dc2626', letterSpacing: '-0.5px' }}>{(reviewMovement.rejected_quantity ?? 0).toLocaleString()}</div>
                  </div>
                  <div style={{
                    padding: '12px', borderRadius: '10px', textAlign: 'center',
                    background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                    border: '1px solid #bfdbfe',
                  }}>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#6b7280', letterSpacing: '0.5px' }}>REQUESTED</div>
                    <div style={{ fontSize: '22px', fontWeight: 800, color: '#2563eb', letterSpacing: '-0.5px' }}>{(reviewMovement.requested_quantity ?? 0).toLocaleString()}</div>
                  </div>
                </div>
              )}

              {/* Supervisor Note (if already reviewed) */}
              {reviewMovement.supervisor_note && (
                <div style={{
                  padding: '12px 16px', borderRadius: '10px', marginBottom: '12px',
                  background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)',
                  border: '1px solid #c4b5fd',
                  display: 'flex', alignItems: 'flex-start', gap: '10px',
                }}>
                  <div style={{
                    width: '28px', height: '28px', borderRadius: '8px', flexShrink: 0,
                    background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Shield size={14} style={{ color: '#fff' }} />
                  </div>
                  <div>
                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#6d28d9', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '2px' }}>
                      Supervisor Note
                    </div>
                    <div style={{ fontSize: '13px', color: '#5b21b6', lineHeight: '1.5', fontWeight: 500 }}>
                      {reviewMovement.supervisor_note}
                    </div>
                  </div>
                </div>
              )}

              {/* ── ROW 9 & 10: SUPERVISOR ACTIONS — Only for PENDING + L2/L3 roles ── */}
              {isPending && canApprove && (
                <>
                  {/* ROW 9: Supervisor Note Input */}
                  <div style={{
                    padding: '16px', borderRadius: '10px', marginBottom: '4px',
                    background: '#fafafa', border: '1px solid #e5e7eb',
                  }}>
                    <label style={{
                      display: 'flex', alignItems: 'center', gap: '6px',
                      fontSize: '12px', fontWeight: 700, color: '#374151',
                      marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.3px',
                    }}>
                      <Shield size={14} style={{ color: '#6366f1' }} />
                      Supervisor Reason *
                    </label>
                    <textarea
                      value={supervisorNote}
                      onChange={e => setSupervisorNote(e.target.value)}
                      rows={2}
                      placeholder="Enter reason for your decision..."
                      style={{
                        ...mInputStyle, resize: 'vertical', fontFamily: 'inherit',
                        borderColor: supervisorNote.trim() ? '#a5b4fc' : '#d1d5db',
                        boxShadow: supervisorNote.trim() ? '0 0 0 3px rgba(99,102,241,0.08)' : 'none',
                        transition: 'all 0.2s ease',
                      }}
                    />

                    {/* Partial Approval Quantity — inline within supervisor section */}
                    {canPartialApprove(reviewMovement.movement_type) && (
                      <div style={{ marginTop: '12px' }}>
                        <label style={{
                          fontSize: '11px', fontWeight: 600, color: '#6b7280',
                          marginBottom: '6px', display: 'block',
                        }}>
                          Quantity to Move (for partial approval)
                        </label>
                        <input
                          type="number" min={1} max={(reviewMovement.requested_quantity ?? 1) - 1}
                          value={approvedQty || ''}
                          onChange={e => setApprovedQty(parseInt(e.target.value) || 0)}
                          style={{ ...mInputStyle, maxWidth: '200px' }}
                          placeholder={`Max: ${(reviewMovement.requested_quantity ?? 0) - 1}`}
                        />
                      </div>
                    )}
                  </div>

                  {/* ROW 10: Action Buttons */}
                  <div style={{
                    display: 'flex', gap: '10px', justifyContent: 'flex-end',
                    padding: '14px 0 4px', borderTop: '1px solid #e5e7eb',
                  }}>
                    {/* Reject */}
                    <button
                      onClick={() => handleApproval('REJECTED')}
                      disabled={reviewSubmitting || !supervisorNote.trim()}
                      style={{
                        padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px',
                        border: '1.5px solid #dc2626', background: 'linear-gradient(135deg, #fff5f5, #fef2f2)', color: '#dc2626',
                        cursor: !supervisorNote.trim() ? 'not-allowed' : 'pointer',
                        opacity: !supervisorNote.trim() ? 0.4 : 1,
                        display: 'flex', alignItems: 'center', gap: '6px',
                        transition: 'all 0.2s ease',
                        boxShadow: supervisorNote.trim() ? '0 1px 3px rgba(220,38,38,0.15)' : 'none',
                      }}
                    >
                      <XCircle size={15} /> Reject
                    </button>

                    {/* Partial — only for eligible types */}
                    {canPartialApprove(reviewMovement.movement_type) && (
                      <button
                        onClick={() => handleApproval('PARTIALLY_APPROVED')}
                        disabled={reviewSubmitting || !supervisorNote.trim() || approvedQty <= 0 || approvedQty >= (reviewMovement.requested_quantity ?? 0)}
                        style={{
                          padding: '10px 20px', borderRadius: '10px', fontWeight: 700, fontSize: '13px',
                          border: '1.5px solid #2563eb', background: 'linear-gradient(135deg, #f0f4ff, #eff6ff)', color: '#2563eb',
                          cursor: !supervisorNote.trim() ? 'not-allowed' : 'pointer',
                          opacity: !supervisorNote.trim() ? 0.4 : 1,
                          display: 'flex', alignItems: 'center', gap: '6px',
                          transition: 'all 0.2s ease',
                          boxShadow: supervisorNote.trim() ? '0 1px 3px rgba(37,99,235,0.15)' : 'none',
                        }}
                      >
                        <Shield size={15} /> Partial
                      </button>
                    )}

                    {/* Complete / Approve */}
                    <button
                      onClick={() => handleApproval('APPROVED')}
                      disabled={reviewSubmitting || !supervisorNote.trim()}
                      style={{
                        padding: '10px 24px', borderRadius: '10px', fontWeight: 700, fontSize: '13px',
                        border: 'none', background: supervisorNote.trim()
                          ? 'linear-gradient(135deg, #16a34a, #15803d)'
                          : '#d1d5db',
                        color: '#fff',
                        cursor: !supervisorNote.trim() ? 'not-allowed' : 'pointer',
                        opacity: !supervisorNote.trim() ? 0.7 : 1,
                        display: 'flex', alignItems: 'center', gap: '6px',
                        transition: 'all 0.2s ease',
                        boxShadow: supervisorNote.trim() ? '0 2px 8px rgba(22,163,74,0.3)' : 'none',
                      }}
                    >
                      <CheckCircle2 size={15} /> Complete
                    </button>
                  </div>
                </>
              )}

              {/* Close button for operators viewing PENDING movements (view-only) */}
              {isPending && isOperator && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '8px', borderTop: '1px solid #e5e7eb' }}>
                  <div style={{
                    flex: 1, display: 'flex', alignItems: 'center', gap: '6px',
                    fontSize: '12px', color: '#9ca3af', fontStyle: 'italic',
                  }}>
                    <Eye size={14} /> View-only — awaiting supervisor approval
                  </div>
                  <button
                    onClick={() => setShowReviewModal(false)}
                    style={{
                      padding: '10px 28px', borderRadius: '10px', fontWeight: 600, fontSize: '13px',
                      border: '1px solid #d1d5db', background: 'white', color: '#374151',
                      cursor: 'pointer', transition: 'all 0.2s ease',
                    }}
                  >
                    Close
                  </button>
                </div>
              )}

              {/* Close / Print button for non-PENDING */}
              {!isPending && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', paddingTop: '8px', borderTop: '1px solid #e5e7eb' }}>
                  {/* Print Slip Button — only for actioned statuses + L2/L3 only */}
                  {!isOperator && ['COMPLETED', 'PARTIALLY_APPROVED', 'REJECTED'].includes(reviewMovement.status) && (
                    <button
                      onClick={() => handlePrintSlip(reviewMovement, statusCfg, stockType, fromLabel, toLabel)}
                      style={{
                        padding: '10px 20px', borderRadius: '10px', fontWeight: 600, fontSize: '13px',
                        border: '1.5px solid #6366f1', background: 'linear-gradient(135deg, #f5f3ff, #ede9fe)', color: '#4f46e5',
                        cursor: 'pointer', transition: 'all 0.2s ease',
                        display: 'flex', alignItems: 'center', gap: '6px',
                        boxShadow: '0 1px 3px rgba(99,102,241,0.15)',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #ede9fe, #ddd6fe)'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg, #f5f3ff, #ede9fe)'; }}
                    >
                      <Printer size={15} /> Print Slip
                    </button>
                  )}
                  <button
                    onClick={() => setShowReviewModal(false)}
                    style={{
                      padding: '10px 28px', borderRadius: '10px', fontWeight: 600, fontSize: '13px',
                      border: '1px solid #d1d5db', background: 'white', color: '#374151',
                      cursor: 'pointer', transition: 'all 0.2s ease',
                    }}
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          );
        })()}
      </Modal>

      {/* ═══════════════ FLOATING TOAST NOTIFICATION ═══════════════ */}
      {toast && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 10000,
          minWidth: '360px', maxWidth: '440px',
          padding: '16px 20px', borderRadius: '14px',
          background: toast.type === 'success' ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)'
            : toast.type === 'error' ? 'linear-gradient(135deg, #fef2f2, #fee2e2)'
              : toast.type === 'warning' ? 'linear-gradient(135deg, #fffbeb, #fef3c7)'
                : 'linear-gradient(135deg, #eff6ff, #dbeafe)',
          border: `1.5px solid ${toast.type === 'success' ? '#86efac'
            : toast.type === 'error' ? '#fca5a5'
              : toast.type === 'warning' ? '#fcd34d'
                : '#93c5fd'
            }`,
          boxShadow: '0 10px 40px rgba(0,0,0,0.12), 0 4px 12px rgba(0,0,0,0.06)',
          display: 'flex', alignItems: 'flex-start', gap: '12px',
          animation: 'slideInDown 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          {/* Icon */}
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
            background: toast.type === 'success' ? 'linear-gradient(135deg, #16a34a, #15803d)'
              : toast.type === 'error' ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
                : toast.type === 'warning' ? 'linear-gradient(135deg, #f59e0b, #d97706)'
                  : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: `0 2px 8px ${toast.type === 'success' ? 'rgba(22,163,74,0.3)'
              : toast.type === 'error' ? 'rgba(220,38,38,0.3)'
                : toast.type === 'warning' ? 'rgba(245,158,11,0.3)'
                  : 'rgba(37,99,235,0.3)'
              }`,
          }}>
            {toast.type === 'success' && <CheckCircle2 size={18} style={{ color: '#fff' }} />}
            {toast.type === 'error' && <XCircle size={18} style={{ color: '#fff' }} />}
            {toast.type === 'warning' && <AlertTriangle size={18} style={{ color: '#fff' }} />}
            {toast.type === 'info' && <Info size={18} style={{ color: '#fff' }} />}
          </div>
          {/* Content */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontSize: '13px', fontWeight: 800,
              color: toast.type === 'success' ? '#14532d'
                : toast.type === 'error' ? '#7f1d1d'
                  : toast.type === 'warning' ? '#78350f'
                    : '#1e3a5f',
              marginBottom: '2px', letterSpacing: '-0.2px',
            }}>{toast.title}</div>
            <div style={{
              fontSize: '12px', fontWeight: 500, lineHeight: '1.5',
              color: toast.type === 'success' ? '#166534'
                : toast.type === 'error' ? '#991b1b'
                  : toast.type === 'warning' ? '#92400e'
                    : '#1e40af',
            }}>{toast.text}</div>
          </div>
          {/* Close */}
          <button onClick={() => { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(null); }} style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '4px',
            color: toast.type === 'success' ? '#16a34a'
              : toast.type === 'error' ? '#dc2626'
                : toast.type === 'warning' ? '#d97706'
                  : '#2563eb',
            borderRadius: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexShrink: 0,
          }}><X size={16} /></button>
        </div>
      )}

      {/* Toast animation keyframes */}
      <style>{`
        @keyframes slideInDown {
          from { opacity: 0; transform: translateY(-20px) scale(0.95); }
          to   { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes fadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
      `}</style>
    </div>
  );
}