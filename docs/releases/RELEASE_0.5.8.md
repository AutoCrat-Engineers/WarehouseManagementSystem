# RELEASE 0.5.8 — Mobile Polish & Pallet Back-Chain Fixes

- **Date:** 2026-05-04
- **Type:** Patch
- **Branch:** `feature/pwa` → `develop-test` → `deploy/pre-prod` →
  `deploy/production`
- **Previous:** 0.5.7 (Inbound Receiving redesign · same day)

## What's in it

A targeted polish pass on top of the 0.5.7 redesign, driven by 3PL
operator feedback after the first day on phones.

### 1. Rack Storage on phones got a real mobile header

The 4 SummaryCards we were forcing into a 2×2 grid on phones were
massive and pushed actual content far below the fold. Replaced with a
**single-row 4-up KPI strip** (Racks · Locations · Items · Qty) with
compact number formatting (e.g. `1.2M`).

The Move + Add Stock buttons under the search box were rendering at
mismatched sizes because the wrapped `ActionButton` was ignoring its
parent `flex: 1`. Replaced with custom buttons — both **44 px tall,
equal width**, balanced visual weight (Move outlined, Add Stock
solid primary).

The rack tabs (Rack A / B / C) were leaking a grey horizontal
scrollbar because each tab was wide enough that `overflow-x: auto`
kicked in. On mobile each tab now uses `flex: 1` so they share the
strip equally with **no scrollbar**.

The **Add Locs / Reduce** pair below the rack title now stretches
full-width on mobile, both buttons at 40 px height, with the active
rack's color tint on Add Locs.

### 2. Pallet Back-Chain drawer cleaned up

Click any cell → click any pallet → the drawer that shows the full
trace from pallet up through invoice / BPA / shipment / GR.

- **Packing List** section removed (it was duplicating Invoice & BPA
  context above it).
- **Inner Boxes** renamed to **Inner Packing IDs** and the data
  source switched from `container_number` to the actual `packing_id`.
  The list went from a 60-row bullet list that hijacked the entire
  drawer to a compact **chip grid** (2 cols mobile, 3 cols desktop)
  with internal scroll capped at 280 px.
- The **PALLET section's Shipment #** row was always `—` because
  `pallet.shipment_sequence` is rarely populated. Now falls back to
  `shipment.shipment_number` so it actually shows the value.
- **OH:** is now **On-Hand:** with a tooltip explaining what it
  means, and the mapping was rerouted to `usTransitOnHand →
  totalOnHand → usTransitStock` so it actually displays a number
  instead of being blank.

### 3. Blanket Release Step 5 Review & Submit

- Removed the **Customer Asked** row from the upper *BLANKET
  RELEASE* card.
- Upper card always shows **Quantity · Unit Price · Release Value**;
  unit price is the BPA price (already correct, just made
  unconditional).
- Lower **PALLET ALLOCATION** grid grew a 4th column:
  **Unit Price**, sourced from each invoice line's
  `parent_unit_price` (the MPL price). Multi-invoice releases now
  show the correct price for each invoice line.

## What's NOT in it

- No schema changes. No new tables, no new RPCs, no new edge
  functions.
- No service worker version bump — the SW shell from 0.5.7 still
  applies.
- No PWA manifest changes.
- No new dependencies.

## Files touched

```
package.json                                            (version 0.5.8)
README.md                                               (badge → 0.5.8)
CHANGELOG.md                                            (0.5.8 entry)
docs/releases/CHANGES_0.5.8.md                          (this release's CHANGES)
docs/releases/RELEASE_0.5.8.md                          (this file)
src/components/RackView.tsx                             (mobile + back-chain)
src/components/release/CreateRelease.tsx                (Step 5 review)
```

## Edge-function note (read this before going to prod)

The Inner Packing IDs chip grid reads
`pack_containers.packing_boxes.packing_id` off each carton in the
`pallet_get_back_chain` payload. If your live edge function still
selects only `container_number`, every chip will render as `—`.

The fix is a one-line update to the carton select inside
`pallet_get_back_chain`. The same pattern is already used in
`new_pac_queries` and `dis_packing_list_create`:

```ts
pack_containers!inner (
    container_number,
    quantity,
    container_type,
    is_adjustment,
    packing_box_id,
    packing_boxes:packing_box_id ( packing_id )
)
```

Apply that on the Supabase dashboard if the chips show `—` after
deploy.

## Branch / deploy flow

| Branch              | Purpose                          | What lands     |
|---------------------|----------------------------------|----------------|
| `feature/pwa`       | Active development               | All commits    |
| `develop-test`      | Internal smoke (post-PR)         | All commits    |
| `deploy/pre-prod`   | Docker pipeline → pre-prod IP    | Frontend only  |
| `deploy/production` | Customer-facing                  | Frontend only  |

Frontend-only branches strip these paths during forward-port:
`supabase/`, `scripts/`, `docs/(architecture|adr|reference|releases|workflows)/`.
For 0.5.8 the only paths in `docs/releases/` are the two new release
docs — the path-gate strip is expected to drop them on the deploy
branches.

## Sign-off

- Code review: pending
- QA mobile pass: required (Android + iOS Safari)
- 3PL operator UAT: requested before promoting to `deploy/production`
