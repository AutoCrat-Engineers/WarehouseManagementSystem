# Release Report — v0.5.7

| Field | Value |
|---|---|
| **Version** | 0.5.7 |
| **Type** | Minor (backwards-compatible) |
| **Release date** | 2026-05-04 |
| **Previous release** | 0.5.6 (2026-05-03) |
| **Headline** | Inbound Receiving — scan-driven, per-pallet verification |

---

## What's new

### Scan & Verify replaces the MPL list

Receiving is now one screen. After picking the proforma:

1. **Scan a pallet** (RF gun, camera, or paste).
2. **Pick a status** — Received / Missing / Damaged.
3. **Verify · Place Now** or **Verify · Place Later**.
4. Scanner re-focuses for the next pallet.

The receiver no longer browses an MPL list. MPL membership is resolved
from the QR. As each MPL's pallets are verified, that MPL's Goods
Receipt auto-commits in the background. When the last MPL commits, the
shipment is marked done.

### No putaway labels, no GRN print

Pallets already carry QR — printing a second label was redundant. The
DONE screen is now a clean shipment summary (received / missing /
damaged + total pallets). The GRN remains downloadable from the GR
detail page (unchanged).

### Damaged-pallet capture is audit-grade

Tap **Damaged** → bottom sheet:

- Reason code (Crushed / Wet / Torn / Contamination / Temperature / Wrong
  Item / Other), grouped by category.
- Required note.
- One or many photos — taken with the device camera or uploaded.

Photos land in the new private `gr-exception-photos` bucket and are
linked to the goods-receipt line via the new `photo_paths` column.

### Mobile-first

The receive screen is full-viewport on phones with safe-area-bottom
respected, 44px touch targets, and the scanner / status buttons sized
for gloved use. Desktop keeps the modal.

### PWA

`manifest.webmanifest` makes the app installable. A hand-rolled service
worker (`public/sw.js`) caches the app shell so the UI loads even when
WiFi drops, and an IndexedDB scan queue holds scans offline and replays
them on reconnect.

### Inbound dashboard polish

- KPI cards are now clickable filters (BPA-style) — separate filter chips removed.
- Refresh + Receive Shipment moved beside the search bar.
- Cards sorted oldest-first (FIFO).
- Inline **Receive** button on the first eligible card only.
- Card layout cleaned up: shipment number + PI side-by-side, no more
  misleading single-part description line.
- "MY DRAFT" / "IN PROGRESS" badges driven by the new
  `gr_inbound_overview` endpoint.

---

## Operator quick reference

| Action | Where |
|---|---|
| Start receiving an arriving truck | Inbound Receiving → tap **Receive** on the top FIFO card, or tap **Receive Shipment** + search PI |
| Resume an in-flight session | Inbound Receiving → cards with **MY DRAFT** badge |
| Scan a pallet | Aim RF gun, tap camera button, or paste QR + Enter |
| Mark damaged | **Damaged** → fill reason + note + photos |
| Skip placement to later | **Verify · Place Later** |
| Send to putaway now | **Verify · Place Now** (last MPL commits → DONE → Continue routes to putaway) |

---

## Rollback / risk

| Concern | Mitigation |
|---|---|
| Existing stickers in the field | The QR resolver parses both v1 (legacy pipe) and v2 (UUID-first) payloads. No reprint required. |
| Mid-flight session lost on browser close | Committed MPLs persist server-side. Uncommitted per-pallet status in the active session is intentionally not persisted (shipment-level drafting is a planned follow-up). |
| Photo storage cost | Bucket is private; 10 MB per photo cap; allowed MIME types restricted to JPEG / PNG / WebP / HEIC / HEIF. |
| New edge functions | All 5 are read/write-light and use the standard `withErrorHandler` + JWT validation path. |
| `confirm_goods_receipt` RPC body change | CREATE OR REPLACE with the same signature; new columns default to NULL / empty array, so legacy callers still work. |

---

## Files

See [`CHANGES_0.5.7.md`](CHANGES_0.5.7.md) for the engineering breakdown
(new modules, modified modules, schema, edge functions, removed
components, public surface).

---

## Next

- Shipment-level draft persistence (so partial sessions survive reload).
- Per-pallet placement signal — using `placeIntent` on the new GR lines
  to drive a smarter putaway queue.
- Org-configurable reason codes (`gr_reason_codes` table) replacing the
  hard-coded constant.
- Real-time presence on the dashboard (replace draft-row polling for the
  "IN PROGRESS" badge).
