/**
 * Item Master – fetches and edits items via direct Supabase client (public.items).
 * Uses the current DB schema: id, item_code, item_name, uom, min_stock_level, max_stock_level,
 * safety_stock, lead_time_days, is_active. No Edge Function; auth is the user's Supabase session.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, Search, Package, AlertCircle, Eye } from 'lucide-react';
import { Card, Button, Badge, Input, Select, Label, Modal, LoadingSpinner, EmptyState } from './ui/EnterpriseUI';
import * as itemsApi from '../utils/api/itemsSupabase';
import { getSupabaseClient } from '../utils/supabase/client';

type Item = itemsApi.ItemForm & { id: string; createdAt: string };

const formDefault: itemsApi.ItemForm = {
  itemCode: '',
  description: '', // Changed from itemName to description to align with form fields and API
  uom: 'PCS',
  minStock: 0,
  maxStock: 0,
  safetyStock: 0,
  leadTimeDays: '',
  status: 'active',
  revision: '',
  masterSerialNo: '',
  partNumber: '',
};

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

/* ========== View Modal Component with Tabs ========== */
function ItemViewModal({ isOpen, onClose, item }: { isOpen: boolean; onClose: () => void; item: any }) {
  const [activeTab, setActiveTab] = useState<'details' | 'orders'>('details');
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
    padding: '12px 24px',
    border: 'none',
    background: isActive ? 'var(--enterprise-primary)' : 'transparent',
    color: isActive ? 'white' : 'var(--enterprise-gray-600)',
    cursor: 'pointer',
    fontWeight: 'var(--font-weight-semibold)',
    borderRadius: 'var(--border-radius-md) var(--border-radius-md) 0 0',
    transition: 'all 0.2s ease',
  });

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="View Item Details" maxWidth="800px">
      <div style={{ display: 'flex', borderBottom: '2px solid var(--enterprise-gray-200)', marginBottom: '20px' }}>
        <button style={tabStyle(activeTab === 'details')} onClick={() => setActiveTab('details')}>Item Details</button>
        <button style={tabStyle(activeTab === 'orders')} onClick={() => setActiveTab('orders')}>Blanket Orders</button>
      </div>

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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div><Label>Min Stock</Label><Input value={item.minStock ?? '-'} disabled /></div>
            <div><Label>Safety Stock</Label><Input value={item.safetyStock ?? '-'} disabled /></div>
            <div><Label>Max Stock</Label><Input value={item.maxStock ?? '-'} disabled /></div>
          </div>
          <div><Label>Created At</Label><Input value={item.createdAt ? new Date(item.createdAt).toLocaleString() : '-'} disabled /></div>
        </div>
      )}

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
    setError(null);
    if (formData.minStock > formData.safetyStock) {
      setError('Minimum stock cannot be greater than safety stock');
      return;
    }
    if (formData.safetyStock > formData.maxStock) {
      setError('Safety stock cannot be greater than maximum stock');
      return;
    }
    const payload: itemsApi.ItemForm = {
      itemCode: formData.itemCode,
      description: formData.description,
      uom: formData.uom,
      minStock: formData.minStock,
      maxStock: formData.maxStock,
      safetyStock: formData.safetyStock,
      leadTimeDays: Number(formData.leadTimeDays),
      status: formData.status,
      revision: formData.revision,
      masterSerialNo: formData.masterSerialNo,
      partNumber: formData.partNumber,
    };

    if (editingItem) {
      const result = await itemsApi.updateItem(editingItem.id, payload);
      if (result.error) {
        setError(result.error);
        return;
      }
    } else {
      const result = await itemsApi.createItem(payload);
      if (result.error) {
        setError(result.error);
        return;
      }
    }
    await fetchItems();
    handleCloseModal();
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this item?')) return;
    setError(null);
    const result = await itemsApi.deleteItem(id);
    if (result.error) {
      setError(result.error);
      return;
    }
    await fetchItems();
  };

  const handleEdit = (item: Item) => {
    setEditingItem(item);
    setFormData({
      itemCode: item.itemCode,
      description: item.description,
      uom: item.uom,
      minStock: item.minStock,
      maxStock: item.maxStock,
      safetyStock: item.safetyStock,
      leadTimeDays: String(item.leadTimeDays),
      status: item.status,
      revision: item.revision,
      masterSerialNo: item.masterSerialNo,
      partNumber: item.partNumber,
    });

    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingItem(null);
    setFormData({ ...formDefault });
    setError(null);
  };

  const filteredItems = items.filter(
    (item) =>
      item.itemCode.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.itemName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return <LoadingSpinner />;
  }
  const handleView = (item: any) => {
    setViewItem(item);
    setShowViewModal(true);
  };



  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {error && (
        <div
          style={{
            padding: '16px',
            backgroundColor: '#fee2e2',
            borderRadius: 'var(--border-radius-md)',
            color: '#dc2626',
            display: 'flex',
            gap: '12px',
            alignItems: 'flex-start',
          }}
        >
          <AlertCircle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
          <div>{error}</div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
        <div style={{ flex: 1, maxWidth: '400px', position: 'relative' }}>
          <Search
            size={20}
            style={{
              position: 'absolute',
              left: '12px',
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--enterprise-gray-400)',
              pointerEvents: 'none',
            }}
          />
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

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: '16px',
        }}
      >
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--enterprise-gray-600)',
                  fontWeight: 'var(--font-weight-medium)',
                  marginBottom: '8px',
                }}
              >
                Total Items
              </p>
              <p
                style={{
                  fontSize: '2rem',
                  fontWeight: 'var(--font-weight-bold)',
                  color: 'var(--enterprise-primary)',
                }}
              >
                {items.length}
              </p>
            </div>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: 'var(--border-radius-md)',
                backgroundColor: 'rgba(30, 58, 138, 0.1)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Package size={24} style={{ color: 'var(--enterprise-primary)' }} />
            </div>
          </div>
        </Card>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--enterprise-gray-600)',
                  fontWeight: 'var(--font-weight-medium)',
                  marginBottom: '8px',
                }}
              >
                Active Items
              </p>
              <p
                style={{
                  fontSize: '2rem',
                  fontWeight: 'var(--font-weight-bold)',
                  color: 'var(--enterprise-success)',
                }}
              >
                {items.filter((i) => i.status === 'active').length}
              </p>
            </div>
            <Badge variant="success">Active</Badge>
          </div>
        </Card>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p
                style={{
                  fontSize: 'var(--font-size-sm)',
                  color: 'var(--enterprise-gray-600)',
                  fontWeight: 'var(--font-weight-medium)',
                  marginBottom: '8px',
                }}
              >
                Inactive Items
              </p>
              <p
                style={{
                  fontSize: '2rem',
                  fontWeight: 'var(--font-weight-bold)',
                  color: 'var(--enterprise-gray-500)',
                }}
              >
                {items.filter((i) => i.status === 'inactive').length}
              </p>
            </div>
            <Badge variant="neutral">Inactive</Badge>
          </div>
        </Card>
      </div>

      {/* <div
        style={{
          backgroundColor: 'var(--enterprise-info-bg)',
          border: '1px solid var(--enterprise-info)',
          borderRadius: 'var(--border-radius-md)',
          padding: '16px',
          display: 'flex',
          gap: '12px',
        }}
      >
        <AlertCircle size={20} style={{ color: 'var(--enterprise-info)', flexShrink: 0, marginTop: '2px' }} />
        <div>
          <p
            style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--enterprise-info)',
              marginBottom: '4px',
            }}
          >
            Business Rules
          </p>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-700)' }}>
            Min ≤ Safety ≤ Max stock levels • Data from public.items (direct Supabase)
          </p>
        </div>
      </div> */}

      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {filteredItems.length === 0 ? (
          <EmptyState
            icon={<Package size={48} />}
            title="No Items Found"
            description={
              searchTerm ? 'Try adjusting your search' : 'Create your first item or check sign-in and RLS on public.items'
            }
            action={!searchTerm ? { label: 'Add Item', onClick: () => setShowModal(true) } : undefined}
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr
                  style={{
                    backgroundColor: 'var(--table-header-bg)',
                    borderBottom: '2px solid var(--table-border)',
                  }}
                >
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
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--table-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor =
                        index % 2 === 0 ? 'white' : 'var(--table-stripe)';
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-primary)' }}>{item.itemCode}</td>
                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '0.85em', color: 'var(--enterprise-gray-600)' }}>{item.masterSerialNo || '-'}</td>
                    <td style={tdStyle}>{item.itemName}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}><Badge variant="info">{item.revision || '-'}</Badge></td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{item.uom}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{item.leadTimeDays} days</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <Badge variant={item.status === 'active' ? 'success' : 'neutral'}>{item.status}</Badge>
                    </td>
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

      <Modal
        isOpen={showModal}
        onClose={handleCloseModal}
        title={editingItem ? 'Edit Item' : 'Create New Item'}
        maxWidth="700px"
      >
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
          {/* Section: Item Identification */}
          <div style={{ background: 'linear-gradient(135deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.08) 100%)', borderRadius: 'var(--border-radius-md)', padding: '16px', border: '1px solid rgba(30,58,138,0.1)' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-primary)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Item Identification</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div>
                <Label required>Item Code</Label>
                <Input
                  value={formData.itemCode}
                  onChange={(e) => setFormData({ ...formData, itemCode: e.target.value })}
                  placeholder="FG-001"
                  required
                  disabled={!!editingItem}
                  style={editingItem ? { backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' } : {}}
                />
              </div>
              <div>
                <Label required>Master Serial No</Label>
                <Input
                  value={formData.masterSerialNo}
                  onChange={(e) => setFormData({ ...formData, masterSerialNo: e.target.value })}
                  placeholder="MSN-001"
                  required
                  disabled={!!editingItem}
                  style={editingItem ? { backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' } : {}}
                />
              </div>
              <div>
                <Label required>Part Number</Label>
                <Input
                  value={formData.partNumber}
                  onChange={(e) => setFormData({ ...formData, partNumber: e.target.value })}
                  placeholder="FR-REF-123"
                  required
                  disabled={!!editingItem}
                  style={editingItem ? { backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' } : {}}
                />
              </div>
            </div>
            <div style={{ marginTop: '16px' }}>
              <Label required>Item Name / Description</Label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Enter item name..."
                required
                disabled={!!editingItem}
                style={editingItem ? { backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' } : {}}
              />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginTop: '16px' }}>
              <div>
                <Label required>Unit of Measure</Label>
                <Select
                  value={formData.uom}
                  onChange={(e) => setFormData({ ...formData, uom: e.target.value })}
                  required
                  disabled={!!editingItem}
                  style={editingItem ? { backgroundColor: 'var(--enterprise-gray-100)', cursor: 'not-allowed' } : {}}
                >
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
          <div style={{ background: 'linear-gradient(135deg, rgba(34,197,94,0.03) 0%, rgba(34,197,94,0.08) 100%)', borderRadius: 'var(--border-radius-md)', padding: '16px', border: '1px solid rgba(34,197,94,0.15)' }}>
            <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-success)', marginBottom: '12px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>{editingItem ? '✏️ Editable Fields' : 'Configuration'}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
              <div>
                <Label required>Revision</Label>
                <Input
                  value={formData.revision}
                  onChange={(e) => setFormData({ ...formData, revision: e.target.value })}
                  placeholder="A / AB / 1A"
                  required
                />
              </div>
              <div>
                <Label required>Lead Time (Days)</Label>
                <Input
                  type="number"
                  value={formData.leadTimeDays}
                  onChange={(e) => setFormData({ ...formData, leadTimeDays: e.target.value })}
                  placeholder="Enter days"
                  required
                  min={0}
                />
              </div>
              <div>
                <Label>Status</Label>
                <Select
                  value={formData.status}
                  onChange={(e) => setFormData({ ...formData, status: e.target.value as 'active' | 'inactive' })}
                >
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </Select>
              </div>
            </div>
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
