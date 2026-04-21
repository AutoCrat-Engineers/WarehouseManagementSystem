/**
 * im_get-blanket-orders — Edge Function
 *
 * Server-side port of the "Blanket Orders" tab fetch inside the Item
 * Master detail modal.  Returns the rows of `v_item_details` that are
 * tied to a blanket order for the given item.
 *
 * WHAT IT REPLACES (UnifiedItemMaster.tsx fetchBlanketOrders, L464-483):
 *   SELECT * FROM v_item_details WHERE id = $1
 *   -- then client filters rows where blanket_order_id IS NOT NULL
 *
 * BUSINESS LOGIC IS UNCHANGED.
 *   - Same view (`v_item_details`).
 *   - Same `blanket_order_id IS NOT NULL` filter (moved server-side —
 *     no behavioural change, just less data shipped to the browser).
 *   - Rows are returned in their natural order; the client does its
 *     own UI transform (BlanketOrder field mapping) as before.
 *
 * No RPC is used — pure direct table operation via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { getCorsHeaders } from '../_shared/cors.ts';

interface GetBlanketOrdersBody {
  item_id: string;
}

export async function handler(req: Request): Promise<Response> {
  const corsHeaders = getCorsHeaders(req.headers.get('origin') ?? undefined);
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── AUTH ─────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json(corsHeaders, { error: 'Missing authorization header' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const userClient = createClient(supabaseUrl, Deno.env.get('PUBLISHABLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(
      authHeader.replace('Bearer ', ''),
    );
    if (authError || !user) return json(corsHeaders, { error: 'Unauthorized' }, 401);

    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── BODY ─────────────────────────────────────────────────────────
    const body: GetBlanketOrdersBody = await req.json().catch(() => ({} as any));
    const itemId = body.item_id;
    if (!itemId) return json(corsHeaders, { error: 'item_id is required' }, 400);

    // ── View query ──────────────────────────────────────────────────
    const { data, error } = await db
      .from('v_item_details')
      .select('*')
      .eq('id', itemId)
      .not('blanket_order_id', 'is', null);

    if (error) throw error;

    return json(corsHeaders, { success: true, rows: data || [] });
  } catch (err: any) {
    console.error('[im_get-blanket-orders] Error:', err?.message || err);
    return json(corsHeaders, { error: err?.message || 'Internal server error' }, 500);
  }
}

function json(corsHeaders: Record<string, string>, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

if (import.meta.main) Deno.serve(handler);
