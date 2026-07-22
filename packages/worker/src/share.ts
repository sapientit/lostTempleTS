/**
 * OG share-card image: GET /og/<level>/<gold>/<stars>/<days>/<language>.
 *
 * A pure function of its five path segments (see parseShareSegments below),
 * so the response is cached aggressively. Background/box coordinates are the
 * measured layout recorded in assets/share/README.md - keep the two in sync.
 *
 * GET /s/<same five segments> serves the client's index.html with og:* meta
 * tags pointing at the /og/ image above, so social/chat unfurlers get a
 * share-card preview while a human visitor still lands in the game
 * (buildShareHtml below).
 */

import { ImageResponse } from "workers-og";
import cinzelDecorativeBold from "../assets/share/cinzel-decorative-bold.ttf";
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
import { DAILY_START_MS, DAY_MS, toIntOrNull } from "./parse.js";

export const SHARE_IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

const DEFAULT_LANGUAGE = "en";

// Background + title art + expedition-result art are always the same
// combination for a given level/language, so they're pre-composited offline
// into one merged template image per level (see assets/share/README.md and
// the composite script referenced there) - the request-time render draws
// ONE image layer here instead of three.
//
// Only English assets exist today. An unrecognized/unsupported language
// falls back to English rather than 404ing the whole share image - a social
// link failing outright is worse than serving the wrong language.
const TEMPLATES: Record<string, Record<number, string>> = {
  en: {
    1: LEVEL_1_TEMPLATE_EN, // Mapmaker
    2: LEVEL_2_TEMPLATE_EN, // Explorer
    3: LEVEL_3_TEMPLATE_EN, // Pathfinder
    4: LEVEL_4_TEMPLATE_EN, // Adventurer
    5: LEVEL_5_TEMPLATE_EN, // Legendary Archaeologist
    6: LEVEL_6_TEMPLATE_EN, // Insane Mode
  },
};

// Text fallback for any level without a pre-composited template (none
// currently - all 6 levels have real art, so this path is dead code today).
// Mirrors temple-client/src/content/helpText.ts levelDescriptions (the part
// before " - "), via levelDisplayName() in JourneyResultModal.tsx. Add an
// entry here if a new level or language ships without art yet, remove it
// once the art exists (same pattern that covered level 4 until its
// "Adventurer" art was generated). Note: without a merged template there's
// also no background/expResult art for that level - this fallback only
// keeps the render from breaking, it doesn't attempt to reproduce the full
// card layout.
const LEVEL_TITLES_FALLBACK: Record<number, string> = {};

// stars is always validated to an integer 1-5 by parseShareSegments below -
// exactly 5 possible pre-baked star-row images.
const STAR_ROWS: Record<number, string> = {
  1: STAR_ROW_1,
  2: STAR_ROW_2,
  3: STAR_ROW_3,
  4: STAR_ROW_4,
  5: STAR_ROW_5,
};

// Gold amount and date are unbounded values, but every *character* that can
// appear in them is one of a small fixed set (digits, a comma, "Gold", a
// month name) - so each character is pre-rendered offline as its own sprite
// (see assets/share/README.md and the Pillow script referenced there) and
// composited left-to-right at request time, the same cheap image-layer
// pattern the star row already uses. This replaces live Satori text
// rendering entirely for these two boxes: Satori's text-shaping (especially
// with the gold amount's gradient-clip effect) was the dominant CPU cost on
// this FREE-plan Worker's per-request ceiling, not image-layer count - see
// the CPU-time note in README.md.
//
// Sprite canvas heights match the source font's ascent+descent at the CSS
// fontSize being replaced (92 for gold/CinzelDecorative, 26 for
// date/Marcellus) and every sprite in a group shares that same height with
// the glyph drawn from the same y-origin, so stacking them at a common
// "top" keeps them baseline-aligned - no per-character vertical jitter.
// Sprite canvas WIDTH is each character's natural advance width (not a
// tight ink-bbox crop), so concatenating sprites with zero gap reproduces
// the same spacing continuous text rendering would (kerning aside, which is
// negligible for digits/month names here).
const GOLD_DIGIT_SPRITES: Record<string, string> = {
  "0": GOLD_DIGIT_0,
  "1": GOLD_DIGIT_1,
  "2": GOLD_DIGIT_2,
  "3": GOLD_DIGIT_3,
  "4": GOLD_DIGIT_4,
  "5": GOLD_DIGIT_5,
  "6": GOLD_DIGIT_6,
  "7": GOLD_DIGIT_7,
  "8": GOLD_DIGIT_8,
  "9": GOLD_DIGIT_9,
  ",": GOLD_COMMA,
};

const DATE_DIGIT_SPRITES: Record<string, string> = {
  "0": DATE_DIGIT_0,
  "1": DATE_DIGIT_1,
  "2": DATE_DIGIT_2,
  "3": DATE_DIGIT_3,
  "4": DATE_DIGIT_4,
  "5": DATE_DIGIT_5,
  "6": DATE_DIGIT_6,
  "7": DATE_DIGIT_7,
  "8": DATE_DIGIT_8,
  "9": DATE_DIGIT_9,
};

// Indexed 0-11 to match Date.getUTCMonth().
const DATE_MONTH_SPRITES: readonly string[] = [
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
];

// Native pixel height of every gold/date sprite (see gen_text_sprites.py):
// font ascent+descent at the fontSize being replaced. Passed as the `height`
// prop on each sprite <img> so no request-time rescaling is needed for the
// common case - cheaper for the rasterizer than the star row's scale-to-60px
// (which is scaling a much larger source image, not these already
// tight-fit sprites).
const GOLD_SPRITE_HEIGHT = 125;
const DATE_SPRITE_HEIGHT = 34;

// Advance width of a plain space in each font at its size - used as the gap
// between the gold number and the word "Gold", and between the
// day/month/year groups in the date row, matching the space character in
// the original live-text strings.
const GOLD_SPACE_GAP = 23;
const DATE_SPACE_GAP = 8;

// Measured boxes in the 1200x620 canvas - see assets/share/README.md.
// Keep in sync with that file if the background template ever changes.
// expResult no longer has its own box: it's baked into the merged template
// (see TEMPLATES above) alongside the background and title art. title stays
// here only for the LEVEL_TITLES_FALLBACK text path (dead code today).
const BOX = {
  title: { left: 173, top: 220, width: 854, height: 52 },
  gold: { left: 69, top: 328, width: 1062, height: 124 },
  stars: { left: 183, top: 460, width: 833, height: 76 },
  date: { left: 493, top: 567, width: 205, height: 31 },
} as const;

// Gradient-clipped fill reads as metallic gold instead of flat yellow. Only
// used by LEVEL_TITLES_FALLBACK below (dead code today - see its comment) -
// the gold amount itself is pre-rendered gold-gradient sprites now (see
// GOLD_DIGIT_SPRITES above), not live Satori text, so this style no longer
// costs anything on the request path that actually runs.
const GOLD_GRADIENT_STYLE = {
  color: "transparent",
  backgroundImage: "linear-gradient(180deg, #fff4c2 0%, #f2c94c 35%, #b8860b 70%, #f2c94c 100%)",
  backgroundClip: "text",
} as const;

export interface ShareParams {
  level: number;
  gold: number;
  stars: number;
  days: number;
  language: string;
}

const LANGUAGE_RE = /^[a-z]{2,3}$/;

/** Strict parse of the five /s/ path segments; null on any malformed value. */
export function parseShareSegments(segments: string[]): ShareParams | null {
  if (segments.length !== 5) return null;
  const [levelStr, goldStr, starsStr, daysStr, languageStr] = segments;
  const level = toIntOrNull(levelStr);
  const gold = toIntOrNull(goldStr);
  const stars = toIntOrNull(starsStr);
  const days = toIntOrNull(daysStr);
  if (level === null || level < 1 || level > 6) return null;
  if (gold === null || gold < 0) return null;
  if (stars === null || stars < 1 || stars > 5) return null;
  if (days === null || days < 0) return null;
  if (languageStr === undefined || !LANGUAGE_RE.test(languageStr)) return null;
  return { level, gold, stars, days, language: languageStr };
}

function formatDate(days: number): string {
  const ms = DAILY_START_MS + days * DAY_MS;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(ms);
}

function box(b: (typeof BOX)[keyof typeof BOX], children: unknown, extraStyle: Record<string, unknown> = {}) {
  return {
    type: "div",
    props: {
      style: {
        position: "absolute",
        left: b.left,
        top: b.top,
        width: b.width,
        height: b.height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        ...extraStyle,
      },
      children,
    },
  };
}

// Pre-rendered art, fit to its box height with aspect ratio preserved -
// width varies per title/label, so only height is fixed.
function artImage(src: string, height: number) {
  return { type: "img", props: { src, height, style: { display: "block" } } };
}

// Invisible fixed-width gap between sprite groups (e.g. gold number <-> the
// word "Gold", or day <-> month <-> year) - same purpose as the star row's
// old `margin: "0 6px"`, just as an explicit element since these rows mix
// variable-width sprites rather than repeating one fixed icon.
function spacer(width: number) {
  return { type: "div", props: { style: { width, height: 1 } } };
}

// "2,715" -> [sprite(2), sprite(,), sprite(7), sprite(1), sprite(5)]. Every
// character of toLocaleString() output is one of "0123456789," - all
// present in GOLD_DIGIT_SPRITES - so the lookup always hits.
function goldRow(gold: number): unknown[] {
  const digits = gold.toLocaleString();
  const children: unknown[] = [];
  for (const ch of digits) {
    children.push(artImage(GOLD_DIGIT_SPRITES[ch]!, GOLD_SPRITE_HEIGHT));
  }
  children.push(spacer(GOLD_SPACE_GAP));
  children.push(artImage(GOLD_WORD, GOLD_SPRITE_HEIGHT));
  return children;
}

// day/month/year sprites laid out the same way formatDate() would read
// ("21 July 2026") but computed directly from the epoch ms instead of
// parsing Intl's formatted string. Day/year characters are always digits
// 0-9 (DATE_DIGIT_SPRITES covers all of them), month is 0-11 indexing
// DATE_MONTH_SPRITES - both lookups always hit.
function dateRow(days: number): unknown[] {
  const date = new Date(DAILY_START_MS + days * DAY_MS);
  const day = String(date.getUTCDate());
  const month = DATE_MONTH_SPRITES[date.getUTCMonth()]!;
  const year = String(date.getUTCFullYear());
  const children: unknown[] = [];
  for (const ch of day) {
    children.push(artImage(DATE_DIGIT_SPRITES[ch]!, DATE_SPRITE_HEIGHT));
  }
  children.push(spacer(DATE_SPACE_GAP));
  children.push(artImage(month, DATE_SPRITE_HEIGHT));
  children.push(spacer(DATE_SPACE_GAP));
  for (const ch of year) {
    children.push(artImage(DATE_DIGIT_SPRITES[ch]!, DATE_SPRITE_HEIGHT));
  }
  return children;
}

export async function shareImage(params: ShareParams): Promise<Response> {
  const defaultTemplates = TEMPLATES[DEFAULT_LANGUAGE] ?? {};
  const templates = TEMPLATES[params.language] ?? defaultTemplates;
  const templateSrc = templates[params.level] ?? defaultTemplates[params.level];
  // parseShareSegments guarantees stars is an integer 1-5, so this index
  // always hits.
  const starRowSrc = STAR_ROWS[params.stars]!;

  const element = {
    type: "div",
    props: {
      style: { position: "relative", width: 1200, height: 620, display: "flex" },
      children: [
        ...(templateSrc !== undefined
          ? [
              {
                type: "img",
                props: {
                  src: templateSrc,
                  width: 1200,
                  height: 620,
                  style: { position: "absolute", left: 0, top: 0 },
                },
              },
            ]
          : [
              // No pre-composited template for this level/language (dead
              // code today - see LEVEL_TITLES_FALLBACK above): no background
              // or expResult art either in that case, just the title text
              // so the render doesn't break outright.
              box(BOX.title, LEVEL_TITLES_FALLBACK[params.level] ?? `Level ${params.level}`, {
                fontFamily: "CinzelDecorative",
                fontSize: 40,
                textAlign: "center",
                ...GOLD_GRADIENT_STYLE,
              }),
            ]),
        box(BOX.gold, goldRow(params.gold)),
        box(BOX.stars, artImage(starRowSrc, 60)),
        box(BOX.date, dateRow(params.days)),
      ],
    },
  };

  return new ImageResponse(element as never, {
    width: 1200,
    height: 620,
    // Only needed for LEVEL_TITLES_FALLBACK's live text (dead code today -
    // no level is missing its pre-composited template). Marcellus is gone
    // entirely: the date box is sprite-composited now, no live text uses it.
    fonts: [{ name: "CinzelDecorative", data: cinzelDecorativeBold, weight: 700, style: "normal" }],
  });
}

// Plain-text level names for the og:title - mirrors the certified-title
// copy in temple-client/src/content/helpText.ts levelDescriptions (the part
// before " - "), same names as the level title art baked into TEMPLATES above.
const LEVEL_NAMES: Record<number, string> = {
  1: "Mapmaker",
  2: "Explorer",
  3: "Pathfinder",
  4: "Adventurer",
  5: "Legendary Archaeologist",
  6: "Insane Mode",
};

/** Builds the og:title/og:description text for a /s/ share page. */
export function shareMeta(params: ShareParams): { title: string; description: string } {
  const levelName = LEVEL_NAMES[params.level] ?? `Level ${params.level}`;
  return {
    title: `Lost Temple · ${levelName}`,
    description: `${params.gold.toLocaleString()} gold · ${"⭐".repeat(params.stars)} · ${formatDate(params.days)}`,
  };
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
