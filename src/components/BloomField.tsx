import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import {
  BLOOM_LAYERS,
  BLOOM_SWAP_MS,
  bloomExitGradient,
  bloomLayerBox,
  bloomRadiusScale,
  bloomRestGradient,
  bloomTravel,
  layerProgress,
  type BloomPalette,
} from '../lib/bloom';

/**
 * What the field is showing: a colour, and whether its cores have collapsed.
 *
 * The two travel together on purpose. In the source a step change reassigns
 * `gradient` and the welcome exit changes `startRadius`, and BOTH are carried by
 * the same three `.animation(.smooth.delay(...))` modifiers. Modelling them as
 * one thing is what keeps the field to a single cross-fade per layer instead of
 * one per property.
 */
export interface BloomStage {
  readonly palette: BloomPalette;
  /** False only on the welcome screen, where each layer holds a solid core. */
  readonly collapsed: boolean;
}

interface Props {
  /**
   * Elapsed milliseconds through the field's POSITION animation, 0 to
   * `BLOOM_FIELD_MS`. Milliseconds rather than a 0..1 fraction because the
   * source's delays are absolute and each layer runs its own fixed 500ms once it
   * starts; normalising would couple every layer's speed to the total.
   */
  elapsed: SharedValue<number>;
  /** Where the field is now. Changing this cross-fades every layer. */
  stage: BloomStage;
  /**
   * Hide the whole field by sliding it off the top.
   *
   * The source's `showGradient = !keyboardShown` with `.transition(.move(edge: .top))`.
   * It is not decoration: a raised keyboard leaves roughly a third of the screen,
   * and a saturated field in the remaining space turns a text field into
   * something you squint at. Giving the whole surface back to the one question
   * being asked is the right call on any platform, and it is also what Android's
   * own layout guidance asks for — the IME is a first-class part of the layout,
   * not something to draw behind.
   */
  hidden?: boolean;
}

type Slot = 'a' | 'b';

interface Slots {
  readonly a: BloomStage;
  readonly b: BloomStage;
  /** The slot that is fading IN. The other one is the base underneath it. */
  readonly arriving: Slot;
}

function sameStage(x: BloomStage, y: BloomStage): boolean {
  return x.palette.name === y.palette.name && x.collapsed === y.collapsed;
}

/**
 * The atmospheric field, three radial layers deep, and the only thing on screen
 * that survives the entire onboarding.
 *
 * **It never unmounts.** That is the architecture of the reference and it is why
 * the flow feels like one place rather than a sequence of screens. The field
 * mounts once, and from then on only three things about it change: where its
 * centre is, how large each solid core is, and what colour it is. There is no
 * navigation underneath any of it.
 *
 * **It is three gradients, not one, and each fades to TRANSPARENT rather than to
 * the page colour.** Three transparent layers *composite* where they overlap;
 * one multi-stop ramp *interpolates* between stops. The first produces depth,
 * the second produces a printed-looking band.
 *
 * **The exit is not a slide.** Circles keep a constant `endRadius` throughout;
 * what moves is their centre, bottom edge to top, and what changes is their
 * solid core, which collapses to nothing. See `src/lib/bloom.ts` for the source
 * this is taken from and the three things I got wrong translating it first.
 *
 * **No dependency and no SVG.** React Native 0.86 renders `radial-gradient`
 * natively through `experimental_backgroundImage`, so this needs neither
 * `react-native-svg`, which is banned here for killing touch inside Reanimated
 * subtrees, nor a linear-gradient package that could not draw a radial anyway.
 *
 * **Boundary:** this field belongs to bounded journeys with a terminal state.
 * It does not belong on Home, Provider Detail, Chat, Call, Recharge selection,
 * Settings, or errors: live surfaces must expose current state immediately.
 * Payment success is the narrow transactional exception: work is already over,
 * so the field celebrates a confirmed result without delaying or hiding state.
 */
function BloomFieldView({ elapsed, stage, hidden = false }: Props) {
  const { width, height } = useWindowDimensions();

  /*
   * Two fixed slots per layer, and a swap that can never show a stale frame.
   *
   * The first version kept a `{ from, to }` pair in React state and reset one
   * shared `mix` to 0 in the same effect. Those two writes take different roads:
   * the shared value reaches the UI thread on the next frame, the state goes
   * through a React commit and a Fabric mount. When that commit was late — and
   * at the onboarding handoff it shared its tick with mounting the whole form —
   * the arriving layer dropped to opacity 0 while the base was still painting
   * the OLD `from` gradient: the saturated welcome pool with its full cores,
   * for one frame, on top of a field that had just finished collapsing them.
   * That frame was the jerk.
   *
   * Now each layer has slots `a` and `b`, each with its own opacity. A new stage
   * is written only into the slot that is ALREADY at opacity 0, and its fade-in
   * starts from an effect that runs after that commit has landed. The order of
   * the two roads stops mattering; and because every layer's stagger delay is at
   * least 400ms (`layerProgress`), the arriving slot stays at exactly 0 for the
   * first 400ms of any swap even if the mount is slow. The base slot sits at 1
   * until it is fully covered, then drops to 0 from the timing's completion
   * callback, on the UI thread, where nothing can be seen changing.
   */
  const [slots, setSlots] = useState<Slots>({ a: stage, b: stage, arriving: 'a' });
  const opA = useSharedValue(1);
  const opB = useSharedValue(0);
  const current = useRef(stage);
  const inFlight = useRef(false);

  useEffect(() => {
    if (sameStage(current.current, stage)) {
      return;
    }
    current.current = stage;
    const arrivingNow = slots.arriving;
    const other: Slot = arrivingNow === 'a' ? 'b' : 'a';
    const arrivingSV = arrivingNow === 'a' ? opA : opB;
    const otherSV = other === 'a' ? opA : opB;
    if (inFlight.current) {
      /*
       * A retarget mid-swap: the slot still fading in becomes the new base. It
       * snaps to 1 here, which is the one discontinuity this design allows, and
       * it is confined to a tap landing inside a 1150ms fade — rare, and better
       * than the alternative of restarting from an older stage.
       */
      cancelAnimation(arrivingSV);
      arrivingSV.value = 1;
    }
    // Invisible already (or covered by the snap above), so rewriting its
    // gradient string in the commit below cannot be seen.
    otherSV.value = 0;
    setSlots(s => ({ ...s, [other]: stage, arriving: other }));
  }, [stage, slots.arriving, opA, opB]);

  useEffect(() => {
    const arrivingSV = slots.arriving === 'a' ? opA : opB;
    const baseSV = slots.arriving === 'a' ? opB : opA;
    if (arrivingSV.value === 1) {
      // Initial mount: slot `a` is the base and there is nothing to fade.
      return;
    }
    inFlight.current = true;
    // Linear, because the easing belongs to each layer. See `layerProgress`.
    arrivingSV.value = withTiming(
      1,
      { duration: BLOOM_SWAP_MS, easing: Easing.linear },
      finished => {
        if (finished) {
          baseSV.value = 0;
        }
      },
    );
    const done = setTimeout(() => {
      inFlight.current = false;
    }, BLOOM_SWAP_MS);
    return () => clearTimeout(done);
  }, [slots.arriving, opA, opB]);

  /*
   * The whole field leaves as one piece, which is why this is on the host rather
   * than folded into each layer's stagger: the stagger is for the field moving
   * through itself, and getting out of the keyboard's way is not that.
   *
   * Driven from an effect, not from inside `useAnimatedStyle`: a `withTiming`
   * inside the style worklet restarts on every re-render of this component,
   * which is every stage change.
   */
  const hide = useSharedValue(0);
  useEffect(() => {
    hide.value = withTiming(hidden ? -height : 0, {
      duration: BLOOM_SWAP_MS / 2,
      easing: Easing.inOut(Easing.quad),
    });
  }, [hidden, height, hide]);
  const host = useAnimatedStyle(() => ({
    transform: [{ translateY: hide.value }],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      /*
       * TRANSPARENT, not `bg/raised` (2026-09-12). The flat base fill moved to
       * `NightSky`, which now mounts BEHIND this field and paints it — so the
       * field's own coral layers composite over the night sky instead of over
       * an opaque wall that would hide it. This is the one wiring change that
       * came with the night-sky backdrop; BLOOM_LAYERS, the stage cross-fade
       * and the collapse geometry below are untouched (Amit: "i hope we are
       * not touching the fuse bloom system animation mechanics itself" — we
       * are not). `OnboardingScreen`'s own root still paints `bg/raised`
       * itself, so there is no seam: NightSky, this field, and the root are
       * all the same surface, just layered instead of one view owning it.
       */
      style={[styles.host, host]}>
      {BLOOM_LAYERS.map(layer => (
        <BloomLayer
          key={layer.name}
          name={layer.name}
          elapsed={elapsed}
          opA={opA}
          opB={opB}
          slots={slots}
          width={width}
          height={height}
        />
      ))}
    </Animated.View>
  );
}

interface LayerProps {
  name: (typeof BLOOM_LAYERS)[number]['name'];
  elapsed: SharedValue<number>;
  opA: SharedValue<number>;
  opB: SharedValue<number>;
  slots: Slots;
  width: number;
  height: number;
}

function BloomLayerView({ name, elapsed, opA, opB, slots, width, height }: LayerProps) {
  const layer = BLOOM_LAYERS.find(l => l.name === name);
  if (layer === undefined) {
    throw new Error(`unknown bloom layer ${name}`);
  }
  const { delayMs } = layer;
  const travel = bloomTravel(layer, height);
  const radiusScale = bloomRadiusScale(width, height);

  // The box moves. Its centre is the gradient's centre, so translating the box
  // IS animating `center:` in the source.
  const box = useAnimatedStyle(() => ({
    transform: [{ translateY: layerProgress(elapsed.value, delayMs) * travel }],
  }));

  /*
   * The stagger applies to colour exactly as it applies to movement.
   *
   * Each slot's opacity is a linear 0..1 across the swap; feeding it back
   * through `layerProgress` gives this layer its own delayed, eased slice of
   * it. Fade all three together and a step change reads as the screen
   * repainting. Staggered, it reads as the field turning over — which is what
   * the source gets for free by putting `.animation(.smooth.delay(x))` on each
   * gradient rather than on their container. A slot at rest maps to exactly 0
   * or exactly 1, so the same expression serves base and arriving alike.
   */
  const fadeA = useAnimatedStyle(() => ({
    opacity: layerProgress(opA.value * BLOOM_SWAP_MS, delayMs),
  }));
  const fadeB = useAnimatedStyle(() => ({
    opacity: layerProgress(opB.value * BLOOM_SWAP_MS, delayMs),
  }));

  // Slot objects are replaced only when a slot's stage changes, so identity is
  // the right memo key.
  const gradientA = useMemo(() => gradientFor(layer, slots.a), [layer, slots.a]);
  const gradientB = useMemo(() => gradientFor(layer, slots.b), [layer, slots.b]);

  // The arriving slot paints above the base. The order flips in the same commit
  // that rewrites the arriving slot's gradient, while it is at opacity 0.
  const aOnTop = slots.arriving === 'a';

  return (
    <Animated.View style={[styles.layer, bloomLayerBox(layer, width, radiusScale), box]}>
      <Animated.View
        style={[
          styles.fill,
          aOnTop ? styles.above : styles.below,
          { experimental_backgroundImage: gradientA },
          fadeA,
        ]}
      />
      <Animated.View
        style={[
          styles.fill,
          aOnTop ? styles.below : styles.above,
          { experimental_backgroundImage: gradientB },
          fadeB,
        ]}
      />
    </Animated.View>
  );
}

function gradientFor(layer: (typeof BLOOM_LAYERS)[number], s: BloomStage): string {
  return s.collapsed
    ? bloomExitGradient(layer, s.palette)
    : bloomRestGradient(layer, s.palette);
}

// Memoised so a re-render of the host for one slot change does not rebuild
// three layers' style arrays when nothing about a layer has moved.
const BloomLayer = memo(BloomLayerView);

export const BloomField = memo(BloomFieldView);

const styles = StyleSheet.create({
  host: {
    ...StyleSheet.absoluteFill,
    overflow: 'hidden',
  },
  // Position and size come from `bloomLayerBox`, which needs the box square for
  // the gradient's `closest-side` to land the transparent stop on the edge.
  layer: {
    position: 'absolute',
  },
  /*
   * No `renderToHardwareTextureAndroid`, and that is measured rather than
   * omitted. Promoting each layer is the textbook fix for six overlapping
   * gradient shaders, and it was tried: jank across the transition went from
   * 52.5% to 52.3%, which is noise. The only device available here is an
   * emulator whose GPU is SwiftShader, a software rasteriser — `ro.hardware.egl`
   * reads `emulation` — so there is nothing to promote a texture onto and the
   * measurement says nothing about real hardware. Left off because a hardware
   * layer costs real memory, up to 1000dp square three times over, and paying
   * that for an unproven win is the wrong trade. Revisit with `dumpsys gfxinfo`
   * on a physical device, where the numbers mean something.
   */
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  above: { zIndex: 1 },
  below: { zIndex: 0 },
});
