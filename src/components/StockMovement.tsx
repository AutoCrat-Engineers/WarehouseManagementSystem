import React, { useState, useEffect } from 'react';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { 
  ArrowUpCircle, 
  ArrowDownCircle, 
  Plus, 
  RefreshCw, 
  Loader2, 
  Filter,
  History,
  Search,
  FileText
} from 'lucide-react';

interface StockMovementProps {
  accessToken: string;
}

interface InventoryMovement {
  id: string;
  itemId: string;
  movementType: 'IN' | 'OUT';
  quantity: number;
  reason: string;
  referenceType: string;
  referenceId: string;
  balanceAfter: number;
  createdAt: string;
  createdBy: string;
  createdByName: string;
}

interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  uom: string;
  minStock: number;
  maxStock: number;
}

interface Inventory {
  id: string;
  itemId: string;
  currentStock: number;
  openingStock: number;
  productionInward: number;
  customerOutward: number;
  lastUpdated: string;
}

export function StockMovement({ accessToken }: StockMovementProps) {
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [inventory, setInventory] = useState<Inventory[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filterItemId, setFilterItemId] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');

  // Form state
  const [selectedItemId, setSelectedItemId] = useState('');
  const [movementType, setMovementType] = useState<'IN' | 'OUT'>('IN');
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState('');
  const [referenceType, setReferenceType] = useState('Manual');
  const [referenceId, setReferenceId] = useState('');

  useEffect(() => {
    fetchData();
  }, [filterItemId]);

  const fetchData = async () => {
    try {
      setLoading(true);
      const apiUrl = `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11`;
      
      const [movementsResponse, itemsResponse, inventoryResponse] = await Promise.all([
        fetch(`${apiUrl}/stock-movements${filterItemId ? `?itemId=${filterItemId}` : ''}`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }),
        fetch(`${apiUrl}/items`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }),
        fetch(`${apiUrl}/inventory`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })
      ]);

      if (!movementsResponse.ok || !itemsResponse.ok || !inventoryResponse.ok) {
        throw new Error('Failed to fetch data');
      }

      const movementsData = await movementsResponse.json();
      const itemsData = await itemsResponse.json();
      const inventoryData = await inventoryResponse.json();

      setMovements(movementsData.movements || []);
      setItems(itemsData.items || []);
      setInventory(inventoryData.inventory || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateMovement = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedItemId || quantity <= 0) return;

    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/inventory/adjust`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            itemId: selectedItemId,
            movementType,
            transactionType: referenceType,
            quantity,
            reason,
            referenceType: referenceType,
            referenceId: referenceId || undefined
          }),
        }
      );

      const responseData = await response.json();

      if (!response.ok) {
        const errorMessage = responseData.error || 'Failed to create stock movement';
        console.error('Stock movement creation failed:', errorMessage);
        alert(`Error: ${errorMessage}`);
        return;
      }

      await fetchData();
      handleCloseModal();
    } catch (error) {
      console.error('Error creating stock movement:', error);
      alert(`Failed to create stock movement: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
    setSelectedItemId('');
    setMovementType('IN');
    setQuantity(0);
    setReason('');
    setReferenceType('Manual');
    setReferenceId('');
  };

  const getItemDetails = (itemId: string) => {
    return items.find(item => item.id === itemId);
  };

  const getInventoryDetails = (itemId: string) => {
    return inventory.find(inv => inv.itemId === itemId);
  };

  const formatDateTime = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Filter movements based on search query
  const filteredMovements = movements.filter(movement => {
    if (!searchQuery) return true;
    
    const item = getItemDetails(movement.itemId);
    const searchLower = searchQuery.toLowerCase();
    
    return (
      item?.itemCode.toLowerCase().includes(searchLower) ||
      item?.itemName.toLowerCase().includes(searchLower) ||
      movement.reason.toLowerCase().includes(searchLower) ||
      movement.referenceType.toLowerCase().includes(searchLower) ||
      movement.referenceId.toLowerCase().includes(searchLower)
    );
  });

  // Calculate summary statistics
  const totalMovements = movements.length;
  const totalInward = movements
    .filter(m => m.movementType === 'IN')
    .reduce((sum, m) => sum + m.quantity, 0);
  const totalOutward = movements
    .filter(m => m.movementType === 'OUT')
    .reduce((sum, m) => sum + m.quantity, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Stock Movement Ledger</h1>
          <p className="text-gray-600 mt-1">Complete audit trail of all inventory transactions</p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={fetchData}
            className="flex items-center gap-2 bg-gray-100 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-200 transition-colors"
          >
            <RefreshCw size={20} />
            Refresh
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            <Plus size={20} />
            New Movement
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-600">Total Movements</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{totalMovements}</p>
            </div>
            <History className="text-blue-600" size={24} />
          </div>
        </div>

        <div className="bg-green-50 rounded-lg border border-green-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-green-700 font-medium">Total Inward</p>
              <p className="text-2xl font-bold text-green-700 mt-1">+{totalInward.toLocaleString()}</p>
            </div>
            <ArrowUpCircle className="text-green-600" size={24} />
          </div>
        </div>

        <div className="bg-red-50 rounded-lg border border-red-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-red-700 font-medium">Total Outward</p>
              <p className="text-2xl font-bold text-red-700 mt-1">-{totalOutward.toLocaleString()}</p>
            </div>
            <ArrowDownCircle className="text-red-600" size={24} />
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Filter size={16} className="inline mr-1" />
              Filter by Item
            </label>
            <select
              value={filterItemId}
              onChange={(e) => setFilterItemId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="">All Items</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.itemCode} - {item.itemName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              <Search size={16} className="inline mr-1" />
              Search Movements
            </label>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by item, reason, reference..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
          </div>
        </div>
      </div>

      {/* Movements Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-blue-600" size={32} />
          </div>
        ) : filteredMovements.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="mx-auto text-gray-400 mb-4" size={48} />
            <p className="text-gray-600">No stock movements found</p>
            <p className="text-sm text-gray-500 mt-2">
              {searchQuery || filterItemId
                ? 'Try adjusting your filters'
                : 'Create your first stock movement to get started'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Date & Time</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Item</th>
                  <th className="text-center px-6 py-4 text-sm font-semibold text-gray-900">Type</th>
                  <th className="text-right px-6 py-4 text-sm font-semibold text-gray-900">Quantity</th>
                  <th className="text-right px-6 py-4 text-sm font-semibold text-gray-900">Balance After</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Reference</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Reason</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Created By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredMovements.map((movement) => {
                  const item = getItemDetails(movement.itemId);
                  const isInward = movement.movementType === 'IN';
                  
                  return (
                    <tr key={movement.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 text-sm text-gray-900">
                        {formatDateTime(movement.createdAt)}
                      </td>
                      <td className="px-6 py-4 text-sm">
                        <div className="font-medium text-gray-900">{item?.itemCode || 'N/A'}</div>
                        <div className="text-gray-500 text-xs">{item?.itemName}</div>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className={`inline-flex items-center gap-1 px-3 py-1 text-xs font-medium rounded-full ${
                          isInward
                            ? 'bg-green-100 text-green-700'
                            : 'bg-red-100 text-red-700'
                        }`}>
                          {isInward ? (
                            <>
                              <ArrowUpCircle size={14} />
                              IN
                            </>
                          ) : (
                            <>
                              <ArrowDownCircle size={14} />
                              OUT
                            </>
                          )}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-sm text-right">
                        <span className={`font-bold ${
                          isInward ? 'text-green-600' : 'text-red-600'
                        }`}>
                          {isInward ? '+' : '-'}{movement.quantity.toLocaleString()}
                        </span>
                        <span className="text-gray-500 ml-1">{item?.uom}</span>
                      </td>
                      <td className="px-6 py-4 text-sm text-right font-bold text-gray-900">
                        {movement.balanceAfter.toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-900">
                        <div className="font-medium">{movement.referenceType}</div>
                        {movement.referenceId && (
                          <div className="text-xs text-gray-500">{movement.referenceId}</div>
                        )}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate">
                        {movement.reason || '-'}
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">
                        {movement.createdByName}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Movement Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-2xl font-bold text-gray-900">Create Stock Movement</h2>
              <p className="text-sm text-gray-600 mt-1">
                Record a new inventory transaction
              </p>
            </div>

            <form onSubmit={handleCreateMovement} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Item *
                </label>
                <select
                  value={selectedItemId}
                  onChange={(e) => setSelectedItemId(e.target.value)}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                >
                  <option value="">Select an item</option>
                  {items.map((item) => {
                    const inv = getInventoryDetails(item.id);
                    return (
                      <option key={item.id} value={item.id}>
                        {item.itemCode} - {item.itemName} (Current: {inv?.currentStock || 0} {item.uom})
                      </option>
                    );
                  })}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Movement Type *
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setMovementType('IN')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        movementType === 'IN'
                          ? 'bg-green-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <ArrowUpCircle size={16} className="inline mr-1" />
                      IN
                    </button>
                    <button
                      type="button"
                      onClick={() => setMovementType('OUT')}
                      className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                        movementType === 'OUT'
                          ? 'bg-red-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      <ArrowDownCircle size={16} className="inline mr-1" />
                      OUT
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Quantity *
                  </label>
                  <input
                    type="number"
                    value={quantity}
                    onChange={(e) => setQuantity(parseInt(e.target.value) || 0)}
                    required
                    min="1"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reference Type
                </label>
                <select
                  value={referenceType}
                  onChange={(e) => setReferenceType(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                >
                  <option value="Manual">Manual</option>
                  <option value="Production Order">Production Order</option>
                  <option value="Blanket Release Shipment">Blanket Release Shipment</option>
                  <option value="Purchase Order">Purchase Order</option>
                  <option value="Sales Order">Sales Order</option>
                  <option value="Stock Adjustment">Stock Adjustment</option>
                  <option value="Stock Transfer">Stock Transfer</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reference ID {referenceType === 'Blanket Release Shipment' && movementType === 'OUT' && <span className="text-red-600">*</span>}
                </label>
                <input
                  type="text"
                  value={referenceId}
                  onChange={(e) => setReferenceId(e.target.value)}
                  placeholder="e.g., PO-2024-001, BO-REL-123"
                  required={referenceType === 'Blanket Release Shipment' && movementType === 'OUT'}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
                {referenceType === 'Blanket Release Shipment' && movementType === 'OUT' && (
                  <p className="text-xs text-red-600 mt-1">Blanket Release ID is mandatory for shipments</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Reason / Notes *
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  required
                  placeholder="Enter the reason for this stock movement (required)..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Required: Provide a clear reason for this stock movement
                </p>
              </div>

              {selectedItemId && (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-blue-900 mb-2">Current Stock Information</h3>
                  {(() => {
                    const item = getItemDetails(selectedItemId);
                    const inv = getInventoryDetails(selectedItemId);
                    if (!item || !inv) return null;

                    const projectedStock = movementType === 'IN' 
                      ? inv.currentStock + quantity 
                      : inv.currentStock - quantity;

                    return (
                      <div className="grid grid-cols-2 gap-4 text-sm">
                        <div>
                          <p className="text-gray-600">Current Stock:</p>
                          <p className="font-bold text-gray-900">{inv.currentStock} {item.uom}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">After Transaction:</p>
                          <p className={`font-bold ${
                            projectedStock < item.minStock ? 'text-red-600' :
                            projectedStock > item.maxStock ? 'text-orange-600' :
                            'text-green-600'
                          }`}>
                            {projectedStock} {item.uom}
                          </p>
                        </div>
                        <div>
                          <p className="text-gray-600">Min Stock:</p>
                          <p className="font-bold text-gray-900">{item.minStock} {item.uom}</p>
                        </div>
                        <div>
                          <p className="text-gray-600">Max Stock:</p>
                          <p className="font-bold text-gray-900">{item.maxStock} {item.uom}</p>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Create Movement
                </button>
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 bg-gray-100 text-gray-700 py-2 rounded-lg hover:bg-gray-200 transition-colors font-medium"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}