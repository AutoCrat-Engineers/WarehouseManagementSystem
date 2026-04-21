/**
 * Shared Authentication Utilities
 *
 * Centralized auth helpers used across all service modules.
 * Eliminates duplicate getCurrentUserId/getUserRole/getAuthContext
 * definitions in packingService, packingEngineService, mplService, etc.
 *
 * getUserRole() is backed by the `au_get-user-role` edge function — the
 * browser no longer touches the `profiles` table directly.  Business
 * logic is unchanged: same SELECT, same `'L1'` fallback, same return.
 *
 * @version v0.4.2 — role lookup migrated to edge function
 */
import { getSupabaseClient } from './supabase/client';
import { fetchWithAuth } from './supabase/auth';
import { getEdgeFunctionUrl } from './supabase/info';

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
 * Fetch the role of the currently authenticated user via the
 * `au_get-user-role` edge function.  Defaults to 'L1' if no role is
 * found — same fallback the previous client-side query used.
 *
 * The `userId` parameter is kept for backward compatibility with
 * existing callers but is NOT sent to the server — the edge function
 * always resolves the role for the JWT's authenticated user.  Every
 * current call site passes `getCurrentUserId()`, so behaviour is
 * identical.
 */
export async function getUserRole(_userId?: string): Promise<string> {
    try {
        const res = await fetchWithAuth(getEdgeFunctionUrl('au_get-user-role'), {
            method: 'POST',
        });
        if (!res.ok) return 'L1';
        const json = await res.json();
        return json?.role || 'L1';
    } catch {
        return 'L1';
    }
}

/**
 * Fetch userId and role in a single parallel call.
 * Most service functions need both — this avoids serial calls.
 */
export async function getAuthContext(): Promise<{ userId: string; role: string }> {
    const [userId, role] = await Promise.all([
        getCurrentUserId(),
        getUserRole(),
    ]);
    return { userId, role };
}
