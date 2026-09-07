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
  // fill style → the label style that sits on it, per file.
  const SURFACES: ReadonlyArray<{ file: string; fill: string; label: string; why: string }> = [
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
    expect(styleBlock(withoutComments(read(file)), label)).toMatch(/text\.onAccent/);
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
