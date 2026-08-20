import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS } from '../theme/tokens';
import { selectIsStreaming, selectStreamText, useStore } from '../store/useStore';
import { Avatar } from './Avatar';
import { TypingIndicator } from './TypingIndicator';

/**
 * The live reply, deliberately rendered outside the FlatList.
 *
 * This component is the entire re-render surface of a stream: it is the only
 * subscriber to `streamText`, and the list's `data` prop never changes while a
 * reply arrives, so the transcript performs no layout work at all. Its identity
 * is stable (module-level memo), so handing it to ListHeaderComponent does not
 * invalidate the list either.
 */
function StreamingTurnView({ initial }: { initial: string }) {
  const isStreaming = useStore(selectIsStreaming);
  const text = useStore(selectStreamText);

  if (!isStreaming) {
    return null;
  }

  return (
    <View style={styles.row}>
      <View style={styles.slot}>
        <Avatar initial={initial} size={26} breathing />
      </View>
      <View style={styles.column}>
        {text === '' ? (
          <TypingIndicator />
        ) : (
          <Text
            testID="streaming-bubble"
            allowFontScaling
            accessibilityLiveRegion="polite"
            style={styles.text}>
            {text}
          </Text>
        )}
      </View>
    </View>
  );
}

export const StreamingTurn = memo(StreamingTurnView);

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
    paddingRight: TOKENS.space.xl,
  },
  text: {
    ...TOKENS.typography.bodyLarge,
    color: TOKENS.color.text.primary,
  },
});
