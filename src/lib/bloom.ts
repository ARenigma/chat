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
 * The hue order is deliberately NOT the recreation's. That code puts its
 * brightest tone innermost, which pools bright at the bottom edge; the shipped
 * Fuse app measures the other way round, deep at the bottom with the bright band
 * above it, and the shipped app is the thing worth matching.
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
    name: 'core',
    restStart: 80,
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
): { width: number; height: number; left: number; bottom: number } {
  const diameter = layer.endRadius * 2;
  return {
    width: diameter,
    height: diameter,
    left: (screenWidth - diameter) / 2,
    bottom: -layer.endRadius,
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
export function fadeStop(color: string): string {
  const hex = color.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},0)`;
}

export function bloomGradient(
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
  welcome: { name: 'welcome', wash: '#FF7043', glow: '#FF8C1A', core: '#DB0A5B' },
  choose: { name: 'choose', wash: '#FF8A5B', glow: '#FFA53D', core: '#E0245E' },
  number: { name: 'number', wash: '#F4785F', glow: '#FF9A4D', core: '#C42A6B' },
  code: { name: 'code', wash: '#F0629A', glow: '#FF7BAC', core: '#B0175E' },
  done: { name: 'done', wash: TRANSPARENT, glow: TRANSPARENT, core: TRANSPARENT },
} as const satisfies Record<string, BloomPalette>;

export type PaletteName = keyof typeof BLOOM_PALETTES;

/**
 * How long a colour swap takes.
 *
 * The source reuses each layer's own `.smooth.delay(...)`, so a colour change is
 * staggered exactly like the exit is. Reusing `BLOOM_FIELD_MS` here rather than
 * picking a new number keeps that property: whatever the field does, it does at
 * one speed.
 */
export const BLOOM_SWAP_MS = BLOOM_FIELD_MS;

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
 * An in-out ease is the honest equivalent for a value with no velocity to carry.
 */
export function smooth(t: number): number {
  'worklet';
  return t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) * (-2 * t + 2)) / 2;
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
