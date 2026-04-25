# Implementation Report — 0.5.4 → 0.5.5

> **Range:** 2026-04-21 (v0.5.4) → 2026-04-25 (v0.5.5) · **Cycle length:** 4 days
> **Branches involved:** `develop-test` · **Audience:** engineering, ops, QA, SRE
>
> This document is the single source of truth for *every* file that
> changed between 0.5.4 and 0.5.5. It is exhaustive on purpose — front
> end, database, edge functions, scripts, documentation. Use the Table
> of Contents to skim.

---

## Table of Contents

1. [Executive summary](#1-executive-summary)
2. [Database — DDL, RPCs, triggers](#2-database--ddl-rpcs-triggers)
3. [Database — Historical data import (M1 → M4)](#3-database--historical-data-import-m1--m4)
4. [Edge functions](#4-edge-functions)
5. [Frontend — components, services, types](#5-frontend--components-services-types)
6. [Scripts and tooling](#6-scripts-and-tooling)
7. [Documentation](#7-documentation)
8. [Configuration and metadata](#8-configuration-and-metadata)
9. [Cross-cutting bug fixes](#9-cross-cutting-bug-fixes)
10. [Verification recipes](#10-verification-recipes)
11. [Rollback recipe](#11-rollback-recipe)
12. [Known limitations and follow-ups](#12-known-limitations-and-follow-ups)

---

## 1. Executive summary

Two work streams ship in this release:

**A. Release Allocation Holds System** (DB migrations 044 → 048)
Inventory now exposes four buckets per `(part × warehouse)` —
`On-Hand / Allocated / Reserved / Available`. Stock decrements only
on delivery, not on sub-invoice creation. MPL cancellations cascade
to pallets so cancelled paperwork stops surfacing in rack views.

**B. Historical Data Import** (DB migrations 049 → 058)
First production import of legacy spreadsheets and PDFs: **4 BPAs,
197 pallets, 30 releases, 31 sub-invoices, 31 tariff invoices**.
Four procurement scenarios are now exercised by real data — Standard
PO, Real BPA, Informal Borrow, Synthesized BPA.

**Counts:** 15 new DB migrations · 1 new edge function · 6 modified
edge functions · 7 new UI components · 3 modified UI components ·
3 new docs · 7 docs refreshed.

---

## 2. Database — DDL, RPCs, triggers

### 2.1 Migrations 044–048 — Release Allocation Holds

#### 044 — `release_pallet_holds` table + RPC + view rebuild

| Object | Change |
|---|---|
| `public.release_pallet_holds` | **NEW table.** Columns: `id, release_id, pallet_id, hold_type ('ALLOCATED'\|'RESERVED'), scope_part_number, scope_warehouse_id, qty, created_at, updated_at`. Unique partial index on `(release_id, pallet_id)`. |
| `release_allocate_pallets(release_id uuid, holds jsonb)` | **NEW RPC.** Inserts one hold per pallet then runs `recompute_release_holds` for the scope. SECURITY DEFINER. |
| `recompute_release_holds(part_number text, warehouse_id uuid)` | **NEW RPC.** For each `(part × warehouse)` scope, picks the OPEN release with the earliest `need_by_date` as the ALLOCATED winner; everything else becomes RESERVED. |
| `vw_item_stock_distribution` | **REBUILT.** New columns per warehouse: `*_on_hand, *_allocated, *_reserved, *_available`. The view subtracts active holds from on-hand to compute `available`. |
| `trg_promote_hold_on_release_open` | **NEW trigger** on `blanket_releases` (`AFTER INSERT/UPDATE WHEN status='OPEN'`) — calls `recompute_release_holds`. |

#### 045 — Backfill + delivery-gated drain

| Object | Change |
|---|---|
| `release_pallet_holds` (data) | **BACKFILL.** Insert one ALLOCATED hold per `release_pallet_assignments` row whose linked release is still OPEN. |
| `trg_rpa_drain_hold` | **DROPPED.** This trigger drained holds when sub-invoice assignments were inserted — too eager. |
| `trg_br_delivered_drain_holds` | **NEW trigger** on `blanket_releases` (`AFTER UPDATE WHEN status = 'DELIVERED'`) — deletes the corresponding holds. The hold survives all the way to delivery. |

#### 046 — Release-level priority + reverse premature deductions

| Object | Change |
|---|---|
| Per-pallet unique partial index on holds | **DROPPED.** Was forcing every release to win, defeating the priority logic. |
| `recompute_release_holds` | **MODIFIED.** Now picks exactly one ALLOCATED winner per `(part × warehouse)` scope. |
| `inv_warehouse_stock` (data) | **CORRECTION.** Reverse on-hand deductions written by the old `trg_rpa_drain_hold`. |

#### 047 — Fix reversal over-credit

| Object | Change |
|---|---|
| `inv_warehouse_stock` (data) | **CORRECTION.** Migration 046 reversed by assignment qty (e.g. 30k) instead of actual ledger qty (e.g. 20k). 047 reads the true reversed qty from `inv_stock_ledger.RELEASE_OUT` and debits the over-credit. |

#### 048 — Sync MPP status on MPL cancel

| Object | Change |
|---|---|
| `master_packing_list_pallets.status` CHECK | **EXPANDED** to permit `'CANCELLED'`. |
| `trg_mpl_cancel_sync_mpp` | **NEW trigger** on `master_packing_lists` (`AFTER UPDATE WHEN status = 'CANCELLED'`) — sets every dependent `master_packing_list_pallets.status = 'CANCELLED'`. |

### 2.2 Materialized views & their refresh

| View | Status | Refresh strategy |
|---|---|---|
| `mv_rack_view` | Materialized | Refreshed at the end of migrations 053, 054, 058 |
| `mv_bpa_fulfillment_dashboard` | Materialized | Same — refreshed inside the migration so verification reads fresh data |

Both views were also previously refreshed via `pg_notify` triggers
on data changes; the explicit refresh inside migrations is needed
because pg_notify is async and the refresh listener is the
`refresh_views_cron` edge function (not an in-DB worker).

---

## 3. Database — Historical data import (M1 → M4)

### 3.1 Migration 049 — Schema prep

| Object | Change |
|---|---|
| `customer_agreement_parts.source` | **NEW enum values** added: `'MIGRATION'`, `'MIGRATION_INFORMAL'`, `'MIGRATION_PLACEHOLDER'`. |
| `cap_integrity_check` constraint | **RELAXED.** Strict fields (drawing_number, drawing_revision, customer_part_number) required only for real BPAs (`source = 'MANUAL'` or `'MIGRATION'`). Skipped for `MIGRATION_INFORMAL` / `MIGRATION_PLACEHOLDER`. |
| `pack_proforma_invoices.shipment_mode, transporter, tracking_number` | **NEW columns** (text). |

### 3.2 Migration 050 — M1 Agreements

Idempotent DELETE-then-INSERT for 4 BPAs:

| Agreement # | Type | Customer | Parts | Source |
|---|---|---|---|---|
| 260067031 | SPOT | OPW Fueling | 1 (OPW-30 / HW-LS-0350) | `MIGRATION` |
| 260067252 | BPA | OPW Fueling | 1 (OPW-29 / HW-LS-0022) | `MIGRATION` |
| 260067251 | BPA | OPW Fueling | 2 (OPW-69 / 205777 + **OPW-70 / 205737 informal**) | `MIGRATION` + `MIGRATION_INFORMAL` |
| 260067299 | BPA (synthesized) | OPW Fueling | 1 (OPW-60 / 212372) | `MIGRATION` |

Verification: `[M1] Seeded 4 agreements, 5 part rows`.

### 3.3 Migration 051 — M2 Shipments

| Table | Rows inserted |
|---|---|
| `pack_packing_lists` | 27 (one stub per invoice × part) |
| `pack_invoices` | 27 (`status = 'CONFIRMED'`, `source = 'MIGRATION'`) |
| `pack_invoice_line_items` | 27 |
| `pack_proforma_invoices` | 27 (`status = 'STOCK_MOVED'`, `shipment_mode = 'Sea'`) |
| `master_packing_lists` | 27 (`status = 'DISPATCHED'`, `mpl_number LIKE 'MPL-M-%'`) |
| `master_packing_list_pallets` | 197 |
| `pack_pallets` | 197 (`pallet_number LIKE 'PLT-2526%'`, state = `IN_3PL_WAREHOUSE`) |
| `warehouse_rack_locations` | 197 (racks A–G) |
| `goods_receipts` | 27 (`gr_number LIKE 'GR-M-%'`, `status = 'COMPLETED'`) |
| `goods_receipt_lines` | 197 |
| `inv_warehouse_stock` (`WH-US-TRANSIT`) | Direct credit per part |

Verification: `[M2] proformas=27, pallets=197, gr=27, gr_lines=197`.

### 3.4 Migration 052 — M3 Releases

| Table | Rows inserted |
|---|---|
| `blanket_orders` | 4 (legacy mirror — required as FK target for releases) |
| `blanket_order_lines` | 5 |
| `blanket_releases` | 30 (`status = 'FULFILLED'`, `source = 'MIGRATION'`) |
| `pack_sub_invoices` | 31 (`status = 'PICKED_UP'`) |
| `release_pallet_assignments` | 84 (FIFO pallet selection) |
| `tariff_invoices` | 31 (`status = 'CLAIMED'`, `source = 'MIGRATION'`) |
| `pack_pallets` (state update) | 84 → state `RELEASED` |

Verification: `[M3] releases=30, sub_invoices=31, assignments=84, tariff_invoices=31, released_pallets=84`.

### 3.5 Migrations 053–054 — M4 Rollups

| Object | Change |
|---|---|
| `blanket_order_line_configs` | One row per `(agreement × part)` upserted. Columns populated: `released_quantity, released_value, total_releases, total_sub_invoices, delivered_quantity`. |
| `pack_sub_invoices.line_config_id` | Back-linked. |
| `mv_bpa_fulfillment_dashboard` | Refreshed. |
| `mv_rack_view` | Refreshed. |

054 fixes 053's source — released qty now rolls up from
`blanket_releases` (which were seeded), not from
`pack_sub_invoice_lines` (which were not seeded until 057).

Verification: `[M4-fix] bolc released_sum=N, view released_sum=N`.

### 3.6 Migration 055 — Inbound Receiving links

| Object | Change |
|---|---|
| `proforma_invoice_mpls` | Junction populated (1 row per migrated MPL). |
| `goods_receipts.mpl_id` | Back-linked from `master_packing_lists.proforma_invoice_id`. |
| `goods_receipts.proforma_invoice_id` | Back-linked from `proforma_number`. |
| `pack_proforma_invoices.status` | Flipped to `RECEIVED` if not already in the `STOCK_MOVED / DISPATCHED / RECEIVED` set. |

Without this fix, the Inbound Receiving dashboard reported
`MPLS=0, EXPECTED=0` on every shipment card.

### 3.7 Migration 056 — Rack code format

`goods_receipt_lines.rack_location_code` rewritten from
`A-01 / A-02 / …` to `A1 / A2 / …` to match the
`RackView.tsx` grid-key generator (`${rack}${i}`).

### 3.8 Migration 057 — Sub-invoice lines

`pack_sub_invoice_lines` seeded with one line per migrated
sub-invoice (single-part invoices per scenario). Drives the
"No Releases Yet" → "✓ Released" UI on the Item Master detail
page.

### 3.9 Migration 058 — `warehouse_rack_locations.agreement_id` back-fill

M2 inserted `agreement_number` (text) but not `agreement_id` (uuid).
The `mv_bpa_fulfillment_dashboard` lateral join uses
`rl.agreement_id = ca.id` and was returning zero pallets-in-rack.
058 fills in the UUID and refreshes the MV.

### 3.10 Provenance summary

| `source` value | Where written | Count after 0.5.5 |
|---|---|---|
| `MIGRATION` | most rows | ~600+ across all tables |
| `MIGRATION_INFORMAL` | OPW-70 part row | 1 |
| `MIGRATION_PLACEHOLDER` | reserved for catch-all `260099999` | 0 (not yet exercised) |
| `MANUAL` | live RPCs (release_create, sub_invoice_create, etc.) | unchanged |

---

## 4. Edge functions

### 4.1 New (1)

| Function | Purpose |
|---|---|
| `release_allocate_pallets` | Wrapper over the RPC of the same name. Resolves `warehouse_id` from the pallet's rack placement (via `warehouse_rack_locations` → `inv_warehouses`) and forwards a hold list. Called from `CreateRelease.tsx` between `release_create` and `sub_invoice_create`. |

### 4.2 Modified (6)

| Function | Change |
|---|---|
| `pallet_get_back_chain` | Sort order changed: non-cancelled MPL rows first, then ACTIVE MPP rows, then most recent dispatch/created. Eliminates rack-drawer UI showing cancelled paperwork. |
| `release_list` | Returns `sub_invoice_lines` array (parent invoice, qty, pallet count, unit price). Falls back to `release_pallet_assignments` for `part_number` / `msn_code` when `line_config_id` is null. |
| `bpa_list` | Returns per-BPA fulfillment aggregates (`blanket_quantity, released_quantity, delivered_quantity, in_rack_value, pallets_in_rack`) sourced from `mv_bpa_fulfillment_dashboard`. Existing call sites unchanged. |
| `release_list_available_pallets` | Filters by 4-bucket-aware `Available` (not raw on-hand) so users can't double-allocate. |
| `shipment_dashboard_list` | Reads through `proforma_invoice_mpls` junction (now populated by 055). |
| `rack_view_get` | Surfaces `agreement_id` on each cell so BPA dashboard's lateral rack-stats join finds rows. |

### 4.3 Unchanged but newly exercised

`bo_get_dashboard`, `bpa_amend`, `bpa_cancel`, `bpa_get`,
`bpa_upload_document`, `tariff_invoice_compute`, `tariff_submit`,
`tariff_invoice_list`, `gr_search_proformas`,
`gr_get_proforma_breakdown`, `gr_confirm_receipt`,
`gr_list_pending_placement`, `gr_mark_placed`, `pending_placement_list`,
`shipment_detail_get`, `rack_get_cell_chain`, `rack_load_storage`,
`pallet_place`, `pallet_move`, `release_fifo_suggest`,
`release_parse_po_number`, `item_get_full_detail`, `sub_invoice_create` —
no code change but exercised at scale for the first time by
the migration data.

### 4.4 Total count

58 → **59** active edge functions (1 added, 0 deprecated).

---

## 5. Frontend — components, services, types

### 5.1 New components (7)

| File | Purpose |
|---|---|
| `src/components/release/CreateRelease.tsx` | Multi-step release wizard (BPA pick → pallet selection → allocate-holds → confirm). Calls `releaseService.createRelease → allocateReleasePallets → createSubInvoice`. |
| `src/components/release/ReleaseList.tsx` | Drafted / Completed / Cancelled releases tabbed view. Default filter `ALL` (changed mid-cycle from `OPEN`). |
| `src/components/release/TariffInvoiceQueue.tsx` | Finance queue: DRAFT → SUBMITTED → CLAIMED → PAID with per-row Compute + Submit actions. Default filter `ALL`. |
| `src/components/bpa/BPAList.tsx` | Customer agreement portfolio with Portfolio Strip (4 KPIs), filter chips, expandable Part cards rolling up across BPAs. |
| `src/components/bpa/BPADetail.tsx` | Per-BPA modal with revisions, line-level table, document attachments, cancel action. Renders an `INFORMAL` badge for `MIGRATION_INFORMAL` parts. |
| `src/components/bpa/BPACreate.tsx` / `BPAAmend.tsx` | Create + amend wizards. |
| `src/components/rack-view/RackViewGrid.tsx` / `ReceiveShipmentScreen.tsx` / `RackCellDrawer.tsx` / `MovePalletDialog.tsx` | Inbound receiving dashboard + per-MPL goods-receipt verification + cell drawer with pallet back-chain. |

### 5.2 Modified components (3)

| File | Change |
|---|---|
| `src/components/StockDistributionCard.tsx` | New `BucketStat` sub-component. US 3PL panel renders 4 buckets (`On-Hand / Allocated / Reserved / Available`) above the existing 3-card row. |
| `src/components/UnifiedItemMaster.tsx` | US Warehouse card surfaces Allocated, Reserved, Available alongside On-Hand using `(distribution as any)?.usTransit*`. |
| `src/components/release/ReleaseList.tsx` (default filter) | `OPEN` → `ALL` so M3 `FULFILLED` releases are visible on first load. |
| `src/components/release/TariffInvoiceQueue.tsx` (default filter) | `DRAFT` → `ALL` so M3 `CLAIMED` tariffs are visible on first load. |

### 5.3 Service / type changes

| File | Change |
|---|---|
| `src/components/release/releaseService.ts` | **NEW** `allocateReleasePallets()` function. **NEW** `PalletHoldInput` interface. |
| `src/components/release/types.ts` | `ReleaseStatus` confirmed = `'OPEN' \| 'FULFILLED' \| 'CANCELLED'`. `TariffStatus` confirmed = `'DRAFT' \| 'SUBMITTED' \| 'CLAIMED' \| 'PAID' \| 'CANCELLED'`. |
| `src/types/inventory.ts` | **NEW** fields on `ItemStockDistribution`: `usTransitOnHand, usTransitAllocated, usTransitReserved, usTransitAvailable`. **NEW** field on `ItemStockDashboard`: `productionAllocated`. |
| `src/components/bpa/bpaService.ts` / `types.ts` | Already in place pre-cycle; exercised at scale by migration data. |

### 5.4 No-op

App-shell (`App.tsx`), auth (`auth/*`), forecasting/MRP (`ForecastingModule.tsx`, `PlanningModule.tsx`), packing engine (`packing-engine/*`) — untouched.

---

## 6. Scripts and tooling

No new tracked scripts. The historical-import SQL (migrations 051 and
052) was hand-tuned from xlsx sources during development; the source
xlsx and the working notebooks live under the gitignored `.db/`
directory and are not part of the remote repo.

`scripts/dev/` remains the gitignored home for ad-hoc local
utilities — only its README is tracked.

---

## 7. Documentation

### 7.1 New (3)

| File | Purpose |
|---|---|
| `docs/releases/CHANGES_0.5.5.md` | Release notes (Keep-a-Changelog format) |
| `docs/releases/RELEASE_0.5.5.md` | Executive release report |
| `docs/releases/IMPLEMENTATION_0.5.4_TO_0.5.5.md` | This file |

### 7.2 Updated (7)

| File | Change |
|---|---|
| `README.md` | Version badge `0.5.4 → 0.5.5`. Added 9 modules to Key Features (BPA, Releases, Allocation Holds, Receiving, Rack, Sub-Invoices, Tariff). Database Schema table refreshed with new tables. Full v0.5.5 entry in Recent Changes. Version history updated. |
| `CHANGELOG.md` | New v0.5.5 entry, structured Added/Changed/Fixed/Deferred/Security/Docs. |
| `docs/MODULE_OVERVIEW.md` | Version `0.5.0 → 0.5.5`. New "Customer-Facing Workflow Modules" section. 4-bucket Stock Distribution Card noted in Support Modules. |
| `docs/DATABASE_SCHEMA.md` | Version `0.5.0 → 0.5.5`. Item Management section notes the `part_number` migration. Three new sections: §7 Customer Agreements & Releases, §8 Release Allocation Holds, §9 Sub-Invoices, Tariff & Inbound Receiving. |
| `docs/architecture.md` | Version + cross-link to this file. |
| `docs/architecture/00-ARCHITECTURE-INDEX.md` | Version `0.5.0 → 0.5.5` + cross-link. |
| `supabase/functions/README.md` | Active function table grew 10 → **59**. Naming-convention table expanded to 13 prefixes. `release_allocate_pallets` and `pallet_get_back_chain` highlighted as new in 0.5.5. |

### 7.3 Removed (1)

| File | Reason |
|---|---|
| `docs/archive/implementation-plan.md` | Obsolete historical plan ("all phases complete") — superseded by current docs. |

---

## 8. Configuration and metadata

| File | Change |
|---|---|
| `package.json` | `version: 0.5.4 → 0.5.5` |
| `.gitignore` | No change — `.db/`, `supabase/migrations/`, `.env*`, `scripts/dev/*` already excluded. The historical-import xlsx and PDFs live under `.db/` and are local-only by design. |
| `.env`, `.env.local`, `supabase/.env.local` | Untouched. |

---

## 9. Cross-cutting bug fixes

These bugs surfaced during 0.5.5 work and are fixed in this release:

1. **On-Hand inflated by 10k after fulfilling 2 releases.** Migration 046 reversed by assignment qty (30k) instead of actual ledger qty (20k). Fixed in 047.
2. **Both releases showing ALLOCATED instead of one ALLOCATED + one RESERVED.** Per-pallet unique partial index defeated the priority logic. Index dropped; `recompute_release_holds` rewritten.
3. **`trg_rpa_drain_hold` decremented stock on sub-invoice creation.** Replaced by delivery-gated `trg_br_delivered_drain_holds`.
4. **Rack drawer surfaced cancelled MPL.** `pallet_get_back_chain` re-sorted; migration 048 cascades MPL cancel to MPP.
5. **Inbound Receiving counters at 0** for migrated proformas → `proforma_invoice_mpls` was empty. Fixed in 055.
6. **Rack Storage UI showed empty grid** for migrated pallets → `A-01` ≠ `A1`. Fixed in 056.
7. **BPA dashboard "Released $0 / 0%"** for migrated BPAs → bolc never updated. Fixed in 053 + 054 + 058 (refresh MV).
8. **Item Master "No Releases Yet"** on migrated parts → sub-invoice-lines were empty. Fixed in 057.
9. **Release List / Tariff Queue showed empty list on first load** → defaults filtered out FULFILLED / CLAIMED. Fixed in `ReleaseList.tsx` and `TariffInvoiceQueue.tsx` defaults.

---

## 10. Verification recipes

### 10.1 Migration apply log

After `supabase db push` you should see (in order):

```
Applying migration 049_migration_prep.sql
Applying migration 050_migration_M1_agreements.sql
NOTICE:  [M1] Seeded 4 agreements, 5 part rows
Applying migration 051_migration_M2_shipments.sql
NOTICE:  [M2] proformas=27, pallets=197, gr=27, gr_lines=197
Applying migration 052_migration_M3_releases.sql
NOTICE:  [M3] releases=30, sub_invoices=31, assignments=84,
              tariff_invoices=31, released_pallets=84
Applying migration 053_migration_M4_bolc_rollup_and_refresh.sql
NOTICE:  [M4] bolc rows=4, released_sum=N | mv rows=N, mv_released_sum=N
Applying migration 054_fix_bolc_rollup_from_releases.sql
NOTICE:  [M4-fix] bolc released_sum=85452, view released_sum=85452
Applying migration 055_fix_inbound_receiving_links.sql
NOTICE:  [055] pim=27, mpls=27, gr_with_mpl=27, pi_ready=27
Applying migration 056_fix_rack_location_format.sql
NOTICE:  [056] remaining old-format rows=0, sample new code=A1
Applying migration 057_seed_sub_invoice_lines.sql
NOTICE:  [057] headers=31, lines=31, distinct_parts=5
Applying migration 058_backfill_rack_location_agreement_id.sql
NOTICE:  [058] rack_locs with agreement_id=197, remaining null+has_number=0
```

### 10.2 UI smoke test

1. **BPA List** — should show 4 cards with non-zero "Released" and "% Fulfillment".
2. **Release List** — default `ALL` tab; 30 FULFILLED rows visible.
3. **Tariff Invoice Queue** — default `ALL` tab; 31 CLAIMED rows visible.
4. **Inbound Receiving** — 27 shipment cards with non-zero MPL/Pallet counts.
5. **Rack Storage** — racks A–G populated; click any cell, drawer shows the back-chain (BPA → Invoice → MPL → Pallet → Release).
6. **Item Master** (e.g. OPW-29) — "Releases" tab shows multiple sub-invoice lines.
7. **Inventory hub** — for OPW-29 / OPW-69 the US 3PL panel shows non-zero values across all 4 buckets.

---

## 11. Rollback recipe

Live (`MANUAL`) rows are untouched. Schema is preserved.

```sql
BEGIN;

-- 1. Tariff & sub-invoice
DELETE FROM tariff_invoices            WHERE source = 'MIGRATION';
DELETE FROM release_pallet_assignments WHERE source = 'MIGRATION';
DELETE FROM pack_sub_invoice_lines
 WHERE sub_invoice_id IN
       (SELECT id FROM pack_sub_invoices WHERE source = 'MIGRATION');
DELETE FROM pack_sub_invoices          WHERE source = 'MIGRATION';

-- 2. Releases
DELETE FROM blanket_releases           WHERE source = 'MIGRATION';
DELETE FROM blanket_order_line_configs WHERE source = 'MIGRATION';
DELETE FROM blanket_order_lines
 WHERE blanket_order_id IN
       (SELECT id FROM blanket_orders WHERE order_number IN
              ('260067031','260067252','260067251','260067299'));
DELETE FROM blanket_orders             WHERE order_number IN
       ('260067031','260067252','260067251','260067299');

-- 3. Goods receipt + rack
DELETE FROM goods_receipt_lines
 WHERE gr_id IN
       (SELECT id FROM goods_receipts WHERE notes = 'MIGRATION historical import');
DELETE FROM goods_receipts             WHERE notes = 'MIGRATION historical import';
DELETE FROM warehouse_rack_locations   WHERE source = 'MIGRATION';

-- 4. MPL & proforma
DELETE FROM master_packing_list_pallets
 WHERE mpl_id IN
       (SELECT id FROM master_packing_lists WHERE mpl_number LIKE 'MPL-M-%');
DELETE FROM master_packing_lists       WHERE mpl_number LIKE 'MPL-M-%';
DELETE FROM proforma_invoice_mpls
 WHERE proforma_id IN
       (SELECT id FROM pack_proforma_invoices WHERE proforma_number LIKE 'PI-2526%');
DELETE FROM pack_proforma_invoices     WHERE proforma_number LIKE 'PI-2526%';

-- 5. Pallets & invoices
DELETE FROM pack_pallets               WHERE pallet_number LIKE 'PLT-2526%';
DELETE FROM pack_invoice_line_items    WHERE source = 'MIGRATION';
DELETE FROM pack_invoices              WHERE source = 'MIGRATION';

-- 6. Agreements (CASCADE through customer_agreement_parts/revisions)
DELETE FROM customer_agreements        WHERE source LIKE 'MIGRATION%';

-- 7. Refresh views
REFRESH MATERIALIZED VIEW mv_rack_view;
REFRESH MATERIALIZED VIEW mv_bpa_fulfillment_dashboard;

COMMIT;
```

For the **allocation-holds system** there is no rollback target —
the new behaviour is a strict superset of the old. Reverting would
require dropping migrations 044–048, which is unsupported.

---

## 12. Known limitations and follow-ups

| # | Item | Owner | Target |
|---|---|---|---|
| 1 | `inv_stock_ledger` not back-filled for M2 — historical pallet inserts credit `inv_warehouse_stock` directly without an audit trail | TBD | Optional M5 |
| 2 | `260099999` synthetic catch-all BPA reserved but not seeded — needs the next batch of unidentified shipment data | TBD | When data arrives |
| 3 | Cross-BPA shared parts not exercised by demo data — schema supports it; needs a real example | TBD | Future cycle |
| 4 | `mv_bpa_fulfillment_dashboard` is still materialized + manually refreshed inside migrations — could be converted to a regular view (always fresh, no refresh needed) | DB team | Cleanup ticket |
| 5 | `release_allocate_pallets` edge function does not yet enforce per-warehouse caller authorisation (any L2+ user can allocate). Add explicit GRBAC permission key. | Backend | Next patch |
| 6 | UI "Receive Shipment" wizard does not yet handle multi-MPL proforma (one MPL per part). Currently single-MPL only. | Frontend | Phase B |

---

*Generated 2026-04-25 alongside `RELEASE_0.5.5.md` and the v0.5.5 release notes.*
