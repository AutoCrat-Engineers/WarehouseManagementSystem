/**
 * pac_details_search-items — Edge Function
 *
 * Server-side item search used by the "Add Packing Specification" modal.
 * Returns items matching the search term, EXCLUDING items that already
 * have a packing specification (enforces the "one spec per item" rule).
 *
 * WHAT IT REPLACES (PackingDetails.tsx searchItems):
 *   - SELECT item_id FROM packing_specifications  (all existing spec owners)
 *   - SELECT id, item_code, item_name, master_serial_no, part_number,
 *     is_active FROM items WHERE is_active = true AND (search match)
 *       LIMIT 10
 *   - Client-side filter: drop items whose id ∈ existingSpecIds
 *
 * BUSINESS LOGIC IS UNCHANGED.
 *   - Minimum query length (2 chars) is still enforced; shorter queries
 *     return an empty list without touching the DB.
 *   - Same .or() search fields: item_code / item_name / master_serial_no
 *     / part_number, all `ilike %q%`.
 *   - Same `is_active = true` filter, same LIMIT 10.
 *   - Same exclusion of already-specced items.
 *
 * No RPC is used — pure direct table operations via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { corsHeaders } from '../_shared/cors.ts';

interface SearchItemsBody {
  query: string;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ── AUTH ─────────────────────────────────────────────────────────
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

    // ── BODY ─────────────────────────────────────────────────────────
    const body: SearchItemsBody = await req.json().catch(() => ({ query: '' }));
    const q = (body.query || '').trim();

    // Matches the client-side guard: empty list for short queries.
    if (q.length < 2) return json({ success: true, items: [] });

    // ── Parallel: existing spec item_ids + items search ──────────────
    // Both queries run together; independent filters, no dependency.
    // .range(0, 99999) on the exists-query overrides the default 1000-row
    // cap so we don't silently miss already-specced items on a large DB.
    const [existingResult, itemsResult] = await Promise.all([
      db.from('packing_specifications')
        .select('item_id')
        .range(0, 99999),
      // item_code dropped in migration 018 — part_number is canonical.
      // Alias part_number AS item_code for backward compat with callers.
      db.from('items')
        .select('id, item_name, master_serial_no, part_number, is_active, item_code:part_number')
        .eq('is_active', true)
        .is('deleted_at', null)
        .or(
          `item_name.ilike.%${q}%,master_serial_no.ilike.%${q}%,part_number.ilike.%${q}%`,
        )
        .limit(10),
    ]);

    if (itemsResult.error) throw itemsResult.error;

    const existingIds = new Set(
      ((existingResult.data || []) as any[]).map((s: any) => s.item_id),
    );
    const filteredItems = ((itemsResult.data || []) as any[]).filter(
      (i: any) => !existingIds.has(i.id),
    );

    return json({ success: true, items: filteredItems });
  } catch (err: any) {
    console.error('[pac_details_search-items] Error:', err?.message || err);
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
