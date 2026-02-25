# 04 — Authentication & RBAC Architecture

> Enterprise Role-Based Access Control — the complete authentication lifecycle.

---

## 4.1 Authentication Model

The WMS uses a **zero-public-signup, manager-provisioned** authentication model:

- ❌ No self-registration
- ❌ No public sign-up endpoint
- ✅ Only L3 (Manager) users can create new accounts
- ✅ JWT-based session management via Supabase Auth

---

## 4.2 Role Hierarchy

```mermaid
graph TD
    L3["🏢 L3 — Manager<br/>Level 3<br/>Full System Access"]
    L2["👷 L2 — Supervisor<br/>Level 2<br/>Operations Oversight"]
    L1["🔧 L1 — Operator<br/>Level 1<br/>Day-to-Day Operations"]

    L3 -->|inherits| L2
    L2 -->|inherits| L1

    style L3 fill:#dc2626,stroke:#b91c1c,color:#fff
    style L2 fill:#f59e0b,stroke:#d97706,color:#fff
    style L1 fill:#10b981,stroke:#059669,color:#fff
```

### Role Configuration

```typescript
export const ROLE_CONFIG = {
    L3: {
        name: 'Manager',
        level: 3,
        description: 'Full access including user management',
        badge: 'Manager'
    },
    L2: {
        name: 'Supervisor',
        level: 2,
        description: 'Operations oversight and approval',
        badge: 'Supervisor'
    },
    L1: {
        name: 'Operator',
        level: 1,
        description: 'Day-to-day warehouse operations',
        badge: 'Operator'
    }
};
```

---

## 4.3 Permission Matrix

| Module | L1 (Operator) | L2 (Supervisor) | L3 (Manager) |
|--------|:---:|:---:|:---:|
| **Dashboard** | ✅ View | ✅ View | ✅ View |
| **Item Master** | ✅ View | ✅ View + Edit | ✅ Full CRUD |
| **Inventory Grid** | ✅ View | ✅ View | ✅ View |
| **Stock Movement** | ❌ | ✅ View + Create | ✅ Full Access |
| **Blanket Orders** | ✅ View | ✅ View + Edit | ✅ Full CRUD |
| **Blanket Releases** | ✅ View | ✅ View + Edit | ✅ Full CRUD |
| **Forecasting** | ✅ View | ✅ View + Run | ✅ Full Access |
| **MRP Planning** | ✅ View | ✅ View + Run | ✅ Full Access |
| **User Management** | ❌ | ❌ | ✅ Full CRUD |

---

## 4.4 Authentication Flow

```mermaid
sequenceDiagram
    participant U as User
    participant LP as LoginPage
    participant AS as authService
    participant SB as Supabase Auth
    participant DB as PostgreSQL
    participant AC as AuthContext

    U->>LP: Enter email + password
    LP->>AS: signIn(email, password)
    AS->>SB: supabase.auth.signInWithPassword()
    SB->>SB: Validate credentials
    SB-->>AS: { session, user }

    alt Auth Success
        AS->>DB: SELECT * FROM profiles WHERE id = user.id
        DB-->>AS: { role, full_name, is_active, ... }

        alt Account Active
            AS-->>LP: AuthResult { success: true, session }
            LP->>AC: Update AuthContext state
            AC->>AC: Store session, role, profile
            AC-->>U: Redirect to Dashboard
        else Account Deactivated
            AS-->>LP: AuthResult { success: false, error: "Account deactivated" }
            LP-->>U: Show error message
        end
    else Auth Failure
        SB-->>AS: { error }
        AS-->>LP: AuthResult { success: false, error }
        LP-->>U: Show error message
    end
```

---

## 4.5 Session Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Unauthenticated: App loads

    Unauthenticated --> Authenticating: User submits login
    Authenticating --> Authenticated: Credentials valid
    Authenticating --> Unauthenticated: Credentials invalid

    Authenticated --> TokenRefresh: Token near expiry
    TokenRefresh --> Authenticated: Refresh success
    TokenRefresh --> Unauthenticated: Refresh failed

    Authenticated --> Unauthenticated: User logs out
    Authenticated --> Unauthenticated: Session expired

    state Authenticated {
        [*] --> FetchProfile
        FetchProfile --> RoleResolved
        RoleResolved --> ActiveSession
        ActiveSession --> [*]
    }
```

### Token Management

| Aspect | Implementation |
|--------|---------------|
| **Token Storage** | In-memory (React state) — not localStorage |
| **Token Refresh** | `refreshToken()` via Supabase SDK |
| **Token Injection** | Every API call includes `Authorization: Bearer <token>` |
| **Session Check** | `getCurrentSession()` on app mount |
| **Auth Listener** | `onAuthStateChange()` subscription for session events |

---

## 4.6 Auth Module File Structure

```
src/auth/
├── index.ts                    ← Barrel exports (centralised API)
├── context/
│   └── AuthContext.tsx          ← React Context provider + useAuth hook
├── services/
│   ├── authService.ts           ← Sign-in, sign-out, token, permissions
│   └── userService.ts           ← User CRUD, role updates (L3 only)
├── components/
│   ├── ProtectedRoute.tsx       ← HOC + hook for role-based route guarding
│   └── RoleBadge.tsx            ← Visual role indicator component
├── login/
│   └── LoginPage.tsx            ← Enterprise login UI with branding
└── users/
    └── UserManagement.tsx       ← Admin panel for user provisioning
```

---

## 4.7 Database Auth Tables

```mermaid
erDiagram
    AUTH_USERS ||--|| PROFILES : "1:1"
    PROFILES ||--o{ USER_ROLES : "has"
    PROFILES ||--o{ TEMP_CREDENTIALS : "receives"
    PROFILES ||--o{ AUDIT_LOGS : "generates"
    ROLES ||--o{ PERMISSIONS : "has"
    ROLES ||--o{ USER_ROLES : "assigned to"

    PROFILES {
        uuid id PK
        varchar employee_id UK
        varchar email UK
        varchar full_name
        varchar role "L1/L2/L3"
        boolean is_active
        boolean must_change_password
        varchar department
        varchar shift
        timestamp last_login_at
    }

    ROLES {
        varchar id PK
        varchar name
        text description
        integer level
    }

    PERMISSIONS {
        uuid id PK
        varchar role_id FK
        varchar module
        varchar action
        boolean is_allowed
    }

    TEMP_CREDENTIALS {
        uuid id PK
        uuid user_id FK
        text temp_password_hash
        timestamp expires_at
        boolean is_used
    }

    AUDIT_LOGS {
        uuid id PK
        uuid user_id FK
        varchar action
        varchar table_name
        jsonb old_values
        jsonb new_values
        boolean success
    }
```

---

## 4.8 Security Functions

| Function | Source | Purpose |
|----------|--------|---------|
| `signIn()` | `authService.ts` | Authenticate user, fetch profile, build session |
| `signOut()` | `authService.ts` | Invalidate session, clear state |
| `getCurrentSession()` | `authService.ts` | Reconstruct session from Supabase SDK |
| `getAccessToken()` | `authService.ts` | Extract current JWT |
| `refreshToken()` | `authService.ts` | Refresh expired JWT |
| `getUserPermissions()` | `authService.ts` | Query permissions table for current user |
| `hasPermission()` | `authService.ts` | Check module + action permission |
| `hasMinimumRole()` | `authService.ts` | Compare role levels (L1 < L2 < L3) |
| `logAuditEvent()` | `authService.ts` | Write to audit_log table |
| `onAuthStateChange()` | `authService.ts` | Subscribe to session events |

---

**← Previous**: [03-FRONTEND-ARCHITECTURE.md](./03-FRONTEND-ARCHITECTURE.md) | **Next**: [05-SERVICE-LAYER.md](./05-SERVICE-LAYER.md) →

---

© 2026 AutoCrat Engineers. All rights reserved.
