"""Puts the owner's drawing of each instrument on its key.

instrument-icons.svg, beside this, is the owner's own drawing of the eight
instruments in one picture. From it this writes, for each:

- phone/ink-<voice>.svg, the drawing alone in the dark ink a cream key is
  printed with, all at one scale in a square box so they sit alike. The
  phone's panel lays it on a key.
- patch/key-<voice>.png, the end of that key on the plate with the drawing
  the picture was painted with taken out and this one printed in its place.
  The page lays it over the plate.

    python3 packages/machine-ritm12/art/cut-icons.py

It needs numpy, Pillow and scipy. The boxes it cuts are INSTRUMENT_INK in
packages/machine-ritm12/src/ui/layout.ts.
"""
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw
from scipy import ndimage

here = Path(__file__).resolve().parent
SVG = '{http://www.w3.org/2000/svg}'
INK = (38, 30, 18)
VOICES = {'kick': 'kick', 'snare': 'snare', 'clap': 'clap', 'closed-hi-hat': 'closed_hat',
          'open-hi-hat': 'open_hat', 'tom': 'tom', 'woodblock': 'rim', 'cowbell': 'perc'}
MARGIN = 6
# Each key on the plate, top and bottom, as layout.ts has them.
KEYS = {'kick': (371, 429), 'snare': (450, 507), 'clap': (527, 584), 'closed_hat': (604, 662),
        'open_hat': (682, 739), 'tom': (759, 816), 'rim': (836, 894), 'perc': (918, 977)}
INK_LEFT, INK_RIGHT, INK_INSET = 158, 216, 5
PRINTED = 46
OVERSAMPLE = 4


def subpaths(path):
    """Each closed outline of a path as a list of points, its curves flattened."""
    outlines, points = [], []
    for command, numbers in re.findall(r'([MLCZ])([^MLCZ]*)', path):
        values = [float(number) for number in re.findall(r'-?\d+(?:\.\d+)?', numbers)]
        pairs = list(zip(values[0::2], values[1::2]))
        if command == 'M':
            points = [pairs[0]]
        elif command == 'L':
            points.extend(pairs)
        elif command == 'C':
            for index in range(0, len(pairs), 3):
                p0, p1, p2, p3 = np.array([points[-1], *pairs[index:index + 3]])
                for t in np.linspace(0, 1, 13)[1:]:
                    points.append(tuple((1 - t) ** 3 * p0 + 3 * (1 - t) ** 2 * t * p1 + 3 * (1 - t) * t ** 2 * p2 + t ** 3 * p3))
        else:
            outlines.append(points)
    return outlines


def printed(outlines, box, size):
    """How much ink each pixel of a square gets, from 0 to 1, by the even-odd rule."""
    x, y, side = box
    scale = size * OVERSAMPLE / side
    mask = Image.new('1', (size * OVERSAMPLE,) * 2)
    for outline in outlines:
        one = Image.new('1', mask.size)
        ImageDraw.Draw(one).polygon([((px - x) * scale, (py - y) * scale) for px, py in outline], fill=1)
        mask = ImageChops.logical_xor(mask, one)
    return np.asarray(mask.convert('L').resize((size, size), Image.LANCZOS), float) / 255


def unpainted(key):
    """A key's end with what is drawn on it taken out: its paint carried across, with the grain it has elsewhere."""
    pixels = np.asarray(key, float)
    light = pixels @ [0.299, 0.587, 0.114]
    drawn = ndimage.binary_dilation(light < np.percentile(light, 80) * 0.86, iterations=3)
    weight = ndimage.gaussian_filter((~drawn).astype(float), 5)
    carried = np.dstack([ndimage.gaussian_filter(np.where(drawn, 0, pixels[..., c]), 5) / np.maximum(weight, 1e-6) for c in range(3)])
    smooth = np.dstack([ndimage.gaussian_filter(np.where(drawn, carried[..., c], pixels[..., c]), 2) for c in range(3)])
    grain = (pixels - smooth)[~drawn]
    rng = np.random.default_rng(12)
    speckle = ndimage.gaussian_filter(rng.normal(0, 1, pixels.shape[:2]), 0.7)
    speckle *= grain.std() / speckle.std()
    soft = ndimage.gaussian_filter(drawn.astype(float), 1.2)[..., None]
    return pixels * (1 - soft) + (carried + speckle[..., None]) * soft


drawings = {}
for group in ET.parse(here / 'instrument-icons.svg').getroot().iter(f'{SVG}g'):
    path = group.find(f'{SVG}path').get('d')
    outlines = subpaths(path)
    xs = [x for outline in outlines for x, _ in outline]
    ys = [y for outline in outlines for _, y in outline]
    drawings[VOICES[group.get('id')]] = (path, outlines, min(xs), min(ys), max(xs), max(ys))

side = max(max(right - left, bottom - top) for *_, left, top, right, bottom in drawings.values()) + 2 * MARGIN
plate = Image.open(here / 'plate.webp').convert('RGB')
for voice, (path, outlines, left, top, right, bottom) in drawings.items():
    x = (left + right - side) / 2
    y = (top + bottom - side) / 2
    (here / 'phone' / f'ink-{voice}.svg').write_text(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x:.2f} {y:.2f} {side:.2f} {side:.2f}" '
        f'fill="#{bytes(INK).hex()}"><path fill-rule="evenodd" d="{path}"/></svg>\n')

    key_top, key_bottom = KEYS[voice]
    box = (INK_LEFT, key_top + INK_INSET, INK_RIGHT, key_bottom - INK_INSET)
    paint = unpainted(plate.crop(box))
    height, width = paint.shape[:2]
    ink = np.zeros((height, width))
    at_x, at_y = (width - PRINTED) // 2, (height - PRINTED) // 2
    ink[at_y:at_y + PRINTED, at_x:at_x + PRINTED] = printed(outlines, (x, y, side), PRINTED)
    ink = (ink * 0.92)[..., None]
    Image.fromarray(np.clip(paint * (1 - ink) + np.array(INK) * ink, 0, 255).astype('uint8')).save(
        here / 'patch' / f'key-{voice}.png', optimize=True)
    print(voice, list(box))
