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
import { renderShareImagePng } from "./render.js";

const HOST = "127.0.0.1";
const PORT = Number(process.env.OG_RENDERER_PORT ?? 8081);
const OG_PREFIX = "/og/";

const server = createServer((req, res) => {
  void (async () => {
    try {
      if (req.method !== "GET" && req.method !== "HEAD") {
        res.writeHead(405, { "Content-Type": "text/plain; charset=utf-8" }).end("Method Not Allowed");
        return;
      }
      const url = new URL(req.url ?? "/", `http://${HOST}`);
      if (!url.pathname.startsWith(OG_PREFIX)) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
        return;
      }
      const segments = url.pathname.slice(OG_PREFIX.length).split("/");
      const params = parseShareSegments(segments);
      if (params === null) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not Found");
        return;
      }
      const png = await renderShareImagePng(params);
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": png.length,
        "Cache-Control": SHARE_IMAGE_CACHE_CONTROL,
      });
      res.end(req.method === "HEAD" ? undefined : png);
    } catch (cause) {
      console.error("og-renderer: request failed:", cause);
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
