import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { Skeleton } from './Skeleton';
import {
  PROVIDER_CARD_HEIGHT,
  ROW_AVATAR_RING,
  ROW_CARD_GAP,
  ROW_CTA_HEIGHT,
  ROW_CTA_WIDTH,
} from './ProviderRow';
import { STARS_WIDTH } from './RatingStars';

/**
 * The Explore screen's first paint, held as a skeleton of what is arriving.
 *
 * IT TRACKS THE REAL CARD BY IMPORT, not by eye. Every box below is sized from
 * a constant `ProviderRow` exports, so the two cannot drift — and they had
 * already drifted once: this drew a 40dp circle and two text lines while the
 * card grew to a ringed 84dp avatar, a star row, five text lines and a 48dp
 * button. A skeleton whose shape is a lie is worse than a spinner, because the
 * content visibly jumps when it lands.
 */
export function DirectorySkeleton({ rows = 5 }: { rows?: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.root} accessible={false} pointerEvents="none">
      <Skeleton height={190} radius={TOKENS.radius.lg} style={styles.hero} />
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.card}>
          {/* Left column: the ringed avatar, the star row, the review count. */}
          <View style={styles.leftColumn}>
            <Skeleton
              width={ROW_AVATAR_RING}
              height={ROW_AVATAR_RING}
              radius={ROW_AVATAR_RING / 2}
            />
            <Skeleton width={STARS_WIDTH} height={12} radius={TOKENS.radius.xs} />
            <Skeleton width={52} height={11} radius={TOKENS.radius.xs} />
          </View>
          {/* Right column: name, expertise, languages, experience, price row. */}
          <View style={styles.lines}>
            <Skeleton width="52%" height={16} radius={TOKENS.radius.xs} />
            <Skeleton width="76%" height={20} radius={TOKENS.radius.xs} />
            <Skeleton width="46%" height={12} radius={TOKENS.radius.xs} />
            <Skeleton width="34%" height={12} radius={TOKENS.radius.xs} />
            <View style={styles.priceLine}>
              <Skeleton width={62} height={16} radius={TOKENS.radius.xs} />
              <View style={styles.spacer} />
              <Skeleton
                width={ROW_CTA_WIDTH}
                height={ROW_CTA_HEIGHT}
                radius={TOKENS.radius.xs}
              />
            </View>
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      paddingTop: TOKENS.space.sm,
    },
    hero: {
      marginHorizontal: TOKENS.space.md,
      marginBottom: TOKENS.space.lg,
    },
    // The card's own box, so the skeleton occupies exactly the height the list
    // will need and nothing shifts when the data lands.
    card: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: TOKENS.space.sm,
      height: PROVIDER_CARD_HEIGHT,
      padding: TOKENS.space.sm,
      marginHorizontal: TOKENS.space.sm,
      marginBottom: ROW_CARD_GAP,
      borderRadius: TOKENS.radius.sm,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.raised,
    },
    leftColumn: {
      width: ROW_AVATAR_RING,
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
    },
    lines: {
      flex: 1,
      gap: TOKENS.space['2xs'],
    },
    priceLine: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    spacer: {
      flex: 1,
    },
  });
