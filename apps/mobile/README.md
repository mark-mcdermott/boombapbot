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
- `src/styles.css` loads Sofia Sans Condensed, the face the phone's panel
  is lettered in, from the same pinned `@fontsource-variable` package as the
  site. The app has no server to fetch it from, so the font files are in
  its bundle.
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
error. While the sheet is open the settings sheet says "Saving the WAV…".

Import, on the same simulator: a project file saved to Files from the
share sheet, then every pattern cleared, then Import: the phone's file
chooser shows the file, and choosing it brings the beat back with the
"Imported" notice.

On an Android emulator (API 36.1, a 1080 by 2400 phone, Chrome 153's web
view), on 2026-11-17: the app launches and shows the machine; Play starts
the engine (audio running at 48 kHz, the step moving, output peaking at
0.66); a step added to the pattern is still there after the app is stopped
and opened again, and the draft is in the app's SharedPreferences. WAV
loop, the MIDI file and the project file each open Android's share sheet
with the file named, and the WAV written for it is the same 24-bit stereo
file as on the iPhone; Back on the sheet leaves no "WAV exported" line and
no error. Import opens Android's file chooser, and a project file chosen
from Downloads is loaded with the "Imported" notice. The page's safe-area
insets arrive there (51 CSS pixels at the top, 24 at the bottom).

Everything above was seen with the picture of the machine. Since
2026-11-18 a screen as narrow as a phone gets the phone's panel, and the
app with it.

With that panel, on the same iPhone simulator on 2026-11-18: the app
launches and shows it, with the settings button under it. Its lettering
(СЕКВЕНСЕР, ГОЛОС, ТЕМП, ЭФФЕКТ, ПИТЧ and the rest) is drawn in Sofia Sans
Condensed: a screenshot of the app matches one of the site's phone panel
in Safari on that simulator, and differs from a build of the app without
the font, where the same words are in the system's wider face. Play starts
the beat, the step moves and iOS shows its playing indicator. WAV loop
opens the share sheet with the file, and the WAV written for it is 24-bit
stereo; with the settings sheet scrolled to its end, "Saving the WAV…" is
there above the share sheet; closing the sheet without choosing leaves no
"WAV exported" line and no error. The project file opens the sheet and
"Save to Files" keeps it; then every pattern cleared, then Import: the
file chooser shows the file, and choosing it brings the beat back with
the "Imported" notice. The MIDI file was not exported again.

With that panel, on the same Android emulator on 2026-11-18: the app
launches and shows it; the web view says the Cyrillic and Latin files of
Sofia Sans Condensed are loaded and every label of the panel is set in
it; Play starts the engine (audio running at 48 kHz, output peaking at
0.66). Export and Import have not been run again there with it.

Nobody has listened to it or held it. Not checked: a real iPhone, a real
Android phone, an iPad, the ringer switch, a phone call or another app
taking the sound, the app coming back from the background, long playing.
On the emulator no other app took a shared file: it has no account for
Drive or Gmail.

## What is not right yet

- **Android's share sheet has no "save to this phone".** It offers other
  apps (Drive, Gmail, Messages, Bluetooth, Quick Share), not the phone's
  own Downloads. Someone who wants the WAV on the phone has to go through
  one of those. A "Save to Downloads" beside the share would need the
  phone's document saver, which neither plug-in gives.
- **A cold start on the Android emulator** shows the dark background for
  about ten seconds before the machine appears. A real phone will be
  quicker; how much is not known.
- **Exports pile up in the cache.** Each one is written to the app's cache
  folder under its beat's name and left there. The system may clear that
  folder, and a second export of the same beat writes over the first.
- **The share sheet covers "Saving the WAV…"** on the iPhone unless the
  settings sheet has been scrolled down first: the line sits under the
  Export button, where the share sheet comes up.
- **The "Imported" notice can be off the screen.** It is above the
  machine, and the settings button is below it, so after an import from
  the bottom of the page the notice is there only once you scroll up.
- **The status bar on the Android emulator** had a dark clock and dark
  icons on the page's dark background. I have not looked into why.
- **Words written for the site.** The settings sheet says the draft is
  saved "in this browser", lists keyboard keys, and ends by pointing to an
  account button in a footer the app does not have.
- **Sideways on a phone** the brand takes about a third of the screen and
  the machine is taller than what is left, so it scrolls. That was the
  picture; the phone's panel has not been looked at sideways.
- **The brand** is the site's header with its link switched off.
- **The icon and the launch screen** are stand-ins: the three bars of the
  site's favicon on the page's dark background. Yours replace the images in
  `ios/App/App/Assets.xcassets` and `android/app/src/main/res`.
- **The ringer switch.** The page asks iOS to treat its sound as playback
  (`navigator.audioSession`), which should keep it sounding with the switch
  on silent. A simulator has no switch, so this is untried.

## What is left before a store

### Android

- Run it on a real phone. The Galaxy S9 that played the site is the one to
  try first, for stutter. It has run on an emulator only.
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
