/**
 * pac_details_upsert-spec — Edge Function
 *
 * Server-side handler for the "Save" action on the Packing Specification
 * modal.  Handles both CREATE (insert) and UPDATE branches, deciding by
 * the presence of `spec_id` in the request body.
 *
 * WHAT IT REPLACES (PackingDetails.tsx handleSave):
 *   - UPDATE branch: `supabase.from('packing_specifications').update({
 *       ...formData, updated_at: now() }).eq('id', editSpec.id)`
 *   - CREATE branch: `supabase.from('packing_specifications').insert({
 *       item_id, item_code, is_active: <from item>, ...formData })`
 *
 * BUSINESS LOGIC IS UNCHANGED.
 *   - Same field shape (10 dimension/weight/qty fields, all stored in
 *     mm / kg / integer units as passed in by the client).
 *   - Same `is_active` default for new rows: inherited from the
 *     underlying Item Master row's `is_active`.
 *   - Same duplicate error surfacing: the unique constraint
 *     `uq_packing_spec_item` or any message containing "duplicate" is
 *     returned as the stable error code `DUPLICATE_SPEC` so the client
 *     can show its existing friendly toast.
 *
 * No RPC is used — pure direct table operations via the service-role client.
 */
import { corsHeaders } from '../_shared/cors.ts';
import { requireActiveSession, withTransactionLock } from '../_shared/session.ts';

// Fields the client submits (all numeric; stored server-side verbatim).
interface SpecFormData {
  inner_box_length_mm: number;
  inner_box_width_mm: number;
  inner_box_height_mm: number;
  inner_box_quantity: number;
  inner_box_net_weight_kg: number;
  outer_box_length_mm: number;
  outer_box_width_mm: number;
  outer_box_height_mm: number;
  outer_box_quantity: number;
  outer_box_gross_weight_kg: number;
}

interface UpsertSpecBody {
  /** When present → UPDATE mode.  When absent → CREATE mode. */
  spec_id?: string | null;
  /** Required for CREATE.  Ignored for UPDATE. */
  item_id?: string | null;
  /** Required for CREATE.  Ignored for UPDATE. */
  item_code?: string | null;
  form_data: SpecFormData;
}

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const session = await requireActiveSession(req);
    if (!session.ok) return session.response;
    const ctx = session.ctx;
    const db = ctx.db;

    const body: UpsertSpecBody = await req.json().catch(() => ({} as any));
    const { spec_id, item_id, item_code, form_data } = body;

    if (!form_data || typeof form_data !== 'object') {
      return json({ error: 'form_data is required' }, 400);
    }

    return await withTransactionLock(ctx, {
      key:   `upserting_packing_spec:${spec_id ?? item_id ?? 'new'}`,
      label: 'Upserting Packing Specification',
    }, async () => {
      if (spec_id) {
        const { error: updErr } = await db
          .from('packing_specifications')
          .update({ ...form_data, updated_at: new Date().toISOString() })
          .eq('id', spec_id);
        if (updErr) throw updErr;
        return json({ success: true, mode: 'update', spec_id });
      }

      if (!item_id) return json({ error: 'item_id is required for create' }, 400);
      if (!item_code) return json({ error: 'item_code is required for create' }, 400);

      const { data: itemRow, error: itemErr } = await db
        .from('items')
        .select('is_active')
        .eq('id', item_id)
        .single();
      if (itemErr || !itemRow) return json({ error: 'Item not found' }, 404);

      const { error: insErr } = await db
        .from('packing_specifications')
        .insert({
          item_id,
          item_code,
          is_active: (itemRow as any).is_active,
          ...form_data,
        });

      if (insErr) {
        const msg = insErr.message || '';
        if (msg.includes('uq_packing_spec_item') || msg.toLowerCase().includes('duplicate')) {
          return json({ error: 'A packing specification already exists for this item.', code: 'DUPLICATE_SPEC' }, 409);
        }
        throw insErr;
      }

      return json({ success: true, mode: 'create', item_id, item_code });
    });
  } catch (err: any) {
    console.error('[pac_details_upsert-spec] Error:', err?.message || err);
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
