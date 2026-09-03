# ADR-0024, The type scale is Material 3

Status: **decided and shipped (foundation)**
Date: 2026-09-03
Supersedes: the type-ladder bullet of
[ADR-0012](0012-ios-surfaces-material-interaction.md) only. Everything else ADR-0012 decided — the 28dp sheet, the 10dp field, the
14dp alert, the iOS interaction model — still stands.
Reference: [m3.material.io/styles/typography](https://m3.material.io/styles/typography/type-scale-tokens),
androidx `TypeScaleTokens.kt` / `TypefaceTokens.kt`

---

## 1. The decision

The app's text is the Material 3 type scale, not the iOS text ladder ADR-0012
adopted. `design/tokens.json` now carries the 15 M3 baseline roles in absolute
dp — `fontSize` / `lineHeight` / `letterSpacing` — plus the emphasized twins
that have a consumer, the three Titan One wordmark sizes, and numerals on the M3
grid.

Weight is still expressed as a bundled static face and never as `fontWeight`
(Android synthesises a weight the family already ships otherwise, ADR-0012 §
type). The M3 weight names map onto the faces already bundled:

| M3 weight  | Face           |
| ---------- | -------------- |
| Regular    | Geist-Regular  |
| Medium     | Geist-SemiBold |
| emphasized | Geist-Bold     |

No new font asset. The brand wordmark stays Titan One.

## 2. Why M3 over the iOS ladder

ADR-0012 adopted the iOS ladder on the theory an iOS build was imminent and
`source.material` should stop claiming a conformance the type did not have. That
build never shipped; the product is Android-only (ADR-0017). Reading a type value
off the platform we actually target means M3, and the whole app is drawn from
tokens rather than platform widgets (RULE 1 / `source.material`), so conforming
the scale costs one token file and a codemod rather than a rewrite.

The visible effect is small and in the M3 direction: body 17→16 with a 24dp line
and +0.5 tracking, previews 15→14, captions 13/12→12, screen titles 30→28. M3
inverts the iOS tracking direction — it sets a large display solid and opens body
and the small labels — which reads correctly on Geist, verified on device.

## 3. How the migration was done

One atomic foundation commit, then per-surface passes — the type ladder is the
highest-blast-radius token in the app (ADR-0012 counted 81 spread sites; this
change touched 49 files).

- The token roles were authored fresh in absolute dp. The generator now passes
  absolute `lineHeight`/`letterSpacing` through, still supporting the legacy
  percentage form so nothing outside typography had to move at once.
- A single-pass codemod renamed every `TOKENS.typography.<old>` to its M3 home
  (`bodyLarge` 16/24 absorbs the old body; `subhead`→`bodyMedium`;
  `headline`→`titleMediumEmphasized`; display/title/label to their M3 roles).
  Single-pass because seven old names collide with M3 names; a sequential
  rename would double-map them. Typecheck is the completeness proof — a missed
  reference is a compile error, not a silent miss.
- The six decorative `.fontFamily` borrows (a glyph wanting SemiBold, not a text
  role) now name the weight through a `face` block, so re-weighting a role can
  never silently change a borrowed glyph.
- `fontScaleCap` is a per-role `maxFontSizeMultiplier` map (display/headline 1.3,
  titles 1.5, wordmarks 1.0; body, label and numerals uncapped so a 200% setting
  still enlarges reading text and the balance). It is a separate map, not a style
  key, because `maxFontSizeMultiplier` is a `Text` prop and the style-shape gate
  forbids extra keys.

## 4. What is deferred

Called out so the follow-ups are not rediscovered:

- **`includeFontPadding: false` globally** — an Android metric-trim that shifts
  vertical metrics app-wide, so it gets its own device-verified pass rather than
  riding in with the scale.
- **Wiring `fontScaleCap`** — the data ships now; each capped `Text` gets
  `maxFontSizeMultiplier={TOKENS.fontScaleCap.<role>}` during the per-surface
  passes, where the call sites are being edited anyway.
- **Per-surface semantic tuning** — the codemod applied M3 values everywhere, so
  these passes are refinement and screenshot spot-checks, not correctness fixes.

## 5. Verification

`npm run verify` (788 tests) green: the generated theme matches the source, every
referenced face is bundled, numerals stay tabular, and the M3 metrics are pinned
in `theme.test.ts`. Verified on a physical S22 (RULE 2): Home and the chat
transcript render correctly under the new scale — 16/24 body with +0.5 tracking
reads clean, section headers and row names hold, nothing clips.
