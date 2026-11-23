"""Fits the effect unit with a turning selector and a window that names the effect.

The plate was painted with a four-position selector and the four effects
lettered beside it. The owner then painted the unit again, close up, as a
knob that turns all the way round and a window with a paper label behind it.
This fits that painting into the plate's own unit:

- patch/effect-unit.png is the unit between its left line and the line
  before the mix, done again from the plate's own paint with nothing on it
  but the window, its label blank, and the shadow the knob throws. The page
  always lays it over the plate and writes the effect on the label.
- patch/effect-knob.png is the knob, cut round, as it stands for the first
  effect. The page turns it. It is kept at twice the plate's size so that
  it stays sharp when turned.

    python3 packages/machine-ritm12/art/cut-effect.py [the owner's painting]

It needs numpy, Pillow and scipy, and the owner's painting of the unit,
misc/assets/ritm12/effect-unit.webp unless another file is named. It prints
where the pieces are, which packages/machine-ritm12/src/ui/layout.ts holds
as EFFECT_UNIT.
"""
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

here = Path(__file__).resolve().parent
painting = Path(sys.argv[1]) if len(sys.argv) > 1 else here.parents[2] / 'misc' / 'assets' / 'ritm12' / 'effect-unit.webp'
plate = np.asarray(Image.open(here / 'plate.webp').convert('RGB'), float)
close_up = Image.open(painting).convert('RGB')

LUMA = [0.299, 0.587, 0.114]

# On the plate: what is painted over, and paint with nothing on it to take the grain from.
PATCH = (1398, 660, 1724, 852)
BARE = (1560, 828, 1700, 848)
# On the plate: where the knob goes, and the window's left, top and right.
KNOB = {'x': 1449, 'y': 756, 'r': 44}
WINDOW = (1503, 712, 1721)

# In the owner's painting: the knob, the way its bar points, the window's frame, its label and what is printed on it.
KNOB_THERE = {'x': 325, 'y': 410, 'r': 147}
BAR_THERE = ((205, 460), (455, 335))
FRAME_THERE = (540, 250, 1385, 590)
FRAME_CORNER = 34
LABEL_THERE = (622, 366, 1304, 520)
PRINT_THERE = (700, 380, 1225, 495)
KNOB_SCALE = 2


def grain(shape, clean, seed):
    """The paint's own grain and wear, as marks to add to a flat colour."""
    fine = clean - ndimage.gaussian_filter(clean, (1.5, 1.5, 0))
    worn = ndimage.gaussian_filter(clean, (1.5, 1.5, 0)) - ndimage.gaussian_filter(clean, (9, 9, 0))
    rng = np.random.default_rng(seed)
    sharp = ndimage.gaussian_filter(rng.normal(0, 1, shape), 0.6)
    slow = ndimage.gaussian_filter(rng.normal(0, 1, shape), 4)
    return sharp * fine.std() * 0.8 / sharp.std() + slow * worn.std() * 0.8 / slow.std()


def carried_in(area, keep, reach):
    """Each pixel as the kept pixels near it would have it."""
    weight = ndimage.gaussian_filter(keep.astype(float), reach)
    return np.dstack([ndimage.gaussian_filter(np.where(keep, area[..., c], 0), reach) / np.maximum(weight, 1e-6) for c in range(3)])


def painted_out(area, gone, kept, clean, reach, seed, edge):
    """An area with something on it taken off: the kept paint near it carried in, with the paint's own marks."""
    flat = carried_in(area, kept, reach)
    filled = flat + grain(area.shape[:2], clean, seed)[..., None] * (flat / flat.mean())
    soft = ndimage.gaussian_filter(gone.astype(float), edge)[..., None]
    return area * (1 - soft) + filled * soft


def bare_unit():
    """The unit with its selector and its lettering painted out."""
    left, top, right, bottom = PATCH
    pad = 12
    area = plate[top - pad:bottom + pad, left - pad:right + pad].copy()
    clean = plate[BARE[1]:BARE[3], BARE[0]:BARE[2]]
    tone = (clean @ LUMA).mean()
    light = area @ LUMA
    stood = np.zeros(area.shape[:2], bool)
    stood[pad:-pad, pad:-pad] = True
    # Only bare paint is carried in: not a line, a letter or a shadow.
    bare = ~stood & (light > tone - 6) & (light < tone + 14)
    return painted_out(area, stood, bare, clean, 40, 11, 3)[pad:-pad, pad:-pad]


def rounded(width, height, radius, feather):
    """A rounded rectangle's cover, soft at its edge."""
    ys, xs = np.mgrid[0:height, 0:width]
    dx = np.maximum(np.maximum(radius - xs, xs - (width - 1 - radius)), 0)
    dy = np.maximum(np.maximum(radius - ys, ys - (height - 1 - radius)), 0)
    return np.clip((radius - np.hypot(dx, dy)) / feather + 0.5, 0, 1)


def blank_window():
    """The window from the owner's painting, with what is printed on its label taken off."""
    left, top = FRAME_THERE[:2]
    window = np.asarray(close_up.crop(FRAME_THERE), float)
    label = (slice(LABEL_THERE[1] - top, LABEL_THERE[3] - top), slice(LABEL_THERE[0] - left, LABEL_THERE[2] - left))
    paper = window[label]
    printed = (slice(PRINT_THERE[1] - LABEL_THERE[1], PRINT_THERE[3] - LABEL_THERE[1]), slice(PRINT_THERE[0] - LABEL_THERE[0], PRINT_THERE[2] - LABEL_THERE[0]))
    # All of the print's place goes, not the ink alone: a letter's soft edge would leave its ghost.
    gone = np.zeros(paper.shape[:2], bool)
    gone[printed] = True
    window[label] = painted_out(paper, gone, ~gone, paper[4:30, 4:70], 30, 23, 6)
    return window


def shrunk(pixels, width, height):
    return np.asarray(Image.fromarray(np.clip(pixels, 0, 255).astype('uint8')).resize((width, height), Image.LANCZOS), float)


def save(pixels, name, mode='RGB'):
    Image.fromarray(np.clip(pixels, 0, 255).astype('uint8'), mode).save(here / 'patch' / name, optimize=True)


unit = bare_unit()

# The knob's shadow, soft and a little below it.
ys, xs = np.mgrid[PATCH[1]:PATCH[3], PATCH[0]:PATCH[2]]
away = np.hypot(xs - KNOB['x'], ys - (KNOB['y'] + 4))
unit *= (1 - np.clip((KNOB['r'] + 9 - away) / 12, 0, 1) * 0.6)[..., None]

window = blank_window()
scale = (WINDOW[2] - WINDOW[0]) / window.shape[1]
width, height = WINDOW[2] - WINDOW[0], round(window.shape[0] * scale)
cover = shrunk(np.repeat(rounded(window.shape[1], window.shape[0], FRAME_CORNER, 3)[..., None] * 255, 3, axis=2), width, height)[..., :1] / 255
at_left, at_top = WINDOW[0] - PATCH[0], WINDOW[1] - PATCH[1]
frame_shadow = np.zeros(unit.shape[:2])
frame_shadow[at_top + 3:at_top + height + 3, at_left:at_left + width] = cover[..., 0]
unit *= (1 - ndimage.gaussian_filter(frame_shadow, 3) * 0.45)[..., None]
under = unit[at_top:at_top + height, at_left:at_left + width]
unit[at_top:at_top + height, at_left:at_left + width] = under * (1 - cover) + shrunk(window, width, height) * cover
save(unit, 'effect-unit.png')

# The knob, cut round.
r = KNOB_THERE['r']
side = 2 * KNOB['r'] * KNOB_SCALE
knob = np.asarray(close_up.crop((KNOB_THERE['x'] - r, KNOB_THERE['y'] - r, KNOB_THERE['x'] + r, KNOB_THERE['y'] + r)).resize((side, side), Image.LANCZOS), float)
ys, xs = np.mgrid[0:side, 0:side]
edge = np.clip(side / 2 - 0.5 - np.hypot(xs - side / 2 + 0.5, ys - side / 2 + 0.5), 0, 1.5) / 1.5
save(np.dstack([knob, edge * 255]), 'effect-knob.png', 'RGBA')

(tail_x, tail_y), (tip_x, tip_y) = BAR_THERE
across = lambda x: round(WINDOW[0] + (x - FRAME_THERE[0]) * scale, 1)
down = lambda y: round(WINDOW[1] + (y - FRAME_THERE[1]) * scale, 1)
print(json.dumps({
    'patch': PATCH,
    'knob': KNOB,
    'firstAngle': round(math.degrees(math.atan2(tip_x - tail_x, tail_y - tip_y)), 1),
    'window': [WINDOW[0], WINDOW[1], WINDOW[2], WINDOW[1] + height],
    'label': [across(LABEL_THERE[0]), down(LABEL_THERE[1]), across(LABEL_THERE[2]), down(LABEL_THERE[3])],
}))
