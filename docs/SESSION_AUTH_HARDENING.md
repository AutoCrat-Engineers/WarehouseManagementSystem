# Session & Auth Hardening (v0.6.0)

This document captures the auth, session, and lockout architecture
introduced in v0.6.0. It is the source of truth for ops, security
review, and onboarding new engineers to this code path.

---

## Invariants

1. **One active session per user.** Across devices, browsers, tabs.
2. **JWT validity ≠ session validity.** Every protected mutation
   validates the row in `global_sessions`, not just the JWT signature.
3. **No silent data loss on concurrent login.** New logins block with
   `409 SESSION_BUSY` while the old session is mid-mutation; the new
   user must wait for the lock to release or click "Force takeover"
   (audit-logged).
4. **Idle = 10 min of no user input.** Server-enforced via
   `enforce_active_session`; client `SessionGuard` provides a
   defense-in-depth detector.
5. **3 wrong passwords → account lock.** Counter is server-side and
   atomic. Unlock is L3-only.
6. **Strict deny-by-default RBAC.** L1/L2 see nothing until L3 grants.

---

## Components

### Database (`public` schema)

| Object | Purpose |
|---|---|
| `profiles` | Extended with `failed_login_count`, `last_failed_login_at`, `locked_at`, `lock_reason` (migration 066). Partial unique index `WHERE role='L3' AND deleted_at IS NULL` (migration 068) enforces single-L3. |
| `global_sessions` | Extended with `last_activity_at`, `idle_timeout_seconds`, `access_token_jti`, `killed_by_session_id`. Status enum gains `KILLED`, `IDLE_EXPIRED`. Subscribed to `supabase_realtime` publication for instant cross-browser kill. |
| `transaction_locks` | New. PK `(user_id, lock_key)`. Row exists for the duration of any wrapped mutation. `acquire_transaction_lock` / `release_transaction_lock` RPCs manage it (server-side only — clients never read or write it directly). |
| `user_permissions` | Subscribed to `supabase_realtime` with an owner-select RLS policy. UPDATE events drive the L1/L2 menu refresh. |

### Edge functions

| Function | Auth | Purpose |
|---|---|---|
| `auth-login` | Public | Lockout pre-flight, password check, in-flight lock check (409 SESSION_BUSY), kill-old-sessions, JTI binding. Supports `force_takeover: true`. |
| `auth-validate-session` | Bearer | Wraps `enforce_active_session`. Used as the heartbeat. |
| `auth-logout` | Bearer | Marks session ENDED, releases locks, calls `admin.signOut(global)`. |
| `admin_user_action` | L3 | Deactivate/delete a user. Locks profile, kills sessions with `ended_reason=ADMIN_DEACTIVATED|ADMIN_DELETED`. |
| `admin_reset_password` | L3 | Direct password override via `auth.admin.updateUserById`. 10 production safeguards (see CHANGELOG). |
| `admin_set_user_role` | L3 | Change role with single-L3 enforcement. Demotion from L3 wipes stale `user_permissions` rows. |
| `perm_get_my_permissions` | Any session | Strict deny-by-default. L3 = full access; L1/L2 = only `user_permissions` rows. |
| `perm_get_user_permissions` | L3 | Loads target user's permissions for the Grant Access modal. |
| `perm_save_user_permissions` | L3 | Validates, upserts, audit-logs. Realtime push delivers the change to the affected user. |

### Shared edge-function helper (`_shared/session.ts`)

- `requireActiveSession(req, opts)` — JWT validation + role check + session row check. Falls back to user-id-based session lookup when `X-Session-Id` header is absent (legacy raw-fetch components).
- `withTransactionLock(ctx, { key, label, ttlSeconds }, body)` — acquires a per-key lock, runs the body, releases in `finally`. Used by 33 critical mutation functions.
- `withMutationGuard(req, { label }, body)` — combined helper that wraps the entire handler in one call.

### Client

| File | Role |
|---|---|
| `src/auth/sessionGuard.ts` | Vanilla controller: BroadcastChannel single-tab claim, activity listeners (mousedown/keydown/scroll/touchstart), 10-min idle, 60-s heartbeat, Realtime subscription on `global_sessions`. Disconnect reasons: `IDLE_TIMEOUT`, `TAB_TAKEOVER`, `CONCURRENT_LOGIN`, `ACCOUNT_LOCKED`, `SESSION_KILLED`, `SESSION_ENDED`, `SESSION_NOT_FOUND`. |
| `src/utils/supabase/auth.ts` | `setActiveSessionId`/`getActiveSessionId`. `fetchWithAuth` injects `X-Session-Id` and surfaces structured `SessionInvalidError`. |
| `src/App.tsx` | SessionGuard lifecycle, `handleLogin` returning structured `LoginResult`, empty-state landing for L1/L2, Realtime subscription on `user_permissions` for live menu refresh. |
| `src/auth/login/LoginPage.tsx` | Force-takeover modal + auto-wait spinner for `409 SESSION_BUSY`. Shows attempts-remaining on `INVALID_CREDENTIALS`. |
| `src/auth/services/permissionService.ts` | All client permission reads/writes route through edge functions. No RPC calls. |
| `src/auth/services/userService.ts` | `updateUserStatus`, `deleteUser`, `updateUserRole`, `resetUserPassword` all route through edge functions. |

---

## End-to-end scenarios

### Login (happy path)

1. Client posts `{email, password}` → `auth-login`.
2. Edge function: not locked → `signInWithPassword` succeeds → no live locks → `kill_user_sessions` (no-op if first login) → re-`signIn` to mint a fresh refresh token → insert `global_sessions` row with JTI → reset failed counter → audit + return tokens + `global_session_id` + `idle_timeout_seconds`.
3. Client: sets Supabase session, stores `global_session_id`, starts `SessionGuard`. Fetches own profile + permissions via edge functions.

### Concurrent login (different browser, same user, no in-flight tx)

1. Browser B posts to `auth-login` → no live locks → `kill_user_sessions` updates A's row to `KILLED`.
2. Postgres replicates the change → Supabase Realtime pushes UPDATE to Browser A's open WebSocket.
3. A's `SessionGuard` Realtime callback sees `status=KILLED` → calls `onDisconnect('CONCURRENT_LOGIN')` → A drops to login screen with the right banner. Total time: ~1 s.

### Concurrent login WITH in-flight transaction

1. Browser A is mid-`gr_confirm_receipt` (or any of the 33 wrapped mutations) — `transaction_locks` row exists.
2. Browser B posts to `auth-login` → finds the lock → returns `409 SESSION_BUSY` with `in_flight: [{ op_label, age_seconds }]`.
3. Browser B's `LoginPage` shows the yellow auto-wait banner and polls `auth-login` every 2s for up to 60s.
4. When A's mutation commits/aborts, the lock is auto-released in the edge function's `try/finally`.
5. Next poll from B succeeds → A is killed via Realtime → B is logged in.

### 3-strikes lockout

1. User submits wrong password → `auth-login` → `record_failed_login` increments `profiles.failed_login_count`.
2. On the 3rd failed attempt, the same query sets `is_active=false`, `locked_at=now()`, `lock_reason='TOO_MANY_FAILED_ATTEMPTS'`.
3. Client receives `423 ACCOUNT_LOCKED_NOW`.
4. Recovery: L3 admin clicks **Activate** in User Management → `userService.updateUserStatus(userId, true)` sets `is_active=true`, clears `locked_at`/`lock_reason`/`failed_login_count`. User can immediately log in.

### Admin deactivation / deletion

1. L3 clicks **Deactivate** or **Delete** in User Management.
2. `admin_user_action` updates `profiles` (sets `is_active=false`, `locked_at=now()`, `lock_reason='ADMIN_DEACTIVATED'`/`'ADMIN_DELETED'`, optionally `deleted_at`).
3. Updates `global_sessions` row(s) with `ended_reason='ADMIN_DEACTIVATED'`. Realtime pushes to the victim's tabs.
4. `SessionGuard.onDisconnect('ACCOUNT_LOCKED')` → banner: *"Account is locked. Please contact your administrator."*

### L3 promotes a 2nd user to L3 (rejected)

1. `admin_set_user_role` checks for any other active L3.
2. Returns `409 ALREADY_HAS_L3` with `existing_l3: { id, full_name, email }`.
3. UI surfaces: *"Cannot have two L3 (Manager) accounts. Bala Sir is already L3. Demote them first."*

### L3 grants modules to L2

1. L3 opens Grant Access modal → modal calls `perm_get_user_permissions` → renders checkboxes.
2. L3 ticks `items.view` + `items.create` → Save → `perm_save_user_permissions` validates + upserts.
3. Postgres updates `user_permissions` → Realtime pushes to the L2's open tab → `App.tsx` Realtime callback invalidates the cache + re-fetches perms via `perm_get_my_permissions` → menu re-renders.

---

## Failure modes & recovery

| Symptom | Likely cause | Fix |
|---|---|---|
| All logins return `423 ACCOUNT_LOCKED` | Orphan `locked_at` from a pre-v0.6.0 admin reactivation | Run `UPDATE profiles SET locked_at=NULL, lock_reason=NULL, failed_login_count=0 WHERE is_active=true AND locked_at IS NOT NULL;` |
| `perm_save_user_permissions` returns 500 with `PRIVILEGE ESCALATION BLOCKED` | Legacy `prevent_self_escalation` trigger blocks service-role writes | `DROP TRIGGER trigger_prevent_escalation ON public.user_permissions; DROP FUNCTION public.prevent_self_escalation() CASCADE;` |
| Migration 068 fails creating the unique L3 index | Multiple active L3s | Demote extras: `UPDATE profiles SET role='L2' WHERE role='L3' AND deleted_at IS NULL AND id <> '<keep-id>';` |
| Cross-browser kill takes 60 s instead of 1 s | Realtime subscription not active | Check Network → WS tab on the victim browser for an open `realtime/v1/websocket`. Check that migration 067 was applied. |
| L2 user logs in but sees nothing | Working as designed in v0.6.0 | L3 must explicitly grant modules via Grant Access. The user's open tab will refresh automatically. |

---

## Audit trail

Every privileged action writes to `audit_log`:

| `action` | Trigger |
|---|---|
| `LOGIN` / `LOGIN_FORCE_TAKEOVER` | `auth-login` success |
| `LOGOUT` | `auth-logout` |
| `USER_DEACTIVATE` / `USER_DELETE` | `admin_user_action` |
| `PASSWORD_RESET_BY_ADMIN` | `admin_reset_password` (never includes the password) |
| `ROLE_CHANGED` | `admin_set_user_role` |
| `PERMISSIONS_UPDATED` | `perm_save_user_permissions` |
| `ACTIVATE_USER` | client `userService.updateUserStatus(true)` |

Each row carries `user_id` (the actor), `target_id`, `ip_address`,
`user_agent`, and a JSON `new_value` describing the change.
