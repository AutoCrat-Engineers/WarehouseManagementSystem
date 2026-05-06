/**
 * auth-login — single-active-session login.
 *
 * Flow:
 *   1. Validate input.
 *   2. Look up profile.  If `locked_at IS NOT NULL` → 423 ACCOUNT_LOCKED.
 *   3. signInWithPassword.  On failure: record_failed_login (3 strikes → lock).
 *   4. On success: query in-flight transaction_locks for this user.
 *        - If any AND request did NOT include `force_takeover: true`
 *          → 409 SESSION_BUSY with the live lock details.
 *        - Otherwise (no locks OR force=true): proceed.
 *   5. kill_user_sessions (clean RPC; cascades transaction_locks release).
 *   6. signOut(global) + re-signIn so the issued refresh token survives the kill.
 *   7. Insert global_sessions row with access_token_jti binding.
 *   8. reset_failed_login.  Audit + activity logs.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders } from "../_shared/cors.ts";

const SESSION_STATUS_ACTIVE = "ACTIVE";

const LOGIN_EVENT = {
  SUCCESS: "LOGIN_SUCCESS",
  FAILED: "LOGIN_FAILED",
  SESSION_KILLED: "SESSION_KILLED",
  TAKEOVER_FORCED: "TAKEOVER_FORCED",
} as const;

const FAILED_LOGIN_THRESHOLD = 3;

function normalizeIdentifier(s: string): string {
  return s.trim().toLowerCase();
}
function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for") || req.headers.get("cf-connecting-ip") || "unknown";
}
function getUserAgent(req: Request): string {
  return req.headers.get("user-agent") || "unknown";
}

function decodeJwtJti(jwt: string): string | null {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return null;
    const norm = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = norm.padEnd(Math.ceil(norm.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded));
    return typeof decoded.jti === "string" ? decoded.jti : null;
  } catch {
    return null;
  }
}

async function recordActivity(
  admin: any,
  req: Request,
  o: {
    identifier: string;
    userId?: string | null;
    eventType: string;
    success: boolean;
    failureCode?: string | null;
    sessionId?: string | null;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  const payload: Record<string, unknown> = {
    identifier: o.identifier,
    normalized_identifier: normalizeIdentifier(o.identifier),
    user_id: o.userId ?? null,
    event_type: o.eventType,
    success: o.success,
    failure_code: o.success ? null : (o.failureCode ?? "UNKNOWN"),
    source: "web",
    ip_address: getClientIp(req),
    user_agent: getUserAgent(req),
    metadata: o.metadata ?? {},
  };
  if (o.sessionId) payload.session_id = o.sessionId;
  // Skip success rows that have no session yet (FK NOT NULL on sessions added later).
  if (o.success && !o.sessionId && o.eventType === LOGIN_EVENT.SUCCESS) return;

  const { error } = await admin.from("auth_login_activity").insert(payload);
  if (error) console.warn("auth_login_activity insert failed:", error);
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin") ?? undefined);

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body = await req.json().catch(() => ({} as any));
    const email: string = body.email;
    const password: string = body.password;
    const forceTakeover: boolean = body.force_takeover === true;

    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      return new Response(JSON.stringify({ error: "Email and password are required." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = normalizeIdentifier(email);
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      console.error("Missing auth-login env configuration.");
      return new Response(JSON.stringify({ error: "Auth service is not configured." }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // --- 1. Pre-flight: is this account locked? --------------------------------
    const { data: preProfile } = await adminClient
      .from("profiles")
      .select("id, locked_at, lock_reason, is_active, deleted_at")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (preProfile?.locked_at || preProfile?.deleted_at || preProfile?.is_active === false) {
      await recordActivity(adminClient, req, {
        identifier: normalizedEmail,
        userId: preProfile?.id ?? null,
        eventType: LOGIN_EVENT.FAILED,
        success: false,
        failureCode: "ACCOUNT_LOCKED",
      });
      return new Response(JSON.stringify({
        error: "Account is locked. Please contact your administrator.",
        code: "ACCOUNT_LOCKED",
        reason: preProfile?.lock_reason ?? null,
      }), { status: 423, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- 2. signInWithPassword (record failures, lock at threshold) -----------
    const performSignIn = async () => {
      const { data, error } = await anonClient.auth.signInWithPassword({
        email: normalizedEmail, password,
      });
      if (error || !data.session || !data.user) return null;
      return data;
    };

    let signInData = await performSignIn();

    if (!signInData) {
      const { data: failResult } = await adminClient.rpc("record_failed_login", {
        p_normalized_identifier: normalizedEmail,
        p_threshold: FAILED_LOGIN_THRESHOLD,
      });

      const lockedNow = failResult?.locked === true;
      await recordActivity(adminClient, req, {
        identifier: normalizedEmail,
        userId: failResult?.profile_id ?? null,
        eventType: LOGIN_EVENT.FAILED,
        success: false,
        failureCode: lockedNow ? "ACCOUNT_LOCKED_NOW" : "INVALID_CREDENTIALS",
        metadata: { failed_count: failResult?.count ?? null },
      });

      if (lockedNow) {
        return new Response(JSON.stringify({
          error: `Account locked after ${FAILED_LOGIN_THRESHOLD} failed attempts. Contact your administrator.`,
          code: "ACCOUNT_LOCKED_NOW",
        }), { status: 423, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const remaining = Math.max(0, FAILED_LOGIN_THRESHOLD - (failResult?.count ?? 0));
      return new Response(JSON.stringify({
        error: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
        attempts_remaining: remaining,
      }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    let finalSession = signInData.session;
    const userId = signInData.user.id;

    // --- 3. Profile re-fetch (full row) --------------------------------------
    const { data: profile, error: profileError } = await adminClient
      .from("profiles").select("*").eq("id", userId).single();

    if (profileError || !profile) {
      try { await adminClient.auth.admin.signOut(finalSession.access_token, "global"); } catch (_) {}
      await recordActivity(adminClient, req, {
        identifier: normalizedEmail, userId,
        eventType: LOGIN_EVENT.FAILED, success: false,
        failureCode: "UNKNOWN_IDENTIFIER",
      });
      return new Response(JSON.stringify({ error: "User profile not found.", code: "PROFILE_NOT_FOUND" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!profile.is_active || profile.deleted_at || profile.locked_at) {
      try { await adminClient.auth.admin.signOut(finalSession.access_token, "global"); } catch (_) {}
      await recordActivity(adminClient, req, {
        identifier: normalizedEmail, userId,
        eventType: LOGIN_EVENT.FAILED, success: false, failureCode: "ACCOUNT_LOCKED",
      });
      return new Response(JSON.stringify({
        error: "Account is locked. Please contact your administrator.",
        code: "ACCOUNT_LOCKED",
      }), { status: 423, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- 4. In-flight transaction lock check ---------------------------------
    const { data: liveLocks, error: locksErr } = await adminClient
      .rpc("list_user_active_locks", { p_user_id: userId });

    if (locksErr) {
      console.error("list_user_active_locks failed:", locksErr);
      try { await adminClient.auth.admin.signOut(finalSession.access_token, "global"); } catch (_) {}
      return new Response(JSON.stringify({ error: "Failed to check in-flight operations.", code: "LOCKS_RPC_FAILED" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (Array.isArray(liveLocks) && liveLocks.length > 0 && !forceTakeover) {
      // Don't burn this auth session; sign out so refresh token doesn't leak.
      try { await adminClient.auth.admin.signOut(finalSession.access_token, "global"); } catch (_) {}
      await recordActivity(adminClient, req, {
        identifier: normalizedEmail, userId,
        eventType: LOGIN_EVENT.FAILED, success: false, failureCode: "SESSION_BUSY",
        metadata: { live_locks: liveLocks },
      });
      return new Response(JSON.stringify({
        error: "This account has an unfinished operation in another session.",
        code: "SESSION_BUSY",
        force_takeover_required: true,
        in_flight: liveLocks.map((l: any) => ({
          op_label: l.op_label,
          acquired_at: l.acquired_at,
          age_seconds: Math.floor((Date.now() - new Date(l.acquired_at).getTime()) / 1000),
        })),
      }), { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- 5. Kill old sessions (clean RPC) ------------------------------------
    let concurrentKill = false;
    let killedCount = 0;

    const { data: killCount, error: killErr } = await adminClient.rpc("kill_user_sessions", {
      p_user_id: userId,
      p_reason: forceTakeover ? "FORCE_TAKEOVER" : "CONCURRENT_LOGIN",
      p_keep_id: null,
    });

    if (killErr) {
      console.error("kill_user_sessions failed:", killErr);
      try { await adminClient.auth.admin.signOut(finalSession.access_token, "global"); } catch (_) {}
      return new Response(JSON.stringify({ error: "Failed to terminate previous sessions.", code: "KILL_RPC_FAILED" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    killedCount = Number(killCount ?? 0);
    concurrentKill = killedCount > 0 || forceTakeover;

    // --- 6. Re-signIn so the new refresh token survives signOut(global) ------
    if (concurrentKill) {
      try {
        await adminClient.auth.admin.signOut(finalSession.access_token, "global");
      } catch (e) {
        console.warn("Concurrent global signOut failed:", e);
      }
      const reSignIn = await performSignIn();
      if (!reSignIn) {
        return new Response(JSON.stringify({
          error: "Failed to establish a fresh session after takeover.",
          code: "RESIGNIN_FAILED",
        }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      finalSession = reSignIn.session;
    }

    // --- 7. Persist global session row ---------------------------------------
    const sessionInsert: Record<string, unknown> = {
      user_id: userId,
      login_ip: getClientIp(req),
      user_agent: getUserAgent(req),
      status: SESSION_STATUS_ACTIVE,
      last_activity_at: new Date().toISOString(),
    };

    const jti = decodeJwtJti(finalSession.access_token);
    if (jti) sessionInsert.access_token_jti = jti;

    const { data: globalSession, error: sessionError } = await adminClient
      .from("global_sessions").insert(sessionInsert).select("id").single();

    if (sessionError || !globalSession) {
      console.error("Failed to create global session:", sessionError);
      try { await adminClient.auth.admin.signOut(finalSession.access_token, "global"); } catch (_) {}
      await recordActivity(adminClient, req, {
        identifier: normalizedEmail, userId,
        eventType: LOGIN_EVENT.FAILED, success: false,
        failureCode: "AUTH_SESSION_INIT_FAILED",
        metadata: { db_message: sessionError?.message ?? null },
      });
      return new Response(JSON.stringify({
        error: "Authentication session initialization failed.",
        code: "AUTH_SESSION_INIT_FAILED",
      }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // --- 8. Post-login bookkeeping -------------------------------------------
    await adminClient.rpc("reset_failed_login", { p_user_id: userId });
    await adminClient.from("profiles").update({ last_login_at: new Date().toISOString() }).eq("id", userId);

    await recordActivity(adminClient, req, {
      identifier: normalizedEmail, userId,
      eventType: forceTakeover ? LOGIN_EVENT.TAKEOVER_FORCED : LOGIN_EVENT.SUCCESS,
      success: true, sessionId: globalSession.id,
      metadata: {
        concurrent_kill: concurrentKill,
        killed_count: killedCount,
        force_takeover: forceTakeover,
      },
    });

    try {
      await adminClient.from("audit_log").insert({
        user_id: userId,
        action: forceTakeover ? "LOGIN_FORCE_TAKEOVER" : "LOGIN",
        target_type: null, target_id: null, old_value: null,
        new_value: {
          global_session_id: globalSession.id,
          concurrent_kill: concurrentKill,
          killed_count: killedCount,
          force_takeover: forceTakeover,
          ip: getClientIp(req),
          user_agent: getUserAgent(req),
        },
      });
    } catch (auditErr) {
      console.warn("Audit log write failed:", auditErr);
    }

    return new Response(JSON.stringify({
      access_token: finalSession.access_token,
      refresh_token: finalSession.refresh_token,
      expires_at: finalSession.expires_at,
      global_session_id: globalSession.id,
      idle_timeout_seconds: 600,
      user_profile: {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        role: profile.role,
        is_active: profile.is_active,
        employee_id: profile.employee_id || null,
        department: profile.department || null,
        shift: profile.shift || null,
      },
      concurrent_kill: concurrentKill,
      killed_count: killedCount,
      force_takeover: forceTakeover,
    }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("auth-login error:", err);
    return new Response(JSON.stringify({ error: "Internal server error", code: "INTERNAL" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

const port = Number(Deno.env.get("PORT"));
if (Number.isInteger(port) && port > 0) Deno.serve({ port }, handler);
else Deno.serve(handler);
