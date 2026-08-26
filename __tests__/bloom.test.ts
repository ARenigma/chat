import { readFileSync } from 'fs';
import { join } from 'path';
import {
  BLOOM_PALETTES,
  BLOOM_CONTENT_MS,
  BLOOM_FIELD_MS,
  BLOOM_HOLD_MS,
  BLOOM_LAYERS,
  BLOOM_LAYER_MS,
  bloomExitGradient,
  bloomLayerBox,
  bloomRestGradient,
  bloomTravel,
  layerProgress,
  colorFor,
  whiteZoneFraction,
} from '../src/lib/bloom';
import {
  COLUMN_HEIGHT,
  COLUMN_OFFSET,
  DIM_OPACITY,
  HIGHLIGHT_INDEX,
  ROW_HEIGHT,
  WINDOW_SIZE,
  highlightedAt,
  windowAt,
} from '../src/lib/carouselWindow';

const ROOT = join(__dirname, '..');
const read = (p: string): string => readFileSync(join(ROOT, p), 'utf8');

/**
 * The field is three layers, and the number is the design.
 *
 * Every one of these values was measured against the Fuse onboarding source
 * rather than chosen, so the tests exist to stop somebody "simplifying" the
 * construction back into the single multi-stop gradient it took three rounds to
 * prove wrong.
 */
describe('the bloom field', () => {
  it('is three layers, not one gradient', () => {
    // One ramp interpolates between opaque stops and looks printed. Three
    // transparent layers composite, and that is what produces depth.
    expect(BLOOM_LAYERS).toHaveLength(3);
  });

  it('nests the layers so they overlap across the whole frame', () => {
    // Each layer must sit inside the next one out, or they stop compositing and
    // start banding.
    for (let i = 1; i < BLOOM_LAYERS.length; i++) {
      const inner = BLOOM_LAYERS[i];
      const outer = BLOOM_LAYERS[i - 1];
      expect(inner).toBeDefined();
      expect(outer).toBeDefined();
      expect(inner!.endRadius).toBeLessThan(outer!.endRadius);
      expect(inner!.restStart).toBeLessThan(outer!.restStart);
    }
  });

  it('keeps every layer wider than the half-width of a phone', () => {
    /*
     * The defect this catches, which cost a whole round: on a 402pt frame the
     * half-width is 201, so a layer whose endRadius is under that has already
     * faded before it reaches the bottom corners and the field visibly drains
     * toward the edges. My first attempt used 250 and did exactly that.
     */
    const HALF_WIDTH = 201;
    for (const layer of BLOOM_LAYERS) {
      expect(layer.endRadius).toBeGreaterThan(HALF_WIDTH);
    }
  });

  it('holds a solid core at rest and collapses it on exit', () => {
    /*
     * `restStart` is why the field snaps to saturation instead of drifting up
     * through pastels, and the collapse to `exitStart` is why it disperses at
     * the top instead of arriving there as the same saturated pool. Both halves
     * are in the source's `startRadius: phase > 0 ? 0 : 300` ternary and my
     * first translation kept only the first half.
     */
    for (const layer of BLOOM_LAYERS) {
      expect(layer.restStart).toBeGreaterThan(0);
      expect(layer.restStart).toBeLessThan(layer.endRadius);
      expect(layer.exitStart).toBeLessThan(layer.restStart);
    }
  });

  it('never changes a layer\'s size, only its centre and its core', () => {
    /*
     * The defect that made the first build read as a curtain rather than as
     * light: I translated each layer off the top of the screen and faded it out.
     * The source does neither. `endRadius` is a constant in every one of its
     * three declarations, and `.clear` lives inside the gradient rather than on
     * the view, so the layer never has an opacity of its own.
     */
    for (const layer of BLOOM_LAYERS) {
      const rest = bloomRestGradient(layer, BLOOM_PALETTES.welcome);
      const exit = bloomExitGradient(layer, BLOOM_PALETTES.welcome);
      // Same colour, same falloff distance; only the solid stop differs.
      const hue = colorFor(layer, BLOOM_PALETTES.welcome);
      expect(rest).toContain(hue);
      expect(exit).toContain(hue);
      /*
       * The terminal stop must be the layer's own hue at alpha 0, and must NOT
       * be the keyword `transparent`. That keyword is transparent BLACK, and on
       * API levels that interpolate non-premultiplied (API 24, the minSdk
       * floor, verified on device 2026-08-26) a colour fading to it drags every
       * midpoint toward black — the field rendered brown and the carousel scrim
       * as a hard grey band. Alpha-0-of-same-hue is identical under both
       * interpolation conventions.
       */
      expect(rest).toMatch(/rgba\(\d+,\d+,\d+,0\) 100%/);
      expect(exit).toMatch(/rgba\(\d+,\d+,\d+,0\) 100%/);
      expect(rest).not.toMatch(/[^(]transparent 100%/);
      expect(rest).not.toBe(exit);
    }
  });

  it('moves each centre from the bottom edge to the top', () => {
    const H = 874;
    for (const layer of BLOOM_LAYERS) {
      // Negative: the field travels up. Magnitude is at least a full screen,
      // because rest is the bottom edge and exit is the top edge or above it.
      expect(bloomTravel(layer, H)).toBeLessThanOrEqual(-H);
    }
    // The innermost layer overshoots the top edge, per `.init(x: 0.5, y: -0.2)`.
    const core = BLOOM_LAYERS.find(l => l.name === 'core');
    expect(core).toBeDefined();
    expect(bloomTravel(core!, H)).toBeLessThan(-H);
  });

  it('leads with the narrowest layer, not the widest', () => {
    /*
     * The source reads 0.65 / 0.52 / 0.40 down the file, widest first, so the
     * LONGEST delay belongs to the WIDEST layer and the innermost core moves
     * first. I had this inverted, which turns a field unfurling into a field
     * collapsing, and nothing in a still frame would ever show it.
     */
    for (let i = 1; i < BLOOM_LAYERS.length; i++) {
      expect(BLOOM_LAYERS[i]!.delayMs).toBeLessThan(BLOOM_LAYERS[i - 1]!.delayMs);
    }
  });

  it('gives every layer the same run once it starts', () => {
    // Each gradient carries its own `.smooth`, so delays stagger the starts but
    // do not compress the movement. Normalising delays against the total, which
    // is what I did first, makes every layer a different speed.
    expect(BLOOM_FIELD_MS).toBe(
      Math.max(...BLOOM_LAYERS.map(l => l.delayMs)) + BLOOM_LAYER_MS,
    );
    for (const layer of BLOOM_LAYERS) {
      expect(layerProgress(layer.delayMs, layer.delayMs)).toBe(0);
      expect(layerProgress(layer.delayMs + BLOOM_LAYER_MS, layer.delayMs)).toBe(1);
      // Still moving when the field's clock stops? Then it would snap.
      expect(layer.delayMs + BLOOM_LAYER_MS).toBeLessThanOrEqual(BLOOM_FIELD_MS);
    }
  });

  it('clamps and eases each layer rather than running it linearly', () => {
    expect(layerProgress(0, 400)).toBe(0);
    expect(layerProgress(99999, 400)).toBe(1);
    // Eased, so the midpoint is 0.5 but the quarter point is not 0.25.
    expect(layerProgress(400 + BLOOM_LAYER_MS / 2, 400)).toBeCloseTo(0.5, 5);
    expect(layerProgress(400 + BLOOM_LAYER_MS / 4, 400)).toBeLessThan(0.25);
  });

  it('lets the content leave before the field is done', () => {
    // The source's 0.7s content transition against a 1.2s handoff is what
    // leaves colour alone on screen. Equal values remove the pause entirely.
    expect(BLOOM_CONTENT_MS).toBeLessThan(BLOOM_HOLD_MS);
  });

  it('staggers the layers so the exit is not a wipe', () => {
    // The source uses 0.65 / 0.52 / 0.40. Equal delays collapse the whole effect
    // into one sliding picture. Direction is asserted separately.
    const delays = BLOOM_LAYERS.map(l => l.delayMs);
    expect(new Set(delays).size).toBe(delays.length);
  });

  it('leaves roughly the reference proportion of the screen untouched', () => {
    // Fuse measured 44.9% clean white above its field. Anything much under 40%
    // and the screen stops breathing; much over 55% and the field stops
    // reading as a field.
    const fraction = whiteZoneFraction(874);
    expect(fraction).toBeGreaterThan(0.38);
    expect(fraction).toBeLessThan(0.55);
  });

  it('emits a radial gradient whose first stop is the solid core', () => {
    const layer = BLOOM_LAYERS[0]!;
    const style = bloomLayerBox(layer, 402);
    const gradient = bloomRestGradient(layer, BLOOM_PALETTES.welcome);
    const expected = Math.round((layer.restStart / layer.endRadius) * 100);
    expect(gradient).toContain('radial-gradient(circle');
    /*
     * The sizing keyword, asserted because dropping it is invisible in code and
     * catastrophic on screen: without it the circle is sized to the farthest
     * corner, is still opaque where the box clips, and the field renders as
     * three hard-edged rectangles.
     */
    expect(gradient).toContain('closest-side');
    // Square, or `closest-side` picks the wrong side.
    expect(style.width).toBe(style.height);
    expect(gradient).toContain(`${expected}%`);
    // Fading to ALPHA ZERO, never to an opaque colour: this is the property
    // that distinguishes the construction from a plain ramp. Alpha-0 of the
    // layer's own hue, not the keyword `transparent` — see the note above.
    expect(gradient).toMatch(/rgba\(\d+,\d+,\d+,0\) 100%/);
    expect(style.height).toBe(layer.endRadius * 2);
    expect(style.bottom).toBe(-layer.endRadius);
  });

  it('pins the React Native version, because the gradient API is unstable', () => {
    /*
     * `experimental_backgroundImage` is prefixed for a reason. If an upgrade
     * renames or drops it the field silently becomes a blank white view and
     * nothing else fails, so the version that is known to support it is
     * asserted here rather than trusted.
     */
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['react-native']).toMatch(/^0\.86\./);
    const types = read(
      'node_modules/react-native/Libraries/StyleSheet/StyleSheetTypes.d.ts',
    );
    expect(types).toContain("type: 'radial-gradient'");
    expect(types).toContain('experimental_backgroundImage');
  });

  it('needs no gradient or svg dependency', () => {
    // react-native-svg is banned here for killing touch inside Reanimated
    // subtrees, and the field must never become the reason it comes back.
    const pkg = JSON.parse(read('package.json')) as {
      dependencies: Record<string, string>;
    };
    for (const name of Object.keys(pkg.dependencies)) {
      expect(name).not.toMatch(/svg|linear-gradient/i);
    }
  });
});

/**
 * The carousel window, whose three surprises all came from the source and none
 * of which are visible in a screenshot.
 */
describe('the word carousel window', () => {
  const COUNT = 4;

  it('highlights the middle row, not the first', () => {
    // Reading a screenshot suggests the top word is the active one. It is not:
    // the source highlights window[2] of five, so the eye lands in the centre
    // of the block and there is always a row entering and leaving.
    expect(HIGHLIGHT_INDEX).toBe(2);
    expect(WINDOW_SIZE).toBe(5);
    expect(HIGHLIGHT_INDEX).toBeGreaterThan(0);
    expect(HIGHLIGHT_INDEX).toBeLessThan(WINDOW_SIZE - 1);
  });

  it('renders more rows than it shows', () => {
    // Five rows in a three-row frame is what gives the movement runway.
    expect(WINDOW_SIZE).toBeGreaterThan(3);
    expect(windowAt(0, COUNT)).toHaveLength(WINDOW_SIZE);
  });

  it('never produces a negative index', () => {
    /*
     * The source writes `((index - 1) + count) % count` rather than `index % count`
     * precisely because JavaScript-style modulo returns negatives, and a negative
     * index here means a blank row on the first tick.
     */
    for (let tick = -8; tick <= 8; tick++) {
      for (const value of windowAt(tick, COUNT)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThan(COUNT);
      }
    }
  });

  it('reproduces the source array exactly, position by position', () => {
    /*
     * The assertion that would have caught the direction bug the highlighted-row
     * checks could not.
     *
     * `TextCarousel.onAppear` fills the window with items 0..4 in order, and each
     * tick does `removeLast()` then `insert(at: 0)`. So tick 1 is the last item
     * pushed onto the front of the first four. Checking only `window[2]` is
     * blind to a reversed window, because the centre of five is a fixed point of
     * the reversal — which is exactly how a stack that crawled upward instead of
     * downward passed every test here.
     */
    const FIVE = 5;
    expect(windowAt(0, FIVE)).toEqual([0, 1, 2, 3, 4]);
    expect(windowAt(1, FIVE)).toEqual([4, 0, 1, 2, 3]);
    expect(windowAt(2, FIVE)).toEqual([3, 4, 0, 1, 2]);
  });

  it('moves every row DOWN one slot per tick', () => {
    // Inserting at the front means position r inherits from position r-1. The
    // rows travelling is the whole visual effect; getting this backwards leaves
    // the words correct and the motion inverted.
    const FIVE = 5;
    const before = windowAt(0, FIVE);
    const after = windowAt(1, FIVE);
    for (let row = 1; row < FIVE; row++) {
      expect(after[row]).toBe(before[row - 1]);
    }
  });

  it('advances BACKWARDS one word per tick, as the source does', () => {
    /*
     * This assertion is the reason the carousel shipped running the wrong way.
     * It used to read `(a + 1) % COUNT`, which is a perfectly good test of "moves
     * by one" and says nothing at all about direction, so an implementation that
     * incremented passed it while the source decrements:
     *
     *     window.removeLast(); window.insert(newItem, at: 0)
     *     index = ((index - 1) + items.count) % items.count
     *
     * New items enter at the TOP and the index counts DOWN, so the words travel
     * downward through the frame. Writing the test in the source's own form is
     * what makes it capable of failing.
     */
    const a = highlightedAt(0, COUNT);
    const b = highlightedAt(1, COUNT);
    expect(b).toBe((a - 1 + COUNT) % COUNT);
  });

  it('returns to the start after a full cycle', () => {
    expect(highlightedAt(COUNT, COUNT)).toBe(highlightedAt(0, COUNT));
  });

  it('survives an empty or single-word list', () => {
    expect(windowAt(3, 0)).toEqual([]);
    expect(new Set(windowAt(3, 1))).toEqual(new Set([0]));
  });

  it('hangs a row off each end of the frame', () => {
    /*
     * Five 80pt rows in a 240pt frame means one row must overflow at the top for
     * the middle of the window to be the middle of the frame. A zero or positive
     * offset puts rows 0 and 1 in view and clips the highlighted row entirely,
     * which is what the first build shipped: one dim word and no carousel, with
     * every test passing because the window arithmetic was never wrong.
     */
    expect(COLUMN_OFFSET).toBe(-ROW_HEIGHT);
    expect(COLUMN_OFFSET + WINDOW_SIZE * ROW_HEIGHT).toBeGreaterThan(COLUMN_HEIGHT);
    // The highlighted row must land inside the visible frame.
    const highlightTop = COLUMN_OFFSET + HIGHLIGHT_INDEX * ROW_HEIGHT;
    expect(highlightTop).toBeGreaterThanOrEqual(0);
    expect(highlightTop + ROW_HEIGHT).toBeLessThanOrEqual(COLUMN_HEIGHT);
  });

  it('dims unselected rows to the source value', () => {
    // 0.2, not the 0.1 a screenshot suggests. At 0.1 the neighbours vanish and
    // the column reads as one floating word.
    expect(DIM_OPACITY).toBe(0.2);
  });
});
