# 🏭 Warehouse Management System (WMS)

An enterprise-grade Inventory Planning, Forecasting, and Warehouse Management System. Designed for high-performance stock tracking, demand prediction using advanced algorithms, and seamless warehouse operations.

[![Status](https://img.shields.io/badge/Status-Production--Ready-success.svg)](#)
[![Stack](https://img.shields.io/badge/Stack-React%20%7C%20TypeScript%20%7C%20Supabase-blue.svg)](#)

---

## 📌 Project Overview

This Warehouse Management System (WMS) provides a comprehensive workflow for managing high-volume inventory. It bridges the gap between historical data and future demand through integrated forecasting and MRP (Material Requirements Planning) logic.

### Problem Statement
Modern warehouses face challenges with inventory accuracy, stockouts, and overstocking. Manual tracking leads to errors, while basic inventory systems lack the predictive capabilities needed for efficient replenishment.

### Our Solution
A type-safe, real-time application that automates stock movement tracking, provides audit trails, and uses **Holt-Winters Triple Exponential Smoothing** to forecast demand, allowing for data-driven procurement decisions.

---

## 🏗️ High-Level Architecture

The system follows a clean, layered architecture ensuring scalability and maintainability:

- **Presentation Layer**: Built with React and TypeScript, utilizing a custom Enterprise Design System for a premium user experience.
- **Business Logic Layer**: Abstrated into custom hooks and services to maintain a strict separation of concerns.
- **Data Layer**: Powered by Supabase (PostgreSQL) with real-time capabilities and strict relational integrity.
- **Forecasting Engine**: Implements the Holt-Winters algorithm for trend and seasonality-aware demand prediction.

Detailed architecture can be found in [docs/architecture.md](docs/architecture.md).

---

## 🚀 Core Features

- **Inventory Control**: Real-time tracking of Finished Goods (FG) with multi-status monitoring (Healthy, Warning, Critical, Overstock).
- **Automated Stock Movement**: Integrated ledger for every transaction, ensuring a 100% accurate audit trail.
- **Smart Forecasting**: Advanced demand prediction using seasonality and trend analysis.
- **MRP Planning**: Automated replenishment recommendations based on lead times, safety stocks, and forecasts.
- **Order Management**: Comprehensive handling of Blanket Orders and Releases.
- **Enterprise Dashboard**: High-level KPIs and critical alerts for warehouse managers.

---

## 🛠️ Tech Stack

| Category | Technology |
| :--- | :--- |
| **Frontend** | React 18, TypeScript, Tailwind CSS |
| **State Management** | React Hooks, Custom Services |
| **Backend / DB** | Supabase (PostgreSQL) |
| **UI Components** | Radix UI, Lucide Icons |
| **Charts / Analytics** | Recharts |
| **Build Tool** | Vite |

---

## 📁 Project Structure

```text
/
├── config/             # Database schemas and system configurations
├── docs/               # Technical and developer documentation
│   └── readme/         # Legacy documentation and specific guides
├── scripts/            # Automation and maintenance scripts
├── src/                # Source code
│   ├── components/     # High-quality UI components
│   ├── hooks/          # Reusable business logic hooks
│   ├── supabase/       # Supabase client and edge functions
│   ├── types/          # Centralized TypeScript definitions
│   ├── utils/          # Helper functions and API clients
│   └── main.tsx        # Application entry point
├── tests/              # Test suites (Unit & Integration)
└── vite.config.ts      # Build configuration
```

---

## ⚙️ Installation & Setup

### Prerequisites
- Node.js (v18+)
- npm / yarn / pnpm
- Supabase Account

### Setup
1. **Clone the repository:**
   ```bash
   git clone https://github.com/AutoCrat-Engineers/Warehouse-Management-System.git
   cd Warehouse-Management-System
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Configuration:**
   Create a `.env` file in the root directory and add your Supabase credentials:
   ```env
   VITE_SUPABASE_URL=your_supabase_url
   VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

4. **Initialize Database:**
   Apply the SQL schemas found in `config/` to your Supabase project.

---

## 🚦 Run Instructions

### Development Mode
```bash
npm run dev
```

### Production Build
```bash
npm run build
```

---

## 🛡️ Security & Performance

- **Type Safety**: End-to-end TypeScript implementation.
- **Data Integrity**: Database-level constraints and triggers for stock updates.
- **Optimized Rendering**: Memoized components and custom hooks for efficient data fetching.
- **Secure Access**: JWT-based authentication via Supabase.

---

## 🤝 Contribution Guidelines

We follow the standard GitHub Flow. For major changes, please open an issue first to discuss what you would like to change.
1. Fork the repo.
2. Create your feature branch.
3. Commit your changes (ensure clean commit history).
4. Push to the branch.
5. Create a new Pull Request.

---

## 📄 License
Internal Proprietary Software - © 2026 AutoCrat Engineers.
# -Warehouse-Management-System-WMS-
