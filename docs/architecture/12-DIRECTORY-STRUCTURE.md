# 12 — Directory Structure

> Full annotated project directory tree.

---

## 12.1 Root Directory

```
WarehouseManagementSystem/
│
├── 📄 index.html                         ← Vite entry HTML
├── 📄 package.json                       ← Dependencies & scripts
├── 📄 package-lock.json                  ← Dependency lock file
├── 📄 vite.config.ts                     ← Vite build configuration
├── 📄 tsconfig.json                      ← TypeScript configuration
├── 📄 tsconfig.node.json                 ← TypeScript config for Node.js
├── 📄 .gitignore                         ← Git exclusions
├── 📄 LICENSE                            ← Project license
├── 📄 README.md                          ← Project README
│
├── 📁 public/                            ← Static assets (served as-is)
│   └── 📄 logo.png                       ← Application logo
│
├── 📁 config/                            ← Configuration & migration scripts
│   ├── 📄 current-database-schema.sql    ← Compact schema reference
│   ├── 📄 migration_add_text_columns.sql ← Text column migration
│   └── 📄 migration_stock_movement_v2.sql← Stock movement v2 migration
│
├── 📁 .db_reference/                     ← Database reference schemas
│   ├── 📄 presentschema.sql              ← Full current schema (12KB)
│   ├── 📄 rbac.sql                       ← RBAC setup script (19KB)
│   ├── 📄 supabasesetup.sql              ← Initial DB setup (22KB)
│   └── 📄 003_add_employee_columns.sql   ← Employee columns migration
│
├── 📁 docs/                              ← Documentation
│   ├── 📄 architecture.md                ← Legacy architecture overview
│   ├── 📄 developer.md                   ← Developer guide
│   ├── 📁 architecture/                  ← ⭐ Architecture document suite
│   │   ├── 📄 00-ARCHITECTURE-INDEX.md
│   │   ├── 📄 01-SYSTEM-OVERVIEW.md
│   │   ├── 📄 02-LAYERED-ARCHITECTURE.md
│   │   ├── 📄 03-FRONTEND-ARCHITECTURE.md
│   │   ├── 📄 04-AUTHENTICATION-RBAC.md
│   │   ├── 📄 05-SERVICE-LAYER.md
│   │   ├── 📄 06-BACKEND-EDGE-FUNCTIONS.md
│   │   ├── 📄 07-DATABASE-ARCHITECTURE.md
│   │   ├── 📄 08-DATA-FLOW-DIAGRAMS.md
│   │   ├── 📄 09-MODULE-BREAKDOWN.md
│   │   ├── 📄 10-SECURITY-ARCHITECTURE.md
│   │   ├── 📄 11-DEPLOYMENT-ARCHITECTURE.md
│   │   └── 📄 12-DIRECTORY-STRUCTURE.md
│   └── 📁 readme/                        ← Module-specific READMEs (26 files)
│
└── 📁 src/                               ← Application source code
```

---

## 12.2 Source Directory (`src/`)

```
src/
│
├── 📄 main.tsx                           ← React root mount point
├── 📄 App.tsx                            ← Application shell (700 lines)
│                                            Auth, navigation, view routing
├── 📄 index.css                          ← Design system (43KB)
├── 📄 vite-env.d.ts                      ← Vite type declarations
│
├── 📁 auth/                              ← 🔐 Authentication & RBAC Module
│   ├── 📄 index.ts                       ← Barrel exports (centralised API)
│   ├── 📁 context/
│   │   └── 📄 AuthContext.tsx            ← React Context + useAuth hook
│   ├── 📁 services/
│   │   ├── 📄 authService.ts             ← Sign-in, sign-out, JWT, permissions
│   │   └── 📄 userService.ts             ← User CRUD (L3 only)
│   ├── 📁 components/
│   │   ├── 📄 ProtectedRoute.tsx         ← Role-based route guard
│   │   └── 📄 RoleBadge.tsx              ← Visual role indicator
│   ├── 📁 login/
│   │   └── 📄 LoginPage.tsx              ← Enterprise login page (19KB)
│   └── 📁 users/
│       └── 📄 UserManagement.tsx         ← Admin user management (78KB)
│
├── 📁 components/                        ← 📦 Feature Components
│   ├── 📄 DashboardNew.tsx               ← Dashboard with KPIs (16KB)
│   ├── 📄 ItemMasterSupabase.tsx         ← Item CRUD (80KB)
│   ├── 📄 InventoryGrid.tsx              ← Multi-warehouse grid (51KB)
│   ├── 📄 StockMovement.tsx              ← Movement ledger (132KB) ⭐ Largest
│   ├── 📄 BlanketOrders.tsx              ← Order management (25KB)
│   ├── 📄 BlanketReleases.tsx            ← Release tracking (23KB)
│   ├── 📄 ForecastingModule.tsx          ← Demand forecasting (19KB)
│   ├── 📄 PlanningModule.tsx             ← MRP planning (15KB)
│   ├── 📄 StockDistributionCard.tsx      ← Stock breakdown card (13KB)
│   ├── 📄 SampleDataInfo.tsx             ← Sample data banner (4KB)
│   ├── 📄 ErrorBoundary.tsx              ← Error boundary wrapper (3KB)
│   ├── 📄 LoadingPage.tsx                ← Branded loading screen (17KB)
│   ├── 📄 LoginPage.tsx                  ← Legacy login redirect (257B)
│   └── 📁 ui/                            ← 🎨 UI Primitives (50 files)
│       ├── 📄 EnterpriseUI.tsx           ← Enterprise layout shell
│       ├── 📄 RotatingQuote.tsx          ← Login page quotes
│       ├── 📄 utils.ts                   ← cn() class merge utility
│       ├── 📄 use-mobile.ts             ← Responsive hook
│       ├── 📄 button.tsx                 ← Button + variants
│       ├── 📄 dialog.tsx                 ← Modal dialog
│       ├── 📄 table.tsx                  ← Data table
│       ├── 📄 form.tsx                   ← Form controls
│       ├── 📄 select.tsx                 ← Select dropdown
│       ├── 📄 tabs.tsx                   ← Tab navigation
│       ├── 📄 card.tsx                   ← Card container
│       ├── 📄 badge.tsx                  ← Status badges
│       ├── 📄 chart.tsx                  ← Recharts wrapper
│       ├── 📄 sidebar.tsx               ← Navigation sidebar
│       ├── 📄 sonner.tsx                ← Toast provider
│       └── 📄 ... (35 more Radix-based primitives)
│
├── 📁 hooks/                             ← ⚡ Custom React Hooks
│   ├── 📄 useDashboard.ts               ← Dashboard data fetching
│   └── 📄 useInventory.ts               ← 8 inventory hooks (17KB)
│
├── 📁 services/                          ← 🔧 Business Services
│   └── 📄 inventoryService.ts            ← Multi-warehouse service (16KB)
│
├── 📁 types/                             ← 📋 TypeScript Type Definitions
│   ├── 📄 index.ts                       ← Domain + API types
│   └── 📄 inventory.ts                   ← Inventory-specific types
│
├── 📁 utils/                             ← 🛠️ Utility Functions
│   ├── 📁 api/
│   │   ├── 📄 client.ts                  ← Supabase client factory
│   │   ├── 📄 fetchWithAuth.ts           ← Authenticated fetch wrapper
│   │   ├── 📄 itemsSupabase.ts           ← Item Master API
│   │   └── 📄 services.ts               ← General API services
│   └── 📁 supabase/
│       ├── 📄 auth.ts                    ← Supabase auth helpers
│       ├── 📄 client.tsx                 ← Supabase client initialisation
│       └── 📄 info.tsx                   ← Project info constants
│
├── 📁 styles/                            ← 🎨 Additional Styles
│   └── 📄 globals.css                    ← Global style overrides
│
└── 📁 supabase/                          ← ☁️ Supabase Backend
    └── 📁 functions/
        └── 📁 server/                    ← Edge Function
            ├── 📄 index.tsx              ← Hono router entry (86KB)
            ├── 📁 services/              ← Backend services
            │   ├── 📄 ItemService.ts
            │   ├── 📄 InventoryService.ts
            │   ├── 📄 BlanketOrderService.ts
            │   ├── 📄 BlanketReleaseService.ts
            │   ├── 📄 ForecastingService.ts
            │   └── 📄 PlanningService.ts
            └── 📁 repositories/          ← Data access layer
                ├── 📄 ItemRepository.ts
                ├── 📄 InventoryRepository.ts
                └── 📄 BlanketOrderRepository.ts
```

---

## 12.3 File Size Distribution

| Category | Files | Total Size | Largest File |
|----------|-------|------------|--------------|
| Feature Components | 13 | ~420KB | `StockMovement.tsx` (132KB) |
| UI Primitives | 50 | ~120KB | `sidebar.tsx` (22KB) |
| Auth Module | 8 | ~135KB | `UserManagement.tsx` (78KB) |
| Hooks | 2 | ~22KB | `useInventory.ts` (17KB) |
| Services | 4 | ~50KB | `fetchWithAuth.ts` (23KB) |
| Backend Services | 6 | ~67KB | `PlanningService.ts` (16KB) |
| Backend Repos | 3 | ~19KB | `BlanketOrderRepository.ts` (8KB) |
| Types | 2 | ~14KB | `inventory.ts` (10KB) |
| Database Scripts | 7 | ~67KB | `supabasesetup.sql` (22KB) |
| Styles | 2 | ~44KB | `index.css` (43KB) |

---

## 12.4 Key Conventions

| Convention | Rule |
|-----------|------|
| **Component files** | PascalCase — `DashboardNew.tsx` |
| **Hook files** | camelCase with `use` prefix — `useDashboard.ts` |
| **Service files** | camelCase — `authService.ts` |
| **Type files** | camelCase — `index.ts`, `inventory.ts` |
| **UI primitives** | kebab-case — `alert-dialog.tsx` |
| **SQL files** | snake_case — `migration_stock_movement_v2.sql` |
| **Docs** | UPPER-KEBAB with number prefix — `01-SYSTEM-OVERVIEW.md` |

---

**← Previous**: [11-DEPLOYMENT-ARCHITECTURE.md](./11-DEPLOYMENT-ARCHITECTURE.md) | **Back to Index**: [00-ARCHITECTURE-INDEX.md](./00-ARCHITECTURE-INDEX.md)

---

© 2026 AutoCrat Engineers. All rights reserved.
