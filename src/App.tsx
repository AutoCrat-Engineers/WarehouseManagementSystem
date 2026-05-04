import React, { useState, useEffect, useRef } from 'react';
import { getSupabaseClient } from './utils/supabase/client';
import { fetchWithAuth, clearLocalAuthSession } from './utils/supabase/auth';
import { getEdgeFunctionUrl, FUNCTIONS_BASE } from './utils/supabase/info';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoginPage } from './auth/login/LoginPage';
import { DashboardNew } from './components/DashboardNew';
import { UnifiedItemMaster } from './components/UnifiedItemMaster';
import { BlanketOrders } from './components/BlanketOrders';
import { BlanketReleases } from './components/BlanketReleases';
import { ForecastingModule } from './components/ForecastingModule';
import { PlanningModule } from './components/PlanningModule';
import { StockMovement } from './components/StockMovement';
import { RackView } from './components/RackView';
// New DB-backed rack view (Phase 3 rewrite; legacy RackView kept as fallback).
import { RackViewGrid } from './components/rack-view';
// BPA (Customer Agreement) management module.
import { BPAList } from './components/bpa';
// Release / Sub-Invoice / Tariff module (Phase 3 rewrite).
import { ReleaseList, TariffInvoiceQueue } from './components/release';
import { PackingModule, PackingDetails, PackingListInvoice, PackingListSubInvoice } from './components/packing';
import { PalletDashboard, ContractConfigManager, DispatchSelection, TraceabilityViewer, MasterPackingListHome, PerformaInvoice } from './components/packing-engine';
import { LoadingPage } from './components/LoadingPage';
import { UserManagement } from './auth/users/UserManagement';
import { NotificationBell } from './components/notifications/NotificationBell';
import { getUserPermissions } from './auth/services/permissionService';
import type { PermissionMap } from './auth/components/GrantAccessModal';
import { canAccessView as _canAccessView, canAccessAnyPackingModule, canAccessAnyDispatchModule } from './auth/utils/permissionUtils';
import {
  LayoutDashboard,
  Package,
  PackageOpen,
  FileText,
  TrendingUp,
  Calendar,
  LogOut,
  Menu,
  ChevronLeft,
  ArrowRightLeft,
  ChevronRight,
  ChevronDown,
  AlertCircle,
  Users,
  Shield,
  Boxes,
  Printer,
  ClipboardList,
  Lock,
  Unlock,
  Grid3X3,
  Layers,
  Forklift,
  Stamp,
  Truck,
} from 'lucide-react';
import './styles/sidebar-animations.css';

// Custom side-view cargo ship icon matching reference design
const CargoShip = ({ size = 20, strokeWidth = 2, style = {} }: { size?: number; strokeWidth?: number; style?: React.CSSProperties }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" style={style} className="cargo-ship-icon">
    {/* Hull - wide tapered shape */}
    <path className="ship-hull" d="M1 18 L3 21 L21 21 L23 18 L20 18 L4 18 Z" />
    {/* Deck line */}
    <line className="ship-deck" x1="4" y1="18" x2="20" y2="18" />
    {/* Bridge / Cabin */}
    <rect className="ship-cabin" x="5" y="13" width="4" height="5" rx="0.5" />
    {/* Bridge window */}
    <rect className="ship-window" x="6" y="14" width="2" height="1.5" rx="0.3" />
    {/* Antenna mast */}
    <line className="ship-mast" x1="7" y1="13" x2="7" y2="9" />
    <circle className="ship-light" cx="7" cy="9" r="0.5" />
    {/* Containers - bottom row */}
    <rect className="ship-container ship-container-bl" x="11" y="14.5" width="2.8" height="3.5" rx="0.3" />
    <rect className="ship-container ship-container-br" x="14.2" y="14.5" width="2.8" height="3.5" rx="0.3" />
    {/* Containers - top row */}
    <rect className="ship-container ship-container-tl" x="11.7" y="11" width="2.8" height="3.5" rx="0.3" />
    <rect className="ship-container ship-container-tr" x="14.9" y="11" width="2.8" height="3.5" rx="0.3" />
    {/* Water waves (decorative, hidden by default, shown on hover) */}
    <path className="ship-wave ship-wave-1" d="M0 23 Q3 21.5, 6 23 T12 23 T18 23 T24 23" strokeWidth="1" />
    <path className="ship-wave ship-wave-2" d="M-2 24 Q1 22.5, 4 24 T10 24 T16 24 T22 24" strokeWidth="0.8" />
  </svg>
);

declare const __APP_VERSION__: string;

const supabase = getSupabaseClient();
const logoImage = '/logo.png';
const compactLogoImage = '/a-logo.png';
const GLOBAL_SESSION_STORAGE_KEY = 'wms_global_session_id';
const TAB_ID_STORAGE_KEY = 'wms_auth_tab_id';
const AUTH_OWNER_STORAGE_KEY = 'wms_auth_owner';
const CONCURRENT_TAB_LOGOUT_MESSAGE = 'Your session was ended because your account signed in from another tab.';

// Edge Function base URL — shared across the app and configurable via VITE_FUNCTIONS_URL
const EDGE_FN_URL = FUNCTIONS_BASE;
const SESSION_VALIDATION_INTERVAL_MS = 15000;

function getStoredTabSessionId(): string | null {
  try {
    return sessionStorage.getItem(GLOBAL_SESSION_STORAGE_KEY);
  } catch {
    return null;
  }
}

function setStoredTabSessionId(value: string | null): void {
  try {
    if (value) {
      sessionStorage.setItem(GLOBAL_SESSION_STORAGE_KEY, value);
    } else {
      sessionStorage.removeItem(GLOBAL_SESSION_STORAGE_KEY);
    }
  } catch {
    // ignore browser storage failures
  }
}

function getOrCreateTabId(): string {
  try {
    const existing = sessionStorage.getItem(TAB_ID_STORAGE_KEY);
    if (existing) {
      return existing;
    }

    const next = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    sessionStorage.setItem(TAB_ID_STORAGE_KEY, next);
    return next;
  } catch {
    return 'tab-unknown';
  }
}

function readAuthOwner(): { tabId: string; sessionId: string | null } | null {
  try {
    const raw = localStorage.getItem(AUTH_OWNER_STORAGE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return {
      tabId: typeof parsed?.tabId === 'string' ? parsed.tabId : '',
      sessionId: typeof parsed?.sessionId === 'string' ? parsed.sessionId : null,
    };
  } catch {
    return null;
  }
}

function writeAuthOwner(tabId: string, sessionId: string | null): void {
  try {
    localStorage.setItem(AUTH_OWNER_STORAGE_KEY, JSON.stringify({
      tabId,
      sessionId,
      updatedAt: Date.now(),
    }));
  } catch {
    // ignore browser storage failures
  }
}

function clearAuthOwnerIfOwnedBy(tabId: string): void {
  try {
    const owner = readAuthOwner();
    if (owner?.tabId === tabId) {
      localStorage.removeItem(AUTH_OWNER_STORAGE_KEY);
    }
  } catch {
    // ignore browser storage failures
  }
}

// User role type for RBAC
type UserRole = 'L1' | 'L2' | 'L3' | null;

type View = 'dashboard' | 'items' | 'inventory' | 'orders' | 'releases' | 'forecast' | 'planning' | 'stock-movements' | 'rack-view' | 'packing' | 'packing-sticker' | 'packing-details' | 'packing-list-invoice' | 'packing-list-sub-invoice' | 'pe-pallet-dashboard' | 'pe-contract-configs' | 'pe-dispatch' | 'pe-mpl-home' | 'pe-performa-invoice' | 'pe-traceability' | 'dispatch' | 'users' | 'bpa' | 'rack-view-v2' | 'releases-v2' | 'tariff-queue';

interface MenuItem {
  id: View;
  label: string;
  icon: React.ElementType;
  description: string;
  hasSubmenu?: boolean;
}

// All packing sub-views (used to determine if packing accordion is active)
const PACKING_SUB_VIEWS: View[] = ['packing', 'packing-sticker', 'packing-details', 'packing-list-invoice', 'packing-list-sub-invoice', 'pe-pallet-dashboard', 'pe-contract-configs', 'pe-traceability'];

// All dispatch sub-views (used to determine if dispatch accordion is active)
const DISPATCH_SUB_VIEWS: View[] = ['dispatch', 'pe-dispatch', 'pe-mpl-home', 'pe-performa-invoice'];

// Meta for packing sub-views (displayed in the header bar)
const PACKING_VIEW_META: Record<string, { label: string; description: string }> = {
  'packing': { label: 'Packing', description: 'FG Packing Workflow' },
  'packing-sticker': { label: 'Packing — Sticker Generation', description: 'FG Sticker Generation' },
  'packing-details': { label: 'Packing — Details', description: 'Packing Specifications' },
  'packing-list-invoice': { label: 'Packing List — Against Invoice', description: 'Packing by Invoice' },
  'packing-list-sub-invoice': { label: 'Packing List — Against Sub Invoice', description: 'Packing by Sub Invoice' },
  'pe-pallet-dashboard': { label: 'Pallet Dashboard', description: 'Real-time Pallet Readiness' },
  'pe-contract-configs': { label: 'Contract Configs', description: 'Contract Packing Rules' },
  'pe-traceability': { label: 'Traceability', description: 'Full Backward Trace' },
};

// Meta for dispatch sub-views (displayed in the header bar)
const DISPATCH_VIEW_META: Record<string, { label: string; description: string }> = {
  'dispatch': { label: 'Dispatch', description: 'Dispatch & Shipping' },
  'pe-dispatch': { label: 'Dispatch Selection', description: 'Select Pallets for Dispatch' },
  'pe-mpl-home': { label: 'Packing List', description: 'Master Packing List Dashboard' },
  'pe-performa-invoice': { label: 'Proforma Invoice', description: 'Shipment Batching & Stock Dispatch' },
};

const menuItems: MenuItem[] = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, description: 'Overview & KPIs' },
  { id: 'items', label: 'Inventory Hub', icon: Boxes, description: 'FG Catalog & Stock View' },
  { id: 'stock-movements', label: 'Stock Movements', icon: ArrowRightLeft, description: 'Audit Trail' },
  { id: 'packing', label: 'Packing', icon: PackageOpen, description: 'FG Packing Workflow', hasSubmenu: true },
  { id: 'dispatch' as View, label: 'Dispatch', icon: CargoShip as any, description: 'Dispatch & Shipping', hasSubmenu: true },
  { id: 'bpa', label: 'Blanket Order & Release', icon: FileText, description: 'Customer BPAs' },
  { id: 'rack-view-v2', label: 'Inbound Receiving', icon: Truck, description: 'Shipment verify & Goods Receipt' },
  { id: 'rack-view', label: 'Rack Storage', icon: Grid3X3, description: 'Physical rack placement & movement' },
  { id: 'forecast', label: 'Forecasting', icon: TrendingUp, description: 'Demand Prediction' },

];

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [user, setUser] = useState<any>(null);
  const [userRole, setUserRole] = useState<UserRole>(null);
  const [currentView, setCurrentView] = useState<View>('dashboard');
  // GR putaway context — when set, legacy RackView enters putaway mode.
  // Set by ReceiveShipmentScreen's auto-navigate on GR confirmation.
  const [activeGrNumber, setActiveGrNumber] = useState<string | null>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true); // mobile only
  const [isSidebarHovered, setIsSidebarHovered] = useState(false);
  const [isSidebarLocked, setIsSidebarLocked] = useState(() => {
    // Persist lock preference in localStorage
    try { return localStorage.getItem('sidebar_locked') === 'true'; } catch { return false; }
  });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isMobile, setIsMobile] = useState(false);
  const [globalSessionId, setGlobalSessionId] = useState<string | null>(() => {
    return getStoredTabSessionId();
  });

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
  const [dispatchMenuOpen, setDispatchMenuOpen] = useState(false);
  // Granular permission state (loaded from localStorage)
  const [userPerms, setUserPerms] = useState<PermissionMap>({});
  const explicitLogoutRef = useRef(false);
  const globalSessionIdRef = useRef<string | null>(globalSessionId);
  const currentTabIdRef = useRef(getOrCreateTabId());

  useEffect(() => {
    globalSessionIdRef.current = globalSessionId;
  }, [globalSessionId]);

  const isAuthOwnedByDifferentTab = (): boolean => {
    const owner = readAuthOwner();
    return Boolean(
      owner?.tabId
      && owner.tabId !== currentTabIdRef.current
      && owner.sessionId,
    );
  };

  const isOwnedByAnotherTab = (): boolean => {
    const owner = readAuthOwner();
    const currentSessionId = globalSessionIdRef.current;

    return Boolean(
      owner?.tabId
      && owner.tabId !== currentTabIdRef.current
      && owner.sessionId
      && currentSessionId
      && owner.sessionId !== currentSessionId,
    );
  };

  const clearClientAuthState = (
    message?: string,
    options?: { clearSharedAuth?: boolean; clearOwner?: boolean },
  ) => {
    const clearSharedAuth = options?.clearSharedAuth ?? true;
    const clearOwner = options?.clearOwner ?? false;

    if (clearSharedAuth) {
      clearLocalAuthSession();
    }
    setAccessToken(null);
    setUser(null);
    setUserRole(null);
    setGlobalSessionId(null);
    globalSessionIdRef.current = null;
    setStoredTabSessionId(null);
    if (clearOwner) {
      clearAuthOwnerIfOwnedBy(currentTabIdRef.current);
    }
    setIsAuthenticated(false);
    setCurrentView('dashboard');
    setError(message ?? null);
  };

  const forceClientLogout = async (message?: string) => {
    explicitLogoutRef.current = true;
    try {
      await supabase.auth.signOut();
    } catch (err) {
      console.warn('Supabase client signOut failed during forced logout:', err);
    } finally {
      explicitLogoutRef.current = false;
    }
    clearClientAuthState(message, { clearSharedAuth: true, clearOwner: true });
  };

  const validateCurrentGlobalSession = async (): Promise<boolean> => {
    if (isAuthOwnedByDifferentTab()) {
      clearClientAuthState(CONCURRENT_TAB_LOGOUT_MESSAGE, {
        clearSharedAuth: false,
        clearOwner: false,
      });
      return false;
    }

    if (!isAuthenticated || !globalSessionId || !accessToken) {
      return true;
    }

    try {
      const response = await fetch(`${EDGE_FN_URL}/auth-validate-session`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ global_session_id: globalSessionId }),
      });

      let result: any = {};
      try {
        result = await response.json();
      } catch (_) {
        result = {};
      }

      if (!response.ok || !result.valid || result.status !== 'active') {
        if (isOwnedByAnotherTab()) {
          clearClientAuthState(CONCURRENT_TAB_LOGOUT_MESSAGE, {
            clearSharedAuth: false,
            clearOwner: false,
          });
          return false;
        }

        await forceClientLogout('Your session was ended because your account signed in from another browser.');
        return false;
      }

      return true;
    } catch (err) {
      console.warn('Global session validation threw:', err);
      return true;
    }
  };

  // ============================================================================
  // PERMISSION ENFORCEMENT: Uses centralized permission utility
  // ============================================================================

  /**
   * Check if the current user can access a view.
   * Delegates to the centralized canAccessView utility.
   */
  const canAccessViewLocal = (view: string): boolean => {
    return _canAccessView(view, userRole, userPerms);
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
        if (session?.access_token && session.user) {
          if (isAuthOwnedByDifferentTab()) {
            clearClientAuthState(CONCURRENT_TAB_LOGOUT_MESSAGE, {
              clearSharedAuth: false,
              clearOwner: false,
            });
            return;
          }

          setAccessToken(session.access_token);
          setUser(session.user);
          setIsAuthenticated(true);
          setError(null);
          fetchUserRole(session.user.id);
        } else {
          if (!explicitLogoutRef.current && globalSessionIdRef.current) {
            return;
          }

          clearClientAuthState();
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== AUTH_OWNER_STORAGE_KEY) {
        return;
      }

      const owner = readAuthOwner();
      if (
        isAuthenticated
        && owner?.tabId
        && owner.tabId !== currentTabIdRef.current
        && owner.sessionId
        && (!globalSessionIdRef.current || owner.sessionId !== globalSessionIdRef.current)
      ) {
        clearClientAuthState(CONCURRENT_TAB_LOGOUT_MESSAGE, {
          clearSharedAuth: false,
          clearOwner: false,
        });
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated || !globalSessionId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void validateCurrentGlobalSession();
    }, SESSION_VALIDATION_INTERVAL_MS);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'visible') {
        void validateCurrentGlobalSession();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    void validateCurrentGlobalSession();

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [isAuthenticated, globalSessionId, accessToken]);

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
        if (isAuthOwnedByDifferentTab()) {
          clearClientAuthState(CONCURRENT_TAB_LOGOUT_MESSAGE, {
            clearSharedAuth: false,
            clearOwner: false,
          });
          return;
        }

        setAccessToken(session.access_token);
        setUser(session.user);
        setIsAuthenticated(true);
        setError(null);
        await fetchUserRole(session.user.id);
      } else {
        setAccessToken(null);
        setUser(null);
        setUserRole(null);
        setGlobalSessionId(null);
        setStoredTabSessionId(null);
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

      const response = await fetch(`${EDGE_FN_URL}/auth-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const result = await response.json();

      if (!response.ok) {
        setError(result.error || 'Login failed');
        return false;
      }

      if (result.access_token) {
        if (result.global_session_id) {
          setGlobalSessionId(result.global_session_id);
          globalSessionIdRef.current = result.global_session_id;
          setStoredTabSessionId(result.global_session_id);
          writeAuthOwner(currentTabIdRef.current, result.global_session_id);
        }

        // Set Supabase client session with the tokens from edge function
        await supabase.auth.setSession({
          access_token: result.access_token,
          refresh_token: result.refresh_token,
        });

        setAccessToken(result.access_token);
        setUser(result.user_profile);
        setUserRole(result.user_profile.role as UserRole);
        setIsAuthenticated(true);

        // Show concurrent kill warning if applicable
        if (result.concurrent_kill) {
          const killedCount = result.transactions_killed?.length || 0;
          if (killedCount > 0) {
            setError(`Your previous session was terminated. ${killedCount} pending transaction(s) were cancelled.`);
          }
        }

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

  // Fetch user role from the profile via `au_get-profile` edge function.
  // The permissions RPC still runs from the browser (by design — RPC
  // migration is a separate follow-up).  Both requests still fire in
  // parallel via Promise.allSettled, preserving the prior latency.
  const fetchUserRole = async (userId: string) => {
    try {
      const [profileResult, permsResult] = await Promise.allSettled([
        fetchWithAuth(getEdgeFunctionUrl('au_get-profile'), { method: 'POST' })
          .then(async (r) => {
            const j = await r.json().catch(() => null);
            if (!r.ok || !j?.success) {
              throw new Error(j?.error || 'Failed to fetch profile');
            }
            return j.profile as { role: string; is_active: boolean; email: string; full_name: string };
          }),
        getUserPermissions(userId),
      ]);

      const data = profileResult.status === 'fulfilled' ? profileResult.value : null;

      if (!data) {
        console.error('❌ Could not fetch user role:',
          profileResult.status === 'rejected' ? profileResult.reason : 'no data');
        setUserRole('L1');
        return;
      }

      if (data.is_active) {
        setUserRole(data.role as UserRole);
        // Apply permissions (already fetched in parallel)
        if (data.role !== 'L3' && permsResult.status === 'fulfilled') {
          setUserPerms(permsResult.value);
        } else if (data.role !== 'L3') {
          setUserPerms({});
        }
      } else {
        setUserRole(null);
        setError('Account is inactive. Please contact your administrator.');
        await supabase.auth.signOut();
        clearClientAuthState('Account is inactive. Please contact your administrator.', {
          clearSharedAuth: true,
          clearOwner: true,
        });
      }
    } catch (err) {
      console.error('💥 Error fetching user role:', err);
      setUserRole('L1');
    }
  };

  const handleLogout = async () => {
    explicitLogoutRef.current = true;
    try {
      setIsLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      const logoutToken = session?.access_token || accessToken;

      const response = await fetch(`${EDGE_FN_URL}/auth-logout`, {
        method: 'POST',
        headers: {
          ...(logoutToken ? { 'Authorization': `Bearer ${logoutToken}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ global_session_id: globalSessionId }),
      });

      let parsedLogoutResult: any = {};
      try {
        parsedLogoutResult = await response.clone().json();
      } catch (_) {
        parsedLogoutResult = {};
      }

      const isIdempotentLogout =
        [401, 403, 404].includes(response.status) &&
        (parsedLogoutResult?.code === 'session_not_found'
          || parsedLogoutResult?.note === 'already_logged_out'
          || parsedLogoutResult?.status === 'not_found'
          || parsedLogoutResult?.reason === 'SESSION_NOT_ACTIVE');

      if (!response.ok && !isIdempotentLogout && response.status >= 500) {
        clearClientAuthState('Logout cleanup failed on the server. Local session cleared.', {
          clearSharedAuth: true,
          clearOwner: true,
        });
        return;
      }

      clearClientAuthState(undefined, {
        clearSharedAuth: true,
        clearOwner: true,
      });
      return;

    } catch (err) {
      console.error('Logout error:', err);
      clearClientAuthState('Logout request failed. Local session cleared.', {
        clearSharedAuth: true,
        clearOwner: true,
      });
    } finally {
      explicitLogoutRef.current = false;
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
      case 'inventory':
        if (!canAccessViewLocal('items') && !canAccessViewLocal('inventory')) return renderAccessDenied('Inventory');
        return <UnifiedItemMaster userRole={userRole} userPerms={userPerms} />;
      case 'stock-movements':
        if (!canAccessViewLocal('stock-movements')) return renderAccessDenied('Stock Movements');
        return <StockMovement accessToken={accessToken} userRole={userRole} userPerms={userPerms} />;
      case 'rack-view':
        if (!canAccessViewLocal('rack-view')) return renderAccessDenied('Rack View');
        return (
          <RackView
            userRole={userRole}
            userPerms={userPerms}
            grNumber={activeGrNumber ?? undefined}
            onGrPlacementDone={() => setActiveGrNumber(null)}
          />
        );
      case 'rack-view-v2':
        // New DB-backed rack view — hydrates from mv_rack_view, shows back-chain,
        // and hosts the Receive Shipment / GR wizard. On GR confirm, auto-jumps
        // to the legacy rack view (which handles physical placement).
        if (!canAccessViewLocal('rack-view')) return renderAccessDenied('Rack View');
        return (
          <RackViewGrid
            userRole={userRole}
            userPerms={userPerms}
            onGrConfirmed={(grNumber) => {
              setActiveGrNumber(grNumber);
              setCurrentView('rack-view');
            }}
          />
        );
      case 'bpa':
        // Customer Agreement (BPA) management — blanket qty, MIN/MAX, REL MULT,
        // revision tracking. Feeds into Blanket Orders via "Activate BO".
        return <BPAList userRole={userRole} userPerms={userPerms} onNavigate={(v) => setCurrentView(v as View)} />;
      case 'releases-v2':
        // New release flow: paste customer PO → FIFO pallet picker →
        // atomic sub-invoice + tariff creation via RPC.
        return <ReleaseList userRole={userRole} userPerms={userPerms} />;
      case 'tariff-queue':
        // Finance queue for US tariff invoices: compute rates,
        // advance status DRAFT → SUBMITTED → CLAIMED → PAID.
        return <TariffInvoiceQueue userRole={userRole} userPerms={userPerms} />;
      case 'packing':
      case 'packing-sticker':
        if (!canAccessViewLocal('packing-sticker')) return renderAccessDenied('Packing — Sticker Generation');
        return <PackingModule accessToken={accessToken} userRole={userRole} />;
      case 'packing-details':
        if (!canAccessViewLocal('packing-details')) return renderAccessDenied('Packing — Details');
        return <PackingDetails accessToken={accessToken} userRole={userRole} userPerms={userPerms} onNavigate={(v) => setCurrentView(v as View)} />;
      case 'packing-list-invoice':
        if (!canAccessViewLocal('packing-list-invoice')) return renderAccessDenied('Packing List — Invoice');
        return <PackingListInvoice accessToken={accessToken} userRole={userRole} onNavigate={(v) => setCurrentView(v as View)} />;
      case 'packing-list-sub-invoice':
        if (!canAccessViewLocal('packing-list-sub-invoice')) return renderAccessDenied('Packing List — Sub Invoice');
        return <PackingListSubInvoice accessToken={accessToken} userRole={userRole} onNavigate={(v) => setCurrentView(v as View)} />;
      case 'pe-pallet-dashboard':
        if (!canAccessViewLocal('pe-pallet-dashboard')) return renderAccessDenied('Pallet Dashboard');
        return <PalletDashboard accessToken={accessToken} userRole={userRole} userPerms={userPerms} />;
      case 'pe-contract-configs':
        if (!canAccessViewLocal('pe-contract-configs')) return renderAccessDenied('Contract Configs');
        return <ContractConfigManager accessToken={accessToken} userRole={userRole} userPerms={userPerms} />;
      case 'pe-dispatch':
        if (!canAccessViewLocal('pe-dispatch')) return renderAccessDenied('Dispatch Selection');
        return <DispatchSelection accessToken={accessToken} userRole={userRole} userPerms={userPerms} onNavigate={(v) => handleNavigation(v as View)} />;
      case 'pe-traceability':
        if (!canAccessViewLocal('pe-traceability')) return renderAccessDenied('Traceability');
        return <TraceabilityViewer accessToken={accessToken} userRole={userRole} userPerms={userPerms} />;
      // pe-pl-print removed — integrated into pe-mpl-home
      case 'pe-mpl-home':
        if (!canAccessViewLocal('pe-mpl-home')) return renderAccessDenied('MPL Home');
        return <MasterPackingListHome accessToken={accessToken} userRole={userRole} userPerms={userPerms} onNavigate={(v) => handleNavigation(v as View)} />;
      case 'pe-performa-invoice':
        if (!canAccessViewLocal('pe-performa-invoice')) return renderAccessDenied('Performa Invoice');
        return <PerformaInvoice accessToken={accessToken} userRole={userRole} userPerms={userPerms} onNavigate={(v) => handleNavigation(v as View)} />;
      case 'orders':
        if (!canAccessViewLocal('orders')) return renderAccessDenied('Blanket Orders');
        return <BlanketOrders accessToken={accessToken} userRole={userRole} userPerms={userPerms} />;
      case 'releases':
        if (!canAccessViewLocal('releases')) return renderAccessDenied('Blanket Releases');
        return <BlanketReleases accessToken={accessToken} userRole={userRole} userPerms={userPerms} />;
      case 'forecast':
        if (!canAccessViewLocal('forecast')) return renderAccessDenied('Forecasting');
        return <ForecastingModule accessToken={accessToken} />;
      case 'planning':
        if (!canAccessViewLocal('planning')) return renderAccessDenied('MRP Planning');
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

      items.push({ id: 'users' as View, label: 'User Management', icon: Users, description: 'Manage Users & Roles' });
    }

    // For L1/L2 users with loaded permissions, filter menu items
    // Only skip filtering if NO permissions have been loaded at all (empty object)
    if (userRole !== 'L3') {
      // For L1/L2 users with loaded permissions, filter menu items
      const permKeys = Object.keys(userPerms);
      if (permKeys.length > 0) {
        items = items.filter(item => {
          // Packing parent: show if ANY packing submodule has view permission
          if (item.id === 'packing') {
            return canAccessAnyPackingModule(userRole, userPerms);
          }
          if (item.id === 'dispatch') {
            return canAccessAnyDispatchModule(userRole, userPerms);
          }
          return canAccessViewLocal(item.id);
        });
      }
    }

    return items;
  };



  // Resolve the current menu item — for packing/dispatch sub-views, show meta
  const packingMeta = PACKING_VIEW_META[currentView];
  const dispatchMeta = DISPATCH_VIEW_META[currentView];
  const currentMenuItem = packingMeta
    ? { id: currentView as View, label: packingMeta.label, icon: PackageOpen, description: packingMeta.description }
    : dispatchMeta
      ? { id: currentView as View, label: dispatchMeta.label, icon: CargoShip as any, description: dispatchMeta.description }
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
                v{typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '0.4.0'}
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

                return (
                  <div key={item.id}>
                    {/* Parent: Packing */}
                    <button
                      data-view="packing"
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
                      maxHeight: (packingMenuOpen && sidebarExpanded) ? '800px' : '0',
                      overflow: 'hidden',
                      transition: 'max-height 300ms ease',
                      backgroundColor: 'rgba(30, 58, 138, 0.02)',
                    }}>
                      {/* 1. Generate Sticker */}
                      {canAccessViewLocal('packing-sticker') && (
                        <button
                          data-view="packing-sticker"
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
                      {canAccessViewLocal('packing-details') && (
                        <button
                          data-view="packing-details"
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

                      {/* ─── Packing Engine Views ─── */}

                      {/* Pallet Dashboard */}
                      {canAccessViewLocal('pe-pallet-dashboard') && (
                        <button
                          data-view="pe-pallet-dashboard"
                          onClick={() => handleNavigation('pe-pallet-dashboard')}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '9px 24px 9px 44px', border: 'none',
                            backgroundColor: currentView === 'pe-pallet-dashboard' ? 'rgba(30, 58, 138, 0.08)' : 'transparent',
                            borderLeft: currentView === 'pe-pallet-dashboard' ? '3px solid #1e3a8a' : '3px solid transparent',
                            color: currentView === 'pe-pallet-dashboard' ? '#1e3a8a' : 'var(--enterprise-gray-600)',
                            textAlign: 'left', cursor: 'pointer', transition: 'all 150ms ease',
                            fontWeight: currentView === 'pe-pallet-dashboard' ? '600' : '400', fontSize: '13px',
                          }}
                          onMouseEnter={(e) => { if (currentView !== 'pe-pallet-dashboard') e.currentTarget.style.backgroundColor = 'rgba(30, 58, 138, 0.04)'; }}
                          onMouseLeave={(e) => { if (currentView !== 'pe-pallet-dashboard') e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <Layers size={15} strokeWidth={currentView === 'pe-pallet-dashboard' ? 2.2 : 1.8} style={{ flexShrink: 0, opacity: currentView === 'pe-pallet-dashboard' ? 1 : 0.6 }} />
                          <span>Pallet Dashboard</span>
                        </button>
                      )}


                    </div>
                  </div>
                );
              }

              // ─── SAP-STYLE DISPATCH ACCORDION ───
              const isDispatchItem = item.hasSubmenu && item.id === 'dispatch';
              if (isDispatchItem) {
                const isDispatchActive = DISPATCH_SUB_VIEWS.includes(currentView);
                return (
                  <div key={item.id}>
                    {/* Parent: Dispatch */}
                    <button
                      data-view="dispatch"
                      onClick={() => {
                        setDispatchMenuOpen(!dispatchMenuOpen);
                      }}
                      style={{
                        width: '100%', display: 'flex', alignItems: 'center', gap: sidebarExpanded ? '12px' : '0px',
                        padding: sidebarExpanded ? '12px 20px' : '12px 0',
                        justifyContent: sidebarExpanded ? 'flex-start' : 'center',
                        border: 'none',
                        backgroundColor: isDispatchActive ? 'rgba(30, 58, 138, 0.08)' : 'transparent',
                        borderLeft: isDispatchActive ? '3px solid var(--enterprise-primary)' : '3px solid transparent',
                        color: isDispatchActive ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-600)',
                        textAlign: 'left', cursor: 'pointer', transition: 'all 200ms ease',
                        fontWeight: isDispatchActive ? '600' : '500', fontSize: '14px',
                      }}
                      onMouseEnter={(e) => { if (!isDispatchActive) e.currentTarget.style.backgroundColor = 'var(--enterprise-gray-50)'; }}
                      onMouseLeave={(e) => { if (!isDispatchActive) e.currentTarget.style.backgroundColor = isDispatchActive ? 'rgba(30, 58, 138, 0.08)' : 'transparent'; }}
                    >
                      <Icon size={20} strokeWidth={isDispatchActive ? 2.5 : 2} style={{ flexShrink: 0 }} />
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
                            transform: dispatchMenuOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                            color: isDispatchActive ? 'var(--enterprise-primary)' : 'var(--enterprise-gray-400)',
                            flexShrink: 0,
                          }}
                        />
                      )}
                    </button>

                    {/* ─── Dispatch Sub-items ─── */}
                    <div style={{
                      maxHeight: (dispatchMenuOpen && sidebarExpanded) ? '400px' : '0',
                      overflow: 'hidden',
                      transition: 'max-height 300ms ease',
                      backgroundColor: 'rgba(30, 58, 138, 0.02)',
                    }}>
                      {/* Dispatch Selection */}
                      {canAccessViewLocal('pe-dispatch') && (
                        <button
                          data-view="pe-dispatch"
                          onClick={() => handleNavigation('pe-dispatch')}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '9px 24px 9px 44px', border: 'none',
                            backgroundColor: currentView === 'pe-dispatch' ? 'rgba(30, 58, 138, 0.08)' : 'transparent',
                            borderLeft: currentView === 'pe-dispatch' ? '3px solid #1e3a8a' : '3px solid transparent',
                            color: currentView === 'pe-dispatch' ? '#1e3a8a' : 'var(--enterprise-gray-600)',
                            textAlign: 'left', cursor: 'pointer', transition: 'all 150ms ease',
                            fontWeight: currentView === 'pe-dispatch' ? '600' : '400', fontSize: '13px',
                          }}
                          onMouseEnter={(e) => { if (currentView !== 'pe-dispatch') e.currentTarget.style.backgroundColor = 'rgba(30, 58, 138, 0.04)'; }}
                          onMouseLeave={(e) => { if (currentView !== 'pe-dispatch') e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <Forklift size={15} strokeWidth={currentView === 'pe-dispatch' ? 2.2 : 1.8} style={{ flexShrink: 0, opacity: currentView === 'pe-dispatch' ? 1 : 0.6 }} />
                          <span>Dispatch Selection</span>
                        </button>
                      )}

                      {/* Packing List */}
                      {canAccessViewLocal('pe-mpl-home') && (
                        <button
                          data-view="pe-mpl-home"
                          onClick={() => handleNavigation('pe-mpl-home')}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '9px 24px 9px 44px', border: 'none',
                            backgroundColor: currentView === 'pe-mpl-home' ? 'rgba(30, 58, 138, 0.08)' : 'transparent',
                            borderLeft: currentView === 'pe-mpl-home' ? '3px solid #1e3a8a' : '3px solid transparent',
                            color: currentView === 'pe-mpl-home' ? '#1e3a8a' : 'var(--enterprise-gray-600)',
                            textAlign: 'left', cursor: 'pointer', transition: 'all 150ms ease',
                            fontWeight: currentView === 'pe-mpl-home' ? '600' : '400', fontSize: '13px',
                          }}
                          onMouseEnter={(e) => { if (currentView !== 'pe-mpl-home') e.currentTarget.style.backgroundColor = 'rgba(30, 58, 138, 0.04)'; }}
                          onMouseLeave={(e) => { if (currentView !== 'pe-mpl-home') e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <ClipboardList size={15} strokeWidth={currentView === 'pe-mpl-home' ? 2.2 : 1.8} style={{ flexShrink: 0, opacity: currentView === 'pe-mpl-home' ? 1 : 0.6 }} />
                          <span>Packing List</span>
                        </button>
                      )}

                      {/* Performa Invoice */}
                      {canAccessViewLocal('pe-performa-invoice') && (
                        <button
                          data-view="pe-performa-invoice"
                          onClick={() => handleNavigation('pe-performa-invoice')}
                          style={{
                            width: '100%', display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '9px 24px 9px 44px', border: 'none',
                            backgroundColor: currentView === 'pe-performa-invoice' ? 'rgba(30, 58, 138, 0.08)' : 'transparent',
                            borderLeft: currentView === 'pe-performa-invoice' ? '3px solid #1e3a8a' : '3px solid transparent',
                            color: currentView === 'pe-performa-invoice' ? '#1e3a8a' : 'var(--enterprise-gray-600)',
                            textAlign: 'left', cursor: 'pointer', transition: 'all 150ms ease',
                            fontWeight: currentView === 'pe-performa-invoice' ? '600' : '400', fontSize: '13px',
                          }}
                          onMouseEnter={(e) => { if (currentView !== 'pe-performa-invoice') e.currentTarget.style.backgroundColor = 'rgba(30, 58, 138, 0.04)'; }}
                          onMouseLeave={(e) => { if (currentView !== 'pe-performa-invoice') e.currentTarget.style.backgroundColor = 'transparent'; }}
                        >
                          <Stamp size={15} strokeWidth={currentView === 'pe-performa-invoice' ? 2.2 : 1.8} style={{ flexShrink: 0, opacity: currentView === 'pe-performa-invoice' ? 1 : 0.6 }} />
                          <span>Proforma Invoice</span>
                        </button>
                      )}
                    </div>
                  </div>
                );
              }

              // ─── REGULAR MENU ITEMS ───
              return (
                <button
                  key={item.id}
                  data-view={item.id}
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
            height: isMobile ? '54px' : '70px',
            backgroundColor: 'var(--card-background)',
            borderBottom: '1px solid var(--border-color)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: isMobile ? '0 12px' : '0 32px',
            boxShadow: 'var(--shadow-sm)',
            gap: isMobile ? 8 : 16,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 8 : 16, minWidth: 0, flex: 1 }}>
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
                    flexShrink: 0,
                  }}
                >
                  {isSidebarOpen ? <ChevronLeft size={20} /> : <Menu size={20} />}
                </button>
              )}

              {currentMenuItem && (
                <div style={{ minWidth: 0 }}>
                  <h1 style={{
                    fontSize: isMobile ? '15px' : '20px',
                    fontWeight: '700',
                    color: 'var(--enterprise-gray-900)',
                    margin: 0,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    lineHeight: isMobile ? 1.2 : undefined,
                  }}>
                    {currentMenuItem.label}
                  </h1>
                  {/* Subtitle hidden on mobile — too cramped, label says enough */}
                  {!isMobile && (
                    <p style={{
                      fontSize: '13px',
                      color: 'var(--enterprise-gray-500)',
                      margin: 0,
                    }}>
                      {currentMenuItem.description}
                    </p>
                  )}
                </div>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 4 : 12, flexShrink: 0 }}>
              {/* Notification Bell */}
              {user?.id && (
                <NotificationBell
                  userId={user.id}
                  onNavigate={(module) => {
                    setCurrentView(module as View);
                  }}
                />
              )}

              {/* Authenticated badge — hidden on mobile to free horizontal
                  space. The notification bell + lock icon already imply auth. */}
              {!isMobile && (
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
              )}
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
    </ErrorBoundary >
  );
}
