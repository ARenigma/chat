import React, { useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
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
import { useConversations, useProfile, useProviders } from '../api/chat';
import { useBlockedPeerIds } from '../api/safety';
import { useStore } from '../store/useStore';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { ProviderRow } from '../components/ProviderRow';
import { TokenCounter } from '../components/TokenCounter';

interface Props {
  onOpenConversation: (peerId: string) => void;
  onOpenProvider: (providerId: string) => void;
  onOpenSettings: () => void;
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
export function HomeScreen({ onOpenConversation, onOpenProvider, onOpenSettings }: Props) {
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

  const loading = convosPending || providersPending;

  return (
    <View style={styles.root}>
      {/* Nav Row — wordmark, search, ₹ balance. Not the collapsing LargeTitleBar:
          v13 Home has a fixed nav row, and the large title belongs to the Explore
          section header below it. */}
      <View style={[styles.nav, { paddingTop: insets.top + TOKENS.space['2xs'] }]}>
        <Text allowFontScaling={false} style={styles.wordmark}>
          pappal
        </Text>
        <View style={styles.navTrailing}>
          <Pressable
            onPress={openRefill}
            testID="home-search"
            accessibilityLabel="Search people"
            press="none"
            size={28}
            style={styles.navIcon}>
            <Icon name="search" size={24} color={theme.color.text.secondary} />
          </Pressable>
          <TokenCounter balance={balance} onPress={openRefill} />
        </View>
      </View>

      {loading ? (
        <View style={styles.state}>
          <ActivityIndicator color={theme.color.text.secondary} />
        </View>
      ) : (
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={[
            styles.scroll,
            // Clear the floating toolbar (64) + its bottom offset + safe inset.
            { paddingBottom: insets.bottom + 64 + TOKENS.space.xl },
          ]}>
          {/* CHATS rail */}
          {chats.length > 0 ? (
            <View style={styles.rail}>
              <Text allowFontScaling style={styles.railLabel}>
                CHATS
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.railScroll}>
                {chats.map(chat => (
                  <RailItem key={chat.id} chat={chat} onPress={onOpenConversation} />
                ))}
              </ScrollView>
            </View>
          ) : null}

          {/* Explore head */}
          <View style={styles.exploreHead}>
            <Text allowFontScaling style={styles.exploreTitle}>
              Explore
            </Text>
          </View>

          {featured ? <FeaturedCard provider={featured} onPress={onFeatured} /> : null}

          {rows.length > 0 ? (
            <View style={styles.rows}>
              {rows.map((p, i) => (
                <ProviderRow
                  key={p.id}
                  provider={p}
                  index={i}
                  isLast={i === rows.length - 1}
                  // Row opens the conversation; the avatar opens the profile card.
                  onPress={() => onOpenConversation(p.id)}
                  onPressAvatar={() => onOpenProvider(p.id)}
                />
              ))}
            </View>
          ) : featured === null ? (
            <View style={styles.empty}>
              <Text allowFontScaling style={styles.emptyText}>
                Nobody is available just yet. Check back shortly.
              </Text>
            </View>
          ) : null}

          {chats.length === 0 && directory.length > 0 ? (
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
          ) : null}
        </ScrollView>
      )}
    </View>
  );
}

/**
 * One face in the CHATS rail: 54pt mark, presence, and — when there is unread —
 * a coral ring and a count badge. The ring and badge are the rail's own signals;
 * `Avatar` carries the mark and the presence dot.
 */
function RailItem({
  chat,
  onPress,
}: {
  chat: ConversationSummary;
  onPress: (peerId: string) => void;
}) {
  const styles = useStyles(makeStyles);
  const name = chat.peer_display_name ?? 'Conversation';
  const unread = Number(chat.unread_count) > 0;
  const presence = readPresence(chat.peer_presence, chat.peer_last_active_at);
  return (
    <Pressable
      onPress={() => onPress(chat.peer_id)}
      testID={`rail-${chat.peer_id}`}
      accessibilityLabel={
        unread ? `${name}, ${chat.unread_count} unread` : name
      }
      press="none"
      style={styles.railItem}>
      <View style={[styles.railRing, unread && styles.railRingUnread]}>
        <Avatar initial={initialOf(name)} size={48} online={presence.here} />
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
}

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
  const presence = readPresence(provider.presence, provider.last_active_at);
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
      <View
        style={[
          styles.featuredFill,
          { experimental_backgroundImage: gradient },
        ]}
      />
      <Text allowFontScaling={false} style={styles.featuredWatermark}>
        {initialOf(provider.display_name)}
      </Text>
      <View style={styles.featuredBadge}>
        <Text allowFontScaling style={styles.featuredBadgeText}>
          Top rated
        </Text>
      </View>
      <View style={styles.featuredBody}>
        <View style={styles.featuredNameRow}>
          <Text allowFontScaling numberOfLines={1} style={styles.featuredName}>
            {provider.display_name}
            <Text style={styles.featuredAge}>{age}</Text>
          </Text>
        </View>
        <View style={styles.featuredMeta}>
          {presence.here ? (
            <>
              <View style={styles.featuredDot} />
              <Text allowFontScaling style={styles.featuredMetaText}>
                Available
              </Text>
              <Text allowFontScaling style={styles.featuredMetaDim}>
                {'  ·  '}
              </Text>
            </>
          ) : null}
          {provider.rating_count > 0 ? (
            <Text allowFontScaling style={styles.featuredMetaText}>
              ★ {provider.rating_avg?.toFixed(1)}
            </Text>
          ) : (
            <Text allowFontScaling style={styles.featuredMetaText}>
              New here
            </Text>
          )}
        </View>
        {tagline !== '' ? (
          <Text allowFontScaling numberOfLines={1} style={styles.featuredTagline}>
            {tagline}
          </Text>
        ) : null}
      </View>
    </Pressable>
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
    railLabel: {
      ...TOKENS.typography.labelSmall,
      color: t.color.text.secondary,
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    railScroll: {
      paddingHorizontal: TOKENS.space.md,
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
      paddingHorizontal: 5,
      borderRadius: 10,
      backgroundColor: t.color.bg.accent,
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
      flexShrink: 1,
    },
    featuredAge: {
      ...TOKENS.typography.headline,
      color: 'rgba(255,255,255,0.82)',
    },
    featuredMeta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
    },
    featuredDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: '#FFFFFF',
    },
    featuredMetaText: {
      ...TOKENS.typography.labelSmall,
      color: '#FFFFFF',
    },
    featuredMetaDim: {
      ...TOKENS.typography.labelSmall,
      color: 'rgba(255,255,255,0.6)',
    },
    featuredTagline: {
      ...TOKENS.typography.subhead,
      color: 'rgba(255,255,255,0.92)',
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
