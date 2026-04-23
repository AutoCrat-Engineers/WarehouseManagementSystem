/**
 * Unified Item Details Module
 *
 * Merges the Item Master (CRUD) and Inventory (stock + warehouse details) into a single view.
 *
 * DATA SOURCES:
 *  - Items CRUD:            public.items  (via itemsSupabase API)
 *  - Stock Distribution:    vw_item_stock_distribution (for View modal ΓÇö Multi Warehouse Stock tab)
 *  - Blanket Orders:        v_item_details view (for View modal)
 *
 * FEATURES:
 *  1. Summary cards: Total Items, Active Items, Inactive Items
 *  2. Table: Status Dot, MSN, Part Number, Description, REV, View, Actions
 *  3. Dynamic search across MSN, Part Number, and Description
 *  4. 4-tab View Modal: Item Details ΓåÆ Multi Warehouse Stock ΓåÆ Blanket Orders ΓåÆ Blanket Release
 *  5. Full CRUD (Add / Edit / Delete) with RBAC
 *  6. Export to Excel (ItemMaster format)
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Plus, Search, X, Package, CheckCircle2, CheckCircle, XCircle, AlertTriangle,
  Info, Edit2, Trash2, Settings, ChevronDown, ChevronRight, Eye,
  Calendar, Clock, Box, Download, RefreshCw, Hash, FileText, Scale, DollarSign, Activity, Tag,
  AlignCenter,
} from 'lucide-react';
import {
  Card, Button, Input, Select, Label, Badge, Modal, EmptyState, Textarea,
  LoadingSpinner, ModuleLoader,
} from './ui/EnterpriseUI';
import {
  SummaryCard, SummaryCardsGrid, FilterBar as SharedFilterBar, ActionBar,
  SearchBox, ExportCSVButton, ClearFiltersButton, AddButton,
  RefreshButton, Pagination,
} from './ui/SharedComponents';
import * as itemsApi from '../utils/api/itemsSupabase';
import { fetchWithAuth } from '../utils/supabase/auth';
import { getEdgeFunctionUrl } from '../utils/supabase/info';
import { useItemStockDistribution } from '../hooks/useInventory';
import type { ItemStockDashboard } from '../types/inventory';

// ============================================================================
// TYPES
// ============================================================================

type Item = itemsApi.Item;
type UserRole = 'L1' | 'L2' | 'L3' | null;
type CardFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';
type SortDirection = 'asc' | 'desc' | null;
type SortField = 'master_serial_no' | 'part_number';

/* ========== v_item_details VIEW INTERFACE ========== */
interface ViewItemDetails {
  id: string;
  item_code: string;
  item_name: string;
  uom: string;
  unit_price: number | null;
  standard_cost: number | null;
  lead_time_days: string;
  is_active: boolean;
  item_created_at: string;
  item_updated_at: string;
  master_serial_no: string | null;
  revision: string | null;
  part_number: string | null;
  blanket_order_id: string | null;
  order_number: string | null;
  customer_name: string | null;
  customer_code: string | null;
  customer_po_number: string | null;
  order_date: string | null;
  blanket_order_start: string | null;
  blanket_order_end: string | null;
  blanket_order_status: string | null;
  blanket_order_total_value: number | null;
  sap_doc_no: string | null;
  order_created_at: string | null;
  line_id: string | null;
  blanket_quantity: number | null;
  released_quantity: number | null;
  delivered_quantity: number | null;
  pending_quantity: number | null;
  line_unit_price: number | null;
  line_total: number | null;
  line_number: number | null;
  monthly_usage: number | null;
  packing_multiple: number | null;
  order_multiple: number | null;
  min_stock: number | null;
  max_stock: number | null;
  safety_stock: number | null;
  item_quantity: number | null;
  delivery_schedule: string | null;
  item_notes: string | null;
}

interface BlanketOrder {
  id: string;
  bpa_number: string;
  master_serial_no: string;
  part_number: string;
  customer_name: string;
  blanket_order_qty: number;
  blanket_order_start: string;
  blanket_order_end: string;
  monthly_usage: number;
  next_delivery: string;
  release_multiple: number;
  min_stock: number;
  max_stock: number;
  safety_stock: number;
  // BPA-layer metadata
  agreement_status: 'ACTIVE' | 'AMENDED' | 'DRAFT' | 'EXPIRED' | 'CANCELLED' | 'UNKNOWN';
  agreement_revision: number;
  released_quantity: number;
  fulfillment_pct: number;
}

/* ========== UOM NORMALIZER ========== */
function normalizeUom(value: string): string {
  const upper = value.toUpperCase().trim();
  if (upper === 'PCS' || upper === 'PIECES' || upper === 'PC') return 'NOS';
  if (upper === 'KG' || upper === 'KILOGRAMS' || upper === 'KILOGRAM') return 'KG';
  if (upper === 'BOX' || upper === 'BOXES') return 'Boxes';
  if (upper === 'NOS' || upper === 'NO' || upper === 'NUMBERS') return 'NOS';
  return 'NOS'; // default fallback
}

/* ========== FORM DEFAULT ========== */
const formDefault: itemsApi.ItemFormData = {
  // item_code: removed in migration 018; part_number is canonical.
  item_name: '',
  uom: 'NOS',
  unit_price: null,
  standard_cost: null,
  weight: null,
  lead_time_days: '',
  is_active: true,
  master_serial_no: '',
  revision: '',
  part_number: '',
};

// ============================================================================
// STYLES
// ============================================================================

const thStyle: React.CSSProperties = {
  padding: '12px 16px',
  textAlign: 'left',
  fontSize: '12px',
  fontWeight: 600,
  color: 'var(--enterprise-gray-700)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: '13px',
  color: 'var(--enterprise-gray-800)',
};

const sectionStyle: React.CSSProperties = {
  borderRadius: 'var(--border-radius-md)',
  padding: '16px',
  marginBottom: '16px',
};

const viewDetailRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '10px',
  padding: '10px 14px',
  borderRadius: '8px',
  background: 'var(--enterprise-gray-50)',
  border: '1px solid var(--enterprise-gray-100)',
  boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 3px rgba(0,0,0,0.04)',
};

const viewDetailLabelStyle: React.CSSProperties = {
  fontSize: '11px',
  fontWeight: 600,
  color: 'var(--enterprise-gray-500)',
  textTransform: 'uppercase',
  letterSpacing: '0.4px',
  marginBottom: '2px',
};

const viewDetailValueStyle: React.CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--enterprise-gray-800)',
  lineHeight: 1.4,
};

const viewDetailIconStyle: React.CSSProperties = {
  width: '32px',
  height: '32px',
  borderRadius: '8px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flexShrink: 0,
};

// ============================================================================
// ACTIVE STATUS DOT COMPONENT (from Inventory module)
// ============================================================================

function ActiveStatusDot({ isActive }: { isActive?: boolean }) {
  return (
    <span
      style={{
        display: 'inline-block',
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        backgroundColor: isActive ? '#22c55e' : '#ef4444',
        boxShadow: isActive
          ? '0 0 6px rgba(34, 197, 94, 0.4)'
          : '0 0 6px rgba(239, 68, 68, 0.4)',
      }}
      title={isActive ? 'Active' : 'Inactive'}
    />
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function exportItemsToExcel(data: Item[]) {
  import('xlsx').then(XLSX => {
    const headers = [
      'Part Number', 'Master Serial No', 'Item Description', 'Revision',
      'UOM', 'Weight (G)', 'Unit Price', 'Standard Cost', 'Lead Time', 'Status', 'Deleted By',
    ];
    const rows = data.map(item => [
      item.part_number || '', item.master_serial_no || '',
      item.item_name || '', item.revision || '', normalizeUom(item.uom),
      item.weight ?? '', item.unit_price ?? '', item.standard_cost ?? '', item.lead_time_days,
      item.is_active ? 'Active' : 'Inactive', item.deleted_by || '',
    ]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Items');
    XLSX.writeFile(wb, `item_details_${new Date().toISOString().split('T')[0]}.xlsx`);
  });
}

// ============================================================================
// DELETE CONFIRMATION MODAL
// ============================================================================

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  item: Item | null;
}

function DeleteConfirmModal({ isOpen, onClose, onConfirm, item }: DeleteConfirmModalProps) {
  // Renamed from msnInput → partNumberInput: delete now keys off part_number
  // (the canonical unique identifier since item_code was dropped in migration 018).
  const [partNumberInput, setPartNumberInput] = useState('');
  const [deletionReason, setDeletionReason] = useState('');
  const [error, setError] = useState('');
  const [showFinalConfirm, setShowFinalConfirm] = useState(false);

  useEffect(() => {
    if (isOpen) { setPartNumberInput(''); setDeletionReason(''); setError(''); setShowFinalConfirm(false); }
  }, [isOpen]);

  const handleConfirm = () => {
    if (!item) return;
    if (partNumberInput.trim() !== (item.part_number || '')) {
      setError('Part Number does not match. Please enter the exact Part Number to confirm deletion.');
      return;
    }
    if (!deletionReason.trim()) {
      setError('Please provide a reason for deletion.');
      return;
    }
    setError('');
    setShowFinalConfirm(true);
  };

  const handleFinalYes = () => {
    setShowFinalConfirm(false);
    onConfirm(deletionReason.trim());
  };

  const handleFinalNo = () => {
    setShowFinalConfirm(false);
  };

  if (!item) return null;

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="Confirm Item Deletion" maxWidth="500px">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }} onCopy={(e) => e.preventDefault()}>
          <div style={{
            background: 'linear-gradient(135deg, rgba(220,38,38,0.05) 0%, rgba(220,38,38,0.1) 100%)',
            border: '1px solid rgba(220,38,38,0.2)', borderRadius: 'var(--border-radius-md)',
            padding: '16px', display: 'flex', gap: '12px', alignItems: 'flex-start',
          }}>
            <AlertTriangle size={24} style={{ color: 'var(--enterprise-error)', flexShrink: 0 }} />
            <div>
              <p style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-error)', marginBottom: '4px' }}>This action cannot be undone</p>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-600)' }}>
                You will not be able to view the details of this Item if You delete it
              </p>
            </div>
          </div>
          <div style={{ background: 'var(--enterprise-gray-50)', borderRadius: 'var(--border-radius-md)', padding: '16px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
              {/* Part Number is the canonical identifier — show it first + highlighted */}
              <div>
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', marginBottom: '4px' }}>Part Number</p>
                <p style={{ fontWeight: 'var(--font-weight-semibold)', fontFamily: 'monospace', color: 'var(--enterprise-primary)' }}>{item.part_number || '-'}</p>
              </div>
              <div>
                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', marginBottom: '4px' }}>MSN</p>
                <p style={{ fontWeight: 'var(--font-weight-semibold)' }}>{item.master_serial_no || '-'}</p>
              </div>
            </div>
          </div>
          <div>
            <Label required>Type Part Number to Confirm</Label>
            <input type="text" value={partNumberInput} onChange={(e) => setPartNumberInput(e.target.value)} onSelect={(e) => e.stopPropagation()}
              placeholder={`Enter "${item.part_number || ''}" to confirm`}
              onPaste={(e) => e.preventDefault()} onCopy={(e) => e.preventDefault()} autoComplete="off"
              style={{ width: '100%', padding: '8px 12px', fontSize: 'var(--font-size-base)', color: 'var(--foreground)', backgroundColor: 'var(--background)', border: '1px solid var(--border-color)', borderRadius: 'var(--border-radius-md)', outline: 'none' }}
              onFocus={(e) => { e.target.style.borderColor = 'var(--enterprise-primary)'; e.target.style.boxShadow = '0 0 0 3px rgba(30,58,140,0.1)'; }}
              onBlur={(e) => { e.target.style.borderColor = 'var(--border-color)'; e.target.style.boxShadow = 'none'; }}
            />
          </div>
          <div>
            <Label required>Reason for Deletion</Label>
            <Textarea value={deletionReason} onChange={(e) => setDeletionReason(e.target.value)} placeholder="Please provide the reason..." rows={3} />
          </div>
          {error && (
            <div style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)', borderRadius: 'var(--border-radius-sm)', padding: '12px', color: 'var(--enterprise-error)', fontSize: 'var(--font-size-sm)' }}>{error}</div>
          )}
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
            <Button variant="tertiary" onClick={onClose}>Cancel</Button>
            <Button variant="danger" onClick={handleConfirm} disabled={!partNumberInput.trim() || !deletionReason.trim()} icon={<Trash2 size={16} />}>Delete Item</Button>
          </div>
        </div>
      </Modal>

      {/* ΓöÇΓöÇ Secondary "Are you sure?" confirmation ΓöÇΓöÇ */}
      <Modal isOpen={showFinalConfirm} onClose={handleFinalNo} title="Final Confirmation" maxWidth="440px">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', padding: '10px 0' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '50%',
            background: 'linear-gradient(135deg, rgba(220,38,38,0.1) 0%, rgba(220,38,38,0.2) 100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <AlertTriangle size={32} style={{ color: 'var(--enterprise-error)' }} />
          </div>
          <div style={{ textAlign: 'center' }}>
            <p style={{ fontSize: '16px', fontWeight: 700, color: 'var(--enterprise-gray-800)', marginBottom: '8px' }}>
              Do you want to delete this item?
            </p>
            <p style={{ fontSize: '13px', color: 'var(--enterprise-gray-500)', lineHeight: 1.5 }}>
              Item <strong style={{ color: 'var(--enterprise-primary)', fontFamily: 'monospace' }}>{item.part_number || '-'}</strong> will be permanently removed.
            </p>
          </div>
          <div style={{ display: 'flex', gap: '12px', width: '100%', justifyContent: 'center' }}>
            <Button variant="tertiary" onClick={handleFinalNo} style={{ minWidth: '100px', padding: '10px 24px' }}>No</Button>
            <Button variant="danger" onClick={handleFinalYes} icon={<Trash2 size={16} />} style={{ minWidth: '100px', padding: '10px 24px' }}>Yes</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

// ============================================================================
// BLANKET ORDER ACCORDION ROW
// ============================================================================

interface BlanketOrderRowProps { order: BlanketOrder; }

function BlanketOrderRow({ order }: BlanketOrderRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const upperLabelStyle: React.CSSProperties = { fontSize: '10px', color: 'var(--enterprise-gray-500)', marginBottom: '2px', textTransform: 'uppercase', letterSpacing: '0.4px', fontWeight: 500 };
  const upperValueStyle: React.CSSProperties = { fontSize: 'var(--font-size-sm)', fontWeight: 600, color: 'var(--enterprise-gray-800)', lineHeight: 1.3 };
  const detailCardStyle: React.CSSProperties = { background: 'white', padding: '12px 14px', borderRadius: 'var(--border-radius-sm)', border: '1px solid var(--enterprise-gray-100)', boxShadow: '0 1px 2px rgba(0,0,0,0.03)' };
  const labelStyle: React.CSSProperties = { fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', marginBottom: '4px', textTransform: 'uppercase', letterSpacing: '0.3px' };

  return (
    <div style={{ border: isExpanded ? '1.5px solid var(--enterprise-primary)' : '1px solid var(--enterprise-gray-200)', borderRadius: 'var(--border-radius-lg)', overflow: 'hidden', marginBottom: '10px', transition: 'all 0.25s cubic-bezier(0.4,0,0.2,1)', boxShadow: isExpanded ? '0 8px 24px rgba(30,58,138,0.12)' : '0 1px 3px rgba(0,0,0,0.04)', background: 'white' }}>
      <div onClick={() => setIsExpanded(!isExpanded)} style={{ display: 'flex', cursor: 'pointer', background: isExpanded ? 'linear-gradient(135deg, rgba(30,58,138,0.04) 0%, rgba(30,58,138,0.08) 100%)' : 'white', transition: 'all 0.2s ease', minHeight: '80px' }}
        onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = 'linear-gradient(135deg, #fafbfc 0%, #f1f5f9 100%)'; }}
        onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = 'white'; }}
      >
        <div style={{ width: '36px', minWidth: '36px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--enterprise-gray-100)', background: isExpanded ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-50)', transition: 'all 0.2s ease' }}>
          <div style={{ transition: 'transform 0.25s ease', transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
            <ChevronRight size={16} style={{ color: isExpanded ? 'white' : 'var(--enterprise-gray-500)' }} />
          </div>
        </div>
        <div style={{ flex: 1, padding: '12px 20px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
          {/* Row 1: BPA NUMBER | MSN | PART NUMBER | STATUS */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr', gap: '20px', marginBottom: '10px' }}>
            <div>
              <p style={upperLabelStyle}>BPA Number</p>
              <p style={{ ...upperValueStyle, color: 'var(--enterprise-primary)', fontWeight: 700, fontFamily: 'monospace' }}>{order.bpa_number}</p>
            </div>
            <div>
              <p style={upperLabelStyle}>Master Serial No</p>
              <p style={{ ...upperValueStyle, fontFamily: 'monospace' }}>{order.master_serial_no}</p>
            </div>
            <div>
              <p style={upperLabelStyle}>Part Number</p>
              <p style={{ ...upperValueStyle, color: 'var(--enterprise-info, #3b82f6)', fontWeight: 700, background: 'rgba(59,130,246,0.1)', padding: '2px 8px', borderRadius: '4px', display: 'inline-block' }}>{order.part_number}</p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <p style={upperLabelStyle}>Status</p>
              <div style={{ display: 'flex', alignItems: 'center', minHeight: '22px' }}>
                <Badge variant={
                  order.agreement_status === 'ACTIVE'    ? 'success' :
                  order.agreement_status === 'AMENDED'   ? 'warning' :
                  order.agreement_status === 'DRAFT'     ? 'info'    :
                  order.agreement_status === 'CANCELLED' ? 'danger'  : 'neutral'
                } style={{ fontWeight: 700, fontSize: '11px', letterSpacing: '0.5px' }}>
                  {order.agreement_status === 'UNKNOWN' ? '—' : order.agreement_status}
                </Badge>
              </div>
            </div>
          </div>
          {/* Row 2: CUSTOMER NAME | REVISION | BLANKET QUANTITY | FULFILLMENT */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr 1fr', gap: '20px' }}>
            <div>
              <p style={upperLabelStyle}>Customer Name</p>
              <p style={{ ...upperValueStyle, color: 'var(--enterprise-gray-700)' }}>{order.customer_name}</p>
            </div>
            <div>
              <p style={upperLabelStyle}>Revision</p>
              <p style={{ ...upperValueStyle, color: 'var(--enterprise-gray-800)', fontWeight: 600 }}>{order.agreement_revision ?? 0}</p>
            </div>
            <div>
              <p style={upperLabelStyle}>Blanket Quantity</p>
              <p style={{ ...upperValueStyle, color: 'var(--enterprise-success)', fontWeight: 700 }}>{order.blanket_order_qty.toLocaleString()}</p>
            </div>
            <div>
              <p style={upperLabelStyle}>Fulfillment</p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontWeight: 700, fontSize: '13px', color: order.fulfillment_pct >= 100 ? 'var(--enterprise-success)' : 'var(--enterprise-gray-800)', minWidth: '44px' }}>
                  {order.fulfillment_pct.toFixed(1)}%
                </span>
                <div style={{ flex: 1, height: '4px', background: 'var(--enterprise-gray-200)', borderRadius: '2px', overflow: 'hidden' }}>
                  <div style={{
                    width: `${Math.min(100, order.fulfillment_pct)}%`,
                    height: '100%',
                    background: order.fulfillment_pct >= 100 ? 'var(--enterprise-success)' : 'var(--enterprise-primary)',
                    transition: 'width 0.3s ease',
                  }} />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      {isExpanded && (
        <div style={{ background: 'linear-gradient(180deg, rgba(30,58,138,0.04) 0%, rgba(30,58,138,0.02) 100%)', borderTop: '1px solid var(--enterprise-gray-200)', padding: '20px 54px', animation: 'slideDown 0.25s ease-out' }}>
          <p style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-primary)', textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}><Package size={14} /> BPA Details</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '14px' }}>
            <div style={detailCardStyle}><p style={labelStyle}>BPA Start Date</p><p style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-gray-800)' }}>{order.blanket_order_start ? new Date(order.blanket_order_start).toLocaleDateString() : '-'}</p></div>
            <div style={detailCardStyle}><p style={labelStyle}>BPA End Date</p><p style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-gray-800)' }}>{order.blanket_order_end ? new Date(order.blanket_order_end).toLocaleDateString() : '-'}</p></div>
            <div style={detailCardStyle}><p style={labelStyle}>Monthly Usage</p><p style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-info)', fontSize: 'var(--font-size-lg)' }}>{(order.monthly_usage || 0).toLocaleString()}</p></div>
            <div style={{ ...detailCardStyle, background: 'linear-gradient(135deg, rgba(34,197,94,0.05) 0%, rgba(34,197,94,0.1) 100%)', border: '1px solid rgba(34,197,94,0.2)' }}><p style={{ ...labelStyle, color: 'var(--enterprise-success)' }}>Next Delivery</p><p style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-success)' }}>{order.next_delivery ? new Date(order.next_delivery).toLocaleDateString() : 'Not Scheduled'}</p></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
            <div style={detailCardStyle}><p style={labelStyle}>Release Multiple</p><p style={{ fontWeight: 'var(--font-weight-semibold)' }}>{(order.release_multiple || 1).toLocaleString()}</p></div>
            <div style={detailCardStyle}><p style={labelStyle}>Min Stock</p><p style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-warning)' }}>{(order.min_stock || 0).toLocaleString()}</p></div>
            <div style={detailCardStyle}><p style={labelStyle}>Max Stock</p><p style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-success)' }}>{(order.max_stock || 0).toLocaleString()}</p></div>
            <div style={detailCardStyle}><p style={labelStyle}>Safety Stock</p><p style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-secondary, #6366f1)' }}>{(order.safety_stock || 0).toLocaleString()}</p></div>
          </div>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ENHANCED VIEW MODAL ΓÇö 4 TABS
// ============================================================================

function ItemViewModal({ isOpen, onClose, item }: {
  isOpen: boolean; onClose: () => void; item: Item | null;
}) {
  const [activeTab, setActiveTab] = useState<'details' | 'multiWarehouseStock' | 'blanketOrders' | 'blanketRelease'>('details');
  const [blanketOrders, setBlanketOrders] = useState<BlanketOrder[]>([]);
  const [subInvoiceLines, setSubInvoiceLines] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [loadingReleases, setLoadingReleases] = useState(false);
  const [blanketSearch, setBlanketSearch] = useState('');

  // Eagerly fetch stock distribution when modal opens (not only on tab switch)
  // This eliminates the loading delay when user switches to Multi Warehouse tab
  const { data: distribution, loading: loadingDistribution } = useItemStockDistribution(
    isOpen && item ? item.part_number : null
  );

  useEffect(() => { if (!isOpen) { setBlanketSearch(''); setActiveTab('details'); } }, [isOpen]);

  useEffect(() => {
    if (isOpen && item && (activeTab === 'blanketOrders' || activeTab === 'blanketRelease')) {
      fetchItemDetail();
    }
  }, [isOpen, item, activeTab]);

  // Backed by the new `item_get_full_detail` edge function (replaces the
  // broken `im_get-blanket-orders` which queried the dropped v_item_details
  // view). One call hydrates BOTH the Blanket Orders tab and the Blanket
  // Release tab.
  const fetchItemDetail = async () => {
    if (!item) return;
    setLoadingOrders(true);
    setLoadingReleases(true);
    try {
      const res = await fetchWithAuth(getEdgeFunctionUrl('item_get_full_detail'), {
        method: 'POST',
        body: JSON.stringify({ item_id: item.id }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setBlanketOrders([]); setSubInvoiceLines([]); return;
      }
      // Transform: one BlanketOrder per agreement_part (each part belongs
      // to exactly one agreement). Line-config supplies running totals.
      const agreementParts = (json.agreements || []) as any[];
      const lineConfigs    = (json.line_configs || []) as any[];
      const nextReleaseByAgr = (json.next_release_by_agreement || {}) as Record<string, string>;
      const lineByAgr = new Map<string, any>();
      for (const lc of lineConfigs) lineByAgr.set(lc.agreement_id, lc);

      const transformed: BlanketOrder[] = agreementParts.map((p: any) => {
        const agr = p.agreement || {};
        const lc  = lineByAgr.get(p.agreement_id) ?? {};
        const blanketQty   = Number(p.blanket_quantity ?? 0);
        const releasedQty  = Number(lc.released_quantity ?? 0);
        const fulfillPct   = lc.fulfillment_pct != null
            ? Number(lc.fulfillment_pct)
            : (blanketQty > 0 ? (releasedQty / blanketQty) * 100 : 0);
        return {
          id:                  p.id,
          bpa_number:          agr.agreement_number || '—',
          master_serial_no:    p.msn_code || '—',
          part_number:         p.part_number || '—',
          customer_name:       agr.customer_name || '—',
          blanket_order_qty:   blanketQty,
          blanket_order_start: agr.effective_start_date || '',
          blanket_order_end:   agr.effective_end_date   || '',
          monthly_usage:       Number(p.avg_monthly_demand ?? 0),
          next_delivery:       nextReleaseByAgr[p.agreement_id] ?? '',
          release_multiple:    p.release_multiple ?? 1,
          min_stock:           p.min_warehouse_stock ?? 0,
          max_stock:           p.max_warehouse_stock ?? 0,
          safety_stock:        p.safety_stock ?? 0,
          agreement_status:    (agr.status || 'UNKNOWN') as BlanketOrder['agreement_status'],
          agreement_revision:  Number(agr.agreement_revision ?? 0),
          released_quantity:   releasedQty,
          fulfillment_pct:     Math.round(fulfillPct * 10) / 10,
        };
      });
      setBlanketOrders(transformed);
      setSubInvoiceLines((json.sub_invoice_lines || []) as any[]);
    } catch {
      setBlanketOrders([]); setSubInvoiceLines([]);
    } finally {
      setLoadingOrders(false); setLoadingReleases(false);
    }
  };

  if (!item) return null;

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '12px 20px', border: 'none',
    background: isActive ? 'var(--enterprise-primary)' : 'transparent',
    color: isActive ? 'white' : 'var(--enterprise-gray-600)',
    cursor: 'pointer', fontWeight: 'var(--font-weight-semibold)',
    borderRadius: 'var(--border-radius-md) var(--border-radius-md) 0 0',
    transition: 'all 0.2s ease', fontSize: 'var(--font-size-sm)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    flex: 1, minWidth: 0, whiteSpace: 'nowrap',
  });

  /* Reusable detail field ΓÇö clean label/value (no per-field icons) */
  const DetailField = ({ label, value }: { label: string; value: string; icon?: React.ReactNode; iconBg?: string }) => (
    <div style={viewDetailRowStyle}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={viewDetailLabelStyle}>{label}</p>
        <p style={viewDetailValueStyle}>{value}</p>
      </div>
    </div>
  );

  /* Tab content wrapper style for smooth transitions + consistent box size */
  const tabContentStyle = (tabName: string): React.CSSProperties => ({
    display: activeTab === tabName ? 'block' : 'none',
    animation: activeTab === tabName ? 'tabFadeIn 0.3s ease-out' : 'none',
    minHeight: '420px',
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={`Details of ${item.master_serial_no || 'MSN'}`} maxWidth="1000px">
      <div style={{ display: 'flex', borderBottom: '2px solid var(--enterprise-gray-300)', marginBottom: '20px' }}>
        <button style={tabStyle(activeTab === 'details')} onClick={() => setActiveTab('details')}>
          <Tag size={14} /> Item Details
        </button>
        <button style={tabStyle(activeTab === 'multiWarehouseStock')} onClick={() => setActiveTab('multiWarehouseStock')}>
          <Package size={14} /> Multi Warehouse
        </button>
        <button style={tabStyle(activeTab === 'blanketOrders')} onClick={() => setActiveTab('blanketOrders')}>
          <FileText size={14} /> BPA
        </button>
        <button style={tabStyle(activeTab === 'blanketRelease')} onClick={() => setActiveTab('blanketRelease')}>
          <Calendar size={14} /> Blanket Release
        </button>
      </div>

      {/* ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ TAB 1: ITEM DETAILS ΓÇö New 6 Row Layout ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ */}
      <div style={tabContentStyle('details')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {/* Row 1: MSN | Part Number */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <DetailField label="MSN" value={item.master_serial_no || '-'} />
            <DetailField label="Part Number" value={item.part_number || '-'} />
          </div>
          {/* Row 2: Description (large) | UOM (small) */}
          <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '12px' }}>
            <DetailField label="Description" value={item.item_name || '-'} />
            <DetailField label="UOM" value={normalizeUom(item.uom)} />
          </div>
          {/* Row 3: Weight | Revision */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <DetailField label="Revision" value={item.revision || '-'} />
            <DetailField label="Weight (G)" value={item.weight != null ? item.weight.toLocaleString() : '-'} />
          </div>
          {/* Row 4: Unit Price | Standard Cost */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <DetailField label="Unit Price" value={item.unit_price != null ? `Γé╣${item.unit_price.toLocaleString()}` : '-'} />
            <DetailField label="Standard Cost" value={item.standard_cost != null ? `$${item.standard_cost.toLocaleString()}` : '-'} />
          </div>
          {/* Row 5: Lead Time | Status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <DetailField label="Lead Time" value={item.lead_time_days || '-'} />
            <div style={viewDetailRowStyle}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={viewDetailLabelStyle}>Status</p>
                <p style={{ ...viewDetailValueStyle, color: item.is_active ? '#16a34a' : '#dc2626' }}>
                  {item.is_active ? 'Active' : 'Inactive'}
                </p>
              </div>
            </div>
          </div>
          {/* Row 6: Last Updated At */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
            <DetailField label="Last Updated At" value={item.updated_at ? new Date(item.updated_at).toLocaleString() : '-'} />
          </div>
        </div>
      </div>

      {/* ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ TAB 2: MULTI WAREHOUSE STOCK ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ */}
      <div style={tabContentStyle('multiWarehouseStock')}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Item Summary Header ΓÇö Part Number, UOM, Status */}
          <div style={{ background: 'var(--enterprise-gray-50)', padding: '16px', borderRadius: '8px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--enterprise-gray-900)', marginBottom: '12px' }}>{item.item_name || item.part_number || '-'}</h3>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', fontSize: '13px', color: 'var(--enterprise-gray-600)' }}>
              <span><strong>Part No:</strong> {item.part_number || '-'}</span>
              <span><strong>UOM:</strong> {normalizeUom(item.uom)}</span>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                <strong>Status:</strong>
                <span style={{ fontWeight: 600, color: item.is_active ? '#16a34a' : '#dc2626' }}>
                  {item.is_active ? 'Active' : 'Inactive'}
                </span>
              </span>
            </div>
          </div>

          {loadingDistribution ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <LoadingSpinner size={32} />
              <p style={{ marginTop: '12px', color: 'var(--enterprise-gray-500)', fontSize: '13px' }}>Loading stock distribution...</p>
            </div>
          ) : (
            /* 4 Equal-Width Warehouse Cards */
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '12px' }}>
              {/* ≡ƒƒª FG Warehouse */}
              <div style={{ background: 'white', padding: '16px', borderRadius: '10px', border: '1px solid var(--enterprise-gray-200)', borderTop: '3px solid var(--enterprise-primary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', fontSize: '13px', fontWeight: 700, color: 'var(--enterprise-gray-800)' }}>
                  <Package size={16} style={{ color: 'var(--enterprise-primary)' }} /> FG Warehouse
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--enterprise-gray-500)' }}>On Hand</span>
                  <span style={{ fontWeight: 600, color: 'var(--enterprise-success)' }}>{(distribution as any)?.productionOnHand ?? 0}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                  <span style={{ color: 'var(--enterprise-gray-500)' }}>Available</span>
                  <span style={{ fontWeight: 600, color: 'var(--enterprise-primary)' }}>{(distribution as any)?.productionOnHand ?? 0}</span>
                </div>
              </div>
              {/* ≡ƒƒ¿ In Transit */}
              <div style={{ background: 'white', padding: '16px', borderRadius: '10px', border: '1px solid var(--enterprise-gray-200)', borderTop: '3px solid var(--enterprise-info, #3b82f6)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', fontSize: '13px', fontWeight: 700, color: 'var(--enterprise-gray-800)' }}>
                  <RefreshCw size={16} style={{ color: 'var(--enterprise-info)' }} /> In Transit
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--enterprise-gray-500)' }}>On Hand</span>
                  <span style={{ fontWeight: 600, color: 'var(--enterprise-info)' }}>{(distribution as any)?.inTransitQty ?? 0}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                  <span style={{ color: 'var(--enterprise-gray-500)' }}>Allocated</span>
                  <span style={{ fontWeight: 600, color: 'var(--enterprise-warning)' }}>{(distribution as any)?.blanketNextMonthReserved ?? 0}</span>
                </div>
              </div>
              {/* ≡ƒƒ⌐ S & V */}
              <div style={{ background: 'white', padding: '16px', borderRadius: '10px', border: '1px solid var(--enterprise-gray-200)', borderTop: '3px solid var(--enterprise-secondary, #6366f1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', fontSize: '13px', fontWeight: 700, color: 'var(--enterprise-gray-800)' }}>
                  <Package size={16} style={{ color: 'var(--enterprise-secondary)' }} /> S & V
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--enterprise-gray-500)' }}>On Hand</span>
                  <span style={{ fontWeight: 600, color: 'var(--enterprise-secondary)' }}>{(distribution as any)?.snvOnHand ?? 0}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                  <span style={{ color: 'var(--enterprise-gray-500)' }}>Reserved</span>
                  <span style={{ fontWeight: 600, color: 'var(--enterprise-warning)' }}>0</span>
                </div>
              </div>
              {/* ≡ƒƒÑ US Warehouse */}
              <div style={{ background: 'white', padding: '16px', borderRadius: '10px', border: '1px solid var(--enterprise-gray-200)', borderTop: '3px solid #ef4444' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', fontSize: '13px', fontWeight: 700, color: 'var(--enterprise-gray-800)' }}>
                  <Package size={16} style={{ color: '#ef4444' }} /> US Warehouse
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--enterprise-gray-500)' }}>On Hand</span>
                  <span style={{ fontWeight: 600, color: '#6366f1' }}>{(distribution as any)?.usTransitOnHand ?? 0}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '13px' }}>
                  <span style={{ color: 'var(--enterprise-gray-500)' }}>Reserved</span>
                  <span style={{ fontWeight: 600, color: 'var(--enterprise-warning)' }}>0</span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ TAB 3: BLANKET ORDERS ΓòÉΓòÉΓòÉΓòÉΓòÉΓòÉ */}
      <div style={tabContentStyle('blanketOrders')}>
        <div>
          <div style={{ position: 'sticky', top: 0, zIndex: 10, background: 'linear-gradient(180deg, white 0%, rgba(255,255,255,0.95) 100%)', paddingBottom: '16px', marginBottom: '8px', borderBottom: '1px solid var(--enterprise-gray-100)' }}>
            <div style={{ position: 'relative' }}>
              <Search size={18} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: 'var(--enterprise-gray-400)' }} />
              <input type="text" value={blanketSearch} onChange={(e) => setBlanketSearch(e.target.value)}
                placeholder="Search by BPA Number, MSN, Part Number, Customer Name..."
                style={{ width: '100%', padding: '12px 14px 12px 44px', border: '1.5px solid var(--enterprise-gray-200)', borderRadius: 'var(--border-radius-lg)', fontSize: 'var(--font-size-sm)', background: 'var(--enterprise-gray-50)', outline: 'none' }}
                onFocus={(e) => { e.target.style.borderColor = 'var(--enterprise-primary)'; e.target.style.background = 'white'; e.target.style.boxShadow = '0 0 0 3px rgba(30,58,138,0.1)'; }}
                onBlur={(e) => { e.target.style.borderColor = 'var(--enterprise-gray-200)'; e.target.style.background = 'var(--enterprise-gray-50)'; e.target.style.boxShadow = 'none'; }}
              />
              {blanketSearch && (
                <button onClick={() => setBlanketSearch('')} style={{ position: 'absolute', right: '14px', top: '50%', transform: 'translateY(-50%)', background: 'var(--enterprise-gray-200)', border: 'none', borderRadius: '50%', width: '20px', height: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: '12px', color: 'var(--enterprise-gray-600)' }}>├ù</button>
              )}
            </div>
          </div>
          {loadingOrders ? (
            <div style={{ textAlign: 'center', padding: '40px' }}><LoadingSpinner size={32} /><p style={{ marginTop: '12px', color: 'var(--enterprise-gray-600)' }}>Loading BPAs...</p></div>
          ) : blanketOrders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--enterprise-gray-500)' }}><Package size={48} style={{ display: 'block', margin: '0 auto 12px', opacity: 0.5 }} /><p>No BPAs found for this item.</p></div>
          ) : (() => {
            const s = blanketSearch.toLowerCase().trim();
            const filtered = s ? blanketOrders.filter(o => o.bpa_number.toLowerCase().includes(s) || o.master_serial_no.toLowerCase().includes(s) || o.part_number.toLowerCase().includes(s) || o.customer_name.toLowerCase().includes(s)) : blanketOrders;
            if (filtered.length === 0) return (
              <div style={{ textAlign: 'center', padding: '48px 24px', color: 'var(--enterprise-gray-500)', background: 'var(--enterprise-gray-50)', borderRadius: 'var(--border-radius-lg)', border: '1px dashed var(--enterprise-gray-200)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
                <Search size={40} style={{ marginBottom: '12px', opacity: 0.4 }} />
                <p style={{ fontWeight: 600, color: 'var(--enterprise-gray-600)' }}>No BPAs match your search</p>
              </div>
            );
            return (
              <div>
                <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)', marginBottom: '12px', paddingLeft: '4px' }}>
                  Showing <strong>{filtered.length}</strong> of <strong>{blanketOrders.length}</strong> BPA{blanketOrders.length !== 1 ? 's' : ''}
                </p>
                {filtered.map((order, idx) => <BlanketOrderRow key={order.id || idx} order={order} />)}
              </div>
            );
          })()}
        </div>
      </div>

      {/* ══════ TAB 4: BLANKET RELEASE (sub-invoices for this part) ══════ */}
      <div style={tabContentStyle('blanketRelease')}>
        {loadingReleases ? (
          <div style={{ textAlign: 'center', padding: '40px' }}>
            <LoadingSpinner size={32} />
            <p style={{ marginTop: '12px', color: 'var(--enterprise-gray-600)' }}>Loading releases…</p>
          </div>
        ) : subInvoiceLines.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 40px', background: 'var(--enterprise-gray-50)', borderRadius: 'var(--border-radius-lg)' }}>
            <div style={{ width: '80px', height: '80px', borderRadius: '50%', background: 'linear-gradient(135deg, var(--enterprise-gray-200) 0%, var(--enterprise-gray-300) 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
              <Clock size={36} style={{ color: 'var(--enterprise-gray-500)' }} />
            </div>
            <h3 style={{ color: 'var(--enterprise-gray-700)', marginBottom: '8px' }}>No Releases Yet</h3>
            <p style={{ color: 'var(--enterprise-gray-500)', fontSize: 'var(--font-size-sm)', maxWidth: '450px', margin: '0 auto', lineHeight: 1.6 }}>
              This part has not yet been released to a customer. Releases will appear here as sub-invoices are issued against an existing BPA.
            </p>
          </div>
        ) : (
          <ItemReleaseSections lines={subInvoiceLines} />
        )}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}><Button variant="primary" onClick={onClose}>Close</Button></div>
    </Modal>
  );
}

// ============================================================================
// ItemReleaseSections — two-bucket card layout for the Blanket Release tab
// ============================================================================

const DRAFT_STATUSES    = ['DRAFT', 'CONFIRMED', 'AWAITING_PICKUP'];
const DELIVERED_STATUSES = ['PICKED_UP', 'DELIVERED'];

function ItemReleaseSections({ lines }: { lines: any[] }) {
  const drafted   = lines.filter(l => DRAFT_STATUSES.includes(l.sub_invoice?.status));
  const delivered = lines.filter(l => DELIVERED_STATUSES.includes(l.sub_invoice?.status));
  const cancelled = lines.filter(l => l.sub_invoice?.status === 'CANCELLED');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
      <ItemReleaseSection
        title="Drafted · In Progress"
        subtitle="Releases created against a BPA, awaiting delivery"
        gradient="linear-gradient(135deg, #2563eb 0%, #1e3a8a 100%)"
        icon={<Clock size={18} color="#fff" />}
        items={drafted}
        emptyLabel="No drafted releases for this part."
        emphasis="open"
      />
      <ItemReleaseSection
        title="Completed Releases"
        subtitle="Delivered to customer and closed"
        gradient="linear-gradient(135deg, #16a34a 0%, #14532d 100%)"
        icon={<CheckCircle size={18} color="#fff" />}
        items={delivered}
        emptyLabel="No completed releases yet."
        emphasis="done"
        collapsedByDefault={drafted.length > 0}
      />
      {cancelled.length > 0 && (
        <ItemReleaseSection
          title="Cancelled"
          subtitle="Withdrawn or voided releases"
          gradient="linear-gradient(135deg, #6b7280 0%, #374151 100%)"
          icon={<XCircle size={18} color="#fff" />}
          items={cancelled}
          emptyLabel="No cancelled releases."
          emphasis="muted"
          collapsedByDefault
        />
      )}
    </div>
  );
}

function ItemReleaseSection({
  title, subtitle, gradient, icon, items, emptyLabel, emphasis, collapsedByDefault = false,
}: {
  title: string; subtitle: string; gradient: string; icon: React.ReactNode;
  items: any[]; emptyLabel: string; emphasis: 'open' | 'done' | 'muted'; collapsedByDefault?: boolean;
}) {
  const [open, setOpen] = useState(!collapsedByDefault);
  const totalQty = items.reduce((s, l) => s + Number(l.quantity ?? 0), 0);

  return (
    <div style={{ border: '1px solid var(--enterprise-gray-200)', borderRadius: 'var(--border-radius-lg)', overflow: 'hidden', background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.04)' }}>
      <div onClick={() => setOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: gradient, color: '#fff', cursor: 'pointer' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div style={{ width: '30px', height: '30px', borderRadius: '8px', background: 'rgba(255,255,255,0.18)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            {icon}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: '14px', letterSpacing: '0.2px' }}>{title}</div>
            <div style={{ fontSize: '11px', opacity: 0.85, marginTop: '1px' }}>{subtitle}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div style={{ textAlign: 'right', fontSize: '11px' }}>
            <div style={{ fontWeight: 700, fontSize: '15px' }}>{items.length}</div>
            <div style={{ opacity: 0.85 }}>{items.length === 1 ? 'release' : 'releases'}</div>
          </div>
          <div style={{ textAlign: 'right', fontSize: '11px', borderLeft: '1px solid rgba(255,255,255,0.2)', paddingLeft: '12px' }}>
            <div style={{ fontWeight: 700, fontSize: '13px', fontFamily: 'monospace' }}>{totalQty.toLocaleString()}</div>
            <div style={{ opacity: 0.85 }}>total qty</div>
          </div>
          <ChevronRight size={18} style={{ transform: open ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.2s ease' }} />
        </div>
      </div>

      {open && (
        <div style={{ padding: '12px 12px 4px', background: emphasis === 'muted' ? 'var(--enterprise-gray-50)' : 'white' }}>
          {items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '24px 0', color: 'var(--enterprise-gray-500)', fontSize: 13 }}>{emptyLabel}</div>
          ) : (
            items.map((line: any) => <ItemReleaseCard key={line.id} line={line} emphasis={emphasis} />)
          )}
        </div>
      )}
    </div>
  );
}

function ItemReleaseCard({ line, emphasis }: { line: any; emphasis: 'open' | 'done' | 'muted' }) {
  const [expanded, setExpanded] = useState(false);
  const si = line.sub_invoice || {};
  const done      = DELIVERED_STATUSES.includes(si.status);
  const cancelled = si.status === 'CANCELLED';
  const accent    = done ? '#16a34a' : cancelled ? '#6b7280' : 'var(--enterprise-primary)';
  const releaseNo = si.customer_po_number ?? si.sub_invoice_number ?? '—';

  return (
    <div style={{
      border: expanded ? `1.5px solid ${accent}` : '1px solid var(--enterprise-gray-200)',
      borderRadius: 'var(--border-radius-lg)',
      overflow: 'hidden',
      marginBottom: '8px',
      background: 'white',
      boxShadow: expanded ? '0 4px 14px rgba(30,58,138,0.1)' : '0 1px 2px rgba(0,0,0,0.03)',
      transition: 'all 0.2s cubic-bezier(0.4,0,0.2,1)',
      opacity: cancelled ? 0.75 : 1,
    }}>
      <div onClick={() => setExpanded(v => !v)} style={{ display: 'flex', cursor: 'pointer', background: expanded ? 'linear-gradient(135deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.07) 100%)' : 'white' }}>
        <div style={{ width: '32px', minWidth: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRight: '1px solid var(--enterprise-gray-100)', background: expanded ? accent : 'var(--enterprise-gray-50)' }}>
          <ChevronRight size={14} style={{ color: expanded ? 'white' : 'var(--enterprise-gray-500)', transform: expanded ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 0.25s ease' }} />
        </div>
        <div style={{ flex: 1, padding: '10px 16px' }}>
          {/* Row 1 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '18px', marginBottom: '8px' }}>
            <MiniField label="Release #">
              <span style={{ fontFamily: 'monospace', fontWeight: 700, color: accent, fontSize: 13 }}>{releaseNo}</span>
            </MiniField>
            <MiniField label="Need By">
              <span style={{ fontWeight: 600, color: si.blanket_release?.need_by_date && !done && !cancelled ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-700)', fontSize: 13 }}>
                {si.blanket_release?.need_by_date ? new Date(si.blanket_release.need_by_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
              </span>
            </MiniField>
            <MiniField label="Buyer">
              <span style={{ color: 'var(--enterprise-gray-700)', fontSize: 13 }}>{si.buyer_name ?? '—'}</span>
            </MiniField>
          </div>
          {/* Row 2 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 1fr', gap: '18px' }}>
            <MiniField label="Quantity">
              <span style={{ fontWeight: 700, color: 'var(--enterprise-success)', fontSize: 13 }}>{Number(line.quantity ?? 0).toLocaleString()}</span>
            </MiniField>
            <MiniField label="Pallets">
              <span style={{ fontWeight: 600, color: 'var(--enterprise-gray-800)', fontSize: 13 }}>{line.pallet_count ?? 0}</span>
            </MiniField>
            <MiniField label="Release Date">
              <span style={{ color: 'var(--enterprise-gray-700)', fontSize: 13 }}>
                {si.sub_invoice_date ? new Date(si.sub_invoice_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
              </span>
            </MiniField>
          </div>
        </div>
      </div>

      {expanded && (
        <div style={{ background: 'linear-gradient(180deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.01) 100%)', borderTop: '1px solid var(--enterprise-gray-200)', padding: '14px 48px' }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: accent, textTransform: 'uppercase', letterSpacing: '0.8px', marginBottom: '10px' }}>Release Details</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px' }}>
            <MiniDetailCard label="Sub-Invoice #"  value={si.sub_invoice_number ?? '—'} mono />
            <MiniDetailCard label="Total Pallets"  value={String(si.total_pallets ?? line.pallet_count ?? 0)} />
            <MiniDetailCard label="Total Qty"      value={Number(si.total_quantity ?? line.quantity ?? 0).toLocaleString()} />
            <MiniDetailCard label="Currency"       value={si.currency_code ?? 'USD'} />
          </div>
        </div>
      )}
    </div>
  );
}

function MiniField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</p>
      <div style={{ display: 'flex', alignItems: 'center', minHeight: 16 }}>{children}</div>
    </div>
  );
}

function MiniDetailCard({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ background: 'white', border: '1px solid var(--enterprise-gray-200)', borderRadius: 'var(--border-radius-md)', padding: '8px 10px' }}>
      <p style={{ fontSize: 9.5, fontWeight: 600, color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 3 }}>{label}</p>
      <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--enterprise-gray-800)', fontFamily: mono ? 'monospace' : 'inherit' }}>{value}</p>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

interface UnifiedItemMasterProps {
  userRole?: UserRole;
  userPerms?: Record<string, boolean>;
}

export function UnifiedItemMaster({ userRole, userPerms = {} }: UnifiedItemMasterProps) {
  // RBAC
  const hasPerms = Object.keys(userPerms).length > 0;
  const canAddItem = userRole === 'L3' || (hasPerms ? userPerms['items.create'] === true : userRole === 'L2');
  const canEditItem = userRole === 'L3' || (hasPerms ? userPerms['items.edit'] === true : false);
  const canDeleteItem = userRole === 'L3' || (hasPerms ? userPerms['items.delete'] === true : false);
  const canEditDelete = canEditItem || canDeleteItem;

  // ΓöÇΓöÇ Core state ΓöÇΓöÇ
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshLoading, setRefreshLoading] = useState(false);
  const [initialLoad, setInitialLoad] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState('');
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState('');
  const [cardFilter, setCardFilter] = useState<CardFilter>('ALL');
  const [page, setPage] = useState(0);
  const ITEMS_PER_PAGE = 20;

  // ΓöÇΓöÇ Sort state ΓöÇΓöÇ
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);

  // ΓöÇΓöÇ CRUD state ΓöÇΓöÇ
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [formData, setFormData] = useState<itemsApi.ItemFormData>(formDefault);
  const [originalFormData, setOriginalFormData] = useState<itemsApi.ItemFormData>(formDefault);
  const [weightStr, setWeightStr] = useState('');
  const [unitPriceStr, setUnitPriceStr] = useState('');
  const [standardCostStr, setStandardCostStr] = useState('');
  const [viewItem, setViewItem] = useState<Item | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<Item | null>(null);

  // ΓöÇΓöÇ Item counts (lightweight server-side) ΓöÇΓöÇ
  const [itemStats, setItemStats] = useState({ totalCount: 0, activeCount: 0, inactiveCount: 0 });
  const [totalCount, setTotalCount] = useState(0);

  // ΓöÇΓöÇ Actions dropdown ΓöÇΓöÇ
  const [activeDropdown, setActiveDropdown] = useState<string | null>(null);
  const [dropdownDirection, setDropdownDirection] = useState<'up' | 'down'>('down');
  const dropdownRef = useRef<HTMLDivElement | null>(null);

  // ΓöÇΓöÇ Toast ΓöÇΓöÇ
  const [toast, setToast] = useState<{ type: 'success' | 'error' | 'warning' | 'info'; title: string; text: string } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = useCallback((type: 'success' | 'error' | 'warning' | 'info', title: string, text: string, dur = 5000) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast({ type, title, text });
    toastTimer.current = setTimeout(() => setToast(null), dur);
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (activeDropdown && dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setActiveDropdown(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [activeDropdown]);

  // Summary counts now come back from `im_list-items` alongside the
  // paginated list — folded into fetchItems to save a round-trip.

  // ── Debounce search term (400ms) ──
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchTerm(searchTerm);
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // ── FETCH: Items + summary counts (backed by `im_list-items` edge fn) ──
  // Business logic is identical to the prior inline query:
  // same sort fallback, same card-filter semantics, same .or() search,
  // same page-size-based pagination.
  const fetchItems = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const res = await fetchWithAuth(getEdgeFunctionUrl('im_list-items'), {
        method: 'POST',
        body: JSON.stringify({
          page,
          page_size: ITEMS_PER_PAGE,
          card_filter: cardFilter,
          search_term: debouncedSearchTerm.trim() || undefined,
          sort_field: sortField || null,
          sort_direction: sortField ? sortDirection : null,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json?.success) {
        setError(json?.error || 'Failed to fetch items');
        setItems([]);
        setTotalCount(0);
        return;
      }

      setItems((json.items as Item[]) || []);
      setTotalCount(json.total_count ?? 0);
      setItemStats({
        totalCount: json.counts?.total ?? 0,
        activeCount: json.counts?.active ?? 0,
        inactiveCount: json.counts?.inactive ?? 0,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch items');
    } finally {
      setLoading(false);
    }
  }, [cardFilter, debouncedSearchTerm, page, sortField, sortDirection]);

  useEffect(() => { fetchItems(); }, [fetchItems]);
  useEffect(() => { if (!loading && initialLoad) setInitialLoad(false); }, [loading, initialLoad]);
  useEffect(() => { setPage(0); }, [cardFilter, debouncedSearchTerm]);

  // ΓöÇΓöÇ Filters ΓöÇΓöÇ
  const hasActiveFilters = cardFilter !== 'ALL';

  const handleCardClick = (filter: CardFilter) => setCardFilter(prev => prev === filter ? 'ALL' : filter);
  const handleClearFilters = () => { setCardFilter('ALL'); };

  // ΓöÇΓöÇ Refresh: reload data only (does NOT clear search or filters) ΓöÇΓöÇ
  const handleRefresh = async () => {
    setRefreshLoading(true);
    try {
      // Clear items first so user sees the table reload
      setItems([]);
      await fetchItems();
      showToast('success', 'Refreshed', 'Table data has been reloaded successfully.');
    } catch {
      showToast('error', 'Refresh Failed', 'Could not reload the table. Please try again.');
    } finally {
      setRefreshLoading(false);
    }
  };

  // ΓöÇΓöÇ Sort handler ΓöÇΓöÇ
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Cycle: asc ΓåÆ desc ΓåÆ none
      if (sortDirection === 'asc') setSortDirection('desc');
      else if (sortDirection === 'desc') { setSortField(null); setSortDirection(null); }
      else { setSortDirection('asc'); }
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // ΓöÇΓöÇ CRUD handlers ΓöÇΓöÇ
  const handleExport = () => exportItemsToExcel(items);

  // ΓöÇΓöÇ Check if form has changed (for Edit mode) ΓöÇΓöÇ
  const hasFormChanges = useCallback((): boolean => {
    if (!editingItem) return true; // always allow submit for new items
    const current = {
      ...formData,
      weight: weightStr ? parseFloat(weightStr) : null,
      unit_price: unitPriceStr ? parseFloat(unitPriceStr) : null,
      standard_cost: standardCostStr ? parseFloat(standardCostStr) : null,
    };
    return (
      current.item_name !== originalFormData.item_name ||
      current.uom !== originalFormData.uom ||
      current.revision !== originalFormData.revision ||
      current.lead_time_days !== originalFormData.lead_time_days ||
      current.is_active !== originalFormData.is_active ||
      current.weight !== originalFormData.weight ||
      current.unit_price !== originalFormData.unit_price ||
      current.standard_cost !== originalFormData.standard_cost
    );
  }, [editingItem, formData, originalFormData, weightStr, unitPriceStr, standardCostStr]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const isEditing = !!editingItem;

    // Don't submit if no changes in edit mode
    if (isEditing && !hasFormChanges()) {
      return;
    }

    // Normalize UOM before submitting
    const normalizedUom = normalizeUom(formData.uom);
    // Map display UOM back to DB value
    const dbUom = normalizedUom === 'NOS' ? 'NOS' : normalizedUom === 'Boxes' ? 'BOX' : normalizedUom;

    // Part number is canonical; fall back to MSN only if part_number missing
    const itemMsn = formData.part_number || formData.master_serial_no;
    const submitData = { ...formData, uom: dbUom, weight: weightStr ? parseFloat(weightStr) : null, unit_price: unitPriceStr ? parseFloat(unitPriceStr) : null, standard_cost: standardCostStr ? parseFloat(standardCostStr) : null };
    const result = editingItem ? await itemsApi.updateItem(editingItem.id, submitData) : await itemsApi.createItem(submitData);
    if (result.error) { showToast('error', isEditing ? 'Update Failed' : 'Creation Failed', result.error); return; }
    showToast('success', isEditing ? 'Item Updated' : 'Item Created', `Item "${itemMsn}" has been ${isEditing ? 'updated' : 'created'} successfully.`);
    handleCloseModal();
    fetchItems();
  };

  const handleEdit = (item: Item) => {
    setEditingItem(item);
    setWeightStr(item.weight != null ? String(item.weight) : '');
    setUnitPriceStr(item.unit_price != null ? String(item.unit_price) : '');
    setStandardCostStr(item.standard_cost != null ? String(item.standard_cost) : '');
    const data: itemsApi.ItemFormData = {
      item_name: item.item_name || '',
      uom: item.uom,
      unit_price: item.unit_price ?? null,
      standard_cost: item.standard_cost ?? null,
      weight: item.weight ?? null,
      lead_time_days: item.lead_time_days ?? '',
      is_active: item.is_active,
      master_serial_no: item.master_serial_no || '',
      revision: item.revision || '',
      part_number: item.part_number,
    };
    setFormData(data);
    setOriginalFormData(data);
    setShowModal(true);
  };

  const handleDeleteClick = (item: Item) => { setItemToDelete(item); setShowDeleteModal(true); };
  const handleDeleteConfirm = async (reason: string) => {
    if (!itemToDelete) return;
    const itemMsn = itemToDelete.part_number || itemToDelete.master_serial_no;
    const result = await itemsApi.deleteItem(itemToDelete.id, reason);
    if (result.error) { showToast('error', 'Deletion Failed', result.error); }
    else { showToast('success', 'Item Deactivated', `Item "${itemMsn}" has been deactivated. It stays in history for audit and can be restored if needed.`); fetchItems(); }
    setShowDeleteModal(false);
    setItemToDelete(null);
  };

  const handleView = (item: Item) => { setViewItem(item); setShowViewModal(true); };
  const handleCloseModal = () => { setShowModal(false); setEditingItem(null); setFormData(formDefault); setOriginalFormData(formDefault); setWeightStr(''); setUnitPriceStr(''); setStandardCostStr(''); };

  // ΓöÇΓöÇ Loading ΓöÇΓöÇ
  if (initialLoad) return <ModuleLoader moduleName="Item Details" icon={<Package size={24} style={{ color: 'var(--enterprise-primary)', animation: 'moduleLoaderSpin 0.8s linear infinite' }} />} />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {error && (
        <div style={{ backgroundColor: 'var(--enterprise-error-bg)', border: '1px solid var(--enterprise-error)', borderRadius: 'var(--border-radius-md)', padding: '12px' }}>
          <p style={{ color: 'var(--enterprise-error)', fontSize: 'var(--font-size-sm)' }}>{error}</p>
        </div>
      )}

      {/* ΓòÉΓòÉΓòÉ TOAST ΓòÉΓòÉΓòÉ */}
      {toast && (
        <div style={{
          position: 'fixed', top: '24px', right: '24px', zIndex: 10000,
          minWidth: '360px', maxWidth: '440px', padding: '16px 20px', borderRadius: '14px',
          background: toast.type === 'success' ? 'linear-gradient(135deg, #f0fdf4, #dcfce7)' : toast.type === 'error' ? 'linear-gradient(135deg, #fef2f2, #fee2e2)' : toast.type === 'warning' ? 'linear-gradient(135deg, #fffbeb, #fef3c7)' : 'linear-gradient(135deg, #eff6ff, #dbeafe)',
          border: `1.5px solid ${toast.type === 'success' ? '#86efac' : toast.type === 'error' ? '#fca5a5' : toast.type === 'warning' ? '#fcd34d' : '#93c5fd'}`,
          boxShadow: '0 10px 40px rgba(0,0,0,0.12)', display: 'flex', alignItems: 'flex-start', gap: '12px',
          animation: 'slideInDown 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          <div style={{
            width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
            background: toast.type === 'success' ? 'linear-gradient(135deg, #16a34a, #15803d)' : toast.type === 'error' ? 'linear-gradient(135deg, #dc2626, #b91c1c)' : toast.type === 'warning' ? 'linear-gradient(135deg, #f59e0b, #d97706)' : 'linear-gradient(135deg, #2563eb, #1d4ed8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            {toast.type === 'success' && <CheckCircle2 size={18} style={{ color: '#fff' }} />}
            {toast.type === 'error' && <XCircle size={18} style={{ color: '#fff' }} />}
            {toast.type === 'warning' && <AlertTriangle size={18} style={{ color: '#fff' }} />}
            {toast.type === 'info' && <Info size={18} style={{ color: '#fff' }} />}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13px', fontWeight: 800, color: toast.type === 'success' ? '#14532d' : toast.type === 'error' ? '#7f1d1d' : toast.type === 'warning' ? '#78350f' : '#1e3a5f', marginBottom: '2px' }}>{toast.title}</div>
            <div style={{ fontSize: '12px', fontWeight: 500, lineHeight: '1.5', color: toast.type === 'success' ? '#166534' : toast.type === 'error' ? '#991b1b' : toast.type === 'warning' ? '#92400e' : '#1e40af' }}>{toast.text}</div>
          </div>
          <button onClick={() => { if (toastTimer.current) clearTimeout(toastTimer.current); setToast(null); }} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '4px', borderRadius: '6px', display: 'flex', color: 'var(--enterprise-gray-400)', flexShrink: 0 }}><X size={16} /></button>
        </div>
      )}

      {/* ΓòÉΓòÉΓòÉ SUMMARY CARDS ΓÇö Total Items, Active Items, Inactive Items ΓòÉΓòÉΓòÉ */}
      <SummaryCardsGrid>
        <SummaryCard
          label="Total Items"
          value={itemStats.totalCount}
          icon={<Package size={22} style={{ color: 'var(--enterprise-primary)' }} />}
          color="var(--enterprise-primary)"
          bgColor="rgba(30, 58, 138, 0.1)"
          isActive={cardFilter === 'ALL'}
          onClick={() => handleCardClick('ALL')}
        />
        <SummaryCard
          label="Active Items"
          value={itemStats.activeCount}
          icon={<CheckCircle size={22} style={{ color: 'var(--enterprise-success)' }} />}
          color="var(--enterprise-success)"
          bgColor="rgba(34, 197, 94, 0.1)"
          isActive={cardFilter === 'ACTIVE'}
          onClick={() => handleCardClick('ACTIVE')}
        />
        <SummaryCard
          label="Inactive Items"
          value={itemStats.inactiveCount}
          icon={<AlertTriangle size={22} style={{ color: '#b91c1c' }} />}
          color="#b91c1c"
          bgColor="rgba(185, 28, 28, 0.1)"
          isActive={cardFilter === 'INACTIVE'}
          onClick={() => handleCardClick('INACTIVE')}
        />
      </SummaryCardsGrid>

      {/* ΓòÉΓòÉΓòÉ FILTER BAR ΓÇö Search across MSN, Part Number, Description ΓòÉΓòÉΓòÉ */}
      <SharedFilterBar>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
          <SearchBox
            value={searchTerm}
            onChange={setSearchTerm}
            placeholder="Search by MSN, Part Number, or Description..."
          />
        </div>
        <ActionBar>
          {hasActiveFilters && <ClearFiltersButton onClick={handleClearFilters} />}
          <RefreshButton onClick={handleRefresh} loading={refreshLoading} />
          <ExportCSVButton onClick={handleExport} />
          {canAddItem && <AddButton label="Add Item" onClick={() => setShowModal(true)} />}
        </ActionBar>
      </SharedFilterBar>

      {/* ΓòÉΓòÉΓòÉ ITEMS TABLE ΓòÉΓòÉΓòÉ */}
      <Card style={{ padding: 0, overflow: activeDropdown ? 'visible' : undefined }}>
        {items.length === 0 && !loading ? (
          <EmptyState
            icon={<Package size={48} />}
            title={hasActiveFilters ? "No Matching Items" : "No Items Found"}
            description={hasActiveFilters ? "Try adjusting your search or filter criteria" : "Create your first item to get started"}
            action={!hasActiveFilters && canAddItem ? { label: 'Add Item', onClick: () => setShowModal(true) } : undefined}
          />
        ) : (
          <>
            <div className="table-responsive" style={{ overflowX: activeDropdown ? 'visible' : 'auto', overflowY: activeDropdown ? 'visible' : undefined }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--table-header-bg)', borderBottom: '2px solid var(--table-border)' }}>
                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '50px' }}></th>
                    <th style={{ ...thStyle, minWidth: '120px', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('master_serial_no')} title={sortField === 'master_serial_no' ? (sortDirection === 'asc' ? 'Sorted AΓåÆZ ┬╖ Click for ZΓåÆA' : 'Sorted ZΓåÆA ┬╖ Click to clear') : 'Click to sort AΓåÆZ'}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: sortField === 'master_serial_no' ? 'var(--enterprise-primary)' : undefined }}>
                        MSN{sortField === 'master_serial_no' && <span style={{ fontSize: '10px', opacity: 0.8 }}>{sortDirection === 'asc' ? 'Γû▓' : 'Γû╝'}</span>}
                      </span>
                    </th>
                    <th style={{ ...thStyle, minWidth: '130px', cursor: 'pointer', userSelect: 'none' }} onClick={() => handleSort('part_number')} title={sortField === 'part_number' ? (sortDirection === 'asc' ? 'Sorted AΓåÆZ ┬╖ Click for ZΓåÆA' : 'Sorted ZΓåÆA ┬╖ Click to clear') : 'Click to sort AΓåÆZ'}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: sortField === 'part_number' ? 'var(--enterprise-primary)' : undefined }}>
                        Part Number{sortField === 'part_number' && <span style={{ fontSize: '10px', opacity: 0.8 }}>{sortDirection === 'asc' ? 'Γû▓' : 'Γû╝'}</span>}
                      </span>
                    </th>
                    <th style={{ ...thStyle, minWidth: '200px' }}>Description</th>
                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '60px' }}>REV</th>
                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '80px' }}>View</th>
                    {canEditDelete && <th style={{ ...thStyle, textAlign: 'center', minWidth: '120px' }}>Actions</th>}
                  </tr>
                </thead>
                <tbody style={{ minHeight: '120px' }}>
                  {items.map((item, index) => (
                    <tr
                      key={item.id}
                      style={{ backgroundColor: index % 2 === 0 ? 'white' : 'var(--table-stripe)', borderBottom: '1px solid var(--table-border)', transition: 'background-color var(--transition-fast)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--table-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = index % 2 === 0 ? 'white' : 'var(--table-stripe)'; }}
                    >
                      {/* Status Dot */}
                      <td style={{ ...tdStyle, textAlign: 'center', padding: '12px 8px' }}>
                        <ActiveStatusDot isActive={item.is_active} />
                      </td>
                      {/* MSN */}
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.85em', color: 'var(--enterprise-gray-600)' }}>{item.master_serial_no || '-'}</td>
                      {/* Part Number */}
                      <td style={{ ...tdStyle, fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-primary)' }}>{item.part_number || '-'}</td>
                      {/* Description */}
                      <td style={{ ...tdStyle, color: 'var(--enterprise-gray-700)', maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={item.item_name || ''}>{item.item_name || '-'}</td>
                      {/* Revision */}
                      <td style={{ ...tdStyle, textAlign: 'center' }}><Badge variant="info">{item.revision || '-'}</Badge></td>
                      {/* View */}
                      <td style={{ ...tdStyle, textAlign: 'center', padding: '8px 12px' }}>
                        <Button variant="tertiary" size="sm" icon={<Eye size={14} />} onClick={() => handleView(item)} style={{ minWidth: '55px' }}>View</Button>
                      </td>
                      {/* Actions */}
                      {canEditDelete && (
                        <td style={{ ...tdStyle, textAlign: 'center', padding: '8px 12px', position: 'relative' }}>
                          <div ref={activeDropdown === item.id ? dropdownRef : null} style={{ position: 'relative', display: 'inline-block' }}>
                            <button
                              onClick={(e) => {
                                if (activeDropdown === item.id) { setActiveDropdown(null); }
                                else {
                                  const rect = e.currentTarget.getBoundingClientRect();
                                  setDropdownDirection(window.innerHeight - rect.bottom < 160 ? 'up' : 'down');
                                  setActiveDropdown(item.id);
                                }
                              }}
                              style={{ padding: '8px 12px', border: '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: activeDropdown === item.id ? '#f8fafc' : 'white', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '13px', color: '#374151', fontWeight: 500, transition: 'all 0.15s ease' }}
                            >
                              <Settings size={16} />Actions
                              <ChevronDown size={14} style={{ transition: 'transform 0.2s', transform: activeDropdown === item.id ? 'rotate(180deg)' : 'rotate(0deg)' }} />
                            </button>
                            {activeDropdown === item.id && (
                              <div style={{
                                position: 'absolute',
                                ...(dropdownDirection === 'up' ? { bottom: '100%', marginBottom: '4px' } : { top: '100%', marginTop: '4px' }),
                                right: '0', zIndex: 9999, width: '180px', backgroundColor: 'white', borderRadius: '12px',
                                boxShadow: dropdownDirection === 'up' ? '0 -10px 40px rgba(0,0,0,0.15)' : '0 10px 40px rgba(0,0,0,0.15)',
                                border: '1px solid #e5e7eb', overflow: 'hidden',
                              }}>
                                {canEditItem && (
                                  <button onClick={() => { handleEdit(item); setActiveDropdown(null); }}
                                    style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: '14px', textAlign: 'left', color: '#374151' }}
                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#f8fafc'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                  ><Edit2 size={16} /> Edit Item</button>
                                )}
                                {canEditItem && canDeleteItem && <div style={{ borderTop: '1px solid #f3f4f6' }} />}
                                {canDeleteItem && (
                                  <button onClick={() => { handleDeleteClick(item); setActiveDropdown(null); }}
                                    style={{ width: '100%', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '10px', border: 'none', backgroundColor: 'transparent', cursor: 'pointer', fontSize: '14px', textAlign: 'left', color: '#ef4444' }}
                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#fef2f2'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                  ><Trash2 size={16} /> Delete Item</button>
                                )}
                              </div>
                            )}
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={ITEMS_PER_PAGE} totalCount={totalCount} onPageChange={setPage} />
          </>
        )}
      </Card>



      {/* ΓòÉΓòÉΓòÉ ADD/EDIT MODAL ΓòÉΓòÉΓòÉ */}
      <Modal isOpen={showModal} onClose={handleCloseModal} title={editingItem ? 'Edit Item' : 'Create New Item'} maxWidth="800px">
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Single Section: Item Identification */}
          <div style={{ ...sectionStyle, background: 'linear-gradient(135deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.08) 100%)', border: '1px solid rgba(30,58,138,0.1)' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-primary)', marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Item Details</p>

            {/* ΓöÇΓöÇ CREATE MODE ΓöÇΓöÇ */}
            {!editingItem && (
              <>
                {/* Row 1: MSN | Part Number (equal width) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <Label required>MSN</Label>
                    <Input value={formData.master_serial_no || ''} onChange={(e) => setFormData({ ...formData, master_serial_no: e.target.value })} placeholder="MSN-001" required />
                  </div>
                  <div>
                    <Label required>Part Number</Label>
                    <Input value={formData.part_number || ''} onChange={(e) => setFormData({ ...formData, part_number: e.target.value })} placeholder="FR-REF-123" required />
                  </div>
                </div>
                {/* Row 2: Description (large) | UOM (small) */}
                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <Label required>Description</Label>
                    <Input value={formData.item_name} onChange={(e) => setFormData({ ...formData, item_name: e.target.value })} placeholder="Item description..." required />
                  </div>
                  <div>
                    <Label required>UOM</Label>
                    <Select value={normalizeUom(formData.uom)} onChange={(e) => setFormData({ ...formData, uom: e.target.value })} required>
                      <option value="NOS">NOS</option>
                      <option value="KG">KG</option>
                      <option value="Boxes">Boxes</option>
                    </Select>
                  </div>
                </div>
                {/* Row 3: Revision | Weight (equal) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div><Label required>Revision</Label><Input value={formData.revision || ''} onChange={(e) => setFormData({ ...formData, revision: e.target.value })} placeholder="A / AB / 1A" required /></div>
                  <div><Label>Weight (G)</Label><Input type="text" value={weightStr} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setWeightStr(v); }} placeholder="0.0000" /></div>
                </div>
                {/* Row 4: Unit Price | Standard Cost (equal) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div><Label>Unit Price (Γé╣)</Label><Input type="text" value={unitPriceStr} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setUnitPriceStr(v); }} placeholder="0.00" /></div>
                  <div><Label>Standard Cost ($)</Label><Input type="text" value={standardCostStr} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setStandardCostStr(v); }} placeholder="0.00" /></div>
                </div>
                {/* Row 5: Lead Time | Status (equal) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div><Label required>Lead Time</Label><Input type="text" value={formData.lead_time_days} onChange={(e) => setFormData({ ...formData, lead_time_days: e.target.value })} placeholder="e.g. 15 days" required /></div>
                  <div><Label>Status</Label><Select value={formData.is_active ? 'active' : 'inactive'} onChange={(e) => setFormData({ ...formData, is_active: e.target.value === 'active' })}><option value="active">Active</option><option value="inactive">Inactive</option></Select></div>
                </div>
              </>
            )}

            {/* ΓöÇΓöÇ EDIT MODE ΓöÇΓöÇ */}
            {editingItem && (
              <>
                {/* Row 0: MSN | Part Number (read-only) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <Label required>MSN</Label>
                    <Input value={formData.master_serial_no || ''} disabled style={{ backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' }} />
                  </div>
                  <div>
                    <Label required>Part Number</Label>
                    <Input value={formData.part_number || ''} disabled style={{ backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' }} />
                  </div>
                </div>
                {/* Row 1: Description (mandatory, large) | UOM (small) */}
                <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div>
                    <Label required>Description</Label>
                    <Input value={formData.item_name} onChange={(e) => setFormData({ ...formData, item_name: e.target.value })} placeholder="Item description..." required />
                  </div>
                  <div>
                    <Label>UOM</Label>
                    <Select value={normalizeUom(formData.uom)} onChange={(e) => setFormData({ ...formData, uom: e.target.value })}>
                      <option value="NOS">NOS</option>
                      <option value="KG">KG</option>
                      <option value="Boxes">Boxes</option>
                    </Select>
                  </div>
                </div>
                {/* Row 2: Revision | Weight (equal) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div><Label required>Revision</Label><Input value={formData.revision || ''} onChange={(e) => setFormData({ ...formData, revision: e.target.value })} placeholder="A / AB / 1A" required /></div>
                  <div><Label>Weight (G)</Label><Input type="text" value={weightStr} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setWeightStr(v); }} placeholder="0.0000" /></div>
                </div>
                {/* Row 3: Lead Time | Status (equal) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div><Label required>Lead Time</Label><Input type="text" value={formData.lead_time_days} onChange={(e) => setFormData({ ...formData, lead_time_days: e.target.value })} placeholder="e.g. 15 days" required /></div>
                  <div><Label>Status</Label><Select value={formData.is_active ? 'active' : 'inactive'} onChange={(e) => setFormData({ ...formData, is_active: e.target.value === 'active' })}><option value="active">Active</option><option value="inactive">Inactive</option></Select></div>
                </div>
                {/* Row 4: Unit Price | Standard Cost (equal) */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div><Label>Unit Price (Γé╣)</Label><Input type="text" value={unitPriceStr} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setUnitPriceStr(v); }} placeholder="0.00" /></div>
                  <div><Label>Standard Cost ($)</Label><Input type="text" value={standardCostStr} onChange={(e) => { const v = e.target.value; if (v === '' || /^\d*\.?\d*$/.test(v)) setStandardCostStr(v); }} placeholder="0.00" /></div>
                </div>
              </>
            )}
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <Button type="submit" variant="primary" fullWidth disabled={editingItem ? !hasFormChanges() : false} style={{ padding: '12px 24px', fontWeight: 'var(--font-weight-semibold)', opacity: (editingItem && !hasFormChanges()) ? 0.5 : 1 }}>{editingItem ? 'Γ£ô Update Item' : '+ Create Item'}</Button>
            <Button type="button" variant="tertiary" fullWidth onClick={handleCloseModal} style={{ padding: '12px 24px' }}>Cancel</Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation */}
      <DeleteConfirmModal isOpen={showDeleteModal} onClose={() => { setShowDeleteModal(false); setItemToDelete(null); }} onConfirm={handleDeleteConfirm} item={itemToDelete} />

      {/* View Modal */}
      <ItemViewModal isOpen={showViewModal} onClose={() => setShowViewModal(false)} item={viewItem} />

      {/* Animations */}
      <style>{`
        @keyframes slideDown {
          from { opacity: 0; max-height: 0; }
          to { opacity: 1; max-height: 500px; }
        }
        @keyframes slideInDown {
          from { opacity: 0; transform: translateY(-20px) scale(0.95); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes tooltipFadeIn {
          from { opacity: 0; transform: translateY(-4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes tabFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}
      </style>
    </div>
  );
}

export default UnifiedItemMaster;
