import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS } from '../theme/tokens';

/** Centred, unadorned. A rule either side would draw the eye to the frame. */
function DayDividerView({ label }: { label: string }) {
  return (
    <View style={styles.host}>
      <Text allowFontScaling style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

export const DayDivider = memo(DayDividerView);

const styles = StyleSheet.create({
  host: {
    alignItems: 'center',
    paddingVertical: TOKENS.space['2xs'],
  },
  label: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.tertiary,
  },
});
