# WhatsApp-specific share image

`packages/og-renderer/src/server.ts` serves a different `og:image` to
WhatsApp than everyone else. Both images and the reasoning live here; the
actual build is `build.py` in this directory (see its module docstring for
full detail - this file is the short version).

## Why WhatsApp gets a different image

WhatsApp's link-preview fetcher picks between two very different layouts -
a small thumbnail cropped and placed next to the title/description text, or
a full-width "large image" card - based on `og:image`'s aspect ratio, not
anything declared in meta tags. The normal share card
(`packages/worker/src/shareTree.ts`, 1200x620) gets the small/cropped
layout, which only leaves the gold amount legible - everything else
(title, stars, date) gets cropped away or shrunk illegibly.

Since `og:description` (`packages/worker/src/share.ts`) already carries the
gold amount, star count, and date as real text regardless of image size,
nothing is actually lost by the image itself being small - so instead of
fighting WhatsApp's layout, this image just shows the star count, large and
legible, dropping everything the description text already covers.

## What it looks like

`source-hex-frame.png` is an untouched copy of an earlier, square
(1254x1254) hexagonal OG-card design - it predates `template-source.png`
(`packages/worker/assets/share/README.md`) and was shelved for the main
card because a hexagon frame doesn't suit the main card's 1200x620 ratio.
That's exactly what makes it a good fit here.

## Square vs. wide - the part that's easy to get backwards

A first version served this hex art as a plain square image. That
backfired: a square `og:image` is exactly what flips WhatsApp into its
full-width large-image layout - the opposite of the small/cropped look that
was wanted. This was confirmed by direct observation (paste a share link
into WhatsApp, see what renders), not documented anywhere official.

The fix actually shipped: keep the same hex-card content, but pillarbox it
back out to the normal card's 1200:620 ratio (`stars-N-wide.jpg`, the ones
actually served - see `WHATSAPP_UA_PATTERN` in `server.ts`). Padded with a
flat color sampled from the source image's own off-white margin, so the
bars are invisible. That ratio gets WhatsApp's small/cropped treatment,
same as the normal card.

**If WhatsApp's layout-picking behavior ever seems to change, re-verify by
actually pasting a share link** - this is observed behavior, not a
documented API contract, and could change without notice.

## Files

- `source-hex-frame.png` - the source art, untouched.
- `build.py` - regenerates everything below from the source + the existing
  `star_row_1.png`..`star_row_5.png` (`packages/worker/assets/share/`).
- `stars-1.jpg` .. `stars-5.jpg` - square intermediate composites (hex frame
  + star row), kept as a reference step. Not served directly.
- `stars-1-wide.jpg` .. `stars-5-wide.jpg` - the square composites
  pillarboxed to 1200:620. **These are what `server.ts` actually serves.**
