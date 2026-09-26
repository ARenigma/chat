import { TOKENS } from '../src/theme/tokens';
import {
  HERO_CARD_GAP,
  HERO_CARD_HEIGHT,
  HERO_CARD_WIDTH,
  HERO_COPIES,
  heroCardsVisible,
  heroCanLoop,
  heroFocusedIndex,
  heroInitialOffset,
  heroInset,
  heroItemWidth,
  heroPitch,
  heroRecentre,
  heroSlots,
} from '../src/lib/carousel';

describe('carousel geometry: the focused card is centred and both sides peek', () => {
  it('makes both neighbours show the same peek', () => {
    const column = 360;
    const peek = 32;
    const gap = 8;
    const item = heroItemWidth(column, peek, gap);
    expect(item).toBe(280);
    // The inset that centres the card equals the peek plus the gap, which is
    // what makes the peek symmetric.
    expect(heroInset(column, item)).toBe(peek + gap);
  });

  it('narrows the peek rather than the card on a small phone', () => {
    // A 320dp phone with the same peek would leave a 240dp card; the floor
    // keeps the card readable and lets the neighbours show less.
    expect(heroItemWidth(320, 32, 8)).toBe(240);
    expect(heroItemWidth(280, 60, 8)).toBe(220);
    // Never wider than the column it sits in.
    expect(heroItemWidth(200, 4, 4)).toBeLessThanOrEqual(200);
  });

  it('pitches by the card plus one gap', () => {
    expect(heroPitch(280, 8)).toBe(288);
  });
});

describe('carousel arithmetic: endless in both directions', () => {
  const count = 3;
  const pitch = 288;

  it('starts in the middle copy, so the first swipe back has somewhere to go', () => {
    expect(HERO_COPIES).toBe(3);
    expect(heroInitialOffset(count, pitch)).toBe(864);
    expect(heroSlots(count)).toHaveLength(count * HERO_COPIES);
    // Stable, non-colliding keys: three copies of the same provider id would.
    expect(new Set(heroSlots(count).map(s => s.key)).size).toBe(count * HERO_COPIES);
    expect(heroSlots(count).map(s => s.index)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2]);
  });

  it('maps any offset back to the item being shown', () => {
    expect(heroFocusedIndex(864, pitch, count)).toBe(0);
    expect(heroFocusedIndex(864 + pitch, pitch, count)).toBe(1);
    expect(heroFocusedIndex(864 + pitch * 2, pitch, count)).toBe(2);
    expect(heroFocusedIndex(864 + pitch * 3, pitch, count)).toBe(0);
    // Half a card past a slot still reads as that slot until it passes the middle.
    expect(heroFocusedIndex(864 + pitch * 0.4, pitch, count)).toBe(0);
    expect(heroFocusedIndex(0, pitch, count)).toBe(0);
    expect(heroFocusedIndex(0, 0, count)).toBe(0);
  });

  it('jumps a whole copy so the wrap is invisible', () => {
    const span = count * pitch;
    // Sitting in the middle copy: nothing to do.
    expect(heroRecentre(864, pitch, count)).toBeNull();
    expect(heroRecentre(864 + pitch, pitch, count)).toBeNull();
    expect(heroRecentre(864 + pitch * 2, pitch, count)).toBeNull();
    // Swiped back into the first copy: jump forward one copy.
    expect(heroRecentre(pitch * 2, pitch, count)).toBe(pitch * 2 + span);
    expect(heroRecentre(0, pitch, count)).toBe(span);
    // Swiped forward into the third: jump back one copy.
    expect(heroRecentre(pitch * 6, pitch, count)).toBe(pitch * 6 - span);
    // And the jump always keeps the SAME item focused, which is what makes it
    // invisible.
    for (const offset of [0, pitch, pitch * 2, pitch * 6, pitch * 7, pitch * 8]) {
      const next = heroRecentre(offset, pitch, count);
      if (next !== null) {
        expect(heroFocusedIndex(next, pitch, count)).toBe(
          heroFocusedIndex(offset, pitch, count),
        );
      }
    }
  });

  it('does not loop what cannot loop', () => {
    expect(heroCanLoop(0)).toBe(false);
    expect(heroCanLoop(1)).toBe(false);
    expect(heroCanLoop(2)).toBe(true);
    expect(heroCanLoop(3)).toBe(true);
    expect(heroRecentre(0, pitch, 0)).toBeNull();
  });
});

describe('the Home picks are portrait story cards, 2.3 across a 384dp phone', () => {
  it('is 3:4, the crop every avatar is stored at, so the selfie shows whole', () => {
    // Migration 087 stores avatars at 3:4; a 3:4 request is a resize, not a
    // crop, which is the whole point (Amit, 2026-09-26: the hero cropped faces).
    expect(HERO_CARD_WIDTH).toBe(150);
    expect(HERO_CARD_HEIGHT).toBe(200);
    expect(HERO_CARD_HEIGHT / HERO_CARD_WIDTH).toBeCloseTo(4 / 3, 10);
    expect(HERO_CARD_GAP).toBe(TOKENS.space.xs);
  });

  it('shows about 2.3 cards at 384dp, and always a fraction', () => {
    const inset = TOKENS.space.md;
    expect(heroCardsVisible(384, inset)).toBeCloseTo(2.33, 2);
    // A fixed item width (Android's uncontained carousel): wider phones show
    // more cards rather than bigger ones, and every common width shows a
    // partial card at the edge, which is the cue that the strip scrolls.
    for (const w of [360, 384, 393, 412]) {
      const visible = heroCardsVisible(w, inset);
      expect(visible).toBeGreaterThan(2);
      expect(visible).toBeLessThan(3);
      expect(visible % 1).toBeGreaterThan(0.1);
    }
  });
});
