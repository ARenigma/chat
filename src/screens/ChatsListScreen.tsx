import React, { useCallback, useMemo, useRef, useState } from 'react';
import { FlashList } from '@shopify/flash-list';
import { StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { initialOf, firstName } from '../lib/display';
import { timeOfDay } from '../lib/datetime';
import { readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { useConversations, useProfile } from '../api/chat';
import { useConversationLabels } from '../api/conversationLabels';
import { useBlockedPeerIds } from '../api/safety';
import type { ConversationSummary } from '../lib/database.types';
import { Avatar } from '../components/Avatar';
import { BackButton } from '../components/BackButton';
import { Button } from '../components/Button';
import { Pressable } from '../components/Pressable';
import { ChatStartHint } from '../components/ChatStartHint';
import { ConversationMenu } from '../components/ConversationMenu';
import type { MenuAnchor } from '../components/PaperMenu';
import { Badge } from '../components/Badge';
import { Divider } from '../components/Divider';
import { compareConversations, visibleOnList } from '../lib/railPrefs';
import { useRailPrefs } from '../store/useRailPrefs';
import { useBottomBarOffset } from '../shell/useBottomBarOffset';

interface Props {
  onBack: () => void;
  onOpenConversation: (peerId: string) => void;
}

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
  // The bottom bar stays up on this pushed screen: the last row clears it.
  const barOffset = useBottomBarOffset(TOKENS.space.xl);
  useProfile();
  const { data: conversations, isError: conversationsError, refetch: refetchConversations } =
    useConversations();
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
            { peerId: a.peer_id, at: a.last_session_at ?? '', unread: a.i_am_member ? Number(a.unread_count_member) : Number(a.unread_count_provider) },
            { peerId: b.peer_id, at: b.last_session_at ?? '', unread: b.i_am_member ? Number(b.unread_count_member) : Number(b.unread_count_provider) },
          ),
        ),
    [conversations, blocked, railPrefs],
  );

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
      {/*
       * One row, back beside the title: the bar every pushed screen in the app
       * uses (Usage, Transactions, Invoices, Blocked users). This was the only
       * one on the two-row medium bar, whose back arrow sat a row above its own
       * headline (Amit, 2026-09-29: "similar app bar ... like other screens").
       */}
      <View style={styles.bar} testID="chatslist-bar">
        <BackButton onPress={onBack} testID="chatslist-back" />
        <Text
          maxFontSizeMultiplier={TOKENS.fontScaleCap.textLgSemiBoldTight}
          allowFontScaling
          accessibilityRole="header"
          style={styles.barTitle}>
          Chats
        </Text>
      </View>
      {rows.length > 0 ? (
        <FlashList
          data={rows}
          keyExtractor={c => c.conversation_id}
          showsVerticalScrollIndicator={false}
          {...SCROLL_PHYSICS}
          contentContainerStyle={{ paddingBottom: barOffset }}
          renderItem={renderRow}
          overrideItemLayout={layout => { (layout as { span?: number; size?: number }).size = 72; }}
        />
      ) : conversationsError ? (
        /*
         * Distinct from the "no conversations yet" empty state below
         * (2026-09-17 audit): before this, a failed fetch fell straight
         * into `ChatStartHint`, so every conversation appeared to have
         * vanished rather than the fetch having failed. Same fix as
         * the chat's own `loadError` branch (`chatV2LoadState` in
         * `src/chat-v2/chatState.ts`) — see its docblock there for
         * the full reasoning; this is the rail's equivalent.
         */
        <View style={styles.empty}>
          <Text allowFontScaling style={styles.emptyText}>
            Couldn&apos;t load your chats
          </Text>
          <View style={styles.emptyRetry}>
            <Button
              label="Try Again"
              onPress={() => {
                void refetchConversations();
              }}
            />
          </View>
        </View>
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
  // A private custom label (migration 098) overrides the peer name in this
  // person's own inbox. The query is shared/deduped across rows by React Query.
  const { data: labels } = useConversationLabels();
  // First name only for everyone (display.ts, 2026-10-03).
  const peerName = firstName(c.peer_display_name);
  const name = labels?.get(c.conversation_id) ?? (peerName || 'Conversation');
  const unreadCount = c.i_am_member
    ? Number(c.unread_count_member)
    : Number(c.unread_count_provider);
  const unread = unreadCount > 0;
  // The server's reading (migration 155): a provider peer's `peer_online`, the
  // same derivation as the directory's `online`, so this dot agrees with the
  // rail and the card. A member peer's presence is never published (false and
  // null), and neither is anyone's across a block, so those light nothing.
  // Only the dot is drawn, and it refreshes with the inbox query's cadence.
  const presence = readPresence({
    online: c.peer_online,
    lastSeenAt: c.peer_last_seen_at,
    now: new Date(),
  });
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
        highlight="dim"
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
    // As UsageLedgerScreen's bar, so every pushed screen's title sits the same.
    bar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.md,
      paddingBottom: TOKENS.space.xs,
    },
    barTitle: { ...TOKENS.typography.textLgSemiBoldTight, color: t.color.text.primary },
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
    emptyRetry: {
      alignSelf: 'stretch',
      paddingTop: TOKENS.space.md,
    },
  });
