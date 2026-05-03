# Release Report — v0.5.6

| Field | Value |
|---|---|
| **Version** | 0.5.6 |
| **Type** | Minor (backwards-compatible) |
| **Release date** | 2026-05-03 |
| **Previous release** | 0.5.5 (2026-04-25) |
| **Days since prev release** | 8 |
| **Net code delta** | 2 new DB migrations · 1 modified edge function · 2 new frontend modules · 4 modified UI components · 0 new schema columns |
| **Risk level** | **Low–Medium** — matcher is purely client-side and additive; migration 059 (S&V) is destructive but the warehouse was already retired operationally; migration 060 is fully reversible |

---

## What ships

### 1. Intelligent Pallet Allocation (headline feature)

The New Blanket Release wizard's Step 4 is rebuilt around a subset-sum
matcher. When the operator enters the customer's requested quantity, the
system now resolves pallet selection in one of three ways:

| Outcome | Customer experience | Operator experience |
|---|---|---|
| **Exact match** (FIFO prefix or non-prefix subset) | No amendment needed — original ask shipped as-is | Auto-allocated · click Next |
| **No exact match** | Receives an amendment draft for sign-off | Picks Round-Up or Round-Down option · prints amendment |
| **Insufficient stock** | Partial-fulfilment amendment | Accepts the available qty as a partial release |

Manual override is preserved as a fallback for power users.

### 2. Industrial-grade print artefacts

Two new printable documents flow out of the Review step:

- **Picking List** — internal warehouse pull document. Rack-sorted rows,
  ✓-checkbox column, signature blocks for picker and verifier, discrepancy
  notes box, standing-instructions footer. Drives the warehouse floor
  walk.
- **Amendment Draft** — customer-facing document mirroring OPW's release
  format. Diff'd Quantity and Extended Price cells (strike-through old
  above green new), 24-hour acknowledgement banner, two-column signature
  panel. Ready to send for confirmation.

Both follow the same A4 portrait visual language as `PROFORMA INVOICE`
and `PACKING LIST`.

### 3. S&V Warehouse decommission

End-to-end retirement of the S&V warehouse: frontend types, UI cards,
movement routes, edge-function code-mappings, and a destructive migration
(059) that drops all S&V data and rebuilds the inventory views without
`snv_*` columns. The warehouse is gone from every surface.

### 4. Historical `shipment_number` backfill

Migration 060 fills `shipment_number` on the 27 historical goods-receipts
and 29 historical proformas that 051 had imported with NULL. Result:
100% coverage. The wizard's Review step now shows real shipment numbers
(SHIP-2025-001 … SHIP-2025-029) instead of `—`.

### 5. UX repairs across BPA Detail and Inventory Hub

- BPA Detail's Fulfilment tab can now be filtered to a single part when
  opened from a per-part card.
- BPA Detail's "Drafted" filter pill works (was looking for status `'DRAFT'`
  but real status is `'OPEN'`).
- BPA List's "New Release" buttons no longer all spin together (per-card
  loading state).
- Release wizard auto-detects the next sequence number (`{BPA}-{maxSeq+1}`)
  with a green AUTO chip, hint line, and reset link.
- Inventory Hub's US Warehouse card recoloured (red → teal) and rebuilt
  with hero Available-to-Promise tile, KPI chips, stacked utilisation
  bar, and per-release breakdown with mini progress bars.
- In-Transit card's mislabelled "Allocated" row is now correctly labelled
  "Reserved".
- Step 3's part row replaces REL MULT with BPA Number.

---

## Numbers at a glance

| Metric | Before (0.5.5) | After (0.5.6) | Δ |
|---|---|---|---|
| DB migrations applied | 018–058 (41) | 018–060 (43) | +2 |
| Frontend modules (release/) | 5 | 7 | +2 (`palletMatcher.ts`, `releasePrints.ts`) |
| Active warehouses | 4 (FG, In-Transit, US, S&V) | 3 (FG, In-Transit, US) | −1 (S&V retired) |
| Proformas with `shipment_number` | 19 / 48 | 48 / 48 | +29 backfilled |
| Goods-receipts with `shipment_number` | 4 / 31 | 31 / 31 | +27 backfilled |
| Edge functions deployed | 59 | 59 (1 modified) | 0 |
| Subset-sum matcher unit tests | — | — *(follow-up)* | — |

---

## Acceptance verification

### Matcher — happy paths

```
# Exact via FIFO prefix
   - BPA with at least one pallet of size N
   - Enter customer ask = N
   - Expect: green "Perfect FIFO Match · 1 pallet"

# Exact via subset (non-prefix)
   - BPA 260067252 with diverse pallet outer-quantities
   - Enter customer ask = a sum reachable by skipping some pallets
   - Expect: green "Exact Match Found · K pallets"

# No exact, two options
   - Enter customer ask = a value between adjacent reachable sums
   - Expect: two stacked option cards (Round Up / Round Down)
   - Click Round Down → Step 5 shows "▼ AMENDED DOWN"
   - Print Amendment Draft → OPW-style PDF preview with diff'd quantities

# Insufficient stock
   - Pick a part with very low rack inventory
   - Enter customer ask = much larger
   - Expect: red Insufficient hero with "Accept partial" button
```

### Database backfill — `shipment_number`

```sql
-- Should both report 0
SELECT COUNT(*) FROM pack_proforma_invoices WHERE shipment_number IS NULL;
SELECT COUNT(*) FROM goods_receipts        WHERE shipment_number IS NULL;

-- Spot-check
SELECT proforma_number, shipment_number FROM pack_proforma_invoices
WHERE proforma_number IN ('PI-252602841','PI-252602421','PI-252601297');
-- Expected: SHIP-2025-029, SHIP-2025-026, SHIP-2025-019
```

### S&V removal — confirm absence

```sql
-- All should return 0 rows
SELECT * FROM inv_warehouses WHERE warehouse_code = 'WH-SNV-MAIN';
SELECT s.* FROM inv_warehouse_stock s
  JOIN inv_warehouses w ON w.id = s.warehouse_id
  WHERE w.warehouse_code = 'WH-SNV-MAIN';

-- Frontend grep
grep -rni "SNV\|S&V\|S & V\|WH-SNV" src/ supabase/functions/
-- Expected: empty
```

---

## Risk assessment

| Risk | Mitigation |
|---|---|
| Matcher returns a sub-optimal subset for some pallet distributions | Algorithm verified against the user-supplied example (`{250, 3000}` from `[900, 250, 1000, 1600, 3000]` for target 3250). Test matrix documented in implementation doc §4.7. |
| Operator overrides matcher with a worse manual pick | Manual mode is explicit (link click); `adjustmentType: 'MANUAL'` flagged in Review and on the Amendment Draft. |
| Customer doesn't confirm amendment before dispatch | Picking List carries a high-contrast amber banner *"AMENDED RELEASE — Confirm customer sign-off before dispatch."* |
| Migration 059 deletes legitimate S&V data unrecoverably | Operationally the warehouse was already retired before 0.5.6. Backup snapshot is the recovery path if needed. |
| Migration 060 invents shipment numbers that conflict with future ones | Numbering scheme is `SHIP-2025-NNN` (year derived from `proforma_number`). Modern proformas already use `SHIP-2026-NNN` — no overlap. |
| Edge-function response shape change breaks consumers | Added field is purely additive (`shipment_number`). Existing `packing_list_number` field preserved. |
| Pop-up blocker breaks print buttons | Both print functions detect the failed `window.open` and `alert()` the user with remediation instructions. |

---

## Rollback

### Frontend (matcher + prints)

The matcher has no persistence side-effects — it only drives UI. Rollback
is a clean revert:

```bash
git revert <0.5.6-merge-commit>
```

This restores the legacy Step 4 manual picker and reverts the print
modules. No DB cleanup needed for matcher rollback.

### Migration 059 — S&V removal

**Destructive and irreversible.** Once 059 runs, the S&V master row,
inventory, and movement history are gone. Recovery requires a Supabase
backup snapshot taken before applying 059.

The view rebuild *can* be reverted by re-running 044's
`vw_item_stock_distribution` definition, but the data is unrecoverable.

### Migration 060 — `shipment_number` backfill

Reversible:

```sql
UPDATE pack_proforma_invoices SET shipment_number = NULL
WHERE shipment_number ~ '^SHIP-2025-\d{3}$'
  AND proforma_number LIKE 'PI-25%';

UPDATE goods_receipts SET shipment_number = NULL
WHERE shipment_number ~ '^SHIP-2025-\d{3}$'
  AND gr_number LIKE 'GR-M-%';
```

### Edge function `release_list_available_pallets`

```bash
git revert <commit-touching-release_list_available_pallets>
npx supabase functions deploy release_list_available_pallets
```

Removing the new `shipment_number` field from the response is non-breaking
— the frontend's existing fallback (`p.shipment_number || p.packing_list_number`)
handles it.

---

## Documentation produced

- [`CHANGES_0.5.6.md`](CHANGES_0.5.6.md) — release notes (Keep-a-Changelog format)
- [`RELEASE_0.5.6.md`](RELEASE_0.5.6.md) — this file (executive summary)
- [`IMPLEMENTATION_0.5.5_TO_0.5.6.md`](IMPLEMENTATION_0.5.5_TO_0.5.6.md) — full technical change log (13 sections covering executive summary, problem statement, architecture, algorithm, frontend rebuild, prints, adjacent improvements, DB, edge fn, file manifest, verification recipes, rollback, follow-ups)

`README.md`, `docs/architecture.md`, `docs/MODULE_OVERVIEW.md`, and
`docs/workflows/stock-movement.md` refreshed for 0.5.6.

---

## Sign-off

This release was developed and verified against the production Supabase
project. Migration 060 has been applied to the linked DB
(verified: 0 NULL `shipment_number` in either table). Migration 059 was
applied earlier in-cycle (S&V data confirmed gone by direct grep).

`package.json` has been bumped to `0.5.6`. Tagging and remote push are
gated on engineering team approval.
