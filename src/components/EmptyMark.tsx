import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import type { Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';

/**
 * The mark on an empty state: two overlapping bubbles, one neutral, one warm.
 *
 * It replaces `<Avatar initial="·" size={56} tone="warm" breathing />`, which was
 * the identity primitive pressed into service as an illustration. That rendered
 * as a pale coral disc with a single tiny dot floating in the middle of it, and
 * it did not read as a mark at all: it read as a contact whose name had failed to
 * load, which is precisely the wrong thing to show somebody on their first ever
 * screen. Found by looking at it rather than by any gate.
 *
 * Two bubbles rather than one, because the product is a conversation and one
 * bubble is a monologue. They take the same rounded-square-at-a-large-radius
 * shape as the tab bar's Chats glyph and as `radius.thread`, so the empty state,
 * the tab and the list it stands in for are visibly the same object at three
 * sizes.
 *
 * Views and borders only. `react-native-svg` is banned here: it throws
 * `synchronouslyUpdateUIProps` inside any Reanimated-animated view and kills
 * touch on the subtree. See `src/components/Icon.tsx`.
 *
 * Nothing animates. The avatar it replaced carried `breathing`, a perpetual 2%
 * sine, and an empty state is the one screen where a slow pulse is least welcome:
 * there is nothing happening, and animating the fact that nothing is happening
 * manufactures activity out of an absence.
 */
function EmptyMarkView({ size = 96 }: { size?: number }) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  // Proportions rather than fixed numbers, so the mark holds together if a caller
  // ever asks for a different size.
  const bubble = size * 0.62;
  const shift = size * 0.19;
  const shape = {
    width: bubble,
    height: bubble * 0.84,
    borderRadius: bubble * 0.3,
    borderCurve: 'continuous' as const,
  };

  return (
    <View
      accessible={false}
      // Hidden from screen readers: the sentence underneath it already says the
      // list is empty, and a decorative mark has nothing to add to that.
      importantForAccessibility="no-hide-descendants"
      /*
       * The host is the pair's union box, NOT a `size` square.
       *
       * Both bubbles are absolutely positioned from the top left, so the pair
       * occupies `bubble + shift` across and `bubble * 0.84 + shift` down, which
       * is smaller than `size` in both directions. Sizing the host to `size` left
       * the ink biased up and to the left inside it, and since the parent centres
       * the host rather than the ink, the mark rendered visibly off-axis from the
       * sentence beneath it. Measured on the emulator: about 9pt of leftward lean.
       */
      style={[styles.host, { width: bubble + shift, height: bubble * 0.84 + shift }]}>
      <View
        style={[
          shape,
          styles.placed,
          styles.origin,
          { backgroundColor: theme.color.bg.sunken },
        ]}
      />
      <View
        style={[
          shape,
          styles.placed,
          { left: shift, top: shift, backgroundColor: theme.color.bg.accentTint },
        ]}
      />
    </View>
  );
}

export const EmptyMark = memo(EmptyMarkView);

const makeStyles = (_t: Theme) => StyleSheet.create({
  host: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The only static property either bubble has. Everything else is derived from
  // the requested size, so it cannot live in a stylesheet.
  placed: {
    position: 'absolute',
  },
  // The rear bubble sits at the origin; the front one is offset by a fraction of
  // the requested size, so only that one can be positioned inline.
  origin: {
    left: 0,
    top: 0,
  },
});
