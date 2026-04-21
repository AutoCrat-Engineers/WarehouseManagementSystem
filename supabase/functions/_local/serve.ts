/**
 * _local/serve.ts — Local Deno dev router for edge function testing.
 *
 * NOT DEPLOYED. Exists only to let the frontend (VITE_FUNCTIONS_URL=http://127.0.0.1:8000)
 * hit the two new sg_* functions locally while transparently forwarding every
 * other edge function call to the deployed remote project.
 *
 * Flow:
 *   - /sg_auto-generate   → local handler (imports ../sg_auto-generate/index.ts)
 *   - /sg_mark-all-printed → local handler (imports ../sg_mark-all-printed/index.ts)
 *   - anything else        → proxied to REMOTE_BASE
 *
 * Run:
 *   SUPABASE_URL=... PUBLISHABLE_KEY=... SUPABASE_SERVICE_ROLE_KEY=... \
 *     deno run --allow-net --allow-env supabase/functions/_local/serve.ts
 */
import { handler as autoGenerateHandler } from '../sg_auto-generate/index.ts';
import { handler as markAllPrintedHandler } from '../sg_mark-all-printed/index.ts';

const REMOTE_BASE = 'https://sugvmurszfcneaeyoagv.supabase.co/functions/v1';

async function proxyToRemote(req: Request, path: string): Promise<Response> {
  const targetUrl = REMOTE_BASE + path;
  console.log(`[proxy] ${req.method} ${path} → remote`);

  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('content-length');

  const bodyMethods = ['POST', 'PUT', 'PATCH', 'DELETE'];
  const body = bodyMethods.includes(req.method) ? await req.arrayBuffer() : undefined;

  try {
    return await fetch(targetUrl, {
      method: req.method,
      headers,
      body,
    });
  } catch (err: any) {
    console.error('[proxy] error:', err.message);
    return new Response(JSON.stringify({ error: 'Proxy failed: ' + err.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

Deno.serve((req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path.includes('sg_auto-generate')) {
    console.log(`[local] ${req.method} sg_auto-generate`);
    return autoGenerateHandler(req);
  }

  if (path.includes('sg_mark-all-printed')) {
    console.log(`[local] ${req.method} sg_mark-all-printed`);
    return markAllPrintedHandler(req);
  }

  return proxyToRemote(req, path);
});
