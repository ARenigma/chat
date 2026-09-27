/**
 * The bloom field's geometry, colour and motion, kept pure so it can be tested.
 *
 * Same split as `src/lib/spinner.ts` and `src/lib/collapse.ts`, and for the same
 * reason: anything that imports `react-native` cannot be imported under jest,
 * and the numbers here are exactly the numbers worth asserting.
 *
 * This is a translation of `OnboardingFlow.swift` from the Fuse onboarding
 * source, not of a screenshot of it. The whole field is three radial gradients
 * over white, and both their rest state and their exit are declared in one
 * ternary each:
 *
 *     RadialGradient([g0, .clear], center: phase > 0 ? .top : .bottom,
 *                    startRadius: phase > 0 ? 0  : 300, endRadius: 500)
 *       .animation(.smooth.delay(0.65), value: phase > 0)
 *     RadialGradient([g1, .clear], center: phase > 0 ? .top : .bottom,
 *                    startRadius: phase > 0 ? 50 : 200, endRadius: 450)
 *       .animation(.smooth.delay(0.52), value: phase > 0)
 *     RadialGradient([g2, .clear], center: phase > 0 ? .init(x:0.5,y:-0.2) : .bottom,
 *                    startRadius: phase > 0 ? 0  : 80,  endRadius: 350)
 *       .animation(.smooth.delay(0.40), value: phase > 0)
 *
 * Four properties of that are load-bearing, and my first translation got three
 * of them wrong by inventing a simpler motion:
 *
 *   1. **`endRadius` never changes.** The field does not slide off the top and it
 *      does not fade out. Its CENTRE travels from the bottom edge to the top
 *      while the circle stays exactly the same size. Translating the layer off
 *      screen and dropping its opacity, which is what I built first, reads as a
 *      curtain being pulled rather than as light moving through the frame.
 *   2. **`startRadius` collapses.** Each layer's solid core shrinks to nothing,
 *      so the field arrives at the top as a soft wash rather than as the
 *      saturated pool it was at the bottom. This is the part that makes the exit
 *      feel like dispersal.
 *   3. **The widest layer moves LAST.** The delays run 0.65, 0.52, 0.40 from
 *      widest to narrowest, so the innermost core leads and the outer wash
 *      trails it. I had this inverted, which turns a field unfurling into a
 *      field collapsing.
 *   4. **The third layer overshoots the top edge**, to `y: -0.2`, so it clears
 *      the frame while the other two are still arriving.
 *
 * Each layer fades to TRANSPARENT rather than to the page colour, so overlaps
 * composite rather than interpolate. That is what produces depth, and it does
 * not survive being flattened into one multi-stop gradient.
 */

export interface BloomLayer {
  readonly name: 'wash' | 'glow' | 'core';
  /** Solid out to here at rest, in points from the centre. */
  readonly restStart: number;
  /** Solid out to here once the field has left. The collapse is the effect. */
  readonly exitStart: number;
  /** Fully transparent by here, at rest and on exit alike. Never animates. */
  readonly endRadius: number;
  /**
   * Where the circle's centre ends up, as a fraction of screen height.
   * 0 is the top edge; negative is above it. Rest is always 1, the bottom edge.
   */
  readonly exitCenterY: number;
  /** Milliseconds this layer waits before it starts, from the source. */
  readonly delayMs: number;
}

/**
 * Ordered back to front, which is also widest to narrowest.
 *
 * Geometry only. Colour lives in `BLOOM_PALETTES` because it is the one property
 * that changes DURING the flow rather than at the start of it: the source
 * reassigns `gradient` on every step submit, and the same three
 * `.animation(.smooth.delay(...))` modifiers that move the field also carry the
 * new colour in. That is the oscillation you see on each tap.
 *
 * Radii are the source's own and they matter at this exact scale: on a 402pt
 * frame the half-width is 201, so a layer ending nearer than that has already
 * faded by the time it reaches the bottom corners and the field visibly drains
 * toward the edges.
 *
 * Each palette is MONOCHROMATIC — wash, glow and core are one hue at three
 * lightnesses, not three hues. This is the load-bearing fact behind the field's
 * smoothness, and it is why the earlier orange-wash/magenta-core tuning read as a
 * "sunset gradient" rather than an atmospheric wash: three DIFFERENT hues stacked
 * composite into a 60° hue sweep, which smears the structure; three shades of ONE
 * hue composite into a clean feathered edge above a saturated plateau — the two
 * zones Fuse's blue bloom shows when you sample it (a light feather L~78% ramping
 * into a flat L~52% core). Measured against `fusewallet_onboarding.mp4`,
 * 2026-09-02: our welcome now feathers L~85% → a flat L~50% plateau, the same
 * two-zone break.
 *
 * The deep bottom / bright band above is still the arrangement: the widest layer
 * (wash) is the palest and reaches highest, the narrow core is the deepest and
 * pools at the bottom edge — deep at the bottom, light above, as the shipped Fuse
 * app measures.
 */
export const BLOOM_LAYERS: readonly BloomLayer[] = [
  {
    name: 'wash',
    restStart: 300,
    exitStart: 0,
    endRadius: 500,
    exitCenterY: 0,
    delayMs: 650,
  },
  {
    name: 'glow',
    restStart: 200,
    exitStart: 50,
    endRadius: 450,
    exitCenterY: 0,
    delayMs: 520,
  },
  {
    // DEVIATION from the source, stated per RULE 1. The source's core `startRadius`
    // is 80 (a small solid pool). Widened to 190 so the deepest colour holds a
    // FLAT plateau across the bottom ~22% of the frame instead of feathering
    // immediately — which, with the monochromatic palette, reproduces the distinct
    // two-zone break the shipped Fuse bloom shows and a literal 80 does not. The
    // trade is a slightly larger saturated field; approved on-device against the
    // reference video (2026-09-02, "B — deep+wide"). Everything else here is the
    // source's own measure.
    name: 'core',
    restStart: 190,
    exitStart: 0,
    endRadius: 350,
    // The source's `.init(x: 0.5, y: -0.2)` — above the top edge, not on it.
    exitCenterY: -0.2,
    delayMs: 400,
  },
] as const;

/**
 * How long one layer takes once it starts moving.
 *
 * SwiftUI's `.smooth` is a critically damped spring with a 0.5s default
 * duration, and each gradient carries its own `.animation(.smooth.delay(x))`
 * which overrides the 0.7s the phase change is wrapped in. So the layers are not
 * squeezed into 700ms: they each run 500ms from their own start.
 */
export const BLOOM_LAYER_MS = 500;

/** The last layer to finish sets the length of the whole field animation. */
export const BLOOM_FIELD_MS =
  Math.max(...BLOOM_LAYERS.map(l => l.delayMs)) + BLOOM_LAYER_MS;

/**
 * How long the content takes to leave, and how long the field is alone.
 *
 * The source runs `withAnimation(.smooth(duration: 0.7))` on the phase change
 * and then waits 1.2s before the form arrives, so there is a stretch with
 * nothing on screen but moving colour. That pause is the transition rather than
 * a gap before it.
 */
export const BLOOM_CONTENT_MS = 700;
export const BLOOM_HOLD_MS = 1200;

/** The long edge of the iPhone frame the source's point radii were authored on. */
export const FUSE_REFERENCE_LONG_EDGE = 874;

/**
 * Preserve the source field's spatial proportions on other window sizes.
 *
 * Copying 500/450/350 points literally is exact only on the 402×874 reference
 * frame. On a taller Android window it compresses the fade into a smaller share
 * of the viewport and makes the outer edge visibly sharper; on a short window
 * it does the opposite. Scaling every radius together keeps all three original
 * ratios and gives the reference frame a scale of exactly 1.
 */
export function bloomRadiusScale(screenWidth: number, screenHeight: number): number {
  return Math.max(screenWidth, screenHeight) / FUSE_REFERENCE_LONG_EDGE;
}

/**
 * Where the field stops and the page begins, as a fraction of screen height.
 *
 * Derived rather than declared: the widest layer reaches `endRadius` above the
 * bottom edge and everything above that is untouched page. On a 874pt screen
 * that is `1 - 500/874`, about 43%, against the reference's measured 44.9%.
 *
 * It is worth knowing because the rule the whole screen obeys depends on it:
 * nothing light-on-dark may sit above this line.
 */
export function whiteZoneFraction(screenHeight: number): number {
  const widest = Math.max(...BLOOM_LAYERS.map(l => l.endRadius));
  return Math.max(0, 1 - widest / screenHeight);
}

/**
 * A layer's box: square, and centred on the bottom edge of the screen.
 *
 * Square because the gradient is sized `closest-side`, and on a non-square box
 * that would pick the wrong side. `closest-side` itself is load-bearing: without
 * it the circle is sized to the box's farthest CORNER, so the ramp is still
 * opaque where the box clips and the field renders as three hard-edged
 * rectangles stacked up the screen. That is exactly what shipped to the emulator
 * on the first attempt.
 */
export function bloomLayerBox(
  layer: BloomLayer,
  screenWidth: number,
  radiusScale = 1,
): { width: number; height: number; left: number; bottom: number } {
  const radius = layer.endRadius * radiusScale;
  const diameter = radius * 2;
  return {
    width: diameter,
    height: diameter,
    left: (screenWidth - diameter) / 2,
    bottom: -radius,
  };
}

/**
 * One gradient string, at an arbitrary core size.
 *
 * `experimental_backgroundImage` is React Native 0.86's native CSS gradient
 * support. The prefix is real: this is unstable API, and `__tests__/bloom.test.ts`
 * pins the React Native version so an upgrade cannot silently drop the field to
 * a blank view.
 *
 * `circle` rather than `ellipse` because the source's radii are scalar; an
 * ellipse would stretch with the aspect ratio and change the falloff on a
 * tablet.
 */
/**
 * The same hue at alpha zero, which is NOT the same thing as `transparent`.
 *
 * The CSS keyword `transparent` is rgba(0,0,0,0) — transparent BLACK — and what
 * a gradient does between a colour and transparent black depends on whether the
 * renderer interpolates premultiplied. Non-premultiplied, every midpoint drags
 * toward black: coral fades through mud, white fades through grey. API 34/36
 * rendered our gradients premultiplied and looked right, which hid the bug;
 * API 24 does not, and the first boot on the minSdk floor showed a brown field
 * and a hard grey band exactly where `transparent` stops sat. Screenshotted,
 * 2026-08-26.
 *
 * Fading to the SAME hue at alpha 0 makes the interpolation identical under
 * both conventions, so this is the correct spelling on every API level rather
 * than a workaround for old ones.
 */
function fadeStop(color: string): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},0)`;
}

function bloomGradient(
  color: string,
  startRadius: number,
  endRadius: number,
): string {
  if (color === TRANSPARENT) {
    // The source's last step sets `gradient = (.clear, .clear, .clear)`, which
    // drains the field to white without unmounting it. A gradient from
    // transparent to transparent is exactly that and keeps every layer's
    // geometry intact, so a later step could bring colour back.
    return `radial-gradient(circle closest-side at 50% 50%, transparent 0%, transparent 100%)`;
  }
  const solidStop = Math.round((startRadius / endRadius) * 100);
  return (
    `radial-gradient(circle closest-side at 50% 50%, ` +
    `${color} 0%, ${color} ${solidStop}%, ${fadeStop(color)} 100%)`
  );
}

/**
 * The two gradients a layer cross-fades between, rest first.
 *
 * The source animates `startRadius` directly. `experimental_backgroundImage` is
 * not an animatable prop — it takes a string, and driving it per frame would
 * mean rebuilding the style on the JS thread sixty times a second — so the
 * collapse is reproduced by stacking both end states and cross-fading them.
 * Opacity is animatable on the UI thread, and two static strings interpolated by
 * opacity is visually identical to one string whose stop is interpolated.
 */
export function bloomRestGradient(layer: BloomLayer, palette: BloomPalette): string {
  return bloomGradient(colorFor(layer, palette), layer.restStart, layer.endRadius);
}

export function bloomExitGradient(layer: BloomLayer, palette: BloomPalette): string {
  return bloomGradient(colorFor(layer, palette), layer.exitStart, layer.endRadius);
}

/** The sentinel for the source's `.clear`: present, positioned, invisible. */
export const TRANSPARENT = 'transparent';

/**
 * One step's three colours, back to front.
 *
 * The source gives every form step its own tuple and swaps to it on submit. The
 * swap is not a fade to a flat colour: all three layers change at once and each
 * carries its own delay, so the field appears to turn over rather than to
 * repaint. That is why this is a triple and not a single hue.
 */
export interface BloomPalette {
  readonly name: string;
  readonly wash: string;
  readonly glow: string;
  readonly core: string;
}

export function colorFor(layer: BloomLayer, palette: BloomPalette): string {
  return layer.name === 'wash'
    ? palette.wash
    : layer.name === 'glow'
      ? palette.glow
      : palette.core;
}

/**
 * The palettes the flow moves through.
 *
 * **One palette per interaction, not one per step.** The source reassigns
 * `gradient` on EVERY submit, so the field turns over on every tap — that is the
 * feedback, and it is most of what makes the flow feel alive. The first build
 * here had a palette per step KEY rather than per state, so choosing the phone
 * route and then typing a number produced no change at all and the field shifted
 * exactly once in the whole flow. Every entry below is a place a finger lands.
 *
 * Each is a distinguishable turn of the same family rather than an unrelated
 * hue: the source uses blue -> orange -> purple, which it can afford because a
 * wallet has no colour story to protect. This app has one accent and the field is
 * the only place it appears at full strength, so the steps rotate WITHIN it.
 *
 * `done` is the source's `.clear`, which is what drains the screen to white
 * under the completion list.
 */
export const BLOOM_PALETTES = {
  welcome: { name: 'welcome', wash: '#FFAB92', glow: '#F87659', core: '#ED3312' },
  choose: { name: 'choose', wash: '#FFB392', glow: '#F88959', core: '#ED5412' },
  number: { name: 'number', wash: '#FF9B92', glow: '#F86659', core: '#ED2412' },
  code: { name: 'code', wash: '#FF92A4', glow: '#F85974', core: '#ED1237' },
  done: { name: 'done', wash: TRANSPARENT, glow: TRANSPARENT, core: TRANSPARENT },
  /** Provider step 0 — "You". Warm coral, distinct from the onboarding welcome. */
  providerYou: { name: 'providerYou', wash: '#FFA692', glow: '#F87659', core: '#ED3A12' },
  /** Provider step 1 — "How you talk". A step toward red-coral. */
  providerHow: { name: 'providerHow', wash: '#FF9D92', glow: '#F86959', core: '#ED2812' },
  /** Provider step 2 — "Why you". Deepest, edging to rose. */
  providerWhy: { name: 'providerWhy', wash: '#FF9297', glow: '#F85961', core: '#ED121D' },
} as const satisfies Record<string, BloomPalette>;

export type PaletteName = keyof typeof BLOOM_PALETTES;

/**
 * The icon tint for an onboarding step — its own wash tone, the way Fuse tints
 * each step's symbol with its `gradient.0`. Keyed by the step key (choose /
 * number / code); anything without a palette (age) falls back to the welcome
 * coral. Uses `glow`, the vivid mid-tone, so the active icon reads on white.
 */
export function stepTint(key: string): string {
  const palette = (BLOOM_PALETTES as Record<string, BloomPalette | undefined>)[
    key
  ];
  return palette !== undefined && palette.glow !== TRANSPARENT
    ? palette.glow
    : BLOOM_PALETTES.welcome.glow;
}


/**
 * How far a layer's centre travels, in points.
 *
 * Rest puts the centre on the bottom edge, at `y = height`. Exit puts it at
 * `exitCenterY * height`. Negative, because the field moves up.
 */
export function bloomTravel(layer: BloomLayer, screenHeight: number): number {
  return screenHeight * (layer.exitCenterY - 1);
}

/**
 * SwiftUI's `.smooth`, as close as a scalar ramp gets to it.
 *
 * `.smooth` is a critically damped spring: it arrives without overshooting, so
 * unlike the springs it sits next to in that API it has no bounce to reproduce.
 * A symmetric ease is the honest equivalent for a value with no velocity to carry
 * — but WHICH ease matters at the very end. The earlier form was a piecewise quad
 * whose velocity reaches zero at t=1 while its acceleration cuts off abruptly
 * (−4 → 0). On a field this large that reads as a faint firmness in the last frame
 * of the exit — the settle "lands" instead of feathering. Measured on a 60fps
 * capture of the welcome→form handoff, 2026-09-03.
 *
 * Smootherstep (Perlin, `6t⁵−15t⁴+10t³`) is C²-continuous at both ends: velocity
 * AND acceleration go to zero at t=0 and t=1, so the field eases in from rest and
 * settles to rest without an acceleration step — the soft landing the spring has,
 * kept symmetric (midpoint still exactly 0.5) so the overall motion character is
 * unchanged. It cannot overshoot, so there is still no bounce to reproduce.
 */
export function smooth(t: number): number {
  'worklet';
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * A layer's own eased 0..1 progress, given the field's elapsed time.
 *
 * The stagger is the effect. Take it out and all three layers arrive together
 * and the whole thing collapses into a wipe.
 *
 * The `'worklet'` directive is not decoration. This is called from inside
 * `useAnimatedStyle`, and a plain function called from a worklet is a hard
 * native crash that the entire jest suite passes straight through.
 */
export function layerProgress(elapsedMs: number, delayMs: number): number {
  'worklet';
  const local = (elapsedMs - delayMs) / BLOOM_LAYER_MS;
  return smooth(local < 0 ? 0 : local > 1 ? 1 : local);
}
