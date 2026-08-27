import React, { useCallback, useMemo } from 'react';
import { FlashList } from '@shopify/flash-list';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { initialOf } from '../lib/display';
import { timeOfDay } from '../lib/datetime';
import { readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useConversations, useProfile } from '../api/chat';
import { useBlockedPeerIds } from '../api/safety';
import { Avatar } from '../components/Avatar';
import { BackButton } from '../components/BackButton';
import { Pressable } from '../components/Pressable';

interface Props {
  onBack: () => void;
  onOpenConversation: (peerId: string) => void;
}

/**
 * The full Chats list — the "See all" destination behind the Home rail (#12).
 *
 * Home keeps the horizontal rail for the few people you talk to most; this is the
 * whole list, newest first, the way a messaging inbox reads. Same conversation
 * data as Home, so nothing new is fetched.
 */
export function ChatsListScreen({ onBack, onOpenConversation }: Props) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  useProfile();
  const { data: conversations } = useConversations();
  const blocked = useBlockedPeerIds();

  const rows = useMemo(
    () =>
      (conversations ?? [])
        .filter(c => !blocked.has(c.peer_id))
        .slice()
        .sort((a, b) => b.last_message_at.localeCompare(a.last_message_at)),
    [conversations, blocked],
  );

  const renderRow = useCallback(
    ({ item: c, index: i }: { item: (typeof rows)[number]; index: number }) => {
      const name = c.peer_display_name ?? 'Conversation';
      const unread = Number(c.unread_count) > 0;
      const presence = readPresence(c.peer_presence, c.peer_last_active_at);
      return (
        <Pressable
          onPress={() => onOpenConversation(c.peer_id)}
          testID={`chatlist-${c.peer_id}`}
          accessibilityLabel={unread ? `${name}, ${c.unread_count} unread` : name}
          press="none"
          highlight="ios"
          style={[styles.row, i === rows.length - 1 && styles.rowLast]}>
          <Avatar
            initial={initialOf(c.peer_display_name)}
            uri={c.peer_avatar_url}
            size={48}
            online={presence.here}
          />
          <View style={styles.rowBody}>
            <Text allowFontScaling numberOfLines={1} style={styles.rowName}>
              {name}
            </Text>
            <Text
              allowFontScaling
              numberOfLines={1}
              style={[styles.rowPreview, unread && styles.rowPreviewUnread]}>
              {c.last_body ?? 'Media'}
            </Text>
          </View>
          <View style={styles.rowTrailing}>
            <Text allowFontScaling style={styles.rowTime}>
              {timeOfDay(c.last_message_at)}
            </Text>
            {unread ? (
              <View style={styles.badge}>
                <Text allowFontScaling style={styles.badgeText}>
                  {c.unread_count}
                </Text>
              </View>
            ) : null}
          </View>
        </Pressable>
      );
    },
    [rows, styles, onOpenConversation],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.bar}>
        <BackButton onPress={onBack} testID="chatslist-back" style={styles.barIcon} />
        <Text allowFontScaling style={styles.barTitle}>
          Chats
        </Text>
      </View>
      {rows.length > 0 ? (
        <FlashList
          data={rows}
          keyExtractor={c => c.id}
          showsVerticalScrollIndicator={false}
          {...SCROLL_PHYSICS}
          contentContainerStyle={{ paddingBottom: insets.bottom + TOKENS.space.xl }}
          renderItem={renderRow}
        />
      ) : (
        <View style={styles.empty}>
          <Text allowFontScaling style={styles.emptyText}>
            No chats yet. Say hi to someone from Home.
          </Text>
        </View>
      )}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.color.bg.base },
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    barIcon: { marginLeft: -TOKENS.space['2xs'] },
    barTitle: {
      ...TOKENS.typography.headline,
      color: t.color.text.primary,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.md,
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: t.color.border.hairline,
    },
    rowLast: { borderBottomWidth: 0 },
    rowBody: { flex: 1, gap: 2 },
    rowName: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    rowPreview: {
      ...TOKENS.typography.subhead,
      color: t.color.text.secondary,
    },
    rowPreviewUnread: {
      color: t.color.text.primary,
    },
    rowTrailing: {
      alignItems: 'flex-end',
      gap: TOKENS.space['2xs'],
    },
    rowTime: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.tertiary,
    },
    badge: {
      minWidth: 20,
      height: 20,
      paddingHorizontal: TOKENS.space['2xs'],
      borderRadius: TOKENS.radius.pill,
      backgroundColor: t.color.bg.accentStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeText: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.onAccent,
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space['2xl'],
    },
    emptyText: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
  });
