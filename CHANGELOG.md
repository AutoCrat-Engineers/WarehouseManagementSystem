# Changelog

All notable changes to the Warehouse Management System will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
