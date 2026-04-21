# Schema Migration — `item_code` → `part_number`

**Status:** ⏸ PLANNING — do not execute until pre-flight checks pass and
this document is approved.

**Scope:** remove `items.item_code` as a foreign-key column and switch
every dependent table / edge function / RPC / view to use
`items.part_number` as the unique natural key.

**Preconditions already met:**
- Write-freeze in place (team has stopped add/delete).
- Soft-delete conversion shipped (`im_delete-item` now SOFT); no rows
  are being destroyed during the migration window.

---

## 1. Why this can't be a one-shot script

`item_code` is used by **three different patterns** across the DB:

| Pattern | Count | Examples |
|---|---|---|
| Hard FK: `child.item_code → items.item_code` | 13 tables | `inv_stock_ledger`, `inv_movement_lines`, `inv_warehouse_stock`, `inventory`, `packing_requests`, `demand_*`, `planning_recommendations`, `blanket_releases`, `blanket_order_lines`, `stock_movements`, `inv_blanket_release_stock` |
| FK already on `items.id` (correct model) | 5 tables | `blanket_order_items`, `pack_containers`, `pack_contract_configs`, `pack_pallets`, `packing_specifications` |
| Denormalized `item_code` column (no FK) | ~7 tables | `pack_packing_list_items`, `pack_packing_lists`, `pack_pallets`, and other `pack_*` tables |

Each pattern needs a different migration step.

---

## 2. Blocking decisions (need your answer before I write any SQL)

### 2.1 Data audit — MUST pass
Run this in Supabase SQL Editor and paste the 3 numbers back:

```sql
SELECT
  COUNT(*)                     AS total_items,
  COUNT(part_number)           AS non_null_part_number,
  COUNT(DISTINCT part_number)  AS distinct_part_number
FROM public.items;
```

**Migration CANNOT proceed if:**
- `non_null_part_number < total_items`  → some items have NULL part_number. Unique constraint will fail.
- `distinct_part_number < non_null_part_number`  → duplicate part_numbers exist. Unique constraint will fail.

If dirty, we'll clean the data first. I'll provide the cleanup SQL
once I see the numbers.

### 2.2 Backup — MUST be taken
Before ANY ALTER/DROP, you need a point-in-time backup:
- Supabase Dashboard → Project Settings → Backups → confirm a recent
  automated backup exists (within the last 24h).
- **Additionally** dump the affected tables in SQL Editor via
  `pg_dump` (ask me for the exact command list once data audit passes).

### 2.3 Confirm no other tables / views reference `item_code` outside the schema dump
`.db/functions.sql` is my only visibility into the schema. Confirm by running:

```sql
-- Every table/column/FK/view that mentions item_code
SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE column_name ILIKE '%item_code%'
  AND table_schema = 'public'
ORDER BY table_name;
```

Paste the result. I'll compare to my list below and flag any gap.

---

## 3. What I plan to migrate (after decisions above are made)

### 3.1 Inventory of dependencies

**Tables with FK on `items.item_code`:**

1. `blanket_order_lines`
2. `blanket_releases`
3. `demand_forecasts`
4. `demand_history`
5. `inv_blanket_release_stock`
6. `inv_movement_lines`
7. `inv_stock_ledger`
8. `inv_warehouse_stock`
9. `inventory`
10. `packing_requests`
11. `planning_recommendations`
12. `stock_movements`
13. (one more if the `information_schema` query returns more than I have)

**Tables with `item_code` as a plain/denormalized column (no FK, used as a "copy for fast queries"):**

- `pack_containers.item_code`
- `pack_contract_configs.item_code`
- `pack_pallets.item_code`
- `pack_packing_list_items.item_code`
- `pack_packing_lists.item_code`
- `pack_proforma_invoices.item_code` (if present)
- `packing_specifications.item_code`

**Edge functions referencing `item_code`:**
- `im_*` (3 fns we just shipped)
- `pac_details_*` (4 fns)
- `sg_*` (4 fns)
- `sm_*` (6 fns — existing pre-migration)
- **All need their SQL updated** to join on / filter by `part_number` instead of `item_code`.

**RPCs known to reference `item_code`:**
- `transfer_packed_stock` (you showed me the body — several `item_code` references)
- Likely `get_effective_permissions` does NOT touch `item_code` (permissions aren't item-scoped)
- `generate_mpl_number`, `create_proforma_invoice`, `approve_proforma_invoice`, `cancel_mpl`, `cancel_proforma_invoice` — all need checking via `pg_get_functiondef`

### 3.2 Views
`v_item_details` definitely uses `item_code` (we saw it in the query earlier). Any other view needs `pg_get_viewdef` check.

---

## 4. Phased migration plan (no phase executes until the previous one verifies clean)

### Phase 0 — Pre-flight (must pass)
- [ ] Data audit (§2.1) returns clean.
- [ ] Backup confirmed (§2.2).
- [ ] Full dependency list verified (§2.3).
- [ ] Write-freeze confirmed (team not pushing data).

### Phase 1 — Prep: add unique constraint on `items.part_number`
```sql
BEGIN;
  ALTER TABLE public.items
    ADD CONSTRAINT items_part_number_unique UNIQUE (part_number);
COMMIT;
```
**Rollback:** `ALTER TABLE public.items DROP CONSTRAINT items_part_number_unique;`

This **doesn't change any FK yet**. If data is dirty, this fails loudly. If clean, it's the foundation for everything that follows.

### Phase 2 — For EACH dependent table: add new `part_number` column + back-fill
Template applied to all 13 FK tables + ~7 denormalized tables:
```sql
BEGIN;
  ALTER TABLE public.<child_table>
    ADD COLUMN part_number_new character varying;

  UPDATE public.<child_table> c
     SET part_number_new = i.part_number
    FROM public.items i
   WHERE c.item_code = i.item_code;

  -- Verify: every row got back-filled
  SELECT COUNT(*) FROM public.<child_table> WHERE part_number_new IS NULL;
  -- Must return 0. If not, STOP, investigate orphans.
COMMIT;
```
**Rollback:** `ALTER TABLE <child_table> DROP COLUMN part_number_new;`

This is **reversible and additive**. App keeps working off `item_code` throughout.

### Phase 3 — Swap FK: drop old FK, add new FK, NOT NULL, rename column
Per table:
```sql
BEGIN;
  ALTER TABLE public.<child_table>
    DROP CONSTRAINT <old_item_code_fk_name>;

  ALTER TABLE public.<child_table>
    ALTER COLUMN part_number_new SET NOT NULL;

  ALTER TABLE public.<child_table>
    ADD CONSTRAINT <child_table>_part_number_fkey
      FOREIGN KEY (part_number_new)
      REFERENCES public.items(part_number);

  ALTER TABLE public.<child_table>
    DROP COLUMN item_code;

  ALTER TABLE public.<child_table>
    RENAME COLUMN part_number_new TO part_number;
COMMIT;
```
**Rollback:** would require restoring from backup — this phase is harder to undo. That's why §2.2 (backup) is non-negotiable.

### Phase 4 — Update all edge functions / RPCs / views to use `part_number`
- **Edge functions:** 17 TS files, straight find-and-replace of `item_code` → `part_number` where it's being used as a join/filter key. Surgical; I'll review each one.
- **RPCs:** `transfer_packed_stock` needs its body rewritten (all `v_req.item_code`, `SELECT ... WHERE item_code = ...` references become `part_number`). Same for any other RPCs that touch these tables.
- **Views:** `v_item_details` + any others I find in §2.3.
- **Frontend:** types / interfaces that include `item_code`. `utils/api/itemsSupabase.ts`, all packing / stock-movement components.

### Phase 5 — Drop `items.item_code` column
Only after Phase 4 is fully deployed and smoke-tested:
```sql
BEGIN;
  ALTER TABLE public.items DROP COLUMN item_code;
COMMIT;
```
After this, the migration is irreversible.

### Phase 6 — Cleanup
- Rename `part_number` back to whatever final column name you want (if different).
- Drop any remaining denormalized `item_code` columns in `pack_*` tables if still present.
- Verify no code references `item_code` anywhere.

---

## 5. Verification queries (run after each phase)

```sql
-- Phase 1:
SELECT conname FROM pg_constraint
 WHERE conname = 'items_part_number_unique';
-- Expect 1 row.

-- Phase 2 (per table):
SELECT COUNT(*) FROM public.<child_table> WHERE part_number_new IS NULL;
-- Expect 0 for every child_table.

-- Phase 3 (per table):
SELECT column_name, is_nullable
  FROM information_schema.columns
 WHERE table_name = '<child_table>' AND column_name IN ('item_code','part_number','part_number_new');
-- After phase 3 a given table should have ONLY 'part_number', NOT NULL.

-- Phase 5:
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND column_name='item_code';
-- Expect 0 rows. If anything references item_code still, STOP, audit before drop.
```

---

## 6. What I need from you to begin

1. **Data audit output** (§2.1). 3 numbers.
2. **Backup confirmation** (§2.2). "Yes, backup exists."
3. **Full dependency list from `information_schema`** (§2.3). SQL output pasted here.
4. **Explicit approval to start Phase 1.**

Once those four are in, I'll:
- Validate the dependency list against my inventory
- Write the exact Phase 1 SQL (5-line migration) and the rollback
- Execute only after you say "run Phase 1"

Each subsequent phase is the same pattern: draft → you approve → execute → verify → proceed.

---

## 7. Honest risks and how we're mitigating

| Risk | Mitigation |
|---|---|
| Data loss | Full backup before Phase 3+. Every phase has a rollback until Phase 5. |
| Long write-freeze (days?) | We keep the app running against `item_code` through Phase 2 (additive). Only the cut at Phase 3 requires a real freeze window per table. |
| Production bugs in new edge functions | Phase 4 code goes through the same `tsc --noEmit` + deploy pattern we've been using. No function goes live without a smoke test. |
| RPC behaviour drift | `transfer_packed_stock` gets its PL/pgSQL body rewritten to `part_number`. I'll diff the before/after side by side with you before applying. |
| Orphan rows | Phase 2 verification catches any child row whose `item_code` no longer resolves in `items` — we find and fix these before we touch FKs. |
| Accidental partial execution (network hiccup, editor crash) | Every phase is wrapped in `BEGIN / COMMIT`. Partial failure rolls back. |
| Historical audit integrity | Audit rows reference `item_code` as `target_id` in `audit_log.target_id`. Those stay as text and don't break — we just note that old audit rows use the old key format. |

---

**Paste the data-audit numbers and the `information_schema` output, confirm backup, and I'll write Phase 1.**
