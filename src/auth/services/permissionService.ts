/**
 * Permission Service — Frontend-Only Persistence via localStorage
 *
 * Location: src/auth/services/permissionService.ts
 *
 * Stores per-user granular permissions entirely in localStorage.
 * No database table or SQL migration required.
 *
 * Storage key: `wms_user_permissions`
 * Format: { [userId]: { [permissionKey]: boolean } }
 */

import type { PermissionMap } from '../components/GrantAccessModal';

const STORAGE_KEY = 'wms_user_permissions';

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Read the full permissions store from localStorage
 */
function readStore(): Record<string, PermissionMap> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        return JSON.parse(raw) as Record<string, PermissionMap>;
    } catch {
        console.warn('⚠️ Failed to read permissions from localStorage');
        return {};
    }
}

/**
 * Write the full permissions store to localStorage
 */
function writeStore(store: Record<string, PermissionMap>): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
        console.error('❌ Failed to write permissions to localStorage');
    }
}

// ============================================================================
// GET PERMISSIONS
// ============================================================================

/**
 * Get all granted permissions for a specific user.
 * Returns a PermissionMap where keys are permission strings and values are boolean.
 */
export function getUserPermissions(userId: string): PermissionMap {
    const store = readStore();
    return store[userId] || {};
}

/**
 * Get permissions for multiple users in one call.
 * Returns a map of userId → PermissionMap.
 */
export function getBulkUserPermissions(
    userIds: string[]
): Record<string, PermissionMap> {
    const store = readStore();
    const result: Record<string, PermissionMap> = {};
    userIds.forEach(uid => {
        if (store[uid]) {
            result[uid] = store[uid];
        }
    });
    return result;
}

// ============================================================================
// SAVE PERMISSIONS
// ============================================================================

/**
 * Save permissions for a user.
 * Overwrites all existing permissions for the user with the new set.
 */
export function saveUserPermissions(
    userId: string,
    permissions: PermissionMap
): { success: boolean; error?: string; grantedCount?: number } {
    try {
        const store = readStore();

        // Only store granted (true) permissions to keep localStorage lean
        const cleanPerms: PermissionMap = {};
        let grantedCount = 0;

        Object.entries(permissions).forEach(([key, granted]) => {
            if (granted) {
                cleanPerms[key] = true;
                grantedCount++;
            }
        });

        store[userId] = cleanPerms;
        writeStore(store);

        console.log(`✓ Permissions saved for user ${userId}: ${grantedCount} granted`);

        return {
            success: true,
            grantedCount,
        };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('💥 Save permissions error:', err);
        return { success: false, error: errorMsg };
    }
}

// ============================================================================
// CHECK PERMISSION (for runtime use in components)
// ============================================================================

/**
 * Check if a specific user has a specific permission.
 */
export function checkPermission(userId: string, permission: string): boolean {
    const perms = getUserPermissions(userId);
    return perms[permission] === true;
}

/**
 * Check if a user has ANY of the given permissions.
 */
export function hasAnyPermission(userId: string, permissions: string[]): boolean {
    const perms = getUserPermissions(userId);
    return permissions.some(p => perms[p] === true);
}

/**
 * Check if a user has ALL of the given permissions.
 */
export function hasAllPermissions(userId: string, permissions: string[]): boolean {
    const perms = getUserPermissions(userId);
    return permissions.every(p => perms[p] === true);
}

/**
 * Get permission count for a user.
 */
export function getPermissionCount(userId: string): number {
    const perms = getUserPermissions(userId);
    return Object.values(perms).filter(Boolean).length;
}

/**
 * Delete all permissions for a user (e.g., when user is deleted).
 */
export function deleteUserPermissions(userId: string): void {
    const store = readStore();
    delete store[userId];
    writeStore(store);
}
