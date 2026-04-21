# Client → Server Migration Notes

**Scope:** the `mig/packing` branch merge that consolidates
1. The packing/auth migration — 14 edge functions that move sticker
   generation, packing details, pallet dashboard, and profile/role
   lookups off the browser.
2. The login2 merge — 4 edge functions that move authentication and
   session management off the browser.

Every migration in this document preserves business logic byte-for-byte;
the only thing that changes is **where** the code runs. This file exists
so the team reviewing the PR can understand scope, risk, and what's
still outstanding.

---

## 1. Why move client-side code to edge functions

Three concrete drivers, in the order they mattered for this work:

1. **Performance.** Sequential loops that ran from the browser (e.g.
   the old sticker generation Phase 5 — 900 round trips over ~150ms
   each) collapsed to ~5 bulk writes when run server-side next to the
   DB. Real measured wins: `sg_auto-generate` went from ~45s → ~2–3s
   for 150 boxes.
2. **Security / authority.** Business rules (who can do what, which
   rows to lock, which state transitions are legal) belong on the
   server. Previously the browser held the `SUPABASE_ANON_KEY` and did
   direct `UPDATE/DELETE`s — which RLS could block, but that's a
   brittle last line of defense.
3. **Surface area.** Moving the queries server-side means the DB
   schema isn't leaking into the browser's network tab, and we can
   change table structure without re-shipping the client.

Every migration here is a **pure port** — same SQL, same branches,
same audit shape. The few bugs that surfaced during the port (e.g.
the `p_idempotency_key` no-op in `transfer_packed_stock`) are called
out explicitly below.

---

## 2. Edge functions added in this branch

### 2.1 Sticker Generation — `sg_*` (6 functions)

All live under `supabase/functions/sg_*`. Caller code: `src/components/packing/PackingModule.tsx` and `PackingDetail.tsx`.

| Function | Client code it replaces | Round-trips |
|---|---|---|
| `sg_auto-generate` | `packingService.autoGenerateBoxes()` + `processPackingBoxAsContainer()` Phase 5 loop | ~900 → ~5 |
| `sg_mark-all-printed` | `packingService.markAllStickersPrinted()` post-print loop | N → 1 |
| `sg_mark-printed` | `packingService.markStickerPrinted()` single-box audit | 2 → 1 |
| `sg_list-requests` | `PackingModule` `fetchRequests` + `fetchSummaryCounts` + user profile lookup | 11 → 1 |
| `sg_get-detail` | `PackingDetail.loadData` (request + items + profiles + boxes + audit) | 5 → 1 |
| `sg_transfer-stock` | `packingService.transferPackedStock()` RPC wrapper | RPC retained inside edge fn; browser no longer calls RPC directly |

#### `sg_auto-generate` — Phase 5 optimization note
The original algorithm did a per-box `processPackingBoxAsContainer()`
loop. The port keeps the identical algorithm but runs it as an
**in-memory simulation** of pallet routing (preserving the
sequential state-machine dependency), then flushes the accumulated
writes in two parallel bulk batches:

1. `INSERT pack_containers` + `INSERT` new pallets + `UPSERT` mutated pallets
2. `INSERT pack_pallet_containers` + `INSERT pack_pallet_state_log`

Same final DB state. Same audit rows. Same state transitions.

#### `sg_transfer-stock` — atomicity preserved via deno-postgres
The original RPC `transfer_packed_stock(uuid, uuid[], uuid, uuid)`
runs inside one Postgres transaction (`SELECT ... FOR UPDATE`
locking, then multi-table writes, commit atomically). Replacing it
with the Supabase JS client would have broken atomicity — each
`.from().update()` is its own auto-commit. Instead this edge function
uses **`deno-postgres`** to open a direct wire-protocol connection
and runs `BEGIN / COMMIT / ROLLBACK` explicitly, reproducing the
RPC body statement-for-statement.

**Bug fix included (not a logic change):** the RPC accepted
`p_idempotency_key` but never used it, so network retries could
double-credit FG stock. The edge function now enforces idempotency
via the existing `public.idempotency_keys` table
(PROCESSING / SUCCESS / FAILED states). Required one-time DDL to add
`(idempotency_key, operation_type)` unique index — applied in
production.

### 2.2 Packing Details — `pac_details_*` (4 functions)

Caller: `src/components/packing/PackingDetails.tsx` (spec management screen).

| Function | Replaces |
|---|---|
| `pac_details_list-specs` | `fetchCounts` (3 count queries) + `fetchSpecs` (paginated list with items inner-join) |
| `pac_details_search-items` | `searchItems` (fetch existing-spec `item_id`s + items search) |
| `pac_details_upsert-spec` | `handleSave` CREATE/UPDATE branches. Server re-reads `items.is_active` so the client can't spoof the new row's state. |
| `pac_details_delete-spec` | `handleDeleteConfirm` (audit log + delete). Server re-reads the row just before delete so the audit payload reflects the actual on-disk state (closes a small TOCTOU window). |

The `DUPLICATE_SPEC` error code is surfaced explicitly so the UI's
friendly toast no longer depends on string-matching DB error text.

### 2.3 Pallet Dashboard — `pac_dashboard_*` (2 functions)

Caller: `src/components/packing-engine/PalletDashboard.tsx`. Read-only module.

| Function | Replaces |
|---|---|
| `pac_dashboard_list-pallets` | 7 summary-state counts + paginated list + items join + `pack_pallet_containers` pre-fetch (used by the client-side search) — 9 → 1 |
| `pac_dashboard_get-containers` | `svc.fetchPalletContainers` (nested containers/profiles/packing_boxes select for the expand-row drawer) |

Card aggregation preserved exactly:
`filling = OPEN + FILLING`, `dispatched = DISPATCHED + IN_TRANSIT`.
The `container_id_map` returned by the list function is the same
lowercased shape the UI's client-side search filter expects.

### 2.4 Auth layer — `au_*` (2 functions)

Used across the whole app.

| Function | Replaces |
|---|---|
| `au_get-user-role` | `utils/auth.getUserRole()` direct DB read. Security upgrade: `user_id` is taken from the verified JWT — callers can no longer pass arbitrary IDs. |
| `au_get-profile` | `App.tsx fetchUserRole` profile SELECT (role / is_active / email / full_name). Runs in parallel with the permissions call, same as before. |

---

## 3. Edge functions from the login2 merge (authentication + session)

These arrived via the `origin/login2` merge into `mig/packing`. They
run alongside the functions above and are what the app now uses for
every login / logout / session-validation flow.

### `auth-login`
Replaces the browser's old `supabase.auth.signInWithPassword()` call.
What it does server-side:
- Takes the caller's identifier + password + `global_session_id`.
- Normalizes the identifier, records client IP + user-agent.
- Authenticates against Supabase Auth.
- **Single-session enforcement.** If the user already has an `ACTIVE`
  row in `global_sessions`, it kills the old one with reason
  `CONCURRENT_LOGIN` and records the event in `auth_login_activity`.
- Writes a new `global_sessions` row tied to the JWT's `jti`.
- Returns the access token + the new global session ID.

Why it matters: login policy (single-session, audit trail, credential
normalization) now lives on the server where the browser can't skip
it.

### `auth-logout`
Mirror of `auth-login`. On POST:
- Extracts `sub` from the JWT.
- Calls `supabase.auth.signOut` server-side.
- Updates the user's `global_sessions` row to `ENDED` with reason
  `USER_LOGOUT`.
- Writes a `LOGOUT` event row to `auth_login_activity`.

### `auth-validate-session`
The heartbeat the frontend polls. On POST with `{ global_session_id }`:
- Looks up the session row in `global_sessions`.
- Returns `{ valid: true | false, status: ... }` so the browser can
  force-logout if the server killed the session (e.g. the user
  logged in on another tab).

This is what enables the cross-tab logout behaviour you see via the
`clearClientAuthState(..., CONCURRENT_TAB_LOGOUT_MESSAGE)` path in
`App.tsx`.

### `session-manager`
Operational session tracking for long-running workflows — dispatch
selection, packing list wizard, stock movement form, contract
config, item edit. Creates / reads / updates / closes
`operation_sessions` rows with states `draft / in_progress /
completed / abandoned`. Fires `operation_session_events` for audit.

Not auth itself — it's per-feature session state so partially
filled-in forms can be resumed and conflicts between concurrent
editors can be detected.

### `make-server-9c637d11`
Placeholder 404 handler. Exists so the front-end's legacy
`make-server-*` lookups don't blow up — returns 404 for any
request. Safe to leave deployed; no runtime role.

---

## 4. Dead code removed by this branch

Because the edge functions take over the work, several client-side
functions became orphans. Removed in this branch:

`src/components/packing/packingService.ts` — net **~780 lines** gone:
- `logAudit` (helper only used by deleted functions)
- `createPackingFromMovementApproval` / `...Rejection`
- `fetchPackingRequests` (workflow layer, unused in v9 UI)
- `fetchBoxesForRequest` / `fetchAuditLogs`
- `startPacking` / `addBox` / `deleteBox`
- `autoGenerateBoxes` / `markAllStickersPrinted` / `markStickerPrinted`
- `completePacking`

`src/components/packing-engine/packingEngineService.ts`:
- `processPackingBoxAsContainer` (~170 lines) — logic now inside
  `sg_auto-generate` Phase 5

`src/components/packing-engine/index.ts`:
- Dead re-export of `processPackingBoxAsContainer`

`src/utils/` — whole files removed (zero callers after cleanup):
- `auditLogger.ts`
- `idGenerator.ts`

Net diff for this branch before the merge: **+3145 / −1754** across
28 files.

---

## 5. What's still outstanding

Two known items remain unmigrated in this branch:

### 5.1 `rpc/get_effective_permissions` (deferred by request)
Still called directly from the browser by
`src/auth/services/permissionService.ts`. Returns the user's effective
permission matrix (module × view/create/edit/delete) with a
`source` field explaining the path: `role_default` / `override` /
`full_control` / `l3_full_access`. To migrate this 1:1, the PL/pgSQL
merge logic (role-defaults ⨝ per-user overrides with `grant` vs
`full_control` modes, plus the L3 short-circuit) needs to be ported
to Deno. Not done here — tracked for a follow-up.

### 5.2 `GET system_settings?key=eq.permission_source`
Tiny direct-DB call from `permissionService.getPermissionSource()`.
Reads the feature flag that tells the permissions service which
source to trust (`localStorage` / `db_with_fallback` / `db_only` /
`cleanup_done`). Cached in memory for 5 minutes. Should be folded
into the same future edge function that replaces
`get_effective_permissions`.

When those land, the browser will make zero direct DB or RPC calls
except:
- Realtime WebSocket subscriptions (cannot be migrated — WebSocket
  vs HTTP).
- `supabase.auth.*` calls that only touch local storage, not
  network (`getSession`, `onAuthStateChange`).

---

## 6. Risks / assumptions worth flagging for review

- **Transactional correctness of `sg_transfer-stock`.** The
  deno-postgres transaction semantics match the RPC, but the two
  implementations share zero code. Regression risk is non-zero for
  pathological edge cases (concurrent operators on the same pallet,
  idempotency-key collisions across different operations). The
  idempotency table's (`idempotency_key, operation_type`) unique
  index is the main safety net — it **must** exist for the function
  to work. We've confirmed it does.
- **Edge-function cold starts** add ~1–2s on the first call after a
  deploy. Every function deployed here has been exercised warm and
  responds in 100–800 ms. The `sg_get-detail` + `pac_dashboard_get-
  containers` endpoints can take longer for very large pallets (70+
  containers) because the nested PostgREST SELECT is inherently
  expensive — that is not a migration regression.
- **`--no-verify-jwt` on every deployed edge function.** The project
  is on ES256 signing keys which the gateway's default HS256
  verifier rejects. Every function verifies the JWT internally via
  `userClient.auth.getUser(token)` (which supports ES256), so
  disabling the gateway-level check doesn't lose security. Swap back
  to gateway verification once the project-level JWT setting allows
  it.
- **Request body trust.** Where a caller could meaningfully spoof a
  value (user id, role, spec active-flag), the edge functions
  **re-derive it from the JWT or re-read it from the DB** rather than
  trusting the payload. See `au_get-user-role`, `au_get-profile`,
  `pac_details_upsert-spec`, `pac_details_delete-spec`.
- **Realtime subscription on `pack_pallets`** in the Pallet Dashboard
  stays client-side. It cannot move — it's WebSocket-based and
  that's not what edge functions solve. Treating it as "still
  exposes the table" is fine because it's read-only subscription,
  filtered by RLS.

---

## 7. One-time operational steps applied during this migration

1. **Unique index for idempotency** (already applied by your DBA):
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS idempotency_keys_key_operation_uidx
     ON public.idempotency_keys (idempotency_key, operation_type);
   ```
   Required by `sg_transfer-stock`. Without it, the `INSERT ... ON
   CONFLICT` atomic claim fails at SQL parse time.

2. **PDF service URL/key rotation** (unrelated to edge functions, done
   in the same branch). The Azure Container App host changed from
   `…mangocliff-a649ed6d…` to `…yellowtree-adf7b03e…` and a fresh
   256-bit API key was issued. The new key **must** also be set on
   the PDF service side — the client-side `.env` value alone is not
   enough.

---

## 8. How to verify the migration in a fresh environment

1. `npm install` + `npm run dev`.
2. Log in → opens the app → `auth-login` fires → `au_get-profile`
   + `rpc/get_effective_permissions` fire in parallel.
3. Open **Packing → Sticker Generation**: one `sg_list-requests`
   call; pick a row → one `sg_get-detail`; the page auto-fires
   `sg_auto-generate` for APPROVED requests. Click Print All →
   `sg_mark-all-printed`. Click Move to FG Warehouse →
   `sg_transfer-stock`.
4. **Packing → Packing Details**: one `pac_details_list-specs`;
   Add modal → `pac_details_search-items`; save →
   `pac_details_upsert-spec`; delete → `pac_details_delete-spec`.
5. **Packing → Pallet Dashboard**: one `pac_dashboard_list-pallets`;
   expand any row → `pac_dashboard_get-containers`.
6. In the browser Network tab, confirm **no `/rest/v1/*` calls
   besides the two outstanding items in §5**.

---

*Last updated: the commit that merged `origin/login2` into
`mig/packing`.*
