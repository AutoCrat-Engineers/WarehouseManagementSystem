/**
 * Item Master – fetches and edits items via direct Supabase client (public.items).
 * Uses the current DB schema: id, item_code, item_name, uom, min_stock_level, max_stock_level,
 * safety_stock, lead_time_days, is_active. No Edge Function; auth is the user's Supabase session.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Edit2, Trash2, Search, Package, AlertCircle } from 'lucide-react';
import { Card, Button, Badge, Input, Select, Label, Modal, LoadingSpinner, EmptyState } from './ui/EnterpriseUI';
import * as itemsApi from '../utils/api/itemsSupabase';

type Item = itemsApi.ItemForm & { id: string; createdAt: string };

const formDefault: itemsApi.ItemForm = {
  itemCode: '',
  itemName: '',
  uom: 'PCS',
  minStock: 0,
  maxStock: 0,
  safetyStock: 0,
  leadTimeDays: 0,
  status: 'active',
};

export function ItemMasterSupabase() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingItem, setEditingItem] = useState<Item | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [formData, setFormData] = useState<itemsApi.ItemForm>(formDefault);

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
      itemName: formData.itemName,
      uom: formData.uom,
      minStock: formData.minStock,
      maxStock: formData.maxStock,
      safetyStock: formData.safetyStock,
      leadTimeDays: formData.leadTimeDays,
      status: formData.status,
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
      itemName: item.itemName,
      uom: item.uom,
      minStock: item.minStock,
      maxStock: item.maxStock,
      safetyStock: item.safetyStock,
      leadTimeDays: item.leadTimeDays,
      status: item.status,
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

      <div
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
      </div>

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
                  <th style={thStyle}>Item Code</th>
                  <th style={thStyle}>Item Name</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>UOM</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Min / Safety / Max</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Lead Time</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Status</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>Actions</th>
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
                    <td style={tdStyle}>{item.itemCode}</td>
                    <td style={tdStyle}>{item.itemName}</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{item.uom}</td>
                    <td style={{ ...tdStyle, textAlign: 'right' }}>
                      {item.minStock} / {item.safetyStock} / {item.maxStock}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>{item.leadTimeDays} days</td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <Badge variant={item.status === 'active' ? 'success' : 'neutral'}>{item.status}</Badge>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
                        <Button
                          variant="secondary"
                          size="sm"
                          icon={<Edit2 size={14} />}
                          onClick={() => handleEdit(item)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="danger"
                          size="sm"
                          icon={<Trash2 size={14} />}
                          onClick={() => handleDelete(item.id)}
                        >
                          Delete
                        </Button>
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <Label required>Item Code</Label>
              <Input
                value={formData.itemCode}
                onChange={(e) => setFormData({ ...formData, itemCode: e.target.value })}
                placeholder="FG-001"
                required
                disabled={!!editingItem}
              />
            </div>
            <div>
              <Label required>Unit of Measure</Label>
              <Select
                value={formData.uom}
                onChange={(e) => setFormData({ ...formData, uom: e.target.value })}
                required
              >
                <option value="PCS">Pieces (PCS)</option>
                <option value="KG">Kilograms (KG)</option>
                <option value="L">Liters (L)</option>
                <option value="M">Meters (M)</option>
                <option value="BOX">Box (BOX)</option>
              </Select>
            </div>
          </div>
          <div>
            <Label required>Item Name</Label>
            <Input
              value={formData.itemName}
              onChange={(e) => setFormData({ ...formData, itemName: e.target.value })}
              placeholder="Enter item name..."
              required
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
            <div>
              <Label required>Min Stock</Label>
              <Input
                type="number"
                value={formData.minStock}
                onChange={(e) => setFormData({ ...formData, minStock: parseInt(e.target.value, 10) || 0 })}
                min={0}
                required
              />
            </div>
            <div>
              <Label required>Safety Stock</Label>
              <Input
                type="number"
                value={formData.safetyStock}
                onChange={(e) => setFormData({ ...formData, safetyStock: parseInt(e.target.value, 10) || 0 })}
                min={0}
                required
              />
            </div>
            <div>
              <Label required>Max Stock</Label>
              <Input
                type="number"
                value={formData.maxStock}
                onChange={(e) => setFormData({ ...formData, maxStock: parseInt(e.target.value, 10) || 0 })}
                min={0}
                required
              />
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div>
              <Label required>Lead Time (Days)</Label>
              <Input
                type="number"
                value={formData.leadTimeDays}
                onChange={(e) =>
                  setFormData({ ...formData, leadTimeDays: parseInt(e.target.value, 10) || 0 })
                }
                min={0}
                required
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
          <div style={{ display: 'flex', gap: '12px', marginTop: '8px' }}>
            <Button type="submit" variant="primary" fullWidth>
              {editingItem ? 'Update Item' : 'Create Item'}
            </Button>
            <Button type="button" variant="tertiary" fullWidth onClick={handleCloseModal}>
              Cancel
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

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
