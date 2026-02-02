import React, { useState, useEffect } from 'react';
import { projectId } from '../utils/supabase/info';
import { Plus, Edit2, FileText, Loader2, Search, Trash2, Eye, Package } from 'lucide-react';

interface BlanketOrdersProps {
  accessToken: string;
}

interface BlanketOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  orderDate: string;
  startDate: string;
  endDate: string;
  status: 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  createdAt: string;
  updatedAt: string;
}

interface OrderLine {
  id: string;
  orderId: string;
  itemId: string;
  itemCode?: string;
  itemName?: string;
  totalQuantity: number;
  releasedQuantity: number;
  deliveredQuantity: number;
  remainingQuantity: number;
}

interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  uom: string;
}

export function BlanketOrders({ accessToken }: BlanketOrdersProps) {
  const [orders, setOrders] = useState<BlanketOrder[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [showLinesModal, setShowLinesModal] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<BlanketOrder | null>(null);
  const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [formData, setFormData] = useState({
    orderNumber: '',
    customerName: '',
    orderDate: new Date().toISOString().split('T')[0],
    startDate: new Date().toISOString().split('T')[0],
    endDate: '',
    status: 'ACTIVE' as 'ACTIVE' | 'COMPLETED' | 'CANCELLED',
    lines: [{ itemId: '', totalQuantity: 0 }]
  });

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      const [ordersResponse, itemsResponse] = await Promise.all([
        fetch(`https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/blanket-orders`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }),
        fetch(`https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/items`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })
      ]);

      if (!ordersResponse.ok || !itemsResponse.ok) {
        throw new Error('Failed to fetch data');
      }

      const ordersData = await ordersResponse.json();
      const itemsData = await itemsResponse.json();

      setOrders(ordersData.orders || []);
      setItems(itemsData.items || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOrderLines = async (orderId: string) => {
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/blanket-orders/${orderId}/lines`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      );

      if (!response.ok) throw new Error('Failed to fetch order lines');

      const data = await response.json();
      setOrderLines(data.lines || []);
    } catch (error) {
      console.error('Error fetching order lines:', error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/blanket-orders`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            orderNumber: formData.orderNumber,
            customerName: formData.customerName,
            orderDate: formData.orderDate,
            startDate: formData.startDate,
            endDate: formData.endDate,
            status: formData.status,
            lines: formData.lines.filter(line => line.itemId && line.totalQuantity > 0)
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to save blanket order');
      }

      await fetchData();
      handleCloseModal();
    } catch (error) {
      console.error('Error saving blanket order:', error);
      alert(error instanceof Error ? error.message : 'Failed to save blanket order');
    }
  };

  const handleViewLines = async (order: BlanketOrder) => {
    setSelectedOrder(order);
    await fetchOrderLines(order.id);
    setShowLinesModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setFormData({
      orderNumber: '',
      customerName: '',
      orderDate: new Date().toISOString().split('T')[0],
      startDate: new Date().toISOString().split('T')[0],
      endDate: '',
      status: 'ACTIVE',
      lines: [{ itemId: '', totalQuantity: 0 }]
    });
  };

  const handleAddLine = () => {
    setFormData({
      ...formData,
      lines: [...formData.lines, { itemId: '', totalQuantity: 0 }]
    });
  };

  const handleRemoveLine = (index: number) => {
    if (formData.lines.length > 1) {
      setFormData({
        ...formData,
        lines: formData.lines.filter((_, i) => i !== index)
      });
    }
  };

  const handleLineChange = (index: number, field: 'itemId' | 'totalQuantity', value: string | number) => {
    const newLines = [...formData.lines];
    newLines[index] = { ...newLines[index], [field]: value };
    setFormData({ ...formData, lines: newLines });
  };

  const getItemDetails = (itemId: string) => {
    return items.find(item => item.id === itemId);
  };

  const filteredOrders = orders.filter(order =>
    order.orderNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    order.customerName.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Blanket Orders</h1>
          <p className="text-gray-600 mt-1">Manage long-term customer orders with multiple items</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={20} />
          New Order
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-blue-700 font-medium">Active Orders</p>
              <p className="text-2xl font-bold text-blue-700 mt-1">
                {orders.filter(o => o.status === 'ACTIVE').length}
              </p>
            </div>
            <FileText className="text-blue-600" size={24} />
          </div>
        </div>

        <div className="bg-green-50 rounded-lg border border-green-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-green-700 font-medium">Completed</p>
              <p className="text-2xl font-bold text-green-700 mt-1">
                {orders.filter(o => o.status === 'COMPLETED').length}
              </p>
            </div>
            <FileText className="text-green-600" size={24} />
          </div>
        </div>

        <div className="bg-gray-50 rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-gray-700 font-medium">Total Orders</p>
              <p className="text-2xl font-bold text-gray-700 mt-1">{orders.length}</p>
            </div>
            <FileText className="text-gray-600" size={24} />
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
        <input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="Search by order number or customer name..."
          className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        />
      </div>

      {/* Orders Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-blue-600" size={32} />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="mx-auto text-gray-400 mb-4" size={48} />
            <p className="text-gray-600">No blanket orders found</p>
            <button
              onClick={() => setShowModal(true)}
              className="mt-4 text-blue-600 hover:text-blue-700 font-medium"
            >
              Create your first order
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Order Number</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Customer</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Order Date</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Valid Period</th>
                  <th className="text-center px-6 py-4 text-sm font-semibold text-gray-900">Status</th>
                  <th className="text-center px-6 py-4 text-sm font-semibold text-gray-900">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {order.orderNumber}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-900">
                      {order.customerName}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(order.orderDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(order.startDate).toLocaleDateString()} - {new Date(order.endDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                        order.status === 'ACTIVE' ? 'bg-green-100 text-green-700' :
                        order.status === 'COMPLETED' ? 'bg-blue-100 text-blue-700' :
                        'bg-gray-100 text-gray-700'
                      }`}>
                        {order.status}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <button
                        onClick={() => handleViewLines(order)}
                        className="inline-flex items-center gap-1 px-3 py-1 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition-colors"
                      >
                        <Eye size={14} />
                        View Lines
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Order Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-3xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 sticky top-0 bg-white">
              <h2 className="text-2xl font-bold text-gray-900">Create Blanket Order</h2>
              <p className="text-sm text-gray-600 mt-1">Multi-line order for long-term customer agreements</p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {/* Order Header */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Order Number *
                  </label>
                  <input
                    type="text"
                    value={formData.orderNumber}
                    onChange={(e) => setFormData({ ...formData, orderNumber: e.target.value })}
                    required
                    placeholder="BO-2024-001"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Customer Name *
                  </label>
                  <input
                    type="text"
                    value={formData.customerName}
                    onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                    required
                    placeholder="ABC Manufacturing Inc."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Order Date *
                  </label>
                  <input
                    type="date"
                    value={formData.orderDate}
                    onChange={(e) => setFormData({ ...formData, orderDate: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Status
                  </label>
                  <select
                    value={formData.status}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  >
                    <option value="ACTIVE">Active</option>
                    <option value="COMPLETED">Completed</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Valid From *
                  </label>
                  <input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Valid To *
                  </label>
                  <input
                    type="date"
                    value={formData.endDate}
                    onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>

              {/* Order Lines */}
              <div className="border-t pt-6">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Order Lines</h3>
                  <button
                    type="button"
                    onClick={handleAddLine}
                    className="flex items-center gap-1 px-3 py-1 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Plus size={16} />
                    Add Line
                  </button>
                </div>

                <div className="space-y-3">
                  {formData.lines.map((line, index) => (
                    <div key={index} className="flex gap-3 items-start bg-gray-50 p-3 rounded-lg">
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Item *
                        </label>
                        <select
                          value={line.itemId}
                          onChange={(e) => handleLineChange(index, 'itemId', e.target.value)}
                          required
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                        >
                          <option value="">Select item...</option>
                          {items.map(item => (
                            <option key={item.id} value={item.id}>
                              {item.itemCode} - {item.itemName}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="w-32">
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Quantity *
                        </label>
                        <input
                          type="number"
                          value={line.totalQuantity}
                          onChange={(e) => handleLineChange(index, 'totalQuantity', parseInt(e.target.value) || 0)}
                          required
                          min="1"
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-sm"
                        />
                      </div>

                      {formData.lines.length > 1 && (
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(index)}
                          className="mt-6 p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Create Order
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

      {/* View Lines Modal */}
      {showLinesModal && selectedOrder && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-2xl font-bold text-gray-900">Order Lines</h2>
              <p className="text-sm text-gray-600 mt-1">
                {selectedOrder.orderNumber} - {selectedOrder.customerName}
              </p>
            </div>

            <div className="p-6">
              {orderLines.length === 0 ? (
                <div className="text-center py-8">
                  <Package className="mx-auto text-gray-400 mb-3" size={40} />
                  <p className="text-gray-600">No order lines found</p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Item Code</th>
                        <th className="text-left px-4 py-3 text-sm font-semibold text-gray-900">Item Name</th>
                        <th className="text-right px-4 py-3 text-sm font-semibold text-gray-900">Total Qty</th>
                        <th className="text-right px-4 py-3 text-sm font-semibold text-gray-900">Released</th>
                        <th className="text-right px-4 py-3 text-sm font-semibold text-gray-900">Delivered</th>
                        <th className="text-right px-4 py-3 text-sm font-semibold text-gray-900">Remaining</th>
                        <th className="text-center px-4 py-3 text-sm font-semibold text-gray-900">Progress</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {orderLines.map((line) => {
                        const progress = (line.deliveredQuantity / line.totalQuantity) * 100;
                        return (
                          <tr key={line.id} className="hover:bg-gray-50">
                            <td className="px-4 py-3 text-sm font-medium text-gray-900">
                              {line.itemCode || 'N/A'}
                            </td>
                            <td className="px-4 py-3 text-sm text-gray-900">
                              {line.itemName || 'Unknown'}
                            </td>
                            <td className="px-4 py-3 text-sm text-right font-bold text-gray-900">
                              {line.totalQuantity}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-blue-600">
                              {line.releasedQuantity}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-green-600">
                              {line.deliveredQuantity}
                            </td>
                            <td className="px-4 py-3 text-sm text-right text-orange-600 font-bold">
                              {line.remainingQuantity}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="flex-1 bg-gray-200 rounded-full h-2">
                                  <div
                                    className="bg-green-500 h-2 rounded-full transition-all"
                                    style={{ width: `${progress}%` }}
                                  />
                                </div>
                                <span className="text-xs text-gray-600 w-12 text-right">
                                  {progress.toFixed(0)}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="p-6 border-t border-gray-200">
              <button
                onClick={() => setShowLinesModal(false)}
                className="w-full bg-gray-100 text-gray-700 py-2 rounded-lg hover:bg-gray-200 transition-colors font-medium"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
