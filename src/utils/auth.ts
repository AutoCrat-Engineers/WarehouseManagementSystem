/**
 * Shared Authentication Utilities
 *
 * Centralized auth helpers used across all service modules.
 * Eliminates duplicate getCurrentUserId/getUserRole/getAuthContext
 * definitions in packingService, packingEngineService, mplService, etc.
 *
 * @version v0.4.1
 */
import { getSupabaseClient } from './supabase/client';

const supabase = getSupabaseClient();

/**
 * Get the current authenticated user's ID from the Supabase session.
 * Throws if not authenticated.
 */
export async function getCurrentUserId(): Promise<string> {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user?.id) throw new Error('Not authenticated');
    return session.user.id;
}

/**
 * Fetch the role of a specific user from the profiles table.
 * Defaults to 'L1' if no role is found.
 */
export async function getUserRole(userId: string): Promise<string> {
    const { data } = await supabase.from('profiles').select('role').eq('id', userId).single();
    return data?.role || 'L1';
}

/**
 * Fetch userId and role in a single parallel call.
 * Most service functions need both — this avoids serial calls.
 */
export async function getAuthContext(): Promise<{ userId: string; role: string }> {
    const userId = await getCurrentUserId();
    const role = await getUserRole(userId);
    return { userId, role };
}
