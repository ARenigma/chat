import React, { useCallback } from 'react';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated from 'react-native-reanimated';
import { TOKENS } from '../theme/tokens';
import type { ConversationSummary, ProviderSummary } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { enterBlock, enterRail, enterRow } from '../theme/motion';
import { useConversations, useProfile, useProviders } from '../api/chat';
import { useStore } from '../store/useStore';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { TokenCounter } from '../components/TokenCounter';

const CARD_MORPH = { from: TOKENS.radius.lg, to: TOKENS.radius.pressCard };

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
 * Chat history, and the home screen whenever any thread exists.
 *
 * Three structures here are lifted from the references, and each earns its place
 * by carrying information the previous version made the member go and find:
 *
 *   1. **A counting headline.** The largest type on the page now says how many
 *      people are free, which is the one thing worth knowing before opening it.
 *      A fixed slogan in that slot spends the most valuable space on the screen
 *      telling you what app you already opened.
 *   2. **The "here now" rail.** Every reference opens with a horizontal row of
 *      faces. Theirs are stories; ours are the providers who are actually
 *      available this second, which turns decoration into a shortcut. The `+`
 *      leads to the full directory, exactly where the "add" affordance led in the
 *      designs this came from.
 *   3. **Threads in one white card.** Cards on warm paper separate content
 *      without drawing a single line, and the whole list reads as one object
 *      rather than a stack of rows.
 *
 * `ScrollView` for the rail rather than a nested FlatList: it holds at most a
 * handful of avatars, and a virtualised list inside a virtualised list is a
 * warning in the console and a scroll-jank bug in practice.
 */
export function InboxScreen({ onOpenConversation, onBrowse, onOpenSettings }: Props) {
  const insets = useSafeAreaInsets();
  const balance = useStore(s => s.balance);
  const openRefill = useStore(s => s.openRefill);
  useProfile();
  const { data, isPending } = useConversations();
  const { data: providers } = useProviders();

  const free = (providers ?? []).filter(p => p.is_available);
  const threads = data ?? [];
  const unreadTotal = threads.reduce((n, t) => n + Number(t.unread_count), 0);

  const renderItem = useCallback(
    ({ item, index }: { item: ConversationSummary; index: number }) => {
      const name = item.peer_display_name ?? 'Conversation';
      const unread = Number(item.unread_count) > 0;
      return (
        <Animated.View entering={enterRow(index)}>
          <Pressable
            onPress={() => onOpenConversation(item.peer_id)}
            testID={`thread-${item.peer_id}`}
            accessibilityLabel={
              unread
                ? `${name}, ${item.unread_count} unread messages`
                : `${name}, no unread messages`
            }
            press="card"
            morph={CARD_MORPH}
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
                  <View testID="unread-dot" style={styles.unread}>
                    <Text allowFontScaling style={styles.unreadCount}>
                      {item.unread_count}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>
          </Pressable>
        </Animated.View>
      );
    },
    [onOpenConversation],
  );

  const header = useCallback(
    () => (
      <View>
        <Animated.View entering={enterBlock(0)} style={styles.head}>
          <Text testID="inbox-hero" allowFontScaling style={styles.title}>
            {free.length > 0
              ? `${free.length} ${free.length === 1 ? 'person' : 'people'}\nfree now.`
              : 'Your\npeople.'}
          </Text>
        </Animated.View>

        {free.length > 0 ? (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.rail}>
            <Animated.View entering={enterRail(0)}>
              <Pressable
                onPress={onBrowse}
                testID="rail-browse"
                accessibilityLabel="See everyone who is available"
                press="card"
                style={styles.railItem}>
                <View style={styles.add}>
                  <Icon glyph="plus" size={16} color={TOKENS.color.text.tertiary} />
                </View>
                <Text allowFontScaling numberOfLines={1} style={styles.railLabel}>
                  All
                </Text>
              </Pressable>
            </Animated.View>
            {free.slice(0, 8).map((p: ProviderSummary, i) => (
              <Animated.View key={p.id} entering={enterRail(i + 1)}>
                <Pressable
                  onPress={() => onOpenConversation(p.id)}
                  testID={`rail-${p.id}`}
                  accessibilityLabel={`Message ${p.display_name}, available now`}
                  press="card"
                  style={styles.railItem}>
                  <Avatar initial={initialOf(p.display_name)} size={42} online />
                  <Text allowFontScaling numberOfLines={1} style={styles.railLabel}>
                    {p.display_name}
                  </Text>
                </Pressable>
              </Animated.View>
            ))}
          </ScrollView>
        ) : null}

        {threads.length > 0 ? (
          <Text allowFontScaling style={styles.section}>
            {unreadTotal > 0 ? `Waiting for you · ${unreadTotal}` : 'Your conversations'}
          </Text>
        ) : null}
      </View>
    ),
    [free, onBrowse, onOpenConversation, threads.length, unreadTotal],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.meta}>
        <TokenCounter balance={balance} onPress={openRefill} />
        <View style={styles.spacer} />
        <Pressable
          onPress={onOpenSettings}
          testID="open-settings"
          accessibilityLabel="Account and privacy"
          press="chip"
          style={styles.iconButton}>
          <Icon glyph="dots" size={18} color={TOKENS.color.text.secondary} />
        </Pressable>
      </View>

      {isPending ? (
        <View style={styles.state}>
          <ActivityIndicator color={TOKENS.color.text.secondary} />
        </View>
      ) : threads.length === 0 ? (
        <View style={styles.state}>
          <Avatar initial="·" size={56} tone="warm" breathing />
          <Text allowFontScaling style={styles.stateText}>
            No conversations yet.
          </Text>
          <View style={styles.stateAction}>
            <Button label="Find someone to talk to" onPress={onBrowse} testID="empty-browse" />
          </View>
        </View>
      ) : (
        <>
          <FlatList
            data={threads}
            keyExtractor={c => c.id}
            renderItem={renderItem}
            ListHeaderComponent={header}
            // One card behind the rows, not a card per row: a list of threads is
            // one object, and per-row cards turn a conversation history into a
            // settings screen.
            contentContainerStyle={[
              styles.list,
              { paddingBottom: insets.bottom + TOKENS.space['3xl'] * 2 },
            ]}
            showsVerticalScrollIndicator={false}
          />
          {/* Floating rather than in a bar. There are two destinations in this
              app, which is one too few for a tab bar and exactly right for a
              single pill that says what it does. */}
          <View style={[styles.fabWrap, { bottom: insets.bottom + TOKENS.space.lg }]}>
            <Pressable
              onPress={onBrowse}
              testID="browse-providers"
              accessibilityLabel="Find someone new to talk to"
              press="button"
              morph={{ from: TOKENS.radius.pill, to: TOKENS.radius.xl }}
              style={styles.fab}>
              <Text allowFontScaling style={styles.fabLabel}>
                Find someone
              </Text>
            </Pressable>
          </View>
        </>
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
    paddingBottom: TOKENS.space.sm,
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
    paddingBottom: TOKENS.space.lg,
  },
  title: {
    ...TOKENS.typography.displaySmall,
    color: TOKENS.color.text.primary,
  },
  rail: {
    gap: TOKENS.space.sm,
    paddingBottom: TOKENS.space.xl,
  },
  railItem: {
    width: 56,
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
  },
  add: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: TOKENS.color.border.strong,
  },
  railLabel: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.secondary,
  },
  section: {
    ...TOKENS.typography.labelSmall,
    color: TOKENS.color.text.secondary,
    paddingBottom: TOKENS.space.xs,
  },
  list: {
    paddingHorizontal: TOKENS.space.lg,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.sm,
    padding: TOKENS.space.sm,
    marginBottom: TOKENS.space.xs,
    borderRadius: TOKENS.radius.lg,
    backgroundColor: TOKENS.color.bg.raised,
    borderWidth: 1,
    borderColor: TOKENS.color.border.hairline,
    ...TOKENS.elevation.card,
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
    ...TOKENS.typography.labelMedium,
    color: TOKENS.color.text.primary,
    flex: 1,
  },
  time: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.tertiary,
  },
  preview: {
    ...TOKENS.typography.captionRegular,
    color: TOKENS.color.text.secondary,
    flex: 1,
  },
  previewUnread: {
    color: TOKENS.color.text.primary,
  },
  // A count, not a bare dot. The dot was chosen to avoid "anxiety about the
  // number", but with the threads in cards it read as a rendering artefact, and
  // one glance at "2" is less anxious than opening a thread to find out.
  unread: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TOKENS.color.bg.accentStrong,
  },
  unreadCount: {
    ...TOKENS.typography.numeralSmall,
    color: TOKENS.color.text.onAccent,
  },
  fabWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  fab: {
    paddingHorizontal: TOKENS.space.xl,
    paddingVertical: TOKENS.space.sm,
    borderRadius: TOKENS.radius.pill,
    backgroundColor: TOKENS.color.bg.inverse,
    ...TOKENS.elevation.composer,
  },
  fabLabel: {
    ...TOKENS.typography.labelMedium,
    color: TOKENS.color.text.onInverse,
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
