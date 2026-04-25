# CHANGES — v0.5.5

- **Version:** 0.5.5
- **Release Type:** Minor
- **Date:** 2026-04-25
- **Previous Version:** 0.5.4 (2026-04-21)

## Summary

Two large pieces of work land in this release:

1. **Release Allocation Holds** (migrations 044–048) — inventory now tracks
   `On-Hand / Allocated / Reserved / Available` per (part × warehouse) at
   release-level priority. Stock is deducted only on delivery, not on
   sub-invoice creation. MPL cancellations cascade to dependent pallets so
   rack views stop pointing at cancelled paperwork.
2. **Historical Data Import** (migrations 049–058) — first production
   import of legacy xlsx + PDF artefacts: 4 customer BPAs, 197 pallets
   placed across racks A–G, 30 releases (FULFILLED), 31 sub-invoices,
   31 tariff invoices (CLAIMED). Four procurement scenarios were
   modelled (Standard PO, Real BPA, Informal Borrow, Synthesized BPA).

No business-logic changes outside these two streams. No edge-function URL
changes; one new edge function added (`release_allocate_pallets`).

---

## Database — Release Allocation Holds (044–048)

### New table

`public.release_pallet_holds (release_id, pallet_id, hold_type, scope_part_number, scope_warehouse_id, qty, …)`
— one row per pallet a release holds, with `hold_type ∈ {ALLOCATED, RESERVED}`.
ALLOCATED reserves the pallet exclusively for the earliest-need-by release
in scope; RESERVED rows accrue against later competing releases.

### New / replaced RPCs

| RPC | Purpose |
|---|---|
| `release_allocate_pallets(release_id, holds[])` | Insert hold rows + run scope-wide priority recompute. |
| `recompute_release_holds(part, warehouse_id)` | Re-runs ALLOCATED/RESERVED priority for the whole `(part × warehouse)` scope. Called from any hold-changing path. |

### Trigger surface

- `trg_br_delivered_drain_holds` (replaces the over-eager
  `trg_rpa_drain_hold`) — drains holds **only** when the linked
  blanket release flips to `DELIVERED`. Sub-invoice creation no longer
  decrements `On-Hand`.
- `trg_mpl_cancel_sync_mpp` — propagates `master_packing_lists.status =
  'CANCELLED'` to `master_packing_list_pallets.status`. The MPP `status`
  CHECK now permits `CANCELLED`.

### Edge functions

- **New:** `release_allocate_pallets` — thin wrapper over the RPC. Resolves
  warehouse_id from the pallet's rack placement and forwards the hold
  list.
- **Updated:** `pallet_get_back_chain` — sorts non-cancelled MPLs first and
  recent-active MPP rows ahead of stale ones, so the rack drawer never
  shows paperwork that has been cancelled.

### Inventory view

`vw_item_stock_distribution` rebuilt to expose the four-bucket breakdown
per warehouse (`*_on_hand`, `*_allocated`, `*_reserved`, `*_available`).
The `ItemStockDistribution` and `ItemStockDashboard` TS types now carry
the matching `usTransitAllocated / usTransitReserved / usTransitAvailable`
fields and the production-side equivalent.

### UI

- `StockDistributionCard.tsx` — new `BucketStat` component; US 3PL panel
  shows all four buckets above the existing 3-card row.
- `UnifiedItemMaster.tsx` — US Warehouse card shows Allocated, Reserved,
  Available alongside On-Hand.
- `CreateRelease.tsx` — wizard now calls `allocateReleasePallets` between
  `createRelease` and `createSubInvoice`, so holds exist before stock
  drains.
- `releaseService.ts` — adds `allocateReleasePallets()` and the
  `PalletHoldInput` interface.

---

## Database — Historical Data Import (049–058)

### Scope

| # | Migration | Phase | Outcome |
|---|---|---|---|
| 1 | 049 | Schema prep | `MIGRATION_INFORMAL` / `MIGRATION_PLACEHOLDER` enum values; relaxed `cap_integrity_check`; `shipment_mode` cols on `pack_proforma_invoices`. |
| 2 | 050 | M1 — Agreements | 4 BPAs, 5 part rows. Includes the OPW-70 informal-borrow line under OPW-69's BPA (260067251). |
| 3 | 051 | M2 — Shipments | 27 invoices, 27 proformas, 27 MPLs, 197 pallets, 197 rack placements (racks A–G), 27 GRs, 197 GR lines. |
| 4 | 052 | M3 — Releases | 30 FULFILLED releases, 31 sub-invoices, 84 release-pallet assignments, 31 CLAIMED tariff invoices, 84 pallets flipped to `RELEASED`. |
| 5 | 053 | M4 — Rollups | Backfill `blanket_order_line_configs` (released_qty, delivered_qty, total_releases, total_sub_invoices). Refresh both materialized views. |
| 6 | 054 | M4 — Fix | Roll up `released_quantity` from `blanket_releases` directly (053 sourced from `pack_sub_invoice_lines` which were not yet seeded). |
| 7 | 055 | UI fix — Inbound | Populate `proforma_invoice_mpls` junction so `shipment_dashboard_list` reports correct MPL/pallet counts. Backfill `goods_receipts.mpl_id` and `proforma_invoice_id`. Flip stale PI status to `RECEIVED`. |
| 8 | 056 | UI fix — Rack | Rewrite `goods_receipt_lines.rack_location_code` from `A-01` → `A1` to match the RackView grid key generator. |
| 9 | 057 | UI fix — Item Master | Seed `pack_sub_invoice_lines` for M3 sub-invoices; back-link `pack_sub_invoices.line_config_id`. |
| 10 | 058 | UI fix — BPA dashboard | Backfill `warehouse_rack_locations.agreement_id` from `agreement_number` so the BPA dashboard's lateral-join rack-stats actually return rows. |

All migrations are **idempotent** (DELETE-then-INSERT keyed on
`source LIKE 'MIGRATION%'` or pallet/MPL number prefix) and re-runnable.

### Source tagging

Every migrated row carries one of:

- `source = 'MIGRATION'` (most rows)
- `source = 'MIGRATION_INFORMAL'` (OPW-70 informal-borrow part row)
- `source = 'MIGRATION_PLACEHOLDER'` (reserved for catch-all BPA `260099999`, not yet exercised)

Live RPCs continue to write `source = 'MANUAL'`. The historical rows can
be removed wholesale via the rollback recipe in
`08_MIGRATION_EXECUTION.md`.

---

## UI — Default filter corrections

Two list pages defaulted to status filters that excluded all migrated
data on first load:

| Component | Before | After |
|---|---|---|
| `ReleaseList.tsx` | `OPEN` | `ALL` |
| `TariffInvoiceQueue.tsx` | `DRAFT` | `ALL` |

M3 seeded releases as `FULFILLED` and tariffs as `CLAIMED` — the old
defaults made the migrated history invisible until the user clicked
through to the right tab.

---

## Documentation

- This file — `CHANGES_0.5.5.md`
- [`RELEASE_0.5.5.md`](RELEASE_0.5.5.md) — executive release report
- [`IMPLEMENTATION_0.5.4_TO_0.5.5.md`](IMPLEMENTATION_0.5.4_TO_0.5.5.md) — full technical change log
- `README.md`, `docs/MODULE_OVERVIEW.md`, `docs/DATABASE_SCHEMA.md`, `docs/architecture.md`, `docs/architecture/00-ARCHITECTURE-INDEX.md`, `supabase/functions/README.md` all refreshed for 0.5.5.

---

## Deferred / known-limitations

- **`inv_stock_ledger` not back-filled for M2.** The historical pallet
  inserts credit `inv_warehouse_stock` directly; ledger rows are not
  written. A future M5 can synthesize `RECEIPT_IN` ledger entries if a
  full audit trail is required.
- **Cross-BPA shared parts not exercised** by demo data. The schema
  supports it (multiple `customer_agreement_parts` rows per part); only
  the import dataset stops short.
- **`260099999` placeholder BPA reserved but not seeded.** Used for
  unidentified historical shipments — wait until the next batch of
  back-fill data arrives.

---

## Security

No new attack surface. `release_allocate_pallets` is a `SECURITY DEFINER`
RPC behind the standard JWT-auth edge function. Migration SQL runs only
under `service_role` via `supabase db push`.
