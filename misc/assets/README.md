# Local faceplate originals

This folder is for the owner's unedited machine photos. Everything in it
except this file is ignored by git, and nothing in it ever reaches a
production build.

`pnpm dev` uses an image here only when its name matches `faceplate.file` in
the machine's panel manifest (`packages/contracts/data/panels/<id>.panel.json`)
and there is no cleared image of that name in `assets/faceplates/`. All four
machines now have a cleared, committed image, so nothing needs to be here.

The originals carry brand names, so they stay local. A version cleared for
distribution goes in `assets/faceplates/` instead, with a provenance entry;
see [`assets/faceplates/README.md`](../../assets/faceplates/README.md).

Without any image, Hardware mode draws a stand-in panel from the same control
layout. The layout is measured in each photo's own coordinate space, so an
image with the same framing works at any resolution.
