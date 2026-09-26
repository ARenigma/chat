import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { ConversationSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { listStamp } from '../lib/datetime';
import { useConversations } from '../api/chat';
import { useConversationLabels } from '../api/conversationLabels';
import { Avatar } from '../components/Avatar';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { useServerFavorites } from '../store/useFavorites';
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
 * hand it, so it can become the SavedTab root without a prop from a sibling. An empty state guides the provider
 * to favourite a member from a chat header.
 */
export function ProviderSavedScreen({
  onOpenConversation,
}: {
  onOpenConversation: (peerId: string) => void;
}) {
  const { data: allThreads } = useConversations();
  const { data: conversationLabels } = useConversationLabels();
  const threads = allThreads ?? [];
  const { data: favorites = [] } = useServerFavorites();
  const savedIds = new Set(favorites.map(f => f.liked_id));
  const saved = threads.filter(t => savedIds.has(t.peer_id) && !t.i_am_member);
  const styles = useStyles(makeStyles);
  const theme = useTheme();

  if (saved.length === 0) {
    return (
      <View style={styles.listEmpty} testID="provider-favourites-empty">
        <Icon name="heart" size={TOKENS.icon.xl} color={theme.color.text.tertiary} />
        <Text allowFontScaling style={styles.emptyTitle}>No saved members yet</Text>
        <Text allowFontScaling style={styles.emptyBody}>
          {'Open a chat and use the ··· menu to save a member here.'}
        </Text>
      </View>
    );
  }

  return (
    <FlashList
      testID="provider-favourites-list"
      data={saved as ConversationSummary[]}
      keyExtractor={t => t.conversation_id}
      renderItem={({ item }) => {
        const unreadCount = Number(item.unread_count_provider);
        const unread = unreadCount > 0;
        const label =
          conversationLabels?.get(item.conversation_id) ??
          item.peer_display_name ??
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
      {...SCROLL_PHYSICS}
    />
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
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
