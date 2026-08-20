import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import { Avatar } from './Avatar';

const AVATAR_SLOT = 26;

interface PeerProps {
  message: string;
  initial: string;
  /** First of a group shows the avatar; continued turns keep the slot, hide the mark. */
  first: boolean;
  timestamp?: string;
  animate?: boolean;
}

/**
 * Their words are not in a bubble. The message IS the content, and a container
 * around it adds chrome carrying no information. The avatar slot is always
 * reserved so the text edge never shifts between a first and a continued turn.
 */
function PeerTurnView({ message, initial, first, timestamp, animate }: PeerProps) {
  return (
    <Animated.View
      entering={animate ? FadeInDown.duration(TOKENS.motion.duration.base).springify() : undefined}
      style={styles.peerRow}>
      <View style={styles.slot}>{first ? <Avatar initial={initial} size={26} /> : null}</View>
      <View style={styles.peerColumn}>
        <Text testID="bubble-peer" allowFontScaling style={styles.peerText}>
          {message}
        </Text>
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

/** My words get the container. That asymmetry separates the voices without colour. */
function MyTurnView({ message, timestamp, pending, receipt }: MineProps) {
  return (
    <Animated.View
      entering={FadeInDown.duration(TOKENS.motion.duration.fast)}
      style={styles.myColumn}>
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

const styles = StyleSheet.create({
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
    paddingRight: TOKENS.space.xl + TOKENS.space['2xs'],
    gap: TOKENS.space['2xs'],
  },
  peerText: {
    ...TOKENS.typography.bodyLarge,
    color: TOKENS.color.text.primary,
  },
  myColumn: {
    alignItems: 'flex-end',
    gap: TOKENS.space['2xs'],
  },
  bubble: {
    maxWidth: '76%',
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: 10,
    backgroundColor: TOKENS.color.bg.inverse,
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
    color: TOKENS.color.text.onInverse,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
  },
  stamp: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
  },
});
