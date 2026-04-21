import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders } from "../_shared/cors.ts";

const SESSION_STATUS = {
  ACTIVE: "ACTIVE",
} as const;

const SESSION_REASON = {
  CONCURRENT_LOGIN: "CONCURRENT_LOGIN",
} as const;

const LOGIN_EVENT = {
  SUCCESS: "LOGIN_SUCCESS",
  FAILED: "LOGIN_FAILED",
  SESSION_KILLED: "SESSION_KILLED",
} as const;

const EMPTY_SESSION_ID = "00000000-0000-0000-0000-000000000000";

function normalizeIdentifier(identifier: string): string {
  return identifier.trim().toLowerCase();
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
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const decoded = JSON.parse(atob(padded));
    return typeof decoded.jti === "string" ? decoded.jti : null;
  } catch {
    return null;
  }
}

async function recordLoginActivity(
  adminClient: any,
  req: Request,
  options: {
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
    identifier: options.identifier,
    normalized_identifier: normalizeIdentifier(options.identifier),
    user_id: options.userId ?? null,
    event_type: options.eventType,
    success: options.success,
    failure_code: options.success ? null : (options.failureCode ?? "UNKNOWN"),
    source: "web",
    ip_address: getClientIp(req),
    user_agent: getUserAgent(req),
    metadata: options.metadata ?? {},
  };

  if (options.sessionId) {
    payload.session_id = options.sessionId;
  }

  if (options.success && !options.sessionId) {
    console.warn("Skipping auth_login_activity success event without session_id:", options.eventType);
    return;
  }

  const { error } = await adminClient.from("auth_login_activity").insert(payload);
  if (error) {
    console.warn("auth_login_activity write failed:", error);
  }
}

async function abandonPendingTransactions(adminClient: any, userId: string): Promise<string[]> {
  const transactionsKilled: string[] = [];

  const { data: pendingMovements, error: movementError } = await adminClient
    .from("inv_movement_headers")
    .select("id")
    .eq("requested_by", userId)
    .eq("status", "PENDING_APPROVAL");

  if (movementError) {
    console.warn("Pending movement lookup failed:", movementError);
  } else if (pendingMovements?.length) {
    for (const movement of pendingMovements) {
      const { error } = await adminClient
        .from("inv_movement_headers")
        .update({ status: "ABANDONED" })
        .eq("id", movement.id);

      if (!error) {
        transactionsKilled.push(movement.id);
      }
    }
  }

  const { data: pendingPacking, error: packingError } = await adminClient
    .from("packing_requests")
    .select("id")
    .eq("created_by", userId)
    .not("status", "in", '("APPROVED","REJECTED","COMPLETED")');

  if (packingError) {
    console.warn("Pending packing lookup failed:", packingError);
  } else if (pendingPacking?.length) {
    for (const packing of pendingPacking) {
      const { error } = await adminClient
        .from("packing_requests")
        .update({ status: "ABANDONED" })
        .eq("id", packing.id);

      if (!error) {
        transactionsKilled.push(packing.id);
      }
    }
  }

  return transactionsKilled;
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req.headers.get("origin") ?? undefined);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const { email, password } = await req.json();

    if (typeof email !== "string" || typeof password !== "string" || !email.trim() || !password) {
      return new Response(JSON.stringify({ error: "Email and password are required." }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const normalizedEmail = normalizeIdentifier(email);
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const supabaseServiceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

    if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
      console.error("Missing auth-login env configuration.");
      return new Response(JSON.stringify({ error: "Auth service is not configured." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    let finalSession: any;

    const performSignIn = async () => {
      const { data, error } = await anonClient.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error || !data.session || !data.user) {
        await recordLoginActivity(adminClient, req, {
          identifier: normalizedEmail,
          eventType: LOGIN_EVENT.FAILED,
          success: false,
          failureCode: error?.message || "INVALID_CREDENTIALS",
        });

        return null;
      }

      return data;
    };

    const signInData = await performSignIn();
    if (!signInData) {
      return new Response(JSON.stringify({ error: "Invalid credentials" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    finalSession = signInData.session;
    const userId = signInData.user.id;

    const { data: profile, error: profileError } = await adminClient
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    if (profileError || !profile) {
      try { await adminClient.auth.admin.signOut(finalSession.access_token, "global"); } catch (_) { /* best effort */ }
      await recordLoginActivity(adminClient, req, {
        identifier: normalizedEmail,
        userId,
        eventType: LOGIN_EVENT.FAILED,
        success: false,
        failureCode: "UNKNOWN_IDENTIFIER",
      });

      return new Response(JSON.stringify({ error: "User profile not found." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!profile.is_active || profile.deleted_at) {
      try { await adminClient.auth.admin.signOut(finalSession.access_token, "global"); } catch (_) { /* best effort */ }
      await recordLoginActivity(adminClient, req, {
        identifier: normalizedEmail,
        userId,
        eventType: LOGIN_EVENT.FAILED,
        success: false,
        failureCode: "ACCOUNT_LOCKED",
      });

      return new Response(JSON.stringify({ error: "Account deactivated. Contact your administrator." }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let concurrentKill = false;
    let transactionsKilled: string[] = [];

    const { data: activeSessions, error: activeSessionsError } = await adminClient
      .from("global_sessions")
      .select("id")
      .eq("user_id", userId)
      .eq("status", SESSION_STATUS.ACTIVE);

    if (activeSessionsError) {
      console.error("Active session lookup failed:", activeSessionsError);
      try { await adminClient.auth.admin.signOut(finalSession.access_token, "global"); } catch (_) { /* best effort */ }
      return new Response(JSON.stringify({ error: "Failed to inspect active sessions." }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (activeSessions && activeSessions.length > 0) {
      concurrentKill = true;
      transactionsKilled = await abandonPendingTransactions(adminClient, userId);

      const { error: killError } = await adminClient.rpc("kill_other_sessions", {
        p_user_id: userId,
        p_keep_session_id: EMPTY_SESSION_ID,
      });

      if (killError) {
        console.error("kill_other_sessions failed:", killError);
        try { await adminClient.auth.admin.signOut(finalSession.access_token, "global"); } catch (_) { /* best effort */ }
        return new Response(JSON.stringify({ error: "Failed to terminate previous session." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      for (const oldSession of activeSessions) {
        await recordLoginActivity(adminClient, req, {
          identifier: normalizedEmail,
          userId,
          eventType: LOGIN_EVENT.SESSION_KILLED,
          success: true,
          sessionId: oldSession.id,
          metadata: { reason: "superseded" },
        });
      }

      try {
        await adminClient.auth.admin.signOut(finalSession.access_token, "global");
      } catch (signOutErr) {
        console.warn("Concurrent global signOut failed:", signOutErr);
      }

      const reSignInData = await performSignIn();
      if (!reSignInData) {
        return new Response(JSON.stringify({ error: "Failed to establish a fresh session after superseding the previous login." }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      finalSession = reSignInData.session;
    }

    await adminClient
      .from("profiles")
      .update({ last_login_at: new Date().toISOString() })
      .eq("id", userId);

    const sessionInsert: Record<string, unknown> = {
      user_id: userId,
      login_ip: getClientIp(req),
      user_agent: getUserAgent(req),
      status: SESSION_STATUS.ACTIVE,
    };

    const accessTokenJti = decodeJwtJti(finalSession.access_token);
    if (accessTokenJti) {
      sessionInsert.access_token_jti = accessTokenJti;
    }

    let globalSession: { id: string } | null = null;
    let sessionError: any = null;

    const insertResult = await adminClient
      .from("global_sessions")
      .insert(sessionInsert)
      .select("id")
      .single();

    globalSession = insertResult.data;
    sessionError = insertResult.error;

    if (sessionError?.message?.includes("access_token_jti")) {
      delete sessionInsert.access_token_jti;
      const fallbackInsert = await adminClient
        .from("global_sessions")
        .insert(sessionInsert)
        .select("id")
        .single();
      globalSession = fallbackInsert.data;
      sessionError = fallbackInsert.error;
    }

    if (sessionError || !globalSession) {
      console.error("Failed to create global session:", sessionError);
      await recordLoginActivity(adminClient, req, {
        identifier: normalizedEmail,
        userId,
        eventType: LOGIN_EVENT.FAILED,
        success: false,
        failureCode: "AUTH_SESSION_INIT_FAILED",
        metadata: {
          db_code: sessionError?.code ?? null,
          db_message: sessionError?.message ?? null,
        },
      });

      try { await adminClient.auth.admin.signOut(finalSession.access_token, "global"); } catch (_) { /* best effort */ }

      return new Response(JSON.stringify({
        error: "Authentication session initialization failed.",
        code: "AUTH_SESSION_INIT_FAILED",
      }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    await recordLoginActivity(adminClient, req, {
      identifier: normalizedEmail,
      userId,
      eventType: LOGIN_EVENT.SUCCESS,
      success: true,
      sessionId: globalSession.id,
      metadata: {
        concurrent_kill: concurrentKill,
        transactions_killed: transactionsKilled,
      },
    });

    try {
      await adminClient.from("audit_log").insert({
        user_id: userId,
        action: "LOGIN",
        target_type: null,
        target_id: null,
        old_value: null,
        new_value: {
          global_session_id: globalSession.id,
          concurrent_kill: concurrentKill,
          ended_reason: concurrentKill ? SESSION_REASON.CONCURRENT_LOGIN : null,
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
      transactions_killed: transactionsKilled,
    }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("auth-login error:", err);
    return new Response(JSON.stringify({ error: "Internal server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
};

const port = Number(Deno.env.get("PORT"));

if (Number.isInteger(port) && port > 0) {
  Deno.serve({ port }, handler);
} else {
  Deno.serve(handler);
}
