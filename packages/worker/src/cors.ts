/**
 * CORS layer (PORTING.md §7.1). Echo Access-Control-Allow-Origin for allowed
 * origins plus Vary: Origin on EVERY response (the client reads error
 * envelopes cross-origin too). Inert when the client is proxied same-origin.
 */

const ALLOWED_ORIGINS = new Set([
  "https://losttemple.duckdns.org",
  "http://localhost:5173",
  "http://localhost:4173",
]);

export function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin !== null && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }
  return headers;
}

export function preflight(cors: Record<string, string>): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...cors,
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
    },
  });
}
