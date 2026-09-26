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
- **Icons:** Phosphor (2026-09-26; Heroicons and Lucide removed), rendered as
  ONE **font**, `assets/fonts/Phosphor.ttf`, from `design/icons.json`. Regular
  weight by default; `active` swaps to the name's `-fill` glyph in the same face
  where `icons.json`'s `active` map has one. Never hand-drawn, never SVG
  (`react-native-svg` is banned).
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
  raw millisecond. `bounce` — the one spring that overshoots — is reserved for
  celebratory and signature beats, and the authoritative list of who may use it
  is the allowlist in `__tests__/theme.test.ts` ("uses bounce nowhere except…"),
  where every entry carries the argument that admitted it. Do not repeat the
  count here; it drifted twice by being written down in two places.
- **Controls:** M3, hand-rolled (ADR-0010) so tokens stay the single source.

## Art direction

The token system says what the values are. These three say which way a decision
goes when the values allow either. They came out of an audit against Emil
Kowalski's motion framework (2026-09-12), and each one exists for the same
reason: the codebase had already worked out the right answer somewhere and then
not applied it elsewhere. `Sheet.tsx` handed the gesture its velocity and
`Turn.tsx` did not. `CallRing` honoured reduce-motion and `Avatar` did not.
`motion.ts` documented the defaulted-easing trap, fixed it for search, and left
it in two banners. So each rule ships with a test — a rule that lives only in
prose is a rule that gets skipped under deadline.

1. **Frequency sets the budget, and the budget is a ceiling, not a target.**
   The more often somebody sees it, the less it may move. 100+/day (the
   composer, the send, the keyboard) gets no animation at all, or under 160ms
   with no movement; tens/day under 200ms; occasional under 300ms. Only the
   rare/first-run tier — onboarding, completion, a first message — draws on the
   delight budget, and it is the only tier where an overshoot is allowed.
   Enforced by `theme.test.ts` (`DURATION.slow` is barred from screens and
   components) and by the `bounce` allowlist.

2. **A curve is never defaulted and never hand-typed.** Reanimated's silent
   default is `Easing.inOut(Easing.quad)` — an ease-in phase on something
   arriving, which is the one shape that is always wrong for an entrance.
   Every timed animation names a curve exported from `theme/motion.ts`; a curve
   typed at a call site is a curve nobody can retune. Enforced by
   `theme.test.ts`: `entering`/`exiting` builders that set a duration must set
   an easing, and a bare `Easing.` expression outside `motion.ts` fails.

3. **If a finger touched it, the spring inherits its velocity; if the OS asked
   for less motion, the movement goes and the signal stays.** The seam between
   a drag and the animation that follows it is where motion stops feeling like
   playback and starts feeling like an object — so a gesture's release velocity
   is handed to the spring, never dropped. Transforms carry
   `ReduceMotion.System`; opacity that carries meaning (which control is live,
   which state you are in) carries `ReduceMotion.Never`, because that fade is
   the accessible signal and must always run. Enforced by `theme.test.ts`.

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
