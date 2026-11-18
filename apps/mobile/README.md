# boombapbot on a phone

The shared editor with РИТМ-12 inside a Capacitor shell, for iOS and
Android. Bundle id `com.boombapbot.app`, shown under its icon as
"boombapbot". This is the first slice: the machine, its settings and a
draft kept on the phone. It is not ready for either store.

## What is here

- `src/main.tsx` mounts `BoombapbotEditor` with РИТМ-12, the same way
  `apps/site/src/components/Machine.tsx` does, with three differences: the
  draft goes to the device's own store, an export goes to the phone's share
  sheet, and under the machine there is only the settings button.
- `src/device-storage.ts` puts the device's store (UserDefaults on iOS,
  SharedPreferences on Android, through `@capacitor/preferences`) behind the
  `KeyValueStorage` the editor asks for. A web view's own storage can be
  cleared by the system; this stays until the app is deleted. Its tests
  are `test/`.
- `src/share-file.ts` is where an export goes. A web view inside an app
  ignores a download, so the file is written to the app's cache folder
  (`@capacitor/filesystem`) and handed to the share sheet
  (`@capacitor/share`), from where it is saved to Files or sent to another
  app. Closing the sheet without choosing is not an error, and the settings
  sheet then does not say a WAV was exported.
- `scripts/copy-assets.mjs` copies the engine, the worklet and the panel art
  from where `scripts/prepare-assets.mjs` put them for the site, so the app
  ships the files the site serves. `public/` is generated and ignored.
- `ios/` and `android/` are the native projects Capacitor made. They are
  committed. `cap sync` rewrites `ios/App/CapApp-SPM/Package.swift` and the
  copies of the web build inside them.

Sound is the web view's own: the same AudioWorklet and WebAssembly engine
as the site. There is no native audio code.

Accounts, saved beats, the shop and the upgrade are left out on purpose, and
so are the footer's pages. Nothing in the app talks to a server.

## Running it

At the repository root, once the engine is built (`pnpm build:wasm`):

```bash
pnpm prepare:assets
pnpm --filter @boombapbot/mobile sync      # web build, then copy into ios/ and android/
pnpm --filter @boombapbot/mobile ios       # needs Xcode; asks which simulator
pnpm --filter @boombapbot/mobile android   # needs Android Studio's SDK and an emulator or a phone
```

`pnpm --filter @boombapbot/mobile dev` serves the page alone on port 4331;
in a browser the draft falls back to that browser's storage.

Checks: `pnpm typecheck` and `pnpm test:unit` at the root cover this
folder with the rest, and so does CI. CI does not build the native
projects: iOS needs a macOS runner.

## What has been checked

On an iPhone 17 Pro simulator, iOS 26.4, with Xcode 26.4, on 2026-11-17:
the app launches and shows the machine; the dock's Play starts the engine
(audio running at 48 kHz, the step moving, output peaking at 0.66, iOS
showing its playing indicator); a step added to the pattern is still there
after the app is quit and opened again, and the draft is in the app's
UserDefaults; the settings sheet opens.

Export, on the same simulator: WAV loop opens the share sheet with the
file, and "Save to Files" leaves a 24-bit stereo WAV of one measure in the
Files app; the MIDI file and the project file open the sheet with theirs;
closing the sheet without choosing leaves no "WAV exported" line and no
error.

`./gradlew assembleDebug` builds the Android app. It has not been run on
an emulator or a phone.

Nobody has listened to it or held it. Not checked: a real iPhone, a real
Android phone, an iPad, the ringer switch, a phone call or another app
taking the sound, the app coming back from the background, long playing.

## What is not right yet

- **Export on Android is untried.** It is built on the same two plug-ins
  and compiles, but no Android share sheet has shown a file from it.
- **Exports pile up in the cache.** Each one is written to the app's cache
  folder under its beat's name and left there. The system may clear that
  folder, and a second export of the same beat writes over the first.
- **While the share sheet is open** the settings sheet behind it still says
  "Rendering the WAV… 100%".
- **Import has not been tried.**
- **Words written for the site.** The settings sheet says the draft is
  saved "in this browser" and lists keyboard keys.
- **Sideways on a phone** the brand takes about a third of the screen and
  the machine is taller than what is left, so it scrolls.
- **The brand** is the site's header with its link switched off.
- **The icon and the launch screen** are stand-ins: the three bars of the
  site's favicon on the page's dark background. Yours replace the images in
  `ios/App/App/Assets.xcassets` and `android/app/src/main/res`.
- **The ringer switch.** The page asks iOS to treat its sound as playback
  (`navigator.audioSession`), which should keep it sounding with the switch
  on silent. A simulator has no switch, so this is untried.

## What is left before a store

### Android

- Run it: an emulator (none is set up on this Mac) and a real phone. The
  Galaxy S9 that played the site is the one to try first, for stutter.
- A release build needs an upload key and Play App Signing. The key is
  yours to make and keep; it must never be committed.
- `versionCode` and `versionName` in `android/app/build.gradle` are still 1
  and "1.0". Every upload to Play needs a higher `versionCode`.
- Play only takes apps that target a recent API level. The project targets
  36; check the rule of the day before the first upload.

### A native audio bridge

The web view's audio is good enough to start with and has limits a
plug-in would remove: the delay between a tap and its sound, which is
longest on Android; sound stopping when the app is not in front; and no
say in what happens on a call or when headphones are pulled.
`docs/follow-ups.md`, "Native shells", has the design: a Capacitor plug-in
that takes the `EngineCommand` messages of
`packages/editor/src/engine/messages.ts` and drives the C++ engine with
AVAudioEngine on iOS and Oboe on Android, in place of `AudioController`.
`AudioController` is made inside `EditorRuntime` today, so the runtime needs
a way to be handed another one.

### Accounts in the app

Left out of this slice. To bring them in:

- The account, saved beats and shop code all ask the page's own address for
  `/api/...`. In the app that address is the app itself, so each needs to be
  told where the site is.
- The site has to let the app in: its log-in keeps a cookie for
  `boombapbot.com` and checks where a request came from, and the app's
  pages come from `capacitor://localhost` on iOS and `https://localhost` on
  Android. That is a change to `apps/site/src/server/auth.ts` and a deploy.
- **Deleting an account.** Apple and Google both require that an app where
  an account can be made lets it be deleted from inside the app. The
  account modal already has that step, so it comes along when the modal
  does; it has to be reachable without leaving the app. Google also asks,
  in the Data safety form, for a web address where someone can ask for
  deletion without the app; the site's account modal can be that.
- **The upgrade.** Apple's rules want its own in-app purchase for
  unlocking features inside an app, with exceptions that differ by country,
  so the planned five dollars through Stripe needs a decision before it is
  offered in the iOS app. The shop sells physical things, which may be paid
  for outside Apple's system.

### The stores

- **Apple.** An app record for `com.boombapbot.app` in App Store Connect,
  signing with your team (the project has no team set), an icon, screenshots,
  a privacy answer (the app collects nothing today), and TestFlight before
  review.
- **Google Play's closed test.** A new personal developer account cannot
  publish until a closed test has had at least 12 testers opted in for 14
  days running. The clock starts when the twelfth joins, so finding the
  testers is the long part and can start as soon as there is a build to
  give them. After the 14 days Play asks a few questions about the test
  before it opens production.
- A privacy policy address for both listings. The site's Policies page
  describes the site; it needs a paragraph on what the app keeps, which is
  the draft on the phone and nothing else.
