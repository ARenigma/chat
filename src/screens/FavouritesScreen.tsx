import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { ProviderTypeTabs } from '../components/ProviderTypeTabs';
import {
  categoryOf,
  DEFAULT_CATEGORY,
  type ProviderCategory,
} from '../lib/providerFilters';

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
  const allFavourites = useMemo(
    () => (providers ?? []).filter(p => ids.includes(p.id)),
    [providers, ids],
  );

  /*
   * Listener / Astrologer tabs, added 2026-09-08 (Amit: "favourites should also
   * have type tabs at top"), and the SAME component Explore uses
   * (`ProviderTypeTabs`) rather than a second hand-built strip — the tab is
   * measured M3 machinery (an elastic sliding indicator), not a a few lines of
   * markup, and Explore's copy was already the one implementation once this
   * screen needed its own.
   *
   * Unlike Explore, this tab can legitimately start on an EMPTY list — a
   * member may have favourited only listeners — so, unlike Explore, favourites
   * are counted per category up front and the initial tab is whichever one
   * actually has someone in it, favouring listeners on a tie. Landing on an
   * empty Astrologers tab when every favourite is a listener would look like
   * the heart taps were lost.
   */
  const [category, setCategory] = useState<ProviderCategory>(DEFAULT_CATEGORY);
  const initialCategorySet = useRef(false);
  const favourites = useMemo(
    () => allFavourites.filter(p => categoryOf(p) === category),
    [allFavourites, category],
  );
  useEffect(() => {
    if (initialCategorySet.current || providers === undefined) {
      return;
    }
    initialCategorySet.current = true;
    const hasListener = allFavourites.some(p => categoryOf(p) === 'listener');
    if (!hasListener && allFavourites.some(p => categoryOf(p) === 'astrologer')) {
      setCategory('astrologer');
    }
  }, [allFavourites, providers]);

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
      <ProviderTypeTabs value={category} onChange={setCategory} testID="favourites-tabs" />
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
          <Icon name="heart" size={TOKENS.icon['2xl']} color={theme.color.text.tertiary} />
          <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.emptyTitle}>
            {allFavourites.length === 0
              ? 'No favourites yet'
              : `No ${category === 'listener' ? 'listeners' : 'astrologers'} favourited`}
          </Text>
          <Text allowFontScaling style={styles.emptyBody}>
            {allFavourites.length === 0
              ? "Tap the heart on someone's profile to save them here."
              : // A real favourite exists, just not in this tab — distinct from
                // "you have never favourited anyone", which is what the message
                // above this one is for.
                `Your ${category === 'listener' ? 'astrologer' : 'listener'} favourites are on the other tab.`}
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
