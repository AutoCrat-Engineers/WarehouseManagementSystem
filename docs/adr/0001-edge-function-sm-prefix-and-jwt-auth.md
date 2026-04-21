# 0001 — Adopt `sm_` prefix for Stock Movement edge functions and in-function JWT validation

- **Status:** Accepted
- **Date:** 2026-04-18
- **Deciders:** @org/backend-team
- **Technical Story:** Edge function reorganization + auth reliability fix

## Context and Problem Statement

The project had 10 Supabase edge functions mixing stock-movement-specific handlers with cross-module utilities in a flat directory. As more modules are migrated server-side, identifying which functions belong to which module in the Supabase dashboard was already noisy, and CORS preflight requests were intermittently failing with 401s against the legacy HS256 anon key.

Two related problems needed a decision:

1. How to organize edge functions as the module count grows.
2. How to reliably authenticate requests after the Supabase project migrated to ES256 asymmetric JWT signing.

## Decision Drivers

- Supabase CLI does not support nested function directories — the folder name is the function identifier
- Supabase reserves the `SUPABASE_*` env var prefix and blocks overriding it
- The project anon key was rotated from HS256 (legacy) to a new `sb_publishable_*` format
- CORS preflight requests (OPTIONS) carry no Authorization header and must succeed before any POST can land
- 15 engineers contribute; visual grouping in the Supabase dashboard matters operationally

## Considered Options

1. **Nested folders per module** (`supabase/functions/stock-movement/<fn>/`) — preferred for filesystem organization but fails the CLI's top-level-only function discovery
2. **Flat structure with module prefix** (`sm_<fn>/`) — keeps CLI happy, keeps dashboard sorted, readable at a glance
3. **Single monolithic function with internal routing** — fewer deployments but loses Supabase's per-function isolation and metrics

## Decision Outcome

Chosen option: **Option 2 — flat structure with `sm_` prefix**, because it is the only option compatible with Supabase's top-level-only function discovery while still giving us visual grouping in the dashboard and distinguishing module boundaries.

Companion decisions:

- Auth validation is performed **inside the function** via `userClient.auth.getUser(jwt)` using a custom secret `PUBLISHABLE_KEY` (not `SUPABASE_ANON_KEY`, which is reserved and would be auto-injected with the legacy value).
- Functions are deployed with `--no-verify-jwt` so the Supabase gateway does not intercept OPTIONS preflight requests before our handler can answer with CORS headers.

### Positive Consequences

- Dashboard groups all Stock Movement functions alphabetically under `sm_*`
- New modules follow the same convention: two-letter prefix + underscore (e.g. `pk_` for packing)
- Auth works correctly against the new ES256 JWT + publishable key combination
- CORS preflight succeeds without requiring gateway-level middleware changes

### Negative Consequences

- JWT verification happens twice per request (function code + indirectly in `auth.getUser()` network call) — adds ~400ms
- Custom `PUBLISHABLE_KEY` secret must be maintained in sync with the Supabase project's active publishable key
- Flat directory will grow large as modules multiply (acceptable at current scale; revisit if count exceeds ~50)

## Pros and Cons of the Options

### Option 1 — Nested folders per module

- **Good:** Cleanest filesystem organization
- **Bad:** CLI does not traverse nested folders; deployment breaks
- **Bad:** Would require per-folder manual deploy scripts

### Option 2 — Flat with `sm_` prefix  *(chosen)*

- **Good:** Works with existing CLI without changes
- **Good:** Dashboard sorts prefixed functions together
- **Good:** Clear module ownership from the name alone
- **Bad:** Flat directory grows over time

### Option 3 — Monolithic function with routing

- **Good:** Single deployment unit
- **Bad:** Loses per-function observability in Supabase dashboard
- **Bad:** One function's error blast-radius becomes the whole module
- **Bad:** Cold-start cost applied to all endpoints together

## Links

- [supabase/functions/README.md](../../supabase/functions/README.md) — updated master index
- [supabase/functions/.env.example](../../supabase/functions/.env.example) — required env vars including `PUBLISHABLE_KEY`
