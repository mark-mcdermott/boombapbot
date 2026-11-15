# boombapbot

A drums-only beat maker. This repo holds v0.1: a web editor that runs
entirely locally, plus a VST3 compile spike. `README.md` covers what it does
and how it was verified; `docs/follow-ups.md` covers what is left. The build
spec's wider scope (cloud, accounts, native shells, billing) is not started.

## Commands

First-time setup, in this order. Later steps use what earlier ones build.

```bash
./scripts/setup-emsdk.sh   # once: Emscripten 6.0.13 into .tools/emsdk
pnpm install
pnpm build:engine          # native engine + CTest, into build/native
pnpm build:wasm            # same sources to build/wasm/boombapbot-engine.wasm
pnpm dev                   # http://localhost:4321
```

Checks, in the order CI runs them:

```bash
pnpm kits:check            # committed demo WAVs match their generator
pnpm faceplates:check      # committed faceplate drawings match their generator
pnpm build:engine          # also runs the engine tests
pnpm build:wasm
pnpm typecheck
pnpm test:unit             # Vitest, against the WASM build
pnpm build                 # production build, then scripts/check-build.mjs
pnpm test:e2e              # Playwright, against apps/site/dist
```

- `pnpm test:e2e` tests the production build, so run `pnpm build` first.
  It needs `pnpm exec playwright install chromium` once on a new machine.
- One engine test binary: `./build/native/test_scheduler` (also `voices`,
  `choke`, `swing`, `kit_mapping`, `midi`).
- One Vitest file: `pnpm exec vitest run packages/editor/test/engine.test.ts`.
- One Playwright file: `pnpm exec playwright test e2e/hardware.spec.ts`.
- VST3 spike: `cmake -S plugins/vst3 -B build/vst3 -G Ninja`, then
  `cmake --build build/vst3`, then `ctest --test-dir build/vst3`.

## How it fits together

- `engine/` is the only audio engine: a C++20 sampler and scheduler behind a
  C ABI (`engine/include/boombapbot/engine.h`). It builds natively and to
  WebAssembly from the same sources. Do not add a second engine in
  JavaScript, even to work around a failing WASM build.
- `packages/contracts/` is the source of truth for data shapes: the Zod
  project schema, drum roles, kit manifests and hardware panel geometry. The
  C++ tests read the same JSON files, so a change there is checked on both
  sides.
- `packages/editor/` is the React editor. `EditorStore` holds the beat;
  `EditorRuntime` connects it to audio, local storage and the exporters;
  `AudioController` is the only thing that talks to the AudioWorklet.
- `apps/site/` is an Astro site that mounts the editor as a client-only
  island. It has no API routes and reads no environment variables.

## Rules that are easy to break

**Engine**

- Nothing in `snare_engine_render` may allocate, lock, do I/O or call out.
  Control calls go through the command queue and apply at the next buffer.
- Step times are computed from an anchor, never accumulated. Playback,
  offline render and MIDI export all use `timeline.h`, so they cannot drift
  apart. Keep it that way.
- Output must not depend on buffer size. `test_scheduler` checks that renders
  at different block sizes are bit-identical.
- The functions the WASM build exports are listed in `engine/CMakeLists.txt`
  (`SNARE_WASM_EXPORTS`). Add new C ABI functions there, and to
  `packages/editor/src/engine/wasm-engine.ts`.
- `test_realtime` counts heap calls inside `snare_engine_render` and
  `test_abi.c` pins struct layouts; a unit test compares the header, the
  export list and the TypeScript bridge. Keep all three passing.
- `engine/src/synth808.cpp` builds the 808's sounds from knob settings. Do
  its arithmetic in double, use the C library's maths for coefficients only,
  and keep its own noise generator: that is what holds native and WASM to
  one 24-bit step per sound. Never synthesise on the audio thread; render
  the sound elsewhere and hand over PCM.
- Each sound slot holds its own sound (`snare_engine_set_sound`); the kit
  calls are a layer over that. A replaced sound is freed on the control
  thread by `snare_engine_collect`, never in render. When a sound knob
  moves, `EditorRuntime.sendSound` re-synthesises that one voice on the main
  thread and posts it; one sound per slot is in flight at a time and the
  newest setting follows when the worklet acknowledges.
- The tools and tests must compile with Clang as well as GCC. CI builds both.
- `-ffp-contract=off` is deliberate: it keeps native and WASM renders within
  two 24-bit steps of each other, which a unit test asserts.

**Beats and kits**

- Steps belong to stable role IDs (`kick`, `snare`, `closed_hat`, ...), and a
  role's `index` in `packages/contracts/data/roles.json` is its engine slot.
  Never reorder or reuse an index.
- The page offers only the kits in `packages/contracts/data/offered-kits.json`
  (`OFFERED_KIT_IDS`), currently the 808. With one kit there is no picker. A
  held-back kit stays defined, built and tested: browser tests reach it with
  `chooseKit`, which goes through `window.__boombapbot.setKit`. A draft or
  import on a held-back kit opens on the first offered kit (`onOfferedKit`),
  and the build ships faceplates for offered kits only.
- A kit switch changes only the role-to-sample mapping. It must not touch
  steps, velocities, tempo or swing.
- The demo kits in `assets/kits/` are synthesised by
  `scripts/gen_demo_kits.py` and are placeholders. Change the script and run
  `pnpm kits:generate`; do not hand-edit the WAVs. They are not recordings of
  hardware and must not be described as such.
- An invalid project import must never replace the current draft, and an
  unreadable saved draft is set aside, not deleted.

**Naming and faceplates**

- The owner does not want manufacturer or product brand names in the app or
  its images. The machines are "606", "707", "808" and "909". The one
  exception is the photo credit line, which has to name the original work.
- A faceplate in `assets/faceplates/` is one of two things, and `check-build`
  fails a build whose faceplate is neither or has no entry in
  `assets/faceplates/README.md`:
  - A drawing made by `scripts/draw-faceplates.mjs` (the 808). Its manifest
    sets `faceplate.original` and has no credit. Change the script and run
    `pnpm faceplates:draw`; do not hand-edit the SVG. The script places live
    controls from the panel manifest, so keep reading positions from there.
  - The owner's debranded edit of a Creative Commons photograph (606, 707,
    909). Its manifest needs a `faceplate.credit`. The credit shown under the
    panel is a licence requirement, so do not remove it.
- `misc/assets/` is git-ignored and is for the owner's unedited originals.
  Nothing from it may reach a production build or a commit.
- Panel coordinates are in each image's own pixel space
  (`faceplate.width` and `height`). If an image is re-cropped, re-fit the
  layout; `assets/faceplates/README.md` records how each was fitted.
- The header mascot (`packages/editor/src/assets/mascot.svg`) is the owner's
  artwork and is used unaltered. Its cream outline on the dark background is
  CSS, in `.sb-mascot`.

**Page layout**

- The page is the brand, the machine and the footer, nothing else. Every
  other control lives in the settings sheet behind the footer's cog
  (`packages/editor/src/ui/Settings.tsx`); put new controls there.
- What stays on the page with the machine: its Play (the faceplate's own
  start/stop in Hardware, the grid's corner in Modern), import and error
  notices, the faceplate credit, and the note about hits a panel cannot show.
- The editor opens in Hardware mode, and the mode is not saved with the
  draft. Browser tests that work on the grid start with `openModern`, and
  reach buried controls through `openSettings` (`e2e/helpers.ts`).

**Build output**

- These are generated and git-ignored; never commit them:
  `apps/site/public/engine/`, `public/kits/`, `public/faceplates/`,
  `public/boombapbot-assets.json`, `build/`, `.tools/`.
- The worklet is bundled separately by `scripts/prepare-assets.mjs`. After
  changing `engine/worklet/processor.ts` or `wasm-engine.ts`, restart
  `pnpm dev` or run `pnpm prepare:assets`.
- Dependencies are pinned to exact versions. `@playwright/test` is pinned to
  match the browser build it is tested with.

## Things that will surprise you

- Astro 7 runs `astro dev` and `astro preview` detached when there is no
  terminal. Stop them with `pnpm --filter @boombapbot/site exec astro dev stop`.
  For serving a production build, `pnpm serve` is simpler and is what the
  browser tests use.
- Browsers only start audio after a user gesture. `AudioController.start`
  creates the `AudioContext` synchronously inside the click for that reason.
- `window.__boombapbot` exposes `debug()` and `renderLoop()` for tests. The
  browser tests use it to check that the worklet really rendered sound.
- Hardware mode is a prototype. Each panel manifest has a `pending` list of
  behaviour not yet checked against the machine's manual.

## Not verified yet

Nobody has listened to this build: audio has only been checked numerically.
Also untested are browsers other than headless Chromium, real phones, macOS
and Windows builds, deployment, and the VST3 in any host. Say so rather than
assuming these work.

## Working in this repo

- Work goes on a feature branch and lands through a pull request. CI
  (`.github/workflows/ci.yml`) runs every check above plus the VST3 spike.
- Run the checks that cover what you changed before pushing, and report
  results as they are, including what you could not run.
- Keep `README.md` and `docs/follow-ups.md` in step with changes to scope,
  commands or what has been verified.
