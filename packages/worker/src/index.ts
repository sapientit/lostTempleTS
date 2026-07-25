/**
 * Worker entrypoints: fetch (routing + StatusPages-equivalent error
 * envelope) and scheduled (daily backstop: alert-only on the free tier).
 */

import { corsHeadersFor, preflight } from "./cors.js";
import type { Env } from "./islands.js";
import { DAY_MS, dayNumber, todayUtcMs } from "./parse.js";
import { respond } from "./respond.js";
import * as routes from "./routes.js";
import {
  injectShareMeta,
  parseShareSegments,
  shareImage,
  shareMeta,
  SHARE_IMAGE_CACHE_CONTROL,
} from "./share.js";

/**
 * Public-facing origin for a request, honoring X-Forwarded-Host/-Proto set
 * by the duckdns.org nginx reverse proxy in front of this Worker. Without
 * this, og:image/og:url would be built from the Cloudflare-visible host
 * (losttemple-api.losttemple.workers.dev) instead of the public domain the
 * link was actually shared under.
 */
function publicOrigin(request: Request, url: URL): string {
  const host = request.headers.get("X-Forwarded-Host") ?? url.host;
  const proto = request.headers.get("X-Forwarded-Proto") ?? url.protocol.slice(0, -1);
  return `${proto}://${host}`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeadersFor(request);
    if (request.method === "OPTIONS") return preflight(cors);
    try {
      const url = new URL(request.url);
      if (request.method === "GET") {
        switch (url.pathname) {
          case "/":
            // Health text; the client never reads it (S§2 route table).
            return new Response("Hello, Ktor!", {
              headers: { ...cors, "Content-Type": "text/plain; charset=utf-8" },
            });
          case "/client/getIsland":
            return await routes.getIsland(url, env, cors);
          case "/client/getDaily":
            return routes.getDaily(url, cors);
          case "/client/getLevel":
            return routes.getLevel(url, cors);
        }
        if (url.pathname.startsWith("/og/")) {
          const segments = url.pathname.slice("/og/".length).split("/");
          const params = parseShareSegments(segments);
          if (params === null) {
            return new Response("Not Found", { status: 404, headers: cors });
          }
          const image = await shareImage(params);
          const headers = new Headers(image.headers);
          for (const [k, v] of Object.entries(cors)) headers.set(k, v);
          headers.set("Cache-Control", SHARE_IMAGE_CACHE_CONTROL);
          return new Response(image.body, { status: image.status, headers });
        }
        if (url.pathname.startsWith("/s/")) {
          const segments = url.pathname.slice("/s/".length).split("/");
          const params = parseShareSegments(segments);
          const indexHtml = await env.ASSETS.fetch(new URL("/index.html", url));
          if (params === null) return indexHtml;
          const origin = publicOrigin(request, url);
          const imageUrl = `${origin}/og/${segments.join("/")}`;
          const pageUrl = `${origin}${url.pathname}${url.search}`;
          const shared = injectShareMeta(indexHtml, shareMeta(params), imageUrl, pageUrl);
          const headers = new Headers(shared.headers);
          for (const [k, v] of Object.entries(cors)) headers.set(k, v);
          headers.set("Cache-Control", SHARE_IMAGE_CACHE_CONTROL);
          return new Response(shared.body, { status: shared.status, headers });
        }
      }
      if (request.method === "POST" && url.pathname === "/client/execute") {
        return await routes.execute(request, env, cors);
      }
      if (request.method === "POST" && url.pathname === "/client/explain") {
        return await routes.explain(request, env, cors);
      }
      return new Response("Not Found", { status: 404, headers: cors });
    } catch (cause) {
      // StatusPages parity: 500 envelope carrying message + stack.
      console.error("Unhandled exception:", cause);
      const error =
        cause instanceof Error
          ? `${cause.message || "Unknown error"}\n${cause.stack ?? ""}`
          : String(cause);
      return respond(500, { status: "error", error }, null, cors);
    }
  },

  /**
   * 00:05 UTC backstop (PORTING.md §5.4): check that TOMORROW's six daily
   * rows exist. Free tier: generating a daily needs testPossible over
   * possibly thousands of seeds (blows the CPU budget), so this only writes
   * an alerts row for the owner; a missing daily degrades to the level-map
   * fallback exactly like Kotlin's IslandStore does.
   */
  async scheduled(event: ScheduledEvent, env: Env): Promise<void> {
    const tomorrow = todayUtcMs(event.scheduledTime) + DAY_MS;
    const day = dayNumber(tomorrow);
    const nums = [1, 2, 3, 4, 5, 6].map((l) => l * 1_000_000 + day);
    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS c FROM islands WHERE kind = 'daily' AND num IN (?1,?2,?3,?4,?5,?6)",
    )
      .bind(...nums)
      .first<{ c: number }>();
    const present = row?.c ?? 0;
    if (present < 6) {
      await env.DB.prepare("INSERT INTO alerts (at, kind, detail) VALUES (?1, ?2, ?3)")
        .bind(
          new Date(event.scheduledTime).toISOString(),
          "missing_dailies",
          `day ${day} (${new Date(tomorrow).toISOString().slice(0, 10)}): ${present}/6 daily rows present - run pregen dailies`,
        )
        .run();
      console.error(`ALERT: only ${present}/6 dailies for day ${day}`);
    }
  },
};
