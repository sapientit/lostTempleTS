"""
Regenerates stars-1.jpg .. stars-5.jpg and stars-1-wide.jpg .. stars-5-wide.jpg
from source-hex-frame.png. Only the *-wide.jpg files are actually served
today (see packages/og-renderer/src/assets.ts) - the plain square ones are
kept as an intermediate/reference step, see "Square vs. wide" below.

Why these exist: WhatsApp's link-preview fetcher renders og:image in one of
two very different layouts - a small cropped thumbnail next to the title/
description text, or a full-width "large image" card - and picks between
them based on the image's aspect ratio, not anything declared in meta tags.
The normal share card (packages/worker/src/shareTree.ts, 1200x620) gets the
small/cropped treatment, which is legible enough for the gold amount but not
much else. This directory's images are a WhatsApp-specific alternative that
shows only the star count - big and legible even cropped small - while
`og:description` (see packages/worker/src/share.ts) already carries the
gold/date text separately, so nothing is lost by dropping it from the image.

source-hex-frame.png is an untouched copy of an earlier, square (1254x1254)
hexagonal OG-card design (originally ~/Downloads/OGBlank.png on the user's
machine) that predates template-source.png (packages/worker/assets/share/
README.md) - it was shelved for the main OG card because a hexagon frame
doesn't suit a 1200x620 (1.9:1) canvas, but that's exactly why it's a good
fit for a square crop.

Square vs. wide (IMPORTANT - easy to get backwards):
A first version served the plain square images directly. That backfired:
serving a square og:image is exactly what flips WhatsApp from small/cropped
to its full-width large-image layout - the opposite of what was wanted here.
Confirmed by direct observation (paste a link, check what WhatsApp renders),
not documented anywhere official. Fix: pad the square composite back out to
the card's normal 1200:620 ratio (PAD_COLOR pillarboxing, see below) so
WhatsApp's aspect-ratio heuristic reads it the same way it reads the normal
card, and it goes back to the small/cropped layout. If WhatsApp's behavior
here ever changes, re-verify by actually pasting a share link rather than
assuming - this isn't documented behavior, just observed.

Placement (STAR_HEIGHT / VERTICAL_CENTER below) was measured by hand against
a 600x600 resize of the source: the hex interior's usable width varies by
row (it's a hexagon, not a rectangle) and was found to be ~510px wide at
y=336, verified by cropping and visually inspecting a horizontal strip.
STAR_HEIGHT=78 was chosen so the widest case (5 stars, the row images are
75px-wide-per-star at 60px source height, i.e. 1.25:1 aspect per star) comes
to 78*1.25*5=488px - fits inside that ~510px band with margin on both sides.
If the source frame or FINAL_SIZE changes, re-measure rather than assume
these numbers still fit - see the git history of this file for the
measurement script (a green-interior color mask + strip crop, run
interactively, not committed as it's throwaway analysis, not part of the
repeatable build).

PAD_COLOR was sampled directly from an existing square JPEG's corner
(~(248,248,248)) rather than guessed, so the pillarbox bars blend into the
source's own off-white margin with no visible seam.
"""

from PIL import Image
import os

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "source-hex-frame.png")
STAR_DIR = os.path.dirname(HERE)  # packages/worker/assets/share
OUT_DIR = HERE

FINAL_SIZE = 600
STAR_HEIGHT = 78  # on the FINAL_SIZE canvas - see module docstring
VERTICAL_CENTER = 336  # px, on the FINAL_SIZE canvas
PAD_COLOR = (248, 248, 248)
WIDE_WIDTH = round(FINAL_SIZE * 1200 / 620)  # match the normal card's 1200:620 ratio exactly

base = Image.open(SRC).convert("RGB").resize((FINAL_SIZE, FINAL_SIZE), Image.LANCZOS)

for stars in range(1, 6):
    star_img = Image.open(f"{STAR_DIR}/star_row_{stars}.png").convert("RGBA")
    scale = STAR_HEIGHT / star_img.height
    new_w = round(star_img.width * scale)
    star_img = star_img.resize((new_w, STAR_HEIGHT), Image.LANCZOS)

    square = base.copy()
    px = FINAL_SIZE // 2 - new_w // 2
    py = VERTICAL_CENTER - STAR_HEIGHT // 2
    square.paste(star_img, (px, py), star_img)

    square_path = os.path.join(OUT_DIR, f"stars-{stars}.jpg")
    square.save(square_path, "JPEG", quality=85, optimize=True)

    wide = Image.new("RGB", (WIDE_WIDTH, FINAL_SIZE), PAD_COLOR)
    wide.paste(square, ((WIDE_WIDTH - FINAL_SIZE) // 2, 0))
    wide_path = os.path.join(OUT_DIR, f"stars-{stars}-wide.jpg")
    wide.save(wide_path, "JPEG", quality=85, optimize=True)

    print(
        stars,
        "row_px_width=", new_w,
        "square_bytes=", os.path.getsize(square_path),
        "wide_bytes=", os.path.getsize(wide_path),
    )
