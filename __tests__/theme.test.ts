import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { DARK, LIGHT, TOKENS } from '../src/theme/tokens';

const ROOT = join(__dirname, '..');
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
  it('is light-first', () => {
    expect(TOKENS).toBe(LIGHT);
    expect(LIGHT.color.bg.base).toBe('#F4F4F4');
    expect(DARK.color.bg.base).toBe('#0C0C0D');
  });

  it('converts percentage line-height and tracking into absolute units', () => {
    // Body/Large is 17pt at 145% with -0.5% tracking.
    expect(LIGHT.typography.bodyLarge.fontSize).toBe(17);
    expect(LIGHT.typography.bodyLarge.lineHeight).toBe(25);
    expect(LIGHT.typography.bodyLarge.letterSpacing).toBeCloseTo(-0.09, 2);
  });

  it('shares space, radius and motion across both modes', () => {
    expect(DARK.space).toEqual(LIGHT.space);
    expect(DARK.radius).toEqual(LIGHT.radius);
    expect(DARK.motion).toEqual(LIGHT.motion);
  });

  it('keeps elevation shadows translucent', () => {
    // A bound Figma colour variable silently discarded these once already.
    expect(LIGHT.elevation.composer.shadowOpacity).toBeGreaterThan(0);
    expect(LIGHT.elevation.composer.shadowOpacity).toBeLessThan(1);
    expect(LIGHT.elevation.sheet.shadowOpacity).toBeGreaterThan(0);
    expect(LIGHT.elevation.sheet.shadowOpacity).toBeLessThan(1);
  });
});

describe('accessibility budget', () => {
  it('holds AAA for body text in both modes', () => {
    expect(contrast(LIGHT.color.text.primary, LIGHT.color.bg.base)).toBeGreaterThanOrEqual(7);
    expect(contrast(DARK.color.text.primary, DARK.color.bg.base)).toBeGreaterThanOrEqual(7);
  });

  it('holds AAA for secondary text in both modes', () => {
    expect(contrast(LIGHT.color.text.secondary, LIGHT.color.bg.base)).toBeGreaterThanOrEqual(7);
    expect(contrast(DARK.color.text.secondary, DARK.color.bg.base)).toBeGreaterThanOrEqual(7);
  });

  it('holds AAA for the accent count on its tint', () => {
    expect(contrast(LIGHT.color.text.accent, LIGHT.color.bg.accentTint)).toBeGreaterThanOrEqual(7);
  });

  it('keeps the send glyph legible on the accent fill', () => {
    // A UI glyph needs 3:1, not 4.5:1 — it carries no text.
    expect(contrast(LIGHT.color.text.onAccent, LIGHT.color.bg.accent)).toBeGreaterThanOrEqual(3);
    expect(contrast(DARK.color.text.onAccent, DARK.color.bg.accent)).toBeGreaterThanOrEqual(3);
  });

  it('keeps user bubble text legible on the inverse fill', () => {
    expect(contrast(LIGHT.color.text.onInverse, LIGHT.color.bg.inverse)).toBeGreaterThanOrEqual(7);
    expect(contrast(DARK.color.text.onInverse, DARK.color.bg.inverse)).toBeGreaterThanOrEqual(7);
  });
});

describe('accent budget is enforced in code, not just documented', () => {
  const componentSources = readdirSync(join(ROOT, 'src/components'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => ({ file: f, body: read(`src/components/${f}`) }));
  const screenSources = readdirSync(join(ROOT, 'src/screens'))
    .filter(f => f.endsWith('.tsx'))
    .map(f => ({ file: f, body: read(`src/screens/${f}`) }));

  it('uses bg.accent in only the permitted components', () => {
    const users = componentSources
      .concat(screenSources)
      .filter(s => s.body.includes('color.bg.accent') && !s.body.includes('color.bg.accentTint('))
      .map(s => s.file)
      .sort();
    // SendButton fill, TypingIndicator dots, plus accentTint in Avatar/Chip/TokenCounter.
    expect(users).toEqual([
      'Avatar.tsx',
      'Chip.tsx',
      'SendButton.tsx',
      'TokenCounter.tsx',
      'TypingIndicator.tsx',
    ]);
  });

  it('never uses the accent for a page or bubble background', () => {
    for (const s of componentSources.concat(screenSources)) {
      const bubbleOrPage = /backgroundColor:\s*TOKENS\.color\.bg\.accent,[\s\S]{0,80}(bubble|root|host:)/;
      expect(s.body).not.toMatch(bubbleOrPage);
    }
  });

  it('has no gradients or glow anywhere', () => {
    for (const s of componentSources.concat(screenSources)) {
      expect(s.body).not.toMatch(/gradient/i);
      expect(s.body).not.toMatch(/accentGlow/);
    }
  });
});
