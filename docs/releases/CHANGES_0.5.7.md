# CHANGES — v0.5.7

- **Version:** 0.5.7
- **Release Type:** Minor
- **Date:** 2026-05-04
- **Previous Version:** 0.5.6 (2026-05-03)

## Summary

The headline of 0.5.7 is the **Inbound Receiving redesign** — a ground-up
rewrite of the receive flow around scan-driven, per-pallet verification.
The receiver no longer navigates an MPL list; after picking the proforma
they go straight into a single Scan & Verify screen where every pallet is
its own decision: scan QR → pick status → pick Verify · Place Now or
Verify · Place Later. As each MPL's pallets get verified, that MPL's GR
auto-commits in the background. When all MPLs are committed, the shipment
is done — no putaway labels (pallets already have QR), no frontend GRN
print.

Bundled in the same cycle:

- A **scan-driven foundation** the new flow is built on: a server-side QR
  resolver (`pallet_resolve_qr`) that hydrates a pallet from a v2-format
  payload (UUID-first, line-delimited), an RF-gun wedge listener, a
  camera scanner with native `BarcodeDetector` + `@zxing/browser`
  fallback, audio + haptic feedback.
- **Audit-grade exception capture** for damaged pallets — reason codes
  (configurable list in client today, table-backed in a future slice),
  required note, eager photo upload to a private storage bucket
  (`gr-exception-photos`), thumbnails via short-lived signed URLs.
- **Mobile-first responsive shell** — desktop modal, full-viewport on
  phones, 44px touch targets, safe-area-bottom honored.
- **PWA shell** — installable via web manifest, hand-rolled service
  worker (network-first navigation, cache-first assets, Supabase
  bypass), offline scan queue in IndexedDB with auto-replay on
  reconnect.
- **Inbound dashboard enhancements** — toolbar with Refresh +
  Receive Shipment beside the search input; FIFO sort (oldest first);
  per-card "Receive" CTA on the first eligible card only; clickable
  filter cards (BPA-style) replacing the separate filter chips; "MY
  DRAFT" / "IN PROGRESS" badges on cards driven by the new
  `gr_inbound_overview` edge function.
- **Quick-pick** — top-2 oldest receivable shipments shown on the
  search step's empty state with a 3-stage step sidebar (Match
  Shipment / Scan & Verify / Done).

Three new edge functions deployed. Two new database migrations
(061: `gr_drafts`; 062: exception capture columns + storage bucket +
RPC update). The pallet-slip QR generator now emits a v2 payload
(backwards compatible with v1 stickers).

---

## New flow at a glance

| Step | Old flow (≤0.5.6) | New flow (0.5.7) |
|---|---|---|
| 1 | Search PI | Search PI (with quick-pick top-2 oldest) |
| 2 | **Pick MPL** from a list | Removed |
| 3 | **Verify all pallets in active MPL** with manual rxQty input | Removed |
| 4 | Exception review interstitial + sign-off | Removed |
| 5 | DONE: print GRN + print putaway labels | DONE: shipment summary, no print |
| New | — | **Scan & Verify** — one screen for the whole shipment, scan-driven, per-pallet decision |

---

## Frontend — Inbound Receiving redesign

### New modules

| File | Purpose |
|---|---|
| [`src/components/rack-view/receiveService.ts`](../../src/components/rack-view/receiveService.ts) | Single client-surface for the receive feature: `resolveQrToPallet`, `loadDraft / saveDraft / discardDraft` (with optimistic versioning), `useGrDraftAutosave` hook, `REASON_CODES`, `uploadExceptionPhoto`, `getPhotoSignedUrl`, `deleteExceptionPhoto`. Discriminated-union return shapes (`ResolveQrResult`, `SaveDraftResult`) so call sites branch on `kind` instead of error-code parsing. |
| [`src/components/rack-view/useWedgeScanner.ts`](../../src/components/rack-view/useWedgeScanner.ts) | Global keydown capture that distinguishes RF-gun wedge input from human typing via median inter-char gap. Multiline-payload tolerant — Enter is treated as a soft separator, with idle-flush so multi-line v2 QR payloads survive intra-payload newlines. Respects `[data-no-scan="true"]`, textareas, and contenteditable surfaces. |
| [`src/components/rack-view/useViewport.ts`](../../src/components/rack-view/useViewport.ts) | `useViewport()` (matchMedia-based mobile/tablet/desktop) and `useOnline()` (`online`/`offline` events). SSR-safe. |
| [`src/components/rack-view/scanFeedback.ts`](../../src/components/rack-view/scanFeedback.ts) | Web Audio API beeps + `navigator.vibrate` for success / duplicate / error. No external assets. Lazy AudioContext (browsers require a user gesture). |
| [`src/components/rack-view/CameraScanner.tsx`](../../src/components/rack-view/CameraScanner.tsx) | Full-screen camera overlay. Native `BarcodeDetector` first; lazy-imports `@zxing/browser` for iOS Safari / Firefox. Rear camera, aim reticle, torch toggle (only when device exposes the capability), 1.5s cooldown against repeat-emit, auto-close 250ms after a decode so the scanner doesn't have to be dismissed by hand. Stops every `MediaStreamTrack` on unmount so the camera light goes off. |
| [`src/components/rack-view/ExceptionSheet.tsx`](../../src/components/rack-view/ExceptionSheet.tsx) | Mobile-first bottom sheet for DAMAGED capture. Reason dropdown grouped by category (Physical / Quality / Other), required note, photo capture via native camera (`<input capture="environment">`) and gallery. Eager upload to `gr-exception-photos` bucket as photos are picked; thumbnails via short-lived signed URLs (5min); per-photo remove with best-effort storage cleanup. |
| [`src/components/rack-view/scanQueue.ts`](../../src/components/rack-view/scanQueue.ts) | IndexedDB-backed offline scan queue. `enqueueScan / listQueuedScans / removeQueuedScan / bumpQueuedScanAttempts / replayQueuedScans`. No external deps; opens its own DB (`wms-scan-queue`, version 1). |

### Modified modules

| File | Change |
|---|---|
| [`src/components/rack-view/ReceiveShipmentScreen.tsx`](../../src/components/rack-view/ReceiveShipmentScreen.tsx) | Rebuilt around three steps: SEARCH → SCAN_PALLETS → DONE (down from five). New `ScanPalletsStep` component owns the scan-driven verify cycle: scan → `PendingPalletPanel` opens with status buttons + Verify · Place Now/Later → on verify, panel clears and the scanner re-focuses. Auto-commit fires `gr_confirm_receipt` per MPL when every pallet in that MPL has been verified (placeIntent set). When all MPLs commit, step flips to `ShipmentDoneStep`. New `StepSidebar` (desktop only) shows the 3-stage progress. Header / Footer / `Step` union slimmed accordingly. Old `ShipmentStep`, `MPLCard`, `VerifyMplStep`, `ExceptionsReviewStep`, `BottomNav`, `DoneStep` (with print buttons) deleted. |
| [`src/components/rack-view/RackViewGrid.tsx`](../../src/components/rack-view/RackViewGrid.tsx) | Page header banner removed. KPI cards become clickable filters (BPA-style) with active ring + colored glow; separate filter-chip row dropped. Toolbar combines search + Refresh + Receive Shipment buttons in one row. FIFO sort: cards ordered oldest-first. Per-card inline "Receive" CTA on the first IN_TRANSIT or PARTIAL card only. Card layout: shipment number + PI number same size/weight, both monospace; customer / part description line removed (a shipment can mix multiple parts). New `MY DRAFT` / `IN PROGRESS` badges driven by `gr_inbound_overview`. |
| [`src/components/packing-engine/MasterPackingListHome.tsx`](../../src/components/packing-engine/MasterPackingListHome.tsx) | Pallet-slip QR upgraded to **v2 payload**: line-delimited tokens with `PALLET:<uuid>` first so scanner truncation can't lose the unique identifier. Backwards compatible — legacy v1 pipe-format stickers still resolve via best-effort match in the edge function. |
| [`src/components/rack-view/index.ts`](../../src/components/rack-view/index.ts) | Public barrel extended to export `resolveQrToPallet`, draft helpers, `useGrDraftAutosave`, reason codes + photo helpers, and the new types (`ResolvedPallet`, `GrDraftPayload`, `ReasonCode`, etc.). |
| [`src/main.tsx`](../../src/main.tsx) | Production-only service worker registration. |
| [`index.html`](../../index.html) | Manifest link, theme-color, iOS PWA meta tags, apple-touch-icon. |
| [`src/index.css`](../../src/index.css) | New `@keyframes pulse` for the autosave indicator. |

### Component layering

```
ReceiveShipmentScreen (modal/page shell + step state)
├─ Header / Footer (chrome)
├─ StepSidebar (desktop, 3 stages)
├─ SearchStep ── quick-pick + manual search
└─ ScanPalletsStep ── orchestrates scan-driven verify
    ├─ Scan bar (sticky) ── input + camera button
    ├─ CameraScanner ── overlay
    ├─ PendingPalletPanel ── after-scan status + verify
    │   └─ ExceptionSheet ── DAMAGED capture
    ├─ Recent scans
    └─ Per-MPL progress strip
└─ ShipmentDoneStep ── shipment summary, single Continue
```

---

## Backend — new edge functions + migrations

### Edge functions

| Function | Slice | Purpose |
|---|---|---|
| `pallet_resolve_qr` | 1 | Resolves a raw QR scan to a pallet record + receive context. Parses v2 (UUID-first) and legacy v1 (pipe). Optional `proforma_invoice_id` scopes the resolution; out-of-scope scans return `INVALID_STATE_TRANSITION` with the actual shipment number for "Switch to shipment X". |
| `gr_draft_save` | 2 | Versioned upsert of a per-(user, proforma, mpl) draft. Returns `CONCURRENT_MODIFICATION` (HTTP 409) when a second tab races. |
| `gr_draft_load` | 2 | Loads the caller's draft for (proforma, mpl), or `null`. |
| `gr_draft_discard` | 2 | Idempotent delete. |
| `gr_inbound_overview` | 4 | Today-focused KPIs + `my_drafts` (caller's resumable drafts hydrated with shipment + MPL labels) + `active_drafts_by_pi` (per-shipment activity rollup). 4 light count queries + 1 small list. |

> The autosave drafts (slice 2) infrastructure remains deployed and exposed
> through `useGrDraftAutosave`. The current scan-driven flow does not engage
> the hook (per-MPL drafts don't fit a per-pallet flow that may touch
> multiple MPLs in one session). A future slice will introduce shipment-level
> drafts and re-enable persistence of partially-verified sessions.

### Database migrations

#### 061 — `gr_drafts`

```sql
CREATE TABLE public.gr_drafts (
    id                  uuid PK,
    user_id             uuid FK profiles,
    proforma_invoice_id uuid FK pack_proforma_invoices,
    mpl_id              uuid,
    warehouse_id        uuid FK inv_warehouses NULL,
    payload             jsonb,                 -- {lines, notes, scan_log}
    version             int,                   -- optimistic concurrency
    created_at, updated_at,
    UNIQUE (user_id, proforma_invoice_id, mpl_id)
);
```

Indexes on `(user_id, updated_at DESC)`, `(proforma_invoice_id)`,
`(updated_at)`. RLS owner-only.

The stale-cleanup index uses a plain `(updated_at)` ordering rather than
a partial index — Postgres rejects `WHERE updated_at < now() - …` in a
partial-index predicate because `now()` is `STABLE`, not `IMMUTABLE`.

#### 062 — Exception capture

```sql
ALTER TABLE goods_receipt_lines
    ADD COLUMN reason_code  text,
    ADD COLUMN photo_paths  text[] NOT NULL DEFAULT '{}';

INSERT INTO storage.buckets (id, name, public, file_size_limit,
                             allowed_mime_types)
    VALUES ('gr-exception-photos', 'gr-exception-photos', false,
            10*1024*1024, ARRAY['image/jpeg','image/png','image/webp',
            'image/heic','image/heif']);
```

Storage RLS: authenticated INSERT/SELECT scoped to bucket; owner-only
DELETE. The `confirm_goods_receipt` RPC body is reissued (CREATE OR
REPLACE) with the same signature; the `goods_receipt_lines` INSERT now
populates `reason_code` and `photo_paths` from the per-line JSONB. No
caller change needed for legacy commits — both columns default to
NULL / `'{}'`.

### QR payload v2 (backwards-compatible)

Old (v1) — emitted prior to 0.5.7:

```
<mpl_number>|<part_number>|<item_name>|<msn>|<qty>
```

New (v2) — emitted from 0.5.7 onward by the pallet-slip generator:

```
PALLET:<uuid>
MPL:<mpl_number>
PN:<pallet_number>
PART:<part_number>
ITEM:<item_name>
MSN:<msn>
QTY:<qty>
V:2
```

`PALLET:<uuid>` first means O(1) DB lookup and survives 1D-laser-emulated
scanner truncation. Legacy v1 stickers in the field still resolve via the
edge function's best-effort match by (mpl + part + msn + qty).

---

## Removed / superseded

| Item | Removed because |
|---|---|
| `ShipmentStep` (MPL picker) | Receiver no longer navigates an MPL list; pallets are scanned directly. |
| `VerifyMplStep` (per-MPL verify table) | Replaced by `ScanPalletsStep`'s per-pallet panel. |
| `ExceptionsReviewStep` (sign-off interstitial) | Each pallet's exception is reviewed at scan time via the bottom sheet; aggregated review at the end was redundant. |
| `BottomNav` (filter tabs in verify) | One screen for the shipment, no more per-MPL focus to filter inside. |
| `DoneStep` print buttons (GRN + putaway labels) | Pallets already carry QR — putaway labels are redundant. GRN print available on demand from the GR detail page (existing). |
| Per-pallet `received_qty` input | Verification is by pallet presence, not by quantity. The qty is informational only on each pallet card. |

---

## Public surface — what callers see

### `ReceiveShipmentScreen` props

```ts
interface Props {
    onClose: () => void;
    onCompleted: (grNumber?: string) => void;
    /** Deep-link: open directly to a specific shipment, skipping SEARCH. */
    initialProformaId?: string;
    /** Deprecated in 0.5.7 — kept for backwards compat. New flow ignores it. */
    initialMplId?: string;
    /** FIFO quick-pick list shown above manual search on SEARCH step. */
    quickPickShipments?: QuickPickShipment[];
}
```

### `RackViewGrid` → `ReceiveShipmentScreen`

- `quickPickShipments`: top-2 IN_TRANSIT or PARTIAL shipments, sorted oldest-first, mapped to a compact shape.
- `initialProformaId` set when the user clicks the per-card Receive CTA.

---

## Failure modes & resilience

| Scenario | Behavior |
|---|---|
| Scan resolves to pallet outside this shipment | Red banner: "Pallet belongs to a different shipment (SH-X)". No state change. |
| Scan resolves to pallet whose MPL already has a GR | "Already received" duplicate banner (soft thunk). |
| User picks a status but never clicks Verify | Pallet stays pending (placeIntent unset). MPL won't auto-commit until every pallet has been verified. |
| Network drops mid-scan | Scan auto-enqueues to IndexedDB, surfaced as a blue "queued" banner. Replays on reconnect. (Reachable via `useOnline` + `replayQueuedScans` — wired in earlier slice; the simplified scan-driven flow uses the same enqueue path on resolve failure.) |
| Browser refresh mid-shipment | Committed MPLs persist via `goods_receipts` (visible on next load). Uncommitted in-flight pallet status is lost — by design for 0.5.7; shipment-level draft persistence is a follow-up. |
| Photo upload fails | Sheet stays open with the error; receiver can retry without losing reason+note. |
| Pop-up blocker on print | Falls back to opening print HTML in a new tab. (Print module retained for the GR detail page; not invoked from the new DONE.) |

---

## Migration / deployment notes

1. Apply migration `061_gr_drafts.sql` (already applied if upgrading from in-progress 0.5.7-pre).
2. Apply migration `062_gr_exception_capture.sql` — adds two columns, the storage bucket, and replaces the `confirm_goods_receipt` RPC.
3. Deploy edge functions: `pallet_resolve_qr`, `gr_draft_save`, `gr_draft_load`, `gr_draft_discard`, `gr_inbound_overview`.
4. Existing pallet stickers in the field continue to resolve via the v1 fallback in `pallet_resolve_qr`. New stickers printed from 0.5.7 onward use v2 payload.
5. No frontend env changes. Service worker registers only on production builds; HTTPS required.

---

## Stats

```
 7 files changed                     in committed scope (pre-flow-rewrite)
 +9 new files                        (PWA, scanners, exception sheet,
                                      scan queue, photo helpers, etc.)
 ~1.7k insertions / ~0.5k deletions  in ReceiveShipmentScreen alone
 5 new edge functions                pallet_resolve_qr, gr_draft_*,
                                      gr_inbound_overview
 2 new migrations                    061, 062
```
