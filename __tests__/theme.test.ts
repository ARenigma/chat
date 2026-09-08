import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { DARK, LIGHT, TOKENS } from '../src/theme/tokens';
import { SOURCE_METRICS } from '../src/lib/onboarding';

const ROOT = join(__dirname, '..');

/**
 * Source with comments removed, for rules that are about CODE.
 *
 * Block comments first, then line comments, so a `//` inside a block cannot
 * leave a dangling fragment. Deliberately not a parser: this only has to be good
 * enough to stop a quoted API name from being read as an instruction.
 */
const stripComments = (body: string): string =>
  body.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/** WCAG relative luminance. */
function luminance(hex: string): number {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = channel(parseInt(hex.slice(1, 3), 16));
  const g = channel(parseInt(hex.slice(3, 5), 16));
  const b = channel(parseInt(hex.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

describe('generated theme', () => {
  it('is light-first, on iOS system greys', () => {
    expect(TOKENS).toBe(LIGHT);
    // systemBackground, not systemGroupedBackground. #F2F2F7 was correct while
    // the lists were white cards on a grey page; the cards are gone and rows now
    // sit on this directly, divided by border/hairline. A grouped grey with
    // nothing to group is just dirty white.
    expect(LIGHT.color.bg.base).toBe('#FFFFFF');
    // Dark base is WhatsApp charcoal #0B141A — a deep blue-black that places
    // tonal elevation above it as lightening steps. Explicit departure from M3's
    // neutral-grey #121212 recommendation: a blue-tinted base makes the tonal
    // steps more perceptible and matches the product's chat-centric character.
    // Docs: docs/android-audit.md dark-theme section. https://m3.material.io/styles/color/dark-theme
    expect(DARK.color.bg.base).toBe('#151E27');
  });

  it('keeps the row separator visible on the page it now sits on', () => {
    // The reason border/hairline moved with the base. It was tuned against white
    // cards on a grey page; on a white page #E5E5EA measured 1.30:1 and was the
    // same absent divider the dark value was already fixed for once.
    expect(LIGHT.color.border.hairline).toBe('#C6C6C8');
    expect(contrast(LIGHT.color.border.hairline, LIGHT.color.bg.base)).toBeGreaterThan(1.5);
    expect(contrast(DARK.color.border.hairline, DARK.color.bg.base)).toBeGreaterThan(1.5);
  });

  /**
   * The inverse of the assertion this used to be.
   *
   * The palette was a warm paper base, and this test defended that warmth, red
   * channel above blue on every neutral, on the grounds that cool greys read as
   * clinical. What that missed is that a warm off-white is also the reflex
   * "tasteful" surface, and ours measured warmth 6, which is the minimum a
   * detector will flag and far below what an eye can see. It was paying the
   * cost of looking like a default without buying any of the warmth.
   *
   * So hue moved out of the chrome entirely and into meaning: coral acts, sage
   * is presence, citrus is the balance. This is the same idea defended from the
   * other side, a neutral that acquires a tint is the regression now, and it is
   * asserted with impeccable's own cream test so the rule and the test cannot
   * disagree.
   */
  it('keeps every surface neutral, no cream, no beige', () => {
    const isCream = (hex: string): boolean => {
      const [r, g, b] = [
        parseInt(hex.slice(1, 3), 16),
        parseInt(hex.slice(3, 5), 16),
        parseInt(hex.slice(5, 7), 16),
      ];
      // impeccable's cream-palette test, verbatim: light, warm-ordered, and
      // tinted somewhere between 6 and 48 points of red-over-blue.
      if (Math.min(r, g, b) < 209) {
        return false;
      }
      if (!(r >= g && g >= b)) {
        return false;
      }
      return r - b >= 6 && r - b <= 48;
    };

    const surfaces = {
      base: LIGHT.color.bg.base,
      raised: LIGHT.color.bg.raised,
      sunken: LIGHT.color.bg.sunken,
      hover: LIGHT.color.bg.hover,
      pressed: LIGHT.color.bg.pressed,
      // The two surfaces the iOS pass added. #F2F2F7 and #D1D1D6 both fail the
      // warm-ordered half of the cream test (g < b), so neither needs an
      // exemption, but they are enumerated here rather than left out, because a
      // surface absent from this list is a surface nothing checks.
      grouped: LIGHT.color.bg.grouped,
      selected: LIGHT.color.bg.selected,
      hairline: LIGHT.color.border.hairline,
      strong: LIGHT.color.border.strong,
      inverseDark: DARK.color.bg.inverse,
      textPrimaryDark: DARK.color.text.primary,
    };
    for (const [name, hex] of Object.entries(surfaces)) {
      expect({ name, cream: isCream(hex) }).toEqual({ name, cream: false });
    }
  });

  /**
   * The exception, stated so it is a decision rather than an oversight.
   *
   * `bg/accentTint` is the wash an avatar initial sits on, and it must belong to
   * the accent FAMILY — that family is the one thing carrying identity in a
   * product with no photographs. Neutralising it to a cream would cut the
   * avatars loose from the brand.
   *
   * The test used to assert warmth (red channel more than 20 above blue),
   * because the accent was coral and the tint was a pink. With the accent moved
   * to WhatsApp green (2026-09-08) the invariant is the same sentence and the
   * arithmetic is the opposite: the tint must now be GREEN-dominant. Asserting
   * the family rather than a specific hue is what makes this survive the next
   * brand change too — so it is written against the accent, not against a
   * hardcoded channel order.
   */
  it('keeps the avatar wash in the accent family', () => {
    const tint = LIGHT.color.bg.accentTint;
    const channels = (h: string) => ({
      r: parseInt(h.slice(1, 3), 16),
      g: parseInt(h.slice(3, 5), 16),
      b: parseInt(h.slice(5, 7), 16),
    });
    const t = channels(tint);
    const accent = channels(LIGHT.color.bg.accent);
    // The tint's dominant channel is the accent's dominant channel. Derived
    // from the accent so a future rebrand does not need this line rewritten.
    const dominant = (c: { r: number; g: number; b: number }) =>
      c.g >= c.r && c.g >= c.b ? 'g' : c.r >= c.b ? 'r' : 'b';
    expect(dominant(t)).toBe(dominant(accent));
    // And it is a tint, not a neutral: the dominant channel leads by a margin.
    const lead = t[dominant(t)] - Math.min(t.r, t.g, t.b);
    expect(lead).toBeGreaterThan(15);
    expect(tint).not.toBe(LIGHT.color.bg.sunken);
  });

  it('carries the M3 bodyLarge metrics through the generator', () => {
    // bodyLarge is now M3 bodyLarge, given as absolute dp (ADR-0024): 16/24 with
    // +0.5 tracking. The generator passes absolute line/tracking straight
    // through rather than deriving them from a percentage of the size.
    expect(LIGHT.typography.bodyLarge.fontSize).toBe(16);
    expect(LIGHT.typography.bodyLarge.lineHeight).toBe(24);
    expect(LIGHT.typography.bodyLarge.letterSpacing).toBeCloseTo(0.5, 2);
  });

  it('shares space, radius, layout, motion and interaction across both modes', () => {
    expect(DARK.space).toEqual(LIGHT.space);
    expect(DARK.radius).toEqual(LIGHT.radius);
    expect(DARK.layout).toEqual(LIGHT.layout);
    expect(DARK.motion).toEqual(LIGHT.motion);
    expect(DARK.interaction).toEqual(LIGHT.interaction);
  });

  it('keeps modal scrims dark instead of reusing inverse surfaces', () => {
    // M3 scrim is its own stable role. inverseSurface deliberately flips light
    // in dark mode and previously washed sheets, menus and tours in white.
    expect(LIGHT.color.bg.scrim).toBe('#000000');
    expect(DARK.color.bg.scrim).toBe('#000000');
    for (const file of ['Sheet.tsx', 'SpotlightCard.tsx', 'PaperMenu.tsx', 'HomeTour.tsx']) {
      expect(read(`src/components/${file}`)).toContain('t.color.bg.scrim');
    }
  });

  it('keeps elevation shadows translucent', () => {
    // A bound Figma colour variable silently discarded these once already.
    for (const name of ['card', 'composer', 'sheet'] as const) {
      expect(LIGHT.elevation[name].shadowOpacity).toBeGreaterThan(0);
      expect(LIGHT.elevation[name].shadowOpacity).toBeLessThan(1);
    }
  });
});

/**
 * Type is bound to a bundled face, not to a weight.
 *
 * Every style names a concrete Urbanist file and none of them sets a
 * `fontWeight`, because on Android a concrete family plus a weight makes the
 * platform synthesise a weight the family already ships, it smears the
 * letterforms, and it is invisible until someone looks at a screenshot at 3x.
 */

/**
 * Enough of a TrueType parser to answer one question: are this face's digits
 * the same width?
 *
 * Deliberately hand-rolled rather than pulling in `fontTools` or `opentype.js`.
 * The whole job is `head` for units-per-em, `cmap` to find the digit glyphs and
 * `hmtx` to read their advances, which is a few dozen lines against a dependency
 * in the test path that would have to be kept current forever.
 *
 * Both cmap formats matter. The first version of this read format 4 only, picked
 * the last matching subtable — which is format 12 in these files — and returned
 * `undefined` for every digit. That produced "one distinct width, tabular: true"
 * out of ten nulls, which is the most dangerous possible wrong answer here: it
 * would have confirmed the very bug this test exists to catch.
 */
/**
 * The 16-bit wrap TrueType's format-4 cmap requires when adding `idDelta`.
 *
 * Every reference implementation writes `& 0xffff`; this is the same arithmetic
 * without a bitwise operator, because this codebase lints those and a spec quirk
 * is not a good enough reason to open the door. `idDelta` is signed, so the sum
 * can be negative, which is why the modulo is applied twice.
 */
const wrap16 = (n: number): number => ((n % 0x10000) + 0x10000) % 0x10000;

function digitAdvances(file: string): number[] {
  const b = readFileSync(join(ROOT, 'assets/fonts', file));
  const numTables = b.readUInt16BE(4);
  const tables: Record<string, number> = {};
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    tables[b.toString('latin1', rec, rec + 4)] = b.readUInt32BE(rec + 8);
  }
  const cmapOff = tables.cmap ?? 0;
  let best = 0;
  const subtables = b.readUInt16BE(cmapOff + 2);
  for (let i = 0; i < subtables; i++) {
    const rec = cmapOff + 4 + i * 8;
    const platform = b.readUInt16BE(rec);
    const encoding = b.readUInt16BE(rec + 2);
    const isUnicode =
      (platform === 3 && (encoding === 1 || encoding === 10)) ||
      (platform === 0 && encoding >= 3);
    if (isUnicode) {
      best = cmapOff + b.readUInt32BE(rec + 4);
    }
  }
  const lookup = (code: number): number => {
    const format = b.readUInt16BE(best);
    if (format === 12) {
      const groups = b.readUInt32BE(best + 12);
      for (let i = 0; i < groups; i++) {
        const g = best + 16 + i * 12;
        const start = b.readUInt32BE(g);
        const end = b.readUInt32BE(g + 4);
        if (code >= start && code <= end) {
          return b.readUInt32BE(g + 8) + (code - start);
        }
      }
      return 0;
    }
    // Format 4.
    const segX2 = b.readUInt16BE(best + 6);
    const segs = segX2 / 2;
    const endsAt = best + 14;
    const startsAt = endsAt + segX2 + 2;
    const deltasAt = startsAt + segX2;
    const rangesAt = deltasAt + segX2;
    for (let i = 0; i < segs; i++) {
      const end = b.readUInt16BE(endsAt + i * 2);
      const start = b.readUInt16BE(startsAt + i * 2);
      if (code < start || code > end) {
        continue;
      }
      const delta = b.readInt16BE(deltasAt + i * 2);
      const range = b.readUInt16BE(rangesAt + i * 2);
      if (range === 0) {
        return wrap16(code + delta);
      }
      const gi = rangesAt + i * 2 + range + (code - start) * 2;
      const g = b.readUInt16BE(gi);
      return g === 0 ? 0 : wrap16(g + delta);
    }
    return 0;
  };
  const numHMetrics = b.readUInt16BE((tables.hhea ?? 0) + 34);
  const hmtx = tables.hmtx ?? 0;
  const out: number[] = [];
  for (let d = 0; d < 10; d++) {
    const glyph = lookup(0x30 + d);
    expect(glyph).toBeGreaterThan(0);
    const idx = Math.min(glyph, numHMetrics - 1);
    out.push(b.readUInt16BE(hmtx + idx * 4));
  }
  return out;
}

describe('typography is bound to real font files', () => {
  const FACES = readdirSync(join(ROOT, 'assets/fonts')).filter(f => f.endsWith('.ttf'));

  it('bundles the faces it references', () => {
    expect(FACES.length).toBeGreaterThan(0);
    for (const style of Object.values(LIGHT.typography)) {
      expect(FACES).toContain(`${style.fontFamily}.ttf`);
    }
  });

  it('bundles no face it does not reference', () => {
    /*
     * The converse of the test above, and the reason it exists: that one checks
     * every referenced family is present, which cannot notice a face that is
     * present and referenced by nothing. `Urbanist-Medium.ttf` sat in the APK
     * that way — 73,320 bytes, named by no token and no source file, shipped to
     * every user.
     *
     * There is no fallback allowlist and there should not be one. Bundling a
     * face for the platform to "fall back" to does not work: React Native loads
     * a bundled face only when a style names it, and Android's own fallback
     * chain reads /system/fonts, never app assets. Four Noto Sans Devanagari
     * faces sat here on that mistaken theory.
     */
    const referenced = new Set(
      Object.values(LIGHT.typography).map(style => `${style.fontFamily}.ttf`),
    );
    /*
     * Icon fonts are referenced by code, not by a typography token, because they
     * are icon sets rather than text styles. Allowlisted here for the same reason
     * Material Symbols once was: each is real, used, and not chosen
     * per-typography-style.
     *
     * Lucide: the outline icon set, referenced by icons.generated.ts. One face
     * ships (Lucide has no filled twin; the active state is colour only for most
     * icons).
     *
     * PappalGlyphs: RETAINED DELIBERATELY, AND GENUINELY ORPHANED. This entry
     * used to say "the filled-heart icon face, referenced by Icon.tsx", and that
     * stopped being true on 2026-09-07 when Amit removed the heart fill ("Remove
     * the heart fill; keep the outline, heavier"). No file in `src/` names the
     * face any more — the active favourite is the same Lucide outline dilated in
     * layout space (`HEAVY_DILATION` in Icon.tsx), and `ICON_FAMILY_FILLED`, which
     * Icon.tsx does still import, resolves to `'Lucide'` in icons.generated.ts.
     * Do not read that surviving constant as a reference to this face.
     *
     * So this is an exemption for an orphan, which is the one thing this test
     * exists to forbid, and it is here on purpose for exactly one reason:
     * removing the file is not a change this suite can make safely. Fonts are
     * packaged at build time, not served over Metro, so deleting
     * `PappalGlyphs.ttf` (804 bytes) and its Apache-2.0 notice
     * `LICENSE-PappalGlyphs.txt` (10,897 bytes) needs a rebuild and a device
     * pass, and it also touches the NOTICE map below and the prose in
     * providerPhotos.test.ts. Recorded as a loose end in ADR-0018's 2026-09-07
     * update rather than left to look like a live reference.
     *
     * When that rebuild happens, delete the face, its notice, the NOTICE entry
     * and this paragraph together, and this regex goes back to /^Lucide/.
     */
    const ICON_FONTS = /^(Lucide|PappalGlyphs)/;
    const orphans = FACES.filter(
      face => !referenced.has(face) && !ICON_FONTS.test(face),
    );
    expect(orphans).toEqual([]);
  });

  it('sets tabular figures only in a face whose digits are actually tabular', () => {
    /*
     * `tabular: true` in tokens.json becomes `fontVariant: ['tabular-nums']`,
     * which does nothing unless the face either ships a `tnum` feature or has
     * uniform digit widths already.
     *
     * On Urbanist it did nothing at all: no `tnum` in GSUB or GPOS, and ten
     * distinct digit advances (Bold: 0=1210, 1=667 at upm 2000). A count going
     * 1 to 2 moved the token pill by 0.27em, about 3.3px at 12pt — precisely the
     * shift the flag was written to prevent, silently, for as long as it shipped.
     *
     * Inter's default digits are proportional, so unlike Nunito it does NOT have
     * uniform default advances — its tabular figures come from the `tnum`
     * OpenType feature, which `fontVariant: ['tabular-nums']` invokes. So a
     * tabular style is honest if EITHER the face has uniform default digit widths
     * (Nunito-style) OR ships a `tnum` feature (Inter-style). Asserted against the
     * binary rather than the family name, so the next font change cannot quietly
     * reintroduce the lie.
     */
    const tabularStyles = Object.entries(LIGHT.typography).filter(
      ([, style]) => 'fontVariant' in style,
    );
    // If nothing is tabular any more, this test is dead weight and should be
    // deleted rather than passing vacuously.
    expect(tabularStyles.length).toBeGreaterThan(0);
    for (const [name, style] of tabularStyles) {
      const widths = digitAdvances(`${style.fontFamily}.ttf`);
      const uniform = new Set(widths).size === 1;
      // GSUB feature tags are stored as four ASCII bytes; a raw search for
      // 'tnum' is a sufficient proxy for "this face can do tabular figures".
      const hasTnum = readFileSync(join(ROOT, 'assets/fonts', `${style.fontFamily}.ttf`)).includes(
        'tnum',
      );
      expect(`${name}: tabular-capable=${uniform || hasTnum}`).toBe(`${name}: tabular-capable=true`);
    }
  });

  it('ships an OFL licence for every family it bundles', () => {
    // Bundling an OFL font without its licence is the one part of using a free
    // typeface that is not optional.
    //
    /*
     * Per family, not one file, because the directory is not single-family:
     * Geist carries the app and Titan One sets the wordmark, and they are two
     * separate copyright holders with two separate reserved font names.
     *
     * The bare `OFL.txt` is gone with Urbanist. Noto Sans Devanagari is gone
     * too, and not because Hindi stopped mattering: React Native only loads a
     * bundled face that a style names by PostScript name, nothing named it, and
     * Android already ships `NotoSansDevanagari-VF.ttf` in /system/fonts. Four
     * static faces, 990,820 bytes, doing nothing a variable system font was not
     * already doing better.
     */
    const files = readdirSync(join(ROOT, 'assets/fonts'));
    const NOTICE: Record<string, string> = {
      Inter: 'OFL-Inter.txt',
      TitanOne: 'OFL-TitanOne.txt',
      // Material Symbols is Apache-2.0, not OFL — a different licence, still
      // mandatory to ship. Both instances map to the one notice.
      // Lucide is ISC, not OFL — a different licence, still mandatory to ship.
      Lucide: 'LICENSE-Lucide.txt',
      // Geist is OFL (Vercel, 2023).
      Geist: 'OFL-Geist.txt',
      // PappalGlyphs is Apache-2.0: the filled-heart glyph is derived from
      // Google Material Symbols 'favorite', which ships under Apache License 2.0.
      PappalGlyphs: 'LICENSE-PappalGlyphs.txt',
    };
    // `?? name` rather than a non-null assertion: a face called exactly `X.ttf`
    // with no weight suffix is its own family, and split always yields at least
    // one element, so the fallback is unreachable and says so honestly.
    const families = new Set(
      files
        .filter(f => f.endsWith('.ttf'))
        .map(f => {
          const stem = f.replace(/\.ttf$/, '');
          return stem.split('-')[0] ?? stem;
        }),
    );
    expect(families.size).toBeGreaterThan(0);
    for (const family of families) {
      // An unmapped family is a failure rather than a skip: adding a face without
      // deciding where its licence goes is exactly what this test exists to catch.
      expect(Object.keys(NOTICE)).toContain(family);
      expect(files).toContain(NOTICE[family]);
    }
  });

  it('never sets a fontWeight anywhere in the app', () => {
    // Comments stripped first, like every other source-reading gate in this
    // file. The rule is "never SETS a fontWeight", and prose sets nothing:
    // Icon.tsx now carries a long comment explaining why the heavy heart is
    // drawn by dilation rather than by asking for `fontWeight`, and the word
    // appearing in that explanation was failing the very gate the explanation
    // exists to honour. A gate that cannot tell code from the reasoning about
    // the code has failed three times in this repo already.
    const sources = ['src/components', 'src/screens']
      .flatMap(dir =>
        readdirSync(join(ROOT, dir)).map(f => stripComments(read(`${dir}/${f}`))),
      )
      .concat(stripComments(read('App.tsx')));
    for (const body of sources) {
      expect(body).not.toMatch(/fontWeight/);
    }
  });

  it('mounts the fonts directory into the Android build', () => {
    // Without this the faces resolve to the system font at runtime and the app
    // simply looks slightly wrong, with nothing failing anywhere.
    expect(read('android/app/build.gradle')).toContain("assets.srcDirs += ['../../assets']");
  });

  it('gives the token balance tabular numerals', () => {
    // A proportional 1 is narrower than a 9, so a non-tabular count makes the
    // pill twitch every time the balance passes a digit like 50 -> 49.
    expect(LIGHT.typography.numeralMedium.fontVariant).toEqual(['tabular-nums']);
    expect(LIGHT.typography.numeralSmall.fontVariant).toEqual(['tabular-nums']);
  });
});

/**
 * Motion is a token, and the physics are asserted rather than trusted.
 *
 * The prose in `design/tokens.json` claims that `smooth` does not overshoot and
 * that `bounce` does. Those are checkable statements about a damping ratio, and
 * the generator computes the ratio from the triplet, so if someone lowers
 * `smooth`'s damping to make sheets livelier, this fails instead of a sheet
 * quietly starting to wobble.
 */
describe('motion tokens', () => {
  const { spring, springMeta, press, gesture, decay, duration, opacity } = LIGHT.motion;

  it('declares exactly the four named springs', () => {
    expect(Object.keys(spring).sort()).toEqual(['bounce', 'gentle', 'smooth', 'snap']);
  });

  it('derives the damping ratio from the physics', () => {
    for (const [name, s] of Object.entries(spring)) {
      const ratio = s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
      expect(springMeta[name as keyof typeof springMeta].ratio).toBeCloseTo(ratio, 3);
    }
  });

  it('keeps smooth critically damped, so sheets do not wobble', () => {
    expect(springMeta.smooth.overshoots).toBe(false);
    expect(springMeta.smooth.ratio).toBeGreaterThanOrEqual(1);
  });

  it('keeps bounce visibly springy, since it is the signature moment', () => {
    expect(springMeta.bounce.overshoots).toBe(true);
    expect(springMeta.bounce.ratio).toBeLessThan(0.7);
  });

  it('settles feedback fast enough to feel attached to the finger', () => {
    // Under ~250ms for anything that answers a touch. Past that the press and
    // the response stop reading as one event.
    expect(springMeta.snap.settleMs).toBeLessThan(250);
  });

  it('tightens the rest thresholds rather than taking the defaults', () => {
    for (const s of Object.values(spring)) {
      expect(s.restDisplacementThreshold).toBeLessThanOrEqual(0.01);
      expect(s.restSpeedThreshold).toBeLessThanOrEqual(2);
    }
  });

  it('presses smaller targets harder than larger ones', () => {
    // The eye reads absolute pixel travel, not the ratio, so a chip needs a
    // bigger scale change than a card to register at all.
    expect(press.chip).toBeLessThan(press.button);
    expect(press.button).toBeLessThan(press.card);
    expect(press.send).toBeLessThan(press.chip);
    // An emoji grid cell is smaller than send in every dimension so it gets
    // the deepest transient scale (0.80 < 0.86). Telegram: EmojiView 0.8 scale.
    expect(press.cell).toBeLessThan(press.send);
  });

  it('squashes the send non-uniformly', () => {
    // Uniform scaling reads as "it got smaller"; a shorter Y reads as weight.
    expect(press.sendSquashY).toBeLessThan(press.send);
  });

  it('compresses a held button more gently than any transient press', () => {
    // `busy` is held for the length of a network request; every other press
    // value is held for the ~220ms a finger is down. At a transient value a
    // sustained compression stops reading as pressed and starts reading as the
    // wrong size, which is the same argument row's 0.99 makes against card's
    // 0.975. Asserted so nobody later "tidies" it to match press.button.
    expect(press.busy).toBeGreaterThan(press.card);
    expect(press.busy).toBeLessThan(1);
  });

  it('lands a step before its colour does', () => {
    // The pairing IS rule 4, not a coincidence of two measurements: the label
    // promotes faster than the accent behind it interpolates, and that ordering
    // is what stops a step change reading as the screen sliding sideways.
    expect(duration.stepPromote).toBeLessThan(duration.accentShift);
  });

  it('keeps the carousel cadence independent of the breathing cycle', () => {
    // breath / 4 is 1050 and the dwell is 1100: close enough to look like the
    // same number, and they are unrelated. One is a slogan cadence, the other is
    // the typing dots' cycle. Coupled, retuning the dots silently retimes
    // onboarding.
    expect(duration.carouselDwell).not.toBe(duration.breath / 4);
    // And a word has to hold longer than it takes to swap, or it is never still
    // long enough to read.
    expect(duration.carouselDwell).toBeGreaterThan(duration.base * 2);
  });

  it('keeps the three W4 durations in their measured relationships', () => {
    // pressRamp is the press-in ramp for emoji cells and icon buttons (Telegram
    // EmojiView ~80ms, rounded to 100). It must be faster than `instant` (110ms),
    // because the whole point is that press feedback is attached to the finger.
    expect(duration.pressRamp).toBeLessThan(duration.instant);
    // listAdd is the bubble-arrive fade (120ms). Faster than `fast` (170ms) so
    // a received message resolves quickly rather than lingering mid-opacity.
    expect(duration.listAdd).toBeLessThan(duration.fast);
    // sendReveal is the mic→send crossfade in useCrossfade (Telegram 220ms).
    // Faster than `base` (240ms) so it reads as snappy, not laboured.
    expect(duration.sendReveal).toBeLessThan(duration.base);
    // All three are independent measurements; none equals another, so retuning
    // one cannot silently retune the others.
    expect(duration.pressRamp).not.toBe(duration.listAdd);
    expect(duration.listAdd).not.toBe(duration.sendReveal);
  });

  it('separates hiding information from de-emphasising it', () => {
    // The whole reason there are two numbers. A carousel neighbour must be
    // unreadable (shape only); an inactive step label must stay readable,
    // because it says what is coming and what is done.
    expect(opacity.neighbour).toBeLessThan(opacity.inactive);
    expect(opacity.neighbour).toBeGreaterThan(0);
    expect(opacity.inactive).toBeLessThan(1);
  });

  it('dismisses a sheet on distance or velocity, not distance alone', () => {
    expect(gesture.dismissDistance).toBeGreaterThan(0);
    expect(gesture.dismissDistance).toBeLessThan(0.5);
    expect(gesture.dismissVelocity).toBeGreaterThan(0);
    expect(decay.deceleration).toBeGreaterThan(0.9);
    expect(decay.deceleration).toBeLessThan(1);
  });
});

/**
 * The Material 3 transition springs, kept honest against their published values.
 *
 * These are authored in `design/tokens.json` as {dampingRatio, stiffness} — how
 * M3 states them — and converted to the physical triplet by the generator,
 * because Reanimated ignores stiffness the moment a dampingRatio key is present.
 * The tests below check the conversion round-trips and that the two schemes keep
 * their character: spatial just under critically damped, effects at exactly
 * critical so opacity and colour never overshoot.
 */
describe('material 3 motion tokens', () => {
  const { m3 } = LIGHT.motion;

  it('declares exactly the six M3 springs', () => {
    expect(Object.keys(m3.spring).sort()).toEqual([
      'effectsDefault',
      'effectsFast',
      'effectsSlow',
      'spatialDefault',
      'spatialFast',
      'spatialSlow',
    ]);
  });

  it('round-trips the authored damping ratio through the physical triplet', () => {
    const authored = JSON.parse(
      readFileSync(join(ROOT, 'design/tokens.json'), 'utf8'),
    ).motion.m3.spring;
    for (const [name, s] of Object.entries(m3.spring)) {
      const ratio = s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
      expect(m3.springMeta[name as keyof typeof m3.springMeta].ratio).toBeCloseTo(ratio, 3);
      expect(ratio).toBeCloseTo(authored[name].dampingRatio, 3);
      expect(s.stiffness).toBe(authored[name].stiffness);
    }
  });

  it('keeps spatial springs just shy of critical and effects exactly critical', () => {
    for (const name of ['spatialFast', 'spatialDefault', 'spatialSlow'] as const) {
      expect(m3.springMeta[name].ratio).toBeCloseTo(0.9, 3);
    }
    for (const name of ['effectsFast', 'effectsDefault', 'effectsSlow'] as const) {
      expect(m3.springMeta[name].ratio).toBeGreaterThanOrEqual(1);
      expect(m3.springMeta[name].overshoots).toBe(false);
    }
  });

  it('orders each family fast, default, slow by stiffness', () => {
    expect(m3.spring.spatialFast.stiffness).toBeGreaterThan(m3.spring.spatialDefault.stiffness);
    expect(m3.spring.spatialDefault.stiffness).toBeGreaterThan(m3.spring.spatialSlow.stiffness);
    expect(m3.spring.effectsFast.stiffness).toBeGreaterThan(m3.spring.effectsDefault.stiffness);
    expect(m3.spring.effectsDefault.stiffness).toBeGreaterThan(m3.spring.effectsSlow.stiffness);
  });

  it('holds the three easing curves as valid unit-x beziers', () => {
    for (const curve of [
      m3.easing.emphasizedDecelerate,
      m3.easing.emphasizedAccelerate,
      m3.easing.standard,
      m3.easing.decelerate,
      m3.easing.easeOutQuint,
      // Added W4#1: timed-curve easings for animations with no finger velocity.
      m3.easing.easeOut,
      m3.easing.ease,
    ]) {
      expect(curve).toHaveLength(4);
      expect(curve[0]).toBeGreaterThanOrEqual(0);
      expect(curve[0]).toBeLessThanOrEqual(1);
      expect(curve[2]).toBeGreaterThanOrEqual(0);
      expect(curve[2]).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the M3 durations ascending', () => {
    const { short2, short3, short4, medium2, medium3, medium4, long2 } = m3.duration;
    expect(short2).toBeLessThan(short3);
    expect(short3).toBeLessThan(short4);
    expect(short4).toBeLessThan(medium2);
    expect(medium2).toBeLessThan(medium3);
    expect(medium3).toBeLessThan(medium4);
    expect(medium4).toBeLessThan(long2);
  });

  it('sets the scrim between the two extremes it must sit between', () => {
    // Darker than a state layer, lighter than a blackout. M3 says 32%; this app
    // is tuned to 0.4 and the token lives in `interaction`.
    expect(LIGHT.interaction.scrim).toBeGreaterThan(0.3);
    expect(LIGHT.interaction.scrim).toBeLessThan(0.6);
    expect(DARK.interaction.scrim).toBe(LIGHT.interaction.scrim);
  });
});

/**
 * The M3 transition builders are actually wired in, not just defined.
 *
 * Phase 2 built `screenIn`/`topLevelIn`/`menuIn`/the M3 springs; these check the
 * surfaces consume them, so a future edit that reverts a screen to a raw
 * `SlideInRight` or a hardcoded scrim fails here rather than on a device.
 */
describe('the app is wired to the M3 transitions', () => {
  const app = read('App.tsx');

  it('pushes every overlay through the one PushedLayer', () => {
    // Every pushed screen in both trees goes through the same layer: an
    // effect-driven entrance (`useScreenEnter`, because `entering` does not run
    // on this mount path) and the `screenOut` layout animation on the way out.
    expect(app).toContain('function PushedLayer(');
    expect(app).toContain('const enter = useScreenEnter();');
    expect(app).toContain('onLayout={enter.onLayout}');
    // Home's slide-in is kicked from the pop, not from an effect on the new route.
    expect(app).toContain('revealHome();');
    expect(app).toContain('useHomeRevealStyle()');
    expect(app).toContain('exiting={screenOut}');
    expect((app.match(/<PushedLayer/g) ?? []).length).toBeGreaterThanOrEqual(4);
    // And never the old raw slide presets, nor an `entering` on a pushed overlay.
    expect(app).not.toMatch(/SlideInRight|SlideOutRight/);
    expect(app).not.toContain('entering={screenIn}');
  });

  it('fades the top-level tab layers rather than sliding them', () => {
    /*
     * The tabs cross-fade on a shared value now, not on `entering`/`exiting`
     * layout animations (Amit, 2026-09-04: tab switching was "slow and janky").
     * A layout animation runs on mount/unmount of the whole subtree, so it
     * competed with the remount it was meant to cover; `TabLayer` keeps every
     * visited tab mounted and animates `opacity` only.
     *
     * What still has to hold is that the movement is a FADE and nothing slides:
     * no translate on the tab layer, and the opacity drives `display` so a
     * hidden tab leaves layout instead of being measured behind the active one.
     */
    const layer = app.slice(app.indexOf('function TabLayer'), app.indexOf('const { StartupTiming }'));
    expect(layer).toContain('opacity: opacity.value');
    expect(layer).toContain("display: opacity.value === 0 ? ('none' as const)");
    expect(layer).not.toMatch(/translate[XY]/);
    // And the tabs are mounted through it rather than conditionally rendered.
    for (const tab of ['favourites', 'calls', 'settings']) {
      expect(app).toContain(`<TabLayer active={route.name === '${tab}'}`);
    }
  });

  it('declares a back direction before every pop', () => {
    // The hardware-back handler and the in-screen back paths must set the
    // direction, or a pop would animate as a push.
    expect(app).toContain("setNavDirection('back')");
    expect(app).toContain("setNavDirection('forward')");
  });

  it('holds no raw transition builder in App.tsx', () => {
    // Every transition App.tsx plays is a named builder from motion.ts, never
    // an inline `FadeIn.duration(...)`; nothing here spells a duration in
    // milliseconds directly.
    expect(stripComments(app)).not.toMatch(/\.duration\(\s*\d/);
  });

  it('drives the sheet surfaces off the shared scrim token', () => {
    for (const file of [
      'src/components/Sheet.tsx',
      'src/components/SpotlightCard.tsx',
      'src/components/PaperMenu.tsx',
    ]) {
      const body = read(file);
      expect(body).toContain('INTERACTION.scrim');
      // No raw scrim opacity literal left behind (0.4 / 0.45).
      expect(stripComments(body)).not.toMatch(/opacity:\s*0\.4/);
    }
  });

  it('animates the toolbar indicator instead of hard-toggling it', () => {
    const bar = read('src/components/FloatingToolbar.tsx');
    expect(bar).toContain('<Indicator active={on} />');
    expect(bar).not.toContain('indicatorOn');
    expect(bar).toContain("springTo(active ? 1 : 0.6, 'spatialFast')");
  });
});

/**
 * The spacing scale and the component-height scale, kept on grid and on token.
 */
describe('spacing and layout tokens', () => {
  const { space, layout, interaction } = LIGHT;

  it('is a strictly increasing scale of even, mostly-4dp values', () => {
    const values = Object.values(space);
    for (const v of values) {
      expect(v % 2).toBe(0);
      if (v >= 8) {
        expect(v % 4).toBe(0);
      }
    }
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]!);
    }
  });

  it('anchors the M3 endpoints and names the source gap', () => {
    expect(space.hair).toBe(2);
    expect(space['6xl']).toBe(64);
    // The onboarding form gap was measured before the scale reached it; now it
    // is a token, and this pins the two together so neither drifts alone.
    expect(space['6xl']).toBe(SOURCE_METRICS.formGap);
  });

  it('holds the M3 list-item heights', () => {
    expect(layout.rowOneLine).toBe(56);
    expect(layout.rowTwoLine).toBe(72);
    expect(layout.rowThreeLine).toBe(88);
  });

  it('derives the floating-toolbar height from its own padding and target', () => {
    // 64 = xs + minTarget + xs, so the bar's padding cannot drift from its
    // declared height. And it is the M3 toolbar 64, never the retired nav-bar 80.
    expect(layout.toolbarHeight).toBe(2 * space.xs + interaction.minTarget);
    expect(layout.toolbarHeight).not.toBe(80);
  });
});

/**
 * Spacing lives in tokens.
 *
 * `gap: 16` is a token that escaped; `gap: TOKENS.space.md` is the same number
 * spelled so it changes in one place. Zero is exempt by construction (a reset of
 * a React Native default is not a spacing decision), and a token expression or a
 * named constant never matches because nothing after the colon is a bare digit —
 * which is the point: a measured value gets a NAME, not a pass. Comments are
 * stripped first, as the motion gate explains, so a quoted SwiftUI/M3 source does
 * not fail a file whose code is correct.
 *
 * The allowlist is the burn-down list: measured optical nudges (1/3/5/6/7/10/14dp)
 * the 4dp grid cannot express, plus two documented departures. Each entry is the
 * exact `prop: value` text; removing a site removes its entry, and the stale
 * check fails an entry that no longer matches anything.
 */
describe('large text roles carry a font-scale cap', () => {
  // A capped role (display/headline/title/wordmark) spread into a text style
  // must be wired with maxFontSizeMultiplier so a 200% accessibility font scale
  // cannot overflow a title the way an uncapped one would. Body/label/numeral
  // roles are uncapped by construction and never match. See ADR-0024.
  const CAPPED_SPREAD =
    /\.\.\.\s*TOKENS\.typography\.(wordmark|display|headline|title)[A-Za-z]*/;
  const sources = ['src/components', 'src/screens'].flatMap(dir =>
    readdirSync(join(ROOT, dir))
      .filter(f => f.endsWith('.tsx'))
      .map(f => ({ file: `${dir}/${f}`, body: stripComments(read(`${dir}/${f}`)) })),
  );

  it('wires maxFontSizeMultiplier wherever a capped role is used', () => {
    const offenders = sources
      .filter(s => CAPPED_SPREAD.test(s.body))
      .filter(s => !s.body.includes('maxFontSizeMultiplier'))
      .map(s => s.file);
    expect(offenders).toEqual([]);
  });
});

/**
 * A kind of text reads at one role, whether it is on a screen or in a sheet.
 *
 * The defect this exists for: RechargeScreen set the pack price in
 * titleLargeEmphasized (22dp Geist-Bold) and PaymentSheet — the MODAL for that
 * same money — restated the identical rupee figure inside Sheet's `body`, which
 * is bodyLarge, 16dp Geist-Regular. Same number, two weights, decided by whether
 * a sheet happened to be over the screen (Amit, 2026-09-07: "the type font is
 * not consistent -- recharge screens show heavy weight but modal is normal
 * weight"). Three more had drifted the same way in the same file: a payment
 * confirmation at the filled-button role, a status line and a text button at
 * bodyMedium.
 *
 * ADR-0024 is what makes this checkable rather than a matter of taste. The app
 * is on the M3 scale in absolute dp, weight is a bundled static FACE and never a
 * numeric fontWeight, and each role has a documented home — bodyMedium's is
 * "list previews, timestamps". So "which role does this kind of text take" has
 * one answer per kind, and the answer is readable out of the source.
 *
 * Comments are stripped before anything is matched, and the role is read by
 * BRACE-MATCHING the named style block rather than by a regex window — this repo
 * has shipped gates that graded their own explanatory prose (see the fontWeight
 * gate's comment), and the prose above names every role it forbids.
 */
describe('a kind of text reads at one role, screen or sheet', () => {
  /** The four kinds, and the one role each takes. */
  const MONEY_FIGURE = 'titleLargeEmphasized';
  const SUPPORTING_LINE = 'bodyLarge';
  const DISCLOSURE = 'bodySmall';
  const TEXT_BUTTON = 'labelLargeEmphasized';

  /**
   * The typography role a named style spreads.
   *
   * Brace-matched from `<name>: {` to its own closing brace, so a style that
   * contains a nested object (`transform: [{ scale }]`) is still read whole and
   * a style cannot be credited with the role of the one after it. Returns null
   * when the style is gone, and every assertion below compares against a role
   * string, so a renamed or deleted style fails loudly instead of passing
   * vacuously.
   */
  const roleOf = (file: string, styleName: string): string | null => {
    const body = stripComments(read(file));
    const at = body.search(new RegExp(`\\b${styleName}\\s*:\\s*\\{`));
    if (at === -1) return null;
    let depth = 0;
    let end = body.indexOf('{', at);
    const start = end;
    for (; end < body.length; end++) {
      if (body[end] === '{') depth += 1;
      else if (body[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return /\.\.\.\s*TOKENS\.typography\.(\w+)/.exec(body.slice(start, end + 1))?.[1] ?? null;
  };

  const RECHARGE = 'src/screens/RechargeScreen.tsx';
  const PAYMENT = 'src/screens/PaymentSheet.tsx';
  const SHEET = 'src/components/Sheet.tsx';

  it('proves the four roles differ by FACE, not only by size', () => {
    // Without this the rest of the file is just string equality. These are the
    // ADR-0024 face mappings: emphasized -> Geist-Bold, Regular -> Geist-Regular.
    // The money figure is Bold and the line the sheet had been using is Regular,
    // which is exactly the "heavy on the screen, normal in the modal" report.
    expect(LIGHT.typography[MONEY_FIGURE].fontFamily).toBe('Geist-Bold');
    expect(LIGHT.typography[SUPPORTING_LINE].fontFamily).toBe('Geist-Regular');
    expect(LIGHT.typography[DISCLOSURE].fontFamily).toBe('Geist-Regular');
    expect(LIGHT.typography[TEXT_BUTTON].fontFamily).toBe('Geist-Bold');
    // The text-button fix is a pure WEIGHT fix: labelLargeEmphasized and the
    // bodyMedium it replaced are both 14dp, so nothing moved on the layout.
    expect(LIGHT.typography[TEXT_BUTTON].fontSize).toBe(
      LIGHT.typography.bodyMedium.fontSize,
    );
    expect(LIGHT.typography.bodyMedium.fontFamily).toBe('Geist-Regular');
  });

  it('states a money figure at the same role on the screen and in its sheet', () => {
    // The screen side: the compact chip's price and the wallet page's price.
    expect(roleOf(RECHARGE, 'amount')).toBe(MONEY_FIGURE);
    expect(roleOf(RECHARGE, 'cardAmount')).toBe(MONEY_FIGURE);
    // The sheet side, for the SAME money: the checkout total, and the terminal
    // "N tokens added" that confirms it. successDetail was
    // titleMediumEmphasized, which ADR-0024 assigns to the filled-button label
    // (Button.tsx) — a payment confirmation set at the weight of a button.
    expect(roleOf(PAYMENT, 'totalValue')).toBe(MONEY_FIGURE);
    expect(roleOf(PAYMENT, 'successDetail')).toBe(MONEY_FIGURE);
  });

  it('states a supporting line at the same role on every screen and sheet', () => {
    // Sheet's `body` is the anchor: every sheet subhead in the app comes through
    // this one style, so the screen side has to match it rather than the reverse.
    expect(roleOf(SHEET, 'body')).toBe(SUPPORTING_LINE);
    for (const [file, style] of [
      [PAYMENT, 'totalLabel'],
      [PAYMENT, 'centreLabel'],
      [PAYMENT, 'successBalance'],
      ['src/screens/SafetySheet.tsx', 'reasonLabel'],
      ['src/screens/SettingsSheet.tsx', 'rowTitle'],
      ['src/components/SessionFeedbackSheet.tsx', 'word'],
      // The screen half of the pair — a centred "Loading…" and an empty-state
      // body on a full page, the same job centreLabel does inside the sheet.
      ['src/screens/TransactionHistoryScreen.tsx', 'hintText'],
      ['src/screens/TransactionHistoryScreen.tsx', 'emptyBody'],
      ['src/components/NoticeBar.tsx', 'text'],
    ] as const) {
      expect(roleOf(file, style)).toBe(SUPPORTING_LINE);
    }
  });

  it('states a tax or caption disclosure at the same role, chip or sheet', () => {
    // The base + tax line is the same disclosure whether it is under a pack chip
    // or under the checkout total (ADR-0029: the pack is the base, the charge is
    // base + tax). On the sheet it used to ride the bodyLarge subhead, i.e. the
    // DISCLOSURE was louder in the modal than on the screen while the TOTAL was
    // quieter — the inversion, both directions at once.
    expect(roleOf(RECHARGE, 'tokensGst')).toBe(DISCLOSURE);
    expect(roleOf(RECHARGE, 'cardGst')).toBe(DISCLOSURE);
    expect(roleOf(PAYMENT, 'totalGst')).toBe(DISCLOSURE);
    expect(roleOf('src/screens/SettingsSheet.tsx', 'rowDetail')).toBe(DISCLOSURE);
  });

  it('sets every text button in the bold label face', () => {
    // A tappable text label is bold everywhere in the app. PaymentSheet's
    // "Card, Net Banking & Wallets" was the one exception, in a regular face.
    for (const [file, style] of [
      [PAYMENT, 'webRowText'],
      ['src/components/ConfirmDialog.tsx', 'cancel'],
      ['src/screens/SettingsSheet.tsx', 'rateFooterText'],
      ['src/components/CodeField.tsx', 'verifyLabel'],
      ['src/components/UpdateBanner.tsx', 'actionLabel'],
      ['src/screens/BlockedUsersScreen.tsx', 'unblockLabel'],
    ] as const) {
      expect(roleOf(file, style)).toBe(TEXT_BUTTON);
    }
  });

  it('keeps bodyMedium out of the sheet and dialog surfaces entirely', () => {
    // bodyMedium's documented home in ADR-0024 is "list previews, timestamps,
    // sheet body" — and the sheet-body clause is the one this pass retired, on
    // the evidence that it is what made the modal quieter than its screen. None
    // of these six surfaces renders a list preview or a timestamp, so after this
    // pass none of them has a reason to reach for a 14dp regular face; the ones
    // that had were all drift from a role decided elsewhere.
    //
    // Scoped to these six files rather than the whole app on purpose: bodyMedium
    // is CORRECT on ChatsListScreen's `rowPreview`, ProviderHomeScreen's
    // `rowTime` and TopAppBar's `subtitle`, which are the previews and timestamps
    // the role exists for.
    for (const file of [
      'src/components/Sheet.tsx',
      'src/components/ConfirmDialog.tsx',
      'src/components/SessionFeedbackSheet.tsx',
      'src/screens/PaymentSheet.tsx',
      'src/screens/SafetySheet.tsx',
      'src/screens/SettingsSheet.tsx',
    ]) {
      expect(stripComments(read(file))).not.toMatch(/TOKENS\.typography\.bodyMedium/);
    }
  });

  /**
   * The same, for a kind of text that renders TWICE IN ONE FILE.
   *
   * RechargeScreen carries two style factories for one feature —
   * `makeCompactStyles` for the interrupting Sheet, `makeStyles` for
   * RechargeWalletPage — and `balanceValue`, `balanceLabel` and `section` each
   * exist in both. `roleOf` above cannot see that: it brace-matches the FIRST
   * `<name>: {` in the file, so on these three it would read one half twice and
   * pass green while the other half said something else. That is not a flaw in
   * `roleOf` — every style it is used on above is unique in its file — but it is
   * exactly the drift this file is here to catch, so these three need the factory
   * as part of the address.
   */
  const factoryOf = (file: string, factory: string): string => {
    const body = stripComments(read(file));
    const at = body.indexOf(`const ${factory} = (`);
    expect(at).toBeGreaterThan(-1);
    // From the declaration to the next top-level `const`, so one factory can
    // never be credited with a style belonging to the factory after it.
    const rest = body.slice(at + 1);
    const next = rest.indexOf('\nconst ');
    return next > 0 ? rest.slice(0, next) : rest;
  };

  /** The role `<styleName>: {` spreads, within one factory's body. */
  const roleInFactory = (body: string, styleName: string): string | null => {
    const at = body.search(new RegExp(`^ {4}${styleName}\\s*:\\s*\\{`, 'm'));
    if (at === -1) return null;
    let depth = 0;
    let end = body.indexOf('{', at);
    const start = end;
    for (; end < body.length; end++) {
      if (body[end] === '{') depth += 1;
      else if (body[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return /\.\.\.\s*TOKENS\.typography\.(\w+)/.exec(body.slice(start, end + 1))?.[1] ?? null;
  };

  /** In-flow section heading over content: bold 16 on primary ink. */
  const SECTION_HEADING = 'titleMediumEmphasized';

  /**
   * The token balance — a FIGURE, not money (Amit, 2026-09-07).
   *
   * Deliberately not MONEY_FIGURE. The balance is a token count rather than a
   * rupee amount, and the app already separates the two: `successBalance`, the
   * other "N tokens" line in this flow, is a SUPPORTING_LINE and not a money
   * figure. What the balance shares with the numerals is tabular digits, which
   * the text roles do not carry and which the bespoke block it replaced was
   * hand-rolling. Asserted against MONEY_FIGURE below so the distinction is a
   * decision on the record rather than an oversight someone later "tidies".
   */
  const BALANCE_FIGURE = 'numeralLarge';

  const SHEET_HALF = factoryOf(RECHARGE, 'makeCompactStyles');
  const PAGE_HALF = factoryOf(RECHARGE, 'makeStyles');

  it('addresses each recharge factory separately, or the pairs below prove nothing', () => {
    // A guard on the guard. `makeStyles` is declared before `makeCompactStyles`
    // and its name is a prefix of nothing else here, but a careless slice would
    // swallow the factory after it and read both halves as one.
    expect(SHEET_HALF).not.toContain('const makeStyles');
    expect(PAGE_HALF).not.toContain('const makeCompactStyles');
    // Both halves really do define all three, which is the premise of the pairs.
    for (const style of ['balanceValue', 'balanceLabel', 'section']) {
      expect(roleInFactory(SHEET_HALF, style)).not.toBeNull();
      expect(roleInFactory(PAGE_HALF, style)).not.toBeNull();
    }
  });

  it('states the balance figure at one numeral role in both recharge hosts', () => {
    // The page's half was a bespoke Geist-Bold 34/40/-0.4 block — the last
    // hand-rolled type in the file, and a 16th role beside ADR-0024's 15. Not
    // numeralDisplay (32dp), whose note names the balance hero: the sheet's
    // balance ROW has 224dp for label AND value on a 360dp window and "12,345
    // tokens" is 237.6dp of it at 32dp, so only one of the two hosts could
    // render it.
    expect(roleInFactory(SHEET_HALF, 'balanceValue')).toBe(BALANCE_FIGURE);
    expect(roleInFactory(PAGE_HALF, 'balanceValue')).toBe(BALANCE_FIGURE);
  });

  it('keeps the balance figure tabular, and distinct from the money figure', () => {
    // The whole reason it is a numeral role: a figure that changes wants digits
    // of equal width. No text role in the scale carries fontVariant.
    expect(LIGHT.typography[BALANCE_FIGURE].fontVariant).toEqual(['tabular-nums']);
    expect(LIGHT.typography[BALANCE_FIGURE].fontFamily).toBe('Geist-Bold');
    expect(LIGHT.typography[MONEY_FIGURE]).not.toHaveProperty('fontVariant');
    // And the split is intentional, not two names for one thing.
    expect(BALANCE_FIGURE).not.toBe(MONEY_FIGURE);
    // Uncapped by construction (ADR-0024 § fontScaleCap: body, label and numerals
    // scale freely), which is why neither call site wires maxFontSizeMultiplier.
    expect(TOKENS.fontScaleCap).not.toHaveProperty(BALANCE_FIGURE);
    expect(TOKENS.fontScaleCap).toHaveProperty(MONEY_FIGURE);
  });

  it('states the balance label at the supporting-line role in both recharge hosts', () => {
    // The wrong half was the PAGE: bodyMedium there against the sheet's
    // bodyLarge. Same direction as the pass above — bodyMedium's retired
    // "sheet body" clause, showing up on a screen instead of in a modal.
    expect(roleInFactory(SHEET_HALF, 'balanceLabel')).toBe(SUPPORTING_LINE);
    expect(roleInFactory(PAGE_HALF, 'balanceLabel')).toBe(SUPPORTING_LINE);
    // And it is a real size change, not a rename: the two roles differ in dp.
    expect(LIGHT.typography[SUPPORTING_LINE].fontSize).not.toBe(
      LIGHT.typography.bodyMedium.fontSize,
    );
  });

  it('states the section header at one role, and in the heading FACE', () => {
    // "Choose a pack" (sheet) and "Add tokens" (page) were both 16dp, so this
    // pair is a FACE defect rather than a size one: the sheet's bodyLarge is
    // Geist-Regular, so one host's section header read as body text and the
    // other's read as a heading.
    expect(roleInFactory(SHEET_HALF, 'section')).toBe(SECTION_HEADING);
    expect(roleInFactory(PAGE_HALF, 'section')).toBe(SECTION_HEADING);
    expect(LIGHT.typography[SECTION_HEADING].fontFamily).toBe('Geist-Bold');
    expect(LIGHT.typography[SECTION_HEADING].fontSize).toBe(
      LIGHT.typography[SUPPORTING_LINE].fontSize,
    );
    expect(LIGHT.typography[SUPPORTING_LINE].fontFamily).toBe('Geist-Regular');
  });

  it('leaves no bespoke type block in either recharge factory', () => {
    // The shape item 1 came in as: a text style setting its own fontSize or
    // fontFamily instead of spreading a role. Checked PER FACTORY — an `||`
    // across the two would pass a bespoke block in one half while the other
    // still spread a role, which is precisely how this one survived.
    //
    // `rateIcon` sizes the ⓘ glyph rather than a text role, and `ribbonText` /
    // `minutesText` borrow a FACE on top of a role (ADR-0024 § the `face`
    // block) — the latter spread a role first, so they only surface here if that
    // spread is removed.
    const BESPOKE = /^ {4}(\w+)\s*:\s*\{[^}]*?\b(fontSize|fontFamily)\s*:/gms;
    const offenders = (
      [
        ['sheet', SHEET_HALF],
        ['page', PAGE_HALF],
      ] as const
    ).flatMap(([host, body]) =>
      [...body.matchAll(BESPOKE)]
        .flatMap(m => (m[1] ? [m[1]] : []))
        .filter(name => name !== 'rateIcon')
        .filter(name => roleInFactory(body, name) === null)
        .map(name => `${host}.${name}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe('spacing lives in tokens', () => {
  const SPACING = /\b(padding|margin|gap|rowGap|columnGap)(Top|Bottom|Left|Right|Horizontal|Vertical|Start|End)?\s*:\s*(-?[1-9]\d*)\b/g;
  const sources = ['src/components', 'src/screens']
    .flatMap(dir =>
      readdirSync(join(ROOT, dir))
        .filter(f => f.endsWith('.tsx'))
        .map(f => ({ file: `${dir}/${f}`, body: stripComments(read(`${dir}/${f}`)) })),
    )
    .concat({ file: 'App.tsx', body: stripComments(read('App.tsx')) });

  const ALLOW: Record<string, string[]> = {
    // Composer field vertical pad is mapped to Telegram measured on device (S22,
    // density 2.8125×): its composer field is ~40dp with 16sp text, so the input
    // is minHeight 32 + pad 6/6 (capsule ≈ 40 with the field's 4dp paddingVertical).
    'src/components/Composer.tsx': [
      'paddingTop: 4',
      'paddingBottom: 4',
      'paddingRight: 6',
    ],
    // Optical nudges the 4dp grid cannot name: a 5dp pill pad, a 6dp dot offset,
    // a 1dp tag inset, a 3dp glyph gap. Grandfathered with their reasons.
    /*
     * FilterChip's three Material 3 chip measurements that are not on the 4dp
     * scale, and should not be added to it — a measured value for one component
     * rather than a step anyone else needs, the same trade `SOURCE_METRICS`
     * argues in `src/lib/onboarding.ts`.
     *
     * Read from material-components-android master, not from m3.material.io
     * (client-rendered, returns a page title to a fetch):
     *   paddingEnd 10    styles.xml `Widget.Material3.Chip.Filter`
     *                    `chipEndPadding`
     *   marginEnd 6      the spec's effective icon-to-label gap,
     *                    `iconEndPadding: -2dp` + `textStartPadding: 8dp`
     *   paddingVertical 6  forced, not chosen: `labelLarge`'s lineHeight is 20,
     *                    and 20 + 6 + 6 = 32, which is `chipMinHeight`
     *                    (`m3_comp_filter_chip_container_height`). Any other
     *                    value misses the spec's own container height.
     * The matching 8dp start padding IS on the scale and is written as
     * `space.xs`.
     */
    'src/components/Chip.tsx': [
      'paddingVertical: 6',
      'paddingEnd: 10',
      'marginEnd: 6',
    ],
    'src/components/CallingDots.tsx': ['marginLeft: 6'],
    'src/components/DirectorySkeleton.tsx': ['gap: 6'],
    'src/components/NoticeBar.tsx': ['paddingVertical: 10'],
    'src/components/ProviderCard.tsx': ['gap: 3'],
    'src/components/ReactionStrip.tsx': ['paddingHorizontal: 6'],
    'src/components/Sheet.tsx': ['paddingTop: 5'],
    'src/components/SpotlightCard.tsx': ['paddingVertical: 5'],
    'src/components/ThreadBubble.tsx': ['paddingVertical: 1', 'paddingHorizontal: 5'],
    'src/components/TokenCounter.tsx': ['paddingVertical: 5'],
    /*
     * The last four are the WhatsApp bubble box, read from the APK on
     * 2026-09-08 (com.whatsapp 2.26.34.81, pulled off the Redmi over adb).
     * 2, 5 and 10 are not on the 4dp scale and must not be rounded onto it:
     * rounding a measurement discards the measurement, the same trade
     * `SOURCE_METRICS` argues in src/lib/onboarding.ts.
     *
     * They are message_text's padding (8/2/8/3) PLUS 2dp on the right and
     * bottom from a parent two elements up in the same layout — an adversarial
     * verification pass caught that the first reading understated both by 2dp.
     *
     * NOT exempted, because someone will look for it here: the corner radius.
     * It stays OURS at 22dp; WhatsApp's could not be sourced. See
     * radius.$bubbleNote in design/tokens.json for why the 12dp that one pass
     * reported as first-party was withdrawn.
     *
     * An earlier edit added these as a SECOND 'src/components/Turn.tsx' key in
     * this object literal, which JS silently resolves in favour of the last
     * one — so the allowlist looked correct and the gate still failed. Merged.
     */
    'src/components/Turn.tsx': [
      'paddingBottom: 14',
      'paddingHorizontal: 5',
      'paddingVertical: 1',
      'gap: 3',
      'gap: 1',
      'paddingLeft: 8',
      'paddingTop: 2',
      'paddingRight: 10',
      'paddingBottom: 5',
    ],
    'src/components/VoiceNote.tsx': ['paddingVertical: 1'],
    'src/screens/HomeScreen.tsx': ['padding: 3'],
    'src/screens/PolicyGateScreen.tsx': ['gap: 6'],
    'src/screens/ProviderHomeScreen.tsx': ['gap: 3', 'paddingHorizontal: 5'],
    'src/screens/RechargeScreen.tsx': ['paddingVertical: 3'],
    // The profile avatar is pulled up over the header by half its 88dp size. A
    // documented departure; becomes a named constant when SettingsSheet is next
    // touched.
    'src/screens/SettingsSheet.tsx': ['marginTop: -44'],
  };

  it('never writes a raw padding, margin or gap outside the theme', () => {
    const offenders: string[] = [];
    for (const s of sources) {
      const allowed = new Set(ALLOW[s.file] ?? []);
      for (const m of s.body.matchAll(SPACING)) {
        const hit = `${m[1]}${m[2] ?? ''}: ${m[3]}`;
        if (!allowed.has(hit)) {
          offenders.push(`${s.file}  ${hit}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('keeps the allowlist honest', () => {
    for (const [file, entries] of Object.entries(ALLOW)) {
      const body = sources.find(s => s.file === file)?.body ?? '';
      for (const entry of entries) {
        expect(body.includes(entry) ? `${file} ${entry}` : `${file} ${entry} STALE`).toBe(
          `${file} ${entry}`,
        );
      }
    }
  });
});

/**
 * Component heights come from tokens.
 *
 * Scoped by STYLE NAME, not by property: a `height: 14` on a presence dot is a
 * size, not a container height, and a rule that flagged it would be an allowlist
 * with a test attached. A style named `row`/`bar`/`slot`/`cell`/`item` is the
 * thing M3 gives a container height to, so that is what is inspected. The
 * allowlist grandfathers the rows/bars migrated to `layout.*` in the
 * component-heights pass; a raw 44 target is forbidden outright (they are all
 * `interaction.minTarget` now).
 */
describe('component heights come from tokens', () => {
  const sources = ['src/components', 'src/screens']
    .flatMap(dir =>
      readdirSync(join(ROOT, dir))
        .filter(f => f.endsWith('.tsx'))
        .map(f => ({ file: `${dir}/${f}`, body: stripComments(read(`${dir}/${f}`)) })),
    )
    .concat({ file: 'App.tsx', body: stripComments(read('App.tsx')) });
  const ROW_LIKE = /(\w*(?:row|Row|bar|Bar|cell|Cell|slot|Slot|item|Item))\s*:\s*\{([^}]*)\}/g;
  const RAW_HEIGHT = /\b(height|minHeight)\s*:\s*[1-9]/;
  // Rows/bars still holding a raw container height, migrated to layout tokens in
  // the component-heights pass. Grandfathered by style-block name per file.
  const ALLOW: Record<string, string[]> = {
    'src/components/FloatingToolbar.tsx': ['slot'],
    'src/components/TopAppBar.tsx': ['slot'],
    'src/screens/PaymentSheet.tsx': ['row', 'webRow'],
    'src/screens/ProfileSetupScreen.tsx': ['avatarCell'],
    'src/screens/ProviderApplicationScreen.tsx': ['avatarCell'],
    'src/screens/RechargeScreen.tsx': ['bar'],
    'src/screens/SettingsSheet.tsx': ['row'],
    'src/screens/TransactionHistoryScreen.tsx': ['row'],
  };

  it('never sizes a row, bar, slot or cell with a raw number outside the allowlist', () => {
    const offenders: string[] = [];
    for (const s of sources) {
      const allowed = new Set(ALLOW[s.file] ?? []);
      for (const m of s.body.matchAll(ROW_LIKE)) {
        if (RAW_HEIGHT.test(m[2]!) && !allowed.has(m[1]!)) {
          offenders.push(`${s.file}  ${m[1]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('never uses 44 as a touch target', () => {
    // iOS's 44 satisfied nothing here: minTarget is 48 and one number serves both.
    for (const s of sources) {
      expect(s.body).not.toMatch(/\b(minHeight|minWidth|width|height)\s*:\s*44\b/);
    }
  });
});

/**
 * No component is allowed its own physics.
 *
 * Motion is the part of a design system that gets tuned by feel, and a spring
 * hidden in a component is a spring nobody will find when the answer to "make
 * this calmer" is one number. Everything goes through src/theme/motion.ts.
 */
describe('motion lives in one module', () => {
  const sources = ['src/components', 'src/screens'].flatMap(dir =>
    readdirSync(join(ROOT, dir))
      .filter(f => f.endsWith('.tsx'))
      .map(f => ({ file: `${dir}/${f}`, body: read(`${dir}/${f}`) })),
  );

  it('never hardcodes a damping, stiffness or mass outside the theme', () => {
    for (const s of sources) {
      expect(s.body).not.toMatch(/damping:\s*\d/);
      expect(s.body).not.toMatch(/stiffness:\s*\d/);
      expect(s.body).not.toMatch(/mass:\s*\d/);
    }
  });

  it('never calls withSpring directly, springTo carries the token', () => {
    for (const s of sources) {
      expect(s.body).not.toMatch(/\bwithSpring\(/);
    }
  });

  it('never writes a raw duration in milliseconds', () => {
    for (const s of sources) {
      /*
       * `duration: 240` is a token that escaped; `duration: DURATION.base` is
       * the same number spelled so it can be changed in one place.
       *
       * Comments are stripped first, and that is not a loophole. Several files
       * quote the SwiftUI source they were translated from — `.bouncy(duration: 1)`,
       * `.smooth(duration: 0.7)` — and matching prose made this fail on a file
       * whose code was correct and whose documentation was the whole point.
       * A test that reads comments is a test that grades documentation.
       */
      /*
       * Three forms, not one. The gate only ever caught the object-literal
       * `duration: 240`, so four builder-style slips lived in screens for
       * months - `FadeInDown.duration(220)`, `FadeOutUp.duration(160)`,
       * `FadeIn.duration(220)` and a `.delay(80)` - each a hand-picked number
       * close enough to a token to look like one and free to drift from it.
       * A builder call is exactly where a raw duration hides, so it is checked
       * too.
       */
      expect(stripComments(s.body)).not.toMatch(
        /duration:\s*\d|\.duration\(\s*\d|\.delay\(\s*\d/,
      );
    }
  });

  it('gives every scrollable the same scroll feel', () => {
    /*
     * src/lib/scroll.ts says "Spread onto every FlatList/ScrollView", and five
     * screens did not: Onboarding, PolicyGate, ProfileSetup, ProviderApplication
     * and ProviderBank. A screen that scrolls with different physics from the
     * one before it is a seam the user feels and cannot name - and "every" in a
     * docstring is a wish until something checks it.
     *
     * Enforced by scanning rather than by a fixed list, so a NEW screen with a
     * scroller fails this the day it is written.
     */
    const dir = join(ROOT, 'src/screens');
    const offenders: string[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.tsx')) {
        continue;
      }
      const body = read(join('src/screens', name));
      const scrollers = body.match(/<(ScrollView|FlatList|SectionList|FlashList)\b/g) ?? [];
      if (scrollers.length === 0) {
        continue;
      }
      const spreads = body.match(/\{\.\.\.SCROLL_PHYSICS\}/g) ?? [];
      if (spreads.length < scrollers.length) {
        offenders.push(`${name}: ${scrollers.length} scroller(s), ${spreads.length} spread(s)`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('routes the signature moment through the shared builder', () => {
    expect(read('src/components/Turn.tsx')).toContain('bubbleLaunch');
    expect(read('src/theme/motion.ts')).toContain("SPRING.bounce");
  });

  it('uses bounce nowhere except the send and the low-balance flinch', () => {
    const users = sources
      .filter(s => s.body.includes("'bounce'"))
      .map(s => s.file)
      .sort();
    /*
     * The flinch is the moment scarcity is felt; the send is the moment a token
     * is spent. Both are the same event from two ends, which is why they share
     * the one spring that overshoots.
     *
     * The completion mark joined them on 2026-08-26. The reference flow resolves
     * it with `.bouncy(duration: 1)`, and it is the one moment in the product
     * that is allowed to celebrate: a rule reserving the overshoot for a sent
     * message while denying it to "you're in" would enforce the letter of the
     * restraint against its point. It appears once, for one second, at the end
     * of one flow. Everything else still uses snap or smooth.
     *
     * TactileCTA joined on 2026-08-31 (Option B, user-approved): the release of
     * an *invitational* CTA — the first-move pills and the SP hero — overshoots
     * once as the "tactile pop". It is the same argument as the completion mark:
     * these are the product's few celebratory beats, and the pop is what makes
     * them feel worth tapping. It is reserved for TactileCTA, never the
     * workhorse ink Button, so the overshoot keeps meaning something.
     *
     * CodeField joined on 2026-09-02: a correct verification code is a
     * celebratory beat by exactly the completion-mark argument — the boxes fill
     * in turn and the row pops once — and Telegram resolves its own success with
     * a low-bouncy scale spring (CodeNumberField.java:142-144). It fires once,
     * on a right code, at the end of the sign-in flow.
     *
     * ReactionStrip joined on 2026-09-03: the reaction bar scales in on an
     * overshoot, which is not a celebration but a clean-room match of Telegram's
     * own reaction bar (OvershootInterpolator(0.5),
     * ReactionsContainerLayout.java:1499). It fires once per open, on a menu that
     * asks to be noticed, and the overshoot is the specific thing being copied —
     * a non-overshoot spring here would be the departure, not the fidelity.
     */
    expect(users).toEqual([
      'src/components/CodeField.tsx',
      'src/components/CompletionRow.tsx',
      'src/components/ReactionStrip.tsx',
      'src/components/TactileCTA.tsx',
      'src/components/TokenCounter.tsx',
      'src/screens/ProviderDetailScreen.tsx',
    ]);
  });

  it('keeps the text-swap builders honouring reduce motion', () => {
    // `fadeSwap` and `fadeSwapFast` are consts rather than factories (nothing
    // varies, so there is nothing to build per call), which means the entrance
    // test below cannot see them: it looks for `export function` blocks
    // containing a `.delay`. Asserted here instead rather than left uncovered.
    const motion = read('src/theme/motion.ts');
    for (const name of ['fadeSwap', 'fadeSwapFast']) {
      const declaration = motion.slice(motion.indexOf(`export const ${name} =`));
      expect(declaration.slice(0, 200)).toMatch(/reduceMotion\(\s*ReduceMotion\.System,?\s*\)/);
    }
  });

  it('stops the carousel rather than short-circuiting it', () => {
    // Reduce-motion must be "do not start", not ReduceMotion.System on a
    // withRepeat(-1): short-circuited zero-length timings spin at frame rate.
    // Snap and word advance also share one paint (useLayoutEffect on tick) so
    // a drifted setInterval cannot paint the next highlight as a static ghost
    // in the focus slot before the slide.
    const column = read('src/components/WordColumn.tsx');
    expect(column).toContain('useReducedMotion()');
    expect(column).toContain('useLayoutEffect');
    expect(column).toContain('CAROUSEL_ENTER_OFFSET');
    expect(column).toMatch(/if \(reduced \|\| words\.length < 2\) \{\s*return;/);
    // Free-running withRepeat + setInterval was the ghost-word defect; the
    // slide must be armed from the tick layout effect, not a parallel loop.
    expect(column).toMatch(/shift\.value\s*=\s*CAROUSEL_ENTER_OFFSET/);
    expect(column).toMatch(/setInterval\(\s*\(\)\s*=>\s*setTick/);
  });

  it('drives the new surfaces through the shared builders', () => {
    // Nothing in this change writes its own physics. The screens ask for a named
    // builder and the builders are the only place a duration appears.
    expect(read('src/components/Button.tsx')).toContain('fadeSwapFast');
  });

  it('exposes a timed press-ramp builder, not a spring', () => {
    // Rule (motion-system.md 2026-09-06): a spring where a finger's velocity is
    // being continued; a timed curve where it is not. A tap has no accumulated
    // velocity, so pressIn uses withTiming, not withSpring.
    const motion = read('src/theme/motion.ts');
    expect(motion).toContain('export function pressIn(');
    const start = motion.indexOf('export function pressIn(');
    const block = motion.slice(start, start + 300);
    expect(block).toContain('withTiming');
    expect(block).not.toContain('withSpring');
    expect(block).toContain('DURATION.pressRamp');
  });

  it('exposes a transition-lock primitive for W5 deferral', () => {
    // W5 #6 gates realtime inserts, image fetches and Avatar loads on this;
    // the five call sites are wired there. Only the primitive is built here.
    const motion = read('src/theme/motion.ts');
    expect(motion).toContain('export const transitioning');
    expect(motion).toContain('export function onTransitionSettled(');
    expect(motion).toContain('export function setTransitioning(');
  });

  it('animates bubbleArrive on timed curves, not springs', () => {
    // Rule (motion-system.md 2026-09-06): a peer's message arriving from the
    // network has no gesture velocity — a spring would overshoot for no reason
    // the user caused. Re-cut to 120ms fade (listAdd) + 250ms keyboard-cubic
    // translate (medium1). Scale removed: a scale with no gesture behind it
    // reads as the animation shrinking the object, not as mass or direction.
    const motion = read('src/theme/motion.ts');
    const start = motion.indexOf('export function bubbleArrive(');
    const block = motion.slice(start, start + 800);
    expect(block).not.toContain('withSpring');
    expect(block).toContain('DURATION.listAdd');
    expect(block).toContain('KEYBOARD_CUBIC');
    expect(block).toContain('M3.duration.medium1');
    // The fade is the accessible fallback and must always run.
    expect(block).toContain('ReduceMotion.Never');
    // The translate collapses under reduce-motion.
    expect(block).toContain('ReduceMotion.System');
  });

  it('honours the OS reduce-motion setting on every transition builder', () => {
    /*
     * "Reduced motion → fades only" is a split policy, not a blanket off switch:
     * an opacity animation is the ACCESSIBLE fallback and must still run
     * (`ReduceMotion.Never`), while a translate or scale must collapse to nothing
     * (`ReduceMotion.System`). So a builder that moves something is checked for
     * both, and a builder that only fades is checked for `Never`.
     *
     * Every exported transition builder — the `screen*`/`menu*`/`row*` worklets
     * and the `topLevel*`/`fadeSwap*` consts — is inspected on its own, rather
     * than counting occurrences against a comment that mentions the call
     * (which is a test grading prose).
     */
    const motion = stripComments(read('src/theme/motion.ts'));
    /*
     * Bounded by the NEXT top-level export, not by a magic character count. It
     * was `start + 700`, which grades position rather than content: adding a
     * `requestAnimationFrame` wrapper inside `useScreenEnter` pushed its
     * `withTiming` past the window and failed a gate about accessibility with a
     * change that had nothing to do with it.
     */
    const bodyOf = (name: string): string => {
      const start = motion.indexOf(`export function ${name}(`);
      expect(start).toBeGreaterThan(-1);
      const next = motion.indexOf('\nexport ', start + 1);
      return motion.slice(start, next === -1 ? undefined : next);
    };
    const spatialBuilders = ['useScreenEnter', 'screenOut', 'menuIn', 'rowIn'];
    for (const name of spatialBuilders) {
      // The fade is the fallback (Never); the movement collapses (System, via springTo).
      expect(bodyOf(name)).toContain('ReduceMotion.Never');
    }
    // springTo threads ReduceMotion.System into every spring it builds, which is
    // the transform channel of the spatial builders above.
    const springTo = motion.slice(motion.indexOf('export function springTo'));
    expect(springTo.slice(0, 400)).toContain('ReduceMotion.System');

    // The pure-fade builders must always run their fade.
    for (const name of ['topLevelIn', 'topLevelOut', 'menuOut']) {
      const decl = motion.slice(motion.indexOf(`export const ${name} =`));
      expect(decl.slice(0, 220)).toContain('ReduceMotion.Never');
    }
  });
});

describe('accessibility budget', () => {
  it('holds AAA for body text in both modes', () => {
    expect(contrast(LIGHT.color.text.primary, LIGHT.color.bg.base)).toBeGreaterThanOrEqual(7);
    expect(contrast(DARK.color.text.primary, DARK.color.bg.base)).toBeGreaterThanOrEqual(7);
  });

  /**
   * AA, not AAA, and this is a deliberate loosening with a reason.
   *
   * The old palette hit AAA on secondary text by making it nearly black, which
   * is why timestamps and previews used to compete with the names above them.
   * 6.2:1 is comfortably past AA at every size we use it, and the hierarchy it
   * buys is worth more than the last 0.8, but it is still asserted, because this
   * exact token shipped at 3.13:1 once and broke AA outright.
   */
  it('holds AA for secondary text in both modes', () => {
    expect(contrast(LIGHT.color.text.secondary, LIGHT.color.bg.base)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK.color.text.secondary, DARK.color.bg.base)).toBeGreaterThanOrEqual(4.5);
  });

  it('holds AA for the accent count on its tint', () => {
    expect(contrast(LIGHT.color.text.accent, LIGHT.color.bg.accentTint)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK.color.text.accent, DARK.color.bg.accentTint)).toBeGreaterThanOrEqual(4.5);
  });

  /**
   * The single most important assertion in this file.
   *
   * `bg.accent` is the bright coral and measures 3.4:1 against white, fine for
   * a glyph, a fail for a label. `bg.accentStrong` is the step that carries
   * text. Every message the member has ever sent sits on the second one, so a
   * merge that swaps them would put the entire transcript below AA, and it would
   * look *better* to whoever made the change.
   */
  it('keeps message text legible on the accent bubble', () => {
    expect(contrast(LIGHT.color.text.onAccent, LIGHT.color.bg.accentStrong)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK.color.text.onAccent, DARK.color.bg.accentStrong)).toBeGreaterThanOrEqual(4.5);
  });

  it('records that the bright accent cannot carry text', () => {
    // Asserted as a fact, so nobody "fixes" the two-step accent by collapsing it.
    expect(contrast('#FFFFFF', LIGHT.color.bg.accent)).toBeLessThan(4.5);
  });

  it('keeps the send glyph legible on its fill', () => {
    // A UI glyph needs 3:1, not 4.5:1, it carries no text.
    expect(contrast(LIGHT.color.text.onAccent, LIGHT.color.bg.accentStrong)).toBeGreaterThanOrEqual(3);
  });

  it('keeps primary button text legible on the ink fill', () => {
    expect(contrast(LIGHT.color.text.onInverse, LIGHT.color.bg.inverse)).toBeGreaterThanOrEqual(7);
    expect(contrast(DARK.color.text.onInverse, DARK.color.bg.inverse)).toBeGreaterThanOrEqual(7);
  });

  it('keeps the calm band and the token chip readable', () => {
    expect(contrast(LIGHT.color.text.positive, LIGHT.color.bg.positive)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK.color.text.positive, DARK.color.bg.positive)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(LIGHT.color.text.token, LIGHT.color.bg.token)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK.color.text.token, DARK.color.bg.token)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(LIGHT.color.text.onTokenStrong, LIGHT.color.bg.tokenHealthy)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(LIGHT.color.text.onTokenStrong, LIGHT.color.bg.tokenCritical)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrast(DARK.color.text.onTokenStrong, DARK.color.bg.tokenHealthy)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(DARK.color.text.onTokenStrong, DARK.color.bg.tokenCritical)).toBeGreaterThanOrEqual(4.5);
  });

  it('makes the presence dot visible as a shape, not just as a colour', () => {
    // A dot has no text to fall back on, so it needs the 3:1 non-text minimum
    // against the page. The softer sage this replaced measured 2.2:1.
    expect(contrast(LIGHT.color.state.available, LIGHT.color.bg.base)).toBeGreaterThanOrEqual(3);
    expect(contrast(DARK.color.state.available, DARK.color.bg.base)).toBeGreaterThanOrEqual(3);
  });

  it('keeps danger distinguishable from the accent, not just from the page', () => {
    // Destructive and brand were both reds once. If they are within a hair of
    // each other, "Block" and "Send" are the same signal.
    expect(contrast(LIGHT.color.state.danger, LIGHT.color.bg.base)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(LIGHT.color.state.danger, LIGHT.color.bg.accent)).toBeGreaterThanOrEqual(2);
  });
});

describe('accent budget is enforced in code, not just documented', () => {
  const componentSources = readdirSync(join(ROOT, 'src/components'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => ({ file: f, body: read(`src/components/${f}`) }));
  const screenSources = readdirSync(join(ROOT, 'src/screens'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => ({ file: f, body: read(`src/screens/${f}`) }));

  it('uses the coral in only the permitted places', () => {
    const users = componentSources
      .concat(screenSources)
      .filter(s => /color\.(bg|border|text)\.accent/.test(s.body))
      .map(s => s.file)
      .sort();
    // Actions and states only, which is the rule that separates friendly from
    // flirty:
    //   Avatar      , the warm wash on *your* mark, never a stranger's
    //   Chip        , at most one warm starter per screen
    //   WordColumn  , the glyph beside the highlighted word. It marks WHICH word
    //                   is active, which is a state rather than an ornament, and
    //                   it is the only thing distinguishing the live row from
    //                   the four dimmed ones besides opacity
    //   EmptyMark   , the warm one of the two bubbles on an empty state. Same
    //                   wash and same argument as Avatar's `tone="warm"`, which
    //                   is where this mark's colour came from: it marks *your*
    //                   side of a conversation that has not started yet. The
    //                   other bubble is neutral precisely so the pair reads as
    //                   two people rather than as a decorative shape
    //   ProviderHomeScreen, the same count, for a member waiting on a reply
    //   TabBar      , the active destination's glyph and label. Added with the
    //                   two-tab bar, and it is a state rather than a decoration:
    //                   the colour IS which of the two lists you are looking at,
    //                   and it is the only thing distinguishing them, since both
    //                   tabs are otherwise a grey glyph over a grey label. Note
    //                   the glyph takes `bg/accent` and the label `text/accent`,
    //                   which is deliberate and not an oversight: the bright
    //                   coral measures 3.44:1, fine under a 2pt glyph stroke at
    //                   the 3:1 non-text minimum and a failure under 12pt text
    //   ThreadBubble, the unread count. This is the same accent that used to be
    //                   listed against InboxScreen: the badge did not change, it
    //                   moved, when the inbox row was extracted into a bubble.
    //                   InboxScreen has no accent of its own any more
    //   SendButton  , the fill and the ring
    //   OnboardingStep: the active checklist row. Replaces the unused Stepper.
    //   Sheet       , the Cancel and Done actions in the sheet's own bar. Added
    //                   by the iOS pass and it is the clearest case on this list:
    //                   an iOS bar action is tintColor *text* with no fill and no
    //                   border, so the colour is the entire affordance. The
    //                   alternative was the full-width dismiss Button every sheet
    //                   used to end with, which is the Material idiom this pass
    //                   exists to remove
    //   Toggle      , the track when on. A control in a colour that appears
    //                   nowhere else reads as a different system, which is
    //                   precisely how the stock Android teal looked
    //   Turn        , the member's own bubble
    //   TypingIndicator, the three dots
    //   TokenCounter is out of the coral budget: wallet tones use tokenHealthy /
    //   token / tokenCritical, not accentTint.
    //
    // Nothing here is a page, a header, a divider or a provider's avatar. This
    // assertion exists to force the argument to be made, not to forbid it.
    expect(users).toEqual([
      'Avatar.tsx',
      /*
       * M3 Badge — the unread count pill. A state signal ("you have unread
       * messages"), exactly what the accent budget reserves the coral for.
       * Previously the coral pill was hand-rolled in ChatsListScreen; Badge
       * centralises it, so ChatsListScreen no longer appears in this list.
       */
      'Badge.tsx',
      /*
       * The call surfaces (gated, ADR-0019). The warm field IS the call
       * background — same class as the bloom — built from the accent tokens; the
       * accept button is sage, the end/decline button state/danger.
       */
      'CallScreen.tsx',
      /*
       * The talk-time meter's Recharge CTA and its live dot (ADR-0019 made chat
       * per-minute). The Recharge button is an action and the dot is a live-state
       * signal — the two things the budget reserves the coral for — and the low
       * variant reuses the same token-tint the balance pill flinches to.
       */
      'ChatScreen.tsx',
      /*
       * The chat wallpaper's blush wash uses bg.accentTint — the softest tint,
       * reserved for warm atmospheric surfaces (the same token behind Avatar's
       * warm mark). It gives the transcript its requested pink hue (user
       * 2026-08-31). An atmospheric field, same class as the hero surfaces, laid
       * UNDER the bubbles as ambience — not chrome, a header or a divider.
       */
      'ChatWallpaper.tsx',
      // ChatsListScreen.tsx no longer has a hand-rolled accent pill; Badge owns it.
      'Chip.tsx',
      /*
       * The completed mark. Green is the source's colour and appears nowhere in
       * this palette; `state/positive` is a background tint for a positive
       * surface, not a foreground mark. The accent is what this app uses to mean
       * "this is the live thing", which is exactly what a resolved completion is
       * — and it appears once, for one second, at the end of one flow.
       */
      'CompletionRow.tsx',
      // The composer's send disc. The coral media "+" that used to justify this
      // entry alongside it is gone with the media Sheet — the attach surface is
      // now a docked panel of neutral tiles (AttachPanel.tsx), so the send
      // button is the single accent on the bar again.
      'Composer.tsx',
      /*
       * The emoji picker's selected category tab. The same M3 navigation
       * indicator FloatingToolbar already argues for, one level down: a tonal
       * accent-tint pill marking which of nine destinations you are currently
       * in. A "you are here" state, not decoration — and the only accent in the
       * surface, since the grid itself is the user's own glyphs.
       */
      'EmojiPicker.tsx',
      'EmptyMark.tsx',
      // First-message pills: the one warm starter, same Chip accent rule.
      'FirstMovePills.tsx',
      /*
       * The bottom bar's active tab (FloatingToolbar). It went coral → black slab
       * → grey box, and both read badly on device (Amit, 2026-08-27). The selected
       * destination is now a soft accent-tint pill with a coral filled glyph — the
       * "you are here" signal, which is a state, exactly what the budget reserves
       * the coral for. An icon-only tab bar (iMessage/Telegram) colours its chosen
       * tab; this is that.
       */
      'FloatingToolbar.tsx',
      /*
       * v13 Home. Two accent uses, both states/actions: the featured hero's warm
       * field (the one designed coral surface on the screen, same class as the
       * bloom) and the unread ring + count on a rail face. Not a page, header or
       * a stranger's avatar.
       */
      'HomeScreen.tsx',
      /*
       * First-Home tour "Next" is the one action on the tooltip — same role as
       * a sheet bar action.
       */
      'HomeTour.tsx',
      /*
       * The circular M3 wait indicator. A wait is a live STATE — the same class
       * as TypingIndicator's dots, which the budget already permits — so drawing
       * the active indicator in the brand accent is one meaning in one place,
       * not decoration (Amit, 2026-09-02: loaders follow the brand token). The
       * default colour lives here; callers over a coloured surface still pass an
       * explicit colour (Button uses its label colour).
       */
      'LoadingIndicator.tsx',
      /*
       * Added with the Fuse translation, and it earns its place rather than
       * widening the budget by accident: the coral here is the ACTIVE step's
       * icon, and it is the only thing on the checklist that distinguishes the
       * question being asked from the ones already answered. Every other row is
       * grey. That is precisely the job the budget exists to reserve the accent
       * for — one meaning, one place, at a moment where it is the whole signal.
       */
      'OnboardingStep.tsx',
      /*
       * UPI chooser processing spinner uses text.accent; the success card is
       * mint (bg/positive), not coral.
       */
      'PaymentSheet.tsx',
      /*
       * PolicyGateScreen: the tappable "Read full document" link uses the
       * accent as a navigational action affordance — the same role the coral
       * plays on call-to-action links throughout the design system.
       */
      /*
       * The permissions gate (ADR-0026): only the "Open Settings" link on a
       * permanently denied row — an action, the same class as PolicyGate's
       * document link. The permission glyph discs are deliberately neutral
       * (bg/sunken, text/secondary): they name the permission, they are not a
       * state, and three coral discs would have read as decoration.
       */
      'PermissionsScreen.tsx',
      'PolicyGateScreen.tsx',
      /*
       * Profile setup gate. text.accent on the Terms and Privacy inline links
       * only — navigational affordances, same role as PolicyGateScreen.
       */
      'ProfileSetupScreen.tsx',
      /*
       * The linear M3 wait bar, paired with LoadingIndicator — same brand-state
       * argument. Media-upload bars pass an explicit onAccent colour; the coral
       * here is only the default.
       */
      'ProgressBar.tsx',
      /*
       * Provider onboarding (verify → profile → done). Same accent argument as
       * ProfileSetupScreen, its member twin: the verify emphasis, the selected
       * avatar ring (a state), and the completion check (the app's onboarding
       * completion language, like CompletionRow). Actions and states, not
       * ornament.
       */
      'ProviderApplicationScreen.tsx',
      /*
       * The v13 provider profile. The coral is the primary Call action and the
       * favourite-when-set, plus the hero's warm field — actions and a live
       * state, the priced entry points to a conversation.
       */
      'ProviderDetailScreen.tsx',
      'ProviderHomeScreen.tsx',
      /*
       * Recharge (v10 layout, ADR-0019). The coral is the selected amount card,
       * the daily-credit strip and the payment icon — a selection state and the
       * one action on the screen, which is exactly what the budget reserves it
       * for. The dark balance card is bg/inverse, not accent.
       */
      'RechargeScreen.tsx',
      'SendButton.tsx',
      // The Settings footer wordmark is the brand mark in the brand colour (#9),
      // and "Rate us" — a brand signature and an action, not chrome.
      'SettingsSheet.tsx',
      'Sheet.tsx',
      /*
       * The first-visit home spotlight. Two accent uses, both sanctioned: the
       * "Say hi" CTA fill is the one action on the card, and the no-photo
       * fallback is a warm atmospheric field (same class as the Home featured
       * hero and the call background). Not a page, header, divider or a
       * stranger's list avatar.
       */
      'SpotlightCard.tsx',
      'ThreadBubble.tsx',
      'Toggle.tsx',
      /*
       * `Turn.tsx` LEFT this list on 2026-09-08, and that is the change worth
       * noting rather than just deleting a line: the chat bubbles used to spend
       * the accent budget (outgoing fill = bg/accentStrong, and every metadata
       * colour derived from text/onAccent). They now read the `bubble/*` group,
       * so the single largest consumer of the accent in the app no longer
       * consumes it at all. The budget this test enforces got cheaper.
       */
      'TypingIndicator.tsx',
      'WordColumn.tsx',
    ]);
  });

  it('never uses the accent for a page background', () => {
    for (const s of componentSources.concat(screenSources)) {
      const page = /backgroundColor:\s*TOKENS\.color\.bg\.accent\w*,[\s\S]{0,80}(root|host:)/;
      expect(s.body).not.toMatch(page);
    }
  });

  it('has no gradients or glow outside the bloom field', () => {
    /*
     * This rule used to be absolute, and the reversal is deliberate rather than
     * a leak. "Surfaces are flat by decision" held while the system was
     * semantic; the entry surfaces now use an atmospheric field, which is three
     * radial gradients by construction.
     *
     * The rule survives everywhere else, which is the point of scoping it: a
     * gradient on a list row or a bubble is still the regression this was
     * written to catch. Exemptions are NAMED rather than pattern-matched so a
     * third gradient component cannot appear quietly.
     *
     * `WordColumn` was added 2026-08-26 and is a different kind of exemption
     * from `BloomField`. Its gradients are not decoration: the reference masks
     * the carousel with a LinearGradient running clear -> black -> black -> clear,
     * so the outer rows dissolve rather than ending at a hard edge. React Native
     * cannot mask a subtree without a dependency and `react-native-svg` is banned
     * here, so the mask is painted as two page-coloured scrims instead. They are
     * gradients that exist to REMOVE something, which is the opposite of the
     * decorative sheen this rule was written against.
     */
    const EXEMPT = new Set([
      'BloomField.tsx',
      'WordColumn.tsx',
      // v13 hero surfaces: the featured card on Home and the profile hero on
      // Provider detail are warm gradient fields where v13 places a photo. Same
      // class of exemption as BloomField — a designed atmospheric surface, not a
      // sheen on a list row — and built from the accent tokens, not raw hex.
      'HomeScreen.tsx',
      'ProviderDetailScreen.tsx',
      // The call background is a warm field (gated, ADR-0019), same exemption
      // class as the hero surfaces, built from accent tokens not raw hex.
      'CallScreen.tsx',
      // The recharge balance banner (#13) is a warm gradient field in the same
      // language as the onboarding/hero surfaces, built from the accent tokens.
      'RechargeScreen.tsx',
      // The first-visit spotlight card: a gradient bottom-scrim carries white
      // copy over any photo, and the no-photo fallback is a warm field — same
      // atmospheric-surface exemption class as the hero surfaces above.
      'SpotlightCard.tsx',
    ]);
    for (const s of componentSources.concat(screenSources)) {
      if (EXEMPT.has(s.file.split('/').pop() ?? '')) {
        continue;
      }
      expect(s.body).not.toMatch(/gradient/i);
      expect(s.body).not.toMatch(/accentGlow/);
    }
  });

  it('leaves the provider directory monochrome', () => {
    // The one screen where a member compares strangers. Tinting any of them is a
    // recommendation the product has not earned the right to make.
    expect(read('src/components/ProviderRow.tsx')).not.toMatch(/accent/);
  });
});

/**
 * iOS conformance, as far as it can be asserted from source.
 *
 * This block is the record of a reversal, so it says what changed and why rather
 * than only asserting the new numbers.
 *
 * The app was a deliberate Material 3 implementation and the tests below used to
 * defend M3's answers to these questions: a 28dp sheet corner, a 15pt nav title,
 * a type ladder that tightened tracking at every size. iOS answers the same
 * questions differently and the two cannot both be satisfied by one number, so
 * the *surface* language is now iOS: sheet corners, page colours, the type
 * ladder, list separators, dates and casing.
 *
 * What did NOT move is in `Material 3 interaction survives` below, and that
 * split is the whole decision: the numbers a user reads are iOS, the numbers a
 * finger feels are still M3 on both platforms, with an opt-in iOS highlight for
 * the surfaces where a scaling row is the loudest tell.
 */
describe('iOS conformance', () => {
  const { radius, typography, color } = LIGHT;

  it('uses Material 3 Paper bottom-sheet corners', () => {
    // 28 is Material 3's specified bottom-sheet corner — M3 Paper is the product
    // choice for every overlay (user 2026-08-30).
    expect(radius.sheet).toBe(28);
    expect(read('src/components/Sheet.tsx')).toContain('TOKENS.radius.sheet');
    expect(read('src/components/Sheet.tsx')).toContain('TOKENS.typography.titleLargeEmphasized');
  });

  it('has a field radius for the iOS filled control', () => {
    // Search fields, text fields, OTP segments and filled buttons are all 10 on
    // iOS. There was no token for it, so every field picked radius.md (16) or
    // radius.lg (20) and read as a Material outlined text field.
    expect(radius.field).toBe(10);
    expect(radius.alert).toBe(14);
  });

  it('carries the M3 title/body/label roles the app consumes', () => {
    // The M3 scale (ADR-0024) supersedes the iOS ladder. The nav inline title,
    // row name and filled-button label are titleMedium emphasized — 16 Bold, the
    // emphasized twin of M3 titleMedium — reached by the old `headline` name.
    expect(typography.titleMediumEmphasized.fontSize).toBe(16);
    expect(typography.titleMediumEmphasized.fontFamily).toBe('Geist-Bold');
    // Plain M3 titleMedium stays Medium weight (Geist-SemiBold).
    expect(typography.titleMedium.fontFamily).toBe('Geist-SemiBold');
    // Message text is M3 bodyLarge, 16/24.
    expect(typography.bodyLarge.fontSize).toBe(16);
    // List previews and timestamps are M3 bodyMedium, 14.
    expect(typography.bodyMedium.fontSize).toBe(14);
  });

  it('tracks the M3 way: display tight, body and label open', () => {
    // M3 inverts the iOS ladder's direction — a large display is set solid with
    // slightly negative tracking, while 16pt body and the small labels open up
    // with positive tracking for legibility.
    expect(typography.displayLarge.letterSpacing).toBeLessThan(0);
    expect(typography.bodyLarge.letterSpacing).toBeGreaterThan(0);
    expect(typography.labelSmall.letterSpacing).toBeGreaterThan(0);
  });

  it('caps only the large roles for accessibility font scaling', () => {
    // M3 large-font support: display/headline cap at 1.3, titles at 1.5, a brand
    // wordmark never scales (1.0), and reading text — body, label — plus the
    // balance numerals are uncapped so a 200% setting still enlarges them.
    const cap = LIGHT.fontScaleCap as Record<string, number>;
    expect(cap.displayLarge).toBe(1.3);
    expect(cap.headlineSmallEmphasized).toBe(1.3);
    expect(cap.titleMediumEmphasized).toBe(1.5);
    expect(cap.wordmarkLarge).toBe(1.0);
    for (const role of ['bodyLarge', 'bodyMedium', 'labelLarge', 'numeralDisplay']) {
      expect(cap[role]).toBeUndefined();
    }
  });

  it('binds the decorative face block to real bundled families', () => {
    // The 6 glyphs that borrow a weight name it through `face` rather than a text
    // role. Every family here must also be one a typography style names, so the
    // face-bundling test already covers the files.
    const families = new Set(
      Object.values(LIGHT.typography).map(s => s.fontFamily),
    );
    for (const fam of Object.values(LIGHT.face)) {
      expect(families).toContain(fam);
    }
  });

  it('has both page colours iOS ships, not just one', () => {
    // A plain list sits on systemBackground and an inset-grouped form sits on
    // systemGroupedBackground. With only the first, six form fields on
    // ProviderApplicationScreen had no visible box at all in light mode.
    expect(color.bg.grouped).not.toBe(color.bg.base);
    expect(color.bg.selected).not.toBe(color.bg.base);
  });

  it('uses the squircle wherever a surface is rounded', () => {
    // borderCurve is iOS-only and a no-op on Android, so it is free. It is also
    // the cheapest single change that makes a rounded rectangle read as iPhone,
    // because every one of them was a circular arc before this.
    const curved = ['src/components', 'src/screens']
      .flatMap(dir =>
        readdirSync(join(ROOT, dir))
          .filter(f => f.endsWith('.tsx'))
          .map(f => read(`${dir}/${f}`)),
      )
      .filter(body => body.includes("borderCurve: 'continuous'"));
    expect(curved.length).toBeGreaterThan(5);
  });
});

/**
 * The half of Material 3 that survived the iOS pass, and why.
 *
 * `interaction.minTarget` is 48, which exceeds iOS's 44 minimum, so one number
 * satisfies both platforms and there was never a reason to move it. The
 * state-layer opacities stay because `Pressable` still drives the M3 press model
 * by default and only switches to the iOS full-bleed cell highlight where a
 * caller asks for it, a row, a table cell, a star. The switch anatomy stays
 * because a toggle's dp is not the app's language: it is one control, it is
 * scheduled to become an inset-grouped switch row, and moving it now would be
 * churn on the one file the iOS pass has no user-visible argument about.
 *
 * Backward compatibility comes from the same decision that makes this testable:
 * every control is drawn by us from these tokens, so it renders identically from
 * minSdk 24 to the current platform.
 */
describe('Material 3 interaction survives', () => {
  const { interaction, toggle } = LIGHT;

  it('uses M3 state-layer opacities', () => {
    expect(interaction.stateHover).toBeCloseTo(0.08, 3);
    expect(interaction.stateFocus).toBeCloseTo(0.1, 3);
    expect(interaction.statePressed).toBeCloseTo(0.1, 3);
    expect(interaction.stateDragged).toBeCloseTo(0.16, 3);
  });

  it('keeps a target that satisfies both platforms', () => {
    // 48 is M3's minimum and it clears iOS's 44, so there is one number here
    // rather than a Platform.select.
    expect(interaction.minTarget).toBe(48);
    expect(interaction.minTarget).toBeGreaterThanOrEqual(44);
  });

  it('matches the M3 switch anatomy to the dp', () => {
    expect(toggle.trackWidth).toBe(52);
    expect(toggle.trackHeight).toBe(32);
    expect(toggle.thumbOff).toBe(16);
    expect(toggle.thumbOn).toBe(24);
    expect(toggle.thumbPressed).toBe(28);
    // The growth is the whole point: off < on < held.
    expect(toggle.thumbOff).toBeLessThan(toggle.thumbOn);
    expect(toggle.thumbOn).toBeLessThan(toggle.thumbPressed);
  });

  it('offers the iOS cell highlight as an opt-in, not a fork', () => {
    // Two press models in one primitive rather than two primitives: a row and a
    // table cell ask for 'ios' and get a full-bleed fill with no scale, and
    // everything else keeps the state layer.
    const pressable = read('src/components/Pressable.tsx');
    expect(pressable).toContain("highlight");
    expect(pressable).toContain('bg.selected');
  });

  it('draws every control itself, no platform widgets left', () => {
    // A platform widget is the one thing that cannot be backward compatible:
    // it renders whatever that Android version's framework draws, and on API 31+
    // Material You would recolour it from the user's wallpaper. RN's Switch was
    // rendering Android's stock teal here.
    const sources = ['src/components', 'src/screens'].flatMap(dir =>
      readdirSync(join(ROOT, dir))
        .filter(f => f.endsWith('.tsx'))
        .map(f => ({ file: f, body: withoutJsxComments(read(`${dir}/${f}`)) })),
    );
    // Checked at the *import*, not the tag: `<Button` matches our own Button
    // too, and an assertion that cannot tell them apart is worse than none.
    for (const s of sources) {
      const rnImport = s.body.match(/import \{([^}]*)\} from 'react-native';/)?.[1] ?? '';
      const imported = rnImport.split(',').map(n => n.trim());
      for (const widget of ['Switch', 'Button', 'Alert', 'ToastAndroid', 'ProgressBarAndroid']) {
        expect(imported).not.toContain(widget);
      }
      expect(s.body).not.toMatch(/Alert\.alert/);
    }
  });

  it('gives every pressable surface a state layer', () => {
    // Asserted on the primitive rather than per caller: everything interactive
    // goes through it, which is the reason it exists.
    const pressable = read('src/components/Pressable.tsx');
    expect(pressable).toContain('INTERACTION.statePressed');
    expect(pressable).toContain("overflow: 'hidden'");
  });

  it('states the minSdk this all has to work on', () => {
    // 24. Nothing here depends on a platform API, so this is a floor rather than
    // a constraint, but it should be a known floor.
    expect(read('android/build.gradle')).toMatch(/minSdkVersion\s*=\s*24/);
  });
});

/** JSX comments quote the things these assertions forbid. */
function withoutJsxComments(source: string): string {
  return source.replace(/\{?\/\*[\s\S]*?\*\/\}?/g, '').replace(/^\s*\/\/.*$/gm, '');
}

/**
 * The light/dark boundary, enforced rather than described.
 *
 * Only `color` is reactive, and that is not a shortcut, `space`, `radius`,
 * `typography` and `motion` are byte-identical across the two modes (asserted
 * above), so making them reactive would re-render the app to hand every
 * component the same numbers back.
 *
 * The failure mode this guards is silent and ugly: one `TOKENS.color` left in a
 * component keeps rendering the *light* value forever, because the generated
 * `TOKENS` is `LIGHT`. The screen goes dark and one border stays pale, and
 * nothing anywhere fails.
 */
describe('light and dark', () => {
  const sources = ['src/components', 'src/screens'].flatMap(dir =>
    readdirSync(join(ROOT, dir))
      .filter(f => f.endsWith('.tsx'))
      .map(f => ({ file: `${dir}/${f}`, body: read(`${dir}/${f}`) })),
  );

  it('never reads a colour off the static token object outside the theme', () => {
    for (const s of sources) {
      expect(withoutJsxComments(s.body)).not.toMatch(/TOKENS\.color/);
    }
    expect(withoutJsxComments(read('App.tsx'))).not.toMatch(/TOKENS\.color/);
  });

  it('still reads the mode-independent scales statically', () => {
    // If this ever finds nothing, the migration went too far and every spacing
    // value is now paying for a context read.
    const staticReads = sources.filter(s => /TOKENS\.(space|radius|layout|typography)/.test(s.body));
    expect(staticReads.length).toBeGreaterThan(10);
  });

  it('builds every themed stylesheet through a module-scope factory', () => {
    for (const s of sources) {
      if (!s.body.includes('StyleSheet.create')) {
        continue;
      }
      /*
       * The invariant is about THEME values, not about the name of a constant.
       *
       * `const styles = StyleSheet.create` at module scope freezes whichever
       * theme was active when the bundle loaded, so any stylesheet that reads a
       * theme value must go through the factory. A stylesheet that reads none
       * cannot freeze anything, and `Spinner` is the case that proved the
       * distinction: it takes its colour as a prop precisely so a caller decides
       * it, and forcing it through `makeStyles(t)` would add a parameter it
       * ignores in order to satisfy a pattern rather than a rule.
       *
       * So: reading `t.` at module scope is the thing that is forbidden.
       */
      const readsTheme = /\bt\.(color|space|radius|elevation)/.test(s.body);
      if (!readsTheme) {
        // Nothing to freeze. Having a factory anyway is harmless, so this only
        // declines to require one; it does not forbid it.
        continue;
      }
      expect(s.body).not.toMatch(/^const styles = StyleSheet\.create/m);
      expect(s.body).toMatch(/^const makeStyles = \(_?t: Theme\)/m);
    }
  });

  it('memoises styles on theme identity rather than rebuilding per render', () => {
    const provider = read('src/theme/ThemeProvider.tsx');
    expect(provider).toContain('useMemo(() => makeStyles(theme), [makeStyles, theme])');
  });

  it('persists the choice and supports light, dark and system modes', () => {
    const provider = read('src/theme/ThemeProvider.tsx');
    expect(provider).toContain('companion.themeMode');
    expect(provider).toContain("Appearance.getColorScheme()");
    // `system` remains a first-class persisted choice even though the empty
    // context and fresh-install fallback now honestly default to Light.
    expect(provider).toContain("export type ThemeMode = 'light' | 'dark' | 'system'");
    expect(provider).toContain("stored === 'system'");
  });

  /**
   * Documented deviation from Android dark-theme recommendation.
   *
   * Android recommends defaulting to System so the app follows the device
   * setting immediately. Pappal departs: fresh-install users get Light mode.
   * Dark and System remain fully supported once stored in MMKV.
   *
   * Audit: docs/android-audit.md dark-theme section.
   * Platform doc: developer.android.com/develop/ui/views/theming/darktheme
   */
  it('defaults to light on first install (documented deviation from Android System recommendation)', () => {
    const provider = read('src/theme/ThemeProvider.tsx');
    // The fallback when no stored mode exists must be 'light', not 'system'.
    // 'system' still appears as a valid stored/context value above this line.
    expect(provider).toMatch(/:\s*'light'.*fresh.install/s);
    // System mode handler (Appearance listener) must still be present so a
    // stored 'system' choice continues to work on upgrade.
    expect(provider).toContain("Appearance.addChangeListener");
  });

  it('flips the status bar with the mode', () => {
    // Edge-to-edge means Android draws the clock over our background; a light
    // bar on a light page is an invisible status bar, not a subtle one.
    expect(read('App.tsx')).toContain("isDark ? 'light-content' : 'dark-content'");
  });

  it('covers the change with a dissolve rather than cutting', () => {
    expect(read('src/theme/ThemeProvider.tsx')).toContain('Dissolve');
    expect(read('src/theme/ThemeProvider.tsx')).toContain('pointerEvents="none"');
  });
});

/**
 * chat-visuals: static / mechanical assertions for the six chat-visual changes
 * shipped in the 2026-09 pass. Each one catches a wiring failure that typechecks.
 */
describe('chat-visuals: SpotlightCard is a bottom-anchored M3 sheet', () => {
  const card = read('src/components/SpotlightCard.tsx');

  it('anchors to the bottom, not the centre', () => {
    // justifyContent: flex-end is the one style that places a child at the
    // bottom of a flex container. Any other value means the sheet floats.
    expect(card).toContain("justifyContent: 'flex-end'");
  });

  it('uses full width, not a guttered width', () => {
    // The old card subtracted TOKENS.space['2xl'] * 2 gutters. A bottom sheet
    // is always full-width; a percentage width is wrong.
    expect(card).not.toMatch(/windowWidth\s*-\s*TOKENS/);
    expect(card).toContain("width: '100%'");
  });

  it('uses M3 sheet corners via TOKENS.radius.sheet', () => {
    expect(card).toContain('TOKENS.radius.sheet');
  });

  it('slides on the M3 sheet spring, not Modal animationType slide', () => {
    // animationType="slide" slides the whole window, dragging the scrim up as a
    // grey rectangle. The sheet alone slides — on `sheetIn`/`sheetOut`, the M3
    // spatialDefault spring, position only — while the window only fades.
    expect(card).toContain("animationType=\"fade\"");
    expect(card).toContain('sheetIn(');
    expect(card).toContain('sheetOut(');
    expect(card).not.toContain("animationType=\"slide\"");
  });

  it('has a drag-to-dismiss gesture with the token thresholds', () => {
    expect(card).toContain('GESTURE.dismissDistance');
    expect(card).toContain('GESTURE.dismissVelocity');
  });

  it('uses GestureHandlerRootView inside the Modal (Android separate window)', () => {
    expect(card).toContain('GestureHandlerRootView');
    expect(card).toContain('GestureDetector');
  });

  it('uses the dark M3 scrim token, not a hand-rolled dim', () => {
    expect(card).toContain('t.color.bg.scrim');
  });

  it('respects safe-area insets for the copy section bottom padding', () => {
    expect(card).toContain('useSafeAreaInsets');
    expect(card).toContain('sheetBottomPad');
  });

  it('lays the two actions out on one row at equal width', () => {
    // User 2026-09-01: side by side, not stacked. Equal width comes from the
    // flex slot on the pressable ROOT — a flex on TactileCTA's inner animated
    // view resolves against the pressable, not the row, and does nothing.
    expect(card).toContain('actions: {');
    expect(card).toMatch(/actions:\s*{[^}]*flexDirection:\s*'row'/);
    expect(card).toContain('containerStyle={styles.slot}');
    expect(card).toMatch(/slot:\s*{\s*flex:\s*1/);
    expect(card).toMatch(/notNowHit:\s*{\s*flex:\s*1/);
    // Neither action may re-introduce the stacked left-aligned shrink-wrap.
    expect(card).not.toContain("alignSelf: 'flex-start'");
  });
});

describe('chat-visuals: the chat wallpaper carries no hue in dark mode', () => {
  const wallpaper = read('src/components/ChatWallpaper.tsx');

  it('washes with the charcoal base in dark and the blush tint only in light', () => {
    // User 2026-09-01: no pink wash in dark mode. The dark JPG is an AMOLED
    // black, so the wash still runs — it lifts the sheet to bg.base charcoal
    // rather than leaving the transcript darker than the app around it.
    expect(wallpaper).toContain('isDark');
    expect(wallpaper).toMatch(/isDark\s*\n?\s*\?\s*{\s*backgroundColor:\s*theme\.color\.bg\.base/);
    expect(wallpaper).toMatch(/:\s*{\s*backgroundColor:\s*theme\.color\.bg\.accentTint/);
  });
});

describe('chat-visuals: typing indicator uses conveyor dots, not breathing', () => {
  const typing = read('src/components/TypingIndicator.tsx');
  const calling = read('src/components/CallingDots.tsx');

  it('imports ConveyorDots from CallingDots', () => {
    // One mechanic, not two. Typing and calling share the same periodic-row
    // conveyor; only the size and cadence differ.
    expect(typing).toContain("from './CallingDots'");
    expect(typing).toContain('ConveyorDots');
  });

  it('uses a slower cadence than calling (DURATION.slow vs DURATION.base)', () => {
    // Typing is patient; calling is urgent. The cadence difference is the signal.
    expect(typing).toContain('DURATION.slow');
    expect(typing).not.toContain('DURATION.base');
  });

  it('uses smaller geometry than calling (dot=3 vs 4, pitch=6 vs 8)', () => {
    expect(typing).toContain('dot={3}');
    expect(typing).toContain('pitch={6}');
  });

  it('still uses a token for the cadence, not a raw millisecond literal', () => {
    // The house rule: every timing lives in the token file.
    expect(typing).not.toMatch(/duration:\s*\d/);
    expect(typing).not.toMatch(/duration=\{\d/);
  });

  it('shows a static ellipsis on reduced motion', () => {
    expect(typing).toContain('useReducedMotion');
  });

  it('exports ConveyorDots from CallingDots.tsx as the shared primitive', () => {
    expect(calling).toContain('export function ConveyorDots');
    // The primitive uses the same mechanic: clipped window, linear translation.
    expect(calling).toContain("overflow: 'hidden'");
    expect(calling).toContain('Easing.linear');
    expect(calling).toContain('withTiming(pitch');
  });

  it('CallingDots original behavior is unchanged: 4dp dot, 8dp pitch, DURATION.base', () => {
    // The shared primitive is additive; CallingDotsView retains its own
    // constants so the calling reference is untouched.
    expect(calling).toContain('const PITCH = 8');
    expect(calling).toContain('const DOT = 4');
    expect(calling).toContain('DURATION.base');
    expect(calling).toContain("withTiming(PITCH");
  });
});

describe('chat-visuals: FirstMovePills host has no own pink strip', () => {
  const pills = read('src/components/FirstMovePills.tsx');

  it('does not set a backgroundColor on the host strip', () => {
    // The chat wallpaper carries the blush wash (ChatWallpaper.tsx,
    // bg.accentTint at 0.2 opacity). A second accentTint on the strip created a
    // bright pink band at the bottom of the transcript.
    // Comments stripped: the removed line is explained in a comment that would
    // satisfy a naive includes() check.
    const stripped = pills.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/strip[\s\S]{0,60}backgroundColor/);
  });

  it('still defines the strip style (pills need the padding)', () => {
    expect(pills).toContain('strip:');
    expect(pills).toContain('paddingHorizontal');
  });

  it('still references the accent (pill ripple color)', () => {
    // Accent is in the permitted list for first-move pills; removing the
    // background must not also drop the ripple.
    expect(pills).toMatch(/accent/);
  });
});

/**
 * recharge-theme: mechanical assertions for the recharge/payment changes
 * shipped in the 2026-09 pass.
 */
describe('recharge-theme: RechargeScreen is a compact non-scrolling M3 sheet', () => {
  const recharge = read('src/screens/RechargeScreen.tsx');

  it('hosts the interrupting flow on Sheet, not a full-page View', () => {
    expect(recharge).toContain("from '../components/Sheet'");
    expect(recharge).toContain('<Sheet');
  });

  it('has no inner ScrollView inside the sheet form', () => {
    // The sheet must fit its resting detent without scrolling.
    const formBlock = recharge.slice(recharge.indexOf('function RechargeSheetForm'));
    const endOfForm = formBlock.indexOf('\nfunction ');
    const formOnly = endOfForm > 0 ? formBlock.slice(0, endOfForm) : formBlock;
    expect(formOnly).not.toContain('<ScrollView');
  });

  it('uses radio semantics on pack cards', () => {
    // accessibilityRole="radio" + checked={selected} is the correct
    // pattern for a single-select group. TalkBack announces "₹300, radio
    // button, checked" instead of reading a stacked accessibilityLabel.
    expect(recharge).toContain('accessibilityRole="radio"');
    expect(recharge).toContain('checked={selected}');
  });

  it('preserves RechargeWalletPage as a full-page route', () => {
    expect(recharge).toContain('export function RechargeWalletPage');
    expect(recharge).toContain('testID="recharge-wallet"');
    // #6 (user 2026-09-02): pick an amount, one Pay button, then the Cashfree
    // sheet owns payment-method choice. The "Pay with" method block is gone.
    expect(recharge).not.toContain('Pay with');

    // The body scrolls UNDER a pinned Pay bar — not the page as a whole. "The
    // grid and the note fit a single screen" was true of one screen height; on
    // a 774dp window the note slid under the bar (2026-09-06). So: exactly one
    // ScrollView, wrapping the form, with the Pay bar a sibling outside it.
    const page = recharge.slice(recharge.indexOf('export function RechargeWalletPage'));
    const scrollAt = page.indexOf('<ScrollView');
    const formAt = page.indexOf('<RechargeForm');
    const payBarAt = page.indexOf('testID="recharge-wallet-pay"');
    const scrollEnd = page.indexOf('</ScrollView>');
    expect(scrollAt).toBeGreaterThan(-1);
    expect(page.indexOf('<ScrollView', scrollAt + 1)).toBe(-1);
    expect(formAt).toBeGreaterThan(scrollAt);
    expect(scrollEnd).toBeGreaterThan(formAt);
    expect(payBarAt).toBeGreaterThan(scrollEnd);
  });

  it('keeps the compact sheet host non-scrolling: it fits its detent or the detent grows', () => {
    // The paywall sheet has one job and no inner scroll view. When its content
    // outgrew the 72% cap the fix was the `large` detent, not a ScrollView —
    // a scrolling body under a sheet's pan gesture is a fight nobody wins.
    const sheetHost = recharge.slice(
      recharge.indexOf('export function RechargeScreen'),
      recharge.indexOf('export function RechargeWalletPage'),
    );
    expect(sheetHost).not.toContain('<ScrollView');
    expect(sheetHost).toContain('detents="large"');
  });
});

describe('recharge-theme: PaymentSheet uses M3 Paper sheet language throughout', () => {
  const payment = read('src/screens/PaymentSheet.tsx');

  it('has no BloomField in the success state', () => {
    // The previous success state placed an animated field inside a Sheet.
    // The M3 success card (bg/positive surface) replaces it.
    // Strip comments before checking: the migration rationale in comments
    // necessarily names what it replaced, but the import/usage must be gone.
    const stripped = payment.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/BloomField/);
    expect(stripped).not.toMatch(/BLOOM_PALETTES/);
  });

  it('success state uses the positive surface token', () => {
    expect(payment).toContain('t.color.bg.positive');
    expect(payment).toContain('t.color.text.positive');
  });

  it('uses radio semantics on the UPI method list', () => {
    // M3 list/selection: accessibilityRole="radio" + checked={on} prop.
    // The iOS grouped label "Google Pay, selected" is replaced by role + state,
    // which is the semantically correct representation for screen readers.
    expect(payment).toContain('accessibilityRole="radio"');
    expect(payment).toContain('checked={on}');
  });

  it('still imports CASHFREE_SANDBOX_CHECKOUT (Cashfree flow intact)', () => {
    expect(payment).toContain('CASHFREE_SANDBOX_CHECKOUT');
  });
});

describe('recharge-theme: SettingsSheet Appearance uses three-choice radio picker', () => {
  const settings = read('src/screens/SettingsSheet.tsx');

  it('has no binary Toggle for dark mode', () => {
    // The binary Toggle expressed only isDark (resolved value), hiding which of
    // light / dark / system the user actually chose. Three radio rows name each
    // choice explicitly.
    expect(settings).not.toContain("import { Toggle }");
    expect(settings).not.toContain('<Toggle');
  });

  it('offers Light, Dark and System as named options', () => {
    // The options are rendered from ['light', 'dark', 'system'] with
    // template testIDs. The three option values appear in the loop declaration;
    // the testID template string appears as a single expression rather than
    // three literals.
    expect(settings).toContain("'light', 'dark', 'system'");
    expect(settings).toMatch(/testID=\{`theme-\$\{option\}`\}/);
  });

  it('uses radio semantics on the appearance rows', () => {
    expect(settings).toContain('accessibilityRole="radio"');
    expect(settings).toContain('checked={on}');
  });
});

describe('dark theme: Telegram midnight-blue palette, and it still passes contrast', () => {
  /*
   * The dark palette follows Telegram Android's darkblue.attheme - the "midnight
   * blue" theme - read as FACTS and re-expressed in design/tokens.json (Amit,
   * 2026-09-06: "dark theme color palette and token exactly same as telegram").
   * It replaced a WhatsApp-charcoal palette (#0B141A / #111B21 / #E9EDEF).
   *
   * Values are pinned so a stray edit to tokens.json cannot quietly drift the
   * theme back, and every pinned value is ALSO contrast-checked: the palette is
   * Telegram's, the accessibility floor is ours. Where Telegram's own grey did
   * not clear AA on its own bubble colour (#7D8B99 on #232E3B is 3.95:1), the
   * grey was lifted by the smallest step that passes - +11 - rather than the
   * gate being lowered.
   */
  it('dark base and surface are Telegram windowBackgroundGray / windowBackgroundWhite', () => {
    expect(DARK.color.bg.base).toBe('#151E27');
    expect(DARK.color.bg.raised).toBe('#1D2733');
  });

  it('dark bubbles are Telegram chat_inBubble / chat_outBubble', () => {
    /*
     * MOVED, not changed (2026-09-08). The bubble fills now have tokens of
     * their own — `bubble/mine` and `bubble/theirs` — because light went to
     * WhatsApp and the bubbles could no longer borrow the accent and the sunken
     * surface. The DARK values are byte-identical to what those two tokens
     * resolved to before, on Amit's instruction: "dark mode looks okay right
     * now.. so dont change that token.. just branding colors". So dark did not
     * move a pixel; only its name did.
     *
     * bg/sunken is still asserted, because it still surfaces search fields and
     * disabled fills — it simply is not the peer bubble any more.
     */
    expect(DARK.color.bubble.theirs).toBe('#232E3B');
    expect(DARK.color.bubble.mine).toBe('#3E618A');
    expect(DARK.color.bg.sunken).toBe('#232E3B');
  });

  it('dark accent is WhatsApp green, and that is the one thing dark DID change', () => {
    /*
     * Amit, 2026-09-08: change the primary colour to WhatsApp, and keep dark's
     * surfaces as they are. Branding is exactly the part that crosses both
     * modes, so this is the deliberate exception to "do not change dark".
     *
     * --WDS-green-450 #21C063 is WhatsApp's dark interactive accent.
     * #25D366 is NOT it — WhatsApp's own design system consumes that only for
     * the brand mark and the activity indicator, so using it here would repeat
     * the mistake every stale third-party palette makes.
     *
     * Was Telegram blue #5FA3DE / #64B5EF.
     */
    expect(DARK.color.bg.accent).toBe('#21C063');
    expect(DARK.color.text.accent).toBe('#71EB85');
    // The retired brand green must not creep back in as the accent.
    expect(DARK.color.bg.accent).not.toBe('#25D366');
  });

  it('dark primary text is Telegram white, passes AAA on dark base', () => {
    expect(DARK.color.text.primary).toBe('#FFFFFF');
    expect(contrast(DARK.color.text.primary, DARK.color.bg.base)).toBeGreaterThanOrEqual(7);
  });

  it('dark secondary text passes AA on base, raised AND the peer bubble', () => {
    expect(DARK.color.text.secondary).toBe('#8896A4');
    for (const bg of [DARK.color.bg.base, DARK.color.bg.raised, DARK.color.bg.sunken]) {
      expect(contrast(DARK.color.text.secondary, bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('dark hairline separator passes the non-text minimum on dark base', () => {
    expect(DARK.color.border.hairline).toBe('#303C4A');
    expect(contrast(DARK.color.border.hairline, DARK.color.bg.base)).toBeGreaterThan(1.5);
  });

  it('dark inverse surface is Telegram chats_nameMessage, primary button passes AAA', () => {
    expect(DARK.color.bg.inverse).toBe('#E9EEF4');
    expect(contrast(DARK.color.text.onInverse, DARK.color.bg.inverse)).toBeGreaterThanOrEqual(7);
  });
});

describe("Pressable's android ripple capability", () => {
  it('exposes a token-backed ripple radius in the interaction block', () => {
    // 20dp: matches radius.lg and is the half-height of an M3 navigation indicator
    // pill (32dp tall), so the ink wave reads as belonging to the glyph slot
    // rather than flooding the full toolbar bar.
    expect(LIGHT.interaction.rippleRadius).toBe(20);
    // interaction tokens are mode-invariant — same guarantee the shared-block
    // test above makes, repeated here so this group is self-contained.
    expect(DARK.interaction.rippleRadius).toBe(LIGHT.interaction.rippleRadius);
  });

  it("sources the radius from the token, not a raw literal, and declares the ripple mode", () => {
    // A bare `radius: 20` inside android_ripple would survive a token rename
    // silently. INTERACTION.rippleRadius is the one place to change the value.
    const pressable = read('src/components/Pressable.tsx');
    expect(pressable).toContain("highlight === 'ripple'");
    expect(pressable).toContain('radius: INTERACTION.rippleRadius');
    // foreground: true is what makes the ripple visible on a filled surface;
    // without it the wave renders behind child views and is hidden by a background.
    expect(pressable).toContain('foreground: true');
    // android_ripple is a no-op on iOS, so the mode is Android-only in effect.
    expect(pressable).toContain('android_ripple');
  });

  it('wires the FloatingToolbar nav tabs to the pill-shaped ripple', () => {
    // M3 NavigationBar clips its state layer to the indicator pill, not the full
    // slot. `highlight="ripple"` on the tab Pressable replaces the Reanimated
    // state layer (layerOpacity forced to 0 in ripple mode) with the Android
    // native ink wave, so the two effects do not stack.
    //
    // The Indicator component — the scaleX tonal fill — is independent of
    // `highlight` and continues to mark which tab is selected. The ripple marks
    // that a tap happened. They are complementary.
    //
    // https://m3.material.io/foundations/interaction/states/state-layers
    const bar = read('src/components/FloatingToolbar.tsx');
    expect(bar).toContain('highlight="ripple"');
    // Confirm the pill (Indicator) is still present: the fill and the ripple
    // are two separate concerns and the fill must not have been removed.
    expect(bar).toContain('<Indicator active={on}');
    // press="none" stays: a nav tab does not scale on touch.
    expect(bar).toContain('press="none"');
    // The layer is suppressed in ripple mode inside Pressable.tsx (layerOpacity=0),
    // so we verify the Reanimated layer is not explicitly requested here — no
    // onColor or layerColor prop that would re-introduce a stacked effect.
    expect(bar).not.toMatch(/onColor.*nav-/);
  });
});

describe('the search field is wide enough to read what you typed', () => {
  it('fills its row, because the input inside it is flex-sized', () => {
    /*
     * The TextInput inside SearchBar has `flex: 1`, which resolves against the
     * container. With no flex on the container it hugged an icon and a
     * zero-width input, so the field was a small pill and typed text was
     * invisible — while the list filtered correctly, which is exactly why every
     * test passed. Found on a device on 2026-09-06.
     */
    const bar = read('src/components/SearchBar.tsx');
    const container = bar.slice(bar.indexOf('container: {'), bar.indexOf('input: {'));
    expect(container).toMatch(/\bflex: 1\b/);
    const input = bar.slice(bar.indexOf('input: {'));
    expect(input).toMatch(/\bflex: 1\b/);
  });
});
describe('the transition lock has a write side', () => {
  const motion = readFileSync(join(__dirname, '..', 'src/theme/motion.ts'), 'utf8');

  it('is raised by useScreenEnter, so no pushed screen can forget', () => {
    // The lock is dead code without a writer: `transitioning` would read false
    // forever and every deferral that reads it -- the wallpaper mount, the
    // message-insert scroll, the emoji pre-mount -- would silently take its
    // immediate branch while looking wired.
    const hook = motion.slice(motion.indexOf('export function useScreenEnter'));
    expect(hook).toContain('setTransitioning(true)');
    expect(hook).toContain('runOnJS(setTransitioning)(false)');
  });

  it('lowers on the fade, and only when the animation actually finished', () => {
    // The slide is a spring and settles asymptotically, so lowering on it would
    // hold the lock past the point anything is visibly moving. An interrupted
    // animation still calls back, and a lock left raised is worse than the jank
    // it avoids.
    const hook = motion.slice(motion.indexOf('export function useScreenEnter'));
    const fade = hook.slice(hook.indexOf('progress.value = withTiming('));
    expect(fade.indexOf('runOnJS(setTransitioning)(false)')).toBeGreaterThan(-1);
    expect(fade.indexOf('runOnJS(setTransitioning)(false)')).toBeLessThan(
      fade.indexOf('shift.value = springTo'),
    );
  });
});

