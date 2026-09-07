# ADR-0018, Icons are a config-driven font

Status: **Superseded (wave-3)** — icon set switched to Lucide. See
`design/icons.json` for the current family. The decision that icons are a
config-driven **font** (not SVG, not hand-drawn geometry) still holds.
Date: 2026-08-26

---

## Decision

Icons are a subset **font**, generated from `design/icons.json` by
`scripts/gen-icons-font.mjs` — the same config → generate → `--check` pipeline
as the type tokens. Style, weight and the glyph set are one config edit plus
`npm run icons:font`.

The original live values were Material Symbols Rounded, weight 400, optical
size 24, fill on active. Wave-3 switched the family to Lucide for a consistent
stroke style and a prebuilt `lucide-static` `.ttf`. Fill-on-active remains a
`fontFamily` swap in `Icon.tsx`. **(Superseded 2026-09-07 — see the update at the
foot of this file. There is no fill; `active` changes stroke weight.)**

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

---

## Update, 2026-09-07 — constraint 2 is superseded: `active` changes WEIGHT, not fill

Restated here rather than left to be contradicted by the code, which is this
repo's convention for a decision that has moved.

**What changes.** Hard constraint 2 above says the active/selected state wants
the FILL axis, and that the generator therefore ships two static instances (FILL
0 and FILL 1) which `Icon`'s `active` prop swaps between. That was true of
Material Symbols and stopped being true at the wave-3 family switch: Lucide is a
single stroke set with no filled twin, so `icons.generated.ts` sets
`ICON_FILL_ON_ACTIVE = false` and both family constants resolve to the same
face. There was exactly one filled glyph left in the app — the favourite heart,
drawn from `PappalGlyphs.ttf`, a one-glyph font holding U+2665 — and Amit removed
it (2026-09-07): "Remove the heart fill; keep the outline, heavier." Nothing in
`src/` imports that face now.

**Why, and why it is not a regression on colour-blindness.** The reason
constraint 2 gave for the fill was that a shape signal on top of colour is
readable where colour alone is not (WCAG 2.2 SC 1.4.1). Stroke weight is also a
non-colour signal, so the requirement is still met — and the product reason for
dropping the fill is the one already recorded next to `FloatingToolbar`: a filled
heart reads as a save action rather than as navigation.

**What it cost, and what pays for it.** A genuinely re-stroked face is a second
font FILE, so it would mean regenerating `assets/fonts/Lucide.ttf` and shipping
a new APK — fonts are packaged at build time and cannot reach a device over
Metro. `fontWeight` is not an alternative: on an asset family with no
`Lucide_bold.ttf`, ReactFontManager falls through to
`Typeface.create("Lucide", BOLD)`, an unknown family, and the system default has
no glyph in the Private Use Area — a silent tofu heart. So the weight is
synthesised the way Skia's fake bold does it, by dilating the outline, in layout
space: four over-drawn copies at half a Lucide grid unit (`HEAVY_DILATION =
1/48`), which takes the stroke from Lucide's shipped 2 to 3. The derivation and
the font measurements are in `src/components/Icon.tsx`.

**Unchanged.** Everything else in this ADR holds. Icons are still a subset font
generated from `design/icons.json` with a `--check` drift gate, still not SVG and
still not hand-drawn geometry. `ICON_FAMILY_FILLED` survives as a constant so a
future family WITH a filled twin needs no call-site change; today it is the same
face as `ICON_FAMILY`.

**Guards.** `__tests__/providerPhotos.test.ts` › "the favourite heart is an
outline in both states" fails the build on a reimported `PappalGlyphs` or a
literal `♥`, and pins the four-way overdraw. `docs/flows.md` › "Heart (locked
pair)" carries the surface description.
