/**
 * Enterprise Authentication Module
 * 
 * Location: src/auth/index.ts
 * 
 * Centralized exports for the RBAC authentication system
 * 
 * Role Hierarchy:
 *   L3 (Manager)    - Full access, user management
 *   L2 (Supervisor) - Operations oversight
 *   L1 (Operator)   - Day-to-day operations
 */

// ============================================================================
// AUTH CONTEXT
// ============================================================================
export { AuthProvider, useAuth } from './context/AuthContext';
export type { AuthContextType } from './context/AuthContext';

// ============================================================================
// AUTH SERVICES
// ============================================================================
export {
    signIn,
    signOut,
    getCurrentSession,
    getAccessToken,
    refreshToken,
    getUserPermissions,
    hasPermission,
    hasMinimumRole,
    onAuthStateChange,
    ROLE_CONFIG,
} from './services/authService';

export type {
    UserRole,
    UserProfile,
    AuthSession,
    Permission,
    AuthResult,
} from './services/authService';

// ============================================================================
// USER MANAGEMENT SERVICES (L3 Only)
// ============================================================================
export {
    getAllUsers,
    getUserById,
    createUser,
    updateUserRole,
    updateUserStatus,
    resetUserPassword,
    getAuditLog,
} from './services/userService';

export type {
    CreateUserRequest,
    UpdateUserRequest,
    UserListItem,
} from './services/userService';

// ============================================================================
// COMPONENTS
// ============================================================================
export { LoginPage } from './login/LoginPage';
export { UserManagement } from './users/UserManagement';
export { RoleBadge } from './components/RoleBadge';
export { ProtectedRoute, useRoleAccess, withRoleAccess } from './components/ProtectedRoute';
