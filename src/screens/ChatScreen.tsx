import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
  type ListRenderItemInfo,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS } from '../theme/tokens';
import { initialOf } from '../lib/display';
import { isPending, lastOwnMessageId } from '../lib/transcript';
import {
  useConversationId,
  useConversations,
  useMessages,
  useProfile,
  useProviders,
  useSelfId,
  useSendMessage,
} from '../api/chat';
import { useLiveConversation, useMarkRead } from '../api/realtime';
import { selectPeerOnline, useStore } from '../store/useStore';
import { Avatar } from '../components/Avatar';
import { Chip } from '../components/Chip';
import { Composer } from '../components/Composer';
import { DayDivider } from '../components/DayDivider';
import { Icon } from '../components/Icon';
import { NoticeBar } from '../components/NoticeBar';
import { PeerTyping } from '../components/PeerTyping';
import { Pressable } from '../components/Pressable';
import { TokenCounter } from '../components/TokenCounter';
import { MyTurn, PeerTurn } from '../components/Turn';
import { ReviewSheet } from './ReviewSheet';
import { SafetySheet } from './SafetySheet';

interface Props {
  providerId: string;
  onBack: () => void;
}

const STARTERS: ReadonlyArray<{ label: string; tone: 'neutral' | 'warm' }> = [
  { label: 'How was your day?', tone: 'neutral' },
  { label: 'I could use some company', tone: 'warm' },
  { label: 'I just need to vent', tone: 'neutral' },
];

function timeOf(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * `inverted` is load-bearing: it anchors the transcript to the bottom, so a
 * keyboard opening or a bubble arriving changes nobody's scroll offset. Combined
 * with a stable `data` reference (the typing indicator lives in
 * ListHeaderComponent and subscribes to the store itself), the list does no
 * layout work while the other person is composing.
 *
 * Note what is *not* here any more: the composer is no longer disabled while a
 * send is in flight. Blocking input was correct against a model that produced
 * one reply per turn; against a person, sending two messages in a row is normal
 * conversation and the UI should not fight it.
 */
export function ChatScreen({ providerId, onBack }: Props) {
  const insets = useSafeAreaInsets();
  const balance = useStore(s => s.balance);
  const openRefill = useStore(s => s.openRefill);
  const peerOnline = useStore(selectPeerOnline);
  const [bloomKey, setBloomKey] = useState(0);
  // Which message the safety sheet was opened from, so a report can attach the
  // specific message rather than only the thread.
  const [safety, setSafety] = useState<{ open: boolean; messageId: string | null }>({
    open: false,
    messageId: null,
  });
  const [reviewOpen, setReviewOpen] = useState(false);
  // Dismissing the prompt is per-visit, not persisted. A member who says "not
  // now" and comes back tomorrow is a different question from one who said it a
  // second ago, and persisting it would need a key per conversation for a
  // decision worth almost nothing.
  const [promptHidden, setPromptHidden] = useState(false);

  useProfile();
  const { data: selfId } = useSelfId();
  const { data: providers } = useProviders();
  const { data: conversationId, isPending: conversationPending } = useConversationId(providerId);
  const { data: messages, isPending: messagesPending } = useMessages(conversationId);
  const { data: threads } = useConversations();

  const { notifyTyping } = useLiveConversation(conversationId, selfId);
  useMarkRead(conversationId, selfId);
  const send = useSendMessage(conversationId, selfId);

  const provider = providers?.find(p => p.id === providerId);
  const name = provider?.display_name ?? 'Conversation';
  const initial = initialOf(provider?.display_name);

  const onSend = useCallback(
    (text: string) => {
      setBloomKey(n => n + 1);
      void send(text);
    },
    [send],
  );

  /**
   * Grouping is computed once per data change, not per row: a row needs to know
   * whether it opens a group and whether it closes one, which depends on its
   * neighbours. The list is newest-first because it renders inverted.
   */
  const rows = useMemo(() => {
    const list = messages ?? [];
    const receiptFor = lastOwnMessageId(list, selfId);
    return list.map((m, i) => {
      const newer = list[i - 1];
      const older = list[i + 1];
      return {
        message: m,
        mine: m.sender_id === selfId,
        first: !older || older.sender_id !== m.sender_id,
        last: !newer || newer.sender_id !== m.sender_id,
        showReceipt: m.id === receiptFor,
      };
    });
  }, [messages, selfId]);

  /**
   * Whether to offer a rating, and the conditions are deliberately strict.
   *
   * The directory publishes a rating and a review count that are worthless if
   * nobody rates — Clarity's rows lead with "5.0 ★ 39+ reviews", which is what a
   * member actually picks on. But a rating prompt is the easiest thing in a
   * product to make obnoxious, so all four of these must hold:
   *
   *   1. **The caller is the member of this thread**, which is `i_am_member`
   *      and deliberately *not* `role === 'member'`. The first version used the
   *      profile role and was wrong for the accounts the product most wants: a
   *      member admitted as a provider keeps the threads they paid for, and
   *      `submit_review` would happily accept them. See migration 007.
   *   2. **A real exchange.** Both sides must have sent something. The server
   *      requires two messages; two of your own is not a conversation, and
   *      rating it would be a rating-farming primitive.
   *   3. **Not already rated.** `conversation_summaries.reviewed` exists for
   *      exactly this and was, until now, published and never read. Defaults to
   *      not-offered while the query is in flight so the prompt cannot flash and
   *      vanish.
   *   4. **Not dismissed this visit.**
   */
  const exchanged = useMemo(() => {
    const list = messages ?? [];
    return (
      list.some(m => m.sender_id === selfId) && list.some(m => m.sender_id !== selfId)
    );
  }, [messages, selfId]);

  const thread = threads?.find(t => t.id === conversationId);
  const offerReview =
    thread !== undefined &&
    thread.i_am_member &&
    !thread.reviewed &&
    conversationId !== undefined &&
    exchanged &&
    !promptHidden;

  const reportMessage = useCallback((messageId: string) => {
    setSafety({ open: true, messageId });
  }, []);

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<(typeof rows)[number]>) => {
      const { message, mine, first, last, showReceipt } = item;
      const stamp = last ? timeOf(message.created_at) : undefined;
      return (
        <View style={styles.turn}>
          {mine ? (
            <MyTurn
              message={message.body}
              timestamp={stamp}
              pending={isPending(message)}
              receipt={
                showReceipt && !isPending(message)
                  ? message.read_at !== null
                    ? 'read'
                    : 'sent'
                  : undefined
              }
            />
          ) : (
            <PeerTurn
              message={message.body}
              initial={initial}
              first={first}
              timestamp={stamp}
              onReport={() => reportMessage(message.id)}
            />
          )}
        </View>
      );
    },
    [initial, reportMessage],
  );

  const header = useCallback(
    () => <PeerTyping initial={initial} name={name} />,
    [initial, name],
  );
  const loading = conversationPending || (conversationId !== undefined && messagesPending);
  const empty = !loading && rows.length === 0;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          testID="chat-back"
          accessibilityLabel="Back to the directory"
          press="chip"
          size={40}
          style={styles.back}>
          <Icon glyph="chevron-left" size={16} />
        </Pressable>
        <Avatar initial={initial} size={34} online={peerOnline} />
        <View style={styles.identity}>
          <Text testID="chat-title" allowFontScaling numberOfLines={1} style={styles.title}>
            {name}
          </Text>
          {peerOnline ? (
            <Text testID="peer-presence" allowFontScaling style={styles.presence}>
              Here now
            </Text>
          ) : null}
        </View>
        <Pressable
          onPress={() => setSafety({ open: true, messageId: null })}
          testID="open-safety"
          accessibilityLabel={`Block or report ${name}`}
          style={styles.back}>
          <Icon glyph="shield" size={16} color={TOKENS.color.text.secondary} />
        </Pressable>
        <TokenCounter balance={balance} onPress={openRefill} />
      </View>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={TOKENS.color.text.secondary} />
          </View>
        ) : empty ? (
          <View style={styles.empty}>
            <View style={styles.emptyMark}>
              <Avatar initial={initial} size={56} tone="warm" breathing />
            </View>
            <Text allowFontScaling style={styles.emptyName}>
              {name}
            </Text>
            <Text allowFontScaling style={styles.emptyLine}>
              Say hello.
            </Text>
            <View style={styles.starters}>
              {STARTERS.map(s => (
                <Chip key={s.label} label={s.label} tone={s.tone} onPress={onSend} />
              ))}
            </View>
          </View>
        ) : (
          <FlatList
            data={rows}
            inverted
            // localKey, not id: a settled row keeps the key its optimistic
            // version had, so the bubble's component survives confirmation and
            // the launch animation does not replay. See lib/transcript.ts.
            keyExtractor={r => r.message.localKey ?? r.message.id}
            renderItem={renderItem}
            ListHeaderComponent={header}
            ListFooterComponent={<DayDivider label="Today" />}
            contentContainerStyle={styles.list}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            initialNumToRender={12}
            maxToRenderPerBatch={8}
            windowSize={9}
            removeClippedSubviews
            showsVerticalScrollIndicator={false}
          />
        )}

        {/* Above the composer and below the transcript: in the flow, but never
            over it. A modal here would interrupt the one thing the screen is
            for. */}
        {offerReview ? (
          <View style={styles.prompt}>
            {/* Wrapped rather than given `flex: 1` directly: Pressable applies
                its `style` to the inner animated view, so layout has to live on
                a plain View around it or the row does not stretch. */}
            <View style={styles.promptFill}>
              <Pressable
                onPress={() => setReviewOpen(true)}
                testID="open-review"
                accessibilityLabel={`Rate your conversation with ${name}`}
                accessibilityHint="Opens a rating sheet"
                style={styles.promptBody}>
                <Text allowFontScaling style={styles.promptText}>
                  How was talking to {name}?
                </Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => setPromptHidden(true)}
              testID="dismiss-review-prompt"
              accessibilityLabel="Not now"
              style={styles.promptClose}>
              <Icon glyph="close" size={12} color={TOKENS.color.text.positive} />
            </Pressable>
          </View>
        ) : null}

        <NoticeBar />

        <View style={{ paddingBottom: insets.bottom + TOKENS.space.sm }}>
          <Composer
            onSend={onSend}
            onTyping={notifyTyping}
            disabled={conversationId === undefined}
            placeholder="Say anything"
            bloomKey={bloomKey}
          />
        </View>
      </KeyboardAvoidingView>

      <SafetySheet
        visible={safety.open}
        onClose={() => setSafety({ open: false, messageId: null })}
        conversationId={conversationId}
        peerId={providerId}
        peerName={name}
        messageId={safety.messageId}
      />

      <ReviewSheet
        visible={reviewOpen}
        onClose={() => {
          setReviewOpen(false);
          // Whether they submitted or backed out, do not ask again this visit.
          // On submit the `reviewed` flag will settle it permanently once the
          // conversation list refetches; this covers the gap in between.
          setPromptHidden(true);
        }}
        conversationId={conversationId}
        peerName={name}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: TOKENS.color.bg.base,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.sm,
    paddingHorizontal: TOKENS.space.md,
    paddingTop: TOKENS.space.xs,
    paddingBottom: TOKENS.space.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: TOKENS.color.border.hairline,
  },
  back: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: TOKENS.color.bg.sunken,
  },
  emptyMark: {
    paddingBottom: TOKENS.space.xs,
  },
  identity: {
    flex: 1,
  },
  title: {
    ...TOKENS.typography.labelMedium,
    color: TOKENS.color.text.primary,
  },
  presence: {
    ...TOKENS.typography.captionSmall,
    color: TOKENS.color.text.positive,
  },
  body: {
    flex: 1,
  },
  list: {
    paddingHorizontal: TOKENS.space.md,
    paddingTop: TOKENS.space.md,
  },
  turn: {
    paddingVertical: TOKENS.space.xs,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: TOKENS.space.xs,
    paddingHorizontal: TOKENS.space['2xl'],
  },
  emptyName: {
    ...TOKENS.typography.displaySmall,
    color: TOKENS.color.text.primary,
  },
  emptyLine: {
    ...TOKENS.typography.bodyMedium,
    color: TOKENS.color.text.secondary,
  },
  starters: {
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
    paddingTop: TOKENS.space.xl,
  },
  // Deliberately quieter than the NoticeBar it sits above: no accent border, no
  // colour. This is an invitation, not a problem.
  // The one calm band in the app. bg/positive rather than bg/sunken: this is an
  // invitation, and the sage reads as "good news, no action required" where the
  // grey read as another piece of chrome.
  prompt: {
    flexDirection: 'row',
    alignItems: 'center',
    marginHorizontal: TOKENS.space.md,
    marginBottom: TOKENS.space.xs,
    borderRadius: TOKENS.radius.md,
    backgroundColor: TOKENS.color.bg.positive,
  },
  promptFill: {
    flex: 1,
  },
  promptBody: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: 10,
  },
  promptText: {
    ...TOKENS.typography.labelSmall,
    color: TOKENS.color.text.positive,
  },
  promptClose: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
