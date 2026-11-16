# boombapbot

A drums-only beat maker. This is **v0.1**: the web editor. The machine runs
entirely on your computer and needs no account. Accounts are optional and
are the only part with a server behind it.

![The page as it opens: the 808 panel playing the starter rhythm](docs/screenshots/hardware-808.jpg)

Open the editor and the page is a drum machine: the 808. Press its start
button and you hear a rhythm; pick an instrument with the selector, press step
buttons to write it, and work the knobs and switches on the faceplate. The
mode selector turns the same sixteen buttons into the choice of rhythm.
Everything else is behind the cog in the footer: the beat's name, undo, and
export as WAV, MIDI or a project file. Reload and your beat is still there.

It is the whole machine as its operation manual describes it: its sixteen
sounds, twelve tracks and accent, every knob and switch, its pattern memory
with the write modes, manual play with intros and fill-ins, and its twelve
rhythm tracks. Only what a browser cannot do is left out. It was built from
the manual, not from a machine, and [The machine](#the-machine) says where
it guesses.

The 808 panel above is original artwork, drawn in code by
[`scripts/draw-faceplates.mjs`](scripts/draw-faceplates.mjs).

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
- The machine reads no environment variables and makes no network requests
  beyond its own files. Accounts need a few; see [Accounts](#accounts).

To try the production build instead:

```bash
pnpm build
```

```bash
pnpm serve
```

## What v0.1 does

- **A page that is just the machine.** The brand along the top, the drum
  machine, and a footer 50px under it. The footer's icons lead to the About,
  Docs, manifesto, Credits and Policies pages and open modals for upgrades,
  the cart, settings and your account; each shows its name when pointed at.
  Settings holds the beat name, undo and redo, a reset to the
  starter rhythms, a clear action, import and export, and the save and audio
  status. The upgrade is not built: its modal says so. The cart is a shop
  that is built but not open (see [Shop](#shop)).
- **Accounts, if you want one.** The account button opens a modal to make an
  account, confirm the address from an emailed link, log in and out, and
  reset a forgotten password. An account does nothing else yet.
- **One machine.** Only the 808 is built. The other three machines are drawn
  for the header but are not shown for now.
- **Every control on the faceplate works**, the power switch included: off,
  the machine stops, its lamps go dark and nothing else on it answers. Knobs
  that turn freely are dragged up and down; dials with fixed positions turn
  to wherever you press or drag around them, and their labels can be pressed
  too.
- **About and Docs** are pages of their own on the same Astro site, with the
  same header and footer. Docs goes through every control. Credits is a
  blank page for now.
- **The 808's sounds, synthesised.** All sixteen: bass drum, snare, three
  toms and three congas, rim shot and claves, hand clap and maracas, cowbell,
  cymbal, open and closed hi-hat. The engine builds each one from its knob
  settings, so the tone, decay, tuning and snappy knobs on the faceplate
  re-synthesise their own sound as they turn, and the five voice switches
  put a conga, the claves or the maracas in place of a tom, the rim shot or
  the clap. It is a model made by ear, not a recording and not checked
  against hardware. See [Sounds](#sounds-provenance).
- **Thirty-two patterns to write.** The sixteen step buttons choose twelve
  Basic Rhythms and four Intro/Fill-ins, each with an A and a B version. A
  rhythm has a 1st and a 2nd part of up to sixteen steps each, and a
  pre-scale of three, four, six or eight steps to the beat. They are written
  as the manual describes: the mode selector, CLEAR, the pre-scale switch and
  the step buttons, or TAP in time with the rhythm.
- **Manual play.** Choose a Basic Rhythm and it flashes; start, and it
  plays. Choose another and it takes over at the bar line, or on the second
  beat if you chose it during the first. The variation lever plays version A,
  version B or the two in turn. TAP makes the selected Intro/Fill-in the
  intro, or drops it in after the measure that is running, once; the auto
  fill-in selector does that every 2, 4, 8, 12 or 16 measures. All of it is
  decided inside the engine at the bar line, on the audio clock.
- **Starter rhythms.** A new machine remembers eight Basic Rhythms, a ninth
  that plays every sound at once for setting levels, four Intro/Fill-ins,
  each in an A and a B version, and one rhythm track that strings them
  together. They were written for boombapbot and are not the hardware's
  factory rhythms. Basic Rhythms 9 to 11 are empty, and settings can put the
  starter set back.
- **Rhythm tracks.** In compose, the instrument selector chooses one of
  twelve tracks and every measure you play is remembered: which rhythm, not
  which version, so the variation levers still work on playback. Stop, and
  the measure you stopped in is the last. Play replays the track and starts
  over. A track holds 64 measures and runs on into the next. A take is one
  step to undo.
- **Twelve tracks, steps that are on or off, and an accent.** The instrument
  selector has its twelve positions: the accent and eleven instruments. A
  step is on or off; an accented step makes every instrument sounding on it
  louder, by as much as the accent's level knob says. Each instrument has a
  level knob, and master volume sits after everything. A track has one
  voice, as on the machine, and the two hi-hats cut each other off.
- **One engine everywhere.** A C++20 drum machine core (`engine/`) with a C
  ABI: a bank of 32 one-measure patterns of up to 32 steps at three, four,
  six or eight steps to the beat, a sequencer that picks the pattern for each
  measure, a fixed pool of voices with deterministic stealing, and step times
  computed from the audio sample clock on a 24-ticks-per-beat timeline. The browser runs its WebAssembly build inside
  an AudioWorklet; export uses a second instance of the same engine. There is
  no separate JavaScript engine.
- **Saving.** The project is saved to this browser on every edit and restored
  on reload. A draft that fails validation is set aside, not deleted. A draft
  or file from the earlier one-pattern version is brought up to date: its
  pattern becomes Basic Rhythm 1, and the page says what could not come with
  it (per-step velocity and swing, which the machine does not have).
- **Import and export.** Project JSON (validated with Zod; an invalid file is
  rejected and never replaces the current beat), PCM WAV (24 or 16-bit
  stereo, 44.1 kHz) and a Type 1 Standard MIDI File with a tempo track and
  General MIDI drum notes on channel 10. What they hold follows the panel:
  the selected rhythm as a seamless loop (A then B with the lever on AB), or,
  with the mode selector on play or compose, the rhythm track.

![Settings open over the 808 panel](docs/screenshots/settings.jpg)

## The machine

What the build does, against the operation manual:

| Part of the machine | State |
| --- | --- |
| Sixteen sounds from their tone, decay, tuning and snappy knobs | Modelled by ear |
| Twelve-position instrument selector, sixteen step buttons and lamps, start/stop | Working |
| Accent track and its level knob | Working |
| Tempo, 40 to 300: a knob with 40 click stops, and a fine knob | Working |
| Eleven level knobs and master volume | Working; how far each reaches is a guess |
| The five voice switches (congas, claves, maracas) | Working |
| Sixteen rhythms, each with an A and a B version, chosen with the step buttons | Working |
| Pattern clear, and the 1st and 2nd part write modes | Working |
| CLEAR: wipe a rhythm, store the pre-scale, set the last step of a part | Working; CLEAR is a latch here, not a button to hold |
| Pre-scale switch: 3, 6, 4 or 8 steps to the beat | Working |
| TAP: write the selected instrument in time | Working, to the nearest step as the page sees it |
| Manual play: a rhythm chosen while another plays takes over at the bar line, or on the second beat if chosen during the first | Working |
| A, AB and B: the AB position plays the two versions in turn | Working, in the write modes too |
| Intro and fill-in with TAP, and the auto fill-in selector (every 2, 4, 8, 12 or 16 measures) | Working |
| Rhythm tracks: compose records the rhythm of every measure into the track the selector is on, and CLEAR empties it | Working |
| Play: the track replays with the variation switches as they stand, and starts over at its end | Working |
| Twelve tracks of 64 measures, running on into the next when full, 768 in all | Working |
| Composing over a written track | Working as far as the manual describes it; the details are an interpretation |
| DIN sync, trigger outputs, separate outputs, pedals | Left out: a browser cannot do them |

Settings lists the same gaps under "what still needs checking", and
[`docs/follow-ups.md`](docs/follow-ups.md) has the order they are being done
in.

## Accounts

Accounts follow the same pattern as the owner's other apps: Better Auth with
email and password, Neon Postgres through Drizzle, and Resend for email. The
pages are still prerendered; only `/api/auth/*` runs on a server.

Copy `apps/site/.env.example` to `apps/site/.env` and fill in the first five
values. Then create the tables:

```bash
pnpm db:migrate
```

- To try accounts with no database and no email provider, set
  `DATABASE_URL=pglite:memory` and `EMAIL_OUTBOX=./.data/outbox`. The database
  then lives inside the server process and each email is written to that
  folder as a file.
- `pnpm build` makes the static pages in `apps/site/dist/client` and a Node
  server in `apps/site/dist/server`. `pnpm serve` serves the pages alone;
  `node apps/site/dist/server/entry.mjs` serves them with the API. On Vercel
  the build uses Vercel's adapter instead.
- Every table has an integer `id` and a `uuid`. Only the uuid ever leaves
  the server.
- After changing `apps/site/src/server/db/schema.ts`, run `pnpm db:generate`
  and commit the new migration.

What has been checked: the whole flow in a browser against the built server
with the in-process database and the outbox, and that the built server
reads from the real Neon database once it is migrated. What has not: a real
sign-up, real delivery through Resend, and a deployment.

## Shop

The cart button opens the shop: what is for sale and a cart kept in the
browser. Checking out asks where the order is going, gets the shipping price
for that address from Printful, and then goes to Stripe Checkout to pay.
When Stripe says an order is paid, the site sends it to Printful to be
printed and posted. It ships wherever Printful does.

- `pnpm shop:sync` reads the Printful store's products, and the countries
  Printful delivers to, into `packages/contracts/data/shop.json` and saves
  the product pictures. It only reads. Commit what it writes.
- The shop opens when the catalog has a product and both `STRIPE_SECRET_KEY`
  and `PRINTFUL_API_KEY` are set. Until then the modal says it is not open.
- Orders live in an `orders` table (`apps/site/drizzle/0001_orders.sql`).
- Two webhooks have to be registered before it opens: Stripe's, to
  `/api/webhooks/stripe`, and Printful's, to
  `/api/webhooks/printful?secret=...`.
- Printful's can only be set through its API. `pnpm shop:webhook` shows what
  Printful has now and changes nothing; `pnpm shop:webhook --register` points
  it at the live site, after checking that the site takes the secret in
  `apps/site/.env`. It never prints the secret.

What has been checked: `pnpm shop:sync` and shipping quotes against the real
Printful store, and the whole purchase in a browser against the built server
with a stand-in for Stripe and Printful (`e2e/fake-shop-services.mjs`). What
has not: a real Stripe checkout, a real Printful order, either real webhook,
and sales tax. `pnpm shop:webhook` has only run against a stand-in, and the
shop has never been open on the live site.

## Tests

Run in this order; later steps use what earlier ones build.

| Command | What it checks |
| --- | --- |
| `pnpm kits:check` | The committed demo WAVs match their generator script |
| `pnpm faceplates:check` | The committed faceplate drawing matches its generator script, and carries no brand names |
| `pnpm build:engine` | Builds the native engine and runs CTest: the tick timeline, scheduler timing across buffer sizes and pre-scales, ten minutes without drift, the pattern bank and its 1st and 2nd parts, the sequencer (A, AB and B, intro, tapped and automatic fill-ins, the first-beat rule, songs and the measure log), accent and level smoothing, voices and stealing, hat chokes, MIDI, every synthesised sound across its knobs, the contract files, no allocation inside the render call, and the header compiling as C |
| `pnpm build:wasm` | Builds the engine to WebAssembly |
| `pnpm typecheck` | TypeScript across packages, tests and the Astro site |
| `pnpm test:unit` | Vitest against the WASM build: the project schema and the move from version 1, the project-to-engine mapping, native versus WASM output for six rhythms of the fixture and for each synthesised sound, byte-identical MIDI from both builds, the engine's export list against its header and the TypeScript bridge, WAV and MIDI contents, import, draft recovery, store |
| `pnpm build` | Production Astro build, then `scripts/check-build.mjs`: the worklet and the engine resolve in the built site, the engine needs no shared memory, no sample files ship, and only the committed faceplate is included |
| `pnpm test:e2e` | Playwright against the production build in headless Chromium: the page layout and settings sheet, every selector position, knob and switch, the write modes, manual play with intros and fill-ins, composing, playing, editing and exporting rhythm tracks, the power switch, dials and cursors, the header and footer, the modals, the About and Docs pages, lamps, keyboard, touch layout, playback activation, reload, a draft from the earlier version, downloads, import rejection, accessibility scan |

`pnpm test` runs the engine, unit and browser suites after a build.
`.github/workflows/ci.yml` runs the whole list on every push and pull request.

### Results

Run on macOS 26.6 on Apple silicon with Apple clang 21, Node 22.23.4,
Emscripten 6.0.13 and headless Chromium via Playwright 1.63.

| Step | Result |
| --- | --- |
| `pnpm kits:check` | 24 of 24 files match |
| `pnpm faceplates:check` | 1 of 1 drawing matches |
| `pnpm build:engine` | 12 CTest suites, all pass with Apple clang 21, and under AddressSanitizer and UndefinedBehaviorSanitizer |
| `pnpm build:wasm` | 63,297-byte module, one import, no threads or shared memory |
| `pnpm typecheck` | 0 errors |
| `pnpm test:unit` | 120 of 120 pass |
| `pnpm build` | Build check passes |
| `pnpm test:e2e` | 63 of 63 pass |
| VST3 spike (`cmake`, then `ctest --test-dir build/vst3`) | Builds on macOS for Apple silicon; processor self-test passes 179 of 179 checks |

Earlier versions of this build were also run on Linux x86-64 with GCC 13 and
Clang 18. This version has not been: CI covers both compilers, and has not run
on it yet.

Two cross-checks worth knowing about:

- **Native versus WASM.** For six rhythms of the shared fixture, at four
  pre-scales and with a 2nd part, event frames are identical, audio agrees to
  within two 24-bit steps and the MIDI files are the same byte for byte. Each
  synthesised sound agrees to within one 24-bit step. The remaining
  difference is the last bit of `exp`, `tanh`, `sin` and `cos` between the
  native C library and the WASM one.
- **Buffer size.** Output is bit-identical whether rendered in one call, one
  frame at a time, or in blocks of 17, 64, 128, 441, 1024 or 4096 frames.

### What was not verified

- **Listening.** The owner has heard an earlier build; nobody has listened
  to this one closely, and nobody has compared it with a real machine. Audio
  is checked numerically: the worklet reports nonzero output, exported WAVs
  contain audio at the right length, and native and WASM renders agree. How
  the sounds, the accent and the knobs feel needs ears.
- **The GitHub Actions workflow** has not run on GitHub. Every command in it
  was run locally from a fresh clone.
- **Browsers other than headless Chromium.** Firefox, Safari and iOS have not
  been tried. The phone layout was checked in Chromium's device emulation,
  not on a phone.
- **Deployment.** `.github/workflows/deploy.yml` builds the site and hands it
  to Vercel after CI passes on `main`. It ran for the first time on
  2026-11-16, and the live site was checked by hand afterwards: the machine
  plays, the pages load and the server answers. A real sign-up, a real order
  and both webhooks have not been tried there.
- **Hardware behaviour.** The panel follows the operation manual, read from
  a scan. Nothing has been checked against a machine. Settings lists what is
  not modelled yet.
- **Device performance.** See the benchmark below; it says nothing about
  phones.

To reproduce the audio check by hand: `pnpm dev`, then press the panel's
start button.

### Engine load

`pnpm bench` renders a worst case through the WASM engine: every track on
every step of a 32-step measure of thirty-second notes at 300 BPM, with every
decay knob fully right, in 128-frame blocks. On the machine above that ran
about 200 times faster than real time, with the slowest block taking 0.3 ms
of its 2.67 ms budget and output bounded. A track has one voice, so the pool
of 64 is never full in normal use. This is a desktop number.

## Sounds: provenance

The 808's sounds are synthesised by the engine itself, in
[`engine/src/synth808.cpp`](engine/src/synth808.cpp): decaying tuned
oscillators, filtered noise and six square waves for the metallic voices,
each built from its knob settings. It is a model made by ear. It has not been
compared with a real machine, and nothing in it is sampled. The browser
synthesises each sound on its main thread at the device's sample rate and
hands the samples to the audio thread; no sound files ship.

`assets/kits/` still holds generated sample kits for the 606, 707 and 909,
made by [`scripts/gen_demo_kits.py`](scripts/gen_demo_kits.py) from
oscillators and seeded noise. The editor does not load them at the moment;
they are kept, with their check, for when those machines come back. Details:
[`assets/kits/README.md`](assets/kits/README.md).

## The faceplate

The panel puts step buttons, lamps, the instrument selector, start/stop, the
knobs and the voice switches where they are on the machine. The layout comes from the manifest
in `packages/contracts/data/panels/808.panel.json`. State, keyboard and
accessibility do not depend on the picture: if the image fails to load, the
panel is drawn from the same layout.

A faceplate image ships only once it is cleared. There are two places an
image can live:

- **`assets/faceplates/`** holds cleared images. They are committed, and each
  has a provenance entry in
  [`assets/faceplates/README.md`](assets/faceplates/README.md). The 808 is
  original artwork drawn by `scripts/draw-faceplates.mjs` from the panel's
  own layout, so it needs no credit. The folder also keeps the owner's edits
  of Creative Commons photographs of the 606, 707 and 909, with the brand
  names removed, for when those machines come back. No build ships them.
- **`misc/assets/`** holds the owner's unedited originals. It is ignored by
  git. `pnpm dev` uses what it finds there; `pnpm build` never does.

A photograph would need its author, source and licence shown under it, and
`check-build` fails a build that ships one without a credit and a provenance
entry. A drawing avoids the photograph's copyright and credit; it does not
settle the manufacturer's rights in the look of the machine.

On a phone, where the faceplate's own selector is too small to tap, an
instrument strip and a fit-to-screen button sit under the panel, and start
and the tempo are docked at the bottom of the screen.

## Layout

| Path | Contents |
| --- | --- |
| `engine/` | C++20 core, C ABI, WASM target, CTest suites, `boombapbot-render` tool |
| `packages/contracts/` | Zod project schema, the machine's tracks and sounds, panel geometry, shared fixtures |
| `packages/editor/` | React editor, AudioWorklet bridge, exporters, local draft |
| `apps/site/` | Astro site: the machine as a client-only island, and the About and Docs pages |
| `assets/kits/` | Generated sample kits for the 606, 707 and 909, not loaded at the moment |
| `assets/faceplates/` | Cleared faceplate images, drawn or photographed, and their provenance |
| `plugins/vst3/` | JUCE VST3 compile spike, outside the web build |
| `e2e/` | Playwright tests |
| `scripts/` | Toolchain setup, builds, asset preparation, build check, benchmark |
| `misc/assets/` | The owner's unedited faceplate originals (ignored by git) |

## File formats

- **Project JSON** (`.boombapbot.json`, `format: "boombapbot.project"`,
  `schemaVersion: 2`): everything the machine remembers. Tempo as the knob's
  click stop and a fine adjustment; every knob and voice switch; sixteen
  rhythms, each with a pre-scale, the lengths of its 1st and 2nd part, and an
  A and a B version of twelve tracks of 32 steps; twelve rhythm tracks; and
  where the panel's switches stand. Version 1 files (one 16-step pattern with
  velocities and swing) still open, as Basic Rhythm 1. This is the draft and
  interchange file. It is **not** the future portable `.boombapbot` bundle.
- **WAV**: the selected rhythm as a loop, rendered as the second of two
  passes so tails wrap into the start: one measure, or A then B with the
  lever on AB. With the mode selector on play or compose it is the rhythm
  track instead, played once from silence with three seconds for the last
  hits to ring. A track longer than five minutes is cut at a whole measure,
  and the page says so; the MIDI export holds all of it.
- **MIDI**: Type 1, 480 PPQ, a tempo track and a drum track on channel 10.
  Notes are placed on the same tick timeline the audio scheduler uses, 20
  MIDI ticks to an engine tick, so they cannot drift apart. An accented step
  is written at a higher velocity. It holds the same measures as the WAV, and
  the engine itself says which version each measure of a track plays.

## VST3 compile spike

`plugins/vst3/` is a small JUCE VST3 instrument that links the same engine,
synthesises the 808's sounds at the host's sample rate and plays them from
MIDI notes, placing each hit on its sample offset inside the block. It is a
separate CMake project and is not part of the web build. JUCE 8.0.9 is
fetched at configure time, not vendored.

```bash
cmake -S plugins/vst3 -B build/vst3 -G Ninja -DCMAKE_BUILD_TYPE=Release
```

```bash
cmake --build build/vst3
```

```bash
ctest --test-dir build/vst3 --output-on-failure
```

On macOS this compiles and produces an Apple silicon `.vst3` bundle that
exports the VST3 entry points and contains the engine, and the processor
self-test passes. That is all it shows. An earlier version was built the same
way on Linux; this one has not been. **Scanning in a host, the Steinberg validator, transport sync and
state recall in a host are all pending**, as is a Windows build. JUCE 8 is
AGPLv3 or commercial, and a licence path has to be chosen before anything
built from it is distributed. Details and the full not-verified list:
[`plugins/vst3/README.md`](plugins/vst3/README.md).

## Next milestone

In the build spec's sequence, v0.1 covers the web half of "prove the platform
stack" and most of "build one end-to-end beat". Next:

1. Have a person listen to it, on a desktop and a phone, beside a real
   machine if one can be found, and fix what they hear. What the build
   guesses at is listed in [`docs/follow-ups.md`](docs/follow-ups.md).
2. Boot the same engine natively: Tauri with CPAL on desktop, Capacitor with
   AVAudioEngine and Oboe on mobile, and the VST3 in a real host on Windows
   and macOS.
3. Bring back the 606, 707 and 909, each with its own sounds and panel.

Cloud sync, billing, signing and store submission come after that.
