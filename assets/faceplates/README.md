# Faceplate images

Images in this folder are cleared for distribution. A build ships the one
the panel manifest names in `faceplate.file`: the editor is the 808 alone at
the moment, so that is `808.svg`. The 606, 707 and 909 photographs are kept
for when those machines come back; no build ships them. Each image is listed here with
where it came from, who made it, its licence and what was changed.
`scripts/check-build.mjs` fails a build that ships a faceplate without an
entry here, and without either a credit in its panel manifest or
`faceplate.original` for artwork drawn in this repository.

The owner's unedited originals are not in the repository. They live in the
git-ignored `misc/assets/` folder and are used for local development only.

## Committed

### `606.webp`

- **Original work:** [“Roland TR-606”](https://commons.wikimedia.org/wiki/File:Roland_TR-606.jpg)
  by Midas Wouters (own work, 2008), from Wikimedia Commons. It is the lead
  image of the English Wikipedia article on the instrument.
- **Licence of the original:** [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
- **Changes:** edited by the repository owner. Brand and product names were
  removed, the model name was replaced with “606”, and the image was resized
  from 1123 × 556 to 2000 × 990.
- **Licence of this file:** as an adaptation of a share-alike work, this
  image is itself licensed [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
  Anyone may reuse it under those terms, crediting Midas Wouters and noting
  the changes above.

### `707.webp`

- **Original work:** [“Roland TR-707”](https://commons.wikimedia.org/wiki/File:Roland_TR-707.jpg)
  by Speculos (own work, 2008), from Wikimedia Commons. It is the lead image
  of the English Wikipedia article on the instrument.
- **Licence of the original:** [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/).
- **Changes:** edited by the repository owner. Brand and product names were
  removed, the model name was replaced with “707”, and the image was resized
  from 1483 × 943 to 2000 × 1272.
- **Licence of this file:** [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/),
  as an adaptation of a share-alike work. Credit Speculos and note the
  changes above.

### `808.svg`

- **Original work:** drawn for boombapbot by
  [`scripts/draw-faceplates.mjs`](../../scripts/draw-faceplates.mjs). Every
  shape in the file is produced by that script. No photograph is traced or
  embedded, so there is nobody to credit, and `808.panel.json` sets
  `faceplate.original` in place of a credit.
- **Where the layout comes from:** the controls the editor makes live (step
  keys and lamps, instrument selector, start/stop, tempo and the tone, decay,
  tuning and snappy knobs) are placed from `808.panel.json`. Those coordinates were measured on the photograph below.
  The fixed controls and lettering were placed by eye against the same
  photograph, as a record of where things are on the machine.
- **Licence of this file:** the owner's own artwork. No licence has been
  chosen for it.
- **Changing it:** edit the script and run `pnpm faceplates:draw`. Do not edit
  the SVG by hand; `pnpm faceplates:check` fails if the two differ.
- **What a drawing does not settle:** it avoids the photograph's copyright
  and its credit. It says nothing about the manufacturer's rights in the look
  of the machine itself. That needs advice before a public release.

### `808.webp`

Not shipped at present: the 808 panel uses the drawing above. The photograph
is kept so the panel can go back to it, by pointing `faceplate.file` at this
file and restoring its `faceplate.credit`.

- **Original work:** [“TR-808 - MIM, Phoenix (cropped)”](https://commons.wikimedia.org/wiki/File:TR-808_-_MIM,_Phoenix_(2019-08-30_14.59.26_by_Bryan_Pocius)_(cropped).jpg)
  by Bryan Pocius (2019), from Wikimedia Commons; the crop was uploaded there
  by Rudolfs Davis Strazds. It is the lead image of the English Wikipedia
  article on the instrument.
- **Licence of the original:** [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/).
- **Changes:** edited by the repository owner. Brand and product names were
  removed, the model name was replaced with “808”, and the image was resized
  from 3764 × 2240 to 2000 × 1190.
- **Licence of this file:** the original's licence asks for attribution but
  not share-alike, so the edit could carry other terms. None have been chosen;
  until the owner says otherwise treat it as [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/),
  crediting Bryan Pocius and noting the changes above.

### `909.webp`

- **Original work:** [“Roland TR-909 (large)”](https://commons.wikimedia.org/wiki/File:Roland_TR-909_(large).png),
  a derivative by Clusternote (2011) of a photograph by Brandon Daniel, from
  Wikimedia Commons. It is the lead image of the English Wikipedia article on
  the instrument.
- **Licence of the original:** [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/).
- **Changes:** edited by the repository owner. Brand and product names were
  removed, the model name was replaced with “909”, the top of the image was
  cropped away, and it was resized: 2284 × 1349 became 2000 × 930.
- **Licence of this file:** [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/),
  as an adaptation of a share-alike work. Credit Brandon Daniel and
  Clusternote and note the changes above.

The four photograph entries were checked against their Wikimedia Commons file pages on
2026-11-15: author, date, licence, and that each file's dimensions match the
owner's original. The credit for each is shown in the app under its panel,
from `faceplate.credit` in the machine's panel manifest.

## How each edit was fitted

The control layout was measured on the originals. Each edit was registered
against its original by feature matching, which gives the exact transform:

| Machine | Transform from original to edit | Effect on the layout |
| --- | --- | --- |
| 606 | uniform resize | none; step lamps re-fitted on the new image |
| 707 | uniform resize | none |
| 808 | identical framing | none |
| 909 | same scale, 251 px cropped from the top | every control moved up 251 px |

No edit introduced rotation, and the fit error was under a pixel in each.

## Adding one

1. Put the cleared image in this folder and set `faceplate.file` in the
   machine's panel manifest to its name.
2. Make sure `faceplate.credit` in that manifest names the original's title,
   author, source and licence, and add `changes` describing the edits.
3. Add an entry under **Committed** above.
4. Check the control layout still lands on the image: `pnpm build`, then
   `pnpm test:e2e`.

## What the licences ask for

This is a summary, not legal advice.

- **Attribution (all four photographs):** credit the author, link the source
  and the licence, and say what was changed. The app does this under the
  panel.
- **Share-alike (606, 707, 909):** an adapted version of the image has to be
  offered under the same licence. That applies to the edited image, which is
  why each committed file states its own licence here.
- Removing brand names addresses trademarks. It does not change who holds
  the copyright in the photograph, so the credit stays.
