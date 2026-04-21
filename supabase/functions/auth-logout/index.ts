import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { getCorsHeaders } from "../_shared/cors.ts";

const SESSION_STATUS = {
  ACTIVE: 'ACTIVE',
  ENDED: 'ENDED',
} as const;

const SESSION_REASON = {
  USER_LOGOUT: 'USER_LOGOUT',
} as const;

function getUserIdFromJwtPayload(jwt: string): string | null {
  try {
    const payload = jwt.split('.')[1];
    if (!payload) return null;

    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const decoded = JSON.parse(atob(padded));

    return typeof decoded.sub === 'string' ? decoded.sub : null;
  } catch (_) {
    return null;
  }
}

async function recordLogoutActivity(
  adminClient: any,
  req: Request,
  userId: string,
  globalSessionId: string,
): Promise<void> {
  const { error } = await adminClient.from('auth_login_activity').insert({
    user_id: userId,
    event_type: 'LOGOUT',
    success: true,
    source: 'web',
    ip_address: req.headers.get('x-forwarded-for') || req.headers.get('cf-connecting-ip') || 'unknown',
    user_agent: req.headers.get('user-agent') || 'unknown',
    session_id: globalSessionId,
    metadata: { global_session_id: globalSessionId, reason: SESSION_REASON.USER_LOGOUT },
  });

  if (error) {
    console.warn('auth_login_activity logout write failed:', error);
  }
}

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
      return new Response(JSON.stringify({ error: 'Auth service is not configured.' }), {
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
      globalSessionId = null;
    }

    let userId: string | null = null;

    if (jwt) {
      try {
        const { data: { user }, error } = await adminClient.auth.getUser(jwt);
        if (!error && user) {
          userId = user.id;
        }
      } catch (_) {
        userId = null;
      }
    }

    if (!userId && jwt) {
      userId = getUserIdFromJwtPayload(jwt);
    }

    if (!userId) {
      return new Response(JSON.stringify({ success: true, note: 'already_logged_out' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!globalSessionId) {
      const { data: latestSession, error } = await adminClient
        .from('global_sessions')
        .select('id')
        .eq('user_id', userId)
        .eq('status', SESSION_STATUS.ACTIVE)
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        console.error('Latest active session lookup failed:', error);
        return new Response(JSON.stringify({ error: 'Failed to resolve active session.' }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      globalSessionId = latestSession?.id ?? null;
    }

    if (!globalSessionId) {
      return new Response(JSON.stringify({ success: true, note: 'already_logged_out' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: validatedUserId, error: validateError } = await adminClient.rpc('validate_active_session', {
      p_session_id: globalSessionId,
    });

    if (validateError) {
      console.error('validate_active_session failed:', validateError);
      return new Response(JSON.stringify({ error: 'Failed to validate active session.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!validatedUserId) {
      return new Response(JSON.stringify({ success: true, note: 'already_logged_out' }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (validatedUserId !== userId) {
      return new Response(JSON.stringify({ error: 'Session does not belong to the current user.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: updateError } = await adminClient
      .from('global_sessions')
      .update({
        status: SESSION_STATUS.ENDED,
        ended_at: new Date().toISOString(),
        ended_reason: SESSION_REASON.USER_LOGOUT,
      })
      .eq('id', globalSessionId)
      .eq('user_id', userId);

    if (updateError) {
      console.error('global_sessions update failed:', updateError);
      return new Response(JSON.stringify({ error: 'Failed to end active session.' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await recordLogoutActivity(adminClient, req, userId, globalSessionId);

    try {
      await adminClient.from('audit_log').insert({
        user_id: userId,
        action: 'LOGOUT',
        target_type: null,
        target_id: null,
        old_value: null,
        new_value: { global_session_id: globalSessionId, ended_reason: SESSION_REASON.USER_LOGOUT },
      });
    } catch (auditErr) {
      console.warn('Audit log write failed:', auditErr);
    }

    if (jwt) {
      try {
        await adminClient.auth.admin.signOut(jwt, 'global');
      } catch (signOutErr) {
        console.warn('admin.signOut failed:', signOutErr);
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('auth-logout error:', err);
    return new Response(JSON.stringify({ error: 'Internal server error' }), {
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
