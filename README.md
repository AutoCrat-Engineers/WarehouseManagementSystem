<p align="center">
  <img src="public/logo.png" alt="AutoCrat Engineers Logo" width="320" />
</p>

<h1 align="center">Warehouse Management System (WMS-AE)</h1>

<p align="center">
  <strong>Enterprise-Grade Inventory Planning, Forecasting & Warehouse Operations Platform</strong>
</p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/Version-0.5.6-blue?style=for-the-badge" alt="Version" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Status-Active_Development-brightgreen?style=for-the-badge" alt="Status" /></a>
  <a href="#"><img src="https://img.shields.io/badge/License-Proprietary-red?style=for-the-badge" alt="License" /></a>
  <a href="#"><img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=white" alt="React" /></a>
  <a href="#"><img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="#"><img src="https://img.shields.io/badge/Supabase-PostgreSQL-3FCF8E?style=for-the-badge&logo=supabase&logoColor=white" alt="Supabase" /></a>
</p>

---

## Table of Contents

- [About the Project](#about-the-project)
- [Key Features](#key-features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Git Workflow](#git-workflow)
- [Environment Variables](#environment-variables)
- [Security & RBAC](#security--rbac)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [Versioning](#versioning)
- [Recent Changes](#recent-changes)
- [Authors & Maintainers](#authors--maintainers)
- [License & Copyright](#license--copyright)

---

## About the Project

### Problem Statement

Modern manufacturing warehouses face critical challenges with inventory accuracy, unplanned stockouts, and excessive overstocking. Manual tracking leads to data inconsistencies, whilst basic inventory systems lack the predictive capabilities needed for intelligent replenishment planning.

### Our Solution

The **Warehouse Management System (WMS)** is a type-safe, real-time application engineered to automate the entire stock lifecycle — from goods receipt and inward movements, through multi-warehouse distribution, to final dispatch and delivery. It features a built-in **Holt-Winters Triple Exponential Smoothing** forecasting engine for data-driven procurement decisions, a comprehensive **Packing Engine** with sticker generation, barcode traceability, palletization, container-level tracking and box-level stock transfer, a comprehensive audit trail for every stock movement, and a granular role-based access control system ensuring operational security.

> _Built by engineers, for engineers — designed to handle real-world manufacturing complexity at scale._

---

## Key Features

| Module | Description |
| :--- | :--- |
| **Enterprise Dashboard** | Real-time KPIs, critical stock alerts, stock distribution, and operational summaries for warehouse managers. |
| **Item Master** | Centralised catalogue of Finished Goods (FG) with part numbers, descriptions, and master serial numbers. |
| **Multi-Warehouse Inventory** | Real-time stock tracking across multiple warehouse types (Production, In Transit, Distribution) with status monitoring (Healthy, Warning, Critical, Overstock). |
| **Stock Movements** | Full ledger-based transaction system with movement types (Inward, Outward, Transfer, Adjustment), approval workflows, and printed slips. Backed by dedicated `sm_*` Supabase Edge Functions for server-side validation and audit. |
| **Packing Module** | End-to-end FG packing workflow — sticker generation with QR-coded barcodes, packing details management, box management. |
| **Packing Engine** | Advanced container management, pallet state machine with automatic fill detection and adjustment box handling, rack view. |
| **Packing Details** | Packing specifications, dimensions, and weight templates for each FG part. |
| **Pallet Dashboard** | Visual pallet state tracking, completion monitoring, and management. |
| **Contract Configs** | Customer-specific packing rules and configuration management. |
| **Dispatch Selection** | Dispatch readiness verification and Master Packing List creation. |
| **Master Packing List** | MPL generation, print, and export for completed dispatches. |
| **Performa Invoice** | Shipment batching and stock dispatch management. |
| **Traceability** | Full backward trace for any container — from dispatch back to production receipt. |
| **Customer Agreements (BPA)** | Long-term blanket purchase agreements with multi-part lines, fulfillment dashboard, and amendment history. Supports SPOT, BPA, Informal-Borrow, and Synthesized scenarios. |
| **Blanket Orders** | Operational mirror of customer agreements with running totals (released / delivered / in-rack quantity per line). |
| **Blanket Releases** | Customer-PO release scheduling against an agreement with FIFO pallet selection and need-by-date prioritisation. |
| **Intelligent Pallet Allocation** | Subset-sum matcher (added 0.5.6) auto-fits whole pallets to a customer's requested quantity exactly, or proposes the closest options above/below with auto-generated customer amendment artefacts. Whole-pallet only · FIFO-biased · client-side. |
| **Release Allocation Holds** | Per-release pallet locks with `ALLOCATED` (earliest need-by wins) vs `RESERVED` (queued) buckets. Stock decrements only on delivery. |
| **Inbound Receiving / Goods Receipt** | Per-MPL goods receipt with discrepancy tracking (missing / damaged / short / quality hold) and rack placement. |
| **Rack Storage** | Visual rack-cell view at the 3PL warehouse with pallet back-chain (release → sub-invoice → MPL → invoice → BPA). |
| **Sub-Invoices & Tariff Invoices** | Customer billing per release with tariff-claim queue (DRAFT → SUBMITTED → CLAIMED → PAID). |
| **Demand Forecasting** | Advanced demand prediction using Holt-Winters algorithm with trend and seasonality analysis. |
| **MRP Planning** | Automated replenishment recommendations based on lead times, safety stock levels, and forecast data. |
| **User Management** | Granular Role-Based Access Control (GRBAC) with L1 Operator, L2 Supervisor, L3 Manager tiers. |
| **Notifications** | Real-time notification bell with alerts for stock movements, approvals, and system events. |
| **Rack View** | Visual warehouse rack layout for spatial stock organisation. |

---

## Architecture

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
│  │  Supabase Edge Functions (sm_* for Stock Movement)    │   │
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

## Tech Stack

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
| **Edge Functions** | Supabase Edge Functions (Deno) | Server-side business logic for stock movement workflows |
| **Authentication** | Supabase Auth (JWT) | Secure session management |
| **State Management** | React Hooks + Context | Lightweight state handling |
| **Barcode / QR** | QRCode library | Sticker barcode printing for packing |
| **Deployment** | Docker, Nginx, GitHub Actions, AWS EC2 | CI/CD and hosting |

---

## Project Structure

```
WarehouseManagementSystem/
│
├── .gitignore                   # Git ignore rules
├── README.md                    # This file
├── CHANGELOG.md                 # Version history and release notes
├── RELEASE_NOTES.md             # Current release notes
├── LICENSE                      # Proprietary license
├── package.json                 # Dependencies and scripts
├── tsconfig.json                # TypeScript configuration
├── tsconfig.node.json           # TypeScript config for Node.js
├── vite.config.ts               # Vite build configuration
├── index.html                   # HTML entry point
│
├── .db_reference/               # Database reference schemas & migrations (git-ignored)
│   ├── db_schema.sql            # Full consolidated DB schema
│   ├── current-database-schema.sql  # Current schema snapshot
│   ├── rbac.sql                 # RBAC tables, roles, policies
│   ├── supabasesetup.sql        # Initial DB setup
│   ├── packing.sql              # Packing module schema
│   ├── packing_module_migration.sql
│   ├── packing_data_migration.sql
│   ├── packing_view.sql         # Packing detail views
│   ├── migration_add_text_columns.sql  # Applied migration
│   ├── migration_stock_movement_v2.sql # Applied migration
│   ├── fix_profiles_rls.sql     # RLS policy fixes
│   ├── fix_supabase_lint_errors.sql
│   ├── fix_remaining_lint_warnings.sql
│   └── migrations/              # GRBAC migration scripts (001–009)
│
├── .github/                     # GitHub configuration
│   └── CODEOWNERS               # Path-to-team review ownership
│
├── docs/                        # Technical documentation
│   ├── ARCHITECTURE.md          # System architecture overview
│   ├── DATABASE_SCHEMA.md       # Complete schema reference
│   ├── MODULE_OVERVIEW.md       # Module catalog and dependency map
│   ├── DEPLOYMENT_GUIDE.md      # Deployment instructions
│   ├── CONTRIBUTING.md          # Code standards and PR process
│   ├── architecture/            # Architecture series (12 files)
│   │   ├── 00-ARCHITECTURE-INDEX.md
│   │   ├── 01-SYSTEM-OVERVIEW.md
│   │   ├── ...
│   │   └── 12-DIRECTORY-STRUCTURE.md
│   ├── adr/                     # Architecture Decision Records (MADR)
│   │   ├── README.md
│   │   ├── 0000-template.md
│   │   └── 0001-edge-function-sm-prefix-and-jwt-auth.md
│   ├── releases/                # Per-version release notes
│   │   ├── CHANGES_0.5.3.md
│   │   ├── CHANGES_0.5.4.md
│   │   ├── CHANGES_0.5.5.md
│   │   ├── CHANGES_0.5.6.md
│   │   ├── RELEASE_0.5.5.md
│   │   ├── RELEASE_0.5.6.md
│   │   ├── IMPLEMENTATION_0.5.4_TO_0.5.5.md
│   │   └── IMPLEMENTATION_0.5.5_TO_0.5.6.md
│   ├── reference/               # Reference documentation
│   │   ├── rbac-database.md     # Granular RBAC system details
│   │   ├── troubleshooting.md   # Common issues and fixes
│   │   └── design-system.md     # UI design tokens
│   └── workflows/               # Workflow documentation
│       └── stock-movement.md    # Stock movement workflow
│
├── public/                      # Static assets
│   ├── logo.png
│   ├── a-logo.png
│   ├── backgroundlogin.png
│   └── data/quotes.json
│
├── scripts/                     # Developer scripts
│   └── dev/                     # Local-only dev scripts (git-ignored)
│       └── README.md
│
├── supabase/                    # Supabase project assets
│   └── functions/               # Edge Functions (Deno)
│       ├── README.md            # Master function index
│       ├── .env.example         # Environment template
│       ├── _shared/             # cors.ts, palletImpact.ts
│       ├── get-user-profile/    # Shared user profile lookup
│       ├── sm_approve-movement/
│       ├── sm_calculate-pallet-impact/
│       ├── sm_get-item-stock/
│       ├── sm_get-movement-counts/
│       ├── sm_get-movement-review-data/
│       ├── sm_get-movements/
│       ├── sm_get-reason-codes/
│       ├── sm_search-items/
│       └── sm_submit-movement-request/
│
└── src/                         # Application source code
    ├── App.tsx                  # Root application component with routing + RBAC
    ├── main.tsx                 # React entry point
    ├── index.css                # Global styles & design tokens
    │
    ├── auth/                    # Authentication & RBAC module
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
    ├── components/              # Feature components
    │   ├── DashboardNew.tsx     # Enterprise dashboard
    │   ├── ItemMasterSupabase.tsx  # Item catalogue (Supabase)
    │   ├── InventoryGrid.tsx    # Multi-warehouse inventory grid
    │   ├── StockMovement.tsx    # Stock movement ledger (calls sm_* edge functions)
    │   ├── BlanketOrders.tsx    # Blanket order management
    │   ├── BlanketReleases.tsx  # Blanket release management
    │   ├── ForecastingModule.tsx # Demand forecasting engine
    │   ├── PlanningModule.tsx   # MRP planning module
    │   ├── StockDistributionCard.tsx # Stock breakdown card
    │   ├── ErrorBoundary.tsx    # Error boundary wrapper
    │   ├── LoadingPage.tsx      # Branded loading screen
    │   │
    │   ├── packing/             # FG Packing module
    │   │   ├── index.ts         # Barrel exports
    │   │   ├── PackingModule.tsx # Main packing workflow
    │   │   ├── PackingDetail.tsx # Single packing detail view
    │   │   ├── PackingDetails.tsx # Packing specifications manager
    │   │   ├── PackingList.tsx   # Packing list component
    │   │   ├── StickerPrint.tsx  # Sticker/QR barcode generation
    │   │   └── packingService.ts # Packing business logic
    │   │
    │   ├── packing-engine/      # Advanced Packing Engine
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
    │   ├── notifications/       # Notification system
    │   │   └── NotificationBell.tsx
    │   │
    │   └── ui/                  # Reusable UI components (51 files)
    │       ├── EnterpriseUI.tsx # Core enterprise design system
    │       ├── SharedComponents.tsx # Shared reusable components
    │       ├── RotatingQuote.tsx # Login page quotes
    │       ├── use-mobile.ts    # Responsive hook
    │       ├── utils.ts         # cn() class merge utility
    │       ├── button.tsx, card.tsx, dialog.tsx, ...
    │       └── (46 more Radix-based primitives)
    │
    ├── hooks/                   # Custom React hooks
    │   ├── useDashboard.ts      # Dashboard data fetching
    │   └── useInventory.ts      # Inventory operations
    │
    ├── services/                # Business logic services
    │   ├── inventoryService.ts  # Inventory CRUD operations
    │   ├── pdfServiceClient.ts  # PDF microservice HTTP client (circuit breaker, retry)
    │   └── sessionService.ts    # Session management
    │
    ├── types/                   # TypeScript type definitions
    │   ├── index.ts             # Core application types
    │   ├── inventory.ts         # Inventory-specific types
    │   └── packing.ts           # Packing module types
    │
    └── utils/                   # Utility functions
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

## Getting Started

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

**3. Configure environment variables:**

Create a `.env` file in the project root:

```bash
# Supabase Configuration (required)
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key

# PDF Service (optional — only for local development with direct Azure access)
VITE_PDF_SERVICE_URL=https://your-pdf-service.azurecontainerapps.io
VITE_PDF_SERVICE_API_KEY=your-pdf-api-key
```

> If no `.env` is provided, the app falls back to hardcoded defaults in `src/utils/supabase/info.tsx`.

**4. Run database migrations:**

Execute the migration scripts in order in the Supabase SQL Editor. Apply schemas from `.db_reference/` as needed:

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

## Git Workflow

This project follows a **Git Feature Branch Workflow** with the following branch strategy:

### Branch Structure

| Branch | Purpose | Protected |
| :--- | :--- | :--- |
| `main` | Production-ready code. Stable releases only. | Yes |
| `deploy/pre-prod` | Deployment branch. Application code + Docker, Nginx, CI/CD configs. | Yes |
| `develop-test` | Active development. Pure application source code only — no deployment artifacts. | Yes |
| `feature/*` | Feature development branches. | No |

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

## Environment Variables

| Variable | Required | Description |
| :--- | :--- | :--- |
| `VITE_SUPABASE_URL` | Yes | Your Supabase project URL (e.g., `https://xyz.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Yes | Your Supabase anonymous/public key (`sb_publishable_*` format for new projects) |
| `VITE_PDF_SERVICE_URL` | No | PDF microservice URL (empty in production — nginx proxies same-origin) |
| `VITE_PDF_SERVICE_API_KEY` | No | PDF service API key (empty in production — nginx injects server-side) |

### Edge Function Secrets (Supabase-side, set via `supabase secrets set`)

| Variable | Required | Description |
| :--- | :--- | :--- |
| `PUBLISHABLE_KEY` | Yes | Publishable anon key used inside edge functions for `auth.getUser()` JWT validation. Must match the project's current `sb_publishable_*` key. Supabase reserves the `SUPABASE_*` prefix, so a custom name is required. |

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_DB_URL` are auto-injected into every edge function at runtime.

> **Never commit `.env` files or service role keys to version control.** The `.gitignore` is configured to exclude all environment files. The application uses the public anon key with Row Level Security (RLS) for all operations.

---

## Security & RBAC

### Authentication

- **JWT-based authentication** via Supabase Auth
- Secure session management with automatic token refresh
- Protected routes and API calls
- Edge functions validate JWTs server-side via `auth.getUser(jwt)` using the custom `PUBLISHABLE_KEY` secret (ES256 asymmetric keys)

### Granular Role-Based Access Control (GRBAC)

| Role | Level | Permissions |
| :--- | :--- | :--- |
| **Operator** | L1 | View data, create stock movements |
| **Supervisor** | L2 | L1 + approve/reject movements, edit items, manage packing |
| **Manager** | L3 | L2 + user management, full system administration, grant/revoke granular permissions |

### Security Best Practices

- End-to-end TypeScript for type safety
- Database-level constraints and triggers
- Row Level Security (RLS) on Supabase tables
- JWT validation on all API calls
- Granular per-user permission overrides
- Input sanitisation and validation
- No hardcoded secrets in source code
- Mutable search path fixes applied to all database functions

For detailed RBAC documentation, see [`docs/reference/rbac-database.md`](docs/reference/rbac-database.md).

---

## Database Schema

The system uses a relational PostgreSQL schema with the following core tables:

| Table | Description |
| :--- | :--- |
| `items` | Finished goods master catalogue |
| `inventory` | Multi-warehouse stock levels |
| `stock_movements` | Complete transaction audit trail |
| `customer_agreements` / `customer_agreement_parts` | BPA headers + per-part lines (with revisions) |
| `blanket_orders` / `blanket_order_line_configs` | Operational mirror with running totals (released, delivered, in-rack) |
| `blanket_releases` | Customer-PO releases against an agreement |
| `release_pallet_holds` | Per-release pallet locks (`ALLOCATED` / `RESERVED`) |
| `release_pallet_assignments` | Resolved pallet → release mapping |
| `pack_sub_invoices` / `pack_sub_invoice_lines` | Customer billing per release |
| `tariff_invoices` | Tariff-claim queue (`DRAFT → SUBMITTED → CLAIMED → PAID`) |
| `goods_receipts` / `goods_receipt_lines` | Per-MPL inbound receiving with rack placement |
| `warehouse_rack_locations` | Physical rack-cell occupancy at the 3PL |
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

Database migrations are stored in `.db_reference/` and `supabase/migrations/`.
Full schema documentation is available at [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md).

---

## API Reference

The backend API is powered by **Supabase PostgREST** with direct client-side access via the Supabase JS SDK, plus **Supabase Edge Functions** for business-logic-heavy workflows.

### Architecture Pattern

```
React Component → Service Layer → Supabase Client / Edge Function → PostgreSQL (with RLS)
```

### Key Operations

| Operation | Service / Function | Description |
| :--- | :--- | :--- |
| Item CRUD | `itemsSupabase.ts` | Fetch, create, update, delete items |
| Inventory Queries | `inventoryService.ts` | Multi-warehouse stock data |
| Stock Movements | `sm_*` edge functions | Server-side validated movement workflows |
| User Profile | `get-user-profile` edge function | Authenticated profile lookup |
| Packing Workflow | `packingService.ts` | Sticker generation, box management |
| Container/Pallet Ops | `packingEngineService.ts` | Container creation, pallet state machine |
| MPL Generation | `PackingListManager.tsx` | Master packing list creation |
| Auth & Permissions | `authService.ts` | JWT auth, role resolution |

### Stock Movement Edge Functions

All Stock Movement workflows are served by dedicated edge functions under [`supabase/functions/`](supabase/functions/):

- `sm_search-items` · `sm_get-item-stock` · `sm_get-reason-codes`
- `sm_get-movements` · `sm_get-movement-counts` · `sm_get-movement-review-data`
- `sm_calculate-pallet-impact` · `sm_submit-movement-request` · `sm_approve-movement`

See the [master function index](supabase/functions/README.md) and per-function READMEs for request/response schemas and deployment commands.

---

## Documentation

| Document | Description |
| :--- | :--- |
| [Architecture](docs/ARCHITECTURE.md) | System architecture with diagrams |
| [Architecture Series](docs/architecture/) | 12-part detailed architecture deep-dive |
| [Architecture Decision Records](docs/adr/) | MADR-format records of key decisions |
| [Release Notes](docs/releases/) | Per-version detailed release notes |
| [Database Schema](docs/DATABASE_SCHEMA.md) | Complete schema reference |
| [Module Overview](docs/MODULE_OVERVIEW.md) | Module catalog and dependency map |
| [Deployment Guide](docs/DEPLOYMENT_GUIDE.md) | Deployment instructions |
| [Contributing](docs/CONTRIBUTING.md) | Code standards and PR process |
| [Edge Functions](supabase/functions/README.md) | Master index for all Supabase Edge Functions |
| [RBAC Reference](docs/reference/rbac-database.md) | Granular RBAC system details |
| [Troubleshooting](docs/reference/troubleshooting.md) | Common issues and fixes |
| [Design System](docs/reference/design-system.md) | UI design tokens |
| [Stock Movement](docs/workflows/stock-movement.md) | Stock movement workflow |

---

## Contributing

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

- TypeScript strict typing for all new code
- Component files use PascalCase (e.g., `StockMovement.tsx`)
- Hooks prefixed with `use` (e.g., `useDashboard.ts`)
- Services use camelCase (e.g., `inventoryService.ts`)
- Use the Enterprise Design System components for UI consistency
- No `console.log` in production code (use proper error handling)
- Meaningful commit messages following Conventional Commits
- All new modules must implement GRBAC (see [workflow](/.agents/workflows/add-new-module.md))

See [`docs/CONTRIBUTING.md`](docs/CONTRIBUTING.md) for full contribution guidelines.

---

## Versioning

This project uses [Semantic Versioning](https://semver.org/):

```
MAJOR.MINOR.PATCH
```

| Version Part | When to Increment |
| :--- | :--- |
| **MAJOR** | Breaking changes or major architecture overhaul |
| **MINOR** | New features, backwards-compatible |
| **PATCH** | Bug fixes and minor improvements |

**Current Version:** `v0.5.6`

### Version History

| Version | Date | Type | Highlights |
| :--- | :--- | :--- | :--- |
| **0.5.6** | 2026-05-03 | Minor | Intelligent Pallet Allocation in New Blanket Release wizard (subset-sum matcher, exact / round-up / round-down options, auto-amendment); two new industrial print artefacts (Picking List, Amendment Draft mirroring OPW format); S&V warehouse decommission (migration 059); historical `shipment_number` backfill (migration 060); BPA Detail per-part fulfilment focus + filter-pill bug fix; Inventory Hub UI polish |
| 0.5.5 | 2026-04-25 | Minor | Release allocation holds (`On-Hand / Allocated / Reserved / Available` per warehouse, delivery-gated stock-out, MPL-cancel cascade); historical data import (4 BPAs, 197 pallets, 30 releases, 31 tariff invoices); 3 new architecture docs |
| 0.5.4 | 2026-04-21 | Minor | Item Master edge functions (`im_*`), hard-cascade → soft delete, `item_code → part_number` schema migration groundwork (Phases 1–3a) |
| 0.5.3 | 2026-04-18 | Patch | Edge function reorganization (`sm_*` prefix), JWT auth stabilization, per-function READMEs, ADR process, CODEOWNERS |
| 0.5.2 | 2026-04-11 | Patch | Branch alignment, security hardening, deploy artifact isolation |
| 0.5.1 | 2026-03-31 | Patch | Deep cleanup, dead code removal, DB consolidation, documentation sync |
| 0.5.0 | 2026-03-31 | Minor | Codebase cleanup, dependency audit, documentation overhaul, PDF microservice |
| 0.4.2 | 2026-03-30 | Patch | Server-side filtering, backend aggregates, pagination fixes |
| 0.4.1 | 2026-03-06 | Patch | Performance optimization, documentation overhaul, structured logging |
| 0.4.0 | 2026-03-05 | Minor | Master Packing List, Performa Invoice, Traceability |
| 0.3.2 | 2026-02-25 | Patch | RBAC refinements, version management |
| 0.3.0 | 2026-02-23 | Minor | Granular RBAC, Supabase security hardening |
| 0.2.0 | 2026-02-15 | Minor | Packing Engine v2, pallets, containers |
| 0.1.0 | 2026-01-20 | Initial | Core WMS with inventory, movements, orders |

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

---

## Recent Changes

### v0.5.6 — Intelligent Pallet Allocation, S&V Decommission & Print Artefacts (2026-05-03)

This minor release rebuilds the New Blanket Release wizard around an intelligent pallet matcher and ships two industrial-grade print documents. Bundled fixes retire the S&V warehouse and backfill historical shipment numbers.

#### Intelligent Pallet Allocation
- New [`palletMatcher.ts`](src/components/release/palletMatcher.ts) module — pure-TS subset-sum matcher with two-stage strategy: FIFO-prefix shortcut → 0/1-knapsack DP with parent-pointer recovery. Whole-pallet only, FIFO-biased, zero dependencies, runs client-side
- Step 4 of [`CreateRelease.tsx`](src/components/release/CreateRelease.tsx) rebuilt with three render paths driven by `MatcherResult`:
  - **Exact match** — green hero, auto-applied
  - **No exact match** — two stacked option cards (Round Up ▲ / Round Down ▼), each with pallet list + auto-generated customer amendment message + Copy button
  - **Insufficient stock** — red hero with partial-fulfilment path
- Manual override preserved as `Step4Manual` for power users
- Step 3 softens REL MULT to a hint (actual pallet outer-quantities vary per shipment); captures `customerRequestedQuantity` separately so the customer's original ask survives any amendment
- Step 5 surfaces amendments via a top banner, header pill (`▲ AMENDED UP` / `▼ AMENDED DOWN` / `✎ MANUAL`), and a diff'd quantity grid (Customer Asked vs Releasing)

#### Industrial-grade print artefacts
- New [`releasePrints.ts`](src/components/release/releasePrints.ts) module exporting `printPickingList()` and `printAmendmentDraft()`
- **Picking List** — internal warehouse pull document with rack-sorted rows, ✓-checkbox per pallet, signature blocks for picker and verifier, discrepancy notes, standing-instructions footer
- **Amendment Draft** — customer-facing document mirroring OPW's release-document format (3-column top band, two-row commercial strip, items table with diff'd Quantity and Extended Price cells, 24-hour acknowledgement banner, two-column signature panel)
- Both share an A4 portrait, 6mm margin, 1.5px outer-border layout consistent with the existing PROFORMA INVOICE and PACKING LIST prints

#### S&V Warehouse decommission (DB migration 059)
- Frontend types, UI cards, movement routes, and edge-function code-mappings purged of S&V references
- Migration 059 deletes all S&V data from `release_pallet_holds`, `inv_warehouse_stock`, `inv_movement_*`, `inv_stock_movements`, and finally `inv_warehouses`; rebuilds `vw_item_stock_distribution` (and dependents) without `snv_*` columns
- ⚠ Destructive and irreversible — recovery requires a backup snapshot

#### Historical `shipment_number` backfill (DB migration 060)
- Populates `shipment_number` on the 27 historical goods-receipts and 29 historical proformas seeded with NULL by migration 051
- Numbering scheme: `SHIP-2025-NNN` based on year extracted from `proforma_number`, sequenced by `proforma_number` order
- Result: 100% coverage on both tables; the wizard's Review step now shows real shipment numbers everywhere
- Companion: `release_list_available_pallets` edge function modified to expose `shipment_number` (with `goods_receipts → pack_proforma_invoices` fallback)

#### UI polish bundled
- BPA Detail Fulfilment tab can be filtered to a single part when opened from a per-part card
- BPA Detail "Drafted" filter pill bug fixed (`'DRAFT'` → `'OPEN'`)
- BPA List "New Release" buttons no longer all spin together (per-card loading state)
- Release wizard auto-detects next sequence (`{BPA}-{maxSeq+1}`) with green AUTO chip and reset link
- Inventory Hub US Warehouse card recoloured (red → teal) and rebuilt with hero Available-to-Promise tile, KPI chips, stacked utilisation bar, and per-release breakdown with mini progress bars
- In-Transit card mislabelled "Allocated" row corrected to "Reserved"

#### Documentation
- [`docs/releases/CHANGES_0.5.6.md`](docs/releases/CHANGES_0.5.6.md) — release notes
- [`docs/releases/RELEASE_0.5.6.md`](docs/releases/RELEASE_0.5.6.md) — executive release report
- [`docs/releases/IMPLEMENTATION_0.5.5_TO_0.5.6.md`](docs/releases/IMPLEMENTATION_0.5.5_TO_0.5.6.md) — full technical change log (architecture, algorithm, UI, prints, DB, edge fn, files manifest, verification recipes, rollback recipe, follow-ups)

### v0.5.5 — Release Allocation Holds & Historical Data Import (2026-04-25)

This minor release ships two large work streams plus a documentation refresh:

#### Release Allocation Holds (DB migrations 044–048)
- New `release_pallet_holds` table tracks pallets a release has locked, split into `ALLOCATED` (earliest need-by-date wins) vs `RESERVED` (queued) buckets per `(part × warehouse)` scope
- New RPCs: `release_allocate_pallets()` (called from a wrapper edge function of the same name) and `recompute_release_holds()` (scope-wide priority recompute)
- **Stock decrements on delivery, not on sub-invoice creation.** The over-eager `trg_rpa_drain_hold` was replaced by `trg_br_delivered_drain_holds` (fires when a release flips to `DELIVERED`)
- MPL cancellation now cascades to dependent pallets (`trg_mpl_cancel_sync_mpp`) so rack drawers stop pointing at cancelled paperwork; `pallet_get_back_chain` re-sorts to put non-cancelled MPLs first
- Inventory views now expose four buckets per warehouse (`On-Hand / Allocated / Reserved / Available`); `StockDistributionCard` and `UnifiedItemMaster` render the breakdown for the US 3PL warehouse

#### Historical Data Import — Phases M1 → M4 (DB migrations 049–058)
- First production import of legacy xlsx + PDF artefacts: **4 customer BPAs, 197 pallets across racks A–G, 30 FULFILLED releases, 31 sub-invoices, 31 CLAIMED tariff invoices**
- Four procurement scenarios modelled in production data: Standard PO (260067031), Real BPA (260067252), Informal Borrow (260067251 hosting OPW-69 + OPW-70), Synthesized BPA (260067299)
- Every imported row carries a `source = 'MIGRATION*'` tag for clean rollback; live RPCs continue to write `source = 'MANUAL'`
- UI defaults corrected: `ReleaseList` and `TariffInvoiceQueue` now default to `ALL` (M3 data is `FULFILLED` / `CLAIMED` and was invisible behind the previous `OPEN` / `DRAFT` defaults)

#### New Edge Function
- `release_allocate_pallets` — wrapper over the new RPC; resolves `warehouse_id` from the pallet's rack placement and forwards the hold list

#### Documentation
- [`docs/releases/CHANGES_0.5.5.md`](docs/releases/CHANGES_0.5.5.md) — release notes
- [`docs/releases/RELEASE_0.5.5.md`](docs/releases/RELEASE_0.5.5.md) — executive release report
- [`docs/releases/IMPLEMENTATION_0.5.4_TO_0.5.5.md`](docs/releases/IMPLEMENTATION_0.5.4_TO_0.5.5.md) — full technical change log (frontend / DB / edge functions / scripts)

### v0.5.4 — Item Master Edge Functions, Soft Delete & Schema Migration Groundwork (2026-04-21)

This minor release moves the Item Master module to edge functions, converts item deletion from a 13-table hard cascade to a reversible soft delete, and stages Phases 1–3a of the `item_code → part_number` schema migration:

#### Edge Functions (`im_*` prefix)
- `im_list-items` — list + summary counts in one round trip (server-side sort, search, filter, pagination)
- `im_get-blanket-orders` — replaces direct `v_item_details` SELECT in the PackingDetail modal
- `im_upsert-item` — single endpoint for create / update branches
- `im_delete-item` — reversible soft delete (sets `is_active = false`; preserves FK integrity and historic audit rows)

#### Delete Semantics
- **Hard cascade → soft delete.** Previously a mis-click wiped stock ledger, movement lines, and packing records. Now a single `UPDATE items SET is_active = false` preserves every child row; restore by flipping the flag.
- Audit log captures a full pre-delete snapshot + reason + JWT-derived user identity.

#### Schema Migration (Phases 1–3a applied; 3b deferred)
- `items.part_number` is now **UNIQUE** (5 pre-existing duplicates resolved via rename + deactivate)
- 24 dependent tables (13 FK + 11 denormalized packing tables) carry a populated `part_number_new` column with FK → `items.part_number`
- Legacy `item_code` columns **retained** — Phase 3b cutover is held until a verified backup exists (free tier, no PITR)
- Audit `target_id` and the UI toast now prefer `part_number`

#### Client Changes
- `src/utils/api/itemsSupabase.ts` rewritten as a thin wrapper over the four `im_*` functions. Public shape unchanged.
- `UnifiedItemMaster.tsx` — no more direct Supabase queries; summary counts folded into the list response; toast copy updated to "deactivated"

#### Documentation
- [`docs/SCHEMA_MIGRATION_item_code_to_part_number.md`](docs/SCHEMA_MIGRATION_item_code_to_part_number.md) — 6-phase migration plan across 13 FK tables, 11 denormalized tables, 17 edge functions, and supporting RPCs/views
- [`docs/releases/CHANGES_0.5.4.md`](docs/releases/CHANGES_0.5.4.md) — detailed release notes

### v0.5.3 — Edge Function Reorganization & Documentation Refresh (2026-04-18)

This patch release focuses on **server-side stock movement infrastructure, function naming, and documentation** with zero business logic changes:

#### Edge Functions
- All Stock Movement functions renamed with `sm_` prefix (e.g., `approve-movement` → `sm_approve-movement`) for visual grouping in the Supabase dashboard
- Auth validation migrated from the reserved `SUPABASE_ANON_KEY` to a custom `PUBLISHABLE_KEY` secret — required after Supabase rotated the project to the new `sb_publishable_*` / ES256 JWT format
- All functions redeployed with `--no-verify-jwt` so CORS preflight reaches the in-function handler cleanly
- `auth.getUser(jwt)` now called with explicit JWT + `persistSession: false` on all clients

#### Client Changes
- `StockMovement.tsx` — all `FUNCTIONS_BASE` URLs updated to point at the new `sm_*` function paths
- Item search input now **debounced at 300ms** — typing "opw-57" fires 1 request instead of 6
- `.env.local` `VITE_FUNCTIONS_URL` override removed so the frontend uses the deployed Supabase URL by default

#### Documentation
- Master edge function index + per-function READMEs (11 new files under `supabase/functions/`)
- `.env.example` template for edge function environment variables
- ADR process bootstrapped under `docs/adr/` with the first record covering this migration
- `.github/CODEOWNERS` added with placeholder team handles
- Detailed release notes at `docs/releases/CHANGES_0.5.3.md`

#### Cleanup
- `.gitignore` refined — un-ignored `supabase/functions/` so edge function source is tracked in git; still ignoring `supabase/.branches/`, `supabase/.temp/`, and the secret-bearing `supabase/functions/.env`
- New `scripts/dev/` folder for ad-hoc developer scripts (git-ignored except its README)

### v0.5.2 — Branch Alignment & Security Hardening (2026-04-11)

This patch release focused on **branch cleanup, deployment isolation, and security hardening** with zero business logic changes:

#### Branch Alignment
- `develop-test` now contains **only application source code** — all Docker, Nginx, CI/CD, and `.env.*` files removed
- `deploy/pre-prod` retains all deployment infrastructure (Dockerfile, docker-compose, deploy.yml, nginx configs)
- Zero-conflict merge path verified between both branches

#### Security Hardening
- Removed hardcoded PDF API key from nginx.conf (now uses `${PDF_API_KEY}` envsubst)
- API client `console.log` guarded with `isDev` — no token/request logging in production
- Supabase config migrated to `import.meta.env` with safe fallbacks

#### Code Cleanup
- Removed 10 unnecessary files (temp notes, test scripts, dead components)
- Removed 40+ dead Vite alias entries
- Centralized auth helpers — eliminated duplicate `getCurrentUserId`/`getUserRole` definitions
- Removed dead seed database code from Dashboard

### v0.5.1 — Deep Cleanup & Standardization (2026-03-31)

- Removed 253 lines of commented-out duplicate code, 8 unused imports, dead components
- Deleted legacy `server/` directory (PDF fully decoupled to microservice)
- Consolidated DB schemas into `.db_reference/`

---

## Authors & Maintainers

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

## License & Copyright

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
  <sub>Built by <strong>AutoCrat Engineers</strong> · © 2025-2026 · All Rights Reserved</sub>
</p>
