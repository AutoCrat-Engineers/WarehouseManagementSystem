/**
 * Edge Function Shared Config
 * Location: supabase/functions/_shared/config.ts
 *
 * Rate limit and session constants used across auth edge functions.
 * Mirror of src/config/rateLimitConfig.ts — kept separate because
 * edge functions cannot import from src/.
 */
export const CONFIG = {
  // Maximum concurrent active sessions per user
  // 1 = enterprise rule: one active login at a time per user
  MAX_CONCURRENT_SESSIONS: 1,

  // Max login attempts per user per window before soft-block
  LOGIN_ATTEMPTS_PER_WINDOW: 20,
  LOGIN_WINDOW_MINUTES: 15,

  // Session auto-expiry after inactivity (must match config.toml)
  SESSION_INACTIVITY_HOURS: 8,

  // Token refresh interval (milliseconds)
  TOKEN_REFRESH_INTERVAL_MS: 30 * 60 * 1000,
} as const;
