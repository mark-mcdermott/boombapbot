# Local faceplate photos

Put the owner-supplied machine photos here to use them in Hardware mode
during local development:

| Machine | File      |
| ------- | --------- |
| 606     | `606.jpg` |
| 707     | `707.jpg` |
| 808     | `808.jpg` |
| 909     | `909.png` |

Everything in this folder except this file is ignored by git. The photos'
rights and provenance are not recorded yet, so they are kept out of the public
repository and out of production builds:

- `pnpm dev` copies any photos found here into the dev site.
- `pnpm build` does not, and `scripts/check-build.mjs` fails a build that
  contains them.
- Once a photo is cleared for distribution, build with
  `BOOMBAPBOT_INCLUDE_FACEPLATES=1 pnpm build`.

Without a photo, Hardware mode draws a stand-in panel from the same control
geometry (`packages/contracts/data/panels/*.panel.json`). That geometry is
measured in each photo's own coordinate space, so a photo with the same
framing works at any resolution.
