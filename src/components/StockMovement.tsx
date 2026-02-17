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
  requested_by_name: string | null;
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

  // Current logged-in user name (for print slip Verified By auto-populate)
  const [currentUserName, setCurrentUserName] = useState<string>('');

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
          source_warehouse:source_warehouse_id ( warehouse_name, warehouse_code ),
          destination_warehouse:destination_warehouse_id ( warehouse_name, warehouse_code )
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

      // Batch-resolve requested_by UUIDs → full_name from profiles table
      const userIds = [...new Set((headers || []).map((h: any) => h.requested_by).filter(Boolean))];
      let userNameMap: Record<string, string> = {};
      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name')
          .in('id', userIds);
        (profiles || []).forEach((p: any) => {
          if (p.full_name) userNameMap[p.id] = p.full_name;
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
          source_warehouse: resolveWarehouseLabel(h.source_warehouse?.warehouse_code || null, h.source_warehouse?.warehouse_name || null),
          destination_warehouse: resolveWarehouseLabel(h.destination_warehouse?.warehouse_code || null, h.destination_warehouse?.warehouse_name || null),
          source_warehouse_id: h.source_warehouse?.warehouse_code || h.source_warehouse_id || null,
          destination_warehouse_id: h.destination_warehouse?.warehouse_code || h.destination_warehouse_id || null,
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
          requested_by_name: h.requested_by ? (userNameMap[h.requested_by] || null) : null,
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

  // Fetch current logged-in user's full_name for print slip Verified By
  useEffect(() => {
    const fetchCurrentUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('full_name')
            .eq('id', session.user.id)
            .single();
          if (profile?.full_name) setCurrentUserName(profile.full_name);
        }
      } catch (err) { console.error('Error fetching current user name:', err); }
    };
    fetchCurrentUser();
  }, [supabase]);

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
     ENTERPRISE PRINT DOCUMENT — A4 PORTRAIT
     A4 = 210mm × 297mm
     Margins: 12mm left/right, 10mm top, 8mm bottom
     Printable area: 186mm × 279mm
     ═══════════════════════════════════════════════════════════════ */
  @page {
    size: 210mm 297mm;
    margin: 10mm 12mm 8mm 12mm;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html {
    width: 210mm;
  }
  body {
    font-family: Arial, 'Helvetica Neue', Helvetica, sans-serif;
    color: #000;
    font-size: 10px;
    line-height: 1.35;
    background: #fff;
    width: 186mm;
    margin: 0 auto;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  /* Page container — exactly fits A4 printable area */
  .doc {
    width: 186mm;
    max-width: 186mm;
    margin: 0 auto;
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
      width: 186mm;
      height: auto;
      margin: 0;
      padding: 0;
      overflow: visible;
    }
    .doc {
      width: 100%;
      max-width: 100%;
      margin: 0;
      page-break-after: avoid;
    }
    .no-print { display: none !important; }
    table { page-break-inside: avoid; }
    /* Remove browser default headers/footers in print */
    @page { margin: 10mm 12mm 8mm 12mm; }
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
       ║  SECTION 5: AUTHORIZATION                                   ║
       ╚══════════════════════════════════════════════════════════════╝ -->
  <table class="w100 bdr mt4" cellspacing="0" cellpadding="0">
    <tr><td colspan="2" class="sec-hdr">Authorization</td></tr>
    <tr>
      <!-- Verified By (auto-populated from current session user) -->
      <td class="vt bdr-r" style="width:50%; padding:10px 14px;">
        <div class="fs9 fw800 uc tc ls1 c000" style="padding-bottom:4px; margin-bottom:8px; border-bottom:1px solid #ccc;">Verified By</div>
        <table class="w100" cellspacing="0" cellpadding="0" style="border:none;">
          <tr><td class="fs9 fw700" style="width:70px; padding:3px 0;">Name</td><td style="padding:3px 0; border-bottom:1px dotted #aaa; font-size:10px; font-weight:600;">${currentUserName || 'System User'}</td></tr>
          <tr><td class="fs9 fw700" style="padding:3px 0;">Designation</td><td style="padding:3px 0; border-bottom:1px dotted #aaa; font-size:10px; font-weight:500;">Supervisor</td></tr>
          <tr><td class="fs9 fw700" style="padding:3px 0;">Date</td><td style="padding:3px 0; border-bottom:1px dotted #aaa; font-size:10px; font-weight:500;">${printTimestamp.split(',')[0]}</td></tr>
        </table>
        <div class="sig-box" style="margin-top:8px; height:60px;"></div>
        <div class="sig-caption">Signature</div>
      </td>
      <!-- Authorized By -->
      <td class="vt" style="width:50%; padding:10px 14px;">
        <div class="fs9 fw800 uc tc ls1 c000" style="padding-bottom:4px; margin-bottom:8px; border-bottom:1px solid #ccc;">Authorized By</div>
        <table class="w100" cellspacing="0" cellpadding="0" style="border:none;">
          <tr><td class="fs9 fw700" style="width:70px; padding:3px 0;">Name</td><td style="padding:3px 0; border-bottom:1px dotted #aaa; font-size:10px;">&nbsp;</td></tr>
          <tr><td class="fs9 fw700" style="padding:3px 0;">Designation</td><td style="padding:3px 0; border-bottom:1px dotted #aaa; font-size:10px;">Manager</td></tr>
          <tr><td class="fs9 fw700" style="padding:3px 0;">Date</td><td style="padding:3px 0; border-bottom:1px dotted #aaa; font-size:10px;">&nbsp;</td></tr>
        </table>
        <div class="sig-box" style="margin-top:8px; height:60px;"></div>
        <div class="sig-caption">Signature</div>
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
                                : resolveWarehouseLabel(m.source_warehouse_id, m.source_warehouse)}
                        </td>
                        <td style={{ ...tdStyle, fontSize: '13px' }}>
                          {m.movement_type === 'REJECTION_DISPOSAL' ? 'Production Floor (Disposal)'
                            : m.movement_type === 'PRODUCTION_RECEIPT' ? 'Production Warehouse'
                              : m.movement_type === 'CUSTOMER_SALE' ? 'Customer'
                                : resolveWarehouseLabel(m.destination_warehouse_id, m.destination_warehouse)}
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
      <Modal isOpen={showReviewModal} onClose={() => setShowReviewModal(false)} title="" maxWidth="720px">
        {reviewMovement && (() => {
          const statusCfg = STATUS_CONFIG[reviewMovement.status] || { color: '#6b7280', bg: '#f9fafb', label: reviewMovement.status };
          const isPending = reviewMovement.status === 'PENDING_APPROVAL';
          const stockType = getStockType(reviewMovement.movement_type);
          const fromLabel =
            reviewMovement.movement_type === 'REJECTION_DISPOSAL' ? 'Production Warehouse'
              : reviewMovement.movement_type === 'PRODUCTION_RECEIPT' ? 'Production'
                : reviewMovement.movement_type === 'CUSTOMER_RETURN' ? 'Customer'
                  : resolveWarehouseLabel(reviewMovement.source_warehouse_id, reviewMovement.source_warehouse, 'External');
          const toLabel =
            reviewMovement.movement_type === 'REJECTION_DISPOSAL' ? 'Production Floor (Disposal)'
              : reviewMovement.movement_type === 'PRODUCTION_RECEIPT' ? 'Production Warehouse'
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