/**
 * Permission Service — Database-Backed RBAC with Feature Flag Support
 *
 * Location: src/auth/services/permissionService.ts
 *
 * Reads/writes granular per-user permissions from the database
 * (user_permissions table + get_effective_permissions() RPC).
 *
 * Override modes per module:
 *   - 'grant'        : Additive only — effective = GREATEST(override, role_default)
 *   - 'full_control' : Override replaces role defaults entirely
 *
 * Feature flag in system_settings.permission_source determines the
 * active source:
 *   - 'localStorage'     : Legacy behaviour (read from LS)
 *   - 'db_with_fallback' : Read DB, fallback to LS on error
 *   - 'db_only'          : DB is sole source of truth
 *   - 'cleanup_done'     : LS code paths removed
 */

import { getSupabaseClient } from '../../utils/supabase/client';
import { fetchWithAuth } from '../../utils/supabase/auth';
import { getEdgeFunctionUrl } from '../../utils/supabase/info';
import type { PermissionMap } from '../components/GrantAccessModal';

const supabase = getSupabaseClient();
const STORAGE_KEY = 'wms_user_permissions';

/** Override mode for a module: 'grant' = additive, 'full_control' = replaces defaults */
export type OverrideMode = 'grant' | 'full_control';

// ============================================================================
// FEATURE FLAG
// ============================================================================

type PermissionSource = 'localStorage' | 'db_with_fallback' | 'db_only' | 'cleanup_done';

let cachedSource: PermissionSource | null = null;
let sourceFetchedAt = 0;
const SOURCE_CACHE_MS = 300_000; // re-fetch every 5 minutes (rarely changes)

async function getPermissionSource(): Promise<PermissionSource> {
    const now = Date.now();
    if (cachedSource && now - sourceFetchedAt < SOURCE_CACHE_MS) {
        return cachedSource;
    }
    try {
        const { data, error } = await supabase
            .from('system_settings')
            .select('value')
            .eq('key', 'permission_source')
            .single();

        if (error || !data) {
            console.warn('⚠️ [PermService] Could not read permission_source, defaulting to db_only');
            cachedSource = 'db_only';
            sourceFetchedAt = now;
            return 'db_only';
        }
        const raw = typeof data.value === 'string' ? data.value : JSON.stringify(data.value);
        cachedSource = raw.replace(/"/g, '') as PermissionSource;
        sourceFetchedAt = now;
        return cachedSource;
    } catch (err) {
        console.error('💥 [PermService] Error reading permission source:', err);
        return cachedSource || 'db_only';
    }
}

/** Force refresh the cached permission source (call after advancing rollout) */
export function invalidatePermissionSourceCache(): void {
    cachedSource = null;
    sourceFetchedAt = 0;
    userPermCache.clear();
}

// ============================================================================
// IN-MEMORY USER PERMISSIONS CACHE
// ============================================================================

const USER_PERM_CACHE_MS = 60_000; // 60s cache per user
const userPermCache = new Map<string, { perms: PermissionMap; fetchedAt: number }>();

/** Invalidate a specific user's cached permissions */
export function invalidateUserPermCache(userId?: string): void {
    if (userId) {
        userPermCache.delete(userId);
    } else {
        userPermCache.clear();
    }
}

// ============================================================================
// INTERNAL: localStorage helpers (legacy, used for fallback)
// ============================================================================

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

function writeStore(store: Record<string, PermissionMap>): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
        console.error('❌ Failed to write permissions to localStorage');
    }
}

function lsGetUserPermissions(userId: string): PermissionMap {
    const store = readStore();
    return store[userId] || {};
}

function lsSaveUserPermissions(
    userId: string,
    permissions: PermissionMap
): { success: boolean; error?: string; grantedCount?: number } {
    try {
        const store = readStore();
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
        return { success: true, grantedCount };
    } catch (err) {
        return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
}

// ============================================================================
// INTERNAL: Database helpers
// ============================================================================

interface EffectivePermRow {
    module_name: string;
    can_view: boolean;
    can_create: boolean;
    can_edit: boolean;
    can_delete: boolean;
    source: string; // 'role_default' | 'override' | 'full_control' | 'l3_full_access'
}

/**
 * Convert the DB effective permissions rows into a flat PermissionMap
 * that matches the frontend key format: "module.action" or "parent.submodule.action"
 *
 * All actions are written (true AND false) so the frontend knows the
 * resolved state for every module.
 */
function rowsToPermissionMap(rows: EffectivePermRow[]): PermissionMap {
    const map: PermissionMap = {};
    for (const row of rows) {
        const mod = row.module_name;
        map[`${mod}.view`] = !!row.can_view;
        map[`${mod}.create`] = !!row.can_create;
        map[`${mod}.edit`] = !!row.can_edit;
        map[`${mod}.delete`] = !!row.can_delete;
    }
    return map;
}

/**
 * Fetch the calling user's effective permissions via the
 * `perm_get_my_permissions` edge function (replaces the old
 * `get_effective_permissions` RPC).
 *
 * The userId argument is kept for API compatibility but ignored — the
 * server resolves the calling user from the JWT.  Passing a different
 * id would never have been authorized anyway under deny-by-default RBAC.
 */
async function dbGetUserPermissions(_userId: string): Promise<PermissionMap> {
    const res = await fetchWithAuth(getEdgeFunctionUrl('perm_get_my_permissions'), {
        method: 'POST',
        body: JSON.stringify({}),
    });
    const result = await res.json().catch(() => ({} as any));
    if (!res.ok) {
        const msg = result?.error ?? 'Failed to load permissions';
        console.error('❌ perm_get_my_permissions failed:', msg);
        throw new Error(msg);
    }
    const rows: EffectivePermRow[] = Array.isArray(result?.permissions) ? result.permissions : [];
    return rowsToPermissionMap(rows);
}

/**
 * Returns effective permissions PLUS which keys are from role defaults
 * and which modules are in full_control override mode.
 * Used by Grant Access modal to show role defaults with visual indicators.
 */
export interface DetailedPermissions {
    permissions: PermissionMap;
    roleDefaultKeys: Set<string>;
    /** Modules where override_mode = 'full_control' (override replaces defaults) */
    fullControlModules: Set<string>;
}

/**
 * Fetch a target user's permissions for the Grant Access modal via
 * `perm_get_user_permissions` (L3-only edge function).
 *
 * In strict deny-by-default RBAC, role defaults no longer exist — the
 * `roleDefaultKeys` set is always empty.  Modules absent from the
 * response are unchecked in the modal (denied).
 */
async function dbGetEffectiveDetailed(userId: string): Promise<DetailedPermissions> {
    const res = await fetchWithAuth(getEdgeFunctionUrl('perm_get_user_permissions'), {
        method: 'POST',
        body: JSON.stringify({ user_id: userId }),
    });
    const result = await res.json().catch(() => ({} as any));
    if (!res.ok) {
        throw new Error(result?.error ?? 'Failed to load user permissions');
    }

    const overrides: Array<{
        module_name: string;
        can_view: boolean; can_create: boolean; can_edit: boolean; can_delete: boolean;
        override_mode: 'grant' | 'full_control';
    }> = Array.isArray(result?.permissions) ? result.permissions : [];

    const permissions: PermissionMap = {};
    const fullControlModules = new Set<string>();
    // Strict deny-by-default — role defaults table is no longer consulted.
    const roleDefaultKeys = new Set<string>();

    for (const row of overrides) {
        const mod = row.module_name;
        if (row.override_mode === 'full_control') fullControlModules.add(mod);
        permissions[`${mod}.view`]   = !!row.can_view;
        permissions[`${mod}.create`] = !!row.can_create;
        permissions[`${mod}.edit`]   = !!row.can_edit;
        permissions[`${mod}.delete`] = !!row.can_delete;
    }

    return { permissions, roleDefaultKeys, fullControlModules };
}

/**
 * Get effective permissions with source details (DB-backed, feature-flag aware).
 * Used by the Grant Access modal.
 */
export async function getEffectivePermissionsDetailed(
    userId: string
): Promise<DetailedPermissions> {
    const source = await getPermissionSource();

    if (source === 'localStorage') {
        return { permissions: lsGetUserPermissions(userId), roleDefaultKeys: new Set(), fullControlModules: new Set() };
    }

    try {
        return await dbGetEffectiveDetailed(userId);
    } catch (err) {
        if (source === 'db_with_fallback') {
            return { permissions: lsGetUserPermissions(userId), roleDefaultKeys: new Set(), fullControlModules: new Set() };
        }
        throw err;
    }
}

// `permissionMapToRows` was the helper for the old direct-upsert path.
// Removed in v0.6.0 — `dbSaveUserPermissions` now reshapes the map
// inline before posting to the `perm_save_user_permissions` edge fn.

/**
 * Save user permission overrides via the `perm_save_user_permissions`
 * edge function (L3-only, server-side validation, audit-logged).
 *
 * Replaces the previous direct supabase-js upsert.  The edge function
 * is the single authority for writing user_permissions.
 */
async function dbSaveUserPermissions(
    userId: string,
    permissions: PermissionMap,
    overrideModes: Record<string, OverrideMode> = {}
): Promise<{ success: boolean; error?: string; grantedCount?: number }> {
    try {
        // Reshape the flat PermissionMap into the per-module rows the
        // edge function expects.
        const moduleMap = new Map<string, {
            module_name: string;
            can_view:    boolean;
            can_create:  boolean;
            can_edit:    boolean;
            can_delete:  boolean;
            override_mode: OverrideMode;
        }>();

        for (const [key, value] of Object.entries(permissions)) {
            const lastDot = key.lastIndexOf('.');
            if (lastDot < 0) continue;
            const moduleName = key.slice(0, lastDot);
            const action     = key.slice(lastDot + 1);
            if (!['view', 'create', 'edit', 'delete'].includes(action)) continue;

            const row = moduleMap.get(moduleName) ?? {
                module_name:  moduleName,
                can_view:     false,
                can_create:   false,
                can_edit:     false,
                can_delete:   false,
                override_mode: overrideModes[moduleName] ?? 'grant',
            };
            (row as any)[`can_${action}`] = !!value;
            moduleMap.set(moduleName, row);
        }

        const payload = {
            user_id:     userId,
            permissions: Array.from(moduleMap.values()),
        };

        const res = await fetchWithAuth(getEdgeFunctionUrl('perm_save_user_permissions'), {
            method: 'POST',
            body:   JSON.stringify(payload),
        });
        const result = await res.json().catch(() => ({} as any));

        if (!res.ok || !result?.success) {
            return { success: false, error: result?.error ?? 'Failed to save permissions' };
        }

        const grantedCount = Object.values(permissions).filter(Boolean).length;
        console.log(`✓ DB permissions saved via edge fn for user ${userId}: ${grantedCount} granted, ${result.revoked ?? 0} revoked`);
        return { success: true, grantedCount };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('💥 perm_save_user_permissions failed:', err);
        return { success: false, error: errorMsg };
    }
}

// ============================================================================
// PUBLIC API — Feature-flag-aware
// ============================================================================

/**
 * Get all effective permissions for a specific user.
 * Returns a PermissionMap where keys are permission strings and values are boolean.
 */
export async function getUserPermissions(userId: string): Promise<PermissionMap> {
    // Check in-memory cache first (avoids redundant DB calls within same session)
    const cached = userPermCache.get(userId);
    if (cached && Date.now() - cached.fetchedAt < USER_PERM_CACHE_MS) {
        return cached.perms;
    }

    const source = await getPermissionSource();
    let result: PermissionMap;

    console.log(`[PermService] Loading permissions for ${userId} (source: ${source})`);

    switch (source) {
        case 'localStorage': {
            result = lsGetUserPermissions(userId);
            break;
        }
        case 'db_with_fallback':
            try {
                result = await dbGetUserPermissions(userId);
            } catch (err) {
                console.warn('⚠️ [PermService] DB fetch failed, falling back to localStorage:', err);
                result = lsGetUserPermissions(userId);
            }
            break;
        case 'db_only':
        case 'cleanup_done':
            try {
                result = await dbGetUserPermissions(userId);
            } catch (err) {
                console.error('❌ [PermService] DB fetch failed in db_only mode:', err);
                // Return empty map — callers should handle this safely
                result = {};
            }
            break;
        default:
            try {
                result = await dbGetUserPermissions(userId);
            } catch {
                result = {};
            }
    }

    const permCount = Object.keys(result).length;
    const grantedCount = Object.values(result).filter(Boolean).length;
    console.log(`[PermService] Loaded ${permCount} permission keys (${grantedCount} granted) for ${userId}`);

    // Cache the result
    userPermCache.set(userId, { perms: result, fetchedAt: Date.now() });
    return result;
}

/**
 * Get permissions for multiple users in one call.
 * Returns a map of userId → PermissionMap.
 */
export async function getBulkUserPermissions(
    userIds: string[]
): Promise<Record<string, PermissionMap>> {
    const source = await getPermissionSource();

    if (source === 'localStorage') {
        const store = readStore();
        const result: Record<string, PermissionMap> = {};
        userIds.forEach(uid => {
            if (store[uid]) result[uid] = store[uid];
        });
        return result;
    }

    // For DB modes, fetch each user's effective permissions
    const result: Record<string, PermissionMap> = {};
    await Promise.all(
        userIds.map(async (uid) => {
            try {
                result[uid] = await dbGetUserPermissions(uid);
            } catch (err) {
                console.warn(`⚠️ Failed to fetch permissions for ${uid}:`, err);
                if (source === 'db_with_fallback') {
                    result[uid] = lsGetUserPermissions(uid);
                }
            }
        })
    );
    return result;
}

// ============================================================================
// USER OVERRIDES ONLY (for Grant Access Modal — NOT effective permissions)
// ============================================================================

/** Result of reading user overrides including override mode */
export interface UserOverridesResult {
    permissions: PermissionMap;
    overrideModes: Record<string, OverrideMode>;
}

/**
 * Read ONLY explicit user overrides from user_permissions table.
 * Does NOT include role defaults. Used by Grant Access modal so admins
 * can see what they've explicitly set vs what comes from the role.
 * Also returns the override_mode per module.
 */
async function dbGetUserOverrides(userId: string): Promise<UserOverridesResult> {
    const { data, error } = await supabase
        .from('user_permissions')
        .select('module_name, can_view, can_create, can_edit, can_delete, override_mode')
        .eq('user_id', userId);

    if (error) {
        console.error('❌ Failed to fetch user overrides:', error.message);
        throw error;
    }

    const map: PermissionMap = {};
    const modes: Record<string, OverrideMode> = {};
    for (const row of (data || [])) {
        const mod = row.module_name;
        const mode = (row.override_mode || 'grant') as OverrideMode;
        modes[mod] = mode;

        // In full_control mode, write ALL values (including false)
        // so the modal knows what L3 explicitly set
        if (mode === 'full_control') {
            map[`${mod}.view`] = !!row.can_view;
            map[`${mod}.create`] = !!row.can_create;
            map[`${mod}.edit`] = !!row.can_edit;
            map[`${mod}.delete`] = !!row.can_delete;
        } else {
            // grant mode: only write true values
            if (row.can_view) map[`${mod}.view`] = true;
            if (row.can_create) map[`${mod}.create`] = true;
            if (row.can_edit) map[`${mod}.edit`] = true;
            if (row.can_delete) map[`${mod}.delete`] = true;
        }
    }
    return { permissions: map, overrideModes: modes };
}

/**
 * Get ONLY explicit user overrides (not role defaults).
 * Used by Grant Access modal.
 * Returns both the permission map and the override modes.
 */
export async function getUserOverrides(userId: string): Promise<UserOverridesResult> {
    const source = await getPermissionSource();

    switch (source) {
        case 'localStorage':
            return { permissions: lsGetUserPermissions(userId), overrideModes: {} };

        case 'db_with_fallback':
            try {
                return await dbGetUserOverrides(userId);
            } catch {
                return { permissions: lsGetUserPermissions(userId), overrideModes: {} };
            }

        case 'db_only':
        case 'cleanup_done':
            return await dbGetUserOverrides(userId);

        default:
            return { permissions: lsGetUserPermissions(userId), overrideModes: {} };
    }
}

/**
 * Get overrides for multiple users (for permission count badges).
 */
export async function getBulkUserOverrides(
    userIds: string[]
): Promise<Record<string, PermissionMap>> {
    const source = await getPermissionSource();

    if (source === 'localStorage') {
        const store = readStore();
        const result: Record<string, PermissionMap> = {};
        userIds.forEach(uid => {
            if (store[uid]) result[uid] = store[uid];
        });
        return result;
    }

    const result: Record<string, PermissionMap> = {};
    await Promise.all(
        userIds.map(async (uid) => {
            try {
                const overrides = await dbGetUserOverrides(uid);
                result[uid] = overrides.permissions;
            } catch {
                if (source === 'db_with_fallback') {
                    result[uid] = lsGetUserPermissions(uid);
                }
            }
        })
    );
    return result;
}

// ============================================================================
// SAVE PERMISSIONS
// ============================================================================

/**
 * Save permissions for a user.
 * Writes to the appropriate backend based on the feature flag.
 * @param overrideModes - per-module override mode ('grant' or 'full_control')
 */
export async function saveUserPermissions(
    userId: string,
    permissions: PermissionMap,
    overrideModes: Record<string, OverrideMode> = {}
): Promise<{ success: boolean; error?: string; grantedCount?: number }> {
    const source = await getPermissionSource();

    switch (source) {
        case 'localStorage':
            return lsSaveUserPermissions(userId, permissions);

        case 'db_with_fallback':
            // Write to BOTH to keep them in sync during transition
            lsSaveUserPermissions(userId, permissions);
            return await dbSaveUserPermissions(userId, permissions, overrideModes);

        case 'db_only':
        case 'cleanup_done':
            return await dbSaveUserPermissions(userId, permissions, overrideModes);

        default:
            return lsSaveUserPermissions(userId, permissions);
    }
}

// ============================================================================
// CHECK PERMISSION (for runtime use in components)
// ============================================================================

/**
 * Check if a specific user has a specific permission.
 * Uses the in-memory cache from getUserPermissions (DB-aware).
 * Falls back to cached data if available, otherwise returns false.
 */
export function checkPermission(userId: string, permission: string): boolean {
    // Use the in-memory cache (populated by getUserPermissions)
    const cached = userPermCache.get(userId);
    if (cached) {
        return cached.perms[permission] === true;
    }
    // No cache available — return false (safe default)
    // Caller should use async getUserPermissions first
    return false;
}

/**
 * Check if a user has ANY of the given permissions.
 * Uses the in-memory cache (DB-aware).
 */
export function hasAnyPermission(userId: string, permissions: string[]): boolean {
    const cached = userPermCache.get(userId);
    if (cached) {
        return permissions.some(p => cached.perms[p] === true);
    }
    return false;
}

/**
 * Check if a user has ALL of the given permissions.
 * Uses the in-memory cache (DB-aware).
 */
export function hasAllPermissions(userId: string, permissions: string[]): boolean {
    const cached = userPermCache.get(userId);
    if (cached) {
        return permissions.every(p => cached.perms[p] === true);
    }
    return false;
}

/**
 * Get permission count for a user.
 */
export async function getPermissionCount(userId: string): Promise<number> {
    const perms = await getUserPermissions(userId);
    return Object.values(perms).filter(Boolean).length;
}

/**
 * Delete all permissions for a user (e.g., when user is deleted).
 */
export async function deleteUserPermissions(userId: string): Promise<void> {
    const source = await getPermissionSource();

    // Always clean localStorage
    const store = readStore();
    delete store[userId];
    writeStore(store);

    // Also clean DB if applicable
    if (source !== 'localStorage') {
        try {
            await supabase
                .from('user_permissions')
                .delete()
                .eq('user_id', userId);
        } catch (err) {
            console.error('❌ Failed to delete DB permissions for user:', err);
        }
    }
}
