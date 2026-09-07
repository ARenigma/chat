import { readFileSync } from 'fs';
import { join } from 'path';
import {
  CRITICAL_TALK_MINUTES,
  DEFAULT_RATES,
  HEALTHY_TALK_MINUTES,
  LOW_BALANCE_TOKENS,
  isLowBalance,
  talkMinutesLeft,
  walletTone,
} from '../src/lib/rates';

const ROOT = join(__dirname, '..');
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8');

/**
 * TypeScript with comments removed, for negative assertions.
 *
 * Every fill below now carries a comment naming the token it must NOT use, so a
 * gate that read raw source would pass against the explanation of the bug.
 */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** The body of one `StyleSheet.create` entry — `name: { ... }`, no nesting. */
function styleBlock(code: string, name: string): string {
  const at = code.indexOf(`${name}: {`);
  expect({ style: name, found: at > -1 }).toEqual({ style: name, found: true });
  return code.slice(at, code.indexOf('}', at));
}

/** WCAG 2.1 relative luminance / contrast, the same arithmetic check-contrast.mjs uses. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const [r, g, bl] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(pair => {
      const c = parseInt(pair, 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    }) as [number, number, number];
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * A foreground at `alpha` painted over a background, as sRGB.
 *
 * Needed because `opacity` on a React Native `Text` composites the whole view
 * before it is drawn, so the colour a contrast rule applies to is this result
 * and not the token the style names. check-contrast.mjs has no equivalent and
 * does not need one: it measures TOKEN pairs, and an alpha is applied at a call
 * site, which is why the earnings card's two faded labels could not have been
 * caught there and are asserted here instead.
 */
function composite(fg: string, bg: string, alpha: number): string {
  const channels = (hex: string): number[] =>
    [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(pair => parseInt(pair, 16));
  const [f, b] = [channels(fg), channels(bg)];
  return `#${f
    .map((v, i) => Math.round(v * alpha + b[i]! * (1 - alpha)).toString(16).padStart(2, '0'))
    .join('')}`;
}

const PALETTE = (
  JSON.parse(read('design/tokens.json')) as {
    color: { tokens: Record<string, Record<string, string>> };
  }
).color.tokens;
const hex = (token: string, mode: 'Light' | 'Dark'): string => PALETTE[token]![mode]!;

describe('walletTone (talk-time colours)', () => {
  const rate = DEFAULT_RATES.chat;

  it('is healthy at or above one hour of talk', () => {
    expect(walletTone(HEALTHY_TALK_MINUTES * rate, rate)).toBe('healthy');
    expect(walletTone(HEALTHY_TALK_MINUTES * rate + 1, rate)).toBe('healthy');
  });

  it('is critical under ten minutes of talk', () => {
    expect(walletTone(CRITICAL_TALK_MINUTES * rate - 1, rate)).toBe('critical');
    expect(walletTone(0, rate)).toBe('critical');
  });

  it('is ok (lime) between the thresholds, including exactly ten minutes', () => {
    expect(walletTone(CRITICAL_TALK_MINUTES * rate, rate)).toBe('ok');
    expect(walletTone(30 * rate, rate)).toBe('ok');
  });

  it('treats a null balance as ok rather than critical', () => {
    expect(walletTone(null)).toBe('ok');
    expect(isLowBalance(null)).toBe(false);
  });

  it('keeps LOW_BALANCE_TOKENS aligned with the critical minute floor', () => {
    expect(LOW_BALANCE_TOKENS).toBe(CRITICAL_TALK_MINUTES * rate);
    expect(isLowBalance(LOW_BALANCE_TOKENS)).toBe(false);
    expect(isLowBalance(LOW_BALANCE_TOKENS - 1)).toBe(true);
  });

  it('derives minutes from balance ÷ rate', () => {
    expect(talkMinutesLeft(220, 22)).toBe(10);
    expect(talkMinutesLeft(null)).toBe(0);
  });
});

/**
 * The bright accent carries no label, asserted at the call site.
 *
 * This block is here because the talk-time meter's Recharge pill is one of the
 * five surfaces that had the defect, and this is the file that owns the meter's
 * colours. The other four come with it because the defect is ONE token pair, not
 * five independent mistakes, and splitting the assertion by screen is how four
 * of them stayed wrong while the fifth was fixed.
 *
 * What went wrong: `text/onAccent` (white) was placed on `bg/accent` — 3.44:1 in
 * light, 2.59:1 in dark — under labels of 12dp, 14dp and 16dp.
 * developer.android.com/guide/topics/ui/accessibility/apps ("Increase text
 * visibility"): "If the text is smaller than 18sp, or if the text is bold and
 * smaller than 14sp, use foreground and background colors that result in a color
 * contrast ratio of at least 4.5:1. For all other text, set the color contrast
 * ratio to at least 3:1." All of them are under 18sp, so all of them took 4.5:1.
 *
 * Why it was not caught: `scripts/check-contrast.mjs` measured `text/onAccent`
 * against `bg/accentStrong` and against nothing else, so it reported 56 passing
 * pairs and never printed the failing one. The last assertion below is about
 * that hole rather than about any screen.
 */
describe('the bright accent carries no label', () => {
  /*
   * fill style → the label that sits on it, per file.
   *
   * `label` is a STYLE NAME where the ink is a style of its own, and a PATTERN
   * against the whole file where it is computed in the component body. The
   * second form exists for ProviderDetailScreen, whose three action buttons pick
   * their ink from one `fg` ternary rather than from three label styles — a
   * shape the style-block form cannot see, and the shape that hid this file's
   * worst pairing (see the `actionDark` assertion below).
   */
  const SURFACES: ReadonlyArray<{
    file: string;
    fill: string;
    label: string | RegExp;
    why: string;
  }> = [
    {
      file: 'src/screens/ChatScreen.tsx',
      fill: 'talkRecharge',
      label: 'talkRechargeLabel',
      why: "the talk-time meter's Recharge pill, labelMediumEmphasized 12dp Bold",
    },
    {
      file: 'src/components/SpotlightCard.tsx',
      fill: 'cta',
      label: 'ctaLabel',
      why: 'the spotlight "Say hi" CTA, labelLargeEmphasized 14dp Bold',
    },
    {
      file: 'src/screens/RechargeScreen.tsx',
      fill: 'balanceMark',
      label: 'balanceMarkText',
      why: 'the wallet ₹ disc — the ₹ is text, not an icon',
    },
    {
      file: 'src/screens/RechargeScreen.tsx',
      fill: 'ribbon',
      label: 'ribbonText',
      why: 'the recharge pack\'s "Popular" / "Best value" corner ribbon, 12dp',
    },
    {
      file: 'src/screens/ProfileSetupScreen.tsx',
      fill: 'ageChipSelected',
      label: 'ageChipLabelSelected',
      why: 'the selected age chip, titleMediumEmphasized 16dp Bold',
    },
    /*
     * The three that aba2c13 left, because they were in files that pass did not
     * own. They are the same defect and they are in the same list, which is the
     * whole argument of this block's header — the first five were found together
     * and fixed together precisely so the remainder could not be triaged apart.
     */
    {
      file: 'src/components/Badge.tsx',
      fill: 'pill',
      label: 'label',
      why: 'EVERY unread count in the app, 10dp Bold — the smallest type here',
    },
    {
      file: 'src/screens/ProviderDetailScreen.tsx',
      fill: 'actionPrimary',
      label: /kind === 'outline'[\s\S]{0,160}theme\.color\.text\.onAccent/,
      why: "the provider's primary call action, 12dp Bold beside a 22dp glyph",
    },
    {
      file: 'src/screens/ProviderHomeScreen.tsx',
      fill: 'earnCard',
      label: 'earnLabel',
      why: 'the provider earnings card, which carries three labels at once',
    },
  ];

  it.each(SURFACES)('fills $fill from the text-safe accent step ($why)', ({ file, fill }) => {
    const block = styleBlock(withoutComments(read(file)), fill);
    expect(block).toContain('bg.accentStrong');
    // The negative is the one that matters: `accentStrong` contains the string
    // `accent`, so a lookahead is the only way to catch a revert.
    expect(block).not.toMatch(/bg\.accent(?!Strong|Tint)/);
  });

  it.each(SURFACES)('still puts text/onAccent on $fill, so the pairing is real', ({ file, label }) => {
    // Without this the fill assertions above could pass on a surface that had
    // quietly stopped carrying a label, which would make them decorative.
    const code = withoutComments(read(file));
    expect(typeof label === 'string' ? styleBlock(code, label) : code).toMatch(
      typeof label === 'string' ? /text\.onAccent/ : label,
    );
  });

  it('takes the checked terms box with it, on the weaker non-text floor', () => {
    /*
     * Listed apart from the five above because the claim is different: the mark
     * inside is a 14dp `check` Icon, not a label, so it answers to the 3:1
     * non-text minimum rather than 4.5:1. bg/accent clears that in light
     * (3.44:1) and misses it in dark (2.59:1), so it was still wrong — and it is
     * the same "on" state as `ageChipSelected` on the same screen, which is the
     * stronger argument for one fill rather than two.
     */
    const profile = withoutComments(read('src/screens/ProfileSetupScreen.tsx'));
    const block = styleBlock(profile, 'checkboxOn');
    expect(block).toContain('bg.accentStrong');
    expect(block).not.toMatch(/bg\.accent(?!Strong|Tint)/);
    // The tick itself, so the pairing this asserts is the one on screen.
    expect(profile).toMatch(/name="check"[^/]*color=\{theme\.color\.text\.onAccent\}/);
  });

  it('takes the provider photo badge too, on that same non-text floor', () => {
    /*
     * Byte-for-byte the case above, one screen over: a 14dp `check` Icon in
     * `text/onAccent` inside a disc, so 3:1 rather than 4.5:1, cleared in light
     * (3.44:1) and missed in dark (2.59:1).
     *
     * It is here rather than in a later pass for the reason in this block's
     * header. The defect is one token pair; triaging it by surface is what kept
     * four of the first five wrong while the fifth was being fixed, and this one
     * is on a screen the same change set is already editing.
     */
    const home = withoutComments(read('src/screens/ProviderHomeScreen.tsx'));
    const block = styleBlock(home, 'photoBadge');
    expect(block).toContain('bg.accentStrong');
    expect(block).not.toMatch(/bg\.accent(?!Strong|Tint)/);
    expect(home).toMatch(/name="check"[^/]*color=\{theme\.color\.text\.onAccent\}/);
  });

  it('carries all three earnings labels at full strength, because opacity IS contrast', () => {
    /*
     * The one surface where moving the fill was not the whole fix.
     *
     * `opacity` on a `Text` composites the entire view before it is painted, so
     * the colour a contrast rule applies to is not the token the style names —
     * `earnLabel` was white at 80% and `earnSub` white at 85%, both over the
     * fill. That is why this is asserted here and could never have been caught
     * by scripts/check-contrast.mjs: the gate measures TOKEN pairs, and an alpha
     * is applied at a call site.
     *
     * The arithmetic is recomputed rather than quoted, so the claim cannot rot:
     * at the alpha that shipped, even the CORRECTED fill leaves these two labels
     * under the 4.5:1 that 12dp takes
     * (developer.android.com/guide/topics/ui/accessibility/apps). Moving the
     * fill alone would have looked exactly like a fix.
     *
     * `earnValue` is in the loop although it never carried an alpha, because it
     * is the label that must KEEP passing: at 28dp Bold it is neither under 18sp
     * nor bold-under-14sp, so it sits in "all other text" at 3:1 — which it met
     * in light on the old fill (3.44:1) and missed in dark (2.59:1). It is the
     * one label on this card whose floor an alpha could plausibly be argued back
     * onto, so it is pinned with its siblings.
     */
    const home = withoutComments(read('src/screens/ProviderHomeScreen.tsx'));
    for (const style of ['earnLabel', 'earnValue', 'earnSub']) {
      const block = styleBlock(home, style);
      expect(block).toMatch(/text\.onAccent/);
      expect(block).not.toMatch(/opacity:/);
    }
    for (const [alpha, floor] of [
      [0.8, 4.5],
      [0.85, 4.5],
    ] as const) {
      const faded = composite(
        hex('text/onAccent', 'Light'),
        hex('bg/accentStrong', 'Light'),
        alpha,
      );
      expect(contrast(faded, hex('bg/accentStrong', 'Light'))).toBeLessThan(floor);
    }
    // And at full strength it clears, which is what makes removing the alpha the
    // fix rather than a step towards one.
    expect(
      contrast(hex('text/onAccent', 'Light'), hex('bg/accentStrong', 'Light')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the payout row visible now the card is the fill the row used to be', () => {
    /*
     * A fill move with a second-order effect that would have been worse than the
     * bug it fixed. `payoutRow` was `bg/accentStrong` inset into a `bg/accent`
     * card — a deeper step in a brighter one, which is what made it read as a
     * control. Once the card takes accentStrong for its labels' sake, an
     * unchanged row is the SAME colour as its container: 1.00:1, a "Get paid"
     * button that is not on screen at all.
     *
     * So it takes the answer the app already gives, stated as a rule on
     * `minutesTagOn` in RechargeScreen.tsx and followed by `ribbonOn` and the
     * compact chip's `popularOn`: anything inset into a filled accent card takes
     * the page colour and accent ink. There is no third accent step for an inset
     * element to be.
     *
     * Both glyphs move with the label or they would be white on white in light
     * mode, which is the same class of mistake as the one being fixed.
     */
    const home = withoutComments(read('src/screens/ProviderHomeScreen.tsx'));
    const row = styleBlock(home, 'payoutRow');
    expect(row).toContain('bg.base');
    expect(row).not.toMatch(/bg\.accent/);
    expect(styleBlock(home, 'payoutLabel')).toMatch(/text\.accent/);
    expect(home).toMatch(/name="wallet"[^/]*color=\{theme\.color\.text\.accent\}/);
    expect(home).toMatch(/name="chevronRight"[^/]*color=\{theme\.color\.text\.accent\}/);
    /*
     * And it is not a downgrade taken to dodge the nesting problem: the pairing
     * it lands on beats the white-on-accentStrong one it replaces in BOTH modes.
     * Asserted as a comparison rather than against 4.5 so it stays meaningful if
     * the palette moves — the claim is "this row got more legible, not less".
     */
    for (const mode of ['Light', 'Dark'] as const) {
      expect(contrast(hex('text/accent', mode), hex('bg/base', mode))).toBeGreaterThan(
        contrast(hex('text/onAccent', mode), hex('bg/accentStrong', mode)),
      );
    }
  });

  it('stops filling a button with an INK token, which was white on white in dark', () => {
    /*
     * Found while moving `actionPrimary`, three lines above it, and worse than
     * anything this block is named for.
     *
     * ProviderDetailScreen's video button filled with `text/primary` — an ink
     * token — and labelled it `text/onAccent`. The two flip in opposite
     * directions: text/primary is #1C1C1E in light and #FFFFFF in dark, while
     * text/onAccent is white in both. So in dark mode the button painted #FAFAFA
     * text and a 22dp glyph onto #FFFFFF. 1.04:1 is not low contrast, it is a
     * button that is not there, and it shipped because the pair was hand-rolled
     * at a call site out of two tokens that are never listed together.
     *
     * `bg/inverse` is the token for a dark full-width fill — its own note calls
     * it "Primary button" — and in light it is #1C1C1E, the SAME value
     * text/primary has there, so light mode does not move by a pixel and only
     * the broken half changes. That pair is already registered in the contrast
     * gate, so this button is now measured rather than improvised.
     */
    const detail = withoutComments(read('src/screens/ProviderDetailScreen.tsx'));
    const dark = styleBlock(detail, 'actionDark');
    expect(dark).toContain('bg.inverse');
    expect(dark).not.toContain('text.primary');
    expect(detail).toMatch(/kind === 'dark'\s*\?\s*theme\.color\.text\.onInverse/);
    // The defect, recomputed: an ink token used as a fill collides with the ink.
    expect(contrast(hex('text/onAccent', 'Dark'), hex('text/primary', 'Dark'))).toBeLessThan(1.1);
    // Why light mode is untouched, as a fact rather than a promise.
    expect(hex('bg/inverse', 'Light')).toBe(hex('text/primary', 'Light'));
    for (const mode of ['Light', 'Dark'] as const) {
      expect(
        contrast(hex('text/onInverse', mode), hex('bg/inverse', mode)),
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('keeps the two accent steps far enough apart to be worth having two', () => {
    for (const mode of ['Light', 'Dark'] as const) {
      expect(contrast(hex('text/onAccent', mode), hex('bg/accentStrong', mode))).toBeGreaterThanOrEqual(4.5);
      // Asserted as a fact, not as an aspiration: bg/accent is the glyph step.
      // If this ever clears 4.5 the two-step accent has been collapsed and every
      // `accentStrong` above is load-bearing for a reason that no longer holds.
      expect(contrast(hex('text/onAccent', mode), hex('bg/accent', mode))).toBeLessThan(4.5);
    }
    // Dark is the harder half and the one the original audit missed: there the
    // accent is a LIGHT blue, so white fails even the 3:1 non-text minimum.
    expect(contrast(hex('text/onAccent', 'Dark'), hex('bg/accent', 'Dark'))).toBeLessThan(3);
  });

  it('registers the failing pair in the contrast gate, which is what let it ship', () => {
    // The gate is pair-driven, so an unlisted pair is an unmeasured pair. This
    // asserts the row exists at all — its target and exemption are argued in the
    // script itself.
    const gate = withoutComments(read('scripts/check-contrast.mjs'));
    const registered = gate
      .split(/\{\s*(?=fg:)/)
      .some(entry => /fg:\s*'text\/onAccent'/.test(entry) && /bg:\s*'bg\/accent'/.test(entry));
    expect(registered).toBe(true);
  });
});
