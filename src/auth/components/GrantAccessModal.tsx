/**
 * Grant Access Modal — Granular RBAC Permission Management
 *
 * Location: src/auth/components/GrantAccessModal.tsx
 *
 * Checklist-driven UI for granting module & submodule permissions.
 * Admins can grant View / Create / Edit / Delete access per (sub)module.
 *
 * Override Modes (per module):
 *   - Grant (default): additive — overrides ADD on top of role defaults.
 *   - Full Control: override REPLACES role defaults. L3 defines exactly
 *     which permissions the user has for that module.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
    X,
    Shield,
    ShieldCheck,
    ShieldAlert,
    Eye,
    Plus,
    Pencil,
    Trash2,
    ChevronDown,
    ChevronRight,
    CheckSquare,
    Square,
    Minus,
    Save,
    RotateCcw,
    AlertTriangle,
    Info,
    LayoutDashboard,
    Package,
    Boxes,
    ArrowRightLeft,
    FileText,
    Calendar,
    TrendingUp,
    BarChart3,
    Printer,
    ClipboardList,
    List,
    FileCheck,
    FileMinus,
    Users,
    Bell,
    Lock,
    Unlock,
    ToggleLeft,
    ToggleRight,
} from 'lucide-react';
import { RoleBadge } from './RoleBadge';
import type { UserListItem } from '../services/userService';
import type { OverrideMode } from '../services/permissionService';

// ═══════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════

export type PermissionAction = 'view' | 'create' | 'edit' | 'delete';

export interface SubmoduleConfig {
    id: string;
    label: string;
    icon: React.ElementType;
    description?: string;
    /** Which actions are applicable to this submodule */
    actions: PermissionAction[];
}

export interface ModuleConfig {
    id: string;
    label: string;
    icon: React.ElementType;
    color: string;
    description: string;
    /** Which actions are applicable when there are no submodules */
    actions: PermissionAction[];
    submodules?: SubmoduleConfig[];
}

/** Permission state: module.submodule.action → boolean */
export type PermissionMap = Record<string, boolean>;

interface GrantAccessModalProps {
    user: UserListItem;
    isOpen: boolean;
    onClose: () => void;
    onSave: (userId: string, permissions: PermissionMap, overrideModes: Record<string, OverrideMode>) => void | Promise<void>;
    /** Previously saved override permissions (if any) */
    initialPermissions?: PermissionMap;
    /** Previously saved override modes per module */
    initialOverrideModes?: Record<string, OverrideMode>;
}

// ═══════════════════════════════════════════════════════════════════════
// MODULE CONFIGURATION — Single source of truth for WMS modules
// ═══════════════════════════════════════════════════════════════════════

const MODULE_CONFIG: ModuleConfig[] = [
    {
        id: 'dashboard',
        label: 'Dashboard',
        icon: LayoutDashboard,
        color: '#3b82f6',
        description: 'Overview & KPIs',
        actions: ['view'],
    },
    {
        id: 'items',
        label: 'Item Master',
        icon: Package,
        color: '#8b5cf6',
        description: 'Finished Goods Catalog',
        actions: ['view', 'create', 'edit', 'delete'],
    },
    {
        id: 'inventory',
        label: 'Inventory',
        icon: Boxes,
        color: '#06b6d4',
        description: 'Multi-Warehouse Stock',
        actions: ['view', 'create', 'edit'],
    },
    {
        id: 'stock-movements',
        label: 'Stock Movements',
        icon: ArrowRightLeft,
        color: '#f59e0b',
        description: 'Transfers & Audit Trail',
        actions: ['view', 'create', 'edit', 'delete'],
    },
    {
        id: 'packing',
        label: 'Packing',
        icon: Package,
        color: '#10b981',
        description: 'FG Packing Workflow',
        actions: ['view', 'create', 'edit', 'delete'],
        submodules: [
            {
                id: 'sticker-generation',
                label: 'Sticker Generation',
                icon: Printer,
                description: 'FG sticker printing',
                actions: ['view', 'create', 'edit'],
            },
            {
                id: 'packing-details',
                label: 'Packing Details',
                icon: ClipboardList,
                description: 'Packing specifications',
                actions: ['view', 'create', 'edit', 'delete'],
            },
            {
                id: 'packing-list-invoice',
                label: 'Packing List — Invoice',
                icon: FileCheck,
                description: 'Packing by invoice',
                actions: ['view', 'create', 'edit', 'delete'],
            },
            {
                id: 'packing-list-sub-invoice',
                label: 'Packing List — Sub Invoice',
                icon: FileMinus,
                description: 'Packing by sub invoice',
                actions: ['view', 'create', 'edit', 'delete'],
            },
        ],
    },
    {
        id: 'orders',
        label: 'Blanket Orders',
        icon: FileText,
        color: '#ec4899',
        description: 'Customer Orders',
        actions: ['view', 'create', 'edit', 'delete'],
    },
    {
        id: 'releases',
        label: 'Blanket Releases',
        icon: Calendar,
        color: '#f97316',
        description: 'Delivery Schedule',
        actions: ['view', 'create', 'edit', 'delete'],
    },
    {
        id: 'forecast',
        label: 'Forecasting',
        icon: TrendingUp,
        color: '#14b8a6',
        description: 'Demand Prediction',
        actions: ['view', 'create', 'edit'],
    },
    {
        id: 'planning',
        label: 'MRP Planning',
        icon: BarChart3,
        color: '#6366f1',
        description: 'Replenishment Planning',
        actions: ['view', 'create', 'edit'],
    },
    {
        id: 'users',
        label: 'User Management',
        icon: Users,
        color: '#7c3aed',
        description: 'Manage Users & Roles',
        actions: ['view', 'create', 'edit', 'delete'],
    },
    {
        id: 'notifications',
        label: 'Notifications',
        icon: Bell,
        color: '#64748b',
        description: 'System Notifications',
        actions: ['view'],
    },
];

// ═══════════════════════════════════════════════════════════════════════
// HELPER: Generate all possible permission keys
// ═══════════════════════════════════════════════════════════════════════

function getAllPermissionKeys(): string[] {
    const keys: string[] = [];
    for (const mod of MODULE_CONFIG) {
        if (mod.submodules && mod.submodules.length > 0) {
            for (const sub of mod.submodules) {
                for (const action of sub.actions) {
                    keys.push(`${mod.id}.${sub.id}.${action}`);
                }
            }
        } else {
            for (const action of mod.actions) {
                keys.push(`${mod.id}.${action}`);
            }
        }
    }
    return keys;
}

function getModulePermissionKeys(mod: ModuleConfig): string[] {
    const keys: string[] = [];
    if (mod.submodules && mod.submodules.length > 0) {
        for (const sub of mod.submodules) {
            for (const action of sub.actions) {
                keys.push(`${mod.id}.${sub.id}.${action}`);
            }
        }
    } else {
        for (const action of mod.actions) {
            keys.push(`${mod.id}.${action}`);
        }
    }
    return keys;
}

function getSubmodulePermissionKeys(modId: string, sub: SubmoduleConfig): string[] {
    return sub.actions.map(action => `${modId}.${sub.id}.${action}`);
}

/**
 * Get the DB module name(s) for a given module config.
 * For modules with submodules, returns all submodule DB keys.
 * For flat modules, returns just the module id.
 */
function getModuleDbKeys(mod: ModuleConfig): string[] {
    if (mod.submodules && mod.submodules.length > 0) {
        return mod.submodules.map(sub => `${mod.id}.${sub.id}`);
    }
    return [mod.id];
}

// ═══════════════════════════════════════════════════════════════════════
// ACTION META
// ═══════════════════════════════════════════════════════════════════════

const ACTION_META: Record<PermissionAction, { label: string; icon: React.ElementType; color: string; bgColor: string }> = {
    view: { label: 'View', icon: Eye, color: '#3b82f6', bgColor: '#eff6ff' },
    create: { label: 'Create', icon: Plus, color: '#10b981', bgColor: '#ecfdf5' },
    edit: { label: 'Edit', icon: Pencil, color: '#f59e0b', bgColor: '#fffbeb' },
    delete: { label: 'Delete', icon: Trash2, color: '#ef4444', bgColor: '#fef2f2' },
};

// ═══════════════════════════════════════════════════════════════════════
// COMPONENT
// ═══════════════════════════════════════════════════════════════════════

export function GrantAccessModal({
    user,
    isOpen,
    onClose,
    onSave,
    initialPermissions = {},
    initialOverrideModes = {},
}: GrantAccessModalProps) {
    // ─── Permission state ────────────────────────────────────────────
    const [permissions, setPermissions] = useState<PermissionMap>({});
    const [overrideModes, setOverrideModes] = useState<Record<string, OverrideMode>>({});
    const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
    const [hasChanges, setHasChanges] = useState(false);

    // Initialize permissions from props
    useEffect(() => {
        if (isOpen) {
            setPermissions({ ...initialPermissions });
            setOverrideModes({ ...initialOverrideModes });
            setHasChanges(false);
            // Auto-expand modules that have submodules
            const expanded = new Set<string>();
            MODULE_CONFIG.forEach(mod => {
                if (mod.submodules && mod.submodules.length > 0) {
                    expanded.add(mod.id);
                }
            });
            setExpandedModules(expanded);
        }
    }, [isOpen, initialPermissions, initialOverrideModes]);

    // ─── Override mode helpers ────────────────────────────────────────
    /**
     * Get the effective override mode for a module.
     * For submodule parents, checks if ALL submodules share the same mode.
     */
    const getModuleOverrideMode = useCallback((mod: ModuleConfig): OverrideMode => {
        const dbKeys = getModuleDbKeys(mod);
        const modes = dbKeys.map(k => overrideModes[k] || 'grant');
        // If all submodule modes are the same, return that; otherwise 'grant'
        return modes.every(m => m === 'full_control') ? 'full_control' : 'grant';
    }, [overrideModes]);

    /**
     * Toggle override mode for a module (and all its submodules).
     */
    const toggleModuleOverrideMode = useCallback((mod: ModuleConfig) => {
        const currentMode = getModuleOverrideMode(mod);
        const newMode: OverrideMode = currentMode === 'grant' ? 'full_control' : 'grant';
        const dbKeys = getModuleDbKeys(mod);

        setOverrideModes(prev => {
            const next = { ...prev };
            dbKeys.forEach(k => { next[k] = newMode; });
            return next;
        });
        setHasChanges(true);
    }, [getModuleOverrideMode]);

    // ─── Derived state ───────────────────────────────────────────────
    const allKeys = useMemo(() => getAllPermissionKeys(), []);
    const totalPermissions = allKeys.length;
    const grantedCount = useMemo(() => allKeys.filter(k => permissions[k]).length, [permissions, allKeys]);

    const isAllSelected = grantedCount === totalPermissions && totalPermissions > 0;
    const isSomeSelected = grantedCount > 0 && grantedCount < totalPermissions;

    // Count how many modules are in full_control mode
    const fullControlCount = useMemo(() => {
        return MODULE_CONFIG.filter(mod => {
            const dbKeys = getModuleDbKeys(mod);
            return dbKeys.some(k => overrideModes[k] === 'full_control');
        }).length;
    }, [overrideModes]);

    // ─── Toggle helpers ──────────────────────────────────────────────
    const togglePermission = useCallback((key: string) => {
        setPermissions(prev => {
            const next = { ...prev, [key]: !prev[key] };
            setHasChanges(true);
            return next;
        });
    }, []);

    const toggleModuleAll = useCallback((mod: ModuleConfig) => {
        const keys = getModulePermissionKeys(mod);
        const allChecked = keys.every(k => permissions[k]);
        setPermissions(prev => {
            const next = { ...prev };
            keys.forEach(k => { next[k] = !allChecked; });
            setHasChanges(true);
            return next;
        });
    }, [permissions]);

    const toggleSubmoduleAll = useCallback((modId: string, sub: SubmoduleConfig) => {
        const keys = getSubmodulePermissionKeys(modId, sub);
        const allChecked = keys.every(k => permissions[k]);
        setPermissions(prev => {
            const next = { ...prev };
            keys.forEach(k => { next[k] = !allChecked; });
            setHasChanges(true);
            return next;
        });
    }, [permissions]);

    const toggleGlobalAll = useCallback(() => {
        const allChecked = isAllSelected;
        setPermissions(prev => {
            const next = { ...prev };
            allKeys.forEach(k => { next[k] = !allChecked; });
            setHasChanges(true);
            return next;
        });
    }, [isAllSelected, allKeys]);

    const clearAll = useCallback(() => {
        setPermissions({});
        setOverrideModes({});
        setHasChanges(true);
    }, []);

    const toggleExpand = useCallback((modId: string) => {
        setExpandedModules(prev => {
            const next = new Set(prev);
            if (next.has(modId)) {
                next.delete(modId);
            } else {
                next.add(modId);
            }
            return next;
        });
    }, []);

    // ─── Module state helpers ────────────────────────────────────────
    const getModuleState = useCallback((mod: ModuleConfig): 'all' | 'some' | 'none' => {
        const keys = getModulePermissionKeys(mod);
        const checked = keys.filter(k => permissions[k]).length;
        if (checked === 0) return 'none';
        if (checked === keys.length) return 'all';
        return 'some';
    }, [permissions]);

    const getSubmoduleState = useCallback((modId: string, sub: SubmoduleConfig): 'all' | 'some' | 'none' => {
        const keys = getSubmodulePermissionKeys(modId, sub);
        const checked = keys.filter(k => permissions[k]).length;
        if (checked === 0) return 'none';
        if (checked === keys.length) return 'all';
        return 'some';
    }, [permissions]);

    const getModuleGrantedCount = useCallback((mod: ModuleConfig): number => {
        return getModulePermissionKeys(mod).filter(k => permissions[k]).length;
    }, [permissions]);

    // ─── Summary data ────────────────────────────────────────────────
    const summaryByAction = useMemo(() => {
        const result: Record<PermissionAction, number> = { view: 0, create: 0, edit: 0, delete: 0 };
        allKeys.forEach(key => {
            if (permissions[key]) {
                const parts = key.split('.');
                const action = parts[parts.length - 1] as PermissionAction;
                result[action]++;
            }
        });
        return result;
    }, [permissions, allKeys]);

    // ─── Save handler ────────────────────────────────────────────────
    const handleSave = useCallback(() => {
        // Build COMPLETE permission set covering ALL modules
        // Every module is saved with full_control mode so role defaults
        // are ignored — what L3 checks is exactly what the user gets.
        const completePerms: PermissionMap = {};
        const fullControlModes: Record<string, OverrideMode> = {};

        for (const mod of MODULE_CONFIG) {
            // Set full_control for every DB key (module or submodule)
            const dbKeys = getModuleDbKeys(mod);
            dbKeys.forEach(k => { fullControlModes[k] = 'full_control'; });

            // Set explicit true/false for every permission key
            const permKeys = getModulePermissionKeys(mod);
            permKeys.forEach(k => {
                completePerms[k] = !!permissions[k]; // unchecked = false
            });
        }


        onSave(user.id, completePerms, fullControlModes);
    }, [user.id, permissions, onSave]);

    if (!isOpen) return null;

    // ═══════════════════════════════════════════════════════════════════
    // RENDER
    // ═══════════════════════════════════════════════════════════════════

    return (
        <div
            id="grant-access-overlay"
            style={{
                position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                backdropFilter: 'blur(4px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                zIndex: 200,
                animation: 'fadeIn 0.2s ease',
            }}
            onClick={(e) => { if ((e.target as HTMLElement).id === 'grant-access-overlay') onClose(); }}
        >
            <div
                style={{
                    backgroundColor: 'white',
                    borderRadius: '20px',
                    width: '100%',
                    maxWidth: '880px',
                    maxHeight: '92vh',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    boxShadow: '0 25px 80px rgba(0, 0, 0, 0.2)',
                    animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                }}
            >
                {/* ═══════════ HEADER ═══════════ */}
                <div style={{
                    padding: '24px 28px 20px',
                    borderBottom: '1px solid #e5e7eb',
                    background: 'linear-gradient(135deg, #f8fafc 0%, #f0f4ff 100%)',
                }}>
                    {/* Title Row */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <div style={{
                                width: '42px', height: '42px', borderRadius: '12px',
                                background: 'linear-gradient(135deg, #1e3a8a, #3b82f6)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                boxShadow: '0 4px 12px rgba(30, 58, 138, 0.25)',
                            }}>
                                <ShieldCheck size={22} style={{ color: 'white' }} />
                            </div>
                            <div>
                                <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#111827', margin: 0, letterSpacing: '-0.3px' }}>
                                    Grant Access
                                </h2>
                                <p style={{ fontSize: '12px', color: '#6b7280', margin: '2px 0 0', fontWeight: '500' }}>
                                    Manage module & submodule permissions
                                </p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            style={{
                                border: 'none', background: 'rgba(107, 114, 128, 0.1)',
                                borderRadius: '10px', padding: '8px', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(107, 114, 128, 0.2)'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'rgba(107, 114, 128, 0.1)'; }}
                        >
                            <X size={18} style={{ color: '#6b7280' }} />
                        </button>
                    </div>

                    {/* User Info Card */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '14px',
                        backgroundColor: 'white', padding: '14px 16px', borderRadius: '12px',
                        border: '1px solid #e5e7eb',
                        boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04)',
                    }}>
                        <div style={{
                            width: '44px', height: '44px', borderRadius: '50%',
                            background: 'linear-gradient(135deg, #1e3a8a, #2563eb)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'white', fontSize: '18px', fontWeight: '700',
                            boxShadow: '0 2px 8px rgba(37, 99, 235, 0.2)',
                            flexShrink: 0,
                        }}>
                            {user.full_name?.charAt(0).toUpperCase() || 'U'}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '15px', fontWeight: '700', color: '#111827', letterSpacing: '-0.2px' }}>
                                {user.full_name}
                            </div>
                            <div style={{ fontSize: '12px', color: '#6b7280', display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '2px' }}>
                                <span>{user.email}</span>
                                {user.employee_id && (
                                    <>
                                        <span style={{ color: '#d1d5db' }}>•</span>
                                        <span style={{ fontWeight: '600', color: '#374151' }}>{user.employee_id}</span>
                                    </>
                                )}
                            </div>
                        </div>
                        <RoleBadge role={user.role} />
                    </div>
                </div>

                {/* ═══════════ TOOLBAR ═══════════ */}
                <div style={{
                    padding: '12px 28px',
                    borderBottom: '1px solid #f3f4f6',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    backgroundColor: '#fafbfc',
                }}>
                    {/* Global Select All */}
                    <button
                        onClick={toggleGlobalAll}
                        style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '8px 14px', border: '1px solid #e5e7eb',
                            borderRadius: '8px', backgroundColor: 'white',
                            cursor: 'pointer', fontSize: '13px', fontWeight: '600',
                            color: isAllSelected ? '#1e3a8a' : '#374151',
                            transition: 'all 0.15s',
                        }}
                        onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#93c5fd'; e.currentTarget.style.backgroundColor = '#eff6ff'; }}
                        onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#e5e7eb'; e.currentTarget.style.backgroundColor = 'white'; }}
                    >
                        {isAllSelected ? (
                            <CheckSquare size={16} style={{ color: '#1e3a8a' }} />
                        ) : isSomeSelected ? (
                            <div style={{ width: '16px', height: '16px', borderRadius: '3px', border: '2px solid #6b7280', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <Minus size={10} style={{ color: '#6b7280' }} />
                            </div>
                        ) : (
                            <Square size={16} style={{ color: '#9ca3af' }} />
                        )}
                        Select All Permissions
                    </button>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>

                        {/* Action Legends */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            {(['view', 'create', 'edit', 'delete'] as PermissionAction[]).map(action => {
                                const meta = ACTION_META[action];
                                const Icon = meta.icon;
                                return (
                                    <div key={action} style={{
                                        display: 'flex', alignItems: 'center', gap: '4px',
                                        fontSize: '11px', fontWeight: '600', color: meta.color,
                                    }}>
                                        <Icon size={13} />
                                        <span>{meta.label}</span>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Clear All */}
                        {grantedCount > 0 && (
                            <button
                                onClick={clearAll}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '5px',
                                    padding: '6px 12px', border: '1px solid #fca5a5',
                                    borderRadius: '6px', backgroundColor: '#fef2f2',
                                    cursor: 'pointer', fontSize: '12px', fontWeight: '600',
                                    color: '#dc2626', transition: 'all 0.15s',
                                }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#fee2e2'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#fef2f2'; }}
                            >
                                <RotateCcw size={12} /> Clear
                            </button>
                        )}
                    </div>
                </div>

                {/* ═══════════ PERMISSION MATRIX (SCROLLABLE) ═══════════ */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '16px 28px 8px',
                }}>
                    {MODULE_CONFIG.map((mod) => {
                        const Icon = mod.icon;
                        const modState = getModuleState(mod);
                        const hasSubmodules = mod.submodules && mod.submodules.length > 0;
                        const isExpanded = expandedModules.has(mod.id);
                        const modGranted = getModuleGrantedCount(mod);
                        const modTotal = getModulePermissionKeys(mod).length;
                        const moduleMode = getModuleOverrideMode(mod);
                        const isFullControl = moduleMode === 'full_control';

                        return (
                            <div
                                key={mod.id}
                                style={{
                                    marginBottom: '8px',
                                    borderRadius: '12px',
                                    border: modState !== 'none' ? `1px solid ${mod.color}30` : '1px solid #e5e7eb',
                                    overflow: 'hidden',
                                    transition: 'all 0.2s ease',
                                    backgroundColor: modState !== 'none' ? `${mod.color}04` : 'white',
                                }}
                            >
                                {/* ───── MODULE ROW ───── */}
                                <div
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '12px',
                                        padding: '14px 16px',
                                        cursor: 'pointer',
                                        borderLeft: `4px solid ${modState !== 'none' ? mod.color : '#e5e7eb'}`,
                                        transition: 'all 0.15s',
                                    }}
                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${mod.color}08`; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
                                >
                                    {/* Expand toggle (for submodule modules) */}
                                    {hasSubmodules ? (
                                        <button
                                            onClick={() => toggleExpand(mod.id)}
                                            style={{
                                                border: 'none', background: 'none', padding: '2px',
                                                cursor: 'pointer', display: 'flex', color: '#6b7280',
                                                transition: 'transform 0.2s',
                                                transform: isExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                                            }}
                                        >
                                            <ChevronDown size={16} />
                                        </button>
                                    ) : (
                                        <div style={{ width: '20px' }} />
                                    )}

                                    {/* Module Select All Checkbox */}
                                    <button
                                        onClick={() => toggleModuleAll(mod)}
                                        style={{
                                            border: 'none', background: 'none', padding: '0',
                                            cursor: 'pointer', display: 'flex', alignItems: 'center',
                                            flexShrink: 0,
                                        }}
                                        title={`Select all permissions for ${mod.label}`}
                                    >
                                        {modState === 'all' ? (
                                            <CheckSquare size={18} style={{ color: mod.color }} />
                                        ) : modState === 'some' ? (
                                            <div style={{
                                                width: '18px', height: '18px', borderRadius: '4px',
                                                border: `2px solid ${mod.color}`, display: 'flex',
                                                alignItems: 'center', justifyContent: 'center',
                                                backgroundColor: `${mod.color}20`,
                                            }}>
                                                <Minus size={12} style={{ color: mod.color }} />
                                            </div>
                                        ) : (
                                            <Square size={18} style={{ color: '#d1d5db' }} />
                                        )}
                                    </button>

                                    {/* Module icon */}
                                    <div style={{
                                        width: '34px', height: '34px', borderRadius: '8px',
                                        backgroundColor: `${mod.color}15`,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        flexShrink: 0,
                                    }}>
                                        <Icon size={17} style={{ color: mod.color }} />
                                    </div>

                                    {/* Module label */}
                                    <div
                                        style={{ flex: 1, cursor: hasSubmodules ? 'pointer' : 'default' }}
                                        onClick={() => { if (hasSubmodules) toggleExpand(mod.id); }}
                                    >
                                        <div style={{
                                            fontSize: '14px', fontWeight: '600', color: '#111827',
                                            display: 'flex', alignItems: 'center', gap: '8px',
                                        }}>
                                            {mod.label}
                                            {hasSubmodules && (
                                                <span style={{
                                                    fontSize: '10px', fontWeight: '700', color: mod.color,
                                                    backgroundColor: `${mod.color}15`,
                                                    padding: '1px 6px', borderRadius: '4px',
                                                }}>
                                                    {mod.submodules!.length} sub
                                                </span>
                                            )}
                                        </div>
                                        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '1px' }}>
                                            {mod.description}
                                            {modGranted > 0 && (
                                                <span style={{ marginLeft: '6px', color: mod.color, fontWeight: '600' }}>
                                                    ({modGranted}/{modTotal} granted)
                                                </span>
                                            )}
                                        </div>
                                    </div>



                                    {/* Action Checkboxes (for modules WITHOUT submodules) */}
                                    {!hasSubmodules && (
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            {(['view', 'create', 'edit', 'delete'] as PermissionAction[]).map(action => {
                                                const applicable = mod.actions.includes(action);
                                                const key = `${mod.id}.${action}`;
                                                const isChecked = !!permissions[key];
                                                const meta = ACTION_META[action];

                                                if (!applicable) {
                                                    return (
                                                        <div key={action} style={{
                                                            width: '72px', height: '34px',
                                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        }}>
                                                            <Lock size={12} style={{ color: '#e5e7eb' }} />
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <button
                                                        key={action}
                                                        onClick={() => togglePermission(key)}
                                                        title={`Toggle ${meta.label}`}
                                                        style={{
                                                            display: 'flex', alignItems: 'center', gap: '5px',
                                                            padding: '6px 10px',
                                                            border: `1.5px solid ${isChecked ? meta.color : '#e5e7eb'}`,
                                                            borderRadius: '8px',
                                                            backgroundColor: isChecked ? meta.bgColor : 'white',
                                                            cursor: 'pointer',
                                                            fontSize: '11px', fontWeight: '600',
                                                            color: isChecked ? meta.color : '#9ca3af',
                                                            transition: 'all 0.15s',
                                                            minWidth: '72px', justifyContent: 'center',
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            if (!isChecked) {
                                                                e.currentTarget.style.borderColor = meta.color + '60';
                                                                e.currentTarget.style.backgroundColor = meta.bgColor;
                                                            }
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            if (!isChecked) {
                                                                e.currentTarget.style.borderColor = '#e5e7eb';
                                                                e.currentTarget.style.backgroundColor = 'white';
                                                            }
                                                        }}
                                                    >
                                                        {isChecked ? <CheckSquare size={13} /> : <Square size={13} />}
                                                        {meta.label}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>



                                {/* ───── SUBMODULES ───── */}
                                {hasSubmodules && (
                                    <div style={{
                                        maxHeight: isExpanded ? '1000px' : '0',
                                        overflow: 'hidden',
                                        transition: 'max-height 0.35s ease',
                                    }}>
                                        {mod.submodules!.map((sub, idx) => {
                                            const SubIcon = sub.icon;
                                            const subState = getSubmoduleState(mod.id, sub);
                                            const isLast = idx === mod.submodules!.length - 1;

                                            return (
                                                <div
                                                    key={sub.id}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: '12px',
                                                        padding: '12px 16px 12px 56px',
                                                        borderTop: '1px solid #f3f4f6',
                                                        borderLeft: `4px solid ${subState !== 'none' ? mod.color + '60' : '#f3f4f6'}`,
                                                        backgroundColor: subState !== 'none' ? `${mod.color}04` : 'transparent',
                                                        transition: 'all 0.15s',
                                                    }}
                                                    onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = `${mod.color}06`; }}
                                                    onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = subState !== 'none' ? `${mod.color}04` : 'transparent'; }}
                                                >
                                                    {/* Submodule Select All */}
                                                    <button
                                                        onClick={() => toggleSubmoduleAll(mod.id, sub)}
                                                        style={{
                                                            border: 'none', background: 'none', padding: '0',
                                                            cursor: 'pointer', display: 'flex', alignItems: 'center',
                                                            flexShrink: 0,
                                                        }}
                                                        title={`Select all permissions for ${sub.label}`}
                                                    >
                                                        {subState === 'all' ? (
                                                            <CheckSquare size={16} style={{ color: mod.color }} />
                                                        ) : subState === 'some' ? (
                                                            <div style={{
                                                                width: '16px', height: '16px', borderRadius: '3px',
                                                                border: `2px solid ${mod.color}`, display: 'flex',
                                                                alignItems: 'center', justifyContent: 'center',
                                                                backgroundColor: `${mod.color}20`,
                                                            }}>
                                                                <Minus size={10} style={{ color: mod.color }} />
                                                            </div>
                                                        ) : (
                                                            <Square size={16} style={{ color: '#d1d5db' }} />
                                                        )}
                                                    </button>

                                                    {/* Submodule icon */}
                                                    <div style={{
                                                        width: '28px', height: '28px', borderRadius: '6px',
                                                        backgroundColor: `${mod.color}10`,
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        flexShrink: 0,
                                                    }}>
                                                        <SubIcon size={14} style={{ color: mod.color, opacity: 0.8 }} />
                                                    </div>

                                                    {/* Submodule label */}
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ fontSize: '13px', fontWeight: '500', color: '#374151' }}>
                                                            {sub.label}
                                                        </div>
                                                        {sub.description && (
                                                            <div style={{ fontSize: '10px', color: '#9ca3af', marginTop: '1px' }}>
                                                                {sub.description}
                                                            </div>
                                                        )}
                                                    </div>

                                                    {/* Action Checkboxes */}
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                        {(['view', 'create', 'edit', 'delete'] as PermissionAction[]).map(action => {
                                                            const applicable = sub.actions.includes(action);
                                                            const key = `${mod.id}.${sub.id}.${action}`;
                                                            const isChecked = !!permissions[key];
                                                            const meta = ACTION_META[action];

                                                            if (!applicable) {
                                                                return (
                                                                    <div key={action} style={{
                                                                        width: '72px', height: '32px',
                                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                                    }}>
                                                                        <Lock size={11} style={{ color: '#e5e7eb' }} />
                                                                    </div>
                                                                );
                                                            }

                                                            return (
                                                                <button
                                                                    key={action}
                                                                    onClick={() => togglePermission(key)}
                                                                    title={`Toggle ${meta.label}`}
                                                                    style={{
                                                                        display: 'flex', alignItems: 'center', gap: '4px',
                                                                        padding: '5px 9px',
                                                                        border: `1.5px solid ${isChecked ? meta.color : '#e5e7eb'}`,
                                                                        borderRadius: '7px',
                                                                        backgroundColor: isChecked ? meta.bgColor : 'white',
                                                                        cursor: 'pointer',
                                                                        fontSize: '11px', fontWeight: '600',
                                                                        color: isChecked ? meta.color : '#9ca3af',
                                                                        transition: 'all 0.15s',
                                                                        minWidth: '72px', justifyContent: 'center',
                                                                    }}
                                                                    onMouseEnter={(e) => {
                                                                        if (!isChecked) {
                                                                            e.currentTarget.style.borderColor = meta.color + '60';
                                                                            e.currentTarget.style.backgroundColor = meta.bgColor;
                                                                        }
                                                                    }}
                                                                    onMouseLeave={(e) => {
                                                                        if (!isChecked) {
                                                                            e.currentTarget.style.borderColor = '#e5e7eb';
                                                                            e.currentTarget.style.backgroundColor = 'white';
                                                                        }
                                                                    }}
                                                                >
                                                                    {isChecked ? <CheckSquare size={12} /> : <Square size={12} />}
                                                                    {meta.label}
                                                                </button>
                                                            );
                                                        })}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>

                {/* ═══════════ SUMMARY & ACTIONS ═══════════ */}
                <div style={{
                    padding: '16px 28px 20px',
                    borderTop: '1px solid #e5e7eb',
                    backgroundColor: '#fafbfc',
                }}>
                    {/* Summary Preview */}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '16px',
                        marginBottom: '16px',
                    }}>
                        {/* Progress */}
                        <div style={{ flex: 1 }}>
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                marginBottom: '6px',
                            }}>
                                <div style={{ fontSize: '13px', fontWeight: '700', color: '#111827' }}>
                                    {grantedCount} of {totalPermissions} permissions granted
                                </div>
                                <div style={{
                                    fontSize: '12px', fontWeight: '600',
                                    color: grantedCount === 0 ? '#9ca3af' : grantedCount === totalPermissions ? '#059669' : '#1e3a8a',
                                }}>
                                    {Math.round((grantedCount / totalPermissions) * 100)}%
                                </div>
                            </div>
                            <div style={{
                                width: '100%', height: '6px', borderRadius: '3px',
                                backgroundColor: '#e5e7eb', overflow: 'hidden',
                            }}>
                                <div style={{
                                    width: `${(grantedCount / totalPermissions) * 100}%`,
                                    height: '100%', borderRadius: '3px',
                                    background: grantedCount === totalPermissions
                                        ? 'linear-gradient(90deg, #059669, #10b981)'
                                        : 'linear-gradient(90deg, #1e3a8a, #3b82f6)',
                                    transition: 'width 0.3s ease',
                                }} />
                            </div>
                        </div>

                        {/* Action Breakdown Pills */}
                        <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                            {(['view', 'create', 'edit', 'delete'] as PermissionAction[]).map(action => {
                                const meta = ACTION_META[action];
                                const count = summaryByAction[action];
                                return (
                                    <div key={action} style={{
                                        display: 'flex', alignItems: 'center', gap: '4px',
                                        padding: '4px 8px', borderRadius: '6px',
                                        backgroundColor: count > 0 ? meta.bgColor : '#f3f4f6',
                                        border: `1px solid ${count > 0 ? meta.color + '30' : '#e5e7eb'}`,
                                    }}>
                                        <span style={{ fontSize: '11px', fontWeight: '700', color: count > 0 ? meta.color : '#9ca3af' }}>
                                            {count}
                                        </span>
                                        <span style={{ fontSize: '10px', fontWeight: '500', color: count > 0 ? meta.color : '#9ca3af' }}>
                                            {meta.label}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>



                    {/* Warning if full access */}
                    {isAllSelected && (
                        <div style={{
                            display: 'flex', alignItems: 'center', gap: '8px',
                            padding: '10px 14px', borderRadius: '8px',
                            backgroundColor: '#fffbeb', border: '1px solid #fcd34d',
                            marginBottom: '14px',
                        }}>
                            <AlertTriangle size={15} style={{ color: '#f59e0b', flexShrink: 0 }} />
                            <p style={{ fontSize: '12px', color: '#92400e', margin: 0, fontWeight: '500' }}>
                                <strong>Full access</strong> is granted. This gives the user complete control over all modules. Verify this is intentional.
                            </p>
                        </div>
                    )}

                    {/* Buttons */}
                    <div style={{ display: 'flex', gap: '12px' }}>
                        <button
                            onClick={onClose}
                            style={{
                                flex: 1, padding: '13px', border: 'none', borderRadius: '10px',
                                backgroundColor: '#f3f4f6', color: '#4b5563',
                                fontWeight: '600', fontSize: '14px', cursor: 'pointer',
                                transition: 'all 0.2s',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = '#e5e7eb'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = '#f3f4f6'; }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={!hasChanges}
                            style={{
                                flex: 2, padding: '13px', border: 'none', borderRadius: '10px',
                                background: hasChanges
                                    ? 'linear-gradient(135deg, #1e3a8a, #2563eb)'
                                    : '#d1d5db',
                                color: 'white', fontWeight: '700', fontSize: '14px',
                                cursor: hasChanges ? 'pointer' : 'not-allowed',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                                boxShadow: hasChanges ? '0 4px 12px rgba(37, 99, 235, 0.25)' : 'none',
                                transition: 'all 0.2s',
                                letterSpacing: '-0.2px',
                            }}
                            onMouseEnter={(e) => {
                                if (hasChanges) e.currentTarget.style.boxShadow = '0 6px 20px rgba(37, 99, 235, 0.35)';
                            }}
                            onMouseLeave={(e) => {
                                if (hasChanges) e.currentTarget.style.boxShadow = '0 4px 12px rgba(37, 99, 235, 0.25)';
                            }}
                        >
                            <Save size={16} />
                            Save Permissions
                        </button>
                    </div>
                </div>

                {/* CSS Animations */}
                <style>{`
                    @keyframes fadeIn {
                        from { opacity: 0; }
                        to { opacity: 1; }
                    }
                    @keyframes slideUp {
                        from { opacity: 0; transform: translateY(20px) scale(0.97); }
                        to { opacity: 1; transform: translateY(0) scale(1); }
                    }
                `}
                </style>
            </div>
        </div>
    );
}

export { MODULE_CONFIG };
export default GrantAccessModal;
