# Enterprise RBAC Authentication System

## Overview

This document describes the Role-Based Access Control (RBAC) system implemented for the Supply Chain Management System. The system follows enterprise security standards with a three-tier role hierarchy, **NO public signup**, and **granular per-user permissions** (v0.4.0).

## Role Hierarchy

| Role | Name | Level | Description |
|------|------|-------|-------------|
| **L3** | Manager | 3 | Full system access. Can create users, assign roles, configure system settings. |
| **L2** | Supervisor | 2 | Operations oversight. Can approve transactions, view all reports, manage L1 tasks. |
| **L1** | Operator | 1 | Day-to-day operations. Can view and create records within assigned modules. |

## Key Principles

### 1. No Public Signup
- ❌ Users **cannot** register themselves
- ✅ Only **L3 (Manager)** can create new user accounts
- ✅ L3 provides credentials directly to new users
- ✅ L3 can reset passwords for any user

### 2. Permission Inheritance + Granular Overrides (v0.4.0)
- L3 has **ALL permissions always** (cannot be restricted)
- L2 and L1 start with role defaults
- L3 can grant or restrict specific permissions per user via **Grant Access Modal**
- Overrides are stored in `user_permissions` table with `override_mode = 'full_control'`
- The `get_effective_permissions()` PostgreSQL function merges role defaults with user-specific overrides

### 3. Server-Side Validation
- All role checks happen on the backend
- Frontend role checks are for UX only (hiding buttons, navigation)
- API endpoints validate permissions before processing

## File Structure

```
src/auth/
├── index.ts                    # Module exports
├── context/
│   └── AuthContext.tsx         # React context for global auth state
├── services/
│   ├── authService.ts          # Authentication operations
│   ├── userService.ts          # User management (L3 only)
│   └── permissionService.ts    # DB-backed granular RBAC engine (v0.4.0)
├── components/
│   ├── ProtectedRoute.tsx      # Role-based route protection
│   ├── RoleBadge.tsx           # Role display component
│   └── GrantAccessModal.tsx    # Granular permission editor (v0.4.0)
├── login/
│   └── LoginPage.tsx           # Enterprise login (no signup)
└── users/
    └── UserManagement.tsx      # User CRUD + permission management
```

## Database Schema

### Tables

#### `profiles`
Extends Supabase `auth.users` with role information.

| Column | Type | Description |
|--------|------|-------------|
| id | uuid | FK to auth.users(id) |
| email | varchar | User email |
| full_name | varchar | Display name |
| role | varchar | L1, L2, or L3 |
| is_active | boolean | Whether user can login |
| created_by | uuid | ID of L3 who created this user |
| created_at | timestamp | Account creation time |
| last_login_at | timestamp | Last successful login |

#### `roles`
Reference table for role definitions.

| Column | Type | Description |
|--------|------|-------------|
| id | varchar | L1, L2, L3 |
| name | varchar | Display name |
| description | text | Role description |
| level | integer | Hierarchy level (1-3) |

#### `permissions`
Granular permission matrix per role.

| Column | Type | Description |
|--------|------|-------------|
| role_id | varchar | FK to roles(id) |
| module | varchar | Feature module name |
| action | varchar | view, create, edit, delete, approve, export |
| is_allowed | boolean | Permission granted? |

#### `audit_log`
Tracks all security-relevant actions.

| Column | Type | Description |
|--------|------|-------------|
| user_id | uuid | Who performed the action |
| action | varchar | LOGIN, LOGOUT, CREATE_USER, etc. |
| target_type | varchar | What was affected |
| target_id | varchar | ID of affected resource |
| old_value | jsonb | Previous state |
| new_value | jsonb | New state |
| created_at | timestamp | When it happened |

#### `user_permissions` (v0.4.0)
Granular per-user permission overrides.

| Column | Type | Description |
|--------|------|-------------|
| user_id | uuid | FK to profiles(id) |
| module_name | varchar | FK to module_registry(module_key) |
| can_view | boolean | View permission |
| can_create | boolean | Create permission |
| can_edit | boolean | Edit permission |
| can_delete | boolean | Delete permission |
| override_mode | varchar | 'grant' or 'full_control' |
| overridden_by | uuid | L3 user who set the override |

#### `system_settings` (v0.4.0)
Feature flags for RBAC rollout.

| Column | Type | Description |
|--------|------|-------------|
| key | varchar | Setting key (e.g., `permission_source`) |
| value | jsonb | Setting value (e.g., `"db_only"`) |

#### `module_registry` (v0.4.0)
Registry of all WMS modules for RBAC.

| Column | Type | Description |
|--------|------|-------------|
| module_key | varchar | Module identifier (e.g., `items`, `stock-movements`) |
| display_name | varchar | Human-readable name |
| parent_module | varchar | Parent for submodules (null for top-level) |
| is_active | boolean | Whether module is active |

## API Endpoints

### Authentication

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/auth/me` | Required | Get current user profile |
| GET | `/auth/permissions` | Required | Get user's permissions |

### User Management (L3 Only)

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | `/users` | L3 | List all users |
| POST | `/users/create` | L3 | Create new user |
| POST | `/users/reset-password` | L3 | Reset user password |
| DELETE | `/users/:id` | L3 | Delete user |

## Permission Matrix

### Dashboard Module
| Role | View | Export |
|------|------|--------|
| L3 | ✅ | ✅ |
| L2 | ✅ | ✅ |
| L1 | ✅ | ❌ |

### Item Master Module
| Role | View | Create | Edit | Delete |
|------|------|--------|------|--------|
| L3 | ✅ | ✅ | ✅ | ✅ |
| L2 | ✅ | ✅ | ✅ | ❌ |
| L1 | ✅ | ❌ | ❌ | ❌ |

### Inventory Module
| Role | View | Adjust |
|------|------|--------|
| L3 | ✅ | ✅ |
| L2 | ✅ | ✅ |
| L1 | ✅ | ✅ |

### Blanket Orders Module
| Role | View | Create | Edit | Delete |
|------|------|--------|------|--------|
| L3 | ✅ | ✅ | ✅ | ✅ |
| L2 | ✅ | ✅ | ✅ | ❌ |
| L1 | ✅ | ❌ | ❌ | ❌ |

### Releases Module
| Role | View | Create | Edit | Approve |
|------|------|--------|------|---------|
| L3 | ✅ | ✅ | ✅ | ✅ |
| L2 | ✅ | ✅ | ✅ | ✅ |
| L1 | ✅ | ✅ | ❌ | ❌ |

### Forecasting & Planning
| Role | View | Run | Approve |
|------|------|-----|---------|
| L3 | ✅ | ✅ | ✅ |
| L2 | ✅ | ✅ | ❌ |
| L1 | ✅ | ❌ | ❌ |

### User Management
| Role | View | Create | Edit | Delete |
|------|------|--------|------|--------|
| L3 | ✅ | ✅ | ✅ | ✅ |
| L2 | ❌ | ❌ | ❌ | ❌ |
| L1 | ❌ | ❌ | ❌ | ❌ |

> **Note (v0.4.0):** The above matrices represent **role defaults**. L3 managers can override any individual permission for L1/L2 users via the Grant Access Modal. See [`DB_RBAC_REFERENCE.md`](DB_RBAC_REFERENCE.md) for full details.

## Granular Permissions (v0.4.0)

### Permission Keys

Permissions follow the pattern `module.action`:

| Module | Keys |
|--------|------|
| Item Master | `items.view`, `items.create`, `items.edit`, `items.delete` |
| Stock Movements | `stock-movements.view`, `.create`, `.edit`, `.delete` |
| Packing Details | `packing.packing-details.view`, `.create`, `.edit`, `.delete` |
| Packing Sticker | `packing.sticker-generation.view`, `.create`, `.edit` |
| Inventory | `inventory.view`, `inventory.create`, `inventory.edit` |
| Dashboard | `dashboard.view` |
| Orders | `orders.view`, `orders.create`, `orders.edit`, `orders.delete` |
| Releases | `releases.view`, `releases.create`, `releases.edit`, `releases.delete` |
| Forecasting | `forecast.view`, `forecast.create`, `forecast.edit` |
| MRP Planning | `planning.view`, `planning.create`, `planning.edit` |
| User Management | `users.view`, `users.create`, `users.edit`, `users.delete` |

### Permission Flow

```
App.tsx → getUserPermissions(userId)
  → permissionService.ts checks in-memory cache (60s TTL)
  → If miss: reads system_settings.permission_source (cached 5 min)
  → Calls RPC: get_effective_permissions(p_user_id)
  → Returns flat PermissionMap: { 'items.view': true, 'items.create': false, ... }
  → Components check: userPerms['module.action'] === true
```

### Performance

- Profile + permissions loaded **in parallel** via `Promise.allSettled()`
- Permission source cached for **5 minutes** (rarely changes)
- User permissions cached for **60 seconds** (avoids redundant DB calls)
- Cache invalidated on permission save via `invalidateUserPermCache()`

## Usage Examples

### Frontend: Using Auth Context

```tsx
import { getUserPermissions } from '../auth/services/permissionService';

function MyComponent({ userRole, userPerms }) {
  // Granular RBAC check (v0.4.0)
  const hasPerms = Object.keys(userPerms).length > 0;
  const canCreate = userRole === 'L3' || (hasPerms ? userPerms['items.create'] === true : false);
  const canEdit = userRole === 'L3' || (hasPerms ? userPerms['items.edit'] === true : userRole === 'L2');

  return (
    <div>
      {canCreate && <button>Create Item</button>}
      {canEdit && <button>Edit Item</button>}
    </div>
  );
}
```

### Frontend: Protected Routes

```tsx
import { ProtectedRoute } from '../auth';

function AdminPage() {
  const { user } = useAuth();

  return (
    <ProtectedRoute userRole={user.role} requiredRole="L3">
      <UserManagement currentUserId={user.id} />
    </ProtectedRoute>
  );
}
```

### Backend: Role Middleware

```typescript
// Protect route with authentication
app.get('/api/items', requireAuth, async (c) => { ... });

// Protect route with L3 role requirement
app.post('/api/users/create', requireAuth, requireL3, async (c) => { ... });
```

## Security Considerations

1. **Password Hashing**: Supabase Auth handles bcrypt hashing automatically
2. **JWT Tokens**: Temporary tokens with expiration, verified on each request
3. **Server-Side Validation**: All role checks are duplicated on backend
4. **Audit Trail**: All sensitive operations are logged
5. **Account Deactivation**: Deactivated users cannot login even with valid tokens
6. **Self-Protection**: Users cannot delete/deactivate their own account

## Initial Setup

### 1. Deploy Database Schema

Execute in Supabase SQL Editor:
```sql
-- First run supabasesetup.sql
-- Then run rbac.sql
```

### 2. Create First L3 Admin

After deploying the schema, create the first admin user:

1. In Supabase Dashboard → Authentication → Users → Add User
2. Enter email and password
3. Then run SQL:

```sql
UPDATE public.profiles
SET role = 'L3', is_active = true
WHERE email = 'admin@yourcompany.com';
```

### 3. Login and Create More Users

Now the L3 admin can login and use the User Management interface to create additional users.

## Migration from Old Auth

To migrate from the old auth system:

1. ✅ Deploy new database tables (`profiles`, `permissions`, `audit_log`)
2. ✅ Update backend with new user management endpoints
3. ✅ Replace frontend `LoginPage` with new version (no signup tabs)
4. ✅ Remove old auth files: `AuthDebug.tsx`, `AuthDebugPanel.tsx`
5. ✅ Update `App.tsx` to use new auth context
6. ✅ Remove `signUpWithEmail` from auth utilities
7. ✅ Deploy granular RBAC tables (`user_permissions`, `module_registry`, `system_settings`)
8. ✅ Set `permission_source = 'db_only'` in `system_settings`
9. ✅ Replace hardcoded role checks with `userPerms['module.action']` pattern
10. ✅ Add in-memory permission caching (60s TTL) for performance
