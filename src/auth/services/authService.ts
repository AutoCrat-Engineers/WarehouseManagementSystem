/**
 * Enterprise RBAC Authentication Service
 * 
 * Location: src/auth/services/authService.ts
 * 
 * Handles all authentication operations with enterprise-grade security.
 * NO public signup - only L3 managers can create users.
 */

import { getSupabaseClient } from '../../utils/supabase/client';

const supabase = getSupabaseClient();

// ============================================================================
// TYPES
// ============================================================================

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

export interface AuthSession {
  user: UserProfile;
  accessToken: string;
  expiresAt: number;
}

export interface Permission {
  module: string;
  action: string;
  is_allowed: boolean;
}

export interface AuthResult {
  success: boolean;
  session?: AuthSession;
  error?: string;
}

// ============================================================================
// ROLE CONFIGURATION
// ============================================================================

export const ROLE_CONFIG = {
  L3: {
    name: 'Manager',
    level: 3,
    description: 'Full system access. Can create users, assign roles, configure system.',
    color: '#7c3aed', // Purple
    badge: 'Admin'
  },
  L2: {
    name: 'Supervisor',
    level: 2,
    description: 'Operations oversight. Can approve transactions, view reports.',
    color: '#2563eb', // Blue
    badge: 'Supervisor'
  },
  L1: {
    name: 'Operator',
    level: 1,
    description: 'Day-to-day operations. Can view and create records.',
    color: '#059669', // Green
    badge: 'Operator'
  }
} as const;

// ============================================================================
// AUTHENTICATION FUNCTIONS
// ============================================================================

/**
 * Sign in with email and password
 * Returns session with user profile and role
 */
export async function signIn(
  email: string,
  password: string
): Promise<AuthResult> {
  try {
    // Sign in with Supabase Auth
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      console.error('Sign in error:', error.message);
      return { success: false, error: error.message };
    }

    if (!data.session) {
      return { success: false, error: 'No session received' };
    }

    // Fetch user profile with role
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', data.user.id)
      .single();

    if (profileError || !profile) {
      console.error('Profile fetch error:', profileError);
      return { success: false, error: 'User profile not found' };
    }

    // Check if user is active and not deleted
    if (!profile.is_active || profile.deleted_at) {
      await supabase.auth.signOut();
      return { success: false, error: 'Your account has been deactivated. Contact your administrator.' };
    }

    // Update last login timestamp
    await supabase
      .from('profiles')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', data.user.id);

    // Log audit event
    await logAuditEvent(data.user.id, 'LOGIN');

    console.log('✓ Sign in successful:', profile.email, 'Role:', profile.role);

    return {
      success: true,
      session: {
        user: profile as UserProfile,
        accessToken: data.session.access_token,
        expiresAt: data.session.expires_at || 0,
      }
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Sign in exception:', err);
    return { success: false, error: errorMsg };
  }
}

/**
 * Sign out the current user
 */
export async function signOut(): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      await logAuditEvent(user.id, 'LOGOUT');
    }

    const { error } = await supabase.auth.signOut();

    if (error) {
      console.error('Sign out error:', error.message);
      return { success: false, error: error.message };
    }

    console.log('✓ Sign out successful');
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error';
    console.error('Sign out exception:', err);
    return { success: false, error: errorMsg };
  }
}

/**
 * Get current session with user profile
 */
export async function getCurrentSession(): Promise<AuthSession | null> {
  try {
    const { data: { session }, error } = await supabase.auth.getSession();

    if (error || !session) {
      return null;
    }

    // Fetch user profile
    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', session.user.id)
      .single();

    if (profileError || !profile || !profile.is_active || profile.deleted_at) {
      return null;
    }

    return {
      user: profile as UserProfile,
      accessToken: session.access_token,
      expiresAt: session.expires_at || 0,
    };
  } catch (err) {
    console.error('Get session error:', err);
    return null;
  }
}

/**
 * Get current access token
 */
export async function getAccessToken(): Promise<string | null> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token || null;
  } catch {
    return null;
  }
}

/**
 * Refresh authentication token
 */
export async function refreshToken(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.refreshSession();

    if (error || !data.session) {
      console.error('Token refresh error:', error?.message);
      return null;
    }

    return data.session.access_token;
  } catch (err) {
    console.error('Token refresh exception:', err);
    return null;
  }
}

// ============================================================================
// PERMISSION FUNCTIONS
// ============================================================================

/**
 * Get all permissions for current user
 */
export async function getUserPermissions(): Promise<Permission[]> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .rpc('get_user_permissions', { user_id: user.id });

    if (error) {
      console.error('Get permissions error:', error);
      return [];
    }

    return data || [];
  } catch {
    return [];
  }
}

/**
 * Check if user has specific permission
 */
export async function hasPermission(module: string, action: string): Promise<boolean> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return false;

    const { data, error } = await supabase
      .rpc('has_permission', {
        user_id: user.id,
        p_module: module,
        p_action: action
      });

    if (error) {
      console.error('Check permission error:', error);
      return false;
    }

    return data || false;
  } catch {
    return false;
  }
}

/**
 * Check if user has minimum role level
 */
export function hasMinimumRole(userRole: UserRole, requiredRole: UserRole): boolean {
  const userLevel = ROLE_CONFIG[userRole]?.level || 0;
  const requiredLevel = ROLE_CONFIG[requiredRole]?.level || 0;
  return userLevel >= requiredLevel;
}

// ============================================================================
// AUDIT LOGGING
// ============================================================================

/**
 * Log audit event
 */
async function logAuditEvent(
  userId: string,
  action: string,
  targetType?: string,
  targetId?: string,
  oldValue?: object,
  newValue?: object
): Promise<void> {
  try {
    await supabase.from('audit_log').insert({
      user_id: userId,
      action,
      target_type: targetType || null,
      target_id: targetId || null,
      old_value: oldValue || null,
      new_value: newValue || null,
    });
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

// ============================================================================
// AUTH STATE LISTENER
// ============================================================================

/**
 * Subscribe to auth state changes
 */
export function onAuthStateChange(
  callback: (session: AuthSession | null) => void
): () => void {
  const { data: { subscription } } = supabase.auth.onAuthStateChange(
    async (event, session) => {
      console.log('Auth state changed:', event);

      if (session) {
        // Fetch profile with role
        const { data: profile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', session.user.id)
          .single();

        if (profile && profile.is_active && !profile.deleted_at) {
          callback({
            user: profile as UserProfile,
            accessToken: session.access_token,
            expiresAt: session.expires_at || 0,
          });
        } else {
          // User is deleted or deactivated - sign them out
          await supabase.auth.signOut();
          callback(null);
        }
      } else {
        callback(null);
      }
    }
  );

  return () => subscription.unsubscribe();
}
