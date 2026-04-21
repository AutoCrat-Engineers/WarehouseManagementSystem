/**
 * get-movement-counts — Edge Function
 *
 * Replaces fetchSummaryCounts() in StockMovement.tsx.
 * Previously: 4 parallel COUNT queries from the browser.
 * Now: single authenticated POST → 4 parallel COUNT queries server-side.
 *
 * Business logic is UNCHANGED.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // ── AUTH ──────────────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, Deno.env.get('PUBLISHABLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── 4 PARALLEL COUNT QUERIES — mirrors fetchSummaryCounts() ──────────────
    const [totalR, pendingR, approvedR, rejectedR] = await Promise.all([
      db.from('inv_movement_headers').select('id', { count: 'exact', head: true }),
      db.from('inv_movement_headers').select('id', { count: 'exact', head: true }).eq('status', 'PENDING_APPROVAL'),
      db.from('inv_movement_headers').select('id', { count: 'exact', head: true }).eq('status', 'APPROVED'),
      db.from('inv_movement_headers').select('id', { count: 'exact', head: true }).eq('status', 'REJECTED'),
    ]);

    return new Response(
      JSON.stringify({
        total: totalR.count ?? 0,
        pending: pendingR.count ?? 0,
        completed: approvedR.count ?? 0,
        rejected: rejectedR.count ?? 0,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[get-movement-counts] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

if (import.meta.main) Deno.serve(handler);
