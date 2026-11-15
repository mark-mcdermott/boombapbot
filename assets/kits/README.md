# Demo kits

These three kits are **placeholders that the editor does not load at the
moment**. The editor is the 808 alone, and the engine synthesises that
machine's sounds itself from its knobs (`engine/src/synth808.cpp`); there are
no 808 files here. The 606, 707 and 909 kits are kept, with their check, for
when those machines come back.

Every file is synthesised by
[`scripts/gen_demo_kits.py`](../../scripts/gen_demo_kits.py) from sine sweeps,
naive square oscillators and a seeded noise generator, using only the Python
standard library.

- Nothing here is sampled from a TR-606, TR-707 or TR-909, or from any other
  instrument or recording.
- The kits are voiced only loosely after the character of those machines.
  They are not emulations.
- Format: 16-bit mono PCM WAV at 44.1 kHz, normalised to a peak of 0.89.
- Author: generated for this repository. No third-party material.

## Regenerating

```bash
pnpm kits:generate   # rewrite assets/kits/<kit>/*.wav
pnpm kits:check      # confirm the committed files match the generator
```

The check allows a difference of one 16-bit step, because the last bit of
`math.sin` and `math.exp` can differ between platforms.

## Using them again

Nothing reads these files today. Bringing a machine back means giving it a
sound source (these samples, or its own synthesiser), a panel manifest and a
track table like `packages/contracts/data/machine-808.json`.

Before licensed recordings are committed, record their rights and provenance
here, per file.
