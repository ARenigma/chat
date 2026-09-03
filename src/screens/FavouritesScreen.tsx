import React, { useCallback, useMemo, useRef } from 'react';
import { FlashList, type FlashListProps } from '@shopify/flash-list';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useProfile, useProviders } from '../api/chat';
import { useFavorites } from '../store/useFavorites';
import type { ProviderSummary } from '../lib/database.types';
import { NAV_BAR_HEIGHT } from '../components/FloatingToolbar';
import { TopAppBar } from '../components/TopAppBar';
import { Icon } from '../components/Icon';
import { SquareProviderCard, SQUARE_CARD_ESTIMATE } from '../components/ProviderCard';

interface Props {
  onOpenProvider: (id: string) => void;
}

// Reanimated wrapper so the grid's scroll offset drives the medium app bar's
// collapse on the UI thread (see ChatsListScreen for the same pattern).
const AnimatedFlashList = Animated.createAnimatedComponent(
  FlashList as React.ComponentType<FlashListProps<ProviderSummary>>,
);

/**
 * The Favourites tab — the people a member has hearted.
 *
 * Shows favourited providers as M3 Cards rather than the directory rows that
 * Explore uses. Cards are appropriate here because the member has already chosen
 * these people; the context is personal curation, not scanning a list.
 * Guideline: https://m3.material.io/components/cards/guidelines
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

  // Stable callback so ProviderCard.memo holds across re-renders.
  const handleOpenProvider = useCallback(
    (id: string) => onOpenProvider(id),
    [onOpenProvider],
  );

  // Track which provider ids have already received their entrance animation.
  // FlashList recycles cells on scroll; without this guard the Animated.View
  // would remount on every recycled cell and re-fire the stagger — an
  // unwanted flash on every scroll-back.
  const seenIds = useRef(new Set<string>());

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler(e => {
    scrollY.value = e.contentOffset.y;
  });

  const renderFavouriteCard = useCallback(
    ({ item, index }: { item: (typeof favourites)[number]; index: number }) => {
      const animate = !seenIds.current.has(item.id);
      if (animate) {
        seenIds.current.add(item.id);
      }
      return (
        <SquareProviderCard
          provider={item}
          index={index}
          onPress={handleOpenProvider}
          animateEntrance={animate}
        />
      );
    },
    [handleOpenProvider],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopAppBar
        variant="medium"
        title="Favourites"
        subtitle={
          favourites.length > 0
            ? `${favourites.length} ${favourites.length === 1 ? 'person' : 'people'}`
            : undefined
        }
        scrollY={scrollY}
        testID="favourites-app-bar"
      />
      {favourites.length > 0 ? (
        <AnimatedFlashList
          data={favourites}
          keyExtractor={p => p.id}
          renderItem={renderFavouriteCard}
          numColumns={2}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          {...SCROLL_PHYSICS}
          contentContainerStyle={{
            paddingHorizontal: TOKENS.space.md,
            paddingTop: TOKENS.space.sm,
            paddingBottom: insets.bottom + NAV_BAR_HEIGHT + TOKENS.space.xl,
          }}
          // SQUARE_CARD_ESTIMATE: square card ≈ 165dp + 12dp margin ≈ 178dp.
          // FlashList self-corrects after first layout; this prevents the initial
          // blank-frame pass on a long list.
          overrideItemLayout={layout => {
            (layout as { span?: number; size?: number }).size = SQUARE_CARD_ESTIMATE;
          }}
        />
      ) : (
        <View style={styles.empty}>
          <Icon name="heart" size={36} color={theme.color.text.tertiary} />
          <Text allowFontScaling style={styles.emptyTitle}>
            No favourites yet
          </Text>
          <Text allowFontScaling style={styles.emptyBody}>
            Tap the heart on someone's profile to save them here.
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
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space['2xl'],
    },
    emptyTitle: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
      marginTop: TOKENS.space.xs,
    },
    emptyBody: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
  });
