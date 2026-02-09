/**
 * Item Master – Direct Supabase integration
 * 
 * SCHEMA ALIGNMENT: Uses snake_case DB column names exactly
 * NO TRANSFORMATION - frontend fields match database 1:1
 * 
 * Database: id, item_code, item_name, uom, unit_price, standard_cost, lead_time_days,
 *           is_active, created_at, updated_at, master_serial_no, revision, part_number
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Plus, Edit2, Trash2, Search, Package, Eye, ChevronDown, ChevronRight, AlertTriangle, Clock, Calendar, Download, X, XCircle, CheckCircle } from 'lucide-react';
import { Card, Button, Badge, Input, Select, Label, Modal, LoadingSpinner, EmptyState, Textarea } from './ui/EnterpriseUI';
import * as itemsApi from '../utils/api/itemsSupabase';
import { getSupabaseClient } from '../utils/supabase/client';

// Re-export Item type from API (uses snake_case, matches DB exactly)
type Item = itemsApi.Item;

/* ========== v_item_details VIEW INTERFACE ========== */

interface ViewItemDetails {
  id: string;
  item_code: string;
  item_name: string;
  uom: string;
  unit_price: number | null;
  standard_cost: number | null;
  lead_time_days: number;
  is_active: boolean;
  item_created_at: string;
  item_updated_at: string;
  master_serial_no: string | null;
  revision: string | null;
  part_number: string | null;
  // Blanket Order fields
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
  // Line fields
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

/* ========== BLANKET ORDER INTERFACE ========== */
/**
 * BlanketOrder - Represents contractual customer order (independent of delivery execution)
 * Data Source: v_item_details view
 * 
 * Upper Tab (Collapsed) - Part 1 (75%):
 *   Row 1: sap_doc_no, master_serial_no, part_number
 *   Row 2: customer_name, line_no, blanket_order_qty
 * Upper Tab (Collapsed) - Part 2 (25%):
 *   Row 1: customer_po_number
 *   Row 2: order_date
 * 
 * Lower Tab (Expanded): blanket_order_start, blanket_order_end, monthly_usage, next_delivery, 
 *                       order_multiples, min_stock, max_stock, safety_stock
 */
interface BlanketOrder {
  id: string;
  // Upper Tab - Part 1 Row 1
  sap_doc_no: string;           // Primary identifier (replaces order_number)
  master_serial_no: string;
  part_number: string;          // ERP-style identifier
  // Upper Tab - Part 1 Row 2
  customer_name: string;
  line_no: number;
  blanket_order_qty: number;
  // Upper Tab - Part 2
  customer_po_number: string;   // May be null, display as '—'
  order_date: string;           // Locale date format
  // Lower Tab (Expanded Section) - Unchanged
  blanket_order_start: string;
  blanket_order_end: string;
  monthly_usage: number;
  next_delivery: string;        // Maps to delivery_schedule in view
  order_multiples: number;      // Maps to order_multiple in view
  min_stock: number;
  max_stock: number;
  safety_stock: number;
}

/* ========== FORM DEFAULT (snake_case, matches DB) ========== */

const formDefault: itemsApi.ItemFormData = {
  item_code: '',
  item_name: '',
  uom: 'PCS',
  unit_price: null,
  standard_cost: null,
  lead_time_days: 0,
  is_active: true,
  master_serial_no: '',
  revision: '',
  part_number: '',
};

/* ========== STYLES ========== */

const thStyle: React.CSSProperties = {
  padding: '12px 16px',
  textAlign: 'left',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-semibold)',
  color: 'var(--enterprise-gray-700)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
};

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  fontSize: 'var(--font-size-base)',
  color: 'var(--enterprise-gray-800)',
};

const sectionStyle: React.CSSProperties = {
  borderRadius: 'var(--border-radius-md)',
  padding: '16px',
  marginBottom: '16px',
};

// ============================================================================
// CARD FILTER TYPE (for click-to-filter on summary cards)
// ============================================================================

type CardFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

// ============================================================================
// SUMMARY CARD COMPONENT (Clickable - matches InventoryGrid)
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
    <div
      onClick={onClick}
      style={{
        cursor: onClick ? 'pointer' : 'default',
        transition: 'all 0.2s ease',
      }}
    >
      <Card
        style={{
          border: isActive ? `2px solid ${color}` : '1px solid var(--enterprise-gray-200)',
          boxShadow: isActive ? `0 0 0 3px ${bgColor}` : 'var(--shadow-sm)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <p style={{
              fontSize: '12px',
              color: 'var(--enterprise-gray-600)',
              fontWeight: 500,
              marginBottom: '6px',
            }}>
              {label}
            </p>
            <p style={{
              fontSize: '1.75rem',
              fontWeight: 700,
              color,
            }}>
              {value}
            </p>
          </div>
          <div style={{
            width: '44px',
            height: '44px',
            borderRadius: '8px',
            backgroundColor: bgColor,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            {icon}
          </div>
        </div>
      </Card>
    </div>
  );
}

// ============================================================================
// FILTER BAR COMPONENT (matches InventoryGrid)
// ============================================================================

interface FilterBarProps {
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onExport: () => void;
  onAddItem: () => void;
  onClearFilters: () => void;
  hasActiveFilters: boolean;
}

function FilterBar({
  searchTerm,
  onSearchChange,
  onExport,
  onAddItem,
  onClearFilters,
  hasActiveFilters,
}: FilterBarProps) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      marginBottom: '16px',
      gap: '12px',
      flexWrap: 'wrap',
      background: 'white',
      padding: '10px 16px',
      borderRadius: '8px',
      border: '1px solid var(--enterprise-gray-200)',
    }}>
      {/* Search - Elongated */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        background: 'var(--enterprise-gray-50)',
        border: '1px solid var(--enterprise-gray-300)',
        borderRadius: '6px',
        padding: '8px 12px',
        flex: 1,
        minWidth: '280px',
      }}>
        <Search size={18} style={{ color: 'var(--enterprise-gray-400)', marginRight: '10px', flexShrink: 0 }} />
        <input
          type="text"
          placeholder="Search by item code, item name..."
          value={searchTerm}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{
            border: 'none',
            outline: 'none',
            flex: 1,
            fontSize: '13px',
            color: 'var(--enterprise-gray-800)',
            background: 'transparent',
            minWidth: '180px',
          }}
        />
        {searchTerm && (
          <button
            onClick={() => onSearchChange('')}
            style={{
              background: 'var(--enterprise-gray-200)',
              border: 'none',
              cursor: 'pointer',
              padding: '4px',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '4px',
              marginLeft: '8px',
            }}
          >
            <X size={14} style={{ color: 'var(--enterprise-gray-600)' }} />
          </button>
        )}
      </div>

      {/* Actions - Right Side */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
        {/* Clear Filters - Only show when filters active */}
        {hasActiveFilters && (
          <button
            onClick={onClearFilters}
            style={{
              padding: '0 12px',
              height: '36px',
              borderRadius: '6px',
              border: '1px solid #dc2626',
              background: 'white',
              color: '#dc2626',
              fontSize: '13px',
              fontWeight: 500,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
              whiteSpace: 'nowrap',
            }}
          >
            <XCircle size={16} />
            Clear Filters
          </button>
        )}

        {/* Export Button */}
        <button
          onClick={onExport}
          style={{
            padding: '0 14px',
            height: '36px',
            borderRadius: '6px',
            border: '1px solid var(--enterprise-gray-300)',
            background: 'white',
            color: 'var(--enterprise-gray-700)',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <Download size={14} />
          Export CSV
        </button>

        {/* Add Item Button - Primary action */}
        <button
          onClick={onAddItem}
          style={{
            padding: '0 14px',
            height: '36px',
            borderRadius: '6px',
            border: 'none',
            background: '#1e3a8a',
            color: 'white',
            fontSize: '13px',
            fontWeight: 500,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            whiteSpace: 'nowrap',
          }}
        >
          <Plus size={14} />
          Add Item
        </button>
      </div>
    </div>
  );
}

// ============================================================================
// CSV EXPORT UTILITY
// ============================================================================

function exportItemsToCSV(data: itemsApi.Item[], filename: string = 'items_export') {
  const headers = [
    'Item Code',
    'Part Number',
    'Master Serial No',
    'Item Name',
    'Revision',
    'UOM',
    'Unit Price',
    'Standard Cost',
    'Lead Time (Days)',
    'Status',
  ];

  const rows = data.map(item => [
    item.item_code,
    item.part_number || '',
    item.master_serial_no || '',
    item.item_name || '',
    item.revision || '',
    item.uom,
    item.unit_price ?? '',
    item.standard_cost ?? '',
    item.lead_time_days,
    item.is_active ? 'Active' : 'Inactive',
  ]);

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell =>
      typeof cell === 'string' && (cell.includes(',') || cell.includes('"'))
        ? `"${cell.replace(/"/g, '""')}"`
        : cell
    ).join(','))
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', `${filename}_${new Date().toISOString().split('T')[0]}.csv`);
  link.style.visibility = 'hidden';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/* ========== DELETE CONFIRMATION MODAL ========== */

interface DeleteConfirmModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
  item: Item | null;
}

function DeleteConfirmModal({ isOpen, onClose, onConfirm, item }: DeleteConfirmModalProps) {
  const [partNumberInput, setPartNumberInput] = useState('');
  const [deletionReason, setDeletionReason] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) {
      setPartNumberInput('');
      setDeletionReason('');
      setError('');
    }
  }, [isOpen]);

  const handleConfirm = () => {
    if (!item) return;

    // Validate Part Number match
    if (partNumberInput.trim() !== item.part_number) {
      setError('Part Number does not match. Please enter the exact Part Number to confirm deletion.');
      return;
    }

    // Validate deletion reason
    if (!deletionReason.trim()) {
      setError('Please provide a reason for deletion.');
      return;
    }

    setError('');
    onConfirm(deletionReason.trim());
  };

  if (!item) return null;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Confirm Item Deletion" maxWidth="500px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
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
              You are about to permanently delete this item. Please confirm by entering the Part Number below.
            </p>
          </div>
        </div>

        {/* Item Info Display */}
        <div style={{
          background: 'var(--enterprise-gray-50)',
          borderRadius: 'var(--border-radius-md)',
          padding: '16px',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', marginBottom: '4px' }}>Item Code</p>
              <p style={{ fontWeight: 'var(--font-weight-semibold)' }}>{item.item_code}</p>
            </div>
            <div>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', marginBottom: '4px' }}>Part Number</p>
              <p style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-primary)' }}>{item.part_number}</p>
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', textTransform: 'uppercase', marginBottom: '4px' }}>MSN</p>
              <p style={{ fontFamily: 'monospace' }}>{item.master_serial_no || '-'}</p>
            </div>
          </div>
        </div>

        {/* Part Number Confirmation Input */}
        <div>
          <Label required>Type Part Number to Confirm</Label>
          <Input
            value={partNumberInput}
            onChange={(e) => setPartNumberInput(e.target.value)}
            placeholder={`Enter "${item.part_number}" to confirm`}
          />
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', marginTop: '4px' }}>
            Must match exactly: <strong>{item.part_number}</strong>
          </p>
        </div>

        {/* Deletion Reason */}
        <div>
          <Label required>Reason for Deletion</Label>
          <Textarea
            value={deletionReason}
            onChange={(e) => setDeletionReason(e.target.value)}
            placeholder="Please provide the reason for deleting this item..."
            rows={3}
          />
        </div>

        {/* Error Message */}
        {error && (
          <div style={{
            background: 'rgba(220,38,38,0.1)',
            border: '1px solid rgba(220,38,38,0.3)',
            borderRadius: 'var(--border-radius-sm)',
            padding: '12px',
            color: 'var(--enterprise-error)',
            fontSize: 'var(--font-size-sm)',
          }}>
            {error}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
          <Button variant="tertiary" onClick={onClose}>Cancel</Button>
          <Button
            variant="danger"
            onClick={handleConfirm}
            disabled={!partNumberInput.trim() || !deletionReason.trim()}
            icon={<Trash2 size={16} />}
          >
            Delete Item
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ========== BLANKET ORDER ACCORDION ROW ========== */

/**
 * Premium ERP-grade Accordion Row for Blanket Order display
 * 
 * Upper Tab (Collapsed) - 75/25 Layout:
 *   Part 1 (75%): Row 1 - SAP Doc No, MSN, Part Number | Row 2 - Customer Name, Line No, Blanket Qty
 *   Part 2 (25%): Row 1 - Customer PO Number | Row 2 - Order Date
 * 
 * Lower Tab (Expanded): Unchanged - 8 detail fields in card grid
 */

interface BlanketOrderRowProps {
  order: BlanketOrder;
}

function BlanketOrderRow({ order }: BlanketOrderRowProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Styles for upper tab labels
  const upperLabelStyle: React.CSSProperties = {
    fontSize: '10px',
    color: 'var(--enterprise-gray-500)',
    marginBottom: '2px',
    textTransform: 'uppercase',
    letterSpacing: '0.4px',
    fontWeight: 500,
  };

  // Styles for upper tab values
  const upperValueStyle: React.CSSProperties = {
    fontSize: 'var(--font-size-sm)',
    fontWeight: 600,
    color: 'var(--enterprise-gray-800)',
    lineHeight: 1.3,
  };

  // Card style for expanded detail items (Lower Tab - unchanged)
  const detailCardStyle: React.CSSProperties = {
    background: 'white',
    padding: '12px 14px',
    borderRadius: 'var(--border-radius-sm)',
    border: '1px solid var(--enterprise-gray-100)',
    boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
  };

  const labelStyle: React.CSSProperties = {
    fontSize: 'var(--font-size-xs)',
    color: 'var(--enterprise-gray-500)',
    marginBottom: '4px',
    textTransform: 'uppercase',
    letterSpacing: '0.3px',
  };

  return (
    <div style={{
      border: isExpanded ? '1.5px solid var(--enterprise-primary)' : '1px solid var(--enterprise-gray-200)',
      borderRadius: 'var(--border-radius-lg)',
      overflow: 'hidden',
      marginBottom: '10px',
      transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
      boxShadow: isExpanded
        ? '0 8px 24px rgba(30,58,138,0.12), 0 2px 8px rgba(0,0,0,0.06)'
        : '0 1px 3px rgba(0,0,0,0.04)',
      background: 'white',
    }}>
      {/* ====== UPPER TAB (Collapsed View) ====== */}
      {/* Layout: Toggle | Part 1 (75%) | Part 2 (25%) */}
      <div
        onClick={() => setIsExpanded(!isExpanded)}
        style={{
          display: 'flex',
          cursor: 'pointer',
          background: isExpanded
            ? 'linear-gradient(135deg, rgba(30,58,138,0.04) 0%, rgba(30,58,138,0.08) 100%)'
            : 'white',
          transition: 'all 0.2s ease',
          minHeight: '80px',
        }}
        onMouseEnter={(e) => { if (!isExpanded) e.currentTarget.style.background = 'linear-gradient(135deg, #fafbfc 0%, #f1f5f9 100%)'; }}
        onMouseLeave={(e) => { if (!isExpanded) e.currentTarget.style.background = 'white'; }}
      >
        {/* Expand/Collapse Toggle */}
        <div style={{
          width: '36px',
          minWidth: '36px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRight: '1px solid var(--enterprise-gray-100)',
          background: isExpanded ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-50)',
          transition: 'all 0.2s ease',
        }}>
          <div style={{
            transition: 'transform 0.25s ease',
            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
          }}>
            <ChevronRight size={16} style={{ color: isExpanded ? 'white' : 'var(--enterprise-gray-500)' }} />
          </div>
        </div>

        {/* ====== PART 1 (75% - flex: 3) ====== */}
        <div style={{
          flex: 3,
          padding: '12px 20px',
          borderRight: '1px solid var(--enterprise-gray-100)',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}>
          {/* Row 1: SAP Doc No, Master Serial No, Part Number */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '24px',
            marginBottom: '8px',
          }}>
            {/* SAP Document Number - Primary Identifier */}
            <div>
              <p style={upperLabelStyle}>SAP Document No</p>
              <p style={{
                ...upperValueStyle,
                color: 'var(--enterprise-primary)',
                fontWeight: 700,
              }}>
                {order.sap_doc_no}
              </p>
            </div>
            {/* Master Serial No */}
            <div>
              <p style={upperLabelStyle}>Master Serial No</p>
              <p style={{ ...upperValueStyle, fontFamily: 'monospace' }}>
                {order.master_serial_no}
              </p>
            </div>
            {/* Part Number - ERP Identifier */}
            <div>
              <p style={upperLabelStyle}>Part Number</p>
              <p style={{
                ...upperValueStyle,
                color: 'var(--enterprise-info, #3b82f6)',
                fontWeight: 700,
                background: 'rgba(59,130,246,0.1)',
                padding: '2px 8px',
                borderRadius: '4px',
                display: 'inline-block',
              }}>
                {order.part_number}
              </p>
            </div>
          </div>

          {/* Row 2: Customer Name, Line Number, Blanket Quantity */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: '24px',
          }}>
            {/* Customer Name */}
            <div>
              <p style={upperLabelStyle}>Customer Name</p>
              <p style={{ ...upperValueStyle, color: 'var(--enterprise-gray-700)' }}>
                {order.customer_name}
              </p>
            </div>
            {/* Line Number */}
            <div>
              <p style={upperLabelStyle}>Line No</p>
              <Badge variant="info" style={{ fontWeight: 700, fontSize: '12px' }}>{order.line_no}</Badge>
            </div>
            {/* Blanket Quantity */}
            <div>
              <p style={upperLabelStyle}>Blanket Quantity</p>
              <p style={{
                ...upperValueStyle,
                color: 'var(--enterprise-success)',
                fontWeight: 700,
              }}>
                {order.blanket_order_qty.toLocaleString()}
              </p>
            </div>
          </div>
        </div>

        {/* ====== PART 2 (25% - flex: 1) ====== */}
        <div style={{
          flex: 1,
          padding: '12px 20px',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          background: 'var(--enterprise-gray-50)',
          minWidth: '180px',
        }}>
          {/* Row 1: Customer PO Number */}
          <div style={{ marginBottom: '8px' }}>
            <p style={upperLabelStyle}>Customer PO Number</p>
            <p style={{
              ...upperValueStyle,
              fontFamily: 'monospace',
              color: order.customer_po_number === '—' ? 'var(--enterprise-gray-400)' : 'var(--enterprise-gray-800)',
            }}>
              {order.customer_po_number}
            </p>
          </div>
          {/* Row 2: Order Date */}
          <div>
            <p style={upperLabelStyle}>Order Date</p>
            <p style={{
              ...upperValueStyle,
              color: 'var(--enterprise-gray-700)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}>
              <Calendar size={12} style={{ color: 'var(--enterprise-gray-400)' }} />
              {order.order_date ? new Date(order.order_date).toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
              }) : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* ====== EXPANDED SECTION (Additional Details) ====== */}
      {/* Fields: blanket_order_start, blanket_order_end, monthly_usage, next_delivery, order_multiples, min_stock, max_stock, safety_stock */}
      {isExpanded && (
        <div style={{
          background: 'linear-gradient(180deg, rgba(30,58,138,0.04) 0%, rgba(30,58,138,0.02) 100%)',
          borderTop: '1px solid var(--enterprise-gray-200)',
          padding: '20px 54px 20px 54px',
          animation: 'slideDown 0.25s ease-out',
        }}>
          <p style={{
            fontSize: 'var(--font-size-xs)',
            fontWeight: 'var(--font-weight-bold)',
            color: 'var(--enterprise-primary)',
            textTransform: 'uppercase',
            letterSpacing: '0.8px',
            marginBottom: '16px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
          }}>
            <Package size={14} /> Order Details
          </p>

          {/* First Row: Dates and Usage */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px', marginBottom: '14px' }}>
            <div style={detailCardStyle}>
              <p style={labelStyle}>Blanket Order Start</p>
              <p style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-gray-800)' }}>
                {order.blanket_order_start ? new Date(order.blanket_order_start).toLocaleDateString() : '-'}
              </p>
            </div>
            <div style={detailCardStyle}>
              <p style={labelStyle}>Blanket Order End</p>
              <p style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-gray-800)' }}>
                {order.blanket_order_end ? new Date(order.blanket_order_end).toLocaleDateString() : '-'}
              </p>
            </div>
            <div style={detailCardStyle}>
              <p style={labelStyle}>Monthly Usage</p>
              <p style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-info)', fontSize: 'var(--font-size-lg)' }}>
                {(order.monthly_usage || 0).toLocaleString()}
              </p>
            </div>
            <div style={{ ...detailCardStyle, background: 'linear-gradient(135deg, rgba(34,197,94,0.05) 0%, rgba(34,197,94,0.1) 100%)', border: '1px solid rgba(34,197,94,0.2)' }}>
              <p style={{ ...labelStyle, color: 'var(--enterprise-success)' }}>Next Delivery</p>
              <p style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-success)' }}>
                {order.next_delivery ? new Date(order.next_delivery).toLocaleDateString() : 'Not Scheduled'}
              </p>
            </div>
          </div>

          {/* Second Row: Stock Parameters */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '14px' }}>
            <div style={detailCardStyle}>
              <p style={labelStyle}>Order Multiples</p>
              <p style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-gray-800)' }}>
                {order.order_multiples || 1}
              </p>
            </div>
            <div style={detailCardStyle}>
              <p style={labelStyle}>Min Stock</p>
              <p style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-warning)' }}>
                {(order.min_stock || 0).toLocaleString()}
              </p>
            </div>
            <div style={detailCardStyle}>
              <p style={labelStyle}>Max Stock</p>
              <p style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-success)' }}>
                {(order.max_stock || 0).toLocaleString()}
              </p>
            </div>
            <div style={detailCardStyle}>
              <p style={labelStyle}>Safety Stock</p>
              <p style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-secondary, #6366f1)' }}>
                {(order.safety_stock || 0).toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ========== VIEW MODAL COMPONENT WITH TABS ========== */

function ItemViewModal({ isOpen, onClose, item }: { isOpen: boolean; onClose: () => void; item: Item | null }) {
  const [activeTab, setActiveTab] = useState<'details' | 'blanketOrders' | 'blanketRelease'>('details');
  const [blanketOrders, setBlanketOrders] = useState<BlanketOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [blanketSearch, setBlanketSearch] = useState('');

  // Reset search when modal closes
  useEffect(() => {
    if (!isOpen) {
      setBlanketSearch('');
    }
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && item && activeTab === 'blanketOrders') {
      fetchBlanketOrders();
    }
  }, [isOpen, item, activeTab]);

  const fetchBlanketOrders = async () => {
    if (!item) return;
    setLoadingOrders(true);
    try {
      const supabase = getSupabaseClient();

      // Fetch from v_item_details view - contains all item + blanket order data
      const { data, error } = await supabase
        .from('v_item_details')
        .select('*')
        .eq('id', item.id);

      if (error) {
        console.error('Error fetching from v_item_details:', error);
        setBlanketOrders([]);
        return;
      }

      // Filter out rows without blanket order data (item might have no orders)
      const ordersData = (data || []).filter((row: ViewItemDetails) => row.blanket_order_id !== null);

      if (ordersData.length === 0) {
        // No blanket orders exist for this item
        setBlanketOrders([]);
      } else {
        // Transform v_item_details rows to BlanketOrder interface
        // Map DB columns to UI fields (snake_case preserved)
        const transformed: BlanketOrder[] = ordersData.map((row: ViewItemDetails, idx: number) => ({
          id: row.line_id || row.blanket_order_id || `order-${idx}`,
          // Upper Tab - Part 1 Row 1
          sap_doc_no: row.sap_doc_no || '—',
          master_serial_no: row.master_serial_no || '—',
          part_number: row.part_number || '—',
          // Upper Tab - Part 1 Row 2
          customer_name: row.customer_name || '—',
          line_no: row.line_number ?? idx + 1,
          blanket_order_qty: row.blanket_quantity ?? row.item_quantity ?? 0,
          // Upper Tab - Part 2
          customer_po_number: row.customer_po_number || '—',
          order_date: row.order_date || '',
          // Lower Tab (Expanded) - Unchanged
          blanket_order_start: row.blanket_order_start || '',
          blanket_order_end: row.blanket_order_end || '',
          monthly_usage: row.monthly_usage ?? 0,
          next_delivery: row.delivery_schedule || '',
          order_multiples: row.order_multiple ?? 1,
          min_stock: row.min_stock ?? 0,
          max_stock: row.max_stock ?? 0,
          safety_stock: row.safety_stock ?? 0,
        }));
        setBlanketOrders(transformed);
      }
    } catch (err) {
      console.error('Error fetching blanket orders:', err);
      setBlanketOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  };

  if (!item) return null;

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    padding: '12px 20px',
    border: 'none',
    background: isActive ? 'var(--enterprise-primary)' : 'transparent',
    color: isActive ? 'white' : 'var(--enterprise-gray-600)',
    cursor: 'pointer',
    fontWeight: 'var(--font-weight-semibold)',
    borderRadius: 'var(--border-radius-md) var(--border-radius-md) 0 0',
    transition: 'all 0.2s ease',
    fontSize: 'var(--font-size-sm)',
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="View Item Details" maxWidth="1000px">
      <div style={{ display: 'flex', borderBottom: '2px solid var(--enterprise-gray-200)', marginBottom: '20px' }}>
        <button style={tabStyle(activeTab === 'details')} onClick={() => setActiveTab('details')}>Item Details</button>
        <button style={tabStyle(activeTab === 'blanketOrders')} onClick={() => setActiveTab('blanketOrders')}>Blanket Orders</button>
        <button style={tabStyle(activeTab === 'blanketRelease')} onClick={() => setActiveTab('blanketRelease')}>Blanket Release</button>
        {/* PHASE 2 — Packaging module (intentionally disabled, do not remove)
        <button style={tabStyle(activeTab === 'packaging')} onClick={() => setActiveTab('packaging')}>
          <Box size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />Packaging
        </button>
        */}
      </div>

      {/* ITEM DETAILS TAB */}
      {activeTab === 'details' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div><Label>Item Code</Label><Input value={item.item_code || '-'} disabled /></div>
            <div><Label>Part Number</Label><Input value={item.part_number || '-'} disabled /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div><Label>Item Name</Label><Input value={item.item_name || '-'} disabled /></div>
            <div><Label>Unit of Measure</Label><Input value={item.uom || '-'} disabled /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div><Label>Master Serial No</Label><Input value={item.master_serial_no || '-'} disabled /></div>
            <div><Label>Revision</Label><Input value={item.revision || '-'} disabled /></div>
            <div><Label>Lead Time (Days)</Label><Input value={item.lead_time_days || '-'} disabled /></div>
          </div>
          <div style={{ borderTop: '1px solid var(--enterprise-gray-200)', paddingTop: '16px', marginTop: '8px' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-gray-600)', marginBottom: '12px' }}>Pricing</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div><Label>Unit Price</Label><Input value={item.unit_price != null ? `₹${item.unit_price.toLocaleString()}` : '-'} disabled /></div>
              <div><Label>Standard Cost</Label><Input value={item.standard_cost != null ? `₹${item.standard_cost.toLocaleString()}` : '-'} disabled /></div>
              <div><Label>Status</Label><Input value={item.is_active ? 'Active' : 'Inactive'} disabled /></div>
            </div>
          </div>
          <div><Label>Created At</Label><Input value={item.created_at ? new Date(item.created_at).toLocaleString() : '-'} disabled /></div>
        </div>
      )}

      {/* BLANKET ORDERS TAB */}
      {/* Blanket Order = contractual customer order, independent of delivery execution */}
      {/* Data Source: v_item_details view */}
      {activeTab === 'blanketOrders' && (
        <div>
          {/* Search Bar - Sticky at top */}
          <div style={{
            position: 'sticky',
            top: 0,
            zIndex: 10,
            background: 'linear-gradient(180deg, white 0%, rgba(255,255,255,0.95) 100%)',
            paddingBottom: '16px',
            marginBottom: '8px',
            borderBottom: '1px solid var(--enterprise-gray-100)',
          }}>
            <div style={{ position: 'relative' }}>
              <Search size={18} style={{
                position: 'absolute',
                left: '14px',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--enterprise-gray-400)'
              }} />
              <input
                type="text"
                value={blanketSearch}
                onChange={(e) => setBlanketSearch(e.target.value)}
                placeholder="Search by SAP Doc No, MSN, Part Number, Customer Name, or PO Number..."
                style={{
                  width: '100%',
                  padding: '12px 14px 12px 44px',
                  border: '1.5px solid var(--enterprise-gray-200)',
                  borderRadius: 'var(--border-radius-lg)',
                  fontSize: 'var(--font-size-sm)',
                  background: 'var(--enterprise-gray-50)',
                  transition: 'all 0.2s ease',
                  outline: 'none',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'var(--enterprise-primary)';
                  e.target.style.background = 'white';
                  e.target.style.boxShadow = '0 0 0 3px rgba(30,58,138,0.1)';
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'var(--enterprise-gray-200)';
                  e.target.style.background = 'var(--enterprise-gray-50)';
                  e.target.style.boxShadow = 'none';
                }}
              />
              {blanketSearch && (
                <button
                  onClick={() => setBlanketSearch('')}
                  style={{
                    position: 'absolute',
                    right: '14px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'var(--enterprise-gray-200)',
                    border: 'none',
                    borderRadius: '50%',
                    width: '20px',
                    height: '20px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: 'var(--enterprise-gray-600)',
                  }}
                >
                  ×
                </button>
              )}
            </div>
            {blanketSearch && (
              <p style={{
                fontSize: '12px',
                color: 'var(--enterprise-gray-500)',
                marginTop: '8px',
                paddingLeft: '4px',
              }}>
                Filtering by: <strong>"{blanketSearch}"</strong>
              </p>
            )}
          </div>

          {/* Content */}
          {loadingOrders ? (
            <div style={{ textAlign: 'center', padding: '40px' }}>
              <LoadingSpinner size={32} />
              <p style={{ marginTop: '12px', color: 'var(--enterprise-gray-600)' }}>Loading blanket orders...</p>
            </div>
          ) : blanketOrders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--enterprise-gray-500)' }}>
              <Package size={48} style={{ marginBottom: '12px', opacity: 0.5 }} />
              <p>No blanket orders found for this item.</p>
            </div>
          ) : (() => {
            // In-memory search filter
            const searchTerm = blanketSearch.toLowerCase().trim();
            const filteredOrders = searchTerm
              ? blanketOrders.filter(order =>
                order.sap_doc_no.toLowerCase().includes(searchTerm) ||
                order.master_serial_no.toLowerCase().includes(searchTerm) ||
                order.part_number.toLowerCase().includes(searchTerm) ||
                order.customer_name.toLowerCase().includes(searchTerm) ||
                order.customer_po_number.toLowerCase().includes(searchTerm)
              )
              : blanketOrders;

            if (filteredOrders.length === 0) {
              return (
                <div style={{
                  textAlign: 'center',
                  padding: '48px 24px',
                  color: 'var(--enterprise-gray-500)',
                  background: 'var(--enterprise-gray-50)',
                  borderRadius: 'var(--border-radius-lg)',
                  border: '1px dashed var(--enterprise-gray-200)',
                }}>
                  <Search size={40} style={{ marginBottom: '12px', opacity: 0.4 }} />
                  <p style={{ fontWeight: 600, color: 'var(--enterprise-gray-600)' }}>No blanket orders match your search</p>
                  <p style={{ fontSize: 'var(--font-size-sm)', marginTop: '4px' }}>
                    Try adjusting your search terms or <button
                      onClick={() => setBlanketSearch('')}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--enterprise-primary)',
                        cursor: 'pointer',
                        textDecoration: 'underline',
                        fontSize: 'inherit',
                      }}
                    >clear the filter</button>
                  </p>
                </div>
              );
            }

            return (
              <div>
                {/* Order count indicator */}
                <div style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '12px',
                  paddingLeft: '4px',
                }}>
                  <p style={{ fontSize: '12px', color: 'var(--enterprise-gray-500)' }}>
                    Showing <strong>{filteredOrders.length}</strong> of <strong>{blanketOrders.length}</strong> blanket order{blanketOrders.length !== 1 ? 's' : ''}
                  </p>
                </div>
                {/* Order Rows - Accordion Cards */}
                {filteredOrders.map((order, idx) => (
                  <BlanketOrderRow key={order.id || idx} order={order} />
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {/* BLANKET RELEASE TAB */}
      {/* 
       * Blanket Release = Delivery Reflector
       * - Displays delivery details once deliveries are made
       * - Supports planning for future deliveries of the same blanket order
       * - Implementation deferred until delivery module is ready
       */}
      {activeTab === 'blanketRelease' && (
        <div style={{
          textAlign: 'center',
          padding: '60px 40px',
          background: 'var(--enterprise-gray-50)',
          borderRadius: 'var(--border-radius-lg)',
        }}>
          <div style={{
            width: '80px',
            height: '80px',
            borderRadius: '50%',
            background: 'linear-gradient(135deg, var(--enterprise-gray-200) 0%, var(--enterprise-gray-300) 100%)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 20px',
          }}>
            <Clock size={36} style={{ color: 'var(--enterprise-gray-500)' }} />
          </div>
          <h3 style={{ color: 'var(--enterprise-gray-700)', marginBottom: '8px' }}>Blanket Release</h3>
          <p style={{ color: 'var(--enterprise-gray-500)', fontSize: 'var(--font-size-sm)', maxWidth: '450px', margin: '0 auto', lineHeight: 1.6 }}>
            This section will display delivery details and support planning for future deliveries.
            <br />
            <strong>Implementation begins after the Delivery module is ready.</strong>
          </p>
          <Badge variant="neutral" style={{ marginTop: '20px' }}>Pending Delivery Module</Badge>
        </div>
      )}

      {/* PHASE 2 — Packaging module (intentionally disabled, do not remove)
      {activeTab === 'packaging' && (
        <div>
          {!item.packaging?.enabled ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--enterprise-gray-500)' }}>
              <Box size={48} style={{ marginBottom: '12px', opacity: 0.5 }} />
              <p>No packaging rules defined for this item.</p>
              <p style={{ fontSize: 'var(--font-size-sm)', marginTop: '8px' }}>This item is dispatched in loose units.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              ... packaging display code ...
            </div>
          )}
        </div>
      )}
      */}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '20px' }}><Button variant="primary" onClick={onClose}>Close</Button></div>
    </Modal>
  );
}

/* ========== MAIN COMPONENT ========== */

export function ItemMasterSupabase() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState<itemsApi.ItemFormData>(formDefault);
  const [viewItem, setViewItem] = useState<Item | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);

  // Card filter state for click-to-filter
  const [cardFilter, setCardFilter] = useState<CardFilter>('ALL');

  // Delete confirmation state
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [itemToDelete, setItemToDelete] = useState<Item | null>(null);

  // Pagination state - show 20 items at a time
  const [displayCount, setDisplayCount] = useState(20);
  const ITEMS_PER_PAGE = 20;

  const fetchItems = useCallback(async () => {
    setError(null);
    setLoading(true);
    const result = await itemsApi.fetchItems();
    setLoading(false);
    if (result.error) {
      setError(result.error);
      setItems([]);
      return;
    }
    setItems(result.data ?? []);
  }, []);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  // Calculate stats from items (always from full data)
  const stats = useMemo(() => ({
    totalCount: items.length,
    activeCount: items.filter(i => i.is_active).length,
    inactiveCount: items.filter(i => !i.is_active).length,
  }), [items]);

  // Filter items based on search and card filter (frontend-only, no refetch)
  const filteredItems = useMemo(() => {
    let result = items;

    // Apply card filter
    if (cardFilter === 'ACTIVE') {
      result = result.filter(item => item.is_active === true);
    } else if (cardFilter === 'INACTIVE') {
      result = result.filter(item => item.is_active === false);
    }

    // Apply search filter (case-insensitive) - includes part_number and master_serial_no
    if (searchTerm.trim()) {
      const search = searchTerm.toLowerCase();
      result = result.filter(item =>
        item.item_code.toLowerCase().includes(search) ||
        (item.item_name || '').toLowerCase().includes(search) ||
        (item.part_number || '').toLowerCase().includes(search) ||
        (item.master_serial_no || '').toLowerCase().includes(search)
      );
    }

    return result;
  }, [items, cardFilter, searchTerm]);

  // Paginated items - only show displayCount items
  const displayedItems = useMemo(() => {
    return filteredItems.slice(0, displayCount);
  }, [filteredItems, displayCount]);

  // Check if there are more items to load
  const hasMoreItems = displayCount < filteredItems.length;

  // Reset display count when filters change
  useEffect(() => {
    setDisplayCount(ITEMS_PER_PAGE);
  }, [cardFilter, searchTerm]);

  // Check if any CARD filters are active (not search - search has its own X button)
  const hasActiveFilters = cardFilter !== 'ALL';

  // Handle card click - toggle filter
  const handleCardClick = (filter: CardFilter) => {
    setCardFilter(prev => prev === filter ? 'ALL' : filter);
  };

  // Handle clear filters (cards only - search has its own X button)
  const handleClearFilters = () => {
    setCardFilter('ALL');
  };

  // Handle load more
  const handleLoadMore = () => {
    setDisplayCount(prev => prev + ITEMS_PER_PAGE);
  };

  // Handle export
  const handleExport = () => {
    exportItemsToCSV(filteredItems, 'item_master');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = editingItem
      ? await itemsApi.updateItem(editingItem.id, formData)
      : await itemsApi.createItem(formData);

    if (result.error) {
      setError(result.error);
      return;
    }
    handleCloseModal();
    fetchItems();
  };

  const handleEdit = (item: Item) => {
    setEditingItem(item);
    setFormData({
      item_code: item.item_code,
      item_name: item.item_name || '',
      uom: item.uom,
      unit_price: item.unit_price ?? null,
      standard_cost: item.standard_cost ?? null,
      lead_time_days: item.lead_time_days,
      is_active: item.is_active,
      master_serial_no: item.master_serial_no || '',
      revision: item.revision || '',
      part_number: item.part_number || '',
    });
    setShowModal(true);
  };

  // Delete flow with confirmation
  const handleDeleteClick = (item: Item) => {
    setItemToDelete(item);
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async (deletionReason: string) => {
    if (!itemToDelete) return;

    // NOTE: deletion_reason will be sent to backend when endpoint supports it
    console.log('Deletion reason:', deletionReason);

    const result = await itemsApi.deleteItem(itemToDelete.id);
    if (result.error) {
      setError(result.error);
    } else {
      fetchItems();
    }
    setShowDeleteModal(false);
    setItemToDelete(null);
  };

  const handleView = (item: Item) => {
    setViewItem(item);
    setShowViewModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData(formDefault);
  };

  if (loading) return <LoadingSpinner />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {error && (
        <div style={{ backgroundColor: 'var(--enterprise-error-bg)', border: '1px solid var(--enterprise-error)', borderRadius: 'var(--border-radius-md)', padding: '12px' }}>
          <p style={{ color: 'var(--enterprise-error)', fontSize: 'var(--font-size-sm)' }}>{error}</p>
        </div>
      )}

      {/* Summary Cards - Responsive & Clickable (matches InventoryGrid) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
        gap: '16px',
      }}>
        <SummaryCard
          label="Total Items"
          value={stats.totalCount}
          icon={<Package size={22} style={{ color: 'var(--enterprise-primary)' }} />}
          color="var(--enterprise-primary)"
          bgColor="rgba(30, 58, 138, 0.1)"
          isActive={cardFilter === 'ALL'}
          onClick={() => handleCardClick('ALL')}
        />
        <SummaryCard
          label="Active Items"
          value={stats.activeCount}
          icon={<CheckCircle size={22} style={{ color: 'var(--enterprise-success)' }} />}
          color="var(--enterprise-success)"
          bgColor="rgba(34, 197, 94, 0.1)"
          isActive={cardFilter === 'ACTIVE'}
          onClick={() => handleCardClick('ACTIVE')}
        />
        <SummaryCard
          label="Inactive Items"
          value={stats.inactiveCount}
          icon={<AlertTriangle size={22} style={{ color: 'var(--enterprise-gray-500)' }} />}
          color="var(--enterprise-gray-500)"
          bgColor="rgba(107, 114, 128, 0.1)"
          isActive={cardFilter === 'INACTIVE'}
          onClick={() => handleCardClick('INACTIVE')}
        />
      </div>

      {/* Filter Bar - Elongated Search + Export + Add Item (matches InventoryGrid) */}
      <FilterBar
        searchTerm={searchTerm}
        onSearchChange={setSearchTerm}
        onExport={handleExport}
        onAddItem={() => setShowModal(true)}
        onClearFilters={handleClearFilters}
        hasActiveFilters={hasActiveFilters}
      />

      {/* Items Table - PRIMARY IDENTIFIER: Part Number */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {filteredItems.length === 0 ? (
          <EmptyState
            icon={<Package size={48} />}
            title={hasActiveFilters ? "No Matching Items" : "No Items Found"}
            description={
              hasActiveFilters
                ? "Try adjusting your search or filter criteria"
                : "Create your first item or check sign-in and RLS on public.items"
            }
            action={!hasActiveFilters ? { label: 'Add Item', onClick: () => setShowModal(true) } : undefined}
          />
        ) : (
          <>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--table-header-bg)', borderBottom: '2px solid var(--table-border)' }}>
                    <th style={{ ...thStyle, minWidth: '100px' }}>Item Code</th>
                    <th style={{ ...thStyle, minWidth: '120px' }}>Part Number</th>
                    <th style={{ ...thStyle, minWidth: '100px' }}>MSN</th>
                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '60px' }}>Rev</th>
                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '60px' }}>UOM</th>
                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '80px' }}>Lead Time</th>
                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '80px' }}>Status</th>
                    <th style={{ ...thStyle, textAlign: 'center', minWidth: '200px', width: '200px' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedItems.map((item, index) => (
                    <tr
                      key={item.id}
                      style={{
                        backgroundColor: index % 2 === 0 ? 'white' : 'var(--table-stripe)',
                        borderBottom: '1px solid var(--table-border)',
                        transition: 'background-color var(--transition-fast)',
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--table-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = index % 2 === 0 ? 'white' : 'var(--table-stripe)'; }}
                    >
                      <td style={{ ...tdStyle, fontWeight: 'var(--font-weight-medium)', color: 'var(--enterprise-gray-700)' }}>{item.item_code}</td>
                      <td style={{ ...tdStyle, fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-primary)' }}>{item.part_number || '-'}</td>
                      <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.85em', color: 'var(--enterprise-gray-600)' }}>{item.master_serial_no || '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}><Badge variant="info">{item.revision || '-'}</Badge></td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{item.uom}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}>{item.lead_time_days} days</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}><Badge variant={item.is_active ? 'success' : 'neutral'}>{item.is_active ? 'Active' : 'Inactive'}</Badge></td>
                      <td style={{ ...tdStyle, textAlign: 'center', padding: '8px 12px' }}>
                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
                          <Button variant="secondary" size="sm" icon={<Edit2 size={14} />} onClick={() => handleEdit(item)} style={{ minWidth: '55px' }}>Edit</Button>
                          <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => handleDeleteClick(item)} style={{ minWidth: '65px' }}>Delete</Button>
                          <Button variant="tertiary" size="sm" icon={<Eye size={14} />} onClick={() => handleView(item)} style={{ minWidth: '55px' }}>View</Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Load More Button - Outside scrollable area */}
            {hasMoreItems && (
              <div style={{
                padding: '20px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
                borderTop: '1px solid var(--table-border)',
                position: 'relative',
                zIndex: 10,
                backgroundColor: 'white',
              }}>
                <p style={{
                  fontSize: '13px',
                  color: 'var(--enterprise-gray-500)',
                  margin: 0,
                }}>
                  Showing {displayedItems.length} of {filteredItems.length} items
                </p>
                <Button
                  variant="primary"
                  onClick={handleLoadMore}
                >
                  Load More ({Math.min(ITEMS_PER_PAGE, filteredItems.length - displayedItems.length)} more)
                </Button>
              </div>
            )}

            {/* Show total when all loaded */}
            {!hasMoreItems && displayedItems.length > 0 && (
              <div style={{
                padding: '16px',
                textAlign: 'center',
                borderTop: '1px solid var(--table-border)',
              }}>
                <p style={{
                  fontSize: '13px',
                  color: 'var(--enterprise-gray-500)',
                }}>
                  Showing all {filteredItems.length} items
                </p>
              </div>
            )}
          </>
        )}
      </Card>

      {/* ADD/EDIT MODAL */}
      <Modal isOpen={showModal} onClose={handleCloseModal} title={editingItem ? 'Edit Item' : 'Create New Item'} maxWidth="800px">
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>

          {/* Section: Item Identification */}
          <div style={{ ...sectionStyle, background: 'linear-gradient(135deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.08) 100%)', border: '1px solid rgba(30,58,138,0.1)' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-primary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Item Identification</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div>
                <Label required>Item Code</Label>
                <Input value={formData.item_code} onChange={(e) => setFormData({ ...formData, item_code: e.target.value })} placeholder="FG-001" required disabled={!!editingItem} style={editingItem ? { backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' } : {}} />
              </div>
              <div>
                <Label required>Master Serial No</Label>
                <Input value={formData.master_serial_no || ''} onChange={(e) => setFormData({ ...formData, master_serial_no: e.target.value })} placeholder="MSN-001" required disabled={!!editingItem} style={editingItem ? { backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' } : {}} />
              </div>
              <div>
                <Label required>Part Number</Label>
                <Input value={formData.part_number || ''} onChange={(e) => setFormData({ ...formData, part_number: e.target.value })} placeholder="FR-REF-123" required disabled={!!editingItem} style={editingItem ? { backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' } : {}} />
              </div>
            </div>
            <div style={{ marginTop: '16px' }}>
              <Label>Item Name</Label>
              <Input value={formData.item_name} onChange={(e) => setFormData({ ...formData, item_name: e.target.value })} placeholder="Item name / description..." disabled={!!editingItem} style={editingItem ? { backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' } : {}} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
              <div>
                <Label required>Unit of Measure</Label>
                <Select value={formData.uom} onChange={(e) => setFormData({ ...formData, uom: e.target.value })} required disabled={!!editingItem} style={editingItem ? { backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' } : {}}>
                  <option value="PCS">Pieces (PCS)</option>
                  <option value="KG">Kilograms (KG)</option>
                  <option value="L">Liters (L)</option>
                  <option value="M">Meters (M)</option>
                  <option value="BOX">Box (BOX)</option>
                </Select>
              </div>
            </div>
          </div>

          {/* Section: Editable Fields */}
          <div style={{ ...sectionStyle, background: 'linear-gradient(135deg, rgba(34,197,94,0.03) 0%, rgba(34,197,94,0.08) 100%)', border: '1px solid rgba(34,197,94,0.15)' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-success)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{editingItem ? '✏️ Editable Fields' : 'Configuration'}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div>
                <Label required>Revision</Label>
                <Input value={formData.revision || ''} onChange={(e) => setFormData({ ...formData, revision: e.target.value })} placeholder="A / AB / 1A" required />
              </div>
              <div>
                <Label required>Lead Time (Days)</Label>
                <Input type="number" value={formData.lead_time_days} onChange={(e) => setFormData({ ...formData, lead_time_days: parseInt(e.target.value) || 0 })} placeholder="Enter days" required min={0} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={formData.is_active ? 'active' : 'inactive'} onChange={(e) => setFormData({ ...formData, is_active: e.target.value === 'active' })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
              <div>
                <Label>Unit Price (₹)</Label>
                <Input type="number" value={formData.unit_price != null ? String(formData.unit_price) : ''} onChange={(e) => setFormData({ ...formData, unit_price: e.target.value ? parseFloat(e.target.value) : null })} placeholder="0.00" min={0} step="0.01" />
              </div>
              <div>
                <Label>Standard Cost (₹)</Label>
                <Input type="number" value={formData.standard_cost != null ? String(formData.standard_cost) : ''} onChange={(e) => setFormData({ ...formData, standard_cost: e.target.value ? parseFloat(e.target.value) : null })} placeholder="0.00" min={0} step="0.01" />
              </div>
            </div>
          </div>

          {/* PHASE 2 — Packaging module (intentionally disabled, do not remove)
          <div style={{ ...sectionStyle, background: 'linear-gradient(135deg, rgba(168,85,247,0.03) 0%, rgba(168,85,247,0.08) 100%)', border: '1px solid rgba(168,85,247,0.15)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'rgb(168,85,247)', textTransform: 'uppercase', letterSpacing: '0.5px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Box size={16} /> Packaging Details
              </p>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={formData.packaging?.enabled || false}
                  onChange={(e) => togglePackaging(e.target.checked)}
                  style={{ width: '18px', height: '18px', accentColor: 'rgb(168,85,247)' }}
                />
                <span style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)' }}>This item has defined packaging rules</span>
              </label>
            </div>
            ... packaging form content ...
          </div>
          */}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <Button type="submit" variant="primary" fullWidth style={{ padding: '12px 24px', fontWeight: 'var(--font-weight-semibold)' }}>
              {editingItem ? '✓ Update Item' : '+ Create Item'}
            </Button>
            <Button type="button" variant="tertiary" fullWidth onClick={handleCloseModal} style={{ padding: '12px 24px' }}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>

      {/* Delete Confirmation Modal */}
      <DeleteConfirmModal
        isOpen={showDeleteModal}
        onClose={() => { setShowDeleteModal(false); setItemToDelete(null); }}
        onConfirm={handleDeleteConfirm}
        item={itemToDelete}
      />

      <ItemViewModal isOpen={showViewModal} onClose={() => setShowViewModal(false)} item={viewItem} />

      {/* Animation keyframes */}
      <style>{`
        @keyframes slideDown {
          from {
            opacity: 0;
            max-height: 0;
          }
          to {
            opacity: 1;
            max-height: 500px;
          }
        }
      `}</style>
    </div>
  );
}
