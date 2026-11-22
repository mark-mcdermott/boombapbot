"""Makes room on the plate for the status readout, in a box of its own.

The picture was painted with the level meter filling its box. This writes
patch/status.png, that box done again from the plate's own paint: the meter
smaller, the box closed under it, and a second box below with nothing in it,
where the page puts the readout and its name. The page always lays it over
the plate. The plate itself is not changed.

    python3 packages/machine-ritm12/art/cut-status.py

It needs numpy, Pillow and scipy. It prints where the meter's face now is,
which packages/machine-ritm12/src/ui/layout.ts holds as METER and STATUS.
"""
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

here = Path(__file__).resolve().parent
plate = np.asarray(Image.open(here / 'plate.webp').convert('RGB'), float)

# The box as it is painted: the lines round it, the meter in its frame, and the meter's face.
LEFT, TOP, RIGHT, BOTTOM = 516, 283, 859, 574
METER = (535, 344, 839, 558)
FACE = (566, 384, 810, 510)
# The patch, with a little of the paint round the box.
PATCH = (505, 278, 870, 580)
# The lines the box is closed and the new one opened with, and how tall a corner of a box is.
CLOSE, OPEN, CORNER = 487, 494, 15
METER_TOP, METER_BOTTOM = 333, 483


def rows(top, bottom, left=PATCH[0], right=PATCH[2]):
    return plate[top:bottom, left:right].copy()


def paint_over(box):
    """Paint where something stood, carried in from the paint round it, with the paint's own grain and wear."""
    left, top, right, bottom = box
    pad = 10
    area = plate[top - pad:bottom + pad, left - pad:right + pad]
    light = area @ [0.299, 0.587, 0.114]
    stood = np.zeros(area.shape[:2], bool)
    stood[pad:-pad, pad:-pad] = True
    clean = plate[300:330, 745:850]
    tone = (clean @ [0.299, 0.587, 0.114]).mean()
    # Only bare paint is carried in: not a line, a letter or a shadow.
    bare = ~stood & (light > tone - 5) & (light < tone + 14)
    weight = ndimage.gaussian_filter(bare.astype(float), 30)
    carried = np.dstack([ndimage.gaussian_filter(np.where(bare, area[..., c], 0), 30) / np.maximum(weight, 1e-6) for c in range(3)])
    fine = clean - ndimage.gaussian_filter(clean, (1.5, 1.5, 0))
    worn = ndimage.gaussian_filter(clean, (1.5, 1.5, 0)) - ndimage.gaussian_filter(clean, (9, 9, 0))
    rng = np.random.default_rng(7)
    shape = area.shape[:2]
    grain = ndimage.gaussian_filter(rng.normal(0, 1, shape), 0.6)
    wear = ndimage.gaussian_filter(rng.normal(0, 1, shape), 4)
    marks = grain * fine.std() * 0.8 / grain.std() + wear * worn.std() * 0.8 / wear.std()
    filled = carried + marks[..., None] * (carried / carried.mean())
    soft = ndimage.gaussian_filter(stood.astype(float), 3)[..., None]
    plate[top - pad:bottom + pad, left - pad:right + pad] = area * (1 - soft) + filled * soft


meter = Image.fromarray(plate[METER[1]:METER[3], METER[0]:METER[2]].astype('uint8'))
paint_over((METER[0] - 6, METER[1] - 6, METER[2] + 6, BOTTOM - 4))

scale = (METER_BOTTOM - METER_TOP) / (METER[3] - METER[1])
width, height = round((METER[2] - METER[0]) * scale), METER_BOTTOM - METER_TOP
meter_left = round((LEFT + RIGHT) / 2 - width / 2)
small = np.asarray(meter.resize((width, height), Image.LANCZOS), float)
edge = np.zeros((height, width))
edge[2:-2, 2:-2] = 1
edge = ndimage.gaussian_filter(edge, 1.2)[..., None]
under = plate[METER_TOP:METER_BOTTOM, meter_left:meter_left + width]
plate[METER_TOP:METER_BOTTOM, meter_left:meter_left + width] = under * (1 - edge) + small * edge

# The box's own bottom line closes it higher up, and its own top line opens the box below.
bottom_line = rows(BOTTOM - CORNER, BOTTOM + 4)
top_line = rows(TOP - 3, TOP + CORNER)
corner = np.zeros(PATCH[2] - PATCH[0], bool)
corner[:LEFT + CORNER - PATCH[0]] = corner[RIGHT - CORNER - PATCH[0]:] = True
for line, at, keep in ((bottom_line, CLOSE - CORNER, slice(CORNER - 3, None)), (top_line, OPEN - 3, slice(0, 6))):
    target = plate[at:at + len(line), PATCH[0]:PATCH[2]]
    target[:, corner] = line[:, corner]
    target[keep][:, ~corner] = line[keep][:, ~corner]

Image.fromarray(np.clip(plate[PATCH[1]:PATCH[3], PATCH[0]:PATCH[2]], 0, 255).astype('uint8')).save(here / 'patch' / 'status.png', optimize=True)

across = lambda x: meter_left + (x - METER[0]) * scale
down = lambda y: METER_TOP + (y - METER[1]) * scale
print(json.dumps({
    'patch': PATCH,
    'scale': round(scale, 4),
    'face': [round(across(FACE[0]), 1), round(down(FACE[1]), 1), round(across(FACE[2]), 1), round(down(FACE[3]), 1)],
    'status': [LEFT, OPEN, RIGHT, BOTTOM],
}))
