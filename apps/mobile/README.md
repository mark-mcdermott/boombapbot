# boombapbot on a phone

The shared editor with РИТМ-12 inside a Capacitor shell, for iOS and
Android. Bundle id `com.boombapbot.app`, shown under its icon as
"boombapbot". This is the first slice: the machine, its settings and a
draft kept on the phone. It is not ready for either store. On both
phones the beat plays through the engine built natively and the phone's
own audio: AVAudioEngine on an iPhone, Oboe on Android.

## What is here

- `src/main.tsx` mounts `BoombapbotEditor` with РИТМ-12, the same way
  `apps/site/src/components/Machine.tsx` does, with four differences: the
  draft goes to the device's own store, an export goes to the phone's share
  sheet, under the machine there is only the settings button, and where the
  phone has the engine plug-in the sound is the plug-in's.
- `native-engine/` is that plug-in, a package of its own that Capacitor
  finds through the app's dependencies (`link:./native-engine`). On iOS it
  is a Swift package, `Package.swift`, with four parts:
  - `BoombapbotEngine.xcframework`, the engine built for РИТМ-12 by the
    repository's CMake, for a phone and for the simulator
    (`scripts/build-engine-ios.sh`, run by `pnpm engine:ios`). It is built,
    not committed.
  - `EngineRender`, in C: what the audio thread calls. It renders straight
    into the buffers AVAudioEngine hands it, calls nothing but
    `snare_engine_render`, takes no lock and allocates nothing, and leaves
    a peak in an atomic for the control thread.
  - `EngineCore`, in Swift with no Capacitor in it: the commands and reports
    in the editor's spelling, the engine for its control thread, and what
    the page is told and how often, as the worklet tells it. Its tests are
    `ios/Tests/`.
  - `EnginePlugin`: the Capacitor plug-in, `BoombapbotEngine` to the page.
    `AudioOutput.swift` sets `AVAudioSession` for playback and runs an
    `AVAudioEngine` whose `AVAudioSourceNode` render block calls
    `EngineRender`; `EnginePlugin.swift` makes every other call to the
    engine on one queue of its own and answers the phone's notices;
    `NowPlaying.swift` is what the lock screen shows while the beat plays.

  On Android it is a Gradle library module, `native-engine/android`, that
  `cap sync` adds to the app:
  - `src/main/cpp/CMakeLists.txt` builds the engine for РИТМ-12 with the
    repository's own CMake (`add_subdirectory` of `engine/`), always
    optimised, with the NDK pinned in `build.gradle` (r27d,
    27.3.13750724, and CMake 3.31.6). Oboe 1.11.0 comes from Google's
    Maven as a prefab package. It is built for `arm64-v8a` and
    `armeabi-v7a` (phones) and `x86_64` and `x86` (emulators on Intel
    computers).
  - `native_engine.cpp` is the Oboe stream and the engine's C ABI over JNI.
    The stream's data callback is the only caller of `snare_engine_render`:
    it renders through scratch made with it into the buffer Oboe hands it,
    takes no lock and allocates nothing. A device that leaves or changes
    makes Oboe close the stream, and the callback for that only sets a flag.
  - The Java (`com.boombapbot.engine`) is the rest, as on iOS: `Command` and
    `Report` in the editor's spelling, `Engine` for the control thread,
    `Watch` for what the page is told and how often, `AudioOutput` for the
    stream, and `BoombapbotEnginePlugin`, which makes every other call to
    the engine on one thread of its own and answers audio focus and the
    phone's "becoming noisy". `PlaybackService` keeps the app alive while
    the beat plays out of the front. Its tests are `src/androidTest`, on a
    phone or an emulator.
- `src/native-engine.ts` is the bridge the editor asks for
  (`NativeEngineBridge`) over that plug-in, and starts the run that checks
  itself when one is asked for.
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
- `scripts/copy-app-assets.mjs`, at the repository root, copies the engine,
  the worklet and the panel art from where `scripts/prepare-assets.mjs` put
  them for the site, so the app ships the files the site serves. The
  desktop app uses it too. `public/` is generated and ignored.
- `ios/` and `android/` are the native projects Capacitor made. They are
  committed. `cap sync` rewrites `ios/App/CapApp-SPM/Package.swift` and the
  copies of the web build inside them.

On a phone the page sends the engine's messages to the plug-in, and a
sound goes as its knobs: the engine synthesises it at the rate the phone's
output runs at. In a browser (`pnpm dev`), which has no plug-in, the sound
is the web view's own: the same AudioWorklet and WebAssembly engine as the
site. Exports render on the page with the WebAssembly engine everywhere.

What the plug-in does when the phone changes its sound:

- **A call, an alarm or another app takes the sound.** The beat stops, and
  the page is told it ended, so it shows the machine stopped; it waits for
  a press of play. On an iPhone the phone stops the sound itself, and when
  it gives it back the engine is made again at the rate the phone runs at
  then. On Android the plug-in asks for audio focus when play is pressed,
  stops the beat when it loses focus, and gives focus back when the beat
  stops. A sound that only asks for quiet for a moment (a "duck") is left
  to Android, which lowers the beat.
- **Headphones pulled out** stop the beat, as the phone's own players do
  (`oldDeviceUnavailable` on iOS, "becoming noisy" on Android). The
  plug-in stops it itself and tells the page.
- **Any other change of device.** On iOS, a change of route, or
  AVAudioEngine saying its configuration changed, makes the engine again
  at the new rate when the rate changed or the sound stopped. On Android
  the stream is closed by Oboe when its device leaves or changes, and the
  engine is made again at the new device's rate. Either way the page tells
  the new engine the beat again and it plays on.
- **The phone's audio starting over** (media services reset) makes
  everything again.

When the app leaves the front, or the screen locks, a beat that plays
keeps playing. The engine sequences on its own, so the page is not needed
for that, and its web view may be asleep:

- **iOS.** The app has the `audio` background mode in `Info.plist`, and
  `AVAudioSession` stays `.playback` and active. While the beat plays, Now
  Playing shows "РИТМ-12" by "boombapbot" with a pause (and the
  play/pause and stop commands); pausing there stops the beat in the
  plug-in and tells the page it ended. Once stopped, Now Playing is
  cleared: play is only in the app, which tells the engine what to play.
  A beat that stops while the app is away lets go of the phone's sound,
  so that iOS may suspend the app, and takes it again on the app's return.
- **Android.** While the beat plays, the plug-in runs `PlaybackService`, a
  foreground service of type `mediaPlayback`, with a media session and a
  media notification (the three bars, "РИТМ-12", "boombapbot", a pause).
  Its pause, the lock screen's and a headset's go to the plug-in, which
  stops the beat and tells the page; the service stops with the beat. The
  library's manifest asks for `FOREGROUND_SERVICE`,
  `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and `POST_NOTIFICATIONS`. The app
  does not ask for notifications at run time: Android 13 and later show a
  media session's notification without it, as the emulator did.
- **The page while away.** Only what changes the machine reaches it: an
  ending, an error, a new engine, a sound taken, measures. The step, the
  meter and the stats are let go, hundreds a second that would pile up in
  a sleeping web view. On the app's return the page is told the step, so it
  shows the machine playing or stopped where the engine is. The plug-in
  logs how long the app was away, how many frames the engine rendered
  meanwhile and their peak (`Back in front after …`, subsystem
  `com.boombapbot.engine` on iOS, tag `BoombapbotEngine` on Android).
- **The phone changing its sound while away.** A call stops the beat as in
  front; the engine is made again on the app's return. On iOS a change of
  route that stops AVAudioEngine starts it again with the same engine,
  whose rate AVAudioEngine's mixer converts if the new route's differs,
  because a sleeping page could not tell a new engine the beat; it is made
  again at the new rate on the app's return. On Android a device that
  leaves makes the engine again, as in front, and the beat plays on only
  if the page is awake to tell it.

Accounts, saved beats, the shop and the upgrade are left out on purpose, and
so are the footer's pages. Nothing in the app talks to a server.

## Running it

At the repository root, once the engine is built (`pnpm build:wasm`):

```bash
pnpm prepare:assets
pnpm --filter @boombapbot/mobile engine:ios  # the engine for iOS, once and after it changes; needs Xcode
pnpm --filter @boombapbot/mobile sync        # web build, then copy into ios/ and android/
pnpm --filter @boombapbot/mobile ios         # builds the engine for iOS again, syncs, asks which simulator
pnpm --filter @boombapbot/mobile android     # needs Android Studio's SDK and an emulator or a phone
```

`pnpm --filter @boombapbot/mobile dev` serves the page alone on port 4331;
in a browser the draft falls back to that browser's storage.

Checks: `pnpm typecheck` and `pnpm test:unit` at the root cover this
folder with the rest, and so does CI. `.github/workflows/native.yml` runs
the plug-in's tests below, in an iPhone simulator and an Android emulator.
CI does not build the app for either phone or run its check.

The plug-in's own tests run in a simulator, from `native-engine/`, once the
engine for iOS is built:

```bash
xcodebuild test -scheme BoombapbotNativeEngine -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
```

On Android they run on a phone or a booted emulator, from `android/`, once
the app is synced. They need the NDK and CMake versions `build.gradle`
names, from Android Studio's SDK Manager:

```bash
./gradlew :boombapbot-native-engine:connectedDebugAndroidTest
```

The app checks itself when launched with `BOOMBAPBOT_CHECK` set, as the
desktop app does: the page presses play, listens for three seconds, asks the
engine for its own account, stops, and the plug-in prints one line that
starts `BOOMBAPBOT_CHECK` with the report as JSON, then closes the app, with
0 only if neither side's peak was silent. `reopen` also makes the engine
again halfway. Exports go to the share sheet, which waits for a person, so
the check leaves them out. With the app installed in a booted simulator:

```bash
SIMCTL_CHILD_BOOMBAPBOT_CHECK=reopen xcrun simctl launch --console-pty --terminate-running-process booted com.boombapbot.app
```

On Android the mode goes as an extra of the intent that starts the app,
the plug-in writes the report to the app's own files and says in the log
(tag `BoombapbotEngine`) whether it passed, and the app closes its screen.
With a debug build installed:

```bash
adb shell am start -n com.boombapbot.app/.MainActivity --es boombapbotCheck reopen
```

```bash
adb shell run-as com.boombapbot.app cat files/check-report.json
```

Both make sound, through the Mac.

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

With the native engine, on the same iPhone simulator on 2026-11-18:

- The plug-in's tests: 6 pass. Every command and report reads and writes
  in the editor's spelling, a buffer holds the beat in stereo and in mono
  (longer than the scratch a mono buffer goes through), the page is told
  what the worklet would tell it, as often, and a command the engine cannot
  take is refused in words.
- The app launches and shows the phone's panel. Play by hand starts the
  beat: the step moves and the voices' lamps light.
- The check run (`reopen`): the plug-in opened AVAudioEngine on the route
  named "Speaker" at 48 kHz. The phone was asked for buffers of 256 frames
  and says it gives them; the render block was called 286 times for
  146,432 frames in about three seconds, so about 512 frames a call. All
  eight sounds were made by the engine and acknowledged, and the page was
  shown every step from 1 to 16. The engine's own peak was 0.66, read by
  the plug-in from the render block and by the page from the stats sent
  to it, the same as the desktop app and the web engine on this beat.
  Made again halfway, the page told the new engine the beat again (sixteen
  sounds sent and acknowledged in all) and it played on from its first
  step with the same peak. Stop stopped it, and the engine says so.

With the native engine, on the same Android emulator (Android 16) on
2026-11-18, with NDK r27d and Oboe 1.11.0:

- The plug-in's tests: 6 pass on the emulator, the same as iOS's.
- The check run (`reopen`): Oboe opened an AAudio stream, shared rather
  than exclusive, at 48 kHz in stereo float, in bursts of 960 frames with
  a buffer of 4,360 (an emulator's numbers; a phone's will be smaller).
  All eight sounds were made by the engine and acknowledged, and the page
  was shown every step from 1 to 16. The engine's own peak was 0.66, read
  by the plug-in and by the page, as on iOS and the desktop. Made again
  halfway, the page told the new engine the beat again and it played on.
  When the app closed its screen, AAudio's log shows the stream stopped and
  closed before the engine went.
- Play by hand, after a check run had closed the screen and left the
  process alive: the beat plays, the play key and the voices' lamps lit.
  The first time this was tried the app crashed. The plug-in of the closed
  screen still held audio focus, was told it had lost it, and handed that
  to a thread it had already stopped. The plug-in now gives focus back
  whenever the beat stops or the page closes the engine, and a notice that
  arrives after it has gone is let go; the same steps then played.
- A phone call, faked by the emulator (`adb emu gsm call`), while the beat
  played: telephony took focus for the ringtone, the plug-in heard it lose
  focus for a moment, stopped the beat and gave focus back, and the app
  showed the machine stopped when the call was cancelled. Play then took
  focus again and the beat played; stop gave it back.

Nobody has listened to it or held it. The simulator and the emulator play
through the Mac's speakers, and everything above about the native engine's
sound is its numbers. Not checked: a real iPhone, a real Android phone, an iPad,
the ringer switch, a phone call or another app taking the sound,
headphones in or out, a Bluetooth route, long playing; on Android, headphones, a Bluetooth device or
another app taking the sound for good, and a phone older than Android 8,
where focus is asked for the old way. A simulator cannot make most of those happen:
what the plug-in does then is built and not run, except making the engine
again, which `reopen` runs by asking for it rather than by a real change
of route. On the emulator no other app took a shared file: it has no
account for Drive or Gmail.

Background playing, on the same iPhone simulator and Android emulator
on 2026-11-18:

- **iOS.** Play by hand, then Home: 20 seconds later the app's process was
  still using the CPU, and locking the screen kept it so. The simulator's
  lock screen and Control Center draw no Now Playing, but iOS's
  `mediaremoted` logged the app as Now Playing with its title, a rate of 1
  and the commands. A pause sent through MediaRemote, as the lock screen
  sends one (a small tool run in the simulator with `simctl spawn`),
  reached the plug-in, which stopped the beat, paused AVAudioEngine and
  turned the commands off. Back in the app after 90.5 seconds: about 74
  seconds rendered at 48 kHz (3,559,936 frames, up to the pause), peak
  0.68, and the page showed the machine stopped. Play again took the sound
  back and played. Played, then Home for 19.6 seconds: 940,032 frames, so
  in real time, peak 0.66, and on return the page showed it playing, the
  step moving. Stopped, then Home: AVAudioEngine paused, but the simulator
  did not suspend the app; it kept a little CPU. Whether a phone does is
  not known.
- **Android.** Play started `PlaybackService` in the foreground as
  `mediaPlayback`, with the notification posted and the media session
  playing, notification permission not granted. Home for 20 seconds, then
  the screen off for 10: still in the foreground. The shade showed the
  media controls, "РИТМ-12", "boombapbot", a pause; the pause stopped the
  beat and the service. Back in the app after 47.3 seconds: 2,269,368
  frames, peak 0.68, the machine shown stopped. Played, then Home for 14.6
  seconds: 702,472 frames, so in real time, peak 0.66, and on return the
  page showed it playing with the step lit. Played, Home, then a media
  pause key (`input keyevent KEYCODE_MEDIA_PAUSE`): the beat and the
  service stopped, and the page showed it on return.
- The plug-in's tests: 7 pass on each, the new one being which reports go
  to the page while the app is away. The `reopen` check run passes on
  both, with the same peak of 0.66, and leaves no service running.

Not tried: real phones, a real call, headphones or Bluetooth while the app
is away, the change of route that iOS's plug-in recovers from out of the
front, Android killing the app's screen while the service runs, playing
for long, and the battery it costs.

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
- **Sideways on a phone** the brand takes about a third of the screen and
  the machine is taller than what is left, so it scrolls. That was the
  picture; the phone's panel has not been looked at sideways.
- **The brand** is the site's header with its link switched off.
- **The icon and the launch screen** are stand-ins: the three bars of the
  site's favicon on the page's dark background. Yours replace the images in
  `ios/App/App/Assets.xcassets` and `android/app/src/main/res`.
- **The ringer switch.** The plug-in sets `AVAudioSession` for playback,
  which should keep it sounding with the switch on silent. A simulator has
  no switch, so this is untried.
- **Play from the lock screen or the notification.** Only pause is
  there. Playing again needs the page, which may be asleep, to tell the
  engine what to play, so the controls go when the beat stops.
- **Knob turns while the phone has the sound.** During a call the engine
  stays made and its sound is stopped, so what the page sends waits in its
  queue. A long run of knob turns then could fill it, and the page would
  show an audio error. Not tried.
- **Two notices for one change.** A change of route and AVAudioEngine's
  own notice can both arrive and make the engine again twice. The page is
  then told the beat twice. Harmless as far as I can tell, and not tried.

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

Both halves are built: iOS has run in a simulator and Android in an
emulator; see above. Left:

- **A real iPhone and a real Android phone**, and listening to them:
  everything in "Not checked". The Galaxy S9 that played the site is the
  phone to try Android on first.
- **The delay between a tap and its sound**, which the web view made
  longest on Android, has not been measured on either.
- **32-bit Android has been built, not run.** Since 2026-11-18 the
  library is built for `armeabi-v7a` and `x86` as well as `arm64-v8a` and
  `x86_64`. Both 32-bit builds compile with the engine's warnings and none
  come up. The ARM one is ARMv7 Thumb-2 with VFPv3 and NEON, the NDK's
  default. No build calls the C++ runtime's atomics, which would take a lock
  on the audio thread: the engine's and the plug-in's 64-bit atomics are
  instructions on both. On x86 the arithmetic is SSE, and x87 appears only
  where the 32-bit calling convention returns a float. A handle crosses JNI
  as a pointer widened through `uintptr_t`, so a 32-bit pointer comes back
  the same. The engine's structs have the same offsets on every ABI: the
  WebAssembly build, which `test_abi.c` holds to them, is 32-bit already.
  No struct crosses JNI as bytes in any case. What ran: the plug-in's 6 tests, on the
  arm64 emulator (Android 16), after the change. Nothing 32-bit has run.
  The emulators on this Mac (Apple silicon) list only `arm64-v8a`, and
  Apple's chips cannot run 32-bit ARM code. The x86 build could run on an
  Intel computer or a Linux CI runner with an x86 image. A 32-bit ARM phone
  is the test.
- **The size of 32-bit.** Release builds, before and after: the universal
  APK went from 17.0 MB to 27.9 MB, since the libraries are stored
  uncompressed; the AAB from 7.9 MB to 11.3 MB; the plug-in's AAR from
  1.2 MB to 2.3 MB. Play hands a phone only its own ABI's libraries, so an
  arm64 phone downloads what it did before. A 32-bit ARM phone gets 5.3 MB
  of libraries (the plug-in 0.7, the C++ runtime 1.3, Oboe 3.4), against
  6.4 MB on arm64.
- `native-engine/` keeps its own copies of the rules the desktop app keeps
  in Rust, one in Swift and one in Java: what the commands and reports are,
  and what the page is told and how often. A change to
  `packages/editor/src/engine/messages.ts` changes all three.

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
