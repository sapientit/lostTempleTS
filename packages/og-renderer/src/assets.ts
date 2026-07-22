/**
 * Node-side asset resolver for the shared share-card element tree (see
 * @losttemple/worker/share-tree buildShareElement). Where the Cloudflare
 * Worker resolves each opaque asset key to a base64 data: URI constant
 * baked into shareAssets.generated.ts at build time, this process just
 * reads the same source PNG/JPG files straight off disk - this is a normal
 * long-lived Node process on the Oracle box with an ordinary filesystem, so
 * the base64-embedding indirection the Worker needs doesn't apply here.
 *
 * Assumes a sibling checkout layout (packages/og-renderer next to
 * packages/worker, both under the same monorepo root) - true both in this
 * repo's local layout and in however the Oracle box gets a copy of it
 * (git clone or rsync of the whole repo).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SHARE_ASSET_FILES, type AssetResolver } from "@losttemple/worker/share-tree";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORKER_ASSETS_DIR = path.join(HERE, "../../worker/assets/share");
const FALLBACK_FONT_PATH = path.join(WORKER_ASSETS_DIR, "cinzel-decorative-bold.ttf");

// Preloaded once at process startup (~40 small PNG/JPG files, a few hundred
// KB total) rather than read-per-request: this is a long-lived service, not
// a per-request cold start, so there's no reason to repeat the disk read +
// base64 encode on every hit.
const dataUriCache = new Map<string, string>();

function loadAllAssets(): void {
  for (const [key, { file, mime }] of Object.entries(SHARE_ASSET_FILES)) {
    const bytes = readFileSync(path.join(WORKER_ASSETS_DIR, file));
    dataUriCache.set(key, `data:${mime};base64,${bytes.toString("base64")}`);
  }
}

loadAllAssets();

export const resolveAsset: AssetResolver = (key: string): string => {
  const value = dataUriCache.get(key);
  if (value === undefined) throw new Error(`og-renderer: unknown share asset key "${key}"`);
  return value;
};

/** Only exercised by the dead-code LEVEL_TITLES_FALLBACK path (see
 * shareTree.ts) - loaded once regardless, it's cheap and rarely-changing. */
export function loadFallbackFontBuffer(): Buffer {
  return readFileSync(FALLBACK_FONT_PATH);
}
