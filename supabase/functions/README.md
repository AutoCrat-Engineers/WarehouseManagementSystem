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

## Naming Convention

- **`sm_*`** — Stock Movement module. All functions bound to movement workflows share this prefix so they sort together in the Supabase dashboard.
- **Unprefixed** — Cross-module utilities (e.g. `get-user-profile`).

When adding a new module, pick a 2-letter prefix (e.g. `pk_` for packing) and apply it consistently.

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
