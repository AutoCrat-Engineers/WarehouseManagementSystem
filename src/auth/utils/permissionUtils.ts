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
 * Strict deny-by-default RBAC:
 *   - L3 always has full access (Manager).
 *   - User Management is L3-only, period.
 *   - L1 / L2 see ONLY what's explicitly granted in user_permissions.
 *     No automatic Dashboard access, no default views, nothing.
 *   - Unmapped views (no entry in VIEW_PERMISSION_MAP) are denied to
 *     prevent silent leakage of new modules.
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
    if (userRole === 'L3') return true;

    // User Management is L3-only, period.
    if (view === 'users') return false;

    const permKey = VIEW_PERMISSION_MAP[view];
    if (!permKey) return false; // Unknown view → DENY (no silent leaks)

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

// Role defaults removed in strict RBAC — every L1/L2 permission is now an
// explicit row in user_permissions.  Nothing to fall back to.
