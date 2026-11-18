# boombapbot

A drums-only beat maker. This repo holds v0.1: a web editor that is one drum
machine, РИТМ-12, running entirely locally. РИТМ-12 is invented for
boombapbot. It is the only machine in this repository, and it is a package
that plugs into a core that knows no machine, so another machine can be
built elsewhere on the same core. `README.md` says what is built and how it
was verified, and `docs/follow-ups.md` has what is left and in what order. Accounts exist and
are optional: sign-up, log-in and password reset, and a free account can
hold up to 20 saved beats. `apps/mobile` is a first slice of the phone
apps: it runs in a simulator and is not ready for a store. The rest of the
build spec's wider scope (background sync, native audio, a desktop shell,
billing) is not started.

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
  is after a key's. The screen is the same drawing in a second shape
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
- The effect on the mix (`engine/src/fx.h`, `snare_engine_set_effect`) is an
  echo, a reverb, a flanger or a chorus, added ahead of the limiter. It keeps
  the engine's promises: every buffer is allocated when the engine is made,
  state moves a sample at a time, and nothing calls the C library's maths
  per sample. With no effect set it does not touch the samples. An offline loop is played often enough
  for the effect's tail to settle (`loopPasses`), without changing its length.
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
  `SavedBeats.tsx`) and `Shop.tsx`.
- `apps/mobile/` is the same editor with РИТМ-12 in a Capacitor shell for
  iOS and Android, a Vite page with no server behind it. Its sound is the
  web view's own worklet and WASM engine. `BoombapbotEditor` takes three
  things for a shell like it: `storage`, where the draft is kept (the app
  hands in the device's own store, `src/device-storage.ts`); `save`, where
  an exported file goes (a download when not given; the app hands it to the
  phone's share sheet, `src/share-file.ts`, because a web view inside an app
  ignores a download); and `below`, what sits under the machine in place of
  the cookie notice and the footer. A `save` answers false when the person
  turned the file down, and an export then claims nothing.
  The app leaves accounts, saved beats and the shop out. Its engine, worklet
  and art are the site's, copied by `scripts/copy-assets.mjs` from what
  `pnpm prepare:assets` made. `ios/` and `android/` are Capacitor's native
  projects and are committed; `cap sync` rewrites parts of them. Its
  `README.md` says how to run it, what was checked and what is left.
- Nothing the editor imports may need the page's address to be http or
  https when the file is read: an app's page is `capacitor://localhost`.
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
  acknowledges.
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
  `Footer` (About, Docs, manifesto, credits, policies, upgrade, cart,
  settings, account) are shared. On the machine's page the header is the
  brand alone.
- `SitePage` wraps a page of words; About, Docs, the manifesto, Credits and
  Policies are Astro pages in `apps/site/src/pages` that use it. There the
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
- Credits is blank until the owner writes it. The ruled outline on it
  (`.sb-blank`) is drawn in CSS and holds no words.
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
  lucide's icons by their order, so look at all nine after changing an icon
  or upgrading `lucide-react`.
- The upgrade has a server (see Upgrade below) and nothing on the page: its
  modal says it is not open and offers no form. Which features are paid is
  not decided, so do not add a feature list or a promise to it. The
  cart is the shop (`ui/Shop.tsx`); it shows products only when the server
  says the shop is open.
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
  in place of sending it. The accounts tests use both. A Vercel build
  leaves the in-process database out (`__LOCAL_DATABASE__`).
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
- This is the entitlement, not the gating. Nothing calls `isUpgraded` yet,
  and which features are paid is not decided. Do not gate a feature, or
  tell a visitor what the upgrade unlocks, until the owner says which.
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
  `GET /api/upgrade`. Like everything else, the machine must not wait on
  the answer.
- Asking for a key by email (`remindKeys`) answers the same whether or not
  the address bought anything, and marks a key as sent before sending it,
  so each goes out once in ten minutes. `AUTH_RATE_LIMIT=off`, which only
  the browser tests set, takes that wait away too.
- The tests keep the fake's upgrade checkouts in a log of their own
  (`/calls/upgrade`), so they and the shop's tests can run side by side.
  The closed switch is tested on a second server the spec starts itself.

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
  `renderLoop()` renders on the page what a WAV export renders in its Worker.
- `pnpm dev` serves the Astro dev server; the browser tests and `pnpm serve`
  use the production build, so run `pnpm build` before either.

## Not verified yet

The owner has listened to РИТМ-12 on a local build and said it sounds good;
nobody has gone through it voice by voice or effect by effect. On the live
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
Say so rather than assuming these work.

## Working in this repo

- Work goes on a feature branch and lands through a pull request. CI
  (`.github/workflows/ci.yml`) runs every check above, with the engine also
  built by Clang and under the sanitizers.
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
