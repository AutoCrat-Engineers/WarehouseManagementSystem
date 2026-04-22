/**
 * _shared/auth.ts — Unified JWT validation + role lookup
 *
 * USAGE:
 *   const ctx = await authenticateRequest(req);
 *   if (!ctx) return unauthorized();
 *   // ctx.userId, ctx.userEmail, ctx.role
 *
 *   // Role-gated function:
 *   const ctx = await authenticateRequest(req, { requireRoles: ['L3','ADMIN'] });
 *   if (!ctx) return forbidden();
 *
 * Every new edge function should call this before touching the DB.
 *
 * Returns a service-role client for privileged DB operations AFTER
 * identity has been verified by the JWT.
 */
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

export interface AuthContext {
    userId:      string;
    userEmail:   string | null;
    role:        string | null;
    isActive:    boolean;
    db:          SupabaseClient;   // service-role client, bypasses RLS
    token:       string;
}

export interface AuthOptions {
    /** Reject if user's role is not in this list. */
    requireRoles?: string[];
    /** Reject inactive / soft-deleted users (default true). */
    requireActive?: boolean;
}

/**
 * Validate the request's Authorization: Bearer <jwt> header.
 *
 * Returns null on any failure (caller should respond 401/403).
 * Never throws for bad input.
 */
export async function authenticateRequest(
    req: Request,
    opts: AuthOptions = {},
): Promise<AuthContext | null> {
    const { requireRoles, requireActive = true } = opts;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) return null;

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anonKey     = Deno.env.get('PUBLISHABLE_KEY')
                     ?? Deno.env.get('SUPABASE_ANON_KEY');

    if (!supabaseUrl || !serviceKey || !anonKey) {
        console.error('[auth] missing env: SUPABASE_URL / SERVICE_ROLE_KEY / PUBLISHABLE_KEY');
        return null;
    }

    // Validate JWT against auth server
    const userClient = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser(token);
    if (authErr || !user) return null;

    // Service-role client for privileged ops
    const db = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
    });

    // Look up role + active state from profiles
    const { data: profile } = await db
        .from('profiles')
        .select('role, is_active, deleted_at')
        .eq('id', user.id)
        .single();

    if (!profile) return null;
    if (requireActive && (!profile.is_active || profile.deleted_at)) return null;
    if (requireRoles && requireRoles.length > 0 &&
        (!profile.role || !requireRoles.includes(profile.role))) {
        return null;
    }

    return {
        userId:    user.id,
        userEmail: user.email ?? null,
        role:      profile.role,
        isActive:  profile.is_active,
        db,
        token,
    };
}
