import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import {
  Image,
  Keyboard,
  PixelRatio,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ConversationSummary, ProviderSummary } from '../lib/database.types';
import { initialOf, providerFirstName } from '../lib/display';
import { presenceForSpeech, readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import Animated, { useReducedMotion, useSharedValue } from 'react-native-reanimated';
import { useSoftReset } from '../lib/routes/useSoftReset';
import { useTabPress } from '../lib/routes/useTabPress';
import { contentColumnWidth } from '../lib/windowSize';
import { sizedStorageImageUri } from '../lib/storageImage';
import { avatarImageSource } from '../lib/clayAvatars';
import { useConversations, useProfile, useProviders } from '../api/chat';
import { useProviderBusyWaits, withBusyWaits } from '../api/busy';
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
  toggleFilterExpertise,
  toggleFilterLanguage,
  type DirectoryFilter,
  type ProviderCategory,
} from '../lib/providerFilters';
import { OFFERED_LANGUAGES, sortByLanguageMatch } from '../lib/languagePrefs';
import { useSearchBack } from '../hooks/useSearchBack';
import { useBlockedPeerIds } from '../api/safety';
import { useStore } from '../store/useStore';
import { Avatar } from '../components/Avatar';
import { useBottomBarOffset } from '../shell/useBottomBarOffset';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import {
  PROVIDER_ROW_HEIGHT,
  ProviderRow,
  seededExperienceYears,
} from '../components/ProviderRow';
import { ProviderPager, type ProviderPagerRef } from '../components/ProviderPager';
import { ProviderTypeTabs } from '../components/ProviderTypeTabs';
import { FALLBACK_ECONOMICS, useEconomicsConfig } from '../api/appConfig';
import { OFFERED_EXPERTISE, expertiseFor } from '../lib/expertise';
import { genderLetter } from '../lib/display';
import { displayRating } from '../lib/systemRating';
import { DirectorySkeleton } from '../components/DirectorySkeleton';
import { Chip } from '../components/Chip';
import {
  HERO_CARD_GAP,
  HERO_CARD_HEIGHT,
  HERO_CARD_WIDTH,
} from '../lib/carousel';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { TabTopBar } from '../components/TabTopBar';
import { StoryRail } from '../components/stories/StoryRail';
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
  searchResultsIn,
  searchResultsOut,
} from '../theme/motion';
import { HOME_SUGGESTIONS_ENABLED } from '../config';
import { useHomeSuggestions } from '../hooks/useHomeSuggestions';
import { useHomeSuggestionPrompt } from '../store/useHomeSuggestionPrompt';

/**
 * Whether the spotlight has been dismissed IN THIS APP RUN.
 *
 * Module-level rather than component state so it survives HomeScreen
 * unmounting and remounting as the member navigates away and back, and
 * deliberately NOT persisted.
 *
 * It replaced an MMKV key (`companion.potd.dismissed`) on 2026-09-12, and the
 * persistence was the bug. Amit: "users should always be greeted with sheet
 * modal on homescreen if balance is 0 right but i just cancelled payment and
 * reopned app and nothing fired?" — and they would not have. A member at zero
 * balance who dismissed the sheet once never saw it again on any later launch,
 * because the flag outlived the condition it was gating.
 *
 * docs/FEATURES.md already described the intended rule — "shown only for
 * first-user (`token_balance === 0`) after the tour" — which is a condition on
 * BALANCE, not a once-per-install event. A run-scoped flag is what makes the
 * sheet stop nagging within a session while still greeting a member who is
 * still at zero the next time they open the app.
 *
 * It stops for good the moment the balance is non-zero, which is the `firstUser`
 * gate below, not this.
 */
let potdDismissedThisRun = false;


/**
 * How many profiles the week's carousel holds (Amit, 2026-09-06: "at least
 * three"). One card is a claim; three is a choice.
 */
const TOP_PICKS = 3;

/** A stable empty directory, so an effect keyed on it does not re-run. */
const NO_PROVIDERS: ProviderSummary[] = [];


interface Props {
  onOpenConversation: (peerId: string) => void;
  onOpenProvider: (providerId: string) => void;
  /**
   * Ring a provider straight from their card's CTA.
   *
   * A DIFFERENT action from `onOpenProvider` and from the card body, which is
   * why the card carries a second touch target: Amit, 2026-09-08, "our CTA will
   * be call not chat". The row falls back to opening the conversation when this
   * is absent or when the provider has switched calls off, so the button never
   * promises something `start_call` will refuse.
   */
  onCallProvider: (providerId: string) => void;
  /** Open the full chats list from the rail's "See all". */
  onSeeAllChats: () => void;
  /**
   * True when a call or incoming ring is live so the idle-home campaign
   * suppresses itself. Passed from App.tsx which owns the route state.
   */
  hasActiveCall?: boolean;
  /**
   * Whether Home is the screen on top (nav-migration §5). The idle campaign,
   * the tour and the spotlight sheet all wait for it, so a cold start into
   * `[Home, Chat]` opens nothing over the chat. Defaults to true: the old tree
   * unmounts or covers Home the way it always has and passes nothing.
   */
  focused?: boolean;
  /**
   * Whether the idle campaign counts Home as shown: Home focused, or its own
   * `HomeSuggestion` prompt on top of it. Defaults to `focused`.
   */
  campaignFocused?: boolean;
  /** Where an accepted prompt goes. Defaults to `onOpenConversation`. */
  onSuggestionChat?: (providerId: string) => void;
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
  onCallProvider,
  onSeeAllChats,
  hasActiveCall = false,
  focused = true,
  campaignFocused = focused,
  onSuggestionChat,
}: Props) {
  const styles = useStyles(makeStyles);
  const { width: windowWidth } = useWindowDimensions();
  const columnWidth = contentColumnWidth(windowWidth);
  const listBottomPadding = useBottomBarOffset(TOKENS.space.xl);
  const balance = useStore(s => s.balance);
  // Read rather than called for its side effect: the directory's ORDER now
  // depends on the member's language preference, so this screen needs the row
  // and not just the balance sync it used to be here for.
  const { data: profile } = useProfile();
  const { data: conversations, isPending: convosPending } = useConversations();
  const {
    data: directoryRows,
    isPending: providersPending,
    refetch: refetchProviders,
  } = useProviders();
  // Busy providers carry `busy_wait_minutes` (migration 154): merged in HERE,
  // at the one place this screen reads the directory, so every page, row and
  // pick downstream sees the same answer. The hook polls every 30s while the
  // app is foregrounded (TanStack focusManager) and only while Home is the
  // focused screen: a covered Home polls nothing.
  const directoryIds = useMemo(() => (directoryRows ?? []).map(p => p.id), [directoryRows]);
  const busyWaits = useProviderBusyWaits(directoryIds, { focused });
  const providers = useMemo(
    () => (directoryRows === undefined ? undefined : withBusyWaits(directoryRows, busyWaits)),
    [directoryRows, busyWaits],
  );
  const blocked = useBlockedPeerIds();

  /* Idle-home campaign — only active when HOME_SUGGESTIONS_ENABLED = true.
     R8 dead-strips this code path in disabled builds because the constant is
     compile-time false. The hook is unconditionally called (rule of hooks) but
     returns null suggestion when the flag is off. */
  const { currentSuggestion, onAccept: onAcceptSuggestion, onDismiss: onDismissSuggestion } =
    useHomeSuggestions({
      hasActiveCallOrRing: hasActiveCall,
      onOpenConversation: onSuggestionChat ?? onOpenConversation,
      focused: campaignFocused,
    });
  /*
   * The prompt is shown by the `HomeSuggestion` route, not over this screen
   * (nav-migration §2): published here, where the campaign lives, and pushed
   * by Home's route adapter.
   */
  const setSuggestionPrompt = useHomeSuggestionPrompt(s => s.setPrompt);
  useEffect(() => {
    if (!HOME_SUGGESTIONS_ENABLED) {
      return;
    }
    setSuggestionPrompt(
      currentSuggestion === null
        ? null
        : { suggestion: currentSuggestion, onAccept: onAcceptSuggestion, onDismiss: onDismissSuggestion },
    );
  }, [currentSuggestion, onAcceptSuggestion, onDismissSuggestion, setSuggestionPrompt]);
  useEffect(() => () => setSuggestionPrompt(null), [setSuggestionPrompt]);

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
   * The category is a PAGE now (owner decision, Amit 2026-09-26/27: Bluesky's
   * pager mechanics exactly), so there are two sources of truth with two
   * different jobs, and neither is allowed to do the other's:
   *
   *   `categoryProgress` — `position + offset`, written on the UI thread by
   *   `ProviderPager` for every frame of a drag or a tapped page scroll. Only
   *   worklets read it (the tab indicator and label inks). A drag never
   *   renders React.
   *
   *   `exploreCategory` — the SETTLED page, set once per page change from
   *   `onPageSelected`. It picks the spotlight's provider, tells TalkBack which
   *   tab is `checked`, and says which page may register tour anchors and play
   *   row entrances. It no longer filters any list: every page filters by its
   *   OWN category, below.
   */
  const categoryProgress = useSharedValue(PROVIDER_CATEGORIES.indexOf(DEFAULT_CATEGORY));
  const pagerRef = useRef<ProviderPagerRef>(null);

  const categoryById = useMemo(() => {
    const map = new Map<string, ProviderCategory>();
    for (const p of providers ?? []) {
      map.set(p.id, categoryOf(p));
    }
    return map;
  }, [providers]);

  /*
   * The rail, sorted once and then split by category, one list per page. A
   * peer with no directory row — a suspended provider, or a member on the
   * provider tree — keeps their thread under the default tab rather than
   * disappearing from the app: a conversation you have had is not something a
   * filter should be able to hide from you.
   */
  const chatsByCategory = useMemo(() => {
    const sorted = (conversations ?? [])
      .filter(c => !blocked.has(c.peer_id) && visibleOnRail(railPrefs, c.peer_id))
      .slice()
      .sort((a, b) =>
        compareConversations(
          railPrefs,
          { peerId: a.peer_id, at: a.last_session_at ?? '', unread: a.i_am_member ? Number(a.unread_count_member) : Number(a.unread_count_provider) },
          { peerId: b.peer_id, at: b.last_session_at ?? '', unread: b.i_am_member ? Number(b.unread_count_member) : Number(b.unread_count_provider) },
        ),
      );
    const byCategory = {} as Record<ProviderCategory, ConversationSummary[]>;
    for (const category of PROVIDER_CATEGORIES) {
      byCategory[category] = sorted.filter(
        c => (categoryById.get(c.peer_id) ?? DEFAULT_CATEGORY) === category,
      );
    }
    return byCategory;
  }, [conversations, blocked, railPrefs, categoryById]);

  // The directory, blocked people removed. The featured pick is lifted out of the
  // list so it is not shown twice.
  const allProviders = useMemo(
    () => (providers ?? []).filter(p => !blocked.has(p.id)),
    [providers, blocked],
  );

  /**
   * The member's onboarding answer, and the only thing that reorders Explore.
   *
   * Empty for a member who skipped the step or predates it, which
   * `sortByLanguageMatch` short-circuits to "the order it already had".
   */
  /*
   * Keyed on the CONTENTS, not the array identity. react-query hands back a
   * fresh array on every refetch, so `[profile?.preferred_languages]` as a memo
   * dependency would re-sort the whole directory every thirty seconds for no
   * change. NUL as the separator because it cannot occur in a language name and
   * cannot occur in a `text[]` element that survived migration 072's floor.
   */
  const languageKey = (profile?.preferred_languages ?? []).join('\u0000');
  const preferredLanguages = useMemo(
    () => (languageKey === '' ? [] : languageKey.split('\u0000')),
    [languageKey],
  );

  /*
   * The topic chips the search panel offers.
   *
   * 083 splits the vocabulary by provider_category, so the panel follows the
   * category chip above it — offering Tarot next to Anxiety would describe
   * neither kind of provider. With no category picked, search spans both tabs,
   * so the union is shown rather than an arbitrary default; a member who has
   * not narrowed to Astrologers should still be able to ask for Tarot.
   *
   * Deduplicated, because the two lists genuinely overlap: 'Career' is offered
   * to both, and two identical chips in one row is a visible bug.
   */
  const searchTopics = useMemo(() => {
    if (searchFilter.category !== null) {
      return [...expertiseFor(searchFilter.category)];
    }
    return [...new Set([...OFFERED_EXPERTISE.listener, ...OFFERED_EXPERTISE.astrologer])];
  }, [searchFilter.category]);

  /*
   * What each PAGE shows: one category. Its picks and its rows both come from
   * here, so the hero always belongs to the page it sits on.
   *
   * Then reordered so providers who share the member's languages come first
   * (Amit, 2026-09-07: "sort the profiles with language on user's home screen
   * according to his selections").
   *
   * **A SORT, never a filter, and that is the whole product decision.** The
   * roster is small enough that "only show me Tamil speakers" can return an
   * empty screen, and an empty directory is a worse answer than a well-ordered
   * one. So nobody is removed here — `sortByLanguageMatch` returns every row it
   * was given, which its own tests assert on every case.
   *
   * The existing language FILTER stays exactly as it is, in `searchFilter`
   * below: sorting is what happens by default, and filtering remains the thing
   * a member does when they have actively decided to hide people.
   *
   * Applied to `directory` rather than to `rows`, so the hero carousel inherits
   * it too: `topPicks` sorts this list by presence-and-rating, and because that
   * sort's own tie-break is the incoming order, a language match now decides
   * which of two equally-rated providers is spotlighted.
   */
  const pages = useMemo(
    () =>
      PROVIDER_CATEGORIES.map(category => {
        const directory = sortByLanguageMatch(
          /*
           * `...NO_FILTER` rather than two more empty arrays: Explore filters
           * by the PAGE's category only. Language is a sort here and a filter
           * in search (see DirectoryFilter.languages for why the two differ on
           * purpose), and expertise is not a browse-level question at all.
           */
          filterProviders(allProviders, { ...NO_FILTER, category }),
          preferredLanguages,
        );
        /**
         * The week's top picks: best-rated who are here now, then best-rated
         * at all. Deterministic, so the carousel does not reshuffle on every
         * render — a hero that changes under the eye reads as broken.
         *
         * Three rather than one (Amit, 2026-09-06). One card is a claim; three
         * is a choice, and M3's hero carousel is the layout its own guidance
         * names for "spotlighting content that you want to emphasize" while
         * showing a peek of what is next.
         */
        /*
         * Three tiers, then rating (2026-09-27, migration 155): online now
         * (the server's `online`, the same reading as the dot), then open but
         * not active in the last 75 s (still callable: the CTA follows
         * `is_available`), then closed (Notify only). `online` implies the
         * switch, so an online provider scores 2000 + 1000. Before 155 the
         * switch was the dot, and the first two tiers were one.
         */
        const now = new Date();
        const score = (p: ProviderSummary) => {
          const here = readPresence({ online: p.online, lastSeenAt: p.last_seen_at, now }).here;
          return (here ? 2000 : 0) + (p.is_available ? 1000 : 0) + (p.rating_avg ?? 0);
        };
        const topPicks = [...directory].sort((a, b) => score(b) - score(a)).slice(0, TOP_PICKS);
        // The picks are lifted out of the list below so nobody is shown twice.
        const shown = new Set(topPicks.map(p => p.id));
        const rows = directory.filter(p => !shown.has(p.id));
        return {
          category,
          directory,
          topPicks,
          rows,
          chats: chatsByCategory[category],
        };
      }),
    [allProviders, preferredLanguages, chatsByCategory],
  );

  const categoryIndex = PROVIDER_CATEGORIES.indexOf(exploreCategory);
  // The settled page's view: the spotlight sheet and the prefetch follow the
  // page the member is actually on.
  const current = pages[categoryIndex];
  const directory = current?.directory ?? NO_PROVIDERS;
  const featured = current?.topPicks[0] ?? null;

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
      // Null for a `clay:` sentinel, which is already in the bundle and has no
      // URL to warm.
      const hero = sizedStorageImageUri(p.avatar_url, heroW, 420, ratio);
      if (hero === null) {
        continue;
      }
      void Image.prefetch(hero).catch(() => {});
    }
  }, [directory, columnWidth]);

  const handleOpenProvider = useCallback(
    (id: string) => {
      // Looked up across BOTH pages: a row can be tapped on the page that is
      // still settling, before `exploreCategory` has caught up with it.
      const p = allProviders.find(x => x.id === id);
      const hero = p?.avatar_url
        ? sizedStorageImageUri(
            p.avatar_url,
            columnWidth - TOKENS.space.md * 2,
            420,
            PixelRatio.get(),
          )
        : null;
      if (hero !== null) {
        void Image.prefetch(hero).catch(() => {});
      }
      onOpenProvider(id);
    },
    [onOpenProvider, allProviders, columnWidth],
  );
  // A4: stable callback for RailItem so memo holds when balance ticks.
  const handleOpenConversation = useCallback(
    (peerId: string) => onOpenConversation(peerId),
    [onOpenConversation],
  );

  const onRailLongPress = useCallback((peerId: string, anchor: MenuAnchor) => {
    setMenuAnchor(anchor);
    setMenuPeer(peerId);
  }, []);

  /*
   * The settled page, once per change (never per frame — see
   * `categoryProgress`). An out-of-range index cannot come from a two-page
   * pager; the fallback only keeps the type honest.
   */
  const onPageSelected = useCallback((index: number) => {
    setExploreCategory(PROVIDER_CATEGORIES[index] ?? DEFAULT_CATEGORY);
  }, []);

  /*
   * A tapped tab asks the PAGER to move (Bluesky's `onTabBarSelect` →
   * `pagerView.setPage(index)`); the pager's scroll then moves the indicator
   * and, via `onPageSelected`, the settled category. Nothing is set here while
   * the pager exists, so a tap and a swipe take the same path.
   *
   * While the skeleton is up (or search is open) there is no pager to scroll,
   * yet the tabs can be on screen and a tap must still land. Then the choice
   * is applied directly and the indicator jumps to it — there is no page
   * underneath to follow — and the pager, when it mounts, starts on that page.
   */
  const selectCategory = useCallback(
    (category: ProviderCategory) => {
      const index = PROVIDER_CATEGORIES.indexOf(category);
      if (pagerRef.current !== null) {
        pagerRef.current.setPage(index);
        return;
      }
      setExploreCategory(category);
      categoryProgress.set(index);
    },
    [categoryProgress],
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
    // Leaving search takes the IME with it, on every exit (the ✕, hardware
    // back). The field unmounts with the bar, and an unmounted TextInput does
    // not always hand the IME back on Android, so it is dismissed explicitly.
    // https://reactnative.dev/docs/keyboard#dismiss
    Keyboard.dismiss();
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
   * back button did nothing at all. Search is exactly the "temporary UI state"
   * the custom-back guidance says back dismisses before the screen itself is
   * left, and the same page says to intercept ONLY in the state that needs it.
   * Focus-scoped since navigation step 7 (`useSearchBack`, nav-migration §4):
   * registered after the NavigationContainer's listener, so it is consulted
   * first, and gone while Home is covered.
   * https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture
   */
  useSearchBack(searching, closeSearch);

  /*
   * Pressing Home, from anywhere, leaves search (Amit, 2026-09-27: "search
   * should get dismissed if home is clicked"): the member asked for Home, and
   * Home is the directory. A re-tap at the root then also refetches the
   * directory, and the settled page scrolls itself up (DirectoryPage's own
   * listener, step 9).
   */
  useTabPress('Home', closeSearch);
  useSoftReset(() => {
    void refetchProviders();
  });

  /*
   * Pull to refresh (Bluesky's feed does; Amit, 2026-09-29: match its
   * smoothness). The spinner is the member's own pull only, never the 30 s
   * background poll. And it is a performance fix as much as a feature:
   * without it the top edge fell to Android 12+'s stretch overscroll, which
   * draws the whole 1080x1902 list into an offscreen layer per frame with
   * every image re-uploaded (S22 trace 2026-09-29: 6 slow draws, 5 bitmap
   * uploads per pull, Bluesky 0 and 0). RefreshControl takes the pull.
   * https://reactnative.dev/docs/refreshcontrol
   */
  const [pulling, setPulling] = useState(false);
  const onPullRefresh = useCallback(() => {
    setPulling(true);
    void refetchProviders().finally(() => setPulling(false));
  }, [refetchProviders]);

  const loading = convosPending || providersPending;
  const firstUser = balance === 0;
  const tourComplete = tourSeen || !firstUser;

  useEffect(() => {
    if (!focused || loading || balance === null || featured === null || searching) {
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
    /*
     * The BALANCE gate, which was missing entirely.
     *
     * `tourComplete` is `tourSeen || !firstUser`, so it is true for a FUNDED
     * member — meaning this sheet was reaching everyone, not the zero-balance
     * member docs/FEATURES.md scopes it to ("shown only for first-user
     * (token_balance === 0) after the tour"). The tour gate was doing duty as a
     * balance gate and does not fit: it exists to stop the sheet interrupting
     * the tutorial, which is a different question from who should see it.
     */
    if (!firstUser) {
      return;
    }
    if (potdDismissedThisRun) {
      return;
    }
    const timer = setTimeout(() => setPotdVisible(true), 2000);
    return () => clearTimeout(timer);
  }, [focused, loading, balance, featured, searching, tourComplete, firstUser]);

  useEffect(() => {
    // Product identity rule: first-user UI is balance-only. A stale local
    // `seen=false` value must never replay onboarding for a funded account.
    // And only while Home is on top: a tour pointing at a covered screen has
    // nothing to point at (nav-migration §5).
    if (!focused || loading || balance === null || searching || tourSeen || !firstUser) {
      return;
    }
    const timer = setTimeout(() => startTour(), 700);
    return () => clearTimeout(timer);
  }, [focused, loading, balance, searching, tourSeen, firstUser, startTour]);

  const dismissPotd = useCallback(() => {
    potdDismissedThisRun = true;
    setPotdVisible(false);
  }, []);

  const chatFromPotd = useCallback(() => {
    if (!featured) {
      return;
    }
    potdDismissedThisRun = true;
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

  /*
   * The rate the rows quote, read ONCE here and passed down.
   *
   * `ProviderRow` deliberately does not call `useEconomicsConfig()` itself —
   * see its `ratePerMin` prop. React Query would dedupe the fetch, but every
   * visible row would subscribe, so one admin edit re-renders the whole list
   * and `memo` stops holding across balance ticks.
   *
   * The CHAT rate, because the row's action is Chat and its CTA says so. The
   * glyph beside it switches to a phone for a provider who takes calls, which
   * is honest today only because `chat_rate` and `audio_rate` are both ₹22 —
   * ProviderRow's own comment names this as the site that has to choose if they
   * ever diverge.
   */
  const { data: economics } = useEconomicsConfig();
  const ratePerMin =
    economics?.chat_rate_tokens_per_min ?? FALLBACK_ECONOMICS.chat_rate_tokens_per_min;

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
          onCall={onCallProvider}
          ratePerMin={ratePerMin}
          animateEntrance={animate}
        />
      );
    },
    [results.length, handleOpenProvider, onCallProvider, ratePerMin],
  );

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
      {/* The bar every tab wears — see TabTopBar for the geometry and for why
          Favourites and Settings render the SAME component rather than a copy
          of it. Home is the one that carries the wordmark and the wallet's
          tour anchor. Not a collapsing LargeTitleBar: v13 Home has a fixed nav
          row, and the large title belongs to the Explore section header below
          it. */}
      <TabTopBar
        title="Pappal"
        brand
        searching={searching}
        onSearchOpen={() => setSearching(true)}
        /* The hardware back button runs this too (`searchBackGuard`), so the
           two ways out cannot diverge. */
        onSearchClose={closeSearch}
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder="Search by name or language"
        testID="home"
        walletTourId="wallet"
      />

      {searching ? null : (
        <ProviderTypeTabs
          value={exploreCategory}
          progress={categoryProgress}
          onSelect={selectCategory}
          testID="explore-tabs"
        />
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
                  selected={searchFilter.bands.includes(band)}
                  onPress={() => setSearchFilter(f => toggleBand(f, band))}
                />
              ))}
            </View>
          </View>
          {/* Language (Amit, 2026-09-08: "give language and expertise filer in
              search").

              A FILTER here, where Home sorts by the same field. That looks
              inconsistent and is the product decision, recorded on
              DirectoryFilter.languages: browsing must not be able to empty
              itself, but a member who has typed a query has asked to narrow,
              and quietly widening what they asked for would be the worse
              answer.

              `OFFERED_LANGUAGES` is the same list a provider ticks, so a member
              can never filter on a language nobody is able to claim. */}
          <View style={styles.filterGroup}>
            <Text allowFontScaling style={styles.filterLabel}>
              Language
            </Text>
            <View style={styles.filterChips}>
              {OFFERED_LANGUAGES.map(language => (
                <Chip
                  key={language}
                  label={language}
                  selected={searchFilter.languages.includes(language)}
                  onPress={() =>
                    setSearchFilter(f =>
                      toggleFilterLanguage(f, language, OFFERED_LANGUAGES),
                    )
                  }
                />
              ))}
            </View>
          </View>
          {/* Topic. The chips follow the CATEGORY chip above, because 083 keeps
              two vocabularies and offering Tarot alongside Anxiety would
              describe neither kind of provider.

              With no category picked the union is shown: search spans both
              tabs, so a member who has not narrowed to one should still be able
              to ask for Tarot. `expertiseFor` gives one list, so the union is
              built here rather than in the lib, where nothing else needs it. */}
          <View style={styles.filterGroup}>
            <Text allowFontScaling style={styles.filterLabel}>
              Topic
            </Text>
            <View style={styles.filterChips}>
              {searchTopics.map(topic => (
                <Chip
                  key={topic}
                  label={topic}
                  selected={searchFilter.expertise.includes(topic)}
                  onPress={() =>
                    setSearchFilter(f => toggleFilterExpertise(f, topic, searchTopics))
                  }
                />
              ))}
            </View>
          </View>
        </View>
      ) : null}

      {/* The content underneath the row, and the second half of the reference app's
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
                { paddingBottom: listBottomPadding },
              ]}
              overrideItemLayout={layout => { (layout as { span?: number; size?: number }).size = PROVIDER_ROW_HEIGHT; }}
            />
          </Animated.View>
        ) : loading ? (
          <View style={styles.swapLayer}>
            <DirectorySkeleton />
          </View>
        ) : (
          /* THE PAGER (owner decision, Amit 2026-09-26/27: Bluesky's mechanics
             exactly). One page per category, each its own list; a horizontal
             swipe moves between them and the tabs above track it. It lives
             INSIDE the directory layer, so search still replaces the whole
             directory the way it did and the search surface has no pager at
             all. Remounted after search closes, it starts on the category the
             member left (`initialPage`). */
          <Animated.View
            key="directory"
            style={styles.swapLayer}
            entering={directoryIn}
            exiting={directoryOut}>
            <ProviderPager
              ref={pagerRef}
              initialPage={categoryIndex}
              dragProgress={categoryProgress}
              onPageSelected={onPageSelected}
              testID="home-pager">
              {pages.map(page => (
                <View key={page.category} collapsable={false}>
                  <DirectoryPage
                    category={page.category}
                    focused={page.category === exploreCategory}
                    chats={page.chats}
                    topPicks={page.topPicks}
                    rows={page.rows}
                    seenIds={seenIds}
                    bottomPadding={listBottomPadding}
                    ratePerMin={ratePerMin}
                    onOpenProvider={onOpenProvider}
                    onOpenRow={handleOpenProvider}
                    onCallProvider={onCallProvider}
                    onOpenConversation={handleOpenConversation}
                    onRailLongPress={onRailLongPress}
                    onSeeAllChats={onSeeAllChats}
                    refreshing={pulling}
                    onRefresh={onPullRefresh}
                  />
                </View>
              ))}
            </ProviderPager>
          </Animated.View>
        )}
      </View>
      {/* The spotlight sheet needs no away branch and this is the check, not an
          omission: its only action is `onChat` → `chatFromPotd` → the
          conversation, which IS the notify action (`announce_chat_open`,
          migration 068). There is no call on it to withdraw, and `online` is
          the same `readPresence` reading of the server's `online` (155) as
          every other dot. */}
      <SpotlightCard
        visible={potdVisible && featured !== null}
        name={providerFirstName(featured?.display_name) || 'Someone for you'}
        avatarUri={featured?.avatar_url ?? null}
        online={
          featured !== null &&
          readPresence({
            online: featured.online,
            lastSeenAt: featured.last_seen_at,
            now: new Date(),
          }).here
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
  // The member's peer is a provider: first name only (display.ts).
  const name =
    (chat.i_am_member ? providerFirstName(chat.peer_display_name) : chat.peer_display_name) ||
    'Conversation';
  const unreadCount = chat.i_am_member
    ? Number(chat.unread_count_member)
    : Number(chat.unread_count_provider);
  const unread = unreadCount > 0;
  /*
   * The server's `peer_online` (migration 155), the same derivation the
   * directory card's `online` is (conversation_peers and provider_directory
   * share it), so this dot and the card's agree about the same provider. It
   * used to read `peer_available` behind `peer_is_provider`, and
   * `conversation_summaries` carried neither until 155: both were undefined,
   * the reading was "nothing", and the rail drew an unlit dot for a provider
   * the card below showed lit. That was the reported rail-versus-card
   * mismatch. A member peer, a blocked pair and a provider never seen all come
   * back false and null, which lights nothing.
   *
   * Only the dot is drawn here, so `now` only has to be a valid clock; the
   * reading refreshes with the inbox query's own cadence.
   */
  const presence = readPresence({
    online: chat.peer_online,
    lastSeenAt: chat.peer_last_seen_at,
    now: new Date(),
  });
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
 * One category's page of the directory pager: its own Chats rail, Explore
 * head, week's picks and provider rows, in its own FlashList.
 *
 * A component rather than two copies of the old inline list because both pages
 * are MOUNTED at once — the pager keeps its neighbour laid out
 * (`offscreenPageLimit={1}`, see ProviderPager) so the first swipe does not
 * build a list mid-drag — and each needs its own list data, its own scroll
 * position and its own recycling pool. Memoised so a settled-page change
 * re-renders only what reads `focused`.
 *
 * The header is an ELEMENT, not a component. It used to be a `useCallback`
 * returning JSX, and FlashList treats a new function as a new component type:
 * any dependency change remounted the whole header, resetting the rail's and
 * the picks' horizontal scroll. With `focused` now changing on every swipe
 * that would have reset both strips on every page change.
 */
const DirectoryPage = memo(function ({
  category,
  focused,
  chats,
  topPicks,
  rows,
  seenIds,
  bottomPadding,
  ratePerMin,
  onOpenProvider,
  onOpenRow,
  onCallProvider,
  onOpenConversation,
  onRailLongPress,
  onSeeAllChats,
  refreshing,
  onRefresh,
}: {
  category: ProviderCategory;
  /** The settled page. Gates tour anchors and row entrances, never content. */
  focused: boolean;
  chats: ConversationSummary[];
  topPicks: ProviderSummary[];
  rows: ProviderSummary[];
  seenIds: React.RefObject<Set<string>>;
  bottomPadding: number;
  ratePerMin: number;
  /** The picks' press, unchanged: the profile, no prefetch. */
  onOpenProvider: (providerId: string) => void;
  /** The rows' press: the profile, with the hero warmed first. */
  onOpenRow: (providerId: string) => void;
  onCallProvider: (providerId: string) => void;
  onOpenConversation: (peerId: string) => void;
  onRailLongPress: (peerId: string, anchor: MenuAnchor) => void;
  onSeeAllChats: () => void;
  /** The member's own pull (HomeScreen's `pulling`), never the background poll. */
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const styles = useStyles(makeStyles);

  /*
   * Re-tapping Home scrolls the SETTLED page back to its top, rail and picks
   * included (step 9). Gated on `focused` so the page off to the side keeps
   * where the member left it.
   */
  const reducedMotion = useReducedMotion();
  const listRef = useRef<FlashListRef<ProviderSummary> | null>(null);
  const railRef = useRef<ScrollView | null>(null);
  const picksRef = useRef<ScrollView | null>(null);
  useSoftReset(() => {
    const animated = !reducedMotion;
    listRef.current?.scrollToOffset({ offset: 0, animated });
    railRef.current?.scrollTo({ x: 0, animated });
    picksRef.current?.scrollTo({ x: 0, animated });
  }, focused);
  const theme = useTheme();

  /*
   * `onCall` is passed for EVERY row, including a row for somebody who is away,
   * and that is correct rather than an oversight: the row decides. Since
   * 2026-09-13 `ProviderRow` computes `away` from the availability switch and
   * drops its Call for a bell (ProviderRow.tsx:413), so no away row on this
   * screen can ring anyone — the CTA falls through to `onPress`.
   *
   * Where that lands is this screen's choice and it is deliberate: `onPress` is
   * `handleOpenProvider`, the PROFILE, whose only action for an away provider
   * is now Notify (ProviderDetailScreen.tsx:146) and where Notify opens the
   * conversation — the thing that actually pushes to them
   * (`announce_chat_open`, migration 068). Home's card body has opened the
   * profile since v13 and the CTA shares that press, so routing the bell
   * straight into a conversation would need a third callback on the row rather
   * than a change here.
   */
  /*
   * Entrances play on the FOCUSED page only. The neighbouring page is mounted
   * and laid out off screen (see the component note), so a stagger there would
   * run where nobody can see it; and when the member swipes to it, its rows
   * should already be there — Bluesky's feeds do not animate in under a page
   * that is sliding in, and a second motion on top of the page's own would be
   * noise. Its ids are still marked seen, so FlashList recycling cannot replay
   * an entrance on scroll-back, which is the rule `seenIds` exists for.
   */
  const renderExploreRow = useCallback(
    ({ item, index }: { item: ProviderSummary; index: number }) => {
      const animate = focused && !seenIds.current.has(item.id);
      seenIds.current.add(item.id);
      return (
        <ProviderRow
          provider={item}
          index={index}
          isLast={index === rows.length - 1}
          onPress={onOpenRow}
          onPressAvatar={onOpenRow}
          onCall={onCallProvider}
          ratePerMin={ratePerMin}
          animateEntrance={animate}
        />
      );
    },
    [focused, seenIds, rows.length, onOpenRow, onCallProvider, ratePerMin],
  );

  // ListHeaderComponent: chats rail + section head + the week's picks. Kept
  // outside the FlashList data so only the provider rows are virtualised; the
  // chrome above them is always rendered.
  // The page's providers, for its stories rail: a page shows the stories of
  // the people it lists, so swiping categories swaps the rail with the rows.
  const pageProviderIds = useMemo(
    () => new Set([...rows, ...topPicks].map(p => p.id)),
    [rows, topPicks],
  );

  const exploreHeader = useMemo(
    () => (
      <>
        {/* Stories (owner, 2026-09-26): above the Chats rail, inside the
            page's list header, so the pager's pages keep their layout and a
            page with no live stories renders exactly as before (the rail
            returns nothing). */}
        <StoryRail providerIds={pageProviderIds} />
        <TourAnchor id="chats" active={focused}>
        <View style={styles.rail}>
          <View style={styles.railHeader}>
            <Text allowFontScaling accessibilityRole="header" style={styles.railLabel}>
              Chats
            </Text>
            {chats.length > 0 ? (
              <View style={styles.seeAllBleed}>
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
              </View>
            ) : null}
          </View>
          {chats.length > 0 ? (
            <ScrollView
              ref={railRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              {...SCROLL_PHYSICS}
              contentContainerStyle={styles.railScroll}>
              {chats.map(chat => (
                <RailItem
                  key={chat.conversation_id}
                  chat={chat}
                  onPress={onOpenConversation}
                  onLongPress={onRailLongPress}
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
        <TourAnchor id="explore" active={focused}>
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
          <Text allowFontScaling accessibilityRole="header" style={styles.exploreTitle}>
            Explore
          </Text>
        </View>
        </TourAnchor>
        {topPicks.length > 0 ? (
          <>
            <View style={styles.picksHead}>
              <Text
                allowFontScaling
                accessibilityRole="header"
                style={styles.picksTitle}>
                Top {CATEGORY_LABEL[category].toLowerCase()} this week
              </Text>
            </View>
            {/* PORTRAIT STORY CARDS, start-aligned, about 2.3 across (Amit,
                2026-09-26: the centred landscape hero cropped faces). Android's
                uncontained carousel: one fixed item size flowing past the edge,
                https://developer.android.com/develop/ui/compose/components/carousel
                — geometry in lib/carousel.ts, where it is tested.

                NOT ENDLESS ANY MORE, and that reverses the 2026-09-06 "endless
                rotation" on purpose: the wrap worked by holding three copies of
                the list, and with THREE picks and 2.3 cards in view the first
                card would sit right beside the last, the same face twice on
                screen. A three-card strip that ends is the honest shape. The
                snap is kept (one card pitch, start-aligned, no multi-card
                flings), and still no timer: nothing moves under a still finger.
                HeroCarousel keeps its centred, endless geometry for the profile
                photo pager. */}
            <ScrollView
              ref={picksRef}
              horizontal
              showsHorizontalScrollIndicator={false}
              snapToInterval={HERO_CARD_WIDTH + HERO_CARD_GAP}
              snapToAlignment="start"
              disableIntervalMomentum
              {...SCROLL_PHYSICS}
              contentContainerStyle={styles.picksStrip}
              testID="top-picks">
              {topPicks.map(p => (
                <Card key={p.id} style={styles.featuredCard}>
                  <FeaturedCard
                    provider={p}
                    imageWidth={HERO_CARD_WIDTH}
                    onPress={() => onOpenProvider(p.id)}
                  />
                </Card>
              ))}
            </ScrollView>
          </>
        ) : null}
        {/* Spacing that separates the featured card (or explore heading) from
            the first provider row. Widened from `sm` (12) to `2xl` (32) so the
            first card sits lower and the top edge of the SECOND card no longer
            peeks above the fold on the default Home viewport (Amit, on device).
            The exact value is viewport-dependent; confirm on the S22/Redmi and
            nudge if the second card still shows a sliver. */}
        <View style={{ height: TOKENS.space['2xl'] }} />
      </>
    ),
    [
      category,
      focused,
      chats,
      topPicks,
      styles,
      theme,
      onOpenProvider,
      onOpenConversation,
      onRailLongPress,
      onSeeAllChats,
      pageProviderIds,
    ],
  );

  return (
    <FlashList
      ref={listRef}
      testID={`home-scroll-${category}`}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          colors={[theme.color.text.accent]}
          progressBackgroundColor={theme.color.bg.raised}
        />
      }
      data={rows}
      keyExtractor={p => p.id}
      renderItem={renderExploreRow}
      ListHeaderComponent={exploreHeader}
      ListEmptyComponent={
        topPicks.length === 0 ? (
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
        // The nav is a frosted overlay, so the list scrolls under it. Clear its
        // full height (bar + safe-area inset) plus the usual end breathing
        // room, so the last row lands above the bar rather than behind it.
        { paddingBottom: bottomPadding },
      ]}
      overrideItemLayout={layout => { (layout as { span?: number; size?: number }).size = PROVIDER_ROW_HEIGHT; }}
    />
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
  // Ramp 500 -> 700, not the 400 -> 600 field (owner, 2026-09-27): the name,
  // age and years sit on it in white with no scrim, and on 400 -> 600 the 82%
  // age line measures 3.89:1, under 4.5 (check-contrast.mjs GRADIENT_TEXT).
  const gradient = `linear-gradient(140deg, ${theme.color.bg.accentGradientFrom} 0%, ${theme.color.bg.accentGradientTo} 100%)`;
  /*
   * "F-34", the same shorthand the explore card uses.
   *
   * Found on the device: the card showed "Rukmini Bhat F-34" while this hero
   * showed "Lalita Devi 54" — the same person, two surfaces, one of them
   * missing the letter, because the card got `genderLetter` and this did not.
   * It reads as a data gap rather than as two components, which is why it is
   * worth fixing rather than leaving to the redesign that eventually merges
   * them.
   */
  const letter = genderLetter(provider.gender);
  const age =
    provider.age !== null
      ? ` ${letter === null ? '' : `${letter}-`}${provider.age}`
      : '';
  /*
   * The DOT and the spoken line are the server's reading (migration 155):
   * `online` is open AND a heartbeat in the last 75 s, and otherwise a last
   * seen. The Notify marker below is NOT: see `away`.
   */
  const presence = readPresence({
    online: provider.online,
    lastSeenAt: provider.last_seen_at,
    now: new Date(),
  });
  /*
   * SPOKEN, NO LONGER DRAWN (2026-09-26). The card is 150dp wide now, 126 inside
   * its padding, and a one-line tagline there holds about 18 characters of
   * bodyMedium: every real headline is a sentence, so it would draw as an
   * ellipsis on every card. It stays in the card's spoken label and in full on
   * the profile, one tap away.
   */
  const tagline =
    provider.headline && provider.headline !== ''
      ? provider.headline
      : provider.languages.slice(0, 2).join(' · ');
  /*
   * The same numbers the cards below show, through the same function.
   *
   * This badge used to read `provider.rating_avg` directly and hide itself when
   * `rating_count` was 0 — so once the cards started showing a system rating,
   * the hero was the one surface still saying nothing for an unrated provider,
   * and where both appeared they could disagree. One provider, two numbers, on
   * one screen.
   */
  const rating = displayRating(provider);
  const years = seededExperienceYears(provider.id);
  /*
   * Experience INLINE, beside the rating (Amit, 2026-09-08: "carousle cards
   * should laos have experience and ratings inline -- place them smartly and
   * space efficiently").
   *
   * NARROWED 2026-09-26 for the 150dp portrait card: the line used to carry
   * reviews, years and languages ("1.2k reviews  ·  7 yrs  ·  Hindi, English"),
   * about 250dp of text, and the card has 126dp inside its padding with the
   * rating pill already on the same row. The years are the one fact that always
   * fits beside the pill; the review count and the languages are spoken in the
   * card's label, drawn on every row below and on the profile.
   */
  const heroMeta = `${years} ${years === 1 ? 'yr' : 'yrs'}`;
  /*
   * AWAY, AND WHAT THE CARD OFFERS BECAUSE OF IT.
   *
   * The same `!provider.is_available` test the directory row uses
   * (ProviderRow.tsx). The switch, NOT the dot (2026-09-27, migration 155):
   * a provider who is open but has not been active in the last 75 s is still
   * callable, so the card offers what it offers anyone open and simply draws
   * no dot. Only a closed switch is away. This hero has never carried a Call, so there is nothing to take
   * away; what it was missing is the other half of the rule, which is that an
   * away provider should be OFFERED the one action that works. The dot slot
   * says "here now" when they are; when they are not, it names what a tap leads
   * to instead — the profile, whose only action for an away provider is Notify
   * (and where Notify opens the conversation, which is what pushes to them:
   * `announce_chat_open`, migration 068).
   *
   * A marker, not a second press target: the whole card is one Pressable and
   * this is `accessible={false}` inside it, exactly as the presence dot it
   * replaces and the rating pill beside it are.
   */
  const away = !provider.is_available;
  /*
   * The card IS 3:4 now, the crop migration 087 stores every avatar at, so the
   * server is asked for exactly the frame: a resize, not a crop. The old
   * landscape band had to request a taller image and window into it, because
   * Supabase's `resize=cover` crops from the centre and took heads off.
   */
  const heroPhoto = avatarImageSource(
    provider.avatar_url,
    imageWidth,
    HERO_CARD_HEIGHT,
  );
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
    `Featured: ${providerFirstName(provider.display_name)}`,
    // "away" / "last seen Tuesday" in the same words every other surface
    // speaks, so the pill is not the only place the state exists.
    presenceForSpeech(presence),
    tagline,
    `rated ${rating.score.toFixed(1)} from ${rating.count} reviews`,
    `${years} ${years === 1 ? 'year' : 'years'} experience`,
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
      {heroPhoto !== null ? (
        <>
          {/* fadeDuration={0}: skip Fresco's 300ms cross-fade. The fade forces
              per-frame GPU composition during the animation; at 0 the bitmap
              is uploaded once and rendered immediately, matching Avatar's own
              policy. The Supabase transform already returns the right pixel
              size, so no decode-time downsampling is needed. */}
          <Image source={heroPhoto} style={styles.featuredPhoto} fadeDuration={0} />
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
      {away ? (
        <View accessible={false} style={styles.featuredNotify}>
          <Icon name="bell" size={TOKENS.icon.xs} color={theme.color.text.onAccent} />
          <Text allowFontScaling style={styles.featuredBadgeText}>
            Notify
          </Text>
        </View>
      ) : presence.here ? (
        // Open and active: the dot. Open and idle: nothing in the slot, since
        // the card offers the same thing either way and a last seen is spoken.
        <View style={styles.featuredOnline} />
      ) : null}
      <View style={styles.featuredBody}>
        <View style={styles.featuredNameRow}>
          {/* The row's name role (titleMediumEmphasized over a nested bodySmall
              "F-28"), not the old 24dp headline: at 126dp a 24dp name held
              about seven characters. */}
          {/* Name and age as SIBLINGS, so a long one-word name ("RaviListens")
              ellipsizes itself and the age tag always shows whole. Nested, the
              line truncated from its tail, which is the age ("M-…", S22
              2026-09-29). Baseline-aligned by the row. */}
          <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling numberOfLines={1} style={styles.featuredName}>
            {providerFirstName(provider.display_name)}
          </Text>
          {age === '' ? null : (
            <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} allowFontScaling numberOfLines={1} style={styles.featuredAge}>
              {age}
            </Text>
          )}
        </View>
        {/* The rating AT THE BOTTOM with the name (Amit, 2026-09-26: "name +
            F-28 and rating at the bottom"), so the photo's top corners hold
            only presence. Same pill, same fill, one step smaller. */}
        <View style={styles.featuredMetaRow}>
          {/* The star and the number, nothing else. "Top rated" repeated the section
              header immediately above the carousel, on all three cards, so it said
              nothing the header had not already said (Amit). With the words gone
              there is no sensible fallback: a solid accent pill asserting nothing,
              on a card in a "Top listeners this week" strip, is an advert rather than
              a status — so a provider with no ratings gets no pill at all. Same
              glyph and precision as ProviderCard.tsx:168-170 and
              ProviderRow.tsx:226-228; `accessible={false}` folds it into the card,
              whose label says "rated 4.8 from 12 reviews" in words. `?? 0` rather
              than the peers' `?.` because on the hero a null average would print the
              literal "★ undefined". */}
          <View accessible={false} style={styles.featuredBadge}>
            {/* Number first, star last (Amit: "interchange position" of the two,
                2026-09-08) — the opposite order from ProviderRow/ProviderCard's
                "★ 4.8" chip. Kept local to the hero rather than flipped
                everywhere: only the hero pill was asked to change. */}
            <Text allowFontScaling style={styles.featuredBadgeText}>
              {`${rating.score.toFixed(1)} ★`}
            </Text>
          </View>
          {/* Experience beside the rating. See `heroMeta`. */}
          <Text allowFontScaling numberOfLines={1} style={styles.featuredMeta}>
            {heroMeta}
          </Text>
        </View>
      </View>
    </Pressable>
  );
}

const RAIL_AVATAR = 56;

/**
 * The Chats rail's content height when it has a row of avatars to show:
 * the ring box (`RAIL_AVATAR` plus its 3dp pad and 2dp border on each side,
 * see `railRing`) plus the `2xs` gap plus the name label's line height (see
 * `railItem`/`railName`).
 *
 * Exported to `railEmpty` so the EMPTY state (a lone 56dp dashed plus, no
 * label) reserves the same height rather than a shorter one. Without this,
 * Listeners (which always has chats in the seed data) and Astrologers
 * (which starts with none) laid out the Chats rail at two different
 * heights, so the Explore heading below it sat at two different Y
 * positions — Amit, on the device: "astrologers dont have chats thats why
 * viewport shifts when you switch between these two tabs".
 */
const RAIL_ITEM_HEIGHT =
  RAIL_AVATAR + 2 * (3 + 2) + TOKENS.space['2xs'] + TOKENS.typography.bodySmall.lineHeight;

/**
 * How far the 48dp "See all" target bleeds past the Chats heading's 22dp line,
 * top and bottom: (48 - 22) / 2 = 13.
 *
 * "See all" renders only when there are chats. If its target set the header
 * row's height, the row would be 48 on Listeners (seeded chats) and 22 on
 * Astrologers (none), and Explore would jump between tabs — the viewport shift
 * `RAIL_ITEM_HEIGHT` above exists to prevent. Bleeding into the header's own
 * padding keeps the row at the heading's line height either way, and the target
 * stays a real 48dp box because hitSlop cannot extend past a parent on Android.
 */
const SEE_ALL_BLEED =
  (TOKENS.interaction.minTarget - TOKENS.typography.textLgSemiBold.lineHeight) / 2;

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
      alignSelf: 'center',
    },
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
    // Bluesky's section header (src/screens/Search/components/ModuleHeader.tsx
    // Container): px_lg 16, pt_2xl 24, pb_md 12 (ADR-0033). The 24 above Chats
    // is ProviderTypeTabs' own marginBottom (sm) plus this sm, so the rail
    // itself carries no vertical padding.
    rail: {},
    railHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.sm,
      paddingBottom: TOKENS.space.sm,
    },
    // Same height as a populated rail (`RAIL_ITEM_HEIGHT`), the plus centred
    // inside it, rather than its own shorter padding — see the constant's
    // comment for the viewport-shift bug this fixes.
    railEmpty: {
      height: RAIL_ITEM_HEIGHT,
      paddingHorizontal: TOKENS.space.md,
      justifyContent: 'center',
    },
    // Chats is a peer section heading to Explore, not a quiet caption (#14,
    // Amit: "bold, looks too shallow in front of Explore"). Same role and
    // primary ink so the two read as equals: Bluesky's section title, text_lg
    // font_semi_bold (ModuleHeader TitleText), no longer larger than the
    // Listeners/Astrologers tabs by a whole display step.
    railLabel: {
      ...TOKENS.typography.textLgSemiBold,
      color: t.color.text.primary,
    },
    // The bleed is on a plain wrapper, not on the Pressable: Pressable moves
    // box sizing (minHeight) to its touchable root and leaves margins on the
    // inner view, so a negative margin in `seeAll` shrank only the inside and
    // the root still claimed 48 in the row. On the S22 that made the Chats row
    // 48 tall and put "Chats" 40.8dp below the tabs instead of 24 (2026-09-26).
    seeAllBleed: {
      marginVertical: -SEE_ALL_BLEED,
    },
    seeAll: {
      flexDirection: 'row',
      alignItems: 'center',
      minHeight: TOKENS.interaction.minTarget,
    },
    seeAllText: {
      ...TOKENS.typography.textSmSemiBold,
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
      // each side = 66) with a little air; the reference app's stories item is 70 (ITEM_
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
    //
    // `top` is 4, not 0, because Badge's pill sits 4dp ABOVE its anchor
    // (`top: -4` in Badge.tsx) and this item is the first thing in a horizontal
    // ScrollView, which always clips its children on Android. At `top: 0` the
    // top quarter of every unread count was cut off (Amit, on device,
    // 2026-09-26). At 4 the pill's top edge meets the item's top edge and the
    // ring's, so the badge still reads as sitting on the ring's corner and the
    // rail's height, which railEmpty reserves, is unchanged.
    railBadge: {
      position: 'absolute',
      top: 4,
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
      // Bluesky ModuleHeader pt_2xl: 24 from the rail above.
      paddingTop: TOKENS.space.xl,
      // 'Explore' and its caption "Top listeners this week" are a title + its
      // supporting line, so they read as ONE unit: a 2dp hairline gap (Amit, on
      // device), so glyph-to-glyph the two lines sit as close as the fonts' own
      // line-box leading allows. Was 12dp, which made them two separate things.
      // Bluesky stacks TitleText and SubtitleText with gap_2xs, the same 2dp.
      // https://m3.material.io/foundations/layout/understanding-layout/spacing
      paddingBottom: TOKENS.space.hair,
    },
    /*
     * "Top listeners this week" (or astrologers) over the hero carousel. A heading, because a row
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
     * That reasoning picked the M3 titleSmall 14/20 SemiBold. ADR-0033 moves it
     * to Bluesky's section subtitle instead (below): same job, one step quieter
     * on weight, since the title above it is now SemiBold rather than Bold.
     */
    // Bluesky ModuleHeader pb_md 12 under the title block, and its
    // SubtitleText role: text_sm leading_tight, 13.1/15 Regular (ADR-0033).
    // The step down from the title is now size and weight (16.9 SemiBold over
    // 13.1 Regular) plus the quieter `text.section` ink.
    picksHead: {
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.sm,
    },
    picksTitle: {
      ...TOKENS.typography.textSmTight,
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
      gap: TOKENS.space.xs,
    },
    // Bluesky text_sm font_semi_bold for a group label (ADR-0033).
    filterLabel: {
      ...TOKENS.typography.textSmSemiBold,
      color: t.color.text.secondary,
    },
    filterChips: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space.xs,
    },
    exploreTitle: {
      ...TOKENS.typography.textLgSemiBold,
      color: t.color.text.primary,
    },
    /*
     * The picks strip: inset by the page's 16dp so the first card lines up with
     * "Top listeners this week" above it, and `space.xs` between cards.
     */
    picksStrip: {
      paddingHorizontal: TOKENS.space.md,
      gap: HERO_CARD_GAP,
    },
    // Card wraps each pick; Card owns borderRadius and overflow. The box is
    // stated here so a card is 150x200 before its photo arrives.
    featuredCard: {
      width: HERO_CARD_WIDTH,
      height: HERO_CARD_HEIGHT,
    },
    featured: {
      // PORTRAIT 3:4, 150x200 (Amit, 2026-09-26: the landscape hero cropped
      // faces). Was a 178dp-tall band the width of the column. The 178 itself
      // was a measured fix (the 210 hid the first row's last line under the tab
      // bar); 200 is 22dp taller, which is why the first-row check below is on
      // the S22 list for this change.
      height: HERO_CARD_HEIGHT,
      justifyContent: 'flex-end',
      // overflow: 'hidden' removed — Card already clips its content to its own
      // borderRadius. An inner rect-clip here was a redundant Skia save/restore
      // per hero card.
    },
    /*
     * The GRADIENT fallback fills the frame exactly — there is nothing in it to
     * crop badly.
     */
    featuredFill: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    },
    /*
     * The photo FILLS the card. The card is 3:4 and so is every stored avatar
     * (087), so filling it is the whole selfie: no top anchoring, no taller
     * request windowed down, which is what the landscape band needed because
     * Supabase's `resize=cover` crops from the centre and took heads off.
     */
    featuredPhoto: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    },
    /*
     * FULL STRENGTH UNDER ALL OF THE TEXT, then a fade. The text block (12 of
     * padding, the name's 24, 4, the pill row's 20, 12) is 72dp, 36% of the
     * card, so the scrim holds its 62% to 38% of the height and fades out by
     * 68%, above which the face sits (~34% from the top). scripts/check-contrast.mjs
     * measures the text against that 62%, which is now true of every line
     * rather than only of the bottom edge.
     */
    featuredScrim: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      experimental_backgroundImage:
        'linear-gradient(0deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.62) 38%, rgba(0,0,0,0) 68%)',
    },
    // The fallback initial, scaled with the card: 160 on a 178dp band, 120
    // on a 200dp portrait, so it still reads as a watermark and not a clip.
    featuredWatermark: {
      position: 'absolute',
      right: TOKENS.space.xs,
      top: -TOKENS.space.xs,
      fontFamily: TOKENS.face.semibold,
      fontSize: 120,
      lineHeight: 144,
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
    // In flow now, first on the bottom row, and one padding step smaller for
    // a 150dp card: 8 across and 2 down around the 16dp line, a 20dp pill.
    featuredBadge: {
      paddingHorizontal: TOKENS.space.xs,
      paddingVertical: TOKENS.space.hair,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.accentStrong,
    },
    featuredBadgeText: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.onAccent,
    },
    featuredBody: {
      padding: TOKENS.space.sm,
      gap: TOKENS.space['2xs'],
    },
    featuredMetaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    featuredNameRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
    },
    featuredName: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: '#FFFFFF',
      // Shrinks (and ellipsizes) before the age does; no `flex: 1`, so a
      // short name keeps the age right beside it.
      flexShrink: 1,
    },
    featuredAge: {
      ...TOKENS.typography.bodySmall,
      color: 'rgba(255,255,255,0.82)',
      flexShrink: 0,
    },
    /*
     * The away state's pill, in the presence dot's slot.
     *
     * Same fill and ink as `featuredBadge` above, and for the same reason: this
     * sits at the TOP of the card, which the scrim does not reach (it fades out
     * by 50% height), so white-on-photo is unreadable on a light photo and any
     * translucent black is at best 3.2:1 against a bright one — under the 4.5:1
     * that 12dp Bold takes (developer.android.com/guide/topics/ui/accessibility/apps).
     * `bg/accentStrong` under `text/onAccent` is the measured pair this app
     * already uses for exactly this job (5.19:1 light, 6.13:1 dark).
     */
    featuredNotify: {
      position: 'absolute',
      top: TOKENS.space.xs,
      right: TOKENS.space.xs,
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.hair,
      paddingHorizontal: TOKENS.space.xs,
      paddingVertical: TOKENS.space['2xs'],
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.accentStrong,
    },
    // Presence dot, top-right of the card: sage with a white ring so it stays
    // legible over any photo. 12dp with an 8dp inset on the 150dp card (was
    // 14 at 16 on the column-wide band): the ring stays 2dp, the fill 8.
    featuredOnline: {
      position: 'absolute',
      top: TOKENS.space.xs,
      right: TOKENS.space.xs,
      width: 12,
      height: 12,
      borderRadius: 6,
      backgroundColor: t.color.state.available,
      borderWidth: 2,
      borderColor: '#FFFFFF',
    },
    /*
     * The hero's meta line, where two language chips used to be. `onMedia` is
     * the tone the chips carried and the reason is unchanged: this text sits
     * over a photo or a gradient, so it needs the white that the scrim above it
     * guarantees rather than a theme ink that flips to dark.
     */
    featuredMeta: {
      ...TOKENS.typography.bodySmall,
      color: '#FFFFFF',
      opacity: 0.85,
      flexShrink: 1,
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
