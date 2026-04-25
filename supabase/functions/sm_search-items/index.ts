/**
 * search-items — Edge Function
 *
 * Replaces handleSearch() item lookup in StockMovement.tsx.
 * Previously: direct supabase.from('items') ilike query from browser.
 * Now: single authenticated POST → server queries with service role key.
 *
 * Business logic is UNCHANGED — same ilike filter, same limit, same response shape.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface RequestBody {
  query: string;
}

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

    // ── PARSE & VALIDATE BODY ─────────────────────────────────────────────────
    const body: RequestBody = await req.json();
    const { query } = body;

    if (!query || query.length < 2) {
      return new Response(JSON.stringify({ items: [] }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── QUERY — mirrors handleSearch() ───────────────────────────────────────
    // item_code column dropped from items in migration 018. Alias part_number
    // AS item_code so callers that still destructure `item_code` keep working.
    const { data, error } = await db
      .from('items')
      .select('id, item_name, part_number, master_serial_no, uom, item_code:part_number')
      .or(`part_number.ilike.%${query}%,master_serial_no.ilike.%${query}%`)
      .eq('is_active', true)
      .is('deleted_at', null)
      .limit(10);

    if (error) throw error;

    return new Response(
      JSON.stringify({ items: data || [] }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[search-items] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

if (import.meta.main) Deno.serve(handler);
