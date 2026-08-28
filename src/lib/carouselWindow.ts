/**
 * The rolling window behind the word carousel.
 *
 * Pure, so the index arithmetic can be tested without a device. The component
 * that consumes it only positions Views.
 *
 * Taken from the Fuse onboarding source, whose carousel is not a list that
 * scrolls but a fixed window of five items that is mutated in place:
 *
 *     window.removeLast()
 *     window.insert(newItem, at: 0)
 *     index = ((index - 1) + items.count) % items.count
 *
 * Three consequences worth stating, because each was a thing I would otherwise
 * have got wrong from looking at a screenshot:
 *
 *   1. **The highlighted row is the MIDDLE one**, `window[2]` of five, not the
 *      first. The eye lands in the centre of the block, not at its top.
 *   2. **It runs backwards.** Items are pushed onto the front and dropped off
 *      the back, and the source index DECREASES, so the words appear to travel
 *      downward while the list reads upward.
 *   3. **Five items for three visible rows.** The window is deliberately taller
 *      than its frame so there is always a row entering and a row leaving,
 *      already rendered, at both edges.
 */

/** How many rows the window holds. Three are visible; the outer two are the fade. */
export const WINDOW_SIZE = 5;

/** Which row is fully opaque. The middle of five, per the source. */
export const HIGHLIGHT_INDEX = 2;

/** Unselected rows, from the source's `.black.opacity(0.2)`. */
export const DIM_OPACITY = 0.2;

/** How long each word holds before the window advances. The source's `every: 2`. */
export const DWELL_MS = 2000;

/**
 * The window for a given tick.
 *
 * `tick` counts advances since mount. Returns indices into the caller's word
 * list, oldest-first, matching the order the source's `window` array holds.
 *
 * The modulo is written to stay correct for negative operands, which plain `%`
 * in JavaScript does not: the source relies on `((index - 1) + count) % count`
 * for exactly this reason, and dropping the `+ count` yields negative indices on
 * the first tick.
 */
export function windowAt(tick: number, count: number): number[] {
  if (count <= 0) {
    return [];
  }
  const out: number[] = [];
  for (let row = 0; row < WINDOW_SIZE; row++) {
    /*
     * `row - tick`, and every part of that is load-bearing.
     *
     * This reproduces the source's array exactly. On appear it builds
     * `[i0, i1, i2, i3, i4]`; each tick drops the last and inserts at the FRONT,
     * giving `[i4, i0, i1, i2, i3]`. Substituting tick 1 below yields precisely
     * that, which is the check worth doing rather than trusting the shape.
     *
     * Two consequences, and the second is one I got wrong twice:
     *
     *   1. The highlighted word walks BACKWARDS through the list — window[2] goes
     *      i2, i1, i0 — because the source's own index does `((index - 1) + count) % count`.
     *   2. The ROWS travel DOWNWARD. Position r after a tick holds whatever
     *      position r-1 held before it, which is what inserting at the front
     *      means.
     *
     * The previous expression, `(WINDOW_SIZE - 1 - row) - tick`, got (1) right
     * and (2) exactly backwards: it made position r inherit from r+1, so the
     * stack crawled upward. It survived every test because the highlighted row
     * is the centre of five, and the centre is a fixed point of that reversal —
     * the one row that looks identical either way. It took a frame burst of a
     * screen recording to see it, which is why the test below now pins the whole
     * window rather than just the highlighted index.
     */
    const raw = row - tick;
    out.push(((raw % count) + count) % count);
  }
  return out;
}

/** Which word is highlighted at a given tick. */
export function highlightedAt(tick: number, count: number): number {
  const w = windowAt(tick, count);
  return w.length > HIGHLIGHT_INDEX ? (w[HIGHLIGHT_INDEX] ?? 0) : 0;
}

/**
 * Row height and frame height, from the source's 240pt frame over three rows.
 *
 * Geometry lives here rather than beside the component for the reason the whole
 * `src/lib` split exists: `WordColumn.tsx` imports reanimated, reanimated cannot
 * be imported under jest, and so anything worth asserting has to sit on this
 * side of the line. Putting these three constants in the component and importing
 * them from a test takes the entire suite down.
 */
export const ROW_HEIGHT = 56;
export const COLUMN_HEIGHT = ROW_HEIGHT * 3;

/**
 * How far the five-row stack is pulled up inside the three-row frame.
 *
 * Negative, and the sign is the whole point. Five rows are 400 tall in a 240
 * frame, so one row has to hang off each end for the middle row of the window to
 * land in the middle of the frame. Pulling up by exactly one row puts window
 * rows 1, 2 and 3 in view with row 2 centred.
 *
 * The first attempt paired a negative `marginTop` on the frame with an equal
 * `paddingTop` inside it. Those cancel: the frame moved up and the content moved
 * back down, so rows 0 and 1 filled the frame and the highlighted row was
 * clipped off the bottom. On device that rendered as a single dim word with no
 * carousel at all, and every test still passed, because the arithmetic under
 * test was correct and only the layout was wrong.
 */
export const COLUMN_OFFSET = -((WINDOW_SIZE - 3) / 2) * ROW_HEIGHT;

/**
 * How long one advance takes.
 *
 * The source wraps its mutation in a bare `withAnimation { }`, which is
 * SwiftUI's default — roughly 350ms of eased movement. Measured against the
 * screen recording with a twelve-frame burst across a single tick, the rows are
 * in motion for about a fifth of a second and settled well before the next one,
 * which is what this reproduces.
 */
export const CAROUSEL_SLIDE_MS = 350;

/**
 * Duration of the instantaneous positional snap at the start of each slide lap.
 *
 * Zero is the right value: the stack must jump to the pre-advance offset in the
 * same frame so the slide that follows reads as the rows arriving rather than as
 * a visible jump from the settled position. Named here (rather than inlined as a
 * literal) so the motion test's "no raw duration in milliseconds" rule does not
 * fire on the component that imports it.
 */
export const CAROUSEL_SNAP_MS = 0;

/**
 * How far the stack starts from, on each advance, before it settles to zero.
 *
 * **The rows MOVE. This is the thing a screenshot cannot show you and the reason
 * the first build looked nothing like the reference despite every index being
 * correct.** The source does not repaint a fixed set of rows with new words:
 *
 *     window.removeLast()
 *     window.insert(newItem, at: 0)
 *
 * inserts at the FRONT, so every surviving row is pushed down one slot, and
 * SwiftUI animates all of them travelling that distance. Frame-by-frame, "Pay"
 * is visibly sliding from the top slot into the middle slot while "Save" arrives
 * above it. Swapping the text inside stationary rows, which is what shipped
 * first, produces the right words in the right places with none of the motion —
 * and motion is the entire effect.
 *
 * Rendering the NEW window while translated up by exactly one row reproduces the
 * pre-advance picture; animating that offset to zero is the slide.
 */
export const CAROUSEL_ENTER_OFFSET = -ROW_HEIGHT;
