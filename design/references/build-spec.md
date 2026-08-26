# Papal build specification

Written 2026-08-23. This is the reference the implementation phase follows.

It exists because the owner gave a new direction on 2026-08-23 (rename to Papal, a
WhatsApp-shaped home bar, chats as bubbles, an Explore list, Hindi, a Settings
dashboard, conversation rename, provider onboarding with a calendar) and because
six research passes went out to find out what that costs. This file is where their
answers get reconciled, ordered and made buildable. `README.md` in this directory
records what was decided and why; this file records what to build, in what order,
and what is not buildable yet.

Read `README.md` and `motion-system.md` before this. Read the ADRs named against
each item. The Figma file is the measured source for every geometry number below:
`design/tokens.json:5` records the file key.

**Android only.** iOS is out of scope for this goal. Where a number comes from
Apple's published UIKit behaviour it is labelled as such, because the iOS
_surface language_ is still the reference (ADR-0012) even though the iOS _build_
is not.

---

## Corrections to carry forward

Six things the research got wrong or could not know. Each one would cost a cycle
if it were discovered during implementation.

1. **The suite is 497 tests, not 480.** Measured: `npx jest --silent` reports
   `Tests: 497 passed, 497 total` across 20 suites. Every "480 tests" in a
   research note is stale. Do not use a test count as a gate; use exit 0.

2. **ADR-0015 is taken.** It is `0015-renamed-to-papal.md`, accepted 2026-08-23.
   Three separate research passes proposed writing "ADR-0015". New ADRs start at
   **0016**. ADR-0015 also states that the wordmark decision belongs in this file
   rather than in an ADR, which is why the typeface section below is here.

3. **Migration numbering is 013 and 014, not 013 twice.** Two research passes
   both claimed 013. Conversation labels is 013 because it is smaller and
   unblocks the rename; availability is 014. This ordering has a trap of its own,
   named in item 14.

4. **The Figma mockup uses the wrong token for the outgoing bubble.** Frame
   `Papal Conversation` (`60:2`) specifies "mine is bg/accent with text/onAccent".
   `bg/accent` is `#F2543D` and its own token note says it must never sit under
   small white text. Measured: `text/onAccent` on `bg/accent` is **3.44:1**, a
   WCAG AA failure. On `bg/accentStrong` it is **5.19:1**. The outgoing bubble
   stays `bg/accentStrong`, which is what `README.md` already settled and what
   `check-contrast.mjs` already proves. Fix the Figma frame, not the code.

5. **The 48pt avatar's initial is 18, not 17.** The research estimated 17 by
   interpolation. `src/components/Avatar.tsx:39` is the real ramp
   (`{26:11, 30:12, 34:13, 40:15, 56:20}`), and the Figma frame measured 18.
   Figma wins because it was measured against the real ramp.

6. **The search field does not hide on scroll, and the Figma file settles it.**
   Collapse travel is **52pt, not 104pt**, because the 52pt search strip stays
   visible in the collapsed bar (`97 = 44 + 52 + 1`). This closes the open
   question the research left for the owner. It also preserves the documented fix
   at `src/screens/InboxScreen.tsx:405-417`: search was deliberately made
   always-visible because it now spans the directory and an empty inbox is when
   finding somebody matters most. Copying WhatsApp's
   `hidesSearchBarWhenScrolling` would have undone that.

---

## Dependency order at a glance

Nothing below is optional reordering. Each phase's output is another phase's
input.

```
Phase A  foundations        1 tokens+font   2 icons   3 motion builder
Phase B  the home surface   4 LargeTitleBar   5 ThreadBubble   6 Explore
Phase C  the conversation   7 bubble radius and media
Phase D  language           8 i18n scaffold   9 Devanagari   10 extraction   11 datetime
Phase E  schema             12 migration 013 labels   13 rename UI
                            14 migration 014 availability
Phase F  provider           15 application repair   16 review console
                            17 availability UI   18 admitted moment
Phase G  settings           19 settings as a route   20 member_usage   21 statement
Phase H  the gaps           22 permission primers   23 toast   24 notifications
                            25 blocked list   26 provider detail
```

Phase A must land before B because the bar needs the wordmark face and the scroll
builder. Phase D must land before F and G, because every string added after the
extraction is a string to be extracted twice, and F and G are the two largest
piles of new copy in the whole plan. Phase E must land before F because the
availability UI has nothing to write to until 014 exists.

**Honest total: 8 to 10 weeks for one engineer.** Item 10 alone is a week. Item
14 is a week. Item 4 is the one most likely to overrun, because it is unproven
ground in this codebase.

---

# Phase A: foundations

## 1. The Papal wordmark face and the four new tokens

**What it is.** Bundle Lilita One as the display face for the word Papal, and add
the four token entries every later item reads.

**Figma reference.** `Papal Home, large title expanded` (`54:4`), the wordmark in
the 52pt large-title strip. Variables added in the Figma file:
`radius/bubble = 22` (`VariableID:54:2`) and `radius/thread = 24`
(`VariableID:54:3`).

**The typeface decision, recorded here because ADR-0015 says it belongs here.**
The owner asked for the face sold at Envato as "Chunk". That item is not
ChunkFive: the Envato listing (`elements.envato.com/chunk-Y7DCH5D`, contributor
`matserotomorrow`) is classified "Decorative, Sans-Serif" and its own cover
specimen is a fat geometric sans with no serifs at all, while ChunkFive is an
ultra-bold slab serif with prominent rectangular serifs. Same name, same weight
class, different genre. The Envato item is also paid, anonymous and has no
published design history, so it is unauditable on top of being unnecessary.

**Lilita One is the answer.** SIL OFL 1.1, Copyright (c) 2011 Juan Montoreano,
Reserved Font Name "Lilita", `google/fonts` at `ofl/lilitaone`, last touched
2026-03-25. Of every free candidate it is the only one that is fat, curved,
serif-free and cut rather than rounded, with visible stroke modulation through the
bowls. That modulation is the "curved ribbon" quality in the brief. It also
happens to be the closest free proxy for what the Envato specimen actually is, so
the owner gets the look he pointed at with no paid asset.

Rejected, with reasons, so this is not relitigated: ChunkFive, Alfa Slab One,
Ultra and Bowlby One are all slabs and all read vintage Western woodtype, which
fights an iOS-flavoured luxury shell and a coral accent. Ultra is also Apache-2.0
rather than OFL, which the brief assumed wrongly. Fredoka One was delisted from
Google Fonts in 2023 and its repo copy is deleted, so bundling it means bundling
an asset with no upstream home. Titan One and Bagel Fat One read juvenile because
their terminals are fully rounded, which is the wrong signal for a paid
marketplace. Titan One is the runner up if the owner wants it wider and softer.

**Why 34 with no optical compensation.** Measured in-browser via canvas at 34px:
Lilita One and Urbanist ExtraBold have an identical cap height of 23.8px and
near-identical x-height (17.17 vs 17.00). Lilita One sets "Papal" 7.5% narrower
(81.8px vs 88.48px), and the Figma frame measures the rendered word at 82px. So
the wordmark reads heavier without reading bigger, and it will not jump when it
sits above an Urbanist title. Tracking is 0 rather than `displayLarge`'s +1.1%,
because that opening exists to stop Urbanist ExtraBold's counters crowding and
Lilita One is already fitted tight for display.

**Files to change.**

- `assets/fonts/LilitaOne.ttf` (new, 28,092 bytes)
- `assets/fonts/OFL-LilitaOne.txt` (new, 4,392 bytes)
- `design/tokens.json`: add `typography.wordmark` first in the block, above
  `displayLarge`; add `radius.bubble` 22 and `radius.thread` 24
- `src/theme/tokens.generated.ts`: regenerated by `npm run tokens`, never
  hand-edited
- `__tests__/theme.test.ts`: widen the licence assertion (below)
- `design/references/README.md`: record the typeface decision under Settled

**The exact commands.** Run from the repo root. Nothing was downloaded during
research, deliberately.

```
curl -fL -o assets/fonts/LilitaOne.ttf \
  https://raw.githubusercontent.com/google/fonts/main/ofl/lilitaone/LilitaOne-Regular.ttf
curl -fL -o assets/fonts/OFL-LilitaOne.txt \
  https://raw.githubusercontent.com/google/fonts/main/ofl/lilitaone/OFL.txt
shasum -a 256 assets/fonts/LilitaOne.ttf
# expect f5b641c45c69d772ee4eda687bc9fda411d5cad6b0b45371491da4580cbc8d59
shasum -a 256 assets/fonts/OFL-LilitaOne.txt
# expect 255d5debbb80eb2ea762644311f266a279e8778f00156655a516e2b7781a63e1
mdls -name com_apple_ats_name_postscript assets/fonts/LilitaOne.ttf
# expect "LilitaOne"
```

**The rename is load-bearing, not tidiness.** The PostScript name is `LilitaOne`
with no `-Regular`. Verified in
`node_modules/react-native/ReactAndroid/.../common/assets/ReactFontManager.kt`:
`createAssetTypeface` builds the path `"fonts/" + fontFamily + extension +
".ttf"`, and if every attempt throws it swallows the exception and returns
`Typeface.create(fontFamilyName, style)`, which is the system font. A misnamed
file does not fail the build and does not fail the app. It renders Roboto and
nothing anywhere complains.

**The second licence file, not an append.** `assets/fonts/OFL.txt` is Urbanist's
notice (first line `Copyright 2024 The Urbanist Project Authors`) and
`__tests__/theme.test.ts` asserts it exists by that exact name. Lilita One's
notice is a different document with a different copyright holder, so it ships as
`OFL-LilitaOne.txt`. Widen the test's "ships the OFL licence alongside them" case
from a literal `OFL.txt` check to one licence file per distinct family in the
typography block, because today it would not notice a bundled font with no notice
at all.

**The token.**

```json
"wordmark": {
  "fontFamily": "LilitaOne",
  "fontSize": 34,
  "lineHeightPct": 121,
  "letterSpacingPct": 0,
  "note": "The Papal wordmark in the home large-title bar, and nothing else. Lilita One (OFL) is the only face in the app that is not Urbanist, which is why this is its own token rather than displayLarge with the family swapped: a screen title stays Urbanist. 34 matches displayLarge because both faces measure a 23.8px cap height at 34px, so the wordmark reads heavier without reading bigger or shifting the bar. Tracking is 0 rather than displayLarge's +1.1%, because that opening exists to stop Urbanist ExtraBold's counters crowding and Lilita One is already fitted tight for display. One weight only, so there is nothing here for Android to synthesise."
}
```

That generates `wordmark: { fontFamily: 'LilitaOne', fontSize: 34, lineHeight: 41,
letterSpacing: 0 }`. `round(34 * 1.21) = 41`, matching the iOS largeTitle 34/41
the rest of the ladder uses.

**No Gradle change.** `android/app/build.gradle:175` already has
`assets.srcDirs += ['../../assets']`, so the file lands at `fonts/LilitaOne.ttf`
in the APK. `__tests__/theme.test.ts` already asserts that line is present.

**Nothing else in the verify chain moves.** `scripts/gen-web-tokens.mjs` hardcodes
the four `--face-*` variables and never iterates `spec.typography`, so
`web/tokens.css` stays byte-identical and `tokens:web:check` stays green.
`scripts/gen-tokens.mjs` iterates `spec.typography`, skips `$`-prefixed keys and
drops `note`, so the token flows through untouched.

**Do not subset the file.** At 28,092 bytes it is not worth shrinking, and
running `pyftsubset` or re-hinting makes it a Modified Version under the OFL, at
which point it may no longer carry the reserved name "Lilita".

**Status: READY.** Nothing blocks it. The two `curl` commands need somebody with
permission to write into the repo.

**How it is verified.** `npm run tokens` then `npm run verify` exits 0.
`shasum` matches both files. `mdls` prints `LilitaOne`. Then
**`npm run android` and look at the home bar on the emulator**, because a Metro
reload cannot pick up a native asset and a missing face does not throw. This one
has to be looked at: `feedback-chatapp-verify-on-device` is the record of three
bugs that passed every gate.

**Size: half a day**, and most of that is the emulator check.

---

## 2. Four new glyphs in the icon set

**What it is.** Add `calendar`, `globe`, `pencil` and `receipt` to `IconName`,
each drawn with Views and borders.

**Figma reference.** `T3.7 Availability calendar` (`44:9`), `T4.5 Language`
(`47:34`), `T3.13 Rename a conversation` (`45:31`), `T4.3 Statement, not
Invoices` (`47:16`). The Figma file also records the construction technique:
a rectangle with only left and bottom stroke weights set, then rotated. Rotation
-45 gives `chevron-left`, +45 on a square gives a chevron-down, +45 on a 12 x 6
rect gives a checkmark.

**Files to change.**

- `src/components/Icon.tsx`: the union at lines 6 to 22 is exactly sixteen names
  today (`chevron-left`, `chevron-right`, `arrow-up`, `check`, `close`, `dot`,
  `ellipsis-circle`, `mic`, `pause`, `phone`, `play`, `plus`, `reply`, `search`,
  `stop`, `video`). It becomes twenty.

**react-native-svg is banned** and this is the file that records why: an SVG
dispatches a layout event from inside its draw pass, Reanimated answers with a
synchronous prop update, and the result is `synchronouslyUpdateUIProps` killing
touch on the whole subtree. See `src/components/Icon.tsx:30-40`. Every new glyph
is Views and borders. Keep the comment style: name the bug that motivated the
shape.

**Status: READY.**

**How it is verified.** `npm run verify` exits 0 (typecheck catches an
unrendered union member). Then render all twenty on the emulator at 3x, because
a border-drawn glyph that is one pixel off reads as broken and no test can see
it.

**Size: half a day.**

---

## 3. The scroll-collapse builder in `motion.ts`

**What it is.** One named function in `src/theme/motion.ts` that turns a scroll
offset into the four interpolations the large-title bar needs.

**Figma reference.** `Papal Home, large title expanded` (`54:4`) and `Papal Home,
title collapsed` (`56:11`) are the two end states. The travel between them is 52.

**Why it lives there.** `__tests__/theme.test.ts:311-325` fails the build on a raw
damping, a bare `withSpring` or a literal millisecond outside that module. This
is not a lint rule wearing a test's clothes: motion is the one part of a design
system that gets tuned by feel, and if four components each hold their own spring
then "make the app feel calmer" becomes four edits and a diff nobody can review.

**The four interpolations**, all driven off a scroll offset rather than a
duration, which is what satisfies the rule at `design/tokens.json:173` that
nothing positional is animated with a curve:

```
largeTitle translateY = -min(scrollY, 52)
largeTitle opacity    = interpolate(scrollY, [0, 26, 44], [1, 1, 0], 'clamp')
inlineTitle opacity   = interpolate(scrollY, [30, 52], [0, 1], 'clamp')
hairline opacity      = interpolate(scrollY, [0, 8],  [0, 1], 'clamp')
```

The two title opacities deliberately do not overlap at full strength. **Do not
scale the 34 down to the 17.** Swapping type styles mid-gesture reflows the row
on one frame while opacity catches up over several, which is the exact failure
`src/theme/motion.ts:96-101` already documents for the stepper, where rule 7
(opacity only) won.

**Files to change.**

- `src/theme/motion.ts`
- `__tests__/theme.test.ts`: assert the builder exists and that its window
  numbers come from tokens rather than being literals

**Status: READY.**

**How it is verified.** `npm run verify` exits 0. The real verification is item 4
on a device.

**Size: half a day.**

---

# Phase B: the home surface

## 4. `LargeTitleBar` and `SearchField`

**What it is.** The WhatsApp iOS large-title bar, owning the wordmark, the inline
title, the trailing target and the search field, collapsing on scroll.

**Figma reference.** `Papal Home, large title expanded` (`54:4`), `Papal Home,
title collapsed` (`56:11`), `Papal Home, dark` (`64:2`), and flow frames
`T2.1 Home, Chats as bubbles` (`41:2`) and `T2.2 Search` (`41:9`).

**The measured geometry.** Device 402 x 874 (iPhone 16 Pro), top safe inset 59,
bottom safe inset 34. Every frame is a vertical stack of fixed bands that add to
874 exactly.

| Band       | Expanded                                                    | Collapsed                                              |
| ---------- | ----------------------------------------------------------- | ------------------------------------------------------ |
| safe inset | 59                                                          | 59                                                     |
| bar        | **148** = 44 content row + 52 title strip + 52 search strip | **97** = 44 content row + 52 search strip + 1 hairline |
| list       | 584                                                         | 635                                                    |
| tab bar    | 83 = 1 hairline + 49 row + 33 home indicator                | 83                                                     |

There is **no bottom hairline at rest**, which is what iOS `scrollEdgeAppearance`
does, and it fades in over the first 8pt of scroll.

- **Wordmark**: Lilita One 34/41/0, leading inset 16 (which is both the
  documented iPhone directional layout margin and `TOKENS.space.md`), vertically
  centred in the 52pt strip, measured width 82px.
- **Collapsed inline title**: Urbanist SemiBold 17/22/-0.43, centred across the
  full 402. It is **not** the wordmark scaled down. A screen title stays Urbanist.
  `__tests__/theme.test.ts:601` already asserts this style exists as "the
  17-semibold headline the nav bar needs".
- **Explore title**: Urbanist ExtraBold 34/41/+0.37, leading inset 16. Only Home
  uses the Lilita One face.
- **Search strip**: 52 = 8 + 36 + 8. Field 370 x 36 at `radius/field` 10, fill
  `bg/sunken`, no border, inner padding 10, glyph box 14, gap 6, placeholder
  subhead 15/20 on `text/tertiary`.
- **Trailing nav target**: a 28 x 40 visual box at x 358, holding a 26pt
  `ellipsis-circle` ring at 1.5 stroke on `border/strong` plus three 3pt dots on
  `text/secondary`. The 48pt touch target comes from `hitSlop`, not from
  inflating the box, which is both the existing pattern
  (`src/screens/ChatScreen.tsx:758-763`) and the stated policy
  (`design/tokens.json:371`). One glyph only: Papal has no camera-to-story and no
  contact compose, so the correct trailing set is the settings dashboard.

**Files to change.**

- `src/components/LargeTitleBar.tsx` (new), exporting the full variant and a
  collapsed-only variant that `ChatScreen` adopts in item 7
- `src/components/SearchField.tsx` (new), extracted from the inline field at
  `src/screens/InboxScreen.tsx:313-339`. The 250ms debounce stays in
  `src/lib/search.ts`
- `src/screens/InboxScreen.tsx`: retitle to Papal, mount the bar, move the search
  field and section header out of the FlashList header, wrap the list so a
  Reanimated scroll handler can drive the bar
- `src/screens/ProvidersScreen.tsx`: mount the bar with the Explore title
- `design/tokens.json`: the bar band heights as layout entries if they are to be
  tokens rather than component constants
- `__tests__/theme.test.ts`: assert the band heights

**Keep the empty state inside the list.** The comment at
`src/screens/InboxScreen.tsx:405-417` records why moving it out broke search for
exactly the person it was built for.

**Status: READY, and it is the riskiest item in the plan.**

**Why it is risky, stated plainly.** FlashList v2 needs
`Animated.createAnimatedComponent` to feed a Reanimated scroll handler. Nothing in
this repo currently uses `useAnimatedScrollHandler` at all, and the single
existing `interpolate` call is in `Sheet.tsx`. So this is unproven ground here. A
collapsing header that jitters or drops the scroll is the most likely single
failure of the whole change, and **Jest cannot see it**. The precedent is the
`Spinner` crash recorded in `README.md`: 497 tests, eight of them written for the
exact function, `tsc`, `eslint --max-warnings=0`, the full verify chain and a
successful release build, and the app still died on the first frame the spinner
rendered.

**How it is verified.** `npm run verify` exits 0. Then, on the emulator, with
`node scripts/dev-session.mjs --member`: scroll the inbox slowly and check the
wordmark translates and fades without the inline title double-exposing; fling it
and check the bar does not jitter or lose the scroll; check the hairline appears
only after scroll begins; check both light and dark (`64:2` is the dark frame);
check the trailing target actually takes a tap at its edges, which is the hitSlop.

**Size: 2 to 3 days, and budget a fourth for the scroll handler.**

---

## 5. `ThreadBubble`: Chats become bubbles

**What it is.** The inbox row stops being a flat hairline-divided row and becomes
a rounded card on `bg/sunken` with no separators at all.

**Figma reference.** `Papal Home, large title expanded` (`54:4`) for the bubble,
`T2.1 Home, Chats as bubbles` (`41:2`) for the flow.

**The measured geometry.**

- Bubble 370 x 72, radius 24 bound to the new `radius/thread`, `cornerSmoothing`
  0.6 for the iOS continuous curve, fill `bg/sunken`. Outer inset 16 each side,
  8pt vertical gap, and **no separators anywhere**. A bubble list has no
  separators, and that is the point of bubbles.
- Internals: padding 12 on all four sides, `itemSpacing` 12, avatar 48 at
  `radius/pill`, body 286 wide, body `itemSpacing` 2. `48 + 12 + 12 = 72` exactly.
- Text: name headline 17/22 on `text/primary`; timestamp subhead 15/20 on
  `text/tertiary`, baseline aligned with the name at the trailing edge; preview
  subhead 15/20 on `text/secondary`, promoted to `text/primary` when unread.
- Unread badge unchanged: 20 x 20 at `radius/pill` on `bg/accentStrong`,
  `numeralSmall` 12 tabular on `text/onAccent`.
- Presence dot on a 48 avatar: 12pt circle filled `state/available` with a 2pt
  **outside** stroke in `bg/sunken` so it separates from the bubble, at x 34,
  y 34 inside the avatar.
- Section header: 36 tall, content bottom aligned with 8pt bottom padding,
  `labelSmall` 13/18 on `text/secondary`, inset 16.

**Why 48 and not the current 40.** A 40pt avatar inside a 24pt-radius container
leaves the corner reading as empty space. WhatsApp's own chat-list avatar is
roughly 49 to 50; iOS Messages is 40, which is the reason the repo picked 40 in
the first place (`src/components/Avatar.tsx:15-19`).

**Why `bg/sunken` and not `bg/raised`.** `bg/raised` is `#FFFFFF` in light mode
and so is `bg/base`, so a bubble on `bg/raised` would be invisible. This is the
identical failure the incoming message bubble already had and had fixed
(`README.md`, Settled decisions). It is the single most repeated bug in this
codebase's history and it is worth reading the token note before choosing a fill.

**The two new contrast pairs, already measured.** `scripts/check-contrast.mjs`
does not currently measure anything against `bg/sunken` except `text/primary`.
Computed for this spec:

| Pair                             | Light  | Dark   | Target                   | Verdict |
| -------------------------------- | ------ | ------ | ------------------------ | ------- |
| `text/secondary` on `bg/sunken`  | 5.90:1 | 6.30:1 | 4.5                      | passes  |
| `text/tertiary` on `bg/sunken`   | 3.50:1 | 4.85:1 | 3 (exempt, as elsewhere) | passes  |
| `state/available` on `bg/sunken` | 3.15:1 | 4.99:1 | 3 (non-text)             | passes  |

So the design is safe. Add all three to `PAIRS` anyway, so it stays safe when
somebody tunes a grey.

**Files to change.**

- `src/components/ThreadBubble.tsx` (new), extracted from the inline `renderItem`
  at `src/screens/InboxScreen.tsx:157-250`
- `src/components/Avatar.tsx`: add 48 to the closed `Size` union at line 21 and
  `48: 18` to the `FONT` map at line 39. The dot-size branch at line 83 also
  needs to know 48 sits above the 30pt threshold
- `src/screens/InboxScreen.tsx`: drop the row separator, mount `ThreadBubble`
- `design/tokens.json`: `radius.thread` 24 (added in item 1)
- `scripts/check-contrast.mjs`: three new pairs
- `__tests__/theme.test.ts`: the 48pt avatar step, `radius.thread`, and
  `borderCurve: 'continuous'` which line 630 already expects on rounded surfaces

**One line survives from WhatsApp and should not.** WhatsApp allows the preview
two lines. Keep one. A two-line preview makes rows disagree about their height,
and the repo already killed the directory's language pills for exactly that
reason (`README.md`, lines 236 to 239).

**Status: READY.**

**How it is verified.** `npm run contrast:check` and `npm run verify` exit 0.
Then on the emulator: an unread thread, a read thread, a thread with a long name
that must truncate before the timestamp, and a thread with a presence dot, in
light and dark. Check the 8pt gap does not read as a separator.

**Size: 1 to 2 days.**

---

## 6. Explore stays a list

**What it is.** `ProvidersScreen` is retitled Explore and `ProviderRow` is
deliberately not touched.

**Figma reference.** `Papal Explore` (`57:2`), flow frame `T2.3 Explore`
(`41:16`).

**The measured geometry, which is what exists today.** Row is **full bleed**
402 x 68 on `bg/base`. Padding 16 across and 12 down, `itemSpacing` 12, avatar 40
at `radius/pill`, body 318 wide. Hairline 1pt on `border/hairline` at x 68, y 67,
width 334, running to the right edge, omitted after the last row.
`68 = space.md 16 + avatar 40 + space.sm 12`, which is the documented iOS
separator inset for a 40pt leading image, and it is already what
`src/components/ProviderRow.tsx:60` and `src/screens/InboxScreen.tsx:599`
compute. Row height 68 equals the hairline inset 68, which is a coincidence worth
knowing so nobody "fixes" one of them.

Content is two lines plus a trailing slot, **never a third line**. Top: name
headline 17/22 plus age `captionRegular` 13/18 on `text/tertiary`, gap 4,
baseline aligned; trailing is either a 7pt `state/available` dot with gap 6 and
`labelSmall` 13/18 "Here now", or `captionRegular` next-open copy on
`text/tertiary`. Bottom: tagline subhead 15/20 on `text/secondary` filling,
trailing rating `captionSmall` 12/17 on `text/tertiary`.

**This resolves open question 1**, which this directory has been carrying since
2026-08-22: Chats becomes bubbles with no separators, Explore stays flat rows
with 68pt inset hairlines, and both idioms now have a reason rather than a
preference. It does **partially override** the settled line "rows are flat with
inset hairlines", so it is listed in the blocked section for the owner to say out
loud rather than being absorbed silently.

**Files to change.**

- `src/screens/ProvidersScreen.tsx`: title copy, and the bar from item 4
- `src/components/ProviderRow.tsx`: unchanged in this item. Item 17 adds one rung
  to its trailing fall-through
- `design/references/README.md`: record the resolution of open question 1

**Status: READY** to build. The override needs the owner's word, which is a
one-line confirmation and not a gate on writing the code.

**How it is verified.** `npm run verify` exits 0. On the emulator, put Chats and
Explore side by side and check the two idioms read as deliberate rather than as
an inconsistency.

**Size: half a day.**

---

# Phase C: the conversation

## 7. Bubble radius, the media case, and the 44pt header

**What it is.** The message bubble radius goes from a hardcoded 18 to a tokenised
22, a media bubble gains concentric radii, and the conversation header rises to
44pt to match the collapsed bar.

**Figma reference.** `Papal Conversation` (`60:2`), flow frame `T2.5
Conversation` (`41:30`).

**The measured geometry.**

- Bubble radius **22 dp on all four corners**, `cornerSmoothing` 0.6, no tails.
  Text bubble padding 16 across and 10 down, `bodyLarge` 17/22.
- Media bubble 246 x 186 = image 240 x 180 plus 3 dp of padding on every side.
  Inner image radius **19 dp = 22 minus 3**. That concentricity is the entire
  reason for raising the radius, and it is what makes an image read as inside the
  bubble instead of pasted onto it.
- Max width 321 = 80% of 402, so max text width is 289 = 321 minus 32 of
  horizontal padding. The widest bubble in the mockup measures 317, which
  exercises the cap without exceeding it.
- Sides: theirs is `bg/sunken` with `text/primary`. **Mine is `bg/accentStrong`
  with `text/onAccent`**, not `bg/accent`. See correction 4 above: the Figma
  frame is wrong and the measured ratio on `bg/accent` is 3.44:1.
- Transcript: padding 16 left and right, 12 top, 8 bottom, `itemSpacing` 8,
  content bottom aligned. Day divider row 20 tall, `captionSmall` 12/17 on
  `text/tertiary`, centred. Stamps `captionSmall` 12/17 on `text/tertiary`,
  aligned to the speaker's side.
- Header 45 = 44 content row + 1 hairline. Back target 28 x 40 at x 16, avatar 30
  at x 52 y 7, identity block 152 wide at x 90 y 2.5 (headline 17/22 over
  `captionSmall` 12/17), video glyph 20 at x 254, phone glyph 20 at x 286, token
  chip 68 x 28 at x 318 y 8 on `bg/token` with `numeralMedium` 15 on
  `text/token`. Right edge lands on 386 = 402 minus 16.
- Composer, unchanged: 64 = 1 hairline + 63 row. Row padding 16 across, 12 top,
  11 bottom. Field 370 x 40 at `radius/pill` on `bg/base` with a 1pt
  `border/hairline` border, paddingLeft 16, paddingRight 6, placeholder
  `bodyMedium` 16/21 on `text/tertiary`. Mic 32 at `radius/pill` on `bg/accent`
  sits inside the field, which is a fill under a glyph rather than under small
  text, so `bg/accent` is correct there.

**Why 22 and not 24.** At 22 with 16pt padding a corner-adjacent glyph in the
text still clears the curve. At 24 it does not. `radius.xl` (24) is the
alternative if the owner ever wants it louder, and `radius.thread` is 24 for
exactly that reason at the larger size.

**Tails stay out.** WhatsApp iOS does have a tail on the first bubble of a run.
Do not take it back: `README.md` records that the tail was what made the two
sides different shapes, which contradicted the symmetry `Turn.tsx` was built on,
and `radius.tail` is already kept with a note saying it has no consumer.

**Rename does not go in this header.** The arithmetic is already at its limit,
about 232pt of fixed width on a 360pt screen, which is why the standalone shield
glyph was removed. Rename goes behind the identity block's existing push, where
iOS Messages puts details. See item 13.

**Files to change.**

- `src/components/Turn.tsx`: `BUBBLE_RADIUS` at line 21 becomes
  `TOKENS.radius.bubble`. Add the media case
- `src/screens/ChatScreen.tsx`: raise the content row to 44, adopt
  `LargeTitleBar`'s collapsed variant
- `design/tokens.json`: `radius.bubble` 22 (added in item 1)
- `__tests__/theme.test.ts`: `radius.bubble`, and assert no component holds a
  radius literal

**Status: READY.**

**How it is verified.** `npm run verify` exits 0. On the emulator: a one-word
bubble, a bubble at the 321 cap, a reply quote inside a bubble, a reaction under
one, and both sides in light and dark. Check the outgoing bubble is the deep
coral and not the bright one, because that is the mistake this item exists to
avoid.

**Size: 1 day.**

---

# Phase D: language

Sequenced before Phases F and G on purpose. i18n is not additive: the
concatenated strings in `RefillSheet` and `SettingsSheet` and the ternary
pluralisation at `src/screens/ProviderHomeScreen.tsx:237` all have to be
rewritten, and every screen built before the extraction lands has to be extracted
afterwards.

## 8. The i18n scaffold

**What it is.** i18next initialised synchronously at module scope, with the
language read from MMKV before the first frame.

**Figma reference.** `Papal Onboarding, language` (`62:2`), flow frame
`T1.2 Language` (`38:9`), and `T4.5 Language` (`47:34`) for the settings row.

**The stack, and Google publishes none of it.** Worth saying plainly because the
phrasing invites a wrong answer: `@google/i18n` and `google-i18n` do not exist on
npm, `@react-native-community/i18n` does not exist, and `react-native-i18n` last
published 2018-07-18 and is abandoned. `@formatjs` and `react-intl` are the
OpenJS FormatJS project, not Google. What Google actually supplies here is the
ICU locale data Android ships and the Noto Sans Devanagari typeface.

| Package                                                        | Version, modified   | Verdict                                                                                                                                                                                         |
| -------------------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `i18next`                                                      | 26.4.0, 2026-08-20  | ADOPT. Three days old, no native code, no `default` export condition so Metro and Jest both resolve CJS cleanly                                                                                 |
| `react-i18next`                                                | 17.0.12, 2026-08-20 | ADOPT, with one config change below                                                                                                                                                             |
| `react-native-localize`                                        | 3.7.0, 2026-02-22   | ADOPT, staleness noted. Constants-only TurboModule (`codegenConfig RNLocalizeSpec`). Earns its place twice: `findBestLanguageTag` for the first-run default and `uses24HourClock()` for item 11 |
| `@formatjs/intl-pluralrules`                                   | 6.3.13, 2026-07-16  | ADOPT. The only polyfill needed                                                                                                                                                                 |
| `@formatjs/intl` and the DateTimeFormat/NumberFormat polyfills | current             | REJECT. They would shadow the ICU-backed Intl the shipped Hermes already has on Android                                                                                                         |
| `expo-localization`                                            | 57.0.1, 2026-08-17  | REJECT. Peers on `expo: '*'` and needs `expo-modules-core` native glue in a bare project                                                                                                        |
| `intl-pluralrules`                                             | 2.0.1, 2023-07-06   | REJECT. Three years stale, and it is the package every tutorial still names                                                                                                                     |
| `@lingui/core`                                                 | 6.6.0, 2026-07-24   | REJECT, credible runner-up. Needs a Babel macro plus two CLI steps, which is another verify gate for no benefit at two languages                                                                |

`react-native-localize` at six months is the one stale item and it should be a
conscious acceptance rather than an oversight. It is zoontek's, it is constants
only, there is no fresher equivalent, and it adds a native module so the Android
build and the New Arch codegen both have to be re-run.

**Hermes Intl, measured rather than assumed.** Read out of the exact engine this
build pulls,
`~/.gradle/caches/modules-2/files-2.1/com.facebook.hermes/hermes-android/250829098.0.16`,
release variant, arm64-v8a `libhermesvm.so`. **Present**: `Intl.Collator`,
`Intl.DateTimeFormat`, `Intl.NumberFormat` (both with format, formatToParts,
resolvedOptions, supportedLocalesOf), `Intl.getCanonicalLocales`, the
`toLocale*String` family, `localeCompare`. **Absent, zero occurrences
case-insensitive**: `PluralRules`, `RelativeTimeFormat`, `ListFormat`,
`DisplayNames`, `Segmenter`, `Intl.Locale`. So Hindi dates and numbers need no
polyfill on Android, and `Intl.PluralRules` is the one gap, which is the one
i18next requires.

**Why that gap is not optional.** Without `Intl.PluralRules`, i18next does not
crash. It warns once and falls through to the base key, so a Hindi `_one`/`_other`
pair silently renders the wrong form on device while every test passes. Add an
assertion that `index.js` imports the polyfill before `src/lib/i18n.ts`, in the
same style as the existing ordered-import guarantees.

**Jest will break, and it is one line.**
`node_modules/@react-native/jest-preset/jest/react-native-env.js` sets
`customExportConditions = ['require', 'react-native']`, and Jest also always
honours `default`. `react-i18next`'s export key order for `.` is types, import,
module, **default**, require, and Node returns the first match, so `default` wins
and Jest resolves `./dist/es/index.js`, which is ESM.
`jest.config.js` `transformIgnorePatterns` does not list it, so the suite dies
with "Cannot use import statement outside a module". Add `react-i18next` to the
allowlist. `i18next` itself is safe: no `default` key. Metro is fine either way.

**The first frame must already be in the right language.** MMKV being synchronous
is the whole reason `src/lib/storage.ts` exists: its docblock says the awaits
AsyncStorage forced were "the difference between the first frame being the right
screen and the first frame being a spinner". So `src/lib/i18n.ts` initialises at
module scope with both catalogues imported statically as JSON, no http backend
and no async detector, and `index.js` side-effect imports it after
`react-native-url-polyfill/auto` and `./src/lib/webcrypto` and before `./App`.
Reject `i18next-react-native-language-detector` and
`@os-team/i18next-react-native-language-detector` (1.1.6, 2025-03-04): both
resolve after the first render and produce a visible English flash on the splash.

**The onboarding screen's own geometry**, from `62:2`: page fill `bg/grouped`
(not `bg/base`) so the card reads in light mode. Card 370 wide on `bg/raised` at
`radius/sm` 12, rows 56 tall with padding 16 across, hairline 1pt inset 16 at
x 16 width 354. Subtitle `captionRegular` 13/18 on `text/secondary`, footer note
`captionRegular` 13/18 on `text/tertiary` with a 12pt gap. Both options are
labelled in their own script, English and हिंदी, and the choice writes through to
MMKV on tap so the very next frame is in the chosen language. Hindi is LTR, so
there is no `I18nManager` RTL work and no forceRTL restart.

**Files to change.**

- `package.json`: four dependencies
- `jest.config.js`: `transformIgnorePatterns` gains `react-i18next`
- `src/lib/i18n.ts` (new)
- `index.js`: two ordered side-effect imports, each with a comment naming the bug
  it prevents, matching the file's existing voice
- `src/lib/storage.ts`: no code change. `companion.language` goes here beside
  `companion.themeMode`
- `src/screens/AuthScreen.tsx`: the language step ahead of `'choose'` in the step
  union at line 66, because the terms copy on the next screen is the first thing
  that has to be readable in Hindi
- `src/screens/SettingsSheet.tsx`: the language row
- `docs/adr/0016-hindi-and-the-i18n-stack.md` (new)

**Status: READY** to scaffold. Do **not** ship a Hindi option to users until
item 9 lands, because Urbanist has no Devanagari and the fallback silently
defeats the whole typography contract.

**How it is verified.** `npm view` each of the four for `time.modified` before
adding, per the standing rule that stale packages have broken this build twice
(`react-native-callkeep`, Nov 2024). Then `npm run verify` exits 0, which is the
gate that catches the Jest resolution break. Then rebuild native
(`npm run android`, not a Metro reload, because `react-native-localize` is a
native module) and check the app opens in English with no flash.

**Size: 2 days.**

---

## 9. Noto Sans Devanagari, and typography gains a language axis

**What it is.** Bundle four Devanagari faces and make the active language part of
theme identity so the type layer can resolve a face per script.

**Figma reference.** `Papal Onboarding, language` (`62:2`), the Hindi row. Its
measured type: Noto Sans Devanagari Regular, fontSize 17, **lineHeight 26**
raised from 22 for the shirorekha and stacked matras, letterSpacing 0. The
English row beside it is `bodyLarge` 17/22/-0.43.

**What actually happens without this, and it is not tofu.** All 13 type styles in
`design/tokens.json` name a hard face (four distinct: Urbanist ExtraBold, Bold,
SemiBold, Regular; note `Urbanist-Medium.ttf` is bundled and referenced by
nothing). Android's Minikin does per-character fallback through the system chain
even when a custom Typeface is set, so Devanagari renders in whatever the OEM
ships: Noto Sans Devanagari on AOSP and Pixel, something else on Samsung and
Xiaomi. Three consequences, all invisible to `npm run verify`:

1. **Weight is lost.** The typography block deliberately never sets `fontWeight`,
   because Android would synthesise a weight the family already has and smear the
   letterforms (`__tests__/theme.test.ts:169` asserts this). Fallback matches the
   _requested_ weight, which is normal for every style, so `displayLarge` naming
   Urbanist ExtraBold renders Hindi at regular weight. Every heading goes flat.
2. **Leading is too tight.** `displayLarge` is 34/41 at `lineHeightPct` 121.
   RN's `lineHeight` on Android clamps rather than grows, so top matras and
   bottom conjuncts clip.
3. **Tracking is actively wrong.** `bodyLarge` carries -2.5% (-0.42px). Android
   `letterSpacing` inserts space between glyph clusters, so negative tracking on
   Devanagari pulls conjuncts together and visually breaks the connecting
   headline stroke.

**The fix.** Bundle static Noto Sans Devanagari Regular, SemiBold, Bold and
ExtraBold from `notofonts/devanagari`, a clean one-to-one mapping onto the four
Urbanist faces actually referenced. Variable fonts are not an option because RN
does not expose `fontVariationSettings`, which is the same reason the existing
token note says "bundled as static faces". Ship the Noto OFL notice as its own
file for the same reason item 1 does.

**How the face is selected.** Not on the light/dark axis:
`ThemeProvider.tsx`'s docblock and `theme.test.ts` assert typography is
byte-identical across modes precisely so it stays non-reactive. Instead make the
active language part of theme identity, because `useStyles` already memoises on
`[makeStyles, theme]`, so a language change rebuilds every stylesheet through the
existing mechanism with no new machinery and no component churn. Preserve the
mode-parity assertion by comparing within one language.

**Two deliberate exemptions.** `numeralMedium` and `numeralSmall` are digits only
and carry `fontVariant: tabular-nums`, so they stay Urbanist in both languages:
Noto's Latin figures are not Urbanist's, and tabular coverage would have to be
proven on device. And **the wordmark stays Latin in every locale**, which is what
WhatsApp does with its own wordmark. Lilita One covers latin and latin-ext only.
Decide that now rather than discovering it: if somebody later wants a Devanagari
lockup, the OFL heavy-display faces that have Devanagari are Bakbak One and
Baloo 2 at 800, both lighter than Lilita One, and either would need its own
second token rather than a swap.

**Numbers, not just dates.** Hindi's CLDR numbering system for `hi-IN` is `latn`,
so choosing Hindi does not switch digits to Devanagari numerals unless the tag
asks for it (`hi-IN-u-nu-deva`). What does change is grouping: both `hi-IN` and
`en-IN` group on the Indian lakh and crore pattern, so 123456 renders 1,23,456.
Every amount in the app is raw interpolation today, so the Settings dashboard in
Phase G is where this starts to matter.

**Files to change.**

- `assets/fonts/NotoSansDevanagari-{Regular,SemiBold,Bold,ExtraBold}.ttf` (new)
- `assets/fonts/OFL-NotoSansDevanagari.txt` (new)
- `design/tokens.json`: a second face field per style, plus per-script
  `lineHeight` and `letterSpacing` overrides
- `scripts/gen-tokens.mjs`: `typography()` at line 77 maps `fontFamily` 1:1 and
  derives lineHeight and letterSpacing from the percentages. Extend it to emit
  the second face and the per-script metrics, and update the summary line at 299
- `src/theme/ThemeProvider.tsx`: language in theme identity
- `__tests__/theme.test.ts`: "bundles the faces it references" at lines 153 to 161
  iterates only `style.fontFamily`, so it will not check the Noto faces at all
  until extended. The licence assertion becomes per family (already widened in
  item 1)

**Status: BLOCKED** on the owner choosing Noto Sans Devanagari or Mukta. See the
blocked section. The recommendation is Noto, because it is the AOSP fallback so
it is the face most Android users already read Devanagari in.

**How it is verified.** `npm run verify` exits 0 with the extended font test.
Then **the emulator, at 3x, in both light and dark**, on the large-title home bar
and inside a bubble. No gate in the verify chain can see clipped matras, flat
regular-weight headings or broken conjuncts. Check on at least one Samsung or
Xiaomi build too, because OEM substitution means a single test device can make
the problem look better or worse than it is.

**Size: 2 days**, plus a day if the metrics need a second pass after looking at
them.

---

## 10. The string extraction

**What it is.** Move 283 literals out of the screens into `locales/en.json` and
`locales/hi.json`, and repoint the contract assertions that read source text.

**Figma reference.** Every frame. There is no single one.

**Measured volume.** A scan of `src/**/*.{ts,tsx}` plus `App.tsx` with comments
stripped gives **283 deduped literals** of two or more words after filtering
paths, keys and interpolation noise, roughly 1,700 words. Loosening to single
words and short labels puts the ceiling around 417. Distribution is concentrated:
`ProviderApplicationScreen` 32, `InboxScreen` 29, `SafetySheet` 25,
`ProviderStatusScreen` 24, `AuthScreen` 22, `SettingsSheet` 22,
`ProviderHomeScreen` 21, `ChatScreen` 19.

**Two surfaces that are easy to miss and both user-facing.** 76
`accessibilityLabel` and `accessibilityHint` sites, several of them templated
(`${name} is typing`, `${name}, blocked. Open to unblock.`,
`${name}, ${item?.unread_count} unread messages`). TalkBack in Hindi is a
requirement, not a nicety, and these are the strings most likely to be skipped as
"not visible" and the ones a screen-reader user depends on entirely. And 25
`Alert.alert` and `throw new Error` sites, with `src/api` holding 19 candidates
across `chat.ts`, `voice.ts` and `auth.ts`.

**The highest risk in the whole plan, and it is not the volume.**
`__tests__/contract.test.ts` asserts on **source text**
(`read('src/screens/X.tsx')).toContain(...)`), not on rendered output. Six
positive assertions will fail loudly, which is the safe kind: L474
`'Your own conversations'`, L1065 `'blocked. Open to unblock.'`, L1739
`'They will still be here'`, L1969 `'Open to New Conversations'`, and L2041 plus
L2044 to L2046 (the three AuthScreen claims). L2043 is worse than a plain
literal: it slices the source between `styles.claims` and `styles.claimText` and
asserts the three claims sit inside that window, which stops meaning anything
once the copy is a key.

**Four NEGATIVE assertions will start passing vacuously, and that is invisible
where a failure is not.** L1740 `not.toMatch(/\bShe\b/)` on `RefillSheet`, which
is the ADR-0001 gendered-persona guard. L1967 `not 'You are hidden.'` and L1968
`not 'Available Now'` on `ProviderHomeScreen`, which guard against two controls
both saying hidden and meaning different things. Once that copy lives in
`locales/en.json`, grepping the `.tsx` proves nothing and the guard is gone with
nothing failing. **Every one of these must be repointed at both catalogues, en
and hi, in the same commit that moves the literal.** Not deleted, and not
deferred to a follow-up.

Unaffected: L1611 and L1614 target `web/privacy.html` and `docs/play/listing.md`,
which are separate artifacts. A Hindi Play listing is a console surface, not code.

**Also affected outside contract.test.ts.** `__tests__/datetime.test.ts` L59-60
and L89-91 assert `'Yesterday'` and `'Today'` exactly, so they follow the
literals into the catalogue.

**Files to change.** `locales/en.json` and `locales/hi.json` (new), every file in
`src/screens/`, `src/components/` and `src/api/` that holds a literal,
`__tests__/contract.test.ts`, `__tests__/datetime.test.ts`.

**Status: READY**, and it must not run concurrently with Phases B, F or G.
Extract per screen, and prefer extracting a screen immediately after its redesign
lands rather than before.

**How it is verified.** `npm run verify` exits 0 after each screen, not after all
of them. Then a deliberate audit: switch to Hindi with a partial catalogue and
confirm the fallback is English rather than a raw key, and confirm TalkBack reads
Hindi labels on at least the inbox and the conversation.

**Size: a week.** This is the single largest item in Phase D and it is mostly
mechanical, which is exactly why the four negative assertions get forgotten.

---

## 11. `datetime.ts` becomes locale-explicit

**What it is.** The date module stops following the device locale and starts
following the app's chosen language, and its two English literals move out
without the file losing its purity.

**Figma reference.** Timestamps in `Papal Home, large title expanded` (`54:4`)
and `Papal Conversation` (`60:2`).

**Four things break under `hi-IN`.**

1. `'Yesterday'` in `listStamp` and `'Today'`/`'Yesterday'` in `dayLabel` are the
   only strings in the file. They must **not** become an i18next import: the
   file's own docblock says it is pure and lives outside a screen so it is
   testable without booting the native runtime. Pass the labels in, or return a
   token and let the caller translate.
2. Every formatter passes `undefined` as the locale, which resolves to the
   **device** locale. Pick Hindi on an en-US phone and the UI is Hindi while every
   weekday name, date and clock string stays English. The inverse holds too.
3. Hermes exposes `resolvedOptions` but the strings `hourCycle` and `hour12` do
   not appear in the binary, so the device 12/24 hour preference cannot be read
   back out of Intl. That is exactly what `react-native-localize`'s
   `uses24HourClock()` is for (it reads
   `android.text.format.DateFormat.is24HourFormat`), so `timeOfDay` becomes
   `new Intl.DateTimeFormat(appLocale, { hour: 'numeric', minute: '2-digit', hour12: !uses24HourClock() })`.
4. **`longDate`'s docblock is factually wrong for this build.** It claims "under
   Hermes gives 8/22/2026 regardless of the device's region because Hermes ships
   one locale". This engine is Intl-enabled and ICU-backed, so on Android it does
   follow the region. That claim is only true for Hermes compiled without Intl and
   for iOS Hermes, which has no Intl at all. Since iOS is out of scope, the
   comment inverts the real platform behaviour and should be corrected as part of
   this work.

Unaffected: `startOfDay`, `daysBetween`, `sameDay` and `opensDay` are calendar
arithmetic, and IST has no DST.

**Files to change.** `src/lib/datetime.ts`, `__tests__/datetime.test.ts`, and
`src/screens/ProviderStatusScreen.tsx:132` where the codebase already knows about
the single-locale assumption.

**Status: READY** once item 8 lands.

**How it is verified.** `npm run verify` exits 0. `__tests__/datetime.test.ts`
L117-132 currently pins `timeOfDay` against a self-computed
`Intl.DateTimeFormat(undefined, ...)`, which turns vacuous or fails once the
function takes an explicit locale. Rewrite it to assert **structure and the
hour12 wiring, never Hindi glyph strings**: Node's ICU and Android's ICU are
different versions, so any test asserting exact Hindi date, weekday or number
output will pass in Jest and disagree on device.

**Size: 1 day.**

---

# Phase E: schema

## 12. Migration 013: provider-private conversation labels

**What it is.** A provider can name a conversation to remember who somebody is,
and the member can never see that name.

**Figma reference.** `T3.13 Rename a conversation` (`45:31`).

**The load-bearing decision: the label is a row, not a column.** A
`provider_label` column on `conversations` cannot satisfy "never leaks to the
member" at all. `conversations` has one SELECT policy, "Participants read their
conversation", which returns the row to **both** participants, and Postgres
column privileges are granted per role, and both sides are the same role
`authenticated`. So there is no mechanism that lets the provider read the column
while the member cannot. The member would simply
`select provider_label from conversations`. Row ownership is the only per-row
boundary RLS gives us. The same shape serves the member later with zero schema
change, because the label is keyed by viewer.

```sql
create table if not exists public.conversation_labels (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  label text not null check (length(btrim(label)) > 0 and length(label) <= 40),
  created_at timestamptz not null default now(),
  primary key (conversation_id, owner_id)
);
```

Four deliberate choices. PK order is `(conversation_id, owner_id)` so the PK index
alone serves the view's join predicate and no second index is added. `label` is
NOT NULL with a non-blank CHECK, so a blank name is unrepresentable and clearing
is a DELETE rather than a null that two read paths would have to agree about.
`default auth.uid()` means a service_role caller (where `auth.uid()` is null) hits
the NOT NULL and fails closed. No `updated_at`, because nothing reads it and it
would need a touch trigger this file deliberately does not have.

Four owner-only policies: SELECT, INSERT, UPDATE, DELETE, all
`owner_id = auth.uid()`. INSERT additionally carries
`exists (select 1 from public.conversations c where c.id = conversation_id and (c.member_id = auth.uid() or c.provider_id = auth.uid()))`.
Two clauses because they fail on different attacks: ownership stops forging a
label onto somebody else's side, the EXISTS stops labelling a thread you are not
in. **The subquery trap 003 records does not apply here**, and the migration
should say why: 003's broken attempt put a subquery on `profiles` inside a
`profiles` policy, so it was filtered by the policy being defined and resolved to
NULL. This subquery reads a different table whose own policy already returns that
row to a participant. UPDATE needs no participant clause: the row can only exist
if INSERT already proved it.

Then the convention 005 established, stated and never assumed, because Supabase
grants ALL on new public tables to `anon` and `authenticated` by default and the
pgTAP harness reproduces that with `alter default privileges`:

```sql
revoke all on public.conversation_labels from anon, authenticated;
grant select, insert, update, delete on public.conversation_labels to authenticated;
```

Writes go direct through PostgREST rather than through an RPC, for the same
reason `is_available` and `presence` do: there is no debit, no cross-row
invariant and no reviewed fact involved, so the RLS policy is the whole rule.

**The override is one LEFT JOIN and one coalesce.** `conversation_summaries` is
already `security_invoker = true`, so the join is filtered by the label table's
own SELECT policy: the provider's session sees their row, the member's session
sees none, and `coalesce` falls through to the handle. RLS does the branching, so
there is no `case when i_am_member` in the view and no second round trip.

```sql
create or replace view public.conversation_summaries
with (security_invoker = true) as
  select
    c.id,
    ...
    coalesce(l.label, pe.peer_display_name) as peer_display_name,
    ...
    (c.member_id = auth.uid()) as i_am_member,
    l.label as my_label
  from public.conversations c
  left join public.conversation_peers pe on pe.conversation_id = c.id
  left join public.conversation_labels l
    on l.conversation_id = c.id and l.owner_id = auth.uid()
  where c.member_id = auth.uid() or c.provider_id = auth.uid();
```

`create or replace` rather than drop and recreate: the only existing column whose
expression changes is `peer_display_name`, which keeps its name, type and
position, and `my_label` is appended last, which is exactly what replace permits.
Replace also keeps the grants a drop would discard.

**The single deletable line that is the whole privacy boundary.**
`create or replace view` replaces the entire reloptions set, so omitting
`with (security_invoker = true)` silently reverts the view to DEFINER. The WHERE
clause would still scope rows to the caller, so the inbox would look completely
normal, but the label join would no longer be RLS-filtered and `coalesce` would
hand the provider's private label to the member. Pin it:

```sql
select ok(
  (select reloptions from pg_class where oid = 'public.conversation_summaries'::regclass)
    @> array['security_invoker=true'],
  'the inbox still runs as the caller, which is the thing filtering the label join'
);
```

A columns-only test passes straight through that leak.

**`my_label` is published beside the coalesced column, and it is not
redundancy.** The coalesced `peer_display_name` cannot tell a label from a real
name, so the rename control could not pre-fill its field, could not choose
between "Name This Conversation" and editing an existing name, and could not know
whether to offer "Clear Name". Finding that out costs a second query. So
`peer_display_name` is what every existing read site renders and inherits the
label for free (the ChatScreen header, its avatar initial through `initialOf`,
the ProviderHomeScreen rows, the inbox search at
`src/screens/InboxScreen.tsx:142`, the accessibility labels), and `my_label` is
the raw value for the editor only.

**What must not change, so the label cannot escape.** `conversation_peers` stays
exactly as 012 left it: it is `security_invoker = false`, so a label join there
would bypass RLS entirely, and it is also the only place the true handle remains
reachable once a thread is renamed. `provider_directory` never touches labels.
`pending_pushes` is deliberately left alone, because the Edge Function reads it as
service_role where `auth.uid()` is null. The consequence, recorded rather than
discovered: a push says "Member 4f2a" while the inbox says the label. That is a
follow-up to be argued on its own terms.

**Files to change.**

- `supabase/migrations/013_conversation_labels.sql` (new). Also redefines
  `guard_event_shape` in full to add `conversation_renamed`
- `supabase/tests/120_conversation_labels.sql` (new), `select plan(27)`
- `scripts/db-test.mjs`: **both arrays**. 013 into `MIGRATIONS` (which ends at 012
  today, line 56) and 120 into the suite list (which ends at 110, line 353).
  Adding only the migration means the new suite never runs and the whole thing
  passes green
- `src/lib/database.types.ts`: `ConversationSummary` gains
  `my_label: string | null`; a `ConversationLabel` row type; a
  `conversation_labels` entry in the **Tables** map (a real table, not Views)
  with `Insert { conversation_id, owner_id, label }` and `Update { label }`;
  `'conversation_renamed'` in the `TelemetryEvent` union
- `__tests__/contract.test.ts`: greps in the house style, including that 013 does
  **not** touch `conversation_peers` or `pending_pushes`
- `__tests__/telemetry.test.ts`: it asserts the SQL allowlist and the TS union are
  identical, so it fails unless both edits land

**The 27 assertions, in order.** Shape and privilege (8): `has_table`;
`has_column label`; `col_not_null label`; `has_column
conversation_summaries.my_label`; `ok(relrowsecurity)` because the harness grants
ALL by default so RLS off would make every label a public read; `ok(reloptions
contains security_invoker=true)`; `is(anon grants, 0)`; `is(authenticated SELECT
grants, 1)`. Fixtures (1). The override (4): provider inserts
`'Rahul from Pune'`; provider's `peer_display_name` is it; provider's `my_label`
is it; `conversation_peers.peer_display_name` is still `'Member bbbb'`. The
member cannot see it (3), the headline claim: member's `peer_display_name` is
`'Ada'`; member's `my_label` is null; member's `count(*)` from
`conversation_labels` is 0. Symmetry (3): member inserts their own label; it
overrides for them; the provider's is untouched. Forgery and outsiders (3):
42501 when the member sets `owner_id` to the **outsider** (chosen over the
provider deliberately, so no unique violation can preempt the RLS check and the
42501 is unambiguous); 42501 when the outsider labels a thread they are not in,
which is what proves the participant clause rather than just the ownership one;
outsider's `count(*)` is 0. Blank and clearing (4): 23514 on a whitespace-only
label; provider deletes; `peer_display_name` reverts; the member's label survives.
Cascade (1).

**One pgTAP constraint that will bite.** `__tests__/contract.test.ts` counts only
**line-initial** `select <helper>(` where the helper is one of `has_table`,
`hasnt_table`, `has_column`, `hasnt_column`, `has_index`, `has_trigger`,
`col_is_pk`, `col_not_null`, `col_has_default`, `col_default_is`, `policies_are`,
`function_privs_are`, `isnt_empty`, `throws_ok`, `lives_ok`, `ok`, `is`, `isnt`.
`has_function`, `has_view` and `has_enum` are absent from that list, so using them
counts at runtime and not in Jest, and the two gates disagree.

**Telemetry props must be `{ cleared: boolean }` and nothing else.**
`guard_event_shape` rejects any prop key matching
`(body|message|content|text|detail|email|phone|name|token)`, so `label_name` is
refused server side. The label **value** must never be a prop: it is the one
string in this feature that is nobody else's business.

**Status: READY.**

**How it is verified.** `npm run verify` exits 0 (which is what catches a missing
`db-test.mjs` array entry) and `npm run test:db` passes 27 of 27, or
`npm run verify:full` for both.

**Size: 2 days.**

---

## 13. The rename UI

**What it is.** A third step inside the sheet the provider already reaches by
tapping the person's name.

**Figma reference.** `T3.13 Rename a conversation` (`45:31`), and
`T2.8 Details and safety` (`42:20`) for the sheet it lives in.

**Where it goes, and why not a new sheet.** `SafetySheet`'s existing `'menu'`
step is already titled with `peerName` and reached by tapping the identity block,
so it is already the details sheet. iOS puts rename behind exactly that push. The
alternative, a separate `PeerSheet`, means a second RN Modal opened over the
first on Android, which needs the first fully dismissed before the second mounts
or the second renders behind the first sheet's dim. The naming debt is that the
file should now be called `PeerSheet`. **Do not rename the file in this change**:
contract tests read it by path, so the rename is churn with no user-visible gain.

**The gate is `asProvider`, the per-conversation answer, never
`profiles.role`.** `src/screens/ChatScreen.tsx:157` already computes it as
`!knownThread.i_am_member`. A promoted provider keeps the threads they paid for
(migration 007), and gating on role would offer rename on their own member-side
conversations.

**Two traps.**

1. **The avatar initial follows the label.** The row derives it from the same
   string it displays, `initialOf(name)` at `src/screens/InboxScreen.tsx:199`, so
   renaming a thread to "Rahul from Pune" silently changes the avatar from M to
   R. The name slot prefers the label while the avatar keeps reading the peer's
   real display name, which means the row needs two values where it currently
   threads one.
2. **The optimistic write is not an optimisation.** `useConversations` has a 10s
   `staleTime` and the sheet closes immediately, so without patching
   `peer_display_name` and `my_label` in `keys.conversationList` before
   invalidating, the header shows the old handle for a beat after Save, which
   reads as the rename having failed.

**Files to change.**

- `src/api/chat.ts`: `useRenameConversation()`. It goes here rather than in
  `provider.ts` because `provider.ts` owns profile writes by its own stated
  charter and this is a conversation write whose invalidation target is
  `keys.conversationList`, which `chat.ts` owns. Set is an upsert with
  `onConflict: 'conversation_id,owner_id'`; clear is a delete. `tick()` on
  success, `errorTick()` plus `setNotice('Could not save that name.')` on
  failure, matching `useSetPresence`
- `src/screens/SafetySheet.tsx`: two new props `canRename` and `currentLabel`, a
  `'rename'` step in the existing `Step` union, a single-line `TextInput` with
  `maxLength={40}` matching the SQL check so the field cannot compose a value the
  database will refuse, `autoFocus`, `returnKeyType="done"`, `onSubmitEditing`
  saves, Cancel top-leading with `cancelLabel="Back"` exactly like the
  `'reasons'` step, a Save button, and a `kind="danger"` "Clear Name" rendered
  only when `currentLabel !== null`
- `src/screens/ChatScreen.tsx`: pass `canRename={asProvider}` and
  `currentLabel={knownThread?.my_label ?? null}`, and extend the identity block's
  `accessibilityLabel` on the provider path only

**The member path stays byte-identical**: same `testID` `open-safety`, same
accessibility label, same body copy, so the Maestro flows and the existing
contract greps are untouched.

**The empty-label fallback chain, stated once because three places have to
agree.** `my_label` null falls to `conversation_summaries.peer_display_name`,
which is `conversation_peers.peer_display_name`, which for a member peer is
`member_handle(peer_id)`, that is "Member 4f2a". That is also the TextInput's
placeholder, so the empty field shows what the row will keep saying if they walk
away. `ProviderHomeScreen`'s client-side `?? 'Member ' + peer_id.slice(0,4)`
fallback stays untouched: 011 made `member_handle` byte-identical to it on
purpose.

**Nothing new in motion or tokens**, so both enforcing tests stay green. The
sheet's spring already lives in `src/theme/motion.ts` via `GESTURE` and
`springTo`. No new dependency: the field is RN core `TextInput`.

**Status: READY** once item 12 lands.

**How it is verified.** `npm run verify` exits 0. Then on the emulator, with a
provider session: rename a thread, confirm the header and the inbox row both
update without a stale beat, confirm the avatar initial did **not** change, clear
the name and confirm it reverts to the handle. Then, and this is the assertion
that matters, open the same thread from a member session and confirm the name is
still "Ada".

**Size: 1 to 2 days.**

---

## 14. Migration 014: availability scheduling

**What it is.** A provider publishes recurring weekly hours and dated exceptions,
and the directory publishes only "open now" and "next open at".

**Figma reference.** `T3.7 Availability calendar` (`44:9`), `T3.8 Day editor`
(`44:20`), `T3.12 Dated exceptions` (`45:24`).

**The ordering trap this creates.** 014 must redefine `guard_event_shape` **in
full, including `conversation_renamed` from 013**, because
`__tests__/telemetry.test.ts` reads the last definition across all migrations in
filename order and asserts it is identical to the `TelemetryEvent` union.
Dropping a name from the reproduced list is a silent runtime rejection of a real
metric, and the test only compares the whole set, so a typo reads as a missing
event rather than as a typo.

**Two tables, both write-protected.**

```sql
availability_windows (
  id, provider_id,
  weekday smallint check (weekday between 0 and 6),
  start_minute smallint check (start_minute between 0 and 1439),
  end_minute smallint check (end_minute between 1 and 1440),
  check (end_minute > start_minute),
  created_at,
  unique (provider_id, weekday, start_minute)
)
availability_exceptions (
  id, provider_id, on_date date,
  start_minute smallint null, end_minute smallint null,
  created_at
)
```

Weekday is 0 for Sunday to match `extract(dow)` exactly, so the column and the
predicate that reads it cannot drift. Minutes rather than `time` because
arithmetic on an integer is checkable in a CHECK and a smallint pair is one index
entry. `end_minute = 1440` means midnight, so "10 pm to midnight" needs no trick.

**A window does not wrap.** A night provider writes Tue 22:00 to 24:00 and
Wed 00:00 to 02:00 as two rows, which is what the day-editor UI produces anyway,
and which keeps every predicate free of modular arithmetic. Rejected: minute-of-
week plus duration, which makes wrap free and overlap one-dimensional, at the
cost of a table no human can read without dividing by 1440.

**Exceptions have one precedence rule, stated once.** If any exception row exists
for an IST date, the recurring week is ignored for that date and only the
exception rows apply. A day off is one row with both minutes null. A partial
unique index `(provider_id, on_date) where start_minute is null` makes "off all
day and also open 7 to 10" unrepresentable. Rejected: an `is_open` boolean per
exception with additive and subtractive semantics, which is two rules that
interact and invites an argument about a subtract overlapping an add.

**Timezone: store IST wall clock, evaluate with the tz database, publish
instants.** Four reasons in order of weight. A recurring window is a wall-clock
intention, not an instant: "Tuesdays 7 pm" has no UTC form until you supply a
date, so storing UTC for a recurring rule is a category error rather than a
trade-off. India has no DST, so the usual "store UTC to survive the transition"
argument has nothing to bite on. The evaluation is written
`(now() at time zone 'Asia/Kolkata')` and never `now() + interval '5:30'`, so the
offset is read from the tz database it belongs in and the day a second country is
added the change is a column rather than an audit. And nothing timezone-shaped
ever reaches the device: what the member reads is `next_open_at`, a real
`timestamptz`, rendered by `listStamp`. State that split in the header comment:
wall clock for the author, instant for the reader.

**Three concepts, three writers, and the schedule writes neither of the other
two.** `presence` is the person's declaration, instant, both roles, in no guard
trigger by design (ADR-0013). `is_available` is the provider's manual listing
master switch, instant, unguarded for the same reason. The schedule is an
intention, edited rarely and read continuously. `open_now` is derived at read
time as `is_available AND coalesce(availability_open_now(id), true)`. The manual
switch always wins, because it is the emergency stop and a rule set last month
must never override somebody deciding now that they want to stop being contacted.
A closed schedule beats `is_available = true` for the rail, because the schedule
is a promise the app made to members on her behalf. **The schedule must never
write `presence`**: ADR-0013 records how uncomfortable even 012's narrow backfill
was about asserting a state on somebody's behalf, and a cron doing it hourly is
that mistake on a timer.

**The safety property that makes 014 deployable.**
`availability_open_now(uuid, timestamptz default now())` returns **NULL, not
false**, when a provider has published no schedule. Every provider that exists on
the day this ships has no rows, so `coalesce(..., true)` collapses `open_now` to
`is_available` and nothing in the directory changes. False would silently delist
all of supply. If a later edit turns that NULL into false, every provider
vanishes the moment it deploys, which is why the pgTAP assertion for a provider
with no rows exists specifically to be the thing that fails.

**What a member sees, and what is deliberately not published.** The weekly
calendar is never published, and that is a safety decision rather than a scoping
one: a provider's recurring hours say when she is alone with her phone and, by
inference, when she is not, and this product publishes an integer age instead of
a birth date precisely to avoid that class of disclosure. What is published is
`open_now` and `next_open_at`, appended to `provider_directory`. The row's
trailing slot gains one rung in its existing fall-through rather than a third
line, because uniform row height is what makes the inset hairline work at all:
`presence.here` wins, else the next-open line, else `readPresence`'s away or
hidden line, else the reply latency.

**Writers.** `set_availability_windows(p_windows jsonb) returns jsonb` validates
(provider role, at most 40 rows, weekday 0..6, minutes in range, end > start),
sorts and merges overlapping and adjacent spans per weekday, replaces the whole
set in one transaction, and **returns what it actually stored**, which is the
same principle as `missing_fields`: the UI renders the server's truth after the
merge instead of the thing it sent.
`set_availability_exception(p_date date, p_windows jsonb)` replaces one IST date,
empty array meaning off all day, and refuses a past date with 22023.
`clear_availability_exception(p_date date)` deletes that date.
`prune_availability_exceptions()` is service_role and deletes rows older than 60
days, mirroring the cron-shaped `refund_unanswered_messages` and
`refresh_reply_latencies`.

`availability_open_now` and `availability_next_open` are SECURITY DEFINER on
purpose: as INVOKER they would return a silently wrong answer to any caller RLS
hides rows from, and what they disclose is a boolean and one timestamp the
directory publishes anyway.

**The guard trigger.** One function, `guard_availability_writes()`, attached as
two triggers BEFORE INSERT OR UPDATE OR DELETE, raising 42501 when `current_user
in ('authenticated','anon')` and additionally refusing a row whose `provider_id`
is not a provider. It must be **SECURITY INVOKER** and the migration must say why
in the same words 003, 004 and 012 use: under DEFINER `current_user` is the
function owner, the branch is never reached, and the guard passes everything
while reading as a guard. The provider-role check is a trigger rather than a
CHECK because `role` lives on another table. The reason a member may not hold a
schedule is the same as the reason a member holds no headline: a member's weekly
routine is pure re-identification risk on the side of the conversation talking
about the worst week of their life.

**The view replace, which is the edit shape that silently deleted five guards in 010.** `create or replace view public.provider_directory` with `open_now` and
`next_open_at` **appended after `presence`**, never dropped: `pending_pushes`
(009) left joins it, so a drop either fails on the dependency or, under CASCADE,
silently takes the push sender with it. `create or replace` cannot remove or
reorder a column, which is what forces the whole 012 select list to be reproduced
verbatim. What proves the reproduction is honest is that the 050, 060, 070, 090
and 110 suites all read this view. `is_available` therefore stays in the view even
though the client stops reading it, and the honest reason to write in the comment
is that removing it is impossible without the cascade, not that it is still
wanted. Also add a `my_availability` view so a provider can see why her switch is
on and she is still not listed.

**Files to change.**

- `supabase/migrations/014_availability_scheduling.sql` (new)
- `supabase/tests/130_availability_scheduling.sql` (new), `select plan(40)`
- `scripts/db-test.mjs`: both arrays again
- `src/lib/database.types.ts`: `ProviderSummary` gains `open_now` and
  `next_open_at`; new `MyAvailability` and `AvailabilityWindow` types;
  `TelemetryEvent` gains `availability_schedule_saved` and
  `availability_exception_set`
- `__tests__/contract.test.ts`: 130 into the plan-count `it.each`, and **the two
  pinned literals** `p.is_available && !blocked.has(p.id)` at roughly lines 1056
  and 1888 become `p.open_now`
- `docs/adr/0017-availability-is-a-schedule-not-a-switch.md` (new)

**The 40 assertions.** Shape and boundary (12): both tables exist;
`availability_windows.provider_id` not null; both guard triggers attached;
`guard_availability_writes.prosecdef` is false; `provider_directory` has
`open_now` and `next_open_at`; it still has `presence` and still has no
`date_of_birth` after the replace; `authenticated` still holds exactly one SELECT
grant on it; `anon` holds zero grants on `availability_windows`. Writers (8): the
approval fixture lives; a member calling `set_availability_windows` throws 42501;
a client INSERT, UPDATE and DELETE each throw 42501; a provider's call lives; her
row count is 2; an unrelated member sees 0. Validation (4): end before start
throws 22023; weekday 7 throws 22023; a past exception date throws 22023;
overlapping input merges to 1. Evaluation (12): open inside a window and closed
outside; `open_now` true for a schedule covering the current IST minute;
`next_open_at` null while open; `open_now` false after `is_available = false`,
proving the manual switch wins; `presence` still reads `here` afterwards, proving
012's separation survived; `open_now` false and `next_open_at` not null when the
schedule does not cover now; **`open_now` true for a provider with no rows at
all**, which is the degeneracy that makes the deploy safe; false with an
all-day-off exception; true with a windowed exception on a normally closed day;
restored after `clear_availability_exception`. Telemetry and service role (4).

**A CI trap worth naming.** The evaluation assertions have to write windows that
cover the current IST minute, because the view calls `now()`. A suite that
hardcodes 19:00 passes for three hours a day and fails for twenty-one, and it
will fail in CI at a different hour than on the machine it was written on.

**Status: BLOCKED** on one product decision: does a scheduled-closed provider
still accept a message from a member she has never spoken to? See the blocked
section. The default if no answer arrives is disclosure rather than a gate, which
needs no new server behaviour and does not have to be undone to add the gate
later.

**How it is verified.** `npm run verify` exits 0 and `npm run test:db` passes 40
of 40, or `npm run verify:full`. Run the suite twice at different hours of the
day, deliberately.

**Size: a week.** It is the largest single item in the plan.

---

# Phase F: provider

## 15. Application repair: prefill, additive resubmit, live status

**What it is.** Fix the three bugs that make the existing application flow lose
somebody's answers, hide the flagged fields, and never tell them the outcome.

**Figma reference.** `T3.1 Apply, step 1 of 3: You` (`43:25`),
`T3.2 Apply, step 2 of 3: How you talk` (`43:32`),
`T3.3 Apply, step 3 of 3: Why you` (`43:39`), `T3.4 Status` (`43:46`),
`T3.4b Needs info, and rejected` (`45:2`).

**Bug 1: resubmission is destructive, and it is the worst one.**
`my_application` does not publish `display_name`, `gender`, `headline`,
`languages` or `about`, and `ProviderApplicationScreen` initialises all six inputs
to empty strings. So "Fix and Resubmit" from `needs_info` starts from a blank
form, and `submit_provider_application`'s ON CONFLICT sets
`display_name = excluded.display_name` and so on for every column with
`nullif(btrim(...), '')` applied. An applicant who was asked for one missing
field, fills that field and submits, **NULLs the other five and gets them all
back as `missing_fields`**. The screen whose entire reason for existing is that
Clarity says "Something Missing" without saying which thing turns one missing
field into six.

The fix is both halves, and it needs both: extend `my_application` with the six
submitted values and prefill the screen from them, **and** make the RPC's ON
CONFLICT preserve a column when the incoming value is blank
(`coalesce(nullif(btrim(excluded.x), ''), pa.x)`). The prefill fixes the person's
experience, the coalesce fixes the API for any client.

**Bug 2: the flagged markers do not render on the resubmit path.**
`const [missing, setMissing] = useState<string[]>(existing?.missing_fields ?? [])`
at `ProviderApplicationScreen.tsx:93` reads a React Query result that is
`undefined` on first render, and `useState` ignores every later value. So on a
fresh mount from the status screen the "Still Needed" box and the `(required)`
labels are absent until a submit round trip has happened. Derive `missing` from
the query with `useEffect` or a key reset.

**Bug 3: nothing tells the app.** `App.tsx` sets
`refetchOnWindowFocus: false` globally, `useMyApplication` has no
`refetchInterval`, and nothing subscribes to `provider_applications` or
`profiles` over Realtime. An applicant sitting on the status screen will never
see it change, and an approved provider stays on the member tree until the
process is restarted. That directly contradicts the documented promise, which is
not faster review but telling people the truth continuously. Give
`useMyApplication` a `refetchInterval` of 30s and `refetchOnWindowFocus: true`
**while the status is non-terminal only**, and invalidate `keys.profile` when it
flips to `approved`. That is one query, one applicant, only while waiting, and it
is what makes both the status screen and the role flip live without touching the
global query defaults or adding a Realtime subscription.

**Files to change.** `supabase/migrations/014_...` (or a 015 if 014 is already
cut) for the view and the RPC, `src/screens/ProviderApplicationScreen.tsx`,
`src/api/provider.ts`, `src/lib/database.types.ts`.

**Status: READY.** One sub-decision is open (can a rejection ever be reopened),
listed in the blocked section, and it does not gate bugs 1 to 3.

**How it is verified.** `npm run verify:full` exits 0. Then on the emulator with
a real application: submit with one field missing, land on `needs_info`, reopen
the form, and confirm the other five fields are still there and the missing one
is flagged before any submit happens.

**Size: 2 days.**

---

## 16. The review console, so `under_review` becomes reachable

**What it is.** A service-role queue over `provider_applications` that calls the
three existing RPCs.

**Figma reference.** `T3.5 Review queue` (`43:57`).

**Why it is needed.** `approve_provider_application`, `request_application_info`
and `reject_provider_application` are service_role only and have **zero callers
anywhere outside `supabase/tests/`**. `scripts/provider-console.mjs` is a provider
chat client, not a review queue, and its own header says the provider surface did
not exist when it was written. There is no queue projection either, so a reviewer
would be writing UPDATEs by hand, which is exactly what the three RPCs exist to
prevent. And no function in any migration sets `under_review`, so
`COPY.under_review` ("Someone is reading it now") can never render: either a
reviewer tool sets it or the enum value should go.

**This item gates item 17 in practice.** Until a provider can be admitted outside
pgTAP, nobody can look at the availability screen on a device without hand-running
an RPC with the service key.

**Files to change.**

- `scripts/review-console.mjs` (new)
- the migration adds `provider_review_queue`, a service_role view over
  `provider_applications` ordered by `submitted_at`
- `package.json`: a `review` script beside `moderate` and `provider`

**Status: READY.**

**How it is verified.** Run it against the live project with the service key and
move one real application through submitted, under_review, needs_info and
approved, checking the status screen on a device at each step. This is the first
time the approve path is exercised outside pgTAP.

**Size: 1 day.**

---

## 17. The availability UI

**What it is.** A seven-row day list, a day editor, and a fourteen-day exceptions
list. No calendar dependency.

**Figma reference.** `T3.7 Availability calendar` (`44:9`), `T3.8 Day editor`
(`44:20`), `T3.12 Dated exceptions` (`45:24`), `T3.10 Go live` (`44:27`).

**Not a month grid, and the arithmetic is what rules it out, not taste.** Seven
columns at `interaction.minTarget` 48 is 336pt, and the usable width on a 360pt
device after `space.md` margins is 328pt. It does not fit, and `hitSlop` cannot
rescue it because adjacent cells would steal each other's taps. A weekly time
grid is worse: 7 by 48 half-hours is 336 targets, which puts each row at roughly
9pt tall. **Put that arithmetic in the file header**, because it is the reason
somebody will otherwise reopen.

So: seven flat rows divided by inset hairlines, day name leading, that day's
windows trailing as text, `chevron-right` at 13pt, today marked with `labelSmall`
weight rather than colour because the accent budget is spent. A day with no
windows reads "Closed" in tertiary. Tapping a day pushes a day editor holding its
windows as removable rows, an "Add Hours" action, and **"Copy to Every Day" plus
"Copy to Weekdays"**, which is the one affordance that makes a seven-day setup
finishable in under a minute. Exceptions are a list of the next fourteen days,
not a month, because exceptions are near-term and a list carries a 48pt row.

**Time entry follows the date-of-birth precedent exactly.**
`ProviderApplicationScreen` records why there is no native picker: every RN date
picker is a native module, the house rule is to check `npm view <pkg>
time.modified` first, and ADR-0010's review trigger 2 names a date picker as a
reason to revisit rather than a reason to add one now. So "Add Hours" is two
`TextInput`s on a number pad with `formatTimeInput` auto-inserting the colon,
mirroring `formatDobInput`, and `timeToMinute` mirroring `dobToIso`. Input is
24-hour because a 12-hour field needs an am/pm control that doubles the taps.

**`minuteLabel` must not reuse `timeOfDay`.** `timeOfDay` converts to
device-local time, which is right for a message stamp and wrong for a wall-clock
schedule. It formats a faked UTC epoch instant with `timeZone: 'UTC'`, so the
number the provider typed survives any device timezone while the am/pm marker
still follows the phone. `minute === 1440` renders "midnight", because "12:00 am"
at the end of a range reads as the start of the day.

**Dependencies: none, and the rejections are on record.**

| Package                                  | Version, modified    | Verdict                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-native-calendars`                 | 1.1314.0, 2026-03-04 | REJECT. Pulls `recyclerlistview`, so the app would ship a second list engine beside FlashList, plus `lodash`, `prop-types`, `xdate` and `react-native-swipe-gestures` (2022-06-26, four years untouched)                                                                                                                               |
| `@marceloterreiro/flash-calendar`        | 2.0.0, 2026-03-04    | FALLBACK ONLY. Genuinely clean: View-based, no SVG, peers on the FlashList 2.x already installed. Rejected on fit, because what is needed is a day list and a fourteen-day list, not a month grid, and it arrives with its own theming and its own animation timings against the rule that every spring lives in `src/theme/motion.ts` |
| `@react-native-community/datetimepicker` | 9.1.0, 2026-06-16    | REJECT for now, and it is the closest call. Recent and healthy, and it is a native module, which is exactly the trigger `ProviderApplicationScreen` already deferred on. Reconsider it as one decision covering both the birth date and the schedule                                                                                   |
| `luxon`, `date-fns`, `dayjs`             | current              | NOT NEEDED. Storing IST wall clock and publishing `timestamptz` means no timezone maths happens on the device. `src/lib/datetime.ts` is 130 lines and already owns every string this app renders                                                                                                                                       |

**Files to change.**

- `src/lib/availability.ts` (new, pure): `formatTimeInput`, `timeToMinute`,
  `minuteLabel`, `mergeWindows`, weekday labels, `summarise`. Mirrors
  `src/lib/dob.ts` and `src/lib/presence.ts`
- `__tests__/availability.test.ts` (new)
- `src/api/availability.ts` (new): `useMyAvailability`,
  `useAvailabilityWindows`, `useSetAvailabilityWindows`,
  `useSetAvailabilityException`, `useClearAvailabilityException`
- `src/screens/ProviderAvailabilityScreen.tsx` (new)
- `src/screens/AvailabilityDayEditor.tsx` (new)
- `src/screens/ProviderHomeScreen.tsx`: a chevron row under the listing switch,
  plus a line saying when the schedule disagrees with the switch, read from
  `my_availability`
- `src/components/ProviderRow.tsx`: one rung in the existing trailing
  fall-through for `next_open_at`. No third line
- `src/screens/InboxScreen.tsx`: the free-now rail filters on `open_now`
- `src/screens/ProvidersScreen.tsx`: the free count reads `open_now`
- `src/api/chat.ts`: `useProviders` orders by `open_now`
- `src/lib/routes.ts`: `ProviderRoute` gains `availability`. `providerParent`
  already handles it, because it maps anything that is not `home` back to `home`
- `App.tsx`: route it

**One thing to verify on the emulator before calling it done.** The day editor
over the day list is a sheet on a sheet if it is presented from `SettingsSheet`.
Reach the availability screen from `ProviderHomeScreen` and **push** the day
editor rather than presenting it.

**The night-window case deserves a table-driven test rather than an example.**
The no-wrap rule pushes the split of 22:00 to 02:00 into the client. If
`mergeWindows` or the day editor gets it wrong, a provider who works nights sees
her Wednesday hours attributed to Tuesday.

**Status: BLOCKED** on item 14, which is blocked on the send-gate decision.

**How it is verified.** `npm run verify` exits 0 with the new pure-module suite.
Then on the emulator: set a seven-day schedule using Copy to Weekdays and time
it, set a night window and check both days read correctly, add a day-off
exception and check the directory row's next-open line, and turn the manual switch
off while the schedule says open and check the row goes dark.

**Size: 3 to 4 days.**

---

## 18. The admitted moment

**What it is.** A one-shot "You are in" screen after admission, ending on the
availability screen.

**Figma reference.** `T3.6 Admitted, you are in` (`44:2`), `T3.10 Go live`
(`44:27`).

**Why it does not exist today.** Role selects the whole navigation tree
(ADR-0002), and `ProviderRoute` is only `home | chat`, so `COPY.approved`
("You are in") is unreachable from the tree an approved provider lands in. A
schedule set at admission is the difference between a directory of names and a
directory of names with times, which is why this screen ends on availability
rather than on home.

**Files to change.** `src/lib/routes.ts` (`ProviderRoute` gains `welcome`),
`App.tsx`, a new screen, and the copy from `ProviderStatusScreen`'s
`COPY.approved`.

**Status: READY** once items 14 and 17 land.

**How it is verified.** Admit a real application through item 16's console and
watch the app move from the member tree to the provider tree without a restart,
landing on the welcome screen once and never again.

**Size: 1 day.**

---

# Phase G: settings

## 19. Settings becomes a route, not a sheet

**What it is.** `SettingsSheet` is promoted to `SettingsScreen`, a route with the
same collapsing large-title bar as Chats and Explore.

**Figma reference.** `T4.1 Settings dashboard` (`47:2`), and the sub-screens
`T4.4 Presence` (`47:27`), `T4.6 Notifications` (`48:2`),
`T4.7 Privacy` (`48:9`), `T4.8 Appearance` (`48:16`),
`T4.9 Delete account` (`48:23`).

**Why it has to stop being a sheet.** `Sheet` dismisses on a drag past 28% of its
height or a fling over 800 px/s (`design/tokens.json:210-214`). A scrolling
dashboard inside that surface puts a vertical scroll in direct competition with a
vertical dismiss, which is the one gesture conflict a bottom sheet cannot
arbitrate.

**Keep everything that is there.** The inset-grouped rows, the section footers,
the chevron pushes, and the destructive action alone in its own group at the
bottom, which the file's own comments defend as the iOS pattern. The presence
group and its role-branching footer move to the privacy sub-screen unchanged.

**Files to change.**

- `src/screens/SettingsSheet.tsx` becomes `SettingsScreen.tsx`
- `src/lib/routes.ts`: `{ name: 'settings' }` in `MemberRoute` with `inbox` as its
  parent. `__tests__/routes.test.ts` covers this table, so every addition needs a
  case, and **the parent map is the thing that stops the Android back gesture
  quitting the app from inside a conversation**. Get it wrong and back becomes
  rude again
- `App.tsx`
- `src/screens/InboxScreen.tsx`: the bottom bar sheds the settings target, because
  the bar's trailing `ellipsis-circle` now carries it (item 4)

**Status: READY** once items 4 and 10 land.

**How it is verified.** `npm run verify` exits 0 including the routes suite. Then
on the emulator, the back gesture from Settings, from a sub-screen of Settings,
and from a conversation opened from Settings.

**Size: 2 days**, plus a day for the five sub-screens' shells.

---

## 20. `member_usage`: the six tiles that are real today

**What it is.** A member-side mirror of the `provider_earnings` view that already
ships, and six tiles built only on data that exists.

**Figma reference.** `T4.2 Tokens and usage` (`47:9`), and
`T4.2b Refused tiles` (`48:30`) which is the note recording what must not be
drawn.

**Why this is safe.** One message costs exactly one token and that is an
**enforced invariant, not a convention**: `MESSAGE_COST = 1` at
`src/lib/tokenLedger.ts:17`, mirrored by the SQL, and asserted by the parity test
`scripts/db-test.mjs` generates. So `count(messages where sender_id = me and
refunded_at is null)` **is** tokens spent on messages, exactly rather than
approximately, and `messages.created_at` buckets it by day.

**The pattern is already proven and already on screen on the other side.**
`public.provider_earnings` (`006_...sql:740`) is a `security_invoker = true` view
doing precisely this aggregation for providers, rendered at
`src/screens/ProviderHomeScreen.tsx:223` through `useEarnings`. The member view is
a mirror of a view that exists, is granted, and works. And it is legal: the
"Participants read messages" policy (`003_...sql:211`) lets either party select
messages in a thread they are in, so a `security_invoker = true` view filtering
`sender_id = auth.uid()` needs no definer rights and no new table.

**The six tiles.** Balance from `profiles.token_balance`, already in
`useProfile`. Next free refill, computed as `last_refill_at + 24h`, or "Available
now" when the column is NULL or older than 24h. Messages sent, lifetime and last
30 days, which equals tokens spent on messages. People talked to, `count(distinct
conversation_id)` over own sends. Since, `min(created_at)` over own sends. And a
30-day usage histogram, `date_trunc('day', created_at)` over own sends.

**The histogram is drawn with Views, following `Waveform.tsx`.** No chart library,
because react-native-svg is banned. `src/components/Waveform.tsx` is the working
precedent: a bar row at fixed geometry (`BAR_WIDTH 2, BAR_GAP 2, BAR_MIN 3,
BAR_MAX 22`) whose docstring explains why fixed rather than flexed geometry is
load-bearing. A usage histogram is the same component with a different height
mapping and no playhead.

**One missing index, which is a migration but not new schema.** Every tile filters
`messages` on `sender_id`, and there is no index for it: the only two on the table
are `messages_chat_created_idx` (on the dead pre-pivot `chat_id`) and
`messages_conversation_created_idx`. Add
`create index if not exists messages_sender_created_idx on public.messages (sender_id, created_at desc)`.
Without it the lifetime counts and the 30-day series are sequential scans on the
hottest table in the product, behind a screen members will open repeatedly.

**Three tiles must be explicitly refused rather than deferred quietly**, because
each would look plausible and be false.

1. **Tokens received, or grant history.** Impossible.
   `profiles.last_refill_at` is a single timestamptz that `claim_daily_tokens`
   overwrites on every successful claim (`002_...sql:149`). Only the most recent
   claim survives. The number of claims, the dates of earlier claims and the
   50-token signup grant are all gone.
2. **Balance over time.** Impossible, because a past balance needs the grant
   history. Any curve drawn today would be reverse-engineered from message counts
   and would diverge from the real balance for every user who has ever claimed a
   refill. Do not draw a sparkline. It is the exact category of plausible-looking
   fiction to avoid.
3. **Anything in rupees.** See item 21.

**The `events` table cannot serve as the ledger**, for three independent reasons
any one of which is disqualifying. The app literally cannot read it:
`005_...sql:596` revokes all then grants INSERT only, with no SELECT policy at
all, and the comment is explicit that a client can emit its own events and can
never read anybody's, including its own. It is client-emitted and
fire-and-forget: `record` in `src/lib/telemetry.ts` swallows every error and
returns silently when there is no user, so counts would run below reality and
never tie to the balance. And `guard_event_shape` rejects any props key matching
`/token/`, so an amount cannot even be carried under a truthful name.

**A copy contradiction this screen will expose.** `RefillSheet.tsx:28` tells
members "One message costs one token: nothing else spends them, not long replies
and not long messages." That is true today and becomes **false** the moment
`CALLS_ENABLED` flips, because a call costs 5 tokens a minute
(`call_tokens_per_minute()`, `011_...sql:790`). Fix the copy in the same commit
that flips the flag, not after. Every call tile ships as a zero until then, so
gate them on the same flag rather than showing an honest but confusing 0.

**Files to change.** a migration for the view and the index,
`src/api/usage.ts` (new, the twin of `useEarnings` with the same 60s
`staleTime`), `src/components/UsageBars.tsx` (new),
`src/screens/SettingsScreen.tsx`, and the local `Stat` component at
`src/screens/ProviderHomeScreen.tsx:281` moved somewhere shareable rather than
duplicated.

**Status: READY.**

**How it is verified.** `npm run verify:full` exits 0. Then on a member session
with real message history, check the lifetime count against a direct
`count(*)` in psql, which is the whole point of an exact rather than sampled
metric.

**Size: 2 days.**

---

## 21. Statement, not Invoices

**What it is.** A statement of account denominated in tokens, with no rupee
figure anywhere on it.

**Figma reference.** `T4.3 Statement, not Invoices` (`47:16`).

**Why the word Invoices cannot ship.** An invoice needs four things: an
identified payer, an amount in currency, a tax treatment, and a settled
transaction. **Zero of the four exist.** There is no currency, no paise, no
GSTIN, no place of supply, no HSN or SAC code and no invoice number series
anywhere in twelve migrations. `docs/play/listing.md` section 6 states outright
that there is no purchase path in the app, that tokens come from a 50-token
starting balance and a 25-token daily refill, both free, and that the listing
declares In-app purchases: No and Financial features: none. Razorpay appears
nowhere in the repo. Cashfree appears exactly once, at
`docs/play/listing.md:218`, as a plan pending KYC.

It is also legally loaded rather than merely empty. A tax invoice for a B2C
digital service in India needs a GSTIN, a serial number per Rule 46, and a place
of supply. Emitting a document called an invoice for tokens that were given away
free would be false on its face and a compliance problem on top.

**The single worst outcome, and it is the easy one to reach by accident**, is an
Invoices row that opens a screen with a rupee figure on it. Every number on such
a screen would be invented.

**So the honest surface is a Statement in tokens.** Rename the section, denominate
it in tokens, put no rupee symbol on the screen. `TokenCounter`'s accessibility
label already says "One message costs one token", and the dashboard copy must stay
consistent with it. `DAILY_REFILL_TOKENS = 25` and `STARTING_BALANCE = 50` from
`src/lib/tokenLedger.ts` are the numbers the copy quotes.

**Files to change.** `src/screens/StatementScreen.tsx` (new),
`src/screens/SettingsScreen.tsx`,
`docs/adr/0018-money-surfaces-say-tokens-not-rupees.md` (new).

**Status: BLOCKED** as an invoice surface, on the merchant-of-record question.
**READY** as a statement.

**How it is verified.** `npm run verify` exits 0. Then a deliberate grep of the
screen and its catalogue entries for a rupee symbol, `INR`, `amount` and `price`,
returning nothing.

**Size: 1 day** as a statement. As real invoices, it is a migration plus a
payments integration plus a tax treatment, and it should not be estimated until
the merchant-of-record answer arrives.

---

# Phase H: the gaps

These five are smaller, and each closes something that is currently broken rather
than missing.

## 22. Permission primers and a denied-recovery state

**What it is.** An explainer before each runtime permission request, and a route
back for anyone who has already denied twice.

**Figma reference.** `T1.6 Notification primer` (`39:2`),
`T1.6b Permission denied recovery` (`39:51`), `T2.7 Voice note` (`42:9`).

**Why it is a bug fix wearing a screen's clothes.** `src/lib/push.ts:53` and
`src/lib/recorder.ts:131` each call `PermissionsAndroid.request` directly, cold.
On Android 13 and up, `POST_NOTIFICATIONS` and `RECORD_AUDIO` give one prompt and
a second denial is permanent with no in-app route back. So **voice notes, which
shipped for both roles, silently do not exist for anyone who tapped Deny once**,
and there is no way for them to discover why.

**Files to change.** `src/lib/push.ts`, `src/lib/recorder.ts`, a primer component,
and a permanently-denied branch that routes to system settings.

**Status: READY.**

**How it is verified.** On the emulator: deny twice, then confirm the app explains
rather than silently failing, and that the settings route actually opens the app's
own settings page.

**Size: 2 days.**

---

## 23. A transient confirmation primitive

**What it is.** A toast, because the app has none.

**Figma reference.** The Figma flow file has no toast frame. The reference is the
contra kit's `Toast home-listing` (`186:3233`), recorded in the gap analysis.

**Why it blocks four other things.** `NoticeBar` and `UpdateBanner` are both
persistent, so block, report, review, purchase and refill currently confirm
nothing to the user. Every one of those actions needs this before it can
acknowledge itself. It must not use react-native-svg.

**Status: READY.**

**How it is verified.** `npm run verify` exits 0. Then confirm on device that it
does not fight the sheet's gesture and that its spring comes from
`src/theme/motion.ts`.

**Size: 1 day.**

---

## 24. The notification centre

**What it is.** An in-app place to read back what was pushed.

**Figma reference.** `T2.11 Notification centre` (`42:41`). The structure was
already recorded in `README.md` from Pinterest pin `579557045824357127`: time
buckets as section headers (Today, This Week, Earlier), a circular avatar with a
small type badge overlaid at its lower trailing corner, one line mixing bold
subject with regular connecting words, and a relative timestamp that degrades to
absolute dates once relative stops being useful. No containers and no separators:
at five or six rows with varied heights, whitespace is enough, which is why the
separator question resolves differently here than in the chat list.

**Why it grows rather than shrinks.** Push is currently write-only, and the new
direction multiplies the events with nowhere to land: an Explore section, a
renamed conversation, a scheduled session, a token purchase and a statement all
generate notifications.

**Status: READY**, and it needs a table, so it is a migration too.

**Size: 3 days.**

---

## 25. The blocked list

**What it is.** A visible, reversible list of blocked people.

**Figma reference.** `T2.10 Blocked list` (`42:34`), `T4.7 Privacy` (`48:9`).

**Why.** `SafetySheet` can block from inside a chat, and unblock, but the list is
never visible anywhere else. A block you cannot find is a block you cannot undo.

**Status: READY.** The `blocks` table already exists.

**Size: 1 day.**

---

## 26. Provider detail, so reading a profile is free

**What it is.** The screen a member reads before spending a token.

**Figma reference.** `T2.4 Provider detail` (`41:23`).

**Why it is the cheapest available reduction in refunds.** A member taps a
`ProviderRow` and lands directly in a metered conversation, so there is nowhere to
read a provider's full profile before paying. **The app currently monetises the
click that should be free.** `design/references/README.md` already logs the
pseudonymous profile UI as not built.

**One thing to hold in mind.** Provider detail plus scheduling together widen the
abuse surface: a profile rich enough to be worth reading and a calendar precise
enough to be worth booking give a determined member more to correlate against a
pseudonymous provider than today's directory row does. That is the argument for
publishing only `open_now` and `next_open_at` rather than the weekly grid.

**Status: READY.** The provider profile **editor** is separate and is blocked;
see the blocked section.

**Size: 2 days.**

---

# What is deliberately not in this spec

Recorded so the scope is visible rather than discovered later.

- **A real purchase flow.** `src/screens/RefillSheet.tsx` is 48 lines and grants
  free tokens. Making it real is blocked on the merchant-of-record question, and
  the flow itself (price list, payment method, order review, success, failure,
  pending, receipt) is its own project.
- **A `token_ledger` table.** It is the only thing that unlocks grant history and
  balance over time, and it is the one item where waiting has a real cost: the
  backfill has to post one reconciling `admin_adjustment` row per user, and every
  day of delay makes that adjustment larger. Message debits backfill exactly from
  `messages`, refunds from `refunded_at`, call debits from `calls.tokens_debited`.
  **Grants cannot be backfilled**, because the dates do not exist, so anything
  other than one adjustment row fabricates history in the one table whose whole
  value is that it does not.
- **Scheduling `refund_unanswered_messages` in pg_cron.** `messages.refunded_at`
  and the function both exist and are correct (`006_...sql:563` and `:565`), and
  **nothing schedules them**. The repo has exactly three `cron.schedule` calls:
  `dispatch-pending-pushes`, `meter-active-calls` and
  `purge-orphaned-voice-notes`. So `refunded_at` is NULL for every row in
  production and the promise in the migration comment is currently not kept. It
  is a real bug that exists independently of any screen here, and item 20 is what
  would make it visible to members. **First run will credit tokens in bulk**, one
  per unanswered member message older than 24 hours across all history, so run it
  once manually with a known `p_after` and read the count before scheduling it.
- **Calling's client half.** The schema, the meter and the blocking gates exist;
  the media layer, signalling and in-call surface do not. `CALLS_ENABLED` stays
  false.
- **Transcription.** The single biggest lever on accessibility here and on
  moderation cost, and it means sending user speech to a third party, which
  contradicts "we never analyse the contents of your messages". A product
  decision, not an implementation gap.
- **Provider ID verification.** `identity_verified_at` is set by approval alone.
  There is no document upload, no ID check and no liveness step, so the column
  means "a human read a form" and the age gate is a claim plus a CHECK. Named
  because "onboarding end to end" implies otherwise.
- **Location, blog, feed, music, alarm, weather, todo, notes, shop and friend
  invite**, all present in the reviewed Figma community kit and all rejected.
  Location in particular: there is no geography in a pseudonymous product, and
  publishing a provider's location inverts the safety model. Friend invite brings
  a whole social graph that contradicts pseudonymity and the no-contacts promise
  in `SettingsSheet`'s own body copy. Hamburger drawers are wrong for a product
  that just adopted a bottom bar. A numeric PIN keypad is one more secret to lose
  with no recovery path when auth is already OTP plus Google.
- **Four steps dropped from the WhatsApp onboarding**, recorded in
  `T1.0 Dropped from the WhatsApp flow` (`39:37`): contacts permission and
  contact sync, because there is no phone book and the directory is server-side;
  restore-from-backup, because history lives in Postgres and nothing is on the
  device; the "is this number correct" alert, because the OTP proves the number
  and the field auto-submits, so the alert confirms a thing twice; and the profile
  photo for members, because members are pseudonymous by decision and a photo is
  a deanonymisation vector.

---

# BLOCKED: what is needed from Amit

Nine items. Each is phrased as one action. Three cost money and name a rupee
figure.

## B1. Choose the Devanagari face. Blocks item 9, which blocks shipping Hindi.

**The action.** Reply with either "Noto Sans Devanagari" or "Mukta".

**Why it cannot be decided without you.** Both are OFL and both work. Noto is the
AOSP and Pixel fallback, so it is the face most Android users already read
Devanagari in, which makes it the safe default and is the recommendation. Mukta is
by Ek Type and is designed as a Devanagari-first family rather than as a
super-family member. The choice changes four bundled files, the typography layer,
the font test and about 400 KB of APK. Cost: **Rs 0.**

**Consequence of not answering.** The Hindi option cannot ship. Urbanist has no
Devanagari, so Hindi text falls back to whatever the OEM ships, at regular weight
regardless of the style, with clipped matras and broken conjuncts, and
`npm run verify` passes the whole way.

## B2. Answer the send-gate question. Blocks item 14, which blocks items 17 and 18.

**The action.** Reply with either "disclosure" or "gate".

**The question.** Does a scheduled-closed provider still accept a message from a
member she has never spoken to?

**Disclosure** means yes: she leaves the free-now rail and the count, she sorts
below open providers, and the row says when she is back before anything is spent.
`refund_unanswered_messages` already means nobody pays for silence. This is the
recommendation, for three reasons: the member's token is protected without a
refusal; an app whose pitch is company telling somebody in distress at 3 am to
come back at 9 is the worst thing it could do; and nothing on the server reads
`is_available` today, so it needs no new server behaviour.

**Gate** means a hard refusal in `open_conversation` only (existing threads always
keep working, which the toggle copy already promises), returning a distinct
`SCHEDULED_CLOSED` error the client renders as "Ada is back at 7:00 pm". Stricter
and defensible, and it trades revenue and reachability for a promise kept exactly.

**If no answer comes, build disclosure**, because it needs no new server behaviour
and does not have to be undone to add the gate later. But writing disclosure first
does not make the gate cheaper later: the gate is a new server behaviour plus a
new error code plus four client render paths, not a flag flip. Cost: **Rs 0.**

## B3. Decide the merchant of record. Blocks real invoices and the purchase flow.

**The action.** Open a Play policy support ticket asking, in writing, whether
Papal's token top-ups must use Google Play Billing, and send the reply.
`docs/clarity-learnings.md` section 8 already recommends exactly this and its
analysis should go in the ticket.

**Why it decides the schema and not just the screen.** Under Play Billing, Google
is merchant of record and Google issues the receipt, so an in-app invoice would
duplicate a document Papal did not issue. Under Cashfree, Papal is the merchant
and must issue a GST invoice with a gapless serial per Rule 46, a place of supply
and a GSTIN. **The two answers need different tables**, so drawing invoice screens
before the answer means drawing them twice.

**The sharp observation already in the record**, worth repeating in the ticket:
the non-clinical positioning that protects the Play listing is exactly what
forfeits the real-world-services exemption.

Cost: **Rs 0** for the ticket. If Play Billing applies, roughly 15% platform cost
plus gateway fees plus the provider split plus TDS and GST. This is a lead time,
not a task.

## B4. Register for Udyam. Rs 0, about 15 minutes, and it unblocks two channels.

**The action.** Go to `udyamregistration.gov.in`, complete Udyam registration with
your Aadhaar OTP and PAN, and save the certificate PDF.

**Why this one first.** It is the single free document that unlocks both auth
channels. Meta accepts it for business verification for an Indian sole proprietor
with no company. Vilpower (Vi) and Airtel both accept it as standalone entity
proof for DLT alongside the proprietor's personal PAN, and Airtel's portal has an
explicit "not GST registered" reason to select. Jio's list is narrower (GST, TAN,
FSSAI or incorporation), so use Vilpower or Airtel.

Cost: **Rs 0.** The Ministry of MSME states zero cost, no fee, and the certificate
issues in about 10 to 15 minutes.

## B5. Decide the Fast2SMS top-up. Rs 118, and it buys an answer worth having.

**The action.** Pay Rs 100 of credit into the Fast2SMS wallet (Rs 118 payable
including 18% GST) and complete their Aadhaar KYC, or reply "not yet".

**Why Rs 118 and not Rs 100.** The Add Credit box is the credit amount and GST is
added on top; their own worked example is 4000 in the box and Rs 4720 payable.
Fast2SMS gates its whole API on error 999 ("Complete single transaction of minimum
100 INR in Fast2SMS wallet before using API") and gates the OTP API on error 996
("Before using OTP SMS API, complete KYC"). The Rs 50 free signup credit does not
satisfy a "single transaction of Rs 100". **Wallet balance is non-refundable**, so
this is spend and not float.

**What the Rs 118 actually buys.** It is the cheapest way to find out whether
Fast2SMS will accept this app's category at all, and that answer is worth having
before Rs 5,900 goes into DLT. Their KYC step asks for the website URL, so the
site is what gets judged. **Present it as paid peer-support conversations,
explicitly not dating and not adult**, because their terms name dating
specifically and separately ban adult or sexual content, with account ban and no
refund of wallet credit.

## B6. Decide the DLT entity registration. Rs 5,900, 3 to 7 working days.

**The action.** Start DLT entity registration on Vilpower with the Udyam
certificate from B4 and your PAN, or reply "not yet".

**Cost: Rs 5,900** (Rs 5,000 plus 18% GST), one time. Registration on one operator
portal is valid across all four. Entity approval is 1 to 3 working days and header
plus template another 1 to 3 each, so 3 to 7 working days with clean documents,
which is faster than the 1 to 3 weeks ADR-0006 assumed.

**Why it is worth the money rather than living on a no-DLT route.** The entity ID,
header and templates belong to us and are portable across every Indian
aggregator, so a single vendor's ban costs the wallet balance and not the channel.
A shared-template or Quick SMS arrangement makes the vendor's discretion the whole
product.

**The steady-state comparison at 1,300 OTPs a month.** WhatsApp Rs 176. SMS on our
own DLT template Rs 384. Fast2SMS Quick SMS (no DLT, works today, Rs 5.00 plus GST
per message) Rs 7,670. Firebase about Rs 8,000, and it also moves `auth.uid()` off
Supabase Auth, which is 64 call sites. Quick SMS is acceptable as a closed-beta
bridge for tens of users, about Rs 300 for 50 users, and it must not be the launch
route.

**One timing dependency that cannot be compressed.** Submit the DLT template only
after the first AAB is on Play, because the 11-character SMS Retriever hash is
derived from Google's app-signing certificate and does not exist before that.
**DLT template text cannot be edited after approval**, so submitting early means
re-registering later.

## B7. Decide the WhatsApp OTP channel. Rs 0 upfront, and it costs you a phone number.

**The action.** Either complete the four steps below, or reply "SMS only".

1. Enter the legal name, address, phone and website in the Meta business
   portfolio, all of which are currently empty with verification never started.
2. Submit Meta business verification with the Udyam certificate from B4.
3. Create a **new** WABA with INR billing selected. An existing USD WABA cannot be
   converted.
4. Delete the consumer WhatsApp account on 8641061752, register it on the WABA,
   and add a card Meta accepts.

**Cost: Rs 0 upfront**, Rs 0.1357 per OTP all-in (Rs 0.115 plus 18% GST, Meta's
own rate card effective 1 July 2026), about Rs 176 a month at 1,300 OTPs.
WhatsApp needs no DLT, which is its one clean advantage over SMS: template
approval happens entirely inside Meta.

**The hardware cost nobody has priced.** 8641061752 stops being a normal WhatsApp
number. It must not be active on the consumer app when it is registered on the
WABA, and after registration it cannot be used in the regular app again. **If that
is your personal number, budget a second SIM** rather than discovering this
mid-onboarding. The business display name also cannot be changed for six months
after it is set.

**One diagnostic that has to be run rather than reasoned about.** The earlier "no
permission to create message template" error is not proof of the verification
gate, because the WABA in question is Meta's test tier bound to test number
+1 555-640-9610, and test WABAs are locked to seeded samples regardless of
verification. Failure after step 3 confirms the gate; success means verification
is only a limits question.

**The largest risk on this item is category, not verification.** WhatsApp's
Business Messaging Policy prohibits adult products and services and dating
services outright, "regardless of local licensing". Worst case is a banned WABA
that takes the phone number with it.

## B8. Confirm the bubble override out loud. Rs 0, one line.

**The action.** Reply confirming that "rows are flat with inset hairlines" now
applies to **Explore only**, and that Chats is bubbles with no separators.

**Why it needs saying rather than assuming.** It partially overrides a settled
decision in `design/references/README.md`. The split is coherent and item 6
explains why each idiom earns its place, but a settled line should be overridden
deliberately rather than absorbed silently.

## B9. Decide whether a rejection can be reopened. Rs 0, and today's answer is the worst of three.

**The action.** Reply with either "reopen after N days" (naming N) or "rejected is
final".

**Why the current state is worse than either.** The guard forbids the client
transition, but `submit_provider_application` is SECURITY DEFINER, so the guard's
`current_user in ('authenticated','anon')` branch never runs for it. A rejected
applicant can still overwrite every application field and reset `submitted_at` to
`now()`, while `status` stays `rejected` via the `else pa.status` branch. The
status screen then shows "Not this time" above a fresh "Submitted 23 August 2026"
stamp. There is no reapply path and no cooling-off column, so it is neither closed
nor reopenable.

"Reopen after N days" means a `reapply_after date` column and an RPC that reopens
past that date. "Final" means the RPC refuses a write to a rejected row outright.

---

# Verification, once, for all of the above

Every item's gate is the same command and it must be run exactly as CI runs it:

```
npm run verify        # exit 0
npm run test:db       # for anything touching supabase/
npm run verify:full   # both
```

`verify` chains eleven gates: `tokens:check`, `tokens:web:check`, `icons:check`,
`contrast:check`, `web:check`, `design:check`, `typecheck`,
`lint --max-warnings=0`, jest (497 tests as of 2026-08-23), `verify:manifest` and
a Metro bundle.

**Do not add flags.** A previous session added `--coverage`, which broke `@env`
and hid three real failures. That is recorded in
`feedback-chatapp-coverage-env-trap` and it is the reason this paragraph exists.

**And the gate is not the verification.** Three things are true about this
codebase and all three were learned the hard way:

1. `Spinner` crashed on the first frame it rendered, past 497 tests (eight
   written for the exact function), `tsc`, `eslint --max-warnings=0`, the full
   chain and a successful release build. Jest imports the module into the JS
   runtime where the function is perfectly callable, so the unit tests passed
   against code that crashed on the UI runtime.
2. The inbox rendered `Nobody matching "".` above the empty state for every brand
   new member, and the directory's section header read `4 AVAILABLE NOW` above
   five rows. Both passed every gate. Both were found by opening the screen.
3. Nothing in the chain can see clipped Devanagari matras, a jittering collapsing
   header, a bubble in the wrong coral, or a border-drawn glyph that is one pixel
   off.

So every visual and motion item above ends on the emulator:

```
node scripts/dev-session.mjs            # provider tree
node scripts/dev-session.mjs --member   # member tree
```

`FLAG_SECURE` is per build type: `release` blocks capture, `internal` and `debug`
do not, because a secure window returns nothing at all to `screencap` and leaving
it on everywhere is what made the app impossible to look at.

---

# ADRs to write

Three, and they start at **0016** because `0015-renamed-to-papal.md` exists.

- **`docs/adr/0016-hindi-and-the-i18n-stack.md`.** The library choice and the
  rejections, the measured Hermes Intl surface (what is present, what is absent,
  and the `.so` it was read from), why typography gains a language axis when it is
  otherwise mode-invariant, and why the language read is synchronous MMKV rather
  than an async detector. `docs/adr` has fifteen entries and no i18n one, and the
  `tokens.json` typography note is currently the only record of any font decision.
- **`docs/adr/0017-availability-is-a-schedule-not-a-switch.md`.** IST wall clock
  over UTC, the schedule writes neither `presence` nor `is_available`, the weekly
  calendar is not published to members, disclosure rather than a send gate, and no
  calendar dependency.
- **`docs/adr/0018-money-surfaces-say-tokens-not-rupees.md`.** Why there is no
  invoice screen, what an Indian tax invoice would require, the merchant-of-record
  fork, and the three refused tiles.

Also amend two, because their load-bearing sentences have expired:

- **ADR-0009 section 5.** It claims `route=otp` injects our code into Fast2SMS's
  pre-approved DLT template so there is nothing to register. Fast2SMS now states
  that the SMS OTP template uses your own DLT template, sender ID and entity, and
  `route=otp` has left their documented API index entirely. Record the two live
  routes with prices, the two gate codes (999 wallet, 996 KYC) and the Rs 118
  figure.
- **ADR-0006.** The cost table and the "gate is DLT" section: 3 to 7 working days
  rather than 1 to 3 weeks, Rs 5,900 with Udyam as the only document needed at
  Vilpower or Airtel, a business-verification precondition on the WhatsApp row,
  and a Quick SMS row at Rs 5.90 because it is the only thing that delivers today.

And append to `design/references/README.md`, in the voice of the existing Settled
decisions section: the typeface decision, the resolution of open question 1
(Chats bubbles, Explore hairlines), the fact that the search field does not hide
on scroll and why, the day-list-over-any-grid decision with the 48pt arithmetic
behind it, and that no WhatsApp Figma kit was reachable so every WhatsApp-specific
number in the research was estimated while every number in this file is measured
off the Papal frames.
