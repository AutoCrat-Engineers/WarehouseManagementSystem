import React, { useState, useEffect } from 'react';
import { projectId } from '../utils/supabase/info';
import { BarChart3, Loader2, AlertTriangle, CheckCircle, Clock, Zap, RefreshCw } from 'lucide-react';

interface PlanningModuleProps {
  accessToken: string;
}

interface PlanningRecommendation {
  itemId: string;
  itemCode: string;
  itemName: string;
  currentStock: number;
  minStock: number;
  maxStock: number;
  safetyStock: number;
  leadTimeDays: number;
  forecastedDemand: number;
  recommendedOrder: number;
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  reason: string;
  daysUntilStockout?: number;
  targetDate?: string;
}

interface MRPResult {
  recommendations: PlanningRecommendation[];
  summary: {
    totalItems: number;
    criticalCount: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
  };
  generatedAt: string;
}

export function PlanningModule({ accessToken }: PlanningModuleProps) {
  const [mrpResult, setMrpResult] = useState<MRPResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [priorityFilter, setPriorityFilter] = useState<string>('ALL');

  const runMRP = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/planning/mrp`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({}),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to run MRP');
      }

      const data = await response.json();
      setMrpResult(data);
    } catch (error) {
      console.error('Error running MRP:', error);
      alert(error instanceof Error ? error.message : 'Failed to run MRP');
    } finally {
      setLoading(false);
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'CRITICAL': return 'bg-red-100 text-red-700 border-red-300';
      case 'HIGH': return 'bg-orange-100 text-orange-700 border-orange-300';
      case 'MEDIUM': return 'bg-yellow-100 text-yellow-700 border-yellow-300';
      case 'LOW': return 'bg-blue-100 text-blue-700 border-blue-300';
      default: return 'bg-gray-100 text-gray-700 border-gray-300';
    }
  };

  const getPriorityIcon = (priority: string) => {
    switch (priority) {
      case 'CRITICAL': return <AlertTriangle className="text-red-600" size={20} />;
      case 'HIGH': return <AlertTriangle className="text-orange-600" size={20} />;
      case 'MEDIUM': return <Clock className="text-yellow-600" size={20} />;
      case 'LOW': return <CheckCircle className="text-blue-600" size={20} />;
      default: return null;
    }
  };

  const filteredRecommendations = mrpResult?.recommendations.filter(rec => 
    priorityFilter === 'ALL' || rec.priority === priorityFilter
  ) || [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">MRP Planning</h1>
          <p className="text-gray-600 mt-1">Material Requirements Planning with Min/Max Logic</p>
        </div>
        <div className="flex items-center gap-2 bg-purple-50 px-4 py-2 rounded-lg border border-purple-200">
          <Zap className="text-purple-600" size={20} />
          <span className="text-sm font-semibold text-purple-900">Intelligent Planning</span>
        </div>
      </div>

      {/* Control Panel */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="flex items-center gap-4">
          <button
            onClick={runMRP}
            disabled={loading}
            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
          >
            {loading ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Running MRP Analysis...
              </>
            ) : (
              <>
                <BarChart3 size={20} />
                Run MRP Planning
              </>
            )}
          </button>
        </div>

        {mrpResult && (
          <div className="mt-4 text-sm text-gray-600 flex items-center justify-between">
            <span>Last run: {new Date(mrpResult.generatedAt).toLocaleString()}</span>
            <button
              onClick={runMRP}
              className="flex items-center gap-1 text-blue-600 hover:text-blue-700"
            >
              <RefreshCw size={14} />
              Refresh
            </button>
          </div>
        )}
      </div>

      {/* MRP Logic Explanation */}
      <div className="bg-gradient-to-r from-purple-50 to-indigo-50 border border-purple-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <BarChart3 className="text-purple-600 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <h3 className="text-sm font-semibold text-purple-900">How MRP Works</h3>
            <p className="text-sm text-purple-700 mt-1">
              The system analyzes <strong>current stock</strong>, <strong>min/max levels</strong>, <strong>safety stock</strong>, 
              <strong> forecasted demand</strong>, and <strong>lead times</strong> to generate intelligent replenishment recommendations. 
              Priorities are automatically assigned based on urgency and risk of stockout.
            </p>
          </div>
        </div>
      </div>

      {/* Summary Cards */}
      {mrpResult && (
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-gray-600">Total Items</p>
                <p className="text-2xl font-bold text-gray-900 mt-1">
                  {mrpResult.summary.totalItems}
                </p>
              </div>
              <BarChart3 className="text-gray-600" size={24} />
            </div>
          </div>

          <div className="bg-red-50 rounded-lg border border-red-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-red-700 font-medium">Critical</p>
                <p className="text-2xl font-bold text-red-700 mt-1">
                  {mrpResult.summary.criticalCount}
                </p>
              </div>
              <AlertTriangle className="text-red-600" size={24} />
            </div>
          </div>

          <div className="bg-orange-50 rounded-lg border border-orange-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-orange-700 font-medium">High</p>
                <p className="text-2xl font-bold text-orange-700 mt-1">
                  {mrpResult.summary.highCount}
                </p>
              </div>
              <AlertTriangle className="text-orange-600" size={24} />
            </div>
          </div>

          <div className="bg-yellow-50 rounded-lg border border-yellow-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-yellow-700 font-medium">Medium</p>
                <p className="text-2xl font-bold text-yellow-700 mt-1">
                  {mrpResult.summary.mediumCount}
                </p>
              </div>
              <Clock className="text-yellow-600" size={24} />
            </div>
          </div>

          <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-blue-700 font-medium">Low</p>
                <p className="text-2xl font-bold text-blue-700 mt-1">
                  {mrpResult.summary.lowCount}
                </p>
              </div>
              <CheckCircle className="text-blue-600" size={24} />
            </div>
          </div>
        </div>
      )}

      {/* Filter */}
      {mrpResult && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-700">Filter by Priority:</span>
          <div className="flex gap-2">
            {['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(priority => (
              <button
                key={priority}
                onClick={() => setPriorityFilter(priority)}
                className={`px-3 py-1 text-sm font-medium rounded-lg transition-colors ${
                  priorityFilter === priority
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {priority}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {mrpResult && filteredRecommendations.length > 0 && (
        <div className="space-y-4">
          {filteredRecommendations.map((rec) => (
            <div
              key={rec.itemId}
              className={`bg-white rounded-xl shadow-sm border-2 p-6 ${getPriorityColor(rec.priority)}`}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4 flex-1">
                  <div className="p-3 rounded-lg bg-white border border-gray-200">
                    {getPriorityIcon(rec.priority)}
                  </div>

                  <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                      <h3 className="text-lg font-bold text-gray-900">{rec.itemCode}</h3>
                      <span className={`inline-flex px-2 py-1 text-xs font-bold rounded-full ${getPriorityColor(rec.priority)}`}>
                        {rec.priority} PRIORITY
                      </span>
                    </div>
                    <p className="text-sm text-gray-600 mb-3">{rec.itemName}</p>

                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-4">
                      <div>
                        <p className="text-xs text-gray-500">Current Stock</p>
                        <p className="text-lg font-bold text-gray-900">{rec.currentStock}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Min / Max</p>
                        <p className="text-lg font-bold text-gray-900">{rec.minStock} / {rec.maxStock}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Safety Stock</p>
                        <p className="text-lg font-bold text-gray-900">{rec.safetyStock}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Forecasted Demand</p>
                        <p className="text-lg font-bold text-blue-600">{rec.forecastedDemand}</p>
                      </div>
                      <div>
                        <p className="text-xs text-gray-500">Lead Time</p>
                        <p className="text-lg font-bold text-gray-900">{rec.leadTimeDays} days</p>
                      </div>
                    </div>

                    <div className="bg-white/50 rounded-lg p-3 mb-3">
                      <p className="text-sm font-medium text-gray-700 mb-1">Reason:</p>
                      <p className="text-sm text-gray-900">{rec.reason}</p>
                    </div>

                    {rec.daysUntilStockout !== undefined && rec.daysUntilStockout < 30 && (
                      <div className="flex items-center gap-2 text-sm text-red-700">
                        <AlertTriangle size={16} />
                        <span className="font-medium">
                          Estimated stockout in {rec.daysUntilStockout} days
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-right ml-4">
                  <p className="text-sm text-gray-600 mb-1">Recommended Order</p>
                  <p className="text-4xl font-bold text-green-600">{rec.recommendedOrder}</p>
                  <p className="text-xs text-gray-500 mt-1">units</p>
                  {rec.targetDate && (
                    <p className="text-xs text-gray-600 mt-2">
                      Target: {new Date(rec.targetDate).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 mt-4 pt-4 border-t border-gray-200">
                <button className="flex-1 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition-colors font-medium">
                  Create Purchase Order
                </button>
                <button className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition-colors font-medium">
                  Schedule Production
                </button>
                <button className="px-6 bg-gray-100 text-gray-700 py-2 rounded-lg hover:bg-gray-200 transition-colors font-medium">
                  Ignore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Empty State */}
      {!mrpResult && !loading && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <BarChart3 className="mx-auto text-gray-400 mb-4" size={64} />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No MRP Analysis Yet</h3>
          <p className="text-gray-600">
            Click "Run MRP Planning" to generate intelligent replenishment recommendations
          </p>
        </div>
      )}

      {/* No Recommendations */}
      {mrpResult && filteredRecommendations.length === 0 && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <CheckCircle className="mx-auto text-green-500 mb-4" size={64} />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Recommendations</h3>
          <p className="text-gray-600">
            {priorityFilter === 'ALL' 
              ? 'All items are within acceptable stock levels!'
              : `No items with ${priorityFilter} priority at this time.`
            }
          </p>
        </div>
      )}
    </div>
  );
}
