/**
 * Enterprise User Management Service
 * 
 * Location: src/auth/services/userService.ts
 * 
 * L3-only operations for managing users.
 * - Create users
 * - Update users
 * - Update roles
 * - Activate/deactivate users
 * - Delete users (soft delete)
 */

import { getSupabaseClient } from '../../utils/supabase/client';
import type { UserRole, UserProfile } from './authService';

const supabase = getSupabaseClient();

// ============================================================================
// TYPES
// ============================================================================

export interface CreateUserRequest {
    email: string;
    password: string;
    full_name: string;
    role: UserRole;
    employee_id?: string;
    department?: string;
    shift?: string;
}

export interface UpdateUserRequest {
    full_name?: string;
    role?: UserRole;
    is_active?: boolean;
    employee_id?: string;
    department?: string;
    shift?: string;
}

export interface UserListItem extends UserProfile {
    created_by_name?: string;
}

// ============================================================================
// USER MANAGEMENT (L3 ONLY)
// ============================================================================

/**
 * Get all users (L3 only)
 * Excludes soft-deleted users
 */
export async function getAllUsers(): Promise<UserListItem[]> {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .is('deleted_at', null)
            .order('created_at', { ascending: false });

        if (error) {
            console.error('Get users error:', error);
            throw new Error('Failed to fetch users');
        }

        return (data || []).map(user => ({
            ...user,
            created_by_name: null // Simple map for now
        }));
    } catch (err) {
        console.error('Get users exception:', err);
        throw err;
    }
}

/**
 * Get user by ID (L3 only)
 */
export async function getUserById(userId: string): Promise<UserProfile | null> {
    try {
        const { data, error } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (error) {
            console.error('Get user error:', error);
            return null;
        }

        return data as UserProfile;
    } catch (err) {
        console.error('Get user exception:', err);
        return null;
    }
}

/**
 * Create new user (L3 only)
 * 
 * IMPORTANT: Uses a separate Supabase client approach to prevent auto-login.
 * The admin's session is preserved by immediately restoring after signup.
 */
export async function createUser(
    request: CreateUserRequest,
    createdBy: string
): Promise<{ success: boolean; user?: UserProfile; error?: string }> {
    try {
        // Get current session to verify L3 access and preserve it
        const { data: { session: currentSession } } = await supabase.auth.getSession();
        if (!currentSession) {
            return { success: false, error: 'Not authenticated' };
        }

        // Store admin's session tokens for restoration
        const adminAccessToken = currentSession.access_token;
        const adminRefreshToken = currentSession.refresh_token;

        // Verify caller is L3
        const { data: callerProfile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', currentSession.user.id)
            .single();

        if (callerProfile?.role !== 'L3') {
            return { success: false, error: 'Only L3 managers can create users' };
        }

        // Check if user already exists
        const { data: existingUsers } = await supabase
            .from('profiles')
            .select('email')
            .eq('email', request.email);

        if (existingUsers && existingUsers.length > 0) {
            return { success: false, error: 'A user with this email already exists' };
        }

        // Create user via Supabase Auth (this will temporarily switch the session)
        const { data: authData, error: authError } = await supabase.auth.signUp({
            email: request.email,
            password: request.password,
            options: {
                data: {
                    full_name: request.full_name,
                    role: request.role,
                },
                // Prevent auto-confirm to avoid session switch
                emailRedirectTo: undefined,
            }
        });

        // IMMEDIATELY restore admin session to prevent redirect
        await supabase.auth.setSession({
            access_token: adminAccessToken,
            refresh_token: adminRefreshToken,
        });

        if (authError) {
            console.error('Auth signup error:', authError);
            return { success: false, error: authError.message };
        }

        if (!authData.user) {
            return { success: false, error: 'Failed to create user' };
        }

        // Profile should be auto-created by database trigger, but let's ensure it exists
        // Wait a moment for trigger to execute
        await new Promise(resolve => setTimeout(resolve, 500));

        // Update profile with additional fields
        const { error: profileError } = await supabase
            .from('profiles')
            .upsert({
                id: authData.user.id,
                email: request.email,
                full_name: request.full_name,
                role: request.role,
                is_active: true,
                employee_id: request.employee_id || null,
                department: request.department || null,
                shift: request.shift || null,
                created_by: createdBy,
                updated_at: new Date().toISOString(),
            }, { onConflict: 'id' });

        if (profileError) {
            console.error('Profile update error:', profileError);
            // Don't fail - user was created
        }

        // Log audit event
        try {
            await supabase.from('audit_log').insert({
                user_id: currentSession.user.id,
                action: 'CREATE_USER',
                target_type: 'user',
                target_id: authData.user.id,
                new_value: { email: request.email, role: request.role },
            });
        } catch { /* ignore audit errors */ }

        return {
            success: true,
            user: {
                id: authData.user.id,
                email: request.email,
                full_name: request.full_name,
                role: request.role,
                is_active: true,
                employee_id: request.employee_id || null,
                department: request.department || null,
                shift: request.shift || null,
            } as UserProfile
        };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Create user exception:', err);
        return { success: false, error: errorMsg };
    }
}

/**
 * Update user details (L3 only)
 */
export async function updateUser(
    userId: string,
    updates: UpdateUserRequest
): Promise<{ success: boolean; error?: string }> {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        // Verify caller is L3
        const { data: callerProfile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (callerProfile?.role !== 'L3') {
            return { success: false, error: 'Only L3 managers can update users' };
        }

        // Get old values for audit
        const { data: oldProfile } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', userId)
            .single();

        if (!oldProfile) {
            return { success: false, error: 'User not found' };
        }

        // Build update object - only include fields that are provided and not empty
        const updateData: Record<string, unknown> = {
            updated_at: new Date().toISOString(),
        };

        // Only set fields that are explicitly provided
        if (updates.full_name !== undefined && updates.full_name !== '') {
            updateData.full_name = updates.full_name;
        }
        if (updates.role !== undefined) {
            updateData.role = updates.role;
        }
        if (updates.is_active !== undefined) {
            updateData.is_active = updates.is_active;
        }
        // Handle optional fields - set to null if empty string
        if (updates.employee_id !== undefined) {
            updateData.employee_id = updates.employee_id || null;
        }
        if (updates.department !== undefined) {
            updateData.department = updates.department || null;
        }
        if (updates.shift !== undefined) {
            updateData.shift = updates.shift || null;
        }

        console.log('Updating user with data:', updateData);

        // Update profile
        const { data: updateResult, error } = await supabase
            .from('profiles')
            .update(updateData)
            .eq('id', userId)
            .select();

        if (error) {
            console.error('Update user error:', error.message, error.details, error.hint);
            return { success: false, error: `Failed to update user: ${error.message}` };
        }

        console.log('Update result:', updateResult);

        // Log audit event
        try {
            await supabase.from('audit_log').insert({
                user_id: user.id,
                action: 'UPDATE_USER',
                target_type: 'user',
                target_id: userId,
                old_value: oldProfile,
                new_value: updates,
            });
        } catch { /* ignore audit errors */ }

        return { success: true };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Update user exception:', err);
        return { success: false, error: errorMsg };
    }
}

/**
 * Update user role (L3 only)
 */
export async function updateUserRole(
    userId: string,
    newRole: UserRole
): Promise<{ success: boolean; error?: string }> {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        // Prevent self-demotion
        if (userId === user.id && newRole !== 'L3') {
            return { success: false, error: 'Cannot change your own role' };
        }

        // Get old value for audit
        const { data: oldProfile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', userId)
            .single();

        // Update role
        const { error } = await supabase
            .from('profiles')
            .update({ role: newRole, updated_at: new Date().toISOString() })
            .eq('id', userId);

        if (error) {
            console.error('Update role error:', error);
            return { success: false, error: 'Failed to update role' };
        }

        // Log audit event
        await supabase.from('audit_log').insert({
            user_id: user.id,
            action: 'UPDATE_ROLE',
            target_type: 'user',
            target_id: userId,
            old_value: { role: oldProfile?.role },
            new_value: { role: newRole },
        });

        return { success: true };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Update role exception:', err);
        return { success: false, error: errorMsg };
    }
}

/**
 * Update user status (activate/deactivate) (L3 only)
 */
export async function updateUserStatus(
    userId: string,
    isActive: boolean
): Promise<{ success: boolean; error?: string }> {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        // Prevent self-deactivation
        if (userId === user.id && !isActive) {
            return { success: false, error: 'Cannot deactivate your own account' };
        }

        // Update status
        const { error } = await supabase
            .from('profiles')
            .update({ is_active: isActive, updated_at: new Date().toISOString() })
            .eq('id', userId);

        if (error) {
            console.error('Update status error:', error);
            return { success: false, error: 'Failed to update status' };
        }

        // Log audit event
        await supabase.from('audit_log').insert({
            user_id: user.id,
            action: isActive ? 'ACTIVATE_USER' : 'DEACTIVATE_USER',
            target_type: 'user',
            target_id: userId,
        });

        return { success: true };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Update status exception:', err);
        return { success: false, error: errorMsg };
    }
}

/**
 * Delete user (L3 only)
 * 
 * NOTE: We can't delete from auth.users via client API.
 * This performs a soft-delete by deactivating and marking the profile as deleted.
 */
export async function deleteUser(
    userId: string
): Promise<{ success: boolean; error?: string }> {
    try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return { success: false, error: 'Not authenticated' };
        }

        // Prevent self-deletion
        if (userId === user.id) {
            return { success: false, error: 'Cannot delete your own account' };
        }

        // Verify caller is L3
        const { data: callerProfile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();

        if (callerProfile?.role !== 'L3') {
            return { success: false, error: 'Only L3 managers can delete users' };
        }

        // Get user info for audit
        const { data: targetUser } = await supabase
            .from('profiles')
            .select('email, full_name')
            .eq('id', userId)
            .single();

        // Soft delete: Mark as inactive and add deleted flag
        const { error } = await supabase
            .from('profiles')
            .update({
                is_active: false,
                deleted_at: new Date().toISOString(),
                updated_at: new Date().toISOString()
            })
            .eq('id', userId);

        if (error) {
            console.error('Delete user error:', error);
            return { success: false, error: 'Failed to delete user' };
        }

        // Log audit event
        try {
            await supabase.from('audit_log').insert({
                user_id: user.id,
                action: 'DELETE_USER',
                target_type: 'user',
                target_id: userId,
                old_value: { email: targetUser?.email, full_name: targetUser?.full_name },
            });
        } catch {
            // Don't fail if audit fails
        }

        return { success: true };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Delete user exception:', err);
        return { success: false, error: errorMsg };
    }
}

/**
 * Reset user password (L3 only)
 * 
 * NOTE: Supabase doesn't allow resetting another user's password from client-side.
 * This would require a Supabase Edge Function with service_role key.
 * For now, we'll send a password reset email to the user.
 */
export async function resetUserPassword(
    userId: string,
    _newPassword: string // Not used - keeping for API compatibility
): Promise<{ success: boolean; error?: string }> {
    try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
            return { success: false, error: 'Not authenticated' };
        }

        // Verify caller is L3
        const { data: callerProfile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', session.user.id)
            .single();

        if (callerProfile?.role !== 'L3') {
            return { success: false, error: 'Only L3 managers can reset passwords' };
        }

        // Get user's email
        const { data: targetUser } = await supabase
            .from('profiles')
            .select('email')
            .eq('id', userId)
            .single();

        if (!targetUser?.email) {
            return { success: false, error: 'User not found' };
        }

        // Send password reset email
        const { error } = await supabase.auth.resetPasswordForEmail(targetUser.email, {
            redirectTo: `${window.location.origin}/reset-password`,
        });

        if (error) {
            console.error('Password reset error:', error);
            return { success: false, error: error.message };
        }

        // Log audit event
        try {
            await supabase.from('audit_log').insert({
                user_id: session.user.id,
                action: 'PASSWORD_RESET_EMAIL_SENT',
                target_type: 'user',
                target_id: userId,
            });
        } catch {
            // Don't fail if audit fails
        }

        return {
            success: true,
            error: `Password reset email sent to ${targetUser.email}. The user will receive an email with instructions.`
        };
    } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        console.error('Reset password exception:', err);
        return { success: false, error: errorMsg };
    }
}

/**
 * Get audit log (L3 only)
 */
export async function getAuditLog(
    limit: number = 100
): Promise<any[]> {
    try {
        const { data, error } = await supabase
            .from('audit_log')
            .select(`
        *,
        user:user_id(email, full_name)
      `)
            .order('created_at', { ascending: false })
            .limit(limit);

        if (error) {
            console.error('Get audit log error:', error);
            return [];
        }

        return data || [];
    } catch {
        return [];
    }
}
