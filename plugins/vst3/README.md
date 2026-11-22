# boombapbot VST3 instrument

A first slice of boombapbot as a plugin: РИТМ-12's eight voices, played from
MIDI notes, with the machine's knobs as host parameters. It is a JUCE 8.0.9
VST3 instrument on the same engine the site, the phone apps and the desktop
app play through (`engine/`, built natively for
`packages/machine-ritm12`).

It is not a product build yet. See [Licensing](#licensing) before giving a
build to anyone, and [Not verified](#not-verified) for what nobody has checked.

## What it does

- An instrument with MIDI input and one stereo output. No audio input, no MIDI
  output.
- A note-on on any channel plays one hit of the voice that listens to it. The
  notes are the General MIDI ones in
  `packages/machine-ritm12/data/ritm12.machine.json`, which the editor's MIDI
  export writes too, so a file exported from the site plays the right voices.

  | Note | FL Studio calls it | Voice | Panel |
  | --- | --- | --- | --- |
  | 36 | C3 | Kick | БАС |
  | 37 | C#3 | Rim | РИМ |
  | 38 | D3 | Snare | МАЛЫЙ |
  | 39 | D#3 | Clap | ХЛОП |
  | 42 | F#3 | Closed hat | ХЭТ З |
  | 45 | A3 | Tom | ТОМ |
  | 46 | A#3 | Open hat | ХЭТ О |
  | 56 | G#4 | Perc | ПЕРК |

  The perc voice is on 56, General MIDI's cowbell: that is where the machine's
  own file puts it. FL Studio numbers note 36 as C3; hosts that call middle C
  "C4" call the same note C2. Every other note, note-offs and all other MIDI
  messages are ignored.
- The machine has two loudnesses, a plain hit and an accented one, so velocity
  picks one: 104 and above is an accented hit. That is halfway between the
  velocities the editor's MIDI export writes (81 and 127) with the accent knob
  where a new project has it. The accent knob itself is not a parameter yet.
- Hits land on the note's sample offset inside the block. The engine applies
  queued triggers at the start of a render call, so `processBlock` splits the
  block at each note-on and renders the pieces in turn.
- A closed hat cuts a ringing open hat, as on the machine: the two share a
  choke group.
- 35 host-automatable parameters (`AudioProcessorValueTreeState`), all from 0
  to 1 like the machine's knobs, resting where a new project has them:

  | Parameter | Ids | At rest |
  | --- | --- | --- |
  | Pitch, Tone, Decay for each voice | `kick_pitch`, `kick_tone`, `kick_decay`, … | 0.5 |
  | Level for each voice | `kick_level`, … | 0.75 |
  | Volume | `master_volume` | 0.8 |
  | Effect: Off, Delay, Reverb, Flanger, Chorus | `effect_kind` | Delay |
  | Effect Mix | `effect_mix` | 0 |

  The voice ids are `kick`, `snare`, `clap`, `closed_hat`, `open_hat`, `tom`,
  `rim` and `perc`. As on the machine, an effect with its mix at 0 is no
  effect, so a new instance is dry. Level and volume follow the machine's
  arithmetic (`src/document/machine.ts`): a level of 0 is silence, and volume
  is the knob to the power 1.5.
- State: every parameter, saved as one small versioned XML element
  (`<BoombapbotPluginState schemaVersion="1" machine="ritm12" kick_pitch="0.5" …/>`).
  A state that is not this plugin's, is for another machine or comes from a
  newer version is left unread. In one that is read, a value out of range is
  brought into it and a parameter it does not name goes to its resting value.
- The plugin window is JUCE's `GenericAudioProcessorEditor`: one slider for
  each parameter. A designed panel is a later slice.
- The delay keeps time with the host: its echo is a dotted eighth note at the
  host's tempo, read from the playhead at every block and held within the
  engine's 40 to 300. A host that reports no tempo gets 104, the tempo of a new
  project. The delay glides to a new time rather than jumping, and the tail the
  plugin reports grows as the tempo slows. Nothing else follows the host yet:
  the plugin does not read its transport or position.

### Threads

The engine's contract is that the audio thread renders and does nothing else
that could wait: no allocation, no locks. The plugin keeps to it this way.

- **Pitch, tone and decay** change the samples a voice plays, and synthesising
  them allocates. A thread of the plugin's own reads those parameters every
  15 ms and, when one has moved, synthesises the voice
  (`snare_engine_synth_sound`) and hands it to the engine, which takes it at
  the next buffer boundary. Hits already ringing finish on the old samples.
  It polls rather than being woken because a parameter listener can be called
  on the audio thread, where waking a thread is not allowed.
- **Level, volume, the effect and the tempo** are engine commands. The audio
  thread reads the parameters' atomics and the host's playhead at the start of
  each block and queues what has changed, along with the note triggers. The engine's command queue has one
  producer, and once the plugin is playing that is the audio thread alone.
- **An offline render** (`isNonRealtime()`) has no deadline, so `processBlock`
  brings the sounds up to date itself before it renders a block. A bounce
  therefore plays the knobs exactly as they stand at each block, and the same
  bounce twice gives the same samples.
- The engine is created in `prepareToPlay` at the host's sample rate, with
  every sound synthesised at that rate, and replaced if the rate changes.
  Outside the engine's 8 kHz to 192 kHz the plugin stays silent.

## Build

From the repository root, with CMake 3.22 or later and Ninja:

```sh
cmake -S plugins/vst3 -B build/vst3 -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build build/vst3
ctest --test-dir build/vst3 --output-on-failure
```

JUCE is fetched at configure time (`FetchContent`, tag 8.0.9) and is not
vendored. To build against a checkout you already have, add
`-DFETCHCONTENT_SOURCE_DIR_JUCE=/path/to/JUCE`.

The bundle is written to
`build/vst3/boombapbot_plugin_artefacts/Release/VST3/boombapbot.vst3`. The
build never copies it into a system plugin folder
(`COPY_PLUGIN_AFTER_BUILD FALSE`).

On macOS the build is universal, arm64 and x86_64, unless
`-DCMAKE_OSX_ARCHITECTURES=` says otherwise. FL Studio still runs under
Rosetta on Apple silicon, and an arm64-only build of the earlier spike made it
crash as it loaded the plugin.

JUCE signs the bundle and then writes `moduleinfo.json` into it, which leaves
the signature not matching the bundle. So the build signs it once more, ad
hoc, as its last step, and checks the result with
`codesign --verify --deep --strict`. An ad hoc signature loads on the Mac that
built it. It is not a Developer ID and the bundle is not notarised.

`-DBOOMBAPBOT_VST3_BUILD_TESTS=OFF` leaves the tests out.

### Trying it in a host

Copy the bundle into your own plugin folder and sign the copy again, since a
copy can pick up attributes that the signature does not cover. The second line
removes a bundle of the same name first, such as the earlier spike's: copying
over one would leave a mixture of the two.

```sh
mkdir -p ~/Library/Audio/Plug-Ins/VST3
rm -rf ~/Library/Audio/Plug-Ins/VST3/boombapbot.vst3
cp -R build/vst3/boombapbot_plugin_artefacts/Release/VST3/boombapbot.vst3 ~/Library/Audio/Plug-Ins/VST3/
codesign --force --deep --sign - ~/Library/Audio/Plug-Ins/VST3/boombapbot.vst3
codesign --verify --deep --strict --verbose=2 ~/Library/Audio/Plug-Ins/VST3/boombapbot.vst3
```

Then scan for plugins in the host. It is listed as "boombapbot", an instrument.

## Tests

`ctest` runs these. The first is the processor self-test
(`Tests/ProcessorSelfTest.cpp`), a console program that links the code the
plugin is made of and drives its `AudioProcessor` as a host would, without the
VST3 wrapper. At 44.1, 48 and 96 kHz, in blocks of 64 and 512 frames where
block size matters, it checks:

- no MIDI gives exact silence;
- a hit starts on its note's sample offset, two notes in one block each start
  on theirs, and the same notes render the same samples whatever the block
  size;
- every mapped note sounds, on any channel, and all 120 other notes, note-offs
  and velocity 0 give exact silence;
- velocity 104 is where the accent starts, and nothing else depends on
  velocity;
- a closed hat cuts an open hat;
- each of the 32 voice knobs alters its voice, a level of 0 silences it, and
  the kick's knobs leave the snare alone;
- a knob turned before `prepareToPlay` and one turned after come to the same
  samples, and a knob turned between two hits changes the second;
- volume scales the output as the machine's knob does and 0 is silence;
- each effect alters the output, no two effects sound the same, and an effect
  with no mix, or Off with some, leaves the output as it was;
- the delay's first echo lands a dotted eighth after the hit at host tempos of
  60, 120 and 174 and at 104 with no host clock; a clock with no tempo or a
  nonsense one is the same as none; a tempo outside 40 to 300 is held at the
  nearer end; the tempo changes nothing while no effect is mixed in; and the
  tempo jumping about while the delay rings keeps the output in range;
- on a realtime clock the plugin's own thread makes the new sound, and it is
  heard without the audio thread synthesising anything;
- a sample rate change, an unsupported rate, the parameter count, the tail and
  that the window opens;
- state: it is versioned, save → load → save is byte for byte the same with
  every knob somewhere awkward, the recalled plugin renders the same samples,
  eight kinds of bad state leave it untouched, and a state of ours that holds
  nonsense is brought into range;
- the plugin's voice table against `ritm12.machine.json`.

On macOS the rest check the built bundle:

- its signature (`codesign --verify --deep --strict`) and that it holds both
  architectures (`lipo -verify_arch`);
- that a process can load the binary and get a plugin factory from it
  (`Tests/BundleLoadCheck.cpp`);
- the plugin through its VST3 wrapper, in JUCE's own VST3 host
  (`Tests/BundleHostCheck.cpp`): the bundle scans as one instrument called
  boombapbot with no input and a stereo output, the host sees the 35
  parameters by name, it is silent without MIDI, note 36 plays the kick, a
  parameter the host sets reaches the sound, a second instance recalls the
  first one's state, and the delay follows the tempo the host reports.

On Apple silicon with Rosetta installed, the self-test, the load check and the
hosted check each run a second time as x86_64, which is how FL Studio runs the
plugin.

## Verified

On the owner's Mac (Apple silicon, macOS 26, Xcode's clang, CMake 4.4.3) on
2026-11-22:

- A configure and a Release build from an empty build directory, with JUCE
  8.0.9 from a local checkout.
- The binary holds both architectures (`lipo -archs`: `x86_64 arm64`).
- The bundle's signature verifies after the build, `moduleinfo.json` included
  (`codesign --verify --deep --strict`: valid on disk, satisfies its
  designated requirement).
- All eight CTest tests pass: the self-test's 355 checks as arm64 and again as
  x86_64 under Rosetta, the signature, the architectures, the load check on
  both and the hosted check on both.
- `/usr/bin/python3` loads the binary with `ctypes.CDLL` and gets a factory
  from `GetPluginFactory`, as arm64 and as x86_64.

The same build and tests also pass on GitHub's macOS 26 runner, which fetches
JUCE itself (the `vst3` job in `.github/workflows/native.yml`).

The earlier spike, on the old machine, loaded and played in FL Studio 2026 on
this Mac once it was universal and signed again. This plugin is built and
signed the same way, but see below.

## Not verified

- **No DAW has loaded this plugin.** Not FL Studio, not any other. Nobody has
  seen the window, turned a knob in a host, automated a parameter or saved and
  reopened a project with it.
- **Steinberg's validator has not run.** JUCE bundles the parts of the VST3
  SDK a plugin needs, and the validator is not among them. `pluginval` has not
  run either. The hosted check uses JUCE's host against JUCE's wrapper, which
  cannot catch a mistake both share.
- **Realtime safety is by design and by reading, not by instrument.** Nothing
  here traps an allocation or a lock on the audio thread, as the desktop app's
  Rust tests do.
- **How it sounds.** The tests compare samples; nobody has listened. A knob
  turned while its voice rings changes the next hit, not the ringing one, and
  nobody has judged how that feels under automation.
- **Windows and Linux.** The CMake project has nothing against them, but it
  has only ever been built on macOS, and CI builds it there alone. The bundle
  checks are macOS only.
- **An Intel Mac, and any macOS older than 26.** The x86_64 half has only run
  under Rosetta. The deployment target is 11.0 and untried.
- **Distribution:** no Developer ID signature, no notarisation, no installer.

## Next slices

- **The internal sequencer, in time with the host.** The engine has РИТМ-12's
  four patterns, swing and accents; the plugin does not use them. Playing one
  means following the host's transport and position, which the plugin does not
  read yet, and deciding where a pattern comes from while there is no panel to
  write one on: a beat saved from the site is the likely answer.
- **A designed panel** in place of the generic sliders.
- **What the machine has and the plugin does not yet:** the accent knob, mutes
  and swing.
- **Other formats and platforms:** AU, CLAP, Windows and Linux builds.

## Licensing

JUCE 8 is offered under the AGPLv3 or a commercial licence from its makers. A
plugin built with it can only be given to anyone else under one of the two:
either boombapbot's plugin source is published under the AGPLv3, or a JUCE
licence is bought. That choice has not been made. Until it is, builds are for
the machine that made them, and CI builds the plugin and throws it away. The
VST3 SDK that JUCE bundles has its own terms, which JUCE's
`modules/juce_audio_processors/format_types/VST3_SDK` spells out.
