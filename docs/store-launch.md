# From here to the App Store and Google Play

What stands between `apps/mobile` and both stores, in one list, drawn up on
2026-11-26. `apps/mobile/README.md` has what the app is and what has been
checked; this is what is left. Tick a line off here when it is done.

## Decided

- **The upgrade is sold in the apps**, in the first store version, through
  each store's own in-app purchase: one product, bought once, 5 dollars. The
  owner decided this on 2026-11-22 and again on 2026-11-26. A purchase in an
  app makes the same license a Stripe payment does, so it unlocks the site,
  the desktop app and the plugin once its buyer logs in.
- The apps unlock by logging in or by buying, never by a typed key.

## The rules, as read on 2026-11-26

They change. Read them again before building on any of these.

- **Apple, 3.1.1.** Features are unlocked with in-app purchase, and license
  keys are named among the things an app may not unlock with.
- **Apple, 3.1.3(b).** An app on several platforms may give what was bought
  on another of them or on a web site, provided it is also for sale as an
  in-app purchase in the app. That is why the apps cannot go on unlocking
  by log-in alone, as they do today. Apple's page was read through a
  summary, not word for word; read 3.1 in full before the purchase is
  built.
- **Apple, the United States.** An app on the US storefront may link out to
  another way to pay. Elsewhere that needs an entitlement. The plan does
  not depend on it.
- **Apple, 5.1.1(v).** An app where an account can be made must let it be
  deleted inside the app. The account modal does.
- **Apple's cut.** 15% in the App Store Small Business Program, which has
  to be enrolled in; 30% otherwise.
- **Apple's privacy manifest.** An app says why it uses certain APIs. The
  app's own manifest covers its plug-ins' use of them.
- **Google's closed test.** A personal account made after 2023-11-13 needs
  a closed test with at least 12 testers opted in for 14 days running
  before it may ask for production. Someone who leaves and comes back does
  not count. Google then asks about the test, and its answer usually takes
  up to a week. An older account, or an organization's, is not held to it:
  the owner is to check which theirs is.
- **Google's target.** A new app must target API level 36 or higher. The
  project does.
- **Google's cut.** Its help page says 15% of the first million dollars a
  year; newer reports give 10%. Read it in the Play Console.

## The owner's

1. An app record for `com.boombapbot.app` in App Store Connect, and the
   Small Business Program.
2. An app record in the Play Console, and whether the account is held to
   the closed test.
3. An Android upload key, kept out of the repository, with Play App
   Signing.
4. The icon and the launch screen. Both are stand-ins.
5. Twelve testers for Android, if the closed test applies.
6. A support address for both listings.
7. The words of both listings: name, subtitle, description, keywords,
   category, and the age rating's answers.
8. iPad or not. The project is set for both, and nobody has looked at the
   app on an iPad.
9. Sideways or not. The project allows it and the layout there is not
   right; upright only is the cheap answer.
10. Whether sales tax or VAT is owed on what Stripe sells. The stores
    collect it themselves on what they sell.

## To build

### The purchase

1. Read Apple's 3.1 and Google's payments policy in full.
2. One product in each store, bought once, at 5 dollars. Needs the app
   records.
3. iOS: StoreKit, with "Restore purchases".
4. Android: Play Billing.
5. A route on the server that checks a store's receipt with Apple or
   Google itself and makes the license, once however often it is told.
   Apple's is built, 2026-11-26: `POST /api/upgrade/store`. Google's is
   left.
6. Each store's notice of a refund withdraws the license, as Stripe's does.
   Apple's is built, 2026-11-26: `POST /api/webhooks/apple`. Google's is
   left.

Before Apple's half can run on the live site, in this order:

- ~~The migration `0008_store_licenses.sql` is run on Neon before the
  code is deployed~~, since the code reads the new columns in the
  statement that makes a Stripe license too. Run on 2026-11-26, before the
  code was merged: nine migrations are applied, `licenses` has its two new
  columns, and every table holds the rows it held before.
- `APPLE_APP_ID` in Vercel: the app's number in App Store Connect. Until
  it is set the server checks no purchase and answers `no_store`.
- In App Store Connect, under the app's App Store Server Notifications,
  version 2, for production and for the sandbox:
  `https://boombapbot.com/api/webhooks/apple`. Until then a refund at
  Apple withdraws nothing.
7. An upgrade screen in the apps, which have none, with nothing in it that
   sends a buyer elsewhere to pay.
8. Tried in each store's sandbox: buying, restoring, a refund.

### What a store asks of the app

1. ~~An iOS privacy manifest.~~ Done 2026-11-26:
   `ios/App/App/PrivacyInfo.xcprivacy`.
2. ~~The export question answered in `Info.plist`.~~ Done 2026-11-26.
3. ~~`arm64` in place of `armv7` as what the phone must have.~~ Done
   2026-11-26.
4. Signing for a release build on each, with no team or key committed.
5. Version numbers. Both are 1 and "1.0", and every upload needs a higher
   build number.
6. The Policies page: what the app keeps, and the upgrade as the stores
   sell it. Both listings link to it.
7. Deleting an account from inside the app, tried on both phones, and a
   web address for it for Google's Data safety form.
8. Google's Data safety form and Apple's privacy answers: an email
   address, saved beats, a purchase.

### What is not right in the app

From `apps/mobile/README.md`, which has each in full.

1. Android cannot save an export to the phone itself.
2. Exports pile up in the cache.
3. The share sheet covers "Saving the WAV…" on an iPhone.
4. The "Imported" notice can be off the screen.
5. Android's status bar is dark on dark.
6. The lock screen can pause and cannot play.
7. A long run of knob turns during a call may fill the engine's queue.

## To try on real phones

Almost none of this has happened. An iPhone has run the app once, on
2026-11-24, to see a license unlock it.

1. Listening, on an iPhone and an Android phone: the eight voices, the ten
   effects, swing, a change of tempo.
2. The delay between a tap and its sound, measured on both.
3. Half an hour of playing, with the screen on and locked: stutter, heat,
   the battery.
4. A real call, an alarm, Siri, another app's music, headphones in and
   out, Bluetooth on and off, the ringer switch.
5. Into the background and back, quit and opened again with the draft
   there, no network, little storage.
6. An account from inside the app: sign up, confirm, log in, save and load
   a beat, the newer-copy question, delete the account.
7. A WAV, a MIDI file and a project through the share sheet, and a project
   file opened from the phone's files.
8. A small iPhone and a large one, an old Android phone (the Galaxy S9)
   and a new one, and a tablet if tablets are in.
9. Android alone: a cold start, a 32-bit phone if one can be found, the
   notification and its service.
10. VoiceOver and TalkBack through the panel, and large text.
11. The purchase in each sandbox, then one real one in each store.

## To submit

1. A TestFlight build to the owner, then to outside testers.
2. Play's internal test, then the closed test if it applies.
3. Screenshots at each size each store asks for.
4. Notes for review, with an account that has the upgrade.
5. To Apple, and its questions answered.
6. To Google: the questions about the test, then production.
