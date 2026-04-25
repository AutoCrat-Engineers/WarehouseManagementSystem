# Supabase Edge Functions

Master index of all Supabase Edge Functions for the Warehouse Management System.

Edge functions replace direct client-side database operations for all business-logic-heavy workflows. They run JWT-authenticated, execute server-side validation + multi-table operations, and return structured JSON responses.

---

## Active Functions

| Function | Module | Status | Purpose | Owner |
|---|---|---|---|---|
| [get-user-profile](./get-user-profile/README.md) | Shared | Active | Fetch the authenticated user's profile record | @org/backend-team |
| [sm_search-items](./sm_search-items/README.md) | Stock Movement | Active | Item lookup by code / part number / MSN | @org/backend-team |
| [sm_get-item-stock](./sm_get-item-stock/README.md) | Stock Movement | Active | Per-warehouse stock lookup for a given item | @org/backend-team |
| [sm_get-reason-codes](./sm_get-reason-codes/README.md) | Stock Movement | Active | Reason code master data (all active, or single lookup) | @org/backend-team |
| [sm_get-movements](./sm_get-movements/README.md) | Stock Movement | Active | Paged movement list with filters + server-side enrichment | @org/backend-team |
| [sm_get-movement-counts](./sm_get-movement-counts/README.md) | Stock Movement | Active | Summary counts (pending / approved / rejected / total) | @org/backend-team |
| [sm_get-movement-review-data](./sm_get-movement-review-data/README.md) | Stock Movement | Active | Packing spec + box breakdown for movement approval screen | @org/backend-team |
| [sm_calculate-pallet-impact](./sm_calculate-pallet-impact/README.md) | Stock Movement | Active | Pallet intelligence preview for PRODUCTION_RECEIPT | @org/backend-team |
| [sm_submit-movement-request](./sm_submit-movement-request/README.md) | Stock Movement | Active | Create movement header + line (with server-side validation) | @org/backend-team |
| [sm_approve-movement](./sm_approve-movement/README.md) | Stock Movement | Active | Approve/reject movement, deduct stock, emit audit + notifications | @org/backend-team |
| im_list-items | Item Master | Active | Paged item list + summary counts in one round trip | @org/backend-team |
| im_get-blanket-orders | Item Master | Active | Item-detail blanket order lookup | @org/backend-team |
| im_upsert-item | Item Master | Active | Single endpoint for create / update branches | @org/backend-team |
| im_delete-item | Item Master | Active | Reversible soft delete (`is_active = false`) | @org/backend-team |
| sg_auto-generate, sg_list-requests, sg_get-detail, sg_mark-printed, sg_mark-all-printed, sg_transfer-stock | Sticker Generation | Active | Browser → server port of sticker workflow (~900 round trips → ~5) | @org/backend-team |
| pac_dashboard_*, pac_details_* | Packing Engine | Active | Packing dashboard + spec management | @org/backend-team |
| auth-login, auth-logout, auth-validate-session, session-manager | Auth | Active | Session lifecycle moved off the browser | @org/backend-team |
| bpa_list, bpa_get, bpa_create, bpa_amend, bpa_cancel, bpa_upload_document | BPA | Active | Customer agreement portfolio + revisions + document attachments | @org/backend-team |
| bo_create_from_bpa, bo_get_dashboard, bo_recalc_totals | Blanket Order | Active | Operational mirror creation + per-line running totals | @org/backend-team |
| release_create, release_list, release_list_available_pallets, release_fifo_suggest, release_parse_po_number, **release_allocate_pallets** *(0.5.5)* | Releases | Active | Release wizard + 4-bucket allocation holds | @org/backend-team |
| sub_invoice_create | Releases | Active | Customer billing per release | @org/backend-team |
| tariff_invoice_list, tariff_invoice_compute, tariff_submit, tariff_rates_upsert | Finance / Tariff | Active | Tariff claim queue (DRAFT → SUBMITTED → CLAIMED → PAID) | @org/backend-team |
| shipment_dashboard_list, shipment_detail_get, shipment_receive | Inbound Receiving | Active | Per-MPL goods receipt with discrepancy tracking | @org/backend-team |
| gr_search_proformas, gr_get_proforma_breakdown, gr_list_pending_placement, gr_mark_placed, gr_confirm_receipt | Goods Receipt | Active | Receiving wizard + rack placement | @org/backend-team |
| pending_placement_list | Goods Receipt | Active | Pallets awaiting rack placement | @org/backend-team |
| rack_view_get, rack_get_cell_chain, rack_load_storage, **pallet_get_back_chain** *(0.5.5)*, pallet_place, pallet_move | Rack Storage | Active | Visual rack view + pallet back-chain (release → MPL → BPA) | @org/backend-team |
| item_get_full_detail | Item Master | Active | One-shot item detail (stock + agreements + upcoming releases) | @org/backend-team |
| audit_log_query, search_global, refresh_views_cron, send-dispatch-email, make-server-9c637d11 | Cross-cutting | Active | Audit, global search, materialized-view refresh, email | @org/backend-team |

> **Total:** 59 functions deployed as of 0.5.5. Per-function READMEs exist for the `sm_*` set; the rest are documented inline with JSDoc headers in their `index.ts`.

## Naming Convention

| Prefix | Module |
|---|---|
| `sm_*` | Stock Movement |
| `im_*` | Item Master |
| `sg_*` | Sticker Generation |
| `pac_*` | Packing Engine |
| `bpa_*` | Customer Agreement / BPA |
| `bo_*` | Blanket Order (operational mirror) |
| `release_*` / `sub_invoice_*` | Releases |
| `tariff_*` | Finance — tariff claim queue |
| `shipment_*` / `gr_*` / `pending_*` / `pallet_*` / `rack_*` | Inbound receiving + rack storage |
| `auth-*` / `au_*` / `session-*` | Auth / session |
| `item_*` | Item detail |
| Unprefixed | Cross-cutting utilities (`get-user-profile`, `audit_log_query`, `search_global`, `refresh_views_cron`, `send-dispatch-email`) |

## Shared Code

Common utilities live under [`_shared/`](./_shared/):

- `cors.ts` — CORS headers (used by all functions)
- `palletImpact.ts` — Pallet intelligence algorithm (used by `sm_calculate-pallet-impact` and `sm_submit-movement-request`)

Shared files are bundled into every function that imports them at deploy time.

## Environment Variables

Each function requires the same core env vars. See [`.env.example`](./.env.example) for the full list and placeholder values.

| Variable | Source | Purpose |
|---|---|---|
| `SUPABASE_URL` | Auto-injected | Project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected | Server-side DB access (bypasses RLS) |
| `PUBLISHABLE_KEY` | Custom secret | Anon-tier JWT validation for `auth.getUser()` calls |

**Note:** Supabase reserves the `SUPABASE_*` prefix. Custom secrets (like `PUBLISHABLE_KEY`) use unprefixed names and are set via `supabase secrets set`.

## Deployment

Deploy a single function:

```bash
./supabase.exe functions deploy <function_name> \
  --project-ref <project-ref> \
  --no-verify-jwt
```

Deploy all functions:

```bash
for fn in get-user-profile sm_*; do
  ./supabase.exe functions deploy "$fn" \
    --project-ref <project-ref> \
    --no-verify-jwt
done
```

**Why `--no-verify-jwt`:** The Supabase gateway's built-in JWT middleware blocks CORS preflight (OPTIONS) requests because they don't carry auth tokens. Disabling gateway-level verification lets our own handler answer OPTIONS cleanly, then performs JWT validation inside the function via `userClient.auth.getUser(jwt)`.

## Local Development

Use the dev server script (not committed to git by default, local-only):

```bash
deno run --allow-net --allow-env --allow-read supabase/functions/local-dev-server.ts
```

Set `VITE_FUNCTIONS_URL=http://127.0.0.1:54321/functions/v1` in `.env.local` to route the frontend to your local functions.

## Contribution Workflow

1. Add a new folder under `supabase/functions/<name>/` containing `index.ts` and `README.md`.
2. Follow the existing template — handler function, CORS headers, auth check, service-role DB client.
3. Update this index and the master `.env.example` if new env vars are required.
4. Deploy to a staging project first and verify end-to-end.
5. Submit PR with changelog entry under `### Added` in [CHANGELOG.md](../../CHANGELOG.md).

See the per-function README files for input/output schemas.
