import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { fadeSwapFast, fadeSwapOutFast } from '../theme/motion';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { selectPeerActivity, useStore } from '../store/useStore';
import { TypingIndicator } from './TypingIndicator';

/**
 * The typing indicator, deliberately rendered outside the FlashList.
 *
 * This inherits the role the streaming bubble used to play: it is the only
 * subscriber to the live-activity state, so the transcript's `data` prop never
 * changes when the other person starts or stops typing and the list performs no
 * layout work. Its identity is stable (module-level memo), so handing it to
 * `ListHeaderComponent` does not invalidate the list either.
 */
function PeerTypingView({ name }: { name: string }) {
  const styles = useStyles(makeStyles);
  const activity = useStore(selectPeerActivity);

  if (activity === null) {
    return null;
  }

  return (
    /*
     * Keyed by `activity` (M14, 2026-09-17 audit): without it, a flip between
     * "is typing" and "is recording" was a hard cut, and the bubble itself
     * popped in/out with no motion at all. `fadeSwapFast`/`fadeSwapOutFast` —
     * the same pair the Notify button and HeaderSubtitle's own status line
     * use — fits the frequency here: this flickers on and off many times
     * within one live conversation, the "near-imperceptible" tier the
     * project's own motion gate calls for, not a heavier bubble-arrival
     * entrance. Not `entering` on a recycled FlashList row (the thing to
     * never do): this is the list's `ListHeaderComponent`, a single
     * non-recycled slot, not a virtualized item.
     */
    <Animated.View
      key={activity}
      entering={fadeSwapFast}
      exiting={fadeSwapOutFast}
      style={styles.row}>
      {/* In a bubble, at the peer's bubble position — and "the peer's bubble
          position" is now the content edge, which is why the avatar that used
          to sit here is gone.
          The transcript's incoming avatar was removed so the composer capsule
          could trace the bubble grid on both edges (Amit, 2026-09-07: "remove
          it, align the grid"), which moved every peer bubble 34dp left. This
          row kept its own 26dp `slot` and 8dp gap, so the typing bubble was
          left standing alone at the OLD column, 34dp right of the message it
          precedes. Dropping the avatar here is not a second decision; it is the
          same one, applied to the one surface that duplicated the inset.
          The `bg/sunken` fill the peer's own bubble uses is what makes this
          read as a bubble the other person is about to fill. */}
      <View style={styles.bubble}>
        <TypingIndicator
          label={
            activity === 'recording'
              ? `${name} is recording`
              : `${name} is typing`
          }
        />
      </View>
    </Animated.View>
  );
}

export const PeerTyping = memo(PeerTypingView);

const makeStyles = (_t: Theme) => StyleSheet.create({
  // No counter-flip: VirtualizedList composes its inversion style onto the
  // ListHeaderComponent wrapper, so the header renders upright already.
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    width: '100%',
    /*
     * The same vertical rhythm a Turn has, and it was missing entirely.
     *
     * This renders as the inverted list's ListHeaderComponent, so it sits at the
     * visual BOTTOM - flush against the newest bubble, with no margin of its own
     * while every transcript row carries a `2xs` gap (`ChatListV2`'s `cell`
     * style). So the dots butted straight into the message above them and read
     * as overlapping it (Amit, 2026-09-05: "typing animation overlaps message
     * bubbles").
     *
     * On an inverted list the header is BELOW the newest item, so the gap that
     * separates them belongs on this row's TOP.
     */
    marginTop: TOKENS.space['2xs'],
    marginBottom: TOKENS.space['2xs'],
  },
  bubble: {
    paddingHorizontal: TOKENS.space.md,
    // `hair` (2dp) made the bubble shorter than the dots it contains, so they
    // sat on its edge. `2xs` gives the dots the same breathing room the text in
    // a real peer bubble gets.
    paddingVertical: TOKENS.space['2xs'],
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: _t.color.bg.sunken,
  },
});
