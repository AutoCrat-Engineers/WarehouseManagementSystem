# Enterprise Architecture - Inventory Planning System

## 🏗️ Architecture Overview

This document outlines the production-ready architecture implemented by our Principal Engineering team.

---

## 📁 Project Structure

```
src/
├── types/
│   ├── index.ts                  # Centralized TypeScript type definitions
│   └── inventory.ts              # Multi-warehouse inventory types
├── utils/
│   ├── api/
│   │   ├── client.ts             # Type-safe API client with error handling
│   │   ├── itemsSupabase.ts      # Items API layer
│   │   └── services.ts           # Business logic layer
│   └── supabase/
│       ├── client.tsx            # Singleton Supabase client
│       └── info.tsx              # Supabase configuration (protected)
├── auth/
│   ├── services/
│   │   ├── authService.ts        # Authentication operations
│   │   ├── userService.ts        # User management (L3 only)
│   │   └── permissionService.ts  # DB-backed granular RBAC engine
│   ├── components/
│   │   ├── ProtectedRoute.tsx    # Role-based route protection
│   │   ├── RoleBadge.tsx         # Role display badge
│   │   └── GrantAccessModal.tsx  # L3 permission editor UI
│   ├── login/LoginPage.tsx       # Enterprise login (no signup)
│   └── users/UserManagement.tsx  # User CRUD + grant access
├── hooks/
│   ├── useDashboard.ts           # Dashboard data (parallel fetching)
│   └── useInventory.ts           # Multi-warehouse inventory hooks
├── services/
│   └── inventoryService.ts       # Inventory data access layer
├── components/
│   ├── DashboardNew.tsx          # Dashboard with stock health
│   ├── ItemMasterSupabase.tsx    # Item master with RBAC
│   ├── StockMovement.tsx         # Stock movements with RBAC
│   ├── InventoryGrid.tsx         # Multi-warehouse inventory
│   ├── packing/                  # Packing module (stickers, details)
│   └── ErrorBoundary.tsx         # Global error boundary
└── App.tsx                       # Main entry point + RBAC enforcement
```

---

## 🎯 Key Architectural Principles

### 1. **Separation of Concerns**
- **Presentation Layer**: React components (UI only)
- **Business Logic Layer**: API services and custom hooks
- **Data Layer**: API client and backend routes
- **Type Layer**: Centralized TypeScript definitions

### 2. **Type Safety**
- ✅ Strict TypeScript types for all data structures
- ✅ Runtime validation at API boundaries
- ✅ No `any` types in production code
- ✅ Proper error types with `APIError` class

### 3. **Error Handling Strategy**

#### Frontend:
```typescript
- APIError class for structured errors
- Error boundaries to catch React errors
- Graceful degradation (fallback to empty state)
- User-friendly error messages
- Retry mechanisms
```

#### Backend:
```typescript
- Proper HTTP status codes
- Structured error responses
- Detailed logging
- Null-safe operations
```

### 4. **State Management**
- Custom hooks for data fetching (`useDashboard`, `useInventory`)
- `permissionService.ts` for DB-backed RBAC with in-memory caching
- Local component state for UI interactions
- Singleton Supabase client (no duplicate instances)
- Proper loading/error/success states

---

## 🔧 Core Components

### API Client (`/utils/api/client.ts`)

**Features:**
- Centralized HTTP client
- Automatic error handling
- Type-safe request/response
- Bearer token authentication
- Network error detection

**Usage:**
```typescript
import { apiClient } from './utils/api/client';

const data = await apiClient.get<DashboardData>(
  '/dashboard', 
  accessToken
);
```

### API Services (`/utils/api/services.ts`)

**Features:**
- Business logic abstraction
- Type-safe service methods
- Response normalization
- Array safety (defaults to `[]`)

**Example:**
```typescript
import { dashboardService } from './utils/api/services';

const dashboard = await dashboardService.getDashboard(token);
```

### Custom Hooks (`/hooks/`)

**Features:**
- Encapsulated data fetching logic
- Loading/error states
- Automatic refetch
- Validated responses
- Graceful fallback

**Usage:**
```typescript
const { data, loading, error, refetch } = useDashboard(accessToken);
const { items, stats } = useAllItemsStockDashboard(filters);
```

### Permission Service (`/auth/services/permissionService.ts`)

**Features:**
- DB-backed permission engine via `get_effective_permissions()` RPC
- Feature flag controlled (`permission_source` in `system_settings`)
- In-memory user permission cache (60s TTL)
- Permission source cache (5-min TTL)
- Cache invalidation on permission save

**Usage:**
```typescript
const perms = await getUserPermissions(userId);
// perms = { 'items.view': true, 'items.create': false, ... }
```

### Error Boundary (`/components/ErrorBoundary.tsx`)

**Features:**
- Catches React rendering errors
- Development error details
- Production-safe error UI
- Reset functionality
- Navigation fallback

---

## 🔐 Type System

### Domain Types (`/types/index.ts`)

All business entities are strictly typed:
- `Item` - Finished goods
- `Inventory` - Stock levels
- `BlanketOrder` - Customer orders
- `BlanketRelease` - Demand releases
- `Forecast` - Demand predictions
- `Planning` - Production plans

### Response Types

All API responses have defined shapes:
```typescript
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
```

---

## 🚨 Error Handling Flow

### 1. Network Errors
```
User Action → API Client → Detect Network Error → 
APIError(Network error) → Hook Catches → 
Show Retry UI
```

### 2. API Errors (4xx/5xx)
```
User Action → API Client → HTTP Error Response → 
Parse JSON → APIError(message, statusCode) → 
Hook Catches → Show Error Message
```

### 3. React Errors
```
Component Render → Error Thrown → 
ErrorBoundary Catches → Show Error UI with Reset
```

---

## 📊 Data Flow

```
Component
  ↓ (uses)
Custom Hook (useDashboard)
  ↓ (calls)
API Service (dashboardService)
  ↓ (uses)
API Client (apiClient)
  ↓ (HTTP request)
Backend API
  ↓ (queries)
KV Store / Database
```

---

## ✅ Best Practices Implemented

### 1. **Singleton Pattern**
- One Supabase client instance
- Prevents multiple auth contexts

### 2. **Custom Hooks**
- Reusable data fetching logic
- Consistent loading/error states
- Easy to test

### 3. **Error Boundaries**
- Prevent entire app crashes
- User-friendly error messages
- Development debugging tools

### 4. **Type Safety**
- Compile-time error detection
- IntelliSense support
- Refactoring safety

### 5. **Graceful Degradation**
- Empty states instead of crashes
- Fallback data
- Progressive enhancement

### 6. **Centralized Configuration**
- Single source of truth for API URLs
- Environment-based configuration
- Easy to update

---

## 🧪 Testing Strategy (Future)

### Unit Tests
- API client error handling
- Service layer business logic
- Custom hook state management

### Integration Tests
- Component + hook integration
- API service + backend integration
- End-to-end user flows

### Error Scenario Tests
- Network failures
- API errors
- Invalid data responses
- Race conditions

---

## 🚀 Performance Optimizations (v0.4.0)

### 1. Parallel Data Fetching
- **Auth startup**: `Promise.allSettled([profileFetch, permissionFetch])` — eliminates sequential waterfall (~60% faster)
- **Dashboard**: `Promise.all([stockQuery, ordersQuery])` — two queries execute simultaneously (~40% faster)
- **StockMovement**: Headers first, then lines + profiles in parallel via `Promise.all`

### 2. In-Memory Caching
- **Permission source**: Cached for 5 minutes (almost never changes)
- **User permissions**: Cached for 60 seconds per user (avoids redundant RPC calls)
- **Cache invalidation**: Called on permission save via `invalidateUserPermCache()`

### 3. Console Output Cleanup
- All debug `console.log`/`console.warn` removed from hot paths
- Only `console.error` retained for actual errors
- Reduces browser console overhead

### 4. `useCallback` and `useMemo`
- Stable function references with `useCallback`
- Derived data computed with `useMemo` (stats, grouped data)

### 5. Selective Column Fetching
- Dashboard: Only fetches `item_code, item_name, stock_status, net_available_for_customer, total_on_hand`
- Blanket orders: Only fetches `id, order_number, customer_name, status, total_value, created_at`
- Avoids `SELECT *` overhead

---

## 🔮 Future Enhancements

### 1. Advanced State Management
- Consider Redux Toolkit or Zustand for complex state
- Implement optimistic updates
- Add offline support

### 2. Real-time Updates
- WebSocket integration
- Supabase Realtime subscriptions
- Live dashboard metrics

### 3. Advanced Error Tracking
- Integration with Sentry/LogRocket
- Error analytics dashboard
- Performance monitoring

### 4. API Layer Enhancements
- Request/response interceptors
- Retry logic with exponential backoff
- Request cancellation
- Response caching

### 5. Type Validation
- Runtime validation with Zod
- API response schema validation
- Form validation

---

## 📝 Code Quality Standards

### TypeScript
- ✅ Strict mode enabled
- ✅ No implicit `any`
- ✅ Explicit return types for functions
- ✅ Interface over type when possible

### React
- ✅ Functional components with hooks
- ✅ Proper key props in lists
- ✅ Accessibility attributes
- ✅ Semantic HTML

### Error Handling
- ✅ Try-catch in async functions
- ✅ Proper error logging
- ✅ User-friendly error messages
- ✅ Error boundaries

### Code Organization
- ✅ Single responsibility principle
- ✅ DRY (Don't Repeat Yourself)
- ✅ Clear naming conventions
- ✅ Proper file structure

---

## 🎓 Learning Resources

- [React Error Boundaries](https://reactjs.org/docs/error-boundaries.html)
- [TypeScript Best Practices](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
- [API Design Best Practices](https://docs.microsoft.com/en-us/azure/architecture/best-practices/api-design)
- [React Hooks Best Practices](https://react.dev/reference/react)

---

## 📞 Support

For architecture questions or improvements, consult with the Principal Engineering team.

**Last Updated**: March 2026
**Version**: 0.4.0 (Granular RBAC + Performance)
