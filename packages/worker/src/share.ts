/**
 * OG share-card image: GET /og/<level>/<gold>/<stars>/<days>/<language>.
 *
 * A pure function of its five path segments (see parseShareSegments,
 * re-exported from ./shareTree.js), so the response is cached aggressively.
 * Background/box coordinates are the measured layout recorded in
 * assets/share/README.md - keep the two in sync.
 *
 * GET /s/<same five segments> serves the client's index.html with og:* meta
 * tags pointing at the /og/ image above, so social/chat unfurlers get a
 * share-card preview while a human visitor still lands in the game
 * (buildShareHtml below).
 *
 * This file is the Cloudflare-Worker-specific half of the share-card
 * pipeline: it resolves the portable asset *keys* built by ./shareTree.js
 * to the base64 data: URI constants baked into shareAssets.generated.ts,
 * then rasterizes via workers-og's ImageResponse (the only Worker-specific
 * dependency in this whole feature). The Node/Oracle-box equivalent lives
 * in packages/og-renderer and resolves the same keys to on-disk files
 * instead, then rasterizes via satori + @resvg/resvg-js - see
 * packages/og-renderer/src/render.ts. Both environments call the exact same
 * buildShareElement() to build the element tree; nothing about "what the
 * card looks like" is duplicated between them.
 */

import { ImageResponse } from "workers-og";
import cinzelDecorativeBold from "../assets/share/cinzel-decorative-bold.ttf";
import {
  buildShareElement,
  parseShareSegments,
  shareElementNeedsFallbackFont,
  shareMeta,
  SHARE_IMAGE_CACHE_CONTROL,
  type ShareParams,
} from "./shareTree.js";
import {
  LEVEL_1_TEMPLATE_EN,
  LEVEL_2_TEMPLATE_EN,
  LEVEL_3_TEMPLATE_EN,
  LEVEL_4_TEMPLATE_EN,
  LEVEL_5_TEMPLATE_EN,
  LEVEL_6_TEMPLATE_EN,
  STAR_ROW_1,
  STAR_ROW_2,
  STAR_ROW_3,
  STAR_ROW_4,
  STAR_ROW_5,
  GOLD_DIGIT_0,
  GOLD_DIGIT_1,
  GOLD_DIGIT_2,
  GOLD_DIGIT_3,
  GOLD_DIGIT_4,
  GOLD_DIGIT_5,
  GOLD_DIGIT_6,
  GOLD_DIGIT_7,
  GOLD_DIGIT_8,
  GOLD_DIGIT_9,
  GOLD_COMMA,
  GOLD_WORD,
  DATE_DIGIT_0,
  DATE_DIGIT_1,
  DATE_DIGIT_2,
  DATE_DIGIT_3,
  DATE_DIGIT_4,
  DATE_DIGIT_5,
  DATE_DIGIT_6,
  DATE_DIGIT_7,
  DATE_DIGIT_8,
  DATE_DIGIT_9,
  DATE_MONTH_JANUARY,
  DATE_MONTH_FEBRUARY,
  DATE_MONTH_MARCH,
  DATE_MONTH_APRIL,
  DATE_MONTH_MAY,
  DATE_MONTH_JUNE,
  DATE_MONTH_JULY,
  DATE_MONTH_AUGUST,
  DATE_MONTH_SEPTEMBER,
  DATE_MONTH_OCTOBER,
  DATE_MONTH_NOVEMBER,
  DATE_MONTH_DECEMBER,
} from "./shareAssets.generated.js";

export { parseShareSegments, shareMeta, SHARE_IMAGE_CACHE_CONTROL, type ShareParams };

// Maps each portable asset key (see shareTree.ts SHARE_ASSET_FILES) to the
// matching base64 data: URI constant generated offline into
// shareAssets.generated.ts. Keep in sync with SHARE_ASSET_FILES there - the
// keys on both sides must match exactly (a mismatch throws at request time
// below, not silently).
const ASSETS: Record<string, string> = {
  template_level1_en: LEVEL_1_TEMPLATE_EN,
  template_level2_en: LEVEL_2_TEMPLATE_EN,
  template_level3_en: LEVEL_3_TEMPLATE_EN,
  template_level4_en: LEVEL_4_TEMPLATE_EN,
  template_level5_en: LEVEL_5_TEMPLATE_EN,
  template_level6_en: LEVEL_6_TEMPLATE_EN,
  star_row_1: STAR_ROW_1,
  star_row_2: STAR_ROW_2,
  star_row_3: STAR_ROW_3,
  star_row_4: STAR_ROW_4,
  star_row_5: STAR_ROW_5,
  gold_digit_0: GOLD_DIGIT_0,
  gold_digit_1: GOLD_DIGIT_1,
  gold_digit_2: GOLD_DIGIT_2,
  gold_digit_3: GOLD_DIGIT_3,
  gold_digit_4: GOLD_DIGIT_4,
  gold_digit_5: GOLD_DIGIT_5,
  gold_digit_6: GOLD_DIGIT_6,
  gold_digit_7: GOLD_DIGIT_7,
  gold_digit_8: GOLD_DIGIT_8,
  gold_digit_9: GOLD_DIGIT_9,
  gold_comma: GOLD_COMMA,
  gold_word: GOLD_WORD,
  date_digit_0: DATE_DIGIT_0,
  date_digit_1: DATE_DIGIT_1,
  date_digit_2: DATE_DIGIT_2,
  date_digit_3: DATE_DIGIT_3,
  date_digit_4: DATE_DIGIT_4,
  date_digit_5: DATE_DIGIT_5,
  date_digit_6: DATE_DIGIT_6,
  date_digit_7: DATE_DIGIT_7,
  date_digit_8: DATE_DIGIT_8,
  date_digit_9: DATE_DIGIT_9,
  date_month_january: DATE_MONTH_JANUARY,
  date_month_february: DATE_MONTH_FEBRUARY,
  date_month_march: DATE_MONTH_MARCH,
  date_month_april: DATE_MONTH_APRIL,
  date_month_may: DATE_MONTH_MAY,
  date_month_june: DATE_MONTH_JUNE,
  date_month_july: DATE_MONTH_JULY,
  date_month_august: DATE_MONTH_AUGUST,
  date_month_september: DATE_MONTH_SEPTEMBER,
  date_month_october: DATE_MONTH_OCTOBER,
  date_month_november: DATE_MONTH_NOVEMBER,
  date_month_december: DATE_MONTH_DECEMBER,
};

function resolveAsset(key: string): string {
  const value = ASSETS[key];
  if (value === undefined) throw new Error(`share.ts: unknown share asset key "${key}"`);
  return value;
}

export async function shareImage(params: ShareParams): Promise<Response> {
  const element = buildShareElement(params, resolveAsset);
  return new ImageResponse(element as never, {
    width: 1200,
    height: 620,
    // Only needed for the LEVEL_TITLES_FALLBACK dead-code text path (see
    // shareTree.ts) - no level is missing its pre-composited template
    // today, so this is always `[]` in practice. Skipping the font array
    // entirely when it's not needed avoids handing workers-og font data it
    // will never use.
    fonts: shareElementNeedsFallbackFont(params)
      ? [{ name: "CinzelDecorative", data: cinzelDecorativeBold, weight: 700, style: "normal" }]
      : [],
  });
}

/**
 * Rewrites the client's index.html <head> with og: and twitter: meta tags
 * so chat/social unfurlers see the share card; the client itself boots exactly
 * as it would from any other path. HTMLRewriter streams the transform, so
 * this never buffers the whole document in memory.
 */
export function injectShareMeta(
  indexHtml: Response,
  meta: { title: string; description: string },
  imageUrl: string,
  pageUrl: string,
): Response {
  const tags =
    `<meta property="og:type" content="website">` +
    `<meta property="og:title" content="${escapeAttr(meta.title)}">` +
    `<meta property="og:description" content="${escapeAttr(meta.description)}">` +
    `<meta property="og:image" content="${escapeAttr(imageUrl)}">` +
    `<meta property="og:image:width" content="1200">` +
    `<meta property="og:image:height" content="620">` +
    `<meta property="og:url" content="${escapeAttr(pageUrl)}">` +
    `<meta name="twitter:card" content="summary_large_image">`;
  return new HTMLRewriter()
    .on("head", {
      element(el) {
        el.append(tags, { html: true });
      },
    })
    .transform(indexHtml);
}

function escapeAttr(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
