# ADR-0025, Reference harvesting: was clean-room, now direct — Pappal is GPL

Status: **superseded 2026-09-18** (see §6). Sections 1-5 below are kept as the
historical record of the original decision; do not follow them.

Date: 2026-09-03 (original), superseded 2026-09-18

---

## 6. Reversal (2026-09-18)

Amit's decision: Pappal is going open source, and does not need to stay clear
of GPL-2.0. The whole reason this ADR existed — "copying would put Pappal
itself under the GPL, which is incompatible with a closed paid product" (§2,
below) — no longer applies, because there is no longer a closed product to
protect.

**What changes:**

- Reading a reference implementation's source and adapting its algorithm,
  values, structure or logic directly into Pappal's own code is now allowed,
  not just measuring and re-expressing. RULE 3 ("read the whole source") is
  unchanged; this ADR's OWN restriction on top of RULE 3 — cite-and-reimplement
  only, never adapt directly — is what's lifted.
- The mechanical guard that used to fail the build on `org.telegram`,
  `TMessagesProj` or `DrKLO` anywhere in the shipping tree is removed
  (`__tests__/contract.test.ts`, "reference harvesting stays clean-room") —
  it enforced the OLD boundary and would now be actively wrong to keep.
- Pappal is licensed under GPL-2.0 (`LICENSE`, `package.json`). This is not
  optional once GPL-derived code ships: the GPL's copyleft covers the whole
  combined work, not just the copied lines — every recipient of the built app
  can demand the corresponding source under GPL terms, for the whole repo.
- Per GPL §1-§2, copied-from attribution is preserved in `THIRD_PARTY_LICENSES.md`
  at the repo root — REQUIRED for license compliance — rather than in
  individual code comments. Amit's separate instruction: no reference's name
  appears in source comments going forward, for readability, not for
  licensing — the repo-root attribution is what actually satisfies GPL, and is
  the reason comments naming a source by name are being reworded across the
  codebase as they're next touched, not stripped in one sweep that would
  silently break the file:line citations RULE 3 depends on.
- `design/references/telegram.md`'s own header, which stated the old
  "measurements only, nothing here is source" boundary, needs the same
  update — its citations remain valid (they're still the map of what was read
  and why), but its framing of what's ALLOWED is now stale until edited.

**What does not change:** RULE 3 itself (still read the whole source, still
cite it), and the practice of citing `File.ext:line` next to an adopted value
— citations remain useful engineering practice (they say why a number is what
it is) independent of the licensing question.

---

## 1. The original decision (superseded, kept for history)

Pappal treated other apps as **measured references**, the way RULE 3 already
treats Fuse: read the source to understand a whole behaviour — the algorithm,
the spring chain, the timings, the thresholds, the interaction anatomy — record
the facts with a `File.ext:line` citation in `design/references/*.md`, and
re-express that behaviour in Pappal's own code. Copying source, assets,
strings, icons or Lottie files was not allowed.

Measurements, durations in ms, distances in dp, easing curves and interaction
anatomy are facts, not copyrightable expression. The line was between learning
_what a good version does_ and _transplanting the file that does it_.

## 2. Why the line mattered then specifically

The primary reference for the chat surface is **Telegram Android, which is
GPL-2.0**. Copying its code into Pappal would have put Pappal itself under the
GPL — full corresponding source published to every user, free to
redistribute — which was incompatible with a closed paid product at the time.
Fuse is a small demo (permissive) and the same discipline applied so the habit
was uniform and never had to be re-decided per source.

## 3. How it was enforced (removed, see §6)

- **Citations, not memory.** Every adopted value named its `File.ext:line` in
  `design/references/telegram.md` (and the code comment that consumed it
  repeated the citation). A rejected value got a "differs because" line —
  identity, M3, or an Android minimum. This practice continues.
- **A mechanical guard (removed 2026-09-18).** A contract test walked `src/`,
  `assets/` and `android/app/src/` and failed the build if any file name or
  text file contained `org.telegram`, `TMessagesProj` or `DrKLO`.
- **The clone lives outside the repo.** Telegram is cloned to `~/references/`,
  never vendored, never in git. Still true — the reference clone itself is
  still not committed, independent of the licensing question.

## 4. What this produced (still true, now just without the licensing constraint)

The chat-feel work (composer geometry, swipe-to-reply threshold and haptic,
long-press timeout, reaction-strip overshoot, screen-transition curves) is
Telegram-measured and expressed in `motion.ts`, `Composer.tsx` and `Turn.tsx`
with `File.java:line` citations.

## 5. Relationship to the rules

This was RULE 3 ("when there is a reference implementation, read its source")
made specific about the licence boundary, with a mechanical enforcer. As of
§6, the licence boundary is gone; RULE 3's instruction to read the whole thing
and cite what's adopted stands on its own.
