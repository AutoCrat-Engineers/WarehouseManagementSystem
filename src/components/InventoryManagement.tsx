/**
 * Inventory Management Module
 * A read-only, operational module that composes data from Item Master and Blanket Orders.
 * Philosophy: Item Master defines rules, Blanket Orders create commitments, Inventory shows reality.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Package, RefreshCw, AlertTriangle, CheckCircle, Eye, TrendingUp,
  Box, Truck, Factory, ArrowRightLeft, ClipboardList, Layers, Info
} from 'lucide-react';
import { Card, Button, Badge, LoadingSpinner, EmptyState, Modal, Label, Input } from './ui/EnterpriseUI';
import { getSupabaseClient } from '../utils/supabase/client';

/* ========== TYPE DEFINITIONS ========== */

interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  description?: string;
  uom: string;
  minStock: number;
  maxStock: number;
  safetyStock: number;
  leadTimeDays: number;
  status: 'active' | 'inactive';
  revision?: string;
  masterSerialNo?: string;
  partNumber?: string;
  createdAt?: string;
}

interface Inventory {
  id: string;
  itemId: string;
  warehouseAvailable: number;
  warehouseReserved: number;
  inTransitQty: number;
  productionFinished: number;
  updatedAt: string;
}

interface BlanketOrderLine {
  line_id: string;
  item_id: string;
  total_quantity: number;
  released_quantity: number;
  delivered_quantity: number;
  blanket_orders?: {
    order_number: string;
    customer_name: string;
    status: string;
  };
}

interface EnrichedInventory {
  id: string;
  item: Item;
  warehouseAvailable: number;
  warehouseReserved: number;
  inTransitQty: number;
  productionFinished: number;
  netAvailable: number;
  status: 'healthy' | 'low' | 'critical';
  updatedAt: string;
}

/* ========== STYLES ========== */

const thStyle: React.CSSProperties = {
  padding: '14px 16px',
  textAlign: 'left',
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-semibold)',
  color: 'var(--enterprise-gray-700)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '14px 16px',
  fontSize: 'var(--font-size-base)',
  color: 'var(--enterprise-gray-800)',
};

const sectionTitleStyle: React.CSSProperties = {
  fontSize: 'var(--font-size-sm)',
  fontWeight: 'var(--font-weight-bold)',
  textTransform: 'uppercase',
  letterSpacing: '0.5px',
  marginBottom: '16px',
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

/* ========== INVENTORY VIEW MODAL ========== */

interface InventoryViewModalProps {
  isOpen: boolean;
  onClose: () => void;
  inventory: EnrichedInventory | null;
}

function InventoryViewModal({ isOpen, onClose, inventory }: InventoryViewModalProps) {
  const [blanketOrders, setBlanketOrders] = useState<BlanketOrderLine[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [showOrdersTable, setShowOrdersTable] = useState(false);

  useEffect(() => {
    if (isOpen && inventory) {
      fetchBlanketOrders();
    }
  }, [isOpen, inventory]);

  const fetchBlanketOrders = async () => {
    if (!inventory?.item?.id) return;
    setLoadingOrders(true);
    try {
      const supabase = getSupabaseClient();
      const { data, error } = await supabase
        .from('blanket_order_lines')
        .select(`*, blanket_orders (order_number, customer_name, status)`)
        .eq('item_id', inventory.item.id);

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

  if (!inventory) return null;

  // Calculate blanket order totals
  const totalBlanketQty = blanketOrders.reduce((sum, o) => sum + (o.total_quantity || 0), 0);
  const totalReleasedQty = blanketOrders.reduce((sum, o) => sum + (o.released_quantity || 0), 0);
  const balanceQty = totalBlanketQty - totalReleasedQty;

  const item = inventory.item;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Inventory Details" maxWidth="900px">
      <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

        {/* ========== SEGMENT 1: ITEM MASTER SNAPSHOT ========== */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(30,58,138,0.03) 0%, rgba(30,58,138,0.08) 100%)',
          borderRadius: 'var(--border-radius-lg)',
          padding: '20px',
          border: '1px solid rgba(30,58,138,0.12)',
        }}>
          <p style={{ ...sectionTitleStyle, color: 'var(--enterprise-primary)' }}>
            <Package size={18} /> Item Definition
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            <div><Label>Item Code</Label><Input value={item.itemCode || '-'} disabled /></div>
            <div><Label>Description</Label><Input value={item.description || item.itemName || '-'} disabled /></div>
            <div><Label>Revision</Label><Input value={item.revision || '-'} disabled /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginTop: '16px' }}>
            <div><Label>UOM</Label><Input value={item.uom || '-'} disabled /></div>
            <div><Label>MSN</Label><Input value={item.masterSerialNo || '-'} disabled /></div>
            <div><Label>Part Number</Label><Input value={item.partNumber || '-'} disabled /></div>
            <div><Label>Lead Time</Label><Input value={`${item.leadTimeDays || 0} days`} disabled /></div>
          </div>
          <div style={{ marginTop: '16px' }}>
            <Label>Status</Label>
            <Badge variant={item.status === 'active' ? 'success' : 'neutral'} style={{ marginTop: '4px' }}>
              {item.status?.toUpperCase() || 'UNKNOWN'}
            </Badge>
          </div>
        </div>

        {/* ========== SEGMENT 2: BLANKET ORDER COMMITMENTS ========== */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(234,179,8,0.03) 0%, rgba(234,179,8,0.08) 100%)',
          borderRadius: 'var(--border-radius-lg)',
          padding: '20px',
          border: '1px solid rgba(234,179,8,0.15)',
        }}>
          <p style={{ ...sectionTitleStyle, color: 'var(--enterprise-warning)' }}>
            <ClipboardList size={18} /> Blanket Order Commitments
          </p>

          {loadingOrders ? (
            <div style={{ textAlign: 'center', padding: '20px' }}>
              <LoadingSpinner size={24} />
              <p style={{ marginTop: '8px', color: 'var(--enterprise-gray-500)', fontSize: 'var(--font-size-sm)' }}>Loading commitments...</p>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '16px' }}>
                <div style={{ background: 'white', padding: '16px', borderRadius: 'var(--border-radius-md)', textAlign: 'center', boxShadow: 'var(--shadow-sm)' }}>
                  <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', marginBottom: '4px', textTransform: 'uppercase' }}>Total Blanket Qty</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-gray-900)' }}>{totalBlanketQty}</p>
                </div>
                <div style={{ background: 'white', padding: '16px', borderRadius: 'var(--border-radius-md)', textAlign: 'center', boxShadow: 'var(--shadow-sm)' }}>
                  <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', marginBottom: '4px', textTransform: 'uppercase' }}>Released Qty</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-info)' }}>{totalReleasedQty}</p>
                </div>
                <div style={{ background: 'white', padding: '16px', borderRadius: 'var(--border-radius-md)', textAlign: 'center', boxShadow: 'var(--shadow-sm)' }}>
                  <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-500)', marginBottom: '4px', textTransform: 'uppercase' }}>Balance Qty</p>
                  <p style={{ fontSize: '1.5rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-warning)' }}>{balanceQty}</p>
                </div>
              </div>

              {/* Collapsible Orders Table */}
              {blanketOrders.length > 0 && (
                <>
                  <button
                    onClick={() => setShowOrdersTable(!showOrdersTable)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--enterprise-primary)',
                      cursor: 'pointer',
                      fontSize: 'var(--font-size-sm)',
                      fontWeight: 'var(--font-weight-medium)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '4px',
                      marginBottom: showOrdersTable ? '12px' : '0',
                    }}
                  >
                    {showOrdersTable ? '▼ Hide Details' : '▶ Show Order Details'}
                  </button>

                  {showOrdersTable && (
                    <div style={{ overflowX: 'auto', background: 'white', borderRadius: 'var(--border-radius-md)' }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--font-size-sm)' }}>
                        <thead>
                          <tr style={{ backgroundColor: 'var(--table-header-bg)', borderBottom: '1px solid var(--table-border)' }}>
                            <th style={{ ...thStyle, padding: '10px 12px' }}>Customer</th>
                            <th style={{ ...thStyle, padding: '10px 12px' }}>Order No</th>
                            <th style={{ ...thStyle, padding: '10px 12px', textAlign: 'right' }}>Total Qty</th>
                            <th style={{ ...thStyle, padding: '10px 12px', textAlign: 'right' }}>Released</th>
                            <th style={{ ...thStyle, padding: '10px 12px', textAlign: 'right' }}>Balance</th>
                            <th style={{ ...thStyle, padding: '10px 12px', textAlign: 'center' }}>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {blanketOrders.map((order, idx) => (
                            <tr key={order.line_id} style={{ backgroundColor: idx % 2 === 0 ? 'white' : 'var(--table-stripe)' }}>
                              <td style={{ ...tdStyle, padding: '10px 12px' }}>{order.blanket_orders?.customer_name || '-'}</td>
                              <td style={{ ...tdStyle, padding: '10px 12px', fontFamily: 'monospace' }}>{order.blanket_orders?.order_number || '-'}</td>
                              <td style={{ ...tdStyle, padding: '10px 12px', textAlign: 'right' }}>{order.total_quantity || 0}</td>
                              <td style={{ ...tdStyle, padding: '10px 12px', textAlign: 'right' }}>{order.released_quantity || 0}</td>
                              <td style={{ ...tdStyle, padding: '10px 12px', textAlign: 'right' }}>{(order.total_quantity || 0) - (order.released_quantity || 0)}</td>
                              <td style={{ ...tdStyle, padding: '10px 12px', textAlign: 'center' }}>
                                <Badge variant={order.blanket_orders?.status === 'ACTIVE' ? 'success' : 'neutral'}>
                                  {order.blanket_orders?.status || '-'}
                                </Badge>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </>
              )}

              {blanketOrders.length === 0 && (
                <p style={{ color: 'var(--enterprise-gray-500)', fontSize: 'var(--font-size-sm)', fontStyle: 'italic' }}>
                  No blanket orders found for this item.
                </p>
              )}

              <p style={{
                marginTop: '12px',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--enterprise-gray-500)',
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
              }}>
                <Info size={12} /> Reserved stock is allocated from warehouse availability
              </p>
            </>
          )}
        </div>

        {/* ========== SEGMENT 3: STOCK DISTRIBUTION & MOVEMENTS ========== */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(220,38,38,0.03) 0%, rgba(220,38,38,0.08) 100%)',
          borderRadius: 'var(--border-radius-lg)',
          padding: '20px',
          border: '1px solid rgba(220,38,38,0.12)',
        }}>
          <p style={{ ...sectionTitleStyle, color: 'var(--enterprise-error)' }}>
            <Layers size={18} /> Stock Distribution & Movements
          </p>

          {/* Stock by Location */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '20px' }}>
            {/* Warehouse */}
            <div style={{ background: 'white', padding: '16px', borderRadius: 'var(--border-radius-md)', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <Box size={18} style={{ color: 'var(--enterprise-primary)' }} />
                <span style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-gray-700)' }}>Warehouse</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-500)' }}>Available</span>
                <span style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-success)' }}>{inventory.warehouseAvailable}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-500)' }}>Reserved</span>
                <span style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-warning)' }}>{inventory.warehouseReserved}</span>
              </div>
            </div>

            {/* In Transit */}
            <div style={{ background: 'white', padding: '16px', borderRadius: 'var(--border-radius-md)', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <Truck size={18} style={{ color: 'var(--enterprise-info)' }} />
                <span style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-gray-700)' }}>In Transit</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-500)' }}>Quantity</span>
                <span style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-info)' }}>{inventory.inTransitQty}</span>
              </div>
            </div>

            {/* Production House */}
            <div style={{ background: 'white', padding: '16px', borderRadius: 'var(--border-radius-md)', boxShadow: 'var(--shadow-sm)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
                <Factory size={18} style={{ color: 'var(--enterprise-secondary)' }} />
                <span style={{ fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-gray-700)' }}>Production</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-500)' }}>Finished Stock</span>
                <span style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--enterprise-secondary)' }}>{inventory.productionFinished}</span>
              </div>
            </div>
          </div>

          {/* Net Availability */}
          {/* <div style={{
            background: 'linear-gradient(135deg, var(--enterprise-primary) 0%, #1e40af 100%)',
            borderRadius: 'var(--border-radius-md)',
            padding: '20px',
            color: 'white',
            textAlign: 'center',
            marginBottom: '20px',
          }}>
            <p style={{ fontSize: 'var(--font-size-sm)', opacity: 0.9, marginBottom: '4px' }}>NET AVAILABLE FOR CUSTOMER</p>
            <p style={{ fontSize: '2.5rem', fontWeight: 'var(--font-weight-bold)' }}>{inventory.netAvailable}</p>
            <p style={{ fontSize: 'var(--font-size-xs)', opacity: 0.8, marginTop: '8px' }}>
              = Warehouse Available ({inventory.warehouseAvailable}) + In Transit ({inventory.inTransitQty}) − Reserved ({inventory.warehouseReserved})
            </p>
          </div> */}
          {/* Net Availability */}
          <div style={{
            background: 'linear-gradient(135deg, #eef4ff 0%, #e0ebff 100%)',
            borderRadius: 'var(--border-radius-md)',
            padding: '20px',
            textAlign: 'center',
            border: '1px solid #c7d7fe',
          }}>
            <p style={{
              fontSize: 'var(--font-size-sm)',
              fontWeight: 'var(--font-weight-semibold)',
              color: 'var(--enterprise-gray-600)',
              letterSpacing: '0.4px',
              marginBottom: '6px',
              textTransform: 'uppercase',
            }}>
              Net Available for Customer
            </p>

            <p style={{
              fontSize: '2.6rem',
              fontWeight: 'var(--font-weight-bold)',
              color: 'var(--enterprise-primary)',
              margin: '4px 0',
            }}>
              {inventory.netAvailable}
            </p>

            <p style={{
              fontSize: 'var(--font-size-xs)',
              color: 'var(--enterprise-gray-500)',
            }}>
              = Warehouse Available ({inventory.warehouseAvailable})
              + In Transit ({inventory.inTransitQty})
              − Reserved ({inventory.warehouseReserved})
            </p>
          </div>


          {/* Inventory Actions (Future-Ready) */}
          <p style={{ fontSize: 'var(--font-size-sm)', fontWeight: 'var(--font-weight-medium)', color: 'var(--enterprise-gray-600)', marginBottom: '12px' }}>
            Inventory Actions
          </p>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <Button variant="secondary" size="sm" icon={<Factory size={14} />} disabled>
              Receive from Production
            </Button>
            <Button variant="secondary" size="sm" icon={<ArrowRightLeft size={14} />} disabled>
              Transfer to Warehouse
            </Button>
            <Button variant="secondary" size="sm" icon={<Truck size={14} />} disabled>
              Dispatch to Customer
            </Button>
            <Button variant="tertiary" size="sm" style={{ opacity: 0.6 }} disabled>
              Adjust Stock (Admin)
            </Button>
          </div>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-400)', marginTop: '8px', fontStyle: 'italic' }}>
            Stock movement actions will be available via the Stock Movements module
          </p>
        </div>

        {/* ========== SEGMENT 4: PHYSICAL & PACKAGING DETAILS ========== */}
        <div style={{
          background: 'linear-gradient(135deg, rgba(34,197,94,0.03) 0%, rgba(34,197,94,0.08) 100%)',
          borderRadius: 'var(--border-radius-lg)',
          padding: '20px',
          border: '1px solid rgba(34,197,94,0.12)',
        }}>
          <p style={{ ...sectionTitleStyle, color: 'var(--enterprise-success)' }}>
            <Box size={18} /> Physical & Packaging Details
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px' }}>
            <div><Label>Finished Size (L×W×H)</Label><Input value="— × — × —" disabled /></div>
            <div><Label>Weight per Unit</Label><Input value="—" disabled /></div>
            <div><Label>Packaging Type</Label><Input value="—" disabled /></div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', marginTop: '16px' }}>
            <div><Label>Pack Size</Label><Input value="—" disabled /></div>
            <div><Label>Min Dispatch Qty</Label><Input value="—" disabled /></div>
          </div>
          <p style={{ fontSize: 'var(--font-size-xs)', color: 'var(--enterprise-gray-400)', marginTop: '12px', fontStyle: 'italic' }}>
            Physical specifications will be available when logistics data is configured
          </p>
        </div>

        {/* Close Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
          <Button variant="primary" onClick={onClose}>Close</Button>
        </div>
      </div>
    </Modal>
  );
}

/* ========== MAIN INVENTORY COMPONENT ========== */

export function InventoryManagement() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date());
  const [selectedInventory, setSelectedInventory] = useState<EnrichedInventory | null>(null);
  const [showViewModal, setShowViewModal] = useState(false);

  const fetchData = useCallback(async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);

    try {
      const supabase = getSupabaseClient();

      // Fetch items from the items table
      const { data: itemsData, error } = await supabase
        .from('items')
        .select('*')
        .order('item_code', { ascending: true });

      if (error) {
        console.error('Error fetching items:', error);
        setItems([]);
      } else {
        // Transform to match our Item interface
        const transformedItems: Item[] = (itemsData || []).map(row => ({
          id: row.id,
          itemCode: row.item_code,
          itemName: row.item_name,
          description: row.description || row.item_name,
          uom: row.uom || 'PCS',
          minStock: row.min_stock_level || 0,
          maxStock: row.max_stock_level || 0,
          safetyStock: row.safety_stock || 0,
          leadTimeDays: row.lead_time_days || 0,
          status: row.is_active ? 'active' : 'inactive',
          revision: row.revision || '',
          masterSerialNo: row.master_serial_no || '',
          partNumber: row.part_number || '',
          createdAt: row.created_at,
        }));
        setItems(transformedItems);
      }

      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Generate enriched inventory from items
  // In production, this would come from an actual inventory table
  const getEnrichedInventory = useCallback((): EnrichedInventory[] => {
    return items.map(item => {
      // Simulated inventory data - in production, fetch from inventory table
      const warehouseAvailable = Math.floor(Math.random() * 500) + 50;
      const warehouseReserved = Math.floor(Math.random() * 100);
      const inTransitQty = Math.floor(Math.random() * 50);
      const productionFinished = Math.floor(Math.random() * 200);

      // Net Available = Warehouse Available + In Transit − Reserved
      const netAvailable = warehouseAvailable + inTransitQty - warehouseReserved;

      // Status Logic
      let status: 'healthy' | 'low' | 'critical' = 'healthy';
      if (netAvailable <= item.minStock) {
        status = 'critical';
      } else if (netAvailable <= item.safetyStock) {
        status = 'low';
      }

      return {
        id: item.id,
        item,
        warehouseAvailable,
        warehouseReserved,
        inTransitQty,
        productionFinished,
        netAvailable,
        status,
        updatedAt: new Date().toISOString(),
      };
    });
  }, [items]);

  const enrichedInventory = getEnrichedInventory();
  const healthyCount = enrichedInventory.filter(i => i.status === 'healthy').length;
  const lowCount = enrichedInventory.filter(i => i.status === 'low').length;
  const criticalCount = enrichedInventory.filter(i => i.status === 'critical').length;

  const handleView = (inv: EnrichedInventory) => {
    setSelectedInventory(inv);
    setShowViewModal(true);
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header with Last Updated & Refresh */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--enterprise-gray-600)',
          }}>
            Last updated: {lastUpdated.toLocaleString()}
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={18} className={refreshing ? 'spinning' : ''} />}
          onClick={() => fetchData(true)}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {/* Summary Cards (4 cards) */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '16px',
      }}>
        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--enterprise-gray-600)',
                fontWeight: 'var(--font-weight-medium)',
                marginBottom: '8px',
              }}>
                Total Items
              </p>
              <p style={{
                fontSize: '2rem',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--enterprise-primary)',
              }}>
                {enrichedInventory.length}
              </p>
            </div>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--border-radius-md)',
              backgroundColor: 'rgba(30, 58, 138, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <Package size={24} style={{ color: 'var(--enterprise-primary)' }} />
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--enterprise-gray-600)',
                fontWeight: 'var(--font-weight-medium)',
                marginBottom: '8px',
              }}>
                Healthy Stock
              </p>
              <p style={{
                fontSize: '2rem',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--enterprise-success)',
              }}>
                {healthyCount}
              </p>
            </div>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--border-radius-md)',
              backgroundColor: 'rgba(34, 197, 94, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <CheckCircle size={24} style={{ color: 'var(--enterprise-success)' }} />
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--enterprise-gray-600)',
                fontWeight: 'var(--font-weight-medium)',
                marginBottom: '8px',
              }}>
                Low Stock
              </p>
              <p style={{
                fontSize: '2rem',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--enterprise-warning)',
              }}>
                {lowCount}
              </p>
            </div>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--border-radius-md)',
              backgroundColor: 'rgba(234, 179, 8, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <AlertTriangle size={24} style={{ color: 'var(--enterprise-warning)' }} />
            </div>
          </div>
        </Card>

        <Card>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <p style={{
                fontSize: 'var(--font-size-sm)',
                color: 'var(--enterprise-gray-600)',
                fontWeight: 'var(--font-weight-medium)',
                marginBottom: '8px',
              }}>
                Critical Stock
              </p>
              <p style={{
                fontSize: '2rem',
                fontWeight: 'var(--font-weight-bold)',
                color: 'var(--enterprise-error)',
              }}>
                {criticalCount}
              </p>
            </div>
            <div style={{
              width: '48px',
              height: '48px',
              borderRadius: 'var(--border-radius-md)',
              backgroundColor: 'rgba(220, 38, 38, 0.1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <AlertTriangle size={24} style={{ color: 'var(--enterprise-error)' }} />
            </div>
          </div>
        </Card>
      </div>

      {/* Inventory Table */}
      <Card style={{ padding: 0, overflow: 'hidden' }}>
        {enrichedInventory.length === 0 ? (
          <EmptyState
            icon={<Package size={48} />}
            title="No Inventory Records"
            description="Inventory will be automatically created when you add items"
          />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{
                  backgroundColor: 'var(--table-header-bg)',
                  borderBottom: '2px solid var(--table-border)',
                }}>
                  <th style={{ ...thStyle, minWidth: '100px' }}>Item Code</th>
                  <th style={{ ...thStyle, minWidth: '180px' }}>Description</th>
                  <th style={{ ...thStyle, textAlign: 'center', minWidth: '60px' }}>UOM</th>
                  <th style={{ ...thStyle, textAlign: 'right', minWidth: '120px' }}>Net Available</th>
                  <th style={{ ...thStyle, textAlign: 'center', minWidth: '100px' }}>Status</th>
                  <th style={{ ...thStyle, textAlign: 'center', minWidth: '80px' }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {enrichedInventory.map((inv, index) => (
                  <tr
                    key={inv.id}
                    style={{
                      backgroundColor: index % 2 === 0 ? 'white' : 'var(--table-stripe)',
                      borderBottom: '1px solid var(--table-border)',
                      transition: 'background-color var(--transition-fast)',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'var(--table-hover)';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = index % 2 === 0 ? 'white' : 'var(--table-stripe)';
                    }}
                  >
                    <td style={{ ...tdStyle, fontWeight: 'var(--font-weight-semibold)', color: 'var(--enterprise-primary)' }}>
                      {inv.item.itemCode}
                    </td>
                    <td style={tdStyle}>
                      {inv.item.description || inv.item.itemName}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      {inv.item.uom}
                    </td>
                    <td style={{
                      ...tdStyle,
                      textAlign: 'right',
                      fontWeight: 'var(--font-weight-bold)',
                      color: inv.status === 'critical' ? 'var(--enterprise-error)' :
                        inv.status === 'low' ? 'var(--enterprise-warning)' :
                          'var(--enterprise-success)',
                    }}>
                      {inv.netAvailable}
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <Badge variant={
                        inv.status === 'healthy' ? 'success' :
                          inv.status === 'low' ? 'warning' :
                            'error'
                      }>
                        {inv.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td style={{ ...tdStyle, textAlign: 'center' }}>
                      <Button
                        variant="tertiary"
                        size="sm"
                        icon={<Eye size={14} />}
                        onClick={() => handleView(inv)}
                      >
                        View
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Info Box */}
      <div style={{
        backgroundColor: 'var(--enterprise-info-bg)',
        border: '1px solid var(--enterprise-info)',
        borderRadius: 'var(--border-radius-md)',
        padding: '16px',
        display: 'flex',
        gap: '12px',
      }}>
        <TrendingUp size={20} style={{ color: 'var(--enterprise-info)', flexShrink: 0, marginTop: '2px' }} />
        <div>
          <p style={{
            fontSize: 'var(--font-size-sm)',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--enterprise-info)',
            marginBottom: '4px',
          }}>
            Inventory Management
          </p>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-700)' }}>
            Net Available = Warehouse Available + In Transit − Reserved •
            Inventory is read-only •
            Use Stock Movements for adjustments •
            Item creation happens in Item Master
          </p>
        </div>
      </div>

      {/* View Modal */}
      <InventoryViewModal
        isOpen={showViewModal}
        onClose={() => setShowViewModal(false)}
        inventory={selectedInventory}
      />

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        .spinning {
          animation: spin 1s linear infinite;
        }
      `}</style>
    </div>
  );
}
