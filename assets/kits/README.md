# Demo kits

These four kits are **temporary placeholders**. Every file is synthesised by
[`scripts/gen_demo_kits.py`](../../scripts/gen_demo_kits.py) from sine sweeps,
naive square oscillators and a seeded noise generator, using only the Python
standard library.

- Nothing here is sampled from a TR-606, TR-707, TR-808 or TR-909, or from any
  other instrument or recording.
- The kits are voiced only loosely after the character of those machines, so
  that switching kit is clearly audible. They are not emulations.
- Format: 16-bit mono PCM WAV at 44.1 kHz, normalised to a peak of 0.89.
- Author: generated for this repository. No third-party material.

## Regenerating

```bash
pnpm kits:generate   # rewrite assets/kits/<kit>/*.wav
pnpm kits:check      # confirm the committed files match the generator
```

The check allows a difference of one 16-bit step, because the last bit of
`math.sin` and `math.exp` can differ between platforms.

## Replacing them

A kit is a manifest plus files. To replace a sound, put the new WAV in the
kit's folder and point the role at it in
`packages/contracts/data/kits/<kit>.kit.json` (`file`, `gain`, `pan`,
`chokeGroup`). Nothing else changes: beats store hits against stable role IDs,
not against files. Bump the manifest `version` when sounds change.

Before licensed recordings are committed, record their rights and provenance
here, per file.
