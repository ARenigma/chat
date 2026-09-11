/**
 * Pure data + timing for `NightSky`: the seeded starfield, the comet's path,
 * and every duration it animates on.
 *
 * Durations live here rather than as literals in `NightSky.tsx` because
 * `__tests__/theme.test.ts` bans a raw millisecond in any component/screen —
 * "motion lives in one module" — the same rule `lib/bloom.ts` answers to for
 * `BLOOM_LAYER_MS` and friends. This is a SEPARATE module from `bloom.ts` on
 * purpose: the night sky is an independent decorative layer with its own
 * lifecycle, not a fourth bloom layer, and giving it its own file is what
 * keeps that boundary real rather than just stated in a comment.
 */

/** How many stars the field draws. */
export const STAR_COUNT = 34;

/** One full twinkle cycle (dim → bright → dim), per star. */
export const STAR_TWINKLE_MS = 1800;

/** Longest a star can wait before its first twinkle, so they don't pulse in unison. */
export const STAR_TWINKLE_DELAY_SPAN_MS = 3000;

/** How long one comet takes to cross its path. */
export const COMET_SHOOT_MS = 900;

/** The shortest gap between comets. */
export const COMET_REST_MIN_MS = 4200;

/** How much random extra can be added to the gap, on top of the minimum. */
export const COMET_REST_SPAN_MS = 3600;

export interface Star {
  readonly x: number;
  readonly y: number;
  readonly size: number;
  readonly baseOpacity: number;
  readonly twinkleDelay: number;
}

export interface CometPath {
  readonly startX: number;
  readonly startY: number;
  readonly dx: number;
  readonly dy: number;
  /** Degrees, for the trail's `rotate` transform. */
  readonly angle: number;
}

/**
 * A Lehmer/Park-Miller LCG. Modulo, not bitmasked — this repo's lint forbids
 * `&`/`>>` (no-bitwise) — which produces the identical bounded range for what
 * this seeds: a visual field, not cryptography.
 */
export function makeRng(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 48271) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/**
 * `STAR_COUNT` stars, seeded once per mount (the caller passes a fresh seed,
 * typically `Date.now()`) rather than re-randomised on every render — a
 * starfield that reshuffles itself on a re-render reads as a glitch, not a
 * sky.
 *
 * Concentrated in the upper ~60% of the frame: the coral bloom already owns
 * the bottom, so stars fill the part of the sky it does not reach.
 */
export function makeStars(seed: number, width: number, height: number): Star[] {
  const rnd = makeRng(seed);
  const stars: Star[] = [];
  for (let i = 0; i < STAR_COUNT; i += 1) {
    stars.push({
      x: rnd() * width,
      y: rnd() * height * 0.6,
      size: 1 + rnd() * 1.6,
      baseOpacity: 0.25 + rnd() * 0.5,
      twinkleDelay: rnd() * STAR_TWINKLE_DELAY_SPAN_MS,
    });
  }
  return stars;
}

/** One comet's diagonal path across the frame, seeded once per mount. */
export function makeCometPath(seed: number, width: number, height: number): CometPath {
  const rnd = makeRng(seed);
  const startX = width * (0.15 + rnd() * 0.5);
  const startY = height * (0.05 + rnd() * 0.18);
  const dx = width * (0.28 + rnd() * 0.18);
  const dy = height * (0.14 + rnd() * 0.1);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return { startX, startY, dx, dy, angle };
}

/**
 * Opacity for a comet mid-flight, given `t` (0..1 progress along its path).
 * Ease in over the first 15%, hold, ease out over the last 15% — smooth fade
 * edges rather than an abrupt cut (Amit: "motion should be smooth").
 */
export function cometFade(t: number): number {
  const fade = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
  return Math.max(0, Math.min(1, fade));
}
