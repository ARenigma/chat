import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';

/** Centred, unadorned. A rule either side would draw the eye to the frame. */
function DayDividerView({ label }: { label: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.host}>
      <Text allowFontScaling style={styles.label}>
        {label}
      </Text>
    </View>
  );
}

export const DayDivider = memo(DayDividerView);

const makeStyles = (t: Theme) => StyleSheet.create({
  host: {
    alignItems: 'center',
    paddingVertical: TOKENS.space['2xs'],
  },
  label: {
    ...TOKENS.typography.captionSmall,
    color: t.color.text.tertiary,
  },
});
