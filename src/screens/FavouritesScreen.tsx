import React, { useCallback, useMemo, useRef } from 'react';
import { FlashList } from '@shopify/flash-list';
import { StyleSheet, Text, View } from 'react-native';
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

  // A3: stable callback so ProviderRow.memo holds across re-renders.
  const handleOpenProvider = useCallback(
    (id: string) => onOpenProvider(id),
    [onOpenProvider],
  );

  // Track which provider ids have already received their entrance animation.
  // FlashList recycles cells on scroll; without this guard, every time a recycled
  // cell is handed a new item the Animated.View would remount and re-fire the
  // FadeInDown stagger — an unwanted flash on every scroll-back.
  const seenIds = useRef(new Set<string>());

  const renderFavouriteRow = useCallback(
    ({ item, index }: { item: (typeof favourites)[number]; index: number }) => {
      const animate = !seenIds.current.has(item.id);
      if (animate) {
        seenIds.current.add(item.id);
      }
      return (
        <ProviderRow
          provider={item}
          index={index}
          isLast={index === favourites.length - 1}
          onPress={handleOpenProvider}
          onPressAvatar={handleOpenProvider}
          animateEntrance={animate}
        />
      );
    },
    [favourites.length, handleOpenProvider],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top + TOKENS.space['2xs'] }]}>
      <View style={styles.nav}>
        <Text allowFontScaling style={styles.title}>
          Favourites
        </Text>
      </View>
      {favourites.length > 0 ? (
        <FlashList
          data={favourites}
          keyExtractor={p => p.id}
          renderItem={renderFavouriteRow}
          showsVerticalScrollIndicator={false}
          {...SCROLL_PHYSICS}
          contentContainerStyle={[
            styles.scroll,
            {
              paddingHorizontal: TOKENS.space.md,
              paddingBottom: insets.bottom + NAV_BAR_HEIGHT + TOKENS.space.xl,
            },
          ]}
        />
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
