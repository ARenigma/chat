import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { dividerParts } from '../lib/datetime';

/**
 * Centred, unadorned. A rule either side would draw the eye to the frame.
 *
 * It takes an instant, not a label, and that is the fix rather than a
 * refactor: the prop used to be a bare `label: string` with no date logic
 * anywhere in the app, and the single call site passed the literal `"Today"` as
 * the `ListFooterComponent` of an *inverted* list, so one hardcoded divider
 * rendered at the visual top of the transcript, labelling the oldest message
 * whatever date it was on. A component that cannot be given a wrong label is
 * better than a comment asking for the right one.
 *
 * Bold relative day plus a regular short date ("Today, 10 May") on one line,
 * matching the reference's timeline metadata (#3). The padding is `space.md`
 * rather than the `2xs` it was: this separates days, so it earns real air
 * instead of decorating.
 */
function DayDividerView({ iso }: { iso: string }) {
  const styles = useStyles(makeStyles);
  const { label, date } = dividerParts(iso);
  return (
    <View style={styles.host}>
      {/* A centred date pill (Sweprek): a soft rounded chip rather than bare
          text, so the day-break reads as a deliberate marker floating over the
          wallpaper instead of a stray line. */}
      <View style={styles.pill}>
        <Text allowFontScaling style={styles.day}>
          {label}
          {date ? <Text style={styles.date}>, {date}</Text> : null}
        </Text>
      </View>
    </View>
  );
}

export const DayDivider = memo(DayDividerView);

const makeStyles = (t: Theme) => StyleSheet.create({
  host: {
    alignItems: 'center',
    paddingVertical: TOKENS.space.md,
  },
  pill: {
    paddingHorizontal: TOKENS.space.sm,
    paddingVertical: TOKENS.space['2xs'],
    borderRadius: TOKENS.radius.pill,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.grouped,
  },
  day: {
    ...TOKENS.typography.labelSmall,
    color: t.color.text.secondary,
  },
  date: {
    ...TOKENS.typography.captionRegular,
    color: t.color.text.secondary,
  },
});
