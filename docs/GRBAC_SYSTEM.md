# Granular Role-Based Access Control (GRBAC)

## Architecture Overview

The WMS-AE system uses a **3-tier permission model**:

```
Role Defaults (permissions table)
        ↕ merged via GREATEST() or full_control
User Overrides (user_permissions table)
        ↓
Effective Permissions (get_effective_permissions RPC)
```

### Role Hierarchy
| Role | Level | Description |
|------|-------|-------------|
| L1   | Operator   | Day-to-day operations, can view + create by default |
| L2   | Supervisor | Operations oversight, can view + create + edit by default |
| L3   | Manager    | Full access always, manages users and permissions |

---

## Database Schema

### Tables

#### `module_registry`
Canonical list of all feature modules. Primary key = `module_key`.

| module_key | display_name | parent_module |
|---|---|---|
| `dashboard` | Dashboard | - |
| `items` | Item Master | - |
| `inventory` | Inventory | - |
| `stock-movements` | Stock Movements | - |
| `rack-view` | Rack View | - |
| `packing.sticker-generation` | Sticker Generation | packing |
| `packing.packing-details` | Packing Details | packing |
| `packing.packing-list-invoice` | Packing List — Invoice | packing |
| `packing.packing-list-sub-invoice` | Packing List — Sub Invoice | packing |
| `packing.pallet-dashboard` | Pallet Dashboard | packing |
| `packing.contract-configs` | Contract Configs | packing |
| `packing.packing-lists` | Packing List Manager | packing |
| `packing.traceability` | Traceability | packing |
| `packing.dispatch` | Dispatch Selection | packing |
| `packing.mpl-home` | Master Packing List | packing |
| `packing.performa-invoice` | Proforma Invoice | packing |
| `orders` | Blanket Orders | - |
| `releases` | Blanket Releases | - |
| `forecast` | Forecasting | - |
| `planning` | MRP Planning | - |
| `users` | User Management | - |
| `notifications` | Notifications | - |

#### `user_permissions`
Per-user, per-module permission overrides.

```sql
CREATE TABLE public.user_permissions (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  module_name     varchar NOT NULL REFERENCES module_registry(module_key),
  can_view        boolean NOT NULL DEFAULT false,
  can_create      boolean NOT NULL DEFAULT false,
  can_edit        boolean NOT NULL DEFAULT false,
  can_delete      boolean NOT NULL DEFAULT false,
  override_mode   varchar NOT NULL DEFAULT 'grant'
                  CHECK (override_mode IN ('grant', 'full_control')),
  overridden_by   uuid REFERENCES profiles(id),
  overridden_at   timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  
  CONSTRAINT user_permissions_unique UNIQUE (user_id, module_name)
);
```

### Override Modes
- **`grant`** (default): Additive only. `Effective = GREATEST(override, role_default)`. Overrides can only ADD permissions.
- **`full_control`**: Override IS the truth. `Effective = override`. Can both add AND restrict permissions.

### RPC Functions
- `get_effective_permissions(p_user_id)` — Returns all modules with resolved permissions
- `check_user_permission(p_user_id, p_module, p_action)` — Single permission check

### RLS Policies
- Users can read their own permissions
- L3 can read AND manage all permissions
- Privilege escalation trigger prevents L3 from modifying their own permissions

---

## Frontend Architecture

### Permission Key Format
```
{module}.{action}
```
Examples: `items.view`, `packing.dispatch.create`, `stock-movements.edit`

### Centralized Utility (`src/auth/utils/permissionUtils.ts`)

```typescript
// Check if user can access a view
canAccessView('pe-dispatch', userRole, userPerms);

// Check specific action permission
canAccess('packing.dispatch', 'create', userRole, userPerms);

// Get all CRUD permissions for a module
const { canView, canCreate, canEdit, canDelete } = 
    resolvePermissions('items', userRole, userPerms);

// Check parent menu visibility
canAccessAnyPackingModule(userRole, userPerms);
canAccessAnyDispatchModule(userRole, userPerms);
```

### Permission Flow
```
Login → fetchUserRole() → getUserPermissions(userId) → setUserPerms()
                                    ↓
                              get_effective_permissions RPC
                                    ↓
                              PermissionMap { 'items.view': true, ... }
                                    ↓
                              canAccessView() / canAccess()
```

### View ↔ Permission Key Mapping
Defined in `VIEW_PERMISSION_MAP` in `permissionUtils.ts`. This is the single source of truth for mapping frontend view IDs to permission keys.

---

## Security Features

1. **RLS Policies**: Row-level security on `user_permissions` and `module_registry`
2. **Privilege Escalation Prevention**: Trigger blocks non-L3 from modifying permissions, and L3 from modifying their own
3. **Audit Trail**: All permission changes logged to `audit_log`
4. **Self-Grant Block**: L3 users cannot grant permissions to themselves
5. **Feature Flag**: `system_settings.permission_source` controls rollout phase (localStorage → db_with_fallback → db_only)

---

## Migration History

| Migration | Description |
|---|---|
| 001 | Create `module_registry` + `user_permissions` tables |
| 002 | Normalize permissions |
| 003 | Staging table + feature flag + effective permissions RPC |
| 004 | Security hardening (RLS, privilege escalation prevention) |
| 005 | Fix OR logic in get_effective_permissions |
| 007 | Add `override_mode` column |
| 013 | **GRBAC production fixes**: Add missing modules, ensure UNIQUE constraint, clean orphans |

---

## Troubleshooting

### Error: 23503 Foreign Key Violation
**Cause**: Trying to insert into `user_permissions` with a `module_name` not in `module_registry`.  
**Fix**: Run migration 013 to add all missing modules.

### Error: 409 Conflict
**Cause**: Missing UNIQUE constraint on `(user_id, module_name)`, causing `onConflict` upsert to fail.  
**Fix**: Run migration 013 which adds the constraint.

### Dispatch buttons not respecting permissions
**Cause**: Permission key mismatch — components were checking `dispatch.create` instead of `packing.dispatch.create`.  
**Fix**: Applied in DispatchSelection.tsx and PackingListManager.tsx.
