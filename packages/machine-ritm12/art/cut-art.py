"""Cuts the РИТМ-12's panel art from the owner's pictures of the machine.

The owner paints the whole panel once for each position of a stepped control.
This takes one picture as the plate, cuts the small patch that differs for
every other position, and lifts each kind of knob's pointer line out of an
earlier picture that still had the lines painted on. The page then shows the
plate, lays a patch over it for a control's position, and turns only the
pointer line of a knob.

The pictures are the owner's originals and are not in the repository. They
are read from misc/assets/ritm12/, which git ignores. What this writes beside
itself (plate.webp, patch/, pointer/) is committed.

    python3 packages/machine-ritm12/art/cut-art.py

It needs numpy, Pillow and scipy. It prints the patch boxes and the knobs'
pivots, which packages/machine-ritm12/src/ui/layout.ts holds: when a picture
changes, compare what is printed with what is there.
"""
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops
from scipy import ndimage

here = Path(__file__).resolve().parent
sources = here.parents[2] / 'misc' / 'assets' / 'ritm12'
load = lambda name: Image.open(sources / name).convert('RGB')
PLATE = 'hits-chorus-12-clean.webp'
base = load(PLATE)
delay = load('hits-delay-12-fixed.webp')
straight = load('hits-delay-16-rocker-other.webp')
accents = load('accents-chorus-12.webp')
flanger = load('hits-flanger-12-fixed.webp')
reverb = load('accents-reverb-12.webp')
old = load('earlier-with-pointer-lines.webp')
shutil.copyfile(sources / PLATE, here / 'plate.webp')

def changed(window, others, threshold=8, pad=6):
    x0, y0, x1, y1 = window
    mask = np.zeros((y1 - y0, x1 - x0), bool)
    for other in others:
        mask |= np.asarray(ImageChops.difference(base.crop(window), other.crop(window))).max(axis=2) > threshold
    ys, xs = np.nonzero(mask)
    return (x0 + xs.min() - pad, y0 + ys.min() - pad, x0 + xs.max() + 1 + pad, y0 + ys.max() + 1 + pad)

boxes = {
    'write': changed((574, 635, 690, 724), [accents], pad=0),
    'effect': changed((1395, 675, 1545, 815), [delay, flanger, reverb], threshold=24, pad=8),
    'size': changed((665, 795, 730, 855), [straight]),
    'power': changed((175, 1065, 275, 1180), [accents]),
}
patches = {'write-accents': ('write', accents), 'size-16': ('size', straight), 'power-on': ('power', accents),
           'effect-delay': ('effect', delay), 'effect-reverb': ('effect', reverb), 'effect-flanger': ('effect', flanger)}
(here / 'patch').mkdir(exist_ok=True)
for name, (box, source) in patches.items():
    source.crop(boxes[box]).save(here / 'patch' / f'{name}.png')
print(json.dumps({k: [int(v) for v in b] for k, b in boxes.items()}))

lum = lambda im: np.asarray(im.convert('L')).astype(float)
old_l, new_l = lum(old), lum(accents)
knobs = [('level', 422, y, 30) for y in (398, 476, 553, 631, 709, 786, 864, 946)] + \
        [('top', x, 452, 42) for x in (1545, 1684, 1820)] + [('voice', x, 780, 38) for x in (968, 1136, 1294)] + \
        [('mix', 1816, 757, 36), ('volume', 1123, 1152, 36)]
(here / 'pointer').mkdir(exist_ok=True)
SPECIMEN = {'level': 2, 'top': 9, 'voice': 12, 'mix': 14, 'volume': 15}
HALF = 44
TIP_ROW = {'mix': 22}
pivots = []
for i, (kind, x, y, r) in enumerate(knobs):
    s = r + 8
    diff = old_l[y - s:y + s, x - s:x + s] - new_l[y - s:y + s, x - s:x + s]
    yy, xx = np.mgrid[-s:s, -s:s]
    diff[np.hypot(xx, yy) > r + 4] = 0
    labels, count = ndimage.label(diff > 34)
    sizes = ndimage.sum(np.ones_like(diff), labels, range(1, count + 1))
    keep = ndimage.binary_dilation(labels == (1 + int(np.argmax(sizes))), iterations=2)
    alpha = np.clip((diff - 12) / 40, 0, 1) * keep
    cx = (alpha.sum(0) * np.arange(2 * s)).sum() / alpha.sum()
    column = alpha[:, int(round(cx)) - 1:int(round(cx)) + 2].max(1) > 0.5
    runs, start = [], None
    for row, on in enumerate(list(column) + [False]):
        if on and start is None: start = row
        if not on and start is not None: runs.append((start, row - 1)); start = None
    top, bottom = max(runs, key=lambda run: run[1] - run[0])
    pivots.append([round(float(cx - s), 1), int(bottom + 1 - s)])
    if SPECIMEN[kind] != i: continue
    alpha[:, np.abs(np.arange(2 * s) - cx) > 3.6] = 0; alpha[:max(0, top - 1)] = 0; alpha[bottom + 2:] = 0
    full = np.zeros(old_l.shape); full[y - s:y + s, x - s:x + s] = alpha
    px, py = x - s + int(round(cx)), y - s + bottom + 1
    box = (px - HALF, py - HALF, px + HALF, py + HALF)
    lifted = (full[box[1]:box[3], box[0]:box[2]] * 255).astype(np.uint8); lifted[:TIP_ROW.get(kind, 0)] = 0
    rgba = np.dstack([np.asarray(old.crop(box)), lifted])
    Image.fromarray(rgba, 'RGBA').save(here / 'pointer' / f'{kind}.png')
print(json.dumps(pivots))
