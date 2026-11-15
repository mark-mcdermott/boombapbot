# Faceplate images

Images in this folder are cleared for distribution and ship in every build.
Each one is listed here with where it came from, who made it, its licence and
what was changed. `scripts/check-build.mjs` fails a build that ships a
faceplate without an entry here and a credit in its panel manifest.

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
- **Credit shown in the app:** under the panel in Hardware mode, from
  `faceplate.credit` in `packages/contracts/data/panels/606.panel.json`.
- **Verified:** on 2026-11-15 the Wikimedia Commons file page listed the
  author, date and licence above, and the file's dimensions (1123 × 556)
  matched the owner's original.

## Sources of the other three

Not committed yet; the owner is preparing versions with brand names removed.
Their sources were checked on Wikimedia Commons on 2026-11-15. All three are
the lead images of their English Wikipedia articles.

| Machine | Original work | Author | Licence |
| --- | --- | --- | --- |
| 707 | [“Roland TR-707”](https://commons.wikimedia.org/wiki/File:Roland_TR-707.jpg) | Speculos (own work, 2008) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |
| 808 | [“TR-808 - MIM, Phoenix (cropped)”](https://commons.wikimedia.org/wiki/File:TR-808_-_MIM,_Phoenix_(2019-08-30_14.59.26_by_Bryan_Pocius)_(cropped).jpg) | Bryan Pocius (2019) | [CC BY 2.0](https://creativecommons.org/licenses/by/2.0/) |
| 909 | [“Roland TR-909 (large)”](https://commons.wikimedia.org/wiki/File:Roland_TR-909_(large).png) | Brandon Daniel; derivative work by Clusternote (2011) | [CC BY-SA 2.0](https://creativecommons.org/licenses/by-sa/2.0/) |

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

- **Attribution (all four):** credit the author, link the source and the
  licence, and say what was changed. The app does this under the panel.
- **Share-alike (606, 707, 909):** an adapted version of the image has to be
  offered under the same licence. That applies to the edited image, which is
  why each committed file states its own licence here.
- Removing brand names addresses trademarks. It does not change who holds
  the copyright in the photograph, so the credit stays.
