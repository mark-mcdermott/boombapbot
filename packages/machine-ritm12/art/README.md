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
  lays one over the plate.
- **`pointer/`** holds the pointer line of each kind of knob, on a clear
  background. A knob's painted body stays still; the page turns only its line.

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
- **Size:** the pictures here are 2000 pixels wide, as they came. The owner's
  originals are 3072 wide; the art should be cut again from those.
