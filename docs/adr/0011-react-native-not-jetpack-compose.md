# ADR-0011, React Native, not Jetpack Compose

Status: **accepted** (recording a decision that predates this record)
Date: 2026-08-22

Asked directly: are we using Jetpack Compose, and if not, why, isn't it the best
option for native Android?

## What we are actually using

React Native 0.86.2 with the New Architecture: Fabric renderer, Hermes engine,
TurboModules. The UI is React components that Fabric renders into real Android
views, not a WebView, and not Compose.

## Compose is the right answer to a different question

**Yes, Compose is the best choice for a native-Android app today.** It is
Google's recommended UI toolkit, it replaced XML layouts, and for an Android-only
product there is no serious argument for anything else. That is not in dispute.

The question this app answers is different: _cross-platform reach from one
codebase_. Compose is Android-only. Compose Multiplatform exists and is a
credible bet, but it is a different bet, and taking it would mean the same
rewrite as taking Compose, plus a less mature iOS story than React Native's.

## What React Native actually costs us

Worth being concrete rather than defensive, because the costs are real:

- **Every platform API needs a bridge.** The in-app updates module
  (`InAppUpdateModule.kt`) is 175 lines of Kotlin plus a TypeScript wrapper. In
  Compose it is roughly twenty lines inside an Activity. That is the tax, paid
  per platform feature, and it recurs.
- **A performance ceiling.** Fabric removed the old asynchronous bridge, so this
  is much less true than it was in 2021, but a Compose list still beats a
  FlashList on the worst frame.
- **APK size.** Hermes plus the RN runtime is a floor Compose does not have.
- **Two toolchains to keep working.** Gradle _and_ Metro, Kotlin _and_
  TypeScript, and the day one of them breaks it is usually the seam between
  them.

## What it buys, for this product specifically

- **One codebase for Android and iOS.** iOS is on the roadmap, ADR-0004 notes
  Apple sign-in becomes mandatory the moment one ships, and this is the whole
  argument.
- **The Supabase JavaScript client, directly.** Auth, Realtime, RLS-aware
  queries, all first-party. The Kotlin client exists but the JS one is where the
  features land first.
- **The app is not graphics-heavy.** Lists, sheets, a transcript, text input.
  Nothing here is near a frame budget that would favour Compose, and the motion
  system in `src/theme/motion.ts` gets real spring physics out of Reanimated on
  the UI thread.
- **A JS-only update path later.** ADR-0008 defers OTA updates, but the option
  exists. It does not exist for Compose.

## Decision

**Stay on React Native.** Migrating to Compose means rewriting all 12 screens and
18 components (2,401 lines), discarding the token pipeline's TypeScript output, the Reanimated
motion system, and 245 tests, for a product about to ship, in exchange for
platform qualities this app does not need and the loss of the one it does.

## When this would be worth revisiting

Honestly, and none of these is close today:

1. **iOS is abandoned as a goal.** The whole argument for React Native
   evaporates, and Compose becomes clearly better.
2. **A performance problem that profiles to the renderer.** Not "it feels slow",
   a trace showing Fabric as the bottleneck on hardware people actually use.
3. **The bridge tax dominates the work.** If most new features start with a
   Kotlin module, the abstraction has stopped paying for itself.

Compose Multiplatform is the third path and worth a look at that point rather
than now: it would keep one codebase while removing the JavaScript runtime, at
the cost of leaving the entire JS ecosystem, including the Supabase client this
app is built on.
