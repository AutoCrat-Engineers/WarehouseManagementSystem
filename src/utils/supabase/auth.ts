/**
 * Browser-side Supabase auth helpers.
 *
 * Login and logout go through dedicated edge functions (`auth-login`,
 * `auth-logout`, `auth-validate-session`).  This module keeps only the
 * client-side primitives the rest of the app still needs:
 *
 *   - clearLocalAuthSession()   — purge cached Supabase session data after
 *                                 the server has revoked the session.
 *   - setActiveSessionId(id)    — register the global_session_id so every
 *                                 fetchWithAuth call carries `X-Session-Id`.
 *                                 Server-side helpers refuse calls without it.
 *   - fetchWithAuth()           — Bearer-token wrapper around fetch with one
 *                                 transparent refresh+retry on 401, and
 *                                 explicit handling of session-killed errors.
 */

import { getSupabaseClient } from './client';
import { projectId } from './info';

const authStorageKey = `sb-${projectId}-auth-token`;

let activeSessionId: string | null = null;

export function setActiveSessionId(id: string | null): void {
  activeSessionId = id;
}

export function getActiveSessionId(): string | null {
  return activeSessionId;
}

export function clearLocalAuthSession(): void {
  try {
    localStorage.removeItem(authStorageKey);
    localStorage.removeItem(`${authStorageKey}-code-verifier`);
    localStorage.removeItem(`${authStorageKey}-user`);
  } catch (err) {
    console.warn('Local auth session cleanup failed:', err);
  }
  activeSessionId = null;
}

/**
 * Codes the server can return on a session check.  The caller is expected
 * to surface these to the user via SessionGuard's onDisconnect (App.tsx).
 */
export class SessionInvalidError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = 'SessionInvalidError';
  }
}

/**
 * Call a Supabase edge function (or any protected endpoint) with the
 * current user's JWT and the active global_session_id.  On a 401 response,
 * refreshes the session once and retries.  On a structured session-kill
 * response (e.g. `code: SESSION_KILLED`) throws SessionInvalidError so the
 * UI layer can route the user to a clean logout state.
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

  const buildHeaders = (token: string): HeadersInit => {
    const headers: Record<string, string> = {
      ...(options.headers as Record<string, string> ?? {}),
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
    if (activeSessionId) headers['X-Session-Id'] = activeSessionId;
    return headers;
  };

  let response = await fetch(url, { ...options, headers: buildHeaders(session.access_token) });

  if (response.status === 401) {
    // Try to read structured session error before refreshing.
    const cloned = response.clone();
    let body: any = null;
    try { body = await cloned.json(); } catch { /* ignore */ }
    const code = (body?.code ?? '').toString().toUpperCase();

    if (code === 'SESSION_KILLED' || code === 'SESSION_IDLE_EXPIRED'
        || code === 'SESSION_ENDED' || code === 'SESSION_NOT_FOUND'
        || code === 'AUTH_MISSING_SESSION') {
      throw new SessionInvalidError(code, body?.error ?? 'Session is no longer active.');
    }

    // Otherwise treat as JWT expiry — refresh once and retry.
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
