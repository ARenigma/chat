import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { TOKENS } from '../theme/tokens';
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
  const typing = useStore(selectPeerTyping);

  if (!typing) {
    return null;
  }

  return (
    <View style={styles.row}>
      <View style={styles.slot}>
        <Avatar initial={initial} size={26} breathing />
      </View>
      <View style={styles.column}>
        <TypingIndicator label={`${name} is typing`} />
      </View>
    </View>
  );
}

export const PeerTyping = memo(PeerTypingView);

const styles = StyleSheet.create({
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
  column: {
    flex: 1,
  },
});
