/**
 * get-reason-codes — Edge Function
 *
 * Replaces two direct DB calls in StockMovement.tsx:
 *   1. fetchReasonCodes() — lines 509-513: fetches ALL active reason codes on mount
 *   2. handleOpenReview() fallback — lines 786-791: fetches ONE reason code by reason_code value
 *
 * Request body:
 *   {}                          → returns all active reason codes
 *   { reasonCode: 'PROD_IN' }   → returns single matching record
 *
 * Business logic is UNCHANGED.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

interface RequestBody {
  reasonCode?: string;
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

    // ── PARSE BODY ────────────────────────────────────────────────────────────
    const body: RequestBody = await req.json().catch(() => ({}));
    const { reasonCode } = body;

    if (reasonCode) {
      // ── SINGLE LOOKUP — mirrors handleOpenReview() fallback (lines 786-791) ─
      const { data } = await db
        .from('inv_reason_codes')
        .select('id, reason_code, category:reason_category, description')
        .eq('reason_code', reasonCode)
        .single();

      return new Response(
        JSON.stringify({ reasonCode: data || null }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      );
    }

    // ── ALL ACTIVE CODES — mirrors fetchReasonCodes() (lines 509-513) ────────
    const { data, error } = await db
      .from('inv_reason_codes')
      .select('id, reason_code, category:reason_category, description')
      .eq('is_active', true)
      .order('created_at');

    if (error) throw error;

    return new Response(
      JSON.stringify({ reasonCodes: data || [] }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  } catch (err: any) {
    console.error('[get-reason-codes] Error:', err);
    return new Response(JSON.stringify({ error: err.message || 'Internal server error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
}

if (import.meta.main) Deno.serve(handler);
