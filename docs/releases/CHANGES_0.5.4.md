# CHANGES — v0.5.4

- **Version:** 0.5.4
- **Release Type:** Minor
- **Date:** 2026-04-21
- **Previous Version:** 0.5.3 (2026-04-18)

## Summary

Item Master module migrated to edge functions (`im_*` prefix), item deletion
converted from a 13-table hard cascade to a reversible soft delete, and the
first three phases of the `item_code → part_number` schema migration applied
to the database. No business-logic changes to other modules.

The schema cutover is **staged but not final** — dependent tables now carry a
populated `part_number_new` column and FK, while the legacy `item_code`
columns remain in place until a verified backup exists (see §Deferred below).

---

## Edge Function Changes

Four new functions deployed to project `sugvmurszfcneaeyoagv`, all under the
`im_` (Item Master) prefix:

| Function | Replaces | Notes |
|---|---|---|
| `im_list-items` | Inline `items` SELECT + 3 count queries in `UnifiedItemMaster.tsx` | Collapses 4 round trips → 1. Server-side sort, search, filter, pagination. Sortable-field whitelist for SQL-injection safety. |
| `im_get-blanket-orders` | Direct `v_item_details` SELECT in PackingDetail modal | `blanket_order_id IS NOT NULL` filter moved server-side. |
| `im_upsert-item` | `createItem` + `updateItem` inline INSERT/UPDATE | One endpoint; presence of `item_id` in body picks the branch. Preserves `updated_at` refresh on UPDATE. |
| `im_delete-item` | 13-table client-side cascade delete | **Now a soft delete** — flips `items.is_active = false`. Audit row written server-side with JWT-derived `user_id` (never the request body). Idempotent on already-inactive rows. |

All four functions use the standard `PUBLISHABLE_KEY` + explicit JWT pattern
established in 0.5.3 and deploy with `--no-verify-jwt`.

## Delete Semantics — Hard Cascade → Soft Delete

**Before:** `deleteItem` deleted from 13 child tables (stock ledger, movement
lines, packing records, inventory, etc.) before deleting the `items` row.
Irreversible; a mis-click wiped historic business data.

**After:**

```sql
UPDATE items
   SET is_active = false,
       deleted_by = <auth user.id>,
       updated_at = now()
 WHERE id = $1;
```

- Every child row still resolves to a live parent; FK integrity preserved.
- An accidental delete is reversed by flipping `is_active` back to `true`.
- The audit log captures a full pre-delete snapshot, the deletion reason,
  and the caller's verified email.
- Summary cards (ACTIVE / INACTIVE / TOTAL) naturally pick up the new
  INACTIVE count because `is_active` is already the filter they drive off.

## Schema Migration — `item_code` → `part_number`

A phased plan is documented in
[`docs/SCHEMA_MIGRATION_item_code_to_part_number.md`](../SCHEMA_MIGRATION_item_code_to_part_number.md).
Phases completed in this release:

### Phase 1 — Unique constraint on `items.part_number`

```sql
ALTER TABLE public.items
  ADD CONSTRAINT items_part_number_unique UNIQUE (part_number);
```

Five pre-existing duplicate `part_number`s were resolved by rename +
deactivate (zero data loss — children retain their FK references).

### Phase 2 — Back-filled `part_number_new` on all dependent tables

24 child tables (13 hard-FK tables + 11 denormalized `pack_*` /
packing tables) received a `part_number_new` column populated from
`items.part_number` via a join on `item_code`. All 24 tables verified
orphan-free (`COUNT(*) WHERE part_number_new IS NULL = 0`).

### Phase 3a — New FK constraints on `part_number_new`

12 `FOREIGN KEY (part_number_new) REFERENCES items(part_number)`
constraints added without dropping the legacy `item_code` FKs. Dual-key
state: both columns resolve, app continues working off `item_code`.

### Deferred — Phase 3b / 4 / 5

Phase 3b (drop `item_code`, rename `part_number_new` → `part_number`) is
**deferred** until a verified point-in-time backup is available. The
project is currently on the Supabase free tier without PITR, so the cutover
will wait for either (a) a manual `pg_dump` snapshot or (b) a Pro-tier
upgrade. Edge functions and RPCs that still reference `item_code` continue
to work against the legacy column; Phase 4 rewrites them against
`part_number` once 3b completes.

### Audit + UI now prefer `part_number`

- `im_delete-item` writes `audit_log.target_id = part_number` (was
  `item_code`). The response payload also switched from `item_code` to
  `part_number`.
- `UnifiedItemMaster.tsx` delete-success toast prefers `part_number`
  first, falling back to `master_serial_no` then `item_code`.

## Client Changes

- `src/utils/api/itemsSupabase.ts` rewritten as a thin wrapper around the
  four `im_*` edge functions. Public shape (`Item`, `ItemFormData`,
  `fetchItems`, `createItem`, `updateItem`, `deleteItem`) unchanged so call
  sites don't move.
- `UnifiedItemMaster.tsx` — removed direct Supabase client imports;
  `fetchCounts` folded into `fetchItems` via the edge-fn response;
  delete-success toast updated from "permanently deleted" to "deactivated".

## Files Added

- `supabase/functions/im_list-items/index.ts`
- `supabase/functions/im_get-blanket-orders/index.ts`
- `supabase/functions/im_upsert-item/index.ts`
- `supabase/functions/im_delete-item/index.ts`
- `docs/SCHEMA_MIGRATION_item_code_to_part_number.md`
- `docs/releases/CHANGES_0.5.4.md` (this file)

## Files Changed

- `src/utils/api/itemsSupabase.ts`
- `src/components/UnifiedItemMaster.tsx`
- `CHANGELOG.md`
- `README.md`
- `package.json`

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Staged dual-column state (`item_code` + `part_number_new`) drifts | Phase 2 verification rerun; both columns populated from the same join. Phase 3b will collapse them. |
| Soft-deleted item still visible in queries that don't filter `is_active` | Item Master UI already filters on `is_active`. Dependent modules read `items` via joins on existing child rows (unaffected by the flag). |
| Phase 3b requires a backup that doesn't exist yet | Phase 3b deliberately blocked until backup lands. All completed phases are additive and reversible. |

## Deployment Checklist

- [x] Deploy `im_list-items`, `im_get-blanket-orders`, `im_upsert-item`,
      `im_delete-item` with `--no-verify-jwt`
- [x] Apply Phase 1 / 2 / 3a SQL to production DB
- [x] Verify constraints with the queries in §5 of the schema migration doc
- [ ] **Before Phase 3b:** capture `pg_dump` of `items` + the 24 dependent
      tables, store off-project
- [ ] **Before Phase 3b:** confirm no new tables reference `item_code`
      (rerun `information_schema.columns` query)
