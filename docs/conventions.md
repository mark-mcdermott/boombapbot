# boombapbot

A drums-only beat maker. This repo holds v0.1: a web editor that is one drum
machine, the 808, running entirely locally, plus a VST3 compile spike. It is
being brought up to the whole machine from its operation manual; `README.md`
says what is modelled so far and how it was verified, and
`docs/follow-ups.md` has what is left and in what order. The build spec's
wider scope (cloud, accounts, native shells, billing) is not started.

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
pnpm kits:check            # committed 606/707/909 WAVs match their generator
pnpm faceplates:check      # committed faceplate drawing matches its generator
pnpm build:engine          # also runs the engine tests
pnpm build:wasm
pnpm typecheck
pnpm test:unit             # Vitest, against the WASM build
pnpm build                 # production build, then scripts/check-build.mjs
pnpm test:e2e              # Playwright, against apps/site/dist
```

- `pnpm test:e2e` tests the production build, so run `pnpm build` first.
  It needs `pnpm exec playwright install chromium` once on a new machine.
- One engine test binary: `./build/native/test_scheduler` (also `timeline`,
  `pattern_bank`, `sequencer`, `accent`, `voices`, `choke`, `midi`, `sound_map`,
  `realtime`, `synth`).
- One Vitest file: `pnpm exec vitest run packages/editor/test/engine.test.ts`.
- One Playwright file: `pnpm exec playwright test e2e/hardware.spec.ts`.
- VST3 spike: `cmake -S plugins/vst3 -B build/vst3 -G Ninja`, then
  `cmake --build build/vst3`, then `ctest --test-dir build/vst3`.

## How it fits together

- `engine/` is the only audio engine: a C++20 drum machine core behind a C
  ABI (`engine/include/boombapbot/engine.h`). It holds a bank of 32 patterns,
  twelve tracks (the accent and eleven instruments), sixteen sound slots, the
  808's synthesiser and a mix bus. It builds natively and to WebAssembly from
  the same sources. Do not add a second engine in JavaScript, even to work
  around a failing WASM build.
- `packages/contracts/` is the source of truth for data shapes: the Zod
  project schema (`project.ts`, version 2, with the move from version 1 in
  `legacy.ts`), the machine's tracks, tempo and level model (`machine.ts`,
  `data/machine-808.json`), the sounds (`roles.ts`) and the panel geometry.
  The C++ tests read the same JSON files, so a change there is checked on
  both sides.
- `packages/editor/` is the React editor. `EditorStore` holds the project;
  `EditorRuntime` connects it to audio, local storage and the exporters;
  `AudioController` is the only thing that talks to the AudioWorklet.
  `engine/machine.ts` turns a project into what the engine takes, for live
  playback and offline rendering alike.
- `apps/site/` is an Astro site that mounts the editor as a client-only
  island. It has no API routes and reads no environment variables.

## Rules that are easy to break

**Engine**

- Nothing in `snare_engine_render` may allocate, lock, do I/O or call out.
  Control calls go through the command queue and apply at the next buffer.
- Time is counted in ticks, 24 to the beat, so a step at any pre-scale is a
  whole number of them. Step frames are computed from an anchor, never
  accumulated. Playback, offline render and MIDI export all use `timeline.h`,
  so they cannot drift apart. Keep it that way.
- A pattern's 2nd part lives at steps 16 to 31 whatever the length of its 1st
  part (`stepPosition`). Its length and step size are fixed for a measure
  when that measure begins; step edits apply at the next buffer.
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
- Each sound slot holds its own sound (`snare_engine_set_sound`). A replaced
  sound is freed on the control thread by `snare_engine_collect`, never in
  render. When a sound knob moves, `EditorRuntime.sendSound` re-synthesises
  that one sound on the main thread and posts it; one sound per slot is in
  flight at a time and the newest setting follows when the worklet
  acknowledges.
- A track has one voice: its new hit fades the old one. The engine takes
  linear gains; the knob tapers live in `packages/contracts/src/machine.ts`
  and are mirrored in `engine/tools/project_io.h` and
  `plugins/vst3/Source/Machine808.h`. Track level and master volume are
  smoothed per sample, in a way that does not depend on buffer size.
- The engine, not TypeScript, decides what plays at a bar line.
  `engine/src/sequencer.h` is pure and holds those rules: A, AB and B, intro,
  tapped and automatic fill-ins, and songs. `engine/machine.ts`
  (`enginePanel`) only tells the engine where the panel's switches stand. A
  rhythm track is handed over whole as a song (`snare_engine_set_song`), and
  an export asks the engine which version each measure plays
  (`snare_song_patterns`) so it cannot disagree with what is heard.
- The page learns what played from the measure log, which the worklet drains
  after every render and never skips. A measure whose rhythm changed on its
  second beat is reported twice under one ordinal. Compose records from it:
  `EditorRuntime` keeps the take and stores it when the machine stops, as
  one undo step.
- The tools and tests must compile with Clang as well as GCC. CI builds both.
- `-ffp-contract=off` is deliberate: it keeps native and WASM renders within
  two 24-bit steps of each other, which a unit test asserts.

**The project and the machine**

- A track's position in `TRACK_IDS` is its engine track (the accent is 0), and
  a role's `index` in `packages/contracts/data/roles.json` is its sound slot
  and the synthesiser's sound number. Never reorder or reuse either.
- A step is on or off. Loudness comes from the accent track and the level
  knobs. There is no per-step velocity and no swing; do not bring them back
  as a convenience.
- The engine's pattern for a rhythm is `rhythm * 2`, plus one for its B
  version (`patternIndex`).
- The instrument selector chooses a rhythm track in play and compose, and a
  track runs on into the next only when it is full (`composition`,
  `withComposition`).
- The step buttons do three jobs: steps in the two write modes, the last step
  of a part while CLEAR is down, and the choice of rhythm in pattern clear,
  manual play and compose. Playing a track back they do nothing. `EditorStore.pressStep` is the one place that decides which.
  `panelTarget` (contracts) says which rhythm and version the panel is on.
- Undo covers what the machine remembers (`rhythms`, `rhythmTracks`) and a
  whole-project import. Knobs, switches, tempo and the name are not undo
  steps.
- An older project is brought up to date in `parseProject`, which also
  reports what was lost; the page shows that list. Add a step there for every
  schema change, with a fixture.
- A new project gets the starter rhythms and starter track
  (`packages/contracts/src/starter.ts`). They are written for boombapbot; do
  not copy the hardware's factory rhythms into them. Browser tests that need
  an empty rhythm use Basic Rhythm 10.
- An invalid project import must never replace the current draft, and an
  unreadable saved draft is set aside, not deleted.
- `assets/kits/` holds generated sample kits for the 606, 707 and 909, made by
  `scripts/gen_demo_kits.py`. Nothing loads them at the moment. Do not
  hand-edit the WAVs, and do not describe them as recordings of hardware.

**Naming and faceplates**

- The owner does not want manufacturer or product brand names in the app or
  its images. The machine is the "808". The one exception would be a photo
  credit line, which has to name the original work.
- The faceplate is a drawing made by `scripts/draw-faceplates.mjs`. Its
  manifest sets `faceplate.original` and has no credit. Change the script and
  run `pnpm faceplates:draw`; do not hand-edit the SVG. The script places live
  controls from the panel manifest, so keep reading positions from there.
  `check-build` fails a build whose faceplate is not the committed one, or has
  no entry in `assets/faceplates/README.md`, or is a photograph without a
  `faceplate.credit`.
- The 606, 707 and 909 photographs in `assets/faceplates/` are the owner's
  debranded edits of Creative Commons works, kept for later. If one ships
  again it needs its credit shown under the panel; that is a licence
  requirement.
- `misc/assets/` is git-ignored and is for the owner's unedited originals.
  Nothing from it may reach a production build or a commit.
- Panel coordinates are in the image's own pixel space (`faceplate.width`
  and `height`). `assets/faceplates/README.md` records how it was fitted.
- The header mascot (`packages/editor/src/assets/mascot.svg`) is the owner's
  artwork and is used unaltered. Its cream outline on the dark background is
  CSS, in `.sb-mascot`.

**Page layout**

- The machine's page is the header, the machine and the footer, nothing else.
  A control the machine has belongs on its faceplate. Anything else about the
  machine lives in the settings modal behind the footer's cog
  (`packages/editor/src/ui/Settings.tsx`).
- `Header` (brand and `MachineNav`) and `Footer` (About, Docs, upgrade, cart,
  settings, account) are shared. `SitePage` wraps a page of words in them;
  About and Docs are Astro pages in `apps/site/src/pages` that use it. Every
  footer modal goes through `ui/Modal.tsx`.
- Upgrades, the cart and accounts have no backend. Their modals say so and
  offer no form. Do not add a form, a price or a feature list until the real
  thing exists.
- What stays on the page with the machine: import and error notices, and on
  a phone the instrument and mode strips and the docked start button.
- The power switch makes everything else on the panel `inert` through the
  `sb-panel-controls` wrapper. A new panel control goes inside that wrapper.
- A dial with fixed positions gets a `DialHandle` so it can be turned by
  hand; its labels and the keyboard are the accessible way to the same choice.
- Browser tests reach buried controls through `openSettings`, and the
  machine through `selectTrack` and `stepButton` (`e2e/helpers.ts`).

**Build output**

- These are generated and git-ignored; never commit them:
  `apps/site/public/engine/`, `public/faceplates/`,
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
- A control is live only if the panel manifest lists it. The drawing reads
  the same entries, and draws a live knob without its light and a live switch
  without its lever, because the editor supplies those.
- The panel manifest has a `pending` list of what is not modelled yet. It is
  shown in settings, so keep it true as controls are connected.
- `pnpm dev` serves the Astro dev server; the browser tests and `pnpm serve`
  use the production build, so run `pnpm build` before either.

## Not verified yet

The owner has listened to an earlier build; the sounds are a model made by
ear and have not been compared with a real machine. Also untested are
browsers other than headless Chromium, real phones, Windows builds,
deployment, and the VST3 in any host. Say so rather than assuming these work.

## Working in this repo

- Work goes on a feature branch and lands through a pull request. CI
  (`.github/workflows/ci.yml`) runs every check above plus the VST3 spike.
- Run the checks that cover what you changed before pushing, and report
  results as they are, including what you could not run.
- Keep `README.md` and `docs/follow-ups.md` in step with changes to scope,
  commands or what has been verified.
