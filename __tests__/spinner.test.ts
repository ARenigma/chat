/**
 * The activity indicator's geometry and opacity curve.
 *
 * Pure maths, so it is tested here rather than looked at. What cannot be tested
 * here is whether it reads as a rotation, which is why it is also checked on a
 * device.
 */
import {
  MIN_OPACITY,
  SPOKES,
  spokeAngle,
  spokeMetrics,
  spokeOpacity,
} from '../src/lib/spinner';

describe('spoke layout', () => {
  it('spaces the spokes evenly around the full circle', () => {
    const angles = Array.from({ length: SPOKES }, (_, i) => spokeAngle(i));
    expect(angles[0]).toBe(0);
    expect(new Set(angles).size).toBe(SPOKES);
    // Every gap identical, and the whole ring covered exactly once. Indexed
    // reads are asserted rather than non-null-asserted: `noUncheckedIndexedAccess`
    // is on, and silencing it with `!` in a test is how a test starts lying.
    const gaps = angles.slice(1).map((a, i) => a - (angles[i] ?? 0));
    expect(new Set(gaps).size).toBe(1);
    const last = angles[angles.length - 1];
    const gap = gaps[0];
    expect(last).toBeDefined();
    expect(gap).toBeDefined();
    expect((last ?? 0) + (gap ?? 0)).toBe(360);
  });

  it('leaves a hole in the middle so the spokes do not merge into a disc', () => {
    const { inset, length, thickness } = spokeMetrics(16);
    expect(inset).toBeGreaterThan(0);
    expect(length).toBeGreaterThan(thickness);
    // The ring must fit inside the requested diameter.
    expect((inset + length) * 2).toBeLessThanOrEqual(16);
  });

  it('keeps a spoke thick enough to be visible on a low-density screen', () => {
    // Below 1 point a capsule can round to nothing on a 1x screen.
    for (const size of [12, 16, 20, 28, 44]) {
      expect(spokeMetrics(size).thickness).toBeGreaterThanOrEqual(1.5);
    }
  });
});

describe('the opacity curve', () => {
  it('never lets a spoke reach zero', () => {
    // At zero the dimmest spoke vanishes and the ring reads as a moving gap
    // rather than a turning wheel.
    for (let i = 0; i < SPOKES; i += 1) {
      for (const p of [0, 0.1, 0.25, 0.5, 0.75, 0.99]) {
        expect(spokeOpacity(i, p)).toBeGreaterThanOrEqual(MIN_OPACITY);
        expect(spokeOpacity(i, p)).toBeLessThanOrEqual(1);
      }
    }
  });

  it('has exactly one leading spoke at any moment', () => {
    for (const p of [0, 0.2, 0.45, 0.8]) {
      const values = Array.from({ length: SPOKES }, (_, i) => spokeOpacity(i, p));
      const brightest = Math.max(...values);
      expect(values.filter(v => v === brightest)).toHaveLength(1);
    }
  });

  it('advances the leading spoke as the cycle progresses', () => {
    // The property that makes it look like rotation rather than a pulse.
    const leadAt = (p: number) => {
      const values = Array.from({ length: SPOKES }, (_, i) => spokeOpacity(i, p));
      return values.indexOf(Math.max(...values));
    };
    const first = leadAt(0.01);
    const later = leadAt(0.01 + 1 / SPOKES);
    expect(later).toBe((first + 1) % SPOKES);
  });

  it('rotates the same set of brightnesses rather than changing them', () => {
    /*
     * The correct invariant, and not the one first written here.
     *
     * The first version asserted that no individual spoke jumps between the end
     * of a cycle and the start of the next. That is false, and it should be: as
     * the lead reaches a spoke, that spoke goes from dimmest to brightest in one
     * step. It happens to every spoke once per revolution, not only at the wrap,
     * and it is what a stepped indicator does. UIKit's steps too.
     *
     * What must hold is that the ring's appearance is the same set of
     * brightnesses in a rotated order, so the indicator never gets brighter or
     * dimmer overall as it turns.
     */
    const round = (n: number) => Math.round(n * 1000) / 1000;
    const setAt = (p: number) =>
      Array.from({ length: SPOKES }, (_, i) => round(spokeOpacity(i, p))).sort();

    const reference = setAt(0);
    for (const p of [1 / SPOKES, 2 / SPOKES, 5 / SPOKES, 7 / SPOKES]) {
      expect(setAt(p)).toEqual(reference);
    }
  });

  it('steps each spoke exactly once per revolution', () => {
    // The step is the design. What would be a defect is a spoke stepping twice,
    // which would read as a wobble rather than a rotation.
    const samples = 200;
    for (let i = 0; i < SPOKES; i += 1) {
      let jumps = 0;
      for (let n = 1; n <= samples; n += 1) {
        const previous = spokeOpacity(i, (n - 1) / samples);
        const current = spokeOpacity(i, n / samples);
        if (current - previous > 0.3) {
          jumps += 1;
        }
      }
      expect(jumps).toBe(1);
    }
  });
});
