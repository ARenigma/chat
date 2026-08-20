import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS } from '../theme/tokens';
import type { ConversationSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { useConversations, useProfile } from '../api/chat';
import { useStore } from '../store/useStore';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { TokenCounter } from '../components/TokenCounter';

interface Props {
  onOpenConversation: (peerId: string) => void;
  onBrowse: () => void;
  onOpenSettings: () => void;
}

/** Relative, because "14:32" is useless on a thread from last week. */
function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) {
    return 'now';
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h`;
  }
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

/**
 * Chat history — the screen the app was missing entirely.
 *
 * Until now the only route into a conversation was through the directory, which
 * meant a member with three ongoing threads had no way to see them and no way to
 * tell which had replied. That is the single most conspicuous absence for a
 * product whose value is a continuing relationship rather than a one-off
 * transaction.
 *
 * This is the home screen when any thread exists, and the directory becomes the
 * "start a new conversation" path rather than the entry point.
 */
export function InboxScreen({ onOpenConversation, onBrowse, onOpenSettings }: Props) {
  const insets = useSafeAreaInsets();
  const balance = useStore(s => s.balance);
  const openRefill = useStore(s => s.openRefill);
  useProfile();
  const { data, isPending } = useConversations();

  const renderItem = useCallback(
    ({ item }: { item: ConversationSummary }) => {
      const name = item.peer_display_name ?? 'Conversation';
      const unread = Number(item.unread_count) > 0;
      return (
        <Pressable
          onPress={() => onOpenConversation(item.peer_id)}
          testID={`thread-${item.peer_id}`}
          accessibilityLabel={
            unread
              ? `${name}, ${item.unread_count} unread messages`
              : `${name}, no unread messages`
          }
          style={styles.row}>
          <Avatar initial={initialOf(name)} size={42} online={item.peer_available} />
          <View style={styles.body}>
            <View style={styles.topLine}>
              <Text allowFontScaling numberOfLines={1} style={styles.name}>
                {name}
              </Text>
              <Text allowFontScaling style={styles.time}>
                {ago(item.last_message_at)}
              </Text>
            </View>
            <View style={styles.bottomLine}>
              <Text
                allowFontScaling
                numberOfLines={1}
                style={[styles.preview, unread && styles.previewUnread]}>
                {item.last_body ?? 'No messages yet'}
              </Text>
              {unread ? (
                <View testID="unread-dot" style={styles.unreadDot} />
              ) : null}
            </View>
          </View>
        </Pressable>
      );
    },
    [onOpenConversation],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.meta}>
        <TokenCounter balance={balance} onPress={openRefill} />
        <View style={styles.spacer} />
        <Pressable
          onPress={onBrowse}
          testID="browse-providers"
          accessibilityLabel="Find someone new to talk to"
          style={styles.iconButton}>
          <Icon glyph="plus" size={18} color={TOKENS.color.text.secondary} />
        </Pressable>
        <Pressable
          onPress={onOpenSettings}
          testID="open-settings"
          accessibilityLabel="Account and privacy"
          style={styles.iconButton}>
          <Icon glyph="dots" size={18} color={TOKENS.color.text.secondary} />
        </Pressable>
      </View>

      <View style={styles.head}>
        <Text allowFontScaling style={styles.title}>
          Your conversations
        </Text>
      </View>

      {isPending ? (
        <View style={styles.state}>
          <ActivityIndicator color={TOKENS.color.text.secondary} />
        </View>
      ) : (data ?? []).length === 0 ? (
        <View style={styles.state}>
          <Text allowFontScaling style={styles.stateText}>
            No conversations yet.
          </Text>
          <View style={styles.stateAction}>
            <Button label="Find someone to talk to" onPress={onBrowse} testID="empty-browse" />
          </View>
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={c => c.id}
          renderItem={renderItem}
          contentContainerStyle={[
            styles.list,
            { paddingBottom: insets.bottom + TOKENS.space['2xl'] },
          ]}
          showsVerticalScrollIndicator={false}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: TOKENS.color.bg.base,
  },
  meta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
    paddingHorizontal: TOKENS.space.lg,
    paddingTop: TOKENS.space['2xs'],
    paddingBottom: TOKENS.space.lg,
  },
  spacer: {
    flex: 1,
  },
  iconButton: {
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  head: {
    paddingHorizontal: TOKENS.space.lg,
    paddingBottom: TOKENS.space.lg,
  },
  title: {
    ...TOKENS.typography.titleMedium,
    color: TOKENS.color.text.primary,
  },
  list: {
    paddingHorizontal: TOKENS.space.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.md,
    paddingVertical: TOKENS.space.sm,
  },
  body: {
    flex: 1,
    gap: 3,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
  },
  bottomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
  },
  name: {
    ...TOKENS.typography.bodyLarge,
    fontWeight: '500',
    color: TOKENS.color.text.primary,
    flex: 1,
  },
  time: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
  },
  preview: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.secondary,
    flex: 1,
  },
  previewUnread: {
    color: TOKENS.color.text.primary,
    fontWeight: '500',
  },
  // A dot, not a count. The number matters far less than "there is something",
  // and a badge with a number invites anxiety about the number.
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: TOKENS.color.bg.accent,
  },
  state: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: TOKENS.space.lg,
    paddingHorizontal: TOKENS.space['2xl'],
  },
  stateText: {
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.secondary,
    textAlign: 'center',
  },
  stateAction: {
    alignSelf: 'stretch',
  },
});
