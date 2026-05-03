# CHANGES — v0.5.6

- **Version:** 0.5.6
- **Release Type:** Minor
- **Date:** 2026-05-03
- **Previous Version:** 0.5.5 (2026-04-25)

## Summary

The headline of 0.5.6 is the **Intelligent Pallet Allocation** flow inside
the New Blanket Release wizard. The wizard now auto-matches whole pallets
to fulfil a customer's requested quantity exactly, or proposes the closest
options above/below with auto-generated customer amendment artefacts —
removing the trial-and-error pallet picking that operators were doing by
hand. Two industrial-grade print artefacts (Picking List, Amendment Draft)
are generated from the Review step to drive warehouse pull and customer
sign-off.

Bundled in the same cycle: full retirement of the S&V warehouse,
historical `shipment_number` backfill so the wizard's Review screen no
longer shows blanks, and a series of UX repairs across the BPA Detail and
Inventory Hub views.

No edge-function URL changes. One modified edge function
(`release_list_available_pallets`). Two new DB migrations (059, 060) —
one is destructive (S&V cleanup) and one is reversible (shipment-number
backfill).

---

## Frontend — Intelligent Pallet Allocation

### New modules

| File | Purpose |
|---|---|
| [`src/components/release/palletMatcher.ts`](../../src/components/release/palletMatcher.ts) | Pure-TS subset-sum matcher. Whole-pallet only. Two-stage strategy (FIFO-prefix shortcut → Int32Array DP with parent-pointer recovery). Returns `{ exact, above, below, availableTotal, insufficient }`. Zero dependencies, zero I/O. |
| [`src/components/release/releasePrints.ts`](../../src/components/release/releasePrints.ts) | Two `window.open + auto-print` layouts: `printPickingList()` (warehouse pull, rack-sorted, ✓-checkbox, signature blocks) and `printAmendmentDraft()` (customer-facing, mirrors OPW's release-document format with diff'd quantities). |

### Modified modules

| File | Change |
|---|---|
| [`src/components/release/CreateRelease.tsx`](../../src/components/release/CreateRelease.tsx) | Wizard rebuilt. Step 3 softens REL MULT to a hint, captures `customerRequestedQuantity` separately. Step 4 replaced with intelligent allocator (3 render paths: exact / no-exact options / insufficient stock) plus a manual-override fallback. Step 5 surfaces the amendment with banner + pill + diff'd quantity grid + print buttons. |
| [`src/components/release/types.ts`](../../src/components/release/types.ts) | `AvailablePallet.shipment_number: string \| null` added. |

### State-model additions

```ts
interface WizardState {
    customerRequestedQuantity: number;             // original customer ask
    requestedQuantity:         number;             // what we will actually ship
    adjustmentType:           'NONE' | 'UP' | 'DOWN' | 'MANUAL';
    selectedPallets:           Map<string, number>;
}
```

Invariants:

- `requestedQuantity === Σ selectedPallets.values()` always.
- `adjustmentType === 'NONE'` ⇔ `requestedQuantity === customerRequestedQuantity`.
- Step 3 edits wipe `selectedPallets` and reset `adjustmentType`.

### Render paths in Step 4

| Path | Trigger | UI |
|---|---|---|
| **Exact match** | `matcher.exact !== null` | Green hero card. Title is "Perfect FIFO Match" (prefix sweep) or "Exact Match Found" (subset search). Auto-applied. |
| **No exact match** | `matcher.exact === null && !matcher.insufficient` | Two stacked option cards (Round Up ▲ amber, Round Down ▼ blue). Each carries pallet list + auto-generated customer message + Copy button. |
| **Insufficient stock** | `matcher.insufficient` | Red hero with shortfall figure + "Accept partial · ship X pcs" button. |
| **Manual override** | User clicks the override link | Legacy grouped picker re-rendered as `Step4Manual`; sets `adjustmentType: 'MANUAL'`. |

### Algorithm details

- **Stage 1 — FIFO-prefix sweep.** Walk pallets oldest-first; if any prefix
  sums to target, return immediately.
- **Stage 2 — 0/1 knapsack DP.** Parent-pointer reachability table sized
  `min(availableTotal, target + maxPalletQty) + 1`. Pallets iterated in
  FIFO order so the first pallet to "claim" a sum is the oldest — the
  recovered subset is naturally FIFO-biased.
- **Recovery.** Walk parent pointers backwards from the target sum to
  enumerate selected pallet indices.
- **Closest-above** = first reachable `s > target` via linear scan upward.
- **Closest-below** = first reachable `s < target` via linear scan downward.
- Complexity: O(N × cap) ≈ 25M boolean writes for typical N=50, cap=500k —
  ~30 ms in V8. Memory: 4 bytes × cap.

Verified against the user-supplied example: pallets `[900, 250, 1000, 1600,
3000]` target `3250` → returns `{250, 3000}` exact match (subset_search). ✓

### Auto-generated customer message

Each option card embeds a draft amendment message scoped to the option's
direction:

> *Hi {customer}, on release {po} our whole-pallet stock totals {target}
> pcs (the closest below your ask of {ask}). Please confirm an amendment
> to {target} pcs (−{delta}) so we can dispatch.*

A "Copy message" button beside the draft uses `navigator.clipboard.writeText`
with try/catch fallback.

---

## Print artefacts

### Picking List (warehouse — Milan / 3PL)

Sections (top to bottom):

1. Top date bar — print timestamp, picking-list number, page number.
2. Header band — Autocrat company block + bold italic `PICKING LIST` title.
3. Reference grid — Customer, Buyer, BPA, Release PO, Order/Need-By dates,
   Part/MSN, Customer Asked vs Pull Quantity.
4. Amendment banner (only when amended) — high-contrast yellow stripe
   warning the picker about pending customer confirmation.
5. Items table sorted by `location_code` (efficient pick walk):
   `SL · Rack · Pallet ID · Qty · Shipment · Parent Invoice · Placed · ✓ Picked`.
   The ✓ column has an empty checkbox the picker ticks on the floor.
6. Totals row — total pcs, estimated load value, pallet count.
7. Signature blocks — Picker (name + signature + date), Verifier (L2/L3),
   Discrepancy notes, Forklift / Carrier-AWB capture.
8. Standing instructions footer — whole-pallet rule, escalation path.

### Amendment Draft (customer — OPW)

Mirrors OPW's release-document format exactly so the customer sees a
familiar mirror with amended numbers diff'd inline:

1. **Page 1 of 1** marker top-right.
2. **Three-column top band** — Customer header (left) · Ship To (middle) ·
   structured title block with `Order No / Revision / Order Date /
   Created By / Contact Number / Amendment Date / Current Buyer` (right).
3. **Three-column second band** — Supplier (us) · Bill To · BPA reference grid
   with adjustment chip (`▲ AMENDED UP` / `▼ AMENDED DOWN` / `MANUAL`).
4. **Acknowledgement banner** — *"Amendment Acknowledgement Required within 24 hrs."*
5. **Two-row commercial strip** — `SUPPLIER NO · PAYMENT TERMS · FREIGHT
   TERMS · FOB · TRANSPORTATION · SHIP VIA`, then `SUPPLIER CONTACT ·
   PHONE · EMAIL · DELIVER TO`.
6. **Note to Customer** — prose explaining why the qty changed.
7. **Items table** with the customer's column geometry:
   `Line · Part No / Description · Need-By Date · Quantity · UOM · Unit
   Price · Tax · Extended Price`. The Quantity and Extended Price cells
   contain a two-line **diff** — strike-through original above, green new
   value below.
8. **Drawing Number / Drawing Revision / MSN** sub-row.
9. **Note to Supplier** sub-row — shipment draw-down breakdown + BPA Min/Max.
10. **TOTAL (USD)** bottom-right.
11. **Customer Acknowledgement** signature panel — two-column (customer
    signs left, Autocrat counter-signs right) with pre-filled legal
    sentence.
12. **Declaration** — supersedes-original-quantity statement, references
    underlying BPA.

Both documents share an `A4 portrait, 6mm margin, 1.5px outer border,
diagonal AUTOCRAT ENGINEERS watermark` skeleton consistent with the
existing `PROFORMA INVOICE` and `PACKING LIST` prints.

---

## Database — Migration 059 — Remove S&V Warehouse

### Scope

The S&V warehouse was retired. Migration `059_remove_snv_warehouse.sql`:

| Statement | Rationale |
|---|---|
| `DELETE FROM release_pallet_holds WHERE warehouse_id = snv_id` | Clear allocations on the retired warehouse. |
| `DELETE FROM inv_warehouse_stock WHERE warehouse_id = snv_id` | Drop on-hand records. |
| `DELETE FROM inv_movement_approvals WHERE movement_id IN (...)` | Cascade-clean approvals. |
| `DELETE FROM inv_movement_lines WHERE header_id IN (...)` | Movement-line cleanup. |
| `DELETE FROM inv_movement_headers WHERE source/dest = snv_id` | Movement-header cleanup. |
| `DELETE FROM inv_stock_movements WHERE warehouse_id = snv_id` | Audit-log cleanup (table-exists guard via EXEC + EXCEPTION). |
| `DELETE FROM inv_warehouses WHERE id = snv_id` | Remove the master row. |
| `DROP VIEW … CASCADE; CREATE VIEW vw_item_stock_distribution …` | Rebuild without `snv_*` columns; cascade dependents (`vw_item_warehouse_detail`, `vw_item_stock_summary`, `vw_item_stock_dashboard`). |

> ⚠ **Destructive and irreversible.** Once 059 runs, the S&V master row,
> inventory, and movement history are gone. Recovery requires a Supabase
> backup snapshot.

### Frontend / edge function follow-through

- `src/types/inventory.ts` — `'SNV'` removed from `WarehouseCategory`,
  `snvOnHand/Available/Reserved/Allocated/Stock` fields removed.
- `src/components/StockMovement.tsx` — `'SV'` removed from `LocationCode`,
  `LOCATIONS` map, both `Customer→S&V` / `S&V→In-Transit` movement routes,
  and the `WH-SNV-MAIN` DB-code mapping.
- `src/components/UnifiedItemMaster.tsx` — S&V warehouse card removed.
- `supabase/functions/sm_submit-movement-request/index.ts`,
  `supabase/functions/new_sm_queries/index.ts`,
  `supabase/functions/sm_get-movements/index.ts` — `WH-SNV-MAIN` mapping,
  `'SV'` from `INTERNAL_LOCATIONS`, and S&V display name removed.
- Documentation purge — `docs/architecture.md` flow diagram and
  `docs/workflows/stock-movement.md` updated.

---

## Database — Migration 060 — Backfill `shipment_number`

The historical seed in 051 had imported 27 goods-receipts and 29
proformas with NULL `shipment_number`. Migration
`060_backfill_historical_shipment_numbers.sql`:

```sql
WITH numbered AS (
    SELECT id, proforma_number,
           2000 + COALESCE(NULLIF(SUBSTRING(proforma_number FROM 'PI-(\d{2})')::int, 0), 25) AS year_part,
           ROW_NUMBER() OVER (PARTITION BY year_part ORDER BY proforma_number) AS seq
    FROM pack_proforma_invoices
    WHERE shipment_number IS NULL
)
UPDATE pack_proforma_invoices ppi
SET shipment_number = 'SHIP-' || n.year_part || '-' || LPAD(n.seq::text, 3, '0')
FROM numbered n WHERE ppi.id = n.id;

UPDATE goods_receipts gr
SET shipment_number = ppi.shipment_number
FROM pack_proforma_invoices ppi
WHERE gr.proforma_invoice_id = ppi.id
  AND gr.shipment_number IS NULL
  AND ppi.shipment_number IS NOT NULL;
```

Result: 100% coverage on both tables (29 PIs and 27 GRs backfilled to
`SHIP-2025-001` … `SHIP-2025-029`). Idempotent — second run is a no-op.

---

## Edge functions

### `release_list_available_pallets` — modified

| Change | Rationale |
|---|---|
| `goods_receipts!inner(gr_number, status)` → `goods_receipts!inner(gr_number, status, shipment_number)` | Pull the canonical shipment number for display in Review/Picking-List. |
| New response field `shipment_number` (preferring `goods_receipts.shipment_number`, falling back to `pack_proforma_invoices.shipment_number`) | Two-tier fallback so legacy and modern data both surface a value. |

### No new edge functions

The intelligent matcher runs entirely client-side. Adding an RPC over
the same subset-sum logic was considered and rejected — the algorithm's
input is already on the client after `release_list_available_pallets`,
so a round-trip would be pure overhead.

---

## UI — bundled fixes

### BPA Detail — per-part fulfilment focus

[`src/components/bpa/BPADetail.tsx`](../../src/components/bpa/BPADetail.tsx)
gains a `focusPart?: string` prop. When set:

- Fulfilment tab filters `data.fulfillment` to the matching `part_number`.
- Blue `FocusBanner` ("Filtered to part X · N other parts hidden — Show
  all parts →") above the table.
- Tab badge count reflects filtered count.
- Parts tab is intentionally not filtered (user wanted parts count
  preserved, fulfilment focused).

[`src/components/bpa/BPAList.tsx`](../../src/components/bpa/BPAList.tsx)
threads `group.part_number` through `onOpenBPA(aid, partNumber)` so opening
a BPA from a per-part card pre-filters fulfilment.

### BPA Detail — "Drafted" filter pill

The pill had `filter === 'DRAFT'` but `BlanketRelease.status` is
`'OPEN' | 'FULFILLED' | 'CANCELLED'`. Fix: change the filter state union,
the pill's `active`/`onClick`, and the `r.status === filter` predicate
from `'DRAFT'` to `'OPEN'`. The label *Drafted* (display-only) is
preserved — `EmbeddedReleaseCard` already labelled OPEN rows as "Drafted".

### BPA List — per-row "New Release" loading state

A single `loadingRelease` state at `BPAList`'s scope was passed to every
`PartCard`, so clicking one button spun all of them. Refactor: drop the
parent state, give each `PartCard` its own `const [busy, setBusy] = useState(false)`,
make the click handler `async` and wrap the `onNewRelease` call in a
`try/finally` that toggles `busy`.

### Release wizard — auto-detected next sequence

Step 1 (Release Header) on mount calls
`listReleases({ agreement_id, page_size: 500, status_filter: 'ALL' })`,
finds `MAX(release_sequence)` (with a regex fallback parsing trailing
`-N` from `release_number`), and pre-fills `releasePo` with
`{BPA-number}-{maxSeq + 1}`. Field stays editable; an `edited` flag
prevents overwriting after the user types. Visual cues — green AUTO chip
when input matches the suggestion, hint line below explaining
*"N existing releases · next sequence: -K"*, and a *"Reset to {suggestion}"*
link when the user has wandered off.

### Inventory Hub — UI polish

| Change | Detail |
|---|---|
| US Warehouse card recolour | Red gradient → teal (`#14b8a6 → #0d9488`). Red read as warning; teal pairs cleanly with the existing FG (navy) and In-Transit (info-blue) cards. |
| In-Transit card label | `Allocated` → `Reserved` (bound field `blanketNextMonthReserved` was already a reservation, label was wrong). |
| US Warehouse card body | Redesigned: hero *Available to Promise* tile, 3 KPI chips (On Hand / Allocated / Reserved), stacked utilisation bar with % legend, per-release breakdown with mini progress bars (allocated red, reserved amber). |
| New service function | `getUSReleaseHolds(partNumber)` in `inventoryService.ts` queries `release_pallet_holds → blanket_releases (release_number)` filtered by US warehouse + part, aggregated by `(release_number, hold_status)`. US warehouse id cached in module memory. |
| New hook | `useUSReleaseHolds` consumed by `UnifiedItemMaster`. |

### Step 3 part-row tweak

Replaced the `REL MULT` mini-stat with `BPA Number` so the operator sees
the BPA reference at a glance during release creation.

---

## Documentation

- This file — `CHANGES_0.5.6.md`
- [`RELEASE_0.5.6.md`](RELEASE_0.5.6.md) — executive release report
- [`IMPLEMENTATION_0.5.5_TO_0.5.6.md`](IMPLEMENTATION_0.5.5_TO_0.5.6.md) — full technical change log (architecture, algorithm, UI, prints, DB, edge fn, files manifest, verification recipes, rollback recipe, follow-ups)
- `README.md`, `docs/architecture.md`, `docs/MODULE_OVERVIEW.md`, `docs/workflows/stock-movement.md` all refreshed for 0.5.6.

---

## Deferred / known limitations

- **`customerRequestedQuantity` not persisted.** The customer's original
  ask only lives in wizard state. The DB write uses `requestedQuantity`
  (post-amendment). Audit trail is via the printed Amendment Draft.
  Follow-up: add `blanket_releases.customer_requested_quantity` +
  `adjustment_type` columns and plumb through `release_create`.
- **No system-of-record for amendment confirmation.** Today the operator
  emails the PDF, customer signs and emails back. Follow-up: a
  `release_amendments` table (PENDING / CONFIRMED / REJECTED) with signed
  PDF upload and a "Mark customer confirmed" action.
- **Matcher considers quantity only.** No lot/expiry constraints, no FEFO.
  Follow-up: optional weight functions on `MatcherPallet` for multi-criteria.
- **Pathological large targets.** target > ~1M with diverse pallet sizes
  pushes DP table past 4 MB. Mitigation if needed: GCD-compress quantities
  before DP. Not blocking at current data scale.
- **Migration tracker drift.** Migrations 058 / 059 / 060 were applied via
  `db query --linked` rather than `db push`, so
  `supabase_migrations.schema_migrations` doesn't know about them. Future
  `db push --linked` will re-attempt them. Follow-up: insert tracker rows
  manually (SQL provided in `IMPLEMENTATION_0.5.5_TO_0.5.6.md` §13.5).
- **Test coverage.** `palletMatcher.ts` has no committed unit tests. The
  test matrix in the implementation doc is the next quality-of-life step.

---

## Security

No new attack surface. All matcher logic is client-side and reads from
the existing authenticated `release_list_available_pallets` edge function.
Migration SQL runs only under `service_role` via `supabase db push` /
`db query --linked`. The amendment-draft print runs in a popup window
opened from the same origin — no cross-origin or third-party content.
