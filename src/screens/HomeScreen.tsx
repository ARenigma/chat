import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import {
  Image,
  PixelRatio,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ConversationSummary, ProviderSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { contentColumnWidth } from '../lib/windowSize';
import { sizedStorageImageUri } from '../lib/storageImage';
import { storage } from '../lib/storage';
import { useConversations, useProfile, useProviders } from '../api/chat';
import {
  AGE_BANDS,
  AGE_BAND_LABEL,
  CATEGORY_LABEL,
  DEFAULT_CATEGORY,
  NO_FILTER,
  PROVIDER_CATEGORIES,
  categoryOf,
  filterProviders,
  isFiltering,
  toggleBand,
  type DirectoryFilter,
  type ProviderCategory,
} from '../lib/providerFilters';
import { useBackGuard } from '../lib/backGuard';
import { useBlockedPeerIds } from '../api/safety';
import { useStore } from '../store/useStore';
import { Avatar } from '../components/Avatar';
import { NAV_BAR_HEIGHT } from '../components/FloatingToolbar';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { ProviderRow } from '../components/ProviderRow';
import { DirectorySkeleton } from '../components/DirectorySkeleton';
import { Chip } from '../components/Chip';
import { HeroCarousel } from '../components/HeroCarousel';
import { MetaChip } from '../components/MetaChip';
import { SearchBar } from '../components/SearchBar';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { TokenCounter } from '../components/TokenCounter';
import { SpotlightCard } from '../components/SpotlightCard';
import { ChatStartHint } from '../components/ChatStartHint';
import { ConversationMenu } from '../components/ConversationMenu';
import type { MenuAnchor } from '../components/PaperMenu';
import { TourAnchor } from '../components/TourAnchor';
import { compareConversations, visibleOnRail } from '../lib/railPrefs';
import { useRailPrefs } from '../store/useRailPrefs';
import { useHomeTour } from '../store/useHomeTour';
import {
  directoryIn,
  directoryOut,
  searchIn,
  searchOut,
  searchResultsIn,
  searchResultsOut,
  tabIndicatorLead,
  tabIndicatorTo,
  tabIndicatorTrail,
} from '../theme/motion';

const POTD_DISMISSED_KEY = 'companion.potd.dismissed';

/**
 * The tab strip's active indicator: 3dp tall, rounded on the TOP corners only.
 *
 * Both numbers are the M3 primary-tab indicator's own, not a choice made here.
 * `Base.Widget.Material3.TabLayout` draws it with
 * `<item name="tabIndicator">@drawable/m3_tabs_rounded_line_indicator</item>`
 * (material-components-android
 * `lib/java/com/google/android/material/tabs/res/values/styles.xml`), and that
 * drawable is a rectangle with `topLeftRadius`/`topRightRadius` of `3dp`,
 * `bottomLeftRadius`/`bottomRightRadius` of `0dp`, sized to
 * `@dimen/m3_comp_primary_navigation_tab_active_indicator_height`, which the
 * component's token file declares as `3dp`
 * (`lib/java/com/google/android/material/tabs/res/values/tokens.xml`).
 *
 * It was a 2dp bar with a 1dp radius on all four corners. 2dp is not a Material
 * number for this part and the bottom radius is actively wrong: the indicator
 * sits ON the bottom edge of the strip, so rounding the bottom corners rounds
 * them against an edge nothing can see, which reads as a slightly blurred bar
 * rather than as a rounded one.
 */
const TAB_INDICATOR_HEIGHT = 3;

/**
 * The floor on the indicator's width — 24dp, and it is the reference's floor.
 *
 * `TabIndicatorInterpolator.MIN_INDICATOR_WIDTH = 24`
 * (material-components-android
 * `lib/java/com/google/android/material/tabs/TabIndicatorInterpolator.java`),
 * applied inside `calculateTabViewContentBounds`: "if the calculated difference
 * between the left and right bounds is less than 24dp, then left and right
 * bounds are adjusted such that the difference between them is equal to 24dp".
 * It matters here only as a guard — both labels are far wider than 24dp — but a
 * label has a frame in which it has not measured yet, and this is what the
 * indicator is that frame instead of being zero-width.
 */
const TAB_INDICATOR_MIN_WIDTH = 24;

/**
 * How many tabs share the strip. Hoisted so the indicator's worklet captures a
 * NUMBER rather than the category array — a worklet's closure is serialised to
 * the UI runtime, and `count` is the only thing about the list it needs.
 */
const TAB_COUNT = PROVIDER_CATEGORIES.length;

/**
 * How many profiles the week's carousel holds (Amit, 2026-09-06: "at least
 * three"). One card is a claim; three is a choice.
 */
const TOP_PICKS = 3;

/**
 * The search field's side margin, in dp, and it is 7 rather than a token
 * because the reference measures 7.
 *
 * `contentView.addView(fragmentSearchField, LayoutHelper.createFrame(
 *    LayoutHelper.MATCH_PARENT, 48, Gravity.TOP, 7, -2, 7, 0))`
 * — DialogsActivity.java:5344 in the 12.10.1 tree. MATCH_PARENT width, 48dp
 * tall, 7dp either side.
 *
 * Named and commented rather than inlined because 7 looks like a mistake next
 * to a spacing scale of 4/8/12/16: the app's `space.xs` is 8 and `space.md` is
 * 16, and someone tidying this to either would move the magnifier off the mark.
 * The field's own 12dp glyph inset is what supplies the optical margin, so the
 * outer one is deliberately smaller than anything else on the screen — the two
 * together are the reference's 23dp from screen edge to glyph box.
 */
const SEARCH_ROW_SIDE_MARGIN = 7;

interface Props {
  onOpenConversation: (peerId: string) => void;
  onOpenProvider: (providerId: string) => void;
  /** Open the full chats list from the rail's "See all". */
  onSeeAllChats: () => void;
}

/**
 * v13 Home: Chats and Explore, one screen.
 *
 * This is the deliberate reversal of the first-gen split. `InboxScreen` and
 * `ProvidersScreen` were two tabs — the docblocks there argued the here-now rail
 * and the directory were redundant with each other and pulled them apart. v13
 * puts them back together: a horizontal CHATS rail of the people you are already
 * talking to, then an Explore section — a featured pick and a ranked list — of
 * everyone else. The floating toolbar (Home / Calls / Settings) lives above this
 * as a sibling in `App`, so it survives the scroll.
 *
 * Photos: v13 shows faces everywhere; the data model publishes initials only
 * (no `avatar_url`), so `Avatar` and the featured card degrade to a warm mark
 * until a provider-photo pipeline exists. Structure matches v13; the fill does
 * not pretend to a photo it does not have.
 */
export function HomeScreen({
  onOpenConversation,
  onOpenProvider,
  onSeeAllChats,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const columnWidth = contentColumnWidth(windowWidth);
  const balance = useStore(s => s.balance);
  const openWallet = useStore(s => s.openWallet);
  useProfile();
  const { data: conversations, isPending: convosPending } = useConversations();
  const { data: providers, isPending: providersPending } = useProviders();
  const blocked = useBlockedPeerIds();

  const railPrefs = useRailPrefs();
  const startTour = useHomeTour(s => s.start);
  const tourSeen = useHomeTour(s => s.seen);
  const [menuPeer, setMenuPeer] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);

  /*
   * A tab is a whole view of the app, not a section of one (Amit, 2026-09-06):
   * the strip sits above Chats and BOTH sections follow it, so Listeners and
   * Astrologers are two separate places rather than one place with a filtered
   * shelf in the middle.
   *
   * A peer with no directory row — a suspended provider, or a member on the
   * provider tree — keeps their thread visible under the default tab rather
   * than disappearing from the app: a conversation you have had is not
   * something a filter should be able to hide from you.
   */
  /**
   * Listeners and Astrologers are two views of the whole app, not two shelves
   * inside one (Amit, 2026-09-06): the strip sits above Chats and both the
   * rail and Explore follow it. In search there are no tabs, so a chip row
   * filters by type AND age there instead (goal item 12).
   */
  const [exploreCategory, setExploreCategory] = useState<ProviderCategory>(DEFAULT_CATEGORY);
  const [searchFilter, setSearchFilter] = useState<DirectoryFilter>(NO_FILTER);

  /*
   * ONE indicator that moves between the tabs, rather than one per tab that
   * switches colour. This is the Material component's own behaviour and the
   * whole class that draws it is called `SlidingTabIndicator` —
   * `animateIndicatorToPosition` (material-components-android
   * `lib/java/com/google/android/material/tabs/TabLayout.java:3334`) whose
   * docstring reads "Animate the position of the indicator from its current
   * position to a new position. This is typically used when a tab destination is
   * tapped." It runs a `ValueAnimator` (`:3379-3386`) and hands every frame's
   * fraction to `TabIndicatorInterpolator.updateIndicatorForOffset`, which
   * LERPS THE LEFT AND RIGHT BOUNDS INDEPENDENTLY between the two tabs
   * (`TabIndicatorInterpolator.java`). So the indicator's position AND its width
   * are animated; nothing about it is a hard switch.
   *
   * The three shared values below are exactly the three things that method needs
   * and no more:
   *
   *   tabStripWidth — the strip's measured width, so each tab's slot is
   *                   `width / count`. `MODE_FIXED` + `GRAVITY_FILL` (both
   *                   `TabLayout` defaults, `:674-675`) give every tab
   *                   `lp.width = 0; lp.weight = 1` (`:1797-1805`), i.e. an
   *                   equal share of the whole strip, so a tab's centre is
   *                   `(i + 0.5) * slot` and needs no measuring of its own.
   *   tabLabelWidths — each LABEL's measured width, because an M3 PRIMARY tab's
   *                   indicator is the width of the label, not of the tab. See
   *                   `styles.tabIndicator` for the citation; this is the one
   *                   place the strip has to measure a child.
   *   tabOrigin/tabTarget/tabSlide — the tab the current move started from, the
   *                   one it is heading to, and the progress between them.
   *                   `updateIndicatorForOffset` takes a startTitle, an endTitle
   *                   and an offset; these are those three. The origin is
   *                   snapped to a whole tab rather than to the interpolated
   *                   position when a move is interrupted, which is the
   *                   reference's behaviour too — it re-targets from
   *                   `getChildAt(getSelectedTabPosition())` (`:3358`), the
   *                   selected tab, not from where the bar happens to be.
   */
  const tabIndex = PROVIDER_CATEGORIES.indexOf(exploreCategory);
  const tabStripWidth = useSharedValue(0);
  const tabLabelWidths = useSharedValue<number[]>(
    PROVIDER_CATEGORIES.map(() => 0),
  );
  const tabOrigin = useSharedValue(tabIndex);
  const tabTarget = useSharedValue(tabIndex);
  const tabSlide = useSharedValue(tabIndex);
  useEffect(() => {
    tabOrigin.value = tabTarget.value;
    tabTarget.value = tabIndex;
    tabSlide.value = tabIndicatorTo(tabIndex);
  }, [tabIndex, tabOrigin, tabTarget, tabSlide]);

  const onTabStripLayout = useCallback(
    (width: number) => {
      tabStripWidth.value = width;
    },
    [tabStripWidth],
  );
  /*
   * Written through a ref as well as the shared value because a label's width
   * has to be read to be updated — the shared value's own `.value` is readable
   * from the JS thread, but reading it to build the next array on every layout
   * pass is a UI-thread round trip for something React already owns.
   */
  const labelWidths = useRef<number[]>(PROVIDER_CATEGORIES.map(() => 0));
  const onTabLabelLayout = useCallback(
    (index: number, width: number) => {
      if (labelWidths.current[index] === width) {
        return;
      }
      labelWidths.current = labelWidths.current.map((w, i) =>
        i === index ? width : w,
      );
      tabLabelWidths.value = labelWidths.current;
    },
    [tabLabelWidths],
  );

  /*
   * `ElasticTabIndicatorInterpolator.updateIndicatorForOffset`, re-expressed.
   *
   * The M3 tab style asks for the elastic variant by name —
   * `<item name="tabIndicatorAnimationMode">elastic</item>` in
   * `Base.Widget.Material3.TabLayout` (material-components-android
   * `lib/java/com/google/android/material/tabs/res/values/styles.xml`) — and
   * that subclass gives the two edges DIFFERENT easings so the bar grows across
   * the gap and shrinks on arrival: the edge being travelled toward takes
   * `decInterp` (ease-out sine) and the edge being left takes `accInterp`
   * (ease-in sine). Both live in `src/theme/motion.ts` as `tabIndicatorLead` /
   * `tabIndicatorTrail`, with the file:line, because a curve is a motion
   * decision and this file is not allowed to hold one.
   *
   * `width` is animated, not just `translateX`, which is the point of lerping
   * the two bounds separately — a fixed-width bar sliding across cannot stretch,
   * and the two labels are different widths anyway ("Listeners" against
   * "Astrologers"), so even a rigid move has to resize.
   */
  const tabIndicatorStyle = useAnimatedStyle(() => {
    const slot = tabStripWidth.value / TAB_COUNT;
    if (slot <= 0) {
      // The strip has not measured yet. The reference hides the indicator in
      // the same case — `tweenIndicatorPosition` sets its bounds to -1 when the
      // start title has no width (`TabLayout.java:3311-3320`).
      return { width: 0, opacity: 0, transform: [{ translateX: 0 }] };
    }
    const widths = tabLabelWidths.value;
    const edgesOf = (index: number) => {
      const label = Math.max(widths[index] ?? 0, TAB_INDICATOR_MIN_WIDTH);
      const centre = (index + 0.5) * slot;
      return { left: centre - label / 2, right: centre + label / 2 };
    };
    const from = edgesOf(tabOrigin.value);
    const to = edgesOf(tabTarget.value);
    const span = tabTarget.value - tabOrigin.value;
    const fraction =
      span === 0 ? 1 : (tabSlide.value - tabOrigin.value) / span;
    const movingRight = to.left > from.left;
    const leftFraction = movingRight
      ? tabIndicatorTrail(fraction)
      : tabIndicatorLead(fraction);
    const rightFraction = movingRight
      ? tabIndicatorLead(fraction)
      : tabIndicatorTrail(fraction);
    const left = from.left + (to.left - from.left) * leftFraction;
    const right = from.right + (to.right - from.right) * rightFraction;
    return {
      width: Math.max(right - left, 0),
      opacity: 1,
      transform: [{ translateX: left }],
    };
  });

  const categoryById = useMemo(() => {
    const map = new Map<string, ProviderCategory>();
    for (const p of providers ?? []) {
      map.set(p.id, categoryOf(p));
    }
    return map;
  }, [providers]);

  const chats = useMemo(
    () =>
      (conversations ?? [])
        .filter(c => !blocked.has(c.peer_id) && visibleOnRail(railPrefs, c.peer_id))
        .filter(
          c => (categoryById.get(c.peer_id) ?? DEFAULT_CATEGORY) === exploreCategory,
        )
        .slice()
        .sort((a, b) =>
          compareConversations(
            railPrefs,
            { peerId: a.peer_id, at: a.last_session_at ?? '' },
            { peerId: b.peer_id, at: b.last_session_at ?? '' },
          ),
        ),
    [conversations, blocked, railPrefs, categoryById, exploreCategory],
  );

  // The directory, blocked people removed. The featured pick is lifted out of the
  // list so it is not shown twice.
  const allProviders = useMemo(
    () => (providers ?? []).filter(p => !blocked.has(p.id)),
    [providers, blocked],
  );

  // What Explore shows: one category at a time. The featured pick and the rows
  // both come from here, so the hero always belongs to the tab you are on.
  const directory = useMemo(
    () => filterProviders(allProviders, { category: exploreCategory, bands: [] }),
    [allProviders, exploreCategory],
  );

  /**
   * The week's top picks: best-rated who are here now, then best-rated at all.
   * Deterministic, so the carousel does not reshuffle on every render — a hero
   * that changes under the eye reads as broken.
   *
   * Three rather than one (Amit, 2026-09-06). One card is a claim; three is a
   * choice, and M3's hero carousel is the layout its own guidance names for
   * "spotlighting content that you want to emphasize" while showing a peek of
   * what is next.
   */
  const topPicks = useMemo<ProviderSummary[]>(() => {
    const score = (p: ProviderSummary) =>
      (readPresence(p.presence, p.last_active_at).here ? 1000 : 0) + (p.rating_avg ?? 0);
    return [...directory].sort((a, b) => score(b) - score(a)).slice(0, TOP_PICKS);
  }, [directory]);

  const featured = topPicks[0] ?? null;

  // The picks are lifted out of the list below so nobody is shown twice.
  const rows = useMemo(() => {
    const shown = new Set(topPicks.map(p => p.id));
    return directory.filter(p => !shown.has(p.id));
  }, [directory, topPicks]);

  // A3: stable callbacks so ProviderRow.memo holds across balance ticks.
  // An inline `onPress={() => onOpenProvider(p.id)}` creates a new function on
  // every render of HomeScreen; these hoisted versions are referentially stable
  // as long as the underlying props are stable (nav props typically are).
  // Warm the detail-hero URIs as soon as the directory lands. RN Image already
  // keeps a disk/memory cache on Android — Image.prefetch fills it. No Redis:
  // that is a server-side cache and does not help decode/display on-device.
  // Prefetch the same transform the detail screen requests so a tap hits cache.
  useEffect(() => {
    if (directory.length === 0) {
      return;
    }
    const ratio = PixelRatio.get();
    const heroW = columnWidth - TOKENS.space.md * 2;
    for (const p of directory.slice(0, 10)) {
      if (!p.avatar_url) {
        continue;
      }
      void Image.prefetch(
        sizedStorageImageUri(p.avatar_url, heroW, 420, ratio),
      ).catch(() => {});
    }
  }, [directory, columnWidth]);

  const handleOpenProvider = useCallback(
    (id: string) => {
      const p =
        directory.find(x => x.id === id) ??
        (featured?.id === id ? featured : undefined);
      if (p?.avatar_url) {
        void Image.prefetch(
          sizedStorageImageUri(
            p.avatar_url,
            columnWidth - TOKENS.space.md * 2,
            420,
            PixelRatio.get(),
          ),
        ).catch(() => {});
      }
      onOpenProvider(id);
    },
    [onOpenProvider, directory, featured, columnWidth],
  );
  // A4: stable callback for RailItem so memo holds when balance ticks.
  const handleOpenConversation = useCallback(
    (peerId: string) => onOpenConversation(peerId),
    [onOpenConversation],
  );

  // Inline search (#5). Replaces the placeholder that opened Recharge. Filters the
  // directory by name or language, client-side over the already-loaded list — no
  // round trip, and it works the instant the directory is in hand.
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [potdVisible, setPotdVisible] = useState(false);
  const trimmed = query.trim().toLowerCase();
  /**
   * Search spans BOTH categories — the tab is an Explore idea, not a search one
   * — narrowed by whatever chips are on and then by the text.
   *
   * Chips ALONE are a search (Amit, 2026-09-06). Requiring a query first made
   * the filters look decorative: you could tap "Astrologers, 25-34" and get an
   * empty screen telling you to type a name, which is the opposite of what a
   * filter is for.
   */
  const results = useMemo(() => {
    const narrowed = filterProviders(allProviders, searchFilter);
    if (trimmed === '') {
      return isFiltering(searchFilter) ? narrowed : [];
    }
    return narrowed.filter(
      p =>
        p.display_name.toLowerCase().includes(trimmed) ||
        p.languages.some(l => l.toLowerCase().includes(trimmed)),
    );
  }, [allProviders, searchFilter, trimmed]);

  const closeSearch = useCallback(() => {
    setSearching(false);
    setQuery('');
    // Filters belong to the search session. Leaving them set would mean the
    // next search silently returns fewer people for a reason off screen.
    setSearchFilter(NO_FILTER);
  }, []);

  /*
   * Hardware back leaves search, the way the arrow does.
   *
   * Found on a device 2026-09-07: the "Leave search" arrow worked and the system
   * back button did nothing at all. `searching` is local state that no guard
   * knew about, so the press fell through to App.tsx's route handler, which sees
   * Home as the root and has nothing to pop — two presses in a row left the
   * member still staring at the search field.
   *
   * Android treats this as a correctness requirement, not a nicety: search is
   * exactly the "temporary UI state" the custom-back guidance says must be
   * dismissed by back before the screen itself is left, and the same page says
   * to intercept ONLY in the state that needs it — hence `searching ? … : null`
   * rather than an always-on guard, which is also what keeps ordinary
   * navigation off Home immediate.
   * https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture
   *
   * The guard returns TRUE because it HANDLED the press — `consumeBack` stops at
   * the first guard that does, which is what keeps the press from also reaching
   * App.tsx's route handler and popping Home out from under the member. It
   * cannot just be `closeSearch`: that returns void, and void is not "handled".
   *
   * Memoised on `closeSearch` alone, which itself has an empty dep list, so the
   * identity is stable and this registers once when search opens and
   * unregisters when it closes — the guard stack cannot accumulate duplicates
   * across renders.
   */
  const searchBackGuard = useCallback(() => {
    closeSearch();
    return true;
  }, [closeSearch]);
  useBackGuard(searching ? searchBackGuard : null);

  const loading = convosPending || providersPending;
  const firstUser = balance === 0;
  const tourComplete = tourSeen || !firstUser;

  useEffect(() => {
    if (loading || balance === null || featured === null || searching) {
      return;
    }
    // Tutorial first, then the spotlight — always, on first sign-in. The tour is
    // scheduled at 700ms and the spotlight at 2000ms, but a slow first tour would
    // otherwise be interrupted mid-step by the sheet popping over it. Gating on
    // `tourComplete` removes the race: a zero-balance member must finish or skip
    // the tour, while a funded member bypasses first-user UI regardless of stale
    // local storage. The effect re-runs when either condition changes.
    if (!tourComplete) {
      return;
    }
    if (storage.get(POTD_DISMISSED_KEY) === '1') {
      return;
    }
    const timer = setTimeout(() => setPotdVisible(true), 2000);
    return () => clearTimeout(timer);
  }, [loading, balance, featured, searching, tourComplete]);

  useEffect(() => {
    // Product identity rule: first-user UI is balance-only. A stale local
    // `seen=false` value must never replay onboarding for a funded account.
    if (loading || balance === null || searching || tourSeen || !firstUser) {
      return;
    }
    const timer = setTimeout(() => startTour(), 700);
    return () => clearTimeout(timer);
  }, [loading, balance, searching, tourSeen, firstUser, startTour]);

  const dismissPotd = useCallback(() => {
    storage.set(POTD_DISMISSED_KEY, '1');
    setPotdVisible(false);
  }, []);

  const chatFromPotd = useCallback(() => {
    if (!featured) {
      return;
    }
    storage.set(POTD_DISMISSED_KEY, '1');
    setPotdVisible(false);
    onOpenConversation(featured.id);
  }, [featured, onOpenConversation]);

  // Track which provider ids have already received their entrance animation so
  // FlashList recycling does not re-fire the stagger on every scroll-back.
  const seenIds = useRef(new Set<string>());
  const searchSeenIds = useRef(new Set<string>());

  // When the search query changes the result set changes entirely, so reset the
  // search-seen set so newly visible items animate in fresh.
  useEffect(() => {
    searchSeenIds.current.clear();
  }, [trimmed]);

  const renderExploreRow = useCallback(
    ({ item, index }: { item: ProviderSummary; index: number }) => {
      const animate = !seenIds.current.has(item.id);
      if (animate) {
        seenIds.current.add(item.id);
      }
      return (
        <ProviderRow
          provider={item}
          index={index}
          isLast={index === rows.length - 1}
          onPress={handleOpenProvider}
          onPressAvatar={handleOpenProvider}
          animateEntrance={animate}
        />
      );
    },
    [rows.length, handleOpenProvider],
  );

  const renderSearchRow = useCallback(
    ({ item, index }: { item: ProviderSummary; index: number }) => {
      const animate = !searchSeenIds.current.has(item.id);
      if (animate) {
        searchSeenIds.current.add(item.id);
      }
      return (
        <ProviderRow
          provider={item}
          index={index}
          isLast={index === results.length - 1}
          onPress={handleOpenProvider}
          onPressAvatar={handleOpenProvider}
          animateEntrance={animate}
          showCategory
        />
      );
    },
    [results.length, handleOpenProvider],
  );

  // ListHeaderComponent for the main Explore FlashList: chats rail + section
  // head + featured card. Kept outside the FlashList data so only the provider
  // rows are virtualised; the chrome above them is always rendered.
  const ExploreHeader = useCallback(
    () => (
      <>
        <TourAnchor id="chats">
        <View style={styles.rail}>
          <View style={styles.railHeader}>
            <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized} allowFontScaling accessibilityRole="header" style={styles.railLabel}>
              Chats
            </Text>
            {chats.length > 0 ? (
              <Pressable
                onPress={onSeeAllChats}
                testID="chats-see-all"
                accessibilityLabel="See all chats"
                press="none"
                style={styles.seeAll}>
                <Text allowFontScaling style={styles.seeAllText}>
                  See all
                </Text>
                <Icon name="chevronRight" size={TOKENS.icon.xs} color={theme.color.text.secondary} />
              </Pressable>
            ) : null}
          </View>
          {chats.length > 0 ? (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              {...SCROLL_PHYSICS}
              contentContainerStyle={styles.railScroll}>
              {chats.map(chat => (
                <RailItem
                  key={chat.conversation_id}
                  chat={chat}
                  onPress={handleOpenConversation}
                  onLongPress={(peerId, anchor) => {
                    setMenuAnchor(anchor);
                    setMenuPeer(peerId);
                  }}
                />
              ))}
            </ScrollView>
          ) : (
            <View style={styles.railEmpty}>
              <ChatStartHint />
            </View>
          )}
        </View>
        </TourAnchor>
        <TourAnchor id="explore">
        <View style={styles.exploreHead}>
          {/* Heading ROLE, not decoration: TalkBack lets a user jump between
              headings instead of walking every row, and the reference marks
              these same cells with `ViewCompat.setAccessibilityHeading(this,
              true)` (GraySectionCell.java:76, HeaderCell.java:107). RN's
              `header` role is "an element that acts as a header for a content
              section". Applied to Chats, Explore and the picks header, which
              are Home's three headings.
              https://reactnative.dev/docs/accessibility
              https://developer.android.com/guide/topics/ui/accessibility/principles */}
          <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized} allowFontScaling accessibilityRole="header" style={styles.exploreTitle}>
            Explore
          </Text>
        </View>
        </TourAnchor>
        {topPicks.length > 0 ? (
          <>
            <View style={styles.picksHead}>
              <Text
                maxFontSizeMultiplier={TOKENS.fontScaleCap.titleSmall}
                allowFontScaling
                accessibilityRole="header"
                style={styles.picksTitle}>
                Top profiles this week
              </Text>
            </View>
            {/* Centred hero, peeking both ways, endless in both directions
                (Amit, 2026-09-06). The geometry and the wrap arithmetic live in
                lib/carousel.ts where they can be tested; this only says which
                cards go in it. No timer — see HeroCarousel for why. */}
            <HeroCarousel
              items={topPicks}
              columnWidth={columnWidth}
              keyOf={p => p.id}
              testID="top-picks"
              render={(p, width) => (
                <Card>
                  <FeaturedCard
                    provider={p}
                    imageWidth={width}
                    onPress={() => onOpenProvider(p.id)}
                  />
                </Card>
              )}
            />
          </>
        ) : null}
        {/* Spacing that separates the featured card (or explore heading) from
            the first provider row — matches the original styles.rows paddingTop. */}
        <View style={{ height: TOKENS.space.sm }} />
      </>
    ),
    [
      chats,
      styles,
      topPicks,
      onOpenProvider,
      columnWidth,
      handleOpenConversation,
      onSeeAllChats,
      theme,
    ],
  );

  // ListFooterComponent for the main Explore FlashList: the "tap someone above"
  // hint that shows only on a fresh install before any conversation exists.
  const ExploreFooter = useCallback(() => null, []);

  // SearchFlashList header and empty components defined as variables to avoid
  // embedding double-quote literals inside JSX prop expressions (a TSX parser
  // quirk that causes spurious "Invalid character" errors).
  /** True once the member has asked for anything at all: text, or a chip. */
  const asking = trimmed !== '' || isFiltering(searchFilter);

  const searchListHeader =
    !asking ? (
      <View style={styles.empty}>
        <Text allowFontScaling style={styles.emptyText}>
          Search by name or language, or pick a filter above.
        </Text>
      </View>
    ) : null;

  // Names the filters when they are the reason. Saying "no one matches Mira"
  // while Mira matched the text and was excluded by an age chip sends the
  // member back to re-type a name that was right all along.
  // Names the filters when they are the reason, and does not quote an empty
  // query when the chips are doing all the asking.
  const noMatchLabel =
    trimmed === ''
      ? 'Nobody matches these filters.'
      : isFiltering(searchFilter)
        ? `No one matches ${JSON.stringify(query.trim())} with these filters.`
        : `No one matches ${JSON.stringify(query.trim())}.`;
  const searchListEmpty =
    asking ? (
      <View style={styles.empty}>
        <Text allowFontScaling style={styles.emptyText}>
          {noMatchLabel}
        </Text>
      </View>
    ) : null;

  return (
    <View style={[styles.root, { width: columnWidth }]}>
      {/* Nav Row — wordmark, search, ₹ balance. Not the collapsing LargeTitleBar:
          v13 Home has a fixed nav row, and the large title belongs to the Explore
          section header below it. */}
      {/* One row, two states, crossfaded in place. Nothing slides, because the
          field arrives in the row the icons were in.

          350ms on EASE_OUT_QUINT, symmetric — `BoolAnimator
          animatorSearchVisible` at DialogsActivity.java:307-308, the animator
          that carries the field and the chrome around it. `searchIn` /
          `searchOut` in src/theme/motion.ts hold the citation and the
          correction history (they ran 150ms with no easing at all until
          2026-09-07, read off ActionBarMenuItem.java, which is the LEGACY
          action-bar search the dialogs list stopped using several versions
          ago).

          The exit affordance is a BACK ARROW, not a second cross: with a cross
          here and the field's own clear inside it, a member with text typed saw
          two ✗ and could not tell which one lost their query (Amit,
          2026-09-06). Note that Telegram itself has NO back arrow here —
          `checkUi_itemBackButtonVisibility` hides it while search is open
          (DialogsActivity.java:14083-14087) and one X, forced visible for the
          whole session (:3365), both clears the query and closes search
          (:3306-3316). Keeping the arrow is Amit's decision of 2026-09-06 and
          the reason he gave (never two crosses) still holds; it is not an
          oversight. */}
      <View style={[styles.nav, { paddingTop: insets.top + TOKENS.space['2xs'] }]}>
        {searching ? (
          <Animated.View
            key="search-row"
            entering={searchIn}
            exiting={searchOut}
            style={styles.searchRow}>
            {/* NO arrow beside the field, and the field takes the whole row.
                Amit, 2026-09-07: "telegram search icon is on left edge of the
                bar and one cross to the right edge on the bar with full width
                bar -- see clearly". He is right, and the source is unambiguous:
                  contentView.addView(fragmentSearchField,
                    LayoutHelper.createFrame(MATCH_PARENT, 48, Gravity.TOP,
                                             7, -2, 7, 0));
                (DialogsActivity.java:5344) — MATCH_PARENT with 7dp side
                margins, no sibling. The magnifier is a 24dp box at 12dp from
                the field's own left edge and the cross the mirror of it at 12dp
                from the right (FragmentSearchField.java:132 and :159), which is
                what puts each mark AT its end of the bar.
                Ours had a 48dp arrow as a row sibling, so the pill started
                ~70dp in and the magnifier another 16dp inside that. That is the
                whole of the difference he was pointing at.
                Leaving search is the hardware back button, which is wired and
                device-verified as of today (HomeScreen's `searchBackGuard`), and
                the cross clears the query — the two jobs the reference splits
                the same way. */}
            <SearchBar
              testID="home-search-input"
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name or language"
              onClear={() => { setQuery(''); }}
            />
          </Animated.View>
        ) : (
          <Animated.View
            key="nav-row"
            entering={searchIn}
            exiting={searchOut}
            style={styles.navRow}>
            <Text allowFontScaling={false} style={styles.wordmark}>
              Pappal
            </Text>
            <View style={styles.navTrailing}>
              <Pressable
                onPress={() => setSearching(true)}
                testID="home-search"
                accessibilityLabel="Search people"
                press="none"
                size={TOKENS.interaction.minTarget}
                /* Circle, for the same reason as the leave-search arrow above. */
                shape="circle"
                style={styles.navIcon}>
                {/* 20, not 24 (Amit, 2026-09-07: "our search icon is too big"
                    — and he meant this one, in the Home nav row, not the one
                    inside the field).
                    Measured on the Redmi before changing it: at size 24 the
                    magnifier inked 66px at density 2.75 = exactly 24.00dp,
                    against the wallet glyph beside it at ~18dp. A third larger
                    than its own neighbour, in the same row, which is what makes
                    it look wrong rather than any absolute value.
                    `size` is NOT the rendered size: Icon.tsx multiplies by
                    ICON_SCALE (1.2) and Lucide inks 19.97 of its 24-unit grid,
                    so 20 -> em round(24) -> ink 24 * 19.97/24 = 19.97dp. That
                    lands it on the chat header's video glyph, which is the
                    nearest comparable control in the app. */}
                <Icon name="search" size={TOKENS.icon.md} color={theme.color.text.secondary} />
              </Pressable>
              <TourAnchor id="wallet">
                <TokenCounter balance={balance} onPress={openWallet} />
              </TourAnchor>
            </View>
          </Animated.View>
        )}
      </View>

      {/* Listeners / Astrologers, ABOVE Chats and outside the list, so the strip
          stays put while everything under it scrolls. A tab is a whole view of
          the app: the rail and Explore both follow it (Amit, 2026-09-06).
          Text-only M3 primary tabs — the label and the active indicator carry
          the state, which is the one thing that distinguishes the two lists.
          Always both, from day one: an empty Astrologers tab is an honest
          "nobody yet", and hiding it would make the strip appear under a member
          the day one signs up.

          Two tabs sharing the strip equally, with ONE indicator that moves
          between them: `MODE_FIXED` + `GRAVITY_FILL` for the division and
          `SlidingTabIndicator.animateIndicatorToPosition` for the move, both
          Material defaults. The citations are in `styles.tabs`,
          `styles.tabIndicator` and `tabIndicatorStyle`; each names the
          material-components-android file and line, because "does Material
          animate this?" is a question with a published answer and it is yes. */}
      {searching ? null : (
      <View
        style={styles.tabs}
        testID="explore-tabs"
        onLayout={e => onTabStripLayout(e.nativeEvent.layout.width)}>
        {PROVIDER_CATEGORIES.map((c, index) => {
          const on = c === exploreCategory;
          return (
            <Pressable
              key={c}
              onPress={() => setExploreCategory(c)}
              testID={`explore-tab-${c}`}
              accessibilityRole="tab"
              checked={on}
              accessibilityLabel={CATEGORY_LABEL[c]}
              press="none"
              /*
               * `ripple`, not `dim`, and the change is forced by the tab
               * becoming full-width. `dim` is a full-bleed fill of the whole
               * Pressable in `bg/selected` (Pressable.tsx: "a full-bleed cell
               * fill"), which was a small block behind a hugged label and is now
               * half the screen flashing solid on every tap. The reference gives
               * a tab a bounded ink ripple — `tabRippleColor` with
               * `tabUnboundedRipple` false in `Base.Widget.Material3.TabLayout`
               * / `Widget.Material3.TabLayout` (material-components-android
               * `lib/java/com/google/android/material/tabs/res/values/
               * styles.xml`) — and RULE 1 §3 says take the platform's own
               * solution: `highlight="ripple"` is `android_ripple`
               * (https://reactnative.dev/docs/pressable#android_ripple).
               * DEPARTURE: ours is a 20dp wave at `interaction.rippleRadius`
               * rather than one that fills the tab's bounds, because that radius
               * is the app's single ripple size — the same departure
               * SearchBar.tsx already records for the clear control.
               */
              highlight="ripple"
              style={styles.tab}>
              <Text
                maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
                allowFontScaling
                onLayout={e => onTabLabelLayout(index, e.nativeEvent.layout.width)}
                style={[styles.tabLabel, on && styles.tabLabelOn]}>
                {CATEGORY_LABEL[c]}
              </Text>
            </Pressable>
          );
        })}
        {/* One indicator for the whole strip, absolutely positioned so it can
            move across tab boundaries. `pointerEvents="none"` keeps it out of
            hit testing — it sits over the bottom edge of both 48dp targets, and
            "The View is never the target of touch events"
            (https://reactnative.dev/docs/view#pointerevents). */}
        <Animated.View
          pointerEvents="none"
          style={[styles.tabIndicator, tabIndicatorStyle]}
        />
      </View>
      )}

      {/* Search filters, vertical (Amit, 2026-09-06). They were one scrolling
          row, which put four of the six chips off screen and made the age bands
          something you had to discover by dragging. Two labelled groups
          stacked, each wrapping, so every option is visible at once on a 360dp
          window. Age comes from `provider_directory.age`, an integer the view
          has published since 042; the bands live in lib/providerFilters.ts. */}
      {searching ? (
        <View style={styles.filters} testID="search-filters">
          <View style={styles.filterGroup}>
            <Text allowFontScaling style={styles.filterLabel}>
              What they offer
            </Text>
            <View style={styles.filterChips}>
              {PROVIDER_CATEGORIES.map(c => (
                <Chip
                  key={c}
                  label={CATEGORY_LABEL[c]}
                  tone={searchFilter.category === c ? 'warm' : 'neutral'}
                  selected={searchFilter.category === c}
                  onPress={() =>
                    setSearchFilter(f => ({
                      ...f,
                      // Tapping the on chip clears it: a single-choice filter
                      // with no way back to "either" is a trap.
                      category: f.category === c ? null : c,
                    }))
                  }
                />
              ))}
            </View>
          </View>
          <View style={styles.filterGroup}>
            <Text allowFontScaling style={styles.filterLabel}>
              Age
            </Text>
            <View style={styles.filterChips}>
              {AGE_BANDS.map(band => (
                <Chip
                  key={band}
                  label={AGE_BAND_LABEL[band]}
                  tone={searchFilter.bands.includes(band) ? 'warm' : 'neutral'}
                  selected={searchFilter.bands.includes(band)}
                  onPress={() => setSearchFilter(f => toggleBand(f, band))}
                />
              ))}
            </View>
          </View>
        </View>
      ) : null}

      {/* The content underneath the row, and the second half of Telegram's
          search transition — the one the row's crossfade is only half of.

          The reference swaps these two on a SEPARATE, faster animator from the
          350ms field one: `searchAnimator`, 200ms opening / 180ms closing on
          CubicBezierInterpolator.EASE_OUT, with a 20ms start delay on the close
          only (DialogsActivity.java:7554-7607, :7590-7594). The results arrive
          at alpha 0->1 scale 1.05->1 while the directory leaves at alpha 1->0
          scale 1->0.95, and on the way back each runs in reverse. The builders
          and every citation live in src/theme/motion.ts.

          THE TWO LAYERS ARE ABSOLUTELY STACKED, and that is load-bearing rather
          than tidy. FlashList gives its OWN ROOT VIEW `flex: 1` whenever the
          list is vertical — `flex: horizontal ? undefined : 1` on the outer
          `CompatView`, @shopify/flash-list@2.3.2
          `src/recyclerview/RecyclerView.tsx:537` (compiled to
          `dist/recyclerview/RecyclerView.js:340`, which is the pointer this
          comment used to give as a bare "RecyclerView.js:340" and which nobody
          could resolve; the claim was right, the path was not, and it described
          the scroll view rather than the wrapper around it). A Reanimated
          `exiting` animation keeps the leaving view in the layout tree until it
          finishes — so as plain flex siblings the outgoing and incoming lists
          would each take HALF the column for the whole 200ms and the swap would
          read as a squash, not a dissolve. Stacked, they overlay,
          which is also what the reference does: `searchViewPager` and
          `viewPages[0]` are siblings in one FrameLayout and it toggles
          visibility around the animation rather than removing either.

          The skeleton is deliberately NOT animated. It is a placeholder for
          content that has not arrived, not a surface the member navigated to. */}
      <View style={styles.swap}>
        {searching ? (
          <Animated.View
            key="search-results"
            style={styles.swapLayer}
            entering={searchResultsIn}
            exiting={searchResultsOut}>
            <FlashList
              data={results}
              keyExtractor={p => p.id}
              renderItem={renderSearchRow}
              ListHeaderComponent={searchListHeader}
              ListEmptyComponent={searchListEmpty}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              {...SCROLL_PHYSICS}
              contentContainerStyle={[
                styles.scroll,
                { paddingBottom: insets.bottom + NAV_BAR_HEIGHT + TOKENS.space.xl },
              ]}
              overrideItemLayout={layout => { (layout as { span?: number; size?: number }).size = 97; }}
            />
          </Animated.View>
        ) : loading ? (
          <View style={styles.swapLayer}>
            <DirectorySkeleton />
          </View>
        ) : (
          // Only the provider rows are virtualised. The chats rail, explore head
          // and featured card live in ListHeaderComponent so they scroll together
          // with the list but are always fully rendered.
          <Animated.View
            key="directory"
            style={styles.swapLayer}
            entering={directoryIn}
            exiting={directoryOut}>
            <FlashList
              testID="home-scroll"
              data={rows}
              keyExtractor={p => p.id}
              renderItem={renderExploreRow}
              ListHeaderComponent={ExploreHeader}
              ListFooterComponent={ExploreFooter}
              ListEmptyComponent={
                featured === null ? (
                  <View style={styles.empty}>
                    <Text allowFontScaling style={styles.emptyText}>
                      Nobody is available just yet. Check back shortly.
                    </Text>
                  </View>
                ) : null
              }
              showsVerticalScrollIndicator={false}
              {...SCROLL_PHYSICS}
              contentContainerStyle={[
                styles.scroll,
                // The nav is a frosted overlay, so the list scrolls under it.
                // Clear its full height (bar + safe-area inset) plus the usual
                // end breathing room, so the last row lands above the bar
                // rather than behind it.
                { paddingBottom: insets.bottom + NAV_BAR_HEIGHT + TOKENS.space.xl },
              ]}
              overrideItemLayout={layout => { (layout as { span?: number; size?: number }).size = 97; }}
            />
          </Animated.View>
        )}
      </View>
      <SpotlightCard
        visible={potdVisible && featured !== null}
        name={featured?.display_name ?? 'Someone for you'}
        avatarUri={featured?.avatar_url ?? null}
        online={
          featured !== null &&
          readPresence(featured.presence, featured.last_active_at).here
        }
        onClose={dismissPotd}
        onChat={chatFromPotd}
        testID="potd-sheet"
      />
      <ConversationMenu
        peerId={menuPeer}
        surface="rail"
        visible={menuPeer !== null}
        anchor={menuAnchor}
        onClose={() => {
          setMenuPeer(null);
          setMenuAnchor(null);
        }}
      />
    </View>
  );
}

/**
 * One face in the CHATS rail: 54pt mark, presence, and — when there is unread —
 * a coral ring and a count badge. The ring and badge are the rail's own signals;
 * `Avatar` carries the mark and the presence dot.
 *
 * A4: wrapped in React.memo and the onPress constructed inside via useCallback
 * so re-renders of HomeScreen (e.g. balance ticks) do not cascade into every
 * rail item. The parent passes a stable `(peerId: string) => void`; the item
 * binds the specific peer id here rather than at the call site.
 */
const RailItem = memo(function ({
  chat,
  onPress,
  onLongPress,
}: {
  chat: ConversationSummary;
  onPress: (peerId: string) => void;
  onLongPress: (peerId: string, anchor: MenuAnchor) => void;
}) {
  const styles = useStyles(makeStyles);
  const pinned = useRailPrefs(s => s.pinned.includes(chat.peer_id));
  const hostRef = useRef<View>(null);
  const name = chat.peer_display_name ?? 'Conversation';
  const unreadCount = chat.i_am_member
    ? Number(chat.unread_count_member)
    : Number(chat.unread_count_provider);
  const unread = unreadCount > 0;
  const presence = readPresence(chat.peer_presence, chat.peer_last_active_at);
  const handlePress = useCallback(() => onPress(chat.peer_id), [onPress, chat.peer_id]);
  const handleLongPress = useCallback(() => {
    hostRef.current?.measureInWindow((x, y, width, height) => {
      onLongPress(chat.peer_id, { x, y, width, height });
    });
  }, [onLongPress, chat.peer_id]);
  return (
    <View ref={hostRef} collapsable={false}>
      <Pressable
        onPress={handlePress}
        onLongPress={handleLongPress}
        testID={`rail-${chat.peer_id}`}
        accessibilityLabel={
          unread
            ? `${name}, ${unreadCount} unread`
            : pinned
              ? `${name}, pinned`
              : name
        }
        press="none"
        style={styles.railItem}>
        <View style={[styles.railRing, unread && styles.railRingUnread]}>
          <Avatar
            initial={initialOf(name)}
            uri={chat.peer_avatar_url}
            size={56}
            online={presence.here}
          />
        </View>
        {unread ? (
          <View style={styles.railBadge}>
            <Badge count={unreadCount} testID={`rail-badge-${chat.peer_id}`} />
          </View>
        ) : null}
        <Text allowFontScaling numberOfLines={1} style={styles.railName}>
          {name}
        </Text>
      </Pressable>
    </View>
  );
});

/**
 * The featured pick. A warm gradient card with the person's mark, presence,
 * rating and tagline — the v13 hero, standing in a coral field where v13 has a
 * photo. `experimental_backgroundImage` is RN 0.86's native gradient (the same
 * mechanism as `BloomField`), so this needs no SVG and no dependency.
 */
function FeaturedCard({
  provider,
  imageWidth,
  onPress,
}: {
  provider: ProviderSummary;
  imageWidth: number;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  // The gradient is built from the accent tokens rather than raw hex, so the
  // featured hero stays inside the accent budget and follows a theme change.
  const gradient = `linear-gradient(140deg, ${theme.color.bg.accent} 0%, ${theme.color.bg.accentStrong} 100%)`;
  const age = provider.age !== null ? ` ${provider.age}` : '';
  const presence = readPresence(provider.presence, provider.last_active_at);
  const tagline =
    provider.headline && provider.headline !== ''
      ? provider.headline
      : provider.languages.slice(0, 2).join(' · ');
  /*
   * The rating has to be spoken in WORDS from here, because the chip below is
   * `accessible={false}` like every other meta chip and its visible text is now
   * only "★ 4.8" — a glyph and a bare number, which announces nothing about what
   * the number measures. Same phrasing as ProviderCard.tsx:105-107 and
   * ProviderRow.tsx:168-170 so the directory speaks one language, and grouped
   * into the card's own label so TalkBack makes a single announcement rather
   * than stopping on a decoration.
   * https://developer.android.com/guide/topics/ui/accessibility/principles
   * https://reactnative.dev/docs/accessibility
   */
  const accessibility = [
    `Featured: ${provider.display_name}`,
    tagline,
    provider.rating_count > 0
      ? `rated ${(provider.rating_avg ?? 0).toFixed(1)} from ${provider.rating_count} reviews`
      : 'no reviews yet',
  ]
    .filter(Boolean)
    .join(', ');
  return (
    <Pressable
      onPress={onPress}
      testID={`featured-${provider.id}`}
      accessibilityLabel={accessibility}
      press="card"
      style={styles.featured}>
      {provider.avatar_url ? (
        <>
          <Image
            source={{
              uri: sizedStorageImageUri(
                provider.avatar_url,
                imageWidth,
                210,
                PixelRatio.get(),
              ),
            }}
            style={styles.featuredFill}
          />
          {/* A dark scrim under the text so white copy stays legible over any
              photo, not only the coral fallback. */}
          <View style={styles.featuredScrim} />
        </>
      ) : (
        <>
          <View style={[styles.featuredFill, { experimental_backgroundImage: gradient }]} />
          <Text allowFontScaling={false} style={styles.featuredWatermark}>
            {initialOf(provider.display_name)}
          </Text>
        </>
      )}
      {/* The star and the number, nothing else. "Top rated" repeated the section
          header immediately above the carousel, on all three cards, so it said
          nothing the header had not already said (Amit). With the words gone
          there is no sensible fallback: a solid accent pill asserting nothing,
          on a card in a "Top profiles this week" strip, is an advert rather than
          a status — so a provider with no ratings gets no pill at all. Same
          glyph and precision as ProviderCard.tsx:168-170 and
          ProviderRow.tsx:226-228; `accessible={false}` folds it into the card,
          whose label says "rated 4.8 from 12 reviews" in words. `?? 0` rather
          than the peers' `?.` because on the hero a null average would print the
          literal "★ undefined". */}
      {provider.rating_count > 0 ? (
        <View accessible={false} style={styles.featuredBadge}>
          <Text allowFontScaling style={styles.featuredBadgeText}>
            {`★ ${(provider.rating_avg ?? 0).toFixed(1)}`}
          </Text>
        </View>
      ) : null}
      {presence.here ? <View style={styles.featuredOnline} /> : null}
      <View style={styles.featuredBody}>
        <View style={styles.featuredNameRow}>
          <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized} allowFontScaling numberOfLines={1} style={styles.featuredName}>
            {provider.display_name}
            <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} style={styles.featuredAge}>{age}</Text>
          </Text>
        </View>
        {tagline !== '' ? (
          <Text allowFontScaling numberOfLines={1} style={styles.featuredTagline}>
            {tagline}
          </Text>
        ) : null}
        {/* Languages only — age already sits beside the name. Same M3
            AssistChip geometry as the list; onMedia keeps them legible. */}
        <View style={styles.featuredChips}>
          {provider.languages.slice(0, 2).map(lang => (
            <MetaChip key={lang} tone="onMedia" label={lang} />
          ))}
        </View>
      </View>
    </Pressable>
  );
}

const RAIL_AVATAR = 56;

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
      alignSelf: 'center',
    },
    nav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    // The one place TitanOne appears outside a logo file. Lowercase coral, per
    // v13. `numeralMedium` is unrelated — the wordmark carries its own size.
    wordmark: {
      fontFamily: TOKENS.face.wordmark,
      fontSize: 28,
      lineHeight: 34,
      color: t.color.bg.accent,
    },
    navTrailing: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    /*
     * A real 48dp box with the glyph centred in it, not a 28x40 box with slop.
     *
     * Both nav controls wear this style — the button that OPENS search and the
     * back arrow that leaves it — and both passed `size={28}`, which asks
     * Pressable for `max(8, ceil((48 - 28) / 2)) = 10` of `hitSlop`
     * (Pressable.tsx:231-234). Almost none of it survived: "The touch area never
     * extends past the parent view bounds"
     * (https://reactnative.dev/docs/view#hitslop), and the search glyph is the
     * FIRST child of a content-sized `navTrailing` row whose left edge is the
     * glyph box's own left edge, so the 10dp on that side is clipped to nothing
     * and the remaining 10dp on the other side falls in the 8dp gap the token
     * counter's own slop is already claiming. Effective box ~28-36 x 40 against
     * Android's floor: "we recommend that each interactive UI element have a
     * focusable area, or touch target size, of at least 48dp x 48dp"
     * (https://developer.android.com/guide/topics/ui/accessibility/apps).
     *
     * This is the same defect the search field's clear control had until
     * 2026-09-07 and it takes the same fix: one laid-out `interaction.minTarget`
     * box that no ancestor can shrink, with the glyph centred inside it. See the
     * GLYPH_SLOT header in src/components/SearchBar.tsx for the long version.
     * `size` is still passed, now as the same 48, so the Pressable and the style
     * agree rather than one of them silently deciding.
     *
     * It also makes the nav row 48dp tall in BOTH states — this box, or the
     * search field's own 48dp row — which the content swap below relies on; see
     * the note on `styles.swap`.
     */
    navIcon: {
      width: TOKENS.interaction.minTarget,
      height: TOKENS.interaction.minTarget,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // SearchBar takes the full nav row while searching; no custom field needed.
    scroll: {
      paddingTop: TOKENS.space['2xs'],
    },
    /*
     * The stack the directory and the search results swap inside.
     *
     * `flex: 1` here takes everything the nav row, the tabs and the filters
     * leave, and `swapLayer` fills it absolutely so the two layers overlay for
     * the length of the transition instead of splitting the column between
     * them. See the comment at the call site for why that is required and not
     * merely neater.
     *
     * KNOWN, AND THE ARITHMETIC IS HERE: this box's HEIGHT still changes in the
     * frame the swap starts, because the chrome above it is not animated.
     * Opening search unmounts the tab strip (48 + 12 = 60dp) and mounts the
     * filter block (two 16dp labels + two 4dp gaps + two 36dp chip rows + a 12dp
     * gap between the groups + 12dp below = ~136dp) in one commit, so `flex: 1`
     * hands the layers ~76dp less than they had and the OUTGOING directory —
     * absolutely filling this box — is re-laid-out shorter while it is fading.
     * It is worth being exact about what that does and does not cost, because an
     * earlier note here overstated it as "the dissolve is not protected":
     *
     *   - The stacking still does its job. The two layers overlay; neither ever
     *     takes half the column, and the swap does not read as a squash.
     *   - The leaving list's rows do not move — a FlashList is anchored at its
     *     top — so what is visible is its BOTTOM EDGE clipping ~76dp early, at
     *     the foot of the screen, under a layer that is already fading in over
     *     it. The 0.95 scale is about the layer's centre, which also rises ~38dp,
     *     but at 5% that is a ~2dp difference in where the content lands.
     *   - The louder half is that the chrome HARD-CUTS while the bodies dissolve
     *     for 200ms. Giving the two chrome blocks their own `entering`/`exiting`
     *     makes it worse, not better: an exiting view stays in the layout tree,
     *     so for those 200ms BOTH blocks would be in the column and this box
     *     would shrink further still, then spring back.
     *
     * Half of it IS fixed: `styles.navIcon` is now a real 48dp box, so the nav
     * row measures 48 in both states instead of 40 un-searched / 48 searched,
     * and the 8dp step it used to add to this box on every toggle is gone.
     *
     * The rest needs the chrome to move INSIDE the two layers, which is also
     * what the reference does — `searchTabsView` lives in `searchViewPager` and
     * the dialogs list in `viewPages[0]`, and it scales each page as one object
     * (DialogsActivity.java:7555-7576). That is a JSX relocation, and it is
     * blocked on a gate outside this change set: `__tests__/contract.test.ts`
     * asserts `'>\n              Age\n            </Text>'`, pinning the filter
     * block to exactly this nesting depth by whitespace, so moving it turns that
     * test red. Whoever owns that file next should re-anchor the assertion to
     * the label text rather than its indentation, then move both blocks in.
     */
    swap: {
      flex: 1,
    },
    swapLayer: {
      ...StyleSheet.absoluteFill,
    },
    state: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    rail: {
      paddingTop: TOKENS.space.xs,
      paddingBottom: TOKENS.space.sm,
    },
    railHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    railEmpty: {
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.xs,
      paddingBottom: TOKENS.space.sm,
    },
    // Chats is a peer section heading to Explore, not a quiet caption (#14,
    // Amit: "bold, looks too shallow in front of Explore"). Same display weight
    // and primary ink so the two read as equals.
    railLabel: {
      ...TOKENS.typography.headlineSmallEmphasized,
      color: t.color.text.primary,
    },
    seeAll: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    seeAllText: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.secondary,
    },
    railScroll: {
      // Pull the row left by the rail item's centring inset (3) + the ring's
      // border+pad (5) = 8, so the first avatar's image edge lands on the md
      // content boundary — the same left edge as "Chats", "Explore", the
      // featured card and the provider rows (#14, Amit: align to the bubbles).
      paddingLeft: TOKENS.space.md - 8,
      paddingRight: TOKENS.space.md,
      gap: TOKENS.space.xs,
    },
    railItem: {
      // Wide enough for the 56dp avatar plus the unread ring (3 pad + 2 border
      // each side = 66) with a little air; Telegram's stories item is 70 (ITEM_
      // WIDTH, DialogStoriesCell.java:111).
      width: 70,
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
    },
    // The unread ring is a 2pt coral border with a 3pt gap to the mark, matching
    // v13's 60pt ring around a 54pt photo, scaled to the 48pt mark used here.
    railRing: {
      padding: 3,
      borderRadius: (RAIL_AVATAR + 12) / 2,
      borderWidth: 2,
      borderColor: 'transparent',
      // Let the Avatar's presence dot spill past this rounded ring instead of
      // being clipped in half at the corner on Android.
      overflow: 'visible',
    },
    railRingUnread: {
      borderColor: t.color.bg.accent,
    },
    // Anchor only — M3 Badge owns fill, size, and “9+”.
    railBadge: {
      position: 'absolute',
      top: 0,
      right: 4,
      width: 0,
      height: 0,
    },
    railName: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.primary,
      textAlign: 'center',
      width: 64,
    },
    exploreHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.xs,
      paddingBottom: TOKENS.space.sm,
    },
    /*
     * Listeners / Astrologers, dividing the whole strip between them.
     *
     * The label and the accent indicator under it carry the state; the accent is
     * what distinguishes two otherwise identical grey labels, which is the accent
     * budget's "state, not decoration" case (theme.test lists HomeScreen for
     * this).
     *
     * IT USED TO HUG ITS CONTENT at the left — `paddingHorizontal: md` plus
     * `gap: lg` with each tab sized to its label, so the two tabs occupied about
     * 200 of a 360dp window and the remaining 160dp was dead space no tap could
     * reach. Material's tab row does not work that way and never has: `mode`
     * defaults to `MODE_FIXED` and `tabGravity` to `GRAVITY_FILL`
     * (material-components-android
     * `lib/java/com/google/android/material/tabs/TabLayout.java:674-675`), and
     * under that pair `updateTabViewLayoutParams` gives every tab
     * `lp.width = 0; lp.weight = 1` (`:1797-1805`) — LinearLayout's "share the
     * parent equally" idiom, which is `flex: 1` here. `MODE_FIXED` is documented
     * on the same class as "Fixed tabs display all tabs concurrently" (`:1124`).
     *
     * So: no `paddingHorizontal` and no `gap`. Both would eat into the share each
     * tab gets and neither has an equivalent in the reference — for `MODE_FIXED`
     * it explicitly zeroes the strip's own start padding
     * (`slidingTabIndicator.setPaddingRelative(paddingStart = 0, ...)`, `:2085-
     * 2091`, where `paddingStart` is only computed for the scrollable modes).
     * The consequence is that each label is now centred in its half rather than
     * left-aligned on the md content boundary, which is also what the reference
     * does (`slidingTabIndicator.setGravity(Gravity.CENTER_HORIZONTAL)` for
     * `MODE_FIXED`, `:2094-2101`).
     *
     * `marginBottom` rather than `paddingBottom`, and the difference matters:
     * the indicator is an absolutely-positioned child at `bottom: 0`, and
     * whether Yoga measures an absolute child's offsets from the padding edge or
     * the border edge is not something this file should be betting the
     * indicator's position on. A margin is outside the box either way, so
     * `bottom: 0` is unambiguously the bottom of the 48dp tab row.
     */
    tabs: {
      flexDirection: 'row',
      marginBottom: TOKENS.space.sm,
    },
    /*
     * Each tab is a 48dp box with its indicator on the bottom edge, not a 30dp
     * label-and-rule.
     *
     * What it used to be: 24 (the label's lineHeight) + 4 (gap) + 2 (rule) =
     * 30dp of content and no height of its own. The `Pressable` around it passed
     * no `size`, so it took the default `ceil(48 / 6) = 8` of `hitSlop`
     * (Pressable.tsx:231-234) — 46dp at the arithmetic's most generous, and less
     * than that on the device, because "The touch area never extends past the
     * parent view bounds" (https://reactnative.dev/docs/view#hitslop) and the
     * strip around it was only 30 + 12 tall, which clips the slop above the
     * label away entirely (~38dp effective).
     *
     * 48 is the platform floor: "we recommend that each interactive UI element
     * have a focusable area, or touch target size, of at least 48dp x 48dp"
     * (https://developer.android.com/guide/topics/ui/accessibility/apps). It is
     * ALSO the height Material's own text-only tab is drawn at —
     * `DEFAULT_HEIGHT = 48` in material-components-android
     * `lib/java/com/google/android/material/tabs/TabLayout.java`, against 72 for
     * a tab carrying both text and an icon — so this is the component's spec
     * height rather than an accessibility patch bolted onto a smaller one.
     * (m3.material.io is a client-rendered app that returns nothing to a fetch,
     * so the Material fact is taken from the AndroidX/Material source that
     * implements it.)
     *
     * `justifyContent: 'flex-end'` keeps the label at the bottom of that box,
     * which is where TabLayout draws its own indicator; the 18dp it opens up
     * above the label is touch target, not padding — the whole 48dp is tappable,
     * which is the point.
     *
     * `flex: 1` is `lp.width = 0; lp.weight = 1` — the equal share every tab gets
     * under `MODE_FIXED` + `GRAVITY_FILL`; see the `tabs` comment above for the
     * file:line. It is what makes the strip full-width, and it also means a tab's
     * centre is arithmetic (`(i + 0.5) * width / count`) rather than something
     * the indicator has to measure.
     *
     * `paddingBottom` replaces the `gap` the removed per-tab rule used to sit
     * after. The label's baseline has to stay where it was, so the space the rule
     * occupied (its 3dp plus the 4dp gap above it) is now padding under the
     * label, and the indicator draws inside it.
     */
    tab: {
      flex: 1,
      minHeight: TOKENS.interaction.minTarget,
      alignItems: 'center',
      justifyContent: 'flex-end',
      paddingBottom: TAB_INDICATOR_HEIGHT + TOKENS.space['2xs'],
    },
    tabLabel: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.tertiary,
    },
    tabLabelOn: {
      color: t.color.text.primary,
    },
    /*
     * ONE indicator for the strip, sized to the SELECTED LABEL and not to the
     * tab, which is the M3 primary-tab rule rather than a leftover from the
     * per-tab rule this replaced.
     *
     * The two M3 tab flavours differ on exactly this and the source is explicit:
     * `Base.Widget.Material3.TabLayout` — primary tabs — sets
     * `<item name="tabIndicatorFullWidth">false</item>`, while
     * `Base.Widget.Material3.TabLayout.Secondary` sets it to `true`
     * (material-components-android
     * `lib/java/com/google/android/material/tabs/res/values/styles.xml`). With
     * it false, `TabIndicatorInterpolator.calculateIndicatorWidthForTab` returns
     * `calculateTabViewContentBounds(tab, MIN_INDICATOR_WIDTH)` — the label's
     * bounds, floored at 24dp — instead of the tab's own left/right
     * (`TabIndicatorInterpolator.java`). This strip is documented as primary
     * tabs at the call site and is styled as them (title-weight labels, no
     * icons), so the label's width is the correct one. THE TAB IS FULL WIDTH;
     * THE INDICATOR IS NOT, and those are two separate settings in the
     * reference, not one.
     *
     * `left: 0` with the offset carried by `translateX` in the animated style,
     * rather than an animated `left`: a transform is a UI-thread compositor
     * property, whereas animating `left` re-runs layout for every frame of every
     * tab change.
     *
     * `bottom: 0` is `tabIndicatorGravity` = `bottom`, the `Widget.Design.
     * TabLayout` default carried through the M3 styles (same styles.xml).
     */
    tabIndicator: {
      position: 'absolute',
      left: 0,
      bottom: 0,
      height: TAB_INDICATOR_HEIGHT,
      // Top corners only, at the drawable's own 3dp; see TAB_INDICATOR_HEIGHT.
      borderTopLeftRadius: TAB_INDICATOR_HEIGHT,
      borderTopRightRadius: TAB_INDICATOR_HEIGHT,
      backgroundColor: t.color.bg.accent,
    },
    // Both nav states occupy the same row so the crossfade has nothing to
    // reflow: the search field lands where the icons were.
    navRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: TOKENS.space.xs,
    },
    /*
     * The search row is NOT `navRow`, and the difference is the point.
     *
     * `navRow` is `space-between` with a gap, which is right for the resting
     * chrome (wordmark, search, wallet) and wrong for search: it would hold the
     * field to its content width and centre it in the leftovers. The field has
     * to be the row.
     *
     * `SEARCH_ROW_SIDE_MARGIN` is the reference's own 7dp
     * (DialogsActivity.java:5344 `createFrame(MATCH_PARENT, 48, ..., 7, -2, 7,
     * 0)`) rather than the app's usual `space.md`. It is deliberately narrower
     * than every other margin on this screen, because the field's 12dp internal
     * glyph inset already supplies the optical inset — stacking 16dp on top of
     * that is exactly how the magnifier ended up 28dp from the screen edge
     * instead of 23.
     */
    searchRow: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      marginHorizontal: SEARCH_ROW_SIDE_MARGIN,
    },
    /*
     * "Top profiles this week" over the hero carousel. A heading, because a row
     * of three cards with no label is three unexplained adverts — but a QUIET
     * heading.
     *
     * It used to be Bold 16 in the same ink as the Bold 24 "Explore" 8dp above
     * it, which put ALL the contrast on one axis (size) and none on weight or
     * colour: two full-ink bold lines that read as two titles arguing rather
     * than as a title and its section. The reference steps all three at once —
     * its section-header cells are 14dp + `AndroidUtilities.bold()` in a grey
     * that is never the title's ink (GraySectionCell.java:57-59,
     * HeaderCell.java:94-95, key_graySectionText) against a 20dp black ActionBar
     * title (ActionBar.java:1455).
     *
     * `bold()` is NOT weight 700: the field it caches into is literally named
     * `mediumTypeface` and the SDK-P branch is `Typeface.create(null, 500,
     * false)` (AndroidUtilities.java:263-272). M3 maps weight 500 to
     * Geist-SemiBold (ADR-0024 §1), and the M3 role that is 14/20 SemiBold is
     * `titleSmall` — which is why this is titleSmall and not a label role. The
     * 0.1 tracking stays M3's; the reference sets none, and 0.1dp at 14dp is
     * ~1/140 em, not worth forking the scale for.
     */
    picksHead: {
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    picksTitle: {
      ...TOKENS.typography.titleSmall,
      color: t.color.text.section,
    },
    picksBelow: {
      height: TOKENS.space.sm,
    },
    // Type and age, stacked and labelled: every option visible at once.
    filters: {
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.sm,
      gap: TOKENS.space.sm,
    },
    filterGroup: {
      gap: TOKENS.space['2xs'],
    },
    filterLabel: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.secondary,
    },
    filterChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space.xs,
    },
    exploreTitle: {
      ...TOKENS.typography.headlineSmallEmphasized,
      color: t.color.text.primary,
    },
    // Card wraps the featured hero; Card owns borderRadius and overflow.
    featuredCard: {
      marginHorizontal: TOKENS.space.md,
    },
    featured: {
      height: 210,
      justifyContent: 'flex-end',
    },
    featuredFill: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    },
    featuredScrim: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      experimental_backgroundImage: 'linear-gradient(0deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0) 55%)',
    },
    featuredWatermark: {
      position: 'absolute',
      right: 16,
      top: -12,
      fontFamily: TOKENS.face.semibold,
      fontSize: 160,
      lineHeight: 190,
      color: 'rgba(255,255,255,0.16)',
    },
    /*
     * The status pill: the ACCENT-STRONG step, not the bright mark coral. A
     * translucent black chip read as chrome; the frame makes this the one
     * branded mark on the card — but 12dp Bold white on bg/accent measures
     * 3.44:1 in light and 2.59:1 in dark, and Android requires 4.5:1 for text
     * under 18sp (and for bold under 14sp). design/tokens.json says of bg/accent
     * "must NEVER sit under small white text; that is what bg/accentStrong is
     * for" — a rule theme.test.ts already asserts as a fact and which this pill
     * had been quietly breaking since it shipped. accentStrong with the same
     * text/onAccent measures 5.19:1 light / 6.13:1 dark.
     * https://developer.android.com/guide/topics/ui/accessibility/apps
     */
    featuredBadge: {
      position: 'absolute',
      top: TOKENS.space.md,
      left: TOKENS.space.md,
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: TOKENS.space['2xs'],
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.accentStrong,
    },
    featuredBadgeText: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.onAccent,
    },
    featuredBody: {
      padding: TOKENS.space.md,
      gap: TOKENS.space['2xs'],
    },
    featuredNameRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
    },
    featuredName: {
      ...TOKENS.typography.headlineSmallEmphasized,
      color: '#FFFFFF',
      flex: 1,
    },
    featuredAge: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: 'rgba(255,255,255,0.82)',
    },
    // Presence dot, top-right of the card: sage with a white ring so it stays
    // legible over any photo.
    featuredOnline: {
      position: 'absolute',
      top: TOKENS.space.md,
      right: TOKENS.space.md,
      width: 14,
      height: 14,
      borderRadius: 7,
      backgroundColor: t.color.state.available,
      borderWidth: 2,
      borderColor: '#FFFFFF',
    },
    featuredTagline: {
      ...TOKENS.typography.bodyMedium,
      color: 'rgba(255,255,255,0.92)',
    },
    featuredChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space['2xs'],
      paddingTop: TOKENS.space.xs,
    },
    rows: {
      paddingTop: TOKENS.space.sm,
    },
    empty: {
      alignItems: 'center',
      paddingVertical: TOKENS.space['3xl'],
      paddingHorizontal: TOKENS.space['2xl'],
    },
    emptyText: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
    settingsHint: {
      paddingVertical: TOKENS.space.lg,
      paddingHorizontal: TOKENS.space['2xl'],
    },
  });
