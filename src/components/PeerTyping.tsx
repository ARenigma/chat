import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { selectPeerTyping, useStore } from '../store/useStore';
import { Avatar } from './Avatar';
import { TypingIndicator } from './TypingIndicator';

/**
 * The typing indicator, deliberately rendered outside the FlatList.
 *
 * This inherits the role the streaming bubble used to play: it is the only
 * subscriber to the live-activity state, so the transcript's `data` prop never
 * changes when the other person starts or stops typing and the list performs no
 * layout work. Its identity is stable (module-level memo), so handing it to
 * `ListHeaderComponent` does not invalidate the list either.
 */
function PeerTypingView({ initial, name }: { initial: string; name: string }) {
  const styles = useStyles(makeStyles);
  const typing = useStore(selectPeerTyping);

  if (!typing) {
    return null;
  }

  return (
    <View style={styles.row}>
      <View style={styles.slot}>
        <Avatar initial={initial} size={26} breathing />
      </View>
      {/* In a bubble, at the peer's bubble position. Three loose dots beside an
          avatar is not where iOS Messages puts the typing state, and the same
          `bg/sunken` fill Turn.tsx uses is what makes it read as a bubble the
          other person is about to fill. */}
      <View style={styles.bubble}>
        <TypingIndicator label={`${name} is typing`} />
      </View>
    </View>
  );
}

export const PeerTyping = memo(PeerTypingView);

const makeStyles = (_t: Theme) => StyleSheet.create({
  // No counter-flip: VirtualizedList composes its inversion style onto the
  // ListHeaderComponent wrapper, so the header renders upright already.
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: TOKENS.space.xs,
    width: '100%',
  },
  slot: {
    width: 26,
  },
  bubble: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space.hair,
    borderRadius: 18,
    borderCurve: 'continuous',
    backgroundColor: _t.color.bg.sunken,
  },
});
