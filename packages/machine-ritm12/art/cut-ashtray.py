"""Cuts the ashtray and its cigarette from the owner's two pictures of the whole bench.

The owner painted the bench with an ashtray beside the machine, once with the
desk lamp lit and once with it out. The panel's own picture has no room for
that bench, so this lifts the ashtray out of each, with the soft shadow it
stands on, for the page to set in the corner of the picture. It is turned
round, so that the cigarette's lit end is clear of the machine's keys and its
smoke rises beside them: props/ashtray.png
for the lit room and night/props/ashtray.png for the dark one.

The two pictures are the owner's originals and are not in the repository.
They are read from misc/assets/ritm12/, which git ignores. What this writes
is committed.

    python3 packages/machine-ritm12/art/cut-ashtray.py

It needs numpy, Pillow and scipy. Where the page sets the ashtray, and where
its cigarette burns, are ASHTRAY in packages/machine-ritm12/src/ui/layout.ts.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

here = Path(__file__).resolve().parent
sources = here.parents[2] / 'misc' / 'assets' / 'ritm12'

# In the owner's pictures, which are 1672 wide: the box cut, the glass's outline, and the cigarette from its lit end to its filter.
BOX = (1352, 738, 1642, 902)
GLASS = [(1367, 787), (1375, 775), (1410, 766), (1503, 763), (1583, 768), (1622, 782), (1627, 795), (1623, 847),
         (1610, 860), (1577, 871), (1517, 876), (1463, 873), (1413, 865), (1383, 853), (1372, 840), (1367, 810)]
CIGARETTE = ((1459, 776), (1612, 753), 10.5)
# On the plate, which is 2000 by 1333: how wide the ashtray is, and where its box's top left corner goes. It is too
# big for the strip of bench the plate has, so it runs off the plate's foot and side, as the lamp runs off its top.
PLATE = (2000, 1333)
WIDTH = 425
AT = (1611, 1186)
# How far from the plate's edge the ashtray starts to go into the dark the picture's edge goes into.
EDGE = 60
OVERSAMPLE = 4


def outline():
    """How much of each pixel of the box is ashtray or cigarette, from 0 to 1."""
    left, top, right, bottom = BOX
    size = ((right - left) * OVERSAMPLE, (bottom - top) * OVERSAMPLE)
    mask = Image.new('L', size)
    draw = ImageDraw.Draw(mask)
    at = lambda x, y: ((x - left) * OVERSAMPLE, (y - top) * OVERSAMPLE)
    draw.polygon([at(*point) for point in GLASS], fill=255)
    start, end, radius = CIGARETTE
    draw.line([at(*start), at(*end)], fill=255, width=round(radius * 2 * OVERSAMPLE))
    for point in (start, end):
        x, y = at(*point)
        reach = radius * OVERSAMPLE
        draw.ellipse([x - reach, y - reach, x + reach, y + reach], fill=255)
    solid = np.asarray(mask.resize((right - left, bottom - top), Image.LANCZOS), float) / 255
    return ndimage.gaussian_filter(solid, 0.8)


def shadow(solid):
    """The dark the glass stands in: under it and a little round it, deepest at its foot."""
    spread = ndimage.gaussian_filter(np.roll(solid, 6, axis=0), 7)
    rows = np.linspace(0, 1, solid.shape[0])[:, None]
    return np.clip(spread * 0.75 * np.clip((rows - 0.35) * 2.2, 0, 1), 0, 1)


solid = outline()
under = shadow(solid) * (1 - solid)
alpha = solid + under
height = round(WIDTH * solid.shape[0] / solid.shape[1])
seen = (min(WIDTH, PLATE[0] - AT[0]), min(height, PLATE[1] - AT[1]))
across = np.clip((PLATE[0] - AT[0] - np.arange(seen[0])) / EDGE, 0, 1)
down = np.clip((PLATE[1] - AT[1] - np.arange(seen[1])) / EDGE, 0, 1)
for source, target in (('scene-lamp-lit.webp', here / 'props'), ('scene-lamp-out.webp', here / 'night' / 'props')):
    pixels = np.asarray(Image.open(sources / source).convert('RGB').crop(BOX), float) / 255
    colour = pixels * (solid / np.maximum(alpha, 1e-6))[..., None]
    cut = Image.fromarray((np.dstack([colour, alpha]) * 255).round().astype('uint8'), 'RGBA')
    turned = cut.transpose(Image.FLIP_LEFT_RIGHT).resize((WIDTH, height), Image.LANCZOS).crop((0, 0, *seen))
    faded = np.asarray(turned, float)
    faded[..., 3] *= down[:, None] * across[None, :]
    target.mkdir(parents=True, exist_ok=True)
    Image.fromarray(faded.round().astype('uint8'), 'RGBA').save(target / 'ashtray.png', optimize=True)
scale = WIDTH / solid.shape[1]
lit_end = (AT[0] + WIDTH - round((CIGARETTE[0][0] - BOX[0]) * scale), AT[1] + round((CIGARETTE[0][1] - BOX[1]) * scale))
print('box', [*AT, AT[0] + seen[0], AT[1] + seen[1]], 'lit end', list(lit_end))
