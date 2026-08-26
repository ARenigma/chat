# ADR-0018, Icons are a config-driven font

Status: **decided and built**
Date: 2026-08-26

---

## Decision

Icons are Material Symbols, shipped as a subset **font**, generated from
`design/icons.json` by `scripts/gen-icons-font.mjs` — the same config → generate
→ `--check` pipeline as the type tokens. Style, weight and the glyph set are one
config edit plus `npm run icons:font`.

Live values: **Rounded, weight 400, optical size 24, fill on active.** Rounded
and fill-on-active are Amit's creative calls (structural-vs-creative split in
CLAUDE.md); everything else follows Material.

## Why a font, not the alternatives

- **Not SVG.** `react-native-svg` is banned here — it throws
  `synchronouslyUpdateUIProps` inside Reanimated views and kills touch on the
  subtree. Icons sit inside animated pressables everywhere.
- **Not hand-drawn geometry.** The previous `Icon.tsx` was 807 lines of `View`
  borders per glyph. That is what made `bubble` render as an empty box and
  `phone` as a bare arc at display size — the bugs that cost three rounds on the
  onboarding carousel.
- **A font is `<Text>`**: safe in Reanimated, tinted by `color`, scaled by
  `fontSize`, and the whole ~3600-glyph set is one file away.

## The two hard constraints, and how the build answers them

1. **React Native Android cannot select or animate a variable-font axis at
   runtime.** So `weight`, `opsz` and `style` are baked into a static instance at
   generation time (`fontTools.varLib.instancer`), not set per render.
2. **The active/selected state wants the FILL axis**, which (1) forbids live. So
   the generator ships TWO static instances — FILL 0 (outlined) and FILL 1
   (filled) — and `Icon`'s `active` prop swaps `fontFamily` between them. That is
   Material's own selection pattern and adds a shape signal on top of colour,
   which colour-blind users cannot read.

## Cost

Subset to the 33 glyphs actually used: **7KB + 9KB**, versus ~1.5MB per unsubset
instance. Both instances together cost less than one Nunito weight.

## Verified

Font resolution by the renamed PostScript family — the silent-tofu failure class
— was confirmed on device (API 24): the `forum` glyph renders as a real
multi-stroke rounded pictogram in the carousel, not a box. `icons:font:check`
gates drift; the licence test covers Material Symbols' Apache-2.0 notice.

## Requires

`python3 -m pip install fonttools brotli` for generation (not for building or
running — the generated fonts are committed).
