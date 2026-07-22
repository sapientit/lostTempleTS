# OG share card

`GET /s/<level>/<gold>/<stars>/<days>/<language>` (`src/share.ts`, wired into
`src/index.ts`) renders a 1200x620 PNG for social link previews.

## Assets

- `template-source.png`, `master-reference.png` — raw 1729x910 sources (the
  master is a full example render with text baked in, for visual reference
  only — not used in the pipeline).
- `og-card-template.jpg` — 1200x620, the actual background. Cropped from the
  source at `(0, 8)-(1729, 901)` (893 tall, matching the 1200:620 ratio at
  full width) then scaled — a much smaller crop than the previous square
  source needed, since this template was composed close to the OG aspect
  ratio already.
- `level1_en.png` .. `level6_en.png`, `expResult_en.png`, `star.png` —
  pre-rendered art overlays, real alpha (see extraction below), cropped to
  content and resized to ~2x their display size. Kept around as the
  compositing *sources*; the Worker no longer loads them individually (see
  below).
- `template_level1_en.jpg` .. `template_level6_en.jpg` — the background,
  that level's title art, and `expResult_en.png` pre-composited offline into
  one 1200x620 JPEG (quality 90) per level. Background/title/expResult
  always co-occur in that exact combination for a given level (English is
  the only language today), so merging them offline means the request-time
  render draws ONE `<img>` layer instead of three — this was one of three
  changes made to cut CPU time on the FREE-plan Worker's per-request CPU
  ceiling (Cloudflare error 1102). Composited with Pillow: title scaled to
  height 44px, expResult scaled to height 26px, both aspect-preserved and
  centered in the boxes below, alpha-pasted onto the opaque background, then
  re-encoded as JPEG (checked visually for ringing/artifacts around text
  edges before accepting quality 90 — none observed).
- `star_row_1.png` .. `star_row_5.png` — the 1-5 possible star counts
  (`stars` is validated to an integer 1-5, so exactly 5 values exist),
  pre-composited as a transparent PNG row of `star.png` icons at 60px
  height with `0 6px` margin per icon (matching the old per-request flex
  layout exactly: row width = count * (iconWidth + 12)). Real alpha
  preserved since this is still placed as a foreground layer inside
  `BOX.stars`, on top of the merged template.
- Fonts: `cinzel-decorative-bold.ttf` (gold amount / date, gradient-styled),
  `marcellus-regular.ttf` (date) — unchanged from the previous template.

`template_level*_en.jpg` and `star_row_*.png` (plus the fonts) are baked
into `../../src/shareAssets.generated.ts` as base64 data URIs — regenerate
that file if any asset changes (re-run the same Pillow compositing + base64
loop; see git history for the exact script). `og-card-template.jpg`,
`level*_en.png`, `expResult_en.png`, and `star.png` are the compositing
inputs, not consumed directly by the Worker anymore, but keep them so the
templates can be regenerated if the layout ever changes.

## Level numbering — IMPORTANT, easy to get wrong again

The first asset batch's level numbers did NOT match
`temple-client/src/content/helpText.ts` `levelDescriptions`. It wasn't a
simple off-by-one:

| Level | Correct title (`levelDescriptions`) |
|---|---|
| 1 | Mapmaker |
| 2 | Explorer |
| 3 | Pathfinder |
| 4 | Adventurer |
| 5 | Legendary Archaeologist |
| 6 | Insane Mode |

The original files had level 1 = "Junior Archaeologist" (not a real level at
all), level 2 = "Mapmaker", level 4 = "Explorer", and no "Adventurer" was
generated at all. Files were renamed/remapped by content, not by number, to
fix this — `level1_en.png` is guaranteed to say "Mapmaker" because someone
looked at the pixels, not because the original filename said "level1".
**Before adding a new language or regenerating any title, always visually
verify what the art actually says before wiring it to a level number** —
don't trust the filename the art tool gave it.

`share.ts` has a text-rendered fallback (`LEVEL_TITLES_FALLBACK`) for any
level whose art doesn't exist yet, so a missing/wrong asset degrades to
readable text instead of breaking the route.

## Transparency extraction (level/expResult images)

The art tool (ChatGPT) exports "transparent" PNGs as a baked-in checkerboard
pattern on opaque RGB — `sips -g hasAlpha` reports `no` on all of them, not
real alpha. Naive fixes that didn't work, in order tried:

1. **Global brightness threshold** — leaves a visible white halo around
   glyphs, because the checkerboard's own brightness range (~236-255)
   overlaps the anti-aliased glyph edge's brightness range. No threshold
   cleanly separates them.
2. **Flood-fill from corners by luminance** — `skimage.segmentation.flood`
   tolerance is measured against the seed's value, not adaptively against
   each newly-added neighbor, so it can't traverse a long smooth gradient
   (white -> near-black -> gold) without a tolerance large enough to eat
   real dark content elsewhere.

**What worked**: saturation, not brightness. The checkerboard and the
glyph's anti-aliased edge are both *desaturated* (R≈G≈B) regardless of how
bright or dark they are; real gold content stays *saturated* (R≫B) even in
its darkest shadow facets. Per-pixel saturation threshold alone handles
text correctly, including enclosed counters (the hole in "e", "d", "o") —
each pixel is judged independently, no connectivity needed, so a counter's
checkerboard pixels correctly go transparent same as the outer background.

The one thing per-pixel saturation can't do: distinguish an intentional
enclosed highlight (a specular glint) from background inside a counter,
if such a highlight existed on a letter. Didn't come up for text, but
mattered for the star icon (see below) — small enclosed low-saturation
blobs are kept opaque (`enclosed_hole_min_px` size threshold, after
dilating to merge a highlight's own internal texture into one blob first),
large ones are cleared as background.

## Star icon — switched to solid-color chroma key

The checkerboard approach hit a wall on `star.png`: it has genuine white
sparkle/glint highlights, indistinguishable from background by saturation
alone (both near-white). A size-based heuristic to keep "small highlights"
but clear "large background blobs" doesn't work either — a star's
legitimate broad shine highlight and a letter's counter are the same size
order, no clean threshold separates them.

Fix: **asked for a version on a solid color background instead**
(`pinkstar.png`, solid magenta) rather than a checkerboard. A distinct,
saturated chroma color is trivially separable from both the gold star and
its white highlights by color distance — no ambiguity, unlike white-on-white.
This is the better approach in general; prefer it over checkerboard exports
for any future asset. Extraction: euclidean RGB distance from the sampled
background color, ramped to alpha, with un-premultiplication (divide out
the background color's contribution) to avoid a colored fringe on
partial-alpha edge pixels. One residual: a faint color cast survives on a
soft contact-shadow area that's genuinely semi-transparent in the source
(a real shadow blended toward whatever's behind it) — not fully fixable
without the true alpha, but negligible at the icon's small on-canvas size.

`star.png` in this directory is the final chroma-keyed result (not the raw
`pinkstar.png`, which stays only in `~/Downloads` on the user's machine).

## Layout — measured, same methodology as before

Coordinates below are in the **final 1200x620 canvas**, top-left origin,
`(x0,y0)-(x1,y1)`. Found via flood-fill of the plain interior + direct pixel
sampling across boundaries (frame vs. interior color), verified visually by
drawing the boxes on the actual template.

| Element | Box | Size | Notes |
|---|---|---|---|
| Title (level name) | `(173,220)-(1027,272)` | 854x52 | now baked into the merged `template_level*_en.jpg`; image, height-fit (44px), centered |
| Expedition Result | `(243,275)-(958,307)` | 715x32 | now baked into the merged template; image, height-fit (26px), centered; static per language, not per level |
| Gold amount | `(69,328)-(1131,452)` | 1062x124 | rendered text, gradient-styled (no shadow — see below) |
| Stars | `(183,460)-(1017,536)` | 833x76 (recentered from measured 833 width) | one pre-baked `star_row_<count>.png`, 60px icons, `0 6px` margin each |
| Date | `(493,567)-(698,598)` | 205x31 | rendered text, sits in the template's blank bottom banner |

Title/expResult were placed at a fixed **height** with aspect ratio
preserved (width varies per title's text length) and centered in their box
by the parent flex container — that centering math is now done once,
offline, when compositing `template_level*_en.jpg` (see Assets above),
rather than by Satori on every request. The star row is pre-baked the same
way, one PNG per possible count.

## CPU-time note (FREE-plan Worker)

This Worker runs on Cloudflare's Workers FREE plan, which has a hard
per-request CPU-time ceiling that can't be raised. `workers-og` (Satori +
`@resvg/resvg-wasm`) rendering this card was blowing that ceiling on ~90% of
requests (Cloudflare error 1102), which silently breaks social link
previews since a crawler's one-time fetch has a ~90% chance of caching "no
preview" permanently. Three changes cut the per-request work: (1) collapsing
background + title + expResult into one pre-composited image layer instead
of three (this section), (2) pre-baking the 5 possible star-row images
instead of compositing up to 5 icons at request time, (3) dropping the
`textShadow` on the gold-amount gradient text — shadow/blur filters are one
of the costliest primitives for `@resvg/resvg-wasm`. If the card design
changes again, keep this in mind: prefer pre-composited art over
request-time Satori layers/filters wherever the content is one of a small
fixed set of combinations (as level/stars are here).

## Language

`/s/.../<language>` uses ISO 639-1 codes (`en`, not `E`/`EN`). Only `en`
exists today. An unrecognized/unsupported code falls back to `en` rather
than 404ing the whole image — a share link failing outright is worse than
serving the wrong language. Adding a language means: generate
`level1_<lang>.png`..`level6_<lang>.png` and `expResult_<lang>.png` (same
content-verification caveat as above applies), run them through the same
extraction pipeline, add to `shareAssets.generated.ts`, and add a `TITLE_IMAGES[lang]` /
`EXP_RESULT_IMAGES[lang]` entry in `share.ts`.
