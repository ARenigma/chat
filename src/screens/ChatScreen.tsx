import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlashList, type FlashListRef, type ListRenderItemInfo } from '@shopify/flash-list';
import {
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { FadeInDown, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { initialOf } from '../lib/display';
import { isPending, PENDING_PREFIX } from '../lib/transcript';
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
import { useKillSwitches } from '../api/appConfig';
import { useSendVoiceNote, useVoicePlayer } from '../api/voice';
import { useSendImage } from '../api/attachments';
import { opensDay, timeOfDay } from '../lib/datetime';
import { voiceOf, type VoiceDraft } from '../lib/voice';
import { imageOf, type ImageDraft } from '../lib/attachments';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
import { DEFAULT_RATES, isLowBalance, talkTimeLeft } from '../lib/rates';
import { ownReaction, tallyByMessage } from '../lib/reactions';
import type { ReactionEmoji } from '../lib/database.types';
import { useStore } from '../store/useStore';
import {
  useActiveSession,
  useEndSession,
  usePendingSessionRequest,
  useSessionLease,
  useSessionRealtime,
} from '../api/sessions';
import { Avatar } from '../components/Avatar';
import { ChatWallpaper } from '../components/ChatWallpaper';
import { FirstMovePills } from '../components/FirstMovePills';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { Composer } from '../components/Composer';
import { ConfirmDialog } from '../components/ConfirmDialog';
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

// ActionTarget is defined and exported from Turn.tsx; imported above.

/**
 * Bounded, length-aware pacing for the sequential opener orchestrator. The beat
 * before each opener is proportional to its length (so a longer greeting reads
 * as typed) but clamped, so a template can neither stall the thread nor flash.
 */
const OPENER_TYPING_MIN_MS = 700;
const OPENER_TYPING_MAX_MS = 2200;
const OPENER_MS_PER_CHAR = 45;
const OPENER_PAUSE_MS = 450;

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
  // Explicit ref so we can force scrollToOffset(0) on every new message.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listRef = useRef<FlashListRef<any>>(null);
  const balance = useStore(s => s.balance);
  const openRefill = useStore(s => s.openRefill);
  const openWallet = useStore(s => s.openWallet);
  const setNotice = useStore(s => s.setNotice);
  const setPeerTyping = useStore(s => s.setPeerTyping);
  const queryClient = useQueryClient();
  const firstSendRefillShown = useRef(false);
  const [sendHaloKey, setSendHaloKey] = useState(0);
  // Drives the dock's frost: composing drops the bar entirely (see the Frost
  // below), leaving a floating capsule over the transcript.
  const [composerFocused, setComposerFocused] = useState(false);
  // The docked emoji panel is sized to the keyboard, so while it is up the dock
  // must not also add the safe-area inset the keyboard-down case needs.
  const [emojiPanelOpen, setEmojiPanelOpen] = useState(false);
  const [leaveDialogVisible, setLeaveDialogVisible] = useState(false);
  // Independent live controls. CALLS_ENABLED remains the compile-time master
  // guard; the admin pair can stop one medium without taking down the other.
  // The same flags are enforced in start_call, so stale client config cannot
  // bypass an operator stop.
  const { data: killSwitches } = useKillSwitches();
  const voiceCallsEnabled =
    (killSwitches?.voice_calls_enabled ?? true) && CALLS_ENABLED;
  const videoCallsEnabled =
    (killSwitches?.video_calls_enabled ?? true) && CALLS_ENABLED;
  // A1: defer ChatWallpaper's ~800 View+Text nodes until the JS thread is idle
  // after the SlideInRight open, so the transition frame budget is not eaten by
  // a synchronous mount. The transcript sits above the wallpaper, so a 1-frame-
  // late wallpaper is invisible to the user. `InteractionManager` is deprecated
  // — idle callback is the RN-sanctioned replacement.
  const [wallpaperReady, setWallpaperReady] = useState(false);
  useEffect(() => {
    const idle = requestIdleCallback(() => {
      setWallpaperReady(true);
    });
    return () => cancelIdleCallback(idle);
  }, []);
  // Which message the safety sheet was opened from, so a report can attach the
  // specific message rather than only the thread.
  const [safety, setSafety] = useState<{ open: boolean; messageId: string | null }>({
    open: false,
    messageId: null,
  });
  // The message the next send replies to. Cleared on send and on cancel, and
  // never persisted: a half-composed reply is not worth surviving a screen.
  const [replyTo, setReplyTo] = useState<ActionTarget | null>(null);
  // Only ever read to decide whether the safe-area inset is already covered by
  // the keyboard's own frame. See the note on the composer wrapper.
  const [keyboardUp, setKeyboardUp] = useState(false);
  // Dismissing the prompt is per-visit, not persisted. A member who says "not
  // now" and comes back tomorrow is a different question from one who said it a
  // second ago, and persisting it would need a key per conversation for a
  // decision worth almost nothing.
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
  const conversationId = knownThread?.conversation_id ?? openedId;
  const { data: messages, isPending: messagesPending } = useMessages(conversationId);
  /**
   * The cutoff for "this bubble just arrived": the moment the screen opened. A
   * message whose `created_at` is after it is a live arrival and animates in
   * (`bubbleArrive`); history — always older — mounts without motion, as does
   * anything later paged in above. Mount time rather than "newest message at
   * load" on purpose: a fresh chat has no conversation yet, so `useMessages` is a
   * disabled query whose `isPending` never resolves, and keying off that left the
   * cutoff unset and the openers un-animated. `useRef(Date.now())` evaluates once,
   * at first render, so it is the open time for both fresh and existing chats.
   */
  const arrivalCutoff = useRef(Date.now());
  const { data: callRecords } = useCalls(conversationId);
  const { data: activeSession } = useActiveSession(conversationId);
  const { data: pendingRequest } = usePendingSessionRequest(conversationId);
  const { mutate: endSessionMutate, isPending: endingSession } = useEndSession();

  useSessionRealtime(conversationId);
  useSessionLease(activeSession ?? null);

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
  const isMemberSide = peerThread?.i_am_member ?? true;
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

  /**
   * Sequential automated openers.
   *
   * Replaces the old all-at-once seed with a cancellable orchestrator that walks
   * the approved opener templates one at a time: show the peer typing, wait a
   * bounded length-aware beat, insert exactly one opener, refresh, pause, and
   * repeat. `insert_next_opener` is idempotent on the server (a per-conversation
   * row lock plus a count cursor), so a remount, a retry, or a process
   * interruption cannot duplicate a message; the loop also stops the moment the
   * thread has any live content. Member-side only — a provider does not greet
   * themselves.
   */
  useEffect(() => {
    if (!isMemberSide) {
      return;
    }
    let cancelled = false;
    // The pending timer is tracked so the cleanup can clear it immediately on
    // unmount rather than waiting for it to fire. Without this, an unmount
    // during a wait leaves a live handle that will call state setters on the
    // gone component, and the Promise never unblocks so the loop leaks until GC.
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;
    const wait = (ms: number) =>
      new Promise<void>(resolve => {
        pendingTimer = setTimeout(() => {
          pendingTimer = undefined;
          resolve();
        }, ms);
      });
    const typingBeat = (body: string | null) =>
      Math.min(
        OPENER_TYPING_MAX_MS,
        Math.max(OPENER_TYPING_MIN_MS, (body?.length ?? 24) * OPENER_MS_PER_CHAR),
      );

    void (async () => {
      // Body of the opener the NEXT step will insert, so the typing beat before
      // it is sized to it. Null on the first step (base beat).
      let upcoming: string | null = null;
      for (;;) {
        if (cancelled) {
          break;
        }
        setPeerTyping(true);
        await wait(upcoming === null ? OPENER_TYPING_MIN_MS : typingBeat(upcoming));
        if (cancelled) {
          break;
        }
        const { data, error } = await supabase.rpc('insert_next_opener', {
          p_provider_id: providerId,
        });
        setPeerTyping(false);
        if (cancelled || error || data === null) {
          break;
        }
        const step = data as {
          conversation_id: string;
          inserted: boolean;
          done: boolean;
          next_body: string | null;
        };
        void queryClient.invalidateQueries({
          queryKey: ['messages', step.conversation_id],
        });
        void queryClient.invalidateQueries({ queryKey: ['conversation-list'] });
        if (!step.inserted || step.done) {
          break;
        }
        upcoming = step.next_body;
        await wait(OPENER_PAUSE_MS);
      }
    })();

    return () => {
      cancelled = true;
      if (pendingTimer !== undefined) {
        clearTimeout(pendingTimer);
        pendingTimer = undefined;
      }
      setPeerTyping(false);
    };
  }, [isMemberSide, providerId, queryClient, setPeerTyping]);

  const memberHasSent = useMemo(
    () =>
      selfId !== undefined &&
      (messages ?? []).some(
        m => m.sender_id === selfId && !m.id.startsWith(PENDING_PREFIX),
      ),
    [messages, selfId],
  );

  const onSend = useCallback(
    async (text: string) => {
      setSendHaloKey(n => n + 1);
      const parent = replyTo;
      setReplyTo(null);
      const wasFirstMemberSend =
        isMemberSide && !memberHasSent && activeSession == null;
      const ok = await send(text, parent?.id ?? null);
      if (ok && wasFirstMemberSend && !firstSendRefillShown.current) {
        firstSendRefillShown.current = true;
        openRefill();
      }
    },
    [send, replyTo, isMemberSide, memberHasSent, activeSession, openRefill],
  );

  /**
   * A recording, sent, and it clears the reply bar for the same reason text does:
   * a reply you composed and then answered with your voice is still a reply.
   *
   * The first-send refill is centralised here (not in useSendVoiceNote) so all
   * three send paths share one guard: provider-side sends and failed/invalid
   * sends return false and never open the modal.
   */
  const onSendVoice = useCallback(
    async (draft: VoiceDraft) => {
      setSendHaloKey(n => n + 1);
      const parent = replyTo;
      setReplyTo(null);
      const wasFirstMemberSend =
        isMemberSide && !memberHasSent && activeSession == null;
      const ok = await sendVoice(draft, parent?.id ?? null);
      if (ok && wasFirstMemberSend && !firstSendRefillShown.current) {
        firstSendRefillShown.current = true;
        openRefill();
      }
    },
    [sendVoice, replyTo, isMemberSide, memberHasSent, activeSession, openRefill],
  );

  /**
   * A picked photo, sent. Clears the reply bar for the same reason text does.
   *
   * Same first-send refill guard as onSendVoice and onSend.
   */
  const onSendImage = useCallback(
    async (draft: ImageDraft) => {
      setSendHaloKey(n => n + 1);
      const parent = replyTo;
      setReplyTo(null);
      const wasFirstMemberSend =
        isMemberSide && !memberHasSent && activeSession == null;
      const ok = await sendImage(draft, parent?.id ?? null);
      if (ok && wasFirstMemberSend && !firstSendRefillShown.current) {
        firstSendRefillShown.current = true;
        openRefill();
      }
    },
    [sendImage, replyTo, isMemberSide, memberHasSent, activeSession, openRefill],
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

    type MessageRow = {
      kind: 'message';
      localKey: string;
      sortAt: string;
      message: (typeof list)[number];
      mine: boolean;
      first: boolean;
      last: boolean;
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
        // opensDay is false here and recomputed in the single pass below.
        opensDay: false,
        // Built here rather than in `renderItem` so its identity is stable across
        // renders and the memo on the bubble still holds. A fresh object literal
        // per render would re-render every row on every playhead tick.
        voice:
          audio === null
            ? undefined
            : ({ messageId: m.id, path: audio.path, durationMs: audio.durationMs, peaks: audio.peaks ?? undefined } as VoiceBody),
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
   * Force offset 0 whenever a new row appears — local optimistic or remote
   * incoming — including while the user is scrolled up reading history.
   *
   * Items 5/12 in the product spec are the same behaviour: "scroll to bottom
   * on send" and "scroll to bottom on receive" share one effect here rather than
   * two separate handlers. The inverted FlashList's resting offset IS 0 (the
   * newest message), so scrollToOffset(0) is the correct call on FlashList v2.
   */
  const prevRowsLen = useRef(0);
  useEffect(() => {
    const len = rows.length;
    if (len > prevRowsLen.current) {
      // FlashList v2 commits its native cells after React publishes `data`.
      // Waiting one frame prevents an offset-0 request from landing against the
      // old layout and becoming a no-op when a batch arrives after invalidation.
      const frame = requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      });
      prevRowsLen.current = len;
      return () => cancelAnimationFrame(frame);
    }
    prevRowsLen.current = len;
  }, [rows]);

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

  // Postgres owns metering. The client only maintains this participant's lease
  // and renders the authoritative request/session state returned by migration
  // 037. There is deliberately no local minute timer or balance mutation.
  const [extendCardDismissed, setExtendCardDismissed] = useState(false);
  // Once the transcript scrolls past the pinned extend card, the recharge
  // talk-bar slides in from the top and the extend card stays away for this
  // visit (Sweprek-style: extend in the header band, recharge replaces it).
  const [extendScrolledAway, setExtendScrolledAway] = useState(false);
  const sessionIsActive = activeSession?.status === 'active';
  // Server pushes 'warning' when time is nearly up; 'grace' during the 30s
  // background grace window. Surface both in the talkBar so the member knows.
  const sessionIsWarning = activeSession?.status === 'warning';
  const sessionIsGrace = activeSession?.status === 'grace';
  // The visible timer must reflect a real, live conversation — not an automated
  // greeting. Gate it on at least one LIVE message from THIS session's provider,
  // on top of the server's authoritative started_at. Automated openers (origin
  // 'automated_opener', session_id null) never count, so the clock cannot start
  // on a seeded "Hey — glad you reached out." before the provider actually replies.
  const hasLiveProviderMessage = useMemo(() => {
    if (activeSession == null) {
      return false;
    }
    return (messages ?? []).some(
      m =>
        m.sender_id === activeSession.provider_id &&
        m.origin === 'live' &&
        m.session_id === activeSession.id,
    );
  }, [messages, activeSession]);
  const sessionStartedAt =
    (sessionIsActive || sessionIsWarning || sessionIsGrace) && hasLiveProviderMessage
      ? activeSession.started_at
      : null;
  const [sessionNow, setSessionNow] = useState(() => Date.now());

  // Display time follows the server's authoritative start timestamp. The local
  // interval only repaints the clock; it never drives billing or balance.
  useEffect(() => {
    if (sessionStartedAt === null) {
      return;
    }
    setSessionNow(Date.now());
    const timer = setInterval(() => setSessionNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [sessionStartedAt]);

  const sessionElapsed =
    sessionStartedAt === null
      ? null
      : Math.max(0, Math.floor((sessionNow - Date.parse(sessionStartedAt)) / 1000));
  const sessionClock =
    sessionElapsed === null
      ? null
      : `${Math.floor(sessionElapsed / 60)}:${String(sessionElapsed % 60).padStart(2, '0')}`;

  // Show a "Need more time?" card when the member has less than 5 minutes of
  // talk time left and an authoritative paid session is active.
  const showExtendCard =
    balance !== null &&
    balance > 0 &&
    balance < 5 * (activeSession?.rate_tokens_per_min ?? DEFAULT_RATES.chat) &&
    sessionIsActive &&
    !extendCardDismissed;

  const showPinnedExtend = showExtendCard && !extendScrolledAway;
  const showStickyRecharge =
    balance !== null && (!showExtendCard || extendScrolledAway);

  useEffect(() => {
    if (!showExtendCard) {
      setExtendScrolledAway(false);
    }
  }, [showExtendCard]);

  const onTranscriptScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      if (!showPinnedExtend) {
        return;
      }
      // Inverted FlashList: offset grows as the user scrolls toward older
      // messages (visual top). Past one card-height, treat extend as out of sight.
      if (e.nativeEvent.contentOffset.y > 64) {
        setExtendScrolledAway(true);
      }
    },
    [showPinnedExtend],
  );

  const endCurrentSession = useCallback(() => {
    if (!activeSession) return;
    endSessionMutate({ sessionId: activeSession.id, reason: 'manual' });
  }, [activeSession, endSessionMutate]);

  /**
   * Back is conditionally intercepted only while a paid session exists. Android
   * recommends enabling a back callback only for the state that needs a decision;
   * ordinary chat navigation remains immediate.
   * https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture
   */
  const requestLeave = useCallback(() => {
    if (!activeSession) {
      onBack();
      return;
    }
    setLeaveDialogVisible(true);
  }, [
    activeSession,
    onBack,
  ]);

  const confirmLeave = useCallback(() => {
    if (!activeSession) {
      setLeaveDialogVisible(false);
      onBack();
      return;
    }
    endSessionMutate(
      // 'manual' is the CHECK-allowed reason for an intentional participant exit
      // (migration 030). A bespoke 'left_chat' string fails the constraint and
      // leaves the user stuck in a billed session.
      { sessionId: activeSession.id, reason: 'manual' },
      {
        onSuccess: () => {
          setLeaveDialogVisible(false);
          onBack();
        },
        onError: () => {
          setLeaveDialogVisible(false);
          setNotice('Could not end session. Check your connection and try again.');
        },
      },
    );
  }, [activeSession, endSessionMutate, onBack, setNotice]);

  useEffect(() => {
    if (!activeSession) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      requestLeave();
      return true;
    });
    return () => sub.remove();
  }, [activeSession, requestLeave]);

  /**
   * WhatsApp gestures: swipe quotes, long-press reacts on the bubble.
   * Report opens SafetySheet directly so a second Modal never stacks.
   */
  const swipeReply = useCallback((target: ActionTarget) => {
    setReplyTo(target);
  }, []);

  const reactOnMessage = useCallback(
    (messageId: string, emoji: ReactionEmoji) => {
      void toggleReaction(messageId, emoji);
    },
    [toggleReaction],
  );

  const reportMessage = useCallback((messageId: string) => {
    setSafety({ open: true, messageId });
  }, []);

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

      const { message, mine, first, voice, image } = item;
      const stamp = timeOfDay(message.created_at);
      const chosen = ownReaction(
        tallies.get(message.id),
        reactionRows ?? [],
        message.id,
        selfId,
      );
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
              onSwipeReply={swipeReply}
              onReact={reactOnMessage}
              onReportMessage={reportMessage}
              chosenReaction={chosen}
              receipt={
                !isPending(message)
                  ? message.read_at !== null
                    ? 'read'
                    : 'sent'
                  : undefined
              }
            />
          ) : (
            <PeerTurn
              message={text}
              // Only live arrivals animate in; history and paged-in rows mount
              // still. See `arrivalCutoff`.
              animate={Date.parse(message.created_at) > arrivalCutoff.current}
              initial={initial}
              avatarUri={avatarUrl}
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
              onSwipeReply={swipeReply}
              onReact={reactOnMessage}
              onReportMessage={reportMessage}
              chosenReaction={chosen}
            />
          )}
        </View>
      );
    },
    [
      avatarUrl,
      initial,
      name,
      parents,
      reactOnMessage,
      reactionRows,
      reportMessage,
      selfId,
      styles,
      swipeReply,
      tallies,
      voicePlayer,
    ],
  );

  const header = useCallback(
    () => <PeerTyping initial={initial} name={name} />,
    [initial, name],
  );
  // On an inverted list the footer renders at the visual TOP, so this reserves
  // the frosted bar's height there: the oldest message scrolls clear of the
  // frost instead of resting permanently behind it. (The extend card is NOT
  // here — a ListFooterComponent on FlashList v2's inverted list does not land
  // at the visual top reliably; the card is pinned inside the Frost header
  // instead, which auto-grows barHeight so this spacer still tracks it.)
  const footer = useCallback(
    () => <View style={{ height: barHeight }} />,
    [barHeight],
  );
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
    (Platform.OS === 'ios' && keyboardUp) || emojiPanelOpen
      ? 0
      : insets.bottom + TOKENS.space['2xs'];

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
          onPress={requestLeave}
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
            <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} testID="chat-title" allowFontScaling numberOfLines={1} style={styles.title}>
              {name}
            </Text>
            {/* Rendered even when it has nothing to say, so the header does not
                change height as presence arrives and goes. `line` is null for
                'hidden' and the empty string keeps the row reserved. */}
            <HeaderSubtitle presence={presence} />
          </View>
        </Pressable>
        </View>
        {/* Rendered and disabled rather than hidden so flipping either admin
            control never changes the header geometry. A pending or live paid
            session also blocks both: start_call enforces one concurrent session
            per pair, so an enabled-looking button there would only return BUSY. */}
        {/* Real Pressables, not Views posing as buttons: TalkBack now announces a
            control that actually does something, and the disabled state is an
            honest gate (CALLS_ENABLED) rather than a role that never fires. */}
        <Pressable
          onPress={() => onStartCall?.('video')}
          disabled={
            !videoCallsEnabled ||
            activeSession !== null ||
            pendingRequest !== null
          }
          testID="call-video"
          accessibilityLabel={`Video call ${name}`}
          press="none"
          size={28}
          style={[
            styles.navButton,
            (!videoCallsEnabled ||
              activeSession !== null ||
              pendingRequest !== null) &&
              styles.navDisabled,
          ]}>
          <Icon name="video" size={20} color={theme.color.text.secondary} />
        </Pressable>
        <Pressable
          onPress={() => onStartCall?.('audio')}
          disabled={
            !voiceCallsEnabled ||
            activeSession !== null ||
            pendingRequest !== null
          }
          testID="call-voice"
          accessibilityLabel={`Voice call ${name}`}
          press="none"
          size={28}
          style={[
            styles.navButton,
            (!voiceCallsEnabled ||
              activeSession !== null ||
              pendingRequest !== null) &&
              styles.navDisabled,
          ]}>
          {/* 18, not 20: Lucide's phone glyph fills more of its em vertically than
              the video glyph, so at a matched fontSize it read visibly taller next
              to it (#1). Two points down evens the pair. */}
          <Icon name="call" size={18} color={theme.color.text.secondary} />
        </Pressable>
        <TokenCounter balance={balance} onPress={openWallet} />
      </View>

      {/* Recharge talk-bar: hidden while the extend card owns the top band;
          slides in from the top once the transcript has scrolled the extend
          card out of sight (or when extend is not eligible). */}
      {showStickyRecharge ? (
        <Animated.View
          entering={FadeInDown.duration(220)}
          exiting={FadeOutUp.duration(160)}
          style={[styles.talkBar, isLowBalance(balance) && styles.talkBarLow]}>
          <View style={styles.talkDot} />
          {sessionClock !== null ? (
            <Text
              allowFontScaling={false}
              testID="chat-session-timer"
              style={styles.talkTimer}>
              {sessionClock}
            </Text>
          ) : null}
          <Text allowFontScaling style={styles.talkText}>
            {talkTimeLeft(
              balance,
              activeSession?.rate_tokens_per_min ?? DEFAULT_RATES.chat,
            )}{' '}
            of talk time left
          </Text>
          {activeSession ? (
            <Pressable
              onPress={endCurrentSession}
              disabled={endingSession}
              testID="chat-end-session"
              accessibilityLabel="End paid session"
              press="chip"
              style={styles.talkRecharge}>
              {endingSession ? (
                <LoadingIndicator size={16} color={theme.color.text.positive} containerColor="transparent" />
              ) : (
                <Text allowFontScaling style={styles.talkRechargeLabel}>
                  End
                </Text>
              )}
            </Pressable>
          ) : null}
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
        </Animated.View>
      ) : null}
      {/* Extend card pinned in the frost (Sweprek size/weight). Recharge bar
          stays hidden until scroll pushes this out of the top band. */}
      {showPinnedExtend ? (
        <View style={styles.extendCard}>
          <View style={styles.extendCardContent}>
            <Text allowFontScaling style={styles.extendCardTitle}>
              Need more time?
            </Text>
            <Text allowFontScaling style={styles.extendCardSubtitle}>
              Extend this match to keep talking
            </Text>
          </View>
          <Pressable
            onPress={openRefill}
            testID="chat-extend-refill"
            accessibilityLabel="Extend talk time"
            press="chip"
            style={styles.extendCardButton}>
            <Text allowFontScaling style={styles.extendCardButtonLabel}>
              Extend
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setExtendCardDismissed(true)}
            testID="chat-extend-dismiss"
            accessibilityLabel="Dismiss extend card"
            press="none"
            highlight="ios"
            size={28}
            style={styles.extendCardClose}>
            <Icon name="close" size={12} color={theme.color.text.secondary} />
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
            <LoadingIndicator size={48} />
          </View>
        ) : empty ? (
          <View style={styles.empty}>
            <View style={styles.emptyMark}>
              <Avatar initial={initial} uri={avatarUrl} size={56} tone="warm" breathing />
            </View>
            <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized} allowFontScaling style={styles.emptyName}>
              {name}
            </Text>
            {/* Also here, not only inside the list. The empty branch *replaces*
                the FlatList, so PeerTyping was unmounted in exactly the case it
                is most wanted: a new peer typing the first message in a thread
                showed nothing at all. */}
            <View style={styles.starters}>
              <PeerTyping initial={initial} name={name} />
            </View>
          </View>
        ) : (
          <FlashList
            ref={listRef}
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
            onScroll={onTranscriptScroll}
            scrollEventThrottle={16}
            // Two recycle pools: message bubbles and call-log rows have very
            // different heights and layouts. Keeping them separate prevents
            // FlashList from handing a recycled bubble cell to a call row (or
            // vice versa), which would produce a visible layout jump on scroll.
            getItemType={item => item.kind}
            showsVerticalScrollIndicator={false}
            {...SCROLL_PHYSICS}
          />
        )}

        <NoticeBar />

        {/* Blush strip sits above the white composer dock so the pills match
            the first-move reference: soft tint behind white capsules, then
            solid chrome for the input row. */}
        {isMemberSide && !loading && !memberHasSent ? (
          <FirstMovePills
            onSendSticker={() => {
              void onSend('👋');
            }}
            onSayHi={() => {
              void onSend('Hi!');
            }}
          />
        ) : null}

        {/* Docked tray: hairline + page chrome, not a floating pill. Reply
            chrome lives in the same surface so the transcript scrolls under
            one bar. */}
        {/* The dock is a frosted glass bar, not a white plate: the transcript
            blurs behind it exactly as Telegram's fixed bottom bar does. `Frost`
            owns the real RenderEffect backdrop blur (the same slot the nav bar and
            header use); the reply chrome and composer render above it in flow, so
            message text over the blur stays fully legible. */}
        {/* The dock carries NO fill of its own, and none at all once the field
            has focus: composing turns the composer into a floating capsule over
            the transcript rather than a bar (Amit, 2026-09-04, "when click to
            type only floating pill and icons.. no bar bg"). `Frost` stays
            mounted at blur 0 rather than being swapped for a plain View — its
            children must remain its children or the blur bakes them in as a
            ghost halo (see Frost's own note). */}
        <Frost
          // No hairline at all. The dock carries no fill, so a top border was
          // drawing a line across the transcript with nothing on the other side
          // of it (Amit, 2026-09-04); the blur alone separates the two.
          tint="none"
          blurAmount={composerFocused ? 0 : 18}
          style={{ paddingBottom: composerInset }}>
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

          <Composer
            onSend={onSend}
            onSendVoice={onSendVoice}
            onSendImage={onSendImage}
            onTyping={notifyTyping}
            disabled={conversationId === undefined}
            placeholder={
              memberHasSent
                ? replyTo !== null
                  ? 'Reply'
                  : 'Message'
                : 'Make your first move'
            }
            sendHaloKey={sendHaloKey}
            onFocusChange={setComposerFocused}
            onPanelChange={setEmojiPanelOpen}
          />
        </Frost>
      </KeyboardAvoidingView>

      <SafetySheet
        visible={safety.open}
        onClose={() => setSafety({ open: false, messageId: null })}
        conversationId={conversationId}
        peerId={providerId}
        peerName={name}
        messageId={safety.messageId}
      />

      <ConfirmDialog
        visible={leaveDialogVisible}
        testID="chat-leave-dialog"
        title="End session and leave?"
        body={
          sessionIsActive
            ? `Your paid session has been running for ${sessionClock ?? '0:00'}.`
            : 'The session is still connecting. Leaving will end it.'
        }
        cancelLabel="Stay"
        confirmLabel="End session"
        destructive
        busy={endingSession}
        busyLabel="Ending session…"
        onCancel={() => setLeaveDialogVisible(false)}
        onConfirm={confirmLeave}
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
  talkTimer: {
    ...TOKENS.typography.numeralMedium,
    color: t.color.text.primary,
    minWidth: 42,
  },
  talkText: {
    ...TOKENS.typography.bodyMedium,
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
    ...TOKENS.typography.labelMediumEmphasized,
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
    paddingVertical: TOKENS.space.hair,
    borderRadius: TOKENS.radius.xs,
    borderCurve: 'continuous',
  },
  identityText: {
    flex: 1,
  },
  title: {
    ...TOKENS.typography.titleMediumEmphasized,
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
    ...TOKENS.typography.labelMediumEmphasized,
    color: t.color.text.secondary,
  },
  replyBody: {
    ...TOKENS.typography.bodySmall,
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
    ...TOKENS.typography.headlineSmallEmphasized,
    color: t.color.text.primary,
  },
  emptyLine: {
    ...TOKENS.typography.bodyLarge,
    color: t.color.text.secondary,
  },
  starters: {
    alignItems: 'center',
    gap: TOKENS.space['2xs'],
    paddingTop: TOKENS.space.xl,
  },
  // "Need more time?" card pinned at the top of the transcript (inverted list
  // footer) when the balance drops under 5 minutes. White card, hairline
  // border, ink pill button — matches the app's card idiom without competing
  // with the coral Recharge chip in the talkBar.
  extendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
    marginHorizontal: TOKENS.space.md,
    marginBottom: TOKENS.space.sm,
    marginTop: TOKENS.space.xs,
    padding: TOKENS.space.sm,
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border.hairline,
    backgroundColor: t.color.bg.raised,
    ...TOKENS.elevation.card,
  },
  extendCardContent: {
    flex: 1,
    gap: TOKENS.space['2xs'],
  },
  extendCardTitle: {
    ...TOKENS.typography.labelMediumEmphasized,
    color: t.color.text.primary,
  },
  extendCardSubtitle: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.secondary,
  },
  extendCardButton: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space['2xs'],
    borderRadius: TOKENS.radius.pill,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.inverse,
  },
  extendCardButtonLabel: {
    ...TOKENS.typography.labelMediumEmphasized,
    color: t.color.text.onInverse,
  },
  extendCardClose: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
