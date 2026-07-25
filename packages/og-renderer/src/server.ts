/**
 * Standalone always-on Node HTTP service for GET /og/<level>/<gold>/<stars>/
 * <days>/<language> - the Oracle-box replacement for the same route on the
 * Cloudflare Worker (packages/worker/src/share.ts), which hits a hard
 * per-request CPU-time ceiling on the free plan (~55-60% success rate even
 * after two rounds of optimization). This box has no such ceiling.
 *
 * Listens on localhost only - nginx (see /etc/nginx/conf.d/losttemple.conf
 * on the Oracle box) reverse-proxies https://losttemple.duckdns.org/og/*
 * here; everything else still goes to the Cloudflare Worker unchanged.
 *
 * Validation and response headers intentionally match the Worker's current
 * /og/ behavior exactly (parseShareSegments for 404s, the same
 * Cache-Control) so this is a drop-in swap from nginx's point of view.
 */

import { createServer } from "node:http";
import { parseShareSegments, SHARE_IMAGE_CACHE_CONTROL } from "@losttemple/worker/share-tree";
import { getWhatsappImage } from "./assets.js";
import { renderShareImageJpeg } from "./render.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.OG_RENDERER_PORT ?? 8081);
const OG_PREFIX = "/og/";

// WhatsApp picks its preview layout (small cropped thumbnail vs. full-width
// "large image") based on og:image's aspect ratio - a square image tips it
// into large-image mode, which wasn't wanted, so the WhatsApp-specific
// image keeps the card's normal 1200:620 ratio (see
// packages/worker/assets/share/whatsapp-square/README.md). Detected by its
// self-identifying User-Agent (stable across versions -
// "WhatsApp/2.23.20.0" etc.) - fails safe to the normal wide card if this
// string ever changes, rather than erroring.
const WHATSAPP_UA_PATTERN = /whatsapp/i;

const server = createServer((req, res) => {
  void (async () => {
    const start = Date.now();
    const ua = req.headers["user-agent"] ?? "-";
    console.log(`og-renderer: request ${req.method} ${req.url} ua="${ua}"`);
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        console.log(`og-renderer: 405 ${req.url}`);
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" }).end("Method Not Allowed");
        return;
      }
      const url = new URL(req.url ?? "/", `http://${HOST}`);
      if (!url.pathname.startsWith(OG_PREFIX)) {
        console.log(`og-renderer: 404 (not /og/ prefix) ${req.url}`);
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
        return;
      }
      const segments = url.pathname.slice(OG_PREFIX.length).split("/");
      const params = parseShareSegments(segments);
      if (params === null) {
        console.log(`og-renderer: 404 (bad params) ${req.url} segments=${JSON.stringify(segments)}`);
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
        return;
      }
      const whatsappImage = WHATSAPP_UA_PATTERN.test(ua) ? getWhatsappImage(params.stars) : undefined;
      const jpeg = whatsappImage ?? (await renderShareImageJpeg(params));
      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Content-Length": jpeg.length,
        "Cache-Control": SHARE_IMAGE_CACHE_CONTROL,
      });
      res.end(req.method === "HEAD" ? undefined : jpeg);
      console.log(
        `og-renderer: 200 ${req.url} params=${JSON.stringify(params)} whatsappImage=${whatsappImage !== undefined} bytes=${jpeg.length} ms=${Date.now() - start}`,
      );
    } catch (cause) {
      console.error(`og-renderer: request failed after ${Date.now() - start}ms for ${req.url}:`, cause);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      }
      res.end("Internal Server Error");
    }
  })();
});

server.listen(PORT, HOST, () => {
  console.log(`og-renderer listening on http://${HOST}:${PORT}`);
});

function shutdown(signal: string): void {
  console.log(`og-renderer: received ${signal}, shutting down`);
  server.close(() => process.exit(0));
  // Belt-and-suspenders: force-exit if close() hangs on an in-flight request.
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
