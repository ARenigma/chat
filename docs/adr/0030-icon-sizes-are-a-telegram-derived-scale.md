# ADR-0030, Icon sizes are a six-step scale derived from Telegram

Status: **decided and shipped (foundation)**
Date: 2026-09-07
Supersedes: nothing. [ADR-0018](0018-icons-are-a-config-driven-font.md) decided
_what_ an icon is — a Lucide glyph in a generated font, driven by
`design/icons.json` — and all of it still stands. This ADR decides _how big_ one
is, which ADR-0018 never addressed and which is why there was no answer.
Reference: local Telegram clone at `~/references/telegram`, 12.10.1, commit
`62b56a07` (`TMessagesProj/src/main/res/drawable/*.xml`);
[m3.material.io/styles/icons](https://m3.material.io/styles/icons/applying-icons#b41cbc01-9b49-4a44-a525-d153d280548f)
for the scale this one deliberately is not.

> **Numbering note.** This is 0030, not 0029. `ADR-0029` is cited by two commits
> (`5b0840a`, `523b1fe`) and by eight code and test sites for the GST-exclusive
> pricing model, but **no `docs/adr/0029-*.md` file was ever committed**. The
> number is taken; the file is missing. Reusing 0029 here would have collided
> with those live citations, so it is left as a gap for whoever writes the
> pricing ADR up. Do not reuse it for anything else.

---

## 1. The decision

Icon sizes come from a six-step scale in `design/tokens.json`, `TOKENS.icon`:

| Token      | dp  | Role                                                                                                                            |
| ---------- | --- | ------------------------------------------------------------------------------------------------------------------------------- |
| `icon.xs`  | 12  | Inline with 11–14sp text; the check or cross inside a ≤22dp badge or checkbox                                                   |
| `icon.sm`  | 16  | Inline with 16sp text; the list-row trailing disclosure chevron; a status glyph in a row; a badge glyph in a 28–34dp disc       |
| `icon.md`  | 20  | **The default.** Nav/header actions, toolbar tabs, a standalone icon button in a 40–48dp slot, a leading glyph in a 32–40dp box |
| `icon.lg`  | 24  | The primary action whose glyph is the main mark of a 56–64dp control                                                            |
| `icon.xl`  | 28  | The hero glyph inside a 64–72dp circular badge; the decorative mark in a media cell                                             |
| `icon.2xl` | 32  | The empty-state mark, in an 88dp disc                                                                                           |

All 80 raw call sites were converted. Two named exceptions stay (§ 6), and
`__tests__/iconScale.test.ts` fails the build on any new raw number.

## 2. The defect: there was no standard, and nobody could have known

Amit, 2026-09-07: _"no fix all icons please for standard view and token"_. Asked
which scale to follow: _"follow telegram here as i dont know standard"_.

A scan of every `<Icon>` in `src/` found **80 call sites carrying 17 distinct
sizes**:

```
11 12 13 14 15 16 17 18 19 20 22 24 28 30 34 36 40
```

That includes the one-point neighbours 13/14/15 and 16/17/18/19 — differences no
one can see and no one chose — and, more tellingly, **the same role disagreeing
with itself**:

- the list-row trailing disclosure chevron was **13** in `ProviderRow` and
  `SafetySheet`, and **18** in `SettingsSheet` and `ProviderHomeScreen`;
- the empty-state mark was **36** in `CallsScreen` and `FavouritesScreen`, and
  **40** in `ProviderHomeScreen` and `TransactionHistoryScreen`;
- the back chevron was **22** everywhere, while every other nav action was 20.

These are not design decisions. They are the residue of forty separate
judgements about the same handful of roles, which is exactly what a scale is for.

**A note on how this was measured, because the first pass got it wrong.** The
initial sweep used `grep "<Icon[^>]*size={[0-9]"` and reported _16 sizes at ~40
sites_. That grep is single-line by construction, so it missed every wrapped tag
— half the population — and missed the size `19` in `SettingsSheet.tsx`
altogether. The real figures above come from a brace-depth-aware tag parser,
which is the same parser the gate now runs. A single-line regex cannot grade JSX.

## 3. Why `size` is already ink-dp, which is what makes a dp scale honest

This is the load-bearing fact, and it is the reason the scale can be stated in
plain dp rather than as frame sizes with a fudge factor.

`Icon.tsx` computes `fontSize = Math.round(size * ICON_SCALE)` with
`ICON_SCALE = 1.2`, and a Lucide glyph inks about **19.97 of the 24 grid units**
the em maps onto (measured with a fontTools outline-bounds pen over
`assets/fonts/Lucide.ttf`; see `Icon.tsx`'s header for why the `glyf` header's
zeroed `xMin`/`yMin` must not be trusted). So:

```
rendered ink = round(size * 1.2) * 19.97/24  ≈  size      (ratio 0.97–1.02)
```

across the whole 12–32 range. `size={20}` really does put about 20dp of ink on
the glass. That correspondence is asserted in the gate, so the scale cannot
quietly stop meaning what it says.

**`ICON_SCALE` is not touched by this ADR.** Its value is Amit's own call — _"the
icons were reading too small"_, recorded in its docblock — and it multiplies
every icon in the app. The gate pins it at 1.2 and names it as the assumption to
revisit rather than policing it as a number of mine.

## 4. Telegram's scale, measured rather than recalled

`android:width` across the **466** vector drawables in
`TMessagesProj/src/main/res/drawable`:

| Frame | Files   | Share |
| ----- | ------- | ----- |
| 24dp  | **289** | 62%   |
| 16dp  | 27      | 6%    |
| 28dp  | 12      | 3%    |
| 20dp  | 8       | 2%    |
| 36dp  | 7       | 2%    |
| 30dp  | 5       | 1%    |
| 18dp  | 5       | 1%    |
| 40dp  | 3       | 1%    |

So their frame scale is **16 / 20 / 24 / 28 / 36 / 40**, with 24 the
overwhelming default.

A 72dp bucket of 42 files is **excluded**, and it is worth saying why rather than
dropping it silently: 40 of those 42 are the generated `profile_levelN_inner` /
`_outer` badge family, plus a birthday illustration and a map pin. One decorative
family repeated forty times is not an icon size step, and counting it would have
made 72dp look like Telegram's second-most-common icon.

## 5. Frames are not ink — the 0.805 → 0.803 ratio

Telegram draws icons at `ImageView.ScaleType.CENTER`, which **never scales**, so
the mark sits at its own intrinsic size inside the frame and the frame is just
padding. This app already had one measurement proving it: the search glyph is a
13.94dp mark in a 24dp frame (`SearchBar.tsx`, with `File.java:line` citations).

To generalise it, the path bounds of every measurable 24dp drawable were measured
against its viewport — béziers and elliptical arcs flattened by sampling rather
than approximated by control-point hulls, stroke width added where a path is
stroked, and the result clipped to the viewport since ink outside the frame is
not drawn:

| Population             | Files   | Median ink/frame | Mean   |
| ---------------------- | ------- | ---------------- | ------ |
| **All 24dp drawables** | **286** | **0.8032**       | 0.7931 |

A prior pass had sampled 74 of them and got 0.805 / 0.793; measuring the full
population confirms it to three decimals. The ratio is stable across their other
frames — 16dp 0.833, 20dp 0.840, 28dp 0.771, 36dp 0.711, 40dp 0.801 — but only
the 24dp bucket has the sample size to carry weight (the 40dp figure is two
files), so a single ratio of **0.803** is applied to every frame and that
limitation is stated rather than hidden behind six decimals.

Each Telegram frame then maps through 0.803 to an ink value, snapped to the 4dp
grid the `space` scale already uses:

| Telegram frame | × 0.803 = ink | Step        | Δ from real Telegram ink  |
| -------------- | ------------- | ----------- | ------------------------- |
| 16dp           | 12.85         | `xs` 12     | 0.85                      |
| 20dp           | 16.06         | `sm` 16     | 0.06                      |
| **24dp**       | **19.28**     | **`md` 20** | **0.72** ← their 62% case |
| 28dp           | 22.49         | `lg` 24     | **1.51** ← worst case     |
| 36dp           | 28.91         | `xl` 28     | 0.91                      |
| 40dp           | 32.13         | `2xl` 32    | 0.13                      |

Every step lands within **1.6dp** of a real Telegram icon. The gate asserts that
bound, so the scale cannot drift away from its own derivation.

### Why this diverges from Material 3, deliberately

M3 specifies a 24dp icon in a standard icon button, and Material Symbols ink to
the edge of their own 24 grid — so M3's 24dp icon is ~24dp of ink, where this
scale's default is 20. That is a real divergence and it is a **creative** choice,
not a structural one: the docs offer a legitimate menu here, and Amit picked from
it (_"follow telegram here"_). Recorded per RULE 1.6 rather than split down the
middle. Everything M3 states as a number that this app does conform to — the
48dp target, state-layer opacities, the switch anatomy — is untouched.

## 6. Two exceptions that are not flattened

Both are older than this scale and better grounded than it, and both are
exempted **by name** in the gate, with the reason:

1. **`SearchBar.tsx`'s `SEARCH_GLYPH_SIZE` (14) and `CLEAR_GLYPH_SIZE` (17).**
   These are matched to the reference's _actual measured ink for that one
   component_ — 13.94dp for the magnifier, 11–12dp for the clear cross — which
   is a stronger claim than "a step on a scale". Snapping them to `icon.sm`
   would put 16dp of ink where Telegram has 13.94, and the entire point of that
   field is that it _is_ Telegram's. Pinned independently by
   `__tests__/homeSurface.test.ts`.
2. **`Icon.tsx`'s own internals.** `ICON_SCALE`, `HEAVY_DILATION` and the heart's
   over-draw geometry are the mechanism that makes `size` mean ink. They are not
   call sites.

Three further sizes are not raw literals and stay as they are, so they need no
waiver: `SOURCE_METRICS.doneIcon`, `ICON_EXPANDED` and `GLYPH` come from the
measured Fuse onboarding source (RULE 3) — including the 28pt carousel glyph
CLAUDE.md names as its example of a stated departure — and `Toggle.tsx`'s
`CHECK` is sized against the M3 thumb box, not against this scale.

## 7. The gate

`__tests__/iconScale.test.ts` **scans** `src/**/*.tsx` at test time; the file
list is never hardcoded, because a hardcoded list is how the next new icon
escapes by simply not being in it. It asserts:

- no `<Icon>` takes a raw numeric `size`;
- every `<Icon>` size is a `TOKENS.icon` step, a conditional between two steps,
  or a named entry in `EXEMPT` — so the loophole a raw-numbers-only gate leaves
  (a bare `size={MY_SIZE}` alias) is closed too;
- no `EXEMPT` entry is stale, so a waiver cannot outlive the site it was argued
  for;
- the scale is six increasing steps on the 4dp grid, each within 1.6dp of a
  Telegram frame through 0.803, with `md` still the modal 24dp case;
- `ICON_SCALE` is still 1.2, so the ink-dp claim § 3 rests on stays checked.

Comments are stripped with the quote- and URL-aware state machine copied from
`iconShape.test.ts`. This repo has shipped **four** gates that graded their own
prose: a naive `//` rule eats the `//` in every `https://` inside a string, which
here means eating exactly the doc citations RULE 1 demands. It is copied rather
than imported because importing another `*.test.ts` would re-register that
file's suites inside this one.

**The gate was proven, not assumed** (three runs, each reverted):

| Injection                                                      | Result                                                      |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| a raw `size={19}` in a **multi-line** tag                      | **red**, naming `CallsScreen.tsx:29` — the case grep missed |
| a bare `size={MY_SIZE}` alias                                  | **red** on the loophole assertion                           |
| a comment containing `size={19}` and an `https://` with a `//` | **green** — it does not grade its own prose                 |

A non-vacuity assertion (≥70 sites found, ≥20 files, ≥70 on the scale) means a
parser regression that matched nothing would fail rather than pass silently.

## 8. Verification

Commands run, all green: `npx tsc --noEmit`, `npx eslint` on every touched file
at `--max-warnings=0`, `npx jest` (**1379 tests / 48 suites**, up from 1371/47 —
the new gate's 8), `npm run tokens:check`, `npm run tokens:web:check`,
`npm run contrast:check`.

One existing gate was **corrected**, none weakened: `rechargeChips.test.ts`
pinned `<Icon name="check" size={17}` in `PaymentSheet`. Its substantive claim is
that the check is present at all (colour is never the only indicator, WCAG 2.2 SC
1.4.1 — the accent tint alone is a 1.22:1 boundary against `bg/base`). The `17`
was incidental specificity that became false, so the line is re-pinned to
`size={TOKENS.icon.sm}` — exactly as specific as before, and now true. Two other
gates that name icon sizes negatively (`homeSurface.test.ts`'s
`not.toContain('size={20}')` and `not.toContain('size={28}')`) were re-checked
and remain true unchanged.

**Still needs a device (RULE 2 — the runner proves consistency, not that it looks
right).** 44 of the 80 sites moved by ≥2dp, and four moved more:

- **`ProviderHomeScreen` and `TransactionHistoryScreen` empty-state marks, 40 →
  32 (−8dp).** The largest change in the app. These sit in an 88dp disc, so the
  proportion drops from 45% to 36%; the point is that all four empty states now
  agree, but whether 32 still reads as a watermark rather than an afterthought is
  a look, not an assertion.
- **`CallsScreen` and `FavouritesScreen` empty-state marks, 36 → 32 (−4dp).**
- Every back chevron, 22 → 20, across five screens — the most-seen change.
- The `+3dp` disclosure chevrons in `ProviderRow` and `SafetySheet`, which were
  the smallest icons in the app at 13.

Check both empty states, one back header, and a settings row on the emulator
before this is called done.
