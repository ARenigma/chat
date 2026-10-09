import React, { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useReducedMotion } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSoftReset } from '../lib/routes/useSoftReset';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ConversationSummary } from '../lib/database.types';
import { firstName, initialOf } from '../lib/display';
import { readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { listStamp } from '../lib/datetime';
import { useConversations } from '../api/chat';
import { useConversationLabels } from '../api/conversationLabels';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { Pressable } from '../components/Pressable';
import { useServerFavorites } from '../store/useFavorites';
import { useBottomBarOffset } from '../shell/useBottomBarOffset';
// The inbox's own avatar size, not a shared directory constant: see the note on
// THREAD_AVATAR in ProviderChatsScreen. Saved is the same inbox, filtered.
import { THREAD_AVATAR } from './ProviderChatsScreen';

/**
 * Provider's "Saved" tab — members they have bookmarked.
 *
 * Shows conversation-summary rows from the shared conversation list filtered to
 * those whose `peer_id` is in the server favorites list. Split out of
 * ProviderHomeScreen in navigation step 6 (it was the inline
 * ProviderFavouritesTab); it reads the same cached queries its host used to
 * hand it, so it can become the SavedTab root without a prop from a sibling.
 *
 * D7 fixes applied:
 *  - top inset: `useSafeAreaInsets().top` so the header clears the status bar.
 *  - bottom padding: `useBottomBarOffset` so the last row clears the bottom bar.
 *  - loading state: `LoadingIndicator` while the conversations query is pending,
 *    so the empty state is never shown while data is in flight.
 *  - empty copy: guides providers to the ⋯ menu in a chat rather than the old
 *    chat-header instruction.
 */
export function ProviderSavedScreen({
  onOpenConversation,
}: {
  onOpenConversation: (peerId: string) => void;
}) {
  const reducedMotion = useReducedMotion();
  const listRef = useRef<FlashListRef<ConversationSummary> | null>(null);
  // Re-tap Saved at its root: back to the top (step 9, nav-migration §6).
  useSoftReset(() => listRef.current?.scrollToOffset({ offset: 0, animated: !reducedMotion }));
  // D7: top inset so the header row does not draw under the status bar, matching
  // ProviderChatsScreen's `{ paddingTop: insets.top + TOKENS.space.xs }` pattern.
  // https://developer.android.com/develop/ui/views/layout/edge-to-edge
  const insets = useSafeAreaInsets();
  // D7: bottom padding clears the absolute bottom bar (useBottomBarOffset), same
  // as ProviderChatsScreen's FlashList contentContainerStyle.
  const barOffset = useBottomBarOffset(TOKENS.space.md);
  const { data: allThreads, isPending } = useConversations();
  const { data: conversationLabels } = useConversationLabels();
  const threads = allThreads ?? [];
  const { data: favorites = [] } = useServerFavorites();
  const savedIds = new Set(favorites.map(f => f.liked_id));
  const saved = threads.filter(t => savedIds.has(t.peer_id) && !t.i_am_member);
  const styles = useStyles(makeStyles);
  const theme = useTheme();

  // D7: loading state — never show the empty state while data is still in flight.
  if (isPending) {
    return (
      <View style={[styles.centre, { paddingTop: insets.top }]} testID="provider-saved-loading">
        <LoadingIndicator size={48} />
      </View>
    );
  }

  if (saved.length === 0) {
    return (
      <View style={[styles.listEmpty, { paddingTop: insets.top }]} testID="provider-favourites-empty">
        <Icon name="heart" size={TOKENS.icon.xl} color={theme.color.text.tertiary} />
        <Text allowFontScaling style={styles.emptyTitle}>No saved members yet</Text>
        {/* D7: guide providers to the ⋯ menu in a chat, not the old header mention. */}
        <Text allowFontScaling style={styles.emptyBody}>
          {'Save a member from the ⋯ menu in your chat with them.'}
        </Text>
      </View>
    );
  }

  return (
    <FlashList
      ref={listRef}
      testID="provider-favourites-list"
      data={saved as ConversationSummary[]}
      keyExtractor={t => t.conversation_id}
      renderItem={({ item }) => {
        const unreadCount = Number(item.unread_count_provider);
        const unread = unreadCount > 0;
        const label =
          conversationLabels?.get(item.conversation_id) ??
          (firstName(item.peer_display_name) || null) ??
          `Member ${item.peer_id.slice(0, 4)}`;
        return (
          <Pressable
            onPress={() => onOpenConversation(item.peer_id)}
            testID={`provider-saved-thread-${item.peer_id}`}
            accessibilityLabel={label}
            press="none"
            highlight="dim"
            style={styles.row}>
            <Avatar
              uri={item.peer_avatar_url ?? undefined}
              initial={initialOf(label)}
              size={THREAD_AVATAR}
              online={
                // The server's `peer_online` (migration 155). The peer here is a
                // member, whose presence is never published, so this is false by
                // construction and the dot stays unlit; a provider peer (a member
                // admitted as a provider keeps their threads) lights as everywhere.
                readPresence({
                  online: item.peer_online,
                  lastSeenAt: item.peer_last_seen_at,
                  now: new Date(),
                }).here
              }
            />
            <View style={styles.rowBody}>
              <View style={styles.rowTop}>
                <Text
                  maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized}
                  allowFontScaling
                  numberOfLines={1}
                  style={styles.rowName}>
                  {label}
                </Text>
                <Text allowFontScaling style={styles.rowTime}>
                  {item.last_session_at ? listStamp(item.last_session_at) : ''}
                </Text>
              </View>
              {unread ? (
                <View testID="saved-waiting-dot" style={styles.unread}>
                  <Text allowFontScaling style={styles.unreadCount}>
                    {unreadCount}
                  </Text>
                </View>
              ) : null}
            </View>
          </Pressable>
        );
      }}
      showsVerticalScrollIndicator={false}
      // D7: top inset as contentContainerStyle so the list header row clears the
      // status bar; bottom padding from useBottomBarOffset for the absolute bar.
      contentContainerStyle={{
        paddingTop: insets.top + TOKENS.space.xs,
        paddingBottom: barOffset,
      }}
      {...SCROLL_PHYSICS}
    />
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    centre: {
      flex: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
    },
    emptyTitle: {
      ...TOKENS.typography.titleMediumEmphasized,
      color: t.color.text.primary,
      textAlign: 'center',
    },
    emptyBody: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
    listEmpty: {
      flex: 1,
      alignItems: 'center' as const,
      justifyContent: 'center' as const,
      gap: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.xl,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingVertical: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.md,
      backgroundColor: t.color.bg.base,
    },
    rowBody: { flex: 1, gap: 3 },
    rowTop: { flexDirection: 'row', alignItems: 'center', gap: TOKENS.space.xs },
    rowName: { ...TOKENS.typography.titleMediumEmphasized, color: t.color.text.primary, flex: 1 },
    rowTime: { ...TOKENS.typography.bodyMedium, color: t.color.text.tertiary },
    unread: {
      minWidth: 20,
      height: 20,
      paddingHorizontal: 5,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: t.color.bg.accentStrong,
    },
    unreadCount: { ...TOKENS.typography.numeralSmall, color: t.color.text.onAccent },
  });
