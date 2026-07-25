/**
 * Node-side rasterizer for the shared share-card element tree: satori
 * (element tree -> SVG string) + @resvg/resvg-js (SVG -> RGBA pixels) +
 * sharp (RGBA pixels -> JPEG bytes). This is the Oracle-box equivalent of
 * packages/worker/src/share.ts's workers-og-based shareImage() - both call
 * the exact same buildShareElement() from @losttemple/worker/share-tree, so
 * nothing about "what the card looks like" is duplicated between the two
 * environments.
 *
 * JPEG (not PNG) because the card is a full-bleed photographic/textured
 * template image (see shareTree.ts buildShareElement - the template <img>
 * covers the entire 1200x620 canvas), which lossless PNG compresses very
 * poorly (~1.5MB) versus JPEG at quality 82 (~100-200KB). That size mattered
 * in practice: WhatsApp's link-preview fetcher is stricter about payload
 * size/latency than a generic crawler and was failing to show the preview
 * at the larger PNG size.
 *
 * @resvg/resvg-js (NOT @resvg/resvg-wasm) is required here: it ships
 * prebuilt native bindings per platform (linux-x64-gnu covers Oracle
 * Linux 9 x86_64, which is glibc-based) and works under plain Node, unlike
 * workers-og itself which imports .wasm in a way only Wrangler's bundler
 * resolves.
 */

import { Resvg } from "@resvg/resvg-js";
import satori from "satori";
import sharp from "sharp";
import {
  buildShareElement,
  shareElementNeedsFallbackFont,
  type ShareParams,
} from "@losttemple/worker/share-tree";
import { loadFallbackFontBuffer, resolveAsset } from "./assets.js";

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 620;

const JPEG_QUALITY = 82;

// Loaded once at startup - only exercised by the dead-code
// LEVEL_TITLES_FALLBACK path (see shareTree.ts: every level has real
// template art today), but it's a small file and rarely changes, so keeping
// it warm costs nothing.
const fallbackFontData = loadFallbackFontBuffer();

/** Renders the /og/ share card for `params` to a JPEG buffer. */
export async function renderShareImageJpeg(params: ShareParams): Promise<Buffer> {
  const element = buildShareElement(params, resolveAsset);
  const svg = await satori(element as never, {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    // Empty when not needed (always true today - see
    // shareElementNeedsFallbackFont) rather than unconditionally supplying
    // font data satori will never reference. Confirmed against a real
    // template render that satori/resvg tolerate an empty fonts array fine
    // when the tree has no live text nodes.
    fonts: shareElementNeedsFallbackFont(params)
      ? [{ name: "CinzelDecorative", data: fallbackFontData, weight: 700, style: "normal" }]
      : [],
  });
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: CARD_WIDTH },
  });
  const rendered = resvg.render();
  return sharp(rendered.pixels, {
    raw: { width: rendered.width, height: rendered.height, channels: 4 },
  })
    // Template art is full-bleed and opaque, but flatten defensively so any
    // stray transparent pixel (e.g. antialiased edges) doesn't turn black -
    // JPEG has no alpha channel and sharp would otherwise composite onto one.
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: JPEG_QUALITY, mozjpeg: true })
    .toBuffer();
}
