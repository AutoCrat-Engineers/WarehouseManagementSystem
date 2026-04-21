/**
 * Browser-side Supabase auth storage helpers.
 *
 * Login and logout are handled by Edge Functions. The frontend only needs to
 * clear cached Supabase session data after the server has revoked the session.
 */

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
