# Release Notes

## Version: 0.5.0

**Release Date:** 2026-03-31  
**Release Type:** Patch — Critical Bugfixes + Codebase Cleanup  
**Branch:** `feature/weight-update` → `develop-under-test`

---

### 🚀 Features

- **PDF Microservice Extraction** — Decoupled PDF generation into an independent Express.js microservice (`micro-services/pdf-service/`) with Docker containerization, Azure Bicep IaC, and a resilient client (`pdfServiceClient.ts`) with automatic fallback
- **Reprint All Stickers** — Added batch reprint functionality for all stickers in a packing request, accessible after all stickers have been printed
- **Pallet Dashboard v2** — ERP-standard terminology, pagination, search by part number and inner box ID, and redesigned pallet cards with crate-on-pallet visual style

### 📈 Improvements

- **Server-Side Filtering Architecture** — Stock Movement, Sticker Generation, and Proforma Invoice modules now apply all filters (status, type, date range, search) at the database query level before pagination, eliminating data accuracy issues
- **Standardized Loading & Refresh Behavior** — Full-page skeleton `ModuleLoader` on first load across all 11 modules; table-only opacity dim during refresh with cards/filters remaining solid
- **GRBAC Production Hardening** — Granular Role-Based Access Control applied to all modules with permission enforcement via `GrantAccessModal`
- **Proforma Invoice Dispatch Pipeline** — Success toast notifications, idempotency guards, and atomic operations for dispatch safety
- **Pagination Standardization** — Unified pagination component across all data tables with consistent page size and navigation

### 🐛 Bug Fixes

- **Stock Movement: Cross-Table Search** — Search now performs two-phase server-side lookup: finds matching items first, then filters movement headers. Previously only searched within the current page's 20 records
- **Sticker Generation: Summary Cards** — Cards now use independent backend HEAD queries instead of computing counts from paginated data. Cards no longer change when navigating pages
- **Pagination + Filter Order** — All modules enforce correct query order: `SELECT → WHERE → ORDER BY → LIMIT/OFFSET`. Previously, pagination was applied before filters
- **Page Reset on Filter Change** — All modules reset to page 0 when any filter changes, preventing stale page numbers
- **Multi-Pallet Adjustment Box Allocation** — Fixed allocation logic for adjustment (top-off) boxes across multiple pallets
- **RLS Policy Fix** — Corrected row-level security policies for packing and container operations
- **Decimal Point Input** — Weight/Price/Cost inputs no longer lose the decimal point during editing
- **Stock Movement Print Layout** — Uniform 10mm margins, A4 landscape orientation, no manual scaling required

### 🧹 Code Cleanup

- **Removed Dead Code** — Cleaned `SampleDataInfo.tsx` (removed 63 lines of commented-out mock data)
- **Removed Debug Artifacts** — Deleted `git_log_output.txt`, `git_status_output.txt`, `tsc_output.txt`, `log.txt`, `log2.txt`
- **Consolidated DB Schema** — Moved root-level `db_schema.sql` into `.db_reference/` directory
- **Removed Unused Dependencies** — Cleaned 6 unused npm packages: `hono`, `canvas`, `html2canvas`, `jspdf`, `jsbarcode`, `puppeteer`
- **Fixed Package Metadata** — Corrected project name from "Build Inventory Forecasting System" to "warehouse-management-system"

### 🔄 Refactoring

- **`.gitignore` Optimization** — Added patterns for debug output files (`tsc_output.txt`, `git_*_output.txt`), temporary files (`*.tmp`, `*.temp`, `*.bak`), and explicit log file names
- **Architecture Documentation** — Updated 12-part architecture series, module overview, and deployment guide to reflect current state including PDF microservice extraction
- **CHANGELOG Enhancement** — Added v0.4.2 entry with detailed categorization of all changes
- **Version Bump** — `package.json` version updated from `0.4.1` to `0.4.2`

### ⚠️ Breaking Changes (if any)

- **None** — All changes are backward-compatible. No API surface changes. No business logic modifications.

### 🔧 Internal Changes

- **Commit History Analysis** — 81 commits analyzed across 40+ pull requests from `feature/*` branches
- **PR Merges**: #77–#115 integrated covering GRBAC, packing engine, UI fixes, and production readiness
- **Branch Strategy**: `feature/*` → `develop-under-test` → `develop-stable` → `main`
- **Key Contributors**: AutoCrat Engineers engineering team

---

### 📊 Change Summary

| Category | Count |
|:---|:---|
| Files modified | 25+ |
| Files removed | 5 |
| Dependencies removed | 6 |
| New .gitignore patterns | 8 |
| Modules refactored | 11 |
| PRs merged | 40+ |

---

### 🔮 Next Steps

- Complete server-side pagination migration for remaining modules
- Implement UI virtualization for large dataset tables
- Expand automated test coverage
- Production deployment of PDF microservice via Azure Container Apps

---

*Generated from git history analysis on 2026-03-31*
