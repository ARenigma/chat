# ADR-0012, iOS owns the surface language, Material 3 keeps the interaction model

Status: **accepted**
Date: 2026-08-22

The audit that preceded this change was blocked on one product question, and it is
worth quoting the shape of it because the answer is not "adopt iOS": this app was
a _deliberate_ Material 3 implementation. `design/tokens.json` carried a
`source.material` note claiming conformance, ADR-0010 defends 17 hand-rolled
components against exactly that standard, and `__tests__/theme.test.ts` had a
whole `Material 3 conformance` describe block asserting M3's numbers to the dp.

iOS answers the same questions with different numbers. A sheet corner is 28 or it
is 10. A nav title is 15 semibold or it is 17. A pressed row scales 2.5% and takes
a 10% state layer, or it flashes full-bleed systemGray4 and does not move. You
cannot conform to both, and there is no `Platform.select` answer that is not two
design systems living in one file.

## Decision

**Split it, along the line between what a user reads and what a finger feels.**

iOS owns everything a user reads as "which platform is this":

- sheet corners (`radius.sheet` 28 → 10, UISheetPresentationController's default)
- the type ladder (largeTitle 34/41, title1 28/34, headline 17 semibold, body
  17/22, subhead 15/20, footnote 13/18) and the direction tracking runs in: iOS
  opens the display sizes and tightens body, where the old ladder tightened
  everything
- both page colours iOS ships, not just one: `bg/grouped` exists now because an
  inset-grouped form needs something to be boxes _on_, and with only
  `systemBackground` six fields on the provider application had no visible box at
  all in light mode
- list separators that reach the trailing edge and stop before the last row
- filled fields at `radius.field` (10) rather than Material outlined text fields
- title-style capitalization on every control label, and sentence case only for
  body copy and footers
- date and time formats: `src/lib/datetime.ts`, following the device's own
  24-Hour Time setting rather than hardcoding either
- `borderCurve: 'continuous'` everywhere, which is iOS-only, a no-op on Android,
  and the cheapest single change that makes a rounded rectangle read as iPhone

Material 3 keeps the interaction model, as the default:

- `interaction.minTarget` stays **48**. It exceeds iOS's 44 minimum, so one number
  satisfies both platforms and there was never a reason to move it.
- The state-layer opacities stay, because `Pressable` still drives M3's
  scale-plus-state-layer by default. It gained `highlight="ios"` for the surfaces
  where a scaling row is the loudest tell: table cells, list rows, stars, buttons,
  chips.
- The switch anatomy stays 52×32 with a growing thumb. A toggle's dp is not the
  app's language; it is one control, it is scheduled to become an inset-grouped
  switch row, and moving it now would be churn on the one file with no
  user-visible argument attached to it.

`__tests__/theme.test.ts` carries both halves under their own names, so neither is
an oversight: `iOS conformance` and `Material 3 interaction survives`.

## Two brand exceptions, stated so nobody "finishes" the pass by deleting them

1. **The send button's squash.** `press="send"` scales to 0.86 and then multiplies
   Y by 0.78. iOS's send button scales _up_ briefly and dims. The squash stays
   because it is the moment the product is built around and because it rhymes with
   `bubbleLaunch`, which nothing on the platform does.
2. **The avatar's breath.** A 2% sine over 4.2s on an empty state and a typing
   avatar. iOS has no ambient motion on a static avatar. It stays because in a
   product with no photographs the avatar is the only thing carrying identity.

## What this costs

`borderCurve` is invisible on Android, which is the only device this project has
verified on. **There is no iOS build yet**, `ios/` holds a Podfile and an Xcode
project from `react-native init` and nothing else, so every squircle, every 10pt
sheet corner and every 17pt nav title in this change is unverified on the platform
it was made for. The type ladder is the highest-blast-radius part: 81 call sites
spread a typography token and moving largeTitle 30 → 34 reflows the inbox hero, the
directory hero, the chat empty state, the OTP digits and App.tsx's fatal title.
Nothing in `npm run verify` covers layout, and MEMORY.md already records three UI
bugs that passed every gate and were only caught on the emulator.

ADR-0004 also notes that Apple sign-in becomes mandatory under App Store guideline
4.8 the moment an iOS build ships, which is a second reason this ADR is about
language and not about shipping.

## Review trigger

Revisit if an iOS build actually ships and the type ladder measures wrong on
device, or if the toggle becomes an inset-grouped switch row, at which point the
switch anatomy assertion has nothing left to defend and should go with it.
