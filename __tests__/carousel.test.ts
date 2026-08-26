import {
  carouselSlot,
  lapMs,
  type CarouselSlot,
  type FadeStep,
} from '../src/lib/carousel';

/**
 * The word carousel's arithmetic.
 *
 * These are not "does it animate" tests, which nothing here could answer. They
 * are about one failure: drift. Three rows each run their own repeating
 * animation with a fixed phase offset, and if a row's steps do not sum to exactly
 * one lap then the rows fall out of step, by a few milliseconds a lap, so it
 * looks perfect for the first minute and then two words are lit at once on a
 * screen nobody watches for a minute. That is a statement about a sum, and a sum
 * is testable.
 */

const DWELL = 1100;
const SWAP = 240;
const REST = 0.1;

const slots = (count: number, swap: number = SWAP): CarouselSlot[] =>
  Array.from({ length: count }, (_, index) =>
    carouselSlot(index, count, DWELL, swap, REST),
  );

/** Indexing under `noUncheckedIndexedAccess`, loudly rather than with a `!`. */
function stepAt(slot: CarouselSlot, index: number): FadeStep {
  const step = slot.steps[index];
  if (step === undefined) {
    throw new Error(`slot has no step ${index}`);
  }
  return step;
}

function slotAt(all: CarouselSlot[], index: number): CarouselSlot {
  const slot = all[index];
  if (slot === undefined) {
    throw new Error(`no slot ${index}`);
  }
  return slot;
}

describe('carouselSlot', () => {
  it('gives every row exactly one lap of steps', () => {
    // The drift assertion, and the reason this module exists apart from the
    // component. One lap is count * dwell for every row, whichever row it is.
    for (const count of [2, 3, 4, 6]) {
      for (const slot of slots(count)) {
        expect(lapMs(slot)).toBe(count * DWELL);
      }
    }
  });

  it('offsets each row by one dwell, outside the repeat', () => {
    const all = slots(3);
    expect(slotAt(all, 0).delayMs).toBe(0);
    expect(slotAt(all, 1).delayMs).toBe(DWELL);
    expect(slotAt(all, 2).delayMs).toBe(2 * DWELL);
    // Same steps, different offsets: the offset is what makes them a sequence,
    // and it is applied once rather than per lap. Inside the repeat it would
    // accumulate and row three would be a word behind by the second pass.
    expect(slotAt(all, 1).steps).toEqual(slotAt(all, 0).steps);
    expect(slotAt(all, 2).steps).toEqual(slotAt(all, 0).steps);
  });

  it('hands over at exactly the moment the previous row starts leaving', () => {
    // A gap here reads as a blink and an overlap reads as two lit words. Both
    // rows should be mid-transition over the same interval, which is what makes
    // the pair one cross-fade rather than two fades.
    const all = slots(3);
    const first = slotAt(all, 0);
    const second = slotAt(all, 1);
    const fadeDownStartsAt =
      first.delayMs + stepAt(first, 0).ms + stepAt(first, 1).ms;
    expect(fadeDownStartsAt).toBe(second.delayMs);
    // And they take the same time, so they cross at the midpoint.
    expect(stepAt(first, 2).ms).toBe(stepAt(second, 0).ms);
  });

  it('spends most of a dwell holding still rather than moving', () => {
    // A word that is perpetually in transition cannot be read. The plateau is
    // the majority of the dwell, not an afterthought at the end of it.
    const slot = slotAt(slots(3), 0);
    const fadeUp = stepAt(slot, 0);
    const hold = stepAt(slot, 1);
    expect(fadeUp.ms).toBe(SWAP);
    expect(hold.ms).toBe(DWELL - SWAP);
    expect(hold.ms).toBeGreaterThan(fadeUp.ms);
    expect(hold.to).toBe(1);
  });

  it('rests at the neighbour opacity between its turns', () => {
    const slot = slotAt(slots(3), 0);
    expect(stepAt(slot, 0).to).toBe(1);
    expect(stepAt(slot, 1).to).toBe(1);
    expect(stepAt(slot, 2).to).toBe(REST);
    expect(stepAt(slot, 3).to).toBe(REST);
  });

  it('never emits a negative duration, whatever the swap', () => {
    // A negative duration is a frozen row rather than an error anybody sees, so
    // an absurd swap is clamped instead of trusted.
    for (const swap of [0, 240, DWELL, DWELL * 4]) {
      for (const slot of slots(3, swap)) {
        for (const step of slot.steps) {
          expect(step.ms).toBeGreaterThanOrEqual(0);
        }
        expect(lapMs(slot)).toBe(3 * DWELL);
      }
    }
  });

  it('refuses to loop what cannot advance', () => {
    // One word is not a carousel, and the component renders it statically. An
    // empty slot is how this says so.
    expect(carouselSlot(0, 1, DWELL, SWAP, REST).steps).toEqual([]);
    expect(carouselSlot(0, 0, DWELL, SWAP, REST).steps).toEqual([]);
    // And an index nothing owns, which is the shape of an off-by-one in a caller.
    expect(carouselSlot(3, 3, DWELL, SWAP, REST).steps).toEqual([]);
    expect(carouselSlot(-1, 3, DWELL, SWAP, REST).steps).toEqual([]);
  });
});
