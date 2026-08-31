import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { Skeleton } from './Skeleton';
import { ROW_AVATAR } from './ProviderRow';

/**
 * The Explore screen's first paint, held as a skeleton of what is arriving: one
 * featured hero and a short run of rows in the real geometry. It replaces the
 * bare centered spinner so the directory does not flash empty then jump — the
 * hero rectangle and the rows are exactly where the loaded content lands.
 */
export function DirectorySkeleton({ rows = 6 }: { rows?: number }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.root} accessible={false} pointerEvents="none">
      <Skeleton height={190} radius={TOKENS.radius.lg} style={styles.hero} />
      {Array.from({ length: rows }).map((_, i) => (
        <View key={i} style={styles.row}>
          <Skeleton width={ROW_AVATAR} height={ROW_AVATAR} radius={ROW_AVATAR / 2} />
          <View style={styles.lines}>
            <Skeleton width="42%" height={15} radius={TOKENS.radius.xs} />
            <Skeleton width="68%" height={13} radius={TOKENS.radius.xs} />
          </View>
          <View style={styles.meta}>
            <Skeleton width={38} height={13} radius={TOKENS.radius.xs} />
            <Skeleton width={58} height={11} radius={TOKENS.radius.xs} />
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    root: {
      paddingTop: TOKENS.space.sm,
    },
    hero: {
      marginHorizontal: TOKENS.space.md,
      marginBottom: TOKENS.space.lg,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingVertical: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
    },
    lines: {
      flex: 1,
      gap: 6,
    },
    meta: {
      alignItems: 'flex-end',
      gap: 6,
    },
  });
