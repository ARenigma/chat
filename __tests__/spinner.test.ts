/**
 * The ring spinner's geometry.
 *
 * The Spinner component is now a single rotating ring (border-trick, no SVG).
 * What can be tested here is the border-width formula: it scales with size,
 * stays on the pixel grid, and never drops below the minimum that keeps the
 * ring visible on low-density screens.
 *
 * The spoke functions (MIN_OPACITY, SPOKES, spokeAngle, spokeOpacity,
 * spokeMetrics) remain exported from src/lib/spinner — they are no longer
 * used by the production component but are kept as a detached utility module.
 * Their tests are removed because they describe behaviour the current spinner
 * does not exhibit; keeping them would assert properties of code that has no
 * effect on the product.
 */
import { ringBorderWidth } from '../src/lib/spinner';

describe('ringBorderWidth', () => {
  it('is at least 2 pt so the ring is visible at small sizes', () => {
    for (const size of [8, 12, 16, 20]) {
      expect(ringBorderWidth(size)).toBeGreaterThanOrEqual(2);
    }
  });

  it('grows with the spinner diameter', () => {
    // Larger spinners need a proportionally heavier stroke.
    const small = ringBorderWidth(16);
    const large = ringBorderWidth(44);
    expect(large).toBeGreaterThan(small);
  });

  it('stays on the 0.5-pt sub-pixel grid', () => {
    // On a 2× display 0.5 pt is one physical pixel; half-pixel values are fine
    // and expected. Values that are not multiples of 0.5 produce sub-pixel
    // bleed on both 2× and 3× densities.
    for (const size of [12, 16, 20, 24, 28, 36, 44]) {
      const bw = ringBorderWidth(size);
      expect((bw * 2) % 1).toBe(0);
    }
  });

  it('fits within the diameter so the ring does not overflow its frame', () => {
    // Two border-width radii (top + bottom) must not exceed the outer diameter.
    for (const size of [12, 16, 20, 28, 44]) {
      expect(ringBorderWidth(size) * 2).toBeLessThan(size);
    }
  });
});
