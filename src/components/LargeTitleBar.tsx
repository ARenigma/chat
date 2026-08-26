import React, { memo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  type SharedValue,
  useAnimatedStyle,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { COLLAPSE_TRAVEL, collapseFrame } from '../theme/motion';


/**
 * The bands, measured off `Pappal Home, large title expanded` (54:4) and
 * `Pappal Home, title collapsed` (56:11).
 *
 *   expanded  148 = 44 content row + 52 title strip + 52 search strip
 *   collapsed  97 = 44 content row + 52 search strip + 1 hairline
 *
 * The safe-area inset sits above all of it and is read from the device rather
 * than assumed: the Figma frame's 59 is an iPhone 16 Pro, and this ships to
 * Android where it is more often 24.
 */
export const BAR_ROW_HEIGHT = 44;
export const BAR_TITLE_STRIP = COLLAPSE_TRAVEL;

/**
 * How much room the centred inline title gives up at each end.
 *
 * Sized for the widest trailing cluster the app actually renders: the balance
 * pill at a four-digit balance (about 76) plus a gap (8) plus the 28pt overflow
 * target plus the row's own 16 of padding. Symmetric, because the title is
 * centred on the screen and not in the space that happens to be left over.
 */
const TRAILING_RESERVE = 76 + TOKENS.space.xs + 28 + TOKENS.space.md;

interface Props {
  /**
   * The large title. A string is set in the wordmark face; a node is rendered as
   * given, which is how Explore keeps its Urbanist title.
   */
  title: string;
  /** `wordmark` is Pappal's own brand face and is only correct on Home. */
  face: 'wordmark' | 'screen';
  /** Live scroll offset of the list below, in points. */
  scrollY: SharedValue<number>;
  /** Rendered at the trailing end of the 44pt content row. */
  trailing?: ReactNode;
  /** The search strip. Omit it and the bar reserves no space for one. */
  search?: ReactNode;
  testID?: string;
}

/**
 * The iOS large-title navigation bar, collapsing on scroll.
 *
 * **Two titles, never one that resizes.** The large title rides up and fades out
 * while a separate 17pt inline title fades in. The obvious implementation is to
 * scale the 34 down to the 17, and it is wrong: swapping type styles mid-gesture
 * reflows the row on one frame while opacity catches up over several, so the
 * label jumps and then settles. `src/theme/motion.ts` already documents that exact
 * failure for the stepper, where rule 7, opacity only, won.
 *
 * **The search strip does not collapse.** Only the title strip is given up, which
 * is why the travel is 52 and not 104. See `SearchField` for why that field earns
 * its permanent place.
 *
 * **One animated style per moving part, all reading one frame.** Every style here
 * calls `collapseFrame(scrollY.value)` and takes one field off it. That looks
 * redundant and is deliberate: the alternative is four independent samples of the
 * shared value, which is how a header ends up with its title and its hairline
 * disagreeing about where the list is by a frame. `collapseFrame` is pure and
 * cheap, and it runs on the UI thread.
 *
 * **The hairline is absent at rest.** iOS `scrollEdgeAppearance` shows no
 * separator until the content moves, and it is the cue that says the list is
 * scrolled rather than short.
 */
function LargeTitleBarView({ title, face, scrollY, trailing, search, testID }: Props) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();

  const largeTitle = useAnimatedStyle(() => {
    const frame = collapseFrame(scrollY.value);
    return {
      opacity: frame.titleOpacity,
      transform: [{ translateY: frame.titleY }],
    };
  });

  const inlineTitle = useAnimatedStyle(() => ({
    opacity: collapseFrame(scrollY.value).inlineOpacity,
  }));

  const hairline = useAnimatedStyle(() => ({
    opacity: collapseFrame(scrollY.value).hairlineOpacity,
  }));

  /*
   * This one animates `height`, which means a layout pass per frame, and that is
   * worth stating plainly rather than hiding: every other animation in this app
   * is opacity or transform precisely because those do not cause layout.
   *
   * It is here because the bar genuinely has two different heights, 148 and 97,
   * and the three cheaper shapes all fail:
   *
   *   Translate the whole bar up by 52. The 44pt content row is ABOVE the title
   *   strip, so it goes under the status bar and takes the trailing control with
   *   it.
   *
   *   Put the large title inside the list as a header, so it scrolls away for
   *   free. That is how the inbox used to work and it cannot work here, because
   *   the title sits BETWEEN two pinned elements: the content row above it and
   *   the search strip below. List content cannot be in the middle of the bar.
   *
   *   Keep the bar at 148 and let the list slide under it. The bar is opaque, so
   *   the bottom 52pt would be covering live rows once collapsed.
   *
   * What makes it acceptable: one node resizes, nothing reflows inside it (the
   * title is absolutely free of siblings and clipped by `overflow: hidden`), the
   * range is 52pt, and on Fabric the layout runs on the UI thread with the rest
   * of the worklet. It is still the single most likely thing on this screen to
   * jank, which is why item 4 is verified by scrolling it on a device and not by
   * a test.
   */
  const strip = useAnimatedStyle(() => ({
    height: BAR_TITLE_STRIP + collapseFrame(scrollY.value).titleY,
  }));

  return (
    <View testID={testID} style={[styles.bar, { paddingTop: insets.top }]}>
      <View style={styles.row}>
        <Animated.View pointerEvents="none" style={[styles.inlineSlot, inlineTitle]}>
          <Text allowFontScaling numberOfLines={1} style={styles.inlineTitle}>
            {title}
          </Text>
        </Animated.View>
        {/* After the inline title in the tree, so the trailing control stays
            tappable while the title fades across underneath it. */}
        <View style={styles.spacer} />
        {trailing}
      </View>

      {/* `overflow: hidden` is what turns the title's translate into a collapse
          rather than a slide over the row above it. */}
      <Animated.View style={[styles.strip, strip]}>
        <Animated.View style={largeTitle}>
          <Text
            testID="bar-large-title"
            allowFontScaling
            numberOfLines={1}
            style={face === 'wordmark' ? styles.wordmark : styles.screenTitle}>
            {title}
          </Text>
        </Animated.View>
      </Animated.View>

      {search}

      <Animated.View pointerEvents="none" style={[styles.hairline, hairline]} />
    </View>
  );
}

export const LargeTitleBar = memo(LargeTitleBarView);

const makeStyles = (t: Theme) => StyleSheet.create({
  bar: {
    backgroundColor: t.color.bg.base,
  },
  row: {
    height: BAR_ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: TOKENS.space.md,
  },
  // Absolute and full width so the inline title is centred on the screen rather
  // than on whatever space the trailing control leaves, which is what iOS does
  // and what stops the title shifting when a badge appears beside it.
  //
  // The horizontal inset is the guard that centring costs you. A screen-centred
  // title in a full-width box will happily run underneath the trailing cluster,
  // and the cluster here is a balance pill plus a glyph, about 120pt of it, which
  // grows when the balance reaches four digits. Reserving that much on BOTH sides
  // keeps the title on the screen's centre line and makes it truncate rather than
  // collide. `numberOfLines={1}` on the Text is the other half.
  inlineSlot: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: TRAILING_RESERVE,
  },
  inlineTitle: {
    ...TOKENS.typography.headline,
    color: t.color.text.primary,
  },
  spacer: {
    flex: 1,
  },
  strip: {
    justifyContent: 'center',
    paddingHorizontal: TOKENS.space.md,
    overflow: 'hidden',
  },
  // The one place in the app that is not Urbanist. See the token note.
  wordmark: {
    ...TOKENS.typography.wordmark,
    color: t.color.text.primary,
  },
  screenTitle: {
    ...TOKENS.typography.displayLarge,
    color: t.color.text.primary,
  },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: t.color.border.hairline,
  },
});
