/**
 * The word carousel's timing, as data rather than as an animation.
 *
 * Rule 1 of `design/references/motion-system.md`: three words stacked, one
 * focused, advancing on their own about every 1.1s, neighbours sitting at
 * roughly 10% opacity. The reference calls it "a continuous loop, not a pager",
 * and that distinction is the whole implementation problem. A pager can be a
 * `setInterval` and a state update, a loop cannot, because it has to keep running
 * while JavaScript is busy and across the hand-off to the system browser and
 * back.
 *
 * So each row gets one repeating opacity animation with a fixed phase offset,
 * built once and left alone on the UI thread. This module is the arithmetic for
 * that, and it is here rather than in the component or in `motion.ts` for one
 * reason: the failure mode is drift. If a row's steps do not sum to exactly one
 * lap, the rows fall out of phase: slowly, invisibly at first, and then two
 * words are lit at once several minutes into a screen nobody watches for several
 * minutes. That is a statement about a sum, which is a unit test, not an
 * eyeball.
 *
 * No React and no Reanimated import on purpose: `motion.ts` turns a slot into
 * springs and timings, and it is the only file allowed to know how.
 */

/** One leg of a row's loop: fade or hold to `to`, taking `ms`. */
export interface FadeStep {
  readonly to: number;
  readonly ms: number;
}

/**
 * One row's whole loop.
 *
 * `delayMs` is applied ONCE, outside the repeat, which is what keeps the phase
 * offset from accumulating. Putting the offset inside the repeated sequence was
 * the obvious first shape and it adds `index * dwell` to every lap, so row two
 * drifts a word behind row one on the second pass.
 */
export interface CarouselSlot {
  readonly delayMs: number;
  readonly steps: readonly FadeStep[];
}

/**
 * The steps for row `index` of a `count`-row carousel.
 *
 * Each row is focused for exactly one dwell out of every `count`, and the fade
 * down of the row leaving is the same `swapMs` as the fade up of the row
 * arriving. They are scheduled to overlap exactly, so the pair reads as one
 * cross-fade rather than as a gap or a double-lit frame.
 *
 * The plateau matters as much as the fade. A word that is perpetually in
 * transition cannot be read, so `dwell - swap` of every dwell is spent holding
 * still. That hold is expressed as a timing to the value it already has, which
 * is the cheapest way to say "wait" inside a sequence.
 *
 * `count < 2` returns an empty slot: there is nothing to advance to, and a caller
 * that gets one should render the single word statically rather than loop it.
 */
export function carouselSlot(
  index: number,
  count: number,
  dwellMs: number,
  swapMs: number,
  restOpacity: number,
): CarouselSlot {
  if (count < 2 || index < 0 || index >= count) {
    return { delayMs: 0, steps: [] };
  }
  // Clamped rather than trusted: a swap longer than the dwell it lives in would
  // make the trailing hold negative, and a negative duration is a frozen row
  // rather than an error anybody sees.
  const swap = Math.max(0, Math.min(swapMs, dwellMs));
  const lap = count * dwellMs;
  return {
    delayMs: index * dwellMs,
    steps: [
      { to: 1, ms: swap },
      { to: 1, ms: dwellMs - swap },
      { to: restOpacity, ms: swap },
      // The remainder, computed rather than written, so the sum is a lap by
      // construction instead of by a comment claiming it is.
      { to: restOpacity, ms: lap - dwellMs - swap },
    ],
  };
}

/** Total time for one full pass of a slot, offset excluded. */
export function lapMs(slot: CarouselSlot): number {
  return slot.steps.reduce((total, step) => total + step.ms, 0);
}
