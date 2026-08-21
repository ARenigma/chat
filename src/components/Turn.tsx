import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { bubbleArrive, bubbleLaunch } from '../theme/motion';
import { Avatar } from './Avatar';

const AVATAR_SLOT = 26;

interface PeerProps {
  message: string;
  initial: string;
  /** First of a group shows the avatar; continued turns keep the slot, hide the mark. */
  first: boolean;
  timestamp?: string;
  animate?: boolean;
  /**
   * Long-press to report this specific message. Only their turns carry it —
   * reporting your own message is meaningless, and the evidence snapshot in
   * `submit_report` refuses it anyway.
   */
  onReport?: () => void;
}

/**
 * Both sides are in bubbles now, and that is a reversal worth recording.
 *
 * The previous version left their words bare on the page, on the argument that a
 * container adds chrome carrying no information. That argument was right about
 * chrome and wrong about the product: with one side in a container and one side
 * loose, a long thread reads as *your* messages punctuated by captions, rather
 * than as two people talking. Symmetry of shape with asymmetry of colour is what
 * every reference used, and it is the correct trade — the tail corner and the fill
 * carry the speaker, the shape carries the fact that both are speech.
 *
 * The avatar slot is still always reserved, so the text edge never shifts between
 * a first and a continued turn.
 */
function PeerTurnView({ message, initial, first, timestamp, animate, onReport }: PeerProps) {
  const styles = useStyles(makeStyles);
  return (
    <Animated.View entering={animate === true ? bubbleArrive : undefined} style={styles.peerRow}>
      <View style={styles.slot}>{first ? <Avatar initial={initial} size={26} /> : null}</View>
      <View style={styles.peerColumn}>
        {/* A plain RN Pressable, not the animated one: a scale spring on a
            long-press over body text reads as an accident, and this must not
            look like a tap target during normal reading. */}
        <Pressable
          onLongPress={onReport}
          delayLongPress={450}
          accessibilityLabel={onReport ? 'Long press to report this message' : undefined}>
          <View style={styles.peerBubble}>
            <Text testID="bubble-peer" allowFontScaling style={styles.peerText}>
              {message}
            </Text>
          </View>
        </Pressable>
        {timestamp ? <Text style={styles.stamp}>{timestamp}</Text> : null}
      </View>
    </Animated.View>
  );
}

export const PeerTurn = memo(PeerTurnView);

interface MineProps {
  message: string;
  timestamp?: string;
  /** Pending until the server confirms it; a dimmed bubble says so honestly. */
  pending?: boolean;
  /**
   * Receipt state, rendered only on the newest message this session sent —
   * repeating it on every bubble is noise, and the newest one answers the
   * question the others would.
   */
  receipt?: 'sent' | 'read';
}

/**
 * The signature moment lands here.
 *
 * `bubbleLaunch` starts the bubble narrow-and-tall and lets one `bounce` spring
 * resolve width, height and position together, so it arrives as an object with
 * mass rather than three properties finishing at their own pace. It is the
 * counterpart to the send button's squash: squeezed out of the button, released
 * into the thread.
 *
 * The fill is `accentStrong` rather than `accent` for a measured reason — the
 * lighter coral carries white text at 3.4:1, which is a fail, and this bubble is
 * full of white body copy. The deeper step measures 5.2:1.
 */
function MyTurnView({ message, timestamp, pending, receipt }: MineProps) {
  const styles = useStyles(makeStyles);
  return (
    <Animated.View entering={bubbleLaunch} style={styles.myColumn}>
      <View style={[styles.bubble, pending === true && styles.pending]}>
        <Text testID="bubble-mine" allowFontScaling style={styles.myText}>
          {message}
        </Text>
      </View>
      {timestamp !== undefined || receipt !== undefined ? (
        <View style={styles.meta}>
          {timestamp !== undefined ? <Text style={styles.stamp}>{timestamp}</Text> : null}
          {receipt !== undefined ? (
            <Text testID="read-receipt" style={styles.stamp}>
              {receipt === 'read' ? 'Read' : 'Sent'}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Animated.View>
  );
}

export const MyTurn = memo(MyTurnView);

const makeStyles = (t: Theme) => StyleSheet.create({
  peerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: TOKENS.space.xs,
  },
  slot: {
    width: AVATAR_SLOT,
  },
  peerColumn: {
    flex: 1,
    alignItems: 'flex-start',
    paddingRight: TOKENS.space.lg,
    gap: TOKENS.space['2xs'],
  },
  peerBubble: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: 10,
    backgroundColor: t.color.bg.raised,
    borderWidth: 1,
    borderColor: t.color.border.hairline,
    borderTopLeftRadius: TOKENS.radius.lg,
    borderTopRightRadius: TOKENS.radius.lg,
    borderBottomRightRadius: TOKENS.radius.lg,
    borderBottomLeftRadius: TOKENS.radius.tail,
  },
  peerText: {
    ...TOKENS.typography.bodyLarge,
    color: t.color.text.primary,
  },
  myColumn: {
    alignItems: 'flex-end',
    gap: TOKENS.space['2xs'],
  },
  bubble: {
    maxWidth: '80%',
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: 10,
    backgroundColor: t.color.bg.accentStrong,
    borderTopLeftRadius: TOKENS.radius.lg,
    borderTopRightRadius: TOKENS.radius.lg,
    borderBottomLeftRadius: TOKENS.radius.lg,
    borderBottomRightRadius: TOKENS.radius.tail,
  },
  // Not a spinner. The bubble is already on screen and will almost always
  // confirm; a spinner would promise more uncertainty than there is.
  pending: {
    opacity: 0.55,
  },
  myText: {
    ...TOKENS.typography.bodyLarge,
    color: t.color.text.onAccent,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
  },
  stamp: {
    ...TOKENS.typography.captionSmall,
    color: t.color.text.secondary,
  },
});
