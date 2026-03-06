# Warehouse Management System

**Enterprise-Grade Finished Goods Warehouse Management System**

[![Version](https://img.shields.io/badge/version-0.4.1-blue.svg)](CHANGELOG.md)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Stack](https://img.shields.io/badge/stack-React%20%2B%20Supabase-purple.svg)]()

---

## Overview

The Warehouse Management System (WMS) is a production-grade ERP module designed for **finished goods (FG) warehouse operations**. It covers the complete lifecycle from production receipt through packing, sticker generation, palletization, dispatch, and stock movement across multiple warehouse locations.

Built for industrial-scale environments comparable to SAP EWM, the system provides:

- **Real-time inventory tracking** across 5+ warehouse locations
- **Automated packing workflows** with QR-coded sticker generation
- **Pallet state machine** with automatic fill detection and adjustment box handling
- **Master Packing List** generation and dispatch management
- **Granular Role-Based Access Control (GRBAC)** with L1/L2/L3 user tiers
- **Full traceability** from raw receipt to customer dispatch

---

## Architecture Summary

```
┌─────────────────────────────────────────────────────────┐
│                    FRONTEND (React/TS)                   │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌────────────┐ │
│  │Dashboard │ │Item Mstr │ │Stock Mvt │ │  Packing   │ │
│  │          │ │          │ │          │ │  Engine    │ │
│  └────┬─────┘ └────┬─────┘ └────┬─────┘ └─────┬──────┘ │
│       │             │            │              │        │
│  ┌────┴─────────────┴────────────┴──────────────┴────┐  │
│  │              Service Layer (TypeScript)            │  │
│  │   packingService · packingEngineService · mplSvc   │  │
│  └───────────────────────┬───────────────────────────┘  │
└──────────────────────────┼──────────────────────────────┘
                           │ HTTPS / PostgREST
┌──────────────────────────┼──────────────────────────────┐
│                  SUPABASE / POSTGRESQL                    │
│  ┌───────────────────────┴───────────────────────────┐  │
│  │  Tables: items · inventory · packing_requests     │  │
│  │  packing_boxes · pack_containers · pallets        │  │
│  │  packing_lists · invoices · warehouse_stock       │  │
│  │  stock_ledger · movement_headers · profiles       │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Functions: get_effective_permissions()            │  │
│  │  RLS Policies: Role-based row security            │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

For detailed architecture documentation, see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

---

## Modules

| Module | Description | Component |
|--------|-------------|-----------|
| **Dashboard** | KPIs, stock distribution, recent activity | `DashboardNew.tsx` |
| **Item Master** | FG catalog management with CRUD | `ItemMasterSupabase.tsx` |
| **Inventory Grid** | Multi-warehouse stock visualization | `InventoryGrid.tsx` |
| **Stock Movements** | Production receipt, transfers, dispatch | `StockMovement.tsx` |
| **Packing** | Sticker generation, box management | `packing/PackingModule.tsx` |
| **Packing Engine** | Containers, pallets, state machine | `packing-engine/` |
| **Packing Details** | Specifications, dimensions, weights | `packing/PackingDetails.tsx` |
| **Pallet Dashboard** | Pallet state tracking and management | `PalletDashboard.tsx` |
| **Contract Configs** | Customer-specific packing rules | `ContractConfigManager.tsx` |
| **Dispatch Selection** | Dispatch readiness and MPL creation | `DispatchSelection.tsx` |
| **Master Packing List** | MPL generation, print, and export | `MasterPackingListHome.tsx` |
| **Performa Invoice** | Shipment batching and stock dispatch | `PerformaInvoice.tsx` |
| **Traceability** | Full backward trace for any container | `TraceabilityViewer.tsx` |
| **Blanket Orders** | Long-term supply agreements | `BlanketOrders.tsx` |
| **Blanket Releases** | Order releases against blankets | `BlanketReleases.tsx` |
| **Forecasting** | Demand prediction and analysis | `ForecastingModule.tsx` |
| **MRP Planning** | Material requirements planning | `PlanningModule.tsx` |
| **User Management** | User roles, permissions, GRBAC | `auth/users/` |
| **Rack View** | Visual warehouse rack layout | `RackView.tsx` |

---

## Installation

### Prerequisites

- **Node.js** ≥ 18.x
- **npm** ≥ 9.x
- **Supabase** project (with PostgreSQL database)

### Setup

1. **Clone the repository**

```bash
git clone https://github.com/AutoCrat-Engineers/WarehouseManagementSystem.git
cd WarehouseManagementSystem
```

2. **Install dependencies**

```bash
npm ci
```

3. **Configure Supabase connection**

Update `src/utils/supabase/info.tsx` with your Supabase project credentials:

```typescript
export const projectId = 'your-project-id';
export const publicAnonKey = 'your-anon-key';
```

4. **Run database migrations**

Execute the migration scripts in order in the Supabase SQL Editor:

```
supabase/migrations/packing_engine/001_contract_configs.sql
supabase/migrations/packing_engine/002_containers.sql
...
supabase/migrations/packing_engine/013_performance_indexes.sql
```

5. **Start the development server**

```bash
npm run dev
```

The application will be available at `http://localhost:3000`.

---

## Environment Setup

| Variable | Description | Location |
|----------|-------------|----------|
| Supabase Project ID | Your Supabase project identifier | `src/utils/supabase/info.tsx` |
| Supabase Anon Key | Public anonymous API key | `src/utils/supabase/info.tsx` |

> **Security Note:** Never commit Supabase service role keys or database passwords. The application uses the public anon key with Row Level Security (RLS) for all operations.

---

## Local Development

```bash
# Install dependencies
npm ci

# Start dev server with hot reload
npm run dev

# Build for production
npm run build
```

### Project Structure

```
src/
├── App.tsx                    # Main application with routing + RBAC
├── auth/                      # Authentication, RBAC, user management
│   ├── components/            # Login, GrantAccess modal
│   ├── context/               # Auth context provider
│   ├── services/              # Permission service, auth service
│   └── users/                 # User management component
├── components/                # All UI components
│   ├── packing/               # Packing workflow (stickers, boxes)
│   ├── packing-engine/        # Advanced engine (pallets, containers)
│   ├── notifications/         # Notification bell
│   └── ui/                    # Shared UI primitives (Radix-based)
├── hooks/                     # Custom React hooks
├── services/                  # Inventory service
├── types/                     # TypeScript type definitions
└── utils/                     # Shared utilities
    ├── api/                   # API clients, Supabase wrappers
    ├── auth.ts                # Shared auth helpers
    ├── auditLogger.ts         # Structured logging module
    ├── idGenerator.ts         # ID generation utilities
    └── supabase/              # Supabase client configuration
```

---

## Deployment

```bash
# Build production bundle
npm run build
```

See [docs/DEPLOYMENT_GUIDE.md](docs/DEPLOYMENT_GUIDE.md) for detailed instructions.

---

## Version History

| Version | Date | Type | Highlights |
|---------|------|------|------------|
| **0.4.1** | 2026-03-06 | Patch | Performance optimization, documentation overhaul, structured logging |
| 0.4.0 | 2026-03-05 | Minor | Master Packing List, Performa Invoice, Traceability |
| 0.3.2 | 2026-02-25 | Patch | RBAC refinements, version management |
| 0.3.0 | 2026-02-23 | Minor | Granular RBAC, Supabase security hardening |
| 0.2.0 | 2026-02-15 | Minor | Packing Engine v2, pallets, containers |
| 0.1.0 | 2026-01-20 | Initial | Core WMS with inventory, movements, orders |

See [CHANGELOG.md](CHANGELOG.md) for detailed release notes.

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 18, TypeScript, Vite |
| **UI Components** | Radix UI, Lucide Icons, Recharts |
| **Backend** | Supabase (PostgreSQL, PostgREST, Auth) |
| **Database** | PostgreSQL 15 with RLS |
| **Deployment** | Docker, Nginx, GitHub Actions, AWS EC2 |
| **Printing** | QR Code (qrcode library), Browser Print API |

---

## Documentation

| Document | Description |
|----------|-------------|
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

## Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for contribution guidelines.

---

## License

This project is licensed under the MIT License. See [LICENSE](LICENSE) for details.
