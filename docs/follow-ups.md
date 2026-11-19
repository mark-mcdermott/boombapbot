# Follow-ups after v0.1

What v0.1 leaves for later, with the concrete prerequisites for each. Nothing
in this file has been built unless it says so.

## Finishing the machine

РИТМ-12 is the machine the site is. What is left of it:

1. **Try it where it has not been.** The owner has used it on the live site
   in desktop Chrome and on an iPhone in Safari and Firefox. Firefox and
   Safari on a Mac and an Android phone have not shown it, and nobody has
   played it for long on a phone.
   A phone, and a tablet held upright, get a panel of their own since
   2026-11-18 (`?panel=picture` brings the picture back). What it still
   needs:
   - The owner has used it on an iPhone and an Android phone, in Chrome on
     both, and likes how it looks and sounds (2026-11-18). They could not
     tell what the Russian meant, so every label now has the picture's own
     drawing beside it, and a touched control says what it is in English
     under the screen for a moment. Both went in after the owner's
     two trials, and neither has been reported back from a real phone. The step keys, play
     and stop say nothing there, and the picture has no such line. Still to
     find out there: whether the step keys (about 39px on a 390px screen)
     are large enough over a long session, and how much of the panel shows
     above the fold with the browser's bars.
   - Its paint. The olive and the rust are drawn in CSS and are flatter than
     the picture. One painted plate with no controls on it would replace
     them.
   - A phone on its side. It is wider than 900px on the largest phones and
     narrower on the rest, so some get the picture and some get a column
     taller than the screen. Neither was designed for it.
   - The instrument strip, the fit button and the dock are still in the
     code, for a small screen that asks for the picture. They can go if
     nobody wants the picture there.
   - The phone app. `apps/mobile` is as narrow as a phone, so it gets this
     panel, and carries the lettering's typeface. It has run that way in
     an iPhone simulator and an Android emulator, never on a phone, and
     export and import were not run again on Android.
   - Decisions it made that are the owner's: step numbers on the keys,
     МУТ on its key, one level knob for the selected voice where the picture
     has eight, no level meter, and controls dimmed while the power is off.
2. **A closer listen.** The owner has heard it and likes it. Its eight
   voices, how far each knob reaches and its four effects were set by
   measurement more than by ear, and nobody has gone through them one by
   one.
3. **Full-size art.** The picture is 2000 pixels wide. The owner's originals
   are 3072 wide; put one picture for each state in `misc/assets/ritm12/`,
   run `packages/machine-ritm12/art/cut-art.py` and update `ui/layout.ts`.
   The pointer lines were lifted from an earlier picture, and the owner may
   paint their own.
4. **Beats of the earlier machine.** A draft, a file and a stored beat from
   the machine the site had first open converted in the tests, from
   fixtures. Nobody has opened a real one, and the owner had saved none.
   Any stored by someone else stay in the database as they were.
5. **The settings sheet's words.** Its heading, its audio lines and its
   closing note were rewritten for РИТМ-12 and for accounts, and the owner
   has read them. The line it shows when a draft cannot be written named
   only the export; since 2026-11-18, on the site, it names an account too:
   "To keep this beat, export the project file or save it to an account."
   The owner has not read that wording. The phone app has no accounts and
   keeps the line as it was. Two things are left:
   - A browser whose storage is missing from the start (a private window
     that blocks it) is never told. The line appears only once a write
     has failed, and with no storage nothing is written, so the sheet goes
     on saying "Draft will be saved in this browser".
   - The closing note points to "the account button in the footer" in the
     phone app as well, which has neither.
6. **The pages of words.** Their design pass was done on 2026-11-17. What it
   left for the owner to decide is under "Accounts, upgrades and the shop".
7. **Names left in the engine's header.** `engine.h` still names sixteen
   sound slots after the earlier machine's sounds (`SNARE_SOUND_KICK` and
   the rest). Nothing here needs more than their numbers; they can go once
   whatever is built on this core elsewhere has names of its own.

## Accounts, upgrades and the shop

Accounts are built: sign-up with a confirmed address, log-in, log-out and
password reset, in the account modal, and saving beats to an account. The
upgrade's server side and its modal are built and switched off; on the live
site its icon still opens a modal that says it is not open.

- **Accounts are live.** The Neon database has its tables, and Vercel has
  the Resend key, the sending address and its own `BETTER_AUTH_SECRET`. On
  2026-11-16 the owner signed up on the live site and the confirmation
  email worked. The Resend key was replaced later that day, and a password
  reset with the new key worked too. The tests still use a database inside
  the process and an outbox folder.
- **What an account is for.** Decided by the owner: as much as possible
  works with no account. A free account adds some cloud storage for beats
  and syncing across devices. The first part is built: a logged-in visitor
  saves the beat on the machine to the account, sees what is saved, and
  loads or deletes one. The owner handed over three decisions on
  2026-11-16, and they were made this way: 20 beats per free account, each
  at most 64 KB; the last save wins, except that a newer cloud copy is
  asked about first; and saving is explicit, with no background sync.
  What is left:
  - **The migration is run.** `apps/site/drizzle/0002_beats.sql` adds the
    `beats` table, and it was run on Neon on 2026-11-16, ahead of the
    code. The table was checked afterwards: its columns, the unique uuid
    and the cascading owner are as the migration has them, it is empty,
    and the existing users and orders were not touched.
  - On 2026-11-17 the owner saved a beat on the live site from a computer
    and loaded it on an iPhone and an Android phone. Deleting a saved beat,
    the question about a newer cloud copy and the 20-beat limit have only
    run in the tests.
  - The limit is counted and then the row is inserted, as two statements.
    Two saves sent at the same instant could both get in at 19. Harmless at
    this size; a paid tier with a hard quota would want it in one statement.
  - A device remembers which saved beat its project goes with in its own
    browser storage. A project brought over as a file, not loaded from the
    account, is saved as a new beat there.
  - There is no way to rename a saved beat except to load it, rename it in
    settings and save again, and no way to save or load from a page of
    words: the modal there points back to the machine.
  - No background sync and no merge. Two devices editing the same beat get
    the question, not a combined beat.
  - The beats routes have no rate limit of their own. An account can hold
    only 20 rows of 64 KB, but it can rewrite them as often as it likes.
  - If the session runs out while the modal is open, a save is refused with
    "Log in to save beats to your account" and the modal still shows the
    account until it next checks the session.
  - The Policies page says what a saved beat keeps. Like the rest of that
    page it was drafted from how the site behaves and nobody qualified has
    read it. Neon keeps its own history of the database for a while; the
    page does not go into that.
- **Deleting an account.** The account modal has a delete step that asks
  for the password. The database takes the account's log-ins, credential and
  saved beats with it and unties its orders, which are kept. It has only run
  in the tests. A pending verification row for the address is left to
  expire.
- **Rate limiting.** Better Auth's limiter is on in production and counts in
  memory, which on Vercel means per instance. Move it to the database before
  relying on it.
- **Upgrade.** Decided by the owner: a flat one-time 5 dollars unlocks every
  paid feature, with a license key the buyer is given and can retrieve later.
  Paid features are the stranger effects (delay, compression and the like),
  perhaps a place to show beats, and AI add-ons that are not defined yet;
  ordinary effects (distortion, a flanger and the like) stay free. The
  engine now has an echo, a reverb, a flanger and a chorus, made for
  РИТМ-12 and tuned by ear by nobody yet; which are paid is still loose.
  Decided on 2026-11-17: a key is `BOOM` and four groups of five; it is
  emailed and can be read from the account, or emailed again to the address
  that paid; buying needs no account; a license outlives its account.
  The server side is built to those decisions and switched off: a Stripe
  checkout, one license and one emailed key for one payment, a route to
  enter a key in an account, routes to get it back, and `isUpgraded`
  beside the session. It has only run in the tests. What is left, in order:
  - **The migration is run.** `apps/site/drizzle/0003_licenses.sql` adds the
    `licenses` table, and it was run on Neon on 2026-11-17, after the code was
    merged. The table was checked afterwards: its columns, the four unique
    columns, the owner that is unset when an account is deleted and the
    email index are as the migration has them, it is empty, and the six
    tables that were there hold the rows they held before.
  - **Decide which features are paid,** then gate them. Nothing reads
    `isUpgraded` yet. To settle with it: whether a key alone unlocks a device
    with nobody logged in, and how a paid feature behaves with no server,
    since the machine has to work without one.
  - **The modal is built**, on 2026-11-18, and shows only while the server
    says the upgrade is open: the price from `GET /api/upgrade`, a button
    that goes to Stripe, the way back (`/?upgrade=paid` and
    `/?upgrade=open`), a key to enter, a lost key to ask for, and the key
    shown to an upgraded account. It has run in the tests and by hand
    against the stand-in for Stripe, never against Stripe itself. What is
    left of it:
    - **Its words.** What it says while the upgrade is open is a stand-in,
      and nothing in it says what the five dollars unlocks, because that is
      not decided. All of it is the owner's to write
      (`packages/editor/src/ui/Upgrade.tsx`), and so is the wording of the
      key's two emails (`src/server/email.ts`), the name Stripe shows
      (`PRODUCT_NAME` in `api/upgrade/checkout.ts`) and the refusals in
      `src/server/upgrade.ts`, which the modal shows as they are.
    - Entering a key needs an account, so the modal sends somebody with no
      account to the account modal and they have to come back to it
      themselves. If a key alone is to unlock a device, this changes.
    - While the upgrade is closed the modal offers nothing, so a key bought
      earlier could not be entered or asked for again there. That only
      matters if the upgrade is ever closed after it has sold.
    - A logged-in buyer back from Stripe is looked up for half a minute. If
      Stripe's webhook takes longer, the modal says to open it again later;
      the key still arrives by email.
    - About still says of the upgrade that its button "only says so for
      now". Change it when the upgrade opens.
  - **Policies.** Before it is sold the page has to say what the upgrade
    costs, how a refund for it works, and that a license keeps the buyer's
    email and its Stripe payment's id, and stays after the account is
    deleted.
  - **Open it.** Set `UPGRADE_OPEN=on` in Vercel and deploy. The Stripe
    webhook already registered for the shop is the one it uses; nothing
    changes in the Stripe dashboard.
  - **Refunds.** Refunding the payment in Stripe does not take the key
    back. That needs a column to mark a license withdrawn and a case in
    the webhook, once there is a refund policy.
  - The key-by-email route has no limit of its own beyond one email per key
    in ten minutes, and it answers sooner for an address that bought
    nothing than for one that did, which a patient stranger could time.
  - A paid upgrade that raises the beat limit would want the count and the
    insert in `api/beats` in one statement first (see saved beats above).
- **The shop** has been open on the live site since 2026-11-16. The catalog
  holds the two products in the Printful store, a hoodie and a sticker, and
  ships wherever Printful does, at Printful's live rate for the address.
  What is left:
  - The first real order went through on 2026-11-16: paid at Stripe,
    accepted from Stripe's webhook and placed with Printful. Still untried:
    a real Printful shipping event, a refund, and a purchase without an
    account.
  - Both webhooks are registered: Stripe's in its dashboard, Printful's by
    `pnpm shop:webhook --register`. Stripe's has taken a real event;
    Printful's has not yet. To change Printful's secret, set the new value
    in Vercel and in `apps/site/.env`, deploy, and run that command again.
  - The Policies page has a section on the shop since 2026-11-16: returns
    and refunds in the owner's words, what is paid, that Stripe takes the
    payment and Printful gets the address, and what an order keeps. Keep it
    true when the shop changes.
  - Sales tax, VAT and customs are not collected or worked out. The modal
    says customs is not included.
  - The shipping route asks Printful on every request and has no limit of
    its own.
  - The buyer gets no email from the site and has nowhere to see an order's
    status; tracking is recorded but not shown.
  - A pending order that is never paid stays in the table, with its address.
  - The shop shows each product under its name in Printful. To change a
    name, a price or a picture, change it there and run `pnpm shop:sync`.
    In the sticker's picture the character lies on its side.
- **Policies.** The Policies page says what an account and an order keep
  and how the shop works. It was drafted from how the site behaves and is
  not legal advice; nobody qualified has read it. It says no sales tax or
  VAT is collected, which is true of the site and is not a view on what the
  owner owes. Update it again before the upgrade is sold.
- **The manifesto** ("Stay Stoked, Stay Woke") is the owner's own position.
  Their first text went in word for word on 2026-11-15, and a rewrite of it
  they asked for on 2026-11-18 followed. Later that day they gave a new text
  of three paragraphs, and that is what is there now, word for word under
  the same title. It says "I've added a small paid tier to this app". The
  upgrade is built and not open, and About says upgrades are not here yet;
  neither was changed to match. The page's description for search engines
  still calls it a footnote to a drum machine, from the text before.
- **The pages of words** were laid out again on 2026-11-17: a compact
  masthead that names the pages, headings in a rail, About opening on a
  still of the machine, and the manifesto as one narrow column. Left for the
  owner to decide:
  - The names in the masthead reverse an earlier decision, that the header
    is the brand alone and the footer's icons are the navigation. They are
    one component, `ui/SiteNav.tsx`, if they are to go.
  - The masthead drops the tagline. It is still on the machine's page.
  - The words on About were reordered and its first lines rewritten as a
    draft: the heading, the paragraph under it, the caption of the picture,
    and "Who made it" moved up to third. No claim was added.
  - Whether "Docs" should be called "Manual".
  - Whether the manifesto is signed. It is not.
  - Credits is still blank.

## Native shells

Both shells reuse two things that exist today: the engine's C ABI
(`engine/include/boombapbot/engine.h`) and the shared editor
(`packages/editor`). The editor reaches audio only through
`AudioController` (`packages/editor/src/engine/audio-controller.ts`), whose
message set is `packages/editor/src/engine/messages.ts`. A native shell
replaces that one class with a bridge that sends the same messages to a
native engine instance.

### Capacitor (iOS and Android)

A first slice is built in `apps/mobile`: the editor with РИТМ-12 in a
Capacitor shell, playing through the web view's own worklet and WASM
engine, with the draft kept in the device's own store and no accounts,
saved beats or shop. On 2026-11-17 it ran in an iPhone simulator and in an
Android emulator: the machine shown, a beat playing, the draft back after a
relaunch, an export handed to the share sheet and a project file imported.
Nobody has listened to it or held it on a phone. `apps/mobile/README.md`
lists what is not right yet (Android's share sheet cannot save to the
phone itself, the words are the site's, the sideways layout, a stand-in
icon) and what a store needs: signing, accounts
in the app with the delete step both stores require, Apple's rule on selling
the upgrade, and Google Play's closed test of 12 testers for 14 days.

What a native audio bridge needs, in place of the web view's sound:

- Xcode with an Apple developer team, and Android Studio with the NDK. Neither
  is available on Linux CI for iOS; iOS needs a macOS runner.
- A Capacitor plugin in `apps/mobile` exposing the `EngineCommand` messages.
  `AudioController` is made inside `EditorRuntime`, which needs a way to be
  handed another one.
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

Unverified: the bridge is not started.

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

## Web

- **The rename.** The app was renamed on 2026-11-16 and the site moved to
  `boombapbot.com` the same day. The wordmark in the header is a stand-in
  drawn on the grid of the owner's earlier one; theirs replaces it in
  `ui/Brand.tsx` when it exists. With ten letters the lockup is tight on a
  phone, where the mascot comes out about 18px tall. A project file exported
  before the rename carries the former format name and no longer imports.
  Browser storage did not carry over to the new domain; beats saved to an
  account did.
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
    the workflow by hand. All of them are set there as of 2026-11-16.
- **Browsers.** The tests run in headless Chromium. On 2026-11-18 the whole
  browser suite also passed in Playwright's builds of WebKit and Firefox on a
  Mac (`BOOMBAPBOT_E2E_BROWSER`), the pages of words and the phone's panel
  with it. That is not Safari or Firefox on a phone, and nobody listened: it
  says the pages lay out and the controls answer. Two things it turned up:
  - In Safari the delete question on a saved beat never took focus. Safari
    does not focus a button when it is clicked, and the question had only
    looked right in Chromium because the clicked button was reused for it.
    Fixed; it now takes focus by hand.
  - In Safari the library the modals are made with (`@base-ui/react`) gives
    the focus guard at each end of an open modal the role of a button and
    no name, so VoiceOver can land on an unnamed button there. It is the
    library's own doing for Safari. The scans leave the guards out
    (`scanner` in `e2e/helpers.ts`); nobody has listened to a modal with
    VoiceOver.
  Safari also keeps Tab for form controls and reaches a link with Option
  and Tab unless its own setting says otherwise, so the footer's links are
  not on the plain Tab key there. That is Safari, not the site. On 2026-11-18 the owner
  used РИТМ-12 on the live site on an iPhone in Safari and in Firefox, and
  loaded there a beat saved from desktop Chrome. Firefox and Safari on a Mac
  and an Android phone have not been tried on it.
- **Work on the main thread.** The synthesis of a sound takes a few
  milliseconds, the longest of a machine several, and happens on the main
  thread. A WAV export renders in a Worker. One thing is left of that:
  the settings sheet shows where a render stands, so nobody sees it once
  the sheet is closed. A menu item that is switched off has had a look of
  its own since 2026-11-18: its name dimmed, no hand over it, and its note,
  which says why, as legible as before.
- **Draft storage.** One draft in `localStorage`, written whole on every
  change, knob moves included. Multiple projects want IndexedDB. Two tabs
  editing at once overwrite each other. An account now holds several beats,
  but the machine still works on one at a time.
- **Stack items not used yet.** The build spec lists TanStack Query and
  Vercel Blob. Neither is installed: the account and shop modals fetch by
  hand, and a saved beat is a row in Postgres, not a file.
- **A grid view.** The earlier build had a second editor showing every track
  at once. It was removed so that the panel is the whole machine; one may
  come back as a view of the same project.
- **The art's licence.** РИТМ-12's picture is the owner's own artwork and no
  licence has been chosen for it.

## Product

Out of scope for v0.1 and not started: background sync and merging, user
sample upload, the portable `.boombapbot` bundle with bundled samples, a mixer
and effects beyond the machine's own knobs, stems, paid effects and billing,
signing, store submission, release metrics.
