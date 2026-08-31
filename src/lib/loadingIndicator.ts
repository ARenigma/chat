/**
 * Geometry helpers for the M3 Contained Loading Indicator.
 *
 * Reference: https://m3.material.io/components/progress-indicators/specs
 * Container: 48dp, active indicator: 38dp (ratio ≈ 0.792).
 *
 * Pure functions, no React, so they are testable without a device or renderer.
 * The worklet directives below are required because `indicatorBorderWidth` is
 * called inside useAnimatedStyle on the UI runtime.
 */

/**
 * M3 canonical ratio: indicator diameter / container diameter.
 * At 48dp container → 38dp indicator.
 */
export const INDICATOR_RATIO = 38 / 48;

/**
 * Indicator diameter for a given container size (dp).
 */
export function indicatorSize(containerSize: number): number {
  'worklet';
  return containerSize * INDICATOR_RATIO;
}

/**
 * Border width for the rotating arc indicator, scaled from the indicator
 * diameter.  Floored at 2 pt so the arc is visible at small sizes.
 * Rounded to the nearest 0.5 to stay on the sub-pixel grid on 2× and 3×.
 *
 * At common sizes:
 *   indicatorSize 12 → 2 pt   16 → 2 pt   20 → 2.5 pt
 *   30 → 3 pt   38 → 4 pt
 *
 * Re-exports `ringBorderWidth` from spinner.ts under a new name so
 * both consumers can share the same formula without a circular dependency.
 */
export function indicatorBorderWidth(indSize: number): number {
  'worklet';
  return Math.max(2, Math.round(indSize * 0.105 * 2) / 2);
}

/**
 * Shape-morph keyframe values used by the borderRadius animation.
 *
 * M3 Expressive cycles the indicator between a rounded square (low radius)
 * and a circle (high radius).  Without SVG path morphing we approximate this
 * by pulsing borderRadius between two values while the arc rotates.
 *
 * low  = ~25 % of half the indicator (visibly cornered)
 * high = half the indicator (perfect circle)
 */
export function morphRadii(indSize: number): { low: number; high: number } {
  const half = indSize / 2;
  return { low: Math.round(half * 0.35 * 2) / 2, high: half };
}
