# Enterprise Architecture - Inventory Planning System

## 🏗️ Architecture Overview

This document outlines the production-ready architecture implemented by our Principal Engineering team.

---

## 📁 Project Structure

```
/
├── types/
│   └── index.ts                 # Centralized TypeScript type definitions
├── utils/
│   ├── api/
│   │   ├── client.ts           # Type-safe API client with error handling
│   │   └── services.ts         # Business logic layer / API services
│   └── supabase/
│       ├── client.tsx          # Singleton Supabase client
│       └── info.tsx            # Supabase configuration (protected)
├── hooks/
│   └── useDashboard.ts         # Custom React hook for dashboard data
├── components/
│   ├── ErrorBoundary.tsx       # Global error boundary
│   ├── DashboardNew.tsx        # Refactored dashboard component
│   └── ...                     # Other components
├── supabase/functions/server/
│   ├── index.tsx              # Backend API routes
│   └── kv_store.tsx           # KV storage utility (protected)
└── App.tsx                     # Main application entry point
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
- Custom hooks for data fetching (`useDashboard`)
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

### Custom Hooks (`/hooks/useDashboard.ts`)

**Features:**
- Encapsulated data fetching logic
- Loading/error states
- Automatic refetch
- Validated responses
- Graceful fallback

**Usage:**
```typescript
const { data, loading, error, refetch } = useDashboard(accessToken);
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

## 🚀 Performance Optimizations

1. **Memoization**: `useCallback` for stable function references
2. **Lazy Loading**: Components loaded on demand
3. **Debouncing**: Search/filter operations
4. **Caching**: Consider React Query for advanced caching
5. **Code Splitting**: Dynamic imports for large modules

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

**Last Updated**: January 2026
**Version**: 2.0 (Enterprise-Grade)
