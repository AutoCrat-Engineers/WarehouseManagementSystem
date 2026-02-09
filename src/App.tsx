import React, { useState, useEffect } from 'react';
import { getSupabaseClient } from './utils/supabase/client';
import { signInWithEmail, signOut } from './utils/supabase/auth';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './components/LoginPage';
import { DashboardNew } from './components/DashboardNew';
import { ItemMasterSupabase } from './components/ItemMasterSupabase';
import { InventoryGrid } from './components/InventoryGrid';
import { BlanketOrders } from './components/BlanketOrders';
import { BlanketReleases } from './components/BlanketReleases';
import { ForecastingModule } from './components/ForecastingModule';
import { PlanningModule } from './components/PlanningModule';
import { StockMovement } from './components/StockMovement';
import { LoadingPage } from './components/LoadingPage';
import { UserManagement } from './auth/users/UserManagement';
import {
  LayoutDashboard,
  Package,
  FileText,
  TrendingUp,
  Calendar,
  BarChart3,
  LogOut,
  Menu,
  ChevronLeft,
  ArrowRightLeft,
  ChevronRight,
  AlertCircle,
  Users,
  Shield,
  Boxes
} from 'lucide-react';

const supabase = getSupabaseClient();
const logoImage = '/logo.png';

// User role type for RBAC
type UserRole = 'L1' | 'L2' | 'L3' | null;

type View = 'dashboard' | 'items' | 'inventory' | 'orders' | 'releases' | 'forecast' | 'planning' | 'stock-movements' | 'users';

interface MenuItem {
  id: View;
  label: string;
  icon: React.ElementType;
  description: string;
}

const menuItems: MenuItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'Overview & KPIs' },
  { id: 'items', label: 'Item Master', icon: Package, description: 'FG Catalog' },
  { id: 'inventory', label: 'Inventory', icon: Boxes, description: 'Multi-Warehouse Stock' },
  { id: 'stock-movements', label: 'Stock Movements', icon: ArrowRightLeft, description: 'Audit Trail' },
  { id: 'orders', label: 'Blanket Orders', icon: FileText, description: 'Customer Orders' },
  { id: 'releases', label: 'Blanket Releases', icon: Calendar, description: 'Delivery Schedule' },
  { id: 'forecast', label: 'Forecasting', icon: TrendingUp, description: 'Demand Prediction' },
  { id: 'planning', label: 'MRP Planning', icon: BarChart3, description: 'Replenishment' },
];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<UserRole>(null);
  const [currentView, setCurrentView] = useState<View>('dashboard');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // ============================================================================
  // INITIALIZATION & SESSION MANAGEMENT
  // ============================================================================

  useEffect(() => {
    initializeAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        console.log('Auth state changed:', event);

        if (session?.access_token && session.user) {
          setAccessToken(session.access_token);
          setUser(session.user);
          setIsAuthenticated(true);
          setError(null);
          // Fetch user role on auth state change
          fetchUserRole(session.user.id);
        } else {
          setAccessToken(null);
          setUser(null);
          setUserRole(null);
          setIsAuthenticated(false);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  const initializeAuth = async () => {
    try {
      setIsLoading(true);
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();

      if (sessionError) {
        console.error('Session check error:', sessionError);
        setIsLoading(false);
        return;
      }

      if (session?.access_token && session.user) {
        console.log('✓ Session found, setting access token');
        setAccessToken(session.access_token);
        setUser(session.user);
        setIsAuthenticated(true);
        setError(null);
        // Fetch user role on init
        await fetchUserRole(session.user.id);
      } else {
        console.log('No active session');
        setIsAuthenticated(false);
      }
    } catch (err) {
      console.error('Auth initialization error:', err);
      setError(err instanceof Error ? err.message : 'Failed to initialize auth');
      setIsAuthenticated(false);
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================================
  // AUTH HANDLERS
  // ============================================================================

  const handleLogin = async (email: string, password: string) => {
    try {
      setError(null);
      setIsLoading(true);

      const result = await signInWithEmail(email, password);

      if (result.error) {
        setError(result.error);
        return false;
      }

      if (result.session?.access_token) {
        console.log('✓ Login successful');
        setAccessToken(result.session.access_token);
        setUser(result.session.user);
        setIsAuthenticated(true);
        return true;
      }

      setError('Login failed: No session received');
      return false;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Login failed';
      console.error('Login error:', err);
      setError(errorMsg);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch user role from profiles table
  const fetchUserRole = async (userId: string) => {
    console.log('🔍 Fetching role for user:', userId);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('role, is_active, email, full_name')
        .eq('id', userId)
        .single();

      console.log('📋 Profile query result:', { data, error });

      if (error) {
        console.error('❌ Could not fetch user role:', error);
        console.error('Error code:', error.code, 'Message:', error.message);
        // Default to L1 if role fetch fails
        setUserRole('L1');
        return;
      }

      if (data && data.is_active) {
        console.log('✅ User role set to:', data.role);
        setUserRole(data.role as UserRole);
      } else if (data && !data.is_active) {
        // User is inactive
        console.warn('⚠️ User account is inactive');
        setUserRole(null);
        setError('Account is inactive. Please contact your administrator.');
        await signOut();
        setIsAuthenticated(false);
      } else {
        console.warn('⚠️ No profile data found, defaulting to L1');
        setUserRole('L1');
      }
    } catch (err) {
      console.error('💥 Error fetching user role:', err);
      setUserRole('L1'); // Default fallback
    }
  };

  const handleLogout = async () => {
    try {
      setIsLoading(true);
      await signOut();
      setAccessToken(null);
      setUser(null);
      setUserRole(null);
      setIsAuthenticated(false);
      setCurrentView('dashboard');
      setError(null);
    } catch (err) {
      console.error('Logout error:', err);
      setError(err instanceof Error ? err.message : 'Logout failed');
    } finally {
      setIsLoading(false);
    }
  };

  // ============================================================================
  // RENDER: LOADING STATE
  // ============================================================================

  if (isLoading && !isAuthenticated) {
    return <LoadingPage message="Initializing System..." />;
  }

  // ============================================================================
  // RENDER: LOGIN PAGE
  // ============================================================================

  if (!isAuthenticated) {
    return (
      <LoginPage
        onLogin={handleLogin}
        isLoading={isLoading}
        error={error}
      />
    );
  }

  // ============================================================================
  // RENDER: MAIN APPLICATION
  // ============================================================================

  const renderContent = () => {
    // Check if token exists before rendering components
    if (!accessToken) {
      return (
        <div style={{
          padding: '32px',
          backgroundColor: '#fee2e2',
          borderRadius: '12px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          color: '#dc2626',
        }}>
          <AlertCircle size={24} />
          <div>
            <strong>Authentication Error:</strong> No access token available. Please login again.
          </div>
        </div>
      );
    }

    switch (currentView) {
      case 'dashboard':
        return <DashboardNew accessToken={accessToken} />;
      case 'items':
        return <ItemMasterSupabase />;
      case 'inventory':
        return <InventoryGrid />;
      case 'stock-movements':
        return <StockMovement accessToken={accessToken} />;
      case 'orders':
        return <BlanketOrders accessToken={accessToken} />;
      case 'releases':
        return <BlanketReleases accessToken={accessToken} />;
      case 'forecast':
        return <ForecastingModule accessToken={accessToken} />;
      case 'planning':
        return <PlanningModule accessToken={accessToken} />;
      case 'users':
        // Only L3 can access user management
        if (userRole !== 'L3') {
          return (
            <div style={{
              padding: '32px',
              backgroundColor: '#fef3c7',
              borderRadius: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              color: '#92400e',
            }}>
              <Shield size={24} />
              <div>
                <strong>Access Denied:</strong> Only L3 Managers can access User Management.
              </div>
            </div>
          );
        }
        return <UserManagement currentUserId={user?.id || ''} />;
      default:
        return <DashboardNew accessToken={accessToken} />;
    }
  };

  // Build menu items dynamically based on user role
  const getMenuItems = () => {
    const baseItems = menuItems;
    console.log('🎯 getMenuItems called, userRole:', userRole);
    // Add User Management for L3 users
    if (userRole === 'L3') {
      console.log('✅ Adding User Management menu for L3');
      return [
        ...baseItems,
        { id: 'users' as View, label: 'User Management', icon: Users, description: 'Manage Users & Roles' }
      ];
    }
    return baseItems;
  };

  // Log current role for debugging
  console.log('🔄 Current userRole state:', userRole);

  const currentMenuItem = getMenuItems().find(item => item.id === currentView);

  return (
    <ErrorBoundary>
      <div style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'var(--background-secondary)',
      }}>
        {/* SIDEBAR */}
        <aside style={{
          width: isSidebarOpen ? '280px' : '0',
          backgroundColor: 'var(--card-background)',
          borderRight: '1px solid var(--border-color)',
          display: 'flex',
          flexDirection: 'column',
          transition: 'width 300ms ease',
          overflow: 'hidden',
          boxShadow: 'var(--shadow-lg)',
        }}>
          {/* Logo Section */}
          <div style={{
            padding: '24px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            backgroundColor: '#1e3a8a',
          }}>
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '16px',
            }}>
              <div style={{
                backgroundColor: 'white',
                padding: '16px 20px',
                borderRadius: '12px',
                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              }}>
                <img
                  src={logoImage}
                  alt="Autocrat Engineers"
                  style={{
                    width: '100%',
                    height: 'auto',
                    display: 'block',
                  }}
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              </div>
              <p style={{
                color: 'rgba(255, 255, 255, 0.95)',
                fontSize: '13px',
                margin: '0',
                fontWeight: '500',
                letterSpacing: '0.3px',
                textAlign: 'center',
              }}>
                Warehouse Management System
              </p>
            </div>
          </div>

          {/* Navigation */}
          <nav style={{
            flex: 1,
            overflowY: 'auto',
            padding: '16px 0',
          }}>
            {getMenuItems().map((item) => {
              const Icon = item.icon;
              const isActive = currentView === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => setCurrentView(item.id)}
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px',
                    padding: '12px 24px',
                    border: 'none',
                    backgroundColor: isActive ? 'rgba(30, 58, 138, 0.08)' : 'transparent',
                    borderLeft: isActive ? '3px solid var(--enterprise-primary)' : '3px solid transparent',
                    color: isActive ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-600)',
                    textAlign: 'left',
                    cursor: 'pointer',
                    transition: 'all 200ms ease',
                    fontWeight: isActive ? '600' : '500',
                    fontSize: '14px',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'var(--enterprise-gray-50)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) {
                      e.currentTarget.style.backgroundColor = 'transparent';
                    }
                  }}
                >
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 2} />
                  <div style={{ flex: 1 }}>
                    <div>{item.label}</div>
                    <div style={{
                      fontSize: '11px',
                      color: 'var(--enterprise-gray-500)',
                      fontWeight: '400',
                    }}>
                      {item.description}
                    </div>
                  </div>
                  {isActive && <ChevronRight size={16} />}
                </button>
              );
            })}
          </nav>

          {/* User Section */}
          <div style={{
            padding: '16px 24px',
            borderTop: '1px solid var(--border-color)',
            backgroundColor: 'var(--enterprise-gray-50)',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
              marginBottom: '12px',
            }}>
              <div style={{
                width: '36px',
                height: '36px',
                borderRadius: '50%',
                backgroundColor: 'var(--enterprise-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                fontWeight: '600',
                fontSize: '13px',
              }}>
                {user?.email?.charAt(0).toUpperCase() || 'U'}
              </div>
              <div style={{ flex: 1, overflow: 'hidden' }}>
                <div style={{
                  fontSize: '13px',
                  fontWeight: '500',
                  color: 'var(--enterprise-gray-900)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}>
                  {user?.user_metadata?.name || user?.email || 'User'}
                </div>
                <div style={{
                  fontSize: '11px',
                  color: userRole === 'L3' ? '#1e40af' : userRole === 'L2' ? '#ca8a04' : '#6b7280',
                  fontWeight: '600',
                }}>
                  {userRole === 'L3' ? 'Manager (Admin)' : userRole === 'L2' ? 'Supervisor' : 'Operator'}
                </div>
              </div>
            </div>
            <button
              onClick={handleLogout}
              disabled={isLoading}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                padding: '10px',
                border: '1px solid var(--border-color)',
                backgroundColor: isLoading ? '#f3f4f6' : 'white',
                borderRadius: 'var(--border-radius-md)',
                color: isLoading ? '#9ca3af' : 'var(--enterprise-primary)',
                fontSize: '13px',
                fontWeight: '500',
                cursor: isLoading ? 'not-allowed' : 'pointer',
                transition: 'all 200ms ease',
                opacity: isLoading ? 0.6 : 1,
              }}
            >
              <LogOut size={16} />
              {isLoading ? 'Signing out...' : 'Sign Out'}
            </button>
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}>
          {/* TOP BAR */}
          <header style={{
            height: '70px',
            backgroundColor: 'var(--card-background)',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 32px',
            boxShadow: 'var(--shadow-sm)',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <button
                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                style={{
                  width: '40px',
                  height: '40px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  backgroundColor: 'transparent',
                  borderRadius: 'var(--border-radius-md)',
                  color: 'var(--enterprise-gray-600)',
                  cursor: 'pointer',
                  transition: 'all 200ms ease',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'var(--enterprise-gray-100)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                {isSidebarOpen ? <ChevronLeft size={20} /> : <Menu size={20} />}
              </button>

              {currentMenuItem && (
                <div>
                  <h1 style={{
                    fontSize: '20px',
                    fontWeight: '600',
                    color: 'var(--enterprise-gray-900)',
                    margin: 0,
                  }}>
                    {currentMenuItem.label}
                  </h1>
                  <p style={{
                    fontSize: '13px',
                    color: 'var(--enterprise-gray-500)',
                    margin: 0,
                  }}>
                    {currentMenuItem.description}
                  </p>
                </div>
              )}
            </div>

            <div style={{
              padding: '6px 12px',
              backgroundColor: '#dcfce7',
              borderRadius: 'var(--border-radius-md)',
              fontSize: '11px',
              fontWeight: '600',
              color: '#15803d',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
            }}>
              ✓ Authenticated
            </div>
          </header>

          {/* CONTENT */}
          <main style={{
            flex: 1,
            overflow: 'auto',
            padding: '32px',
          }}>
            <div style={{
              maxWidth: '1400px',
              margin: '0 auto',
            }}>
              {error && (
                <div style={{
                  padding: '16px',
                  marginBottom: '24px',
                  backgroundColor: '#fee2e2',
                  borderRadius: '8px',
                  color: '#dc2626',
                  display: 'flex',
                  gap: '12px',
                  alignItems: 'flex-start',
                }}>
                  <AlertCircle size={20} style={{ flexShrink: 0, marginTop: '2px' }} />
                  <div>{error}</div>
                </div>
              )}
              {renderContent()}
            </div>
          </main>
        </div>
      </div>
    </ErrorBoundary>
  );
}