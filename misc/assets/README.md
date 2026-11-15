# Local faceplate originals

This folder is for the owner's unedited machine photos. Everything in it
except this file is ignored by git, and nothing in it ever reaches a
production build.

`pnpm dev` uses an image here when its name matches `faceplate.file` in the
machine's panel manifest (`packages/contracts/data/panels/<id>.panel.json`)
and there is no cleared image of that name in `assets/faceplates/`:

| Machine | File name the manifest expects today |
| ------- | ------------------------------------ |
| 606     | `606.webp` (a cleared copy is committed, so this is not needed) |
| 707     | `707.jpg` |
| 808     | `808.jpg` |
| 909     | `909.png` |

The originals carry brand names, so they stay local. A version cleared for
distribution goes in `assets/faceplates/` instead, with a provenance entry;
see [`assets/faceplates/README.md`](../../assets/faceplates/README.md).

Without any image, Hardware mode draws a stand-in panel from the same control
layout. The layout is measured in each photo's own coordinate space, so an
image with the same framing works at any resolution.
