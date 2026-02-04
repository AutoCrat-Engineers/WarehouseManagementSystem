/**
 * Item Master – fetches and edits items via direct Supabase client (public.items).
 * Uses the current DB schema: id, item_code, item_name, uom, min_stock_level, max_stock_level,
 * safety_stock, lead_time_days, is_active. No Edge Function; auth is the user's Supabase session.
 * 
 * Extended with Packaging Details support for multi-level packaging configurations.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, Search, Package, Eye, Box, Layers, X, Check } from 'lucide-react';
import { Card, Button, Badge, Input, Select, Label, Modal, LoadingSpinner, EmptyState } from './ui/EnterpriseUI';
import * as itemsApi from '../utils/api/itemsSupabase';
import { getSupabaseClient } from '../utils/supabase/client';

type Item = itemsApi.ItemForm & { id: string; createdAt: string };

/* ========== DEFAULT VALUES ========== */

const defaultPackagingConfig: itemsApi.PackagingConfig = {
  name: '',
  type: 'SIMPLE',
  isDefault: false,
  levels: [{ label: 'Box', quantity: 10 }],
  allowInnerDispatch: false,
  allowLooseDispatch: false,
  minDispatchQty: 1,
};

const formDefault: itemsApi.ItemForm = {
  itemCode: '',
  description: '',
  uom: 'PCS',
  minStock: 0,
  maxStock: 0,
  safetyStock: 0,
  leadTimeDays: '',
  status: 'active',
  revision: '',
  masterSerialNo: '',
  partNumber: '',
  packaging: {
    enabled: false,
    configs: [],
  },
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

/* ========== PACKAGING CONFIG CARD ========== */

interface PackagingCardProps {
  config: itemsApi.PackagingConfig;
  index: number;
  onUpdate: (index: number, config: itemsApi.PackagingConfig) => void;
  onRemove: (index: number) => void;
  onSetDefault: (index: number) => void;
}

function PackagingCard({ config, index, onUpdate, onRemove, onSetDefault }: PackagingCardProps) {
  const updateField = <K extends keyof itemsApi.PackagingConfig>(key: K, value: itemsApi.PackagingConfig[K]) => {
    onUpdate(index, { ...config, [key]: value });
  };

  const updateLevel = (levelIndex: number, field: 'label' | 'quantity', value: string | number) => {
    const newLevels = [...config.levels];
    // For quantity field, allow empty/0 for easier editing
    const processedValue = field === 'quantity'
      ? (value === '' || value === 0 ? 0 : Number(value) || 0)
      : value;
    newLevels[levelIndex] = { ...newLevels[levelIndex], [field]: processedValue };
    onUpdate(index, { ...config, levels: newLevels });
  };

  const handleTypeChange = (type: 'SIMPLE' | 'NESTED') => {
    if (type === 'SIMPLE') {
      // Keep the first level if it exists, otherwise use default
      const firstLevel = config.levels[0] || { label: 'Box', quantity: 10 };
      onUpdate(index, { ...config, type, levels: [firstLevel] });
    } else {
      // For nested, preserve existing levels if they exist, otherwise use defaults
      const masterLevel = config.levels[0] || { label: 'Master Box', quantity: 50 };
      const innerLevel = config.levels[1] || { label: 'Inner Box', quantity: 10 };
      onUpdate(index, {
        ...config,
        type,
        levels: [masterLevel, innerLevel],
      });
    }
  };

  // Calculate min dispatch qty from smallest package
  const calculatedMinDispatch = config.levels.length > 0
    ? Math.min(...config.levels.map(l => l.quantity))
    : 1;

  return (
    <div style={{
      background: 'white',
      border: config.isDefault ? '2px solid var(--enterprise-primary)' : '1px solid var(--enterprise-gray-200)',
      borderRadius: 'var(--border-radius-md)',
      padding: '16px',
      position: 'relative',
    }}>
      {/* Default Badge */}
      {config.isDefault && (
        <div style={{
          position: 'absolute',
          top: '-10px',
          right: '12px',
          background: 'var(--enterprise-primary)',
          color: 'white',
          padding: '2px 10px',
          borderRadius: '10px',
          fontSize: 'var(--font-size-xs)',
          fontWeight: 'var(--font-weight-semibold)',
        }}>
          DEFAULT
        </div>
      )}

      {/* Header Row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
        <div style={{ flex: 1, marginRight: '12px' }}>
          <Label>Packaging Name</Label>
          <Input
            value={config.name}
            onChange={(e) => updateField('name', e.target.value)}
            placeholder="e.g., Box of 10, Master Box 50"
          />
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', paddingTop: '24px' }}>
          {!config.isDefault && (
            <Button variant="secondary" size="sm" onClick={() => onSetDefault(index)} icon={<Check size={14} />}>
              Set Default
            </Button>
          )}
          <Button variant="danger" size="sm" onClick={() => onRemove(index)} icon={<X size={14} />}>
            Remove
          </Button>
        </div>
      </div>

      {/* Packaging Type */}
      <div style={{ marginBottom: '16px' }}>
        <Label>Packaging Type</Label>
        <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="radio"
              checked={config.type === 'SIMPLE'}
              onChange={() => handleTypeChange('SIMPLE')}
              style={{ accentColor: 'var(--enterprise-primary)' }}
            />
            <span style={{ fontSize: 'var(--font-size-sm)' }}>Simple (Single-Level)</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
            <input
              type="radio"
              checked={config.type === 'NESTED'}
              onChange={() => handleTypeChange('NESTED')}
              style={{ accentColor: 'var(--enterprise-primary)' }}
            />
            <span style={{ fontSize: 'var(--font-size-sm)' }}>Nested (Master + Inner)</span>
          </label>
        </div>
      </div>

      {/* SIMPLE Packaging */}
      {config.type === 'SIMPLE' && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(34,197,94,0.03) 0%, rgba(34,197,94,0.08) 100%)',
          borderRadius: 'var(--border-radius-md)',
          padding: '12px',
          border: '1px solid rgba(34,197,94,0.15)',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <Label>Package Label</Label>
              <Select value={config.levels[0]?.label || 'Box'} onChange={(e) => updateLevel(0, 'label', e.target.value)}>
                <option value="Box">Box</option>
                <option value="Carton">Carton</option>
                <option value="Packet">Packet</option>
                <option value="Bundle">Bundle</option>
                <option value="Bag">Bag</option>
              </Select>
            </div>
            <div>
              <Label>Quantity per Package</Label>
              <Input
                type="number"
                value={config.levels[0]?.quantity ?? ''}
                onChange={(e) => updateLevel(0, 'quantity', e.target.value === '' ? 0 : parseInt(e.target.value))}
                min={0}
                placeholder="Enter quantity"
              />
            </div>
          </div>
          <div style={{
            marginTop: '12px',
            padding: '10px',
            background: 'white',
            borderRadius: 'var(--border-radius-sm)',
            fontFamily: 'monospace',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--enterprise-gray-700)',
          }}>
            📦 1 {config.levels[0]?.label || 'Box'} = {config.levels[0]?.quantity || 10} units
          </div>
        </div>
      )}

      {/* NESTED Packaging */}
      {config.type === 'NESTED' && (
        <div style={{
          background: 'linear-gradient(135deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.08) 100%)',
          borderRadius: 'var(--border-radius-md)',
          padding: '12px',
          border: '1px solid rgba(30,58,138,0.12)',
        }}>
          {/* Master Pack */}
          <p style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-primary)', marginBottom: '8px', textTransform: 'uppercase' }}>
            Master Pack
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
            <div>
              <Label>Label</Label>
              <Input
                value={config.levels[0]?.label ?? ''}
                onChange={(e) => updateLevel(0, 'label', e.target.value)}
                placeholder="e.g., Master Box"
              />
            </div>
            <div>
              <Label>Quantity (Total Units)</Label>
              <Input
                type="number"
                value={config.levels[0]?.quantity ?? ''}
                onChange={(e) => updateLevel(0, 'quantity', e.target.value === '' ? 0 : parseInt(e.target.value))}
                min={0}
                placeholder="Enter total units"
              />
            </div>
          </div>

          {/* Inner Pack */}
          <p style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-info)', marginBottom: '8px', textTransform: 'uppercase' }}>
            Inner Pack
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }}>
            <div>
              <Label>Label</Label>
              <Input
                value={config.levels[1]?.label ?? ''}
                onChange={(e) => updateLevel(1, 'label', e.target.value)}
                placeholder="e.g., Inner Box"
              />
            </div>
            <div>
              <Label>Quantity (Units per Inner)</Label>
              <Input
                type="number"
                value={config.levels[1]?.quantity ?? ''}
                onChange={(e) => updateLevel(1, 'quantity', e.target.value === '' ? 0 : parseInt(e.target.value))}
                min={0}
                placeholder="Enter units per inner"
              />
            </div>
          </div>

          {/* Preview */}
          <div style={{
            marginTop: '12px',
            padding: '10px',
            background: 'white',
            borderRadius: 'var(--border-radius-sm)',
            fontFamily: 'monospace',
            fontSize: 'var(--font-size-sm)',
            color: 'var(--enterprise-gray-700)',
          }}>
            📦 1 {config.levels[0]?.label || 'Master Box'} ({config.levels[0]?.quantity || 50})<br />
            &nbsp;&nbsp;↳ {Math.floor((config.levels[0]?.quantity || 50) / (config.levels[1]?.quantity || 10))} × {config.levels[1]?.label || 'Inner Box'} ({config.levels[1]?.quantity || 10} each)
          </div>
        </div>
      )}

      {/* Dispatch Rules */}
      <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--enterprise-gray-200)' }}>
        <p style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-gray-600)', marginBottom: '10px', textTransform: 'uppercase' }}>
          Dispatch Rules
        </p>
        <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
          {config.type === 'NESTED' && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
              <input
                type="checkbox"
                checked={config.allowInnerDispatch}
                onChange={(e) => updateField('allowInnerDispatch', e.target.checked)}
                style={{ accentColor: 'var(--enterprise-primary)' }}
              />
              Allow dispatch in inner packs
            </label>
          )}
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', fontSize: 'var(--font-size-sm)' }}>
            <input
              type="checkbox"
              checked={config.allowLooseDispatch}
              onChange={(e) => updateField('allowLooseDispatch', e.target.checked)}
              style={{ accentColor: 'var(--enterprise-primary)' }}
            />
            Allow loose unit dispatch
          </label>
        </div>
        <div style={{ marginTop: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-600)' }}>Min dispatch qty:</span>
          <Badge variant="info">{config.allowLooseDispatch ? 1 : calculatedMinDispatch}</Badge>
        </div>
      </div>
    </div>
  );
}

/* ========== VIEW MODAL COMPONENT WITH TABS ========== */

function ItemViewModal({ isOpen, onClose, item }: { isOpen: boolean; onClose: () => void; item: any }) {
  const [activeTab, setActiveTab] = useState<'details' | 'orders' | 'packaging'>('details');
  const [blanketOrders, setBlanketOrders] = useState<any[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);

  useEffect(() => {
    if (isOpen && item && activeTab === 'orders') {
      fetchBlanketOrders();
    }
  }, [isOpen, item, activeTab]);

  const fetchBlanketOrders = async () => {
    if (!item) return;
    setLoadingOrders(true);
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('blanket_order_lines')
        .select(`*, blanket_orders (order_number, customer_name, order_date, start_date, end_date, status)`)
        .eq('item_id', item.id);

      if (error) {
        console.error('Error fetching blanket orders:', error);
        setBlanketOrders([]);
      } else {
        setBlanketOrders(data || []);
      }
    } catch (err) {
      console.error('Error:', err);
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

  const packaging = item.packaging as itemsApi.PackagingData | undefined;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="View Item Details" maxWidth="850px">
      <div style={{ display: 'flex', borderBottom: '2px solid var(--enterprise-gray-200)', marginBottom: '20px' }}>
        <button style={tabStyle(activeTab === 'details')} onClick={() => setActiveTab('details')}>Item Details</button>
        <button style={tabStyle(activeTab === 'packaging')} onClick={() => setActiveTab('packaging')}>
          <Box size={14} style={{ marginRight: '6px', verticalAlign: 'middle' }} />Packaging
        </button>
        <button style={tabStyle(activeTab === 'orders')} onClick={() => setActiveTab('orders')}>Blanket Orders</button>
      </div>

      {/* ITEM DETAILS TAB */}
      {activeTab === 'details' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div><Label>Item Code</Label><Input value={item.itemCode || '-'} disabled /></div>
            <div><Label>Item Name</Label><Input value={item.description || item.itemName || '-'} disabled /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div><Label>Unit of Measure</Label><Input value={item.uom || '-'} disabled /></div>
            <div><Label>Lead Time (Days)</Label><Input value={item.leadTimeDays || '-'} disabled /></div>
            <div><Label>Status</Label><Input value={item.status || '-'} disabled /></div>
          </div>
          <div style={{ borderTop: '1px solid var(--enterprise-gray-200)', paddingTop: '16px', marginTop: '8px' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-gray-600)', marginBottom: '12px' }}>Additional Information</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div><Label>Revision</Label><Input value={item.revision || '-'} disabled /></div>
              <div><Label>Master Serial No</Label><Input value={item.masterSerialNo || '-'} disabled /></div>
              <div><Label>Part Number</Label><Input value={item.partNumber || '-'} disabled /></div>
            </div>
          </div>
          {/* <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div><Label>Min Stock</Label><Input value={item.minStock ?? '-'} disabled /></div>
            <div><Label>Safety Stock</Label><Input value={item.safetyStock ?? '-'} disabled /></div>
            <div><Label>Max Stock</Label><Input value={item.maxStock ?? '-'} disabled /></div>
          </div> */}
          <div
            style={{
              marginTop: '12px',
              padding: '10px',
              background: 'var(--enterprise-gray-50)',
              borderRadius: 'var(--border-radius-sm)',
              fontSize: 'var(--font-size-sm)',
              color: 'var(--enterprise-gray-600)',
            }}
          >
            📦 Stock thresholds are managed per customer under <strong>Blanket Orders</strong>.
          </div>

          <div><Label>Created At</Label><Input value={item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'} disabled /></div>
        </div>
      )}

      {/* PACKAGING TAB */}
      {activeTab === 'packaging' && (
        <div>
          {!packaging?.enabled ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--enterprise-gray-500)' }}>
              <Box size={48} style={{ marginBottom: '12px', opacity: 0.5 }} />
              <p>No packaging rules defined for this item.</p>
              <p style={{ fontSize: 'var(--font-size-sm)', marginTop: '8px' }}>This item is dispatched in loose units.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Check size={18} style={{ color: 'var(--enterprise-success)' }} />
                <span style={{ fontWeight: 'var(--font-weight-medium)' }}>Packaging rules are enabled</span>
                <Badge variant="info">{packaging.configs.length} configuration(s)</Badge>
              </div>

              {packaging.configs.map((config, idx) => (
                <div
                  key={idx}
                  style={{
                    background: config.isDefault ? 'linear-gradient(135deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.08) 100%)' : 'var(--enterprise-gray-50)',
                    border: config.isDefault ? '2px solid var(--enterprise-primary)' : '1px solid var(--enterprise-gray-200)',
                    borderRadius: 'var(--border-radius-md)',
                    padding: '16px',
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Layers size={18} style={{ color: 'var(--enterprise-primary)' }} />
                      <span style={{ fontWeight: 'var(--font-weight-semibold)', fontSize: 'var(--font-size-base)' }}>
                        {config.name || 'Unnamed Package'}
                      </span>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <Badge variant={config.type === 'SIMPLE' ? 'success' : 'info'}>{config.type}</Badge>
                      {config.isDefault && <Badge variant="warning">DEFAULT</Badge>}
                    </div>
                  </div>

                  {/* Levels Display */}
                  <div style={{ background: 'white', borderRadius: 'var(--border-radius-sm)', padding: '12px', marginBottom: '12px' }}>
                    {config.levels.map((level, lIdx) => (
                      <div key={lIdx} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                        <span style={{ color: 'var(--enterprise-gray-600)' }}>{lIdx === 0 && config.type === 'NESTED' ? '📦 Master:' : lIdx === 1 ? '↳ Inner:' : '📦'} {level.label}</span>
                        <span style={{ fontWeight: 'var(--font-weight-semibold)' }}>{level.quantity} units</span>
                      </div>
                    ))}
                  </div>

                  {/* Dispatch Rules */}
                  <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-600)', display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                    {config.type === 'NESTED' && (
                      <span>{config.allowInnerDispatch ? '✅' : '❌'} Inner dispatch</span>
                    )}
                    <span>{config.allowLooseDispatch ? '✅' : '❌'} Loose dispatch</span>
                    <span>Min qty: <strong>{config.minDispatchQty || (config.allowLooseDispatch ? 1 : config.levels[config.levels.length - 1]?.quantity || 1)}</strong></span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* BLANKET ORDERS TAB */}
      {activeTab === 'orders' && (
        <div>
          {loadingOrders ? (
            <div style={{ textAlign: 'center', padding: '40px' }}><LoadingSpinner size={32} /><p style={{ marginTop: '12px', color: 'var(--enterprise-gray-600)' }}>Loading blanket orders...</p></div>
          ) : blanketOrders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--enterprise-gray-500)' }}><Package size={48} style={{ marginBottom: '12px', opacity: 0.5 }} /><p>No blanket orders found for this item.</p></div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ backgroundColor: 'var(--table-header-bg)', borderBottom: '2px solid var(--table-border)' }}>
                    <th style={thStyle}>Order Number</th>
                    <th style={thStyle}>Customer</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Total Qty</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Released</th>
                    <th style={{ ...thStyle, textAlign: 'right' }}>Delivered</th>
                    <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {blanketOrders.map((line, index) => (
                    <tr key={line.line_id || index} style={{ backgroundColor: index % 2 === 0 ? 'white' : 'var(--table-stripe)', borderBottom: '1px solid var(--table-border)' }}>
                      <td style={tdStyle}>{line.blanket_orders?.order_number || '-'}</td>
                      <td style={tdStyle}>{line.blanket_orders?.customer_name || '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{line.total_quantity ?? '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{line.released_quantity ?? '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>{line.delivered_quantity ?? '-'}</td>
                      <td style={{ ...tdStyle, textAlign: 'center' }}><Badge variant={line.blanket_orders?.status === 'ACTIVE' ? 'success' : 'neutral'}>{line.blanket_orders?.status || '-'}</Badge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

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
  const [formData, setFormData] = useState<itemsApi.ItemForm>(formDefault);
  const [viewItem, setViewItem] = useState<any | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);

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
      itemCode: item.itemCode,
      description: item.description || item.itemName || '',
      uom: item.uom,
      minStock: item.minStock,
      maxStock: item.maxStock,
      safetyStock: item.safetyStock,
      leadTimeDays: item.leadTimeDays,
      status: item.status,
      revision: item.revision || '',
      masterSerialNo: item.masterSerialNo || '',
      partNumber: item.partNumber || '',
      packaging: item.packaging || { enabled: false, configs: [] },
    });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    const result = await itemsApi.deleteItem(id);
    if (result.error) {
      setError(result.error);
      return;
    }
    fetchItems();
  };

  const handleView = (item: any) => {
    setViewItem(item);
    setShowViewModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData(formDefault);
  };

  // Packaging handlers
  const addPackagingConfig = () => {
    const currentConfigs = formData.packaging?.configs || [];
    const newConfig: itemsApi.PackagingConfig = {
      ...defaultPackagingConfig,
      isDefault: currentConfigs.length === 0,
    };
    setFormData({
      ...formData,
      packaging: {
        enabled: true,
        configs: [...currentConfigs, newConfig],
      },
    });
  };

  const updatePackagingConfig = (index: number, config: itemsApi.PackagingConfig) => {
    const configs = [...(formData.packaging?.configs || [])];
    configs[index] = config;
    setFormData({ ...formData, packaging: { enabled: true, configs } });
  };

  const removePackagingConfig = (index: number) => {
    const configs = (formData.packaging?.configs || []).filter((_, i) => i !== index);
    // If removed was default, set first one as default
    if (configs.length > 0 && !configs.some(c => c.isDefault)) {
      configs[0].isDefault = true;
    }
    setFormData({
      ...formData,
      packaging: {
        enabled: configs.length > 0,
        configs,
      },
    });
  };

  const setDefaultConfig = (index: number) => {
    const configs = (formData.packaging?.configs || []).map((c, i) => ({
      ...c,
      isDefault: i === index,
    }));
    setFormData({ ...formData, packaging: { enabled: true, configs } });
  };

  const togglePackaging = (enabled: boolean) => {
    if (enabled && (formData.packaging?.configs || []).length === 0) {
      addPackagingConfig();
    } else {
      setFormData({
        ...formData,
        packaging: { ...formData.packaging!, enabled },
      });
    }
  };

  const filteredItems = items.filter(
    (item) =>
      item.itemCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.description || item.itemName || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) return <LoadingSpinner />;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ position: 'relative', width: '320px' }}>
          <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--enterprise-gray-400)' }} />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search items by code or name..."
            style={{ paddingLeft: '40px' }}
          />
        </div>
        <Button variant="primary" icon={<Plus size={20} />} onClick={() => setShowModal(true)}>
          Add Item
        </Button>
      </div>

      {error && (
        <div style={{ backgroundColor: 'var(--enterprise-error-bg)', border: '1px solid var(--enterprise-error)', borderRadius: 'var(--border-radius-md)', padding: '12px' }}>
          <p style={{ color: 'var(--enterprise-error)', fontSize: 'var(--font-size-sm)' }}>{error}</p>
        </div>
      )}

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-600)', fontWeight: 'var(--font-weight-medium)', marginBottom: '8px' }}>Total Items</p>
              <p style={{ fontSize: '2rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-primary)' }}>{items.length}</p>
            </div>
            <div style={{ width: '48px', height: '48px', borderRadius: 'var(--border-radius-md)', backgroundColor: 'rgba(30, 58, 138, 0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Package size={24} style={{ color: 'var(--enterprise-primary)' }} />
            </div>
          </div>
        </Card>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-600)', fontWeight: 'var(--font-weight-medium)', marginBottom: '8px' }}>Active Items</p>
              <p style={{ fontSize: '2rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-success)' }}>{items.filter((i) => i.status === 'active').length}</p>
            </div>
            <Badge variant="success">Active</Badge>
          </div>
        </Card>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-600)', fontWeight: 'var(--font-weight-medium)', marginBottom: '8px' }}>Inactive Items</p>
              <p style={{ fontSize: '2rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-gray-500)' }}>{items.filter((i) => i.status === 'inactive').length}</p>
            </div>
            <Badge variant="neutral">Inactive</Badge>
          </div>
        </Card>
      </div>

      {/* Items Table */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {filteredItems.length === 0 ? (
          <EmptyState
            icon={<Package size={48} />}
            title="No Items Found"
            description={searchTerm ? 'Try adjusting your search' : 'Create your first item or check sign-in and RLS on public.items'}
            action={!searchTerm ? { label: 'Add Item', onClick: () => setShowModal(true) } : undefined}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ backgroundColor: 'var(--table-header-bg)', borderBottom: '2px solid var(--table-border)' }}>
                  <th style={{ ...thStyle, minWidth: '100px' }}>Item Code</th>
                  <th style={{ ...thStyle, minWidth: '80px' }}>MSN</th>
                  <th style={{ ...thStyle, minWidth: '140px' }}>Item Name</th>
                  <th style={{ ...thStyle, textAlign: 'center', minWidth: '60px' }}>Rev</th>
                  <th style={{ ...thStyle, textAlign: 'center', minWidth: '60px' }}>UOM</th>
                  <th style={{ ...thStyle, textAlign: 'center', minWidth: '80px' }}>Lead Time</th>
                  <th style={{ ...thStyle, textAlign: 'center', minWidth: '80px' }}>Status</th>
                  <th style={{ ...thStyle, textAlign: 'center', minWidth: '200px', width: '200px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item, index) => (
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
                    <td style={{ ...tdStyle, fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-primary)' }}>{item.itemCode}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.85em', color: 'var(--enterprise-gray-600)' }}>{item.masterSerialNo || '-'}</td>
                    <td style={tdStyle}>{item.itemName}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}><Badge variant="info">{item.revision || '-'}</Badge></td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{item.uom}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{item.leadTimeDays} days</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}><Badge variant={item.status === 'active' ? 'success' : 'neutral'}>{item.status}</Badge></td>
                    <td style={{ ...tdStyle, textAlign: 'center', padding: '8px 12px' }}>
                      <div style={{ display: 'flex', gap: '6px', justifyContent: 'center', alignItems: 'center' }}>
                        <Button variant="secondary" size="sm" icon={<Edit2 size={14} />} onClick={() => handleEdit(item)} style={{ minWidth: '55px' }}>Edit</Button>
                        <Button variant="danger" size="sm" icon={<Trash2 size={14} />} onClick={() => handleDelete(item.id)} style={{ minWidth: '65px' }}>Delete</Button>
                        <Button variant="tertiary" size="sm" icon={<Eye size={14} />} onClick={() => handleView(item)} style={{ minWidth: '55px' }}>View</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
                <Input value={formData.itemCode} onChange={(e) => setFormData({ ...formData, itemCode: e.target.value })} placeholder="FG-001" required disabled={!!editingItem} style={editingItem ? { backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' } : {}} />
              </div>
              <div>
                <Label required>Master Serial No</Label>
                <Input value={formData.masterSerialNo} onChange={(e) => setFormData({ ...formData, masterSerialNo: e.target.value })} placeholder="MSN-001" required disabled={!!editingItem} style={editingItem ? { backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' } : {}} />
              </div>
              <div>
                <Label required>Part Number</Label>
                <Input value={formData.partNumber} onChange={(e) => setFormData({ ...formData, partNumber: e.target.value })} placeholder="FR-REF-123" required disabled={!!editingItem} style={editingItem ? { backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' } : {}} />
              </div>
            </div>
            <div style={{ marginTop: '16px' }}>
              <Label required>Item Name / Description</Label>
              <Input value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="Enter item name..." required disabled={!!editingItem} style={editingItem ? { backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' } : {}} />
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
                <Input value={formData.revision} onChange={(e) => setFormData({ ...formData, revision: e.target.value })} placeholder="A / AB / 1A" required />
              </div>
              <div>
                <Label required>Lead Time (Days)</Label>
                <Input type="number" value={formData.leadTimeDays} onChange={(e) => setFormData({ ...formData, leadTimeDays: e.target.value })} placeholder="Enter days" required min={0} />
              </div>
              <div>
                <Label>Status</Label>
                <Select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}>
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </div>
            </div>
          </div>

          {/* Section: Packaging Details */}
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

            {formData.packaging?.enabled && (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {(formData.packaging?.configs || []).map((config, idx) => (
                    <PackagingCard
                      key={idx}
                      config={config}
                      index={idx}
                      onUpdate={updatePackagingConfig}
                      onRemove={removePackagingConfig}
                      onSetDefault={setDefaultConfig}
                    />
                  ))}
                </div>

                <Button
                  type="button"
                  variant="secondary"
                  onClick={addPackagingConfig}
                  style={{ marginTop: '16px' }}
                  icon={<Plus size={16} />}
                >
                  Add Packaging Option
                </Button>

                <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', marginTop: '12px', fontStyle: 'italic' }}>
                  💡 These rules will be used during delivery and inventory dispatch.
                </p>
              </>
            )}

            {!formData.packaging?.enabled && (
              <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-500)', fontStyle: 'italic' }}>
                No packaging rules. This item will be dispatched in loose units.
              </p>
            )}
          </div>

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

      <ItemViewModal isOpen={showViewModal} onClose={() => setShowViewModal(false)} item={viewItem} />
    </div>
  );
}
