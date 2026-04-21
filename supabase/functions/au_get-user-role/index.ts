/**
 * au_get-user-role — Edge Function
 *
 * Server-side port of the `getUserRole()` helper in
 * src/utils/auth.ts.  The browser previously queried
 *   GET /rest/v1/profiles?select=role&id=eq.<user_id>
 * directly on every call into service functions that use
 * getAuthContext().  This moves that read into an edge function so the
 * browser never hits the DB directly for role lookups.
 *
 * BUSINESS LOGIC IS UNCHANGED.  Same SELECT, same `'L1'` default, same
 * return shape.
 *
 * Security hardening (no behaviour change for legitimate users):
 *   - The user_id is taken from the verified JWT (`user.id`), NOT from
 *     the request body.  A caller can only ever resolve its own role —
 *     which matches every existing caller anyway (all pass
 *     getCurrentUserId() before calling).
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

    // ── SELECT role FROM profiles WHERE id = <authenticated user.id> ──
    // Exact mirror of the previous client-side query.  Default to 'L1'
    // when the profile row is missing OR the role column is null — matches
    // the original `data?.role || 'L1'` fallback.
    const { data } = await db
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();

    const role: string = (data as any)?.role || 'L1';
    return json({ role });
  } catch (err: any) {
    console.error('[au_get-user-role] Error:', err);
    return json({ error: err.message || 'Internal server error' }, 500);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

if (import.meta.main) Deno.serve(handler);
