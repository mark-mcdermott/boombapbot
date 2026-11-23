Rosetta. On the same day the owner tried it in FL Studio 2026 and it worked:
see the first item below for what was and was not settled. Nobody else has
loaded it and no other host has.

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
    the last place. **Its migration is run.**
    `apps/site/drizzle/0005_beat_counts.sql` adds the table and counts the
    beats already saved. Looked at on 2026-11-22: the real database has the
    table, and its counts add up to the beats saved, so none was saved
    uncounted between the migration and the deploy. Checked in the tests
    (thirty saves sent at once stop at twenty, and a delete gives back one place) and against a real Postgres
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
    (2026-11-18): no control reaches them, so nothing a visitor has
    changes. They pass
    the engine's tests, natively and in WebAssembly alike. How each sounds
    was set by measurement: the crusher's rate and levels, tape's drive and
    wobble, how the pump ducks, the filter's range and ring, vinyl's hiss
    and pops, the phaser's sweep. The owner listened on 2026-11-22: four
    were decent, and tape and the pump could not be told from the dry beat
    on a kick. Both were made stronger the same day and have not been heard
    since. Tape is driven about twice as hard, with more wobble and less
    top. The pump was a compressor on the low end, which only made a kick
    quieter; it now ducks on each low hit (about 8 dB under a kick at full)
    and is back, and a little over, while the hit still rings. To hear them, `pnpm audition`
    renders a beat through each, half on and full on, into
    `build/auditions`. Still to do before they are
    sold: the owner listens and they are tuned; they are gated; and
    they get a place on the machine. РИТМ-12's document takes them since
    2026-11-23: a beat can name any of the six, and a program that does not
    hold the upgrade opens it, plays it without that effect, and says so
    (`engineSetup`, `holdsUpgrade` in the machine's `src/upgrade.ts`, which
    since 2026-11-23 answers yes where the device keeps a license file
    that checks out, and no in the plugin, which reads none). The
    schema is version 4 for it, by the owner's decision. A beat of
    version 3 is brought up to date as it is read, with nothing lost
    (`fixtures/version-3.project.json`); a program from before version 4
    refuses any beat saved since, and the plugin reads both. The selector reaches only the four without the upgrade
    and all ten with it, so only an upgraded device writes such a beat. The plugin loads one with its effect off and
    says which effect that was, but does not keep the name: saved from the
    plugin, the beat has no effect. The six names on the label are
    stand-ins. Where they sit was decided by the
    owner on 2026-11-22 and the picture's unit is built for it: the effect
    selector now turns a whole circle shared evenly among the effects there
    are, four now and ten with the upgrade, beside a window that shows the
    effect's drawing and name. What that leaves for the six: a drawing and
    a Russian name each, which are the owner's. The phone's panel has the
    same selector and window behind its effect tab. Nobody has looked at
    either on a real screen, only in the tests' browser.
  - **One upgrade for everything.** Decided by the owner on 2026-11-22: the
    same five dollars unlocks the paid effects in the VST3 plugin too, and
    in the apps on both stores. None of it is built. How it works was
    agreed by the owner the same day:
    - The server hands out a signed license file when a key is entered or
      an account logs in, and each program checks the signature with a
      public key built into it. That answers both questions above: a key
      alone unlocks the desktop app and the plugin, and nothing needs the
      server afterwards. The desktop app and the plugin read the file from
      one place, so unlocking one unlocks the other on that machine.
    - In the store apps the upgrade is the store's own in-app purchase, one
      product bought once, with "Restore purchases" on iOS. The app sends
      the store's receipt to the server, which checks it with Apple or
      Google itself and makes the same license a Stripe payment does. The
      store apps unlock by logging in, never by a typed key: Apple's review
      guideline 3.1.1 names license keys as something an app may not unlock
      with. A purchase made in a store app reaches the site, the desktop
      app and the plugin once its buyer logs in.
    - A beat that uses a paid effect, opened without the upgrade, plays
      with that effect off and says so. It is never refused.
    - No limit on devices.
    - A refund marks the license so that it cannot be fetched again; files
      already on a machine keep working, since withdrawing them would mean
      licenses that expire and need the server.
    - The stores' cut and their rules on linking out to another checkout
      were not checked and change by country; check them when this is built.
    - **The license file and the server's side of it are built**, on
      2026-11-22, and nothing uses them yet. The format is in
      `docs/license-file.md`: one line, a JSON payload (version, license
      id, when it was issued, what it unlocks) and an Ed25519 signature
      over the bytes as they are in the file, with no expiry.
      `POST /api/upgrade/license` gives a file for a key alone and
      `GET /api/upgrade/license` gives one to an upgraded account;
      `verifyLicenseFile` in `packages/contracts` checks one. Checked in
      the unit tests (changed, cut short, wrong key, wrong version, and
      against Node's own Ed25519) and against the built server with its
      database in memory. What is left, in order:
      - **The migration is run.**
        `apps/site/drizzle/0007_license_withdrawn.sql` adds `withdrawn_at`
        to `licenses`. It was run on Neon on 2026-11-22, before the code was
        deployed: eight migrations are applied, the column is there, and
        every table holds the rows it held before.
      - **The real key pair is made**, on 2026-11-22. The signing half is
        in Vercel as `LICENSE_SIGNING_KEY` and nowhere else; the public
        half is `LICENSE_PUBLIC_KEY` in
        `packages/contracts/src/license-file.ts`, and goes into the plugin
        when its check is written. The two halves go together: on
        2026-11-23 the live site's page kept a file the live server signed
        (see below). Losing the signing key
        means a new pair and new builds of every program; files signed
        with the old one stop verifying in them.
      - Nothing sets `withdrawn_at`. The Stripe webhook still has no case
        for a refund, and a withdrawn license still counts as upgraded on
        the site (`isUpgraded`) and still shows its key.
      - **The site, the desktop app and the phone apps fetch, keep and
        check a file**, since 2026-11-23
        (`packages/editor/src/upgrade/device-license.ts`). A page that
        finds an upgraded account logged in, or has just put a key on one,
        asks `GET /api/upgrade/license`, checks the file against the
        built-in key and keeps it in the browser's storage; РИТМ-12 then
        reaches and plays the six. Checked in the unit tests, and in a
        browser against the built server, where the test server's file,
        signed with another key, is fetched and not kept. The unlocked path
        was run once by hand in a browser with a page built for a
        throwaway pair: four effects before, ten after, and still ten
        offline and logged out. **It works on the live site**: on 2026-11-23 the
        owner gave their own account a license by adding a row to
        `licenses` by hand on Neon (its `stripe_session_id` starts
        `manual_`, since no payment made it), logged in on the site, and
        the selector reached all ten effects, each of which played. Logged
        out, it reached four again; logged in with the network off and the
        page reloaded, it still reached ten. Not tried there: a key alone,
        which the site's modal offers only while the upgrade is open; a
        license made by a payment; and the desktop and phone apps. What is
        left of it:
        - **A key alone unlocks the site and the desktop app**, since
          2026-11-23: typed with nobody logged in, it fetches its file
          (`POST /api/upgrade/license`) and goes onto no account. The
          desktop app has the upgrade's modal for it, which sells nothing
          and takes a key whether or not the upgrade is open. The phone
          apps have no modal and unlock by logging in only.
        - The plugin reads no file and its C++ check is not written. The
          desktop app keeps its file in its web view's storage, where the
          plugin cannot read it; the one place they share is not chosen.
        - The phone apps keep the file in the web view's storage, which
          the system may clear. Logging in fetches it again.
        - **A device is locked the way it was unlocked**, decided by the
          owner on 2026-11-23. One an account unlocked has its file removed
          when the server says nobody is logged in: after a log-out, a
          deleted account or a session that ran out. One a typed key
          unlocked stays unlocked until "Remove the key" is pressed in the
          modal. A server that cannot be reached locks nothing. Run once by
          hand in a browser with a page built for a throwaway pair: on the
          site, four effects, ten with a key alone, ten after a reload with
          the server cut off, four once the key was removed; ten logged in
          to an upgraded account and after a reload, four after logging
          out; and on the desktop app's page, four, then ten with a key
          alone. Left of it: a tab open while another tab logs out keeps
          its effects until it next asks who is logged in; and a beat left
          on a paid effect when the device is locked keeps the name and
          plays without it.
        - The desktop app's modal has not been seen in the app's own
          window, only as its page in a browser. Its "I lost my key" and
          an upgraded account's key are the site's, untried there.
        - A logged-in account that has not upgraded is asked about once
          for each page it opens, and answered 404.
        - Nothing gates the six effects on the server: a beat that names
          one is saved and loaded for anybody, and plays without it.
      - The key route's limit, ten tries in ten minutes from one address,
        has run on the test server and not on Vercel. Its refusal borrows
        the words of the key-by-email limit, which say "an hour".
      - Both routes answer whether or not the upgrade is open, like the
        routes that enter and recover a key.
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
  native-against-WASM comparison have not been run with MSVC. Since
  2026-11-20 the bundle has an NSIS installer for Windows and a `.dmg` for
  macOS, and CI keeps both as artifacts for seven days. Neither is signed,
  and the installer has not been run on a Windows machine. A Mac does not
  build the Windows one; `apps/desktop/README.md` says what that would take.
- **CI builds the app, and does not play it.** `.github/workflows/native.yml`
  bundles it on macOS (the `.app` and the `.dmg`) and on Windows (the
  installer) and runs `cargo test` on both, when the engine, the app, the
  workflow or the lockfile change, and by hand. It does not run `check:run`,
  which needs a sound device, so nothing in CI plays the app.
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

### VST3 (a plugin for a host)

The first slices are built in `plugins/vst3`: РИТМ-12 as a JUCE 8.0.17 VST3
instrument on the engine built natively. Notes from the host play the
voices, the knobs are host parameters, a beat saved from the site loads and
its patterns play in time with the host's transport, its window is the
machine's painted panel in a web view with step keys to write a pattern on,
and a beat goes back to the site as a file or into the host as MIDI. `plugins/vst3/README.md` has what it
does, what was checked, how, and what was not.

Everything known about it comes from tests: a self-test that drives the
plugin without a host, JUCE's own VST3 host playing the built bundle, a trap
for heap use on the audio thread, and the sanitizers. On 2026-11-22 all of
them passed on the Mac it was built on, as arm64 and as x86_64 under
Rosetta. On the same day the owner loaded it in FL Studio 2026: it scans and
opens, the panel shows, notes play the eight voices and a parameter follows a
hardware controller. That is steps 1 to 3 below; the rest are still to do.

What is left:

- **MIDI into FL Studio.** The owner went through the nine steps of trying it
  in FL Studio 2026 (26.1.7, under Rosetta) on 2026-11-22, and they held: it
  scans and opens, notes play the voices, a parameter follows a hardware
  controller, a beat loads and its pattern plays with FL's transport, the step
  keys, dice and undo work while it plays, a project saved and reopened comes
  back, a saved beat opens on the site, and the window resizes. The ninth
  took finding. Dragging the MIDI key onto FL's playlist shows FL's paintbrush
  and drops nothing, and so does dragging the saved `.mid` there from the
  Finder, so the plugin's drag does what the Finder's does and the playlist
  is not where FL takes a MIDI file. The Channel Rack is: the MIDI key dragged
  straight onto it imports the pattern, and so does the saved `.mid` from the
  Finder. So all nine held, once the right place to drop was found. An
  automation clip, as against a linked controller, is untried.
- **A build FL has seen before.** FL crashed the first time, as the plugin was
  added: its plugin database still held the earlier spike's class ID under the
  same name. `plugins/vst3/README.md` says how to clear it.
- **A closed hat that may go missing.** On 2026-11-22, with a beat of eight
  closed hats to the measure looping in FL's pattern mode at 99 and 100, the
  owner sometimes did not hear the hat on the fifteenth step, in some passes
  and not others. It was not pinned down: it may be how FL reports its
  position near the loop point, how a voice cuts its own last hit, or
  nothing. If it comes back, a build that writes what the host says at every
  block to a file is the way in.
- **Listen to it.** The tests compare samples. A knob turned while its voice
  rings changes the next hit and not the ringing one; nobody has judged how
  that feels under automation, or how the delay sounds when the tempo moves.
- **`pluginval`.** Steinberg's validator runs in CI and passes; `pluginval`
  has not run. It is a download, and it drives a plugin in ways the validator
  does not.
- **JUCE's licence.** Chosen by the owner on 2026-11-22: JUCE's commercial
  licence on its free Starter tier, not the AGPLv3, because the upgrade's
  paid effects are to be gated in the plugin. JUCE's licence lets a product
  be sold on that tier and asks for no source. The plugin is on JUCE 8.0.17,
  whose VST3 SDK is 3.8 under the MIT licence, so nothing has to be signed
  with Steinberg. What is left before a build is given to anyone: a notices
  file with the SDK's licence in it, which the MIT licence asks for, and a
  read of Steinberg's guidelines on the VST name and logo. And watch the
  tier's limit of 20,000 dollars a year: the owner sells as a
  person, so it counts what the use of JUCE brings in, and forming a company
  would make it count everything the company receives.
  `plugins/vst3/README.md` has the detail under "Licensing".
- **Measures and the host's time signature.** A measure is four of the host's
  beats counted from the start of its timeline, whatever its signature says.
  In 3/4 the pattern runs across the bar lines. Whether it should restart at
  each bar is a choice nobody has made.
- **The painted window in a host.** Since 2026-11-22 the plugin's window is
  the painted panel in a web view, with a bar under it for the beat's name,
  its files and undo; the owner tried the first cut of it in FL Studio that
  day and chose it, and then tried the finished window there too: the name
  can be typed without FL's shortcuts firing, undo, load and save work, and
  a click on the MIDI key saves a `.mid` that is right. What is left:
  - **Dragging the MIDI key out of the window does not work.** Tried by the
    owner in FL Studio on 2026-11-22: nothing is carried out. From a web
    view the drag is started by the plugin once the page says the key is
    being dragged, with the mouse button still down, and that does not take;
    why has not been looked into. The owner is not asking for it now. Until
    it is mended the way into FL is the click, which saves the file, and the
    Finder. The panel drawn in code drags.
  - In FL nobody has watched the meter or recorded a knob as automation, and
    whether a click in the web view keeps FL's own shortcuts (the space bar
    for play) from it until FL's window is clicked again is not known.
  - Several instances, each with a web view and its processes; a screen that
    is not Retina.
  - Windows needs Microsoft's WebView2, at build time and on the user's
    machine. Linux needs WebKitGTK.
- **The panel drawn in code** is still in the plugin, behind
  `-DBOOMBAPBOT_VST3_WEB_PANEL=OFF`, with its tests. Once the painted window
  has been lived with it can be taken out; that is the owner's to say.
- **CI does not see the panel change.** The native workflow runs when
  `plugins/vst3` changes, not when `packages/editor` or
  `packages/machine-ritm12`'s panel does, though the plugin's page is built
  from both. A change there that breaks the plugin's window is only caught
  the next time the workflow runs. Widening its paths would also run the
  desktop, phone and WebAssembly jobs on every change to the panel.
- **Other hosts, formats and platforms.** Only macOS has built it and CI
  builds it there alone. Windows, Linux, an Intel Mac, AU and CLAP are
  untried.
- **Signing and notarising**, for anyone else to load it without a warning:
  the bundle is signed ad hoc, which loads on the Mac that built it. The
  plugin's codes (`Bmbp`, `Rt12`) and its bundle identifier are stand-ins
  until a build is released, and cannot change after.
- **Beats from an account.** Only a file on disk loads. Saved beats live
  behind the site's `/api/...`, as they do for the phone and desktop apps.

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
  control reaches them. A project can name one, and it plays only where the
  upgrade is held, which is nowhere yet.
- **Paying.** The build spec's billing is, by the owner's decision, a flat
  one-time upgrade with no subscription: a Stripe checkout, a license key
  and `isUpgraded` on the server, and the modal. It is built and switched
  off (`UPGRADE_OPEN`), and has run against Stripe's stand-in in the tests,
  never against Stripe itself.
