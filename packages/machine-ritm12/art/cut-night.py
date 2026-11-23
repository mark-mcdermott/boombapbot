"""Makes the panel's pictures as they look with the desk lamp switched off.

The lamp in the picture can be switched off, and then the machine sits in
the dark of the room: cooler, dimmer, and lit only by its own lamps and
screen, which the page draws. This regrades plate.webp and everything in
patch/ the same way, so a patch still lies on the plate without a seam, and
puts the lamp itself out. It regrades the phone panel's parts, phone/, as it
does the machine, so both panels are the same in the dark. Nothing is moved or redrawn. What it writes,
night/, is committed.

    python3 packages/machine-ritm12/art/cut-night.py

It needs numpy, Pillow and scipy. Run it again when the plate or a patch
changes. The lamp's box is DESK_LAMP in packages/machine-ritm12/src/ui/layout.ts.
"""
import re
import shutil
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage

here = Path(__file__).resolve().parent
night = here / 'night'
(night / 'patch').mkdir(parents=True, exist_ok=True)
(night / 'phone').mkdir(parents=True, exist_ok=True)

# The machine keeps most of its own colour; the room behind it goes to the blue of a dark room.
MACHINE = {'light': np.array([0.83, 1.0, 1.32]), 'colour_kept': 1.0, 'depth': 1.0}
ROOM = {'light': np.array([0.55, 0.78, 1.15]), 'colour_kept': 0.3, 'depth': 0.9}
# The machine's case on the plate. Every patch lies well inside it.
CASE = (70, 150, 1950, 1235)
# The instrument keys, as layout.ts has them, are the ones read most, so they are kept a little brighter than the rest.
INSTRUMENT_KEYS = [(150, 371, 309, 429), (150, 450, 309, 507), (150, 527, 309, 584), (150, 604, 309, 662),
                   (150, 682, 309, 739), (150, 759, 309, 816), (150, 836, 309, 894), (150, 918, 310, 977)]
KEY_LIFT = 1.1
# The lamp and the light it throws on the wall behind it: the middle of that glow, and how far it reaches.
LAMP_GLOW = {'centre': (150, 70), 'reach': (400, 250)}
LAMP_DARK = 0.3


def graded(pixels, light, colour_kept, depth):
    """A picture's colours without the lamp. Each pixel alone decides its colour, so a patch matches the plate. `depth` deepens the shadows and leaves the brightest paint where it was."""
    grey = (pixels @ [0.299, 0.587, 0.114])[..., None]
    return (grey * (1 - colour_kept) + pixels * colour_kept) ** depth * light


def in_room(pixels):
    """The whole plate: the machine as its patches are graded, and the room round it bluer and darker."""
    height, width = pixels.shape[:2]
    left, top, right, bottom = CASE
    case = np.zeros((height, width))
    case[top:bottom, left:right] = 1
    case = ndimage.gaussian_filter(case, 22)[..., None]
    machine = graded(pixels, **MACHINE)
    for left, top, right, bottom in INSTRUMENT_KEYS:
        machine[top:bottom, left:right] *= KEY_LIFT
    return machine * case + graded(pixels, **ROOM) * (1 - case)


def dimmed(pixels):
    """A lamp that is out: nothing of it is brighter than a shade in a dark room."""
    light = pixels.max(axis=2, keepdims=True)
    over = np.clip(light - LAMP_DARK, 0, None)
    return np.minimum(pixels, pixels * (LAMP_DARK + over * 0.45) / np.maximum(light, 1e-6))


def lamp_out(pixels):
    """The plate with its lamp out, and with it the light it threw on the wall behind it."""
    height, width = pixels.shape[:2]
    ys, xs = np.mgrid[0:height, 0:width]
    (cx, cy), (rx, ry) = LAMP_GLOW['centre'], LAMP_GLOW['reach']
    near = np.clip(1 - np.hypot((xs - cx) / rx, (ys - cy) / ry), 0, 1)[..., None] ** 0.6
    return pixels * (1 - near) + dimmed(pixels) * near


def read(path):
    return np.asarray(Image.open(path).convert('RGBA'), float) / 255


def write(pixels, alpha, path, **options):
    rgba = np.dstack([np.clip(pixels, 0, 1), alpha])
    picture = Image.fromarray((rgba * 255).round().astype('uint8'), 'RGBA')
    (picture.convert('RGB') if alpha.min() == 1 else picture).save(path, **options)


plate = read(here / 'plate.webp')
write(lamp_out(in_room(plate[..., :3])), plate[..., 3], night / 'plate.webp', quality=92, method=6)
for patch in sorted((here / 'patch').glob('*.png')):
    pixels = read(patch)
    if patch.name == 'lamp.png':
        # The larger lamp that cut-lamp.py lays over the plate's own is in the room, not on the machine.
        colours = dimmed(graded(pixels[..., :3], **ROOM))
    else:
        colours = graded(pixels[..., :3], **MACHINE) * (KEY_LIFT if patch.name.startswith('key-') else 1)
    write(colours, pixels[..., 3], night / 'patch' / patch.name, optimize=True)
    print(patch.name)

# The label's drawings are shapes the page fills with ink, with no colour of their own to regrade.
(night / 'effect').mkdir(exist_ok=True)
for drawing in sorted((here / 'effect').glob('*.svg')):
    shutil.copyfile(drawing, night / 'effect' / drawing.name)

for part in sorted((here / 'phone').iterdir()):
    if part.suffix == '.svg':
        # A drawing in one flat ink: the ink is regraded where it is named.
        inked = re.sub(r'#([0-9a-f]{6})', lambda found: '#' + bytes(
            (np.clip(graded(np.array([[list(bytes.fromhex(found[1]))]], float) / 255, **MACHINE), 0, 1) * 255).round().astype('uint8').ravel()
        ).hex(), part.read_text())
        (night / 'phone' / part.name).write_text(inked)
    else:
        pixels = read(part)
        write(graded(pixels[..., :3], **MACHINE), pixels[..., 3], night / 'phone' / part.name, **(
            {'quality': 92, 'method': 6} if part.suffix == '.webp' else {'optimize': True}))
print(len(list((night / 'phone').iterdir())), 'phone parts')
