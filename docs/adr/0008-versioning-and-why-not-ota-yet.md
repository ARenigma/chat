# ADR-0008 — Versioning, and why OTA updates wait

Status: **accepted**
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
