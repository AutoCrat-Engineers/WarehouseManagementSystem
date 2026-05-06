/**
 * _shared/session.ts — Session-aware authentication for edge functions.
 *
 * Builds on _shared/auth.ts.  Adds:
 *   • global_session validation (so killed/idle sessions can't act on data
 *     even while their JWT is still inside its TTL).
 *   • last_activity_at touch on every protected call.
 *   • acquireLock / releaseLock helpers for critical mutations.
 *
 * USAGE (replaces authenticateRequest in any protected edge function):
 *
 *   import { requireActiveSession, withTransactionLock } from '../_shared/session.ts';
 *
 *   const ctx = await requireActiveSession(req);
 *   if (!ctx.ok) return ctx.response;
 *
 *   // For critical mutations, wrap the body:
 *   return await withTransactionLock(ctx, {
 *     key: 'gr_confirm_receipt:' + grId,
 *     label: 'Confirming Goods Receipt #' + grNumber,
 *     ttlSeconds: 90,
 *   }, async () => {
 *     // ...do the irreversible work...
 *     return new Response(...);
 *   });
 */
import { authenticateRequest, AuthContext, AuthOptions } from './auth.ts';
import { getCorsHeaders } from './cors.ts';

const SESSION_HEADER = 'X-Session-Id';

export interface SessionContext extends AuthContext {
  sessionId: string;
}

export type SessionResult =
  | { ok: true;  ctx: SessionContext }
  | { ok: false; response: Response };

interface SessionGuardOptions extends AuthOptions {
  /** Skip touching last_activity_at — use for read-only/heartbeat paths. */
  skipActivityTouch?: boolean;
}

function corsJson(req: Request, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req.headers.get('origin') ?? undefined), 'Content-Type': 'application/json' },
  });
}

/**
 * Validate JWT + global_session in one call.  Reject killed/idle/missing
 * sessions with a structured error the client can surface verbatim.
 */
export async function requireActiveSession(
  req: Request,
  opts: SessionGuardOptions = {},
): Promise<SessionResult> {
  const auth = await authenticateRequest(req, opts);
  if (!auth) {
    return {
      ok: false,
      response: corsJson(req, 401, { error: 'Unauthenticated', code: 'AUTH_INVALID_JWT' }),
    };
  }

  let sessionId = req.headers.get(SESSION_HEADER) ?? req.headers.get(SESSION_HEADER.toLowerCase());

  // Fallback: many legacy components call edge functions with a raw fetch()
  // and don't yet attach the X-Session-Id header.  Resolve the user's single
  // ACTIVE session row by user_id from their JWT.  We still enforce against
  // global_sessions so a killed/idle session is rejected — only the explicit
  // jti binding is dropped on this path.
  if (!sessionId) {
    const { data: row, error: lookupErr } = await auth.db
      .from('global_sessions')
      .select('id')
      .eq('user_id', auth.userId)
      .eq('status', 'ACTIVE')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (lookupErr) {
      console.error('[session] active session lookup failed:', lookupErr);
      return {
        ok: false,
        response: corsJson(req, 500, { error: 'Session lookup failed', code: 'AUTH_SESSION_LOOKUP_FAILED' }),
      };
    }
    if (!row?.id) {
      return {
        ok: false,
        response: corsJson(req, 401, { error: 'No active session', code: 'AUTH_NO_ACTIVE_SESSION' }),
      };
    }
    sessionId = row.id;
  }

  if (opts.skipActivityTouch) {
    return { ok: true, ctx: { ...auth, sessionId } };
  }

  const { data, error } = await auth.db.rpc('enforce_active_session', {
    p_session_id: sessionId,
    p_user_id:    auth.userId,
  });

  if (error) {
    console.error('[session] enforce_active_session failed:', error);
    return {
      ok: false,
      response: corsJson(req, 500, { error: 'Session validation failed', code: 'AUTH_SESSION_RPC_FAILED' }),
    };
  }

  switch ((data ?? '').toString().toUpperCase()) {
    case 'ACTIVE':
      return { ok: true, ctx: { ...auth, sessionId } };
    case 'IDLE_EXPIRED':
      return {
        ok: false,
        response: corsJson(req, 401, { error: 'Session expired due to inactivity', code: 'SESSION_IDLE_EXPIRED' }),
      };
    case 'KILLED':
      return {
        ok: false,
        response: corsJson(req, 401, { error: 'Session was ended because your account signed in elsewhere', code: 'SESSION_KILLED' }),
      };
    case 'ENDED':
      return {
        ok: false,
        response: corsJson(req, 401, { error: 'Session has been logged out', code: 'SESSION_ENDED' }),
      };
    case 'NOT_FOUND':
    default:
      return {
        ok: false,
        response: corsJson(req, 401, { error: 'Session not found', code: 'SESSION_NOT_FOUND' }),
      };
  }
}

/**
 * Acquire a transaction lock for the duration of an irreversible operation.
 * If another session already holds the lock, returns a 409 SESSION_BUSY
 * shaped exactly like the auth-login response so the client can reuse one
 * "force takeover" UX.
 *
 * The lock is released in a `finally` regardless of whether the body throws.
 */
export async function withTransactionLock<T extends Response>(
  ctx: SessionContext,
  args: { key: string; label: string; ttlSeconds?: number; metadata?: Record<string, unknown> },
  body: () => Promise<T>,
): Promise<Response> {
  const ttlSeconds = args.ttlSeconds ?? 90;

  const { data, error } = await ctx.db.rpc('acquire_transaction_lock', {
    p_user_id:     ctx.userId,
    p_session_id:  ctx.sessionId,
    p_lock_key:    args.key,
    p_op_label:    args.label,
    p_ttl_seconds: ttlSeconds,
    p_metadata:    args.metadata ?? {},
  });

  if (error) {
    console.error('[session] acquire_transaction_lock failed:', error);
    return new Response(JSON.stringify({ error: 'Failed to acquire transaction lock', code: 'LOCK_RPC_FAILED' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (!data?.acquired) {
    return new Response(JSON.stringify({
      error:    'Another session is performing this operation',
      code:     'SESSION_BUSY',
      lock:     data?.lock ?? null,
    }), {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    return await body();
  } finally {
    const { error: relErr } = await ctx.db.rpc('release_transaction_lock', {
      p_user_id:    ctx.userId,
      p_lock_key:   args.key,
      p_session_id: ctx.sessionId,
    });
    if (relErr) {
      console.warn('[session] release_transaction_lock failed:', relErr);
    }
  }
}

/**
 * One-shot guard for a mutation handler.  Combines requireActiveSession +
 * a per-request transaction lock so concurrent logins for the same user
 * are blocked while ANY mutation is in flight (not just the few "critical"
 * ones).
 *
 * Lock key is randomised per call (so two simultaneous mutations from the
 * same session do not deadlock on each other), but `list_user_active_locks`
 * still surfaces all of them to auth-login for the SESSION_BUSY check.
 *
 * USAGE (replaces the auth + body wiring in any mutation edge function):
 *
 *   export const handler = withErrorHandler((req) =>
 *     withMutationGuard(req, { label: 'Confirming GR' }, async (ctx) => {
 *       // ...mutation body using ctx.db, ctx.userId, ctx.sessionId...
 *       return jsonResponse(data, { origin });
 *     }));
 */
export async function withMutationGuard(
  req: Request,
  opts: {
    label:        string;
    ttlSeconds?:  number;
    requireRoles?: string[];
    metadata?:    Record<string, unknown>;
  },
  body: (ctx: SessionContext) => Promise<Response>,
): Promise<Response> {
  const session = await requireActiveSession(req, { requireRoles: opts.requireRoles });
  if (!session.ok) return session.response;
  const ctx = session.ctx;

  const lockKey = `mutation:${ctx.sessionId}:${crypto.randomUUID()}`;
  return await withTransactionLock(ctx, {
    key:        lockKey,
    label:      opts.label,
    ttlSeconds: opts.ttlSeconds ?? 60,
    metadata:   opts.metadata,
  }, () => body(ctx));
}
