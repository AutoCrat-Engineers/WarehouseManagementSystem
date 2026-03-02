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
import { RackView } from './components/RackView';
import { PackingModule, PackingDetails, PackingListInvoice, PackingListSubInvoice } from './components/packing';
import { LoadingPage } from './components/LoadingPage';
import { UserManagement } from './auth/users/UserManagement';
import { NotificationBell } from './components/notifications/NotificationBell';
import { getUserPermissions } from './auth/services/permissionService';
import type { PermissionMap } from './auth/components/GrantAccessModal';
import {
  LayoutDashboard,
  Package,
  PackageOpen,
  FileText,
  TrendingUp,
  Calendar,
  BarChart3,
  LogOut,
  Menu,
  ChevronLeft,
  ArrowRightLeft,
  Grid3X3,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Users,
  Shield,
  Boxes,
  Printer,
  ClipboardList,
  List,
  FileCheck,
  FileMinus,
  Lock,
  Unlock
} from 'lucide-react';

declare const __APP_VERSION__: string;

const supabase = getSupabaseClient();
const logoImage = '/logo.png';
const compactLogoImage = '/a-logo.png';

// User role type for RBAC
type UserRole = 'L1' | 'L2' | 'L3' | null;

type View = 'dashboard' | 'items' | 'inventory' | 'orders' | 'releases' | 'forecast' | 'planning' | 'stock-movements' | 'rack-view' | 'packing' | 'packing-sticker' | 'packing-details' | 'packing-list-invoice' | 'packing-list-sub-invoice' | 'users';

interface MenuItem {
  id: View;
  label: string;
  icon: React.ElementType;
  description: string;
  hasSubmenu?: boolean;
}

// All packing sub-views (used to determine if packing accordion is active)
const PACKING_SUB_VIEWS: View[] = ['packing', 'packing-sticker', 'packing-details', 'packing-list-invoice', 'packing-list-sub-invoice'];

// Meta for packing sub-views (displayed in the header bar)
const PACKING_VIEW_META: Record<string, { label: string; description: string }> = {
  'packing': { label: 'Packing', description: 'FG Packing Workflow' },
  'packing-sticker': { label: 'Packing — Sticker Generation', description: 'FG Sticker Generation' },
  'packing-details': { label: 'Packing — Details', description: 'Packing Specifications' },
  'packing-list-invoice': { label: 'Packing List — Against Invoice', description: 'Packing by Invoice' },
  'packing-list-sub-invoice': { label: 'Packing List — Against Sub Invoice', description: 'Packing by Sub Invoice' },
};

const menuItems: MenuItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'Overview & KPIs' },
  { id: 'items', label: 'Item Master', icon: Package, description: 'FG Catalog' },
  { id: 'inventory', label: 'Inventory', icon: Boxes, description: 'Multi-Warehouse Stock' },
  { id: 'stock-movements', label: 'Stock Movements', icon: ArrowRightLeft, description: 'Audit Trail' },
  { id: 'rack-view', label: 'Rack View', icon: Grid3X3, description: 'US Warehouse Racks' },
  { id: 'packing', label: 'Packing', icon: PackageOpen, description: 'FG Packing Workflow', hasSubmenu: true },
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
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); // mobile only
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [isSidebarLocked, setIsSidebarLocked] = useState(() => {
    // Persist lock preference in localStorage
    try { return localStorage.getItem('sidebar_locked') === 'true'; } catch { return false; }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);

  // Desktop: sidebar expands on hover OR when locked; Mobile: uses isSidebarOpen toggle
  const sidebarExpanded = isMobile ? isSidebarOpen : (isSidebarLocked || isSidebarHovered);

  const toggleSidebarLock = () => {
    const next = !isSidebarLocked;
    setIsSidebarLocked(next);
    try { localStorage.setItem('sidebar_locked', String(next)); } catch { }
  };
  const SIDEBAR_COLLAPSED_W = 72;
  const SIDEBAR_EXPANDED_W = 280;
  // SAP-style accordion states
  const [packingMenuOpen, setPackingMenuOpen] = useState(false);
  const [packingListOpen, setPackingListOpen] = useState(false);
  // Granular permission state (loaded from localStorage)
  const [userPerms, setUserPerms] = useState<PermissionMap>({});

  // ============================================================================
  // PERMISSION ENFORCEMENT: Map view IDs → permission keys
  // ============================================================================
  const VIEW_PERMISSION_MAP: Record<string, string> = {
    'dashboard': 'dashboard.view',
    'items': 'items.view',
    'inventory': 'inventory.view',
    'stock-movements': 'stock-movements.view',
    'rack-view': 'rack-view.view',
    'packing': 'packing.sticker-generation.view',
    'packing-sticker': 'packing.sticker-generation.view',
    'packing-details': 'packing.packing-details.view',
    'packing-list-invoice': 'packing.packing-list-invoice.view',
    'packing-list-sub-invoice': 'packing.packing-list-sub-invoice.view',
    'orders': 'orders.view',
    'releases': 'releases.view',
    'forecast': 'forecast.view',
    'planning': 'planning.view',
    'users': 'users.view',
  };

  /**
   * Check if the current user can access a view.
   * L3 users always have full access (they grant permissions).
   * L1/L2 users must have the specific view permission.
   */
  const canAccessView = (view: string): boolean => {
    // L3 always has full access
    if (userRole === 'L3') return true;
    // If no permissions have been assigned yet, allow everything
    // (prevents lockout for existing users before permissions are set)
    const hasAnyPermission = Object.values(userPerms).some(v => v === true);
    if (!hasAnyPermission) return true;
    // Check specific permission
    const permKey = VIEW_PERMISSION_MAP[view];
    return permKey ? userPerms[permKey] === true : true;
  };

  // ============================================================================
  // RESPONSIVE: Detect mobile/tablet screen size
  // ============================================================================
  useEffect(() => {
    const checkMobile = () => {
      const mobile = window.innerWidth < 1024;
      setIsMobile(mobile);
      if (mobile) setIsSidebarOpen(false);
    };
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  const handleNavigation = (view: View) => {
    setCurrentView(view);
    if (isMobile) setIsSidebarOpen(false);
  };

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
        // Load granular permissions from localStorage
        if (data.role !== 'L3') {
          const perms = getUserPermissions(userId);
          setUserPerms(perms);
          console.log('🔐 Loaded permissions:', Object.keys(perms).filter(k => perms[k]).length, 'granted');
        }
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
        return <DashboardNew accessToken={accessToken} onNavigate={(view) => setCurrentView(view as View)} />;
      case 'items':
        if (!canAccessView('items')) return renderAccessDenied('Item Master');
        return <ItemMasterSupabase userRole={userRole} />;
      case 'inventory':
        if (!canAccessView('inventory')) return renderAccessDenied('Inventory');
        return <InventoryGrid />;
      case 'stock-movements':
        if (!canAccessView('stock-movements')) return renderAccessDenied('Stock Movements');
        return <StockMovement accessToken={accessToken} userRole={userRole} />;
      case 'rack-view':
        if (!canAccessView('rack-view')) return renderAccessDenied('Rack View');
        return <RackView />;
      case 'packing':
      case 'packing-sticker':
        if (!canAccessView('packing-sticker')) return renderAccessDenied('Packing — Sticker Generation');
        return <PackingModule accessToken={accessToken} userRole={userRole} />;
      case 'packing-details':
        if (!canAccessView('packing-details')) return renderAccessDenied('Packing — Details');
        return <PackingDetails accessToken={accessToken} userRole={userRole} onNavigate={(v) => setCurrentView(v as View)} />;
      case 'packing-list-invoice':
        if (!canAccessView('packing-list-invoice')) return renderAccessDenied('Packing List — Invoice');
        return <PackingListInvoice accessToken={accessToken} userRole={userRole} onNavigate={(v) => setCurrentView(v as View)} />;
      case 'packing-list-sub-invoice':
        if (!canAccessView('packing-list-sub-invoice')) return renderAccessDenied('Packing List — Sub Invoice');
        return <PackingListSubInvoice accessToken={accessToken} userRole={userRole} onNavigate={(v) => setCurrentView(v as View)} />;
      case 'orders':
        if (!canAccessView('orders')) return renderAccessDenied('Blanket Orders');
        return <BlanketOrders accessToken={accessToken} />;
      case 'releases':
        if (!canAccessView('releases')) return renderAccessDenied('Blanket Releases');
        return <BlanketReleases accessToken={accessToken} />;
      case 'forecast':
        if (!canAccessView('forecast')) return renderAccessDenied('Forecasting');
        return <ForecastingModule accessToken={accessToken} />;
      case 'planning':
        if (!canAccessView('planning')) return renderAccessDenied('MRP Planning');
        return <PlanningModule accessToken={accessToken} />;
      case 'users':
        // Only L3 can access user management
        if (userRole !== 'L3') {
          return renderAccessDenied('User Management');
        }
        return <UserManagement currentUserId={user?.id || ''} />;
      default:
        return <DashboardNew accessToken={accessToken} onNavigate={(view) => setCurrentView(view as View)} />;
    }
  };

  // Access denied component
  const renderAccessDenied = (moduleName: string) => (
    <div style={{
      padding: '48px 32px',
      display: 'flex',
      flexDirection: 'column' as const,
      alignItems: 'center',
      justifyContent: 'center',
      textAlign: 'center' as const,
      gap: '16px',
    }}>
      <div style={{
        width: '64px', height: '64px', borderRadius: '16px',
        background: 'linear-gradient(135deg, #fef3c7, #fde68a)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 12px rgba(245, 158, 11, 0.2)',
      }}>
        <Shield size={32} style={{ color: '#d97706' }} />
      </div>
      <div>
        <h3 style={{ fontSize: '18px', fontWeight: '700', color: '#111827', margin: '0 0 6px' }}>
          Access Restricted
        </h3>
        <p style={{ fontSize: '14px', color: '#6b7280', margin: '0', maxWidth: '360px' }}>
          You don't have permission to access <strong>{moduleName}</strong>. Contact your L3 Manager to request access.
        </p>
      </div>
    </div>
  );

  // Build menu items dynamically based on user role + granular permissions
  const getMenuItems = () => {
    let items = [...menuItems];

    // Add User Management for L3 users
    if (userRole === 'L3') {
      console.log('✅ Adding User Management menu for L3');
      items.push({ id: 'users' as View, label: 'User Management', icon: Users, description: 'Manage Users & Roles' });
    }

    // For L1/L2 users with assigned permissions, filter menu items
    if (userRole !== 'L3') {
      const hasAnyPermission = Object.values(userPerms).some(v => v === true);
      if (hasAnyPermission) {
        items = items.filter(item => {
          // Packing parent: show if ANY packing submodule has view permission
          if (item.id === 'packing') {
            return (
              userPerms['packing.sticker-generation.view'] ||
              userPerms['packing.packing-details.view'] ||
              userPerms['packing.packing-list-invoice.view'] ||
              userPerms['packing.packing-list-sub-invoice.view']
            );
          }
          return canAccessView(item.id);
        });
      }
    }

    return items;
  };

  // Log current role for debugging
  console.log('🔄 Current userRole state:', userRole);

  // Resolve the current menu item — for packing sub-views, show packing meta
  const packingMeta = PACKING_VIEW_META[currentView];
  const currentMenuItem = packingMeta
    ? { id: currentView as View, label: packingMeta.label, icon: PackageOpen, description: packingMeta.description }
    : getMenuItems().find(item => item.id === currentView);

  return (
    <ErrorBoundary>
      <div style={{
        display: 'flex',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'var(--background-secondary)',
      }}>
        {/* MOBILE OVERLAY */}
        {isMobile && isSidebarOpen && (
          <div
            className="sidebar-overlay active"
            onClick={() => setIsSidebarOpen(false)}
          />
        )}

        {/* SIDEBAR */}
        <aside
          className={`app-sidebar${isMobile ? (isSidebarOpen ? ' open' : '') : ''}`}
          onMouseEnter={() => { if (!isMobile) setIsSidebarHovered(true); }}
          onMouseLeave={() => { if (!isMobile) setIsSidebarHovered(false); }}
          style={{
            width: isMobile ? '280px' : (sidebarExpanded ? SIDEBAR_EXPANDED_W : SIDEBAR_COLLAPSED_W),
            backgroundColor: 'var(--card-background)',
            borderRight: '1px solid var(--border-color)',
            display: 'flex',
            flexDirection: 'column',
            transition: isMobile ? 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)' : 'width 280ms cubic-bezier(0.4, 0, 0.2, 1)',
            overflow: 'hidden',
            boxShadow: sidebarExpanded ? '4px 0 24px rgba(0, 0, 0, 0.12)' : 'var(--shadow-sm)',
            position: 'fixed' as const,
            left: 0,
            top: 0,
            bottom: 0,
            zIndex: isMobile ? 999 : 100,
            ...(isMobile ? {
              transform: isSidebarOpen ? 'translateX(0)' : 'translateX(-100%)',
            } : {}),
          }}
        >
          {/* ═══ SECTION 1: LOGO ═══ */}
          <div style={{
            padding: sidebarExpanded ? '20px' : '12px 8px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            backgroundColor: '#1e3a8a',
            transition: 'padding 280ms cubic-bezier(0.4, 0, 0.2, 1)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: sidebarExpanded ? '12px' : '8px',
          }}>
            {/* Logo: Full logo when expanded, compact a-logo when collapsed */}
            <div style={{
              backgroundColor: 'white',
              padding: sidebarExpanded ? '14px 18px' : '8px',
              borderRadius: sidebarExpanded ? '12px' : '10px',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
              transition: 'all 280ms cubic-bezier(0.4, 0, 0.2, 1)',
              width: sidebarExpanded ? '100%' : '48px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}>
              <img
                src={sidebarExpanded ? logoImage : compactLogoImage}
                alt="Autocrat Engineers"
                style={{
                  width: sidebarExpanded ? '100%' : '32px',
                  height: 'auto',
                  display: 'block',
                  transition: 'width 280ms cubic-bezier(0.4, 0, 0.2, 1)',
                }}
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                }}
              />
            </div>
            {/* App name: Full name when expanded, "WMS" when collapsed */}
            <p style={{
              color: 'rgba(255, 255, 255, 0.95)',
              fontSize: sidebarExpanded ? '13px' : '10px',
              margin: '0',
              fontWeight: sidebarExpanded ? '500' : '700',
              letterSpacing: sidebarExpanded ? '0.3px' : '1px',
              textAlign: 'center',
              whiteSpace: 'nowrap',
              transition: 'all 280ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}>
              {sidebarExpanded ? 'Warehouse Management System' : 'WMS'}
            </p>
            {/* Version badge + Lock button */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: sidebarExpanded ? '8px' : '0px',
              justifyContent: 'center',
              transition: 'all 280ms cubic-bezier(0.4, 0, 0.2, 1)',
            }}>
              <span style={{
                display: 'inline-block',
                padding: sidebarExpanded ? '2px 10px' : '2px 6px',
                backgroundColor: 'rgba(255, 255, 255, 0.15)',
                borderRadius: '12px',
                fontSize: sidebarExpanded ? '11px' : '9px',
                fontWeight: '600',
                color: 'rgba(255, 255, 255, 0.9)',
                letterSpacing: '0.5px',
                textAlign: 'center',
                backdropFilter: 'blur(4px)',
                whiteSpace: 'nowrap',
                transition: 'all 280ms cubic-bezier(0.4, 0, 0.2, 1)',
              }}>
                v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.3.2'}
              </span>
              {/* Lock / Unlock toggle — desktop only */}
              {!isMobile && sidebarExpanded && (
                <button
                  onClick={(e) => { e.stopPropagation(); toggleSidebarLock(); }}
                  title={isSidebarLocked ? 'Unlock sidebar (hover mode)' : 'Lock sidebar open'}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '26px',
                    height: '26px',
                    border: '1px solid rgba(255, 255, 255, 0.25)',
                    borderRadius: '8px',
                    backgroundColor: isSidebarLocked ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)',
                    color: 'rgba(255, 255, 255, 0.95)',
                    cursor: 'pointer',
                    transition: 'all 200ms ease',
                    padding: 0,
                    flexShrink: 0,
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.35)';
                    e.currentTarget.style.transform = 'scale(1.1)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = isSidebarLocked ? 'rgba(255, 255, 255, 0.25)' : 'rgba(255, 255, 255, 0.08)';
                    e.currentTarget.style.transform = 'scale(1)';
                  }}
                >
                  {isSidebarLocked ? <Lock size={13} strokeWidth={2.5} /> : <Unlock size={13} strokeWidth={2} />}
                </button>
              )}
            </div>
          </div>

          {/* ═══ SECTION 2: NAVIGATION ═══ */}
          <nav style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            padding: sidebarExpanded ? '12px 0' : '8px 0',
          }}>
            {getMenuItems().map((item) => {
              const Icon = item.icon;
              const isPackingItem = item.hasSubmenu && item.id === 'packing';
              const isActive = isPackingItem
                ? PACKING_SUB_VIEWS.includes(currentView)
                : currentView === item.id;

              // ─── SAP-STYLE PACKING ACCORDION ───
              if (isPackingItem) {
                const isStickerActive = currentView === 'packing' || currentView === 'packing-sticker';
                const isDetailsActive = currentView === 'packing-details';
                const isListInvActive = currentView === 'packing-list-invoice';
                const isListSubInvActive = currentView === 'packing-list-sub-invoice';
                const isPackingListActive = isListInvActive || isListSubInvActive;

                return (
                  <div key={item.id}>
                    {/* Parent: Packing */}
                    <button
                      onClick={() => {
                        setPackingMenuOpen(!packingMenuOpen);
                        if (!packingMenuOpen) setPackingListOpen(false);
                      }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: sidebarExpanded ? '12px' : '0px',
                        padding: sidebarExpanded ? '12px 20px' : '12px 0',
                        justifyContent: sidebarExpanded ? 'flex-start' : 'center',
                        border: 'none',
                        backgroundColor: isActive ? 'rgba(30, 58, 138, 0.08)' : 'transparent',
                        borderLeft: isActive ? '3px solid var(--enterprise-primary)' : '3px solid transparent',
                        color: isActive ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-600)',
                        textAlign: 'left', cursor: 'pointer', transition: 'all 200ms ease',
                        fontWeight: isActive ? '600' : '500', fontSize: '14px',
                      }}
                      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--enterprise-gray-50)'; }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = isActive ? 'rgba(30, 58, 138, 0.08)' : 'transparent'; }}
                    >
                      <Icon size={20} strokeWidth={isActive ? 2.5 : 2} style={{ flexShrink: 0 }} />
                      {sidebarExpanded && (
                        <div style={{ flex: 1, overflow: 'hidden' }}>
                          <div style={{ whiteSpace: 'nowrap' }}>{item.label}</div>
                          <div style={{ fontSize: '11px', color: 'var(--enterprise-gray-500)', fontWeight: '400', whiteSpace: 'nowrap' }}>
                            {item.description}
                          </div>
                        </div>
                      )}
                      {sidebarExpanded && (
                        <ChevronDown
                          size={16}
                          style={{
                            transition: 'transform 250ms ease',
                            transform: packingMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                            color: isActive ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-400)',
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </button>

                    {/* ─── Level-1 Sub-items (only when expanded) ─── */}
                    <div style={{
                      maxHeight: (packingMenuOpen && sidebarExpanded) ? '400px' : '0',
                      overflow: 'hidden',
                      transition: 'max-height 300ms ease',
                      backgroundColor: 'rgba(30, 58, 138, 0.02)',
                    }}>
                      {/* 1. Generate Sticker */}
                      {canAccessView('packing-sticker') && (
                        <button
                          onClick={() => handleNavigation('packing-sticker')}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '9px 24px 9px 44px', border: 'none',
                            backgroundColor: isStickerActive ? 'rgba(30, 58, 138, 0.08)' : 'transparent',
                            borderLeft: isStickerActive ? '3px solid #1e3a8a' : '3px solid transparent',
                            color: isStickerActive ? '#1e3a8a' : 'var(--enterprise-gray-600)',
                            textAlign: 'left', cursor: 'pointer', transition: 'all 150ms ease',
                            fontWeight: isStickerActive ? '600' : '400', fontSize: '13px',
                          }}
                          onMouseEnter={(e) => { if (!isStickerActive) e.currentTarget.style.backgroundColor = 'rgba(30, 58, 138, 0.04)'; }}
                          onMouseLeave={(e) => { if (!isStickerActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <Printer size={15} strokeWidth={isStickerActive ? 2.2 : 1.8} style={{ flexShrink: 0, opacity: isStickerActive ? 1 : 0.6 }} />
                          <span>Sticker Generation</span>
                        </button>
                      )}

                      {/* 2. Packing Details */}
                      {canAccessView('packing-details') && (
                        <button
                          onClick={() => handleNavigation('packing-details')}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '9px 24px 9px 44px', border: 'none',
                            backgroundColor: isDetailsActive ? 'rgba(30, 58, 138, 0.08)' : 'transparent',
                            borderLeft: isDetailsActive ? '3px solid #1e3a8a' : '3px solid transparent',
                            color: isDetailsActive ? '#1e3a8a' : 'var(--enterprise-gray-600)',
                            textAlign: 'left', cursor: 'pointer', transition: 'all 150ms ease',
                            fontWeight: isDetailsActive ? '600' : '400', fontSize: '13px',
                          }}
                          onMouseEnter={(e) => { if (!isDetailsActive) e.currentTarget.style.backgroundColor = 'rgba(30, 58, 138, 0.04)'; }}
                          onMouseLeave={(e) => { if (!isDetailsActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <ClipboardList size={15} strokeWidth={isDetailsActive ? 2.2 : 1.8} style={{ flexShrink: 0, opacity: isDetailsActive ? 1 : 0.6 }} />
                          <span>Packing Details</span>
                        </button>
                      )}

                      {/* 3. Packing List (expandable — Level 2) — only if at least one child is accessible */}
                      {(canAccessView('packing-list-invoice') || canAccessView('packing-list-sub-invoice')) && (
                        <>
                          <button
                            onClick={() => setPackingListOpen(!packingListOpen)}
                            style={{
                              width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                              padding: '9px 24px 9px 44px', border: 'none',
                              backgroundColor: isPackingListActive ? 'rgba(30, 58, 138, 0.08)' : 'transparent',
                              borderLeft: isPackingListActive ? '3px solid #1e3a8a' : '3px solid transparent',
                              color: isPackingListActive ? '#1e3a8a' : 'var(--enterprise-gray-600)',
                              textAlign: 'left', cursor: 'pointer', transition: 'all 150ms ease',
                              fontWeight: isPackingListActive ? '600' : '400', fontSize: '13px',
                            }}
                            onMouseEnter={(e) => { if (!isPackingListActive) e.currentTarget.style.backgroundColor = 'rgba(30, 58, 138, 0.04)'; }}
                            onMouseLeave={(e) => { if (!isPackingListActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                          >
                            <List size={15} strokeWidth={isPackingListActive ? 2.2 : 1.8} style={{ flexShrink: 0, opacity: isPackingListActive ? 1 : 0.6 }} />
                            <span style={{ flex: 1 }}>Packing List</span>
                            <ChevronDown
                              size={14}
                              style={{
                                transition: 'transform 250ms ease',
                                transform: packingListOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                                color: isPackingListActive ? '#1e3a8a' : '#9ca3af',
                              }}
                            />
                          </button>

                          {/* ─── Level-2: Packing List sub-items ─── */}
                          <div style={{
                            maxHeight: packingListOpen ? '200px' : '0',
                            overflow: 'hidden',
                            transition: 'max-height 250ms ease',
                            backgroundColor: 'rgba(30, 58, 138, 0.02)',
                          }}>
                            {/* Against Invoice */}
                            {canAccessView('packing-list-invoice') && (
                              <button
                                onClick={() => handleNavigation('packing-list-invoice')}
                                style={{
                                  width: '100%', display: 'flex', alignItems: 'center', gap: '9px',
                                  padding: '8px 24px 8px 62px', border: 'none',
                                  backgroundColor: isListInvActive ? 'rgba(30, 58, 138, 0.1)' : 'transparent',
                                  borderLeft: isListInvActive ? '3px solid #1e3a8a' : '3px solid transparent',
                                  color: isListInvActive ? '#1e3a8a' : 'var(--enterprise-gray-500)',
                                  textAlign: 'left', cursor: 'pointer', transition: 'all 150ms ease',
                                  fontWeight: isListInvActive ? '600' : '400', fontSize: '12px',
                                }}
                                onMouseEnter={(e) => { if (!isListInvActive) e.currentTarget.style.backgroundColor = 'rgba(30, 58, 138, 0.04)'; }}
                                onMouseLeave={(e) => { if (!isListInvActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                              >
                                <FileCheck size={14} strokeWidth={isListInvActive ? 2.2 : 1.8} style={{ flexShrink: 0, opacity: isListInvActive ? 1 : 0.55 }} />
                                <span>Against Invoice</span>
                              </button>
                            )}

                            {/* Against Sub Invoice */}
                            {canAccessView('packing-list-sub-invoice') && (
                              <button
                                onClick={() => handleNavigation('packing-list-sub-invoice')}
                                style={{
                                  width: '100%', display: 'flex', alignItems: 'center', gap: '9px',
                                  padding: '8px 24px 8px 62px', border: 'none',
                                  backgroundColor: isListSubInvActive ? 'rgba(30, 58, 138, 0.1)' : 'transparent',
                                  borderLeft: isListSubInvActive ? '3px solid #1e3a8a' : '3px solid transparent',
                                  color: isListSubInvActive ? '#1e3a8a' : 'var(--enterprise-gray-500)',
                                  textAlign: 'left', cursor: 'pointer', transition: 'all 150ms ease',
                                  fontWeight: isListSubInvActive ? '600' : '400', fontSize: '12px',
                                }}
                                onMouseEnter={(e) => { if (!isListSubInvActive) e.currentTarget.style.backgroundColor = 'rgba(30, 58, 138, 0.04)'; }}
                                onMouseLeave={(e) => { if (!isListSubInvActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                              >
                                <FileMinus size={14} strokeWidth={isListSubInvActive ? 2.2 : 1.8} style={{ flexShrink: 0, opacity: isListSubInvActive ? 1 : 0.55 }} />
                                <span>Against Sub Invoice</span>
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                );
              }

              // ─── REGULAR MENU ITEMS ───
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavigation(item.id)}
                  title={!sidebarExpanded ? item.label : undefined}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: sidebarExpanded ? '12px' : '0px',
                    padding: sidebarExpanded ? '12px 20px' : '12px 0',
                    justifyContent: sidebarExpanded ? 'flex-start' : 'center',
                    border: 'none',
                    backgroundColor: isActive ? 'rgba(30, 58, 138, 0.08)' : 'transparent',
                    borderLeft: isActive ? '3px solid var(--enterprise-primary)' : '3px solid transparent',
                    color: isActive ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-600)',
                    textAlign: 'left', cursor: 'pointer', transition: 'all 200ms ease',
                    fontWeight: isActive ? '600' : '500', fontSize: '14px',
                  }}
                  onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--enterprise-gray-50)'; }}
                  onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                >
                  <Icon size={20} strokeWidth={isActive ? 2.5 : 2} style={{ flexShrink: 0 }} />
                  {sidebarExpanded && (
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ whiteSpace: 'nowrap' }}>{item.label}</div>
                      <div style={{ fontSize: '11px', color: 'var(--enterprise-gray-500)', fontWeight: '400', whiteSpace: 'nowrap' }}>
                        {item.description}
                      </div>
                    </div>
                  )}
                  {isActive && sidebarExpanded && <ChevronRight size={16} style={{ flexShrink: 0 }} />}
                </button>
              );
            })}
          </nav>

          {/* ═══ SECTION 3: USER & LOGOUT ═══ */}
          <div style={{
            padding: sidebarExpanded ? '16px 20px' : '12px 8px',
            borderTop: '1px solid var(--border-color)',
            backgroundColor: 'var(--enterprise-gray-50)',
            transition: 'padding 280ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}>
            {sidebarExpanded ? (
              /* ── Expanded: full user info ── */
              <>
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
                    flexShrink: 0,
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
              </>
            ) : (
              /* ── Collapsed: avatar + logout icon stacked ── */
              <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: '12px',
              }}>
                <div
                  title={user?.user_metadata?.name || user?.email || 'User'}
                  style={{
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
                    flexShrink: 0,
                  }}
                >
                  {user?.email?.charAt(0).toUpperCase() || 'U'}
                </div>
                <button
                  onClick={handleLogout}
                  disabled={isLoading}
                  title="Sign Out"
                  style={{
                    width: '36px',
                    height: '36px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid var(--border-color)',
                    backgroundColor: isLoading ? '#f3f4f6' : 'white',
                    borderRadius: '50%',
                    color: isLoading ? '#9ca3af' : 'var(--enterprise-primary)',
                    cursor: isLoading ? 'not-allowed' : 'pointer',
                    transition: 'all 200ms ease',
                    opacity: isLoading ? 0.6 : 1,
                    padding: 0,
                  }}
                >
                  <LogOut size={16} />
                </button>
              </div>
            )}
          </div>
        </aside>

        {/* MAIN CONTENT */}
        <div style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          marginLeft: isMobile ? 0 : (sidebarExpanded ? SIDEBAR_EXPANDED_W : SIDEBAR_COLLAPSED_W),
          transition: 'margin-left 280ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}>
          {/* TOP BAR */}
          <header className="app-topbar" style={{
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
              {/* Mobile: hamburger menu button */}
              {isMobile && (
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
              )}

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

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              {/* Notification Bell */}
              {user?.id && (
                <NotificationBell
                  userId={user.id}
                  onNavigate={(module) => {
                    setCurrentView(module as View);
                  }}
                />
              )}

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
            </div>
          </header>

          {/* CONTENT */}
          <main className="app-main" style={{
            flex: 1,
            overflow: 'auto',
            padding: '32px',
          }}>
            <div className="app-main-inner" style={{
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