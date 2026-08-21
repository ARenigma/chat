# ADR-0008 — Versioning, and why OTA updates wait

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
derived from anything — a version name that increments itself stops meaning
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
ship native changes — a new native module, a permission, the app icon, a
launch screen, an SDK bump. Roughly half of what we have changed recently
(FCM, MMKV, the icon, the manifest) would have needed a store release anyway.

**The landscape, as of now.** CodePush is dead: App Center was retired 31 March
2025 and CodePush went with it. Microsoft open-sourced the server, so
`react-native-code-push` still works if you host it yourself — and accept that
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
   tell in a category — paid conversation with strangers — that is already read
   closely. Establishing the listing first, then adding OTA, is the order that
   costs least.

**When to add it.** Once 1.0.x is live and there is a real user base:
`expo-updates` with EAS, on a `production` channel, with the runtime version
pinned to `versionName` so a JS bundle can never land on a binary it was not
built against. That last part is the whole safety argument — an OTA update
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
correct — and then every local release build is also `1` and is rejected at
upload, by which time nobody remembers why. The failure lands on whoever ships
the update, not whoever set it up.

A release build now refuses to guess:

```
> A release build needs an explicit versionCode.
    CI_PIPELINE_IID=<n> npm run android:bundle
    ./gradlew bundleRelease -PversionCode=<n>
```

Debug keeps the fallback — those builds are never uploaded. Verified all three
paths: release without a number fails, release with `-PversionCode` builds, debug
builds untouched.

### In-app updates ship in 1.0.0, not 1.0.1

This reverses nothing in §3 — OTA JavaScript updates are still deferred — but it
is the opposite kind of decision, and the reason is timing rather than taste:
**the prompt runs inside the version the user already has.** A 1.0.0 without it
can never offer 1.0.1 in-app. Play's silent background auto-update still happens
either way, but nothing can _ask_, and there is no way to add it retroactively to
a version already installed. It is the one feature whose absence cannot be fixed
in the next release.

`com.google.android.play:app-update:2.1.0`, a thin Kotlin module, and a policy
module in TypeScript. The split is deliberate: nothing in the native module can
be tested without Play, so it holds no judgement at all — a test asserts there is
no threshold comparison in the Kotlin. Every decision is in
`src/lib/updatePolicy.ts` and covered by 13 unit tests.

The policy, in order of how much it matters:

1. **Flexible by default.** An immediate update is a full-screen block the user
   cannot dismiss. Doing that to someone mid-conversation, in an app whose whole
   premise is that a person is listening, is worse than shipping a day later.
2. **Immediate only when Play says urgent** — priority 4 or 5, set per release at
   rollout, so it is a decision made when publishing rather than guessed here.
3. **Immediate when 30+ days stale**, because at that point a block is the lesser
   harm.
4. **Flexible prompts at most weekly**, recorded _before_ the flow starts so a
   dismissal also counts. A prompt that returns every launch is one people learn
   to dismiss unread — which then gets the urgent ones dismissed too.

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
live — stated rather than implied.
