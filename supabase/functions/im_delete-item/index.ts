/**
 * im_delete-item — Edge Function (SOFT DELETE)
 *
 * Deactivates an item without removing it or its children.
 *
 *   UPDATE items
 *     SET is_active = false,
 *         deleted_by = <auth user.id>,
 *         updated_at = now()
 *   WHERE id = $1;
 *
 * Plus an `audit_log` row capturing WHO / WHEN / WHY / a snapshot of
 * the item's state at the moment of deactivation.
 *
 * RATIONALE (business-rule change approved by product):
 *   The prior implementation performed a 13-table hard cascade delete.
 *   That is destructive and irreversible — one mis-click wiped historic
 *   stock ledger rows, movement lines, packing records, etc.  Soft
 *   delete preserves referential integrity (every child row still
 *   points at a real parent) and lets ops reverse an accidental delete
 *   by flipping `is_active` back to true.
 *
 * SAFETY GUARANTEES:
 *   - No data is removed from any child table.  FKs still resolve.
 *   - Summary cards naturally pick up the new INACTIVE count because
 *     `is_active` is the same flag the UI already filters on.
 *   - The audit entry captures the item's FULL pre-delete state, the
 *     reason the user gave, and the caller's email — identity comes
 *     from the verified JWT, never the request body.
 *
 * No RPC is used — pure direct table operation via the service-role client.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';
import { getCorsHeaders } from '../_shared/cors.ts';

interface DeleteItemBody {
  item_id: string;
  deletion_reason: string;
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

    const userId = user.id;
    const userEmail = user.email || null;

    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── BODY ─────────────────────────────────────────────────────────
    const body: DeleteItemBody = await req.json().catch(() => ({} as any));
    const { item_id: itemId, deletion_reason: deletionReason } = body;
    if (!itemId) return json(corsHeaders, { error: 'item_id is required' }, 400);
    if (!deletionReason || !String(deletionReason).trim()) {
      return json(corsHeaders, { error: 'deletion_reason is required' }, 400);
    }

    // ── Step 1: fetch the row for the audit snapshot + target_id ─────
    const { data: item, error: fetchError } = await db
      .from('items')
      .select('*')
      .eq('id', itemId)
      .single();
    if (fetchError || !item) {
      return json(corsHeaders, { error: fetchError?.message || 'Item not found.' }, 404);
    }
    const partNumber = (item as any).part_number;

    // Idempotency: if the caller re-sends a delete for an already-
    // deactivated row, don't write another audit entry — just return
    // success with a flag so the client can decide whether to toast
    // "already deleted" vs "deleted just now".
    if ((item as any).is_active === false) {
      return json(corsHeaders, {
        success: true,
        already_inactive: true,
        item_id: itemId,
        part_number: partNumber,
      });
    }

    // ── Step 2: write audit log (best-effort — matches prior client behaviour) ──
    try {
      const { error: auditError } = await db.from('audit_log').insert({
        user_id: userId,
        action: 'SOFT_DELETE_ITEM',
        target_type: 'item',
        target_id: partNumber,
        old_value: {
          ...(item as any),
          deletion_reason: deletionReason,
          deleted_by_email: userEmail,
        },
        new_value: { is_active: false },
      });
      if (auditError) console.warn('[im_delete-item] audit log failed:', auditError.message);
    } catch (auditSwallow: any) {
      console.warn('[im_delete-item] audit log swallowed:', auditSwallow?.message);
    }

    // ── Step 3: soft delete ──────────────────────────────────────────
    const { error: updateError } = await db
      .from('items')
      .update({
        is_active: false,
        deleted_by: userId,
        updated_at: new Date().toISOString(),
      })
      .eq('id', itemId);
    if (updateError) {
      return json(
        corsHeaders,
        { error: `Failed to deactivate item: ${updateError.message}` },
        500,
      );
    }

    return json(corsHeaders, {
      success: true,
      already_inactive: false,
      item_id: itemId,
      part_number: partNumber,
    });
  } catch (err: any) {
    console.error('[im_delete-item] Error:', err?.message || err);
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
