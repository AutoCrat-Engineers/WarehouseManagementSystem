import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders } from "../_shared/cors.ts";

const handler = async (req: Request): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req.headers.get('origin') ?? undefined);

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

    if (!supabaseUrl || !supabaseServiceRoleKey) {
      return new Response(JSON.stringify({ valid: false, status: 'server_error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
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
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!jwt || !globalSessionId) {
      return new Response(JSON.stringify({ valid: false, status: 'missing_session_context' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: { user }, error: userError } = await adminClient.auth.getUser(jwt);

    if (userError || !user) {
      return new Response(JSON.stringify({ valid: false, status: 'invalid_jwt' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: validatedUserId, error: validateError } = await adminClient.rpc('validate_active_session', {
      p_session_id: globalSessionId,
    });

    if (validateError) {
      console.error('validate_active_session failed:', validateError);
      return new Response(JSON.stringify({ valid: false, status: 'server_error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!validatedUserId) {
      const { data: sessionRow } = await adminClient
        .from('global_sessions')
        .select('status, ended_reason')
        .eq('id', globalSessionId)
        .eq('user_id', user.id)
        .maybeSingle();

      return new Response(JSON.stringify({
        valid: false,
        status: sessionRow?.status?.toLowerCase() ?? 'not_found',
        reason: sessionRow?.ended_reason ?? 'SESSION_NOT_ACTIVE',
      }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (validatedUserId !== user.id) {
      return new Response(JSON.stringify({ valid: false, status: 'session_mismatch' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ valid: true, status: 'active' }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('auth-validate-session error:', err);
    return new Response(JSON.stringify({ valid: false, status: 'server_error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

const port = Number(Deno.env.get('PORT'));

if (Number.isInteger(port) && port > 0) {
  Deno.serve({ port }, handler);
} else {
  Deno.serve(handler);
}
