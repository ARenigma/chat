import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { DARK, LIGHT, TOKENS } from '../src/theme/tokens';

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
    expect(DARK.color.bg.base).toBe('#000000');
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
   * `bg/accentTint` is the only light token that still reads warm, and it has to
   * be: it is the coral at low saturation, the wash an avatar initial sits on.
   * Neutralising it would mean the avatars stop belonging to the accent family,
   * which is the one thing carrying identity in a product with no photographs.
   * It is a pink, not a cream, and impeccable's rule only ever inspects the page
   * background, so it cannot fire on this token in practice.
   */
  it('keeps the avatar wash in the accent family', () => {
    const tint = LIGHT.color.bg.accentTint;
    const r = parseInt(tint.slice(1, 3), 16);
    const b = parseInt(tint.slice(5, 7), 16);
    expect(r - b).toBeGreaterThan(20);
    expect(tint).not.toBe(LIGHT.color.bg.sunken);
  });

  it('converts percentage line-height and tracking into absolute units', () => {
    // Body/Large is iOS body: 17pt at 129% (22pt, iOS's own leading) with -2.5%
    // tracking. It was 142% and -0.5% when the ladder was Material's.
    expect(LIGHT.typography.bodyLarge.fontSize).toBe(17);
    expect(LIGHT.typography.bodyLarge.lineHeight).toBe(22);
    expect(LIGHT.typography.bodyLarge.letterSpacing).toBeCloseTo(-0.42, 2);
  });

  it('shares space, radius and motion across both modes', () => {
    expect(DARK.space).toEqual(LIGHT.space);
    expect(DARK.radius).toEqual(LIGHT.radius);
    expect(DARK.motion).toEqual(LIGHT.motion);
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
     * The Material Symbols faces are referenced by icons.generated.ts, not by a
     * typography token, because they are the icon set rather than a text style.
     * Two static instances ship — outlined and filled — for the active-state
     * swap RN Android cannot do on the FILL axis at runtime. Allowlisted here
     * for the same reason Noto once was: they are real, used, and not chosen
     * per-typography-style.
     */
    const ICON_FONTS = /^MaterialSymbols/;
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
     * Nunito carries the app and Lilita One sets the wordmark, and they are two
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
      LilitaOne: 'OFL-LilitaOne.txt',
      // Material Symbols is Apache-2.0, not OFL — a different licence, still
      // mandatory to ship. Both instances map to the one notice.
      MaterialSymbolsOutlined: 'LICENSE-MaterialSymbols.txt',
      MaterialSymbolsOutlinedFill: 'LICENSE-MaterialSymbols.txt',
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
    const sources = ['src/components', 'src/screens']
      .flatMap(dir => readdirSync(join(ROOT, dir)).map(f => read(`${dir}/${f}`)))
      .concat(read('App.tsx'));
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
      expect(stripComments(s.body)).not.toMatch(/duration:\s*\d/);
    }
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
     */
    expect(users).toEqual([
      'src/components/CompletionRow.tsx',
      'src/components/TokenCounter.tsx',
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
    // The one animation in the app that must NOT take ReduceMotion.System, and
    // the reason is a real bug rather than a preference: a withRepeat(-1) whose
    // inner timings have been short-circuited to their final value does not
    // stop, it spins at frame rate running zero-length animations. So the
    // decision has to be "do not start", which only the component can make.
    expect(read('src/theme/motion.ts')).toContain('ReduceMotion.Never');
    const carousel = read('src/components/WordCarousel.tsx');
    expect(carousel).toContain('useReducedMotion()');
    // The gate itself, not just the import: the loop is only ever armed when the
    // component has decided it may run.
    expect(carousel).toMatch(/const looping = !reduced/);
    expect(carousel).toMatch(/if \(!looping\) \{\s*return;/);
  });

  it('drives the new surfaces through the shared builders', () => {
    // Nothing in this change writes its own physics. The screens ask for a named
    // builder and the builders are the only place a duration appears.
    expect(read('src/components/WordCarousel.tsx')).toContain('carouselLoop');
    expect(read('src/components/Stepper.tsx')).toContain('promoteTo');
    expect(read('src/components/Stepper.tsx')).toContain('accentTo');
    expect(read('src/components/Button.tsx')).toContain('fadeSwapFast');
  });

  it('honours the OS reduce-motion setting on every entrance', () => {
    // Checked per factory rather than by counting occurrences: the first version
    // compared a builder count against a `reduceMotion` count and failed because
    // the doc comment above them mentions the call, which is a test measuring
    // prose. Each exported entrance is now inspected on its own.
    const motion = read('src/theme/motion.ts');
    const factories = motion
      .split(/export function /)
      .slice(1)
      .filter(block => /FadeIn\w*\.delay/.test(block));
    expect(factories.length).toBeGreaterThan(0);
    for (const block of factories) {
      expect(block).toMatch(/reduceMotion\(ReduceMotion\.System\)/);
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
    //   OnboardingScreen, the mark's letter on the entry screen. The white tile it
    //                   sits in is the only opaque white above the button pair,
    //                   so the letter is the one place the brand hue appears at
    //                   display size on that surface
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
    //   Stepper       : the active step's marker, and the ramp it walks. Added by
    //                   the motion adoption, and it is the clearest "state" on
    //                   this list after the unread count: the marker IS which
    //                   step you are on, and it is the only accent anywhere on
    //                   the provider application. Rule 2 of the Fuse system is
    //                   "the accent changes per step and how it changes", so
    //                   without an accent here the rule reduces to decoration and
    //                   there is nothing left of it. The three rungs were
    //                   measured against both page colours before this was
    //                   accepted: 1.68:1 pending, 3.44:1 active and 5.19:1
    //                   complete on white, 6.11:1 on black, so every state
    //                   clears the 3:1 non-text minimum, and `bg/accentTint` is
    //                   deliberately NOT the first rung despite looking like it
    //                   should be, because it measures 1.22:1 on white
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
    //   TokenCounter, the low-balance pill
    //   Turn        , the member's own bubble
    //   TypingIndicator, the three dots
    //
    // Nothing here is a page, a header, a divider or a provider's avatar. This
    // assertion exists to force the argument to be made, not to forbid it.
    expect(users).toEqual([
      'Avatar.tsx',
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
      'Chip.tsx',
      /*
       * The completed mark. Green is the source's colour and appears nowhere in
       * this palette; `state/positive` is a background tint for a positive
       * surface, not a foreground mark. The accent is what this app uses to mean
       * "this is the live thing", which is exactly what a resolved completion is
       * — and it appears once, for one second, at the end of one flow.
       */
      'CompletionRow.tsx',
      'EmptyMark.tsx',
      /*
       * The v13 floating nav. The coral is the ACTIVE destination's disc — the
       * only thing distinguishing Home from Calls and Settings, which are
       * otherwise identical grey glyphs. Same "colour is the state" argument the
       * old TabBar made; this replaced it.
       */
      'FloatingToolbar.tsx',
      /*
       * v13 Home. Two accent uses, both states/actions: the featured hero's warm
       * field (the one designed coral surface on the screen, same class as the
       * bloom) and the unread ring + count on a rail face. Not a page, header or
       * a stranger's avatar.
       */
      'HomeScreen.tsx',
      // The entry surface's mark and CTA, unchanged in intent from the screen
      // this replaced.
      'OnboardingScreen.tsx',
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
      'Sheet.tsx',
      'Stepper.tsx',
      'ThreadBubble.tsx',
      'Toggle.tsx',
      'TokenCounter.tsx',
      'Turn.tsx',
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

  it('uses UIKit sheet corners, not Material bottom-sheet corners', () => {
    // 28 was Material 3's specified bottom-sheet corner. 10 is
    // UISheetPresentationController's default, and the sheet is the single
    // largest surface in the app, so its corner is the loudest platform tell.
    expect(radius.sheet).toBe(10);
    expect(read('src/components/Sheet.tsx')).toContain('TOKENS.radius.sheet');
  });

  it('has a field radius for the iOS filled control', () => {
    // Search fields, text fields, OTP segments and filled buttons are all 10 on
    // iOS. There was no token for it, so every field picked radius.md (16) or
    // radius.lg (20) and read as a Material outlined text field.
    expect(radius.field).toBe(10);
    expect(radius.alert).toBe(14);
  });

  it('has the 17-semibold headline the nav bar needs', () => {
    // Every navigation title in the app used to be labelMedium, which is 15, so
    // every one of them was two points small. iOS's headline is 17 semibold and
    // it is also a list row's name and a filled button's label.
    expect(typography.headline.fontSize).toBe(17);
    expect(typography.headline.fontFamily).toBe('Inter-SemiBold');
    expect(typography.subhead.fontSize).toBe(15);
    expect(typography.bodyLarge.fontSize).toBe(17);
    expect(typography.displayLarge.fontSize).toBe(34);
  });

  it('opens the display sizes and tightens body, the iOS direction', () => {
    // The old ladder put -2.5% on the display sizes and -0.5% on body, which is
    // backwards: iOS sets a large title open and tightens 17pt body hard.
    expect(typography.displayLarge.letterSpacing).toBeGreaterThan(0);
    expect(typography.bodyLarge.letterSpacing).toBeLessThan(0);
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
    const staticReads = sources.filter(s => /TOKENS\.(space|radius|typography)/.test(s.body));
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

  it('persists the choice and defaults to following the OS', () => {
    const provider = read('src/theme/ThemeProvider.tsx');
    expect(provider).toContain('companion.themeMode');
    expect(provider).toContain("Appearance.getColorScheme()");
    expect(provider).toMatch(/:\s*'system'/);
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
