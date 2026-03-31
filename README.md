<p align="center">
  <img src="public/logo.png" alt="AutoCrat Engineers Logo" width="320" />
</p>

<h1 align="center">Warehouse Management System (WMS-AE)</h1>

<p align="center">
  <strong>Enterprise-Grade Inventory Planning, Forecasting & Warehouse Operations Platform</strong>
</p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/Version-0.5.0-blue?style=for-the-badge" alt="Version" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Status-Active_Development-brightgreen?style=for-the-badge" alt="Status" /></a>
  <a href="#"><img src="https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge" alt="License" /></a>
  <a href="#"><img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=white" alt="React" /></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Supabase-PostgreSQL-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" /></a>
</p>

---

## 📋 Table of Contents

- [About the Project](#-about-the-project)
- [Key Features](#-key-features)
- [Architecture](#-architecture)
- [Tech Stack](#-tech-stack)
- [Project Structure](#-project-structure)
- [Getting Started](#-getting-started)
- [Git Workflow](#-git-workflow)
- [Environment Variables](#-environment-variables)
- [Security & RBAC](#-security--rbac)
- [Database Schema](#-database-schema)
- [API Reference](#-api-reference)
- [Documentation](#-documentation)
- [Contributing](#-contributing)
- [Versioning](#-versioning)
- [Recent Changes](#-recent-changes)
- [Authors & Maintainers](#-authors--maintainers)
- [License & Copyright](#-license--copyright)

---

## 🏭 About the Project

### Problem Statement

Modern manufacturing warehouses face critical challenges with inventory accuracy, unplanned stockouts, and excessive overstocking. Manual tracking leads to data inconsistencies, whilst basic inventory systems lack the predictive capabilities needed for intelligent replenishment planning.

### Our Solution

The **Warehouse Management System (WMS)** is a type-safe, real-time application engineered to automate the entire stock lifecycle — from goods receipt and inward movements, through multi-warehouse distribution, to final dispatch and delivery. It features a built-in **Holt-Winters Triple Exponential Smoothing** forecasting engine for data-driven procurement decisions, a comprehensive **Packing Engine** with sticker generation, barcode traceability, palletization, container-level tracking and box-level stock transfer, a comprehensive audit trail for every stock movement, and a granular role-based access control system ensuring operational security.

> _Built by engineers, for engineers — designed to handle real-world manufacturing complexity at scale._

---

## 🚀 Key Features

| Module | Description |
| :--- | :--- |
| **📊 Enterprise Dashboard** | Real-time KPIs, critical stock alerts, stock distribution, and operational summaries for warehouse managers. |
| **📦 Item Master** | Centralised catalogue of Finished Goods (FG) with part numbers, descriptions, and master serial numbers. |
| **🏗️ Multi-Warehouse Inventory** | Real-time stock tracking across multiple warehouse types (S&V, Production, In Transit, Distribution) with status monitoring (Healthy, Warning, Critical, Overstock). |
| **🔄 Stock Movements** | Full ledger-based transaction system with movement types (Inward, Outward, Transfer, Adjustment), approval workflows, and printed slips. |
| **📦 Packing Module** | End-to-end FG packing workflow — sticker generation with QR-coded barcodes, packing details management, box management. |
| **⚙️ Packing Engine** | Advanced container management, pallet state machine with automatic fill detection and adjustment box handling, rack view. |
| **📋 Packing Details** | Packing specifications, dimensions, and weight templates for each FG part. |
| **🎯 Pallet Dashboard** | Visual pallet state tracking, completion monitoring, and management. |
| **📝 Contract Configs** | Customer-specific packing rules and configuration management. |
| **🚚 Dispatch Selection** | Dispatch readiness verification and Master Packing List creation. |
| **📄 Master Packing List** | MPL generation, print, and export for completed dispatches. |
| **🧾 Performa Invoice** | Shipment batching and stock dispatch management. |
| **🔍 Traceability** | Full backward trace for any container — from dispatch back to production receipt. |
| **📋 Blanket Orders** | Comprehensive handling of long-term customer contracts with order line items. |
| **📅 Blanket Releases** | Delivery scheduling against blanket orders with automatic inventory deduction upon delivery. |
| **📈 Demand Forecasting** | Advanced demand prediction using Holt-Winters algorithm with trend and seasonality analysis. |
| **🔧 MRP Planning** | Automated replenishment recommendations based on lead times, safety stock levels, and forecast data. |
| **👥 User Management** | Granular Role-Based Access Control (GRBAC) with L1 Operator, L2 Supervisor, L3 Manager tiers. |
| **🔔 Notifications** | Real-time notification bell with alerts for stock movements, approvals, and system events. |
| **🗄️ Rack View** | Visual warehouse rack layout for spatial stock organisation. |

---

## 🏗️ Architecture

The system follows a **clean, layered architecture** ensuring scalability, testability, and maintainability:

```
┌─────────────────────────────────────────────────────────────┐
│                   PRESENTATION LAYER                         │
│         React 18 + TypeScript + Enterprise Design System     │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐     │
│  │Dashboard │ │Item Mstr │ │Stock Mvt │ │  Packing   │     │
│  │          │ │          │ │          │ │  Engine    │     │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘     │
├───────┼─────────────┼────────────┼─────────────┼────────────┤
│                   BUSINESS LOGIC LAYER                       │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  Custom Hooks (useDashboard, useInventory)            │   │
│  │  Services (inventoryService, packingService,          │   │
│  │           packingEngineService, mplService)            │   │
│  └───────────────────────┬──────────────────────────────┘   │
├──────────────────────────┼──────────────────────────────────┤
│                   API / DATA LAYER                           │
│           Supabase (PostgreSQL) + PostgREST + Auth           │
│  ┌───────────────────────┴───────────────────────────┐      │
│  │  Tables: items · inventory · packing_requests     │      │
│  │  packing_boxes · pack_containers · pallets        │      │
│  │  packing_lists · invoices · warehouse_stock       │      │
│  │  stock_ledger · movement_headers · profiles       │      │
│  ├───────────────────────────────────────────────────┤      │
│  │  Functions: get_effective_permissions()            │      │
│  │  RLS Policies: Role-based row security            │      │
│  └───────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

For detailed architecture documentation, see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) and the [Architecture Series](docs/architecture/).

---

## 🛠️ Tech Stack

| Category | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React 18, TypeScript | UI framework with type safety |
| **Build Tool** | Vite 6 + SWC | Lightning-fast HMR and builds |
| **UI Components** | Radix UI Primitives | Accessible, unstyled component library |
| **Design System** | Custom Enterprise UI | Consistent visual language |
| **Icons** | Lucide React | Crisp, customisable icon set |
| **Charts** | Recharts | Composable charting library |
| **Forms** | React Hook Form | Performant form management |
| **Toasts** | Sonner | Non-intrusive notifications |
| **Backend / Database** | Supabase (PostgreSQL) | Managed database with real-time subscriptions |
| **Authentication** | Supabase Auth (JWT) | Secure session management |
| **State Management** | React Hooks + Context | Lightweight state handling |
| **Barcode / QR** | QRCode library | Sticker barcode printing for packing |
| **Deployment** | Docker, Nginx, GitHub Actions, AWS EC2 | CI/CD and hosting |

---

## 📁 Project Structure

```
WarehouseManagementSystem/
│
├── 📄 .gitignore                # Git ignore rules
├── 📄 README.md                 # This file
├── 📄 CHANGELOG.md              # Version history and release notes
├── 📄 RELEASE_NOTES.md          # Current release notes (v0.5.0)
├── 📄 LICENSE                   # Proprietary license
├── 📄 package.json              # Dependencies and scripts
├── 📄 tsconfig.json             # TypeScript configuration
├── 📄 tsconfig.node.json        # TypeScript config for Node.js
├── 📄 vite.config.ts            # Vite build configuration
├── 📄 index.html                # HTML entry point
│
├── 📁 config/                   # Database schemas & migrations
│   ├── current-database-schema.sql
│   ├── migration_add_text_columns.sql
│   └── migration_stock_movement_v2.sql
│
├── 📁 .db_reference/            # Database reference schemas & migrations
│   ├── presentschema.sql        # Current full schema reference
│   ├── rbac.sql                 # RBAC tables, roles, policies
│   ├── supabasesetup.sql        # Initial DB setup
│   ├── packing.sql              # Packing module schema
│   ├── packing_module_migration.sql
│   ├── packing_data_migration.sql
│   ├── packing_view.sql         # Packing detail views
│   ├── fix_profiles_rls.sql     # RLS policy fixes
│   ├── fix_supabase_lint_errors.sql
│   ├── fix_remaining_lint_warnings.sql
│   └── today.sql                # Latest consolidated SQL
│
├── 📁 docs/                     # Technical documentation
│   ├── ARCHITECTURE.md          # System architecture overview
│   ├── DATABASE_SCHEMA.md       # Complete schema reference
│   ├── MODULE_OVERVIEW.md       # Module catalog and dependency map
│   ├── DEPLOYMENT_GUIDE.md      # Deployment instructions
│   ├── CONTRIBUTING.md          # Code standards and PR process
│   ├── architecture/            # ⭐ Architecture series (12 files)
│   │   ├── 00-ARCHITECTURE-INDEX.md
│   │   ├── 01-SYSTEM-OVERVIEW.md
│   │   ├── ...
│   │   └── 12-DIRECTORY-STRUCTURE.md
│   ├── reference/               # Reference documentation
│   │   ├── rbac-database.md     # Granular RBAC system details
│   │   ├── troubleshooting.md   # Common issues and fixes
│   │   └── design-system.md     # UI design tokens
│   └── workflows/               # Workflow documentation
│       └── stock-movement.md    # Stock movement workflow
│
├── 📁 public/                   # Static assets
│   ├── logo.png
│   ├── a-logo.png
│   ├── backgroundlogin.png
│   └── data/quotes.json
│
└── 📁 src/                      # Application source code
    ├── 📄 App.tsx               # Root application component with routing + RBAC
    ├── 📄 main.tsx              # React entry point
    ├── 📄 index.css             # Global styles & design tokens
    │
    ├── 📁 auth/                 # Authentication & RBAC module
    │   ├── index.ts             # Auth barrel exports
    │   ├── components/          # Auth-specific UI components
    │   │   ├── ProtectedRoute.tsx
    │   │   ├── GrantAccessModal.tsx
    │   │   └── RoleBadge.tsx
    │   ├── context/             # Auth context provider
    │   │   └── AuthContext.tsx
    │   ├── login/               # Login page component
    │   │   └── LoginPage.tsx
    │   ├── services/            # Auth & permission services
    │   │   ├── authService.ts
    │   │   ├── userService.ts
    │   │   └── permissionService.ts
    │   └── users/               # User management module
    │       └── UserManagement.tsx
    │
    ├── 📁 components/           # Feature components
    │   ├── DashboardNew.tsx     # Enterprise dashboard
    │   ├── ItemMasterSupabase.tsx  # Item catalogue (Supabase)
    │   ├── InventoryGrid.tsx    # Multi-warehouse inventory grid
    │   ├── StockMovement.tsx    # Stock movement ledger
    │   ├── BlanketOrders.tsx    # Blanket order management
    │   ├── BlanketReleases.tsx  # Blanket release management
    │   ├── ForecastingModule.tsx # Demand forecasting engine
    │   ├── PlanningModule.tsx   # MRP planning module
    │   ├── StockDistributionCard.tsx # Stock breakdown card
    │   ├── ErrorBoundary.tsx    # Error boundary wrapper
    │   ├── LoadingPage.tsx      # Branded loading screen
    │   │
    │   ├── 📁 packing/         # 📦 FG Packing module
    │   │   ├── index.ts         # Barrel exports
    │   │   ├── PackingModule.tsx # Main packing workflow
    │   │   ├── PackingDetail.tsx # Single packing detail view
    │   │   ├── PackingDetails.tsx # Packing specifications manager
    │   │   ├── PackingList.tsx   # Packing list component
    │   │   ├── StickerPrint.tsx  # Sticker/QR barcode generation
    │   │   └── packingService.ts # Packing business logic
    │   │
    │   ├── 📁 packing-engine/  # ⚙️ Advanced Packing Engine
    │   │   ├── index.ts         # Barrel exports
    │   │   ├── PackingEngine.tsx # Container & pallet management
    │   │   ├── PalletDashboard.tsx # Pallet state tracking
    │   │   ├── ContractConfigManager.tsx # Customer packing rules
    │   │   ├── DispatchSelection.tsx # Dispatch readiness & MPL creation
    │   │   ├── PackingListManager.tsx # Master Packing List home
    │   │   ├── MasterPackingListHome.tsx # MPL generation & print
    │   │   ├── PerformaInvoice.tsx # Shipment batching
    │   │   ├── TraceabilityViewer.tsx # Full backward trace
    │   │   ├── RackView.tsx     # Visual rack layout
    │   │   └── packingEngineService.ts # Engine business logic
    │   │
    │   ├── 📁 notifications/   # 🔔 Notification system
    │   │   └── NotificationBell.tsx
    │   │
    │   └── 📁 ui/              # Reusable UI components (51 files)
    │       ├── EnterpriseUI.tsx # Core enterprise design system
    │       ├── SharedComponents.tsx # Shared reusable components
    │       ├── RotatingQuote.tsx # Login page quotes
    │       ├── use-mobile.ts    # Responsive hook
    │       ├── utils.ts         # cn() class merge utility
    │       ├── button.tsx, card.tsx, dialog.tsx, ...
    │       └── (46 more Radix-based primitives)
    │
    ├── 📁 hooks/                # Custom React hooks
    │   ├── useDashboard.ts      # Dashboard data fetching
    │   └── useInventory.ts      # Inventory operations
    │
    ├── 📁 services/             # Business logic services
    │   └── inventoryService.ts  # Inventory CRUD operations
    │
    ├── 📁 types/                # TypeScript type definitions
    │   ├── index.ts             # Core application types
    │   ├── inventory.ts         # Inventory-specific types
    │   └── packing.ts           # Packing module types
    │
    └── 📁 utils/                # Utility functions
        ├── api/                 # API client & fetch utilities
        │   ├── client.ts        # Supabase client factory
        │   ├── fetchWithAuth.ts # Authenticated fetch wrapper
        │   ├── itemsSupabase.ts # Item Master API
        │   └── services.ts      # General API services
        ├── auth.ts              # Shared auth helpers
        ├── auditLogger.ts       # Structured logging module
        ├── idGenerator.ts       # ID generation utilities
        ├── notifications/       # Notification utilities
        │   └── notificationService.ts
        └── supabase/            # Supabase client & auth helpers
            ├── auth.ts
            ├── client.tsx
            └── info.tsx
```

---

## 🏁 Getting Started

### Prerequisites

| Requirement | Version |
| :--- | :--- |
| **Node.js** | v18.0.0 or higher |
| **npm** | v9.0.0 or higher |
| **Git** | v2.30.0 or higher |
| **Supabase Account** | [supabase.com](https://supabase.com) |

### Installation

**1. Clone the repository:**

```bash
git clone https://github.com/AutoCrat-Engineers/WarehouseManagementSystem.git
cd WarehouseManagementSystem
```

**2. Install dependencies:**

```bash
npm ci
```

**3. Configure Supabase connection:**

Update `src/utils/supabase/info.tsx` with your Supabase project credentials:

```typescript
export const projectId = 'your-project-id';
export const publicAnonKey = 'your-anon-key';
```

**4. Run database migrations:**

Execute the migration scripts in order in the Supabase SQL Editor. Apply schemas from `config/` and `.db_reference/` as needed:

```
supabase/migrations/packing_engine/001_contract_configs.sql
supabase/migrations/packing_engine/002_containers.sql
...
supabase/migrations/packing_engine/013_performance_indexes.sql
```

**5. Start the development server:**

```bash
npm run dev
```

The application will be available at **http://localhost:3000**.

### Available Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start development server with HMR |
| `npm run build` | Create production build in `build/` |

---

## 🔀 Git Workflow

This project follows a **Git Feature Branch Workflow** with the following branch strategy:

### Branch Structure

| Branch | Purpose | Protected |
| :--- | :--- | :--- |
| `main` | Production-ready code. Stable releases only. | ✅ Yes |
| `develop-stable` | Pre-production staging branch. | ✅ Yes |
| `develop-test` | Integration testing branch. | ✅ Yes |
| `feature/*` | Feature development branches. | ❌ No |

### Pull Latest Changes (Git Pull)

Always pull the latest changes before starting new work:

```bash
# Switch to the target branch
git checkout develop-test

# Pull latest changes from remote
git pull origin develop-test
```

To pull changes into your current feature branch:

```bash
# Ensure you're on your feature branch
git checkout feature/your-feature-name

# Pull and rebase from develop-test
git pull origin develop-test --rebase
```

### Push Your Changes (Git Push)

After making changes, follow this workflow:

```bash
# 1. Stage your changes
git add .

# 2. Commit with a descriptive message (follow conventional commits)
git commit -m "feat(module): brief description of the change"

# 3. Push to your feature branch
git push origin feature/your-feature-name
```

Then create a **Pull Request** on GitHub to merge into `develop-test`.

### Commit Message Convention

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```
<type>(<scope>): <description>

# Examples:
feat(stock-movement): add print slip functionality
feat(packing): implement sticker barcode generation
fix(dashboard): resolve loading state race condition
refactor(auth): consolidate authentication services
docs(readme): update installation instructions
chore(deps): upgrade React to v18.3.1
```

| Type | When to Use |
| :--- | :--- |
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructuring (no behaviour change) |
| `docs` | Documentation updates |
| `chore` | Maintenance tasks (dependencies, configs) |
| `style` | Formatting changes (no logic change) |
| `perf` | Performance improvements |

---

## 🔐 Environment Variables

| Variable | Required | Description |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | ✅ | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | ✅ | Your Supabase anonymous/public key |

> ⚠️ **Never commit `.env` files or service role keys to version control.** The `.gitignore` is configured to exclude all environment files. The application uses the public anon key with Row Level Security (RLS) for all operations.

---

## 🛡️ Security & RBAC

### Authentication

- **JWT-based authentication** via Supabase Auth
- Secure session management with automatic token refresh
- Protected routes and API calls

### Granular Role-Based Access Control (GRBAC)

| Role | Level | Permissions |
| :--- | :--- | :--- |
| **Operator** | L1 | View data, create stock movements |
| **Supervisor** | L2 | L1 + approve/reject movements, edit items, manage packing |
| **Manager** | L3 | L2 + user management, full system administration, grant/revoke granular permissions |

### Security Best Practices

- ✅ End-to-end TypeScript for type safety
- ✅ Database-level constraints and triggers
- ✅ Row Level Security (RLS) on Supabase tables
- ✅ JWT validation on all API calls
- ✅ Granular per-user permission overrides
- ✅ Input sanitisation and validation
- ✅ No hardcoded secrets in source code
- ✅ Mutable search path fixes applied to all database functions

For detailed RBAC documentation, see [`docs/reference/rbac-database.md`](docs/reference/rbac-database.md).

---

## 🗄️ Database Schema

The system uses a relational PostgreSQL schema with the following core tables:

| Table | Description |
| :--- | :--- |
| `items` | Finished goods master catalogue |
| `inventory` | Multi-warehouse stock levels |
| `stock_movements` | Complete transaction audit trail |
| `blanket_orders` | Long-term customer order contracts |
| `blanket_releases` | Scheduled deliveries against orders |
| `profiles` | User profiles with roles and status |
| `packing_requests` | FG packing workflow requests |
| `packing_boxes` | Individual box records with PKG IDs |
| `pack_containers` | Container-level tracking |
| `pallets` | Pallet state machine records |
| `packing_lists` | Master packing list records |
| `invoices` | Invoice & proforma records |
| `packing_audit_log` | Packing operation audit trail |
| `packing_details` | Packing dimension/specification templates |
| `contract_configs` | Customer-specific packing configurations |
| `user_permissions` | Granular RBAC permission overrides |

Database migrations are stored in `config/`, `.db_reference/`, and `supabase/migrations/`.
Full schema documentation is available at [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md).

---

## 📡 API Reference

The backend API is powered by **Supabase PostgREST** with direct client-side access via the Supabase JS SDK.

### Architecture Pattern

```
React Component → Service Layer → Supabase Client → PostgreSQL (with RLS)
```

### Key Operations

| Operation | Service | Description |
| :--- | :--- | :--- |
| Item CRUD | `itemsSupabase.ts` | Fetch, create, update, delete items |
| Inventory Queries | `inventoryService.ts` | Multi-warehouse stock data |
| Stock Movements | `StockMovement.tsx` | Ledger-based transactions |
| Packing Workflow | `packingService.ts` | Sticker generation, box management |
| Container/Pallet Ops | `packingEngineService.ts` | Container creation, pallet state machine |
| MPL Generation | `PackingListManager.tsx` | Master packing list creation |
| Auth & Permissions | `authService.ts` | JWT auth, role resolution |

---

## 📚 Documentation

| Document | Description |
| :--- | :--- |
| [Architecture](docs/ARCHITECTURE.md) | System architecture with diagrams |
| [Architecture Series](docs/architecture/) | 12-part detailed architecture deep-dive |
| [Database Schema](docs/DATABASE_SCHEMA.md) | Complete schema reference |
| [Module Overview](docs/MODULE_OVERVIEW.md) | Module catalog and dependency map |
| [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) | Deployment instructions |
| [Contributing](docs/CONTRIBUTING.md) | Code standards and PR process |
| [RBAC Reference](docs/reference/rbac-database.md) | Granular RBAC system details |
| [Troubleshooting](docs/reference/troubleshooting.md) | Common issues and fixes |
| [Design System](docs/reference/design-system.md) | UI design tokens |
| [Stock Movement](docs/workflows/stock-movement.md) | Stock movement workflow |

---

## 🤝 Contributing

We follow the **GitHub Flow** model. All changes must go through Pull Requests.

### Workflow

1. **Create a feature branch** from `develop-test`:
   ```bash
   git checkout develop-test
   git pull origin develop-test
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** with clean, atomic commits.

3. **Push your branch** and create a Pull Request:
   ```bash
   git push origin feature/your-feature-name
   ```

4. **Request a code review** from at least one team member.

5. **Merge** after approval — squash merge is preferred for clean history.

### Code Standards

- ✅ TypeScript strict typing for all new code
- ✅ Component files use PascalCase (e.g., `StockMovement.tsx`)
- ✅ Hooks prefixed with `use` (e.g., `useDashboard.ts`)
- ✅ Services use camelCase (e.g., `inventoryService.ts`)
- ✅ Use the Enterprise Design System components for UI consistency
- ✅ No `console.log` in production code (use proper error handling)
- ✅ Meaningful commit messages following Conventional Commits
- ✅ All new modules must implement GRBAC (see [workflow](/.agents/workflows/add-new-module.md))

See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) for full contribution guidelines.

---

## 🏷️ Versioning

This project uses [Semantic Versioning](https://semver.org/):

```
MAJOR.MINOR.PATCH
```

| Version Part | When to Increment |
| :--- | :--- |
| **MAJOR** | Breaking changes or major architecture overhaul |
| **MINOR** | New features, backwards-compatible |
| **PATCH** | Bug fixes and minor improvements |

**Current Version:** `v0.5.0`

### Version History

| Version | Date | Type | Highlights |
| :--- | :--- | :--- | :--- |
| **0.5.0** | 2026-03-31 | Minor | Codebase cleanup, dependency audit, documentation overhaul, PDF microservice |
| 0.4.2 | 2026-03-30 | Patch | Server-side filtering, backend aggregates, pagination fixes |
| 0.4.1 | 2026-03-06 | Patch | Performance optimization, documentation overhaul, structured logging |
| 0.4.0 | 2026-03-05 | Minor | Master Packing List, Performa Invoice, Traceability |
| 0.3.2 | 2026-02-25 | Patch | RBAC refinements, version management |
| 0.3.0 | 2026-02-23 | Minor | Granular RBAC, Supabase security hardening |
| 0.2.0 | 2026-02-15 | Minor | Packing Engine v2, pallets, containers |
| 0.1.0 | 2026-01-20 | Initial | Core WMS with inventory, movements, orders |

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

---

## 🔄 Recent Changes

### v0.5.0 — Codebase Cleanup & Documentation (2026-03-31)

This release focuses on enterprise-grade code quality improvements with **zero business logic changes**:

#### Dependency Audit
- Removed **6 unused npm packages** (`hono`, `canvas`, `html2canvas`, `jspdf`, `jsbarcode`, `puppeteer`) — none were imported in `src/`
- Fixed package name from "Build Inventory Forecasting System" to "warehouse-management-system"

#### Dead Code & Artifact Cleanup
- Deleted 5 debug text files (`git_log_output.txt`, `git_status_output.txt`, `tsc_output.txt`, `log.txt`, `log2.txt`)
- Cleaned 63 lines of commented-out mock data from `SampleDataInfo.tsx`
- Consolidated duplicate `db_schema.sql` (60KB) into `.db_reference/`

#### .gitignore Optimization
- Added 8 new exclusion patterns for debug outputs, temporary files, and diagnostic artifacts

#### Documentation
- Created `RELEASE_NOTES.md` from analysis of 81 commits and 40+ PRs
- Updated `CHANGELOG.md` with structured v0.5.0 entry
- Updated architecture documentation to reflect PDF microservice extraction

### v0.4.2 — Critical Bugfixes (2026-03-30)

- Migrated Stock Movement, Sticker Generation, and Proforma Invoice to server-side filtering
- Fixed summary card counts using independent backend HEAD queries
- Standardized pagination + filter ordering across all modules
- Added page reset on filter change to prevent stale results

See [CHANGELOG.md](CHANGELOG.md) and [RELEASE_NOTES.md](RELEASE_NOTES.md) for complete details.

---

## 👥 Authors & Maintainers

<table>
  <tr>
    <td align="center"><strong>AutoCrat Engineers</strong></td>
  </tr>
  <tr>
    <td align="center">Engineering & Product Team</td>
  </tr>
</table>

**Organisation:** AutoCrat Engineers
**Repository:** [github.com/AutoCrat-Engineers/WarehouseManagementSystem](https://github.com/AutoCrat-Engineers/WarehouseManagementSystem)

---

## 📄 License & Copyright

```
Copyright (c) 2025-2026 AutoCrat Engineers. All Rights Reserved.

PROPRIETARY & CONFIDENTIAL

This software and its source code are the exclusive property of AutoCrat Engineers.
Unauthorised copying, distribution, modification, or use of this software,
in whole or in part, is strictly prohibited without prior written consent
from AutoCrat Engineers.

This software is provided "AS IS" without warranty of any kind, express or
implied. AutoCrat Engineers shall not be held liable for any damages arising
from the use of this software.

For licensing enquiries, contact the engineering team at AutoCrat Engineers.
```

---

<p align="center">
  <sub>Built with ❤️ by <strong>AutoCrat Engineers</strong> · © 2025-2026 · All Rights Reserved</sub>
</p>
