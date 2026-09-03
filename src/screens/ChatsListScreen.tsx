import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlashList, type FlashListProps } from '@shopify/flash-list';
import { StyleSheet, Text, View } from 'react-native';
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { initialOf } from '../lib/display';
import { timeOfDay } from '../lib/datetime';
import { readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useConversations, useProfile } from '../api/chat';
import { useBlockedPeerIds } from '../api/safety';
import type { ConversationSummary } from '../lib/database.types';
import { Avatar } from '../components/Avatar';
import { BackButton } from '../components/BackButton';
import { Pressable } from '../components/Pressable';
import { ChatStartHint } from '../components/ChatStartHint';
import { ConversationMenu } from '../components/ConversationMenu';
import type { MenuAnchor } from '../components/PaperMenu';
import { TopAppBar } from '../components/TopAppBar';
import { Badge } from '../components/Badge';
import { Divider } from '../components/Divider';
import { compareConversations, visibleOnList } from '../lib/railPrefs';
import { useRailPrefs } from '../store/useRailPrefs';

interface Props {
  onBack: () => void;
  onOpenConversation: (peerId: string) => void;
}

// Reanimated wrapper so the list's scroll offset can drive the medium app bar's
// collapse on the UI thread (a plain onScroll would run this every frame on JS).
const AnimatedFlashList = Animated.createAnimatedComponent(
  FlashList as React.ComponentType<FlashListProps<ConversationSummary>>,
);

function summaryLabel(conversation: ConversationSummary): string {
  if (conversation.last_session_status === 'active') return 'Active session';
  if (conversation.last_session_status === 'pending_leases') return 'Connecting session';
  if (conversation.last_preview_kind === 'voice') return 'Voice note';
  if (conversation.last_preview_kind === 'image') return 'Photo';
  if (conversation.last_session_channel === 'audio') return 'Voice call';
  if (conversation.last_session_channel === 'video') return 'Video call';
  if (conversation.last_session_at) return 'Chat session';
  return 'No sessions yet';
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
  const railPrefs = useRailPrefs();
  const [menuPeer, setMenuPeer] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<MenuAnchor | null>(null);

  const rows = useMemo(
    () =>
      (conversations ?? [])
        .filter(c => !blocked.has(c.peer_id) && visibleOnList(railPrefs, c.peer_id))
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

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler(e => {
    scrollY.value = e.contentOffset.y;
  });

  const openMenu = useCallback((peerId: string, anchor: MenuAnchor) => {
    setMenuAnchor(anchor);
    setMenuPeer(peerId);
  }, []);

  const renderRow = useCallback(
    ({ item: c, index: i }: { item: (typeof rows)[number]; index: number }) => (
      <ChatListRow
        conversation={c}
        isLast={i === rows.length - 1}
        onOpen={onOpenConversation}
        onMenu={openMenu}
      />
    ),
    [rows.length, onOpenConversation, openMenu],
  );

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <TopAppBar
        variant="medium"
        title="Chats"
        subtitle={rows.length > 0 ? `${rows.length} ${rows.length === 1 ? 'conversation' : 'conversations'}` : undefined}
        leading={<BackButton onPress={onBack} testID="chatslist-back" />}
        scrollY={scrollY}
        testID="chatslist-bar"
      />
      {rows.length > 0 ? (
        <AnimatedFlashList
          data={rows}
          keyExtractor={c => c.conversation_id}
          showsVerticalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          {...SCROLL_PHYSICS}
          contentContainerStyle={{ paddingBottom: insets.bottom + TOKENS.space.xl }}
          renderItem={renderRow}
          overrideItemLayout={layout => { (layout as { span?: number; size?: number }).size = 72; }}
        />
      ) : (
        <View style={styles.empty}>
          <ChatStartHint />
        </View>
      )}
      <ConversationMenu
        peerId={menuPeer}
        surface="list"
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

function ChatListRow({
  conversation: c,
  isLast,
  onOpen,
  onMenu,
}: {
  conversation: ConversationSummary;
  isLast: boolean;
  onOpen: (peerId: string) => void;
  onMenu: (peerId: string, anchor: MenuAnchor) => void;
}) {
  const styles = useStyles(makeStyles);
  const hostRef = useRef<View>(null);
  const name = c.peer_display_name ?? 'Conversation';
  const unreadCount = c.i_am_member
    ? Number(c.unread_count_member)
    : Number(c.unread_count_provider);
  const unread = unreadCount > 0;
  const presence = readPresence(c.peer_presence, c.peer_last_active_at);
  return (
    <View ref={hostRef} collapsable={false}>
      <Pressable
        onPress={() => onOpen(c.peer_id)}
        onLongPress={() => {
          hostRef.current?.measureInWindow((x, y, width, height) => {
            onMenu(c.peer_id, { x, y, width, height });
          });
        }}
        testID={`chatlist-${c.peer_id}`}
        accessibilityLabel={unread ? `${name}, ${unreadCount} unread` : name}
        press="none"
        highlight="ios"
        style={styles.row}>
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
            {summaryLabel(c)}
          </Text>
        </View>
        <View style={styles.rowTrailing}>
          <Text allowFontScaling style={styles.rowTime}>
            {c.last_session_at ? timeOfDay(c.last_session_at) : ''}
          </Text>
          {unread ? (
            <View style={styles.badgeAnchor}>
              <Badge count={unreadCount} testID={`badge-${c.peer_id}`} />
            </View>
          ) : null}
        </View>
      </Pressable>
      {!isLast ? <Divider variant="inset" /> : null}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: { flex: 1, backgroundColor: t.color.bg.base },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.md,
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: TOKENS.space.sm,
    },
    rowBody: { flex: 1, gap: TOKENS.space.hair },
    rowName: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    rowPreview: {
      ...TOKENS.typography.bodyMedium,
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
      ...TOKENS.typography.bodySmall,
      color: t.color.text.tertiary,
    },
    // Anchor for the absolute-positioned Badge component.
    badgeAnchor: {
      position: 'relative',
      minWidth: 20,
      height: 20,
      alignItems: 'center',
      justifyContent: 'center',
    },
    empty: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space['2xl'],
    },
    emptyText: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.secondary,
      textAlign: 'center',
    },
  });
