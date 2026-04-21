/**
 * calculate-pallet-impact — Edge Function
 *
 * Runs the pallet intelligence algorithm server-side.
 * Previously this ran in the browser via calculatePalletImpact() in packingEngineService.ts.
 *
 * Called by StockMovement when L1 enters box count for PRODUCTION_RECEIPT.
 * Returns what will happen to pallets if this movement is submitted.
 *
 * Business logic is UNCHANGED from the client-side original.
 * Algorithm lives in _shared/palletImpact.ts (shared with submit-movement-request).
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { calculatePalletImpactInternal } from '../_shared/palletImpact.ts';

interface RequestBody {
  itemCode: string;
  boxCount: number;
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

    // Validate JWT
    const userClient = createClient(supabaseUrl, Deno.env.get('PUBLISHABLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Service role client — bypasses RLS for DB reads
    const db = createClient(supabaseUrl, serviceRoleKey);

    // ── PARSE & VALIDATE BODY ─────────────────────────────────────────────────
    const body: RequestBody = await req.json();
    const { itemCode, boxCount } = body;

    if (!itemCode) {
      return new Response(JSON.stringify({ error: 'itemCode is required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (typeof boxCount !== 'number' || boxCount < 0) {
      return new Response(JSON.stringify({ error: 'boxCount must be a non-negative number' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── RUN PALLET IMPACT ALGORITHM ───────────────────────────────────────────
    const impact = await calculatePalletImpactInternal(db, itemCode, boxCount);

    return new Response(
      JSON.stringify(impact),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[calculate-pallet-impact] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

if (import.meta.main) Deno.serve(handler);
