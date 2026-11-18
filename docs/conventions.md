# boombapbot

A drums-only beat maker. This repo holds v0.1: a web editor that is one drum
machine, the 808, running entirely locally, plus a VST3 compile spike. It is
being brought up to the whole machine from its operation manual; `README.md`
says what is modelled so far and how it was verified, and
`docs/follow-ups.md` has what is left and in what order. Accounts exist and
are optional: sign-up, log-in and password reset, and a free account can
hold up to 20 saved beats. The rest of the build spec's wider scope
(background sync, native shells, billing) is not started.

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
  `realtime`, `synth`, `swing`, `fx`, and `test_ritm12_voices`).
- One Vitest file: `pnpm exec vitest run packages/machine-808/test/engine.test.ts`.
- One Playwright file: `pnpm exec playwright test e2e/hardware.spec.ts`.
- VST3 spike: `cmake -S plugins/vst3 -B build/vst3 -G Ninja`, then
  `cmake --build build/vst3`, then `ctest --test-dir build/vst3`.

## How it fits together

- `engine/` is the only audio engine: a C++20 drum machine core behind a C
  ABI (`engine/include/boombapbot/engine.h`). It holds a bank of 32 patterns,
  twelve tracks (the accent and up to eleven instruments), sixteen sound
  slots and a mix bus, with swing by pattern, one effect on the mix and an
  output level for a meter. It builds natively and to WebAssembly from the
  same sources. Do not add a second engine in JavaScript, even to work
  around a failing WASM build.
- A machine is one package, and the rest is core that knows no machine.
  `packages/machine-808/` is the 808: its project document
  (`src/document/`: `project.ts`, version 2, with the move from version 1 in
  `legacy.ts`; the tracks, tempo and level model in `machine.ts`; the sounds
  in `roles.ts`; the panel geometry in `hardware.ts`), what its controls do
  and how it plays and composes (`src/session.ts`), what it asks of the
  engine (`src/engine.ts`) and its panel (`src/ui/`). `src/index.tsx` puts
  those together as a `Machine`. Core must never import a machine package.
- `packages/contracts/` holds what every machine shares: what any project
  document carries and the codec a build makes from its machines
  (`document.ts`), saved beats and the shop.
- A machine package also holds its data and what the engine needs from it:
  for the 808, its JSON data files (`data/`) and fixtures (`fixtures/`),
  which the C++ tests read by path, so a change there is checked on both
  sides; its voices (`engine/voices.cpp`); its panel art and the script that
  draws it (`art/`); and its panel's styles (`src/styles.css`, imported by
  its `index.tsx`). The editor's own `styles.css` has no machine in it.
- The engine is only ever built for a machine. The core
  (`engine/src/engine.cpp`, `midi.cpp`, `synth.cpp`) has no voices; a
  machine's sources define `boombapbot::machineVoices()`
  (`engine/include/boombapbot/voices.h`) and its `engine/CMakeLists.txt`
  calls `boombapbot_add_machine` (`engine/cmake/BoombapbotMachine.cmake`).
  That gives `boombapbot-engine-<id>.wasm` and, natively,
  `boombapbot_engine_<id>`. A plain `cmake -S engine` builds every machine
  package in the repository; `BOOMBAPBOT_MACHINE_DIRS` names them otherwise.
  The engine's test suites and render tool are still written against the
  808's project and track table, so the 808's `engine/CMakeLists.txt` builds
  them (`boombapbot-render-808 --project FILE --machine packages/machine-808`).
- `packages/machine-ritm12/` is РИТМ-12, everything but its panel so far.
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
  formats. It must stay self-contained: it may not import the 808's package.
  A machine's draft has its own storage key, and a draft found under an
  earlier key is read and left exactly where it was.
- A setup follows either what a panel's switches ask for (`follow.panel`,
  the 808) or one pattern round and round (`follow.cue`). A render plan is a
  song of rhythms (`SongPlan`) or one cued pattern (`PatternPlan`). The
  worklet takes `cue` and `effect` and reports `level` while it changes;
  `EditorRuntime.outputLevel()` is what a meter reads as it draws.
- Swing is a byte of the pattern (`SnarePattern.swing`, 0 to
  `SNARE_SWING_MAX`): every second step of a measure of four or eight steps
  to the beat plays late by `swing / 256` of a step, in the engine and in a
  MIDI export alike. The bar line never swings, and triplets do not.
- The effect on the mix (`engine/src/fx.h`, `snare_engine_set_effect`) is an
  echo, a reverb, a flanger or a chorus, added ahead of the limiter. It keeps
  the engine's promises: every buffer is allocated when the engine is made,
  state moves a sample at a time, and nothing calls the C library's maths
  per sample. With no effect set it does not touch the samples, which is what
  keeps the 808's output as it was. An offline loop is played often enough
  for the effect's tail to settle (`loopPasses`), without changing its length.
- `snare_engine_output_level` is the root mean square of the output over
  about a third of a second, after the volume: what a meter shows.
- `scripts/prepare-assets.mjs` and `scripts/check-build.mjs` work for one
  machine, named by `BOOMBAPBOT_MACHINE` like the site's alias (the 808 when
  unset). The asset manifest says which machine the build is.
- `packages/editor/` is the React editor core. `EditorStore` holds the
  project and undo; `EditorRuntime` connects it to audio, local storage and
  the exporters and hosts the machine; `AudioController` is the only thing
  that talks to the AudioWorklet. `machine.ts` is the contract a machine
  fills in. A machine's `setup` turns a project into an `EngineSetup`
  (`engine/setup.ts`), which the runtime compares with the last one and
  sends on, for live playback and offline rendering alike.
- The site mounts the editor through `apps/site/src/components/Machine.tsx`,
  which imports `#machine`: an alias in `astro.config.mjs` set by
  `BOOMBAPBOT_MACHINE` (the 808 when unset), with the matching `paths` in
  `apps/site/tsconfig.json`. The server reads projects with a codec made
  from `#machine/document`. Only the chosen machine is ever imported.
- `apps/site/` is an Astro site that mounts the editor as a client-only
  island. Its pages are prerendered. The one thing that runs on a server is
  `src/pages/api/`, backed by `src/server/`: accounts (`api/auth`, Better
  Auth, Drizzle on Neon Postgres, Resend), saved beats (`api/beats`) and the
  shop (`api/store`, `api/webhooks`, Stripe and Printful). The modals that
  talk to it are `packages/editor/src/ui/Account.tsx` (with
  `SavedBeats.tsx`) and `Shop.tsx`.

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
- `packages/machine-808/engine/voices.cpp` builds the 808's sounds from knob settings. Do
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
  linear gains; the knob tapers live in `packages/machine-808/src/document/machine.ts`
  and are mirrored in `engine/tools/project_io.h` and
  `plugins/vst3/Source/Machine808.h`. Track level and master volume are
  smoothed per sample, in a way that does not depend on buffer size.
- The engine, not TypeScript, decides what plays at a bar line.
  `engine/src/sequencer.h` is pure and holds those rules: A, AB and B, intro,
  tapped and automatic fill-ins, and songs. The 808's `engine.ts`
  (`enginePanel`) only tells the engine where the panel's switches stand. A
  rhythm track is handed over whole as a song (`snare_engine_set_song`), and
  an export asks the engine which version each measure plays
  (`snare_song_patterns`) so it cannot disagree with what is heard.
- The page learns what played from the measure log, which the worklet drains
  after every render and never skips. A measure whose rhythm changed on its
  second beat is reported twice under one ordinal. Compose records from it:
  the 808's `Session808` keeps the take and stores it when the machine stops,
  as one undo step.
- The tools and tests must compile with Clang as well as GCC. CI builds both.
- `-ffp-contract=off` is deliberate: it keeps native and WASM renders within
  two 24-bit steps of each other, which a unit test asserts.

**The project and the machine**

- A track's position in `TRACK_IDS` is its engine track (the accent is 0), and
  a role's `index` in `packages/machine-808/data/roles.json` is its sound slot
  and the synthesiser's sound number. Never reorder or reuse either.
- A step is on or off. Loudness comes from the accent track and the level
  knobs. There is no per-step velocity; do not bring it back as a
  convenience. The 808 has no swing either: its patterns leave the engine's
  swing at 0.
- The engine's pattern for a rhythm is `rhythm * 2`, plus one for its B
  version (`patternIndex`).
- The instrument selector chooses a rhythm track in play and compose, and a
  track runs on into the next only when it is full (`composition`,
  `withComposition`).
- The step buttons do three jobs: steps in the two write modes, the last step
  of a part while CLEAR is down, and the choice of rhythm in pattern clear,
  manual play and compose. Playing a track back they do nothing. `Session808.pressStep` is the one place that decides which.
  `panelTarget` says which rhythm and version the panel is on.
- Undo covers what the machine remembers (its `memory`: for the 808,
  `rhythms` and `rhythmTracks`) and a
  whole-project import. Knobs, switches, tempo and the name are not undo
  steps.
- An older project is brought up to date in `parseProject`, which also
  reports what was lost; the page shows that list. Add a step there for every
  schema change, with a fixture.
- A new project gets the starter rhythms and starter track
  (`packages/machine-808/src/document/starter.ts`). They are written for boombapbot; do
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
- The faceplate is a drawing made by `packages/machine-808/art/draw-faceplate.mjs`. Its
  manifest sets `faceplate.original` and has no credit. Change the script and
  run `pnpm faceplates:draw`; do not hand-edit the SVG. The script places live
  controls from the panel manifest, so keep reading positions from there.
  `check-build` fails a build whose faceplate is not the committed one, or has
  no entry in the machine's `art/README.md`, or is a photograph without a
  `faceplate.credit`.
- The 606, 707, 808 and 909 photographs in `assets/faceplates/` are the owner's
  debranded edits of Creative Commons works, kept for later. If one ships
  again it needs its credit shown under the panel; that is a licence
  requirement.
- `misc/assets/` is git-ignored and is for the owner's unedited originals.
  Nothing from it may reach a production build or a commit.
- Panel coordinates are in the image's own pixel space (`faceplate.width`
  and `height`). `packages/machine-808/art/README.md` records how it was fitted.
- The header mascot (`packages/editor/src/assets/mascot.svg`) is the owner's
  artwork and is used unaltered. Its cream outline on the dark background is
  CSS, in `.sb-mascot`.

**Page layout**

- The machine's page is the header, the machine and the footer, nothing else.
  A control the machine has belongs on its faceplate. Anything else about the
  machine lives in the settings modal behind the footer's cog
  (`packages/editor/src/ui/Settings.tsx`).
- `Header` (the brand: mascot over the tagline, together as tall as the
  wordmark beside them) and
  `Footer` (About, Docs, manifesto, credits, policies, upgrade, cart,
  settings, account) are shared. The header is the brand alone.
  `SitePage` wraps a page of words in them; About, Docs, the manifesto,
  Credits and Policies are Astro pages in `apps/site/src/pages` that use it.
  Credits is blank until the owner writes it.
- On the machine's page the footer sits 50px under the machine
  (`--footer-drop`, `.sb-below-machine`). On a page of words it stays at
  the bottom. Keep
  Policies true to what the site does: it covers accounts, saved beats and
  the shop, with the returns policy in the owner's words. Update it before
  the upgrade is sold.
  Every footer modal goes through `ui/Modal.tsx`.
- Each footer icon has a tip with its name (`ui/Tip.tsx`, Base UI's tooltip)
  and a move of its own when pointed at. The tip is for the eye only: the
  icon keeps its `aria-label`. The moves are CSS that picks shapes inside
  lucide's icons by their order, so look at all nine after changing an icon
  or upgrading `lucide-react`.
- The upgrade has no backend. Its modal says so and offers no form. Do not
  add a form, a price or a feature list until the real thing exists. The
  cart is the shop (`ui/Shop.tsx`); it shows products only when the server
  says the shop is open.
- The cookie notice (`ui/CookieNotice.tsx`) is on the machine's page only and
  sits between the machine and the footer. It is taller than the gap there,
  so the footer sits lower until it is closed. Do not make it an overlay: it
  must never cover a control.
- What stays on the page with the machine: import and error notices, and on
  a phone the instrument and mode strips and the docked start button.
- The power switch makes everything else on the panel `inert` through the
  `sb-panel-controls` wrapper. A new panel control goes inside that wrapper.
- A dial with fixed positions gets a `DialHandle` so it can be turned by
  hand; its labels and the keyboard are the accessible way to the same choice.
- Browser tests reach buried controls through `openSettings`, and the
  machine through `selectTrack` and `stepButton` (`e2e/helpers.ts`). The
  ones that need an account share `e2e/account.ts`.

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
  in place of sending it. The accounts tests use both. A Vercel build
  leaves the in-process database out (`__LOCAL_DATABASE__`).
- Sign-up always needs a confirmed address. Better Auth sends that email in
  the background, so a failed send does not fail the sign-up; the modal
  always offers to send it again. Keep that.
- An account is deleted from the modal with its password
  (`user.deleteUser` in `src/server/auth.ts`). The schema does the rest:
  sessions, the credential and saved beats cascade, and orders keep their
  rows with the user unset. A new table that hangs off a user has to choose
  one of those two on purpose. Both app stores require this button.

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
  as it came.
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
ear and have not been compared with a real machine. Untested: Firefox,
Safari on a Mac, Windows builds, and the VST3 in any host. The site is
deployed at `boombapbot.com`, and the owner has done these on it: signed up
and reset a password (the emails arrived and their links worked), bought a
sticker (paid at Stripe, accepted from Stripe's webhook, placed with
Printful), saved a beat from a computer and loaded it on two phones, and
logged in, loaded a beat and played it on an iPhone in Safari and in Chrome
and on a Samsung Galaxy S9 in Chrome. Never tried there: deleting an
account or a saved beat, the newer-copy question, the beat limit, a real
Printful shipping event, a refund, and a purchase without an account.
Nobody has gone over the phone layout or long playing on a real phone.
Say so rather than assuming these work.

## Working in this repo

- Work goes on a feature branch and lands through a pull request. CI
  (`.github/workflows/ci.yml`) runs every check above plus the VST3 spike.
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
