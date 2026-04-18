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
  Package,
} from 'lucide-react';
import { Card, Button, Badge, Modal, LoadingSpinner, EmptyState, ModuleLoader } from './ui/EnterpriseUI';
import {
  SummaryCard, SummaryCardsGrid, SearchBox, FilterBar, ActionBar, ActionButton, RefreshButton,
  StatusFilter, AddButton, ExportCSVButton, DateRangeFilter, ClearFiltersButton, Pagination
} from './ui/SharedComponents';
import { getSupabaseClient } from '../utils/supabase/client';
import type { PalletImpact } from './packing-engine/packingEngineService';

// Base URL for all Supabase Edge Function calls.
// For local testing: set VITE_FUNCTIONS_URL=http://127.0.0.1:54321/functions/v1 in .env
// For production: leave unset — falls back to the hardcoded project URL.
const FUNCTIONS_BASE = import.meta.env.VITE_FUNCTIONS_URL || 'https://sugvmurszfcneaeyoagv.supabase.co/functions/v1';

// ============================================================================
// TYPES
// ============================================================================

type UserRole = 'L1' | 'L2' | 'L3' | null;

interface StockMovementProps {
  accessToken: string;
  userRole?: UserRole;
  userPerms?: Record<string, boolean>;
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
  requested_by_name: string | null;
  reason_code: string | null;
  reference_document_type: string | null;
  reference_document_number: string | null;
  box_breakdown: { boxes: number; perBox: number; total: number; adjBoxes?: number; adjQty?: number } | null;
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
  PW: { name: 'FG Warehouse', icon: Warehouse, color: '#6366f1' },
  IT: { name: 'In-Transit', icon: Truck, color: '#f59e0b' },
  SV: { name: 'S&V Warehouse', icon: MapPin, color: '#10b981' },
  US: { name: 'US Warehouse', icon: MapPin, color: '#3b82f6' },
  PF: { name: 'Production Floor', icon: ArrowDownCircle, color: '#dc2626' },
};

const VALID_ROUTES: MovementRoute[] = [
  // Stock In: Only Production → FG Warehouse (positive flow)
  { from: 'PRODUCTION', to: 'PW', movementType: 'PRODUCTION_RECEIPT', flow: 'FORWARD', label: 'Production → FG Warehouse' },
  // Negative flows: ALL kept as-is from original
  { from: 'CUSTOMER', to: 'SV', movementType: 'CUSTOMER_RETURN', flow: 'REVERSE', label: 'Customer → S&V' },
  { from: 'CUSTOMER', to: 'US', movementType: 'CUSTOMER_RETURN', flow: 'REVERSE', label: 'Customer → US' },
  { from: 'SV', to: 'IT', movementType: 'RETURN_TO_PRODUCTION_FLOW', flow: 'REVERSE', label: 'S&V → In-Transit' },
  { from: 'US', to: 'IT', movementType: 'RETURN_TO_PRODUCTION_FLOW', flow: 'REVERSE', label: 'US → In-Transit' },
  { from: 'IT', to: 'PW', movementType: 'RETURN_TO_PRODUCTION_FLOW', flow: 'REVERSE', label: 'In-Transit → PW' },
  { from: 'PW', to: 'PRODUCTION', movementType: 'RETURN_TO_PRODUCTION', flow: 'REVERSE', label: 'PW → Production' },
  { from: 'PW', to: 'PF', movementType: 'REJECTION_DISPOSAL', flow: 'REVERSE', label: 'PW → Rejection Warehouse' },
];

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  PRODUCTION_RECEIPT: 'Production Receipt',
  DISPATCH_TO_TRANSIT: 'Dispatch to Transit',
  TRANSFER_TO_WAREHOUSE: 'Transfer to Warehouse',
  CUSTOMER_SALE: 'Customer Sale',
  CUSTOMER_RETURN: 'Customer Return',
  RETURN_TO_PRODUCTION_FLOW: 'Return to Production Flow',
  RETURN_TO_PRODUCTION: 'Return to Production',
  REJECTION_DISPOSAL: 'Rejection Stock Out',
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


// Stock In: only Work Order + Inventory Adjustment
const STOCK_IN_REFERENCE_TYPES = [
  { value: 'WORK_ORDER', label: 'Work Order' },
  { value: 'INVENTORY_ADJUSTMENT', label: 'Inventory Adjustment' },
];

// Rejection: all original reference types
const REJECTION_REFERENCE_TYPES = [
  { value: 'DELIVERY_NOTE', label: 'Delivery Note' },
  { value: 'RETURN_NOTE', label: 'Return Note' },
  { value: 'WORK_ORDER', label: 'Work Order' },
  { value: 'TRANSFER_ORDER', label: 'Transfer Order' },
  { value: 'ADJUSTMENT_MEMO', label: 'Adjustment Memo' },
];

// Combined for display in review/print (all types)
const REFERENCE_TYPES = [
  ...STOCK_IN_REFERENCE_TYPES,
  ...REJECTION_REFERENCE_TYPES.filter(r => !STOCK_IN_REFERENCE_TYPES.some(s => s.value === r.value)),
];

const STATUS_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  DRAFT: { color: '#6b7280', bg: '#f9fafb', label: 'Draft' },
  PENDING_APPROVAL: { color: '#d97706', bg: '#fffbeb', label: 'Pending' },
  APPROVED: { color: '#16a34a', bg: '#f0fdf4', label: 'Completed' },  // stock moved on approval
  IN_PROGRESS: { color: '#2563eb', bg: '#eff6ff', label: 'In Progress' },
  PARTIALLY_APPROVED: { color: '#2563eb', bg: '#eff6ff', label: 'Partial' },
  REJECTED: { color: '#dc2626', bg: '#fef2f2', label: 'Rejected' },
  CANCELLED: { color: '#6b7280', bg: '#f9fafb', label: 'Cancelled' },
  COMPLETED: { color: '#16a34a', bg: '#f0fdf4', label: 'Completed' },
};

function getRoutesForWarehouse(warehouse: string, stockType: StockType): MovementRoute[] {
  if (stockType === 'STOCK_IN') {
    return VALID_ROUTES.filter(r => r.to === warehouse && r.flow === 'FORWARD');
  }
  // For rejection: show routes FROM or TO this warehouse (both directions relevant)
  if (warehouse === 'CUSTOMER') {
    return VALID_ROUTES.filter(r => r.from === 'CUSTOMER' && r.flow === 'REVERSE');
  }
  return VALID_ROUTES.filter(r => (r.from === warehouse || r.to === warehouse) && r.flow === 'REVERSE');
}

function getWarehousesForStockType(stockType: StockType): string[] {
  const whs = new Set<string>();
  VALID_ROUTES.forEach(r => {
    if (stockType === 'STOCK_IN' && r.flow === 'FORWARD') {
      if (r.to in LOCATIONS) whs.add(r.to);
    } else if (stockType === 'REJECTION' && r.flow === 'REVERSE') {
      // Show all endpoints involved in reverse flows
      if (r.from in LOCATIONS) whs.add(r.from);
      if (r.from === 'CUSTOMER') whs.add('CUSTOMER');
    }
  });
  return Array.from(whs);
}

/** Can this route be partially approved? Only normal forward (not PRODUCTION_RECEIPT) */
function canPartialApprove(movementType: string): boolean {
  return ['DISPATCH_TO_TRANSIT', 'TRANSFER_TO_WAREHOUSE'].includes(movementType);
}

/** Resolve warehouse label from warehouse_code using DB_CODE_MAP → LOCATIONS.
 *  Falls back to raw warehouse name or the fallback string. */
function resolveWarehouseLabel(warehouseCode: string | null, warehouseName: string | null, fallback = '—'): string {
  if (warehouseCode) {
    const locCode = DB_CODE_MAP[warehouseCode];
    if (locCode && LOCATIONS[locCode]) return LOCATIONS[locCode].name;
  }
  return warehouseName || fallback;
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
// MAIN COMPONENT
// ============================================================================

export function StockMovement({ accessToken, userRole, userPerms = {} }: StockMovementProps) {
  // RBAC helpers — granular permissions with role-based fallback
  const hasPerms = Object.keys(userPerms).length > 0;
  const canCreate = userRole === 'L3' || (hasPerms ? userPerms['stock-movements.create'] === true : true); // all roles can create by default
  const canApprove = userRole === 'L3' || (hasPerms ? userPerms['stock-movements.edit'] === true : userRole === 'L2'); // L2+ can approve
  const isOperator = !canApprove; // if you can't approve, you're effectively an operator
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

  // Production Receipt box-based entry
  const [boxCount, setBoxCount] = useState<number>(0);
  const [innerBoxQty, setInnerBoxQty] = useState<number>(0);
  const [loadingPackingSpec, setLoadingPackingSpec] = useState(false);
  const [packingSpecError, setPackingSpecError] = useState<string | null>(null);
  // Pallet intelligence state
  const [palletImpact, setPalletImpact] = useState<PalletImpact | null>(null);
  const [loadingPalletImpact, setLoadingPalletImpact] = useState(false);
  const [adjustmentAcknowledged, setAdjustmentAcknowledged] = useState(false);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const palletImpactTimer = useRef<any>(null);
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
  const [reviewBoxInfo, setReviewBoxInfo] = useState<{ boxes: number; perBox: number; total: number; adjQty?: number; adjBoxCount?: number; adjIncluded?: boolean } | null>(null);

  // Toast notification state
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; title: string; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((type: 'success' | 'error' | 'warning' | 'info', title: string, text: string, duration = 5000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, title, text });
    toastTimer.current = setTimeout(() => setToast(null), duration);
  }, []);

  // Current logged-in user name (for print slip Verified By auto-populate)
  const [currentUserName, setCurrentUserName] = useState<string>('');

  const searchRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 20;
  const [page, setPage] = useState(0);
  const [totalDbCount, setTotalDbCount] = useState(0);
  const realtimeDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);
  const itemSearchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search for server-side queries (300ms delay after last keystroke)
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Ref holds current filter values — enables stable useCallback while reading latest filters
  const filtersRef = useRef({ status: 'ALL', type: 'ALL', stockType: 'ALL', dateFrom: '', dateTo: '', search: '' });
  filtersRef.current = { status: filterStatus, type: filterType, stockType: filterStockType, dateFrom: filterDateFrom, dateTo: filterDateTo, search: debouncedSearch };

  // ============================================================================
  // FETCH MOVEMENTS FOR MAIN PAGE
  // ============================================================================

  /**
   * Fetch a page of movements with SERVER-SIDE filtering.
   * Filters are read from filtersRef (kept current on every render).
   * Query order: SELECT → WHERE (filters) → ORDER BY → LIMIT/OFFSET
   */
  const fetchMovements = useCallback(async (offset = 0) => {
    setLoading(true);
    try {
      const filters = filtersRef.current;
      const res = await fetch(`${FUNCTIONS_BASE}/sm_get-movements`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          offset,
          pageSize: PAGE_SIZE,
          filters: {
            status: filters.status,
            movementType: filters.type,
            stockType: filters.stockType,
            dateFrom: filters.dateFrom,
            dateTo: filters.dateTo,
            search: filters.search,
          },
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to fetch movements');
      setMovements(json.data || []);
      setTotalDbCount(json.totalCount ?? 0);
    } catch (err) { console.error('Error fetching movements:', err); }
    finally { setLoading(false); }
  }, [accessToken]);

  // Fetch summary counts separately (lightweight, no enrichment)
  const [summaryCounts, setSummaryCounts] = useState({ total: 0, pending: 0, completed: 0, rejected: 0 });
  const fetchSummaryCounts = useCallback(async () => {
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/sm_get-movement-counts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) return; // non-critical
      setSummaryCounts({
        total: json.total ?? 0,
        pending: json.pending ?? 0,
        completed: json.completed ?? 0,
        rejected: json.rejected ?? 0,
      });
    } catch { /* non-critical */ }
  }, [accessToken]);

  // Fetch data when page changes
  useEffect(() => { fetchMovements(page * PAGE_SIZE); }, [fetchMovements, page]);
  // Reset to page 0 and re-fetch when any filter changes
  useEffect(() => { setPage(0); fetchMovements(0); }, [filterStatus, filterType, filterStockType, filterDateFrom, filterDateTo, debouncedSearch, fetchMovements]);
  // Load summary counts on mount
  useEffect(() => { fetchSummaryCounts(); }, [fetchSummaryCounts]);

  // Real-time subscription: debounced auto-refresh on approval/status changes
  useEffect(() => {
    const channel = supabase
      .channel('stock-movements-realtime')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'inv_movement_headers' },
        () => {
          // Debounce: avoid rapid-fire refetches when multiple changes occur
          if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
          realtimeDebounce.current = setTimeout(() => {
            fetchMovements(0); setPage(0);
            fetchSummaryCounts();
          }, 1000);
        }
      )
      .subscribe();

    return () => {
      if (realtimeDebounce.current) clearTimeout(realtimeDebounce.current);
      supabase.removeChannel(channel);
    };
  }, [supabase, fetchMovements, fetchSummaryCounts]);

  // Fetch current logged-in user's full_name for print slip Verified By
  useEffect(() => {
    if (!accessToken) return;
    const fetchCurrentUser = async () => {
      try {
        const res = await fetch(`${FUNCTIONS_BASE}/get-user-profile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({}),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.fullName) setCurrentUserName(json.fullName);
        }
      } catch (err) { console.error('Error fetching current user name:', err); }
    };
    fetchCurrentUser();
  }, [accessToken]);

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
      const res = await fetch(`${FUNCTIONS_BASE}/sm_get-reason-codes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error('Failed to fetch reason codes');
      const json = await res.json();
      setReasonCodes(json.reasonCodes || []);
    } catch { setReasonCodes([]); }
  }, [accessToken]);

  useEffect(() => { fetchReasonCodes(); }, [fetchReasonCodes]);

  // Auto-default reason code for Stock In if reason codes load after stock type was set
  useEffect(() => {
    if (stockType === 'STOCK_IN' && !selectedCategory && reasonCodes.length > 0) {
      const prodRc = reasonCodes.find(r => r.reason_code.toUpperCase().includes('PROD'));
      if (prodRc) handleCategoryChange(prodRc.reason_code);
    }
  }, [reasonCodes, stockType, selectedCategory]);

  // ============================================================================
  // MODAL FORM LOGIC
  // ============================================================================

  const handleSearch = useCallback((query: string) => {
    setSearchQuery(query);
    if (itemSearchDebounce.current) clearTimeout(itemSearchDebounce.current);
    if (query.length < 2) { setSearchResults([]); setShowDropdown(false); setSearching(false); return; }
    setSearching(true); setShowDropdown(true);
    itemSearchDebounce.current = setTimeout(async () => {
      try {
        const res = await fetch(`${FUNCTIONS_BASE}/sm_search-items`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ query }),
        });
        if (!res.ok) throw new Error('Search failed');
        const json = await res.json();
        setSearchResults(json.items || []);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 300);
  }, [accessToken]);

  const fetchWarehouseStocks = useCallback(async (itemCode: string) => {
    setLoadingStocks(true);
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/sm_get-item-stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ itemCode }),
      });
      if (!res.ok) throw new Error('Stock fetch failed');
      const json = await res.json();
      setWarehouseStocks(json.stock || []);
    } catch { setWarehouseStocks([]); }
    finally { setLoadingStocks(false); }
  }, [accessToken]);

  // Fetch packing spec for an item (inner_box_quantity)
  const fetchPackingSpec = useCallback(async (itemCode: string) => {
    setLoadingPackingSpec(true);
    setPackingSpecError(null);
    setInnerBoxQty(0);
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/sm_get-movement-review-data`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ itemCode }),
      });
      if (!res.ok) throw new Error('Failed to fetch packing specification.');
      const json = await res.json();
      if (!json.found) {
        setPackingSpecError('No packing specification found for this item. Please add one in Packing Details first.');
        setInnerBoxQty(0);
      } else {
        setInnerBoxQty(json.innerBoxQty || 0);
        if (json.innerBoxQty <= 0) {
          setPackingSpecError('Inner box quantity is 0. Please update the packing specification.');
        }
      }
    } catch {
      setPackingSpecError('Failed to fetch packing specification.');
      setInnerBoxQty(0);
    } finally {
      setLoadingPackingSpec(false);
    }
  }, [accessToken]);

  // Auto-fetch packing spec when route is PRODUCTION_RECEIPT and item is selected
  useEffect(() => {
    if (selectedRoute?.movementType === 'PRODUCTION_RECEIPT' && selectedItem) {
      fetchPackingSpec(selectedItem.item_code);
    } else {
      // Reset box-based fields when switching away from production receipt
      setBoxCount(0);
      setInnerBoxQty(0);
      setPackingSpecError(null);
    }
  }, [selectedRoute, selectedItem, fetchPackingSpec]);

  const handleSelectItem = (item: ItemResult) => {
    setSelectedItem(item);
    setSearchQuery(item.part_number || item.item_code);
    setShowDropdown(false);
    fetchWarehouseStocks(item.item_code);

    // Apply user-requested defaults automatically
    setStockType('STOCK_IN');
    setSelectedWarehouse('PW');
    setReferenceType('WORK_ORDER');
    setReferenceId('AE/WO/D/');

    setQuantity(0); setNote(''); setFormMessage(null);
    setSelectedCategory('');
    setBoxCount(0); setInnerBoxQty(0); setPackingSpecError(null);
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
    setBoxCount(0); setInnerBoxQty(0); setPackingSpecError(null);
    setPalletImpact(null); setAdjustmentAcknowledged(false);
  };

  const openModal = () => { resetForm(); setShowModal(true); };
  const closeModal = () => { setShowModal(false); resetForm(); };

  // ============================================================================
  // SUBMIT REQUEST (PENDING — No Stock Movement) or IMMEDIATE for REJECTION_DISPOSAL
  // ============================================================================

  const handleSubmitRequest = async () => {
    // For PRODUCTION_RECEIPT, calculate quantity from boxes × inner qty
    // When pallet engine auto-includes adjustment box, use the adjusted total
    const isProductionReceipt = selectedRoute?.movementType === 'PRODUCTION_RECEIPT';
    const finalQty = isProductionReceipt
      ? (palletImpact?.adjustmentBoxIncluded ? palletImpact.adjustedTotalQty : (boxCount * innerBoxQty))
      : quantity;

    // ENFORCEMENT: Block if adjustment box is required but not acknowledged
    if (isProductionReceipt && palletImpact?.mustCreateAdjustmentFirst && !adjustmentAcknowledged) {
      setFormMessage({ type: 'error', text: `Cannot submit: You must acknowledge the Top-off Box requirement (${palletImpact.adjustmentBoxQty} PCS) to complete the current pallet before starting a new one.` });
      showToast('error', 'Pallet Completion Required', `Create the Top-off Box of ${palletImpact.adjustmentBoxQty} PCS first.`);
      return;
    }

    if (!selectedItem || !stockType || !selectedWarehouse || !selectedRoute || finalQty <= 0) {
      setFormMessage({ type: 'error', text: isProductionReceipt ? 'Please fill all required fields. Ensure box count and inner qty are valid.' : 'Please fill all required fields.' });
      showToast('error', 'Validation Error', isProductionReceipt ? 'Ensure box count and packing spec are valid.' : 'Please fill all required fields.'); return;
    }
    if (!selectedCategory) {
      setFormMessage({ type: 'error', text: 'Please select a reason category.' });
      showToast('error', 'Validation Error', 'Please select a reason category.'); return;
    }
    if (!note.trim()) {
      setFormMessage({ type: 'error', text: 'Note is required.' });
      showToast('error', 'Validation Error', 'Note is required.'); return;
    }
    if (!referenceType) {
      setFormMessage({ type: 'error', text: 'Reference Type is required.' });
      showToast('error', 'Validation Error', 'Please select a Reference Type.'); return;
    }
    const effectiveRefId = referenceType === 'WORK_ORDER'
      ? referenceId.replace(/^AE\/WO\/D\//, '').trim()
      : referenceType === 'INVENTORY_ADJUSTMENT'
        ? referenceId.replace(/^AE\/M\/D\//, '').trim()
        : referenceId.trim();
    if (!effectiveRefId) {
      setFormMessage({ type: 'error', text: 'Reference ID is required.' });
      showToast('error', 'Validation Error', 'Please enter a Reference ID.'); return;
    }

    setSubmitting(true); setFormMessage(null);
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/sm_submit-movement-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          itemCode: selectedItem.item_code,
          movementType: selectedRoute.movementType,
          fromLocation: selectedRoute.from,
          toLocation: selectedRoute.to,
          finalQty,
          boxCount: isProductionReceipt ? boxCount : undefined,
          innerBoxQty: isProductionReceipt ? innerBoxQty : undefined,
          stockType,
          reasonCode: selectedCategory || '',
          note: note.trim(),
          routeLabel: selectedRoute.label,
          referenceType,
          referenceDocNumber: referenceId,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === 'INSUFFICIENT_STOCK_AT_REQUEST') {
          setFormMessage({ type: 'error', text: json.error });
          showToast('warning', 'Insufficient Stock', json.error);
          return;
        }
        throw new Error(json.error || 'Failed to submit request.');
      }

      const movNum: string = json.movementNumber;
      setFormMessage({ type: 'success', text: `Request ${movNum} submitted for approval.` });
      showToast('success', 'Request Submitted', `Movement ${movNum} has been submitted for supervisor approval.`);
      fetchMovements(); fetchSummaryCounts();
      setTimeout(() => { closeModal(); }, 1500);
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
    setReviewBoxInfo(null);

    // Look up reason code from cached data by matching reason_code string
    if (m.reason_code) {
      const rc = reasonCodes.find(r => r.reason_code === m.reason_code);
      if (rc) {
        setReviewReasonCode(rc);
      } else {
        // Fallback: fetch from edge function by reason_code
        const res = await fetch(`${FUNCTIONS_BASE}/sm_get-reason-codes`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ reasonCode: m.reason_code }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json.reasonCode) setReviewReasonCode(json.reasonCode as any);
        }
      }
    }

    // For Production Receipts, fetch packing spec + ADJUSTMENT_REQUIRED pallets
    // to show CORRECT box breakdown (multi-pallet aware)
    if (m.movement_type === 'PRODUCTION_RECEIPT' && m.item_code) {
      try {
        const reviewRes = await fetch(`${FUNCTIONS_BASE}/sm_get-movement-review-data`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({ itemCode: m.item_code, reqQty: m.requested_quantity || 0 }),
        });
        const reviewJson = reviewRes.ok ? await reviewRes.json() : null;

        const spec = reviewJson?.found
          ? { inner_box_quantity: reviewJson.innerBoxQty, outer_box_quantity: reviewJson.outerBoxQty }
          : null;
        const adjPalletsCount = reviewJson?.adjustmentPalletCount || 0;

        // Box breakdown now computed server-side in get-movement-review-data (Issue 2)
        if (reviewJson?.boxBreakdown) {
          setReviewBoxInfo(reviewJson.boxBreakdown);
        }
      } catch {
        // Non-critical — box breakdown just won't show
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
    setReviewSubmitting(true);
    try {
      const res = await fetch(`${FUNCTIONS_BASE}/sm_approve-movement`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({
          movementId: reviewMovement.id,
          action,
          approvedQty: finalApproved,
          supervisorNote,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.code === 'INSUFFICIENT_STOCK') {
          showToast('error', 'Insufficient Stock', `Source warehouse has only ${json.available} units available but ${finalApproved} were requested. Please reduce the quantity or reject this movement.`, 8000);
          return;
        }
        throw new Error(json.error || 'Failed to process the approval action.');
      }

      setShowReviewModal(false);
      fetchMovements(); fetchSummaryCounts();

      const movNum = reviewMovement.movement_number;
      if (action === 'REJECTED') {
        showToast('error', 'Movement Rejected', `Movement ${movNum} has been rejected. No stock has been moved.`);
      } else if (action === 'PARTIALLY_APPROVED') {
        const pMsg = reviewMovement.movement_type === 'PRODUCTION_RECEIPT'
          ? ` Stock pending packing. Packing request created.`
          : ` ${approvedQty} units moved.`;
        showToast('info', 'Partially Approved', `Movement ${movNum} partially approved — ${approvedQty} units approved, ${(reviewMovement.requested_quantity ?? 0) - approvedQty} units rejected.${pMsg}`);
      } else {
        const extra = reviewMovement.movement_type === 'PRODUCTION_RECEIPT'
          ? ' Packing request created. Stock will transfer to FG Warehouse via packing.'
          : '';
        const stockMsg = reviewMovement.movement_type === 'PRODUCTION_RECEIPT'
          ? `${reviewMovement.requested_quantity ?? 0} units approved`
          : `${reviewMovement.requested_quantity ?? 0} units moved successfully`;
        showToast('success', 'Movement Completed', `Movement ${movNum} fully approved — ${stockMsg}.${extra}`);
      }
    } catch (err: any) {
      console.error('Approval error:', err);
      showToast('error', 'Approval Failed', err.message || 'Failed to process the approval action.');
    } finally { setReviewSubmitting(false); }
  };

  // ============================================================================
  // FILTER / SEARCH
  // ============================================================================

  // All filtering including COMPLETED / PARTIALLY_APPROVED is now server-side (Issue 7)
  const filteredMovements = movements;

  const displayedMovements = filteredMovements;
  const hasMore = movements.length < totalDbCount;

  // Summary counts from lightweight server query
  const totalMovements = summaryCounts.total;
  const pendingCount = summaryCounts.pending;
  const completedCount = summaryCounts.completed;
  const rejectedCount = summaryCounts.rejected;

  // All active reason codes (no reason_type filtering needed)
  const filteredReasonCodes = reasonCodes;

  // ============================================================================
  // CSV EXPORT
  // ============================================================================

  const handleExport = () => {
    import('xlsx').then(XLSX => {
      const headers = ['Movement #', 'Date', 'Type', 'Status', 'Part Number', 'MSN', 'Qty', 'From', 'To', 'Reason'];
      const rows = filteredMovements.map(m => ([
        m.movement_number, m.movement_date, MOVEMENT_TYPE_LABELS[m.movement_type] || m.movement_type,
        m.status, m.part_number || m.item_code || '', m.master_serial_no || '', m.quantity ?? '', m.source_warehouse || '—',
        m.destination_warehouse || '—', m.reason_description || '',
      ]));
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Stock Movements');
      XLSX.writeFile(wb, `stock_movements_${new Date().toISOString().split('T')[0]}.xlsx`);
    });
  };

  // ============================================================================
  // PRINT SLIP — Enterprise-Grade ERP Transaction Document
  // Pure HTML table layout for bulletproof cross-browser print rendering
  // ============================================================================

  const handlePrintSlip = (
    m: MovementRecord,
    _statusCfg: { color: string; bg: string; label: string },
    stockTypeLabel: string,
    fromLabel: string,
    toLabel: string,
  ) => {
    const statusLabel = m.status === 'COMPLETED' ? 'COMPLETED'
      : m.status === 'PARTIALLY_APPROVED' ? 'PARTIALLY APPROVED'
        : m.status === 'REJECTED' ? 'REJECTED'
          : m.status === 'PENDING_APPROVAL' ? 'PENDING' : m.status;
    const statusLetter = m.status === 'COMPLETED' ? 'C'
      : m.status === 'PARTIALLY_APPROVED' ? 'P'
        : m.status === 'REJECTED' ? 'R'
          : m.status === 'PENDING_APPROVAL' ? 'A' : 'A';
    const statusColor = m.status === 'COMPLETED' ? '#16a34a'
      : m.status === 'PARTIALLY_APPROVED' ? '#7c3aed'
        : m.status === 'REJECTED' ? '#dc2626'
          : '#2563eb';
    const movedQty = m.approved_quantity ?? 0;
    const requestedQty = m.requested_quantity ?? m.quantity ?? 0;
    const movementTypeLabel = MOVEMENT_TYPE_LABELS[m.movement_type] || m.movement_type;
    const stockTypeDisplay = stockTypeLabel === 'REJECTION' ? 'Rejection' : 'Stock In';

    // Parse box breakdown from notes field for Production Receipt movements
    // Notes format: "Production → FI Warehouse | Boxes: 5 × 100 PCS/box = 500 PCS | Stock Type: ..."
    // Parse box breakdown from notes field for Production Receipt movements
    // New format: "... | Boxes: 67 x 450 PCS/box + 1 Adj Box x 300 PCS = 30450 PCS | ..."
    // Old format: "... | Boxes: 68 × 450 PCS/box = 30450 PCS | ..."
    // Box breakdown now parsed server-side in get-movements (Issue 4)
    const boxBreakdown = m.box_breakdown || null;
    const printTimestamp = new Date().toLocaleString('en-IN', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true,
    });
    const docDate = m.movement_date
      ? new Date(m.movement_date + 'T00:00:00').toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
      : '—';
    const refTypeLabel = m.reference_document_type
      ? (REFERENCE_TYPES.find(r => r.value === m.reference_document_type)?.label || m.reference_document_type.replace(/_/g, ' '))
      : '—';
    const reasonLabel = m.reason_code?.replace(/_/g, ' ') || '—';

    const html = `<!DOCTYPE html>
<html><head>
<meta charset="UTF-8">
<title>SM-${m.movement_number} | Stock Movement Slip | Autocrat Engineers</title>
<style>
  /* ═══════════════════════════════════════════════════════════════
     ENTERPRISE PRINT DOCUMENT — A4 LANDSCAPE
     A4 Landscape = 297mm × 210mm
     Margins: 12mm left/right, 10mm top, 8mm bottom
     Printable area: 273mm × 192mm
     ═══════════════════════════════════════════════════════════════ */
  @page {
    size: A4 landscape;
    margin: 10mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%;
    margin: 0;
    padding: 0;
    font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
    color: #000;
    font-size: 10px;
    line-height: 1.35;
    background: #fff;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Page container — fills available printable area */
  .doc {
    width: 100%;
    margin: 0;
    padding: 0;
    position: relative;
    overflow: hidden;
  }

  /* AUTOCARAT ENGINEERS watermark */
  .watermark {
    position: fixed;
    top: 46%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 64px;
    font-weight: 900;
    color: rgba(0,0,0,0.06);
    letter-spacing: 14px;
    text-transform: uppercase;
    pointer-events: none;
    z-index: 0;
    white-space: nowrap;
    font-family: Arial, sans-serif;
  }

  /* Master table — controls entire document */
  table {
    border-collapse: collapse;
    page-break-inside: avoid;
    width: 100%;
  }
  .w100 { width: 100%; }
  .bdr { border: 1px solid #000; }
  .bdr-b { border-bottom: 1px solid #000; }
  .bdr-r { border-right: 1px solid #000; }
  .bdr-t { border-top: 1px solid #000; }
  .no-bdr { border: none; }

  /* Cell padding presets */
  .cp { padding: 5px 8px; }
  .cp-sm { padding: 3px 8px; }
  .cp-lg { padding: 8px 10px; }

  /* Typography */
  .fw800 { font-weight: 800; }
  .fw700 { font-weight: 700; }
  .fw600 { font-weight: 600; }
  .fw500 { font-weight: 500; }
  .fs8 { font-size: 8px; }
  .fs9 { font-size: 9px; }
  .fs10 { font-size: 10px; }
  .fs11 { font-size: 11px; }
  .fs12 { font-size: 12px; }
  .fs13 { font-size: 13px; }
  .fs15 { font-size: 15px; }
  .uc { text-transform: uppercase; }
  .mono { font-family: 'Courier New', Courier, monospace; }
  .tr { text-align: right; }
  .tc { text-align: center; }
  .tl { text-align: left; }
  .vt { vertical-align: top; }
  .vm { vertical-align: middle; }
  .ls1 { letter-spacing: 0.8px; }
  .ls2 { letter-spacing: 1.2px; }
  .nowrap { white-space: nowrap; }
  .uline { text-decoration: underline; }
  .italic { font-style: italic; }
  .c666 { color: #666; }
  .c333 { color: #333; }
  .c000 { color: #000; }

  /* Section header (black band) */
  .sec-hdr {
    background: #000;
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 1.5px;
    padding: 4px 8px;
  }
  /* Section sub-header (light grey) */
  .sec-sub {
    background: #f0f0f0;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    padding: 4px 8px;
    border-bottom: 1px solid #000;
  }

  /* Field label */
  .lbl {
    font-size: 9px;
    font-weight: 700;
    color: #000;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    padding: 4px 8px;
    vertical-align: top;
    white-space: nowrap;
  }
  /* Field value */
  .val {
    font-size: 10px;
    font-weight: 600;
    color: #000;
    padding: 4px 8px;
    vertical-align: top;
  }

  /* Dotted field line for handwriting */
  .field-line {
    border-bottom: 1px dotted #999;
    min-width: 120px;
    height: 15px;
    display: inline-block;
    vertical-align: bottom;
  }
  /* Signature box */
  .sig-box {
    height: 50px;
    border-bottom: 1px solid #000;
    margin-bottom: 3px;
  }
  .sig-caption {
    font-size: 8px;
    color: #555;
    text-align: center;
    font-weight: 600;
  }

  /* Spacing */
  .mb4 { margin-bottom: 4px; }
  .mb6 { margin-bottom: 6px; }
  .mb8 { margin-bottom: 8px; }
  .mt4 { margin-top: 4px; }
  .mt8 { margin-top: 8px; }

  /* Print-specific overrides */
  @media print {
    html, body {
      width: 100%;
      height: auto;
      margin: 0;
      padding: 0;
      overflow: visible;
    }
    .doc {
      width: 100%;
      margin: 0;
      padding: 0;
      page-break-after: avoid;
    }
    .no-print { display: none !important; }
    table { page-break-inside: avoid; }
    @page { size: A4 landscape; margin: 10mm; }
  }
</style>
</head>
<body>
<div class="doc">

  <!-- WATERMARK -->
  <div class="watermark">AUTOCARAT ENGINEERS</div>

  <!-- ╔══════════════════════════════════════════════════════════════╗
       ║  SECTION 1: DOCUMENT HEADER                                 ║
       ╚══════════════════════════════════════════════════════════════╝ -->
  <table class="w100 bdr" cellspacing="0" cellpadding="0">
    <tr>
      <!-- LEFT: Company Logo -->
      <td class="vm tc" style="width:14%; padding:12px 10px;">
        <img src="/a-logo.png" alt="AE" style="width:100px; height:auto; display:block; margin:0 auto;" onerror="this.style.display='none'" />
      </td>
      <!-- CENTER: Organization Details -->
      <td class="vt" style="padding:10px 14px;">
        <div class="fw800 uc c000" style="font-size:16px; margin-bottom:3px; letter-spacing:0.6px;">AUTOCRAT ENGINEERS</div>
        <div class="c000" style="font-size:9px; line-height:1.5;">
          21 &amp; 22, Phase-1, E.P.I.P, Whitefield, Bangalore - 560066, Karnataka, India<br/>
          <span class="fw700">Tel:</span> 4333 0100 / 4333 0102 &nbsp;&nbsp;
          <span class="fw700">Email:</span> purchasing@autocratengineers.in<br/>
          <span class="fw700">GSTIN:</span> 29ABLPK6831H1ZB &nbsp;&nbsp;
          <span class="fw700">PAN:</span> ABLPK6831H
        </div>
      </td>
      <!-- RIGHT: Status Letter -->
      <td class="vm tc" style="width:10%; padding:8px 6px; border-left:1px solid #000;">
        <div style="font-size:36px; font-weight:900; color:${statusColor}; line-height:1; letter-spacing:1px;">${statusLetter}</div>
        <div style="font-size:7px; font-weight:700; color:#555; text-transform:uppercase; letter-spacing:0.5px; margin-top:3px;">${statusLabel}</div>
      </td>
    </tr>
  </table>

  <!-- Document Title -->
  <table class="w100 bdr" cellspacing="0" cellpadding="0" style="border-top:none;">
    <tr>
      <td class="tc" style="padding:6px 10px;">
        <div class="fs15 fw800 uc uline c000" style="letter-spacing:2px; display:inline-block;">STOCK MOVEMENT</div>
      </td>
    </tr>
  </table>

  <!-- ╔══════════════════════════════════════════════════════════════╗
       ║  SECTION 1B: DOCUMENT CONTROL (Two-column layout)           ║
       ╚══════════════════════════════════════════════════════════════╝ -->
  <table class="w100 bdr" cellspacing="0" cellpadding="0" style="border-top:none;">
    <tr>
      <td class="lbl bdr-b bdr-r cp-sm" style="width:18%;">Movement Type</td>
      <td class="val bdr-b bdr-r cp-sm fw600" style="width:32%;">${movementTypeLabel}</td>
      <td class="lbl bdr-b bdr-r cp-sm" style="width:18%;">Document No.</td>
      <td class="val bdr-b cp-sm mono fw800" style="width:32%;">${m.movement_number}</td>
    </tr>
    <tr>
      <td class="lbl bdr-r cp-sm">Stock Category</td>
      <td class="val bdr-r cp-sm fw600">${stockTypeDisplay}</td>
      <td class="lbl bdr-r cp-sm">Document Date</td>
      <td class="val cp-sm fw600">${docDate}</td>
    </tr>
  </table>

  <!-- ╔══════════════════════════════════════════════════════════════╗
       ║  SECTION 2: TRANSACTION DETAILS (Single consolidated block) ║
       ╚══════════════════════════════════════════════════════════════╝ -->
  <table class="w100 bdr mt4" cellspacing="0" cellpadding="0">
    <tr><td colspan="4" class="sec-hdr">Transaction Details</td></tr>
    <tr>
      <td class="lbl bdr-b bdr-r cp-sm" style="width:18%;">From Location</td>
      <td class="val bdr-b bdr-r cp-sm fw700" style="width:32%;">${fromLabel}</td>
      <td class="lbl bdr-b bdr-r cp-sm" style="width:18%;">To Location</td>
      <td class="val bdr-b cp-sm fw700" style="width:32%;">${toLabel}</td>
    </tr>
    <tr>
      <td class="lbl bdr-b bdr-r cp-sm">Reference Type</td>
      <td class="val bdr-b bdr-r cp-sm">${refTypeLabel}</td>
      <td class="lbl bdr-b bdr-r cp-sm">Reference ID</td>
      <td class="val bdr-b cp-sm mono fw700">${m.reference_document_number || '—'}</td>
    </tr>
    <tr>
      <td class="lbl bdr-b bdr-r cp-sm">Reason / Purpose</td>
      <td class="val bdr-b bdr-r cp-sm mono">${reasonLabel}</td>
      <td class="lbl bdr-b bdr-r cp-sm">Requested By</td>
      <td class="val bdr-b cp-sm">${m.requested_by_name || 'Operator'}</td>
    </tr>
    <tr>
      <td colspan="4" class="cp-sm fs9 italic c333 tc bdr-b" style="padding:4px 8px; background:#fafafa;">
        This document serves as official proof of stock movement executed against the above reference.
      </td>
    </tr>
  </table>

  <!-- ╔══════════════════════════════════════════════════════════════╗
       ║  SECTION 3: ITEM SCHEDULE                                   ║
       ╚══════════════════════════════════════════════════════════════╝ -->
  <table class="w100 bdr mt4" cellspacing="0" cellpadding="0">
    <tr><td colspan="8" class="sec-hdr">Item Schedule</td></tr>
    <tr style="background:#f0f0f0;">
      <th class="fs8 fw800 uc ls1 bdr-b bdr-r cp-sm tc" style="width:5%;">Sl.</th>
      <th class="fs8 fw800 uc ls1 bdr-b bdr-r cp-sm tl" style="width:13%;">Item Code</th>
      <th class="fs8 fw800 uc ls1 bdr-b bdr-r cp-sm tl" style="width:13%;">Part Number</th>
      <th class="fs8 fw800 uc ls1 bdr-b bdr-r cp-sm tl" style="width:23%;">Description</th>
      <th class="fs8 fw800 uc ls1 bdr-b bdr-r cp-sm tc" style="width:7%;">UOM</th>
      <th class="fs8 fw800 uc ls1 bdr-b bdr-r cp-sm tr" style="width:11%;">Req. Qty</th>
      <th class="fs8 fw800 uc ls1 bdr-b bdr-r cp-sm tr" style="width:11%;">Appr. Qty</th>
      <th class="fs8 fw800 uc ls1 bdr-b cp-sm tl" style="width:17%;">Batch / MSN</th>
    </tr>
    <tr>
      <td class="bdr-b bdr-r cp-sm tc fs10">1</td>
      <td class="bdr-b bdr-r cp-sm mono fs10">${m.item_code || '—'}</td>
      <td class="bdr-b bdr-r cp-sm fw700 fs10">${m.part_number || '—'}</td>
      <td class="bdr-b bdr-r cp-sm fs10">${m.item_name || '—'}</td>
      <td class="bdr-b bdr-r cp-sm tc fs10">NOS</td>
      <td class="bdr-b bdr-r cp-sm tr mono fw700 fs10">${requestedQty.toLocaleString()}</td>
      <td class="bdr-b bdr-r cp-sm tr mono fw700 fs10">${movedQty.toLocaleString()}</td>
      <td class="bdr-b cp-sm mono fs9">${m.master_serial_no || '—'}</td>
    </tr>
    ${boxBreakdown ? `
    <!-- Box Breakdown Row (Production Receipt) -->
    <tr>
      <td colspan="8" class="bdr-b cp-sm" style="padding:6px 12px;">
        <span class="fs8 fw800 uc ls1" style="color:#000; margin-right:8px;">BOX BREAKDOWN:</span>
        ${boxBreakdown.adjBoxes && boxBreakdown.adjQty ? `
          <span class="mono fw700 fs10" style="color:#000;">${boxBreakdown.boxes} Inner Boxes x ${boxBreakdown.perBox} PCS/Box = ${(boxBreakdown.boxes * boxBreakdown.perBox).toLocaleString()} PCS</span>
          <span class="mono fw700 fs10" style="color:#000; margin-left:12px;">+</span>
          <span class="mono fw700 fs10" style="color:#000; margin-left:12px;">${boxBreakdown.adjBoxes} Top-off Box x ${boxBreakdown.adjQty} PCS = ${(boxBreakdown.adjBoxes * boxBreakdown.adjQty).toLocaleString()} PCS</span>
          <span class="mono fw800 fs10" style="color:#000; margin-left:16px;">TOTAL: ${boxBreakdown.total.toLocaleString()} PCS</span>
        ` : `
          <span class="mono fw700 fs10" style="color:#000;">${boxBreakdown.boxes} Boxes x ${boxBreakdown.perBox} PCS/Box = ${boxBreakdown.total.toLocaleString()} PCS</span>
        `}
      </td>
    </tr>
    ` : ''}
    <!-- Blank rows for manual additions -->
    <tr><td class="bdr-b bdr-r cp-sm tc">&nbsp;</td><td class="bdr-b bdr-r cp-sm"></td><td class="bdr-b bdr-r cp-sm"></td><td class="bdr-b bdr-r cp-sm"></td><td class="bdr-b bdr-r cp-sm"></td><td class="bdr-b bdr-r cp-sm"></td><td class="bdr-b bdr-r cp-sm"></td><td class="bdr-b cp-sm"></td></tr>
    <tr><td class="bdr-b bdr-r cp-sm tc">&nbsp;</td><td class="bdr-b bdr-r cp-sm"></td><td class="bdr-b bdr-r cp-sm"></td><td class="bdr-b bdr-r cp-sm"></td><td class="bdr-b bdr-r cp-sm"></td><td class="bdr-b bdr-r cp-sm"></td><td class="bdr-b bdr-r cp-sm"></td><td class="bdr-b cp-sm"></td></tr>
    <tr><td class="bdr-r cp-sm tc">&nbsp;</td><td class="bdr-r cp-sm"></td><td class="bdr-r cp-sm"></td><td class="bdr-r cp-sm"></td><td class="bdr-r cp-sm"></td><td class="bdr-r cp-sm"></td><td class="bdr-r cp-sm"></td><td class="cp-sm"></td></tr>
  </table>

  <!-- ╔══════════════════════════════════════════════════════════════╗
       ║  SECTION 4: SUMMARY + REMARKS (side by side)               ║
       ╚══════════════════════════════════════════════════════════════╝ -->
  <table class="w100 bdr mt4" cellspacing="0" cellpadding="0">
    <tr>
      <!-- LEFT: Supervisor Note -->
      <td class="vt bdr-r" style="width:60%;">
        <table class="w100" cellspacing="0" cellpadding="0" style="border:none;">
          <tr><td class="sec-sub">Supervisor Note</td></tr>
          <tr><td class="cp vt" style="font-size:10px; line-height:1.5;">
            ${m.supervisor_note || '&nbsp;'}
          </td></tr>
        </table>
      </td>
      <!-- RIGHT: Summary Totals -->
      <td class="vt" style="width:40%;">
        <table class="w100" cellspacing="0" cellpadding="0" style="border:none;">
          <tr><td class="sec-sub" colspan="2">Summary</td></tr>
          <tr><td class="lbl bdr-b bdr-r cp-sm" style="width:55%;">Total Line Items</td><td class="val bdr-b cp-sm tr mono fw800">1</td></tr>
          <tr><td class="lbl bdr-b bdr-r cp-sm">Total Requested Qty</td><td class="val bdr-b cp-sm tr mono fw800">${requestedQty.toLocaleString()}</td></tr>
          <tr><td class="lbl bdr-r cp-sm" style="background:#f0f0f0;">Total Approved Qty</td><td class="val cp-sm tr mono fw800 fs11" style="background:#f0f0f0;">${movedQty.toLocaleString()}</td></tr>
        </table>
      </td>
    </tr>
  </table>

  <!-- ╔══════════════════════════════════════════════════════════════╗
       ║  SECTION 6: FOOTER                                          ║
       ╚══════════════════════════════════════════════════════════════╝ -->
  <table class="w100 mt8" cellspacing="0" cellpadding="0" style="border-top:1.5px solid #000;">
    <tr>
      <td class="tc cp-sm fs9 fw700 c000 bdr-b" style="padding:5px 8px;">
        This is an official system-generated document and forms part of inventory audit records.
      </td>
    </tr>
    <tr>
      <td style="padding:3px 8px;">
        <table class="w100" cellspacing="0" cellpadding="0" style="border:none;">
          <tr>
            <td class="tl fs8 c666">Printed On: ${printTimestamp}</td>
            <td class="tc fs8 c666">Document Classification: ORIGINAL</td>
            <td class="tr fs8 c666">Page 1 of 1</td>
          </tr>
        </table>
      </td>
    </tr>
  </table>

</div>
<script>window.onload = function() { window.print(); };<\/script>
</body></html>`;

    const printWindow = window.open('', '_blank', 'width=1100,height=800');
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

  // ── FIRST-LOAD: full-page skeleton ──
  if (loading && movements.length === 0) {
    return <ModuleLoader moduleName="Stock Movements" icon={<ArrowRightLeft size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />;
  }

  return (
    <div>
      {/* ─── SUMMARY CARDS ─── */}
      <SummaryCardsGrid columns={4}>
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
      </SummaryCardsGrid>

      {/* ─── FILTER BAR ─── */}
      <FilterBar>
        <SearchBox
          value={searchTerm}
          onChange={setSearchTerm}
          placeholder="Search by movement #, part number, MSN, warehouse..."
        />

        {/* Status Filter */}
        <StatusFilter
          value={filterStatus}
          onChange={setFilterStatus}
          options={[
            { value: 'ALL', label: 'All Status' },
            { value: 'PENDING_APPROVAL', label: 'Pending' },
            { value: 'PARTIALLY_APPROVED', label: 'Partial' },
            { value: 'COMPLETED', label: 'Completed' },
            { value: 'REJECTED', label: 'Rejected' },
          ]}
        />

        {/* Stock Type Filter */}
        <StatusFilter
          value={filterStockType}
          onChange={setFilterStockType}
          options={[
            { value: 'ALL', label: 'All Stock Type' },
            { value: 'STOCK_IN', label: 'Stock In' },
            { value: 'REJECTION', label: 'Rejection' },
          ]}
        />

        {/* Date Range Filter */}
        <DateRangeFilter
          dateFrom={filterDateFrom}
          dateTo={filterDateTo}
          onDateFromChange={setFilterDateFrom}
          onDateToChange={setFilterDateTo}
        />

        {/* Right actions */}
        <ActionBar>
          {(filterType !== 'ALL' || filterStatus !== 'ALL' || filterStockType !== 'ALL' || filterDateFrom || filterDateTo) && (
            <ClearFiltersButton onClick={() => { setFilterType('ALL'); setFilterStatus('ALL'); setFilterStockType('ALL'); setFilterDateFrom(''); setFilterDateTo(''); }} />
          )}
          <ExportCSVButton onClick={handleExport} />
          {canCreate && <AddButton label="New Movement" onClick={openModal} />}
        </ActionBar>
      </FilterBar>

      {/* ─── MOVEMENT RECORDS TABLE ─── */}
      {loading && movements.length === 0 ? (
        <ModuleLoader moduleName="Stock Movements" icon={<ArrowRightLeft size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />
      ) : movements.length === 0 ? (
        <EmptyState
          icon={<ArrowRightLeft size={48} style={{ color: 'var(--enterprise-gray-400)' }} />}
          title="No Stock Movements"
          description={'Click "New Movement" to record your first stock movement.'}
          action={canCreate ? { label: 'New Movement', onClick: openModal } : undefined}
        />
      ) : (
        <>
          <div style={{
            background: 'white', borderRadius: '8px', border: '1px solid var(--enterprise-gray-200)',
            overflow: 'hidden', boxShadow: 'var(--shadow-sm)',
            opacity: loading ? 0.5 : 1, transition: 'opacity 0.2s', pointerEvents: loading ? 'none' : 'auto',
          }}>
            <div className="table-responsive" style={{ overflowX: 'auto' }}>
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
                <thead style={{ background: 'var(--enterprise-gray-50)' }}>
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
                          {m.movement_type === 'REJECTION_DISPOSAL' ? 'FG Warehouse'
                            : m.movement_type === 'PRODUCTION_RECEIPT' ? 'Production'
                              : m.movement_type === 'CUSTOMER_RETURN' ? 'Customer'
                                : resolveWarehouseLabel(m.source_warehouse_id, m.source_warehouse)}
                        </td>
                        <td style={{ ...tdStyle, fontSize: '13px' }}>
                          {m.movement_type === 'REJECTION_DISPOSAL' ? 'Rejection Warehouse'
                            : m.movement_type === 'PRODUCTION_RECEIPT' ? 'FG Warehouse'
                              : m.movement_type === 'CUSTOMER_SALE' ? 'Customer'
                                : resolveWarehouseLabel(m.destination_warehouse_id, m.destination_warehouse)}
                        </td>
                        <td style={{ ...tdStyle, textAlign: 'center' }}>{getStatusBadge(m.status, m)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>

              {filteredMovements.length > 0 && (
                <Pagination
                  page={page}
                  pageSize={PAGE_SIZE}
                  totalCount={totalDbCount}
                  onPageChange={setPage}
                />
              )}
            </div>
          </div>
        </>
      )}

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
          Total Records: {totalDbCount}
        </span>
      </div>

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
            </div>
            {showDropdown && searchResults.length > 0 && (
              <>
                <style>{`
                  @keyframes smDropdownSlideIn {
                    from { opacity: 0; transform: translateY(-6px); }
                    to { opacity: 1; transform: translateY(0); }
                  }
                `}</style>
                <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.08)', marginTop: '4px', animation: 'smDropdownSlideIn 0.35s cubic-bezier(0.4, 0, 0.2, 1)' }}>
                  {searchResults.map(item => (
                    <button key={item.id} onClick={() => handleSelectItem(item)} style={{
                      width: '100%', padding: '10px 14px', border: 'none', background: 'none', textAlign: 'left',
                      cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: '2px',
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
              </>
            )}
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
                  <select value={stockType} onChange={e => {
                    const newType = e.target.value as StockType;
                    setStockType(newType);
                    if (newType === 'STOCK_IN') {
                      // Auto-default: FG Warehouse + Production Receipt route + Prod Receive reason
                      setSelectedWarehouse('PW');
                      const routes = getRoutesForWarehouse('PW', 'STOCK_IN');
                      setAvailableRoutes(routes);
                      setSelectedRoute(routes.length >= 1 ? routes[0] : null);
                      // Auto-default reason code to Prod Receive
                      const prodRc = reasonCodes.find(r =>
                        r.reason_code.toUpperCase().includes('PROD')
                      );
                      if (prodRc) {
                        handleCategoryChange(prodRc.reason_code);
                      } else if (reasonCodes.length > 0) {
                        handleCategoryChange(reasonCodes[0].reason_code);
                      }
                    } else {
                      setSelectedWarehouse(''); setSelectedRoute(null); setAvailableRoutes([]);
                      setSelectedCategory(''); setNote(''); setNotePrefix('');
                    }
                  }} style={mSelectStyle}>
                    <option value="">Select stock type...</option>
                    <option value="STOCK_IN">Stock In (Production → FG)</option>
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
                  {stockType === 'STOCK_IN' ? (
                    <div style={{ padding: '0 12px', border: '1px solid #e5e7eb', borderRadius: '8px', fontSize: '13px', backgroundColor: '#f9fafb', color: '#111827', display: 'flex', alignItems: 'center', height: '42px', fontWeight: 500, userSelect: 'none' }}>
                      FG Warehouse (PW)
                    </div>
                  ) : (
                    <select value={selectedWarehouse} onChange={e => setSelectedWarehouse(e.target.value as LocationCode)} style={mSelectStyle}>
                      <option value="">Choose warehouse...</option>
                      {getWarehousesForStockType(stockType).map(code => (
                        <option key={code} value={code}>
                          {code === 'CUSTOMER' ? 'Customer' : `${LOCATIONS[code as LocationCode]?.name || code} (${code})`}
                        </option>
                      ))}
                    </select>
                  )}
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

              {/* Packing Spec Warning (between Production Receipt badge and Reference Type) */}
              {selectedRoute?.movementType === 'PRODUCTION_RECEIPT' && packingSpecError && !loadingPackingSpec && (
                <div style={{
                  padding: '10px 16px', borderRadius: '8px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  fontSize: 13, color: '#991b1b', display: 'flex', alignItems: 'center', gap: 8,
                }}>
                  <XCircle size={16} />
                  {packingSpecError}
                </div>
              )}

              {/* Production Receipt: Inner Qty + Total Qty calculation — placed between route badge and reference */}
              {selectedRoute?.movementType === 'PRODUCTION_RECEIPT' && (
                <div style={{
                  padding: '12px 16px', borderRadius: '8px',
                  background: 'linear-gradient(135deg, #eff6ff, #dbeafe)',
                  border: '1px solid #bfdbfe',
                }}>
                  {loadingPackingSpec ? (
                    <div style={{ fontSize: 13, color: '#6b7280', display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid #93c5fd', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      Loading packing specification...
                    </div>
                  ) : !packingSpecError ? (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                      <div>
                        <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>Inner Box Qty</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#1e40af' }}>{innerBoxQty} <span style={{ fontSize: 12, fontWeight: 500, color: '#6b7280' }}>PCS/box</span></div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>Boxes</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: '#374151' }}>{boxCount || 0}</div>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, color: '#6b7280', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px', marginBottom: 4 }}>Total Quantity</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: boxCount > 0 ? '#16a34a' : '#9ca3af' }}>
                          {boxCount > 0
                            ? palletImpact?.adjustmentBoxIncluded
                              ? `${palletImpact.adjustedTotalQty.toLocaleString()} PCS`
                              : `${(boxCount * innerBoxQty).toLocaleString()} PCS`
                            : '—'}
                        </div>
                        {boxCount > 0 && (
                          <div style={{ fontSize: 11, color: palletImpact?.adjustmentBoxIncluded ? '#b45309' : '#6b7280', marginTop: 2, fontWeight: palletImpact?.adjustmentBoxIncluded ? 600 : 400 }}>
                            {palletImpact?.adjustmentBoxIncluded
                              ? palletImpact.breakdownText
                              : `${boxCount} × ${innerBoxQty} = ${(boxCount * innerBoxQty).toLocaleString()} PCS`
                            }
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* Row 2: Reference Type + Reference ID (FIRST per requirement 6) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={mLabelStyle}>Reference Type *</label>
                  <select value={referenceType} onChange={e => {
                    setReferenceType(e.target.value);
                    if (e.target.value === 'WORK_ORDER') { setReferenceId('AE/WO/D/'); }
                    else if (e.target.value === 'INVENTORY_ADJUSTMENT') { setReferenceId('AE/M/D/'); }
                    else { setReferenceId(''); }
                  }} style={mSelectStyle}>
                    <option value="">Select type...</option>
                    {(stockType === 'STOCK_IN' ? STOCK_IN_REFERENCE_TYPES : REJECTION_REFERENCE_TYPES).map(rt => <option key={rt.value} value={rt.value}>{rt.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={mLabelStyle}>Reference ID *</label>
                  {referenceType === 'WORK_ORDER' ? (
                    <div style={{ position: 'relative' }}>
                      <span style={{
                        position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                        fontSize: '13px', fontWeight: 600, color: '#1e40af', pointerEvents: 'none', userSelect: 'none',
                      }}>AE/WO/D/</span>
                      <input type="text"
                        value={referenceId.startsWith('AE/WO/D/') ? referenceId.slice(8) : referenceId}
                        onChange={e => setReferenceId('AE/WO/D/' + e.target.value)}
                        placeholder="Enter ID..."
                        style={{ ...mInputStyle, paddingLeft: '88px' }}
                      />
                    </div>
                  ) : referenceType === 'INVENTORY_ADJUSTMENT' ? (
                    <div style={{ position: 'relative' }}>
                      <span style={{
                        position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)',
                        fontSize: '13px', fontWeight: 600, color: '#7c3aed', pointerEvents: 'none', userSelect: 'none',
                      }}>AE/M/D/</span>
                      <input type="text"
                        value={referenceId.startsWith('AE/M/D/') ? referenceId.slice(7) : referenceId}
                        onChange={e => setReferenceId('AE/M/D/' + e.target.value)}
                        placeholder="Enter ID..."
                        style={{ ...mInputStyle, paddingLeft: '72px' }}
                      />
                    </div>
                  ) : (
                    <input type="text" value={referenceId} onChange={e => setReferenceId(e.target.value)}
                      placeholder="Select reference type first..." style={mInputStyle} disabled={!referenceType} />
                  )}
                </div>
              </div>

              {/* Row 3: Reason Code + Number of Boxes/Quantity (SECOND per requirement 6) */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                <div>
                  <label style={mLabelStyle}>Reason Code *</label>
                  <select value={selectedCategory} onChange={e => handleCategoryChange(e.target.value)} style={mSelectStyle}>
                    <option value="">Select reason code...</option>
                    {filteredReasonCodes.map(rc => <option key={rc.id} value={rc.reason_code}>{rc.reason_code.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                {selectedRoute?.movementType === 'PRODUCTION_RECEIPT' ? (
                  /* BOX-BASED ENTRY FOR PRODUCTION RECEIPT */
                  <div>
                    <label style={mLabelStyle}>Number of Boxes *</label>
                    <input type="number" min={1} value={boxCount || ''}
                      onChange={e => {
                        const val = parseInt(e.target.value) || 0;
                        setBoxCount(val);
                        setQuantity(val * innerBoxQty);
                        setAdjustmentAcknowledged(false);
                        // Debounced pallet impact calculation
                        if (palletImpactTimer.current) clearTimeout(palletImpactTimer.current);
                        if (val > 0 && selectedItem) {
                          setLoadingPalletImpact(true);
                          palletImpactTimer.current = setTimeout(async () => {
                            try {
                              const res = await fetch(`${FUNCTIONS_BASE}/sm_calculate-pallet-impact`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
                                body: JSON.stringify({ itemCode: selectedItem.item_code, boxCount: val }),
                              });
                              if (!res.ok) throw new Error('Pallet impact calculation failed');
                              const impact = await res.json();
                              setPalletImpact(impact);
                            } catch (err: any) {
                              console.warn('[PalletImpact] Calculation failed:', err.message);
                              setPalletImpact(null);
                            } finally {
                              setLoadingPalletImpact(false);
                            }
                          }, 400);
                        } else {
                          setPalletImpact(null);
                          setLoadingPalletImpact(false);
                        }
                      }}
                      placeholder="Enter number of boxes"
                      style={mInputStyle}
                      disabled={loadingPackingSpec || innerBoxQty <= 0}
                    />
                  </div>
                ) : (
                  <div>
                    <label style={mLabelStyle}>Quantity ({selectedItem.uom}) *</label>
                    <input type="number" min={1} value={quantity || ''} onChange={e => setQuantity(parseInt(e.target.value) || 0)}
                      placeholder="Enter quantity" style={mInputStyle} />
                  </div>
                )}
              </div>

              {/* ═══════════════ PALLET INTELLIGENCE PANEL — ERP STANDARD ═══════════════ */}
              {selectedRoute?.movementType === 'PRODUCTION_RECEIPT' && boxCount > 0 && (
                <div style={{
                  borderRadius: 'var(--border-radius-lg, 12px)', overflow: 'hidden',
                  background: 'var(--card-background, #fff)',
                  border: '1px solid var(--border-color, #e5e7eb)',
                  boxShadow: 'var(--shadow-sm, 0 1px 2px rgba(0,0,0,0.05))',
                }}>
                  {/* ── HEADER ── */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: 'var(--enterprise-primary, #1e3a8a)',
                    borderBottom: '1px solid var(--border-color, #e5e7eb)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <Package size={15} style={{ color: '#fff' }} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', textTransform: 'uppercase', letterSpacing: '0.8px' }}>
                        Pallet Intelligence
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {loadingPalletImpact && (
                        <span style={{ display: 'inline-block', width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
                      )}
                      {palletImpact && !loadingPalletImpact && (
                        <span style={{
                          fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 4,
                          background: 'rgba(255,255,255,0.15)',
                          color: '#fff',
                          border: '1px solid rgba(255,255,255,0.3)',
                        }}>
                          {palletImpact.mustCreateAdjustmentFirst ? 'ACTION REQUIRED' : palletImpact.adjustmentBoxRequired ? 'TOP-OFF INCLUDED' : 'READY'}
                        </span>
                      )}
                    </div>
                  </div>

                  {palletImpact && !loadingPalletImpact && (
                    <div style={{ padding: '12px' }}>
                      {/* ── PALLET STATUS ── */}
                      {palletImpact.currentPallet && (
                        <div style={{ marginBottom: 10 }}>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--enterprise-primary, #1e3a8a)' }}>
                              {palletImpact.currentPallet.pallet_number}
                            </span>
                            <span style={{
                              fontSize: 11, fontWeight: 600, padding: '2px 10px', borderRadius: 4,
                              background: 'var(--enterprise-gray-100, #f3f4f6)',
                              color: 'var(--enterprise-gray-700, #374151)',
                              border: '1px solid var(--enterprise-gray-200, #e5e7eb)',
                            }}>
                              {palletImpact.currentPallet.state.replace(/_/g, ' ')}
                            </span>
                          </div>
                          {/* Progress Bar */}
                          <div style={{ marginBottom: 10 }}>
                            <div style={{ height: 8, borderRadius: 4, background: 'var(--enterprise-gray-200, #e5e7eb)', overflow: 'hidden' }}>
                              <div style={{
                                height: '100%', borderRadius: 4, transition: 'width 0.4s ease',
                                width: `${Math.min(100, (palletImpact.currentPallet.containers_filled / palletImpact.total_containers_per_pallet) * 100)}%`,
                                background: 'var(--enterprise-primary, #1e3a8a)',
                              }} />
                            </div>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: 'var(--enterprise-gray-500, #6b7280)', fontWeight: 500 }}>
                              <span>{palletImpact.currentPallet.containers_filled} of {palletImpact.total_containers_per_pallet} inner boxes filled</span>
                              <span style={{ fontWeight: 700 }}>{Math.round((palletImpact.currentPallet.containers_filled / palletImpact.total_containers_per_pallet) * 100)}%</span>
                            </div>
                          </div>
                          {/* Stat Row */}
                          <div style={{ display: 'grid', gridTemplateColumns: palletImpact.adjustment_qty_per_pallet > 0 ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: 6 }}>
                            <div style={{ background: 'var(--enterprise-gray-50, #f9fafb)', borderRadius: 8, padding: '10px', textAlign: 'center', border: '1px solid var(--enterprise-gray-200, #e5e7eb)' }}>
                              <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500, #6b7280)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>Current</div>
                              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--enterprise-primary, #1e3a8a)' }}>{palletImpact.currentPallet.current_qty.toLocaleString()}</div>
                            </div>
                            <div style={{ background: 'var(--enterprise-gray-50, #f9fafb)', borderRadius: 8, padding: '10px', textAlign: 'center', border: '1px solid var(--enterprise-gray-200, #e5e7eb)' }}>
                              <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500, #6b7280)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>Target</div>
                              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--enterprise-gray-700, #374151)' }}>{palletImpact.currentPallet.target_qty.toLocaleString()}</div>
                            </div>
                            <div style={{ background: 'var(--enterprise-gray-50, #f9fafb)', borderRadius: 8, padding: '10px', textAlign: 'center', border: '1px solid var(--enterprise-gray-200, #e5e7eb)' }}>
                              <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500, #6b7280)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>Still Needed</div>
                              <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--enterprise-primary, #1e3a8a)' }}>
                                {palletImpact.currentPallet.containers_needed} box{palletImpact.currentPallet.containers_needed !== 1 ? 'es' : ''}
                              </div>
                            </div>
                            {palletImpact.adjustment_qty_per_pallet > 0 && (
                              <div style={{ background: '#f5f3ff', borderRadius: 8, padding: '10px', textAlign: 'center', border: '1px solid #e9d5ff' }}>
                                <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500, #6b7280)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 3 }}>Top-off Box</div>
                                <div style={{ fontSize: 18, fontWeight: 800, color: '#7c3aed' }}>{palletImpact.adjustment_qty_per_pallet} PCS</div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* ── MOVEMENT BREAKDOWN ── */}
                      <div style={{
                        background: 'var(--enterprise-gray-50, #f9fafb)', borderRadius: 8, padding: '14px',
                        marginBottom: 10, border: '1px solid var(--enterprise-gray-200, #e5e7eb)',
                      }}>
                        <div style={{ fontSize: 11, color: 'var(--enterprise-gray-500, #6b7280)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 6, textAlign: 'center' }}>
                          This Movement
                        </div>
                        <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--enterprise-gray-900, #111827)', lineHeight: 1.5, textAlign: 'center' }}>
                          {palletImpact.breakdownText}
                        </div>
                        {palletImpact.adjustmentBoxIncluded && (
                          <div style={{
                            marginTop: 8, padding: '8px 12px', borderRadius: 6,
                            background: '#f5f3ff', border: '1px solid #e9d5ff',
                            fontSize: 12, fontWeight: 600, color: '#7c3aed',
                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                          }}>
                            <Info size={14} style={{ flexShrink: 0 }} />
                            {(palletImpact.totalAdjustmentBoxes || 1)} Box{(palletImpact.totalAdjustmentBoxes || 1) > 1 ? 'es' : ''} will be auto-converted to Top-off Box{(palletImpact.totalAdjustmentBoxes || 1) > 1 ? 'es' : ''} ({palletImpact.adjustmentBoxQty} PCS each)
                          </div>
                        )}

                        {/* Distribution */}
                        <div style={{ display: 'grid', gridTemplateColumns: palletImpact.boxesToNewPallet > 0 ? '1fr 1fr' : '1fr', gap: 8, marginTop: 10 }}>
                          <div style={{
                            background: '#fff', borderRadius: 6, padding: '12px 14px',
                            border: '1px solid var(--enterprise-gray-200, #e5e7eb)',
                            borderLeft: '4px solid var(--enterprise-primary, #1e3a8a)',
                            textAlign: 'center',
                          }}>
                            <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500, #6b7280)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>Current Pallet</div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--enterprise-primary, #1e3a8a)' }}>
                              {palletImpact.boxesToCurrentPallet} Box{palletImpact.boxesToCurrentPallet !== 1 ? 'es' : ''}
                              {palletImpact.adjustmentBoxIncluded && <span style={{ color: '#7c3aed' }}> + {palletImpact.totalAdjustmentBoxes || 1} Top-off</span>}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--enterprise-gray-500, #6b7280)', marginTop: 2, fontWeight: 500 }}>
                              {((palletImpact.boxesToCurrentPallet * palletImpact.inner_box_qty) + (palletImpact.adjustmentBoxIncluded ? palletImpact.adjustmentBoxQty : 0)).toLocaleString()} PCS total
                            </div>
                          </div>
                          {palletImpact.boxesToNewPallet > 0 && (
                            <div style={{
                              background: '#fff', borderRadius: 6, padding: '12px 14px',
                              border: '1px solid var(--enterprise-gray-200, #e5e7eb)',
                              borderLeft: '4px solid var(--enterprise-success, #16a34a)',
                              textAlign: 'center',
                            }}>
                              <div style={{ fontSize: 10, color: 'var(--enterprise-gray-500, #6b7280)', fontWeight: 600, textTransform: 'uppercase', marginBottom: 4 }}>New Pallet</div>
                              <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--enterprise-success, #16a34a)' }}>
                                {palletImpact.boxesToNewPallet} Box{palletImpact.boxesToNewPallet !== 1 ? 'es' : ''}
                              </div>
                              <div style={{ fontSize: 12, color: 'var(--enterprise-gray-500, #6b7280)', marginTop: 2, fontWeight: 500 }}>
                                {(palletImpact.boxesToNewPallet * palletImpact.inner_box_qty).toLocaleString()} PCS total
                              </div>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* ── WARNINGS ── */}
                      {palletImpact.warnings.map((w, i) => (
                        <div key={i} style={{
                          padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                          marginBottom: 8, lineHeight: 1.5,
                          background: 'var(--enterprise-warning-bg, #fffbeb)',
                          color: 'var(--enterprise-warning, #d97706)',
                          border: '1px solid #fde68a',
                          display: 'flex', alignItems: 'flex-start', gap: 8,
                        }}>
                          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 2 }} />
                          <span>{w}</span>
                        </div>
                      ))}

                      {/* ── ACKNOWLEDGMENT ── */}
                      {palletImpact.mustCreateAdjustmentFirst && (
                        <label style={{
                          display: 'flex', alignItems: 'flex-start', gap: 10, cursor: 'pointer',
                          padding: '12px 14px', borderRadius: 8,
                          background: adjustmentAcknowledged ? 'var(--enterprise-success-bg, #f0fdf4)' : 'var(--enterprise-gray-50, #f9fafb)',
                          border: `1.5px solid ${adjustmentAcknowledged ? 'var(--enterprise-success, #16a34a)' : 'var(--border-color, #e5e7eb)'}`,
                          transition: 'all 0.2s ease',
                        }}>
                          <div style={{
                            width: 20, height: 20, borderRadius: 4, flexShrink: 0, marginTop: 1,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            background: adjustmentAcknowledged ? 'var(--enterprise-success, #16a34a)' : '#fff',
                            transition: 'all 0.2s ease',
                            border: adjustmentAcknowledged ? '1px solid var(--enterprise-success, #16a34a)' : '1px solid var(--enterprise-gray-300, #d1d5db)',
                          }}>
                            {adjustmentAcknowledged && <CheckCircle2 size={13} style={{ color: '#fff' }} />}
                          </div>
                          <input type="checkbox" checked={adjustmentAcknowledged} onChange={e => setAdjustmentAcknowledged(e.target.checked)}
                            style={{ display: 'none' }} />
                          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--enterprise-gray-700, #374151)', lineHeight: 1.5 }}>
                            I confirm that <strong>{palletImpact.totalAdjustmentBoxes || 1} Top-off Box{(palletImpact.totalAdjustmentBoxes || 1) > 1 ? 'es' : ''}</strong> of <strong>{palletImpact.adjustmentBoxQty} PCS each</strong> will be
                            created during packing to complete{' '}
                            {(palletImpact.adjustmentBoxesForExistingPallets || 0) > 0
                              ? <strong>{palletImpact.adjustmentBoxesForExistingPallets} existing pallet{(palletImpact.adjustmentBoxesForExistingPallets || 0) > 1 ? 's' : ''}</strong>
                              : <strong>{palletImpact.currentPallet?.pallet_number || 'the current pallet'}</strong>
                            } before
                            starting a new pallet.
                          </span>
                        </label>
                      )}

                      {/* ── FOOTER ── */}
                      <div style={{
                        marginTop: 8, padding: '8px 12px', borderRadius: 6,
                        background: 'var(--enterprise-gray-50, #f9fafb)',
                        fontSize: 12, color: 'var(--enterprise-gray-500, #6b7280)', fontStyle: 'italic',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                        border: '1px solid var(--enterprise-gray-200, #e5e7eb)',
                      }}>
                        <Info size={13} style={{ flexShrink: 0 }} />
                        {palletImpact.palletSummary}
                      </div>
                    </div>
                  )}
                </div>
              )}

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
              disabled={submitting || !selectedRoute || (selectedRoute?.movementType === 'PRODUCTION_RECEIPT' ? (boxCount <= 0 || innerBoxQty <= 0) : quantity <= 0) || !selectedCategory || !note.trim() || !referenceType || !(referenceType === 'WORK_ORDER' ? referenceId.replace(/^AE\/WO\/D\//, '').trim() : referenceType === 'INVENTORY_ADJUSTMENT' ? referenceId.replace(/^AE\/M\/D\//, '').trim() : referenceId.trim())}
              icon={submitting ? <Loader2 size={16} style={{ animation: 'spin 1s linear infinite' }} /> : <Shield size={16} />}
            >
              {submitting ? 'Submitting...' : 'Submit Request'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ═══════════════ SUPERVISOR REVIEW MODAL ═══════════════ */}
      <Modal isOpen={showReviewModal} onClose={() => setShowReviewModal(false)} title="" maxWidth="720px">
        {reviewMovement && (() => {
          const statusCfg = STATUS_CONFIG[reviewMovement.status] || { color: '#6b7280', bg: '#f9fafb', label: reviewMovement.status };
          const isPending = reviewMovement.status === 'PENDING_APPROVAL';
          const stockType = getStockType(reviewMovement.movement_type);
          const fromLabel =
            reviewMovement.movement_type === 'REJECTION_DISPOSAL' ? 'FG Warehouse'
              : reviewMovement.movement_type === 'PRODUCTION_RECEIPT' ? 'Production'
                : reviewMovement.movement_type === 'CUSTOMER_RETURN' ? 'Customer'
                  : resolveWarehouseLabel(reviewMovement.source_warehouse_id, reviewMovement.source_warehouse, 'External');
          const toLabel =
            reviewMovement.movement_type === 'REJECTION_DISPOSAL' ? 'Rejection Warehouse'
              : reviewMovement.movement_type === 'PRODUCTION_RECEIPT' ? 'FG Warehouse'
                : reviewMovement.movement_type === 'CUSTOMER_SALE' ? 'Customer'
                  : resolveWarehouseLabel(reviewMovement.destination_warehouse_id, reviewMovement.destination_warehouse, 'External');
          const requestedQty = reviewMovement.requested_quantity ?? reviewMovement.quantity ?? 0;
          const movedQty = reviewMovement.approved_quantity ?? 0;
          const rejectedQty = reviewMovement.rejected_quantity ?? 0;

          /* ── Shared micro-component styles ── */
          const labelStyle: React.CSSProperties = {
            fontSize: '12px', fontWeight: 700, color: '#6b7a8d',
            textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '5px',
          };
          const valueStyle: React.CSSProperties = {
            fontSize: '15px', fontWeight: 600, color: '#1a2332',
            lineHeight: '1.45',
          };

          return (
            <div style={{ fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}>

              {/* ══════════ SECTION 1: IDENTITY HEADER ══════════ */}
              <div style={{
                margin: '-20px -24px 0 -24px',
                padding: '20px 24px 16px',
                background: 'linear-gradient(180deg, #f7f8fc 0%, #ffffff 100%)',
                borderBottom: '1px solid #e8ecf2',
              }}>
                {/* Top row: Movement ID + Status */}
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '12px' }}>
                  <div>
                    <div style={{
                      fontSize: '20px', fontWeight: 800, color: '#0e1726',
                      letterSpacing: '-0.4px', lineHeight: '1.2',
                      fontFamily: "'Inter', sans-serif",
                    }}>
                      {reviewMovement.movement_number}
                    </div>
                    <div style={{
                      fontSize: '16px', fontWeight: 600, color: '#475569',
                      marginTop: '4px', lineHeight: '1.3',
                    }}>
                      {reviewMovement.item_name || reviewMovement.item_code || '—'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px' }}>
                    <span style={{
                      fontSize: '13px', fontWeight: 700,
                      padding: '3px 12px', borderRadius: '100px',
                      color: statusCfg.color,
                      background: `${statusCfg.color}12`,
                      border: `1.5px solid ${statusCfg.color}25`,
                      letterSpacing: '0.15px',
                      display: 'inline-flex', alignItems: 'center', gap: '5px',
                    }}>
                      <span style={{
                        width: '6px', height: '6px', borderRadius: '50%',
                        background: statusCfg.color, display: 'inline-block',
                      }} />
                      {statusCfg.label}
                    </span>
                  </div>
                </div>
                {/* Meta sub-line */}
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '16px',
                  fontSize: '13px', color: '#6b7a8d', fontWeight: 500,
                }}>
                  <span>
                    {reviewMovement.created_at ? new Date(reviewMovement.created_at).toLocaleString('en-IN', {
                      day: '2-digit', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit', hour12: true,
                    }) : '—'}
                  </span>
                  <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#cbd5e1' }} />
                  <span>by {reviewMovement.requested_by_name || 'Operator'}</span>
                  {reviewMovement.part_number && (
                    <>
                      <span style={{ width: '3px', height: '3px', borderRadius: '50%', background: '#cbd5e1' }} />
                      <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: '12.5px', color: '#64748b' }}>
                        {reviewMovement.part_number}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* ══════════ SECTION 2: INFO GRID (2-Column) ══════════ */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr',
                padding: '20px 0',
                borderBottom: '1px solid #f0f2f5',
              }}>
                {/* ── Left Column: Item Identity ── */}
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: '16px',
                  paddingRight: '28px',
                  borderRight: '1px solid #f0f2f5',
                }}>
                  <div>
                    <div style={labelStyle}>Item Code</div>
                    <div style={{ ...valueStyle, fontFamily: "'JetBrains Mono', monospace", fontSize: '14.5px', letterSpacing: '0.3px' }}>
                      {reviewMovement.item_code || '—'}
                    </div>
                  </div>
                  {reviewMovement.master_serial_no && (
                    <div>
                      <div style={labelStyle}>Master Serial No.</div>
                      <div style={{ ...valueStyle, fontFamily: "'JetBrains Mono', monospace", fontSize: '14.5px' }}>
                        {reviewMovement.master_serial_no}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={labelStyle}>Movement Type</div>
                    <div style={{ ...valueStyle, fontSize: '15px' }}>
                      {MOVEMENT_TYPE_LABELS[reviewMovement.movement_type] || reviewMovement.movement_type}
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>Stock Type</div>
                    <div style={{
                      ...valueStyle, fontSize: '15px',
                      color: stockType === 'STOCK_IN' ? '#1e3a8a' : '#c2410c',
                      fontWeight: 700,
                    }}>
                      {stockType === 'REJECTION' ? 'From Rejection' : 'Stock In'}
                    </div>
                  </div>
                </div>

                {/* ── Right Column: Movement Meta ── */}
                <div style={{
                  display: 'flex', flexDirection: 'column', gap: '16px',
                  paddingLeft: '28px',
                }}>
                  <div>
                    <div style={labelStyle}>Reason</div>
                    <div style={valueStyle}>
                      {reviewReasonCode?.description || reviewReasonCode?.reason_code?.replace(/_/g, ' ') || reviewMovement.reason_code?.replace(/_/g, ' ') || '—'}
                    </div>
                  </div>
                  {(reviewMovement.reference_document_number || reviewMovement.reference_document_type) && (
                    <div>
                      <div style={labelStyle}>Reference</div>
                      <div style={valueStyle}>
                        <span style={{ textTransform: 'capitalize' }}>
                          {reviewMovement.reference_document_type?.replace(/_/g, ' ')?.toLowerCase() || ''}
                        </span>
                        {reviewMovement.reference_document_number && (
                          <span style={{
                            marginLeft: '6px', padding: '1px 8px', borderRadius: '4px',
                            background: '#f1f5f9', fontSize: '13px', fontWeight: 600,
                            fontFamily: "'JetBrains Mono', monospace", color: '#475569',
                            border: '1px solid #e8ecf2',
                          }}>
                            {reviewMovement.reference_document_number}
                          </span>
                        )}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={labelStyle}>Created</div>
                    <div style={valueStyle}>
                      {reviewMovement.created_at ? new Date(reviewMovement.created_at).toLocaleString('en-IN', {
                        day: '2-digit', month: 'short', year: 'numeric',
                      }) : '—'}
                    </div>
                  </div>
                  <div>
                    <div style={labelStyle}>Requested By</div>
                    <div style={valueStyle}>
                      {reviewMovement.requested_by_name || 'Operator'}
                    </div>
                  </div>
                </div>
              </div>

              {/* ══════════ SECTION 3: ROUTE FLOW ══════════ */}
              <div style={{ padding: '20px 0', borderBottom: '1px solid #f0f2f5' }}>
                <div style={{ ...labelStyle, marginBottom: '10px' }}>Movement Route</div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: '0',
                  background: 'linear-gradient(135deg, #f0f4ff 0%, #f7f8fc 100%)', borderRadius: '10px',
                  border: '1px solid #dce3f0', padding: '14px 16px',
                }}>
                  {/* From */}
                  <div style={{
                    flex: 1, padding: '8px 12px', borderRadius: '8px',
                    background: '#fff', border: '1px solid #d4dbe8',
                    textAlign: 'center', boxShadow: '0 1px 2px rgba(30,58,138,0.04)',
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '2px' }}>From</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a2332' }}>{fromLabel}</div>
                  </div>
                  {/* Arrow connector */}
                  <div style={{
                    padding: '0 12px', display: 'flex', alignItems: 'center',
                    position: 'relative',
                  }}>
                    <div style={{
                      width: '32px', height: '1.5px', background: '#c8ced8',
                      position: 'relative',
                    }}>
                      <ArrowRight size={14} style={{
                        color: '#1e3a8a', position: 'absolute',
                        right: '-7px', top: '-6.5px',
                      }} />
                    </div>
                  </div>
                  {/* To */}
                  <div style={{
                    flex: 1, padding: '8px 12px', borderRadius: '8px',
                    background: '#fff', border: '1px solid #d4dbe8',
                    textAlign: 'center', boxShadow: '0 1px 2px rgba(30,58,138,0.04)',
                  }}>
                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '2px' }}>To</div>
                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#1a2332' }}>{toLabel}</div>
                  </div>
                </div>
              </div>

              {/* ══════════ SECTION 3.5: BOX BREAKDOWN (Production Receipt only) ══════════ */}
              {reviewMovement.movement_type === 'PRODUCTION_RECEIPT' && reviewBoxInfo && (reviewBoxInfo.boxes > 0 || reviewBoxInfo.adjIncluded) && (
                <div style={{ padding: '16px 0', borderBottom: '1px solid #f0f2f5' }}>
                  <div style={{ ...labelStyle, marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <Package size={13} style={{ color: '#1e3a8a' }} />
                    Box Breakdown
                  </div>
                  <div style={{
                    background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                    borderRadius: '10px', border: '1px solid #bfdbfe',
                    padding: '16px 20px',
                  }}>
                    {/* Inner boxes row */}
                    {reviewBoxInfo.boxes > 0 && (
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', alignItems: 'center' }}>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b7a8d', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>Inner Boxes</div>
                          <div style={{ fontSize: '28px', fontWeight: 800, color: '#1e3a8a', lineHeight: '1', letterSpacing: '-0.5px' }}>
                            {reviewBoxInfo.boxes}
                          </div>
                        </div>
                        <div style={{ fontSize: '20px', fontWeight: 700, color: '#93a8d2', padding: '0 8px' }}>×</div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b7a8d', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>Qty per Box</div>
                          <div style={{ fontSize: '28px', fontWeight: 800, color: '#1e3a8a', lineHeight: '1', letterSpacing: '-0.5px' }}>
                            {reviewBoxInfo.perBox}
                            <span style={{ fontSize: '13px', fontWeight: 500, color: '#6b7a8d', marginLeft: '4px' }}>PCS</span>
                          </div>
                        </div>
                        <div style={{ fontSize: '20px', fontWeight: 700, color: '#93a8d2', padding: '0 8px' }}>=</div>
                        <div style={{ textAlign: 'center' }}>
                          <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b7a8d', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>
                            {reviewBoxInfo.adjIncluded ? 'Subtotal' : 'Total Pieces'}
                          </div>
                          <div style={{ fontSize: '28px', fontWeight: 800, color: reviewBoxInfo.adjIncluded ? '#1e3a8a' : '#16a34a', lineHeight: '1', letterSpacing: '-0.5px' }}>
                            {(reviewBoxInfo.boxes * reviewBoxInfo.perBox).toLocaleString()}
                            <span style={{ fontSize: '13px', fontWeight: 500, color: '#6b7a8d', marginLeft: '4px' }}>PCS</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Top-off box row (if applicable) */}
                    {reviewBoxInfo.adjIncluded && reviewBoxInfo.adjQty !== undefined && (
                      <>
                        {reviewBoxInfo.boxes > 0 && <div style={{ margin: '12px 0 8px', borderTop: '1px dashed #93a8d2' }} />}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr auto 1fr', alignItems: 'center' }}>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>Top-off Box{(reviewBoxInfo.adjBoxCount || 1) > 1 ? 'es' : ''}</div>
                            <div style={{ fontSize: '22px', fontWeight: 800, color: '#b45309', lineHeight: '1' }}>{reviewBoxInfo.adjBoxCount || 1}</div>
                          </div>
                          <div style={{ fontSize: '20px', fontWeight: 700, color: '#93a8d2', padding: '0 8px' }}>×</div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#b45309', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>Top-off Qty</div>
                            <div style={{ fontSize: '22px', fontWeight: 800, color: '#b45309', lineHeight: '1' }}>
                              {reviewBoxInfo.adjQty}
                              <span style={{ fontSize: '13px', fontWeight: 500, color: '#6b7a8d', marginLeft: '4px' }}>PCS</span>
                            </div>
                          </div>
                          <div style={{ fontSize: '20px', fontWeight: 700, color: '#93a8d2', padding: '0 8px' }}>=</div>
                          <div style={{ textAlign: 'center' }}>
                            <div style={{ fontSize: '11px', fontWeight: 700, color: '#6b7a8d', textTransform: 'uppercase', letterSpacing: '0.6px', marginBottom: '6px' }}>Grand Total</div>
                            <div style={{ fontSize: '28px', fontWeight: 800, color: '#16a34a', lineHeight: '1', letterSpacing: '-0.5px' }}>
                              {reviewBoxInfo.total.toLocaleString()}
                              <span style={{ fontSize: '13px', fontWeight: 500, color: '#6b7a8d', marginLeft: '4px' }}>PCS</span>
                            </div>
                          </div>
                        </div>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* ══════════ SECTION 4: METRICS ══════════ */}
              <div style={{
                padding: '20px 0',
                borderBottom: '1px solid #f0f2f5',
              }}>
                <div style={{
                  display: 'flex', alignItems: 'stretch',
                  background: '#f8f9fb',
                  borderRadius: '10px', border: '1px solid #edf0f4',
                  overflow: 'hidden',
                }}>
                  {/* Requested */}
                  <div style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: '#6b7a8d', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '6px' }}>Requested</div>
                    <div style={{ fontSize: '32px', fontWeight: 800, color: '#0e1726', letterSpacing: '-0.8px', lineHeight: '1' }}>{requestedQty.toLocaleString()}</div>
                  </div>
                  {!isPending && (
                    <>
                      <div style={{ width: '1px', background: '#edf0f4' }} />
                      <div style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#6b7a8d', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '6px' }}>Moved</div>
                        <div style={{ fontSize: '32px', fontWeight: 800, color: '#16a34a', letterSpacing: '-0.8px', lineHeight: '1' }}>{movedQty.toLocaleString()}</div>
                      </div>
                      <div style={{ width: '1px', background: '#edf0f4' }} />
                      <div style={{ flex: 1, textAlign: 'center', padding: '16px 12px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#6b7a8d', textTransform: 'uppercase', letterSpacing: '0.7px', marginBottom: '6px' }}>Rejected</div>
                        <div style={{ fontSize: '32px', fontWeight: 800, color: rejectedQty > 0 ? '#dc2626' : '#d0d5dd', letterSpacing: '-0.8px', lineHeight: '1' }}>{rejectedQty.toLocaleString()}</div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {/* ══════════ SECTION 5: NOTES ══════════ */}
              {(reviewMovement.reason_description || reviewMovement.supervisor_note) && (
                <div style={{ padding: '16px 0', borderBottom: '1px solid #f0f2f5', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {reviewMovement.reason_description && (
                    <div style={{
                      padding: '12px 16px',
                      borderLeft: '3.5px solid #1e3a8a',
                      background: 'linear-gradient(135deg, #f0f4ff 0%, #f8f9fc 100%)',
                      borderRadius: '0 8px 8px 0',
                    }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#1e3a8a', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Operator Note</div>
                      <div style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', fontWeight: 500, fontStyle: 'italic' }}>
                        "{reviewMovement.reason_description}"
                      </div>
                    </div>
                  )}
                  {reviewMovement.supervisor_note && (
                    <div style={{
                      padding: '10px 16px',
                      borderLeft: '3px solid #7c3aed',
                      background: '#faf8ff',
                      borderRadius: '0 8px 8px 0',
                    }}>
                      <div style={{ fontSize: '12px', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '4px' }}>Supervisor Note</div>
                      <div style={{ fontSize: '15px', color: '#374151', lineHeight: '1.6', fontWeight: 500, fontStyle: 'italic' }}>
                        "{reviewMovement.supervisor_note}"
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ══════════ SUPERVISOR ACTIONS (PENDING + L2/L3) ══════════ */}
              {isPending && canApprove && (
                <div style={{ paddingTop: '16px' }}>
                  <div style={{ marginBottom: '16px' }}>
                    <label style={{
                      display: 'block', fontSize: '12px', fontWeight: 700, color: '#374151',
                      marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.3px',
                    }}>
                      Supervisor Reason *
                    </label>
                    <textarea
                      value={supervisorNote}
                      onChange={e => setSupervisorNote(e.target.value)}
                      rows={2}
                      placeholder="Enter reason for your decision..."
                      style={{
                        ...mInputStyle, resize: 'vertical', fontFamily: 'inherit',
                        borderColor: supervisorNote.trim() ? '#93a8d2' : '#e2e8f0',
                        boxShadow: supervisorNote.trim() ? '0 0 0 2px rgba(30,58,138,0.06)' : 'none',
                        transition: 'all 0.15s ease', borderRadius: '8px',
                      }}
                    />
                  </div>

                  {canPartialApprove(reviewMovement.movement_type) && (
                    <div style={{ marginBottom: '16px' }}>
                      <label style={{ fontSize: '12px', fontWeight: 600, color: '#64748b', marginBottom: '6px', display: 'block' }}>
                        Partial Quantity (max {(reviewMovement.requested_quantity ?? 1) - 1})
                      </label>
                      <input
                        type="number" min={1} max={(reviewMovement.requested_quantity ?? 1) - 1}
                        value={approvedQty || ''}
                        onChange={e => setApprovedQty(parseInt(e.target.value) || 0)}
                        style={{ ...mInputStyle, maxWidth: '160px', borderRadius: '8px' }}
                        placeholder={`1 – ${(reviewMovement.requested_quantity ?? 0) - 1}`}
                      />
                    </div>
                  )}

                  <div style={{
                    display: 'flex', gap: '8px', justifyContent: 'flex-end',
                    paddingTop: '14px', borderTop: '1px solid #f0f2f5',
                  }}>
                    <button
                      onClick={() => handleApproval('REJECTED')}
                      disabled={reviewSubmitting || !supervisorNote.trim()}
                      style={{
                        padding: '10px 22px', borderRadius: '8px', fontWeight: 600, fontSize: '14px',
                        border: '1px solid #fecaca', background: '#fff', color: '#dc2626',
                        cursor: !supervisorNote.trim() ? 'not-allowed' : 'pointer',
                        opacity: !supervisorNote.trim() ? 0.4 : 1,
                        transition: 'all 0.15s ease',
                      }}
                    >
                      Reject
                    </button>

                    {canPartialApprove(reviewMovement.movement_type) && (
                      <button
                        onClick={() => handleApproval('PARTIALLY_APPROVED')}
                        disabled={reviewSubmitting || !supervisorNote.trim() || approvedQty <= 0 || approvedQty >= (reviewMovement.requested_quantity ?? 0)}
                        style={{
                          padding: '10px 22px', borderRadius: '8px', fontWeight: 600, fontSize: '14px',
                          border: '1px solid #c7d6ef', background: '#fff', color: '#1e3a8a',
                          cursor: !supervisorNote.trim() ? 'not-allowed' : 'pointer',
                          opacity: !supervisorNote.trim() ? 0.4 : 1,
                          transition: 'all 0.15s ease',
                        }}
                      >
                        Partial Approve
                      </button>
                    )}

                    <button
                      onClick={() => handleApproval('APPROVED')}
                      disabled={reviewSubmitting || !supervisorNote.trim()}
                      style={{
                        padding: '10px 26px', borderRadius: '8px', fontWeight: 600, fontSize: '14px',
                        border: 'none',
                        background: supervisorNote.trim() ? '#16a34a' : '#d1d5db',
                        color: '#fff',
                        cursor: !supervisorNote.trim() ? 'not-allowed' : 'pointer',
                        opacity: !supervisorNote.trim() ? 0.6 : 1,
                        transition: 'all 0.15s ease',
                        boxShadow: supervisorNote.trim() ? '0 1px 3px rgba(22,163,74,0.2)' : 'none',
                      }}
                    >
                      {reviewSubmitting ? 'Processing...' : 'Approve & Move'}
                    </button>
                  </div>
                </div>
              )}

              {/* Operator view-only state */}
              {isPending && isOperator && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: '12px', paddingTop: '16px' }}>
                  <span style={{ flex: 1, fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>
                    View-only — awaiting supervisor approval
                  </span>
                  <button
                    onClick={() => setShowReviewModal(false)}
                    style={{
                      padding: '10px 24px', borderRadius: '8px', fontWeight: 600, fontSize: '14px',
                      border: '1px solid #e2e8f0', background: '#fff', color: '#374151',
                      cursor: 'pointer', transition: 'all 0.15s ease',
                    }}
                  >
                    Close
                  </button>
                </div>
              )}

              {/* Footer for actioned movements */}
              {!isPending && (
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', paddingTop: '16px' }}>
                  <button
                    onClick={() => setShowReviewModal(false)}
                    style={{
                      padding: '10px 24px', borderRadius: '8px', fontWeight: 600, fontSize: '14px',
                      border: '1px solid #e2e8f0', background: '#fff', color: '#64748b',
                      cursor: 'pointer', transition: 'all 0.15s ease',
                    }}
                  >
                    Close
                  </button>
                  {!isOperator && ['COMPLETED', 'PARTIALLY_APPROVED', 'REJECTED'].includes(reviewMovement.status) && (
                    <button
                      onClick={() => handlePrintSlip(reviewMovement, statusCfg, stockType, fromLabel, toLabel)}
                      style={{
                        padding: '10px 22px', borderRadius: '8px', fontWeight: 600, fontSize: '14px',
                        border: 'none', background: '#1e3a8a', color: '#fff',
                        cursor: 'pointer', transition: 'all 0.15s ease',
                        display: 'flex', alignItems: 'center', gap: '6px',
                        boxShadow: '0 1px 3px rgba(30,58,138,0.2)',
                      }}
                    >
                      <Printer size={16} /> Print Slip
                    </button>
                  )}
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