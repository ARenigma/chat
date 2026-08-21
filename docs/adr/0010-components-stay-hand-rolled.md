# ADR-0010 — Components stay hand-rolled, for now

Status: **accepted, with a review trigger**
Date: 2026-08-22

The question was asked directly — why is everything hand-rolled rather than from a
standard library — and it deserves an answer on the record rather than a shrug,
because the honest answer is partly "history" and partly "we tried".

## The surface being defended

17 components, **2,306 lines**, and 56 tests asserting Material 3 conformance,
the accent budget, motion tokens, contrast ratios and touch targets.

## One fact that settles half the question

**React Native has no standard auth UI.** Supabase's `@supabase/auth-ui-react` is
React DOM only; there is no React Native equivalent. So sign-in, phone entry and
the code field are hand-built whichever way this decision goes. "Use a library
for auth" is not an available option, and it is worth knowing that before
weighing anything else.

## Why the rest is hand-rolled

Not preference. The platform components were tried and failed:

- **`Switch`** renders Android's stock teal and cannot express the M3 switch
  anatomy — 52×32 track, thumb 16 → 24 → 28. That is recorded in
  `src/components/Toggle.tsx`, which exists because of it.
- **`Button`** cannot be styled meaningfully at all.

So the choice was never "library or hand-rolled". It was "React Native Paper or
hand-rolled", and Paper was not evaluated at the time.

## What Paper would actually cost

Paper (Callstack, MD3) is the credible option and would genuinely reduce bespoke
code and handle accessibility. Against that:

- Its theming is MD3 **colour roles** (primary / onPrimary / surfaceVariant …).
  "Signal on Neutral" is iOS neutrals plus a deliberately rationed accent, and
  the accent-budget test enforces where that accent may appear. Mapping one onto
  the other means fighting Paper's defaults.
- Its components animate on their own timings, which bypasses `src/theme/motion.ts`
  and the rule that every spring in the app lives in one module.
- Roughly 30–40 of the 56 tests assert behaviour Paper would own instead, so they
  would be rewritten rather than kept.
- Heavily theming Paper to look non-Material is hand-rolling again, inside
  someone else's abstraction.

## Decision

**Keep the hand-rolled components through the first Play release.** The trade is
maintenance burden against a working, tested, on-device-verified system and a
submission deadline. A component migration is the wrong thing to have in flight
while shipping.

**Review trigger, so this is a decision and not inertia:** revisit when any of
these becomes true.

1. A second developer joins and the bespoke components are what slows them down.
2. A component needs a behaviour the hand-rolled version cannot reach — nested
   scroll, complex text selection, a date picker.
3. iOS ships, and the platform-conformance cost doubles.

At that point the migration is a project with its own plan, not a side effect of
a sprint. Should it happen, the order that preserves the most value is: keep the
token generator and `motion.ts`, wrap Paper components so the tokens remain the
source of colour and spacing, and migrate one component at a time behind the
existing tests rather than in a single pass.

## What is not in scope

The hand-rolled _screens_ — Inbox, Chat, Directory — are not the subject here.
Screens are composition and would be hand-written under any component library.
