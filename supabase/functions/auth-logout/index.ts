/**
 * auth-logout — clean session termination via kill_session RPC.
 *
 * Body  : { global_session_id?: uuid }   (optional; falls back to most recent active)
 * Header: Authorization: Bearer <jwt>
 *
 * Idempotent: re-logout returns success: true.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders } from "../_shared/cors.ts";

function getUserIdFromJwtPayload(jwt: string): string | null {
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return null;
    const norm = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = norm.padEnd(Math.ceil(norm.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded));
    return typeof decoded.sub === 'string' ? decoded.sub : null;
  } catch {
    return null;
  }
}

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin') ?? undefined);

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(JSON.stringify({ error: 'Auth service is not configured.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const authHeader = req.headers.get('Authorization');
    const jwt = authHeader ? authHeader.replace('Bearer ', '') : null;

    let globalSessionId: string | null = null;
    try {
      const body = await req.json();
      globalSessionId = body.global_session_id || null;
    } catch (_) {
      globalSessionId = null;
    }

    let userId: string | null = null;
    if (jwt) {
      try {
        const { data: { user } } = await adminClient.auth.getUser(jwt);
        userId = user?.id ?? null;
      } catch (_) {/* fall through */}
      if (!userId) userId = getUserIdFromJwtPayload(jwt);
    }

    if (!userId) {
      return new Response(JSON.stringify({ success: true, note: 'already_logged_out' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!globalSessionId) {
      const { data: latest } = await adminClient
        .from('global_sessions')
        .select('id').eq('user_id', userId).eq('status', 'ACTIVE')
        .order('started_at', { ascending: false }).limit(1).maybeSingle();
      globalSessionId = latest?.id ?? null;
    }

    if (!globalSessionId) {
      return new Response(JSON.stringify({ success: true, note: 'already_logged_out' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // End the session row (status -> ENDED).
    const { error: updErr } = await adminClient
      .from('global_sessions')
      .update({ status: 'ENDED', ended_at: new Date().toISOString(), ended_reason: 'USER_LOGOUT' })
      .eq('id', globalSessionId).eq('user_id', userId).eq('status', 'ACTIVE');

    if (updErr) {
      console.error('global_sessions logout update failed:', updErr);
      return new Response(JSON.stringify({ error: 'Failed to end active session.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Release any locks held by this session (defensive; should be empty by logout time).
    await adminClient.from('transaction_locks').delete().eq('session_id', globalSessionId);

    await adminClient.from('auth_login_activity').insert({
      user_id: userId, event_type: 'LOGOUT', success: true, source: 'web',
      ip_address: req.headers.get('x-forwarded-for') || 'unknown',
      user_agent:  req.headers.get('user-agent') || 'unknown',
      session_id: globalSessionId,
      metadata: { reason: 'USER_LOGOUT' },
    });

    try {
      await adminClient.from('audit_log').insert({
        user_id: userId, action: 'LOGOUT',
        target_type: null, target_id: null, old_value: null,
        new_value: { global_session_id: globalSessionId, ended_reason: 'USER_LOGOUT' },
      });
    } catch (auditErr) {
      console.warn('Audit log write failed:', auditErr);
    }

    if (jwt) {
      try { await adminClient.auth.admin.signOut(jwt, 'global'); }
      catch (e) { console.warn('admin.signOut failed:', e); }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('auth-logout error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

const port = Number(Deno.env.get('PORT'));
if (Number.isInteger(port) && port > 0) Deno.serve({ port }, handler);
else Deno.serve(handler);
