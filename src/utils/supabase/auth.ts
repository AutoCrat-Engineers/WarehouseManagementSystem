/**
 * Browser-side Supabase auth helpers.
 *
 * Login and logout go through dedicated edge functions (`auth-login`,
 * `auth-logout`, `auth-validate-session`).  This module keeps only the
 * client-side primitives the rest of the app still needs:
 *
 *   - clearLocalAuthSession()  — purge cached Supabase session data after
 *                                the server has revoked the session.
 *   - fetchWithAuth()          — thin wrapper around fetch() that injects
 *                                the current Bearer token and transparently
 *                                retries once after a 401 with a refreshed
 *                                token.  Used by every client → edge-fn
 *                                call (au_*, sg_*, pac_*).
 */

import { getSupabaseClient } from './client';
import { projectId } from './info';

const authStorageKey = `sb-${projectId}-auth-token`;

export function clearLocalAuthSession(): void {
  try {
    localStorage.removeItem(authStorageKey);
    localStorage.removeItem(`${authStorageKey}-code-verifier`);
    localStorage.removeItem(`${authStorageKey}-user`);
  } catch (err) {
    console.warn('Local auth session cleanup failed:', err);
  }
}

/**
 * Call a Supabase edge function (or any protected endpoint) with the
 * current user's JWT.  On a 401 response, refreshes the session once and
 * retries.  If refresh fails, surfaces an auth error for the caller.
 *
 * Semantics preserved from the pre-login2 implementation so every edge
 * function client (PackingDetail, PalletDashboard, PackingModule,
 * PackingDetails, packingService, App) keeps working unchanged.
 */
export async function fetchWithAuth(
  url: string,
  options: RequestInit = {},
): Promise<Response> {
  const supabase = getSupabaseClient();

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session?.access_token) {
    throw new Error('No authentication token available. Please login.');
  }

  const buildHeaders = (token: string): HeadersInit => ({
    ...(options.headers || {}),
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  });

  // First attempt with the current token.
  let response = await fetch(url, {
    ...options,
    headers: buildHeaders(session.access_token),
  });

  // On 401, refresh once and retry.
  if (response.status === 401) {
    const { data: refreshData, error: refreshError } = await supabase.auth.refreshSession();
    if (refreshError || !refreshData.session?.access_token) {
      throw new Error('Authentication failed. Please login again.');
    }
    response = await fetch(url, {
      ...options,
      headers: buildHeaders(refreshData.session.access_token),
    });
  }

  return response;
}
