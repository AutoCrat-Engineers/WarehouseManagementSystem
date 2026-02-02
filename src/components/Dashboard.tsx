import React, { useState, useEffect } from 'react';
import { projectId, publicAnonKey } from '../utils/supabase/info';
import { 
  Package, 
  AlertTriangle, 
  CheckCircle, 
  TrendingUp,
  AlertCircle,
  Loader2
} from 'lucide-react';
import { SampleDataInfo } from './SampleDataInfo';

interface DashboardProps {
  accessToken: string;
}

interface DashboardData {
  activeItems: number;
  totalInventoryValue: number;
  statusCounts: {
    healthy: number;
    warning: number;
    critical: number;
    overstock: number;
  };
  lastUpdated: string;
}

export function Dashboard({ accessToken }: DashboardProps) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [seeding, setSeeding] = useState(false);

  useEffect(() => {
    fetchDashboard();
  }, []);

  const fetchDashboard = async () => {
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/dashboard`,
        {
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      const result = await response.json();
      setData(result);
    } catch (err: any) {
      console.error('Dashboard fetch error:', err);
      // Set empty data on error instead of showing error message
      setData({
        activeItems: 0,
        totalInventoryValue: 0,
        statusCounts: {
          healthy: 0,
          warning: 0,
          critical: 0,
          overstock: 0
        },
        lastUpdated: new Date().toISOString()
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSeedDatabase = async () => {
    if (!confirm('This will load sample manufacturing data into the system. Continue?')) {
      return;
    }

    setSeeding(true);
    try {
      const response = await fetch(
        `https://${projectId}.supabase.co/functions/v1/make-server-9c637d11/seed-database`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to seed database');
      }

      const result = await response.json();
      alert(`Success! Loaded ${result.stats.items} items, ${result.stats.inventory} inventory records, ${result.stats.blanketOrders} blanket orders, and ${result.stats.releases} releases.`);
      
      // Refresh dashboard
      await fetchDashboard();
      
      // Reload page to refresh all data
      window.location.reload();
    } catch (err: any) {
      console.error('Seed database error:', err);
      alert('Failed to load sample data: ' + err.message);
    } finally {
      setSeeding(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="animate-spin text-blue-600" size={32} />
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
        Error loading dashboard: {error}
      </div>
    );
  }

  const statusCards = [
    {
      title: 'Healthy',
      count: data?.statusCounts?.healthy || 0,
      icon: CheckCircle,
      color: 'green',
      bgColor: 'bg-green-50',
      textColor: 'text-green-700',
      iconColor: 'text-green-600',
      borderColor: 'border-green-200'
    },
    {
      title: 'Warning',
      count: data?.statusCounts?.warning || 0,
      icon: AlertTriangle,
      color: 'yellow',
      bgColor: 'bg-yellow-50',
      textColor: 'text-yellow-700',
      iconColor: 'text-yellow-600',
      borderColor: 'border-yellow-200'
    },
    {
      title: 'Critical',
      count: data?.statusCounts?.critical || 0,
      icon: AlertCircle,
      color: 'red',
      bgColor: 'bg-red-50',
      textColor: 'text-red-700',
      iconColor: 'text-red-600',
      borderColor: 'border-red-200'
    },
    {
      title: 'Overstock',
      count: data?.statusCounts?.overstock || 0,
      icon: TrendingUp,
      color: 'purple',
      bgColor: 'bg-purple-50',
      textColor: 'text-purple-700',
      iconColor: 'text-purple-600',
      borderColor: 'border-purple-200'
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-1">Real-time inventory planning overview</p>
      </div>

      {/* Welcome Banner - Show when no data */}
      {data?.activeItems === 0 && (
        <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-xl shadow-lg p-8 text-white">
          <div className="max-w-3xl">
            <h2 className="text-2xl font-bold mb-3">👋 Welcome to Your Enterprise Inventory System!</h2>
            <p className="text-blue-50 mb-4">
              Get started by loading sample manufacturing data to see the full power of this ERP-grade 
              planning and forecasting system. The sample data includes:
            </p>
            <ul className="text-blue-50 space-y-1 mb-6 ml-4">
              <li>• 6 finished goods items with min/max stock levels</li>
              <li>• Current inventory with various status levels (healthy, warning, critical, overstock)</li>
              <li>• 5 blanket orders from different customers</li>
              <li>• Historical release data for accurate demand forecasting</li>
            </ul>
            <button 
              onClick={handleSeedDatabase}
              disabled={seeding}
              className="bg-white text-blue-600 px-6 py-3 rounded-lg font-semibold hover:bg-blue-50 transition-all shadow-md disabled:opacity-50"
            >
              {seeding ? 'Loading Sample Data...' : '🚀 Load Sample Data Now'}
            </button>
          </div>
        </div>
      )}

      {/* Key Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Active Items</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {data?.activeItems || 0}
              </p>
            </div>
            <div className="bg-blue-50 p-3 rounded-lg">
              <Package className="text-blue-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Total Stock</p>
              <p className="text-3xl font-bold text-gray-900 mt-2">
                {(data?.totalInventoryValue || 0).toLocaleString()}
              </p>
            </div>
            <div className="bg-green-50 p-3 rounded-lg">
              <TrendingUp className="text-green-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Critical Items</p>
              <p className="text-3xl font-bold text-red-600 mt-2">
                {data?.statusCounts?.critical || 0}
              </p>
            </div>
            <div className="bg-red-50 p-3 rounded-lg">
              <AlertCircle className="text-red-600" size={24} />
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-600">Warnings</p>
              <p className="text-3xl font-bold text-yellow-600 mt-2">
                {data?.statusCounts?.warning || 0}
              </p>
            </div>
            <div className="bg-yellow-50 p-3 rounded-lg">
              <AlertTriangle className="text-yellow-600" size={24} />
            </div>
          </div>
        </div>
      </div>

      {/* Status Overview */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Inventory Health Status</h2>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {statusCards.map((card) => {
            const Icon = card.icon;
            return (
              <div
                key={card.title}
                className={`${card.bgColor} border ${card.borderColor} rounded-lg p-4`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={card.iconColor} size={24} />
                  <div>
                    <p className={`text-sm font-medium ${card.textColor}`}>
                      {card.title}
                    </p>
                    <p className={`text-2xl font-bold ${card.textColor}`}>
                      {card.count}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Quick Actions */}
      <div className="bg-gradient-to-r from-blue-600 to-indigo-600 rounded-xl shadow-lg p-6 text-white">
        <h2 className="text-xl font-semibold mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <button 
            onClick={handleSeedDatabase}
            disabled={seeding}
            className="bg-white/20 hover:bg-white/30 backdrop-blur rounded-lg p-4 text-left transition-all disabled:opacity-50"
          >
            <p className="font-semibold">
              {seeding ? 'Loading...' : '🎯 Load Sample Data'}
            </p>
            <p className="text-sm text-blue-100 mt-1">
              {seeding ? 'Please wait...' : 'Populate with manufacturing data'}
            </p>
          </button>
          <button className="bg-white/20 hover:bg-white/30 backdrop-blur rounded-lg p-4 text-left transition-all">
            <p className="font-semibold">Run Planning</p>
            <p className="text-sm text-blue-100 mt-1">Generate production recommendations</p>
          </button>
          <button className="bg-white/20 hover:bg-white/30 backdrop-blur rounded-lg p-4 text-left transition-all">
            <p className="font-semibold">Generate Forecast</p>
            <p className="text-sm text-blue-100 mt-1">Predict future demand</p>
          </button>
          <button className="bg-white/20 hover:bg-white/30 backdrop-blur rounded-lg p-4 text-left transition-all">
            <p className="font-semibold">View Alerts</p>
            <p className="text-sm text-blue-100 mt-1">Check critical notifications</p>
          </button>
        </div>
      </div>

      {/* Sample Data Info - Show when data is loaded */}
      {data && data.activeItems > 0 && (
        <SampleDataInfo />
      )}

      {/* Last Updated */}
      {data?.lastUpdated && (
        <div className="text-center text-sm text-gray-500">
          Last updated: {new Date(data.lastUpdated).toLocaleString()}
        </div>
      )}
    </div>
  );
}