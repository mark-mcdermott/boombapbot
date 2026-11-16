# Follow-ups after v0.1

What v0.1 leaves for later, with the concrete prerequisites for each. Nothing
in this file has been built unless it says so.

## Finishing the machine

The editor now does what the 808's operation manual describes, short of what
a browser cannot. What is left of that work:

1. **A listen, and what it turns up.** The sounds, the reach of the level and
   accent knobs, and the feel of TAP are the parts most likely to need it.
2. **Long exports off the main thread.** A rhythm track renders in memory on
   the main thread, so WAV export stops at five minutes. A Worker and
   streamed encoding would lift that.

Left out for good, because a browser cannot do them: DIN sync, trigger
outputs, separate instrument outputs, pedal jacks and memory protection.

Not settled by any of that:

- **How it sounds.** `engine/src/synth808.cpp` is a model made by ear. It
  needs a listen beside a real machine, voice by voice and knob by knob.
- **Composing over a written track.** The manual says a track can be edited
  "from a certain point onward" without changing its length, and little
  more. Here a rhythm chosen on the way replaces every measure from there to
  the end of the track, a tapped fill-in replaces one measure, and the
  machine stops at the end. A real machine may differ.
- **Tracks running on.** A composition goes on into the next track when the
  one before it holds all 64 measures. Whether the hardware decides it that
  way is an inference from the manual.
- **What the manual leaves out about fill-ins.** Here a tapped fill-in counts
  as one of the measures the automatic fill-in counts and an intro does not;
  AB keeps its turn across a fill-in; and the first-beat rule applies in the
  play modes only, never cutting into an intro or fill-in.
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

## Accounts, upgrades and the shop

Accounts are built: sign-up with a confirmed address, log-in, log-out and
password reset, in the account modal. The upgrade and the cart still open a
modal that says they are not open.

- **Before accounts go live.** The Neon database has its tables
  (`pnpm db:migrate`, run once) and the built server reads from it. Still to
  do: verify a sending domain in Resend and fill in `RESEND_API_KEY` and
  `EMAIL_FROM`, then set the same values in Vercel with its own
  `BETTER_AUTH_SECRET`. No real sign-up has been made yet, and nothing has
  been tried on Vercel: the tests use a database inside the process and an
  outbox folder.
- **What an account is for.** Decided by the owner: as much as possible
  works with no account. A free account adds some cloud storage for beats
  and syncing across devices. That is the next piece: a projects table per
  user, an upload and download API, a limit, and a rule for two devices
  editing the same beat. Until it exists the modal says an account only logs
  you in.
- **Deleting an account.** There is no button. The Policies page says to
  write in and it will be done by hand. Better Auth can do it
  (`user.deleteUser`); it needs a confirmation step in the modal.
- **Rate limiting.** Better Auth's limiter is on in production and counts in
  memory, which on Vercel means per instance. Move it to the database before
  relying on it.
- **Upgrade.** Decided by the owner: a flat one-time 5 dollars unlocks every
  paid feature, with a license key the buyer is given and can retrieve later.
  Paid features are the stranger effects (delay, compression and the like),
  perhaps a place to show beats, and AI add-ons that are not defined yet;
  ordinary effects (distortion, a flanger and the like) stay free. None of it
  exists. The engine has no effects at all yet, and the exact split is still
  loose.
- **The shop** is built and closed. The catalog holds the one product in the
  Printful store and ships wherever Printful does, at Printful's live rate
  for the address. Before it opens:
  - Put the Stripe secret key in place. (The `orders` table is in the
    database since 2026-11-15.) The owner chose live keys, so the first real
    purchase is a real charge and a real Printful order, made by the owner
    and by nothing automated. Nothing has
    run against real Stripe; in particular a Checkout with a shipping option
    and no address collection has only been sent to the stand-in.
  - Register both webhooks, Stripe's on the current API version. Printful's
    is set through its API and needs the live address.
  - Say on the Policies page what an order keeps (email, address, items),
    that Stripe takes the payment and Printful gets the address, and how
    returns and refunds work. That last one is the owner's to decide.
  - Sales tax, VAT and customs are not collected or worked out. The modal
    says customs is not included.
  - The shipping route asks Printful on every request and has no limit of
    its own.
  - The buyer gets no email from the site and has nowhere to see an order's
    status; tracking is recorded but not shown.
  - A pending order that is never paid stays in the table, with its address.
  - The product is named "Unisex Hoodie" in Printful, which is what the shop
    shows. Rename it there and run `pnpm shop:sync`.
- **Policies.** The Policies page says what an account keeps. It was drafted
  from how the site behaves and is not legal advice. It has to be read by
  someone qualified, and updated again, before payments open.
- **The manifesto** ("Stay Stoked, Stay Woke") is the owner's own text, put
  in word for word on 2026-11-15, "for now". It mentions a small paid tier,
  which does not exist yet; the shop is the only thing with a price.
- **The other machines** in the header are drawn but not built.

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

- **Deployment.** Vercel's build machines do not have Emscripten, so the site
  is built in GitHub Actions and handed to Vercel finished
  (`.github/workflows/deploy.yml`, after CI passes on `main`, or by hand).
  Vercel's own build on push is switched off in `apps/site/vercel.json`. It
  first ran on 2026-11-16 and the live site was checked by hand. What it
  depends on:
  - Three repository secrets on GitHub: `VERCEL_TOKEN` (scoped to the team
    that owns the project; it expires), `VERCEL_ORG_ID` and
    `VERCEL_PROJECT_ID`.
  - The Vercel project's Root Directory being `apps/site`; the workflow
    stops and says so if it is not.
  - The site's own values, set in Vercel for Production (see
    `apps/site/.env.example`). A changed value needs a new deployment: run
    the workflow by hand. Still missing there: the Resend, Stripe and
    webhook values.
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
