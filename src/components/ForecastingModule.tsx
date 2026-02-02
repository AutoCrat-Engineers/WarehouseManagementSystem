import React, { useState, useEffect } from 'react';
import { projectId } from '../utils/supabase/info';
import { TrendingUp, Loader2, BarChart3, Activity, AlertCircle, Zap } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, AreaChart } from 'recharts';

interface ForecastingModuleProps {
  accessToken: string;
}

interface Item {
  id: string;
  itemCode: string;
  itemName: string;
  uom: string;
}

interface ForecastResult {
  itemId: string;
  itemCode: string;
  itemName: string;
  historicalDemand: number[];
  forecast: number[];
  lowerBound: number[];
  upperBound: number[];
  periods: number;
  algorithm: string;
  parameters: {
    alpha?: number;
    beta?: number;
    gamma?: number;
  };
  metrics: {
    mae?: number;
    mse?: number;
    rmse?: number;
  };
  generatedAt: string;
}

export function ForecastingModule({ accessToken }: ForecastingModuleProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [forecastResult, setForecastResult] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [periods, setPeriods] = useState(6);
  const [seasonalPeriods, setSeasonalPeriods] = useState(12);

  useEffect(() => {
    fetchItems();
  }, []);

  const fetchItems = async () => {
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/items`,
        {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        }
      );

      if (!response.ok) throw new Error('Failed to fetch items');

      const data = await response.json();
      setItems(data.items || []);
    } catch (error) {
      console.error('Error fetching items:', error);
    }
  };

  const generateForecast = async () => {
    if (!selectedItemId) {
      alert('Please select an item first');
      return;
    }

    setGenerating(true);
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/forecast/generate`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            itemId: selectedItemId,
            periods: periods,
            seasonalPeriods: seasonalPeriods
          }),
        }
      );

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Failed to generate forecast');
      }

      const data = await response.json();
      setForecastResult(data);
    } catch (error) {
      console.error('Error generating forecast:', error);
      alert(error instanceof Error ? error.message : 'Failed to generate forecast');
    } finally {
      setGenerating(false);
    }
  };

  const getChartData = () => {
    if (!forecastResult) return [];

    const data = [];
    const historicalLength = forecastResult.historicalDemand.length;

    // Historical data
    for (let i = 0; i < historicalLength; i++) {
      data.push({
        period: `Period ${i + 1}`,
        index: i + 1,
        actual: forecastResult.historicalDemand[i],
        forecast: null,
        lowerBound: null,
        upperBound: null,
      });
    }

    // Forecast data
    for (let i = 0; i < forecastResult.forecast.length; i++) {
      data.push({
        period: `Forecast ${i + 1}`,
        index: historicalLength + i + 1,
        actual: null,
        forecast: forecastResult.forecast[i],
        lowerBound: forecastResult.lowerBound[i],
        upperBound: forecastResult.upperBound[i],
      });
    }

    return data;
  };

  const selectedItem = items.find(item => item.id === selectedItemId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Demand Forecasting</h1>
          <p className="text-gray-600 mt-1">Holt-Winters Triple Exponential Smoothing Algorithm</p>
        </div>
        <div className="flex items-center gap-2 bg-blue-50 px-4 py-2 rounded-lg border border-blue-200">
          <Zap className="text-blue-600" size={20} />
          <span className="text-sm font-semibold text-blue-900">AI-Powered</span>
        </div>
      </div>

      {/* Control Panel */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Select Item *
            </label>
            <select
              value={selectedItemId}
              onChange={(e) => setSelectedItemId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            >
              <option value="">Choose an item to forecast...</option>
              {items.map(item => (
                <option key={item.id} value={item.id}>
                  {item.itemCode} - {item.itemName}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Forecast Periods
            </label>
            <input
              type="number"
              value={periods}
              onChange={(e) => setPeriods(parseInt(e.target.value) || 6)}
              min="1"
              max="24"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">1-24 periods ahead</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Seasonal Periods
            </label>
            <input
              type="number"
              value={seasonalPeriods}
              onChange={(e) => setSeasonalPeriods(parseInt(e.target.value) || 12)}
              min="2"
              max="12"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none"
            />
            <p className="text-xs text-gray-500 mt-1">Seasonality cycle</p>
          </div>
        </div>

        <div className="mt-4">
          <button
            onClick={generateForecast}
            disabled={!selectedItemId || generating}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white px-6 py-3 rounded-lg hover:bg-blue-700 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed font-medium"
          >
            {generating ? (
              <>
                <Loader2 className="animate-spin" size={20} />
                Generating Forecast...
              </>
            ) : (
              <>
                <TrendingUp size={20} />
                Generate Forecast
              </>
            )}
          </button>
        </div>
      </div>

      {/* Algorithm Info */}
      <div className="bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Activity className="text-blue-600 flex-shrink-0 mt-0.5" size={20} />
          <div>
            <h3 className="text-sm font-semibold text-blue-900">Holt-Winters Triple Exponential Smoothing</h3>
            <p className="text-sm text-blue-700 mt-1">
              Advanced time series forecasting that captures <strong>level</strong>, <strong>trend</strong>, and <strong>seasonality</strong> patterns in your demand data. 
              Automatically optimizes α (alpha), β (beta), and γ (gamma) parameters for maximum accuracy.
            </p>
          </div>
        </div>
      </div>

      {/* Forecast Results */}
      {forecastResult && (
        <div className="space-y-6">
          {/* Metrics Cards */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">Algorithm</p>
                  <p className="text-lg font-bold text-gray-900 mt-1">{forecastResult.algorithm}</p>
                </div>
                <BarChart3 className="text-blue-600" size={24} />
              </div>
            </div>

            <div className="bg-green-50 rounded-lg border border-green-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-green-700 font-medium">Alpha (α)</p>
                  <p className="text-lg font-bold text-green-700 mt-1">
                    {forecastResult.parameters.alpha?.toFixed(3) || 'N/A'}
                  </p>
                </div>
                <div className="text-xs text-green-600">Level</div>
              </div>
            </div>

            <div className="bg-blue-50 rounded-lg border border-blue-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-blue-700 font-medium">Beta (β)</p>
                  <p className="text-lg font-bold text-blue-700 mt-1">
                    {forecastResult.parameters.beta?.toFixed(3) || 'N/A'}
                  </p>
                </div>
                <div className="text-xs text-blue-600">Trend</div>
              </div>
            </div>

            <div className="bg-purple-50 rounded-lg border border-purple-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-purple-700 font-medium">Gamma (γ)</p>
                  <p className="text-lg font-bold text-purple-700 mt-1">
                    {forecastResult.parameters.gamma?.toFixed(3) || 'N/A'}
                  </p>
                </div>
                <div className="text-xs text-purple-600">Season</div>
              </div>
            </div>
          </div>

          {/* Accuracy Metrics */}
          {forecastResult.metrics && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">Forecast Accuracy Metrics</h3>
              <div className="grid grid-cols-3 gap-4">
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">MAE</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {forecastResult.metrics.mae?.toFixed(2) || 'N/A'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Mean Absolute Error</p>
                </div>
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">MSE</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {forecastResult.metrics.mse?.toFixed(2) || 'N/A'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Mean Squared Error</p>
                </div>
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-600 mb-1">RMSE</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {forecastResult.metrics.rmse?.toFixed(2) || 'N/A'}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Root Mean Squared Error</p>
                </div>
              </div>
            </div>
          )}

          {/* Chart */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold text-gray-900">Demand Forecast</h3>
                <p className="text-sm text-gray-600 mt-1">
                  {selectedItem?.itemCode} - {selectedItem?.itemName}
                </p>
              </div>
              <div className="text-sm text-gray-500">
                Generated: {new Date(forecastResult.generatedAt).toLocaleString()}
              </div>
            </div>

            <ResponsiveContainer width="100%" height={400}>
              <AreaChart data={getChartData()}>
                <defs>
                  <linearGradient id="colorForecast" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorActual" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis 
                  dataKey="period" 
                  tick={{ fontSize: 12 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: 'white', 
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px'
                  }}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="actual"
                  stroke="#10b981"
                  strokeWidth={2}
                  fill="url(#colorActual)"
                  name="Historical Demand"
                  dot={{ fill: '#10b981', r: 4 }}
                />
                <Area
                  type="monotone"
                  dataKey="forecast"
                  stroke="#3b82f6"
                  strokeWidth={2}
                  fill="url(#colorForecast)"
                  name="Forecast"
                  dot={{ fill: '#3b82f6', r: 4 }}
                  strokeDasharray="5 5"
                />
                <Line
                  type="monotone"
                  dataKey="lowerBound"
                  stroke="#94a3b8"
                  strokeWidth={1}
                  dot={false}
                  name="Lower Bound (80%)"
                  strokeDasharray="3 3"
                />
                <Line
                  type="monotone"
                  dataKey="upperBound"
                  stroke="#94a3b8"
                  strokeWidth={1}
                  dot={false}
                  name="Upper Bound (80%)"
                  strokeDasharray="3 3"
                />
              </AreaChart>
            </ResponsiveContainer>

            <div className="mt-4 flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-green-500 rounded"></div>
                <span className="text-gray-600">Historical Demand</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 bg-blue-500 rounded"></div>
                <span className="text-gray-600">Forecast</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-4 h-1 bg-gray-400 rounded"></div>
                <span className="text-gray-600">80% Confidence Interval</span>
              </div>
            </div>
          </div>

          {/* Forecast Table */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
            <div className="p-6 border-b border-gray-200">
              <h3 className="text-lg font-bold text-gray-900">Forecast Details</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="text-left px-6 py-3 text-sm font-semibold text-gray-900">Period</th>
                    <th className="text-right px-6 py-3 text-sm font-semibold text-gray-900">Forecast</th>
                    <th className="text-right px-6 py-3 text-sm font-semibold text-gray-900">Lower Bound</th>
                    <th className="text-right px-6 py-3 text-sm font-semibold text-gray-900">Upper Bound</th>
                    <th className="text-center px-6 py-3 text-sm font-semibold text-gray-900">Confidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {forecastResult.forecast.map((value, index) => (
                    <tr key={index} className="hover:bg-gray-50">
                      <td className="px-6 py-3 text-sm font-medium text-gray-900">
                        Period {forecastResult.historicalDemand.length + index + 1}
                      </td>
                      <td className="px-6 py-3 text-sm text-right font-bold text-blue-600">
                        {value.toFixed(2)}
                      </td>
                      <td className="px-6 py-3 text-sm text-right text-gray-600">
                        {forecastResult.lowerBound[index].toFixed(2)}
                      </td>
                      <td className="px-6 py-3 text-sm text-right text-gray-600">
                        {forecastResult.upperBound[index].toFixed(2)}
                      </td>
                      <td className="px-6 py-3 text-center">
                        <span className="inline-flex px-2 py-1 text-xs font-medium rounded-full bg-green-100 text-green-700">
                          80%
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Empty State */}
      {!forecastResult && !generating && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-12 text-center">
          <TrendingUp className="mx-auto text-gray-400 mb-4" size={64} />
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No Forecast Generated Yet</h3>
          <p className="text-gray-600">
            Select an item and click "Generate Forecast" to see AI-powered demand predictions
          </p>
        </div>
      )}
    </div>
  );
}
