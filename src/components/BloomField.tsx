import React, { memo, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useTheme } from '../theme/ThemeProvider';
import {
  BLOOM_LAYERS,
  BLOOM_SWAP_MS,
  bloomExitGradient,
  bloomLayerBox,
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
 */
function BloomFieldView({ elapsed, stage, hidden = false }: Props) {
  const theme = useTheme();
  const { width, height } = useWindowDimensions();

  /*
   * The cross-fade is between two whole stages, not between two colours.
   *
   * `from` is what the field was showing, `to` is where it is going, and `mix`
   * walks 0 to 1 between them. Keeping the pair in state rather than deriving it
   * means a change arriving mid-fade starts its own fade from whatever is
   * currently on screen instead of snapping back to an older stage.
   */
  const [pair, setPair] = useState<{ from: BloomStage; to: BloomStage }>({
    from: stage,
    to: stage,
  });
  const mix = useSharedValue(1);
  const current = useRef(stage);

  useEffect(() => {
    if (
      current.current.palette.name === stage.palette.name &&
      current.current.collapsed === stage.collapsed
    ) {
      return;
    }
    const previous = current.current;
    current.current = stage;
    setPair({ from: previous, to: stage });
    mix.value = 0;
    // Linear, because the easing belongs to each layer. See `layerProgress`.
    mix.value = withTiming(1, { duration: BLOOM_SWAP_MS, easing: Easing.linear });
  }, [stage, mix]);

  // The whole field leaves as one piece, which is why this is on the host rather
  // than folded into each layer's stagger: the stagger is for the field moving
  // through itself, and getting out of the keyboard's way is not that.
  const host = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: withTiming(hidden ? -height : 0, {
          duration: BLOOM_SWAP_MS / 2,
          easing: Easing.inOut(Easing.quad),
        }),
      },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[styles.host, { backgroundColor: theme.color.bg.base }, host]}>
      {BLOOM_LAYERS.map(layer => (
        <BloomLayer
          key={layer.name}
          name={layer.name}
          elapsed={elapsed}
          mix={mix}
          pair={pair}
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
  mix: SharedValue<number>;
  pair: { from: BloomStage; to: BloomStage };
  width: number;
  height: number;
}

function BloomLayer({ name, elapsed, mix, pair, width, height }: LayerProps) {
  const layer = BLOOM_LAYERS.find(l => l.name === name);
  if (layer === undefined) {
    throw new Error(`unknown bloom layer ${name}`);
  }
  const { delayMs } = layer;
  const travel = bloomTravel(layer, height);

  // The box moves. Its centre is the gradient's centre, so translating the box
  // IS animating `center:` in the source.
  const box = useAnimatedStyle(() => ({
    transform: [{ translateY: layerProgress(elapsed.value, delayMs) * travel }],
  }));

  /*
   * The stagger applies to colour exactly as it applies to movement.
   *
   * `mix` is a linear 0..1 across the swap; feeding it back through
   * `layerProgress` gives this layer its own delayed, eased slice of it. Fade
   * all three together and a step change reads as the screen repainting.
   * Staggered, it reads as the field turning over — which is what the source
   * gets for free by putting `.animation(.smooth.delay(x))` on each gradient
   * rather than on their container.
   */
  const arriving = useAnimatedStyle(() => ({
    opacity: layerProgress(mix.value * BLOOM_SWAP_MS, delayMs),
  }));

  const gradientFor = (s: BloomStage): string =>
    s.collapsed
      ? bloomExitGradient(layer, s.palette)
      : bloomRestGradient(layer, s.palette);

  return (
    <Animated.View style={[styles.layer, bloomLayerBox(layer, width), box]}>
      <View
        style={[styles.fill, { experimental_backgroundImage: gradientFor(pair.from) }]}
      />
      <Animated.View
        style={[
          styles.fill,
          { experimental_backgroundImage: gradientFor(pair.to) },
          arriving,
        ]}
      />
    </Animated.View>
  );
}

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
});
