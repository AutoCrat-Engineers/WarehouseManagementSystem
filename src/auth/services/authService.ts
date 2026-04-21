/**
 * Shared RBAC auth types and role metadata.
 *
 * Runtime login/logout is handled by App.tsx through the auth-login and
 * auth-logout Edge Functions. This module intentionally contains only the
 * pieces still shared by user management and permission UI.
 */

export type UserRole = 'L1' | 'L2' | 'L3';

export interface UserProfile {
  id: string;
  email: string;
  full_name: string;
  role: UserRole;
  is_active: boolean;
  employee_id?: string;
  department?: string;
  shift?: string;
  created_at: string;
  updated_at?: string;
  last_login_at: string | null;
}

export const ROLE_CONFIG = {
  L3: {
    name: 'Manager',
    level: 3,
    description: 'Full system access. Can create users, assign roles, configure system.',
    color: '#7c3aed',
    badge: 'Admin',
  },
  L2: {
    name: 'Supervisor',
    level: 2,
    description: 'Operations oversight. Can approve transactions, view reports.',
    color: '#2563eb',
    badge: 'Supervisor',
  },
  L1: {
    name: 'Operator',
    level: 1,
    description: 'Day-to-day operations. Can view and create records.',
    color: '#059669',
    badge: 'Operator',
  },
} as const;

export function hasMinimumRole(userRole: UserRole, requiredRole: UserRole): boolean {
  const userLevel = ROLE_CONFIG[userRole]?.level || 0;
  const requiredLevel = ROLE_CONFIG[requiredRole]?.level || 0;
  return userLevel >= requiredLevel;
}
