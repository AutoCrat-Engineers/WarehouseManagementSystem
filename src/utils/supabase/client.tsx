import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Singleton Supabase client.
 *
 * Uses environment variables directly — no hardcoded keys or project IDs.
 * The fail-fast validation in info.tsx guarantees these are set at startup.
 */
let supabaseInstance: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!supabaseInstance) {
    const url = import.meta.env.VITE_SUPABASE_URL;
    const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

    if (!url || !key) {
      throw new Error(
        '[FATAL] VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY missing. Check .env file.'
      );
    }

    supabaseInstance = createClient(url, key);
  }
  return supabaseInstance;
}
