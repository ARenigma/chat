import React, { useMemo } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useProfile, useProviders } from '../api/chat';
import { useFavorites } from '../store/useFavorites';
import { NAV_BAR_HEIGHT } from '../components/FloatingToolbar';
import { Icon } from '../components/Icon';
import { ProviderRow } from '../components/ProviderRow';

interface Props {
  onOpenProvider: (id: string) => void;
}

/**
 * The Favourites tab — the people a member has hearted.
 *
 * Reads the persisted favourite ids (`useFavorites`) and shows those providers
 * from the directory as the same rows Explore uses. An honest empty state points
 * back at the heart on a profile, so a fresh member knows how the list fills.
 */
export function FavouritesScreen({ onOpenProvider }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  useProfile();
  const { data: providers } = useProviders();
  const ids = useFavorites(s => s.ids);
  const favourites = useMemo(
    () => (providers ?? []).filter(p => ids.includes(p.id)),
    [providers, ids],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + TOKENS.space['2xs'] }]}>
      <View style={styles.nav}>
        <Text allowFontScaling style={styles.title}>
          Favourites
        </Text>
      </View>
      {favourites.length > 0 ? (
        <ScrollView
          showsVerticalScrollIndicator={false}
          {...SCROLL_PHYSICS}
          contentContainerStyle={[
            styles.scroll,
            { paddingBottom: insets.bottom + NAV_BAR_HEIGHT + TOKENS.space.xl },
          ]}>
          <View style={styles.rows}>
            {favourites.map((p, i) => (
              <ProviderRow
                key={p.id}
                provider={p}
                index={i}
                isLast={i === favourites.length - 1}
                onPress={() => onOpenProvider(p.id)}
                onPressAvatar={() => onOpenProvider(p.id)}
              />
            ))}
          </View>
        </ScrollView>
      ) : (
        <View style={styles.empty}>
          <Icon name="heart" size={36} color={theme.color.text.tertiary} />
          <Text allowFontScaling style={styles.emptyTitle}>
            No favourites yet
          </Text>
          <Text allowFontScaling style={styles.emptyBody}>
            Tap the heart on someone’s profile to save them here.
          </Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    nav: {
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    title: {
      ...TOKENS.typography.displaySmall,
      color: t.color.text.primary,
    },
    scroll: {
      paddingTop: TOKENS.space['2xs'],
    },
    rows: {
      paddingHorizontal: TOKENS.space.md,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space['2xl'],
    },
    emptyTitle: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
      marginTop: TOKENS.space.xs,
    },
    emptyBody: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
  });
