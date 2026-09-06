/**
 * The geometry and the index arithmetic of a centred, endless hero carousel.
 *
 * Pure, because every part of this that can be wrong is arithmetic: which item
 * is focused, where the strip has to jump back to, and how wide an item must be
 * for the two neighbours to peek by the same amount. The component around it
 * (components/HeroCarousel.tsx) only owns the ScrollView.
 *
 * Amit, 2026-09-06: "hero in middle and both sides peek and endless rotation".
 * That is a departure from M3's hero, which peeks on the trailing side only —
 * stated at the component.
 */

/**
 * How wide the focused card is, given the column it sits in.
 *
 * Derived so that BOTH neighbours show exactly `peek` dp:
 *
 *   item = column − 2 × (peek + gap)
 *
 * and the strip's horizontal content padding is `peek + gap`, which is what
 * puts the focused item in the middle of the column rather than at its edge.
 * Floored at a readable width so a 320dp phone narrows the peek rather than
 * the card.
 */
export function heroItemWidth(columnWidth: number, peek: number, gap: number): number {
  const ideal = columnWidth - 2 * (peek + gap);
  return Math.max(Math.min(ideal, columnWidth), Math.min(220, columnWidth));
}

/** The distance from one focused item to the next: the card plus one gap. */
export function heroPitch(itemWidth: number, gap: number): number {
  return itemWidth + gap;
}

/** The inset that centres the focused card. Equals what each neighbour shows, plus the gap. */
export function heroInset(columnWidth: number, itemWidth: number): number {
  return Math.max(0, (columnWidth - itemWidth) / 2);
}

/**
 * How many copies of the list the strip holds so it can be swiped forever.
 *
 * Three: one to the left to swipe back into, one in the middle to sit in, one
 * to the right to swipe forward into. Two would leave one direction ending, and
 * five would just be more images mounted for no extra runway.
 */
export const HERO_COPIES = 3;

/** Where the strip starts: the first item of the middle copy. */
export function heroInitialOffset(count: number, pitch: number): number {
  return count * pitch;
}

/** Which of the ORIGINAL items is focused at this scroll offset. */
export function heroFocusedIndex(offset: number, pitch: number, count: number): number {
  if (count <= 0 || pitch <= 0) {
    return 0;
  }
  const slot = Math.round(offset / pitch);
  return ((slot % count) + count) % count;
}

/**
 * The offset to jump to, without animation, to put the strip back in the middle
 * copy — or null when it is already there and nothing should move.
 *
 * Called when a swipe settles. Jumping by exactly one copy's width keeps the
 * focused item under the finger: the card does not change, only which of the
 * three identical copies is being looked at, so the wrap is invisible.
 */
export function heroRecentre(
  offset: number,
  pitch: number,
  count: number,
): number | null {
  if (count <= 0 || pitch <= 0) {
    return null;
  }
  const slot = Math.round(offset / pitch);
  const span = count * pitch;
  if (slot < count) {
    return offset + span;
  }
  if (slot >= count * 2) {
    return offset - span;
  }
  return null;
}

/**
 * `count × HERO_COPIES` indices, each mapped back to the item it shows.
 *
 * Returned as a list of `{ key, index }` so the caller can render stable keys —
 * three copies of the same provider id would otherwise collide.
 */
export function heroSlots(count: number): { key: string; index: number }[] {
  const slots: { key: string; index: number }[] = [];
  for (let copy = 0; copy < HERO_COPIES; copy += 1) {
    for (let i = 0; i < count; i += 1) {
      slots.push({ key: `${copy}-${i}`, index: i });
    }
  }
  return slots;
}

/** Looping needs at least two items; one item wrapping to itself is a still image. */
export function heroCanLoop(count: number): boolean {
  return count >= 2;
}
