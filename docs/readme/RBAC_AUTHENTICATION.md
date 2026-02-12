# Enterprise RBAC Authentication System

## Overview

This document describes the Role-Based Access Control (RBAC) system implemented for the Supply Chain Management System. The system follows enterprise security standards (ABB/GE Healthcare level) with a three-tier role hierarchy and **NO public signup**.

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

### 2. Permission Inheritance
- L3 has all permissions of L2 and L1, plus admin capabilities
- L2 has all permissions of L1, plus oversight capabilities
- Each higher level inherits lower level permissions

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
│   └── userService.ts          # User management (L3 only)
├── components/
│   ├── ProtectedRoute.tsx      # Role-based route protection
│   └── RoleBadge.tsx           # Role display component
├── login/
│   └── LoginPage.tsx           # Enterprise login (no signup)
└── users/
    └── UserManagement.tsx      # User CRUD (L3 only)
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

## Usage Examples

### Frontend: Using Auth Context

```tsx
import { useAuth, ProtectedRoute, RoleBadge } from '../auth';

function MyComponent() {
  const { user, isL3, hasRole, logout } = useAuth();

  return (
    <div>
      <p>Welcome, {user?.full_name}</p>
      <RoleBadge role={user.role} />
      
      {/* Only show to L3 */}
      {isL3 && <AdminPanel />}
      
      {/* Only show to L2 or above */}
      {hasRole('L2') && <ApprovalButton />}
      
      <button onClick={logout}>Sign Out</button>
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
