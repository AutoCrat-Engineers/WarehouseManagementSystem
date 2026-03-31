# RBAC Database Reference

> **Version:** 0.4.1 | **Last Updated:** 2026-03-06  
> **Status:** Production (`db_only` mode)

## Overview

The Granular RBAC (GRBAC) system replaces hardcoded role checks with a database-backed permission engine. L3 (Manager) users can grant or restrict specific permissions for L1/L2 users via the Grant Access Modal.

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                FRONTEND (React/TypeScript)                │
│  App.tsx → getUserPermissions(userId)                    │
│  Components check: userPerms['module.action'] === true   │
├─────────────────────────────────────────────────────────┤
│                PERMISSION SERVICE                        │
│  permissionService.ts                                    │
│    1. Reads feature flag: system_settings                │
│    2. Calls RPC: get_effective_permissions(p_user_id)    │
│    3. Converts rows to flat PermissionMap                │
│    4. In-memory cache (60s TTL)                          │
├─────────────────────────────────────────────────────────┤
│                DATABASE (PostgreSQL/Supabase)             │
│  get_effective_permissions(p_user_id uuid)               │
│    1. Gets user role from profiles                       │
│    2. Gets role defaults from role_module_defaults       │
│    3. Gets user overrides from user_permissions          │
│    4. Merges (L3 = all access, L1/L2 = merge/override)  │
└─────────────────────────────────────────────────────────┘
```

## Role Hierarchy

| Role | Name | Level | Description |
|------|------|-------|-------------|
| **L3** | Manager | 3 | Full system access. Creates users, assigns roles. |
| **L2** | Supervisor | 2 | Operations oversight. Approves transactions. |
| **L1** | Operator | 1 | Day-to-day operations within assigned modules. |

## Key Principles

1. **No Public Signup** — Only L3 can create users
2. **Permission Inheritance** — L3 always has all permissions; L1/L2 start with role defaults
3. **Granular Overrides** — L3 can grant/restrict individual permissions per user
4. **Server-Side Validation** — Frontend checks are UX only; all validated server-side

## Database Tables

### `user_permissions` — Per-User Overrides

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` PK | Auto-generated |
| `user_id` | `uuid` FK → `profiles.id` | Target user |
| `module_name` | `varchar` FK → `module_registry.module_key` | Module |
| `can_view` | `boolean` | View permission |
| `can_create` | `boolean` | Create permission |
| `can_edit` | `boolean` | Edit permission |
| `can_delete` | `boolean` | Delete permission |
| `override_mode` | `varchar` | `'grant'` or `'full_control'` |
| `overridden_by` | `uuid` FK → `profiles.id` | L3 who set override |

**Unique Constraint:** `(user_id, module_name)` — one override per module per user.

### `module_registry` — Module Definitions

| Column | Type | Description |
|--------|------|-------------|
| `module_key` | `varchar` PK | e.g., `items`, `packing.packing-details` |
| `display_name` | `varchar` | Human-readable name |
| `parent_module` | `varchar` | Parent for submodules |
| `sort_order` | `integer` | Display order |
| `is_active` | `boolean` | Whether active |

### `system_settings` — Feature Flags

| Key | Value | Purpose |
|-----|-------|---------|
| `permission_source` | `"db_only"` | Controls RBAC engine mode |

Values: `localStorage` → `db_with_fallback` → `db_only` → `cleanup_done`

### `profiles` — User Accounts

| Column | Type | Description |
|--------|------|-------------|
| `id` | `uuid` FK → `auth.users` | User ID |
| `email` | `varchar` | Email |
| `full_name` | `varchar` | Display name |
| `role` | `varchar` | L1, L2, or L3 |
| `is_active` | `boolean` | Can login? |

## Database Functions

### `get_effective_permissions(p_user_id uuid)`

**Returns:** `TABLE(module_name, can_view, can_create, can_edit, can_delete, source)`

**Logic:**
- **L3** → always returns ALL modules with ALL permissions = `true`
- **L1/L2** → merges role defaults with user overrides:
  - `override_mode = 'full_control'` → use override only
  - `override_mode = 'grant'` → OR-merge with role defaults

### `check_user_permission(p_user_id, p_module, p_action)`

**Returns:** `boolean` — single permission check for backend use.

## Module Registry

| Module Key | Display Name | Actions |
|-----------|-------------|---------|
| `dashboard` | Dashboard | view |
| `items` | Item Master | view, create, edit, delete |
| `inventory` | Inventory | view, create, edit |
| `stock-movements` | Stock Movements | view, create, edit, delete |
| `packing` | Packing | view, create, edit, delete |
| `packing.sticker-generation` | Sticker Generation | view, create, edit |
| `packing.packing-details` | Packing Details | view, create, edit, delete |
| `orders` | Blanket Orders | view, create, edit, delete |
| `releases` | Blanket Releases | view, create, edit, delete |
| `forecast` | Forecasting | view, create, edit |
| `planning` | MRP Planning | view, create, edit |
| `users` | User Management | view, create, edit, delete |
| `notifications` | Notifications | view |

## Permission Flow

### Login Flow
```
App.tsx → fetchUserRole()
  → Promise.allSettled([profileFetch, permissionFetch])    ← PARALLEL
  → getUserPermissions(userId)
    → Check cache (60s TTL)                                 ← CACHE HIT = instant
    → If miss: supabase.rpc('get_effective_permissions')
    → rowsToPermissionMap(rows)
    → Cache result
  → setUserPerms(perms)
  → Components receive userPerms as prop
```

### Grant Flow
```
Grant Access Modal → User selects checkboxes
  → GrantAccessModal saves with override_mode = 'full_control'
  → UPSERT into user_permissions table
  → Cache invalidated
```

### Component Pattern
```typescript
const hasPerms = Object.keys(userPerms).length > 0;
const canCreate = userRole === 'L3' || (hasPerms ? userPerms['items.create'] === true : false);
const canEdit = userRole === 'L3' || (hasPerms ? userPerms['items.edit'] === true : userRole === 'L2');
```

## Frontend Integration

| File | RBAC Changes |
|------|-------------|
| `src/auth/services/permissionService.ts` | Core RBAC engine with caching |
| `src/auth/components/GrantAccessModal.tsx` | L3 permission editor UI |
| `src/App.tsx` | Loads `userPerms`, `canAccessView()` for sidebar |
| `src/components/ItemMasterSupabase.tsx` | `items.create/edit/delete` gating |
| `src/components/StockMovement.tsx` | `stock-movements.create/edit` gating |
| `src/components/packing/PackingDetails.tsx` | `packing.packing-details.*` gating |

## Initial Setup

1. Run RBAC migration scripts in order (`.db_reference/migrations/001-008`)
2. Create first L3 admin in Supabase Dashboard → Authentication → Users
3. Set role: `UPDATE profiles SET role = 'L3' WHERE email = 'admin@company.com';`
4. Login as L3 → use User Management to create more users

## Troubleshooting

### Permissions not loading?
1. Check browser console for `[PermService]` logs
2. Verify `permission_source`: `SELECT * FROM system_settings WHERE key = 'permission_source';`
3. Test RPC: `SELECT * FROM get_effective_permissions('USER_UUID');`

### Grant Modal not saving?
1. Check `module_registry` is populated: `SELECT * FROM module_registry ORDER BY sort_order;`
2. Verify RLS allows L3 to write to `user_permissions`

### Cache issues?
- Permissions cache = 60 seconds TTL
- Hard refresh or wait for cache expiry
- Cache invalidated on permission save via `invalidateUserPermCache()`
