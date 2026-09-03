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
import { contentColumnWidth } from '../lib/windowSize';
import { sizedStorageImageUri } from '../lib/storageImage';
import { storage } from '../lib/storage';
import { useConversations, useProfile, useProviders } from '../api/chat';
import { useBlockedPeerIds } from '../api/safety';
import { useStore } from '../store/useStore';
import { Avatar } from '../components/Avatar';
import { NAV_BAR_HEIGHT } from '../components/FloatingToolbar';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { ProviderRow } from '../components/ProviderRow';
import { DirectorySkeleton } from '../components/DirectorySkeleton';
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

const POTD_DISMISSED_KEY = 'companion.potd.dismissed';

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

  const chats = useMemo(
    () =>
      (conversations ?? [])
        .filter(c => !blocked.has(c.peer_id) && visibleOnRail(railPrefs, c.peer_id))
        .slice()
        .sort((a, b) =>
          compareConversations(
            railPrefs,
            { peerId: a.peer_id, at: a.last_session_at ?? '' },
            { peerId: b.peer_id, at: b.last_session_at ?? '' },
          ),
        ),
    [conversations, blocked, railPrefs],
  );

  // The directory, blocked people removed. The featured pick is lifted out of the
  // list so it is not shown twice.
  const directory = useMemo(
    () => (providers ?? []).filter(p => !blocked.has(p.id)),
    [providers, blocked],
  );

  /**
   * The algo pick: the best-rated person who is here now, else the best-rated at
   * all, else the first. Deterministic, so the hero does not reshuffle on every
   * render — a featured card that changes under the eye reads as broken.
   */
  const featured = useMemo<ProviderSummary | null>(() => {
    if (directory.length === 0) {
      return null;
    }
    const score = (p: ProviderSummary) =>
      (readPresence(p.presence, p.last_active_at).here ? 1000 : 0) + (p.rating_avg ?? 0);
    return [...directory].sort((a, b) => score(b) - score(a))[0] ?? null;
  }, [directory]);

  const rows = useMemo(
    () => directory.filter(p => p.id !== featured?.id),
    [directory, featured],
  );

  const onFeatured = useCallback(() => {
    if (featured) {
      onOpenProvider(featured.id);
    }
  }, [featured, onOpenProvider]);

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
  const results = useMemo(() => {
    if (trimmed === '') {
      return [];
    }
    return directory.filter(
      p =>
        p.display_name.toLowerCase().includes(trimmed) ||
        p.languages.some(l => l.toLowerCase().includes(trimmed)),
    );
  }, [directory, trimmed]);

  const closeSearch = useCallback(() => {
    setSearching(false);
    setQuery('');
  }, []);

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
            <Text allowFontScaling style={styles.railLabel}>
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
                <Icon name="chevronRight" size={14} color={theme.color.text.secondary} />
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
          <Text allowFontScaling style={styles.exploreTitle}>
            Explore
          </Text>
        </View>
        </TourAnchor>
        {featured ? (
          <Card style={styles.featuredCard}>
            <FeaturedCard
              provider={featured}
              imageWidth={columnWidth - TOKENS.space.md * 2}
              onPress={onFeatured}
            />
          </Card>
        ) : null}
        {/* Spacing that separates the featured card (or explore heading) from
            the first provider row — matches the original styles.rows paddingTop. */}
        <View style={{ height: TOKENS.space.sm }} />
      </>
    ),
    [
      chats,
      styles,
      featured,
      columnWidth,
      onFeatured,
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
  const searchListHeader =
    trimmed === '' ? (
      <View style={styles.empty}>
        <Text allowFontScaling style={styles.emptyText}>
          Search for someone by name or language.
        </Text>
      </View>
    ) : null;

  const noMatchLabel = `No one matches ${JSON.stringify(query.trim())}.`;
  const searchListEmpty =
    trimmed !== '' ? (
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
      <View style={[styles.nav, { paddingTop: insets.top + TOKENS.space['2xs'] }]}>
        {searching ? (
          <>
            <SearchBar
              testID="home-search-input"
              value={query}
              onChangeText={setQuery}
              placeholder="Search by name or language"
              onClear={() => { setQuery(''); }}
            />
            <Pressable
              onPress={closeSearch}
              testID="home-search-close"
              accessibilityLabel="Close search"
              press="none"
              size={28}
              style={styles.navIcon}>
              <Icon name="close" size={20} color={theme.color.text.secondary} />
            </Pressable>
          </>
        ) : (
          <>
            <Text allowFontScaling={false} style={styles.wordmark}>
              Pappal
            </Text>
            <View style={styles.navTrailing}>
              <Pressable
                onPress={() => setSearching(true)}
                testID="home-search"
                accessibilityLabel="Search people"
                press="none"
                size={28}
                style={styles.navIcon}>
                <Icon name="search" size={24} color={theme.color.text.secondary} />
              </Pressable>
              <TourAnchor id="wallet">
                <TokenCounter balance={balance} onPress={openWallet} />
              </TourAnchor>
            </View>
          </>
        )}
      </View>

      {searching ? (
        <FlashList
          data={trimmed === '' ? [] : results}
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
      ) : loading ? (
        <DirectorySkeleton />
      ) : (
        // Only the provider rows are virtualised. The chats rail, explore head
        // and featured card live in ListHeaderComponent so they scroll together
        // with the list but are always fully rendered.
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
            // Clear its full height (bar + safe-area inset) plus the usual end
            // breathing room, so the last row lands above the bar rather than
            // behind it.
            { paddingBottom: insets.bottom + NAV_BAR_HEIGHT + TOKENS.space.xl },
          ]}
          overrideItemLayout={layout => { (layout as { span?: number; size?: number }).size = 97; }}
        />
      )}
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
  return (
    <Pressable
      onPress={onPress}
      testID={`featured-${provider.id}`}
      accessibilityLabel={`Featured: ${provider.display_name}. ${tagline}`}
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
      <View style={styles.featuredBadge}>
        <Text allowFontScaling style={styles.featuredBadgeText}>
          {provider.rating_count > 0
            ? `★ ${provider.rating_avg?.toFixed(1)} · Top rated`
            : 'Top rated'}
        </Text>
      </View>
      {presence.here ? <View style={styles.featuredOnline} /> : null}
      <View style={styles.featuredBody}>
        <View style={styles.featuredNameRow}>
          <Text allowFontScaling numberOfLines={1} style={styles.featuredName}>
            {provider.display_name}
            <Text style={styles.featuredAge}>{age}</Text>
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
      fontFamily: TOKENS.typography.wordmarkLarge.fontFamily,
      fontSize: 28,
      lineHeight: 34,
      color: t.color.bg.accent,
    },
    navTrailing: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    navIcon: {
      width: 28,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // SearchBar takes the full nav row while searching; no custom field needed.
    scroll: {
      paddingTop: TOKENS.space['2xs'],
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
      fontFamily: TOKENS.typography.labelLarge.fontFamily,
      fontSize: 160,
      lineHeight: 190,
      color: 'rgba(255,255,255,0.16)',
    },
    // The status pill: solid accent, matching the v13 frame's "Top rated" badge.
    // A translucent black chip read as chrome; the frame makes this the one
    // branded mark on the card.
    featuredBadge: {
      position: 'absolute',
      top: TOKENS.space.md,
      left: TOKENS.space.md,
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: TOKENS.space['2xs'],
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.accent,
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
