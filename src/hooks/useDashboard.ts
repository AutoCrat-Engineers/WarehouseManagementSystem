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

      // Fetch items
      const { data: items, error: itemsError } = await supabase
        .from('items')
        .select('*');

      if (itemsError) throw itemsError;

      // Fetch inventory
      const { data: inventory, error: inventoryError } = await supabase
        .from('inventory')
        .select('*');

      if (inventoryError) throw inventoryError;

      // Fetch blanket orders
      const { data: blanketOrders, error: ordersError } = await supabase
        .from('blanket_orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);

      if (ordersError) throw ordersError;

      // Calculate summary
      const totalItems = items?.length || 0;
      let lowStockCount = 0;
      let totalStockValue = 0;

      items?.forEach((item: any) => {
        const inv = inventory?.find((i: any) => i.item_code === item.item_code);
        if (inv) {
          const currentStock = inv.current_stock || 0;
          const minStock = item.min_stock_level || 0;
          const reorderPoint = item.reorder_point || 0;

          if (currentStock <= Math.max(minStock, reorderPoint)) {
            lowStockCount++;
          }

          totalStockValue += currentStock * (item.unit_price || 0);
        }
      });

      const healthyStockCount = totalItems - lowStockCount;

      // Generate alerts
      const alerts: any[] = [];
      items?.forEach((item: any) => {
        const inv = inventory?.find((i: any) => i.item_code === item.item_code);
        if (inv) {
          const currentStock = inv.current_stock || 0;
          const minStock = item.min_stock_level || 0;
          const reorderPoint = item.reorder_point || 0;

          if (currentStock <= minStock) {
            alerts.push({
              message: `${item.item_name} is critically low (${currentStock} ${item.uom})`,
              severity: 'critical' as const,
              itemCode: item.item_code,
              timestamp: new Date().toISOString(),
            });
          } else if (currentStock <= reorderPoint) {
            alerts.push({
              message: `${item.item_name} below reorder point (${currentStock} ${item.uom})`,
              severity: 'warning' as const,
              itemCode: item.item_code,
              timestamp: new Date().toISOString(),
            });
          }
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