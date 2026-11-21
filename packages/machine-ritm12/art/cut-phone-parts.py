"""Cuts the parts of РИТМ-12's phone panel from the panel art in this folder.

The phone's panel is not one picture. It is laid out by the page from parts
of the big one: its keys, its knobs, its lamps, the frame of its screen, and
what is lettered on its instrument keys and its nameplate. This cuts those
parts from plate.webp and patch/, which cut-art.py made, so nothing here
needs the owner's originals. What it writes, phone/, is committed.

    python3 packages/machine-ritm12/art/cut-phone-parts.py

It needs numpy and Pillow. Every position below is the one
packages/machine-ritm12/src/ui/layout.ts holds for that control: when the
plate changes, bring these in step with it and run this again.
"""
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

here = Path(__file__).resolve().parent
out = here / 'phone'
shutil.rmtree(out, ignore_errors=True)
out.mkdir()

plate = Image.open(here / 'plate.webp').convert('RGB')

# Where each patch is laid over the plate (PATCHES in layout.ts).
PATCHES = {
    'power-on': (178, 1070),
    'size-16': (674, 804),
    'effect-delay': (1415, 696),
    'effect-reverb': (1415, 696),
    'effect-flanger': (1415, 696),
}


def wearing(*names):
    """The plate with these patches laid over it."""
    picture = plate.copy()
    for name in names:
        patch = Image.open(here / 'patch' / f'{name}.png').convert('RGBA')
        picture.paste(patch, PATCHES[name], patch)
    return picture


def rect(name, box, picture=plate):
    """A key or a frame, cut square."""
    picture.crop(box).save(out / f'{name}.webp', quality=92, method=6)


def disc(name, x, y, radius, picture=plate, feather=3):
    """A knob or a lamp, cut round with a soft edge so it sits on any paint."""
    box = (round(x - radius), round(y - radius), round(x + radius), round(y + radius))
    cut = picture.crop(box).convert('RGBA')
    side = cut.size[0]
    down, across = np.mgrid[0:side, 0:side]
    distance = np.hypot(across - side / 2 + 0.5, down - side / 2 + 0.5)
    alpha = np.clip((radius - distance) / feather, 0, 1) * 255
    cut.putalpha(Image.fromarray(alpha.astype('uint8')))
    cut.save(out / f'{name}.png', optimize=True)


def luminance(box):
    pixels = np.asarray(plate.crop(box)).astype(float)
    return pixels, 0.299 * pixels[..., 0] + 0.587 * pixels[..., 1] + 0.114 * pixels[..., 2]


def dark_ink(name, box):
    """What is printed on a cream key, without the key."""
    pixels, light = luminance(box)
    paper = np.percentile(light, 70) * 0.9
    ink = np.percentile(light, 1)
    alpha = np.clip((paper - light) / (paper - ink), 0, 1) ** 0.85
    cut = np.zeros(pixels.shape[:2] + (4,), 'uint8')
    cut[..., :3] = (38, 30, 18)
    cut[..., 3] = (alpha * 255).astype('uint8')
    Image.fromarray(cut, 'RGBA').save(out / f'{name}.png', optimize=True)


def light_ink(name, box):
    """What is lettered in cream on the paint, without the paint."""
    pixels, light = luminance(box)
    paint = np.percentile(light, 30) * 1.5
    ink = np.percentile(light, 96)
    alpha = np.clip((light - paint) / (ink - paint), 0, 1) ** 0.8
    cut = np.zeros(pixels.shape[:2] + (4,), 'uint8')
    cut[..., :3] = pixels.astype('uint8')
    cut[..., 3] = (alpha * 255).astype('uint8')
    Image.fromarray(cut, 'RGBA').save(out / f'{name}.png', optimize=True)


def icon(name, box):
    """A small drawing in cream on the paint, without the paint. The paint is read from the edge of the box, which is all paint."""
    pixels, light = luminance(box)
    edge = np.concatenate([light[:2].ravel(), light[-2:].ravel(), light[:, :2].ravel(), light[:, -2:].ravel()])
    paint = np.percentile(edge, 75) * 1.3
    ink = np.percentile(light, 99)
    alpha = np.clip((light - paint) / (ink - paint), 0, 1) ** 0.8
    cut = np.zeros(pixels.shape[:2] + (4,), 'uint8')
    cut[..., :3] = (220, 202, 164)
    cut[..., 3] = (alpha * 255).astype('uint8')
    Image.fromarray(cut, 'RGBA').save(out / f'{name}.png', optimize=True)


# The frame of the screen, with the dark tube inside it. The page stretches
# it as a frame and draws the screen in the middle.
rect('bezel', (870, 215, 1455, 605))

# A step key, blank. The page stretches it for every plain key.
rect('key', (642, 954, 713, 1024))

for index, left in enumerate([1288, 1379, 1468, 1557]):
    rect(f'pattern-{index + 1}', (left, 1114, left + 75, 1177))
rect('play', (403, 1114, 510, 1177))
rect('stop', (539, 1114, 646, 1177))
rect('record', (675, 1114, 775, 1177))
rect('dice', (1696, 1100, 1773, 1177))
rect('clear', (1788, 1100, 1869, 1177))
rect('power-off', (182, 1077, 266, 1166))
rect('power-on', (182, 1077, 266, 1166), wearing('power-on'))

# What is printed on each instrument key: its drawing and its name.
VOICES = [('kick', 371, 429), ('snare', 450, 507), ('clap', 527, 584), ('closed_hat', 604, 662),
          ('open_hat', 682, 739), ('tom', 759, 816), ('rim', 836, 894), ('perc', 918, 977)]
for voice, top, bottom in VOICES:
    dark_ink(f'ink-{voice}', (160, top + 8, 300, bottom - 8))

light_ink('nameplate', (205, 165, 705, 268))
light_ink('badge', (1490, 165, 1835, 250))

# The small drawing the picture has beside a label, so that the phone's
# panel can show what a control is for to someone who does not read its
# lettering. Each box is that drawing alone, with a little paint round it.
ICONS = {
    'sequencer': (530, 885, 584, 925),
    'hits': (692, 652, 726, 681),
    'accents': (692, 711, 726, 736),
    'mute': (883, 1104, 931, 1141),
    'voice': (904, 622, 962, 650),
    'pitch': (950, 690, 984, 726),
    'decay': (1115, 692, 1163, 726),
    'tone': (1261, 693, 1329, 723),
    'level': (544, 296, 596, 336),
    'tempo': (1519, 296, 1561, 344),
    'swing': (1651, 297, 1699, 342),
    'accent': (1796, 297, 1839, 343),
    'size': (530, 780, 566, 816),
    'effect': (1414, 623, 1458, 666),
    'delay': (1561, 667, 1603, 695),
    'reverb': (1561, 706, 1604, 743),
    'flanger': (1561, 751, 1606, 781),
    'chorus': (1561, 795, 1609, 825),
    'volume': (1022, 1076, 1069, 1121),
}
for name, box in ICONS.items():
    icon(f'icon-{name}', box)

disc('lamp', 340, 400, 15)

# Each knob's body, cut round its own centre (KNOBS and INSTRUMENTS in
# layout.ts) so that its pointer line sits on it exactly as on the plate.
# The radius is a little more than the body and less than its marks.
KNOBS = {
    'tempo': (1545, 452, 45), 'swing': (1684, 452, 45), 'accent': (1820, 452, 45),
    'pitch': (968, 780, 43), 'decay': (1136, 780, 43), 'tone': (1294, 780, 43),
    'mix': (1816, 757, 41), 'volume': (1123, 1152, 43), 'level': (422, 398, 33),
}
for name, (x, y, radius) in KNOBS.items():
    disc(f'knob-{name}', x, y, radius)

# The stepped controls, once for each position (SWITCHES in layout.ts).
disc('write-hits', 604, 693, 42)
disc('size-12', 697, 827, 26)
disc('size-16', 697, 827, 26, wearing('size-16'))
disc('effect-chorus', 1470, 756, 54)
for kind in ('delay', 'reverb', 'flanger'):
    disc(f'effect-{kind}', 1470, 756, 54, wearing(f'effect-{kind}'))

files = sorted(out.iterdir())
print(f'{len(files)} parts, {sum(file.stat().st_size for file in files) // 1024} KB, in {out.relative_to(here.parents[2])}')
