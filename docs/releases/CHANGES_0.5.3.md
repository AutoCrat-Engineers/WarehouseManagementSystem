# CHANGES — v0.5.3

- **Version:** 0.5.3
- **Release Type:** Patch
- **Date:** 2026-04-18
- **Previous Version:** 0.5.2 (2026-04-11)

## Summary

Edge-function reorganization and documentation refresh. No business-logic changes. Authentication inside edge functions was stabilized against the new Supabase publishable-key + ES256 JWT combination. Per-function documentation added. ADR process bootstrapped. CODEOWNERS introduced (placeholder teams).

## Architecture Changes

- Stock Movement edge functions renamed with `sm_` prefix for visual grouping in the Supabase dashboard and to scope module ownership by name.
- Edge-function auth validation migrated from the legacy `SUPABASE_ANON_KEY` (HS256, rotated out upstream) to a custom `PUBLISHABLE_KEY` secret (new `sb_publishable_*` format), set via `supabase secrets set`. Supabase reserves the `SUPABASE_*` name prefix and blocks overriding it, so a custom name was required.
- All functions deploy with `--no-verify-jwt` so CORS preflight (OPTIONS) requests reach the in-function handler rather than being blocked by the gateway's JWT middleware.

See [ADR-0001](../adr/0001-edge-function-sm-prefix-and-jwt-auth.md) for the full decision rationale.

## Edge Function Changes

All 10 functions redeployed to project `sugvmurszfcneaeyoagv`:

| Function | Change |
|---|---|
| `get-user-profile` | Auth flow updated to use `PUBLISHABLE_KEY` + explicit JWT passing |
| `sm_approve-movement` | Same auth update; renamed from `approve-movement` |
| `sm_calculate-pallet-impact` | Same; renamed from `calculate-pallet-impact` |
| `sm_get-item-stock` | Same; renamed from `get-item-stock` |
| `sm_get-movement-counts` | Same; renamed from `get-movement-counts` |
| `sm_get-movement-review-data` | Same; renamed from `get-movement-review-data` |
| `sm_get-movements` | Same; renamed from `get-movements` |
| `sm_get-reason-codes` | Same; renamed from `get-reason-codes` |
| `sm_search-items` | Same; renamed from `search-items` |
| `sm_submit-movement-request` | Same; renamed from `submit-movement-request` |

Old (unprefixed) versions remain deployed on Supabase but are **unreferenced by client code** and should be deleted from the dashboard.

## Client Changes

- [`StockMovement.tsx`](../../src/components/StockMovement.tsx) — all `FUNCTIONS_BASE` URLs updated to use `sm_*` prefixed function names.
- Item search input (line 1625) now **debounced at 300ms** to collapse typing bursts into one request — typing a 6-character query fires 1 function call instead of 6.
- `.env.local` `VITE_FUNCTIONS_URL` removed so the app uses the deployed Supabase URL by default.

## Documentation Updates

- [`supabase/functions/README.md`](../../supabase/functions/README.md) — **new** master index for edge functions, naming convention, deployment workflow, contribution guide.
- [`supabase/functions/.env.example`](../../supabase/functions/.env.example) — **new** template covering `SUPABASE_*` auto-injected vars and the `PUBLISHABLE_KEY` custom secret.
- 10 per-function `README.md` files — **new** — one per function covering purpose, request/response schemas, error codes, env vars, and local-test commands.
- [`docs/adr/README.md`](../adr/README.md) — **new** ADR process and index.
- [`docs/adr/0000-template.md`](../adr/0000-template.md) — **new** MADR-format template.
- [`docs/adr/0001-edge-function-sm-prefix-and-jwt-auth.md`](../adr/0001-edge-function-sm-prefix-and-jwt-auth.md) — **new** documents the migration decision.
- [`.github/CODEOWNERS`](../../.github/CODEOWNERS) — **new** with placeholder team handles.

## Cleanup

- `.env.local` emptied (routing override removed).

## Security

- **Hardcoded JWT** flagged in [`src/utils/supabase/info.tsx`](../../src/utils/supabase/info.tsx) — this is the anon key. For SPAs this is expected (the anon key is public by design and protected by RLS), but the project's recent rotation to a `sb_publishable_*` key means the source-code fallback is stale. Replace the fallback or remove it in a follow-up patch.
- No service-role or secret keys committed to the repo.
- `supabase/functions/.env` (real secrets) remains gitignored.

## Placeholders Requiring Follow-Up

- `.github/CODEOWNERS` uses `@org/backend-team`, `@org/frontend-team`, `@org/security-team`, `@org/tech-writers`, `@org/devops-team`, `@org/architecture-team`. Replace with real GitHub team slugs before enabling required reviews.
- Update anon-key fallback in [`src/utils/supabase/info.tsx`](../../src/utils/supabase/info.tsx) to the new `sb_publishable_*` value or rely on the `VITE_SUPABASE_ANON_KEY` env var instead.

## Migration Notes

To reach parity with this release in a fresh environment:

1. Ensure `PUBLISHABLE_KEY` secret is set on the Supabase project:
   ```bash
   supabase secrets set PUBLISHABLE_KEY=sb_publishable_... --project-ref <ref>
   ```
2. Redeploy every function with `--no-verify-jwt`.
3. Delete the old (unprefixed) function versions from the Supabase dashboard.
