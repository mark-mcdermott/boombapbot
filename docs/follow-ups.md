# Follow-ups after v0.1

What v0.1 leaves for later, with the concrete prerequisites for each. Nothing
in this file has been built unless it says so.

## Finishing the machine

The editor is being brought up to the whole 808, from its operation manual.
The engine and the project file already hold the pattern bank, 1st and 2nd
parts, pre-scale, accent, levels, voice switches and rhythm tracks. What is
left, in the order it is being done:

1. **Manual play.** Rhythm selection that waits for the bar line (and the
   first-beat rule), the A/AB/B switch, intro and fill-in by tap, and auto
   fill-in every 2 to 16 measures. The engine takes over every decision made
   at a bar line, in a `sequencer.h` beside `timeline.h`, and reports a log of
   the measures it played. Until then `snare_engine_cue_pattern` switches
   pattern at the bar line and nothing more.
2. **Rhythm tracks.** Compose, play and edit, twelve tracks of 64 measures
   chained up to 768, and export of a whole track.
3. **Starter rhythms**, screenshots and a last pass over these documents.

Left out for good, because a browser cannot do them: DIN sync, trigger
outputs, separate instrument outputs, pedal jacks and memory protection.

Not settled by any of that:

- **How it sounds.** `engine/src/synth808.cpp` is a model made by ear. It
  needs a listen beside a real machine, voice by voice and knob by knob.
- **CLEAR as a latch.** On the machine CLEAR is held while a step button is
  pressed. A mouse has one pointer, so here CLEAR stays down until a step is
  pressed, or until it or Escape is pressed. Whether CLEAR also resets a
  rhythm's stored pre-scale is not in the manual; here it does not.
- **TAP timing.** A tap lands on the step the page last heard about, or the
  next once that step is half over. The page learns of steps a little after
  the engine plays them and before they are heard, so a tap can land a step
  out at fast tempos. Placing it in the engine would be exact.
- **Lamp behaviour.** The manual describes the lamps in each mode in words.
  What they do on the hardware in the corner cases is unverified.
- **The level model.** How far the level and accent knobs reach, and the taper
  of each, are guesses (`packages/contracts/src/machine.ts`).

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
- Sounds need no files: the engine synthesises them
  (`snare_engine_synth_sound`), so a native shell can call that at the
  device's sample rate instead of receiving PCM over the bridge.
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
- Device change handling: recreate the engine at the new sample rate and load
  the project into it again, which re-synthesises the sounds at that rate.
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
- The voice switches, knobs and pattern memory as plugin parameters and state.
- A native JUCE editor sharing the panel manifest in
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
- **Work on the main thread.** A one-measure render and the synthesis of a
  sound each take a few milliseconds, so both happen on the main thread. The
  worst sound measured, a cymbal at its longest, took about 7 ms. A whole
  rhythm track is longer and should render in a Worker; `renderLoop` has no
  DOM dependencies.
- **Draft storage.** One draft in `localStorage`, written whole on every
  change, knob moves included. Multiple projects want IndexedDB. Two tabs
  editing at once overwrite each other.
- **Stack items not used yet.** The build spec lists TanStack Query, Better
  Auth, Drizzle, Neon, Vercel Blob and Resend. v0.1 has no remote data, so none
  of them are installed. They arrive with the cloud API.
- **The other three machines.** The 606, 707 and 909 are out of the editor.
  Their generated sample kits and faceplate photographs are still in
  `assets/`, with provenance. Each needs what the 808 now has: a track table,
  a sound source, a panel manifest and its manual worked through.
- **A grid view.** The earlier build had a second editor showing every track
  at once. It was removed so that the panel is the whole machine; one may
  come back as a view of the same project.
- **Faceplates.** The 808 is a drawing made by `scripts/draw-faceplates.mjs`.
  Its own licence is not chosen, and the manufacturer's rights in the look of
  the machine need advice before a public release.

## Product

Out of scope for v0.1 and not started: accounts, cloud library and sync,
conflict handling, user sample upload, the portable `.boombapbot` bundle with
bundled samples, a mixer and effects beyond the machine's own knobs, stems,
paid effects and billing, signing, store submission, release metrics.
