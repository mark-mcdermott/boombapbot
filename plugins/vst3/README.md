# boombapbot VST3 compile spike

A minimal VST3 instrument that links the shared render engine (`engine/`) into a
JUCE plugin and plays the built-in 808 demo kit from MIDI notes. It exists to
prove the engine's C ABI works inside a plugin build. It is not a product.

## What it does

- Instrument with MIDI input and one stereo output. No audio input, no MIDI output.
- "MIDI Trigger" only: a note-on on any channel plays one hit of the matching
  role, with the note's velocity (1–127). Notes follow General MIDI, as in
  `packages/contracts/data/roles.json`:

  | Note | Role | Note | Role |
  | --- | --- | --- | --- |
  | 36 | kick | 45 | low tom |
  | 38 | snare | 50 | high tom |
  | 42 | closed hat | 39 | clap |
  | 46 | open hat | 49 | cymbal |

  Other notes, note-offs and all other MIDI messages are ignored.
- Hits land on the note's sample offset inside the block. The engine applies
  queued triggers at the start of a render call, so `processBlock` splits the
  block at each note-on and renders the pieces in turn.
- The eight WAVs of the 808 demo kit (`assets/kits/808/`) are compiled into the
  binary. Nothing is read from disk at runtime. Gain, pan and choke group are a
  small table in `Source/PluginProcessor.cpp` that mirrors
  `packages/contracts/data/kits/808.kit.json`; the manifest is the source of
  truth and the table has to be kept in step by hand.
- The engine is created in `prepareToPlay` at the host sample rate and replaced
  if the rate changes. Outside the engine's 8 kHz–192 kHz range the plugin
  stays silent.
- State is a small XML blob: `<BoombapbotPluginState schemaVersion="1" kitId="808"/>`.
- No editor (`hasEditor()` is false), no parameters, no internal sequencer, no
  host sync.

## Build

From the repository root:

```sh
cmake -S plugins/vst3 -B build/vst3 -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build/vst3
```

The bundle is written to
`build/vst3/boombapbot_plugin_artefacts/Release/VST3/boombapbot.vst3`. It is not
copied into a system plugin folder (`COPY_PLUGIN_AFTER_BUILD FALSE`).

The same build also produces the processor self-test (see [Self-test](#self-test)).
It compiles the JUCE modules a second time, which roughly doubles the build.
Pass `-DSNARE_VST3_BUILD_SELFTEST=OFF` at configure time to leave it out; the
plugin target is the same either way.

JUCE 8.0.9 is cloned from GitHub at configure time with CMake `FetchContent`. It
is not vendored in this repository. To use a local checkout instead, add
`-DFETCHCONTENT_SOURCE_DIR_JUCE=/path/to/JUCE`.

Needs CMake 3.22 or newer, a C++20 compiler, Ninja (or another generator) and
network access to github.com for the first configure.

### Linux packages

On Ubuntu 24.04:

```sh
apt-get install -y --no-install-recommends \
  pkg-config libx11-dev libxext-dev libxrandr-dev libxinerama-dev libxcursor-dev \
  libfreetype-dev libfontconfig-dev libasound2-dev libgl1-mesa-dev
```

`libxrender-dev` comes in as a dependency of the X11 packages. In this build no
compiled file included an ALSA or OpenGL header and the plugin does not link
either library, so `libasound2-dev` and `libgl1-mesa-dev` are probably not
needed. A build without them installed was not tried.

`JUCE_WEB_BROWSER=0` and `JUCE_USE_CURL=0` are set, so WebKitGTK, GTK and
libcurl development packages are not needed. Configure prints "not found" for
them and carries on.

## Self-test

`Tests/ProcessorSelfTest.cpp` is a console program that compiles
`Source/PluginProcessor.cpp` directly and drives the processor the way a host
would, block by block, without the VST3 wrapper. After the build above:

```sh
ctest --test-dir build/vst3 --output-on-failure
```

It prints one line per check and exits non-zero if any check fails. To see the
lines of a passing run, add `-V` or run
`build/vst3/boombapbot_plugin_selftest_artefacts/Release/boombapbot_plugin_selftest`.

Run at 44.1, 48 and 96 kHz, each with block sizes 64 and 512:

- No MIDI gives exact silence.
- A kick at frame 100 gives exact zeros before it and its first non-zero sample
  at frame 100 on both channels.
- A kick at frame 10 and a snare at frame 40 in the same block: the output is
  bit-identical to the kick alone up to frame 40 and first differs at frame 40.
  This is the block-splitting path.
- Each of the eight mapped notes makes sound, on a spread of MIDI channels. An
  unmapped note, a note-off and a note-on with velocity 0 give exact silence.
- A closed hat chokes a sounding open hat: 10 ms after the closed hat the
  output is bit-identical to the closed hat alone, and from 0.20 s to 0.30 s it
  is exact silence while an un-choked open hat is still sounding.

Run once:

- Re-preparing at a different sample rate still plays a hit on its frame, and
  a sample rate outside the engine's range gives silence.
- State is byte-for-byte identical after save, load, save. Garbage bytes, an
  empty block, XML of another type, a newer `schemaVersion` and an unknown kit
  id each leave the saved state unchanged, and the processor still plays
  afterwards. The kit id is the only stored value and only one kit exists, so
  these show that bad input does no damage. They cannot tell a rejected load
  from an accepted one that happens to carry the same kit id.

## Licensing

JUCE 8 is licensed under AGPLv3 or a commercial JUCE licence. This spike does
not choose between them. A licensing path has to be chosen before any binary
built from it is distributed. The VST3 SDK that ships inside JUCE has its own
terms, which also have to be checked at that point.

## Verified

On one machine: Ubuntu 24.04, x86_64, g++ 13.3, CMake 3.28, Ninja.

- Configure and a Release build succeed from an empty build directory.
  Configure took about 45 s including the JUCE clone. The build took about
  2 min 20 s on 4 cores with the self-test, and about 90 s for the plugin alone.
- The build produces `boombapbot.vst3/Contents/x86_64-linux/boombapbot.so`
  (about 10.8 MB, not stripped). It exports `GetPluginFactory`, `ModuleEntry`
  and `ModuleExit`, and contains the engine's `snare_engine_*` functions.
- JUCE's `juce_vst3_helper` loaded the built module and wrote
  `Contents/Resources/moduleinfo.json`, listing one Audio Module Class and one
  Component Controller Class with sub-categories `Instrument` and `Drum`.
- The plugin's sources and the self-test compile with no warnings under JUCE's
  recommended warning flags. `engine/tools/wav_io.h` gives two
  `-Wsign-conversion` warnings under those flags; that warning is switched off
  around that one include.
- The self-test passes: `ctest --test-dir build/vst3 --output-on-failure`
  reports 1 of 1 tests passed, 137 checks with none failed. What it checks is
  listed under [Self-test](#self-test).
- Configuring with `-DSNARE_VST3_BUILD_SELFTEST=OFF` works and leaves the
  self-test target out. Configuring with `-DFETCHCONTENT_SOURCE_DIR_JUCE`
  pointing at an existing JUCE 8.0.9 checkout works. Neither of those
  configurations was built.

## Not verified

- Windows and macOS builds. Nothing here has been configured or compiled on
  either.
- Loading or scanning in any host or DAW.
- The Steinberg VST3 validator.
- The audio path through the VST3 wrapper. The self-test calls the processor
  directly, so parameter, bus, MIDI and state handling inside JUCE's VST3
  wrapper are not exercised.
- State recall in a real host. The self-test round-trips the blob in process
  only.
- Transport sync. There is none: the spike has no sequencer and ignores the
  host's tempo and position.
- Automation. The plugin has no parameters.
- Real-time behaviour under a host: no measurement of CPU load, of dropouts, or
  of allocations on the audio thread. The code was written to avoid allocation,
  locks and file access in `processBlock`, and that was checked by reading it,
  not by a tool.
- Compilers other than g++ 13, and Debug builds.
