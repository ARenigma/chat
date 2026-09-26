# Pappal — project rules

These override anything in the global config. They exist because each one has
already been broken once on this codebase.

---

## Figma is connected — use it for design truth

The Figma Dev Mode MCP plugin IS connected in this environment. When a design/
Figma link or a "match the design" ask comes up, READ IT — do not claim you
can't access Figma. Use `get_screenshot` / `get_design_context` / `get_metadata`
/ `get_variable_defs` with the fileKey + nodeId from the URL
(`.../design/<fileKey>/...?node-id=<a>-<b>` → nodeId `<a>:<b>`).

- **v13 frames** in file `2PjJLeNzXXq3Hs2ItwRWsr` are authoritative (v13
  synthesises v10/v11/v12). See `DESIGN.md` for locked frame node IDs. The v10
  recharge frame (`2024:3253`) remains the recharge reference.

---

## RULE 1 — Platform docs first, every time, smallest to biggest

**Before writing or changing ANY Android-facing behaviour, read the Android
developer documentation for that specific thing and follow it.** Not the general
idea of it — the actual page. This applies at every scale: a single attribute, a
notification, a permission, a layout, a whole screen.

This is not advisory. It is the working method.

### Why it is a rule and not a preference

Every one of these shipped because a platform doc was not read:

| What broke                                       | The doc that already said how                        |
| ------------------------------------------------ | ---------------------------------------------------- |
| Phone number input sat under the keyboard        | System bars / insets — the IME is part of the layout |
| Field rendered as hard-edged stripes             | CSS `radial-gradient` sizing keywords                |
| Orientation locked to dodge the IME extract view | Large-screen guidance: do not restrict orientation   |
| Generic notifications in a messaging app         | `MessagingStyle`, `Person`, conversation shortcuts   |
| Jank chased by guesswork                         | Baseline Profiles, Macrobenchmark, JankStats         |

Each cost a rebuild. Reading first is cheaper than every one of them.

**There is a skill for this.** `.claude/skills/android-docs/SKILL.md` carries the
method, the scoped four-pillar map, and the pointer to `docs/android-audit.md`.
Invoke it before touching Android-facing behaviour rather than reconstructing the
process each time.

### What "follow the docs" means concretely

1. **Find the page, then find the IMPLEMENTATION page.** An overview page tells
   you a feature exists; it does not tell you which API to call. Fetch both.
   `developer.android.com` for platform behaviour, `m3.material.io` for Material 3.
   Do not work from memory — memory is how `adjustResize` got treated as
   sufficient under edge-to-edge.

   **This is the rule's own failure case, so it is spelled out.** Credential
   Manager was built from `credential-manager-siwg` (the overview) without reading
   `credential-manager-siwg-implementation`. The overview describes a bottom
   sheet; the implementation page names TWO APIs and says to ship both —
   `GetGoogleIdOption` for the sheet and `GetSignInWithGoogleOption` for an
   explicit button, which is what this app has. Only the sheet was built. It could
   not work for a user with no Google account on the device, and nothing said so
   because the browser fallback carried every sign-in.

   If a doc page has an "implementation", "guide", "migrate" or "reference"
   sibling, that sibling is part of the reading, not optional depth.

2. **Then check it actually ran.** A fallback that works is indistinguishable
   from a primary path that works. Drive the real flow on a device and read
   `adb logcat` for the API you just wrote — not the screen, the log. The
   Credential Manager sheet was reported as working for two days while
   `Auth.Api.Credentials: cgi: No matching credentials` appeared on every attempt.
3. **Prefer the platform's own solution over a hand-rolled one.** If AndroidX
   ships it, use it. A bespoke version of something Google maintains is a
   liability, not craft.
4. **Cite it in the code.** The comment names the requirement and why it applies
   here. A reader must be able to check the claim.
5. **Assert it.** If it can be checked mechanically, it goes in
   `__tests__/platform.test.ts` so a regression fails the build rather than
   waiting to be noticed on a device.
6. **Say so when departing.** Deviations are allowed and sometimes correct — the
   28pt carousel glyph is one — but they are stated, with the reason, next to the
   code.

### The order of work

Smallest to biggest, always. Attribute → component → screen → flow. A screen
built on an attribute nobody checked is a screen that gets rebuilt.

### Structural comes from the docs. Creative comes from Amit.

Two different kinds of decision, and confusing them wastes his time in one
direction and produces wrong work in the other.

**Structural — take it from the docs and do not ask.** Anything with a correct
answer the platform already published: insets and system bars, window size
classes, orientation and resizability, notification channels and conversation
requirements, permission timing, Baseline Profiles, R8, testing tiers, security
and storage APIs, minSdk consequences, deprecations. Asking "should we handle
insets?" wastes a turn on a question Google answered.

**Creative — ask, with options and a recommendation.** Anything where the docs
offer a legitimate menu and the choice expresses the product: Material Symbols
Outlined vs Rounded vs Sharp, which of several sanctioned layouts, colour and
type direction, motion character, copy. These are brand decisions wearing
technical clothes, and picking silently means presenting a fait accompli.

The test: **if the docs name one correct answer, implement it. If the docs name
several valid answers, the choice is the product's, not mine.** State the
recommendation when asking — a menu with no opinion is also a failure.

---

## RULE 2 — Verify on a device, not in the test runner

`npm run verify` passing means the code is consistent, not that it works. Every
visual or motion change is checked on the emulator before it is called done, and
motion is checked frame by frame — a still frame cannot show direction. The
carousel ran backwards through three green builds.

**"It cannot be tested" is almost always wrong.** UI Automator sees system UI
outside the app: permission dialogs, the Credential Manager sheet, the share
sheet, the IME. `adb exec-out uiautomator dump` gives you every node with bounds,
so a flow can be driven by name instead of by guessed coordinates:

```
adb exec-out uiautomator dump /dev/tty | tr '>' '>\n' \
  | grep -oE 'text="Continue with Google"[^>]*bounds="[^"]+"'
```

The whole Google sign-in flow was called untestable and then driven end to end in
one command chain — which is how the Credential Manager defect was found. Before
writing "cannot verify", name the specific tool that fails and why.

**And upgrade the tooling rather than working around it.** The AVD ran Play
services 23.18.18, a 2023 build too old for Credential Manager. That is a
`sdkmanager --install` away, not a permanent limitation to document.

## RULE 3 — When there is a reference implementation, read its source

Not a screenshot, not a video, not the one file that looks relevant. The whole
thing. See `docs/adr/0016-onboarding-is-one-screen.md` for what guessing cost.

## RULE 4 — Never hand-edit generated files

`src/theme/tokens.generated.ts` and `web/tokens.css` come from
`design/tokens.json` via `npm run tokens`. `src/theme/icons.generated.ts` and
`assets/fonts/Phosphor.ttf` come from `design/icons.json` via `npm run icons:font`
(glyphs from the `@phosphor-icons/core` devDependency; Phosphor is the only icon
set, in the app and the admin console).
`src/lib/emoji.generated.ts` comes from the `@emoji-mart/data` devDependency via
`npm run emoji`. Drift is a build gate in every case.

## RULE 5 — No new dependency without a reason that survives a question

`react-native-svg` is banned: it throws `synchronouslyUpdateUIProps` inside
Reanimated views and kills touch on the whole subtree. That is the standard —
a dependency has to be worth its failure modes.

## RULE 6 — The Emil skills fire on every UI, state, motion or interaction change

Not when asked. **Always.** Amit has had to ask three times in one session
(2026-09-17: "Use Emil skills for UI, state, clicks and presses animations and
physics and transitions", then "use emil skill here for all states and transition
of notify button please", then "I am telling you to use emil skill again and
againg.. make this a rule for this repo.. so it always fires"). A rule that has
to be requested is not a rule.

They live in `~/.agents/skills/`:

| Skill                          | When                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `animate-expo`                 | **Building any motion in React Native.** This repo is RN, so this one governs, never `animate` |
| `review-animations`            | Reviewing motion, including your own, before calling it done                                   |
| `emil-design-eng`              | Component design, states, the invisible details                                                |
| `find-animation-opportunities` | Auditing a surface for motion it should have                                                   |
| `improve-animations`           | Auditing existing motion across the codebase                                                   |
| `prototype`                    | A creative fork Amit should choose between on device                                           |

**Read the skill before writing the code, not after.** The value is in the
decision order — should it animate at all, what purpose, which thread, which
properties, which curve — and that order only helps in front of the work.

Things this rule has already caught, each shipped wrong first:

- An accordion written as an animated `height`, which re-runs Yoga every frame
  for the node and its siblings. `animate-expo` lists height among the
  properties never to animate; the answer is a layout animation.
- An away control painted in Material 3's **disabled** vocabulary while being
  enabled — faint outline, tertiary ink, 3.30:1 against a 4.5:1 floor.
- The correction to that, an accent fill, which fixed the contrast and broke the
  hierarchy: a secondary action wearing the primary action's colour.
- A toggle whose only on/off signal was a 0.22 → 0.42 alpha shift with no icon
  change, on a control the user presses to change state.

**And the frequency gate is the part that gets skipped.** Motion is budgeted by
how often a thing is seen: keyboard-initiated and 100+/day get none, tens/day
get near-imperceptible, occasional gets standard, rare gets the delight budget.
A list row is not a rare surface.
