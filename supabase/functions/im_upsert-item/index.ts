/**
 * im_upsert-item — Edge Function
 *
 * Server-side port of the Create / Update branches in
 * `utils/api/itemsSupabase.ts` (createItem + updateItem).  One endpoint
 * handles both — the presence of `item_id` in the body decides the branch.
 *
 * WHAT IT REPLACES:
 *   - createItem(formData) → INSERT into `items`
 *   - updateItem(id, formData) → UPDATE `items` SET {...formData, updated_at=now()} WHERE id = $1
 *
 * BUSINESS LOGIC IS UNCHANGED.
 *   - Same raw-form-data passthrough (snake_case fields, no transformation).
 *   - Same `updated_at` refresh on UPDATE.
 *   - Same error surfacing — the raw DB error message is returned as-is so
 *     the client's toast can show what happened (e.g. unique-constraint
 *     violations on item_code / master_serial_no).
 *
 * No RPC is used — pure direct table operations via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { getCorsHeaders } from '../_shared/cors.ts';

// Mirrors ItemFormData in utils/api/itemsSupabase.ts.  All fields are
// forwarded verbatim to the DB without transformation.
interface ItemFormData {
  // item_code: REMOVED in migration 018. part_number is canonical + unique.
  item_name: string;
  uom: string;
  unit_price: number | null;
  standard_cost: number | null;
  weight: number | null;
  lead_time_days: string;
  is_active: boolean;
  master_serial_no: string | null;
  revision: string | null;
  part_number: string;  // now required + unique
}

interface UpsertItemBody {
  /** When present → UPDATE branch.  When absent → CREATE branch. */
  item_id?: string | null;
  form_data: ItemFormData;
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
    const body: UpsertItemBody = await req.json().catch(() => ({} as any));
    const { item_id: itemId, form_data: formData } = body;

    if (!formData || typeof formData !== 'object') {
      return json(corsHeaders, { error: 'form_data is required' }, 400);
    }

    // ── UPDATE MODE ──────────────────────────────────────────────────
    if (itemId) {
      const { data, error } = await db
        .from('items')
        .update({ ...formData, updated_at: new Date().toISOString() })
        .eq('id', itemId)
        .select()
        .single();
      if (error) return json(corsHeaders, { error: error.message }, 400);
      return json(corsHeaders, { success: true, mode: 'update', item: data });
    }

    // ── CREATE MODE ──────────────────────────────────────────────────
    const { data, error } = await db
      .from('items')
      .insert(formData)
      .select()
      .single();
    if (error) return json(corsHeaders, { error: error.message }, 400);

    return json(corsHeaders, { success: true, mode: 'create', item: data });
  } catch (err: any) {
    console.error('[im_upsert-item] Error:', err?.message || err);
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
