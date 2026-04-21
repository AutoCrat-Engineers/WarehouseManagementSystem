/**
 * Enterprise authentication/RBAC module exports.
 *
 * Login/logout are owned by App.tsx and the auth Edge Functions. This barrel
 * only re-exports active user, role, and permission APIs.
 */

export {
    hasMinimumRole,
    ROLE_CONFIG,
} from './services/authService';

export type {
    UserRole,
    UserProfile,
} from './services/authService';

export {
    getAllUsers,
    getUserById,
    createUser,
    updateUser,
    updateUserRole,
    updateUserStatus,
    deleteUser,
    getAuditLog,
} from './services/userService';

export type {
    CreateUserRequest,
    UpdateUserRequest,
    UserListItem,
} from './services/userService';

export {
    getUserPermissions,
    saveUserPermissions,
    getBulkUserPermissions,
    checkPermission,
    hasAnyPermission,
    hasAllPermissions,
    getPermissionCount,
    deleteUserPermissions,
    getUserOverrides,
    getBulkUserOverrides,
    invalidateUserPermCache,
    invalidatePermissionSourceCache,
    getEffectivePermissionsDetailed,
} from './services/permissionService';

export type {
    OverrideMode,
    DetailedPermissions,
    UserOverridesResult,
} from './services/permissionService';

export {
    canAccessView,
    canAccess,
    resolvePermissions,
    canAccessAnyPackingModule,
    canAccessAnyDispatchModule,
    VIEW_PERMISSION_MAP,
} from './utils/permissionUtils';

export type {
    ModulePermissions,
} from './utils/permissionUtils';

export { LoginPage } from './login/LoginPage';
export { UserManagement } from './users/UserManagement';
export { RoleBadge } from './components/RoleBadge';
export { GrantAccessModal, MODULE_CONFIG } from './components/GrantAccessModal';
export type { PermissionMap, PermissionAction, ModuleConfig, SubmoduleConfig } from './components/GrantAccessModal';
