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
import { presenceForSpeech, readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import Animated from 'react-native-reanimated';
import { contentColumnWidth } from '../lib/windowSize';
import { sizedStorageImageUri } from '../lib/storageImage';
import { avatarImageSource } from '../lib/clayAvatars';
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
  toggleFilterExpertise,
  toggleFilterLanguage,
  type DirectoryFilter,
  type ProviderCategory,
} from '../lib/providerFilters';
import { OFFERED_LANGUAGES, sortByLanguageMatch } from '../lib/languagePrefs';
import { useBackGuard } from '../lib/backGuard';
import { useBlockedPeerIds } from '../api/safety';
import { useStore } from '../store/useStore';
import { Avatar } from '../components/Avatar';
import { NAV_BAR_HEIGHT } from '../components/FloatingToolbar';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import {
  PROVIDER_ROW_HEIGHT,
  ProviderRow,
  seededExperienceYears,
} from '../components/ProviderRow';
import { ProviderTypeTabs } from '../components/ProviderTypeTabs';
import { FALLBACK_ECONOMICS, useEconomicsConfig } from '../api/appConfig';
import { OFFERED_EXPERTISE, expertiseFor } from '../lib/expertise';
import { genderLetter } from '../lib/display';
import { displayRating, formatReviewCount } from '../lib/systemRating';
import { DirectorySkeleton } from '../components/DirectorySkeleton';
import { Chip } from '../components/Chip';
import { HeroCarousel } from '../components/HeroCarousel';
import { Badge } from '../components/Badge';
import { Card } from '../components/Card';
import { TabTopBar } from '../components/TabTopBar';
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
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const columnWidth = contentColumnWidth(windowWidth);
  const balance = useStore(s => s.balance);
  // Read rather than called for its side effect: the directory's ORDER now
  // depends on the member's language preference, so this screen needs the row
  // and not just the balance sync it used to be here for.
  const { data: profile } = useProfile();
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
   * What Explore shows: one category at a time. The featured pick and the rows
   * both come from here, so the hero always belongs to the tab you are on.
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

  const directory = useMemo(
    () =>
      sortByLanguageMatch(
        /*
         * `...NO_FILTER` rather than two more empty arrays: Explore filters by
         * the TAB only. Language is a sort here and a filter in search (see
         * DirectoryFilter.languages for why the two differ on purpose), and
         * expertise is not a browse-level question at all.
         */
        filterProviders(allProviders, { ...NO_FILTER, category: exploreCategory }),
        preferredLanguages,
      ),
    [allProviders, exploreCategory, preferredLanguages],
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
      (readPresence(p.is_available).here ? 1000 : 0) + (p.rating_avg ?? 0);
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
      const p =
        directory.find(x => x.id === id) ??
        (featured?.id === id ? featured : undefined);
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
  }, [loading, balance, featured, searching, tourComplete, firstUser]);

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

  /*
   * `onCall` is passed for EVERY row, including a row for somebody who is away,
   * and that is correct rather than an oversight: the row decides. Since
   * 2026-09-13 `ProviderRow` computes `away` from the same `readPresence` and
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
          onCall={onCallProvider}
          ratePerMin={ratePerMin}
          animateEntrance={animate}
        />
      );
    },
    [rows.length, handleOpenProvider, onCallProvider, ratePerMin],
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
          onCall={onCallProvider}
          ratePerMin={ratePerMin}
          animateEntrance={animate}
        />
      );
    },
    [results.length, handleOpenProvider, onCallProvider, ratePerMin],
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
            the first provider row. Widened from `sm` (12) to `2xl` (32) so the
            first card sits lower and the top edge of the SECOND card no longer
            peeks above the fold on the default Home viewport (Amit, on device).
            The exact value is viewport-dependent; confirm on the S22/Redmi and
            nudge if the second card still shows a sliver. */}
        <View style={{ height: TOKENS.space['2xl'] }} />
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
          onChange={setExploreCategory}
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
                  tone={searchFilter.languages.includes(language) ? 'warm' : 'neutral'}
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
                  tone={searchFilter.expertise.includes(topic) ? 'warm' : 'neutral'}
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
                { paddingBottom: insets.bottom + NAV_BAR_HEIGHT + TOKENS.space.xl },
              ]}
              overrideItemLayout={layout => { (layout as { span?: number; size?: number }).size = PROVIDER_ROW_HEIGHT; }}
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
              overrideItemLayout={layout => { (layout as { span?: number; size?: number }).size = PROVIDER_ROW_HEIGHT; }}
            />
          </Animated.View>
        )}
      </View>
      {/* The spotlight sheet needs no away branch and this is the check, not an
          omission: its only action is `onChat` → `chatFromPotd` → the
          conversation, which IS the notify action (`announce_chat_open`,
          migration 068). There is no call on it to withdraw, and `online` is
          the same `readPresence` reading as everywhere else. */}
      <SpotlightCard
        visible={potdVisible && featured !== null}
        name={featured?.display_name ?? 'Someone for you'}
        avatarUri={featured?.avatar_url ?? null}
        online={featured !== null && readPresence(featured.is_available).here}
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
  // A member has no availability switch, so `peer_available` is false for one by
  // construction and passing it through would dot every member's face as away.
  // Null is the honest argument: nothing published, so nothing rendered.
  const presence = readPresence(chat.peer_is_provider ? chat.peer_available : null);
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
  const presence = readPresence(provider.is_available);
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
   * Experience and reviews INLINE (Amit, 2026-09-08: "carousle cards should
   * laos have experience and ratings inline -- place them smartly and space
   * efficiently").
   *
   * One text line REPLACING the two language chips, rather than a third row
   * added under them. The chips cost 32dp of a 210dp card to say two words that
   * fit in a shared line with room to spare; dot-separated text carries four
   * facts in 16dp. That is where the "space efficiently" is — the card did not
   * get taller.
   */
  const heroMeta = [
    `${formatReviewCount(rating.count)} reviews`,
    `${years} ${years === 1 ? 'yr' : 'yrs'}`,
    provider.languages.slice(0, 2).join(', '),
  ]
    .filter(x => x !== '')
    .join('  ·  ');
  /*
   * AWAY, AND WHAT THE CARD OFFERS BECAUSE OF IT.
   *
   * The same `!presence.here` reading the directory row uses
   * (ProviderRow.tsx:431). This hero has never carried a Call, so there is nothing to take
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
  const away = !presence.here;
  /*
   * A tall crop, not a 178dp band: the window into it happens in the layout
   * (`featuredPhoto`), so asking the server for a frame-height image would
   * centre-crop the head off before it arrived. `HERO_PHOTO_HEIGHT_RATIO` is
   * 4/3 scaled to this card's height — see its note for why that is a trim and
   * not that band.
   */
  const heroPhoto = avatarImageSource(
    provider.avatar_url,
    imageWidth,
    Math.round(imageWidth * HERO_PHOTO_HEIGHT_RATIO),
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
    `Featured: ${provider.display_name}`,
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
          <Image source={heroPhoto} style={styles.featuredPhoto} />
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
      <View accessible={false} style={styles.featuredBadge}>
        {/* Number first, star last (Amit: "interchange position" of the two,
            2026-09-08) — the opposite order from ProviderRow/ProviderCard's
            "★ 4.8" chip. Kept local to the hero rather than flipped
            everywhere: only the hero pill was asked to change. */}
        <Text allowFontScaling style={styles.featuredBadgeText}>
          {`${rating.score.toFixed(1)} ★`}
        </Text>
      </View>
      {away ? (
        <View accessible={false} style={styles.featuredNotify}>
          <Icon name="bell" size={TOKENS.icon.xs} color={theme.color.text.onAccent} />
          <Text allowFontScaling style={styles.featuredBadgeText}>
            Notify
          </Text>
        </View>
      ) : (
        <View style={styles.featuredOnline} />
      )}
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
        {/* Reviews, experience and languages on one line, where two language
            chips used to sit. See `heroMeta`. */}
        <Text allowFontScaling numberOfLines={1} style={styles.featuredMeta}>
          {heroMeta}
        </Text>
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

/** How much shorter the hero card is than the 210dp it shipped at. */
const HERO_HEIGHT_REDUCTION = TOKENS.space['2xl'];

/** The hero card's frame height. */
const HERO_HEIGHT = 210 - HERO_HEIGHT_REDUCTION;

/**
 * The photo's height as a multiple of the card's width — 4/3 scaled by the
 * SAME factor the frame shrank by.
 *
 * The magnification a face renders at is `frameHeight / photoHeight`: how much
 * of the photo the window shows. Shrinking the frame to 178dp while the photo
 * stayed pinned at `width * 4/3` cut that fraction from 43% to 36%, so the
 * same face filled more of a smaller box — Amit: "zoom out the photo to be in
 * perfect view in hero cards.. (too zoomed in for smaller carousel)".
 *
 * Scaling the photo's height by `HERO_HEIGHT / 210` restores the fraction the
 * 210dp card was tuned at, which is the zoom that was already right. The
 * shorter crop comes from the server (`sizedStorageImageUri` asks for this
 * height too), and it is a ~15% trim of a stored 3:4 image rather than a
 * short band cut from a tall one — the failure mode the `featuredPhoto` note
 * warns about needs the latter. 087 puts the face 34% down the stored crop; a
 * centred 15% trim moves it to ~31% of the shorter one, still well inside the
 * top 43% this frame shows.
 */
const HERO_PHOTO_HEIGHT_RATIO = (4 / 3) * (HERO_HEIGHT / 210);

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
    // Same height as a populated rail (`RAIL_ITEM_HEIGHT`), the plus centred
    // inside it, rather than its own shorter padding — see the constant's
    // comment for the viewport-shift bug this fixes.
    railEmpty: {
      height: RAIL_ITEM_HEIGHT,
      paddingHorizontal: TOKENS.space.md,
      justifyContent: 'center',
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
      // 'Explore' and its caption 'Top profiles this week' are a title + its
      // supporting line, so they read as ONE unit: a 2dp hairline gap (Amit, on
      // device), so glyph-to-glyph the two lines sit as close as the fonts' own
      // line-box leading allows. Was 12dp, which made them two separate things.
      // https://m3.material.io/foundations/layout/understanding-layout/spacing
      paddingBottom: TOKENS.space.hair,
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
      // 178, not 210: on the Redmi's default (unscrolled) Home, the 210dp hero
      // pushed the FIRST ProviderRow card's last line ("X reviews") underneath
      // the fixed bottom tab bar (Amit: "at least first explore row card should
      // be visible fully without getting cut off -- carousel size down?").
      // Measured on-device with a screenshot at the app's default scroll
      // position: the clipped line needed about 30dp of headroom back, so this
      // gives up one `space['2xl']` (32dp) rather than an unmeasured guess.
      height: HERO_HEIGHT,
      justifyContent: 'flex-end',
      // The photo is taller than this frame and anchored to its top; without
      // the clip it would spill over the card below. See `featuredPhoto`.
      overflow: 'hidden',
    },
    /*
     * The GRADIENT fallback fills the frame exactly — there is nothing in it to
     * crop badly.
     */
    featuredFill: {
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    },
    /*
     * A PHOTO is anchored to the TOP instead, at its natural 3:4, and the frame
     * clips the rest.
     *
     * Supabase's image transform only offers `resize=cover`, which crops from
     * the CENTRE and has no gravity parameter. A 900x1200 portrait squeezed
     * into a 210dp landscape band centre-crops to the middle third — which on
     * the first astrologer build was a suit and a chin, with the head cut off
     * above the frame. The listeners never showed it because their crops happen
     * to put the face near the middle.
     *
     * So the window is cut here rather than asked for: the photo keeps a tall
     * ratio and the parent's overflow does the cutting. The height is
     * `HERO_PHOTO_HEIGHT_RATIO` — 4/3 scaled by how much the frame shrank, so
     * the fraction of the photo this window shows (and therefore the zoom the
     * face renders at) is the one the 210dp card was tuned at, not a tighter
     * one. See that constant for the arithmetic and for where the face lands.
     */
    featuredPhoto: {
      position: 'absolute', top: 0, left: 0, right: 0,
      aspectRatio: 1 / HERO_PHOTO_HEIGHT_RATIO,
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
      top: TOKENS.space.md,
      right: TOKENS.space.md,
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
      paddingTop: TOKENS.space['2xs'],
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
