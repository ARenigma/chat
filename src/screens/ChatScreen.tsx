import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashList, type ListRenderItemInfo } from '@shopify/flash-list';
import {
  ActivityIndicator,
  AppState,
  InteractionManager,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { initialOf } from '../lib/display';
import { isPending, lastOwnMessageId } from '../lib/transcript';
import {
  useConversationId,
  useConversations,
  useMessages,
  useCalls,
  useProfile,
  useProviders,
  useSelfId,
  useSendMessage,
} from '../api/chat';
import { useLiveConversation, useMarkRead } from '../api/realtime';
import { useReactions, useToggleReaction } from '../api/reactions';
import { CALLS_ENABLED } from '../api/calls';
import { useSendVoiceNote, useVoicePlayer } from '../api/voice';
import { useSendImage } from '../api/attachments';
import { opensDay, timeOfDay } from '../lib/datetime';
import { voiceOf, type VoiceDraft } from '../lib/voice';
import { imageOf, type ImageDraft } from '../lib/attachments';
import { readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { DEFAULT_RATES, isLowBalance, talkTimeLeft } from '../lib/rates';
import { ownReaction, tallyByMessage } from '../lib/reactions';
import type { ReactionEmoji } from '../lib/database.types';
import { supabase } from '../lib/supabase';
import { useStore } from '../store/useStore';
import { Avatar } from '../components/Avatar';
import { ChatWallpaper } from '../components/ChatWallpaper';
import { Chip } from '../components/Chip';
import { Composer } from '../components/Composer';
import { DayDivider } from '../components/DayDivider';
import { Frost } from '../components/Frost';
import { Icon } from '../components/Icon';
import { NoticeBar } from '../components/NoticeBar';
import { HeaderSubtitle } from '../components/HeaderSubtitle';
import { PeerTyping } from '../components/PeerTyping';
import { Pressable } from '../components/Pressable';
import { TokenCounter } from '../components/TokenCounter';
import { CallLogRow } from '../components/CallLogRow';
import { MyTurn, PeerTurn, type ActionTarget, type ImageBody, type Quote, type VoiceBody } from '../components/Turn';
import { MessageActionsSheet } from './MessageActionsSheet';
import { ReviewSheet } from './ReviewSheet';
import { SafetySheet } from './SafetySheet';

interface Props {
  providerId: string;
  onBack: () => void;
  /**
   * Start a voice/video call from the header. Only fires while `CALLS_ENABLED`
   * (the buttons are disabled otherwise); omitted on the provider tree.
   */
  onStartCall?: (channel: 'audio' | 'video') => void;
  /**
   * Open the peer's detail card. Passed on the member tree (the peer is a
   * provider with a profile); tapping the header identity goes there (#2). Absent
   * on the provider tree, where the peer is a member with no profile card — there
   * the identity still opens the safety sheet.
   */
  onOpenProfile?: (providerId: string) => void;
}

const STARTERS: ReadonlyArray<{ label: string; tone: 'neutral' | 'warm' }> = [
  { label: 'How was your day?', tone: 'neutral' },
  { label: 'I could use some company', tone: 'warm' },
  { label: 'I just need to vent', tone: 'neutral' },
];

// ActionTarget is defined and exported from Turn.tsx; imported above.

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
export function ChatScreen({ providerId, onBack, onStartCall, onOpenProfile }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const balance = useStore(s => s.balance);
  const setBalance = useStore(s => s.setBalance);
  const openRefill = useStore(s => s.openRefill);
  const [bloomKey, setBloomKey] = useState(0);
  // A1: defer ChatWallpaper's ~800 View+Text nodes until after the SlideInRight
  // open animation completes, so the transition frame budget is not eaten by
  // a synchronous mount. The transcript sits above the wallpaper, so a 1-frame-
  // late wallpaper is invisible to the user.
  const [wallpaperReady, setWallpaperReady] = useState(false);
  useEffect(() => {
    const handle = InteractionManager.runAfterInteractions(() => {
      setWallpaperReady(true);
    });
    return () => handle.cancel();
  }, []);
  // Which message the safety sheet was opened from, so a report can attach the
  // specific message rather than only the thread.
  const [safety, setSafety] = useState<{ open: boolean; messageId: string | null }>({
    open: false,
    messageId: null,
  });
  const [actions, setActions] = useState<ActionTarget | null>(null);
  // The message the next send replies to. Cleared on send and on cancel, and
  // never persisted: a half-composed reply is not worth surviving a screen.
  const [replyTo, setReplyTo] = useState<ActionTarget | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  // Only ever read to decide whether the safe-area inset is already covered by
  // the keyboard's own frame. See the note on the composer wrapper.
  const [keyboardUp, setKeyboardUp] = useState(false);
  // Dismissing the prompt is per-visit, not persisted. A member who says "not
  // now" and comes back tomorrow is a different question from one who said it a
  // second ago, and persisting it would need a key per conversation for a
  // decision worth almost nothing.
  const [promptHidden, setPromptHidden] = useState(false);
  // Height of the frosted top bar (header + talk strip + status-bar inset),
  // measured rather than guessed: the strip is conditional on balance and the
  // inset varies by device, so the transcript's top spacer has to track it.
  const [barHeight, setBarHeight] = useState(0);

  // `Will` rather than `Did` on iOS: the padding has to change on the same frame
  // the keyboard starts moving, or the composer visibly jumps 34pt at the end of
  // the animation. Android only emits the `Did` pair.
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      () => setKeyboardUp(true),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setKeyboardUp(false),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  useProfile();
  const { data: selfId } = useSelfId();
  const { data: providers } = useProviders();
  const { data: threads } = useConversations();

  /**
   * Which side of this thread we are on, and it decides how the conversation id
   * is resolved rather than being a cosmetic flag.
   *
   * `open_conversation` takes a **provider** id and raises `not an admitted
   * provider` for anything else. The provider tree renders this same screen with
   * `providerId` set to a *member's* profile id (ProviderHomeScreen passes
   * `peer_id`), so on that side the RPC could never succeed: the id never
   * resolved, the transcript never loaded, and the composer stayed disabled. Voice
   * notes made that visible rather than causing it, because a feature written for
   * both roles and reachable by one is worse than one that is honestly absent.
   *
   * The fix does not loosen the RPC, which is security-relevant and correct as it
   * is. The summary row already carries the id, and `i_am_member` is the
   * authoritative answer to which side we are: not `profiles.role`, because a
   * member admitted as a provider keeps the threads they paid for.
   *
   * The cost, and it is deliberate: on the very first render the conversation list
   * has not arrived, so a provider opening a thread cold fires one
   * `open_conversation` that is guaranteed to fail. Waiting for the list before
   * asking would fix that and would put a second round trip in front of a
   * *member* opening a conversation from the directory, which is the hot path.
   * The RPC raises before it writes anything, so the wasted call costs a request.
   */
  const knownThread = threads?.find(t => t.peer_id === providerId);

  /**
   * If the thread is already in the cached conversation list (either side), use
   * its id directly — `open_conversation` would just round-trip back the same id.
   * That RPC is only needed to CREATE a conversation that does not exist yet: a
   * member opening a brand-new chat from the directory (`needsOpen`). Skipping it
   * for a known thread is what makes reopening a chat land on the transcript in a
   * single round-trip (messages) instead of two (open_conversation, then
   * messages) — the "tap Chat, wait, then it loads" the detail card showed.
   *
   * It also keeps the provider-side correct for free: a provider only ever
   * reaches threads they are in, so `knownThread` is always set there and
   * `open_conversation` (which takes a *provider* id and rejects a member id) is
   * never called on that side.
   */
  const needsOpen = knownThread === undefined;
  const { data: openedId } = useConversationId(needsOpen ? providerId : null);
  const conversationId = knownThread?.id ?? openedId;
  const { data: messages, isPending: messagesPending } = useMessages(conversationId);
  const { data: callRecords } = useCalls(conversationId);

  const { notifyTyping } = useLiveConversation(conversationId, selfId);
  useMarkRead(conversationId, selfId);
  const send = useSendMessage(conversationId, selfId);
  const sendVoice = useSendVoiceNote(conversationId, selfId);
  const sendImage = useSendImage(conversationId, selfId);
  /**
   * One playhead for the whole transcript, because the recorder exposes one
   * player object. Held here rather than per bubble so starting a second note
   * cannot leave the first one believing it is still playing, and so leaving the
   * screen stops the audio.
   */
  const voicePlayer = useVoicePlayer();

  /**
   * Identity comes from the thread first, and the directory only as a fallback.
   *
   * `useProviders()` reads `provider_directory`, which by construction contains
   * providers. This screen serves the provider tree too, where `providerId` is a
   * *member's* profile id, so the directory lookup missed every time and the
   * header fell back to the literal 'Conversation' with a blank avatar.
   * `conversation_summaries.peer_display_name` resolves through
   * `conversation_peers` and is correct on both sides, a member peer comes back
   * as their handle rather than as null.
   *
   * The directory fallback stays for the one case the thread cannot cover: a
   * conversation opened from the directory before it has any messages, where
   * there is no summary row yet.
   */
  const peerThread = knownThread;
  const provider = providers?.find(p => p.id === providerId);
  const peerName = peerThread?.peer_display_name ?? provider?.display_name;
  const name = peerName ?? 'Conversation';
  const initial = initialOf(peerName);
  const avatarUrl = peerThread?.peer_avatar_url ?? provider?.avatar_url ?? null;

  /**
   * One presence value, read from one place, so the header's layout does not have
   * to change when the source does.
   *
   * It used to be `selectPeerOnline`, fed by a Realtime presence channel, which
   * answers "is their app in the foreground": a question nobody agreed to have
   * answered about them, and one that contradicts the settled decision that
   * presence is user-controlled. It was then `peer_available`, which was honest
   * about consent and wrong about meaning, because that column is the provider's
   * *listing* switch and is false for a member peer by construction. So the
   * provider tree's header could never show a member as present.
   *
   * `peer_presence` is the declared state and is published for either role. The
   * directory fallback covers a conversation opened from the rail before the
   * first message creates a thread row.
   */
  const presence = readPresence(
    peerThread?.peer_presence ?? provider?.presence,
    peerThread?.peer_last_active_at ?? provider?.last_active_at,
  );

  const onSend = useCallback(
    (text: string) => {
      setBloomKey(n => n + 1);
      const parent = replyTo;
      setReplyTo(null);
      void send(text, parent?.id ?? null);
    },
    [send, replyTo],
  );

  /**
   * A recording, sent, and it clears the reply bar for the same reason text does:
   * a reply you composed and then answered with your voice is still a reply.
   */
  const onSendVoice = useCallback(
    (draft: VoiceDraft) => {
      setBloomKey(n => n + 1);
      const parent = replyTo;
      setReplyTo(null);
      void sendVoice(draft, parent?.id ?? null);
    },
    [sendVoice, replyTo],
  );

  /** A picked photo, sent. Clears the reply bar for the same reason text does. */
  const onSendImage = useCallback(
    (draft: ImageDraft) => {
      setBloomKey(n => n + 1);
      const parent = replyTo;
      setReplyTo(null);
      void sendImage(draft, parent?.id ?? null);
    },
    [sendImage, replyTo],
  );

  /**
   * Grouping is computed once per data change, not per row: a row needs to know
   * whether it opens a group and whether it closes one, which depends on its
   * neighbours. The list is newest-first because it renders inverted.
   *
   * `opensDay` joined it for the same reason. The divider used to be a single
   * hardcoded `<DayDivider label="Today" />` in `ListFooterComponent`, which on an
   * *inverted* list renders at the visual top of the transcript, so one divider
   * saying "Today" sat above the oldest message the client held, whatever date
   * that message was actually on, and there was no per-day grouping anywhere.
   */
  const rows = useMemo(() => {
    const list = messages ?? [];
    const receiptFor = lastOwnMessageId(list, selfId);

    type MessageRow = {
      kind: 'message';
      localKey: string;
      sortAt: string;
      message: (typeof list)[number];
      mine: boolean;
      first: boolean;
      last: boolean;
      showReceipt: boolean;
      opensDay: boolean;
      voice?: VoiceBody;
      image?: ImageBody;
    };
    type CallRow = {
      kind: 'call';
      localKey: string;
      sortAt: string;
      call: NonNullable<typeof callRecords>[number];
      opensDay: boolean;
    };

    const messageRows: MessageRow[] = list.map((m, i) => {
      const newer = list[i - 1];
      const older = list[i + 1];
      const audio = voiceOf(m);
      const picture = imageOf(m);
      return {
        kind: 'message' as const,
        localKey: m.localKey ?? m.id,
        sortAt: m.created_at,
        message: m,
        mine: m.sender_id === selfId,
        first: !older || older.sender_id !== m.sender_id,
        last: !newer || newer.sender_id !== m.sender_id,
        showReceipt: m.id === receiptFor,
        // opensDay is false here and recomputed in the single pass below.
        opensDay: false,
        // Built here rather than in `renderItem` so its identity is stable across
        // renders and the memo on the bubble still holds. A fresh object literal
        // per render would re-render every row on every playhead tick.
        voice:
          audio === null
            ? undefined
            : ({ messageId: m.id, path: audio.path, durationMs: audio.durationMs } as VoiceBody),
        image:
          picture === null
            ? undefined
            : ({
                messageId: m.id,
                path: picture.path,
                width: picture.width,
                height: picture.height,
                localUri: m.localImageUri,
              } as ImageBody),
      };
    });

    const callRows: CallRow[] = (callRecords ?? []).map(c => ({
      kind: 'call' as const,
      localKey: `call-${c.id}`,
      sortAt: c.created_at,
      call: c,
      opensDay: false,
    }));

    // Merge and sort newest-first (matches the inverted FlatList).
    const sorted = [...messageRows, ...callRows].sort(
      (a, b) => new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime(),
    );

    // Single pass over the merged list to compute day dividers.
    //
    // `opensDay` was previously computed in messageRows.map() against adjacent
    // messages only, so a call row between two days broke the divider (the day
    // whose first row was a call showed no divider, and calls between days
    // swallowed the boundary).  Computing it here — after sorting — means every
    // row compares against its actual older neighbour regardless of kind.
    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i];
      const olderNeighbour = sorted[i + 1];
      if (row === undefined) continue;
      row.opensDay = opensDay(
        { created_at: row.sortAt },
        olderNeighbour !== undefined ? { created_at: olderNeighbour.sortAt } : undefined,
      );
    }

    return sorted;
  }, [messages, selfId, callRecords]);

  /**
   * Reactions for the loaded page, and the parents of any replies in it.
   *
   * Pending rows are excluded from the id list: their ids are `pending-…`, which
   * no server row can carry, so including them would make the query key churn on
   * every keystroke-to-send for no result.
   */
  const messageIds = useMemo(
    () => (messages ?? []).filter(m => !isPending(m)).map(m => m.id),
    [messages],
  );
  const { data: reactionRows } = useReactions(conversationId, messageIds);
  const toggleReaction = useToggleReaction(conversationId);
  const tallies = useMemo(() => tallyByMessage(reactionRows ?? [], selfId), [reactionRows, selfId]);

  /**
   * Parents by id, for the quote block.
   *
   * Only what is in the loaded page. A reply to something older than the last
   * hundred messages renders as a plain bubble rather than fetching one row at a
   * time from inside `renderItem`, which is the version of this that scrolls badly.
   */
  const parents = useMemo(() => {
    const map = new Map<string, Quote>();
    for (const m of messages ?? []) {
      map.set(m.id, {
        author: m.sender_id === selfId ? 'You' : name,
        body: m.body,
      });
    }
    return map;
  }, [messages, selfId, name]);

  /**
   * Whether to offer a rating, and the conditions are deliberately strict.
   *
   * The directory publishes a rating and a review count that are worthless if
   * nobody rates, Clarity's rows lead with "5.0 ★ 39+ reviews", which is what a
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

  /**
   * Prepaid per-minute chat meter (member side only).
   *
   * The first minute is charged immediately when the screen mounts and the
   * conversation is known (prepaid — you pay before you talk, not after). A
   * 60 s interval then charges each subsequent minute.
   *
   * Drain-to-zero model (migration 022): a sub-minute balance (1–21 tokens)
   * is still granted as a full minute, draining to 0. The session ends only
   * when the RPC returns OUT_OF_TOKENS (balance already 0 at charge time).
   *
   * `spend_chat_minute` is SECURITY DEFINER and self-scoped so no client-side
   * trust is required.
   */
  const [sessionEnded, setSessionEnded] = useState(false);
  // Single slot for the running interval — shared between initial start and
  // the resume restart so there is never more than one running timer.
  const meterRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /**
   * Debit one minute atomically. Returns true to keep the session running,
   * false to end it. Background time is never billed (returns true).
   *
   * Drain-to-zero semantics: success with last=true means the balance just hit
   * 0; the session keeps running this final minute and ends only on the NEXT
   * charge when OUT_OF_TOKENS is returned. Stable: setBalance is a Zustand
   * action.
   */
  const chargeMinute = useCallback(async (): Promise<boolean> => {
    if (AppState.currentState !== 'active') {
      return true;
    }
    const { data: result } = await supabase.rpc('spend_chat_minute');
    if (result === null) {
      return true;
    }
    if (result.success && result.new_balance != null) {
      setBalance(result.new_balance);
      // result.last=true: balance hit 0 this minute. The session keeps running;
      // the NEXT charge will return OUT_OF_TOKENS and end it then.
      return true;
    }
    // OUT_OF_TOKENS: balance was already 0 — end the session.
    // NOT_AUTHENTICATED / NO_PROFILE: stop the meter gracefully.
    if (
      result.error === 'OUT_OF_TOKENS' ||
      result.error === 'NOT_AUTHENTICATED' ||
      result.error === 'NO_PROFILE'
    ) {
      return false;
    }
    return true;
  }, [setBalance]);

  // Derived gate: meter runs when the member is in an active conversation and
  // the session has not been ended by an OUT_OF_TOKENS response.
  // Balance is intentionally NOT a dep: the session ends only when the RPC
  // says so, not when the client-side balance crosses a threshold, and
  // including balance would restart the meter on every successful charge.
  const shouldMeter =
    (thread?.i_am_member ?? false) && conversationId !== undefined && !sessionEnded;

  // Effect A — meter lifecycle. Starts a prepaid minute immediately when
  // shouldMeter becomes true (chat open or session resumed), then ticks every
  // 60 s. Cleanup clears the interval on unmount or when shouldMeter goes false
  // (session ends or the component leaves the screen).
  useEffect(() => {
    if (!shouldMeter) {
      return;
    }

    let cancelled = false;

    void chargeMinute().then(ok => {
      if (cancelled) return;
      if (!ok) {
        setSessionEnded(true);
        openRefill();
        return;
      }
      meterRef.current = setInterval(() => {
        void chargeMinute().then(tickOk => {
          if (!tickOk) {
            if (meterRef.current !== null) {
              clearInterval(meterRef.current);
              meterRef.current = null;
            }
            setSessionEnded(true);
            openRefill();
          }
        });
      }, 60_000);
    });

    return () => {
      cancelled = true;
      if (meterRef.current !== null) {
        clearInterval(meterRef.current);
        meterRef.current = null;
      }
    };
    // shouldMeter encapsulates thread?.i_am_member, conversationId, and
    // !sessionEnded. chargeMinute and openRefill are stable references.
  }, [shouldMeter, chargeMinute, openRefill]);

  // Effect B — resume. Clears sessionEnded when the balance is any positive
  // value after a recharge (any positive balance starts a fresh last-or-more
  // minute under the drain-to-zero model), which flips shouldMeter back to
  // true and causes Effect A to restart the meter with a fresh prepaid charge.
  useEffect(() => {
    if (sessionEnded && balance !== null && balance > 0) {
      setSessionEnded(false);
    }
  }, [sessionEnded, balance]);

  const offerReview =
    thread !== undefined &&
    thread.i_am_member &&
    !thread.reviewed &&
    conversationId !== undefined &&
    exchanged &&
    !promptHidden;

  /**
   * A long press opens the actions sheet, and Report is a row inside it.
   *
   * It used to go straight to SafetySheet with the message attached. That path is
   * preserved rather than dropped, it is the only route by which one specific
   * message becomes evidence, it is simply one tap further in now, and it is
   * reachable from your own messages' sheet too (as nothing, correctly: there is
   * no Report row on your own words).
   *
   * The two sheets are never open at once. Two `Modal`s open together on Android
   * is the exact class of bug the second `GestureHandlerRootView` inside Sheet
   * exists for, so `setActions(null)` happens in the same tick as the open.
   */
  const openActions = useCallback((target: ActionTarget) => {
    requestAnimationFrame(() => setActions(target));
  }, []);

  const reportFromActions = useCallback(() => {
    const target = actions;
    setActions(null);
    requestAnimationFrame(() => setSafety({ open: true, messageId: target?.id ?? null }));
  }, [actions]);

  const replyFromActions = useCallback(() => {
    setReplyTo(actions);
    setActions(null);
  }, [actions]);

  const reactFromActions = useCallback(
    (emoji: ReactionEmoji) => {
      const target = actions;
      setActions(null);
      if (target !== null) {
        void toggleReaction(target.id, emoji);
      }
    },
    [actions, toggleReaction],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<(typeof rows)[number]>) => {
      // Call log row: non-interactive inline entry.
      if (item.kind === 'call') {
        return (
          <View style={styles.turn}>
            {item.opensDay ? <DayDivider iso={item.call.created_at} /> : null}
            <CallLogRow call={item.call} />
          </View>
        );
      }

      const { message, mine, first, last, showReceipt, voice, image } = item;
      const stamp = last ? timeOfDay(message.created_at) : undefined;
      // Only reached when `voice` and `image` are unset, which the payload
      // constraint guarantees means the row has a body. The fallback covers a row
      // that somehow has none rather than rendering an empty bubble.
      const text = message.body ?? (image !== undefined ? 'Photo' : 'Voice note');
      const quote =
        message.reply_to_id !== null ? parents.get(message.reply_to_id) : undefined;
      const reactions = tallies.get(message.id);
      // A5: pass primitive props + a stable openActions reference so each bubble
      // can build its own `onLongPress` via useCallback internally, rather than
      // receiving a new per-render closure from renderItem.
      return (
        <View style={[styles.turn, first && styles.turnOpensGroup]}>
          {/* Above the bubble in the cell, which on an inverted list is visually
              above it too, so the divider labels the day it opens rather than
              the day that just ended. */}
          {item.opensDay ? <DayDivider iso={message.created_at} /> : null}
          {mine ? (
            <MyTurn
              message={text}
              timestamp={stamp}
              pending={isPending(message)}
              isNew={isPending(message)}
              quote={quote}
              reactions={reactions}
              voice={voice}
              image={image}
              voicePlayer={voicePlayer}
              messageId={message.id}
              author="You"
              rawBody={message.body}
              onRequestActions={openActions}
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
              message={text}
              initial={initial}
              first={first}
              timestamp={stamp}
              quote={quote}
              reactions={reactions}
              voice={voice}
              image={image}
              voicePlayer={voicePlayer}
              messageId={message.id}
              author={name}
              rawBody={message.body}
              onRequestActions={openActions}
            />
          )}
        </View>
      );
    },
    // openActions is stable (useCallback with empty deps); messageId/author/rawBody
    // are primitives from the row data. No per-render closures over openActions needed.
    [initial, name, openActions, parents, styles, tallies, voicePlayer],
  );

  const header = useCallback(
    () => <PeerTyping initial={initial} name={name} />,
    [initial, name],
  );
  // On an inverted list the footer renders at the visual TOP, so this reserves
  // the frosted bar's height there: the oldest message scrolls clear of the
  // frost instead of resting permanently behind it.
  const footer = useCallback(() => <View style={{ height: barHeight }} />, [barHeight]);
  /**
   * Still resolving covers three cases, not one.
   *
   * `threads === undefined && conversationId === undefined` is the provider side
   * before the conversation list has arrived: the id comes from that list, so
   * without this the screen shows its empty state for a beat and then swaps in a
   * transcript, which reads as the thread having been lost.
   */
  // A brand-new chat (no known thread) has nothing to load: show the "Say hi"
  // empty state the instant the screen mounts rather than a spinner while
  // `open_conversation` creates the row in the background. The transcript spinner
  // is reserved for a KNOWN thread whose messages have NEVER been fetched before
  // (messages === undefined). If React Query has stale cached data, render it
  // immediately — no spinner on a background refetch.
  const loading =
    (conversationId === undefined && threads === undefined) ||
    (knownThread !== undefined && conversationId !== undefined && messages === undefined && messagesPending);
  const empty = !loading && rows.length === 0;

  /**
   * The safe-area inset, applied only while the keyboard is down.
   *
   * RN's iOS `KeyboardAvoidingView` with `behavior="padding"` derives its padding
   * from the keyboard frame, which already reaches the bottom of the screen, so
   * adding `insets.bottom` on top of it floated the composer about 34pt above the
   * raised keyboard on any notched iPhone. Android's `behavior="height"` does not
   * double up, hence the platform check rather than dropping the inset outright.
   */
  const composerInset =
    Platform.OS === 'ios' && keyboardUp ? 0 : insets.bottom + TOKENS.space['2xs'];

  return (
    <View style={styles.root}>
      {/**
       * The header + talk-time strip, now a single frosted overlay.
       *
       * Lifted out of the layout flow (absolute, `zIndex` above the body) so the
       * transcript scrolls *under* it and `Frost`'s real blur has live content to
       * frost — an in-flow bar sits over the page and would frost nothing. This is
       * the top-bar case, not the bottom-nav one: a message bubble is not a
       * full-width touch target, so nothing underneath can steal the bar's taps,
       * and the bar renders last in z-order so its own controls take them. The
       * inverted list reserves `barHeight` at its visual top (a footer spacer, see
       * below) so the oldest message can still scroll clear of the frost.
       */}
      <Frost
        edge="bottom"
        style={[styles.barStack, { paddingTop: insets.top }]}
        onLayout={e => setBarHeight(e.nativeEvent.layout.height)}>
      {/**
       * The header, and it is a restructure rather than a restyle.
       *
       * It used to be a Material Toolbar: a 40pt grey-filled circular back button
       * with a left-aligned 15pt title beside it, which is the single strongest
       * Android tell in the app. The back affordance is now a bare chevron in a
       * transparent target, the way ProvidersScreen already did it and the other
       * three screens did not.
       *
       * The shield is gone as a standalone glyph and safety now lives behind the
       * identity block, which is the arithmetic forcing the decision rather than a
       * preference: back, avatar, video, phone and the token counter come to about
       * 232pt of fixed width on a 360pt screen before the name gets a pixel. Four
       * grey circles in one row is chrome the reference does not have, and a
       * tappable centred identity block is what iOS Messages does anyway.
       *
       * The token counter stays. It is not negotiable independently of the layout:
       * `.maestro/03-token-economy.yaml` taps into this screen and asserts the
       * literal `3 left` on it, and the contract test only greps the testID across
       * all of `src`, so removing it from here would keep jest green and break the
       * only gate that would notice.
       */}
      <View style={styles.header}>
        <Pressable
          onPress={onBack}
          testID="chat-back"
          accessibilityLabel="Back to the directory"
          press="none"
          highlight="ios"
          size={28}
          style={styles.navButton}>
          <Icon name="chevronLeft" size={22} />
        </Pressable>
        {/* One target for the avatar, the name and the presence line. A centred
            identity block that pushes somewhere is what an iOS nav title does.
            The `flex: 1` lives on this wrapper View, not on the Pressable: set on
            the Pressable it reaches an inner view while the touchable hugs
            content, so `identityText`'s flex resolved to zero and the name and
            "Online" clipped to nothing. */}
        <View style={styles.identitySlot}>
        <Pressable
          onPress={() =>
            onOpenProfile !== undefined
              ? onOpenProfile(providerId)
              : setSafety({ open: true, messageId: null })
          }
          testID="open-safety"
          accessibilityLabel={
            onOpenProfile !== undefined ? `${name}. View profile` : `${name}. Block or report`
          }
          accessibilityHint={
            onOpenProfile !== undefined ? 'Opens their profile' : 'Opens safety options'
          }
          press="none"
          highlight="ios"
          style={styles.identity}>
          <Avatar initial={initial} uri={avatarUrl} size={30} online={presence.here} />
          <View style={styles.identityText}>
            <Text testID="chat-title" allowFontScaling numberOfLines={1} style={styles.title}>
              {name}
            </Text>
            {/* Rendered even when it has nothing to say, so the header does not
                change height as presence arrives and goes. `line` is null for
                'hidden' and the empty string keeps the row reserved. */}
            <HeaderSubtitle presence={presence} />
          </View>
        </Pressable>
        </View>
        {/* Rendered and disabled rather than hidden. Migration 011 shipped the
            whole server half of calling, start_call, the per-minute meter, the
            blocking gate, and there is no media layer on the client, so a tap
            would ring a phone that can never connect. Hiding them instead would
            mean the header changes shape on the commit that turns calling on.
            See CALLS_ENABLED in src/api/calls.ts. */}
        {/* Real Pressables, not Views posing as buttons: TalkBack now announces a
            control that actually does something, and the disabled state is an
            honest gate (CALLS_ENABLED) rather than a role that never fires. */}
        <Pressable
          onPress={() => onStartCall?.('video')}
          disabled={!CALLS_ENABLED || sessionEnded}
          testID="call-video"
          accessibilityLabel={`Video call ${name}`}
          press="none"
          size={28}
          style={[styles.navButton, (!CALLS_ENABLED || sessionEnded) && styles.navDisabled]}>
          <Icon name="video" size={20} color={theme.color.text.secondary} />
        </Pressable>
        <Pressable
          onPress={() => onStartCall?.('audio')}
          disabled={!CALLS_ENABLED || sessionEnded}
          testID="call-voice"
          accessibilityLabel={`Voice call ${name}`}
          press="none"
          size={28}
          style={[styles.navButton, (!CALLS_ENABLED || sessionEnded) && styles.navDisabled]}>
          {/* 18, not 20: Lucide's phone glyph fills more of its em vertically than
              the video glyph, so at a matched fontSize it read visibly taller next
              to it (#1). Two points down evens the pair. */}
          <Icon name="call" size={18} color={theme.color.text.secondary} />
        </Pressable>
        <TokenCounter balance={balance} onPress={openRefill} />
      </View>

      {/* Talk-time meter + Recharge (v13). Chat is per-minute now (ADR-0019), so
          this shows how long the balance buys at the chat rate and offers a top-up
          without leaving the thread. Coral-tint when low, quiet otherwise. */}
      {balance !== null ? (
        <View style={[styles.talkBar, isLowBalance(balance) && styles.talkBarLow]}>
          <View style={styles.talkDot} />
          <Text allowFontScaling style={styles.talkText}>
            {talkTimeLeft(balance, DEFAULT_RATES.chat)} of talk time left
          </Text>
          <Pressable
            onPress={openRefill}
            testID="chat-recharge"
            accessibilityLabel="Recharge"
            press="chip"
            style={styles.talkRecharge}>
            <Text allowFontScaling style={styles.talkRechargeLabel}>
              Recharge
            </Text>
          </Pressable>
        </View>
      ) : null}
      </Frost>

      <KeyboardAvoidingView
        style={styles.body}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* The chat wallpaper deferred until after the open animation (A1):
            ~800 View+Text nodes mount after InteractionManager fires so they
            don't compete with SlideInRight for frame budget. The transcript
            sits above it, so the 1-frame delay is invisible. */}
        {wallpaperReady ? <ChatWallpaper /> : null}
        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={theme.color.text.secondary} />
          </View>
        ) : empty ? (
          <View style={styles.empty}>
            <View style={styles.emptyMark}>
              <Avatar initial={initial} uri={avatarUrl} size={56} tone="warm" breathing />
            </View>
            <Text allowFontScaling style={styles.emptyName}>
              {name}
            </Text>
            <Text allowFontScaling style={styles.emptyLine}>
              Say hi 👋
            </Text>
            <View style={styles.starters}>
              {STARTERS.map(s => (
                <Chip key={s.label} label={s.label} tone={s.tone} onPress={onSend} />
              ))}
            </View>
            {/* Also here, not only inside the list. The empty branch *replaces*
                the FlatList, so PeerTyping was unmounted in exactly the case it
                is most wanted: a new peer typing the first message in a thread
                showed nothing at all. */}
            <PeerTyping initial={initial} name={name} />
          </View>
        ) : (
          <FlashList
            data={rows}
            inverted
            // localKey carries the stable key for both message rows and call rows.
            // Message rows use localKey from transcript; call rows use `call-${id}`.
            keyExtractor={r => r.localKey}
            renderItem={renderItem}
            ListHeaderComponent={header}
            ListFooterComponent={footer}
            contentContainerStyle={styles.list}
            keyboardDismissMode="interactive"
            keyboardShouldPersistTaps="handled"
            // Two recycle pools: message bubbles and call-log rows have very
            // different heights and layouts. Keeping them separate prevents
            // FlashList from handing a recycled bubble cell to a call row (or
            // vice versa), which would produce a visible layout jump on scroll.
            getItemType={item => item.kind}
            showsVerticalScrollIndicator={false}
            {...SCROLL_PHYSICS}
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
                onPress={() => requestAnimationFrame(() => setReviewOpen(true))}
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
              <Icon name="close" size={12} color={theme.color.text.positive} />
            </Pressable>
          </View>
        ) : null}

        <NoticeBar />

        {/* What the next send will quote, with a way out. Above the composer
            rather than inside it, so the field's own height behaviour is
            untouched. */}
        {replyTo !== null ? (
          <View style={styles.replyBar}>
            <View style={styles.replyRule} />
            <View style={styles.replyFill}>
              <Text allowFontScaling style={styles.replyAuthor}>
                Replying to {replyTo.author}
              </Text>
              <Text allowFontScaling numberOfLines={1} style={styles.replyBody}>
                {replyTo.body ?? 'Voice note'}
              </Text>
            </View>
            <Pressable
              onPress={() => setReplyTo(null)}
              testID="cancel-reply"
              accessibilityLabel="Cancel reply"
              press="none"
              highlight="ios"
              size={32}
              style={styles.replyClose}>
              <Icon name="close" size={12} color={theme.color.text.secondary} />
            </Pressable>
          </View>
        ) : null}

        {sessionEnded ? (
          <Text allowFontScaling style={styles.sessionEndedText}>
            Out of tokens — recharge to keep talking
          </Text>
        ) : null}

        <View style={{ paddingBottom: composerInset }}>
          <Composer
            onSend={onSend}
            onSendVoice={onSendVoice}
            onSendImage={onSendImage}
            onTyping={notifyTyping}
            disabled={conversationId === undefined || sessionEnded}
            placeholder={replyTo !== null ? 'Reply' : 'Message'}
            bloomKey={bloomKey}
          />
        </View>
      </KeyboardAvoidingView>

      <MessageActionsSheet
        visible={actions !== null}
        onClose={() => setActions(null)}
        mine={actions?.mine ?? false}
        author={actions?.author ?? name}
        body={actions?.body ?? null}
        chosen={
          actions === null
            ? null
            : ownReaction(tallies.get(actions.id), reactionRows ?? [], actions.id, selfId)
        }
        onReact={reactFromActions}
        onReply={replyFromActions}
        onReport={reportFromActions}
      />

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

const makeStyles = (t: Theme) => StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: t.color.bg.base,
  },
  // The frosted top overlay: header + talk strip, lifted above the transcript.
  // zIndex (not elevation) so it paints over the list without an Android drop
  // shadow, which under a translucent bar reads as a smudge.
  barStack: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    // space.xs, not sm: five items plus the counter in one row, and 12pt gaps
    // left the name about 60pt on a 360pt screen.
    gap: TOKENS.space.xs,
    paddingHorizontal: TOKENS.space.md,
    paddingTop: TOKENS.space.xs,
    paddingBottom: TOKENS.space.sm,
    // No hairline here: `Frost edge="bottom"` draws the one edge, so the header
    // stays fully transparent and the blur reads to the bar's bottom lip.
  },
  // The talk-time meter strip under the header. Quiet by default; the low
  // variant borrows the token-tint the balance pill uses so scarcity reads the
  // same everywhere.
  talkBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space.xs,
    // Transparent by default so the frost shows through the strip too, making
    // the header and the meter read as one pane of glass rather than a clear
    // bar stacked on a grey one.
  },
  // Low balance keeps its coral wash: scarcity is the one thing here worth
  // overriding the glass for, and the tint is the same signal the balance pill
  // and the recharge banner use.
  talkBarLow: {
    backgroundColor: t.color.bg.accentTint,
  },
  talkDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.color.bg.accent,
  },
  talkText: {
    ...TOKENS.typography.subhead,
    color: t.color.text.secondary,
    flex: 1,
  },
  talkRecharge: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space['2xs'],
    borderRadius: TOKENS.radius.pill,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.accent,
  },
  talkRechargeLabel: {
    ...TOKENS.typography.labelSmall,
    color: t.color.text.onAccent,
  },
  // Transparent, not a filled grey circle. The 48dp target is met by hitSlop
  // derived from `size`, which is what the Pressable primitive is for.
  navButton: {
    width: 28,
    height: 40,
    borderRadius: TOKENS.radius.xs,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navDisabled: {
    opacity: 0.35,
  },
  emptyMark: {
    paddingBottom: TOKENS.space.xs,
  },
  identitySlot: {
    flex: 1,
  },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
    paddingVertical: 2,
    borderRadius: TOKENS.radius.xs,
    borderCurve: 'continuous',
  },
  identityText: {
    flex: 1,
  },
  title: {
    ...TOKENS.typography.headline,
    color: t.color.text.primary,
  },
  body: {
    flex: 1,
  },
  list: {
    paddingHorizontal: TOKENS.space.md,
    paddingTop: TOKENS.space.md,
  },
  // paddingTop only, and the gap is the one between this row and the older one
  // above it, which is where a group boundary belongs. A symmetric
  // paddingVertical made every gap the same and lost the grouping the `first`
  // flag was already computing for the avatar.
  turn: {
    paddingTop: TOKENS.space['2xs'],
  },
  turnOpensGroup: {
    paddingTop: TOKENS.space.sm,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
    marginHorizontal: TOKENS.space.md,
    marginBottom: TOKENS.space['2xs'],
    paddingVertical: TOKENS.space['2xs'],
  },
  replyRule: {
    width: 2,
    alignSelf: 'stretch',
    borderRadius: 1,
    backgroundColor: t.color.border.strong,
  },
  replyFill: {
    flex: 1,
  },
  replyAuthor: {
    ...TOKENS.typography.labelSmall,
    color: t.color.text.secondary,
  },
  replyBody: {
    ...TOKENS.typography.captionRegular,
    color: t.color.text.tertiary,
  },
  replyClose: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
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
    color: t.color.text.primary,
  },
  emptyLine: {
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.secondary,
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
    backgroundColor: t.color.bg.positive,
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
    color: t.color.text.positive,
  },
  promptClose: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Shown above the composer when the session has been ended by an
  // OUT_OF_TOKENS response, so the member knows why the field is locked.
  sessionEndedText: {
    ...TOKENS.typography.captionRegular,
    color: t.color.text.accent,
    textAlign: 'center',
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space['2xs'],
  },
});
