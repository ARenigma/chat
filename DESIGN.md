# Pappal — Design

## Source of truth

**v13 frames in Figma `bond Copy` (file `2PjJLeNzXXq3Hs2ItwRWsr`, screens page
`node 4:2`) are authoritative.** v13 is the synthesis of the best of v10, v11 and
v12; where a v13 frame exists it wins outright. Screens v13 does not redraw inherit
from **v12** (the most complete prior set), taking the best of v11 where it is
better. Build to the frame, do not reinvent a layout v13 already specifies (the
lesson behind [[feedback-copy-the-source-not-the-screenshot]]).

Locked v13 frames: **Home** (`2131:2052`), **Chat** (`2131:2158`), **Provider
detail** (`2131:2332`), **Sign in** (`2130:2056`).

### The one deliberate departure

**Onboarding / welcome uses what we built, not the v13 Sign-in frame.** The Figma
welcome was not updated; the in-app onboarding flow (built from `OnboardingFlow.swift`,
one screen, bloom, palette-swap, carousel) is the current, better version and
stays. See [[reference-chatapp-design-system]] and ADR-0016.

## The Warm Signal system (Fuse)

Applied globally; verified via the token drift gate.

- **Type:** Nunito (was Urbanist), with LilitaOne reserved for the wordmark.
  Tabular figures where numerals must align. Ladder in `design/tokens.json`.
- **Icons:** Material Symbols Rounded, weight 400, fill-on-active, as a subset
  **font** driven by `design/icons.json` (ADR-0018) — swappable like a typeface,
  never hand-drawn, never SVG (react-native-svg is banned).
- **Colour:** coral accent tokens (`bg/accent` is marks-only, 3.4:1), warm
  gradient "bloom" where the design calls for it. Generated to
  `tokens.generated.ts` + `web/tokens.css` from `design/tokens.json`; `--check`
  gates drift. Never hand-edit generated files (RULE 4).
- **Space / radius:** token scale; measured source values (e.g. 64, 42) kept as
  named constants rather than rounded to the nearest token.
- **Motion:** every duration/spring is a token in `motion.ts`; a test fails on a
  raw millisecond. `bounce` is used in exactly two places.
- **Controls:** M3, hand-rolled (ADR-0010) so tokens stay the single source.

## Navigation shape (v13)

Home merges the first-gen Inbox + Explore into **one screen** with a floating
3-item nav — **Home / Call / Settings** — replacing the first-gen Chats/Explore
tab bar. Home holds: wordmark, ₹ balance pill, a horizontal CHATS story row
(avatars, unread badges, online dots), an Explore hero card, and a ranked provider
list. Tapping a provider opens the new **Provider detail** screen (hero photo,
favourite, name/age/online/languages/rating/tags, three priced action buttons,
ABOUT) — not straight into chat as first-gen did.

## Platform floor (four pillars, per-function docs)

Every Android-facing function follows its developer.android.com page via
`.claude/skills/android-docs` and carries the test that page prescribes, gated in
`__tests__/platform.test.ts`: edge-to-edge, IME insets, MessagingStyle
conversations, deep-link routing, baseline profiles, a11y. Verify on device
(RULE 2) — UI/motion bugs pass every static gate ([[feedback-chatapp-verify-on-device]]).
Tall 20:9 (1080×2400) is the primary form factor; tablet/fold deferred.

## Skills in play

impeccable (craft floor), figma-use + figma-design-to-code (read v13), android-docs
(platform conformance), screenshot-surgery + spatial-rhythm (visual audit),
graphify (context search).
