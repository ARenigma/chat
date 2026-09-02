# Pappal — Design

## Source of truth

**v13 frames in Figma `bond Copy` (file `2PjJLeNzXXq3Hs2ItwRWsr`, screens page
`node 4:2`) are authoritative.** v13 is the synthesis of the best of v10, v11 and
v12; where a v13 frame exists it wins outright. Screens v13 does not redraw inherit
from **v12** (the most complete prior set), taking the best of v11 where it is
better. Build to the frame, do not reinvent a layout v13 already specifies (the
lesson behind [[feedback-copy-the-source-not-the-screenshot]]).

Locked v13 frames on page **02 Screens** (`4:2`): **Home** (`2074:2052`),
**Chat** (`2080:2051`), **Provider detail** (`2082:2051`), **Sign in**
(`2130:2056`). Recharge reference remains v10 (`2024:3253`).

### The one deliberate departure

**Onboarding / welcome uses what we built, not the v13 Sign-in frame.** The Figma
welcome was not updated; the in-app onboarding flow (built from `OnboardingFlow.swift`,
one screen, bloom, palette-swap, carousel) is the current, better version and
stays. See [[reference-chatapp-design-system]] and ADR-0016.

## The Warm Signal system (Fuse)

Applied globally; verified via the token drift gate.

- **Type:** Geist (Regular / SemiBold / Bold; was Urbanist), with TitanOne
  reserved for the wordmark. Tabular figures where numerals must align. Ladder
  in `design/tokens.json`.
- **Icons:** Lucide, rendered as a subset **font** from `design/icons.json`
  (ADR-0018 superseded in wave-3). Fill-active via `fontFamily` swap in
  `Icon.tsx`. Never hand-drawn, never SVG (`react-native-svg` is banned).
- **Colour:** coral accent tokens (`bg/accent` is marks-only, 3.4:1), warm
  gradient "bloom" where the design calls for it. Generated to
  `tokens.generated.ts` + `web/tokens.css` from `design/tokens.json`; `--check`
  gates drift. Never hand-edit generated files (RULE 4).
- **Space / radius:** the Material 3 spacing scale (2 to 64, `space25` to
  `space800`) in tokens; a raw padding/margin/gap literal fails
  `theme.test.ts` (allowlist for documented measured nudges only). Component
  container heights — list rows 56/72/88, the 64dp floating toolbar, app bars —
  live in a `layout` block, not as module constants. Measured source values keep
  a named constant (`SOURCE_METRICS`, `RIPPLE`) rather than rounding to a token.
- **Motion:** every duration/spring is a token in `motion.ts`; a test fails on a
  raw millisecond. `bounce` is used in exactly two places.
- **Controls:** M3, hand-rolled (ADR-0010) so tokens stay the single source.

## Navigation shape (v13)

Home merges the first-gen Inbox + Explore into **one screen** with a docked
3-item nav — **Home / Favourites / You** (Calls tab gated behind
`CALLS_TAB_ENABLED`) — replacing the first-gen Chats/Explore tab bar. **You**
is the profile-first Settings surface (WhatsApp Android reference), not a gear
utility page. Home holds: wordmark (Titan One), ₹ balance pill, a horizontal
CHATS story row (avatars, unread badges, online dots), an Explore hero card,
and a ranked provider list. On medium/expanded windows the column stays ≤600dp.
Tapping a provider opens the **Provider detail** screen (hero photo, favourite,
name/age/online/languages/rating/tags, three priced action buttons, ABOUT) —
not straight into chat as first-gen did.

### Figma check vs app (2026-09-01)

Live read of bond Copy via Figma MCP. Structure matches: Home (wordmark + CHATS
rail + Explore hero + ranked list), Chat (talk-time bar + bubbles + composer),
Provider detail (hero + three priced actions + ABOUT), welcome bloom + Continue.
**Deliberate gaps vs Figma:** app nav is docked Home / Favourites / You (Calls
gated); Figma still shows a floating coral Home / Call / Settings capsule.
Settings uses the WhatsApp profile-first “You” pattern (compact transparent app
bar, chat wallpaper cover, overlapping avatar, continuous M3 inset dividers)
rather than a medium app-bar form.

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
