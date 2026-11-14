# boombapbot

A drums-only beat maker. This is **v0.1**: the web editor, running entirely on
your machine with no accounts, secrets or external services.

![The Modern editor playing the starter beat on the 909 demo kit](docs/screenshots/modern.png)

Open the editor, press Play, and you hear a beat. Toggle steps, shape their
velocity, change tempo and swing, switch between four kits without losing the
rhythm, reload and find your beat still there, and export it as WAV, MIDI or a
project file.

## Run it

You need Node 22.23.4 (`.nvmrc`), pnpm 10.28.0 (`corepack enable` provides
it), CMake 3.22 or newer, Ninja, a C++20 compiler, Python 3 and git.

```bash
./scripts/setup-emsdk.sh
```

```bash
pnpm install
```

```bash
pnpm build:engine
```

```bash
pnpm build:wasm
```

```bash
pnpm dev
```

Then open http://localhost:4321.

- `setup-emsdk.sh` installs Emscripten 6.0.13 (pinned in `.emscripten-version`)
  into `.tools/emsdk`. It is needed once and touches nothing outside the repo.
- `build:engine` builds the native C++ core and runs its tests. `build:wasm`
  builds the same sources to WebAssembly.
- No environment variables are read. The site makes no network requests
  beyond its own files.

To try the production build instead:

```bash
pnpm build
```

```bash
pnpm serve
```

## What v0.1 does

- **Modern editor.** Eight lanes by 16 steps in 4/4, play and stop, tempo
  (40 to 240 BPM), swing (50 to 75%), per-step velocity, voice audition pads,
  kit selection, undo and redo, a starter beat and a clear action. Works with
  mouse, keyboard and touch; on a phone each lane wraps into two rows of
  eight.
- **Four demo kits** labelled 606, 707, 808 and 909. They are synthesised
  placeholders, not recordings of hardware. See
  [Demo kits](#demo-kits-provenance).
- **Kit switching keeps the beat.** Steps belong to stable drum roles (`kick`,
  `snare`, `closed_hat`, ...). A kit maps roles to samples, so changing kit
  changes the sound and nothing else. Where a kit has no native voice for a
  role (the 606 has no clap) the manifest names a stand-in and the lane is
  marked.
- **One engine everywhere.** A C++20 sampler and scheduler (`engine/`) with a
  C ABI: a fixed pool of 64 overlapping voices, hat chokes, deterministic
  voice stealing, and step times computed from the audio sample clock. The
  browser runs its WebAssembly build inside an AudioWorklet; export uses a
  second instance of the same engine. There is no separate JavaScript engine.
- **Saving.** The draft is saved to this browser on every edit and restored on
  reload. A draft that fails validation is set aside, not deleted.
- **Import and export.** Project JSON (validated with Zod; an invalid file is
  rejected and never replaces the current beat), a one-bar seamless PCM WAV
  loop (24 or 16-bit stereo, 44.1 kHz), and a Type 1 Standard MIDI File with a
  tempo track and General MIDI drum notes on channel 10.
- **Hardware mode (prototype).** A panel for each of the four machines,
  sharing the same beat as the Modern editor. See
  [Hardware mode](#hardware-mode-and-faceplate-photos).

## Tests

Run in this order; later steps use what earlier ones build.

| Command | What it checks |
| --- | --- |
| `pnpm kits:check` | The committed demo WAVs match their generator script |
| `pnpm build:engine` | Builds the native engine and runs CTest: scheduler timing across buffer sizes, ten minutes without drift, voices and stealing, hat chokes, swing and loop length, kit mapping across all four kits, MIDI |
| `pnpm build:wasm` | Builds the engine to WebAssembly |
| `pnpm typecheck` | TypeScript across packages, tests and the Astro site |
| `pnpm test:unit` | Vitest against the WASM build: rendering through every kit, native versus WASM output, WAV and MIDI contents, project schema, import, draft recovery, store |
| `pnpm build` | Production Astro build, then `scripts/check-build.mjs`: the worklet, the engine and all kit samples resolve in the built site, the engine needs no shared memory, and no faceplate photos are included |
| `pnpm test:e2e` | Playwright against the production build in headless Chromium: grid, keyboard, touch layout, playback activation, kit switch, reload, downloads, import rejection, hardware mode on all four panels, accessibility scan |

`pnpm test` runs the engine, unit and browser suites after a build.
`.github/workflows/ci.yml` runs the whole list on every push and pull request.

### Results on the machine that built this

Linux x86-64, 4 cores, GCC 13, Node 22.23.4, Emscripten 6.0.13, Chromium
headless via Playwright 1.63.

| Step | Result |
| --- | --- |
| `pnpm kits:check` | 32 of 32 files match |
| `pnpm build:engine` | 6 CTest suites, 29 cases, all pass with GCC 13 and Clang 18, and under AddressSanitizer and UndefinedBehaviorSanitizer |
| `pnpm build:wasm` | 40 KB module, one import, no threads or shared memory |
| `pnpm typecheck` | 0 errors |
| `pnpm test:unit` | 47 of 47 pass |
| `pnpm build` | Build check passes |
| `pnpm test:e2e` | 37 of 37 pass |

The same sequence was also run from a fresh clone with a fresh Emscripten
install, start to finish, and passed. The WASM binary from that run was
byte-identical to the working build.

Two cross-checks worth knowing about:

- **Native versus WASM.** For the shared fixture through all four kits, event
  frames are identical and audio agrees to within two 24-bit steps. The
  remaining difference is the last bit of `pow`, `tanh`, `sin` and `cos`
  between glibc and the WASM libc.
- **Buffer size.** Output is bit-identical whether rendered one frame at a
  time or in blocks of 17, 64, 128, 441, 1024 or 4096 frames.

### What was not verified

- **Listening.** Nobody has heard this build. Audio was checked numerically:
  the worklet reports nonzero output, exported WAVs contain audio at the right
  length, and native and WASM renders agree. How the kits sound, and how the
  latency feels, needs ears.
- **The GitHub Actions workflow** has not run on GitHub. Every command in it
  was run locally from a fresh clone.
- **Browsers other than headless Chromium.** Firefox, Safari and iOS have not
  been tried. The phone layout was checked in Chromium's device emulation,
  not on a phone.
- **Deployment.** The Vercel adapter build was produced locally, never
  deployed.
- **Hardware behaviour.** The panels are checked against the photos, not
  against the machines' manuals. Each panel lists what is unverified.
- **Device performance.** See the benchmark below; it says nothing about
  phones.

To reproduce the audio check by hand: `pnpm dev`, press Play, and switch
between the four kits while it plays.

### Engine load

`pnpm bench` renders a worst case through the WASM engine: every lane on every
step at 300 BPM with the longest-tailed kit, in 128-frame blocks, with the
voice pool full the whole time. On the build machine ten minutes of that
rendered in 7.7 seconds, about 78 times faster than real time, with output
bounded and 64 voices sounding. This is a desktop number.

## Demo kits: provenance

Every sound in `assets/kits/` is generated by
[`scripts/gen_demo_kits.py`](scripts/gen_demo_kits.py) from oscillators and
seeded noise, using only the Python standard library. Nothing is sampled from
a real drum machine or any recording, and there is no third-party material.
The kits are voiced loosely after the character of the four machines so that
a kit switch is obvious; they are placeholders until licensed recordings
replace them. Details and how to replace them:
[`assets/kits/README.md`](assets/kits/README.md).

## Hardware mode and faceplate photos

![The drawn 606 panel](docs/screenshots/hardware-drawn.png)

Hardware mode puts step buttons, lamps, an instrument selector, transport and
a tempo knob where they are on each machine's faceplate. The layout comes from
manifests in `packages/contracts/data/panels/`, measured on the owner's
photos. State, keyboard and accessibility do not depend on the picture.

**The photos are not in this repository and not in production builds.** Their
rights and provenance are not recorded, and the handoff says not to copy
uncleared photos into public source or release artifacts. So:

- With no photo, the panel is drawn from the manifest (the screenshot above).
  That is what a fresh clone, CI and `pnpm build` show.
- Put `606.jpg`, `707.jpg`, `808.jpg` and `909.png` in `misc/assets/` (ignored
  by git) and `pnpm dev` uses them as the faceplate, with the knobs cut from
  the photo and rotating in place.
- `pnpm build` leaves them out, and `check-build` fails a build that contains
  them. Once a photo is cleared, `BOOMBAPBOT_INCLUDE_FACEPLATES=1 pnpm build`
  includes it.

Hardware mode is a prototype. Edits made on a panel and in Modern are the same
beat. Hits on lanes a panel has no control for are kept, keep playing, and are
pointed out. What each panel does not yet model (accent tracks, A/B variation,
first and second parts, scale, chaining and so on) is listed in the panel
itself and in [`docs/follow-ups.md`](docs/follow-ups.md).

## Layout

| Path | Contents |
| --- | --- |
| `engine/` | C++20 core, C ABI, WASM target, CTest suites, `boombapbot-render` tool |
| `packages/contracts/` | Zod project schema, drum roles, kit manifests, panel geometry, shared fixture |
| `packages/editor/` | React editor, AudioWorklet bridge, exporters, local draft |
| `apps/site/` | Astro site; the editor is a client-only island |
| `assets/kits/` | Generated demo kit WAVs |
| `plugins/vst3/` | JUCE VST3 compile spike, outside the web build |
| `e2e/` | Playwright tests |
| `scripts/` | Toolchain setup, builds, asset preparation, build check, benchmark |
| `misc/assets/` | Local faceplate photos (ignored by git) |

## File formats

- **Project JSON** (`.boombapbot.json`, `format: "boombapbot.project"`,
  `schemaVersion: 1`): one 16-step pattern, tempo, swing, kit ID and version,
  and eight lanes keyed by role with a velocity per step. This is the v0.1
  draft and interchange file. It is **not** the future portable `.boombapbot`
  bundle, which will carry user samples next to a manifest.
- **WAV**: one bar, rendered as the second of two bars so tails wrap into the
  start and it loops cleanly. The length is exactly `240 / BPM` seconds.
- **MIDI**: Type 1, 480 PPQ, a tempo track and a drum track on channel 10.
  Notes are placed with the same timeline function the audio scheduler uses,
  so swing matches.

## VST3 compile spike

VST3_PLACEHOLDER

## Next milestone

In the build spec's sequence, v0.1 covers the web half of "prove the platform
stack" and most of "build one end-to-end beat". Next:

1. Have a person listen to it, on a desktop and a phone, and fix what they
   hear.
2. Boot the same engine natively: Tauri with CPAL on desktop, Capacitor with
   AVAudioEngine and Oboe on mobile, and the VST3 in a real host on Windows
   and macOS. Prerequisites for each are in
   [`docs/follow-ups.md`](docs/follow-ups.md).
3. Clear the faceplate photos and replace the demo kits with licensed
   recordings, recording rights and provenance for both.
4. Validate one machine's panel workflow against its manual and sign off its
   control profile, then the other three.
5. Grow the project document: multiple patterns, arrangement, per-lane mix,
   and the portable bundle.

Cloud sync, accounts, billing, signing and store submission come after that.
