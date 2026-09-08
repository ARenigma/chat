import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useProfile, useProviders } from '../api/chat';
import { useFavorites } from '../store/useFavorites';
import { NAV_BAR_HEIGHT } from '../components/FloatingToolbar';
import { TabTopBar } from '../components/TabTopBar';
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
  /*
   * The bar's magnifier filters THIS screen, which is what WhatsApp's does on
   * every tab (Amit named it as the reference, 2026-09-08). So the query is
   * local state here rather than a route into Home's people search: a member
   * searching from Favourites is looking for someone they already hearted.
   *
   * Name only. Home's search also matches languages, because it is searching a
   * directory of strangers; a favourites list is short and personal, and the
   * fact the member knows is the name.
   */
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const favourites = useMemo(() => {
    const inCategory = allFavourites.filter(p => categoryOf(p) === category);
    const needle = query.trim().toLowerCase();
    return needle === ''
      ? inCategory
      : inCategory.filter(p => p.display_name.toLowerCase().includes(needle));
  }, [allFavourites, category, query]);
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
    <View style={styles.root}>
      {/*
       * The SAME bar Home renders, with "Favourites" in the wordmark's slot at
       * regular weight (Amit: "home to fovourties o setting the top app bar
       * remians constant -- just chnage pappal to fav to settings"). It owns
       * the safe-area padding, which is why `root` no longer applies it.
       *
       * What this replaced: a medium TopAppBar with a large "Favourites"
       * headline and a "1 person" subtitle. It was 128dp against Home's 48dp
       * row, so every switch between the two tabs moved the tabs and the
       * content under them — the shift Amit called out ("the viewport must not
       * shift when hopping beteen ... screens (home to favourite)"). No back
       * arrow either: this is a tab's first screen.
       */}
      <TabTopBar
        title="Favourites"
        searching={searching}
        onSearchOpen={() => setSearching(true)}
        onSearchClose={() => {
          setQuery('');
          setSearching(false);
        }}
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder="Search your favourites"
        testID="favourites"
      />
      <ProviderTypeTabs value={category} onChange={setCategory} testID="favourites-tabs" />
      {favourites.length > 0 ? (
        <FlashList
          data={favourites}
          keyExtractor={p => p.id}
          renderItem={renderFavouriteCard}
          numColumns={2}
          showsVerticalScrollIndicator={false}
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
          <Icon
            /* The magnifier, not the heart, when a QUERY is what emptied the
               grid: the heart's message ("tap the heart to save someone") is
               advice for a member with no favourites, and reads as if the ones
               they have were lost. */
            name={query.trim() === '' ? 'heart' : 'search'}
            size={TOKENS.icon['2xl']}
            color={theme.color.text.tertiary}
          />
          <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling style={styles.emptyTitle}>
            {query.trim() !== ''
              ? 'No match'
              : allFavourites.length === 0
                ? 'No favourites yet'
                : `No ${category === 'listener' ? 'listeners' : 'astrologers'} favourited`}
          </Text>
          <Text allowFontScaling style={styles.emptyBody}>
            {query.trim() !== ''
              ? `Nobody in your ${category === 'listener' ? 'listener' : 'astrologer'} favourites matches ${JSON.stringify(query.trim())}.`
              : allFavourites.length === 0
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
