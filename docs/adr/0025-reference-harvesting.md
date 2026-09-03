# ADR-0025, Reference harvesting is clean-room: measure, cite, re-express — never copy

Status: **decided and shipped**
Date: 2026-09-03
Guard: `__tests__/contract.test.ts` › "reference harvesting stays clean-room"

---

## 1. The decision

Pappal treats other apps as **measured references**, the way RULE 3 already
treats Fuse: read the source to understand a whole behaviour — the algorithm,
the spring chain, the timings, the thresholds, the interaction anatomy — record
the facts with a `File.ext:line` citation in `design/references/*.md`, and
re-express that behaviour in Pappal's own code. We do **not** copy source,
assets, strings, icons or Lottie files.

Measurements, durations in ms, distances in dp, easing curves and interaction
anatomy are facts, not copyrightable expression. The line is between learning
_what a good version does_ and _transplanting the file that does it_.

## 2. Why the line matters here specifically

The primary reference for the chat surface is **Telegram Android, which is
GPL-2.0**. Copying its code into Pappal would put Pappal itself under the GPL —
full corresponding source published to every user, free to redistribute — which
is incompatible with a closed paid product. The code is also native Java +
MTProto that would not graft onto React Native + Supabase anyway. Fuse is a
small demo (permissive) and the same discipline applies so the habit is uniform
and never has to be re-decided per source.

Out of scope, explicitly: MTProto and Telegram's own security guidelines
(protocol-specific; Pappal's security is Supabase RLS + its own auth), and
anything that would require the GPL graft. The Telegram MTProto API credentials
that were shared are client keys for Telegram's servers; Pappal has its own
backend and no use for them, and live secrets never enter the repo.

## 3. How it is enforced

- **Citations, not memory.** Every adopted value names its `File.ext:line` in
  `design/references/telegram.md` (and the code comment that consumes it repeats
  the citation). A rejected value gets a "differs because" line — identity, M3,
  or an Android minimum.
- **A mechanical guard.** The contract test walks `src/`, `assets/` and
  `android/app/src/` and fails the build if any file name or text file contains
  `org.telegram`, `TMessagesProj` or `DrKLO` — the identifiers a copied Telegram
  file would carry. `design/references/` is exempt: it is where the measurements
  legitimately live and discuss Telegram by name.
- **The clone lives outside the repo.** Telegram is cloned to `~/references/`,
  never vendored, never in git.

## 4. What this has produced

The chat-feel work (composer geometry, swipe-to-reply threshold and haptic,
long-press timeout, reaction-strip overshoot, screen-transition curves) is all
Telegram-measured and re-expressed in `motion.ts`, `Composer.tsx` and `Turn.tsx`
with `File.java:line` citations — and none of it is Telegram code. The guard is
green on a tree that has never contained a Telegram identifier, so it starts as a
tripwire rather than a cleanup.

## 5. Relationship to the rules

This is RULE 3 ("when there is a reference implementation, read its source") made
specific about the licence boundary and given a mechanical enforcer. RULE 3 says
read the whole thing; this ADR says read it, cite it, and re-express it — never
paste it.
