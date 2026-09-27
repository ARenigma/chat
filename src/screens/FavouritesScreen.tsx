import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import {
  Keyboard,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { useSoftReset } from '../lib/routes/useSoftReset';
import { useTabPress } from '../lib/routes/useTabPress';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useProfile, useProviders } from '../api/chat';
import { useProviderBusyWaits, withBusyWaits } from '../api/busy';
import { useFavorites } from '../store/useFavorites';
import { useBottomBarOffset } from '../shell/useBottomBarOffset';
import { useSearchBack } from '../hooks/useSearchBack';
import { TabTopBar } from '../components/TabTopBar';
import { Icon } from '../components/Icon';
import { SquareProviderCard, SQUARE_CARD_ESTIMATE } from '../components/ProviderCard';
import { ProviderPager, type ProviderPagerRef } from '../components/ProviderPager';
import { ProviderTypeTabs } from '../components/ProviderTypeTabs';
import type { ProviderSummary } from '../lib/database.types';
import {
  categoryOf,
  DEFAULT_CATEGORY,
  PROVIDER_CATEGORIES,
  type ProviderCategory,
} from '../lib/providerFilters';

interface Props {
  onOpenProvider: (id: string) => void;
  /** Whether Favourites is the focused screen; a covered tab polls nothing. */
  focused?: boolean;
}

/**
 * The Favourites tab — the people a member has hearted.
 *
 * Shows favourited providers as M3 Cards rather than the directory rows that
 * Explore uses. Cards are appropriate here because the member has already chosen
 * these people; the context is personal curation, not scanning a list.
 * Guideline: https://m3.material.io/components/cards/guidelines
 */
export function FavouritesScreen({ onOpenProvider, focused = true }: Props) {
  const styles = useStyles(makeStyles);
  useProfile();
  const { data: directoryRows } = useProviders();
  const ids = useFavorites(s => s.ids);
  // Busy providers carry `busy_wait_minutes` (migration 154): merged in HERE,
  // at the one place this screen reads the directory, so every page and row
  // sees the same answer. The hook polls every 30s while the
  // app is foregrounded (TanStack focusManager) and only while this tab is
  // the focused screen.
  const busyWaits = useProviderBusyWaits(ids, { focused });
  const providers = useMemo(
    () => (directoryRows === undefined ? undefined : withBusyWaits(directoryRows, busyWaits)),
    [directoryRows, busyWaits],
  );
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
   * The same pager Home has (owner decision, Amit 2026-09-26/27): each
   * category is a page, a swipe moves between them, and the tabs follow
   * `categoryProgress` on the UI thread. `category` is the SETTLED page, set
   * once per change — see HomeScreen's note on the two values for why neither
   * may do the other's job.
   */
  const categoryProgress = useSharedValue(PROVIDER_CATEGORIES.indexOf(DEFAULT_CATEGORY));
  const pagerRef = useRef<ProviderPagerRef>(null);
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
  const closeSearch = useCallback(() => {
    // The IME leaves with search, on every exit (as on Home).
    Keyboard.dismiss();
    setQuery('');
    setSearching(false);
  }, []);
  // Hardware back leaves search first, as on Home (`useSearchBack`, nav §4).
  useSearchBack(searching, closeSearch);
  // Pressing Favourites leaves search, as pressing Home does (2026-09-27).
  useTabPress('Favourites', closeSearch);
  // One list per page, each filtered by its own category and the one query.
  const favouritesByCategory = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const byCategory = {} as Record<ProviderCategory, ProviderSummary[]>;
    for (const c of PROVIDER_CATEGORIES) {
      const inCategory = allFavourites.filter(p => categoryOf(p) === c);
      byCategory[c] =
        needle === ''
          ? inCategory
          : inCategory.filter(p => p.display_name.toLowerCase().includes(needle));
    }
    return byCategory;
  }, [allFavourites, query]);
  useEffect(() => {
    if (initialCategorySet.current || providers === undefined) {
      return;
    }
    initialCategorySet.current = true;
    const hasListener = allFavourites.some(p => categoryOf(p) === 'listener');
    if (!hasListener && allFavourites.some(p => categoryOf(p) === 'astrologer')) {
      /*
       * The screen's choice, not the member's, so the pager JUMPS rather than
       * scrolls, and its `onPageSelected` settles `category`. The direct set
       * covers the frame before the pager has mounted.
       */
      const index = PROVIDER_CATEGORIES.indexOf('astrologer');
      setCategory('astrologer');
      categoryProgress.set(index);
      pagerRef.current?.jumpTo(index);
    }
  }, [allFavourites, providers, categoryProgress]);

  const onPageSelected = useCallback((index: number) => {
    setCategory(PROVIDER_CATEGORIES[index] ?? DEFAULT_CATEGORY);
  }, []);
  // A tap asks the pager to scroll; the scroll moves the indicator and settles
  // `category`. Favourites always has its pager mounted, so there is no
  // fallback path here, unlike Home's skeleton.
  const selectCategory = useCallback((c: ProviderCategory) => {
    pagerRef.current?.setPage(PROVIDER_CATEGORIES.indexOf(c));
  }, []);

  // Stable callback so ProviderCard.memo holds across re-renders.
  const handleOpenProvider = useCallback(
    (id: string) => onOpenProvider(id),
    [onOpenProvider],
  );

  // Track which provider ids have already received their entrance animation.
  // FlashList recycles cells on scroll; without this guard the Animated.View
  // would remount on every recycled cell and re-fire the stagger — an
  // unwanted flash on every scroll-back. Shared by both pages: ids are unique
  // across categories.
  const seenIds = useRef(new Set<string>());
  const bottomPadding = useBottomBarOffset(TOKENS.space.xl);

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
        onSearchClose={closeSearch}
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder="Search your favourites"
        testID="favourites"
      />
      <ProviderTypeTabs
        value={category}
        progress={categoryProgress}
        onSelect={selectCategory}
        testID="favourites-tabs"
      />
      <ProviderPager
        ref={pagerRef}
        initialPage={PROVIDER_CATEGORIES.indexOf(category)}
        dragProgress={categoryProgress}
        onPageSelected={onPageSelected}
        testID="favourites-pager">
        {PROVIDER_CATEGORIES.map(c => (
          <View key={c} collapsable={false}>
            <FavouritesPage
              category={c}
              focused={c === category}
              favourites={favouritesByCategory[c]}
              hasAnyFavourite={allFavourites.length > 0}
              query={query}
              seenIds={seenIds}
              bottomPadding={bottomPadding}
              onOpenProvider={handleOpenProvider}
            />
          </View>
        ))}
      </ProviderPager>
    </View>
  );
}

/**
 * One category's page of the Favourites pager: the grid, or the empty state
 * that explains why this page is empty.
 *
 * Both pages are mounted at once (ProviderPager keeps the neighbour laid out),
 * so entrances play on the FOCUSED page only — the page being swiped to should
 * already be there, not stagger in under a sliding page. Its ids are still
 * marked seen, so recycling cannot replay an entrance on scroll-back.
 */
const FavouritesPage = memo(function ({
  category,
  focused,
  favourites,
  hasAnyFavourite,
  query,
  seenIds,
  bottomPadding,
  onOpenProvider,
}: {
  category: ProviderCategory;
  focused: boolean;
  favourites: ProviderSummary[];
  hasAnyFavourite: boolean;
  query: string;
  seenIds: React.RefObject<Set<string>>;
  bottomPadding: number;
  onOpenProvider: (id: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const reducedMotion = useReducedMotion();
  const listRef = useRef<FlashListRef<ProviderSummary> | null>(null);
  // Re-tap Favourites (the settled page only; search filters it in place) at its root: back to the top (step 9, nav-migration §6).
  useSoftReset(() => listRef.current?.scrollToOffset({ offset: 0, animated: !reducedMotion }), focused);
  const renderFavouriteCard = useCallback(
    ({ item, index }: { item: ProviderSummary; index: number }) => {
      const animate = focused && !seenIds.current.has(item.id);
      seenIds.current.add(item.id);
      return (
        <SquareProviderCard
          provider={item}
          index={index}
          onPress={onOpenProvider}
          animateEntrance={animate}
        />
      );
    },
    [focused, seenIds, onOpenProvider],
  );

  if (favourites.length > 0) {
    return (
      <FlashList
        ref={listRef}
        testID={`favourites-scroll-${category}`}
        data={favourites}
        keyExtractor={p => p.id}
        renderItem={renderFavouriteCard}
        numColumns={2}
        showsVerticalScrollIndicator={false}
        {...SCROLL_PHYSICS}
        contentContainerStyle={{
          paddingHorizontal: TOKENS.space.md,
          paddingTop: TOKENS.space.sm,
          paddingBottom: bottomPadding,
        }}
        // SQUARE_CARD_ESTIMATE: square card ≈ 165dp + 12dp margin ≈ 178dp.
        // FlashList self-corrects after first layout; this prevents the initial
        // blank-frame pass on a long list.
        overrideItemLayout={layout => {
          (layout as { span?: number; size?: number }).size = SQUARE_CARD_ESTIMATE;
        }}
      />
    );
  }
  return (
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
          : !hasAnyFavourite
            ? 'No favourites yet'
            : `No ${category === 'listener' ? 'listeners' : 'astrologers'} favourited`}
      </Text>
      <Text allowFontScaling style={styles.emptyBody}>
        {query.trim() !== ''
          ? `Nobody in your ${category === 'listener' ? 'listener' : 'astrologer'} favourites matches ${JSON.stringify(query.trim())}.`
          : !hasAnyFavourite
            ? "Tap the heart on someone's profile to save them here."
            : // A real favourite exists, just not in this tab — distinct from
              // "you have never favourited anyone", which is what the message
              // above this one is for.
              `Your ${category === 'listener' ? 'astrologer' : 'listener'} favourites are on the other tab.`}
      </Text>
    </View>
  );
});

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
