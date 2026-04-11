# Changelog

All notable changes to the Warehouse Management System will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.5.2] — 2026-04-11

### Release Type: Codebase Cleanup, Branch Alignment & Security Hardening

### Changed

- **API Client Security** — All `console.log` in `src/utils/api/client.ts` guarded with `isDev` check; removed emoji prefixes and token credential logging that could leak JWTs in production
- **Supabase Configuration** — `src/utils/supabase/info.tsx` now uses `import.meta.env` with hardcoded fallbacks for backward compatibility
- **Auth Deduplication** — `packingService.ts` now imports from centralized `src/utils/auth.ts` instead of local duplicate definitions
- **LoginPage Import** — `App.tsx` imports directly from `./auth/login/LoginPage` instead of through re-export shim
- **Nginx Security** — Replaced hardcoded PDF API key with `${PDF_API_KEY}` envsubst template (deploy branch only)
- **Vite Configuration** — Removed 40+ unused versioned package alias entries from `vite.config.ts`
- **Branch Strategy** — `develop-test` now contains exclusively application source code; deployment artifacts isolated to `deploy/pre-prod`

### Removed

- **Temporary Files** — `changelog-ui-standardization.txt`, `sidebar_icon_changes.txt`
- **Ad-hoc Test Scripts** — `test-foreign-key.js`, `test.mjs`
- **Obsolete Docker Config** — `devops/docker/Dockerfile` (replaced by root `Dockerfile` on deploy branch)
- **Dead Components** — `SampleDataInfo.tsx` (no-op), `LoginPage.tsx` (re-export shim)
- **Dead Code** — `seedService` import, `handleSeedDatabase`, `SampleDataInfo` JSX from `DashboardNew.tsx`
- **Deployment Artifacts from Dev** — `.env.example`, `.env.production`, entire `devops/` directory removed from `develop-test` (preserved on `deploy/pre-prod`)

### Improved

- **Merge Safety** — Zero-conflict merges verified between `develop-test` and `deploy/pre-prod`
- **`.gitignore`** — Added `test*.js`, `test*.mjs`, `*.conf.bak` patterns
- **Security** — No hardcoded API keys or secrets in any tracked source file
- **Documentation** — Updated README.md, DEPLOYMENT_GUIDE.md, CHANGELOG.md for v0.5.2

---

## [0.5.1] — 2026-03-31

### Release Type: Deep Cleanup & Standardization

### Removed

- **Dead Commented-Out Code** — Removed 253 lines of entirely commented-out duplicate code from `src/utils/supabase/auth.ts` (identical copy of active code below it)
- **Unused Imports** — Removed 8 unused Lucide icon imports from `App.tsx` (`BarChart3`, `List`, `FileCheck`, `FileMinus`, `Settings`, `Truck`, `Receipt`, `Eye`)
- **Commented-Out UI Block** — Removed 20-line commented-out Traceability menu section from `App.tsx` sidebar
- **Dangling Import** — Removed `AuthDebug` import from `DashboardNew.tsx` (referenced file did not exist)
- **Unused Component Import** — Removed `PackingListManager` import from `App.tsx` (imported but never rendered)
- **Legacy Server Directory** — Deleted `server/pdf-server.mjs` and `server/` directory (PDF service fully decoupled to `micro-services/pdf-service/`)
- **Legacy Script** — Removed `pdf-server` npm script from `package.json`
- **Legacy Config Directory** — Removed `config/` directory after consolidating 3 SQL files into `.db_reference/`

### Changed

- **Dependency Classification** — Moved `@types/qrcode` from `dependencies` to `devDependencies` (type packages belong in devDependencies)
- **`.gitignore` Enhancement** — Added `config/` and `server/` patterns to prevent re-creation of removed directories
- **DB File Consolidation** — Moved `current-database-schema.sql`, `migration_add_text_columns.sql`, `migration_stock_movement_v2.sql` from `config/` into `.db_reference/`

### Documentation

- Updated `docs/DISPATCH_EMAIL_SYSTEM.md` to version v8 reflecting microservice architecture
- Updated `README.md` project structure to match current directory layout
- Updated `README.md` with v0.5.1 Recent Changes section
- Updated `RELEASE_NOTES.md` with v0.5.1 entries
- Updated `CHANGELOG.md` — This entry

---

## [0.5.0] — 2026-03-31

### Release Type: Codebase Cleanup & Documentation

### Removed

- **Unused Dependencies** — Removed 6 packages not imported anywhere in `src/`: `hono`, `canvas`, `html2canvas`, `jspdf`, `jsbarcode`, `puppeteer`. Reduces `node_modules` footprint and eliminates native compilation requirements.
- **Debug Artifacts** — Deleted `git_log_output.txt`, `git_status_output.txt`, `tsc_output.txt`, `log.txt`, `log2.txt` from tracked files.
- **Dead Code** — Cleaned 63 lines of commented-out mock data from `SampleDataInfo.tsx` (retained no-op shim for backward compatibility).

### Changed

- **Package Metadata** — Fixed project name from "Build Inventory Forecasting System" to "warehouse-management-system". Version bumped to `0.5.0`.
- **`.gitignore` Optimization** — Added 8 new patterns: `tsc_output.txt`, `git_*_output.txt`, `log.txt`, `log2.txt`, `*.tmp`, `*.temp`, `*.bak`, and reorganized sections for clarity.
- **DB Schema Consolidation** — Moved root-level `db_schema.sql` (60KB duplicate) into `.db_reference/` directory where it belongs.

### Documentation

- Added `RELEASE_NOTES.md` — Professional release notes generated from 81 commits and 40+ PRs.
- Updated `README.md` — Added "Recent Changes" section documenting v0.5.0 cleanup.
- Updated `CHANGELOG.md` — This entry.
- Updated architecture documentation index to reflect current module count and PDF microservice extraction.

---

## [0.4.2] — 2026-03-30

### Release Type: Critical Bugfix

### Fixed

- **Stock Movement: Server-Side Filtering** — Filters (Pending, Rejected, Completed, Partial) now query the database directly instead of filtering paginated client-side data. Fixed "No data found" bug when selecting status filters while data exists on other pages.
- **Stock Movement: Cross-Table Search** — Search now performs a two-phase server-side lookup: first finds matching items (item_code, part_number, MSN) in the items table, then filters movement headers. Previously, search only worked within the current page's 20 records.
- **Sticker Generation: Summary Cards** — Cards now use independent backend HEAD queries (`select('id', { count: 'exact', head: true })`) instead of computing counts from `requests.filter().length` on paginated data. Cards no longer change when navigating pages.
- **Sticker Generation: Server-Side Status Filter** — Status filter (Approved, In Progress, Completed) is now applied at the database query level before pagination, fixing "No records" when filtering by status.
- **Pagination + Filter Order** — All affected modules now enforce the correct query order: `SELECT → WHERE (filters) → ORDER BY → LIMIT/OFFSET`. Previously, pagination was applied before filters, causing empty results.
- **Page Reset on Filter Change** — All modules now reset to page 0 when any filter changes, preventing stale page numbers after filter updates.

### Changed

- `src/components/StockMovement.tsx` — Rewritten `fetchMovements` to apply status, type, stock type, date range, and search filters server-side before pagination. Uses `{ count: 'exact' }` in the main query for accurate filtered totals. Added debounced search (300ms) for server-side queries. Added `filtersRef` pattern for stable useCallback with current filter state.
- `src/components/packing/PackingModule.tsx` — Added `fetchSummaryCounts()` with parallel HEAD queries for all 4 card values. Replaced `requests.filter().length` with backend aggregate state. Server-side status filtering added to `fetchRequests`.
- `src/components/packing-engine/PerformaInvoice.tsx` — Replaced `limit(100)` with proper server-side pagination using `{ count: 'exact' }`. Status and date range filters moved server-side. Removed `filteredPIs` client-side array in favor of `displayedPIs` from server-filtered data.

### Architecture

- **Rule: Never compute counts from paginated data** — All summary cards must use independent HEAD queries (`{ count: 'exact', head: true }`)
- **Rule: Filter before paginate** — Database query must apply WHERE clauses before RANGE/LIMIT
- **Pattern: filtersRef** — Use React refs to hold current filter state for stable useCallback functions, avoiding unnecessary re-renders while keeping filter values current

---

## [0.4.1] — 2026-03-06

### Release Type: Patch Release

### Performance

- **Sticker Generation: Batch ID Generation** — Pre-compute UUIDs and packing IDs client-side before bulk INSERT. Eliminates N individual UPDATE calls per box (100 boxes = 100 calls → 0). New `generateBoxBatch()` utility in `src/utils/idGenerator.ts`.
- **Stock Movement: Parallel Fetch Optimization** — Movement header fetch moved into Phase 1 parallel block in `transferPackedStock()`, reducing serial DB calls.
- **Database Indexes** — Added 10 performance indexes targeting packing boxes, containers, pallets, warehouse stock, and audit logs (`013_performance_indexes.sql`).
- **Structured Logging with Timing** — `withTiming()` wrapper auto-logs operation duration for all critical paths.

### Added

- `src/utils/auth.ts` — Shared authentication utilities (extracted from 4 duplicate definitions)
- `src/utils/auditLogger.ts` — Enterprise structured logging module with JSON output, performance timing, and convenience helpers
- `src/utils/idGenerator.ts` — Centralized ID generation with batch support for packing box creation
- `supabase/migrations/packing_engine/013_performance_indexes.sql` — Performance indexes for all critical query paths
- `CHANGELOG.md` — This file
- `docs/ARCHITECTURE.md` — Consolidated architecture overview
- `docs/DATABASE_SCHEMA.md` — Complete database schema documentation
- `docs/MODULE_OVERVIEW.md` — Module relationship map
- `docs/DEPLOYMENT_GUIDE.md` — Production deployment guide
- `docs/CONTRIBUTING.md` — Contribution guidelines

### Changed

- `src/components/packing/packingService.ts` — `autoGenerateBoxes()` rewritten to use batch ID generation; `transferPackedStock()` optimized with parallel fetches; structured logging added
- `package.json` — Version bumped to `0.4.1`
- `README.md` — Complete rewrite for v0.4.1 with architecture overview, setup instructions, and module documentation

### Deprecated

- `config/current-database-schema.sql` — Superseded by `.db_reference/presentschema.sql` and `docs/DATABASE_SCHEMA.md`
- `config/migration_add_text_columns.sql` — Already-applied migration
- `config/migration_stock_movement_v2.sql` — Already-applied migration

### Documentation

- Consolidated 27 scattered readme files under `docs/readme/` into structured documentation
- Archived historical status logs (PHASE_2_STATUS, PHASE_3_COMPLETE, etc.)
- Merged JWT troubleshooting documents into consolidated TROUBLESHOOTING.md
- Created architecture diagrams for stock movement, packing, and dispatch flows

---

## [0.4.0] — 2026-03-05

### Added

- Master Packing List (MPL) module with full workflow
- Dispatch Selection → MPL creation flow
- Performa Invoice module
- Traceability Viewer with full backward trace
- MPL print with export capabilities

---

## [0.3.2] — 2026-02-25

### Changed

- Version bump and deployment updates
- RBAC refinements

---

## [0.3.0] — 2026-02-23

### Added

- Granular Role-Based Access Control (GRBAC) system
- Database-driven permission resolution
- Supabase lint error fixes (27 functions, 30 RLS policies)

### Security

- Fixed mutable search paths in all PostgreSQL functions
- Replaced overly permissive RLS policies with role-based controls

---

## [0.2.0] — 2026-02-15

### Added

- Packing Engine v2 (containers, pallets, state machine)
- Contract Configuration Manager
- Pallet Dashboard with state tracking
- Packing List and Invoice generation
- QR Code sticker generation

---

## [0.1.0] — 2026-01-20

### Added

- Initial release
- Item Master with CRUD operations
- Inventory Grid with warehouse stock view
- Stock Movement module with supervisor approval workflow
- Blanket Orders and Releases
- Demand Forecasting module
- MRP Planning module
- Enterprise UI design system
- Supabase authentication integration
