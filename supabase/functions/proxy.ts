// Deno Edge Function Native Proxy
// Listens on 127.0.0.1:54321 and routes to local natively running edge functions.
// Binding explicitly to loopback avoids localhost/127.0.0.1 resolution mismatches.

const PORT_MAP: Record<string, number> = {
  "auth-login": 8001,
  "auth-logout": 8002,
  "make-server-9c637d11": 8003,
  "auth-validate-session": 8004,
  "session-manager": 8005,
};

Deno.serve({ hostname: "127.0.0.1", port: 54321 }, async (req) => {
  const url = new URL(req.url);
  // Match path like /functions/v1/auth-login
  const match = url.pathname.match(/\/functions\/v1\/([^/]+)/);
  const functionName = match ? match[1] : null;

  // Handle CORS Preflight globally for the proxy
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS, PUT, DELETE",
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (!functionName || !PORT_MAP[functionName]) {
    return new Response(JSON.stringify({ error: `Function not found or not running locally native: ${functionName}` }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }

  const targetPort = PORT_MAP[functionName];
  const targetUrl = `http://127.0.0.1:${targetPort}${url.pathname.replace(`/functions/v1/${functionName}`, "")}`;

  try {
    const proxyReq = new Request(targetUrl, {
      method: req.method,
      headers: req.headers,
      body: req.body,
      // For some strict methods you may need to omit body or specify duplex
      ...(req.body ? { duplex: "half" } : {})
    });

    const resp = await fetch(proxyReq);
    
    // Pass headers back
    const responseHeaders = new Headers(resp.headers);
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    
    return new Response(resp.body, {
      status: resp.status,
      headers: responseHeaders
    });
  } catch (error) {
    console.error(`Proxy error to ${functionName}:`, error);
    return new Response(JSON.stringify({ error: `Failed to proxy to native edge function on port ${targetPort}` }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...corsHeaders }
    });
  }
});
