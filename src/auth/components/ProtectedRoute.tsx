/**
 * Protected Route Component
 * 
 * Location: src/auth/components/ProtectedRoute.tsx
 * 
 * Wraps routes that require specific role access
 */

import React from 'react';
import { Shield, Lock } from 'lucide-react';
import { hasMinimumRole, ROLE_CONFIG, type UserRole } from '../services/authService';

interface ProtectedRouteProps {
    children: React.ReactNode;
    userRole: UserRole;
    requiredRole: UserRole;
    fallback?: React.ReactNode;
}

export function ProtectedRoute({
    children,
    userRole,
    requiredRole,
    fallback,
}: ProtectedRouteProps) {
    const hasAccess = hasMinimumRole(userRole, requiredRole);

    if (!hasAccess) {
        if (fallback) {
            return <>{fallback}</>;
        }

        return (
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '60px 40px',
                textAlign: 'center',
                backgroundColor: '#fee2e2',
                borderRadius: '12px',
                border: '1px solid #fecaca',
                maxWidth: '480px',
                margin: '40px auto',
            }}>
                <div style={{
                    width: '64px',
                    height: '64px',
                    borderRadius: '50%',
                    backgroundColor: '#fef2f2',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: '20px',
                }}>
                    <Lock size={32} style={{ color: '#dc2626' }} />
                </div>

                <h2 style={{
                    fontSize: '20px',
                    fontWeight: '700',
                    color: '#dc2626',
                    marginBottom: '8px',
                }}>
                    Access Denied
                </h2>

                <p style={{
                    fontSize: '14px',
                    color: '#b91c1c',
                    marginBottom: '20px',
                }}>
                    You do not have permission to access this area.
                </p>

                <div style={{
                    padding: '12px 16px',
                    backgroundColor: 'white',
                    borderRadius: '8px',
                    border: '1px solid #fecaca',
                }}>
                    <p style={{ fontSize: '13px', color: '#7f1d1d', marginBottom: '8px' }}>
                        <strong>Required Role:</strong>
                    </p>
                    <span style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '4px 10px',
                        backgroundColor: `${ROLE_CONFIG[requiredRole].color}15`,
                        color: ROLE_CONFIG[requiredRole].color,
                        borderRadius: '6px',
                        fontWeight: '600',
                        fontSize: '12px',
                    }}>
                        <Shield size={14} />
                        {requiredRole} - {ROLE_CONFIG[requiredRole].name}
                    </span>
                    <p style={{
                        fontSize: '11px',
                        color: '#9ca3af',
                        marginTop: '8px',
                    }}>
                        Contact your administrator for access.
                    </p>
                </div>
            </div>
        );
    }

    return <>{children}</>;
}

/**
 * Hook to check role access
 */
export function useRoleAccess(userRole: UserRole, requiredRole: UserRole): boolean {
    return hasMinimumRole(userRole, requiredRole);
}

/**
 * Higher-order component for role-based access
 */
export function withRoleAccess<P extends object>(
    WrappedComponent: React.ComponentType<P>,
    requiredRole: UserRole
) {
    return function RoleAccessComponent(props: P & { userRole: UserRole }) {
        const { userRole, ...rest } = props;
        return (
            <ProtectedRoute userRole={userRole} requiredRole={requiredRole}>
                <WrappedComponent {...(rest as P)} />
            </ProtectedRoute>
        );
    };
}

export default ProtectedRoute;
