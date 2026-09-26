import { TOKENS } from '../theme/tokens';

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

/**
 * THE HOME PICKS STRIP: portrait "story" cards, not the centred hero above.
 *
 * Amit, 2026-09-26: the hero crops faces, so the cards go PORTRAIT 3:4 and the
 * selfie shows whole, about 2.3 cards across a 384dp screen, like the
 * reference's story cards. That is Android's UNCONTAINED carousel, not its
 * hero: "items that are a single size and flow past the edge of the screen",
 * sized by an exact `itemWidth` rather than derived from the column
 * (https://developer.android.com/develop/ui/compose/components/carousel). So
 * the width is a fixed dp and a wider screen shows more cards, not bigger
 * ones. The centred hero geometry above stays for the profile photo pager.
 *
 * 3:4 because that is the crop migration 087 stores every avatar at, so a
 * 150x200 request is a resize, not a crop: the whole selfie, face ~34% down.
 */
export const HERO_CARD_WIDTH = 150;
export const HERO_CARD_HEIGHT = (HERO_CARD_WIDTH * 4) / 3;
/** Card-to-card gap, the `space.xs` the centred hero used. */
export const HERO_CARD_GAP = TOKENS.space.xs;

/**
 * How many cards a column shows at rest, the strip inset from the leading edge:
 * (column - inset) / (width + gap). At 384dp with the 16dp page inset that is
 * 368 / 158 = 2.33, the "about 2.3" asked for; 2.18 on a 360dp phone, 2.51 on
 * a 412dp one. Always a fraction, which is what tells the eye the strip scrolls.
 */
export function heroCardsVisible(columnWidth: number, inset: number): number {
  return (columnWidth - inset) / (HERO_CARD_WIDTH + HERO_CARD_GAP);
}
