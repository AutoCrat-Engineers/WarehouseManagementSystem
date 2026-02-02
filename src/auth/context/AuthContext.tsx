/**
 * Authentication Context
 * 
 * Location: src/auth/context/AuthContext.tsx
 * 
 * Provides global auth state to the entire application
 */

import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
    signIn as authSignIn,
    signOut as authSignOut,
    getCurrentSession,
    onAuthStateChange,
    hasMinimumRole,
    type AuthSession,
    type UserProfile,
    type UserRole,
} from '../services/authService';

// ============================================================================
// TYPES
// ============================================================================

interface AuthContextType {
    // State
    isAuthenticated: boolean;
    isLoading: boolean;
    user: UserProfile | null;
    accessToken: string | null;
    error: string | null;

    // Actions
    login: (email: string, password: string) => Promise<boolean>;
    logout: () => Promise<void>;
    clearError: () => void;

    // Role checks
    hasRole: (requiredRole: UserRole) => boolean;
    isL3: boolean;
    isL2OrAbove: boolean;
}

// ============================================================================
// CONTEXT
// ============================================================================

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// ============================================================================
// PROVIDER
// ============================================================================

interface AuthProviderProps {
    children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [user, setUser] = useState<UserProfile | null>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Initialize auth on mount
    useEffect(() => {
        initializeAuth();

        // Subscribe to auth state changes
        const unsubscribe = onAuthStateChange((session) => {
            if (session) {
                setUser(session.user);
                setAccessToken(session.accessToken);
                setIsAuthenticated(true);
            } else {
                setUser(null);
                setAccessToken(null);
                setIsAuthenticated(false);
            }
        });

        return () => unsubscribe();
    }, []);

    const initializeAuth = async () => {
        try {
            setIsLoading(true);
            const session = await getCurrentSession();

            if (session) {
                setUser(session.user);
                setAccessToken(session.accessToken);
                setIsAuthenticated(true);
                console.log('✓ Session restored:', session.user.email, 'Role:', session.user.role);
            } else {
                setIsAuthenticated(false);
            }
        } catch (err) {
            console.error('Auth initialization error:', err);
            setError(err instanceof Error ? err.message : 'Failed to initialize auth');
        } finally {
            setIsLoading(false);
        }
    };

    // Login handler
    const login = useCallback(async (email: string, password: string): Promise<boolean> => {
        try {
            setError(null);
            setIsLoading(true);

            const result = await authSignIn(email, password);

            if (!result.success || !result.session) {
                setError(result.error || 'Login failed');
                return false;
            }

            setUser(result.session.user);
            setAccessToken(result.session.accessToken);
            setIsAuthenticated(true);

            return true;
        } catch (err) {
            const errorMsg = err instanceof Error ? err.message : 'Login failed';
            setError(errorMsg);
            return false;
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Logout handler
    const logout = useCallback(async (): Promise<void> => {
        try {
            setIsLoading(true);
            await authSignOut();
        } catch (err) {
            console.error('Logout error:', err);
        } finally {
            setUser(null);
            setAccessToken(null);
            setIsAuthenticated(false);
            setError(null);
            setIsLoading(false);
        }
    }, []);

    // Clear error
    const clearError = useCallback(() => {
        setError(null);
    }, []);

    // Role checks
    const hasRole = useCallback((requiredRole: UserRole): boolean => {
        if (!user) return false;
        return hasMinimumRole(user.role, requiredRole);
    }, [user]);

    const isL3 = user?.role === 'L3';
    const isL2OrAbove = hasRole('L2');

    // Context value
    const value: AuthContextType = {
        isAuthenticated,
        isLoading,
        user,
        accessToken,
        error,
        login,
        logout,
        clearError,
        hasRole,
        isL3,
        isL2OrAbove,
    };

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}

// ============================================================================
// HOOK
// ============================================================================

export function useAuth(): AuthContextType {
    const context = useContext(AuthContext);

    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }

    return context;
}

// Export types
export type { AuthContextType };
