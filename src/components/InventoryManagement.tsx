import React, { useState, useEffect } from 'react';
import { projectId } from '../utils/supabase/info';
import { Package, RefreshCw, AlertTriangle, CheckCircle, TrendingUp } from 'lucide-react';
import { Card, Button, Badge, LoadingSpinner, EmptyState } from './ui/EnterpriseUI';

interface InventoryManagementProps {
  accessToken: string;
}

interface Inventory {
  id: string;
  itemId: string;
  availableStock: number;
  reservedStock: number;
  inTransitStock: number;
  lastMovementDate?: string;
  lastMovementType?: string;
  updatedAt: string;
}

interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  uom: string;
  minStock: number;
  maxStock: number;
  safetyStock: number;
}

interface EnrichedInventory extends Inventory {
  item?: Item;
  totalStock: number;
  status: 'healthy' | 'warning' | 'critical';
}

export function InventoryManagement({ accessToken }: InventoryManagementProps) {
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async (showRefreshing = false) => {
    if (showRefreshing) setRefreshing(true);
    
    try {
      const [invResponse, itemsResponse] = await Promise.all([
        fetch(`https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/inventory`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }),
        fetch(`https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/items`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })
      ]);

      if (!invResponse.ok || !itemsResponse.ok) throw new Error('Failed to fetch data');

      const invData = await invResponse.json();
      const itemsData = await itemsResponse.json();

      setInventory(invData.inventory || []);
      setItems(itemsData.items || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const getEnrichedInventory = (): EnrichedInventory[] => {
    return inventory.map(inv => {
      const item = items.find(i => i.id === inv.itemId);
      const totalStock = inv.availableStock + inv.reservedStock + inv.inTransitStock;
      
      let status: 'healthy' | 'warning' | 'critical' = 'healthy';
      if (item) {
        if (inv.availableStock < item.minStock) {
          status = 'critical';
        } else if (inv.availableStock < item.safetyStock) {
          status = 'warning';
        }
      }

      return {
        ...inv,
        item,
        totalStock,
        status,
      };
    });
  };

  const enrichedInventory = getEnrichedInventory();
  const healthyCount = enrichedInventory.filter(i => i.status === 'healthy').length;
  const warningCount = enrichedInventory.filter(i => i.status === 'warning').length;
  const criticalCount = enrichedInventory.filter(i => i.status === 'critical').length;

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      {/* Header Actions */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <p style={{
            fontSize: 'var(--font-size-sm)',
            color: 'var(--enterprise-gray-600)',
          }}>
            Last updated: {new Date().toLocaleString()}
          </p>
        </div>
        <Button
          variant="secondary"
          icon={<RefreshCw size={20} className={refreshing ? 'spinning' : ''} />}
          onClick={() => fetchData(true)}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {/* Summary Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
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
            <Package size={32} style={{ color: 'var(--enterprise-primary)' }} />
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
            <CheckCircle size={32} style={{ color: 'var(--enterprise-success)' }} />
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
                {warningCount}
              </p>
            </div>
            <AlertTriangle size={32} style={{ color: 'var(--enterprise-warning)' }} />
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
            <AlertTriangle size={32} style={{ color: 'var(--enterprise-error)' }} />
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
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Item Code
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'left',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Item Name
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'right',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Available
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'right',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Reserved
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'right',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    In Transit
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'right',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Total Stock
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'right',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Min / Max
                  </th>
                  <th style={{
                    padding: '12px 16px',
                    textAlign: 'center',
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-semibold)',
                    color: 'var(--enterprise-gray-700)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    Status
                  </th>
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
                    <td style={{
                      padding: '12px 16px',
                      fontSize: 'var(--font-size-base)',
                      fontWeight: 'var(--font-weight-semibold)',
                      color: 'var(--enterprise-gray-900)',
                    }}>
                      {inv.item?.itemCode || 'N/A'}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      fontSize: 'var(--font-size-base)',
                      color: 'var(--enterprise-gray-800)',
                    }}>
                      {inv.item?.itemName || 'Unknown'}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontSize: 'var(--font-size-base)',
                      fontWeight: 'var(--font-weight-bold)',
                      color: 'var(--enterprise-primary)',
                    }}>
                      {inv.availableStock}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontSize: 'var(--font-size-base)',
                      color: 'var(--enterprise-secondary)',
                    }}>
                      {inv.reservedStock}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontSize: 'var(--font-size-base)',
                      color: 'var(--enterprise-info)',
                    }}>
                      {inv.inTransitStock}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontSize: 'var(--font-size-base)',
                      fontWeight: 'var(--font-weight-semibold)',
                      color: 'var(--enterprise-gray-900)',
                    }}>
                      {inv.totalStock}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'right',
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--enterprise-gray-600)',
                    }}>
                      {inv.item ? `${inv.item.minStock} / ${inv.item.maxStock}` : 'N/A'}
                    </td>
                    <td style={{
                      padding: '12px 16px',
                      textAlign: 'center',
                    }}>
                      <Badge variant={
                        inv.status === 'healthy' ? 'success' :
                        inv.status === 'warning' ? 'warning' :
                        'error'
                      }>
                        {inv.status}
                      </Badge>
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
            Stock Management
          </p>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--enterprise-gray-700)' }}>
            Available stock can be used for shipments • Reserved stock is allocated to releases • In-transit stock is on the way • Use Stock Movements to adjust inventory
          </p>
        </div>
      </div>

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
