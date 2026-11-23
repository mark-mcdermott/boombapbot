"""Makes the desk lamp in the picture larger, as a patch laid over the plate.

On the plate the lamp is small beside the machine. This takes the lamp from
plate.webp, makes it larger, and writes it as patch/lamp.png, which the page
always lays over the plate's top left corner. The larger shade covers the
smaller one, and runs off the picture's edge as that one does.

    python3 packages/machine-ritm12/art/cut-lamp.py

It needs numpy, Pillow and scipy. Run it again when the plate changes, and
cut-night.py after it. The patch's box is DESK_LAMP_PATCH in
packages/machine-ritm12/src/ui/layout.ts.
"""
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

here = Path(__file__).resolve().parent

# The part of the plate the lamp is in, and the shade's outline within it.
FROM = (0, 0, 300, 140)
SHADE = [(6, 0), (282, 0), (287, 40), (272, 86), (205, 121), (112, 135), (40, 130), (18, 96), (5, 40)]
LARGER = 1.4
# Where the larger lamp's top left corner goes: off the plate, so the shade stays clear of the nameplate.
AT = (-40, -34)

plate = Image.open(here / 'plate.webp').convert('RGB')
width, height = round((FROM[2] - FROM[0]) * LARGER), round((FROM[3] - FROM[1]) * LARGER)
lamp = plate.crop(FROM).resize((width, height), Image.LANCZOS)
outline = Image.new('L', (width, height))
ImageDraw.Draw(outline).polygon([(x * LARGER, y * LARGER) for x, y in SHADE], fill=255)
alpha = ndimage.gaussian_filter(np.asarray(outline, float), 2.5)

seen = (-AT[0], -AT[1], width, height)
cut = Image.fromarray(np.dstack([np.asarray(lamp), alpha.round().astype('uint8')]), 'RGBA').crop(seen)
cut.save(here / 'patch' / 'lamp.png', optimize=True)
print('box', [0, 0, cut.width, cut.height])
