import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FlashList } from '@shopify/flash-list';
import {
  ActivityIndicator,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ConversationSummary, ProviderSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useConversations, prefetchMessages, useProfile, useProviders } from '../api/chat';
import { useBlockedPeerIds } from '../api/safety';
import { useStore } from '../store/useStore';
import { Avatar } from '../components/Avatar';
import { NAV_BAR_HEIGHT } from '../components/FloatingToolbar';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { ProviderRow } from '../components/ProviderRow';
import { TextField } from '../components/TextField';
import { TokenCounter } from '../components/TokenCounter';

interface Props {
  onOpenConversation: (peerId: string) => void;
  onOpenProvider: (providerId: string) => void;
  onOpenSettings: () => void;
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
  onOpenSettings,
  onSeeAllChats,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const balance = useStore(s => s.balance);
  const openRefill = useStore(s => s.openRefill);
  useProfile();
  const { data: conversations, isPending: convosPending } = useConversations();
  const { data: providers, isPending: providersPending } = useProviders();
  const blocked = useBlockedPeerIds();

  const chats = useMemo(
    () => (conversations ?? []).filter(c => !blocked.has(c.peer_id)),
    [conversations, blocked],
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
  const handleOpenProvider = useCallback(
    (id: string) => onOpenProvider(id),
    [onOpenProvider],
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
        {chats.length > 0 ? (
          <View style={styles.rail}>
            <View style={styles.railHeader}>
              <Text allowFontScaling style={styles.railLabel}>
                Chats
              </Text>
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
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              {...SCROLL_PHYSICS}
              contentContainerStyle={styles.railScroll}>
              {chats.map(chat => (
                <RailItem key={chat.id} chat={chat} onPress={handleOpenConversation} />
              ))}
            </ScrollView>
          </View>
        ) : null}
        <View style={styles.exploreHead}>
          <Text allowFontScaling style={styles.exploreTitle}>
            Explore
          </Text>
        </View>
        {featured ? <FeaturedCard provider={featured} onPress={onFeatured} /> : null}
        {/* Spacing that separates the featured card (or explore heading) from
            the first provider row — matches the original styles.rows paddingTop. */}
        <View style={{ height: TOKENS.space.sm }} />
      </>
    ),
    [chats, styles, featured, onFeatured, handleOpenConversation, onSeeAllChats, theme],
  );

  // ListFooterComponent for the main Explore FlashList: the "tap someone above"
  // hint that shows only on a fresh install before any conversation exists.
  const ExploreFooter = useCallback(
    () =>
      chats.length === 0 && directory.length > 0 ? (
        <Pressable
          onPress={onOpenSettings}
          testID="home-settings-hint"
          accessibilityLabel="Account and privacy"
          press="none"
          style={styles.settingsHint}>
          <Text allowFontScaling style={styles.emptyText}>
            Tap someone above to start a conversation.
          </Text>
        </Pressable>
      ) : null,
    [chats.length, directory.length, onOpenSettings, styles],
  );

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
    <View style={styles.root}>
      {/* Nav Row — wordmark, search, ₹ balance. Not the collapsing LargeTitleBar:
          v13 Home has a fixed nav row, and the large title belongs to the Explore
          section header below it. */}
      <View style={[styles.nav, { paddingTop: insets.top + TOKENS.space['2xs'] }]}>
        {searching ? (
          <>
            <View style={styles.searchField}>
              <Icon name="search" size={18} color={theme.color.text.tertiary} />
              <TextField
                testID="home-search-input"
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search by name or language"
                placeholderTextColor={theme.color.text.tertiary}
                autoFocus
                returnKeyType="search"
                allowFontScaling
                accessibilityLabel="Search people"
                underlineColorAndroid="transparent"
              />
            </View>
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
              <TokenCounter balance={balance} onPress={openRefill} />
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
        <View style={styles.state}>
          <ActivityIndicator color={theme.color.text.secondary} />
        </View>
      ) : (
        // Only the provider rows are virtualised. The chats rail, explore head
        // and featured card live in ListHeaderComponent so they scroll together
        // with the list but are always fully rendered.
        <FlashList
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
}: {
  chat: ConversationSummary;
  onPress: (peerId: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const qc = useQueryClient();
  const name = chat.peer_display_name ?? 'Conversation';
  const unread = Number(chat.unread_count) > 0;
  const presence = readPresence(chat.peer_presence, chat.peer_last_active_at);
  const handlePress = useCallback(() => onPress(chat.peer_id), [onPress, chat.peer_id]);
  const handlePressIn = useCallback(() => prefetchMessages(qc, chat.id), [qc, chat.id]);
  return (
    <Pressable
      onPress={handlePress}
      onPressIn={handlePressIn}
      testID={`rail-${chat.peer_id}`}
      accessibilityLabel={
        unread ? `${name}, ${chat.unread_count} unread` : name
      }
      press="none"
      style={styles.railItem}>
      <View style={[styles.railRing, unread && styles.railRingUnread]}>
        <Avatar
          initial={initialOf(name)}
          uri={chat.peer_avatar_url}
          size={48}
          online={presence.here}
        />
      </View>
      {unread ? (
        <View style={styles.railBadge}>
          <Text allowFontScaling={false} style={styles.railBadgeText}>
            {Number(chat.unread_count) > 9 ? '9+' : String(chat.unread_count)}
          </Text>
        </View>
      ) : null}
      <Text allowFontScaling numberOfLines={1} style={styles.railName}>
        {name}
      </Text>
    </Pressable>
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
  onPress,
}: {
  provider: ProviderSummary;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  // The gradient is built from the accent tokens rather than raw hex, so the
  // featured hero stays inside the accent budget and follows a theme change.
  const gradient = `linear-gradient(140deg, ${theme.color.bg.accent} 0%, ${theme.color.bg.accentStrong} 100%)`;
  const age = provider.age !== null ? ` ${provider.age}` : '';
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
          <Image source={{ uri: provider.avatar_url }} style={styles.featuredFill} />
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
      {/* Presence is a shape, not a word, and it lives top-right of the card
          (Amit's call): a green dot balancing the "Top rated" badge top-left. A
          white ring keeps it legible over any photo. */}
      <View style={styles.featuredOnline} />
      <View style={styles.featuredBody}>
        {/* The rating lives in the "Top rated" chip now (#4), so the name line is
            just the name and age. */}
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
        {/* Cute badges — age + languages — the Sweprek "Best Matches" chip idiom,
            glassy over the photo. Age and languages are what we hold; richer
            interest/category tags come when the schema carries them. */}
        <View style={styles.featuredBadges}>
          {provider.age !== null ? <Badge label={`${provider.age}`} /> : null}
          {provider.languages.slice(0, 2).map(lang => (
            <Badge key={lang} label={lang} />
          ))}
        </View>
      </View>
    </Pressable>
  );
}

/** A small glassy pill for a fact on a photo card (age, language, category). */
function Badge({ label }: { label: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.badge}>
      <Text allowFontScaling style={styles.badgeText}>
        {label}
      </Text>
    </View>
  );
}

const RAIL_AVATAR = 48;

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    nav: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    // The one place LilitaOne appears outside a logo file. Lowercase coral, per
    // v13. `numeralMedium` is unrelated — the wordmark carries its own size.
    wordmark: {
      fontFamily: TOKENS.typography.wordmark.fontFamily,
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
    // The search field that takes the nav row's place while searching: a capsule
    // on the page colour with a leading glyph, the same anatomy as the composer.
    searchField: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      height: 40,
      paddingHorizontal: TOKENS.space.md,
      marginRight: TOKENS.space.xs,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      backgroundColor: t.color.bg.sunken,
    },
    searchInput: {
      flex: 1,
      padding: 0,
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.primary,
    },
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
    // Chats is a peer section heading to Explore, not a quiet caption (#14,
    // Amit: "bold, looks too shallow in front of Explore"). Same display weight
    // and primary ink so the two read as equals.
    railLabel: {
      ...TOKENS.typography.displaySmall,
      color: t.color.text.primary,
    },
    seeAll: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    seeAllText: {
      ...TOKENS.typography.labelSmall,
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
      width: 64,
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
    },
    railRingUnread: {
      borderColor: t.color.bg.accent,
    },
    railBadge: {
      position: 'absolute',
      top: -2,
      right: 6,
      minWidth: 20,
      height: 20,
      paddingHorizontal: TOKENS.space['2xs'],
      borderRadius: TOKENS.radius.pill,
      // accentStrong, matching the provider tree's unread badge (ThreadBubble /
      // ProviderHome): the deeper coral step carries white at 5.2:1, and the two
      // trees should not show the same "unread" concept in two different corals.
      backgroundColor: t.color.bg.accentStrong,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 2,
      borderColor: t.color.bg.base,
    },
    railBadgeText: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.onAccent,
      fontFamily: TOKENS.typography.numeralSmall.fontFamily,
    },
    railName: {
      ...TOKENS.typography.captionSmall,
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
      ...TOKENS.typography.displaySmall,
      color: t.color.text.primary,
    },
    featured: {
      height: 210,
      marginHorizontal: TOKENS.space.md,
      borderRadius: TOKENS.radius.lg,
      borderCurve: 'continuous',
      overflow: 'hidden',
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
      fontFamily: TOKENS.typography.displayLarge.fontFamily,
      fontSize: 160,
      lineHeight: 190,
      color: 'rgba(255,255,255,0.16)',
    },
    featuredBadge: {
      position: 'absolute',
      top: TOKENS.space.md,
      left: TOKENS.space.md,
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: 4,
      borderRadius: TOKENS.radius.xs,
      backgroundColor: 'rgba(0,0,0,0.28)',
    },
    featuredBadgeText: {
      ...TOKENS.typography.labelSmall,
      color: '#FFFFFF',
    },
    featuredBody: {
      padding: TOKENS.space.md,
      gap: 4,
    },
    featuredNameRow: {
      flexDirection: 'row',
      alignItems: 'baseline',
    },
    featuredName: {
      ...TOKENS.typography.displaySmall,
      color: '#FFFFFF',
      flex: 1,
    },
    featuredAge: {
      ...TOKENS.typography.headline,
      color: 'rgba(255,255,255,0.82)',
    },
    // The rating on the name line, trailing. marginLeft (not a row `gap`) so the
    // Explore-list separator guard, which forbids `gap: space.sm` in this file,
    // still holds — the rating sits on the hero, not in that list.
    featuredRating: {
      ...TOKENS.typography.subhead,
      color: '#FFFFFF',
      marginLeft: TOKENS.space.sm,
    },
    // The presence dot, top-right of the card: sage (the system's one presence
    // hue) with a white ring so it stays legible over any photo.
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
    featuredMetaText: {
      ...TOKENS.typography.labelSmall,
      color: '#FFFFFF',
    },
    featuredTagline: {
      ...TOKENS.typography.subhead,
      color: 'rgba(255,255,255,0.92)',
    },
    featuredBadges: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: TOKENS.space['2xs'],
      paddingTop: TOKENS.space.xs,
    },
    badge: {
      paddingHorizontal: TOKENS.space.sm,
      paddingVertical: 3,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: 'rgba(255,255,255,0.22)',
    },
    badgeText: {
      ...TOKENS.typography.captionSmall,
      color: '#FFFFFF',
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
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
    settingsHint: {
      paddingVertical: TOKENS.space.lg,
      paddingHorizontal: TOKENS.space['2xl'],
    },
  });
