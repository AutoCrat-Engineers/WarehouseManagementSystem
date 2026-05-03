# Implementation Report — 0.5.5 → 0.5.6

> **Range:** 2026-04-25 (v0.5.5) → 2026-05-03 (v0.5.6) · **Cycle length:** 8 days
> **Branches involved:** `develop-test` · **Audience:** engineering, ops, QA, SRE
>
> This is the single source of truth for every change shipped in 0.5.6.
> The headline feature is the **Intelligent Pallet Allocation** flow inside the
> New Blanket Release wizard — a subset-sum matcher that finds whole-pallet
> combinations satisfying a customer's ask exactly, or proposes the closest
> options above/below with auto-generated customer amendment artefacts.
>
> Use the Table of Contents to skim.

---

## Table of Contents

1. [Executive summary](#1-executive-summary)
2. [Problem statement & business context](#2-problem-statement--business-context)
3. [Architecture overview](#3-architecture-overview)
4. [Algorithm — subset-sum matcher](#4-algorithm--subset-sum-matcher)
5. [Frontend — wizard rebuild](#5-frontend--wizard-rebuild)
6. [Print artefacts — picking list & amendment draft](#6-print-artefacts--picking-list--amendment-draft)
7. [Adjacent improvements bundled in 0.5.6](#7-adjacent-improvements-bundled-in-056)
8. [Database changes](#8-database-changes)
9. [Edge functions](#9-edge-functions)
10. [Files touched (manifest)](#10-files-touched-manifest)
11. [Verification recipes](#11-verification-recipes)
12. [Rollback recipe](#12-rollback-recipe)
13. [Known limitations & follow-ups](#13-known-limitations--follow-ups)

---

## 1. Executive summary

**Headline feature** — `Intelligent Pallet Allocation` (Step 4 of the New Blanket
Release wizard). When the operator enters the customer's requested quantity, the
system now:

1. **Auto-matches whole pallets** to fulfil the request exactly using a two-stage
   subset-sum strategy (FIFO-prefix shortcut → DP-based subset search).
2. If no exact whole-pallet combination exists, **proposes two amendments**
   — closest reachable sum *above* and *below* the request — each with the
   pallet list, delta vs ask, and an auto-generated customer-facing message
   draft.
3. If stock is short, raises an **insufficient-stock** card with a
   "ship the available qty as partial fulfilment" path.
4. **Generates two industrial-grade print artefacts** from the Review step:
   - **Picking List** for the warehouse (rack-sorted, pick-checkbox, signature
     blocks).
   - **Amendment Draft** for the customer (mirrors OPW's release-document
     format with diff'd quantities).

**Bundled fixes / UX upgrades** in the same cycle:

- Removed the obsolete S&V warehouse end-to-end (frontend, edge functions,
  views, data) — migration 059.
- Backfilled `shipment_number` on 29 historical proformas + 27 goods-receipts
  — migration 060.
- BPA Detail per-part fulfilment focus (open from a part card → Fulfilment
  tab is filtered to that part).
- BPA Detail "Drafted" filter pill bug fix (was `'DRAFT'`, should have been
  `'OPEN'`).
- BPA List per-row "New Release" loading state (no longer shared across cards).
- Auto-detected next release sequence on the Release wizard.
- Inventory Hub UI polish — US Warehouse card recoloured (red → teal),
  in-transit "Allocated" relabelled to "Reserved", per-release breakdown with
  visual progress bars.

**Counts** — 1 new DB migration (060) · 1 modified DB migration (snv removal,
059) · 1 modified edge function (`release_list_available_pallets`) · 2 new
frontend modules (`palletMatcher.ts`, `releasePrints.ts`) · 4 modified UI
components · 0 schema changes related to the matcher itself.

---

## 2. Problem statement & business context

### 2.1 Why the old flow was inadequate

Before 0.5.6, the Release wizard had a rigid Part & Quantity step that:

- Showed the BPA's `release_multiple` as a **hard step value** on the qty
  input (`step={relMult}`), implicitly forcing customer asks to be a multiple
  of REL MULT.
- Validated `qty % relMult !== 0` with a soft warning but didn't help the
  user resolve it.
- Then handed off to a manual pallet picker where the operator had to find
  a combination summing to the requested qty by hand.

The reality on the warehouse floor:

- **Pallet outer-quantities vary per shipment.** One shipment may pack 250
  pcs/pallet, the next 900 pcs/pallet, the next 1,000 pcs/pallet. The
  agreement-level REL MULT is a planning hint, not a dispatch constraint.
- **Customers ask for round-ish numbers** (1,450, 3,250) that rarely sum
  cleanly from whole pallets in the rack.
- **We dispatch only whole pallets** — partial-pallet picks are not a
  business option.

The operator was therefore left with two unattractive choices:

- Trial-and-error pallet selection until the running total matched the ask.
- Manually phone the customer and negotiate an amended quantity.

### 2.2 The user-articulated requirement

Direct quote from the spec, lightly edited for legibility:

> *"if customer will give us i need 3250 quantity so system should think — ok
> we have 250 pallet and 3000 pallet so we will take 2nd and 5th shipment
> pallets. Match in FIFO first, if it's not matching then it can select like
> that. Scenarios — if we don't get the 3250 quantity pallets, system should
> ask user: option 1 — pick 900 pallet then tell customer to amend, option 2
> — tell customer we don't have 250 pallet, amend to 3000 only. User selects
> any 1 and generates the amended release for customer confirmation. If we
> have 3000 + 250 quantity pallet, no pallet picking — use that screen for
> this process."*

### 2.3 What "good" looks like

| Scenario | System behaviour |
|---|---|
| **Exact match exists, FIFO prefix sums to ask** | Auto-allocate, no UI choice required, no amendment. |
| **Exact match exists via non-prefix subset** (e.g. *250 + 3000 = 3250*) | Auto-allocate, no amendment. |
| **No exact match** | Show two amendment options (closest above, closest below) with pallet lists + ready-to-send customer message. |
| **Insufficient stock** | Block dispatch, offer partial-fulfilment path. |
| **Operator override** | "Pick manually" link drops back to the legacy grouped picker. |

---

## 3. Architecture overview

### 3.1 Layered breakdown

```
┌──────────────────────────────────────────────────────────────────────┐
│                           USER (operator)                             │
└──────────────────────────────────────────────────────────────────────┘
                                  │
                                  ▼
┌──────────────────────────────────────────────────────────────────────┐
│  Step 4 — Pallet Allocation  (CreateRelease.tsx, new)                 │
│  ┌────────────────────────────────────────────────────────────────┐ │
│  │  Load pallets ──► matchPallets(...) ──► render result          │ │
│  └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
                                  │
            ┌─────────────────────┴──────────────────────┐
            ▼                                            ▼
┌────────────────────────────────┐         ┌─────────────────────────────┐
│  palletMatcher.ts (new)         │         │  releaseService.ts (existing)│
│  pure-TS subset-sum             │         │  listAvailablePallets()      │
│  no I/O · O(target × N)         │         │  ──► edge fn over HTTPS      │
└────────────────────────────────┘         └─────────────────────────────┘
                                                              │
                                                              ▼
                                              ┌──────────────────────────────┐
                                              │ release_list_available_      │
                                              │ pallets (Deno edge fn)       │
                                              │  · GR lines + pack_pallets   │
                                              │  · MPL → proforma → shipment │
                                              │  · FIFO sort                 │
                                              └──────────────────────────────┘
                                                              │
                                                              ▼
                                              ┌──────────────────────────────┐
                                              │ Postgres                     │
                                              │  goods_receipt_lines,        │
                                              │  pack_pallets,               │
                                              │  master_packing_list_pallets,│
                                              │  release_pallet_assignments  │
                                              └──────────────────────────────┘
```

### 3.2 Why the matcher lives client-side

The user's stated guidance was *"use edge function where needed and frontend
client logic where only necessary"*. The matcher fits the *necessary client*
bucket because:

- Inputs are tiny (≤ 50 pallets per part typically) and already fully
  available client-side after `listAvailablePallets()`.
- Adding an RPC just to run subset-sum would add an HTTP round-trip, a Deno
  runtime cold-start, and a code-path duplication for no algorithmic benefit.
- The result drives an interactive UI (option cards, expand/collapse) that
  needs sub-100ms responsiveness — local computation hits that.
- Pure functions are trivially testable and have zero deployment surface.

### 3.3 State model

Two new fields on `WizardState` in [`CreateRelease.tsx`](../../src/components/release/CreateRelease.tsx):

```ts
interface WizardState {
    // ...
    customerRequestedQuantity: number;   // what the customer asked for
    requestedQuantity:         number;   // what we will actually ship
    adjustmentType:           'NONE' | 'UP' | 'DOWN' | 'MANUAL';
    selectedPallets:          Map<string, number>;   // pallet_id → qty
}
```

Invariants:

- `customerRequestedQuantity` is set in Step 3 and never auto-mutates again.
- `requestedQuantity` always equals `Σ selectedPallets.values()`.
- `adjustmentType === 'NONE'` ⇔ `requestedQuantity === customerRequestedQuantity`.
- Step 3 edits wipe `selectedPallets` and reset `adjustmentType` so the
  matcher re-runs on a clean slate.
- The DB write (`createRelease({ requested_quantity })`) uses `requestedQuantity`
  (the post-amendment final). The customer's original ask is in-session only —
  the printable amendment draft is the audit trail. (Persistence is a
  follow-up — see §13.)

---

## 4. Algorithm — subset-sum matcher

### 4.1 Module: [`src/components/release/palletMatcher.ts`](../../src/components/release/palletMatcher.ts) (new)

Pure TS, zero dependencies, framework-agnostic.

### 4.2 Public API

```ts
export interface MatcherPallet {
    id:        string;
    qty:       number;
    fifoOrder: number;   // lower = older
}

export interface MatcherSelection {
    pallets:  MatcherPallet[];
    totalQty: number;
}

export interface MatcherResult {
    exact:          MatcherSelection | null;
    exactVia:      'FIFO_PREFIX' | 'SUBSET_SEARCH' | null;
    above:          MatcherSelection | null;   // smallest reachable sum > target
    below:          MatcherSelection | null;   // largest  reachable sum < target
    availableTotal: number;
    insufficient:   boolean;                   // target > availableTotal
}

export function matchPallets(input: MatcherPallet[], target: number): MatcherResult;
```

### 4.3 Strategy

**Stage 1 — FIFO-prefix shortcut.** Sort pallets by `fifoOrder` ascending.
Walk them, maintaining a cumulative sum. If `cum + pallets[i].qty === target`
at any point, return the prefix as an exact match flagged
`exactVia: 'FIFO_PREFIX'`. This is the cheapest possible answer and most
aligned with FIFO discipline (oldest stock goes first, no skipping).

**Stage 2 — Subset-sum DP.** If the prefix sweep doesn't terminate, build
a parent-pointer DP table:

```
parent: Int32Array(cap + 1)
        // -2 = unreachable
        // -1 = base case (sum = 0)
        //  i = pallet index whose qty extended a smaller reachable sum to this one

cap = min(availableTotal, target + max(pallets.qty))
parent[0] = -1

for i in 0..N-1:
    q = pallets[i].qty
    for s in cap..q (descending — classic 0/1 knapsack iteration):
        if parent[s] === -2 and parent[s - q] !== -2:
            parent[s] = i
```

This is a standard 0/1 knapsack reachability scan, O(N × cap). Iterating in
descending `s` ensures each pallet is used at most once. Iterating pallets in
FIFO order (the outer loop) means that when multiple pallets could each reach
the same sum, the first to "claim" it is the oldest — so the recovered subset
is naturally biased toward FIFO.

**Recovery (`trace`).** Given a reachable sum, walk parent pointers backwards
to recover the pallet indices:

```
function trace(sum: number): MatcherPallet[] | null {
    if (parent[sum] === -2) return null;
    const out = [];
    let cur = sum;
    while (cur > 0) {
        const i = parent[cur];
        if (i < 0) return null;
        out.push(pallets[i]);
        cur -= pallets[i].qty;
    }
    return out.reverse();
}
```

**Output assembly.**

- `exact = trace(target)` if `parent[target] !== -2`.
- `above = first reachable s ∈ (target, cap]` via linear scan, then `trace(s)`.
- `below = first reachable s ∈ [0, target)` scanning *down* from `target - 1`,
  then `trace(s)`.

### 4.4 Cap selection

`cap = min(availableTotal, target + maxPalletQty)` is intentional:

- We need to evaluate `s > target` to find the *closest above*, but only just
  beyond — at most one pallet's worth above the target can satisfy the
  "smallest sum strictly above" definition (no combination of pallets is
  smaller than the largest single pallet, so beyond `target + maxQty` we'd
  never find a smaller-above).
- Capping at `availableTotal` avoids wasted DP cells when the target itself
  is close to the inventory ceiling.

### 4.5 Complexity

- Time: O(N × cap) where `N ≤ 50` typical and `cap ≤ ~500,000` for realistic
  release sizes. Roughly 25M boolean writes, ~30 ms in V8.
- Memory: `Int32Array(cap + 1)` — 4 bytes × cap = 2 MB for cap = 500k.
- Pathological tail: a target > 1M with 50 pallets would push DP table above
  4 MB and ~80 ms compute — still fine for an interactive UX. Above that,
  the matcher would need a heuristic (LP relaxation or pseudo-poly DP with
  qty GCD compression). Not needed at current data scale.

### 4.6 Worked examples

#### 4.6.1 Exact via FIFO prefix

Pallets `[300, 200, 500, 1000]` (FIFO oldest-first), target 500.

- FIFO sweep: cum 300, then `300 + 200 === 500` → return `[300, 200]`,
  `exactVia: 'FIFO_PREFIX'`.
- DP not needed.

#### 4.6.2 Exact via non-prefix subset

Pallets `[900, 250, 1000, 1600, 3000]` (FIFO oldest-first), target 3250.

- FIFO sweep: 900 → 1150 → 2150 → cum + 1600 = 3750 > 3250. No prefix
  matches exactly.
- DP runs, `cap = min(6750, 3250 + 3000) = 6250`.
- After processing all pallets, `parent[3250]` is set: reaching 3250
  required pallet 4 (qty 3000) on top of `parent[250]` which was set by
  pallet 1 (qty 250).
- `trace(3250)` → `[pallet@1 (qty 250), pallet@4 (qty 3000)]`.
- `exactVia: 'SUBSET_SEARCH'`.

#### 4.6.3 No exact match

Pallets `[500, 500, 500, 1000]`, target 1100.

- FIFO sweep: 500, 1000, then cum + 500 = 1500 > 1100.
- DP: `parent[1000]` set, `parent[1500]` set, `parent[1100]` unset.
- Above scan: `parent[1500]` is the smallest reachable above 1100 → 3 pallets
  of 500.
- Below scan: `parent[1000]` is the largest reachable below 1100 → 1 pallet
  of 1000 (or 2 of 500 — DP picks whichever was set first; either is correct).
- Output: `exact: null`, `above: 1500/3pallets`, `below: 1000/1pallet`.

#### 4.6.4 Insufficient stock

Pallets summing to 4,000, target 50,000.

- Early exit before DP: `target > availableTotal` returns `insufficient: true`
  with `below = { pallets: [...all], totalQty: 4000 }`.

### 4.7 Test matrix (suggested unit tests, not yet committed)

| Case | Inputs | Expected exact | Expected above | Expected below |
|---|---|---|---|---|
| Empty | `[]`, 100 | null | null | null |
| Zero target | `[10, 20]`, 0 | null | null | null |
| Single match | `[100]`, 100 | 100 | null | null |
| FIFO prefix | `[300, 200, 500]`, 500 | 500 (prefix) | – | – |
| Skip needed | `[900, 250, 1000, 1600, 3000]`, 3250 | 3250 (subset) | – | – |
| No exact, both sides | `[500, 500, 500, 1000]`, 1100 | null | 1500 | 1000 |
| Insufficient | `[100]`, 1000 | null | null | 100 |
| Large | 50 pallets, target 250k | Match in <100ms | … | … |

---

## 5. Frontend — wizard rebuild

### 5.1 Files

- [`src/components/release/CreateRelease.tsx`](../../src/components/release/CreateRelease.tsx) — modified
- [`src/components/release/palletMatcher.ts`](../../src/components/release/palletMatcher.ts) — new
- [`src/components/release/releasePrints.ts`](../../src/components/release/releasePrints.ts) — new
- [`src/components/release/types.ts`](../../src/components/release/types.ts) — added `shipment_number` to `AvailablePallet`

### 5.2 Step 3 — Part & Quantity (softened)

Old behaviour:

- `<input step={relMult}>` forced multiple-of-REL-MULT entry on the input.
- Hard `mismatchRelMult` warning banner.

New behaviour:

- Input has no `step` attribute — operator types whatever the customer asked.
- REL MULT is shown only as a soft hint tile next to the input (right-aligned).
- Editing the qty wipes `selectedPallets` + resets `adjustmentType` so Step 4
  re-runs cleanly.
- The input value drives `customerRequestedQuantity` (and initially mirrors
  it to `requestedQuantity` until the matcher amends).

### 5.3 Step 4 — Pallet Allocation (full rebuild)

Three render paths driven by `MatcherResult`:

#### 5.3.1 Allocation summary (always)

3-tile KPI strip: `Customer Asked` · `Available in Rack` · `Stock Coverage`
with semantic-coloured left rails (green when sufficient, red when short).

#### 5.3.2 Path A — Exact match (`matcher.exact !== null`)

Single hero card, green theme:

- Title: *"Perfect FIFO Match"* if `exactVia === 'FIFO_PREFIX'`,
  otherwise *"Exact Match Found"*.
- Subtitle: *"N pallets · X pcs · across M shipments"*.
- Reasoning sentence explains *why* this is exact (oldest pallets fulfil
  request, vs. non-prefix subset).
- Expand toggle reveals the pallet list.
- Auto-applied: a `useEffect` watching `matcher.exact` writes the selection
  into wizard state (skipped if user has flipped to manual mode or already
  matches).

#### 5.3.3 Path B — No exact match (`matcher.exact === null && !insufficient`)

Two stacked option cards (full-width each, vertical layout):

| Field | Round Up (▲) | Round Down (▼) |
|---|---|---|
| Theme | Amber `#fffbeb / #d97706` | Blue `#eff6ff / #2563eb` |
| Headline | *"ROUND UP TO {target}"* | *"ROUND DOWN TO {target}"* |
| Meta | Pallets count · `+Δ vs Ask` | Pallets count · `−Δ vs Ask` |
| Selection | Radio + click area | Radio + click area |
| Expand panel | 2-col: pallet list (left) · customer message draft + Copy button (right) | Same |

Selecting an option:

- Sets `selectedPallets` to that selection's pallets.
- Sets `requestedQuantity` to `selection.totalQty`.
- Sets `adjustmentType` to `'UP'` or `'DOWN'`.

#### 5.3.4 Path C — Insufficient stock (`matcher.insufficient`)

Single red hero with shortfall figure (`customerAsk − availableTotal`) and a
"Accept partial · ship X pcs" button that adopts the entire available
inventory as a partial fulfilment. `adjustmentType` ends up `'DOWN'`.

#### 5.3.5 Manual override

Small underlined link below all paths: *"Override and pick pallets manually →"*.
Clicking flips `manualMode` and renders the legacy grouped picker
(`Step4Manual`, the original Step4Pallets body preserved verbatim except for
state-binding tweaks). Picking pallets there sets `adjustmentType: 'MANUAL'`.

### 5.4 Auto-generated customer message

In each option card's expanded view, an `OptionCard.customerScript` template
string is rendered in a dashed-border panel with a "Copy message" button:

```ts
const customerScript = kind === 'up'
    ? `Hi {customer}, on release {po} we have whole-pallet stock that totals
       {target} pcs (the closest above your ask of {customerAsk}). Please
       confirm an amendment to {target} pcs (+{delta}) so we can dispatch.`
    : `Hi {customer}, on release {po} our whole-pallet stock totals {target}
       pcs (the closest below your ask of {customerAsk}). Please confirm an
       amendment to {target} pcs (−{delta}) so we can dispatch.`;
```

Copy-to-clipboard uses `navigator.clipboard.writeText` with a try/catch
fallback so a missing clipboard API doesn't crash the UI.

### 5.5 Step 5 — Review & Submit (adjustment surfacing)

When `customerRequestedQuantity !== requestedQuantity`:

- **Top banner** (amber/blue/grey, color-keyed to `adjustmentType`):
  *"Customer amendment required: customer asked X · this release will ship Y
  pcs (±Δ). Send the customer the amended release for confirmation before
  dispatch."*
- **Header pill** in the Blanket Release card title row:
  *"▲ AMENDED UP"* / *"▼ AMENDED DOWN"* / *"✎ MANUAL"*.
- **Quantity grid** swaps `Quantity` for `Customer Asked` + `Releasing`
  with the latter highlighted in the primary blue.
- **Print buttons** in the top-right of the review:
  - *Picking List* — always when pallets selected.
  - *Amendment Draft* — only when adjusted; tinted to match direction.

### 5.6 Form-validation (`canGoNext`)

Step 4's gate now requires:

```ts
const sel = Σ state.selectedPallets.values();
return sel > 0 && sel === state.requestedQuantity;
```

— i.e. the user has actually committed to a selection (auto-applied exact, or
clicked a Round-Up/Round-Down option, or manually picked) and the running
total equals the (possibly amended) requested qty.

### 5.7 Visual polish

Beyond the matcher itself, the rebuild incorporates these UX patterns:

- **`fontVariantNumeric: 'tabular-nums'`** everywhere quantities appear, so
  digits column-align under each other.
- **Semantic color tokens** — green = ready, red = blocking, amber = needs
  customer ack, blue = amendment-down (less alarming than amber).
- **MetaStat tiles** with right-aligned label + tabular-numeric value.
- **Sticky-style expand toggles** so option cards can be scanned at a glance
  before drilling in.
- **Independent inner scrolling** for the pallet list (`maxHeight: 220px`,
  `overflow: auto`) so long lists don't break card layout.

---

## 6. Print artefacts — picking list & amendment draft

### 6.1 Module: [`src/components/release/releasePrints.ts`](../../src/components/release/releasePrints.ts) (new)

Two exported functions, both following the existing `window.open() +
auto-print` pattern from `PerformaInvoice.tsx` / `PackingListPrint.tsx`:

```ts
export interface ReleasePrintData {
    bpa:                       CustomerAgreement;
    part:                      CustomerAgreementPart;
    releasePo:                 string;
    orderDate:                 string;
    needByDate:                string;
    buyerName:                 string;
    customerRequestedQuantity: number;
    requestedQuantity:         number;
    adjustmentType:           'NONE' | 'UP' | 'DOWN' | 'MANUAL';
    pallets:                   AvailablePallet[];
}

export function printPickingList(d: ReleasePrintData): void;
export function printAmendmentDraft(d: ReleasePrintData): void;
```

Each builds an HTML string, opens a new window, writes the HTML, closes the
document, and triggers `window.print()` on load.

### 6.2 Shared print CSS

A single `SHARED_CSS` constant defines:

- A4 portrait, 6 mm margin, 9.5px base font.
- 1.5px outer border (`.outer`).
- Diagonal `AUTOCRAT ENGINEERS` watermark via `position: fixed` + rotation.
- Title bar (`.title`, `.subtitle`).
- Cell helpers (`.bb`, `.br`, `.bt`, `.c4`, `.ctr`, `.rgt`, `.lbl`, `.mono`).
- Adjustment chips (`.chip-up` / `.chip-down` / `.chip-manual`).

### 6.3 Picking List

Internal warehouse document for Milan/3PL. Sections:

1. **Top date bar** — print timestamp, picking-list number, page number.
2. **Header band** — Autocrat company block (left) + bold italic
   `PICKING LIST` title (right).
3. **Reference grid** — Picking List No., Issued On, Customer, Buyer, BPA,
   Release PO, Order/Need-By Date, Part No., MSN, Customer Asked, Pull Quantity.
4. **Amendment banner** (only if amended) — high-contrast yellow stripe
   warning the picker about pending customer confirmation.
5. **Items table** — sorted by `location_code` for an efficient pick walk:
   `SL · Rack · Pallet ID · Qty · Shipment · Parent Invoice · Placed · ✓ Picked`.
   The ✓ column has an empty checkbox the picker ticks on the floor.
6. **Totals row** — total to pull, estimated load value (qty × unit price),
   pallet count.
7. **Signature blocks** — Picker (name + signature + date), Verifier (L2/L3),
   Discrepancy notes, Forklift/Carrier capture lines.
8. **Standing instructions** — whole-pallet rule, escalation path.

### 6.4 Amendment Draft (customer-facing)

Mirrors **OPW's release-document format exactly** (the customer's reference
PDF was provided in-conversation) so the customer sees a familiar mirror with
amended numbers diff'd inline.

Layout (top-down):

1. **Page 1 of 1** marker (top-right).
2. **Three-column top band**:
   - *Customer header* (left) — name + tagline + delivery address.
   - *Ship To* (middle) — same address.
   - *Title block* (right) — `Release Amendment` title, `PENDING CUSTOMER
     CONFIRMATION` subtitle, and a stacked grid of `Order No / Revision /
     Order Date / Created By / Contact Number / Amendment Date / Current Buyer`.
3. **Three-column second band**:
   - *Supplier* (us — Autocrat).
   - *Bill To* (customer).
   - *Reference grid* — `BPA Number / Revision / Need-By Date / Adjustment
     chip / Issued On / Total Pallets`.
4. **Acknowledgement banner** — `Amendment Acknowledgement Required within
   24 hrs.` (mirrors OPW's *"PO Acknowledgement Required within 24 hrs."*).
5. **Two-row commercial strip** — `SUPPLIER NO · PAYMENT TERMS · FREIGHT TERMS
   · FOB / INCOTERMS · TRANSPORTATION · SHIP VIA`, then `SUPPLIER CONTACT ·
   SUPPLIER PHONE · SUPPLIER EMAIL · DELIVER TO`.
6. **Note to Customer** — full-width prose explaining why the qty changed.
7. **Items table** with the customer's column geometry: `Line · Part No /
   Description · Need-By Date · Quantity · UOM · Unit Price · Tax · Extended
   Price`. The Quantity and Extended Price cells contain a **two-line diff**:
   strike-through original above, green new value below.
8. **Drawing Number / Drawing Revision / MSN** sub-row.
9. **Note to Supplier** sub-row — shipment draw-down (`SHIP-2025-019 (Inv …):
   560 pcs / 2 pallets · …`) and BPA Min/Max.
10. **TOTAL (USD)** bottom-right, font-size 13px.
11. **Customer Acknowledgement** signature panel — two columns (customer
    signs left, Autocrat counter-signs right), with a pre-filled legal
    sentence summarising the agreement.
12. **Declaration** — supersedes-original-quantity statement, references
    underlying BPA.
13. **Bottom bar** — release ID, print timestamp, "Draft — pending customer
    confirmation".

### 6.5 Wiring in Step 5

Two buttons in the Review header:

```tsx
<button onClick={() => printPickingList(buildPrintData())}>Picking List</button>
{adjusted && (
    <button onClick={() => printAmendmentDraft(buildPrintData())}>
        Amendment Draft
    </button>
)}
```

`buildPrintData()` is a thin closure that snapshots the wizard state into the
`ReleasePrintData` shape. Both buttons gated on `canPrint` (BPA loaded, part
selected, ≥1 pallet picked).

### 6.6 Pop-up blocker handling

```ts
const w = window.open('', '_blank', 'width=900,height=1100');
if (!w) {
    alert('Pop-up blocked. Allow pop-ups for this site to print.');
    return;
}
```

— graceful degradation when the browser blocks the new window.

---

## 7. Adjacent improvements bundled in 0.5.6

### 7.1 S&V warehouse decommission

The S&V warehouse was retired. Files / data touched:

- `src/types/inventory.ts` — `'SNV'` removed from `WarehouseCategory`,
  `snvOnHand/Available/Reserved/Allocated/Stock` fields removed.
- `src/components/StockMovement.tsx` — `'SV'` removed from `LocationCode`,
  `LOCATIONS` map, both `Customer→S&V` / `S&V→In-Transit` movement routes,
  and the `WH-SNV-MAIN` DB-code mapping.
- `src/components/UnifiedItemMaster.tsx` — S&V warehouse card removed from
  the Multi-Warehouse tab.
- `supabase/functions/sm_submit-movement-request/index.ts`,
  `supabase/functions/new_sm_queries/index.ts`,
  `supabase/functions/sm_get-movements/index.ts` — `WH-SNV-MAIN` mapping,
  `'SV'` from `INTERNAL_LOCATIONS`, and S&V display name removed.
- Migration **059** (`059_remove_snv_warehouse.sql`):
  - Deletes `WH-SNV-MAIN` rows from `release_pallet_holds`,
    `inv_warehouse_stock`, `inv_movement_approvals`, `inv_movement_lines`,
    `inv_movement_headers`, `inv_stock_movements` (if present).
  - Drops the warehouse master row.
  - Recreates `vw_item_stock_distribution` (and dependents
    `vw_item_warehouse_detail`, `vw_item_stock_summary`,
    `vw_item_stock_dashboard`) without `snv_*` columns.

### 7.2 Historical shipment_number backfill

Migration **060** (`060_backfill_historical_shipment_numbers.sql`) populates
`shipment_number` on the 29 historical proformas + 27 goods-receipts that
migration 051 had imported with NULL. Numbering: `SHIP-YYYY-NNN` based on
year extracted from `proforma_number` (`PI-25xxxxxxxx → 2025`), sequenced by
`proforma_number` order. After backfill: 100% coverage on both tables.

This was discovered when the New Blanket Release wizard's Review step was
showing `—` for SHIPMENT NUMBER on every historical pallet — root cause was
that `pack_proforma_invoices.shipment_number` was not seeded by 051.

A companion edge-function patch in `release_list_available_pallets/index.ts`
adds `shipment_number` to the `goods_receipts!inner(...)` select and a new
`shipment_number` field on the response (preferring `goods_receipts.shipment_number`,
falling back to `pack_proforma_invoices.shipment_number`).

### 7.3 BPA Detail per-part fulfilment focus

[`src/components/bpa/BPADetail.tsx`](../../src/components/bpa/BPADetail.tsx)
gains a `focusPart?: string` prop. When set:

- Fulfilment tab filters `data.fulfillment` to the single matching
  `part_number`.
- A blue `FocusBanner` ("Filtered to part X · N other parts hidden — Show
  all parts →") sits above the table.
- Tab badge count reflects the filtered count.
- Clear-focus button re-shows everything.

[`src/components/bpa/BPAList.tsx`](../../src/components/bpa/BPAList.tsx)
threads `group.part_number` through `onOpenBPA(aid, partNumber)` so opening
a BPA from a per-part card pre-filters fulfilment. Parts tab is intentionally
not filtered (user wanted the parts count visible, fulfilment focused).

### 7.4 BPA Detail "Drafted" filter pill bug

The pill had `filter === 'DRAFT'` but `BlanketRelease.status` is
`'OPEN' | 'FULFILLED' | 'CANCELLED'`. The label *Drafted* is the friendly
display name for the `OPEN` status (consistent with `EmbeddedReleaseCard`
which already labelled OPEN rows as "Drafted"). Fix: change the filter
state union, the pill's `active`/`onClick`, and the `r.status === filter`
predicate from `'DRAFT'` to `'OPEN'`.

### 7.5 BPA List per-row "New Release" loading state

A single `loadingRelease` state at `BPAList`'s scope was passed to every
`PartCard`, so clicking one button spun all of them. Refactor: drop the
parent state, give each `PartCard` its own `const [busy, setBusy] = useState(false)`,
make the click handler `async` and wrap the `onNewRelease` call in a
`try/finally` that toggles `busy`.

### 7.6 Auto-detected next release sequence

[`Step2Header`](../../src/components/release/CreateRelease.tsx) on mount calls
`listReleases({ agreement_id, page_size: 500, status_filter: 'ALL' })`,
finds `MAX(release_sequence)` (with a regex fallback parsing trailing
`-N` from `release_number`), and pre-fills `releasePo` with
`{BPA-number}-{maxSeq + 1}`. Field stays editable; an `edited` flag prevents
overwriting after the user types. Visual cues: green AUTO chip when the
input matches the suggestion, hint line below explaining
*"N existing releases · next sequence: -K"*, and a *"Reset to {suggestion}"*
link when the user has wandered off.

### 7.7 Inventory Hub UI polish

- US Warehouse card: red gradient → teal (`#14b8a6 → #0d9488`). Red read as
  warning; teal pairs cleanly with the existing FG (navy) and In-Transit
  (info-blue) cards.
- In-Transit card: `Allocated` row relabelled to `Reserved` (bound field
  `blanketNextMonthReserved` was already a reservation, label was wrong).
- US Warehouse card body: redesigned from 4 stacked numbers to a hero
  *Available to Promise* tile + KPI chips (On Hand / Allocated / Reserved)
  + stacked utilisation bar + per-release breakdown with mini progress bars.
  See [§7.7.1](#771-us-warehouse-card-detail) for layout.

#### 7.7.1 US Warehouse card detail

```
┌─ US Warehouse ─────────────────────────────────[● HEALTHY · 20% UTIL]─┐
│ ╭──────────────╮  ╭ ON HAND ─╮ ╭ ALLOCATED ╮ ╭ RESERVED ─╮             │
│ │ AVAILABLE TO │  │ 300,000  │ │ 30,000    │ │ 30,000    │            │
│ │ PROMISE      │  ╰──────────╯ ╰───────────╯ ╰───────────╯            │
│ │ 240,000      │                                                       │
│ │ 80% of OH    │                                                       │
│ ╰──────────────╯                                                       │
│ ████████░░░░░░░░░░░░░░░░  Allocated 10% · Reserved 10% · Avail 80%    │
│ ┌─ ALLOCATED · 1 release ──┐ ┌─ RESERVED · 1 release ─────────────┐  │
│ │ 20260426001-2  100%  30k │ │ 20260426001-1  100%  30k            │  │
│ └──────────────────────────┘ └─────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
```

Backed by a new client function `getUSReleaseHolds(partNumber)` in
[`inventoryService.ts`](../../src/services/inventoryService.ts) that joins
`release_pallet_holds → blanket_releases (release_number)` filtered by the
US warehouse id (cached in module memory) + part number, aggregated by
`(release_number, hold_status)`.

---

## 8. Database changes

### 8.1 Migration 059 — `059_remove_snv_warehouse.sql`

| Statement | Rationale |
|---|---|
| `DELETE FROM release_pallet_holds WHERE warehouse_id = snv_id` | Clear allocations on the retired warehouse. |
| `DELETE FROM inv_warehouse_stock WHERE warehouse_id = snv_id` | Drop on-hand records. |
| `DELETE FROM inv_movement_approvals WHERE movement_id IN (...)` | Cascade-clean approvals before lines/headers. |
| `DELETE FROM inv_movement_lines WHERE header_id IN (...)` | Movement-line cleanup. |
| `DELETE FROM inv_movement_headers WHERE source/dest = snv_id` | Movement-header cleanup. |
| `DELETE FROM inv_stock_movements WHERE warehouse_id = snv_id` | Audit-log cleanup (table-exists guard via EXEC + EXCEPTION). |
| `DELETE FROM inv_warehouses WHERE id = snv_id` | Remove the master row. |
| `DROP VIEW … CASCADE; CREATE VIEW vw_item_stock_distribution …` | Rebuild without `snv_*` columns; cascade dependents. |

Idempotent on second run via `RAISE NOTICE 'WH-SNV-MAIN not found — nothing
to delete'` early exit.

### 8.2 Migration 060 — `060_backfill_historical_shipment_numbers.sql`

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

Wrapped in `BEGIN; … COMMIT;`. Final `DO $$ … RAISE NOTICE` reports
remaining-NULL counts. Idempotent — only touches `IS NULL` rows, so a
second run is a no-op.

### 8.3 No schema changes for the matcher itself

Deliberate: the matcher is a UI affordance for picking from existing
pallets. The chosen `requestedQuantity` lands in `blanket_releases` as
before. Persisting `customerRequestedQuantity` separately is a follow-up
(see §13).

---

## 9. Edge functions

### 9.1 `release_list_available_pallets` — modified

| Change | Rationale |
|---|---|
| `goods_receipts!inner(gr_number, status)` → `goods_receipts!inner(gr_number, status, shipment_number)` | Pull the canonical shipment number for display in Review/Picking-List. |
| New response field `shipment_number: r.goods_receipts?.shipment_number ?? mpl?.pack_proforma_invoices?.shipment_number ?? null` | Two-tier fallback (GR first, proforma second). Existing `packing_list_number` is preserved for back-compat. |

### 9.2 No new edge functions

Considered and rejected:

- `release_auto_match_pallets` — would have been a thin server-side wrapper
  over the same subset-sum logic. Rejected because the algorithm's input is
  already on the client (after `release_list_available_pallets`), so a
  round-trip would be pure overhead.

---

## 10. Files touched (manifest)

### 10.1 New

```
src/components/release/palletMatcher.ts
src/components/release/releasePrints.ts
supabase/migrations/059_remove_snv_warehouse.sql
supabase/migrations/060_backfill_historical_shipment_numbers.sql
docs/releases/IMPLEMENTATION_0.5.5_TO_0.5.6.md   ← this file
```

### 10.2 Modified

```
src/components/release/CreateRelease.tsx
src/components/release/types.ts
src/components/bpa/BPADetail.tsx
src/components/bpa/BPAList.tsx
src/components/UnifiedItemMaster.tsx
src/components/StockMovement.tsx
src/types/inventory.ts
src/services/inventoryService.ts
src/hooks/useInventory.ts
supabase/functions/release_list_available_pallets/index.ts
supabase/functions/sm_submit-movement-request/index.ts
supabase/functions/new_sm_queries/index.ts
supabase/functions/sm_get-movements/index.ts
docs/architecture.md
docs/workflows/stock-movement.md
README.md
```

---

## 11. Verification recipes

### 11.1 Matcher — happy paths

```
# Open New Blanket Release
# Pick a BPA with diverse pallet outer-quantities (e.g. 260067252 has
# pallets sized 250 and 300 — easy to construct sum scenarios)

# 1. Exact via FIFO prefix
   - Enter customer ask = 280  (one whole pallet of 280)
   - Expect: green "Perfect FIFO Match · 1 pallet"
   - Click Next → Review shows no amendment banner

# 2. Exact via subset
   - Enter customer ask = 560  (= 280 + 280 from non-adjacent pallets)
   - Expect: green "Exact Match Found · 2 pallets"

# 3. No exact, two options
   - Enter customer ask = 1450  (no whole-pallet sum hits exactly)
   - Expect: two stacked option cards (Round Up + Round Down)
   - Click Round Down to 1440 → Review shows "▼ AMENDED DOWN"
   - Click Print Amendment Draft → OPW-style PDF preview
```

### 11.2 Matcher — edge cases

```
# Insufficient stock
   - Pick a part with very low rack inventory (< 100 pcs)
   - Enter customer ask = 50000
   - Expect: red Insufficient hero with "Accept partial" button

# Manual override
   - From any matcher state, click "Override and pick pallets manually →"
   - Expect: legacy grouped picker; selecting pallets sets ▢ MANUAL pill in Step 5
```

### 11.3 Print artefacts

```
# Picking List
   - Step 5 → click "Picking List"
   - Verify: rack-sorted rows, ✓ checkbox column, signature blocks at bottom

# Amendment Draft (only after an UP/DOWN amendment)
   - Step 5 → click "Amendment Draft"
   - Verify:
     * Customer logo space top-left + "Release Amendment" title block top-right
     * Quantity cell shows old (strike-through, red) above new (green)
     * Extended Price cell same diff treatment
     * "Amendment Acknowledgement Required within 24 hrs." banner
     * Customer Acknowledgement signature panel at the bottom
```

### 11.4 Database backfill — shipment_number

```sql
-- Should report zero on both
SELECT COUNT(*) FROM pack_proforma_invoices WHERE shipment_number IS NULL;
SELECT COUNT(*) FROM goods_receipts        WHERE shipment_number IS NULL;

-- Spot-check
SELECT proforma_number, shipment_number FROM pack_proforma_invoices
WHERE proforma_number IN ('PI-252602841','PI-252602421','PI-252601297');
-- Expected: SHIP-2025-029, SHIP-2025-026, SHIP-2025-019
```

### 11.5 S&V removal — confirm absence

```sql
SELECT * FROM inv_warehouses WHERE warehouse_code = 'WH-SNV-MAIN';   -- 0 rows
SELECT * FROM inv_warehouse_stock
JOIN inv_warehouses ON inv_warehouses.id = inv_warehouse_stock.warehouse_id
WHERE warehouse_code = 'WH-SNV-MAIN';                                -- 0 rows
```

```bash
# Frontend should have no S&V references outside historical migrations
grep -rni "SNV\|S&V\|S & V\|WH-SNV" src/ supabase/functions/  # should return empty
```

---

## 12. Rollback recipe

### 12.1 Frontend (no DB writes from matcher)

The matcher itself has no persistence side-effects. To roll back:

```bash
git revert <0.5.6-merge-commit>
```

This restores the legacy Step 4 manual picker and reverts the print modules.
No DB cleanup needed for matcher rollback.

### 12.2 Migration 059 — S&V data deletion is **destructive and irreversible**

Once 059 runs, the S&V master row, inventory, and movement history are gone.
There is no rollback. If you need a recovery path, restore from a Supabase
backup snapshot taken before applying 059.

The view rebuild *can* be reverted by re-running 044's
`vw_item_stock_distribution` definition, but the data is unrecoverable.

### 12.3 Migration 060 — shipment_number backfill

Reversible:

```sql
-- Wipe the auto-generated SHIP-2025-NNN values on the historical rows.
-- DO NOT run this in production unless you really want NULLs back.
UPDATE pack_proforma_invoices SET shipment_number = NULL
WHERE shipment_number ~ '^SHIP-2025-\d{3}$'
  AND proforma_number LIKE 'PI-25%';

UPDATE goods_receipts SET shipment_number = NULL
WHERE shipment_number ~ '^SHIP-2025-\d{3}$'
  AND gr_number LIKE 'GR-M-%';
```

### 12.4 Edge function rollback

```bash
git revert <commit-touching-release_list_available_pallets>
npx supabase functions deploy release_list_available_pallets
```

The previous version doesn't request `shipment_number` from `goods_receipts`,
so the field will simply disappear from the response — frontend's
fallback (`p.shipment_number || p.packing_list_number`) handles it.

---

## 13. Known limitations & follow-ups

### 13.1 Customer-asked quantity not persisted

Right now `customerRequestedQuantity` lives only in wizard state. When the
release is created, `requestedQuantity` (the post-amendment number) is what
hits `blanket_releases.requested_quantity` — there's no DB field that says
"the customer originally asked for X". Audit trail is via the printed
Amendment Draft.

**Follow-up:** add `blanket_releases.customer_requested_quantity` (nullable,
defaults to `requested_quantity` for back-compat) plus
`adjustment_type text NULL CHECK (adjustment_type IN ('UP','DOWN','MANUAL','NONE'))`.
Update `release_create` edge function to accept and write both.

### 13.2 No customer-confirmation workflow

The amendment draft is generated and printed but there's no system-of-record
for "customer confirmed amendment Y on date Z". Today the operator emails
the PDF, the customer signs and emails back, and we proceed.

**Follow-up:** a `release_amendments` table (one row per amendment) with
`status: PENDING|CONFIRMED|REJECTED`, signed-PDF upload, customer signatory
name. Wire a "Mark customer confirmed" action on the release detail screen.

### 13.3 Matcher doesn't consider lot/expiry constraints

Subset-sum picks the closest combination by quantity alone. If a customer
contract requires same-lot dispatch, or if pallets have expiry dates that
should be FEFO'd before FIFO'd, the matcher won't honour that.

**Follow-up:** add optional weight functions (`MatcherPallet.weight?`) and
a multi-criteria scorer. Currently FIFO is the only ordering signal.

### 13.4 Pathological large targets

For target > ~1M with diverse pallet sizes, the DP table grows past 4 MB and
compute past 100 ms. Acceptable but not great. Mitigation: GCD-compress all
pallet quantities by their greatest common divisor before DP, divide target
similarly, expand back on output. Saves ~10× on typical data.

Not blocking; logged as a performance follow-up.

### 13.5 Migration tracker drift

Migrations 058 / 059 / 060 were applied via `db query --linked` rather than
`db push`, so `supabase_migrations.schema_migrations` doesn't know about
them. Future `db push --linked` will re-attempt them.

**Follow-up:** mark them applied:

```sql
INSERT INTO supabase_migrations.schema_migrations (version, name)
VALUES
  ('058', 'backfill_rack_location_agreement_id'),
  ('059', 'remove_snv_warehouse'),
  ('060', 'backfill_historical_shipment_numbers')
ON CONFLICT (version) DO NOTHING;
```

(Run once against the linked project.)

### 13.6 Test coverage

`palletMatcher.ts` has no unit tests committed. The test matrix in §4.7
covers the cases that matter — adding them to the repo (under
`src/components/release/__tests__/palletMatcher.test.ts`) is the next
quality-of-life step.

---

**Document version:** 1.0
**Last updated:** 2026-05-03
**Author:** WMS engineering
