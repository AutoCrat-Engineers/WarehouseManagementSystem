# Release Report — v0.5.5

| Field | Value |
|---|---|
| **Version** | 0.5.5 |
| **Type** | Minor (backwards-compatible) |
| **Release date** | 2026-04-25 |
| **Previous release** | 0.5.4 (2026-04-21) |
| **Days since prev release** | 4 |
| **Net code delta** | 15 new DB migrations · 1 new edge function · 6 modified edge functions · 7 new UI components · 3 modified UI components |
| **Risk level** | **Low** — all changes additive; no schema drops; migration data carries `source = 'MIGRATION*'` and is fully reversible |

---

## What ships

This release ships two large, independent work-streams that were
developed in parallel against `develop-test` and merged together:

### 1. Release Allocation Holds System

Inventory now answers four questions per `(part × warehouse)` instead
of one:

| Bucket | Meaning |
|---|---|
| **On-Hand** | Physical pallets in the rack right now |
| **Allocated** | Locked for the highest-priority release in scope (earliest `need_by_date`) |
| **Reserved** | Held for lower-priority competing releases |
| **Available** | `On-Hand − Allocated − Reserved` (free for new releases) |

Stock no longer decrements when a sub-invoice is created — only when
the linked release flips to `DELIVERED`. MPL cancellations cascade to
dependent pallets so the rack drawer never points at cancelled
paperwork again.

### 2. Historical Data Import (Phases M1 → M4)

First production import of legacy data:

| Phase | What was seeded |
|---|---|
| **M1 — Agreements** | 4 customer BPAs (1 SPOT, 3 BPA, including 1 informal-borrow host and 1 synthesized) |
| **M2 — Shipments** | 27 invoices · 27 proformas · 27 master packing lists · **197 pallets** placed across racks A–G · 27 goods receipts · 197 GR lines |
| **M3 — Releases** | 30 releases · 31 sub-invoices · 84 release-pallet assignments · 31 tariff invoices · 84 pallets flipped to `RELEASED` |
| **M4 — Rollups & UI fixes** | `blanket_order_line_configs` running totals back-filled; `proforma_invoice_mpls` junction populated; rack codes normalised; sub-invoice lines seeded |

Every imported row carries a `source = 'MIGRATION*'` provenance tag.
Live RPCs continue to write `source = 'MANUAL'`. Rollback is one
script.

---

## Numbers at a glance

| Metric | Before (0.5.4) | After (0.5.5) | Δ |
|---|---|---|---|
| DB migrations applied | 018–043 (26) | 018–058 (41) | +15 |
| Production tables | 60 | 62 | +2 (`release_pallet_holds`, `customer_agreement_revisions` *) |
| Edge functions deployed | 58 | 59 | +1 (`release_allocate_pallets`) |
| Materialized views | 2 | 2 (rebuilt) | — |
| BPAs in DB | 0 | 4 | +4 |
| Pallets in 3PL rack | 0 | 197 | +197 |
| Releases tracked | 0 | 30 | +30 |
| Tariff invoices | 0 | 31 | +31 |

\* `customer_agreement_revisions` existed pre-0.5.5 but is exercised
for the first time by the historical import.

---

## Acceptance verification

After applying the migrations, every phase prints a verification
NOTICE that the migration runner asserts on. Sample output:

```
NOTICE:  [M1] Seeded 4 agreements, 5 part rows
NOTICE:  [M2] proformas=27, pallets=197, gr=27, gr_lines=197
NOTICE:  [M3] releases=30, sub_invoices=31, assignments=84,
              tariff_invoices=31, released_pallets=84
NOTICE:  [M4-fix] bolc released_sum=85452, view released_sum=85452
NOTICE:  [055] pim=27, mpls=27, gr_with_mpl=27, pi_ready=27
NOTICE:  [056] remaining old-format rows=0, sample new code=A1
NOTICE:  [057] headers=31, lines=31, distinct_parts=5
NOTICE:  [058] rack_locs with agreement_id=197, remaining null+has_number=0
```

Any failure aborts the migration in a transaction. Re-running the
phase is safe (idempotent DELETE-then-INSERT keyed on `source` /
pallet number prefix).

---

## Risk assessment

| Risk | Mitigation |
|---|---|
| Migration over-credits stock if re-run | DELETE-first guards keyed on `source LIKE 'MIGRATION%'` and `pallet_number LIKE 'PLT-2526%'` |
| Allocation logic changes break existing OPEN releases | Migration 045 back-fills holds for any pre-existing OPEN release; release-level priority kicks in immediately |
| MV staleness hides correct numbers in BPA dashboard | Both materialized views are now refreshed at the end of every migration that writes their source tables |
| Live writes blocked by migration | All migration SQL runs `BEGIN…COMMIT` and avoids `LOCK TABLE`; production writes coexist |

---

## Rollback

The historical import can be reverted without dropping any schema
or affecting live (`MANUAL`) rows. The rollback recipe is a single
SQL block (~20 statements, all keyed on `source` / pallet-number
prefix). See [`IMPLEMENTATION_0.5.4_TO_0.5.5.md`](IMPLEMENTATION_0.5.4_TO_0.5.5.md)
§ "Rollback recipe" for the full script.

For the allocation-holds system there is no rollback target — the
new behaviour is a strict superset of the old (the old global "free
pallet" view is still the union of `Available + Reserved`). Reverting
would require dropping migrations 044–048, which is unsupported.

---

## Documentation produced

- [`CHANGES_0.5.5.md`](CHANGES_0.5.5.md) — release notes (Keep-a-Changelog format)
- [`RELEASE_0.5.5.md`](RELEASE_0.5.5.md) — this file (executive summary)
- [`IMPLEMENTATION_0.5.4_TO_0.5.5.md`](IMPLEMENTATION_0.5.4_TO_0.5.5.md) — full technical change log

---

## Sign-off

This release was developed and verified end-to-end against the
production Supabase project. All migrations have been applied to
the dev database and verification NOTICEs match expected counts.

`package.json` has been bumped to `0.5.5`. Tagging and remote push
are gated on engineering team approval.
