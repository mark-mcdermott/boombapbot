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
     the picture. The owner finds the panel nice as it is (2026-11-18), so
     this is not asked for; one painted plate with no controls on it would
     replace them if it ever is.
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
2. **A closer listen.** The owner went through the eight instruments and
   says they are all good (2026-11-18). They were set by measurement more
   than by ear, and so were the four effects, which the owner has not said
   they went through one by one.
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
   The owner has not read that wording. Since 2026-11-18 as well:
   - Storage that is missing from the start (a private window that blocks
     it, or `localStorage` that throws) is reported as soon as the editor
     opens, with the same line and state as a failed write. A shell that
     hands in its own store is not affected.
   - In the phone and desktop apps the draft lines say "on this device"
     instead of "in this browser", the line for a failed write reads "This
     device is not saving drafts. Export the project to keep it.", and the
     closing note names only the export, with no account or footer.
   - The closing note leaves out "Your beat is saved … as you go" while the
     draft cannot be written.
   - The list of keyboard keys is hidden where nothing but a touchscreen
     points (no mouse or trackpad), so a phone does not show it and an iPad
     with a trackpad does.
   - The notice for a draft that could not be read says the draft "was set
     aside, not deleted" instead of "kept in this browser", in every shell.

   Unit tests cover the wording in both kinds of page and the missing
   storage, and a Playwright test on the site blocks `localStorage` before
   the page loads and checks the sheet. Playwright checks the keys are
   listed on a desktop browser and hidden on a phone-sized touch screen
   (Chromium's Pixel 7). Neither app was opened to look at the sheet; the
   owner has not read the new wording for the apps.
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
  - **The count and the insert are one statement**, since 2026-11-18. A
    `beat_counts` table holds how many beats each account has; a save
    raises it only while it is under the limit and inserts the beat only if
    it rose, and a delete lowers it in the statement that deletes the beat.
    Two saves at once queue on the account's row, so they cannot both take
    the last place. **Its migration has not been run.**
    `apps/site/drizzle/0005_beat_counts.sql` adds the table and counts the
    beats already saved; run it with `pnpm db:migrate` after the code is
    merged and before it is deployed, because the new code fails to save or
    delete without the table. A beat the old code saves between the
    migration and the deploy is not counted, which would let that account
    hold one more. Checked in the tests (thirty saves sent at once stop at
    twenty, and a delete gives back one place) and against a real Postgres
    17 with thirty sessions at once: the new statement stopped at twenty
    and the count matched the rows, where the old count-then-insert let all
    thirty in. The tests' in-process database runs one statement at a time,
    so the race itself is shown only by that Postgres run.
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
- **Rate limiting.** Better Auth's limiter is on in production. It counted
  in memory, which on Vercel means each server kept a count of its own.
  Since 2026-11-18 the code counts in the database, in a `rate_limits`
  table, so every server counts together: three tries at logging in or
  signing up in ten seconds from one address, three requests for an email
  in a minute, a hundred of anything else in ten seconds.
  - **The migration is run.** `apps/site/drizzle/0004_rate_limits.sql`
    adds the table. It was run on Neon on 2026-11-18 (US Central), with
    `pnpm db:migrate`, after the code was merged and before it was
    deployed. Neon's record of migrations held the four before it, so only
    this one was applied. The table was checked afterwards: its columns,
    the identity `id`, the unique `uuid` and `key` are as the migration has
    them, it was empty, and the seven tables that were there hold the rows
    they held before.
  - Asking who is logged in is not counted. Every page asks it as it
    loads, and counting it would write to the database for each visitor.
  - **A visitor's address reaches Better Auth on Vercel.** It reads
    `x-forwarded-for` and trusts it only when it holds a single address;
    where it finds none, every visitor would share one count for each
    route, which with the count in the database is one count for the whole
    site. Checked on the live site on 2026-11-18, after the deploy: one
    log-in with a made-up account was answered "wrong password", and the
    row it left in `rate_limits` was keyed by the caller's own IPv4
    address. Asking who is logged in still answered and left no row.
  - Better Auth clears old rows away itself as new ones are counted.
  - The routes outside `api/auth` (saved beats, the shop, the upgrade) are
    not covered by it.
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
  - **What is paid is decided,** on 2026-11-18: extra effects, new ones
    beside the four the machine has, which stay free. They are fully gated:
    someone who has not upgraded cannot hear them. They are six, chosen by
    the owner the same day: a crusher, tape, a pump, a filter, vinyl and a
    phaser. Nothing reads `isUpgraded` yet. The six are built in the engine
    (2026-11-18) and nowhere else: no control reaches them and РИТМ-12's
    document cannot name them, so nothing a visitor has changes. They pass
    the engine's tests, natively and in WebAssembly alike. How each sounds
    was set by measurement and nobody has listened: the crusher's rate and
    levels, tape's drive and wobble, how deep the pump ducks (it halves the
    loudness of the test beat at full), the filter's range and ring,
    vinyl's hiss and pops, the phaser's sweep. Still to do before they are
    sold: the owner listens and they are tuned; РИТМ-12's document takes
    them (a schema change, with its step and fixture); they are gated; and
    they get a place on the machine. Still to settle:
    where they sit on the machine, whose painted effect switch has four
    positions (a unit of their own beside it, or the same switch stepping
    on); whether a key alone unlocks a device with nobody logged in; and how
    a paid effect behaves with no server, since the machine has to work
    without one.
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
  - **The key-by-email route is limited and answers alike**, since
    2026-11-18. One address can be asked about three times an hour, and one
    visitor's address can ask five times in ten minutes; past that the
    answer is 429 `too_many`. Both are counted in the `rate_limits` table
    the way Better Auth counts, with the visitor's address worked out as
    Better Auth does, and the email address is counted by its hash. The
    keys are looked up and sent after the answer has gone (`waitUntil` from
    `@vercel/functions` keeps the function alive for it on Vercel), so the
    answer is the same, and as quick, whether or not the address bought
    anything; a failed send is logged. No migration. Checked in the tests,
    including on a server whose email always fails, where a buyer and a
    stranger get the same status, headers and body. Not yet tried on
    Vercel itself.
  - The beat limit is counted and raised in one statement now (see saved
    beats above), so a paid upgrade can raise it.
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

## Native shells

Both shells reuse two things that exist today: the engine's C ABI
(`engine/include/boombapbot/engine.h`) and the shared editor
(`packages/editor`). The editor reaches audio only through
`AudioController` (`packages/editor/src/engine/audio-controller.ts`), whose
message set is `packages/editor/src/engine/messages.ts`. A native shell
replaces that one class with a bridge that sends the same messages to a
native engine instance.

The way in for that bridge is built. `BoombapbotEditor` takes `audio`, and
the runtime plays through whatever controller it makes. A shell hands in
`NativeAudioController` (`packages/editor/src/engine/native-audio.ts`) and
fills in four calls for it, `open`, `send`, `listen` and `close`
(`NativeEngineBridge`). It is sent `NativeEngineCommand`: a sound as its
knobs, for the engine to synthesise at its device's rate, and the effect by
the engine's number. When the bridge makes its engine again by itself, it
reports `ready` with the new rate and the runtime tells the new engine the
beat again. Unit tests hold this with stand-in controllers and a fake
bridge (`packages/editor/test/audio-seam.test.ts`). The web build goes on
making its own `AudioController`, and every unit and browser test it had
passes unchanged. The desktop app is the first real engine behind it.

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

The native audio bridge is built for both phones: a Capacitor plug-in in
`apps/mobile/native-engine` that fills in `NativeEngineBridge`. On iOS the
engine is built by the repository's CMake as an XCFramework,
`AVAudioSession` is set for playback, and an `AVAudioEngine` whose
`AVAudioSourceNode` render block calls `snare_engine_render` plays it. On
Android the same CMake builds it with the NDK (r27d, installed on
2026-11-18), and an Oboe stream's data callback calls `snare_engine_render`,
with audio focus and changes of device handled. Sounds are synthesised by
the engine at the phone's rate. On 2026-11-18 it ran in an iPhone
simulator and an Android emulator: the machine shown, a beat playing
through it, the engine's own peak at 0.66, and the engine made again
halfway with the beat playing on. On the emulator a faked phone call
stopped the beat and play started it again. Nobody has listened to it, and
it has not been on a phone. `apps/mobile/README.md` has what was checked
and how.

What is left:

- **Real phones**, and listening to them. A simulator cannot ring, take a
  call, have headphones pulled or a Bluetooth route chosen, and the
  emulator only fakes a call, so most of what the plug-in does then is
  built and has not run.
- **32-bit Android phones**: the library is built for `armeabi-v7a` and
  `x86` as well as `arm64-v8a` and `x86_64`, with no warnings and no
  locking atomics, but nothing 32-bit has run. The emulators on an Apple
  silicon Mac are 64-bit only; the plug-in's 6 tests pass on the arm64 one.
  A 32-bit ARM phone is the test. `apps/mobile/README.md` has the details
  and the size change.
- **Background playing.** Built on 2026-11-18, as decided: a beat that
  plays keeps playing when the app leaves the front or the screen locks.
  On iOS the app has the `audio` background mode, shows the beat in Now
  Playing and takes a pause from there; on Android a foreground service of
  the media playback type keeps the app alive while the beat plays, with a
  media notification whose pause stops it. Either way the pause stops the
  beat in the plug-in and tells the page, and the page is told the step
  again when the app comes back. Once stopped there is nothing to press
  play on: playing again is done in the app. It ran in the iPhone
  simulator and the Android emulator: the engine rendered in real time out
  of the front and behind the lock screen, the pause stopped it, and the
  page matched on return, playing or stopped. Not tried: real phones, a
  real call out of the front, headphones or Bluetooth out of the front, how
  long a phone lets it play, and what it costs in battery. In the
  simulator iOS did not suspend the app after the beat stopped out of the
  front, though the plug-in lets go of the sound then; a phone may differ.
- **CI runs the plug-in's tests, not the app.** Since 2026-11-19
  `.github/workflows/native.yml` builds the engine for iOS as an
  XCFramework on a macOS runner and runs the plug-in's 6 Swift tests in an
  iPhone 17 Pro simulator, and builds the Android plug-in with the NDK and
  CMake its `build.gradle` pins, for all four of its ABIs, and runs its 6
  instrumented tests in an x86_64 emulator (API 35, through
  `reactivecircus/android-emulator-runner`), which runs only the 64-bit
  library: the 32-bit ones are built in CI and not run.
  It runs when the engine, the plug-in, the workflow or the lockfile
  change, and by hand. It does not build the app for either phone or run
  its check, and the tests make no sound.

### Tauri (Windows and macOS)

A first slice is built in `apps/desktop`, for macOS: the editor with
РИТМ-12 in a Tauri window, playing through the engine built natively by the
repository's CMake and a CPAL output stream. On 2026-11-18 it ran on the
Mac it was built on, from the dev server, as a debug build and as the
release `.app`: the window shows the machine, a beat plays, and the
engine's own numbers say the output was not silent. Nobody has listened to
it. `apps/desktop/README.md` has what was checked, how, and what was not.

What is left:

- **Listen to it.** Everything known about its sound is numbers.
- **A real change of sound device.** Pull headphones out, plug a 44.1 kHz
  interface in, change the rate in Audio MIDI Setup. The app is built to
  make the engine again at the new rate and have the page tell it the beat
  again, and that was run only by making the app behave as if the device
  had said so. CPAL 0.18 follows the default device by itself and says
  when it has; whether the beat carries on cleanly through that is untried.
- **The dialog that asks where to keep an export.** It has never been on a
  screen: the check writes exports to a folder of its own in place of
  asking. Import, which opens the system's file chooser, is untried too.
- **Windows.** It compiles and its Rust tests pass in CI, since
  2026-11-19, on `windows-latest` with MSVC from Visual Studio 2026 and
  CMake 4.4: the engine is built by its CMake (which gives MSVC its own
  warning, float and UTF-8 flags) and linked, `tauri build --no-bundle`
  makes `boombapbot-desktop.exe`, and `cargo test`'s 9 tests pass. Nobody
  has run the app on a Windows machine or listened to it, so WASAPI
  output through CPAL, the page in WebView2, a change of device and the
  exports are untried there. The engine's CTest suites and the
  native-against-WASM comparison have not been run with MSVC. There is no
  installer: the bundle's only target is the macOS `.app`.
- **CI builds the app, and does not play it.** `.github/workflows/native.yml`
  builds it on macOS (`tauri build`, the `.app`) and on Windows and runs
  `cargo test` on both, when the engine, the app, the workflow or the
  lockfile change, and by hand. It does not run `check:run`, which needs a
  sound device, so nothing in CI plays the app, and nothing it builds is
  kept.
- **How long a tap takes to sound.** The stream asks for buffers of 256
  frames and got them on the Mac's own speakers; a tap also crosses Tauri's
  bridge and waits for the next buffer. Not measured, and not compared with
  the web view.
- **The draft is in the web view's storage,** under the app's identifier.
  The phone app keeps its draft in the device's own store for a reason that
  may apply here: find out whether macOS ever clears it.
- **Signing and notarising**, for anyone else to open it without a warning:
  an Apple developer team and a Developer ID certificate, which are the
  owner's. The identifier `com.boombapbot.desktop` and the icon (the phone
  app's stand-in) are stand-ins as well.
- **Accounts, saved beats and the shop** are left out, as in the phone app,
  and for the same reasons: they ask the page's own address for `/api/...`.

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
  thread. A WAV export renders in a Worker. Since 2026-11-18 where a render
  stands shows outside the settings sheet too: with the sheet closed, a chip
  at the foot of the screen counts the render up, says when it is saving,
  then says it is done or failed and goes, after five seconds or eight. It
  is a button that opens the sheet, and a polite live region tells a screen
  reader when a render starts and how it ends. It mounts with the modals,
  not in the footer, so a shell's own `below` has it as well. A Playwright
  test holds the Worker up, closes the sheet and follows the chip from
  rendering to done and then gone, on a desktop and on a phone's width; the
  accessibility scan passes with it showing. It has not been seen in the
  phone or desktop app. A menu item that is switched off has had a look of
  its own since 2026-11-18: its name dimmed, no hand over it, and its note,
  which says why, as legible as before.
- **Draft storage.** Since 2026-11-18 the web editor keeps its draft in
  IndexedDB (`packages/editor/src/state/drafts.ts`): one record for each
  project id, and a note of which one each machine is working on. The
  machine still works on one draft at a time. A beat it moved away from
  stays in the database, and nothing lists those yet; a list of projects is
  the owner's to design. A write waits for 400 ms without a change, and
  never more than 2 seconds, so a knob drag is not written on every move. A
  waiting write goes at once when the page is hidden or closed. A draft
  left in `localStorage` moves across on the first visit, and the old copy
  is removed only once IndexedDB has it; one left by the earlier machine is
  read and left where it was. Where IndexedDB is missing or refuses, the
  settings sheet says the browser is not saving drafts, the same line as
  for missing storage before.
  - **Two tabs.** One tab owns the draft, held by Web Locks; a
    BroadcastChannel carries the hand-over, and settles the owner on its own
    where Web Locks are missing. A tab that opens the draft while another
    owns it says "This beat is open in another tab, which is saving it.
    Changes here are not saved.", and writes nothing. Its button, "Work in
    this tab", has the owner write what it has and stop; that beat comes
    onto this tab as one undo step, with "This tab is saving the beat now.
    It has the other tab’s changes; Undo brings back what was here." A tab
    that does not answer within 1.5 seconds has the draft taken from it.
    Nothing is merged, and a tab is never handed the draft without asking.
  - The phone app's device store, or any store a shell hands in, works as
    before and has no tab rule. The desktop app uses the web view's
    IndexedDB.
  - Verified by Vitest, against `fake-indexeddb`, and by Playwright in
    Chromium: a draft moved out of `localStorage`, IndexedDB refused and
    full, a change kept when the tab closes straight after it, and two
    pages in one browser (the second told, writing nothing, then taking
    over with the first one's newest change). Not tried: WebKit and
    Firefox, a real private window, the desktop app, and a tab frozen in
    the background.
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
sample upload, the portable `.boombapbot` bundle with bundled samples, a
mixer, stems, signing, store submission, release metrics.

Started, and open to nobody yet (both under "Upgrade" above):

- **Paid effects.** Six effects for the upgrade are built in the engine
  (2026-11-18): a crusher, tape, a pump, a filter, vinyl and a phaser. No
  control reaches them, a project cannot name them, and nothing gates them.
- **Paying.** The build spec's billing is, by the owner's decision, a flat
  one-time upgrade with no subscription: a Stripe checkout, a license key
  and `isUpgraded` on the server, and the modal. It is built and switched
  off (`UPGRADE_OPEN`), and has run against Stripe's stand-in in the tests,
  never against Stripe itself.
