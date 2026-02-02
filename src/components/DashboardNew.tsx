import React, { useState } from 'react';
import { 
  Package, 
  AlertTriangle, 
  CheckCircle, 
  TrendingUp,
  AlertCircle,
  Loader2,
  Warehouse,
  FileText,
  Calendar,
  BarChart3
} from 'lucide-react';
import { useDashboard } from '../hooks/useDashboard';
import { seedService } from '../utils/api/services';
import { SampleDataInfo } from './SampleDataInfo';
import { AuthDebug } from './AuthDebug';
import { APIError } from '../utils/api/client';

interface DashboardProps {
  accessToken: string;
}

export function DashboardNew({ accessToken }: DashboardProps) {
  const { data, loading, error, refetch } = useDashboard(accessToken);
  const [seeding, setSeeding] = useState(false);
  const [seedError, setSeedError] = useState<string | null>(null);

  const handleSeedDatabase = async () => {
    if (!confirm('This will load sample manufacturing data into the system. Continue?')) {
      return;
    }

    setSeeding(true);
    setSeedError(null);

    try {
      const result = await seedService.seedDatabase(accessToken);
      
      alert(
        `Success! Loaded:\n` +
        `• ${result.stats.items} items\n` +
        `• ${result.stats.inventory} inventory records\n` +
        `• ${result.stats.blanketOrders} blanket orders\n` +
        `• ${result.stats.releases} releases`
      );
      
      await refetch();
      window.location.reload();
    } catch (err) {
      console.error('Seed database error:', err);
      setSeedError(err instanceof APIError ? err.message : 'Failed to seed database');
    } finally {
      setSeeding(false);
    }
  };

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '400px',
      }}>
        <div style={{ textAlign: 'center' }}>
          <Loader2 
            size={48} 
            style={{ 
              color: 'var(--enterprise-primary)',
              animation: 'spin 1s linear infinite',
              margin: '0 auto 16px',
            }} 
          />
          <p style={{ 
            color: 'var(--enterprise-gray-600)',
            fontSize: 'var(--font-size-base)',
          }}>
            Loading dashboard...
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{
        backgroundColor: 'var(--enterprise-error-bg)',
        border: '1px solid var(--enterprise-error)',
        borderRadius: 'var(--border-radius-lg)',
        padding: '24px',
        marginBottom: '24px',
      }}>
        <div style={{ display: 'flex', alignItems: 'start', gap: '16px' }}>
          <AlertCircle size={24} style={{ color: 'var(--enterprise-error)', flexShrink: 0 }} />
          <div>
            <h3 style={{ 
              color: 'var(--enterprise-error)',
              fontSize: 'var(--font-size-lg)',
              fontWeight: 'var(--font-weight-semibold)',
              marginBottom: '8px',
            }}>
              Failed to Load Dashboard
            </h3>
            <p style={{ 
              color: 'var(--enterprise-error)',
              fontSize: 'var(--font-size-base)',
            }}>
              {error}
            </p>
          </div>
        </div>
      </div>
    );
  }

  const kpis = [
    {
      label: 'Total Items',
      value: data?.summary.totalItems || 0,
      icon: Package,
      color: 'var(--enterprise-primary)',
      bgColor: 'rgba(30, 58, 138, 0.08)',
    },
    {
      label: 'Low Stock Items',
      value: data?.summary.lowStockCount || 0,
      icon: AlertTriangle,
      color: 'var(--enterprise-warning)',
      bgColor: 'var(--enterprise-warning-bg)',
    },
    {
      label: 'Healthy Items',
      value: data?.summary.healthyStockCount || 0,
      icon: CheckCircle,
      color: 'var(--enterprise-success)',
      bgColor: 'var(--enterprise-success-bg)',
    },
    {
      label: 'Total Stock Value',
      value: data?.summary.totalStockValue || 0,
      icon: TrendingUp,
      color: 'var(--enterprise-secondary)',
      bgColor: 'rgba(15, 118, 110, 0.08)',
      prefix: '$',
      format: true,
    },
  ];

  const modules = [
    {
      title: 'Inventory Management',
      description: 'Real-time stock tracking and monitoring',
      icon: Warehouse,
      color: 'var(--enterprise-primary)',
      stats: [
        { label: 'Available', value: data?.summary.totalItems || 0 },
        { label: 'Low Stock', value: data?.summary.lowStockCount || 0 },
      ]
    },
    {
      title: 'Blanket Orders',
      description: 'Multi-line customer order management',
      icon: FileText,
      color: 'var(--enterprise-secondary)',
      stats: [
        { label: 'Active Orders', value: data?.recentActivity?.blanketOrders?.length || 0 },
        { label: 'Total Lines', value: 0 },
      ]
    },
    {
      title: 'Release Schedule',
      description: 'Delivery planning with auto-deduction',
      icon: Calendar,
      color: 'var(--enterprise-info)',
      stats: [
        { label: 'Pending', value: 0 },
        { label: 'Delivered', value: 0 },
      ]
    },
    {
      title: 'Demand Forecasting',
      description: 'Holt-Winters predictive analytics',
      icon: TrendingUp,
      color: 'var(--enterprise-accent)',
      stats: [
        { label: 'Forecasts', value: 0 },
        { label: 'Accuracy', value: '0%' },
      ]
    },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
      {/* Welcome Section */}
      <div>
        <h2 style={{
          fontSize: 'var(--font-size-2xl)',
          fontWeight: 'var(--font-weight-semibold)',
          color: 'var(--enterprise-gray-900)',
          marginBottom: '8px',
        }}>
          Welcome to Enterprise ERP
        </h2>
        <p style={{
          fontSize: 'var(--font-size-base)',
          color: 'var(--enterprise-gray-600)',
        }}>
          Real-time inventory planning and forecasting system
        </p>
      </div>

      {/* KPI Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '24px',
      }}>
        {kpis.map((kpi, index) => {
          const Icon = kpi.icon;
          return (
            <div
              key={index}
              style={{
                backgroundColor: 'var(--card-background)',
                border: '1px solid var(--border-color)',
                borderRadius: 'var(--border-radius-lg)',
                padding: '24px',
                boxShadow: 'var(--shadow-sm)',
                transition: 'all var(--transition-fast)',
                cursor: 'default',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                e.currentTarget.style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                e.currentTarget.style.transform = 'translateY(0)';
              }}
            >
              <div style={{ display: 'flex', alignItems: 'start', justifyContent: 'space-between' }}>
                <div>
                  <p style={{
                    fontSize: 'var(--font-size-sm)',
                    fontWeight: 'var(--font-weight-medium)',
                    color: 'var(--enterprise-gray-600)',
                    marginBottom: '8px',
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                  }}>
                    {kpi.label}
                  </p>
                  <p style={{
                    fontSize: '2rem',
                    fontWeight: 'var(--font-weight-bold)',
                    color: kpi.color,
                    lineHeight: 1,
                  }}>
                    {kpi.prefix || ''}{kpi.format ? kpi.value.toLocaleString() : kpi.value}
                  </p>
                </div>
                <div style={{
                  width: '56px',
                  height: '56px',
                  borderRadius: 'var(--border-radius-lg)',
                  backgroundColor: kpi.bgColor,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Icon size={28} style={{ color: kpi.color }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Module Grid */}
      <div>
        <h3 style={{
          fontSize: 'var(--font-size-xl)',
          fontWeight: 'var(--font-weight-semibold)',
          color: 'var(--enterprise-gray-900)',
          marginBottom: '16px',
        }}>
          Quick Access
        </h3>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '24px',
        }}>
          {modules.map((module, index) => {
            const Icon = module.icon;
            return (
              <div
                key={index}
                style={{
                  backgroundColor: 'var(--card-background)',
                  border: '1px solid var(--border-color)',
                  borderRadius: 'var(--border-radius-lg)',
                  padding: '24px',
                  boxShadow: 'var(--shadow-sm)',
                  transition: 'all var(--transition-fast)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.boxShadow = 'var(--shadow-md)';
                  e.currentTarget.style.borderColor = module.color;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
                  e.currentTarget.style.borderColor = 'var(--border-color)';
                }}
              >
                <div style={{ display: 'flex', alignItems: 'start', gap: '16px', marginBottom: '16px' }}>
                  <div style={{
                    width: '48px',
                    height: '48px',
                    borderRadius: 'var(--border-radius-md)',
                    backgroundColor: `${module.color}15`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}>
                    <Icon size={24} style={{ color: module.color }} />
                  </div>
                  <div style={{ flex: 1 }}>
                    <h4 style={{
                      fontSize: 'var(--font-size-lg)',
                      fontWeight: 'var(--font-weight-semibold)',
                      color: 'var(--enterprise-gray-900)',
                      marginBottom: '4px',
                    }}>
                      {module.title}
                    </h4>
                    <p style={{
                      fontSize: 'var(--font-size-sm)',
                      color: 'var(--enterprise-gray-600)',
                    }}>
                      {module.description}
                    </p>
                  </div>
                </div>
                <div style={{
                  display: 'flex',
                  gap: '16px',
                  paddingTop: '16px',
                  borderTop: '1px solid var(--border-color)',
                }}>
                  {module.stats.map((stat, idx) => (
                    <div key={idx} style={{ flex: 1 }}>
                      <p style={{
                        fontSize: 'var(--font-size-xs)',
                        color: 'var(--enterprise-gray-500)',
                        marginBottom: '4px',
                      }}>
                        {stat.label}
                      </p>
                      <p style={{
                        fontSize: 'var(--font-size-lg)',
                        fontWeight: 'var(--font-weight-semibold)',
                        color: 'var(--enterprise-gray-900)',
                      }}>
                        {stat.value}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Alerts */}
      {data?.alerts && data.alerts.length > 0 && (
        <div>
          <h3 style={{
            fontSize: 'var(--font-size-xl)',
            fontWeight: 'var(--font-weight-semibold)',
            color: 'var(--enterprise-gray-900)',
            marginBottom: '16px',
          }}>
            System Alerts
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {data.alerts.slice(0, 5).map((alert, index) => (
              <div
                key={index}
                style={{
                  backgroundColor: alert.severity === 'critical' 
                    ? 'var(--enterprise-error-bg)' 
                    : 'var(--enterprise-warning-bg)',
                  border: `1px solid ${alert.severity === 'critical' 
                    ? 'var(--enterprise-error)' 
                    : 'var(--enterprise-warning)'}`,
                  borderRadius: 'var(--border-radius-md)',
                  padding: '16px',
                  display: 'flex',
                  alignItems: 'start',
                  gap: '12px',
                }}
              >
                <AlertTriangle 
                  size={20} 
                  style={{ 
                    color: alert.severity === 'critical' 
                      ? 'var(--enterprise-error)' 
                      : 'var(--enterprise-warning)',
                    flexShrink: 0,
                  }} 
                />
                <div style={{ flex: 1 }}>
                  <p style={{
                    fontSize: 'var(--font-size-base)',
                    fontWeight: 'var(--font-weight-medium)',
                    color: alert.severity === 'critical' 
                      ? 'var(--enterprise-error)' 
                      : 'var(--enterprise-warning)',
                    marginBottom: '4px',
                  }}>
                    {alert.message}
                  </p>
                  <p style={{
                    fontSize: 'var(--font-size-sm)',
                    color: 'var(--enterprise-gray-600)',
                  }}>
                    {alert.itemCode} - {new Date(alert.timestamp).toLocaleString()}
                  </p>
                </div>
                <span style={{
                  padding: '4px 12px',
                  borderRadius: '12px',
                  fontSize: 'var(--font-size-xs)',
                  fontWeight: 'var(--font-weight-semibold)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px',
                  backgroundColor: 'white',
                  color: alert.severity === 'critical' 
                    ? 'var(--enterprise-error)' 
                    : 'var(--enterprise-warning)',
                }}>
                  {alert.severity}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sample Data Section */}
      <SampleDataInfo 
        onSeedDatabase={handleSeedDatabase}
        seeding={seeding}
        error={seedError}
      />
    </div>
  );
}
