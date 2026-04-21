import { getCorsHeaders } from "../_shared/cors.ts";

const handler = async (req: Request): Promise<Response> => {
  const responseHeaders = getCorsHeaders(req.headers.get('origin') ?? undefined);

  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: responseHeaders,
    });
  }

  return new Response("Not Found", { status: 404, headers: responseHeaders });
};

// Local dev: use PORT env var (set by start-dev.ps1)
// Supabase cloud: Deno.serve() with no port (platform manages it)
const port = Number(Deno.env.get('PORT'));
if (Number.isInteger(port) && port > 0) {
  Deno.serve({ port }, handler);
} else {
  Deno.serve(handler);
}
