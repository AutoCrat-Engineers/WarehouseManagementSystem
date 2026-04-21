/**
 * get-movement-review-data — Edge Function
 *
 * Replaces two direct DB calls in StockMovement.tsx:
 *   1. fetchPackingSpec() — lines 570-575: inner_box_quantity for form box-count input
 *   2. handleOpenReview() production receipt block — lines 800-812:
 *      packing_specifications (inner + outer qty) + pack_pallets ADJUSTMENT_REQUIRED count
 *
 * Request body: { itemCode: string }
 *
 * Response:
 *   {
 *     found: boolean,             — false when no active packing spec exists
 *     innerBoxQty: number,
 *     outerBoxQty: number,
 *     adjustmentPalletCount: number
 *   }
 *
 * Business logic is UNCHANGED — same queries, same filters.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface RequestBody {
  itemCode: string;
  reqQty?: number;   // optional — when provided, box breakdown is computed server-side (Issue 2)
}

// ── ISSUE 2 MIGRATION: Box breakdown computation ──────────────────────────────
// Previously computed in StockMovement.tsx handleOpenReview lines 818-870.
// Exact same algorithm — no logic changes, only relocated server-side.
function computeBoxBreakdown(
  reqQty: number,
  perBox: number,
  outerQty: number,
  adjPalletsCount: number,
): { boxes: number; perBox: number; total: number; adjQty?: number; adjBoxCount?: number; adjIncluded: boolean } {
  const adjQty = outerQty > 0 ? outerQty % perBox : 0;
  let adjBoxCount = 0;
  let innerBoxCount = 0;

  if (adjQty > 0 && adjPalletsCount > 0) {
    const maxAdjFromQty = Math.floor(reqQty / adjQty);
    adjBoxCount = Math.min(adjPalletsCount, maxAdjFromQty);
    const adjTotal = adjBoxCount * adjQty;
    const remainingQty = reqQty - adjTotal;
    innerBoxCount = Math.floor(remainingQty / perBox);
    const calculatedTotal = (adjBoxCount * adjQty) + (innerBoxCount * perBox);
    if (calculatedTotal !== reqQty) {
      const leftover = reqQty - calculatedTotal;
      if (leftover === adjQty) {
        adjBoxCount += 1;
      }
    }
  } else if (adjQty > 0) {
    innerBoxCount = Math.floor(reqQty / perBox);
    const leftover = reqQty - (innerBoxCount * perBox);
    if (leftover === adjQty) {
      adjBoxCount = 1;
    } else {
      innerBoxCount = Math.round(reqQty / perBox);
    }
  } else {
    innerBoxCount = Math.round(reqQty / perBox);
  }

  const hasAdj = adjBoxCount > 0;
  return {
    boxes: innerBoxCount,
    perBox,
    total: reqQty,
    adjQty: hasAdj ? adjQty : undefined,
    adjBoxCount: hasAdj ? adjBoxCount : undefined,
    adjIncluded: hasAdj,
  };
}
// ── END ISSUE 2 ───────────────────────────────────────────────────────────────

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
    const { itemCode, reqQty } = body;

    if (!itemCode) {
      return new Response(JSON.stringify({ error: 'itemCode is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── PARALLEL QUERIES — mirrors handleOpenReview() lines 800-812 ──────────
    // Query 1: packing_specifications (inner_box_quantity + outer_box_quantity)
    // Query 2: pack_pallets ADJUSTMENT_REQUIRED count
    // (fetchPackingSpec only needed query 1 — response shape covers both callers)
    const [specResult, adjPalletsResult] = await Promise.all([
      db
        .from('packing_specifications')
        .select('inner_box_quantity, outer_box_quantity')
        .eq('item_code', itemCode)
        .eq('is_active', true)
        .single(),
      db
        .from('pack_pallets')
        .select('id')
        .eq('item_code', itemCode)
        .eq('state', 'ADJUSTMENT_REQUIRED'),
    ]);

    const spec = specResult.data;
    const adjustmentPalletCount = adjPalletsResult.data?.length || 0;

    if (!spec) {
      return new Response(
        JSON.stringify({
          found: false,
          innerBoxQty: 0,
          outerBoxQty: 0,
          adjustmentPalletCount,
          boxBreakdown: null,
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // Compute box breakdown if reqQty provided (Issue 2 — was computed client-side lines 818-870)
    const boxBreakdown = (reqQty && reqQty > 0 && spec.inner_box_quantity > 0)
      ? computeBoxBreakdown(reqQty, spec.inner_box_quantity, spec.outer_box_quantity || 0, adjustmentPalletCount)
      : null;

    return new Response(
      JSON.stringify({
        found: true,
        innerBoxQty: spec.inner_box_quantity || 0,
        outerBoxQty: spec.outer_box_quantity || 0,
        adjustmentPalletCount,
        boxBreakdown,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[get-movement-review-data] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

if (import.meta.main) Deno.serve(handler);
