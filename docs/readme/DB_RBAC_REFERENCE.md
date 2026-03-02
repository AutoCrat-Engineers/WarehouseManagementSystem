# 🛡️ Database RBAC Reference — Granular Permission System

> **Version:** 0.4.0  
> **Last Updated:** 2026-03-02  
> **Status:** Production (Active on `db_with_fallback`)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Tables Created](#tables-created)
- [Database Functions](#database-functions)
- [Feature Flag System](#feature-flag-system)
- [Migration History](#migration-history)
- [Permission Flow](#permission-flow)
- [Module Registry](#module-registry)
- [Frontend Integration](#frontend-integration)
- [Unused / Legacy Tables](#unused--legacy-tables)
- [Safe Cleanup SQL](#safe-cleanup-sql)
- [Troubleshooting](#troubleshooting)

---

## Overview

The Granular RBAC system replaces the old hardcoded role checks (`userRole === 'L1'`) with a database-backed permission engine. L3 (Manager) users can grant or restrict specific create/edit/delete permissions for L1 and L2 users via the Grant Access Modal.

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    FRONTEND (React/TypeScript)                   │
│                                                                 │
│  App.tsx → getUserPermissions(userId)                           │
│         → stores in userPerms state                             │
│         → passes to ItemMasterSupabase, StockMovement,         │
│           PackingDetails, etc.                                  │
│                                                                 │
│  Components check: userPerms['module.action'] === true          │
├─────────────────────────────────────────────────────────────────┤
│                    PERMISSION SERVICE (TypeScript)               │
│                                                                 │
│  permissionService.ts                                          │
│    1. Reads feature flag: system_settings.permission_source    │
│    2. Calls RPC: get_effective_permissions(p_user_id)          │
│    3. Converts rows to flat PermissionMap                      │
├─────────────────────────────────────────────────────────────────┤
│                    DATABASE (PostgreSQL/Supabase)                │
│                                                                 │
│  get_effective_permissions(p_user_id uuid)                     │
│    1. Gets user role from profiles                             │
│    2. Gets role defaults from role_module_defaults             │
│    3. Gets user overrides from user_permissions                │
│    4. Merges based on override_mode (full_control)             │
│    5. Returns: module_name, can_view/create/edit/delete,       │
│               source ('role_default' | 'override')             │
└─────────────────────────────────────────────────────────────────┘
```

---

## Tables Created

### 1. `user_permissions` — Per-User Permission Overrides

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` PK | Auto-generated |
| `user_id` | `uuid` FK → `profiles.id` | Target user |
| `module_name` | `varchar` FK → `module_registry.module_key` | Module identifier |
| `can_view` | `boolean` | View permission |
| `can_create` | `boolean` | Create permission |
| `can_edit` | `boolean` | Edit permission |
| `can_delete` | `boolean` | Delete permission |
| `override_mode` | `varchar` CHECK `'grant'` or `'full_control'` | How overrides merge with role defaults |
| `source_role` | `varchar` | Role at time of override |
| `overridden_by` | `uuid` FK → `profiles.id` | L3 user who set the override |
| `overridden_at` | `timestamptz` | When override was set |
| `created_at` | `timestamptz` | Row creation timestamp |
| `updated_at` | `timestamptz` | Last update timestamp |

**Unique Constraint:** `(user_id, module_name)` — one override per module per user.

### 2. `module_registry` — Module Definitions

| Column | Type | Description |
|--------|------|-------------|
| `module_key` | `varchar` PK | Module identifier (e.g., `items`, `packing.packing-details`) |
| `display_name` | `varchar` | Human-readable name |
| `parent_module` | `varchar` | Parent module for submodules (null for top-level) |
| `sort_order` | `integer` | Display order |
| `is_active` | `boolean` | Whether module is active |

### 3. `system_settings` — Feature Flags

| Column | Type | Description |
|--------|------|-------------|
| `key` | `varchar` PK | Setting key |
| `value` | `jsonb` | Setting value |
| `updated_at` | `timestamptz` | Last update |
| `updated_by` | `uuid` | Who updated |

**Key Setting:** `permission_source` controls which RBAC engine is active:

| Value | Behavior |
|-------|----------|
| `"localStorage"` | Legacy mode — browser localStorage only |
| `"db_with_fallback"` | **Current** — DB-backed with localStorage fallback |
| `"db_only"` | DB only, no fallback |
| `"cleanup_done"` | All legacy code removed |

### 4. `roles` — Role Definitions (Pre-existing)

| Role ID | Name | Level |
|---------|------|-------|
| `L1` | Operator | 1 |
| `L2` | Supervisor | 2 |
| `L3` | Manager | 3 |

### 5. `permissions` — Legacy Role-Action Matrix (Pre-existing)

Used by `get_effective_permissions()` to determine role defaults.

---

## Database Functions

### `get_effective_permissions(p_user_id uuid)`

**Returns:** `TABLE(module_name varchar, can_view bool, can_create bool, can_edit bool, can_delete bool, source varchar)`

**Logic:**
1. If user is L3 → returns ALL modules with ALL permissions set to `true` (source = `'l3_full_access'`)
2. For L1/L2:
   - Loads role defaults from `role_module_defaults` view
   - Loads user overrides from `user_permissions`
   - For each module in `module_registry`:
     - If override exists with `override_mode = 'full_control'`: use override only (source = `'full_control'`)
     - If override exists with `override_mode = 'grant'`: OR-merge with role defaults (source = `'override'`)
     - If no override: use role defaults (source = `'role_default'`)

### `check_user_permission(p_user_id uuid, p_module varchar, p_action varchar)`

**Returns:** `boolean`

Quick single-permission check for backend use.

---

## Feature Flag System

The `permission_source` flag in `system_settings` controls the rollout:

```
localStorage → db_with_fallback → db_only → cleanup_done
```

**Current state:** `db_only`

To advance to `db_only` (after confirming everything works):
```sql
UPDATE public.system_settings
SET value = '"db_only"'::jsonb,
    updated_at = now()
WHERE key = 'permission_source';
```

---

## Migration History

Migrations are in `.db_reference/migrations/` and should be run in order:

| # | File | Purpose | Status |
|---|------|---------|--------|
| 001 | `001_create_user_permissions.sql` | Creates `user_permissions`, `module_registry`, `role_module_defaults`, `system_settings` | ✅ Applied |
| 002 | `002_normalize_permissions.sql` | Normalizes permission data, seeds module registry | ✅ Applied |
| 003 | `003_staging_flag_engine.sql` | Creates `perm_migration_staging`, `get_effective_permissions()`, `check_user_permission()` | ✅ Applied |
| 004 | `004_security_hardening.sql` | RLS policies on permission tables | ✅ Applied |
| 005 | `005_fix_effective_permissions_or_logic.sql` | Fixes OR-merge logic in `get_effective_permissions()` | ✅ Applied |
| 005b | `005_rollback_scripts.sql` | Rollback scripts (reference only) | 📋 Reference |
| 006 | `006_validation_queries.sql` | Validation queries to verify migration | 📋 Reference |
| 007 | `007_override_mode.sql` | Adds `override_mode` column, updates `get_effective_permissions()` | ✅ Applied |
| 008 | `008_advance_permission_source.sql` | Sets `permission_source = 'db_with_fallback'` | ✅ Applied |

---

## Permission Flow

### When L3 Grants Permissions:

```
Grant Access Modal
  → User selects permissions (checkboxes)
  → GrantAccessModal always saves with override_mode = 'full_control'
  → permissionService.dbSaveUserPermissions()
  → UPSERT into user_permissions table
```

### When User Logs In:

```
App.tsx → fetchUserRole()
  → Promise.allSettled([          ← PARALLEL (v0.4.0 perf optimization)
       profileFetch,
       getUserPermissions(userId)
     ])
  → getUserPermissions(userId)
    → Check in-memory cache (60s TTL)     ← CACHE HIT = instant return
    → If miss: getPermissionSource()
      → Check source cache (5-min TTL)    ← Avoids DB call
      → If miss: reads system_settings.permission_source
    → supabase.rpc('get_effective_permissions', { p_user_id })
    → rowsToPermissionMap(rows)
    → Cache result in userPermCache
  → setUserPerms(perms)
  → Components receive userPerms as prop
```

### In Components:

```typescript
// Pattern used in all components:
const hasPerms = Object.keys(userPerms).length > 0;
const canCreate = userRole === 'L3' || (hasPerms ? userPerms['module.action'] === true : fallbackRoleCheck);
```

---

## Module Registry

These modules are registered in both the `module_registry` table and the frontend `MODULE_CONFIG`:

| Module Key | Display Name | Actions | Parent |
|-----------|-------------|---------|--------|
| `dashboard` | Dashboard | view | — |
| `items` | Item Master | view, create, edit, delete | — |
| `inventory` | Inventory | view, create, edit | — |
| `stock-movements` | Stock Movements | view, create, edit, delete | — |
| `packing` | Packing | view, create, edit, delete | — |
| `packing.sticker-generation` | Sticker Generation | view, create, edit | packing |
| `packing.packing-details` | Packing Details | view, create, edit, delete | packing |
| `packing.packing-list-invoice` | Packing List — Invoice | view, create, edit, delete | packing |
| `packing.packing-list-sub-invoice` | Packing List — Sub Invoice | view, create, edit, delete | packing |
| `orders` | Blanket Orders | view, create, edit, delete | — |
| `releases` | Blanket Releases | view, create, edit, delete | — |
| `forecast` | Forecasting | view, create, edit | — |
| `planning` | MRP Planning | view, create, edit | — |
| `users` | User Management | view, create, edit, delete | — |
| `notifications` | Notifications | view | — |

---

## Frontend Integration

### Files Modified for Granular RBAC:

| File | Changes |
|------|---------|
| `src/auth/services/permissionService.ts` | Core RBAC engine — reads DB, manages feature flag |
| `src/auth/components/GrantAccessModal.tsx` | L3's UI for granting/revoking permissions |
| `src/App.tsx` | Loads `userPerms`, passes to components, `canAccessView()` for sidebar |
| `src/components/ItemMasterSupabase.tsx` | Uses `items.create/edit/delete` for button gating |
| `src/components/StockMovement.tsx` | Uses `stock-movements.create/edit` for New Movement & Review |
| `src/components/packing/PackingDetails.tsx` | Uses `packing.packing-details.create/edit/delete` |

---

## Unused / Legacy Tables

The following tables exist in the database but are **NOT accessed** by the current codebase. They are safe to drop after verification.

### ⚠️ Candidates for Removal (NOT referenced in codebase):

| Table | Reason for Removal | Has Data? | FK Dependencies? |
|-------|-------------------|-----------|-------------------|
| `audit_logs` (plural) | Duplicate of `audit_log` (singular) which IS used | Check | FK → profiles |
| `perm_migration_staging` | Temporary migration table, no longer needed | Likely empty | FK → profiles |
| `view_backups` | One-time view migration utility table | Likely has rows | None |
| `view_deployment_log` | One-time view deployment tracking | Likely has rows | None |
| `user_roles` | Legacy role assignment table, NOT used (roles are in `profiles.role`) | Check | FK → profiles |
| `users` (public.users) | Legacy user table, NOT used (all auth uses `profiles`) | Check | FK → auth.users |

### ✅ Tables That ARE Used (DO NOT DELETE):

| Table | Used By |
|-------|---------|
| `audit_log` (singular) | `userService.ts`, `authService.ts`, `itemsSupabase.ts`, `PackingDetails.tsx`, `index.tsx` |
| `packing_audit_logs` | `packingService.ts` |
| `permissions` | `index.tsx` (edge functions) |
| `roles` | Used by `get_effective_permissions()` function |
| `user_permissions` | Core RBAC table — `permissionService.ts` |
| `module_registry` | Referenced by `user_permissions` FK |
| `system_settings` | Feature flag for `permission_source` |
| `profiles` | Core authentication table |
| `stock_movements` | `InventoryRepository.ts`, `itemsSupabase.ts` |

---

## Safe Cleanup SQL

> ⚠️ **Run these ONLY after verifying the tables are empty or their data is not needed.**
> Always create a backup first!

```sql
-- ============================================================================
-- STEP 1: Verify tables are empty or have no important data
-- ============================================================================

SELECT 'perm_migration_staging' AS table_name, count(*) FROM public.perm_migration_staging
UNION ALL
SELECT 'view_backups', count(*) FROM public.view_backups
UNION ALL
SELECT 'view_deployment_log', count(*) FROM public.view_deployment_log
UNION ALL
SELECT 'user_roles', count(*) FROM public.user_roles
UNION ALL
SELECT 'users', count(*) FROM public.users
UNION ALL
SELECT 'audit_logs', count(*) FROM public.audit_logs;

-- ============================================================================
-- STEP 2: Drop unused tables (only if counts above are 0 or data is not needed)
-- ============================================================================

-- Temporary migration staging (safe to drop)
DROP TABLE IF EXISTS public.perm_migration_staging;

-- View migration utility tables (safe to drop)
DROP TABLE IF EXISTS public.view_backups;
DROP TABLE IF EXISTS public.view_deployment_log;

-- ============================================================================
-- STEP 3: CAREFUL — Only drop after confirming NOT used
-- ============================================================================

-- Legacy user_roles table (roles are stored in profiles.role now)
-- Verify no data: SELECT * FROM public.user_roles;
-- DROP TABLE IF EXISTS public.user_roles;

-- Legacy users table (auth uses profiles table now)
-- Verify no data: SELECT * FROM public.users;
-- DROP TABLE IF EXISTS public.users;

-- Duplicate audit_logs table (audit_log singular is the real one)
-- Verify no data: SELECT * FROM public.audit_logs LIMIT 10;
-- DROP TABLE IF EXISTS public.audit_logs;
```

---

## Troubleshooting

### Permissions not loading?

1. Check browser console for `🏷️ [PermService]` logs
2. Verify `permission_source = 'db_with_fallback'`:
   ```sql
   SELECT * FROM system_settings WHERE key = 'permission_source';
   ```
3. Test the RPC directly:
   ```sql
   SELECT * FROM get_effective_permissions('USER_UUID_HERE');
   ```

### Grant Access Modal not saving?

1. Check that `module_registry` is populated:
   ```sql
   SELECT * FROM module_registry ORDER BY sort_order;
   ```
2. Verify RLS policies allow L3 to write to `user_permissions`

### User can still access modules after permission removal?

1. The `permission_source` must be `db_with_fallback` or `db_only`
2. User must log out and log back in (permissions are loaded on login)
3. Cache expires every 30 seconds — wait or hard-refresh

---

*Document maintained as part of WMS v0.4.0 — Granular RBAC Release*
