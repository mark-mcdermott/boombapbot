# Follow-ups after v0.1

What v0.1 leaves for later, with the concrete prerequisites for each. Nothing
in this file has been built unless it says so.

## Native shells

All three shells reuse two things that exist today: the engine's C ABI
(`engine/include/boombapbot/engine.h`) and the shared editor
(`packages/editor`). The editor reaches audio only through
`AudioController` (`packages/editor/src/engine/audio-controller.ts`), whose
message set is `packages/editor/src/engine/messages.ts`. A native shell
replaces that one class with a bridge that sends the same messages to a
native engine instance.

### Capacitor (iOS and Android)

Prerequisites:

- Xcode with an Apple developer team, and Android Studio with the NDK. Neither
  is available on Linux CI for iOS; iOS needs a macOS runner.
- A Capacitor plugin (`apps/mobile`) exposing the `EngineCommand` messages.
  - iOS: `AVAudioEngine` with an `AVAudioSourceNode` whose render block calls
    `snare_engine_render`. Configure `AVAudioSession` for playback and handle
    interruptions and route changes by reopening at the new sample rate.
  - Android: Oboe with a C++ callback calling `snare_engine_render`; build the
    engine with the NDK from `engine/CMakeLists.txt`. Handle audio focus and
    device changes.
- Kit loading from the app bundle instead of `fetch`. `loadKit` already takes
  a `fetchBytes` function, so only that function changes.
- Position and stats reports throttled across the bridge. The worklet already
  reports at most once per step and ten times a second for stats.
- Decide draft storage: Web Storage inside the WebView is not durable enough
  on iOS. `draft-storage.ts` takes a `KeyValueStorage`, so a native-backed
  implementation can be dropped in.

Unverified: everything. No Capacitor project exists yet.

### Tauri (Windows and macOS)

Prerequisites:

- Rust toolchain, the Tauri CLI, and platform build tools (MSVC on Windows,
  Xcode command line tools on macOS).
- A Rust audio bridge (`apps/desktop`) that opens a CPAL output stream and
  calls the engine through the C ABI. Link `boombapbot_engine` as a static
  library built by CMake (the `cmake` crate or a build script).
- The engine's control functions are safe to call from one non-audio thread;
  the CPAL callback must be the only caller of `snare_engine_render`.
- Device change handling: recreate the engine at the new sample rate and
  re-commit the kit (kits are sample-rate independent; voices resample).
- Tauri commands mirroring `EngineCommand`, and events for position and stats.

Unverified: everything. No Tauri project exists yet.

### VST3

See [`plugins/vst3/README.md`](../plugins/vst3/README.md) for the state of
the compile spike. Beyond it:

- Choose a JUCE licence path before distributing anything (JUCE 8 is AGPLv3 or
  commercial). A public repository does not choose it.
- Windows and macOS builds, host scanning, the Steinberg validator, state
  recall in a host, transport sync (Host Sync mode) and offline bounce.
- Freeze plugin and parameter IDs before a public beta.
- A native JUCE editor sharing the panel manifests in
  `packages/contracts/data/panels`.

## Web

- **Deployment.** Vercel's build machines do not have Emscripten. Either build
  in GitHub Actions and deploy the prebuilt output, or install the pinned
  Emscripten in the Vercel build. The site builds with the Vercel adapter when
  `VERCEL` is set (`apps/site/astro.config.mjs`); that output was produced
  locally but never deployed.
- **Browsers.** Only headless Chromium was exercised. Firefox, Safari and real
  phones need a pass, in particular iOS Safari's audio unlock and the phone
  layout on small screens.
- **Export off the main thread.** A one-bar render takes a few milliseconds, so
  v0.1 renders on the main thread. Longer renders (arrangements, tails, stems)
  should move to a Worker; `renderLoop` has no DOM dependencies.
- **Draft storage.** One draft in `localStorage`. Multiple beats and offline
  kit caching want IndexedDB. Two tabs editing at once overwrite each other.
- **Stack items not used yet.** The build spec lists TanStack Query, Better
  Auth, Drizzle, Neon, Vercel Blob and Resend. v0.1 has no remote data, so none
  of them are installed. They arrive with the cloud API.
- **The other three machines.** The page offers the 808 alone. To bring one
  back, add it to `packages/contracts/data/offered-kits.json`: the kit picker
  returns in settings once there is a choice, its faceplate ships again, and
  the two skipped kit picker tests run. Each needs its panel finished first.
- **Editor choice.** The page always opens in Hardware mode. The choice of
  Modern is not saved with the draft, so a reload returns to the faceplate.
- **Kit switch preview.** Substituted voices are shown on the lane and in the
  kit note after switching. A preview before committing the switch is not
  built.

## Hardware mode

Each panel manifest carries a `pending` list of behaviour that has not been
checked against the machine's manual. The common gaps:

- Accent as its own track (606, 808) and total accent (909). v0.1 stores a
  velocity per step instead.
- Pattern write and play modes, tracks, pattern groups and banks, chaining.
- A/B and AB variation and first and second parts (808).
- Scale, pre-scale, last step, shuffle and flam.
- Instrument selection by holding a button and pressing a step key (707, 909).
- Voices with no v0.1 lane: mid tom, rim shot, cowbell, tambourine, ride, and
  the 808's congas, claves and maracas.
- Knob art: the tempo and instrument knobs are round crops of the faceplate
  that rotate. On the three photographs their rest angles are estimates, and
  lighting rotates with the crop; clean knob art there needs close-ups, as
  the build spec expects. The drawn 808 has neither problem.
- Faceplates: the 808 is a drawing made by `scripts/draw-faceplates.mjs`,
  tried first to see whether drawn panels are wanted. If they are, the 606,
  707 and 909 need the same, which removes the remaining photo credits. The
  three photographs are committed with their credits and provenance
  (`assets/faceplates/README.md`). The drawing's own licence is not chosen,
  and the manufacturer's rights in the look of the machines need advice
  before a public release, whichever kind of image ships.

## Product

Out of scope for v0.1 and not started: accounts, cloud library and sync,
conflict handling, user sample upload, the portable `.boombapbot` bundle with
bundled samples, song arrangement and multiple patterns, per-lane mixer and
effects, stems, paid effects and billing, signing, store submission, release
metrics.
