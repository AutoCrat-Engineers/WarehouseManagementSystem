/**
 * auth-validate-session — thin wrapper around enforce_active_session.
 *
 * Body  : { global_session_id: uuid }
 * Header: Authorization: Bearer <jwt>
 *
 * Returns:
 *   200 { valid: true,  status: 'active', idle_remaining_seconds }
 *   200 { valid: false, status: 'idle_expired' | 'killed' | 'ended' | 'not_found', code }
 *   401 { valid: false, status: 'invalid_jwt' }
 *   400 { valid: false, status: 'missing_session_context' }
 *
 * Note: this endpoint DOES touch last_activity_at on every successful call.
 * The client polls it every ~60s plus on focus/visibility.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders } from "../_shared/cors.ts";

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
      return new Response(JSON.stringify({ valid: false, status: 'server_error' }), {
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
      return new Response(JSON.stringify({ valid: false, status: 'invalid_request' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!jwt || !globalSessionId) {
      return new Response(JSON.stringify({ valid: false, status: 'missing_session_context' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: { user }, error: userError } = await adminClient.auth.getUser(jwt);
    if (userError || !user) {
      return new Response(JSON.stringify({ valid: false, status: 'invalid_jwt' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: enforceResult, error: enforceErr } = await adminClient.rpc('enforce_active_session', {
      p_session_id: globalSessionId,
      p_user_id:    user.id,
    });

    if (enforceErr) {
      console.error('enforce_active_session failed:', enforceErr);
      return new Response(JSON.stringify({ valid: false, status: 'server_error' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const status = (enforceResult ?? '').toString().toUpperCase();

    if (status === 'ACTIVE') {
      // Best-effort fetch of remaining idle window (no extra activity touch — we just touched).
      const { data: sessionRow } = await adminClient
        .from('global_sessions')
        .select('last_activity_at, idle_timeout_seconds')
        .eq('id', globalSessionId)
        .maybeSingle();

      let idle_remaining_seconds: number | null = null;
      if (sessionRow?.last_activity_at && sessionRow?.idle_timeout_seconds) {
        const elapsed = Math.floor((Date.now() - new Date(sessionRow.last_activity_at).getTime()) / 1000);
        idle_remaining_seconds = Math.max(0, (sessionRow.idle_timeout_seconds as number) - elapsed);
      }

      return new Response(JSON.stringify({
        valid: true, status: 'active',
        idle_remaining_seconds,
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({
      valid: false,
      status: status.toLowerCase(),
      code: status, // also surface as code for symmetry with edge-fn _shared/session
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('auth-validate-session error:', err);
    return new Response(JSON.stringify({ valid: false, status: 'server_error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

const port = Number(Deno.env.get('PORT'));
if (Number.isInteger(port) && port > 0) Deno.serve({ port }, handler);
else Deno.serve(handler);
