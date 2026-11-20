# boombapbot

A drums-only beat maker. This repo holds v0.1: a web editor that is one drum
machine, РИТМ-12, running entirely locally. РИТМ-12 is invented for
boombapbot. It is the only machine in this repository, and it is a package
that plugs into a core that knows no machine, so another machine can be
built elsewhere on the same core. `README.md` says what is built and how it
was verified, and `docs/follow-ups.md` has what is left and in what order. Accounts exist and
are optional: sign-up, log-in and password reset, and a free account can
hold up to 20 saved beats. `apps/mobile` is a first slice of the phone
apps: it runs in a simulator and an emulator and is not ready for a
store. On both phones it plays through the engine built natively.
`apps/desktop` is a first slice of the desktop app, for macOS: the engine
built natively behind the same editor. It runs on the Mac it was built on
and is not signed. On Windows it compiles and its Rust tests pass in CI,
and it has not run on a Windows machine. The paid upgrade, a one-time
payment rather than billing, is built and switched off, and its six effects
are in the engine only. Background sync is not started.

## Commands

First-time setup, in this order. Later steps use what earlier ones build.

```bash
./scripts/setup-emsdk.sh   # once: Emscripten 6.0.13 into .tools/emsdk
pnpm install
pnpm build:engine          # native engine + CTest, into build/native
pnpm build:wasm            # same sources to build/wasm/boombapbot-engine-<machine>.wasm
pnpm dev                   # http://localhost:4321
```

Checks, in the order CI runs them:

```bash
pnpm build:engine          # also runs the engine tests
pnpm build:wasm
pnpm typecheck
pnpm test:unit             # Vitest, against the WASM build
pnpm build                 # production build, then scripts/check-build.mjs
pnpm test:e2e              # Playwright, against apps/site/dist
```

- `pnpm test:e2e` tests the production build, so run `pnpm build` first.
  It needs `pnpm exec playwright install chromium` once on a new machine.
  CI runs Chromium only. To try another engine, install it once
  (`pnpm exec playwright install webkit firefox`) and name it:
  `BOOMBAPBOT_E2E_BROWSER=webkit pnpm test:e2e`. That is Playwright's own
  build of WebKit or Firefox on this computer, not Safari on a phone.
- One engine test binary: `./build/native/test_scheduler` (also `timeline`,
  `pattern_bank`, `sequencer`, `accent`, `voices`, `choke`, `midi`,
  `realtime`, `synthesis`, `swing`, `fx`, and `test_ritm12_voices`).
- One Vitest file: `pnpm exec vitest run packages/machine-ritm12/test/native.test.ts`.
- One Playwright file: `pnpm exec playwright test e2e/ritm12/panel.spec.ts`.
- `pnpm bench` measures the WebAssembly engine at its worst case.
- The desktop app, which CI does not build. It needs Rust and
  `pnpm prepare:assets` first: `pnpm --filter @boombapbot/desktop app` runs
  it from a dev server, `bundle` builds the `.app` and a `.dmg` (on Windows, an installer), `test:engine` is
  `cargo test` for its Rust, and `check:run` builds it and has it play a
  beat and report on itself. `check:run` makes sound.
- The phone app's engine for iOS: `pnpm --filter @boombapbot/mobile
  engine:ios` builds it, and its plug-in's tests run in a simulator with
  `xcodebuild test -scheme BoombapbotNativeEngine` in
  `apps/mobile/native-engine`. On Android its tests run on an emulator with
  `./gradlew :boombapbot-native-engine:connectedDebugAndroidTest` in
  `apps/mobile/android`, with the NDK and CMake its `build.gradle` pins.
  `apps/mobile/README.md` has the check runs.

## How it fits together

- `engine/` is the only audio engine: a C++20 drum machine core behind a C
  ABI (`engine/include/boombapbot/engine.h`). It holds a bank of 32 patterns,
  twelve tracks (the accent and up to eleven instruments), sixteen sound
  slots and a mix bus, with swing by pattern, one effect on the mix and an
  output level for a meter. It builds natively and to WebAssembly from the
  same sources. Do not add a second engine in JavaScript, even to work
  around a failing WASM build.
- A machine is one package, and the rest is core that knows no machine. A
  machine package holds its project document (`src/document/`), what its
  controls do (`src/session.ts`), what it asks of the engine
  (`src/engine.ts`), its panel (`src/ui/`, with `src/styles.css`), its
  voices (`engine/voices.cpp`), its data, fixtures and art, and
  `src/index.tsx`, which puts those together as a `Machine`. Core must never
  import a machine package, and the editor's own `styles.css` has no machine
  in it.
- `packages/contracts/` holds what every machine shares: what any project
  document carries and the codec a build makes from its machines
  (`document.ts`), saved beats and the shop.
- The engine is only ever built for a machine. The core
  (`engine/src/engine.cpp`, `midi.cpp`, `synth.cpp`) has no voices; a
  machine's sources define `boombapbot::machineVoices()`
  (`engine/include/boombapbot/voices.h`) and its `engine/CMakeLists.txt`
  calls `boombapbot_add_machine` (`engine/cmake/BoombapbotMachine.cmake`).
  That gives `boombapbot-engine-<id>.wasm` and, natively,
  `boombapbot_engine_<id>`. A plain `cmake -S engine` builds every machine
  package in the repository; `BOOMBAPBOT_MACHINE_DIRS` names them otherwise.
- The engine's own tests (`engine/tests/`) are built with a test machine of
  two plain voices, `test_machine.cpp`, so they need no real one. A real
  machine's voices are tested in its own package, as
  `packages/machine-ritm12/engine/test_voices.cpp` does.
- The render tool (`engine/tools/render_cli.cpp`) knows no machine either.
  It is built once for each (`boombapbot-render-<id>`) and plays an engine
  setup, written as JSON, through the native engine: `--setup run.json`
  with `--out`, `--events` and `--midi`. `engine/tools/setup_io.h` applies a
  setup with the same calls, in the same order, as `applySetup` in the
  editor; keep the two in step. A unit test gives both builds the same
  setup and compares what comes out
  (`packages/machine-ritm12/test/native.test.ts`).
- `packages/machine-ritm12/` is РИТМ-12.
  Its eight voices are `engine/voices.cpp` (pitch, tone and decay; their
  place in the table is their sound number, never reorder); what voices are
  built from is shared in `engine/include/boombapbot/dsp.h`. Its project
  document is `src/document/` (schema version 3, `machine: 'ritm12'`: a tempo
  in beats a minute, four patterns of eight sixteen-step rows and an accent
  row, the mix, the voices' knobs, the effect and where the panel stands),
  with the voice table in `data/ritm12.machine.json`. `src/engine.ts` turns
  a project into an `EngineSetup` that cues the pattern the panel is on, and
  `src/session.ts` is what its controls do, recording by tapping included.
- `src/document/legacy.ts` in that package is the only thing that reads the
  beats of the machine before it (schema versions 1 and 2). It turns one
  into a РИТМ-12 beat and lists what was lost; it never writes those
  formats. It is self-contained: the machine it reads is not in this
  repository.
  A machine's draft has its own storage key, and a draft found under an
  earlier key is read and left exactly where it was.
- РИТМ-12's panel (`src/ui/`) is one picture with every control live on top
  of it. The stage is exactly as large as the picture, 2000 by 1333, and is
  shrunk as a whole to fit its frame, so every position in `ui/layout.ts`
  and every length in `src/styles.css` is in the picture's own pixels. A
  stepped control (power, write, size, effect) shows another picture of
  itself for each position (`Patch`); a knob's painted body stays still and
  only its pointer line, a picture of its own, turns (`PointerKnob`,
  `handTransform`); a lit key or lamp is light laid over the paint with a
  blend mode. The screen and the meter are drawn a frame at a time outside
  React (`ui/Screen.tsx`). What is lettered on the picture is Russian; every
  control's accessible name is English, and a control that moves says what
  it did in an `aria-live` line as well as on the machine's screen. The
  mouse wheel must not turn a knob: it would hijack scrolling the page.
- The panel has two views of one wiring. `ui/wiring.ts` (`useWiring`) reads
  the machine's state once and makes every control's name, state and action
  from it; `PicturePanel` (in `ui/Panel.tsx`) and `ui/PhonePanel.tsx` only
  draw it, through the same `Key`, `Lamp` and knob code in `ui/Controls.tsx`.
  A control is added or changed in the wiring, never in one view alone, and
  a control keeps one test id in both.
- Which view shows is decided in `ui/Panel.tsx` (`usePanelView`): the phone's
  panel on a screen up to 900px wide, which is a phone or a tablet held
  upright, and the picture on anything wider. It follows the width as it
  changes, and nothing is lost in between, because the beat is in the store.
  A page's address can ask for either by name, `?panel=phone` or
  `?panel=picture`, at any width. The phone's panel is not the
  picture shrunk. The page lays out parts cut from the picture
  (`art/phone/`) in a column: nameplate, screen, the eight voices, the step
  keys with the write switch, patterns with dice and clear, the transport
  and mute, and three tabs (voice, tempo, effect) that hold the knobs. Its
  styles are the `.rt-ph` part of `src/styles.css`, in the page's own
  pixels; a knob's body and pointer line are a piece of the picture shrunk
  about the knob's centre (`PHONE_KNOBS` in `ui/layout.ts`). Its paint and
  rust are drawn in CSS until the owner paints a blank plate. The lettering
  is drawn by the stylesheet (`Lettered`), as paint is, so it is not text of
  the page; names stay English, with the lettering after a tab's name as it
  is after a key's. The lettering is there to look at. What tells someone
  who cannot read it what a control is for is the drawing the picture has
  beside that label, cut from the picture (`art/phone/icon-*.png`) and
  shown in front of the lettering (`icon` on `Lettered`). Give every new
  lettered control one; the mix has none on the picture and carries the
  picture's 0 and 100% at the ends of its travel instead. And whatever a
  control says when it is touched shows in English for a moment on the
  screen's lower frame (`Caption`), the same words the `aria-live` line has:
  a key says what it did, a knob says where it stands as soon as it is
  pressed (`useTurning`), a tab says what is behind it, and the power switch
  says on or off. A new control that does something must say it
  (`readout.say`), in both tongues. The screen is the same drawing in a second shape
  (`PHONE_SCREEN` in `ui/Screen.tsx`); keep `PICTURE_SCREEN` as it is
  painted. It sets `data-own-transport`, which tells the editor to leave the
  docked start button out. It is laid out for a screen up to 430px wide and
  grows as a whole, by up to 1.3 times, where there is more room
  (`useGrowth`).
- Its art is `art/` in its package: `plate.webp`, `patch/` and `pointer/`,
  with where it comes from in `art/README.md`. `art/cut-art.py` cuts it
  from the owner's pictures in the git-ignored `misc/assets/ritm12/`, and
  `art/cut-phone-parts.py` cuts `phone/` from what that made; do not
  edit the cut files by hand. A build ships every image in the machine's
  `art/` folder, served under `machines/<id>/` and named by
  `art` in the asset manifest; `check-build` fails a build whose art is not
  byte for byte what is committed, or that carries another machine's.
- The site is one machine a build, named by `BOOMBAPBOT_MACHINE`; РИТМ-12
  when it is unset, which is always, here. РИТМ-12's browser tests of its
  own panel are in `e2e/ritm12/`, with its `helpers.ts`. The tests in `e2e/`
  itself are the site's: the page, settings, accounts, saved beats and the
  shop. They drive РИТМ-12.
- Shared between panels, in the editor: `useKnob` (a slider to a screen
  reader, dragged up and down, turned with the keys) and `useAssetManifest`.
- A setup follows either one pattern round and round (`follow.cue`, which
  is what РИТМ-12 asks for) or what a panel's switches ask for
  (`follow.panel`: A, AB and B versions, intros, fill-ins and songs). A
  render plan is one cued pattern (`PatternPlan`) or a song of rhythms
  (`SongPlan`). No machine here uses the panel and song side; it is core
  all the same, and `packages/editor/test/offline.test.ts` tests it with a
  setup written out by hand. The
  worklet takes `cue` and `effect` and reports `level` while it changes;
  `EditorRuntime.outputLevel()` is what a meter reads as it draws.
- Swing is a byte of the pattern (`SnarePattern.swing`, 0 to
  `SNARE_SWING_MAX`): every second step of a measure of four or eight steps
  to the beat plays late by `swing / 256` of a step, in the engine and in a
  MIDI export alike. The bar line never swings, and triplets do not.
- The effect on the mix (`engine/src/fx.h`, `snare_engine_set_effect`) sits
  ahead of the limiter. The engine has ten. An echo, a reverb, a flanger, a
  chorus and vinyl noise are added to the mix. A crusher, tape, a pump, a
  filter and a phaser work on the mix itself, and with their amount at 0
  give back exactly what came in, which is what lets one effect fade out
  before the next begins; for the filter the amount is how far it is shut.
  РИТМ-12 has the first four. The other six are for the upgrade: they are
  in the engine and in the bridge's `EFFECT`, and no machine's document can
  name them yet. All of it keeps the engine's promises: every buffer is
  allocated when the engine is made, state moves a sample at a time, and
  nothing calls the C library's maths per sample (the filter's and the
  phaser's tangent comes from the same polynomial as the sine). With no
  effect set it does not touch the samples. Vinyl's noise starts from one
  seed, so a render can be made twice, and it sounds only while there is
  something to hear and for a moment after. The pump hears the low end of
  the mix, not the kick's own track: the core knows no machine's tracks.
  An offline loop is played often enough for the effect's tail to settle
  (`loopPasses`), without changing its length. A new effect needs its
  number in `engine.h`, its name in `engine/tools/setup_io.h` and in
  `EFFECT` in `wasm-engine.ts`, a tail in `effectTailSeconds`, and a place
  in the lists in `engine/tests/test_fx.cpp`, `test_realtime.cpp` and
  `packages/machine-ritm12/test/native.test.ts`.
- `snare_engine_output_level` is the root mean square of the output over
  about a third of a second, after the volume: what a meter shows.
- `scripts/prepare-assets.mjs` and `scripts/check-build.mjs` work for one
  machine, named by `BOOMBAPBOT_MACHINE` like the site's alias (РИТМ-12 when
  unset). The asset manifest says which machine the build is. Its
  `faceplate` entry is for a machine whose panel is one drawn faceplate; no
  machine here has one, and `check-build` fails a build that names one.
- `packages/editor/` is the React editor core. `EditorStore` holds the
  project and undo; `EditorRuntime` connects it to audio, local storage and
  the exporters and hosts the machine; `AudioController` is the only thing
  that talks to the AudioWorklet. `machine.ts` is the contract a machine
  fills in. A machine's `setup` turns a project into an `EngineSetup`
  (`engine/setup.ts`), which the runtime compares with the last one and
  sends on, for live playback and offline rendering alike.
- The runtime plays through an `EngineAudio` (`engine/engine-audio.ts`) and
  knows no more of it than that. It makes an `AudioController` unless it is
  handed something else: `audio` on `BoombapbotEditor` is a function from
  where reports go (`AudioControllerEvents`) to a controller. What is
  handed in for an engine a shell runs natively is `NativeAudioController`
  (`engine/native-audio.ts`), which a shell gives a `NativeEngineBridge`:
  four calls, `open`, `send`, `listen` and `close`. The messages are in
  `engine/messages.ts`. A native engine is sent `NativeEngineCommand`, the
  worklet's commands but for two: a sound goes as its knobs (`synth`), for
  the engine to make at its own rate, and the effect goes by the engine's
  number, so a bridge keeps no list of effects. What comes back is
  `EngineReport` either way. The commands both take the same way are sent
  by one class, `EngineCommands`, which both controllers extend; add a
  command there, or to both if they must differ.
- A native controller sends one batch to its bridge at a time, and what is
  asked meanwhile goes together in the next, so the engine hears commands
  in the order given whatever the bridge does with two calls at once. Keep
  that if the sending changes.
- A native engine that was made again, as one is when the sound device
  changes, reports `ready` with its new rate. The controller then calls
  `onReset`, and the runtime tells the new engine the whole setup again
  (`retell`), which makes its sounds at the new rate, and to play on if it
  was playing. `ready` is not sent when an engine is first opened: `open`
  answers with the rate.
- A WAV export renders in a Worker, so a long one cannot hold the page
  still. `engine/wav-job.ts` is the job and what runs it, with no DOM in it
  and tested in Node; `wav-worker.ts` is the Worker and `wav-render.ts`
  starts one for each export. The file must stay byte for byte what
  `renderSong` and `encodeWav` give on the main thread; a unit test holds
  that. The store's `wavExport` says where a render stands, and the
  settings sheet shows it and says it to a screen reader. A MIDI file and
  the sound of a knob are made on the main thread. Vite bundles the Worker
  from `new URL('./wav-worker.ts', import.meta.url)`; keep that spelling.
- The site mounts the editor through `apps/site/src/components/Machine.tsx`,
  which imports `#machine`: an alias in `astro.config.mjs` set by
  `BOOMBAPBOT_MACHINE` (РИТМ-12 when unset), with the matching `paths` in
  `apps/site/tsconfig.json`: change both together. The server reads projects
  with a codec made from `#machine/document`. Only the chosen machine is
  ever imported.
- `apps/site/` is an Astro site that mounts the editor as a client-only
  island. Its pages are prerendered. The one thing that runs on a server is
  `src/pages/api/`, backed by `src/server/`: accounts (`api/auth`, Better
  Auth, Drizzle on Neon Postgres, Resend), saved beats (`api/beats`), the
  shop (`api/store`, `api/webhooks`, Stripe and Printful) and the upgrade
  (`api/upgrade`, the same Stripe webhook). The modals that
  talk to it are `packages/editor/src/ui/Account.tsx` (with
  `SavedBeats.tsx`), `Shop.tsx` and `Upgrade.tsx`. A call to the site's own
  server goes through `ask` (`account/ask.ts`), which reads an answer and a
  refusal with the contracts' schemas; `account/beats.ts` and
  `upgrade/client.ts` are built on it. What a form shares (one call at a
  time, the line that says what went wrong, a button that reads as a link)
  is `ui/attempt.tsx`.
- `apps/mobile/` is the same editor with РИТМ-12 in a Capacitor shell for
  iOS and Android, a Vite page with no server behind it. `BoombapbotEditor`
  takes four things for a shell: `audio`, above, which this app hands in
  where the phone has its engine plug-in (both phones; in a browser the
  sound is the web view's own worklet and WASM engine);
  `storage`, where the draft is kept (the app
  hands in the device's own store, `src/device-storage.ts`); `save`, where
  an exported file goes (a download when not given; the app hands it to the
  phone's share sheet, `src/share-file.ts`, because a web view inside an app
  ignores a download); and `below`, what sits under the machine in place of
  the cookie notice and the footer. A `save` answers false when the person
  turned the file down, and an export then claims nothing. It can take as
  long as the person does, so a WAV export has a `saving` state between
  `rendering` and `done`, and another WAV cannot be asked for in either.
  The settings sheet is told whether the page has accounts (`accounts`,
  false when `below` is given), and names an account as a way to keep a
  beat only where there is one.
  The app leaves accounts, saved beats and the shop out, and what it puts
  under the machine is `shellFooter`, the editor's. Its engine, worklet
  and art are the site's, copied by `scripts/copy-app-assets.mjs` from what
  `pnpm prepare:assets` made. `ios/` and `android/` are Capacitor's native
  projects and are committed; `cap sync` rewrites parts of them. Its
  `README.md` says how to run it, what was checked and what is left.
- The phone's engine plug-in is `apps/mobile/native-engine`, a package the
  app depends on (`link:`) so that Capacitor finds it: Capacitor calls it
  `BoombapbotNativeEngine` and asks its `Package.swift` for a product of
  that name. Its iOS half is a Swift package. The engine is a binary target,
  `BoombapbotEngine.xcframework`, built for a machine by
  `scripts/build-engine-ios.sh` with the repository's CMake and not
  committed. `EngineRender` is the C the audio thread runs; `EngineCore` is
  the Swift that touches the engine, with no Capacitor, so its tests run on
  their own; `EnginePlugin` is the Capacitor plug-in and the phone's audio.
  Capacitor finds the plug-in's class by the first `@objc(...)` in a Swift
  file under `ios/`, so only `EnginePlugin.swift` may have one. Its Android
  half is the Gradle module `android/`: `src/main/cpp` builds the engine
  with the repository's CMake (`add_subdirectory` of `engine/`, found from
  the folder's real path, since Gradle may reach it through
  `node_modules`) and plays it with Oboe; the Java is the rest. The NDK
  and CMake versions are pinned in its `build.gradle`; change them there.
- A shell that runs the engine natively checks itself with
  `runShellCheck` (`packages/editor/src/shell-check.ts`, imported from
  `@boombapbot/editor/shell-check`, only in a check run): the page plays
  the beat, and reports what it saw and what the engine says of itself
  through a `ShellCheckHost` the shell fills in. A shell's page asks its
  native side whether this is a check run, and loads the check only then.
- `apps/desktop/` is the same editor with РИТМ-12 in a Tauri window, for
  macOS first, and the one shell whose sound is not the web view's. Its page
  (`src/main.tsx`) hands the editor a `NativeAudioController` over
  `src/tauri-engine.ts`, and `save` as `src/save-export.ts`: the app asks
  where to keep a file and writes it, and the page never names a place on
  the disk. Served to a browser by `pnpm dev`, the same page is the editor
  as the site has it. The Rust is `src-tauri/`. `build.rs` builds the
  engine with the repository's CMake as `boombapbot_engine_ritm12` and
  links it; `ffi.rs` is the C ABI as far as the app calls it;
  `messages.rs` is `NativeEngineCommand` and `EngineReport` in serde, with
  tests that hold both to the editor's spelling; `engine.rs` splits the
  engine as its threading contract does, an `Engine` for control calls and
  a `Renderer` for the audio thread; `output.rs` is the CPAL stream;
  `bridge.rs` is the control thread; `watch.rs` decides what the page is
  told and how often, as the worklet does; `save.rs` is exports; and
  `check.rs`, with the page's `src/check.ts`, is the run that checks
  itself. Its page still
  loads the WASM engine, for exports. It leaves out what `apps/mobile`
  leaves out. Its `README.md` says how to run it, what was checked and what
  is left.
- Nothing the editor imports may need the page's address to be http or
  https when the file is read: an app's page is `capacitor://localhost`,
  or `tauri://localhost`.
  The account client is made on first use for that reason (`authClient()`
  in `account/client.ts`).

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
- The functions the WASM build exports are listed in
  `engine/cmake/BoombapbotMachine.cmake` (`SNARE_WASM_EXPORTS`). Add new C ABI functions there, and to
  `packages/editor/src/engine/wasm-engine.ts`.
- `test_realtime` counts heap calls inside `snare_engine_render` and
  `test_abi.c` pins struct layouts; a unit test compares the header, the
  export list and the TypeScript bridge. Keep all three passing.
- A machine's `engine/voices.cpp` builds its sounds from knob settings. Do
  its arithmetic in double, use the C library's maths for coefficients only,
  and take noise from the integer generator in `dsp.h`: that is what holds
  native and WASM to one 24-bit step per sound. Never synthesise on the
  audio thread; render the sound elsewhere and hand over PCM.
- Each sound slot holds its own sound (`snare_engine_set_sound`). A replaced
  sound is freed on the control thread by `snare_engine_collect`, never in
  render. When a sound knob moves, `EditorRuntime.sendSound` re-synthesises
  that one sound on the main thread and posts it; one sound per slot is in
  flight at a time and the newest setting follows when the worklet
  acknowledges. A native engine is sent the knobs instead and synthesises on
  its control thread (`snare_engine_synth_sound`); it acknowledges the same
  way, and the same one-in-flight rule holds.
- A track has one voice: its new hit fades the old one. The engine takes
  linear gains; a machine's knob tapers live in its `src/document/machine.ts`
  and nowhere else. Track level and master volume are smoothed per sample,
  in a way that does not depend on buffer size.
- The engine, not TypeScript, decides what plays at a bar line.
  `engine/src/sequencer.h` is pure and holds those rules: a cued pattern
  taking over at the bar line, A, AB and B, intro, tapped and automatic
  fill-ins, and songs. A machine only tells the engine what it asks for. An
  export of a song asks the engine which version each measure plays
  (`snare_song_patterns`) so it cannot disagree with what is heard.
- The page learns what played from the measure log, which the worklet drains
  after every render and never skips. A measure whose rhythm changed on its
  second beat is reported twice under one ordinal.
- In the desktop app the sound device's callback (`Renderer::fill`) is the
  only caller of `snare_engine_render`, and it allocates nothing, takes no
  lock and calls nothing else: its buffers are made before the stream
  starts, and what it leaves for others to read (`Meter`) is atomics.
  `tests/audio_thread.rs` counts heap calls around it; keep that passing.
  CPAL may call the stream's error callback on the audio thread too, so
  that sets a bit (`StreamNews`) and no more.
- Every other call to the engine there is made on one thread, `bridge.rs`'s.
  Tauri runs each command on a thread of its own, so a command hands its
  request to that thread and waits. Do not call the engine from a command.
- The stream is dropped before the engine it plays (`Output` holds them in
  that order). A device that changes its rate, or one that leaves, gets a
  new engine at the new rate and a `ready` report; the app keeps no copy of
  the beat, and the page tells the new engine again.
- A C ABI function the desktop app calls is declared in its `ffi.rs` as
  well. A command or a report that changes in `messages.ts` changes in
  `messages.rs` and its tests, and in the phone plug-in's
  `EngineCore/Messages.swift` and its tests.
- On iOS the render block of the plug-in's `AVAudioSourceNode` is the only
  caller of `snare_engine_render`. It captures a pointer and nothing Swift
  counts, and calls `bb_render_fill` in `EngineRender`, C that renders into
  the buffers it is handed, calls nothing else, takes no lock and allocates
  nothing (a mono buffer goes through scratch made with it). Keep the block
  that small. Every other call to the engine is made on the plug-in's
  `control` queue: Capacitor's calls, the phone's notices and the watch's
  timer all hop onto it.
- On iOS too the sound stops before the engine goes (`AudioOutput.stop`,
  then the renderer, then the engine), and a change of rate gets a new
  engine and a `ready` report. A call or another app taking the sound is
  reported as `ended`, so the page shows the machine stopped, and the new
  engine waits for play. Headphones pulled out stop the beat the same way.
- On Android the Oboe stream's data callback is the only caller of
  `snare_engine_render`, in `native_engine.cpp`, under the same rules: no
  lock, no allocation, scratch made with it, and only a flag set when Oboe
  closes the stream because its device left. Every other call is made on
  the plug-in's `control` thread. The plug-in asks for audio focus when
  play is pressed and gives it back when the beat stops or the page closes
  the engine, never when the engine is only made again. A notice from the
  phone (focus, becoming noisy) goes through `onControl`, which lets it go
  if the plug-in has already been destroyed: a closed screen's plug-in can
  still be told things while the process lives.
- The tools and tests must compile with Clang as well as GCC. CI builds both.
- `-ffp-contract=off` is deliberate: it keeps native and WASM renders within
  two 24-bit steps of each other, which a unit test asserts.

**The project and the machine**

- A voice's place in `VOICE_IDS` and in `data/ritm12.machine.json` is its
  sound number, its sound slot and, plus one, its engine track (the accent
  is track 0). Never reorder or reuse them.
- A step is on or off. Loudness comes from the accent row and the level
  knobs. There is no per-step velocity; do not bring it back as a
  convenience.
- Undo covers what the machine remembers (its `memory`: for РИТМ-12, the
  four patterns) and a whole-project import. Knobs, switches, tempo and the
  name are not undo steps. Notes tapped in one take of recording are one
  step.
- A change to the project schema needs a step in `parseProject` that brings
  an older project up to date and reports what was lost, and a fixture.
  `fixtures/four-patterns.project.json` is the current format; a unit test
  reads it and writes it back unchanged.
- A new project gets the starter patterns (`src/document/starter.ts`). They
  are written for boombapbot. Browser tests that need an empty pattern use
  В or Г.
- An invalid project import must never replace the current draft, and an
  unreadable saved draft is set aside, not deleted.

**Naming and art**

- The owner does not want manufacturer or product brand names in the app or
  its images. РИТМ-12 and the maker's name on its panel are invented.
- `misc/assets/` is git-ignored and is for the owner's unedited originals.
  Nothing from it may reach a production build or a commit.
- The header mascot (`packages/editor/src/assets/mascot.svg`) is the owner's
  artwork and is used unaltered. Its cream outline on the dark background is
  CSS, in `.sb-mascot`.

**Page layout**

- The machine's page is the header, the machine and the footer, nothing else.
  A control the machine has belongs on its panel. Anything else about the
  machine lives in the settings modal behind the footer's cog
  (`packages/editor/src/ui/Settings.tsx`).
- `Header` (the brand: mascot over the tagline, together as tall as the
  wordmark beside them) and
  `Footer` (About, Docs, manifesto, policies, upgrade, cart,
  settings, account) are shared. On the machine's page the header is the
  brand alone.
- On a phone (680px and under) both are arranged differently, in CSS alone.
  The machine's header is the mascot, a quarter larger, on the left and the
  wordmark, a tenth smaller, against the right edge, with no tagline. The
  footer is two rows: its eight names in words where a wider screen has
  icons (`.sb-footer-word`, in every footer link and in `ui/Modal.tsx`'s
  button), the pages and then the buttons, across the whole width; and
  under them "by mm.coffee" on the right, without "built with" and its
  heart. A count or a signed-in dot that rides an icon's corner follows
  the word instead.
- `SitePage` wraps a page of words; About, Docs, the manifesto and Policies
  are Astro pages in `apps/site/src/pages` that use it. There the
  header is a compact masthead (`.sb-masthead`: the mascot beside a small
  wordmark, with no tagline) and names the pages beside the brand
  (`ui/SiteNav.tsx`, with a lamp lit for the page that is open), so the
  page's own `h1` is the largest thing on it. The pages are listed once, in
  `ui/pages.ts`, for the masthead and the footer alike.
- A page of words is a title (its one `h1`, and a `.sb-lede` if it has one)
  and then `Section`s (`apps/site/src/components/Section.astro`). A section
  sets its heading in a rail beside its body on a wide screen and above it
  on a narrow one; `stacked` gives the body the whole width.
  `layout="note"` on `SitePage` is one narrow column, set larger and with no
  art: the manifesto. Words quoted from the machine's lettering go in
  `Lettering.astro`, which marks them as Russian.
- Their styles are the "Pages of words" part of the editor's `styles.css`.
  The two faces, PT Serif to read and Sofia Sans Condensed for headings, are
  pinned `@fontsource` packages loaded in `apps/site/src/styles/global.css`:
  the site serves them itself and loads nothing from another host. The
  colours taken from the machine's picture (`--ritm-*`) are for these pages
  only. The cream key (`.sb-key`, and `kbd`), the lamp and the outline
  (`.sb-plate`) are borrowed from the picture; do not add its art to the
  manifesto.
- About opens on the machine: what it is as the `h1`, the way in, and a
  still of the top of the panel with its screen lit. The stills are in
  `apps/site/src/assets/ritm12/` and the machine's `art/README.md` says how
  they were taken; take them again if the panel's art changes. The words on
  About are the owner's to edit.
- On the machine's page the footer sits 50px under the machine
  (`--footer-drop`, `.sb-below-machine`). On a page of words it follows the
  words, so a short page ends where its words do. Keep
  Policies true to what the site does: it covers accounts, saved beats and
  the shop, with the returns policy in the owner's words. Update it before
  the upgrade is sold.
  Every footer modal goes through `ui/Modal.tsx`.
- Each footer icon has a tip with its name (`ui/Tip.tsx`, Base UI's tooltip)
  and a move of its own when pointed at. The tip is for the eye only: the
  icon keeps its `aria-label`. The moves are CSS that picks shapes inside
  lucide's icons by their order, so look at all eight after changing an icon
  or upgrading `lucide-react`.
- The upgrade's modal is `ui/Upgrade.tsx` (see Upgrade below). While the
  server says it is closed, which the live site does, it says it is not open
  and offers no form; a browser test holds that. Which features are paid is
  not decided, so do not add a feature list or a promise to it, open or
  closed. The cart is the shop (`ui/Shop.tsx`); it shows products only when
  the server says the shop is open.
- The footer keeps whether the account modal is open, so that the upgrade's
  modal can close itself and send somebody there to log in.
- The cookie notice (`ui/CookieNotice.tsx`) is on the machine's page only and
  sits between the machine and the footer. It is taller than the gap there,
  so the footer sits lower until it is closed. Do not make it an overlay: it
  must never cover a control.
- What stays on the page with the machine: import and error notices, and on
  a phone the instrument strip, the fit button and the docked start button.
  Those three are now only for a small screen whose address asks for the
  picture: the phone's panel has keys of its own for all three and shows
  none of them.
- A panel's power switch makes everything else on it `inert`.
- Browser tests reach buried controls through `openSettings`
  (`e2e/helpers.ts`), and РИТМ-12 through `beat`, `step` and its test ids
  (`e2e/ritm12/helpers.ts`). The ones that need an account share
  `e2e/account.ts`.

**Accounts**

- The machine must work with no server at all. Most browser tests serve
  `apps/site/dist/client` as plain files to hold that; the account modal then
  says it cannot reach the server. Do not make the machine wait on a session.
- Every table has an integer `id`, used for joins, and a `uuid`. Only the
  uuid leaves the server: in a URL, an API answer or an email.
  `src/server/public-ids.ts` rewrites every Better Auth answer that way, and a
  browser test checks no row id gets out. New tables and endpoints follow it.
- The database and Better Auth are built on first use (`getDb`, `getAuth`),
  because Astro runs module top-level code at build time. Read secrets from
  `astro:env/server`, not `process.env`.
- Change the schema in `src/server/db/schema.ts`, then `pnpm db:generate`
  and commit the migration. `pnpm db:migrate` runs against the owner's
  database: ask first.
- `DATABASE_URL=pglite:memory` opens a Postgres inside the process, built
  from the committed migrations, and `EMAIL_OUTBOX` files mail in a folder
  in place of sending it. The accounts tests use both. `pglite:` and a
  folder keeps the database there; it notes in a `local_migrations` table
  which migrations it has had, so the folder can be opened again and gets
  only the new ones. A Vercel build leaves the in-process database out
  (`__LOCAL_DATABASE__`).
- Better Auth's rate limit counts in the database (`rateLimit` in the
  schema, the `rate_limits` table), never in memory: on Vercel each server
  would keep a count of its own. Asking who is logged in (`/get-session`)
  is left out of it on purpose, because every page asks that as it loads
  and a count would be a write to the database for each visitor. Only the
  browser tests switch the limit off (`AUTH_RATE_LIMIT=off`). Its own
  tests are in `e2e/accounts.spec.ts`, on a second server with the limits
  on and its database in a folder, so that one of them can stop the server
  and find the count still there. A request there says where it came from
  in `x-forwarded-for`, with addresses no other test uses.
- Sign-up always needs a confirmed address. Better Auth sends that email in
  the background, so a failed send does not fail the sign-up; the modal
  always offers to send it again. Keep that.
- An account is deleted from the modal with its password
  (`user.deleteUser` in `src/server/auth.ts`). The schema does the rest:
  sessions, the credential and saved beats cascade, and orders and licenses
  keep their rows with the user unset. A new table that hangs off a user has to choose
  one of those two on purpose. Both app stores require this button.
- Who is logged in is read by `signedInAccount` (`account/session.ts`),
  never straight from the session answer. A host with no account server can
  answer 200 at that address with its own page; whatever names no user is
  nobody logged in.

**Saved beats**

- Saving is something a person does: a button in the account modal sends the
  project, and a list there loads or deletes. There is no background sync.
  The browser's draft stays the working copy, and the page asks for no beats
  until the modal is open with someone logged in; a browser test holds that.
- The limits are two constants in `packages/contracts/src/beats.ts`:
  `FREE_BEAT_LIMIT` (20 beats) and `MAX_BEAT_BYTES` (64 KB of project JSON).
  The server enforces both and tells the page the limit with the list, so a
  paid tier changes them in one place.
- Every route under `api/beats` asks who is calling first (`signedIn`,
  `readBeatRequest` in `src/server/beats.ts`) and finds a row by its uuid
  and the caller's id together (`ownedBeat`). Somebody else's beat is
  answered exactly as one that does not exist.
- What is stored is what the build's project codec returns, never the body
  as it came, and only a beat the build's machine owns (`parseOwned`). A
  beat of the machine before it is never converted on the server. Only a
  page left open since the machine changed still sends one, and that page
  shows the message of a refusal it knows, so the answer is `invalid` with
  words telling the person to reload.
  The body is weighed first. One that is too large is still read to its end
  before the answer goes out, because answering early resets the connection.
- The conflict rule is `cloudCopyIsNewer`. A replace carries `lastSeen`, the
  time of the copy this device last loaded or saved; a newer row answers 409
  with its time, and only a replace sent again with `overwrite` writes over
  it. The page sets `overwrite` only after the person has said so. The
  server stamps `updatedAt` itself, always later than the copy it replaces.
- What a device last saw is kept in the browser beside the draft
  (`account/beat-links.ts`), by account and by project id. A save replaces
  the beat the project is linked to, and makes a new one otherwise.
- Loading goes through `EditorRuntime.loadSavedBeat`, which shares
  `adopt` with a file import: checked first, never replacing the draft with
  something invalid, and one undo step.
- A beat taken over from the earlier machine is a new beat. The codec marks
  it `adopted`, the runtime gives it a new id (a draft, a file and a saved
  beat alike), and `SavedBeats` does not link it to the beat it was loaded
  from. So saving it adds a beat, and the one stored before the machine
  changed is never written over. Stored beats are not migrated.
- On a page of words there is no machine, so the modal points back to it.
  `SavedBeats` reads the runtime from context for that reason; do not make
  it require one.

**Shop**

- `packages/contracts/data/shop.json` is the catalog: the products of the
  Printful store and the countries Printful delivers to. `pnpm shop:sync`
  writes it (read-only at Printful) and saves each picture under
  `apps/site/public/shop`; do not hand-edit it. The shop is closed while it
  has no products or countries, or the Stripe or Printful key is missing.
- The owner decided (2026-11-15): it ships anywhere Printful does, at
  Printful's live rate. So the address is taken in the modal, before
  payment: `/api/store/shipping` asks Printful for quotes, the buyer picks
  one, and Stripe only takes the money. Shipping quotes are asked by the
  blank garment's `catalogVariantId`; orders are placed by the sync
  variant's `id`.
- The page asks `/api/store/catalog` what is for sale. Checkout prices the
  cart from the same catalog and asks Printful for the shipping again. Never
  take a price from a request.
- Checkout records a pending order with its address and shipping method,
  then sends the buyer to Stripe. Only the
  signed Stripe webhook marks it paid and sends it to Printful
  (`server/shop/fulfil.ts`). Each step there can run twice without doing
  anything twice, and an error is meant to reach Stripe so it retries.
  Confirming a Printful order spends the owner's money: keep it behind the
  verified webhook.
- Printful does not sign webhooks. Its address carries
  `PRINTFUL_WEBHOOK_SECRET` as `?secret=`; keep the check.
  `pnpm shop:webhook --register` gives Printful that address. It changes the
  owner's Printful account, so ask first. The events it asks for and the
  ones the webhook acts on are one list,
  `apps/site/src/server/shop/printful-events.json`.
- `SHOP_CATALOG`, `STRIPE_API_URL` and `PRINTFUL_API_URL` exist for the
  browser tests, which run against `e2e/fake-shop-services.mjs`. Nothing else
  sets them.

**Upgrade**

- The owner decided: a flat one-time 5 dollars, a license key the buyer is
  given and can get back, no account needed to buy, and a license that
  outlives its account. The price and the shape of a key are in
  `packages/contracts/src/upgrade.ts`; the server is `src/server/upgrade.ts`
  and the routes under `api/upgrade`.
- This is the entitlement, not the gating. Nothing calls `isUpgraded` yet.
  The owner decided on 2026-11-18 that the upgrade unlocks extra effects:
  new ones, beside the four the machine has, which stay free as the modal
  promises. They are fully gated: someone who has not upgraded cannot hear
  them at all. They are six: a crusher (fewer bits and a lower sample
  rate), tape (saturation, a slow wobble and a duller top), a pump (a
  compressor that ducks everything under the kick), a filter (a resonant
  low-pass swept by the mix knob), vinyl (crackle and hiss) and a phaser.
  Where they sit on the machine is not decided, so do not tell a visitor
  what the upgrade unlocks until they can be reached there.
- It is closed until `UPGRADE_OPEN` is `on`, and without Stripe's key or the
  webhook's secret (`upgradeOpen`). Closed, checkout refuses. A payment
  already made is still honoured: the webhook does not ask whether it is
  open. Do not set the switch for the owner; the Policies page has to
  cover the upgrade before it is sold.
- A row in `licenses` is a license somebody paid for. Checkout records
  nothing; only the signed Stripe webhook makes a row (`issueLicense`).
  `stripe_session_id` is unique and the insert steps aside for a row that
  is already there, so one payment is one key however often, or however
  close together, Stripe reports it. Keep it one statement: the database
  driver on Vercel has no transactions.
- The key is emailed until one send has succeeded, and an error is meant
  to reach Stripe so it tries again. Two deliveries that cross can both
  send the email; they send the same key.
- A checkout says it is the upgrade in its metadata (`purpose`), and names
  the buyer's account by uuid when there is one. The webhook route sends a
  session to `issueLicense` or to the shop's `fulfil` on that alone.
- An account holds one license (`user_id` is unique) and a key goes onto
  one account. Someone who pays twice gets a second key on no account.
  `redeemKey` claims a free key in one statement.
- A server route asks `isUpgraded` (`src/server/session.ts`) about the
  account `resolveUser` gave it. It is a question of its own on purpose:
  `resolveUser` never reads `licenses`, so accounts, saved beats and the
  shop run the same whether or not that table exists yet. The page asks
  `GET /api/upgrade`, and only once the upgrade's modal is open. Like
  everything else, the machine must not wait on the answer.
- The modal never sells to someone who has just paid. Stripe's way back
  (`?upgrade=paid`) and its webhook arrive in either order, so until the
  server says the account is upgraded the modal thanks the buyer, hides the
  button and asks again every two seconds for half a minute. Opened from
  its icon it starts over. Entering a key needs an account, as the server
  does; whether a key alone should unlock a device is not decided.
- The words the modal uses while the upgrade is open, and the refusals it
  shows from `src/server/upgrade.ts`, are stand-ins for the owner to
  rewrite. The closed modal's words are the owner's and were not changed.
- Asking for a key by email (`remindKeys`) answers the same whether or not
  the address bought anything: the keys are looked up and sent after the
  answer (`afterResponse` in `src/server/site.ts`), never before it. A key
  is marked as sent before it goes, so each goes out once in ten minutes.
  The route is counted per address and per visitor (`mayRemindKeys`) in
  Better Auth's `rate_limits` table by `consumeRateLimit`
  (`src/server/rate-limit.ts`); a new counted route gets its rule in
  `SITE_RATE_RULES`, which Better Auth is given too so that it keeps the
  rows long enough. `AUTH_RATE_LIMIT=off`, which only the browser tests
  set, takes the limits and the ten-minute wait away.
- A saved beat is inserted and deleted only through `saveNewBeat` and
  `deleteBeat` (`src/server/beats.ts`), which keep `beat_counts` in step in
  the same statement. Anything else that adds or removes beats has to do
  the same, or the limit drifts.
- The tests keep the fake's upgrade checkouts in a log of their own
  (`/calls/upgrade`), so they and the shop's tests can run side by side.
  The modal's tests are in `e2e/upgrade.spec.ts` with the server's, in one
  worker, because they read the last checkout from that log.
  The closed switch is tested on a second server the spec starts itself
  (`startServer` in `e2e/second-server.ts`, which the accounts tests use too).

**Written copy**

- Everything a visitor reads (pages, modals, emails) is in the owner's voice:
  first person singular, true and plain. One person made this in their spare
  time. No "we", no mission statements, no marketing adjectives, nothing
  grandiose.
- The About page says who that person is, in their words. Do not add their
  name or other personal details beyond what they have offered.
- The manifesto (`manifesto.astro`) is the owner's own position. Do not
  soften it, extend it or add commitments to it unasked.

**Build output**

- These are generated and git-ignored; never commit them:
  `apps/site/public/engine/`, `public/machines/`,
  `public/boombapbot-assets.json`, `build/`, `.tools/`, an app's `public/`,
  and `apps/desktop/src-tauri/target/` and `gen/`. `Cargo.lock` there is
  committed.
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
  `renderLoop()` renders on the page what a WAV export renders in its Worker.
- `pnpm dev` serves the Astro dev server; the browser tests and `pnpm serve`
  use the production build, so run `pnpm build` before either.

## Not verified yet

The owner has listened to РИТМ-12 on a local build and said it sounds good,
and has since gone through its eight instruments and says they are all good;
nobody has said they went through its four effects one by one. On the live
site, `boombapbot.com`, the owner has used РИТМ-12 on an iPhone in Safari
and in Firefox, and saved a beat to an account from desktop Chrome and
loaded it in Firefox on the iPhone. Before that, while the site was an
earlier machine, they signed up and reset a password (the emails arrived and
their links worked) and bought a sticker: paid at Stripe, accepted from
Stripe's webhook, placed with Printful, and marked shipped with its tracking
number when Printful's own event arrived. Untested: Firefox and Safari on a
Mac, an Android phone on РИТМ-12, and Windows. Never tried there: deleting an
account or a saved beat, the newer-copy question, the beat limit, a beat
from the earlier machine opening converted, a refund, and a purchase without
an account.
Nobody has tried long playing on a phone.
The desktop app has run on one Mac, and what is known of its sound is the
engine's own numbers: nobody has listened to it. Its `README.md` lists the
rest: a real change of sound device, the dialog that asks where to keep an
export, and Windows. The phone app's native engine has run in an iPhone
simulator and an Android emulator only, and the same holds: no one has
listened, and no real call, headphones or change of device has happened
to it. The emulator's faked call is the one interruption that has.
Say so rather than assuming these work.

## Working in this repo

- Work goes on a feature branch and lands through a pull request. CI
  (`.github/workflows/ci.yml`) runs every check above, with the engine also
  built by Clang and under the sanitizers. It typechecks the desktop app's
  page and runs its unit tests with the rest. It does not build the app or
  run its Rust tests: run `test:engine` and `check:run` by hand after
  changing `apps/desktop/src-tauri` or the engine's C ABI.
- Production is deployed by `.github/workflows/deploy.yml` once CI passes on
  `main`: it builds the engine and the site and hands Vercel the finished
  output, because Vercel cannot build the engine. `apps/site/vercel.json`
  switches off Vercel's own build on push; do not turn it back on. The
  build reads none of the site's secrets; keep it that way. `engines` in
  `apps/site/package.json` is what sets the Node version on Vercel; the
  project's own setting there is ignored.
- Run the checks that cover what you changed before pushing, and report
  results as they are, including what you could not run.
- Keep `README.md` and `docs/follow-ups.md` in step with changes to scope,
  commands or what has been verified.
