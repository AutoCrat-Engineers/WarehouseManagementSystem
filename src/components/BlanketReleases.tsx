import React, { useState, useEffect } from 'react';
import { projectId } from '../utils/supabase/info';
import { Plus, Calendar, Loader2, Search, Truck, Package, AlertCircle, CheckCircle } from 'lucide-react';

interface BlanketReleasesProps {
  accessToken: string;
}

interface BlanketRelease {
  id: string;
  orderLineId: string;
  releaseNumber: string;
  releaseDate: string;
  scheduledDeliveryDate: string;
  actualDeliveryDate?: string;
  quantity: number;
  status: 'PENDING' | 'SHIPPED' | 'DELIVERED';
  shippingReference?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
  // Enriched fields
  orderNumber?: string;
  customerName?: string;
  itemCode?: string;
  itemName?: string;
}

interface OrderLine {
  id: string;
  orderId: string;
  itemId: string;
  totalQuantity: number;
  releasedQuantity: number;
  deliveredQuantity: number;
  remainingQuantity: number;
  orderNumber?: string;
  customerName?: string;
  itemCode?: string;
  itemName?: string;
}

export function BlanketReleases({ accessToken }: BlanketReleasesProps) {
  const [releases, setReleases] = useState<BlanketRelease[]>([]);
  const [orderLines, setOrderLines] = useState<OrderLine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  
  const [formData, setFormData] = useState({
    orderLineId: '',
    releaseNumber: '',
    releaseDate: new Date().toISOString().split('T')[0],
    scheduledDeliveryDate: '',
    quantity: 0,
    status: 'PENDING' as 'PENDING' | 'SHIPPED' | 'DELIVERED',
    shippingReference: '',
    notes: ''
  });

  useEffect(() => {
    fetchData();
  }, [statusFilter]);

  const fetchData = async () => {
    try {
      const url = statusFilter === 'ALL' 
        ? `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/blanket-releases`
        : `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/blanket-releases?status=${statusFilter}`;
      
      const [releasesResponse, linesResponse] = await Promise.all([
        fetch(url, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }),
        fetch(`https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/blanket-orders/lines/available`, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        })
      ]);

      if (!releasesResponse.ok || !linesResponse.ok) {
        throw new Error('Failed to fetch data');
      }

      const releasesData = await releasesResponse.json();
      const linesData = await linesResponse.json();

      setReleases(releasesData.releases || []);
      setOrderLines(linesData.lines || []);
    } catch (error) {
      console.error('Error fetching data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/blanket-releases`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify(formData),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to create release');
      }

      await fetchData();
      handleCloseModal();
    } catch (error) {
      console.error('Error creating release:', error);
      alert(error instanceof Error ? error.message : 'Failed to create release');
    }
  };

  const handleStatusUpdate = async (releaseId: string, newStatus: 'SHIPPED' | 'DELIVERED') => {
    if (!confirm(`Are you sure you want to mark this release as ${newStatus}?${newStatus === 'DELIVERED' ? '\n\n⚠️ This will automatically deduct stock from inventory!' : ''}`)) {
      return;
    }

    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/blanket-releases/${releaseId}/status`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({ 
            status: newStatus,
            actualDeliveryDate: newStatus === 'DELIVERED' ? new Date().toISOString().split('T')[0] : undefined
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to update status');
      }

      const result = await response.json();
      
      if (newStatus === 'DELIVERED' && result.stockDeducted) {
        alert(`✅ Release delivered successfully!\n\n📦 Stock deducted: ${result.stockDeducted.quantity} units\n📊 New available stock: ${result.stockDeducted.newStock}`);
      }

      await fetchData();
    } catch (error) {
      console.error('Error updating status:', error);
      alert(error instanceof Error ? error.message : 'Failed to update status');
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setFormData({
      orderLineId: '',
      releaseNumber: '',
      releaseDate: new Date().toISOString().split('T')[0],
      scheduledDeliveryDate: '',
      quantity: 0,
      status: 'PENDING',
      shippingReference: '',
      notes: ''
    });
  };

  const getOrderLineDetails = (orderLineId: string) => {
    return orderLines.find(line => line.id === orderLineId);
  };

  const filteredReleases = releases.filter(release =>
    release.releaseNumber.toLowerCase().includes(searchTerm.toLowerCase()) ||
    release.customerName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    release.itemCode?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Blanket Releases</h1>
          <p className="text-gray-600 mt-1">Manage delivery schedules with automatic inventory deduction</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus size={20} />
          New Release
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-yellow-700 font-medium">Pending</p>
              <p className="text-2xl font-bold text-yellow-700 mt-1">
                {releases.filter(r => r.status === 'PENDING').length}
              </p>
            </div>
            <Calendar className="text-yellow-600" size={24} />
          </div>
        </div>

        <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-blue-700 font-medium">Shipped</p>
              <p className="text-2xl font-bold text-blue-700 mt-1">
                {releases.filter(r => r.status === 'SHIPPED').length}
              </p>
            </div>
            <Truck className="text-blue-600" size={24} />
          </div>
        </div>

        <div className="bg-green-50 rounded-lg border border-green-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-green-700 font-medium">Delivered</p>
              <p className="text-2xl font-bold text-green-700 mt-1">
                {releases.filter(r => r.status === 'DELIVERED').length}
              </p>
            </div>
            <CheckCircle className="text-green-600" size={24} />
          </div>
        </div>

        <div className="bg-purple-50 rounded-lg border border-purple-200 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-purple-700 font-medium">Total Releases</p>
              <p className="text-2xl font-bold text-purple-700 mt-1">{releases.length}</p>
            </div>
            <Package className="text-purple-600" size={24} />
          </div>
        </div>
      </div>

      {/* Filters and Search */}
      <div className="flex gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={20} />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by release number, customer, or item..."
            className="w-full pl-10 pr-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
          />
        </div>
        
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="px-4 py-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
        >
          <option value="ALL">All Statuses</option>
          <option value="PENDING">Pending</option>
          <option value="SHIPPED">Shipped</option>
          <option value="DELIVERED">Delivered</option>
        </select>
      </div>

      {/* Auto-Deduction Alert */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex items-start gap-3">
        <AlertCircle className="text-blue-600 flex-shrink-0 mt-0.5" size={20} />
        <div>
          <p className="text-sm font-semibold text-blue-900">Automatic Stock Deduction Enabled</p>
          <p className="text-sm text-blue-700 mt-1">
            When you mark a release as <span className="font-bold">DELIVERED</span>, the system will automatically deduct the quantity from available inventory. This ensures real-time inventory accuracy.
          </p>
        </div>
      </div>

      {/* Releases Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-64">
            <Loader2 className="animate-spin text-blue-600" size={32} />
          </div>
        ) : filteredReleases.length === 0 ? (
          <div className="text-center py-12">
            <Calendar className="mx-auto text-gray-400 mb-4" size={48} />
            <p className="text-gray-600">No releases found</p>
            <button
              onClick={() => setShowModal(true)}
              className="mt-4 text-blue-600 hover:text-blue-700 font-medium"
            >
              Create your first release
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Release #</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Order / Customer</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Item</th>
                  <th className="text-right px-6 py-4 text-sm font-semibold text-gray-900">Quantity</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Scheduled Date</th>
                  <th className="text-left px-6 py-4 text-sm font-semibold text-gray-900">Actual Date</th>
                  <th className="text-center px-6 py-4 text-sm font-semibold text-gray-900">Status</th>
                  <th className="text-center px-6 py-4 text-sm font-semibold text-gray-900">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {filteredReleases.map((release) => (
                  <tr key={release.id} className="hover:bg-gray-50">
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">
                      {release.releaseNumber}
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div>
                        <p className="font-medium text-gray-900">{release.orderNumber || 'N/A'}</p>
                        <p className="text-gray-600 text-xs">{release.customerName || 'Unknown'}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm">
                      <div>
                        <p className="font-medium text-gray-900">{release.itemCode || 'N/A'}</p>
                        <p className="text-gray-600 text-xs">{release.itemName || 'Unknown'}</p>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-sm text-right font-bold text-gray-900">
                      {release.quantity}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {new Date(release.scheduledDeliveryDate).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-600">
                      {release.actualDeliveryDate 
                        ? new Date(release.actualDeliveryDate).toLocaleDateString()
                        : '-'
                      }
                    </td>
                    <td className="px-6 py-4 text-center">
                      <span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${
                        release.status === 'PENDING' ? 'bg-yellow-100 text-yellow-700' :
                        release.status === 'SHIPPED' ? 'bg-blue-100 text-blue-700' :
                        'bg-green-100 text-green-700'
                      }`}>
                        {release.status}
                        {release.status === 'DELIVERED' && (
                          <span className="ml-1" title="Stock automatically deducted">✓</span>
                        )}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        {release.status === 'PENDING' && (
                          <button
                            onClick={() => handleStatusUpdate(release.id, 'SHIPPED')}
                            className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors"
                          >
                            Ship
                          </button>
                        )}
                        {release.status === 'SHIPPED' && (
                          <button
                            onClick={() => handleStatusUpdate(release.id, 'DELIVERED')}
                            className="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors flex items-center gap-1"
                          >
                            <Package size={12} />
                            Deliver
                          </button>
                        )}
                        {release.status === 'DELIVERED' && (
                          <span className="text-green-600 text-xs font-medium flex items-center gap-1">
                            <CheckCircle size={14} />
                            Stock Deducted
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create Release Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-2xl font-bold text-gray-900">Create Release</h2>
              <p className="text-sm text-gray-600 mt-1">Schedule a delivery from a blanket order line</p>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Order Line *
                </label>
                <select
                  value={formData.orderLineId}
                  onChange={(e) => {
                    const line = getOrderLineDetails(e.target.value);
                    setFormData({ 
                      ...formData, 
                      orderLineId: e.target.value,
                      quantity: line?.remainingQuantity || 0
                    });
                  }}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                >
                  <option value="">Select order line...</option>
                  {orderLines.filter(l => l.remainingQuantity > 0).map(line => (
                    <option key={line.id} value={line.id}>
                      {line.orderNumber} - {line.customerName} - {line.itemCode} (Available: {line.remainingQuantity})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Release Number *
                  </label>
                  <input
                    type="text"
                    value={formData.releaseNumber}
                    onChange={(e) => setFormData({ ...formData, releaseNumber: e.target.value })}
                    required
                    placeholder="REL-2024-001"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Quantity *
                  </label>
                  <input
                    type="number"
                    value={formData.quantity}
                    onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) || 0 })}
                    required
                    min="1"
                    max={getOrderLineDetails(formData.orderLineId)?.remainingQuantity || 0}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                  {formData.orderLineId && (
                    <p className="text-xs text-gray-500 mt-1">
                      Max: {getOrderLineDetails(formData.orderLineId)?.remainingQuantity || 0}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Release Date *
                  </label>
                  <input
                    type="date"
                    value={formData.releaseDate}
                    onChange={(e) => setFormData({ ...formData, releaseDate: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Scheduled Delivery *
                  </label>
                  <input
                    type="date"
                    value={formData.scheduledDeliveryDate}
                    onChange={(e) => setFormData({ ...formData, scheduledDeliveryDate: e.target.value })}
                    required
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Shipping Reference
                </label>
                <input
                  type="text"
                  value={formData.shippingReference}
                  onChange={(e) => setFormData({ ...formData, shippingReference: e.target.value })}
                  placeholder="Tracking number, BOL, etc."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Notes
                </label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  placeholder="Delivery instructions, special handling, etc."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none resize-none"
                />
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium"
                >
                  Create Release
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
