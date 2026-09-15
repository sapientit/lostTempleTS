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

// itch.io serves HTML5 uploads from its CDN (e.g.
// https://v6p9d9t4.ssl.hwcdn.itch.zone/html/<id>/...), inside an iframe. The
// exact subdomain is fixed per project but isn't known until the project is
// created and the build is uploaded, so match by suffix instead of trying to
// hardcode it. These are public, unauthenticated read endpoints, so allowing
// the whole itch.zone/itch.io family here is not a meaningful widening of
// what the API exposes.
const ALLOWED_ORIGIN_SUFFIXES = [".itch.zone", ".itch.io"];

function isAllowedOrigin(origin: string): boolean {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  return ALLOWED_ORIGIN_SUFFIXES.some(
    (suffix) => url.hostname === suffix.slice(1) || url.hostname.endsWith(suffix),
  );
}

export function corsHeadersFor(request: Request): Record<string, string> {
  const origin = request.headers.get("Origin");
  const headers: Record<string, string> = { Vary: "Origin" };
  if (origin !== null && isAllowedOrigin(origin)) {
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
