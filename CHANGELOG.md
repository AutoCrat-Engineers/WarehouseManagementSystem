# Changelog

All notable changes to the Warehouse Management System will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.5.8] — 2026-05-04

### Release Type: Patch — Mobile polish, Pallet Back-Chain & Release Review fixes

### Changed

- **Rack Storage (mobile)** — header redesigned for phones:
  compact 4-up KPI strip (Racks · Locations · Items · Qty) replaces the
  oversized 2×2 SummaryCards; rack tabs use `flex: 1` so all racks fit
  without a horizontal scrollbar; Move / Add Stock buttons are now a
  balanced 44px pair (equal flex, full width); Add Locs / Reduce
  stretch full-width with a 40px touch target.
- **Pallet Back-Chain drawer** —
  - Removed the **Packing List** section entirely.
  - Renamed *Inner Boxes* → **Inner Packing IDs**, switched the ID
    source from `container_number` to `packing_boxes.packing_id`,
    rendered as a compact 2-col (mobile) / 3-col (desktop) chip grid
    with internal scroll (max 280 px) so 60+ rows no longer hijack the
    drawer.
  - PALLET section's Shipment # now falls back to
    `shipment.shipment_number` when `pallet.shipment_sequence` is null
    (was always `—`).
  - Renamed `OH:` → `On-Hand:` with a tooltip explaining the value
    (US-warehouse total for that MSN across all racks). Mapping
    promoted to `usTransitOnHand → totalOnHand → usTransitStock` so
    the field actually populates from the dashboard view.
- **Blanket Release · Step 5 Review & Submit** —
  - Removed the *Customer Asked* row from the upper card.
  - Upper card now always shows **Quantity** (releasing qty) +
    **Unit Price** (from BPA) + **Release Value**.
  - Lower **Pallet Allocation** grid is now 4 columns: Shipment # ·
    Invoice # · **Unit Price** · Release Qty. Unit price comes from
    that invoice line's `parent_unit_price` (the MPL price), not from
    the BPA.

### Fixed

- Rack tabs no longer leak a grey horizontal scrollbar on phones.
- Move / Add Stock buttons no longer render at different sizes on
  mobile (the wrapped `ActionButton` was ignoring the `flex: 1`
  parent).
- Pallet Back-Chain drawer's Inner Boxes list no longer overflows the
  drawer height on pallets with many cartons.

---

## [0.5.7] — 2026-05-04

### Release Type: Minor — Inbound Receiving redesign (scan-driven, per-pallet)

### Added

- **Scan & Verify** flow replaces the MPL list. Receivers scan one
  pallet at a time, pick status, then **Verify · Place Now** or
  **Verify · Place Later**. Per-MPL Goods Receipts auto-commit in the
  background as their pallets are verified.
- **`pallet_resolve_qr`** edge function — resolves a scanned QR (v2
  UUID-first or legacy v1 pipe) to a pallet record + receive context.
- **`gr_drafts`** table + **`gr_draft_save / load / discard`** edge
  functions for per-(user, proforma, MPL) draft autosave with optimistic
  versioning.
- **`gr_inbound_overview`** edge function — today-focused KPIs +
  caller's resumable drafts + per-shipment draft activity.
- **RF-gun wedge listener** (`useWedgeScanner`) — global keydown capture
  with median-gap human-vs-wedge detection, multiline-payload tolerant.
- **Camera scanner** (`CameraScanner`) — native `BarcodeDetector` first,
  `@zxing/browser` fallback for iOS Safari, torch toggle, auto-close on
  decode.
- **Audit-grade exception capture** for damaged pallets — reason codes,
  required note, photo upload to private `gr-exception-photos` bucket.
  New columns on `goods_receipt_lines`: `reason_code`, `photo_paths`.
- **Mobile-first responsive shell** — full-viewport on phones, 44px
  touch targets, safe-area honored.
- **PWA shell** — `manifest.webmanifest`, hand-rolled service worker
  (`public/sw.js`) with network-first navigation + cache-first assets.
- **Offline scan queue** — IndexedDB-backed (`scanQueue.ts`) with
  auto-replay on reconnect.
- **Inbound dashboard** — clickable filter cards (BPA-style), FIFO sort,
  per-card Receive CTA on the oldest eligible card, search +
  Refresh + Receive Shipment unified into one toolbar, MY DRAFT / IN
  PROGRESS badges.
- **Quick-pick** on SEARCH step — top-2 oldest receivable shipments
  shown as one-tap cards above the manual search.
- **Step sidebar** (desktop) — 3-stage progress indicator (Match
  Shipment / Scan & Verify / Done).

### Changed

- **Pallet QR payload** upgraded to v2 (line-delimited tokens with
  `PALLET:<uuid>` first). Legacy v1 stickers continue to resolve via
  best-effort match in the resolver.
- **Receive flow** simplified from 5 steps to 3 (SEARCH → SCAN_PALLETS →
  DONE). MPL picker, per-MPL verify table, and exceptions-review
  interstitial removed in favor of the unified scan-driven screen.
- **DONE step** is a clean shipment summary — no putaway label print
  (pallets already carry QR), no frontend GRN print.
- **Per-pallet `received_qty` input** removed. Verification is by pallet
  presence, not by quantity.
- **`confirm_goods_receipt` RPC** body reissued (CREATE OR REPLACE) to
  populate `reason_code` and `photo_paths` on each line. Signature
  unchanged; backwards-compatible.

### Removed

- `ShipmentStep`, `MPLCard`, `VerifyMplStep`, `ExceptionsReviewStep`,
  `BottomNav`, the print-buttons `DoneStep`, the per-pallet quantity
  input, and the receive screen's separate filter-chip row.

### Migrations

- `061_gr_drafts.sql` — autosave drafts table with RLS and optimistic
  version column.
- `062_gr_exception_capture.sql` — adds `reason_code` and `photo_paths`
  to `goods_receipt_lines`, creates the private
  `gr-exception-photos` storage bucket, replaces the
  `confirm_goods_receipt` RPC body to persist the new fields.

See [`docs/releases/CHANGES_0.5.7.md`](docs/releases/CHANGES_0.5.7.md)
and [`docs/releases/RELEASE_0.5.7.md`](docs/releases/RELEASE_0.5.7.md)
for the full breakdown.

---

## [0.5.6] — 2026-05-03

### Release Type: Minor — Intelligent Pallet Allocation + S&V decommission

See [`docs/releases/CHANGES_0.5.6.md`](docs/releases/CHANGES_0.5.6.md)
and [`docs/releases/RELEASE_0.5.6.md`](docs/releases/RELEASE_0.5.6.md).

---

## [0.5.5] — 2026-04-25

### Release Type: Minor — Release Allocation Holds + Historical Data Import

### Added

- **Release Allocation Holds system** (migrations 044–048) — `release_pallet_holds` table tracks ALLOCATED vs RESERVED per (part × warehouse) at release-level priority (earliest `need_by_date` wins). Inventory views now expose 4 buckets per warehouse: On-Hand / Allocated / Reserved / Available
- **`release_allocate_pallets` edge function** — thin wrapper over the new RPC; resolves `warehouse_id` from pallet rack placement
- **`recompute_release_holds(part, warehouse_id)` RPC** — scope-wide priority recompute, called from any hold-changing path
- **Historical data import — Phases M1 → M4** (migrations 049–058) — first production import of legacy artefacts: 4 customer BPAs, 197 pallets across racks A–G, 30 FULFILLED releases, 31 sub-invoices, 31 CLAIMED tariff invoices. Four procurement scenarios modelled (Standard PO, Real BPA, Informal Borrow, Synthesized BPA)
- **Release notes** — [`docs/releases/CHANGES_0.5.5.md`](docs/releases/CHANGES_0.5.5.md)
- **Release report** — [`docs/releases/RELEASE_0.5.5.md`](docs/releases/RELEASE_0.5.5.md) (executive summary)
- **Implementation report** — [`docs/releases/IMPLEMENTATION_0.5.4_TO_0.5.5.md`](docs/releases/IMPLEMENTATION_0.5.4_TO_0.5.5.md) (full technical change log)

### Changed

- **Stock-deduction timing** — `On-Hand` is decremented only when a release flips to `DELIVERED`, not on sub-invoice creation. The premature `trg_rpa_drain_hold` trigger was replaced by `trg_br_delivered_drain_holds`
- **MPL cancellation cascade** — `master_packing_lists.status = 'CANCELLED'` now propagates to `master_packing_list_pallets.status` via `trg_mpl_cancel_sync_mpp`. The MPP `status` CHECK now permits `CANCELLED`. Rack drawer no longer surfaces cancelled paperwork
- **`pallet_get_back_chain` edge function** — sorts non-cancelled MPLs first and active MPP rows ahead of stale ones
- **`vw_item_stock_distribution` view** — rebuilt to expose four buckets per warehouse; `ItemStockDistribution` and `ItemStockDashboard` TS types updated to match
- **`ReleaseList.tsx` / `TariffInvoiceQueue.tsx` default filters** — switched from `OPEN`/`DRAFT` to `ALL` so migrated FULFILLED/CLAIMED rows are visible on first load
- **`StockDistributionCard.tsx`** — new `BucketStat` component; US 3PL panel renders 4-bucket breakdown
- **`UnifiedItemMaster.tsx`** — US Warehouse card surfaces Allocated, Reserved, Available alongside On-Hand
- **`CreateRelease.tsx` wizard** — calls `allocateReleasePallets` between `createRelease` and `createSubInvoice` so holds exist before stock drains

### Fixed

- **On-Hand inflated by 10k** after fulfilling two releases — root cause was migration 046 reversing by assignment qty (30k) instead of actual ledger deductions (20k). Fixed in 047 by debiting the over-credit from `inv_stock_ledger.RELEASE_OUT`
- **Both releases showing ALLOCATED instead of one ALLOCATED + one RESERVED** — per-pallet unique partial index forced both releases to win. Index dropped; `recompute_release_holds` now sets exactly one winner per `(part × warehouse)` scope
- **Inbound Receiving dashboard counters at 0** for migrated proformas — `proforma_invoice_mpls` junction was not seeded by M2. Migration 055 backfills it and links `goods_receipts.mpl_id` / `proforma_invoice_id`
- **Rack Storage UI showing empty grid** for migrated pallets — M2 wrote codes as `A-01` but the RackView generator keys cells as `A1`. Migration 056 strips the dash and leading zeros
- **BPA dashboard "Released $0 / 0% fulfillment"** for migrated BPAs — `mv_bpa_fulfillment_dashboard` joins through `blanket_order_line_configs.released_quantity` which M3 never updated. Migrations 053 + 054 roll up from `blanket_releases`; 058 backfills `warehouse_rack_locations.agreement_id` so the lateral rack-stats join returns rows. Both materialized views are now refreshed at the end of each migration
- **Item Master "No Releases Yet"** on parts with M3 history — M3 seeded `pack_sub_invoices` headers but no line rows. Migration 057 seeds one line per sub-invoice and back-links `line_config_id`

### Deferred

- **`inv_stock_ledger` back-fill for M2** — historical pallet inserts credit `inv_warehouse_stock` directly; explicit ledger rows are not written. A future M5 can synthesize `RECEIPT_IN` rows if a full audit trail is required
- **`260099999` synthetic catch-all BPA** — schema reserves the `MIGRATION_PLACEHOLDER` source value but no rows are seeded yet; held until the next batch of back-fill data arrives
- **Cross-BPA shared parts** — schema supports it; demo dataset does not yet exercise the path

### Security

- No new attack surface. `release_allocate_pallets` is a `SECURITY DEFINER` RPC behind a JWT-auth edge function; migration SQL runs only under `service_role` via `supabase db push`

### Docs

- New release notes, three new architecture files, this CHANGELOG entry, `00_INDEX.md` migration count refreshed (018–058) and edge-function count bumped (58 → 59)

---

## [0.5.4] — 2026-04-21

### Release Type: Minor — Item Master Edge Functions, Soft Delete & Schema Migration Groundwork

### Added

- **Item Master Edge Functions (`im_*`)** — four new Supabase functions covering the entire Item Master module:
  - `im_list-items` — list + 3 summary counts in a single round trip (server-side sort, search, filter, pagination)
  - `im_get-blanket-orders` — replaces direct `v_item_details` SELECT in PackingDetail modal
  - `im_upsert-item` — single endpoint for create / update branches
  - `im_delete-item` — reversible soft delete (see _Changed_ below)
- **Schema Migration Plan** — [`docs/SCHEMA_MIGRATION_item_code_to_part_number.md`](docs/SCHEMA_MIGRATION_item_code_to_part_number.md) documents the 6-phase `item_code → part_number` cutover across 13 FK tables + 11 denormalized tables + 17 edge functions
- **Release Notes** — [`docs/releases/CHANGES_0.5.4.md`](docs/releases/CHANGES_0.5.4.md)

### Changed

- **Item deletion semantics — HARD CASCADE → SOFT DELETE** — `im_delete-item` now sets `items.is_active = false` instead of deleting the row + cascading through 13 child tables. Audit log captures a full pre-delete snapshot; an accidental delete is reversed by flipping the flag. Idempotent on already-inactive rows.
- **`items.part_number` is now UNIQUE** — `items_part_number_unique` constraint added after resolving 5 pre-existing duplicates via rename + deactivate (zero data loss)
- **Dependent tables carry `part_number_new`** — 24 child tables (13 FK tables + 11 denormalized `pack_*` / packing tables) now have a populated `part_number_new` column with an FK to `items.part_number`. Legacy `item_code` columns remain in place; Phase 3b cutover deferred pending backup
- **Delete audit keys on `part_number`** — `im_delete-item` writes `audit_log.target_id = part_number` (was `item_code`); response payload and UI toast prefer `part_number` first
- **`src/utils/api/itemsSupabase.ts`** — rewritten as a thin wrapper over the four `im_*` edge functions. Public API (`Item`, `ItemFormData`, `fetchItems`, `createItem`, `updateItem`, `deleteItem`) unchanged
- **`UnifiedItemMaster.tsx`** — removed direct Supabase client imports; `fetchCounts` folded into `fetchItems`; delete-success toast copy updated from "permanently deleted" to "deactivated"

### Deferred

- **Phase 3b / 4 / 5 of the schema migration** — dropping `items.item_code`, renaming `part_number_new → part_number`, and rewriting 17 edge functions + 3 RPCs + 14 views against `part_number` is held until a verified `pg_dump` backup (or Supabase Pro PITR) is available. All applied phases are additive and reversible.

### Security

- **No new attack surface** — soft delete preserves FK integrity (no orphaned child rows). JWT-derived `user_id` in the audit log prevents spoofing via the request body.

### Docs

- New release notes, schema migration plan, and this CHANGELOG entry

---

## [0.5.3] — 2026-04-18

### Release Type: Patch — Edge Function Reorganization & Documentation Refresh

### Added

- **Edge Function READMEs** — per-function documentation for all 10 Supabase functions covering purpose, request/response schemas, error codes, env vars, and local-test commands
- **Master Edge Function Index** — [`supabase/functions/README.md`](supabase/functions/README.md) documents all functions, naming convention, deployment workflow, and contribution guide
- **Environment Template** — [`supabase/functions/.env.example`](supabase/functions/.env.example) with placeholders for auto-injected and custom secrets
- **ADR Process** — [`docs/adr/`](docs/adr/) with index, MADR-format template, and the first ADR documenting the Stock Movement function prefix + JWT auth decision
- **CODEOWNERS** — [`.github/CODEOWNERS`](.github/CODEOWNERS) with placeholder team handles mapping paths to review ownership
- **Release Notes** — [`docs/releases/CHANGES_0.5.3.md`](docs/releases/CHANGES_0.5.3.md)
- **Item search debounce** — 300ms debounce on the New Stock Movement item search input (collapses typing bursts into a single request)

### Changed

- **Edge Function Naming** — all Stock Movement functions renamed with `sm_` prefix (e.g. `approve-movement` → `sm_approve-movement`); visual grouping in Supabase dashboard
- **Edge Function Auth** — `userClient` now uses a custom `PUBLISHABLE_KEY` secret instead of the reserved `SUPABASE_ANON_KEY`; `auth.getUser(jwt)` called with explicit JWT; `auth: { persistSession: false, autoRefreshToken: false }` set on all edge-function Supabase clients
- **Deployment Flag** — all functions deployed with `--no-verify-jwt` so CORS preflight reaches the in-function handler
- **Client URLs** — [`StockMovement.tsx`](src/components/StockMovement.tsx) `FUNCTIONS_BASE` URLs point to new `sm_*` paths
- **`.env.local`** — `VITE_FUNCTIONS_URL` override removed so frontend uses the deployed Supabase URL

### Fixed

- **401 Unauthorized on edge functions** — root cause was the legacy HS256 anon key being used against new ES256 user JWTs; resolved by migrating to the current `sb_publishable_*` key via the `PUBLISHABLE_KEY` custom secret
- **CORS preflight failures** — resolved by deploying with `--no-verify-jwt`; OPTIONS requests now receive CORS headers from the in-function handler

### Deprecated

- Old (unprefixed) edge function deployments remain live on Supabase but are **unreferenced by client code**. Should be deleted from the dashboard.

### Security

- Flagged hardcoded legacy JWT fallback in [`src/utils/supabase/info.tsx`](src/utils/supabase/info.tsx). Anon key is expected to be public for SPAs, but the fallback is now stale after publishable-key rotation. Follow-up patch to sync.

### Docs

- 13 new markdown files under `supabase/functions/`, `docs/adr/`, `.github/`, and `docs/releases/`

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
