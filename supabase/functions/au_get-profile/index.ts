/**
 * au_get-profile — Edge Function
 *
 * Server-side port of the login-time profile fetch in `App.tsx`
 * (`fetchUserRole`).  The browser previously issued:
 *   GET /rest/v1/profiles?select=role,is_active,email,full_name&id=eq.<user_id>
 * directly.  This edge function replaces that call with a single POST to
 * the Supabase Edge Runtime.
 *
 * BUSINESS LOGIC IS UNCHANGED.  Same SELECT columns, same row resolution
 * (single() semantics), same authenticated-user scoping.
 *
 * Security hardening (no behaviour change for legitimate users):
 *   - The user_id is taken from the verified JWT (`user.id`), NOT from
 *     the request body.  A caller can only ever fetch its own profile —
 *     which matches every existing call site (`fetchUserRole(userId)`
 *     always receives `session.user.id`).
 *
 * The permissions RPC (`get_effective_permissions`) is intentionally
 * LEFT IN THE BROWSER for now — per explicit scope.  When you're ready
 * to fold it in, an `au_bootstrap` function can replace both in one trip.
 *
 * No RPC is used — pure direct table operation via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders } from '../_shared/cors.ts';

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── AUTH ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Missing authorization header' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, Deno.env.get('PUBLISHABLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── SELECT role, is_active, email, full_name FROM profiles WHERE id = <auth user> ──
    // Exact mirror of the previous client-side query.  If the row is
    // missing the server returns a 404 so the caller can fall back to
    // the same defaults the client-side code used.
    const { data, error } = await db
      .from('profiles')
      .select('role, is_active, email, full_name')
      .eq('id', user.id)
      .single();

    if (error || !data) {
      return json({ error: 'Profile not found' }, 404);
    }

    return json({
      success: true,
      profile: {
        role: (data as any).role,
        is_active: (data as any).is_active,
        email: (data as any).email,
        full_name: (data as any).full_name,
      },
    });
  } catch (err: any) {
    console.error('[au_get-profile] Error:', err?.message || err);
    return json({ error: err?.message || 'Internal server error' }, 500);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

if (import.meta.main) Deno.serve(handler);
