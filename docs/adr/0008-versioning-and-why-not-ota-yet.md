# ADR-0008, Versioning, and why OTA updates wait

Status: **accepted, amended 2026-08-22 (§4)**
Date: 2026-08-21

Three questions that look like one: how Play versions are numbered, how the git
history is tagged, and whether JavaScript ships over the air.

## 1. Play versioning

| Field         | Value                       | Owner                             |
| ------------- | --------------------------- | --------------------------------- |
| `versionCode` | `CI_PIPELINE_IID`, else `1` | CI, monotonic, never hand-edited  |
| `versionName` | `1.0.0`                     | a human, semver, changed on merge |

`versionCode` is the only number Play cares about: it must strictly increase, and
a duplicate is rejected at upload. Deriving it from the pipeline number makes
that automatic and makes every artefact traceable to the run that built it.

**The local fallback of `1` is a trap worth naming.** A locally built AAB is
always `versionCode 1`, so it can be uploaded exactly once, ever. Either build
release artefacts in CI, or pass the number explicitly:

```bash
CI_PIPELINE_IID=7 npm run android:bundle
```

`versionName` is what users see and it is semver by hand: patch for fixes, minor
for features, major when the product changes shape. It is deliberately not
derived from anything, a version name that increments itself stops meaning
anything.

## 2. Git and GitLab

Commits are conventional (`type: description`), enforced by commitlint. On top of
that, a release is a **tag**, because a `versionName` with no commit attached to
it cannot be reproduced:

```bash
git tag -a v1.0.0 -m "First Play release" && git push --tags
```

The convention: `v<versionName>`, annotated (not lightweight, so it carries a
date and author), created only for artefacts that actually went to Play. Internal
test builds are identified by their `versionCode`, which is already unique.

Two remotes, both pushed on every commit: GitLab runs CI, GitHub is the mirror
Vercel deploys the website from. Neither is authoritative over the other; they
carry identical history.

## 3. OTA updates: not in 1.0.0, and the reason is not laziness

**What OTA can and cannot do.** It ships the JS bundle and its assets. It cannot
ship native changes, a new native module, a permission, the app icon, a
launch screen, an SDK bump. Roughly half of what we have changed recently
(FCM, MMKV, the icon, the manifest) would have needed a store release anyway.

**The landscape, as of now.** CodePush is dead: App Center was retired 31 March
2025 and CodePush went with it. Microsoft open-sourced the server, so
`react-native-code-push` still works if you host it yourself, and accept that
Microsoft takes neither issues nor patches. The live options are
`expo-updates`/EAS Update (the most mature; works in bare React Native, supports
phased rollout, auto-rollback and Hermes bytecode diffing), a self-hosted
CodePush server, or a smaller vendor (hot-updater, Pushy, Stallion, Revopush).

**Why we are not adopting one today.**

1. `expo-updates` is a native module. Adding it is itself a native change, it
   costs a few hundred KB, and it couples our release cycle to Expo's. That is a
   real architectural commitment, and the day of a first submission is the wrong
   day to make it.
2. There is nothing to update yet. OTA earns its keep when you have users and a
   bug you want fixed in an hour. We have neither. Play's own review is 1–7 days
   for a new app and hours for an update to an established one.
3. It changes what Play is reviewing. Play permits shipping interpreted code, but
   an app that can rewrite its own behaviour after review is a harder story to
   tell in a category, paid conversation with strangers, that is already read
   closely. Establishing the listing first, then adding OTA, is the order that
   costs least.

**When to add it.** Once 1.0.x is live and there is a real user base:
`expo-updates` with EAS, on a `production` channel, with the runtime version
pinned to `versionName` so a JS bundle can never land on a binary it was not
built against. That last part is the whole safety argument, an OTA update
applied across a native boundary is the failure mode that makes people distrust
OTA, and it is configuration, not luck.

Sources consulted: [Stallion's 2026 OTA
guide](https://stalliontech.io/react-native-ota-updates-guide), [CodePush
alternatives](https://rnrescue.dev/blog/react-native-codepush-alternatives),
[Expo vs bare in 2026](https://pawelkarniej.com/blog/expo-or-bare-react-native-2026/).

---

## 4. Amended: in-app updates, and a guard on versionCode

Two changes, both prompted by preparing the first upload.

### The versionCode fallback was a trap with a delayed trigger

`CI_PIPELINE_IID ?: 1` is fine until the second release. Play only checks that
versionCode strictly increases, so the _first_ upload of `1` succeeds and looks
correct, and then every local release build is also `1` and is rejected at
upload, by which time nobody remembers why. The failure lands on whoever ships
the update, not whoever set it up.

A release build now refuses to guess:

```
> A release build needs an explicit versionCode.
    CI_PIPELINE_IID=<n> npm run android:bundle
    ./gradlew bundleRelease -PversionCode=<n>
```

Debug keeps the fallback, those builds are never uploaded. Verified all three
paths: release without a number fails, release with `-PversionCode` builds, debug
builds untouched.

### In-app updates ship in 1.0.0, not 1.0.1

This reverses nothing in §3, OTA JavaScript updates are still deferred, but it
is the opposite kind of decision, and the reason is timing rather than taste:
**the prompt runs inside the version the user already has.** A 1.0.0 without it
can never offer 1.0.1 in-app. Play's silent background auto-update still happens
either way, but nothing can _ask_, and there is no way to add it retroactively to
a version already installed. It is the one feature whose absence cannot be fixed
in the next release.

`com.google.android.play:app-update:2.1.0`, a thin Kotlin module, and a policy
module in TypeScript. The split is deliberate: nothing in the native module can
be tested without Play, so it holds no judgement at all, a test asserts there is
no threshold comparison in the Kotlin. Every decision is in
`src/lib/updatePolicy.ts` and covered by 13 unit tests.

The policy, in order of how much it matters:

1. **Flexible by default.** An immediate update is a full-screen block the user
   cannot dismiss. Doing that to someone mid-conversation, in an app whose whole
   premise is that a person is listening, is worse than shipping a day later.
2. **Immediate only when Play says urgent**, priority 4 or 5, set per release at
   rollout, so it is a decision made when publishing rather than guessed here.
3. **Immediate when 30+ days stale**, because at that point a block is the lesser
   harm.
4. **Flexible prompts at most weekly**, recorded _before_ the flow starts so a
   dismissal also counts. A prompt that returns every launch is one people learn
   to dismiss unread, which then gets the urgent ones dismissed too.

`UpdateBanner` is a separate surface from `NoticeBar` for a behavioural reason:
NoticeBar self-dismisses after 4.2 seconds and cannot be tapped, which is right
for "Reported." and wrong for the one notice that asks the user to act and must
wait until they do. It mounts as a sibling of `<Root />` so a downloaded update
survives every route change and both the signed-in and signed-out trees.

Verified on device, which is the most that can be verified off Play:

```
PlayCore: AppUpdateService : requestUpdateInfo(com.companionchat)
PlayCore: AppUpdateService : Failed to bind to the service.
ReactNativeJS: update check: supported=true available=false ...
```

`supported=true` proves the module is registered; the bind failure is expected on
an emulator with no Play Store, and it degrades to "nothing available" with no
crash and nothing shown to the user. The flows themselves need internal app
sharing or a Play test track, so they are unverified until the first release is
live, stated rather than implied.

---

## 5. Amended: the `internal` variant, and two update prompts

Date: 2026-08-22

§4 added Google Play in-app updates. That covers people who installed from Play,
which is nobody yet. Testers install a sideloaded APK, where Play's check cannot
work at all: it fails to bind to the Play service and correctly reports nothing
available. So a tester on a build we pushed had no way to be told a newer one
existed, beyond an email.

Fixing that meant adding the Firebase App Distribution SDK, and the interesting
part is why it could not simply be added.

### The SDK cannot ship to Play

Measured on the two artefacts rather than taken on faith. The full SDK pulls in:

```
android.permission.REQUEST_INSTALL_PACKAGES
android.permission.WRITE_EXTERNAL_STORAGE
```

Both make sense for something whose job is to download and install an APK, and
both are wrong in a store build. `REQUEST_INSTALL_PACKAGES` is restricted by
Play, needs a declaration form, and an app in a category as closely read as paid
conversation with strangers does not want to be explaining why it installs
packages.

So the shortcut of putting the SDK in `release` was rejected. It would have
built, distributed and worked, and surfaced weeks later as a Play review problem.

### `internal`, which is `release` plus one dependency

```groovy
internal {
    initWith release
    matchingFallbacks = ["release"]
    signingConfig ...release
    manifestPlaceholders["usesCleartextTraffic"] = false
}
```

`initWith release` is the load-bearing line: minification, resource shrinking,
ProGuard rules and the upload signing config are all inherited, so a crash a
tester hits is a crash that would have shipped. A test build with minification
off tests a different application.

Two things that are not obvious and both cost a failed build to learn:

- **`matchingFallbacks` is required.** Every AAR we depend on publishes only
  `debug` and `release`, so AGP cannot resolve a variant called `internal`
  without being told what to fall back to.
- **`usesCleartextTraffic` must be set by hand.** The React Native Gradle Plugin
  interpolates that manifest placeholder for `debug` and `release` only, and it
  does so after `buildTypes` is evaluated, so `initWith` cannot inherit it. The
  build dies in the manifest merger with "requires a placeholder substitution",
  which reads like a broken manifest rather than a missing build type.

No `applicationIdSuffix`, tempting though it is. Google sign-in returns through
the `companionchat://` scheme against a fixed Supabase redirect list, so a
different application id would only produce a build nobody can sign into.

The dependency split is Google's, and it is what keeps the call site in shared
code:

```groovy
implementation("com.google.firebase:firebase-appdistribution-api:16.0.0-beta20")
internalImplementation("com.google.firebase:firebase-appdistribution:16.0.0-beta20")
```

The `-api` artefact is a no-op in builds without the full SDK, so
`MainActivity.onResume` calls `updateIfNewReleaseAvailable()` unconditionally
with no build-type check and no variant-specific source set. Verified in the
built APKs: `internal` registers
`appdistribution.impl.FirebaseAppDistributionRegistrar`, `release` registers only
the Api and Ktx stubs.

A contract test asserts the full SDK stays `internalImplementation`, because the
entire risk is one word.

### Version numbers testers can read

`versionName` moved out of `build.gradle` into `android/gradle.properties` as
`VERSION_NAME`, so a bump is a one-line diff.

The rule from §1 changes in exactly one respect. Major and minor stay hand-edited
judgement calls. The **patch digit on an internal build is now mechanical**,
because it is not a claim about the product, it is a sequence number a tester
reads in the update prompt, and making a person type it is how two builds end up
sharing a version.

`versionCode` for internal builds is derived: `MAJOR*10000 + MINOR*100 + PATCH`,
so 1.0.1 is 10001. App Distribution only prompts when the code increases, and
deriving it means bumping the name is sufficient, with no counter file to drift.
`version-bump.mjs` refuses to take minor or patch past 99, since that would break
monotonicity.

Release builds are still **not** derived. Play needs a code that strictly
increases across everything ever uploaded, and only CI's pipeline number
guarantees that.

Consequence worth stating plainly: internal builds consume patch numbers, so the
first Play release will not be 1.0.0. It will be whatever the number has reached.
That is the cost of testers being able to tell builds apart, and it is the right
trade.

### The commands

```
npm run ship:testers    bump, build internal, upload to the internal-testers group
npm run ship            build the Play bundle and run the release checks
```

`ship` no longer calls `distribute`. It used to build `release` and then
distribute it, which after this change would have sent testers an artefact with
only the no-op stub: they would be prompted once, install, and never be prompted
again.

### The tester-enrolment trap, which cost an hour

Worth writing down because everything looked correct while nothing worked.

The first internal build went out, the console showed `Invited 2`, and the SDK's
sign-in screen came up on the device exactly as designed. It then said:

```
tester2@example.com does not have access to test CompanionChat
```

The console explained it: `Invited 2, Accepted 0, Downloaded 0`. **A tester who
has not accepted their invitation has no access, and the SDK reports that as if
the account were wrong.** The message sends you looking at the account, which is
the one thing that was fine.

Accepting normally means clicking the invitation email. Two things make that a
dead end. Firebase sends the invitation **once**, when the tester record is
created, not per release, so the six releases that followed generated no further
mail. And that single message routinely lands in Gmail's spam or promotions.

The way out is an **invite link**, which enrols and accepts in one step with no
email involved. Created for this app, scoped to the `internal-testers` group.

Note what it is: public by default, so anyone holding the URL can enrol as a
tester and download an unreleased build. A domain restriction is offered and is
no help here, because the two testers are on `gmail.com` and `axionix.tech` and
only one domain can be set. So the link is a short-lived tool, not
infrastructure: enrol, then delete it from the Invite links tab.

### RCA: why every tester was refused, and it was not the account

The in-app prompt failed for both testers with:

```
tester2@example.com does not have access to test CompanionChat
```

while the console showed that tester enrolled with a green check. Three separate
things were confusing the picture, and only one was a real fault.

**The fault: a disabled API.** App Distribution uses two different Google Cloud
APIs, and only one of them is on by default.

| API                                      | Used by                         | Default      |
| ---------------------------------------- | ------------------------------- | ------------ |
| `firebaseappdistribution.googleapis.com` | uploading and distributing      | enabled      |
| `firebaseapptesters.googleapis.com`      | the in-app SDK's tester sign-in | **disabled** |

Nothing in the upload path touches the second one, so `firebase
appdistribution:distribute` reported complete success every time while no tester
could ever sign in. The error names the account, which is the one thing that was
correct. Enabled with:

```bash
gcloud services enable firebaseapptesters.googleapis.com --project chat-d8c87
```

`scripts/distribute.mjs` now warns before uploading if it is off. A warning and
not a failure, because a machine that can upload should not be blocked for
lacking gcloud.

Also checked and ruled out: the troubleshooting guide says API **key**
restrictions must include the testers API. Both auto-created Firebase keys
already list `firebaseapptesters.googleapis.com` among their allowed targets, so
that was never it.

**Not a fault: no invitation email.** The account is the project Owner. Owners and
Editors already have access to releases through their IAM role, so App
Distribution has no invitation to send them. Chasing that email was chasing
something that was never sent. Yash, who is not a project member, is the one who
genuinely needs an invitation or an invite link.

**Not a fault: `Downloaded 0`.** Pressing Download on the release page in the
console is an owner action, not a tester action, and does not move the release's
download counter. The build was installed; the counter tracks the tester flow.

**Also misleading: the release-level `Accepted` counter.** It stayed at 0 after
enrolment succeeded. The per-tester row is the reliable signal:
`check_circle Invited` means enrolled, `warning Invitation not accepted` means not.
Read the row, not the counter.

### Verified on device, and the second cause

Enabling the testers API was necessary but not sufficient.

The client side is confirmed working. The internal build installed on an emulator
shows the SDK's own dialog on first resume:

```
Enable testing features
Enable testing features like new build alerts and in-app feedback.
                                              NOT NOW    ENABLE
```

with `FirebaseAppDistribution: NotificationsManager: Activity resumed` in logcat.
So the variant, the dependency split and the call site are all correct.

Worth noting for anyone testing this on an emulator: a previously installed debug
build blocks the install with `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, because debug
is signed with the shared debug key and `internal` with the upload key. Uninstall
first. The same applies to a tester's phone.

The second cause was a **stale tester record**. The management API showed
`lastActivityTime: 2026-08-20` for the owner's account, unchanged even after an
invite link reported success, while the console displayed a reassuring
`check_circle Invited`. An invitation can only be accepted once, so a
half-consumed one silently swallows every later attempt.

The fix is the documented reset, not another acceptance:

```bash
firebase appdistribution:testers:remove <email> --project chat-d8c87
firebase appdistribution:testers:add <email> --group-alias internal-testers --project chat-d8c87
```

Deleting a tester clears its outstanding invitations. `lastActivityTime` moving to
now is the signal that it worked; the console's per-tester label is not.

### Ordering trap: resetting a tester revokes their release access

Deleting a tester clears their outstanding invitations, which is the documented
fix for a stale record. It also drops that tester's association with every
release already distributed to them, and re-adding them to the group does **not**
retroactively restore it.

So the reset has an order, and getting it wrong reproduces the original symptom
exactly:

1. remove the tester
2. re-add to the group
3. **distribute again** so a release exists that the new record is attached to

Skipping step 3 leaves a tester who is correctly in the group, correctly enrolled,
and attached to nothing. The SDK reports that as "does not have access to test",
the same string as a disabled API and a stale record, which is why this took three
attempts to isolate: one error message, three unrelated causes.

`npm run ship:testers` is the safe way to do step 3, because it bumps the version
first and so cannot collide with the release the tester was detached from.

### Correction: an invite link cannot enrol an existing tester

The section above recommends an invite link when the invitation email does not
arrive. That is wrong for a tester who already has a record, and it wasted an
afternoon.

The console's own wording is the clue: "Invite links let **new** testers request
to join a tester group or get access to the most recent distributed release." For
an address that is already a tester, the link has no invitation to accept. It
reports success, changes nothing, and the tester stays at `Invited` forever.

The only mechanism that moves a tester from `Invited` to `Accepted` is their own
invitation email. On a release's tester row, the `⋮` menu has exactly one item,
**Resend invitation**, and that is the correct tool.

Evidence that the pipeline itself is sound: on release 1.0.2,
`yash@axionix.tech` shows the full chain `✓ → ✓ → Downloaded` having simply
received the email and clicked it, while the owner account, which never received
one, sits at `✓ Invited`.

So the ranked remedies for a tester stuck at `Invited` are:

1. **Resend invitation** from the release's tester row, then have them open it and
   accept. Search spam and Gmail's Promotions tab; `in:anywhere` in Gmail search
   covers both.
2. If mail to that address is genuinely undeliverable, add a **different** Google
   account as the tester. Invitations can be accepted by any account, and whichever
   accepts is the one that gets access from then on.
3. Invite links remain useful, but only for onboarding somebody who is not yet a
   tester at all.

### The two real causes, found last

Everything above about disabled APIs, stale records and re-distribution was
necessary work, but neither of the two things actually keeping a tester at
`Invited` was in the project at all.

**An invitation can only be accepted on a mobile device.** Opening an acceptance
URL in a desktop browser redirects to
`appdistribution.firebase.google.com/mobilerequired` with "Open the invitation
email on your mobile device to install test apps." It does not accept, and it does
not say it failed. Every desktop attempt, including the group invite link, was
guaranteed to do nothing. This is the single most useful fact in this document:
**send the tester the acceptance URL and have them open it on the phone.**

**The invitation emails were being deleted by a Gmail filter.** The owner's
account had a filter `from:(*google*) -> Delete it`, which matches
`firebase-noreply@google.com`. Three invitations were sent (20 Aug, and 15:38 and
16:03 on 22 Aug) and all three went straight to Bin. The tester on a custom
domain received his normally and completed the flow in one go, which is what
localised the problem to one mailbox rather than the setup.

Diagnostic that would have found both in five minutes instead of an afternoon:
compare a working tester against a failing one before changing anything. Yash's
row read `✓ → ✓ → Downloaded` from the very first release. That single difference
said the pipeline was sound and the problem was specific to one account.
