# РИТМ-12's panel art

Everything in this folder is cleared for distribution, and a build of
РИТМ-12 ships all of it. `scripts/check-build.mjs` fails a build whose art is
not byte for byte what is committed here, or that ships an image this folder
does not have.

## What is here

- **`plate.webp`** is the panel: the whole machine, with every stepped
  control in one position and every knob without its pointer line.
- **`patch/`** holds a small picture for each other position of a stepped
  control: the write switch on accents, the size switch on 16, the power
  rocker on, and the effect selector on delay, reverb and flanger. The page
  lays one over the plate. It also holds the end of each instrument key
  (`key-*.png`) with the instrument drawn as `instrument-icons.svg` has it,
  which the page always lays over the plate.
- **`instrument-icons.svg`** is the owner's drawing of the eight instruments
  in one picture. [`cut-icons.py`](cut-icons.py) cuts each from it, as the
  phone's `phone/ink-*.svg` and printed onto its key for `patch/key-*.png`.
  Run it again when the sheet or the plate changes.
- **`pointer/`** holds the pointer line of each kind of knob, on a clear
  background. A knob's painted body stays still; the page turns only its line.
- **`phone/`** holds the parts of the phone's panel, which the page lays out
  itself: the frame of the screen, a blank key, the pattern, transport, dice
  and clear keys, the power rocker off and on, each knob's body and each
  stepped control in every position cut round, a lamp, the nameplate and
  the maker's badge with the paint taken away, the drawing on each
  instrument key (`ink-*.svg`, from `cut-icons.py`), and (`icon-*.png`) the small drawing the picture has
  beside each label, in the lettering's cream. [`cut-phone-parts.py`](cut-phone-parts.py) cuts the
  rest from `plate.webp` and `patch/`, so it is this artwork and nothing
  else. Run it again when either changes.

## Where it comes from

The picture is the owner's own artwork, made for boombapbot. The machine in
it never existed: its maker, its name and its lettering are invented, and it
copies no real instrument's panel. There is nobody to credit.

The owner paints the whole panel once for each position of a stepped control.
[`cut-art.py`](cut-art.py) takes one of those pictures as the plate, cuts the
patches from the others, and lifts the pointer lines out of an earlier
picture that still had them painted on. The owner's pictures are not in the
repository: they live in the git-ignored `misc/assets/ritm12/`.

- **Licence of these files:** the owner's own artwork. No licence has been
  chosen for it.
- **Changing it:** put the new pictures in `misc/assets/ritm12/`, run
  `python3 packages/machine-ritm12/art/cut-art.py`, and compare the boxes
  and pivots it prints with `src/ui/layout.ts`. Do not edit the cut files by
  hand.
- **Stills on the About page:** `apps/site/src/assets/ritm12/` holds three
  cuts of one still of this panel, taken from the built page as it starts
  up, with the screen lit and showing its start-up lines: `top.webp` (the top
  of the panel, 1996 pixels wide), `top-998.webp` (the same at half the
  size) and `screen.webp` (the screen alone, for a phone). The still is the
  whole panel photographed by a headless Chromium at twice the density with
  the page 1040 pixels wide, so the art is drawn one to one, about two
  seconds after the machine appears. They are this artwork and nothing
  else; take them again if the art or the screen changes.
- **Size:** the pictures here are 2000 pixels wide, as they came. The owner's
  originals are 3072 wide; the art should be cut again from those.
