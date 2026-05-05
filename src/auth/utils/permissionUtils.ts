/**
 * Centralized Permission Access Utility
 *
 * Location: src/auth/utils/permissionUtils.ts
 *
 * Single source of truth for permission checks across the entire application.
 * Replaces scattered inline permission logic in components.
 *
 * Usage:
 *   const { canCreate, canEdit, canDelete } = resolvePermissions('items', userRole, userPerms);
 *   if (canAccess('items', 'create', userRole, userPerms)) { ... }
 */

import type { PermissionMap } from '../components/GrantAccessModal';

type UserRole = 'L1' | 'L2' | 'L3' | null;

/** Per-action permission flags for a module */
export interface ModulePermissions {
    canView: boolean;
    canCreate: boolean;
    canEdit: boolean;
    canDelete: boolean;
}

// ============================================================================
// VIEW → PERMISSION KEY MAPPING
// ============================================================================

/**
 * Maps every frontend view ID to its corresponding permission key
 * in the user_permissions / module_registry system.
 *
 * This is the SINGLE SOURCE OF TRUTH for view ↔ permission mapping.
 */
export const VIEW_PERMISSION_MAP: Record<string, string> = {
    'dashboard':                'dashboard.view',
    'items':                    'items.view',
    'inventory':                'inventory.view',
    'stock-movements':          'stock-movements.view',
    'rack-view':                'rack-view.view',
    'rack-view-v2':             'inbound-receiving.view',
    // Packing submodules
    'packing':                  'packing.sticker-generation.view',
    'packing-sticker':          'packing.sticker-generation.view',
    'packing-details':          'packing.packing-details.view',
    'packing-list-invoice':     'packing.list-invoice.view',
    'packing-list-sub-invoice': 'packing.list-sub-invoice.view',
    'pe-pallet-dashboard':      'packing.pallet-dashboard.view',
    'pe-contract-configs':      'packing.contract-configs.view',
    'pe-traceability':          'packing.traceability.view',
    // Dispatch submodules (kept under packing.* DB prefix)
    'pe-dispatch':              'packing.dispatch.view',
    'pe-mpl-home':              'packing.mpl-home.view',
    'pe-performa-invoice':      'packing.performa-invoice.view',
    // Blanket Order & Release (BPA) — replaces legacy `orders` + `releases`
    'bpa':                      'bpa.agreements.view',
    'releases-v2':              'bpa.releases.view',
    'tariff-queue':             'bpa.tariff-queue.view',
    // Legacy modules (still routable but no longer in the menu).
    // Kept here so direct deep-links don't 403; resolves to the BPA equivalents.
    'orders':                   'bpa.agreements.view',
    'releases':                 'bpa.releases.view',
    'forecast':                 'forecast.view',
    'planning':                 'planning.view',
    'users':                    'users.view',
};

// ============================================================================
// CORE PERMISSION CHECKS
// ============================================================================

/**
 * Check if the current user can access a specific view.
 *
 * Rules:
 *   - L3 always has full access
 *   - If no permissions are loaded yet (empty map), DENY access (safe default)
 *   - Otherwise check the specific permission key
 *
 * @param view - The view ID (e.g., 'items', 'pe-dispatch')
 * @param userRole - The user's role (L1/L2/L3)
 * @param userPerms - The loaded permission map
 */
export function canAccessView(
    view: string,
    userRole: UserRole,
    userPerms: PermissionMap
): boolean {
    // L3 always has full access
    if (userRole === 'L3') return true;

    // User Management is L3-only, period
    if (view === 'users') return false;

    // Dashboard is always accessible to all authenticated users
    if (view === 'dashboard') return true;

    const permKeys = Object.keys(userPerms);

    // If no permissions have been loaded at all — DENY
    // This prevents silently granting full access on DB failures
    if (permKeys.length === 0) return false;

    const permKey = VIEW_PERMISSION_MAP[view];
    if (!permKey) return true; // Unknown view → allow (don't block on unmapped views)

    return userPerms[permKey] === true;
}

/**
 * Check if a user can perform a specific action on a module.
 *
 * @param module - Module key (e.g., 'items', 'packing.dispatch', 'stock-movements')
 * @param action - Action type ('view' | 'create' | 'edit' | 'delete')
 * @param userRole - The user's role
 * @param userPerms - The loaded permission map
 */
export function canAccess(
    module: string,
    action: 'view' | 'create' | 'edit' | 'delete',
    userRole: UserRole,
    userPerms: PermissionMap
): boolean {
    if (userRole === 'L3') return true;

    const permKey = `${module}.${action}`;
    const permKeys = Object.keys(userPerms);

    // If no permissions loaded, deny by default (safe)
    if (permKeys.length === 0) {
        return false;
    }

    return userPerms[permKey] === true;
}

/**
 * Resolve all 4 action permissions for a module in one call.
 * Use this in components to get all CRUD flags at once.
 *
 * @example
 * const { canView, canCreate, canEdit, canDelete } = resolvePermissions('items', userRole, userPerms);
 */
export function resolvePermissions(
    module: string,
    userRole: UserRole,
    userPerms: PermissionMap
): ModulePermissions {
    return {
        canView: canAccess(module, 'view', userRole, userPerms),
        canCreate: canAccess(module, 'create', userRole, userPerms),
        canEdit: canAccess(module, 'edit', userRole, userPerms),
        canDelete: canAccess(module, 'delete', userRole, userPerms),
    };
}

/**
 * Check if ANY packing submodule has view permission.
 * Used to show/hide the Packing parent menu item.
 */
export function canAccessAnyPackingModule(userRole: UserRole, userPerms: PermissionMap): boolean {
    if (userRole === 'L3') return true;

    const packingModules = [
        'packing.sticker-generation',
        'packing.packing-details',
        'packing.list-invoice',
        'packing.list-sub-invoice',
        'packing.pallet-dashboard',
        'packing.contract-configs',
        'packing.traceability',
    ];

    return packingModules.some(mod => userPerms[`${mod}.view`] === true);
}

/**
 * Check if ANY BPA (Blanket Order & Release) submodule has view permission.
 * Used to show/hide the BPA parent menu item.
 */
export function canAccessAnyBpaModule(userRole: UserRole, userPerms: PermissionMap): boolean {
    if (userRole === 'L3') return true;

    const bpaModules = [
        'bpa.agreements',
        'bpa.releases',
        'bpa.tariff-queue',
    ];

    return bpaModules.some(mod => userPerms[`${mod}.view`] === true);
}

/**
 * Check if ANY dispatch submodule has view permission.
 * Used to show/hide the Dispatch parent menu item.
 */
export function canAccessAnyDispatchModule(userRole: UserRole, userPerms: PermissionMap): boolean {
    if (userRole === 'L3') return true;

    const dispatchModules = [
        'packing.dispatch',
        'packing.mpl-home',
        'packing.performa-invoice',
    ];

    return dispatchModules.some(mod => userPerms[`${mod}.view`] === true);
}

// ============================================================================
// ROLE DEFAULTS (used when no DB permissions are loaded)
// ============================================================================

/**
 * Get the default permission for a role + action combination.
 * This is only used as a fallback when permissions haven't loaded yet.
 */
function getRoleDefault(userRole: UserRole, action: string): boolean {
    switch (action) {
        case 'view':
            return true; // All roles can view by default
        case 'create':
            return userRole === 'L2'; // L2+ can create
        case 'edit':
            return userRole === 'L2'; // L2+ can edit
        case 'delete':
            return false; // Only explicit grants
        default:
            return false;
    }
}
