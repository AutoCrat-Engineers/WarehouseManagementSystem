import { useState, useEffect } from 'react';
import { getSupabaseClient } from '../utils/supabase/client';

const supabase = getSupabaseClient();

export interface DashboardData {
  summary: {
    totalItems: number;
    lowStockCount: number;
    healthyStockCount: number;
    totalStockValue: number;
  };
  alerts: Array<{
    message: string;
    severity: 'critical' | 'warning';
    itemCode: string;
    timestamp: string;
  }>;
  recentActivity: {
    blanketOrders: any[];
  };
}

export function useDashboard(accessToken: string | null) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchDashboard = async () => {
    if (!accessToken) {
      setError('Unauthorized. Please log in again.');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // PERF: Fetch stock data and blanket orders IN PARALLEL
      const [stockResult, ordersResult] = await Promise.all([
        supabase
          .from('vw_item_stock_dashboard')
          .select('item_code, item_name, stock_status, net_available_for_customer, total_on_hand'),
        supabase
          .from('blanket_orders')
          .select('id, order_number, customer_name, status, total_value, created_at')
          .order('created_at', { ascending: false })
          .limit(5),
      ]);

      if (stockResult.error) throw stockResult.error;
      if (ordersResult.error) throw ordersResult.error;

      const stockItems = stockResult.data;
      const blanketOrders = ordersResult.data;

      // Calculate summary from the DB view's stock_status
      const totalItems = stockItems?.length || 0;
      let lowStockCount = 0;
      let totalStockValue = 0;

      stockItems?.forEach((item: any) => {
        const status = (item.stock_status || '').toUpperCase();
        // Count CRITICAL and LOW as "low stock" — matches Inventory module
        if (status === 'CRITICAL' || status === 'LOW') {
          lowStockCount++;
        }
        totalStockValue += item.total_on_hand || 0;
      });

      const healthyStockCount = totalItems - lowStockCount;

      // Generate alerts from the view data
      const alerts: any[] = [];
      stockItems?.forEach((item: any) => {
        const status = (item.stock_status || '').toUpperCase();
        const netAvailable = item.net_available_for_customer || 0;

        if (status === 'CRITICAL') {
          alerts.push({
            message: `${item.item_name || item.item_code} is critically low (${netAvailable} available)`,
            severity: 'critical' as const,
            itemCode: item.item_code,
            timestamp: new Date().toISOString(),
          });
        } else if (status === 'LOW') {
          alerts.push({
            message: `${item.item_name || item.item_code} is below reorder point (${netAvailable} available)`,
            severity: 'warning' as const,
            itemCode: item.item_code,
            timestamp: new Date().toISOString(),
          });
        }
      });

      setData({
        summary: {
          totalItems,
          lowStockCount,
          healthyStockCount,
          totalStockValue,
        },
        alerts: alerts.sort((a, b) =>
          a.severity === 'critical' ? -1 : b.severity === 'critical' ? 1 : 0
        ),
        recentActivity: {
          blanketOrders: blanketOrders || [],
        },
      });
    } catch (err: any) {
      console.error('Dashboard fetch error:', err);

      // Handle specific error cases
      if (err.code === 'PGRST301') {
        setError('Unauthorized. Please log in again.');
      } else if (err.message?.includes('JWT')) {
        setError('Session expired. Please log in again.');
      } else if (err.code === '42P01') {
        setError('Database tables not found. Please set up the database schema.');
      } else {
        setError(err.message || 'Failed to load dashboard data');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, [accessToken]);

  return {
    data,
    loading,
    error,
    refetch: fetchDashboard,
  };
}