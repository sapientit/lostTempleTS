/**
 * Environment-agnostic OG share-card logic: everything about "what does the
 * card look like" with no dependency on any particular rasterizer.
 *
 * This module builds the same JSX-like `{type, props}` element tree that
 * both rasterizers (workers-og's `ImageResponse` on Cloudflare, satori
 * directly on the Node/Oracle box) can consume unchanged - see
 * src/share.ts (Cloudflare Worker thin wrapper) and
 * packages/og-renderer/src/render.ts (Node thin wrapper).
 *
 * Image assets are referenced here only by opaque string *keys* (see the
 * SHARE_ASSET_* maps below) - never by actual pixel data. Each environment
 * resolves a key to real image data its own way:
 *   - Worker: key -> base64 data: URI constant in shareAssets.generated.ts.
 *   - Node: key -> file path under assets/share/, read via fs + converted
 *     to a data: URI (see SHARE_ASSET_FILES).
 * This keeps the base64-embedding indirection (needed for the Worker build,
 * pointless overhead for a plain Node process with normal filesystem
 * access) entirely out of this shared module.
 */

import { DAILY_START_MS, DAY_MS, toIntOrNull } from "./parse.js";

const DEFAULT_LANGUAGE = "en";

/** Cache-control for the /og/ share-card PNG - the response is a pure
 * function of its five path segments, so it's safe to cache forever.
 * Shared (not Worker-specific) so both the Cloudflare and Node/Oracle-box
 * paths apply the exact same header. */
export const SHARE_IMAGE_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Resolves an opaque asset key (see SHARE_ASSET_FILES) to a usable `src`
 * value (data: URI in both current environments). */
export type AssetResolver = (key: string) => string;

// Background + title art + expedition-result art are always the same
// combination for a given level/language, so they're pre-composited offline
// into one merged template image per level (see assets/share/README.md and
// the composite script referenced there) - the request-time render draws
// ONE image layer here instead of three.
//
// Only English assets exist today. An unrecognized/unsupported language
// falls back to English rather than 404ing the whole share image - a social
// link failing outright is worse than serving the wrong language.
const TEMPLATE_KEYS: Record<string, Record<number, string>> = {
  en: {
    1: "template_level1_en", // Mapmaker
    2: "template_level2_en", // Explorer
    3: "template_level3_en", // Pathfinder
    4: "template_level4_en", // Adventurer
    5: "template_level5_en", // Legendary Archaeologist
    6: "template_level6_en", // Insane Mode
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
const STAR_ROW_KEYS: Record<number, string> = {
  1: "star_row_1",
  2: "star_row_2",
  3: "star_row_3",
  4: "star_row_4",
  5: "star_row_5",
};

// Gold amount and date are unbounded values, but every *character* that can
// appear in them is one of a small fixed set (digits, a comma, "Gold", a
// month name) - so each character is pre-rendered offline as its own sprite
// (see assets/share/README.md and the Pillow script referenced there) and
// composited left-to-right at request time, the same cheap image-layer
// pattern the star row already uses. This replaces live Satori text
// rendering entirely for these two boxes: Satori's text-shaping (especially
// with the gold amount's gradient-clip effect) was the dominant CPU cost on
// the Cloudflare Worker's per-request ceiling, not image-layer count.
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
const GOLD_DIGIT_KEYS: Record<string, string> = {
  "0": "gold_digit_0",
  "1": "gold_digit_1",
  "2": "gold_digit_2",
  "3": "gold_digit_3",
  "4": "gold_digit_4",
  "5": "gold_digit_5",
  "6": "gold_digit_6",
  "7": "gold_digit_7",
  "8": "gold_digit_8",
  "9": "gold_digit_9",
  ",": "gold_comma",
};
const GOLD_WORD_KEY = "gold_word";

const DATE_DIGIT_KEYS: Record<string, string> = {
  "0": "date_digit_0",
  "1": "date_digit_1",
  "2": "date_digit_2",
  "3": "date_digit_3",
  "4": "date_digit_4",
  "5": "date_digit_5",
  "6": "date_digit_6",
  "7": "date_digit_7",
  "8": "date_digit_8",
  "9": "date_digit_9",
};

// Indexed 0-11 to match Date.getUTCMonth().
const DATE_MONTH_KEYS: readonly string[] = [
  "date_month_january",
  "date_month_february",
  "date_month_march",
  "date_month_april",
  "date_month_may",
  "date_month_june",
  "date_month_july",
  "date_month_august",
  "date_month_september",
  "date_month_october",
  "date_month_november",
  "date_month_december",
];

/**
 * Every asset key referenced by TEMPLATE_KEYS/STAR_ROW_KEYS/GOLD_DIGIT_KEYS/
 * GOLD_WORD_KEY/DATE_DIGIT_KEYS/DATE_MONTH_KEYS, mapped to its source file
 * under assets/share/ - the single source of truth for "which key means
 * which file" so a Node-side resolver (fs.readFileSync) doesn't need to
 * duplicate this list. The Worker's resolver (share.ts) doesn't consume
 * this map - it resolves keys to already-embedded base64 constants instead
 * - but keeping this here (rather than only in the Node package) means
 * both environments' asset lookup ultimately derives from the same key
 * space defined once, in this file.
 */
export const SHARE_ASSET_FILES: Record<string, { file: string; mime: string }> = {
  template_level1_en: { file: "template_level1_en.jpg", mime: "image/jpeg" },
  template_level2_en: { file: "template_level2_en.jpg", mime: "image/jpeg" },
  template_level3_en: { file: "template_level3_en.jpg", mime: "image/jpeg" },
  template_level4_en: { file: "template_level4_en.jpg", mime: "image/jpeg" },
  template_level5_en: { file: "template_level5_en.jpg", mime: "image/jpeg" },
  template_level6_en: { file: "template_level6_en.jpg", mime: "image/jpeg" },
  star_row_1: { file: "star_row_1.png", mime: "image/png" },
  star_row_2: { file: "star_row_2.png", mime: "image/png" },
  star_row_3: { file: "star_row_3.png", mime: "image/png" },
  star_row_4: { file: "star_row_4.png", mime: "image/png" },
  star_row_5: { file: "star_row_5.png", mime: "image/png" },
  gold_digit_0: { file: "gold_digit_0.png", mime: "image/png" },
  gold_digit_1: { file: "gold_digit_1.png", mime: "image/png" },
  gold_digit_2: { file: "gold_digit_2.png", mime: "image/png" },
  gold_digit_3: { file: "gold_digit_3.png", mime: "image/png" },
  gold_digit_4: { file: "gold_digit_4.png", mime: "image/png" },
  gold_digit_5: { file: "gold_digit_5.png", mime: "image/png" },
  gold_digit_6: { file: "gold_digit_6.png", mime: "image/png" },
  gold_digit_7: { file: "gold_digit_7.png", mime: "image/png" },
  gold_digit_8: { file: "gold_digit_8.png", mime: "image/png" },
  gold_digit_9: { file: "gold_digit_9.png", mime: "image/png" },
  gold_comma: { file: "gold_comma.png", mime: "image/png" },
  gold_word: { file: "gold_word.png", mime: "image/png" },
  date_digit_0: { file: "date_digit_0.png", mime: "image/png" },
  date_digit_1: { file: "date_digit_1.png", mime: "image/png" },
  date_digit_2: { file: "date_digit_2.png", mime: "image/png" },
  date_digit_3: { file: "date_digit_3.png", mime: "image/png" },
  date_digit_4: { file: "date_digit_4.png", mime: "image/png" },
  date_digit_5: { file: "date_digit_5.png", mime: "image/png" },
  date_digit_6: { file: "date_digit_6.png", mime: "image/png" },
  date_digit_7: { file: "date_digit_7.png", mime: "image/png" },
  date_digit_8: { file: "date_digit_8.png", mime: "image/png" },
  date_digit_9: { file: "date_digit_9.png", mime: "image/png" },
  date_month_january: { file: "date_month_january.png", mime: "image/png" },
  date_month_february: { file: "date_month_february.png", mime: "image/png" },
  date_month_march: { file: "date_month_march.png", mime: "image/png" },
  date_month_april: { file: "date_month_april.png", mime: "image/png" },
  date_month_may: { file: "date_month_may.png", mime: "image/png" },
  date_month_june: { file: "date_month_june.png", mime: "image/png" },
  date_month_july: { file: "date_month_july.png", mime: "image/png" },
  date_month_august: { file: "date_month_august.png", mime: "image/png" },
  date_month_september: { file: "date_month_september.png", mime: "image/png" },
  date_month_october: { file: "date_month_october.png", mime: "image/png" },
  date_month_november: { file: "date_month_november.png", mime: "image/png" },
  date_month_december: { file: "date_month_december.png", mime: "image/png" },
};

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
// (see TEMPLATE_KEYS above) alongside the background and title art. title
// stays here only for the LEVEL_TITLES_FALLBACK text path (dead code
// today).
export const BOX = {
  title: { left: 173, top: 220, width: 854, height: 52 },
  gold: { left: 69, top: 328, width: 1062, height: 124 },
  stars: { left: 183, top: 460, width: 833, height: 76 },
  date: { left: 493, top: 567, width: 205, height: 31 },
} as const;

// Gradient-clipped fill reads as metallic gold instead of flat yellow. Only
// used by LEVEL_TITLES_FALLBACK below (dead code today - see its comment) -
// the gold amount itself is pre-rendered gold-gradient sprites now (see
// GOLD_DIGIT_KEYS above), not live text, so this style no longer costs
// anything on the request path that actually runs.
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

/** Strict parse of the five /s/ (and /og/) path segments; null on any
 * malformed value. */
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
// present in GOLD_DIGIT_KEYS - so the lookup always hits.
function goldRow(gold: number, resolve: AssetResolver): unknown[] {
  const digits = gold.toLocaleString();
  const children: unknown[] = [];
  for (const ch of digits) {
    children.push(artImage(resolve(GOLD_DIGIT_KEYS[ch]!), GOLD_SPRITE_HEIGHT));
  }
  children.push(spacer(GOLD_SPACE_GAP));
  children.push(artImage(resolve(GOLD_WORD_KEY), GOLD_SPRITE_HEIGHT));
  return children;
}

// day/month/year sprites laid out the same way formatDate() would read
// ("21 July 2026") but computed directly from the epoch ms instead of
// parsing Intl's formatted string. Day/year characters are always digits
// 0-9 (DATE_DIGIT_KEYS covers all of them), month is 0-11 indexing
// DATE_MONTH_KEYS - both lookups always hit.
function dateRow(days: number, resolve: AssetResolver): unknown[] {
  const date = new Date(DAILY_START_MS + days * DAY_MS);
  const day = String(date.getUTCDate());
  const monthKey = DATE_MONTH_KEYS[date.getUTCMonth()]!;
  const year = String(date.getUTCFullYear());
  const children: unknown[] = [];
  for (const ch of day) {
    children.push(artImage(resolve(DATE_DIGIT_KEYS[ch]!), DATE_SPRITE_HEIGHT));
  }
  children.push(spacer(DATE_SPACE_GAP));
  children.push(artImage(resolve(monthKey), DATE_SPRITE_HEIGHT));
  children.push(spacer(DATE_SPACE_GAP));
  for (const ch of year) {
    children.push(artImage(resolve(DATE_DIGIT_KEYS[ch]!), DATE_SPRITE_HEIGHT));
  }
  return children;
}

/**
 * Builds the share-card element tree - the same JSX-like `{type, props}`
 * object tree both workers-og's `ImageResponse` and satori() accept
 * directly, no per-rasterizer translation needed. `resolve` turns each
 * opaque asset key (see SHARE_ASSET_FILES) into a usable `src` value.
 */
export function buildShareElement(params: ShareParams, resolve: AssetResolver): unknown {
  const defaultTemplateKeys = TEMPLATE_KEYS[DEFAULT_LANGUAGE] ?? {};
  const templateKeys = TEMPLATE_KEYS[params.language] ?? defaultTemplateKeys;
  const templateKey = templateKeys[params.level] ?? defaultTemplateKeys[params.level];
  // parseShareSegments guarantees stars is an integer 1-5, so this index
  // always hits.
  const starRowKey = STAR_ROW_KEYS[params.stars]!;

  return {
    type: "div",
    props: {
      style: { position: "relative", width: 1200, height: 620, display: "flex" },
      children: [
        ...(templateKey !== undefined
          ? [
              {
                type: "img",
                props: {
                  src: resolve(templateKey),
                  width: 1200,
                  height: 620,
                  style: { position: "absolute", left: 0, top: 0 },
                },
              },
            ]
          : [
              // No pre-composited template for this level/language (dead
              // code today - see LEVEL_TITLES_FALLBACK above): no
              // background or expResult art either in that case, just the
              // title text so the render doesn't break outright.
              box(BOX.title, LEVEL_TITLES_FALLBACK[params.level] ?? `Level ${params.level}`, {
                fontFamily: "CinzelDecorative",
                fontSize: 40,
                textAlign: "center",
                ...GOLD_GRADIENT_STYLE,
              }),
            ]),
        box(BOX.gold, goldRow(params.gold, resolve)),
        box(BOX.stars, artImage(resolve(starRowKey), 60)),
        box(BOX.date, dateRow(params.days, resolve)),
      ],
    },
  };
}

/** Whether buildShareElement() for these params needs the CinzelDecorative
 * font loaded (only true for the dead-code LEVEL_TITLES_FALLBACK path -
 * every level has real template art today, so this is always false in
 * practice, but rasterizers that require fonts declared up front should
 * still check this rather than assume). */
export function shareElementNeedsFallbackFont(params: ShareParams): boolean {
  const defaultTemplateKeys = TEMPLATE_KEYS[DEFAULT_LANGUAGE] ?? {};
  const templateKeys = TEMPLATE_KEYS[params.language] ?? defaultTemplateKeys;
  const templateKey = templateKeys[params.level] ?? defaultTemplateKeys[params.level];
  return templateKey === undefined;
}

// Plain-text level names for the og:title - mirrors the certified-title
// copy in temple-client/src/content/helpText.ts levelDescriptions (the part
// before " - "), same names as the level title art baked into TEMPLATE_KEYS
// above.
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
