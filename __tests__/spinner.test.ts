/**
 * Loading indicator geometry.
 *
 * The component is now the M3 Contained Loading Indicator (LoadingIndicator.tsx),
 * a single rotating arc with a shape-morph animation — no SVG, no eight-spoke
 * cascade.  Geometry helpers live in two places:
 *
 *   src/lib/spinner.ts          — legacy ringBorderWidth (kept for compat)
 *   src/lib/loadingIndicator.ts — canonical indicatorBorderWidth, indicatorSize,
 *                                  morphRadii for the new component
 *
 * What can be tested here is the border-width formula: it scales with size,
 * stays on the pixel grid, and never drops below the minimum that keeps the
 * arc visible on low-density screens.
 */
import { ringBorderWidth } from '../src/lib/spinner';
import { indicatorBorderWidth, indicatorSize, morphRadii, INDICATOR_RATIO } from '../src/lib/loadingIndicator';

// ─── Legacy ringBorderWidth (still exported from spinner.ts for compat) ─────

describe('ringBorderWidth', () => {
  it('is at least 2 pt so the ring is visible at small sizes', () => {
    for (const size of [8, 12, 16, 20]) {
      expect(ringBorderWidth(size)).toBeGreaterThanOrEqual(2);
    }
  });

  it('grows with the spinner diameter', () => {
    const small = ringBorderWidth(16);
    const large = ringBorderWidth(44);
    expect(large).toBeGreaterThan(small);
  });

  it('stays on the 0.5-pt sub-pixel grid', () => {
    for (const size of [12, 16, 20, 24, 28, 36, 44]) {
      const bw = ringBorderWidth(size);
      expect((bw * 2) % 1).toBe(0);
    }
  });

  it('fits within the diameter so the ring does not overflow its frame', () => {
    for (const size of [12, 16, 20, 28, 44]) {
      expect(ringBorderWidth(size) * 2).toBeLessThan(size);
    }
  });
});

// ─── M3 Contained Loading Indicator geometry ─────────────────────────────────

describe('indicatorSize', () => {
  it('preserves the M3 38/48 ratio', () => {
    expect(indicatorSize(48)).toBeCloseTo(38, 1);
    expect(INDICATOR_RATIO).toBeCloseTo(38 / 48, 5);
  });

  it('scales linearly with the container', () => {
    const small = indicatorSize(24);
    const large = indicatorSize(64);
    expect(large / small).toBeCloseTo(64 / 24, 3);
  });
});

describe('indicatorBorderWidth', () => {
  it('is at least 2 pt so the arc is visible at small indicator sizes', () => {
    for (const size of [10, 12, 16, 20]) {
      expect(indicatorBorderWidth(size)).toBeGreaterThanOrEqual(2);
    }
  });

  it('grows with the indicator diameter', () => {
    const small = indicatorBorderWidth(16);
    const large = indicatorBorderWidth(38);
    expect(large).toBeGreaterThan(small);
  });

  it('stays on the 0.5-pt sub-pixel grid', () => {
    for (const size of [12, 16, 20, 30, 38, 48]) {
      const bw = indicatorBorderWidth(size);
      expect((bw * 2) % 1).toBe(0);
    }
  });

  it('fits within the indicator diameter (arc never overflows its frame)', () => {
    for (const size of [12, 20, 30, 38, 48]) {
      expect(indicatorBorderWidth(size) * 2).toBeLessThan(size);
    }
  });
});

describe('morphRadii', () => {
  it('high radius is exactly half the indicator (perfect circle)', () => {
    for (const size of [20, 38, 48]) {
      expect(morphRadii(size).high).toBeCloseTo(size / 2, 3);
    }
  });

  it('low radius is less than high radius (provides visible morph)', () => {
    for (const size of [20, 38, 48]) {
      const { low, high } = morphRadii(size);
      expect(low).toBeLessThan(high);
      // Low must still be positive so it does not become a sharp corner.
      expect(low).toBeGreaterThan(0);
    }
  });
});
