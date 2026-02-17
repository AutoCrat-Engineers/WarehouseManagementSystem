<p align="center">
  <img src="public/logo.png" alt="AutoCrat Engineers Logo" width="320" />
</p>

<h1 align="center">Warehouse Management System (WMS)</h1>

<p align="center">
  <strong>Enterprise-Grade Inventory Planning, Forecasting & Warehouse Operations Platform</strong>
</p>

<p align="center">
  <a href="#"><img src="https://img.shields.io/badge/Version-0.2.0-blue?style=for-the-badge" alt="Version" /></a>
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
- [Contributing](#-contributing)
- [Versioning](#-versioning)
- [Authors & Maintainers](#-authors--maintainers)
- [License & Copyright](#-license--copyright)

---

## 🏭 About the Project

### Problem Statement

Modern manufacturing warehouses face critical challenges with inventory accuracy, unplanned stockouts, and excessive overstocking. Manual tracking leads to data inconsistencies, whilst basic inventory systems lack the predictive capabilities needed for intelligent replenishment planning.

### Our Solution

The **Warehouse Management System (WMS)** is a type-safe, real-time application engineered to automate the entire stock lifecycle — from goods receipt and inward movements, through multi-warehouse distribution, to final dispatch and delivery. It features a built-in **Holt-Winters Triple Exponential Smoothing** forecasting engine for data-driven procurement decisions, a comprehensive audit trail for every stock movement, and a role-based access control system ensuring operational security.

> _Built by engineers, for engineers — designed to handle real-world manufacturing complexity at scale._

---

## 🚀 Key Features

| Module | Description |
| :--- | :--- |
| **📊 Enterprise Dashboard** | Real-time KPIs, critical stock alerts, and operational summaries for warehouse managers. |
| **📦 Item Master** | Centralised catalogue of Finished Goods (FG) with part numbers, descriptions, and master serial numbers. |
| **🏗️ Multi-Warehouse Inventory** | Real-time stock tracking across multiple warehouse types (S&V, Production, In Transit, Distribution) with status monitoring (Healthy, Warning, Critical, Overstock). |
| **🔄 Stock Movements** | Full ledger-based transaction system with movement types (Inward, Outward, Transfer, Adjustment), approval workflows, and printed slips. |
| **📋 Blanket Orders** | Comprehensive handling of long-term customer contracts with order line items. |
| **📅 Blanket Releases** | Delivery scheduling against blanket orders with automatic inventory deduction upon delivery. |
| **📈 Demand Forecasting** | Advanced demand prediction using Holt-Winters algorithm with trend and seasonality analysis. |
| **🔧 MRP Planning** | Automated replenishment recommendations based on lead times, safety stock levels, and forecast data. |
| **👥 User Management** | Role-based access control (L1 Operator, L2 Supervisor, L3 Manager) with account activation/deactivation. |

---

## 🏗️ Architecture

The system follows a **clean, layered architecture** ensuring scalability, testability, and maintainability:

```
┌─────────────────────────────────────────────────────────────┐
│                   PRESENTATION LAYER                         │
│         React 18 + TypeScript + Enterprise Design System     │
├─────────────────────────────────────────────────────────────┤
│                   BUSINESS LOGIC LAYER                       │
│      Custom Hooks (useDashboard, useInventory)               │
│      Services (inventoryService, authService)                │
├─────────────────────────────────────────────────────────────┤
│                   API / EDGE FUNCTIONS                        │
│           Supabase Edge Functions (Hono Framework)            │
│      Repositories → Services → Route Handlers                │
├─────────────────────────────────────────────────────────────┤
│                      DATA LAYER                              │
│       Supabase (PostgreSQL) + Row Level Security             │
│     Views, Triggers, Foreign Key Constraints                 │
└─────────────────────────────────────────────────────────────┘
```

For detailed architecture documentation, see [`docs/architecture.md`](docs/architecture.md).

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
| **Backend / Database** | Supabase (PostgreSQL) | Managed database with real-time subscriptions |
| **Edge Functions** | Deno + Hono | Serverless API layer |
| **Authentication** | Supabase Auth (JWT) | Secure session management |
| **State Management** | React Hooks + Context | Lightweight state handling |

---

## 📁 Project Structure

```
WarehouseManagementSystem/
│
├── 📄 .gitignore                # Git ignore rules
├── 📄 README.md                 # This file
├── 📄 package.json              # Dependencies and scripts
├── 📄 tsconfig.json             # TypeScript configuration
├── 📄 vite.config.ts            # Vite build configuration
├── 📄 index.html                # HTML entry point
│
├── 📁 config/                   # Database schemas & migrations
│   ├── current-database-schema.sql
│   ├── migration_add_text_columns.sql
│   └── migration_stock_movement_v2.sql
│
├── 📁 docs/                     # Technical documentation
│   ├── architecture.md          # System architecture overview
│   ├── developer.md             # Developer onboarding guide
│   └── readme/                  # Module-specific documentation
│       ├── DATABASE_SCHEMA.md
│       ├── ARCHITECTURE.md
│       ├── RBAC_AUTHENTICATION.md
│       ├── STOCK_MOVEMENT_GUIDE.md
│       ├── TROUBLESHOOTING.md
│       └── ...
│
├── 📁 public/                   # Static assets
│   ├── logo.png
│   ├── a-logo.png
│   ├── backgroundlogin.png
│   └── data/quotes.json
│
└── 📁 src/                      # Application source code
    ├── 📄 App.tsx               # Root application component
    ├── 📄 main.tsx              # React entry point
    ├── 📄 index.css             # Global styles & design tokens
    │
    ├── 📁 auth/                 # Authentication & RBAC module
    │   ├── index.ts             # Auth barrel exports
    │   ├── components/          # Auth-specific UI components
    │   ├── context/             # Auth context provider
    │   ├── login/               # Login page component
    │   ├── services/            # Auth service layer
    │   └── users/               # User management module
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
    │   ├── ErrorBoundary.tsx    # Error boundary wrapper
    │   ├── LoadingPage.tsx      # Loading state component
    │   └── ui/                  # Reusable UI components (50+)
    │       ├── EnterpriseUI.tsx # Core enterprise design system
    │       ├── button.tsx, card.tsx, dialog.tsx, ...
    │       └── utils.ts
    │
    ├── 📁 hooks/                # Custom React hooks
    │   ├── useDashboard.ts      # Dashboard data fetching
    │   └── useInventory.ts      # Inventory operations
    │
    ├── 📁 services/             # Business logic services
    │   └── inventoryService.ts  # Inventory CRUD operations
    │
    ├── 📁 supabase/             # Supabase edge functions
    │   └── functions/server/    # API route handlers
    │       ├── index.tsx        # Main edge function entry
    │       ├── repositories/    # Data access layer
    │       └── services/        # Business logic layer
    │
    ├── 📁 types/                # TypeScript type definitions
    │   ├── index.ts             # Core application types
    │   └── inventory.ts         # Inventory-specific types
    │
    └── 📁 utils/                # Utility functions
        ├── api/                 # API client & fetch utilities
        └── supabase/            # Supabase client & auth helpers
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
npm install
```

**3. Configure environment variables:**

Create a `.env` file in the project root (see [Environment Variables](#-environment-variables)):

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

**4. Initialise the database:**

Apply the SQL schemas from `config/` to your Supabase project via the SQL Editor.

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

> ⚠️ **Never commit `.env` files to version control.** The `.gitignore` is configured to exclude all environment files.

---

## 🛡️ Security & RBAC

### Authentication

- **JWT-based authentication** via Supabase Auth
- Secure session management with automatic token refresh
- Protected routes and API calls

### Role-Based Access Control (RBAC)

| Role | Level | Permissions |
| :--- | :--- | :--- |
| **Operator** | L1 | View data, create stock movements |
| **Supervisor** | L2 | L1 + approve/reject movements, edit items |
| **Manager** | L3 | L2 + user management, full system administration |

### Security Best Practices

- ✅ End-to-end TypeScript for type safety
- ✅ Database-level constraints and triggers
- ✅ Row Level Security (RLS) on Supabase tables
- ✅ JWT validation on all edge function endpoints
- ✅ Input sanitisation and validation
- ✅ No hardcoded secrets in source code

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

Database migrations are stored in `config/`.  
Full schema documentation is available at [`docs/readme/DATABASE_SCHEMA.md`](docs/readme/DATABASE_SCHEMA.md).

---

## 📡 API Reference

The backend API is powered by **Supabase Edge Functions** using the Hono framework.

### Architecture Pattern

```
Request → Route Handler → Service → Repository → Database
```

### Key Endpoints

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/items` | Fetch all items |
| `POST` | `/items` | Create a new item |
| `PUT` | `/items/:id` | Update an item |
| `DELETE` | `/items/:id` | Delete an item (cascading) |
| `GET` | `/inventory` | Fetch inventory data |
| `GET` | `/blanket-orders` | Fetch blanket orders |
| `GET` | `/forecasting` | Run demand forecasting |
| `GET` | `/planning` | Generate MRP plans |

Edge function source is located at `src/supabase/functions/server/`.

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

**Current Version:** `v0.2.0`

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
