/**
 * Supabase Project Configuration
 *
 * All values are sourced exclusively from environment variables.
 * No hardcoded keys or project IDs — these MUST be set in .env.
 *
 * For local development, create a .env file with:
 *   VITE_SUPABASE_URL=https://your-project.supabase.co
 *   VITE_SUPABASE_ANON_KEY=your-anon-key
 *   VITE_FUNCTIONS_URL=https://your-project.supabase.co/functions/v1
 */

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ── Fail-fast validation ──────────────────────────────────────────────────
// The app MUST NOT start without these critical environment variables.
if (!supabaseUrl) {
  throw new Error(
    '[FATAL] VITE_SUPABASE_URL is not set. ' +
    'Add it to your .env file. See .env.example for required variables.'
  );
}

if (!supabaseAnonKey) {
  throw new Error(
    '[FATAL] VITE_SUPABASE_ANON_KEY is not set. ' +
    'Add it to your .env file. See .env.example for required variables.'
  );
}

// Extract project ID from URL (e.g., https://xyz.supabase.co → xyz)
function extractProjectId(url: string): string {
  const match = url.match(/https:\/\/([^.]+)\.supabase\.co/);
  if (!match) {
    throw new Error(
      `[FATAL] VITE_SUPABASE_URL has invalid format: "${url}". ` +
      'Expected format: https://<project-id>.supabase.co'
    );
  }
  return match[1];
}

export const projectId = extractProjectId(supabaseUrl);
export const publicAnonKey = supabaseAnonKey;

/**
 * Base URL for Supabase Edge Function calls.
 *
 * For local dev: set VITE_FUNCTIONS_URL=http://127.0.0.1:54321/functions/v1
 * For production: leave unset — auto-derives from VITE_SUPABASE_URL.
 */
export const FUNCTIONS_BASE: string =
  import.meta.env.VITE_FUNCTIONS_URL ||
  `https://${projectId}.supabase.co/functions/v1`;

/**
 * Build the full URL for a specific edge function.
 * Use this instead of hardcoding URLs in components.
 *
 * @example getEdgeFunctionUrl('sm_get-movements')
 * @example getEdgeFunctionUrl('send-dispatch-email')
 * @example getEdgeFunctionUrl('make-server-9c637d11/blanket-orders')
 */
export function getEdgeFunctionUrl(functionPath: string): string {
  return `${FUNCTIONS_BASE}/${functionPath}`;
}