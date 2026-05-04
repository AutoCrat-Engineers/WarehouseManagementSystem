# CHANGES — v0.5.8

- **Version:** 0.5.8
- **Release Type:** Patch
- **Date:** 2026-05-04
- **Previous Version:** 0.5.7 (2026-05-04)

## Summary

0.5.8 is a focused polish release on top of the 0.5.7 Inbound Receiving
redesign. Two areas got attention:

1. **Rack Storage on phones** — the page that 3PL operators stare at
   all day. The mobile header was bleeding off-screen, the rack tabs
   were leaking a grey scrollbar, and the action buttons under the
   search were rendering at mismatched sizes. Re-laid out with a
   compact 4-up KPI strip, equal-flex tabs, and balanced 44px / 40px
   button pairs.
2. **Pallet Back-Chain drawer** — accessible from any cell click in
   Rack Storage. Removed the *Packing List* section (redundant with
   *Invoice & BPA*), renamed *Inner Boxes* → *Inner Packing IDs* and
   switched the ID source from `container_number` to the actual
   `packing_id` (with a compact chip grid + internal scroll instead of
   a 60-row bullet list), populated the empty Shipment # field on the
   PALLET section, and swapped the cryptic `OH:` for `On-Hand:` with a
   tooltip — and a mapping fix so the field actually shows data.

A separate fix on the Blanket Release wizard's Step 5 review modal
removes the *Customer Asked* line from the upper card and adds a
**Unit Price** column (sourced from each invoice line's MPL price) to
the Pallet Allocation grid.

## Scope

| Area                    | Change Type      |
|-------------------------|------------------|
| Rack Storage (mobile)   | UI / responsive  |
| Pallet Back-Chain       | UI / data fix    |
| Blanket Release Step 5  | UI / data fix    |
| Edge functions          | None             |
| Database migrations     | None             |
| Service worker / PWA    | None             |

Patch release — no schema changes, no edge-function deploys, no SW
bumps.

## Files touched

```
package.json                                            (version 0.5.8)
README.md                                               (badge → 0.5.8)
CHANGELOG.md                                            (0.5.8 entry)
docs/releases/CHANGES_0.5.8.md                          (this file)
docs/releases/RELEASE_0.5.8.md                          (release notes)
src/components/RackView.tsx                             (mobile + back-chain)
src/components/release/CreateRelease.tsx                (Step 5 review)
```

## Detail by area

### Rack Storage (mobile)

- **Summary cards** — replaced `SummaryCardsGrid columns={4}` (which
  forced 4 cards into ~340px of usable width on phones, blowing the
  layout) with a single bordered container holding 4 `MiniKpi` tiles
  in a row. Numbers use a compact formatter (`1.2M`, `150k`) so big
  totals don't wrap.
- **Filter bar** — search box now uses `minWidth="0"` so it stops
  demanding 260px and clipping. Move / Add Stock are now custom
  buttons (not the wrapped `ActionButton`) so they actually honor the
  `flex: 1` parent — both render at exactly 44px tall, full width.
  Add Stock has a slight elevation (`box-shadow: 0 1px 2px
  rgba(30,58,138,0.18)`) to keep the primary/secondary hierarchy
  legible.
- **Rack tabs** — on mobile each tab now uses `flex: 1` with
  `overflowX: hidden`, so the 3 racks share the full strip and there
  is no scroll bar. Padding tightened to `10px 6px` and gap to 4px.
  Desktop branch unchanged (still scrolls if many racks).
- **Add Locs / Reduce** — row stretches `width: 100%` on mobile, both
  buttons take `flex: 1`, height 40px, font 13px, icons 15px, radius
  8px. Add Locs keeps the active rack's color tint; Reduce stays
  neutral.

### Pallet Back-Chain drawer

- **Packing List section** — removed entirely. The Invoice & BPA
  section above it already covers the same parent traceability.
- **Inner Boxes → Inner Packing IDs** — section title renamed,
  display switched from `<ul>` of `container_number` lines to a
  compact chip grid:
  - 2 columns on mobile, 3 columns on desktop
  - Each chip: monospace bold packing ID + qty (+ `(adj)` flag if
    applicable)
  - Inner area scrollable (`maxHeight: 280px`) so 60+ rows stay
    contained
  - Field source: `pack_containers.packing_boxes.packing_id`, with
    fallbacks to `pack_containers.packing_id` and `c.packing_id`
  - **NB:** the `pallet_get_back_chain` edge function must select
    `packing_boxes:packing_box_id(packing_id)` for the chips to
    populate. Other functions (`new_pac_queries`,
    `dis_packing_list_create`) already use this select shape.
- **PALLET section · Shipment #** — was always `—` because
  `palletDetail.pallet.shipment_sequence` is rarely populated. Now
  falls back to `palletDetail.shipment.shipment_number`, rendered
  monospace bold like the other IDs in the section.
- **Shipment (Proforma) section · Shipment #** — reverted the
  brief experiment with a clickable navigation link; it's plain
  monospace text again per user feedback.
- **OH → On-Hand** — relabel + tooltip ("On-Hand: total US warehouse
  stock for this MSN across all racks"). Mapping changed from
  `i.usTransitStock ?? 0` (often 0/null on the dashboard view) to
  `i.usTransitOnHand ?? i.totalOnHand ?? i.usTransitStock ?? 0` so a
  populated value actually shows up.

### Blanket Release · Step 5 Review & Submit

- **Upper card (BLANKET RELEASE)** — removed the
  `Customer Asked` row entirely. The card now always shows:
  BPA · Revision · Status · Customer · Buyer · Order Date · Need By ·
  Part · MSN · **Quantity** · **Unit Price** (from BPA's
  `part.unit_price`) · **Release Value**. The amendment banner above
  the card (red strip when releasing qty differs from customer ask)
  remains as the place where amendment details are surfaced.
- **Lower card (PALLET ALLOCATION)** — grid was 3 columns
  (Shipment / Invoice / Release Qty), is now 4 columns:
  - Shipment Number
  - Invoice Number
  - **Unit Price** — sourced from `parent_unit_price` (the MPL /
    invoice line price) on each pallet, captured during the
    `invoiceBreakdown` reduce
  - Release Qty
  Per-row mapping ensures multi-invoice releases show the correct
  price for each invoice line, not a single BPA-level price.

## Migrations

None. 0.5.8 ships zero new tables, zero new RPCs, zero new edge
functions.

## Backward compatibility

Fully compatible. No public API surface changes.

## Risks / known gaps

- The Inner Packing IDs chip grid renders `—` if the
  `pallet_get_back_chain` edge function does not select
  `packing_boxes:packing_box_id(packing_id)`. The fix is a one-line
  addition to that function's select; if the production deploy still
  shows `—`, update the edge function on the Supabase dashboard.
- `parent_unit_price` is read off `AvailablePallet`. Pallets whose
  parent invoice line has no price set will display `—` in the new
  Unit Price column. This is correct (pre-MPL stock).

## Verification

- [x] Mobile (≤768 px): Rack Storage page no longer overflows
      horizontally; all controls reachable.
- [x] Mobile: rack tabs render without a scroll bar.
- [x] Pallet Back-Chain drawer: Packing List section gone; Inner
      Packing IDs chip grid scrolls; PALLET Shipment # populated; OH
      relabel visible.
- [x] Blanket Release wizard Step 5: Customer Asked row removed;
      lower grid shows Unit Price column.
- [ ] Edge-function `pallet_get_back_chain` patched on dashboard if
      packing IDs render as `—`.
