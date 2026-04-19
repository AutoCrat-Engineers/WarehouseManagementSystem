/**
 * local-dev-server.ts — Deno Local Dev Router
 *
 * Runs ALL edge functions in a single Deno process on port 54321.
 * Simulates the Supabase edge function gateway without Docker.
 *
 * Usage:
 *   deno run --no-check --allow-net --allow-env --allow-read \
 *     supabase/functions/local-dev-server.ts
 *
 * Frontend .env.local must have:
 *   VITE_FUNCTIONS_URL=http://127.0.0.1:54321/functions/v1
 */

// ── Load env vars from supabase/.env.local ─────────────────────────────────
const envText = await Deno.readTextFile(
  new URL('../../supabase/.env.local', import.meta.url),
);
for (const line of envText.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eqIdx = trimmed.indexOf('=');
  if (eqIdx === -1) continue;
  const key = trimmed.slice(0, eqIdx).trim();
  const val = trimmed.slice(eqIdx + 1).trim();
  Deno.env.set(key, val);
}
console.log('[local-dev-server] Env loaded from supabase/.env.local');

// ── Import all function handlers (sm_ prefixed to match deployed folders) ──
import { handler as getMovements } from './sm_get-movements/index.ts';
import { handler as getMovementCounts } from './sm_get-movement-counts/index.ts';
import { handler as calculatePalletImpact } from './sm_calculate-pallet-impact/index.ts';
import { handler as getItemStock } from './sm_get-item-stock/index.ts';
import { handler as searchItems } from './sm_search-items/index.ts';
import { handler as submitMovementRequest } from './sm_submit-movement-request/index.ts';
import { handler as approveMovement } from './sm_approve-movement/index.ts';
import { handler as getUserProfile } from './get-user-profile/index.ts';
import { handler as getReasonCodes } from './sm_get-reason-codes/index.ts';
import { handler as getMovementReviewData } from './sm_get-movement-review-data/index.ts';

// ── Route table (matches deployed function names with sm_ prefix) ───────────
const routes: Record<string, (req: Request) => Promise<Response>> = {
  '/functions/v1/sm_get-movements': getMovements,
  '/functions/v1/sm_get-movement-counts': getMovementCounts,
  '/functions/v1/sm_calculate-pallet-impact': calculatePalletImpact,
  '/functions/v1/sm_get-item-stock': getItemStock,
  '/functions/v1/sm_search-items': searchItems,
  '/functions/v1/sm_submit-movement-request': submitMovementRequest,
  '/functions/v1/sm_approve-movement': approveMovement,
  '/functions/v1/get-user-profile': getUserProfile,
  '/functions/v1/sm_get-reason-codes': getReasonCodes,
  '/functions/v1/sm_get-movement-review-data': getMovementReviewData,
};

// ── Server ───────────────────────────────────────────────────────────────────
const PORT = 54321;

Deno.serve({ port: PORT, hostname: '127.0.0.1' }, async (req: Request) => {
  const url = new URL(req.url);
  const fn = routes[url.pathname];

  if (!fn) {
    console.warn(`[local-dev-server] 404 — no function at ${url.pathname}`);
    return new Response(
      JSON.stringify({ error: `No function registered at ${url.pathname}` }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  const name = url.pathname.split('/').pop();
  console.log(`[local-dev-server] → ${req.method} ${name}`);

  try {
    const res = await fn(req);
    console.log(`[local-dev-server] ← ${name} ${res.status}`);
    return res;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[local-dev-server] ✗ ${name} threw:`, msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});

console.log(`[local-dev-server] Listening on http://127.0.0.1:${PORT}/functions/v1/`);
console.log('[local-dev-server] Registered routes:');
Object.keys(routes).forEach(r => console.log(`  ${r}`));
