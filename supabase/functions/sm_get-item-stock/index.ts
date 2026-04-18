/**
 * get-item-stock — Edge Function
 *
 * Replaces fetchWarehouseStocks() in StockMovement.tsx.
 * Previously: direct supabase.from('inv_warehouse_stock') query from browser.
 * Now: single authenticated POST → server queries with service role key.
 *
 * Business logic is UNCHANGED — same query, same response shape.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface RequestBody {
  itemCode: string;
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
    const { itemCode } = body;

    if (!itemCode) {
      return new Response(JSON.stringify({ error: 'itemCode is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── QUERY — mirrors fetchWarehouseStocks() ────────────────────────────────
    const { data, error } = await db
      .from('inv_warehouse_stock')
      .select('quantity_on_hand, inv_warehouses!inner ( warehouse_code, warehouse_name )')
      .eq('item_code', itemCode)
      .eq('is_active', true);

    if (error) throw error;

    const stock = (data || []).map((r: any) => ({
      warehouse_code: r.inv_warehouses?.warehouse_code || '',
      warehouse_name: r.inv_warehouses?.warehouse_name || '',
      quantity_on_hand: r.quantity_on_hand || 0,
    }));

    return new Response(
      JSON.stringify({ stock }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[get-item-stock] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

if (import.meta.main) Deno.serve(handler);
