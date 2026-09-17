import React, { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlashList,
  type FlashListRef,
  type ListRenderItem,
  type ListRenderItemInfo,
} from '@shopify/flash-list';
import {
  useWindowDimensions,
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated from 'react-native-reanimated';
import {
  barIn,
  barOut,
  holdScreenEnter,
  onTransitionSettled,
  pageDownIn,
  pageDownOut,
  rowIn,
  transitioning,
} from '../theme/motion';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import {
  ImeGeometryProvider,
  useBarHeight,
  useBodyInset,
  useChatImeStore,
  useComposerFocused,
  useComposerInset,
  useImeStore,
  useListPad,
} from '../lib/imeGeometry';
import { readKeyboardHeight } from '../lib/keyboardPanel';
import { initialOf } from '../lib/display';
import { isPending, PENDING_PREFIX, sessionEndedLabel } from '../lib/transcript';
import {
  canDeleteMessage,
  canEditMessage,
  editedAt,
  isDeleted,
  useConversationId,
  useConversations,
  useDeleteMessage,
  useEditMessage,
  useLiveMessageEdits,
  useMessages,
  useCalls,
  useProfile,
  useProviders,
  useSelfId,
  useOutboxReplay,
  useSendMessage,
} from '../api/chat';
import { useLiveConversation, useMarkRead } from '../api/realtime';
import { useReactions, useToggleReaction } from '../api/reactions';
import { CALLS_ENABLED } from '../api/calls';
import { useKillSwitches } from '../api/appConfig';
import { useSendVoiceNote, useRetryVoiceSend, useVoicePlayer } from '../api/voice';
import { useSendImage, useRetryImageSend } from '../api/attachments';
import { opensDay, timeOfDay } from '../lib/datetime';
import { voiceOf, type VoiceDraft } from '../lib/voice';
import { imageOf, type ImageDraft } from '../lib/attachments';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { readPresence } from '../lib/presence';
import { SCROLL_PHYSICS } from '../lib/scroll';
/*
 * `DEFAULT_RATES`, `isLowBalance`, `estimatedTalkSeconds` and `formatMinutes`
 * are all gone from this screen as of 2026-09-07, and they went together
 * because they were one feature: the whole-minutes talk-time estimate the bar
 * used to show above the five-minute mark. With the bar reduced to the
 * countdown alone there is nothing left that needs to guess at minutes from a
 * balance and a rate, so the imports go rather than sitting here looking
 * load-bearing. They all still exist for their other callers.
 */
import {
  clockTickMs,
  formatClock,
  secondsRemainingNow,
  showsCountdown,
} from '../lib/sessionClock';
import { useBackBarrier, useBackGuard } from '../lib/backGuard';
import { ownReaction, tallyByMessage } from '../lib/reactions';
import type { ReactionEmoji } from '../lib/database.types';
import { useStore } from '../store/useStore';
import {
  useActiveSession,
  useSessionEvents,
  useAnnounceChatOpen,
  useConfirmChatSession,
  useDeclineSessionRequest,
  useEndSession,
  useChatConsent,
  usePendingSessionRequest,
  useResumeChatConsent,
  useSessionLease,
  useSessionRealtime,
} from '../api/sessions';
import { useEarnings } from '../api/provider';
import { Avatar } from '../components/Avatar';
import { Badge } from '../components/Badge';
import { ChatWallpaper } from '../components/ChatWallpaper';
import { FirstMovePills } from '../components/FirstMovePills';
import { LoadingIndicator } from '../components/LoadingIndicator';
import { Composer, TELEGRAM_ISLAND_INSET } from '../components/Composer';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DayDivider } from '../components/DayDivider';
import { Frost } from '../components/Frost';
import { Button } from '../components/Button';
import { Icon, type IconName } from '../components/Icon';
import { NoticeBar } from '../components/NoticeBar';
import { HeaderSubtitle } from '../components/HeaderSubtitle';
import { MediaViewer } from '../components/MediaViewer';
import { PeerTyping } from '../components/PeerTyping';
import { Pressable } from '../components/Pressable';
import { TokenCounter } from '../components/TokenCounter';
import { CallLogRow } from '../components/CallLogRow';
import { SystemMessageRow } from '../components/SystemMessageRow';
import { MyTurn, PeerTurn, type ActionTarget, type ImageBody, type Quote, type VoiceBody } from '../components/Turn';
import { Sheet } from '../components/Sheet';
import { M3Field } from '../components/TextField';
import { SafetySheet } from './SafetySheet';
import { RenameChatSheet } from '../components/RenameChatSheet';
import { useConversationLabels } from '../api/conversationLabels';
import { clearChatDraft } from '../lib/chatDraft';

/*
 * The transcript's two row shapes, at module scope rather than inside the
 * `rows` useMemo, so the `Transcript` leaf at the foot of this file can name
 * what it renders. Same shapes, moved.
 */
type Message = NonNullable<ReturnType<typeof useMessages>['data']>[number];
type CallRecord = NonNullable<ReturnType<typeof useCalls>['data']>[number];

type MessageRow = {
  kind: 'message';
  localKey: string;
  sortAt: string;
  message: Message;
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
  call: CallRecord;
  opensDay: boolean;
};

/** A centered "system message" — a session boundary or notice, not a bubble. */
type SystemRow = {
  kind: 'system';
  localKey: string;
  sortAt: string;
  text: string;
  icon?: IconName;
  opensDay: boolean;
};

export type TranscriptRow = MessageRow | CallRow | SystemRow;

/** A hold that was never taken, so the release is a no-op. */
const NO_HOLD = (): void => undefined;

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
  /**
   * Open the provider's earnings ledger. Only meaningful on the provider tree
   * (where the peer is a member). When absent the TokenCounter onPress falls
   * back to openWallet.
   */
  onOpenEarnings?: () => void;
}

// ActionTarget is defined and exported from Turn.tsx; imported above.

/**
 * Bounded, length-aware pacing for the sequential opener orchestrator. The beat
 * before each opener is proportional to its length (so a longer greeting reads
 * as typed) but clamped, so a template can neither stall the thread nor flash.
 */
/**
 * The header handset, one step under `icon.md`, for an optical reason.
 *
 * Measured on the Redmi at density 440: at the same `size` token the video
 * glyph inks 19.3 x 19.3dp and the handset 19.6 x 20.0dp, so equal sizes give
 * unequal ink and the call control read as the bigger of the pair (Amit spotted
 * it). 19 brings the handset to ~19.0dp and the two to within 0.3dp.
 *
 * Named rather than inline because the icon-scale gate requires it: a raw
 * number is indistinguishable from a drift, and a name can carry its reason.
 */
const CALL_GLYPH_SIZE = 19;

/*
 * How far (dp) the inverted transcript must be scrolled from the newest
 * message before a new incoming row counts as "missed" instead of
 * triggering the usual scroll-to-bottom (2026-09-17 audit). Deliberately
 * more forgiving than the extend card's own 64dp: that threshold decides
 * whether a pinned card is still in view, this one decides whether the
 * member is genuinely reading history versus glancing at the last couple
 * of bubbles, so it wants a bigger margin before it starts withholding
 * the auto-scroll a member sitting near the bottom still expects.
 */
const PAGE_DOWN_THRESHOLD = 200;

const OPENER_TYPING_MIN_MS = 700;
const OPENER_TYPING_MAX_MS = 2200;
const OPENER_MS_PER_CHAR = 45;
const OPENER_PAUSE_MS = 450;

/**
 * The height the header's identity column always reserves: the name's line box
 * plus the presence line's, whether or not there is a presence line to show.
 *
 * Material 3 reserves top-app-bar height on the CONTAINER, not with a blank
 * subtitle row. `TopAppBarLayout` composes the title as a two-child `Column`
 * only `if (subtitle != null)` and a single `Box` otherwise, and `placeTopAppBar`
 * then centres BOTH the navigation icon and the whole title block:
 * `y = (contentHeight - navigationIconPlaceable.height) / 2` and
 * `Arrangement.Center -> (contentHeight - titlePlaceable.height) / 2`
 * (androidx.compose.material3 AppBar.kt). The bar's own floor is
 * `AppBarSmallTokens.ContainerHeight = 64.dp`.
 *
 * Reserving it here, on the column, rather than only on the bar buys the same
 * fixed height AND lets the single-line state centre on the avatar, which a
 * reserved blank line cannot do: an always-rendered empty presence row pinned
 * the name's cap band 8dp above the 30dp avatar's centre, which is the defect
 * this fixes.
 *
 * Multiplied by `fontScale` at the call site rather than baked in: the title is
 * capped at 1.5 (ADR-0024) and the presence line is uncapped, so `40 * s` is
 * exactly the two-line content height for every s <= 1.5 and a safe upper bound
 * above it. Either way the column is the same height in both presence states, so
 * the bar cannot change height as presence arrives and goes.
 */
const IDENTITY_LINES =
  TOKENS.typography.titleMediumEmphasized.lineHeight +
  TOKENS.typography.labelMedium.lineHeight;

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
/** Stable empty default for the labels map, so an unlabelled chat never re-renders. */
const EMPTY_LABELS: ReadonlyMap<string, string> = new Map();

/**
 * What a deleted message says, to each side of it.
 *
 * WhatsApp's two sentences verbatim, because the split is the point rather than
 * the wording: the author is told what THEY did, and the other person is told
 * that something was taken back without being told who by — which is already
 * obvious from the side the bubble is on, and is not obvious at all if the app
 * writes "they deleted this" into a thread somebody is scrolling back through.
 *
 * Both are statements, not blanks. A row that simply disappeared from the other
 * person's scrollback is the failure mode migration 103's tombstone exists to
 * prevent.
 */
function tombstoneText(mine: boolean): string {
  return mine ? 'You deleted this message' : 'This message was deleted';
}

export function ChatScreen({ providerId, onBack, onStartCall, onOpenProfile, onOpenEarnings }: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // `fontScale` is "the scale of the font currently used", and the hook
  // "automatically updates all of its values when screen size or font scale
  // changes" — the documented reactive source for the header's height
  // reservation. https://reactnative.dev/docs/usewindowdimensions
  const { height: winH, fontScale } = useWindowDimensions();
  // Explicit ref so we can force scrollToOffset(0) on every new message.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listRef = useRef<FlashListRef<any>>(null);
  const openRefill = useStore(s => s.openRefill);
  const openWallet = useStore(s => s.openWallet);
  // Providers see their earnings in the header instead of the member wallet.
  const { data: earnings } = useEarnings();
  const setNotice = useStore(s => s.setNotice);
  const setPeerActivity = useStore(s => s.setPeerActivity);
  const queryClient = useQueryClient();
  const [sendHaloKey, setSendHaloKey] = useState(0);
  const [leaveDialogVisible, setLeaveDialogVisible] = useState(false);
  // The same dialog serves back (end and leave) and the End chip (end, stay).
  const [leaveIntent, setLeaveIntent] = useState<'leave' | 'end'>('leave');
  // Independent live controls. CALLS_ENABLED remains the compile-time master
  // guard; the admin pair can stop one medium without taking down the other.
  // The same flags are enforced in start_call, so stale client config cannot
  // bypass an operator stop.
  const { data: killSwitches } = useKillSwitches();
  const voiceCallsEnabled =
    (killSwitches?.voice_calls_enabled ?? true) && CALLS_ENABLED;
  const videoCallsEnabled =
    (killSwitches?.video_calls_enabled ?? true) && CALLS_ENABLED;
  // A1 / W5#6: defer ChatWallpaper's ~800 View+Text nodes until the push
  // transition settles AND the JS thread is idle. `onTransitionSettled` fires
  // after `setTransitioning(false)` in App.tsx's PushedLayer (the call site
  // that writes the flag — see the W5#6 note in src/theme/motion.ts).
  // `requestIdleCallback` is the unconditional fallback: if the write side has
  // not yet been wired, the idle slot fires anyway so the wallpaper is never
  // permanently stranded. Whichever fires first wins; the guard (`fired`) stops
  // a second call from triggering a redundant re-render.
  const [wallpaperReady, setWallpaperReady] = useState(false);
  useEffect(() => {
    let fired = false;
    const settle = () => {
      if (!fired) {
        fired = true;
        setWallpaperReady(true);
      }
    };
    const unsubscribe = onTransitionSettled(settle);
    const idle = requestIdleCallback(settle);
    return () => {
      unsubscribe();
      cancelIdleCallback(idle);
    };
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
  /*
   * The message being edited, and the draft of its new text (migration 103).
   *
   * A SHEET rather than the composer, and that is a constraint rather than a
   * preference: `Composer` owns its draft in local state with no way in
   * ("Composition state is local, lifting the draft into the store would
   * re-render every subscriber on each keystroke"), so there is no prop that
   * seeds it with the text being edited. WhatsApp edits inline; doing that here
   * means giving the composer a controlled value, which is a change to a
   * component this one does not own.
   */
  const [editing, setEditing] = useState<ActionTarget | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  /** The message a confirmed tap on Delete would remove. Null when closed. */
  const [deleting, setDeleting] = useState<ActionTarget | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  // The photo the full-screen viewer is showing, or null when it is closed.
  // Held by the screen and not by the bubble: a Modal inside a FlashList cell
  // unmounts when the list recycles that cell, which happens while messages
  // arrive — so a viewer owned by the bubble would vanish mid-look.
  const [viewerImage, setViewerImage] = useState<ImageBody | null>(null);
  // Dismissing the prompt is per-visit, not persisted. A member who says "not
  // now" and comes back tomorrow is a different question from one who said it a
  // second ago, and persisting it would need a key per conversation for a
  // decision worth almost nothing.
  /*
   * The IME's geometry — keyboard, panel, dock and bar heights, and the five
   * numbers derived from them — lives in a screen-scoped store, not in this
   * component's state. A keyboard show used to re-render all 1858 lines of this
   * screen, twice, to move two numbers. See src/lib/imeGeometry.ts, which also
   * carries the measured 96px/34dp note that used to sit over `imeSpace` here.
   *
   * This screen holds the HANDLE and subscribes to nothing. Only the four leaf
   * components at the bottom of this file read a value. Calling `useBodyInset()`
   * or its siblings from this body would silently restore the full re-render,
   * so a contract test asserts that none of them appear here.
   */
  const ime = useChatImeStore({
    insetBottom: insets.bottom,
    winH,
    seedKeyboardHeight: readKeyboardHeight(false),
  });
  const onComposerFocus = useCallback(
    (v: boolean) => ime.getState().set({ composerFocused: v }),
    [ime],
  );
  const onPanelChange = useCallback(
    (v: boolean) => ime.getState().set({ emojiPanelOpen: v }),
    [ime],
  );
  const onPanelSearchChange = useCallback(
    (v: boolean) => ime.getState().set({ emojiSearching: v }),
    [ime],
  );

  useProfile();
  const { data: selfId } = useSelfId();
  const { data: providers } = useProviders();
  const { data: threads, isError: threadsError, refetch: refetchThreads } = useConversations();

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
  const {
    data: messages,
    isPending: messagesPending,
    isError: messagesError,
    refetch: refetchMessages,
  } = useMessages(conversationId);

  /*
   * Hold the push animation until this screen has its transcript.
   *
   * Telegram's rule, and the reason it feels smoother at the same refresh rate:
   * a screen is animated in when it has DATA, not when it has geometry. See
   * `holdScreenEnter` for the citations and the measured gap.
   *
   * Taken in RENDER via a `useState` initialiser, so it runs exactly once and
   * before the parent's `onLayout` — a hold taken in an effect would arrive
   * after the animation had already started. It is only taken when there is
   * genuinely nothing to show: with a warm React Query cache `messages` is
   * already an array on the first render and the push is never delayed.
   *
   * Released three ways, and it has to be all three: when the transcript
   * arrives, when the conversation turns out to be new and empty (there is no
   * data coming, so waiting for it would burn the whole ceiling), and on
   * unmount — a hold left standing by a screen the user backed out of would
   * make the NEXT push wait.
   */
  const [releaseEnter] = useState(() =>
    messages === undefined ? holdScreenEnter() : NO_HOLD,
  );
  useEffect(() => releaseEnter, [releaseEnter]);
  useEffect(() => {
    if (messages !== undefined || !messagesPending) {
      releaseEnter();
    }
  }, [messages, messagesPending, releaseEnter]);
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
  // `dataUpdatedAt` is the instant the server's snapshot was taken — the only
  // moment `seconds_remaining` was exactly right, and what it is aged from.
  const { data: activeSession, dataUpdatedAt: sessionSyncedAt } = useActiveSession(conversationId);
  const { data: sessionEvents } = useSessionEvents(conversationId);
  const { data: pendingRequest } = usePendingSessionRequest(conversationId);
  const { data: chatConsent } = useChatConsent(conversationId);
  const resumeConsent = useResumeChatConsent();
  const { mutate: endSessionMutate, isPending: endingSession } = useEndSession();
  const confirmChat = useConfirmChatSession();
  const declineChatRequest = useDeclineSessionRequest();

  useSessionRealtime(conversationId);
  useSessionLease(activeSession ?? null);

  const { notifyTyping, notifyRecording, notifyRecordingEnded } =
    useLiveConversation(conversationId, selfId);
  useMarkRead(conversationId, selfId);
  const send = useSendMessage(conversationId, selfId);
  /*
   * Replay anything the persisted outbox still holds for this thread — a send
   * that was in flight when the app was killed, or one that failed while
   * offline. Safe because every entry carries its original nonce, so a replay
   * of a send that actually landed is collapsed by migration 081 instead of
   * duplicating.
   */
  useOutboxReplay(conversationId, send);
  /*
   * `send` behind a ref for the retry tap. Taking it as a `renderItem`
   * dependency would rebuild renderItem whenever its identity changed and
   * re-render every bubble in the thread; a retry does not need to be reactive,
   * it needs to be current when tapped.
   */
  const sendRef = useRef(send);
  sendRef.current = send;
  const sendVoice = useSendVoiceNote(conversationId, selfId);
  const sendImage = useSendImage(conversationId, selfId);
  // Retry-only siblings: the object already uploaded and only
  // send_message_idempotent failed, so retrying is the RPC alone (2026-09-17
  // audit). See useRetryImageSend / useRetryVoiceSend for why this is safe
  // within a session even though outbox.ts does not replay media across one.
  const retryImage = useRetryImageSend(conversationId, selfId);
  const retryVoice = useRetryVoiceSend(conversationId, selfId);
  /**
   * One playhead for the whole transcript, because the recorder exposes one
   * player object. Held here rather than per bubble so starting a second note
   * cannot leave the first one believing it is still playing, and so leaving the
   * screen stops the audio.
   */
  const voicePlayer = useVoicePlayer();
  const editMessage = useEditMessage(conversationId);
  const deleteMessage = useDeleteMessage(conversationId);
  /*
   * An edit or a delete made on the OTHER device lands here. `useLiveConversation`
   * above already receives the UPDATE and reads only `read_at` off it; this is
   * the rest of that event, on its own channel — see the hook's own note for why
   * it is not one line in `src/api/realtime.ts`.
   */
  useLiveMessageEdits(conversationId, selfId);

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
  /*
   * 082. `consentDeclined` suppresses the prompt entirely.
   *
   * Without it the member was re-asked on every exchange: a decline marked one
   * REQUEST refused, their next message created a fresh one, and the provider's
   * next reply re-armed it. The member meant "no session in this conversation",
   * which is a fact about the conversation, so that is where it now lives.
   */
  const consentDeclined = chatConsent?.declined === true;
  const awaitingMemberConsent =
    isMemberSide &&
    !consentDeclined &&
    pendingRequest != null &&
    pendingRequest.channel === 'chat' &&
    pendingRequest.responded_at != null &&
    activeSession == null;
  /*
   * Declined, and no session running: the composer closes and an explicit
   * "Start session" takes its place. Not a prompt — a control the member
   * reaches for when they want it.
   */
  const offerExplicitStart = isMemberSide && consentDeclined && activeSession == null;
  const theyOpenedTheChat =
    pendingRequest != null &&
    selfId != null &&
    pendingRequest.initiator_id !== selfId;
  /*
   * `spJoining` was deleted on 2026-09-13 with the placeholder ladder that was
   * its only reader. The state it described — a chat request sent and not yet
   * answered — is still shown, by the header's presence line and the pending
   * request row; it just no longer also retitles the text field.
   */
  const provider = providers?.find(p => p.id === providerId);
  /*
   * What this provider offers (migration 064), folded into the operator's own
   * switches. Two different refusals with two different remedies: a kill switch
   * is ours and the member can only wait, a channel switch is theirs and the
   * member can pick another one. The button is disabled either way; only the
   * second is worth explaining, which ProviderDetailScreen does.
   *
   * Defaults to true: on the PROVIDER's side of a thread the peer is a member
   * and has no directory row at all, and a missing row must never read as
   * "offers nothing".
   */
  const peerOffersChat = provider?.chat_enabled ?? true;
  const canStartAudio = voiceCallsEnabled && (provider?.audio_enabled ?? true);
  const canStartVideo = videoCallsEnabled && (provider?.video_enabled ?? true);
  /*
   * The composer closes only when a NEW chat session would be refused: the
   * trigger fires on INSERT into session_requests, so a session already live or
   * a request already pending runs to its end. Turning chat off is a statement
   * about the next conversation, not a way to walk out of this one.
   */
  /*
   * Tell the other person this chat was just opened (goal items 3 and 4).
   *
   * The server decides whether that is worth a push — the member must hold a
   * minute whoever opened, the peer must be away, no session may be live, and
   * a cooldown must have passed — and answers with what it actually did. The
   * banner below renders only `alerted: true`, so it can never claim a
   * notification that was not sent.
   */
  const openAlert = useAnnounceChatOpen(conversationId, conversationId !== undefined);

  /*
   * When we actually pinged an away peer (`alerted: true` — a real push went
   * out, gated server-side on presence/balance/cooldown), drop a one-time
   * SYSTEM MESSAGE into the transcript confirming it, in addition to the
   * persistent "knows you are here" bar below. Amit (2026-09-16): the member
   * should be told the provider has been notified and will join soon, in the
   * thread itself. Stamped once per open so the row does not resort on every
   * render; ephemeral (client-only, no DB row) because it is a confirmation of
   * the just-taken action, not durable history.
   */
  const [notifiedAt, setNotifiedAt] = useState<string | null>(null);
  useEffect(() => {
    if (openAlert?.alerted === true && notifiedAt === null) {
      setNotifiedAt(new Date().toISOString());
    }
  }, [openAlert?.alerted, notifiedAt]);

  const { data: conversationLabels = EMPTY_LABELS } = useConversationLabels();
  const [renaming, setRenaming] = useState(false);

  const chatClosed =
    isMemberSide && !peerOffersChat && activeSession === null && pendingRequest === null;
  /*
   * Cold open: `threads` and `providers` are both undefined for the first frames
   * after launch or a deep link, so the name has no source yet. Falling straight
   * to the literal 'Conversation' made the header flash that wrong word before
   * the real name arrived. Assert it ONLY once the sources have actually resolved
   * — while either is still loading the title is blank (the bar reserves its
   * height regardless, so nothing shifts), and the real name fades in the moment
   * `peer_display_name` or the directory row lands. 'Conversation' is then the
   * genuine dead-end (no summary row and no directory entry), which effectively
   * never happens because every thread has a peer.
   */
  const nameFromData = peerThread?.peer_display_name ?? provider?.display_name;
  const identityLoading = threads === undefined || providers === undefined;
  const peerName = nameFromData ?? (identityLoading ? '' : 'Conversation');
  // A private custom label (migration 098) overrides the peer's name in this
  // person's own header, but only theirs — resolved client-side so the shared
  // conversation view is untouched. Long-pressing the header renames it.
  const customLabel =
    conversationId !== undefined ? conversationLabels.get(conversationId) : undefined;
  const name = customLabel ?? peerName;

  /*
   * When a session this member was in ends, ask how it went (goal item 14).
   *
   * Watches for the transition rather than for the absence: `activeSession` is
   * null before a session exists too, and asking then would prompt for a
   * conversation that never happened. The ref remembers the last LIVE session,
   * so the trigger fires once, on the edge.
   *
   * Member side only — a provider rating a member is a different feature with
   * different consequences (006's rule, kept).
   */
  const liveSessionRef = useRef<string | null>(null);
  const requestReview = useStore(s => s.requestReview);
  useEffect(() => {
    const live =
      activeSession != null && activeSession.ended_at === null ? activeSession.id : null;
    const previous = liveSessionRef.current;
    if (live !== null) {
      liveSessionRef.current = live;
      return;
    }
    if (previous !== null) {
      liveSessionRef.current = null;
      // `name` is blank only in the cold-open loading window (identity not
      // resolved). A session cannot end before its own thread has loaded, so
      // this is theoretical — but a blank name in the review sheet is worse than
      // deferring, and the review is re-driven off the same edge if it recurs.
      if (isMemberSide && name !== '') {
        requestReview(previous, name);
      }
    }
  }, [activeSession, isMemberSide, name, requestReview]);
  const initial = initialOf(peerName);
  const avatarUrl = peerThread?.peer_avatar_url ?? provider?.avatar_url ?? null;

  /**
   * One presence value, read from one place, so the header's layout does not have
   * to change when the source does.
   *
   * It used to be `selectPeerOnline`, fed by a Realtime presence channel, which
   * answers "is their app in the foreground": a question nobody agreed to have
   * answered about them. It was then `peer_presence`, the declaration 012 added,
   * and since 2026-09-17 it is the master switch again — the declaration is
   * gone rather than merged, which is what makes that honest (src/lib/presence.ts).
   *
   * THE MEMBER SIDE STILL PUBLISHES NOTHING, and this is the same fact 012 was
   * reaching for: a member has no listing switch, so `peer_available` is false
   * for one by construction. Passing that through would tell a provider that the
   * person they are talking to is away, which is a claim about a human being
   * that nobody made. Null instead, and the header renders the name alone.
   *
   * The directory fallback covers a conversation opened from the rail before the
   * first message creates a thread row, and is a provider by definition.
   */
  const presence = readPresence(
    peerThread !== undefined
      ? peerThread.peer_is_provider
        ? peerThread.peer_available
        : null
      : provider?.is_available,
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
        setPeerActivity('typing');
        await wait(upcoming === null ? OPENER_TYPING_MIN_MS : typingBeat(upcoming));
        if (cancelled) {
          break;
        }
        const { data, error } = await supabase.rpc('insert_next_opener', {
          p_provider_id: providerId,
        });
        setPeerActivity(null);
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
      setPeerActivity(null);
    };
  }, [isMemberSide, providerId, queryClient, setPeerActivity]);

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
      await send(text, parent?.id ?? null);
    },
    [send, replyTo],
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
      await sendVoice(draft, parent?.id ?? null);
    },
    [sendVoice, replyTo],
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
      await sendImage(draft, parent?.id ?? null);
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

    /*
     * Ended-chat-session rows, sorted into the transcript at their end time
     * like call logs.
     *
     * CHAT SESSIONS ONLY, and that is not an omission: a call already produces
     * its own row from the `calls` table via `CallLogRow`, which carries the
     * medium, the duration and the time — and the outcomes a session row cannot
     * express, since a declined or missed call has no `paid_sessions` row at
     * all. Feeding call sessions in here as well would print every connected
     * call twice.
     *
     * So the two ARE separate line items, which is what Amit asked for
     * (2026-09-13) — they just come from different tables, because the two
     * things being recorded are different: a session that was billed, and a
     * call that was attempted.
     *
     * `heart` is the mark. CallLogRow puts a call/video glyph in the same pill
     * slot, so the chat row having none was the visible half of these reading
     * as two features rather than one history.
     */
    const systemRows: SystemRow[] = (sessionEvents ?? []).map(e => ({
      kind: 'system' as const,
      localKey: `session-${e.id}`,
      sortAt: e.ended_at,
      text: sessionEndedLabel(e.minutes_billed, e.ended_at),
      icon: 'heart' as const,
      opensDay: false,
    }));

    // A one-time confirmation that we pinged the away peer (see `notifiedAt`).
    // Same SystemRow shape as a session boundary, so the day-divider and
    // run-break passes below treat it correctly with no special-casing.
    const alertRows: SystemRow[] =
      notifiedAt !== null && name !== ''
        ? [
            {
              kind: 'system' as const,
              localKey: 'peer-notified',
              sortAt: notifiedAt,
              text: `${name} has been notified. They'll join you here soon.`,
              icon: 'bell' as const,
              opensDay: false,
            },
          ]
        : [];

    // Merge and sort newest-first (matches the inverted FlashList).
    const sorted = [...messageRows, ...callRows, ...systemRows, ...alertRows].sort(
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

    /*
     * A RUN BREAKS ON ANYTHING THAT VISUALLY SEPARATES TWO BUBBLES, not just on
     * a change of speaker.
     *
     * `first`/`last` were computed up in messageRows.map() against adjacent
     * MESSAGES only — `older.sender_id !== m.sender_id` and nothing else. So a
     * message could be the start of a visual run and not be marked as one:
     * send something today after sending something last week and the two are
     * "the same run", because the sender never changed. A day divider and a
     * "Session ended" row sat between them on screen and counted for nothing.
     *
     * What that looked like (Amit, 2026-09-12: "why does the hi bubble not have
     * a tail when its first msg of that session?"): the tail is drawn on the
     * oldest bubble of a run, so today's first message had no tail, while a
     * message from thirteen days earlier kept one. WhatsApp, which this grouping
     * is taken from, restarts the tail after a date separator — a new day is a
     * new run, and so is a session boundary.
     *
     * Recomputed HERE rather than up there because only this pass — after the
     * merge and sort — knows a row's true older neighbour regardless of kind.
     * That is the same reason `opensDay` moved down here.
     */
    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i];
      if (row === undefined || row.kind !== 'message') continue;
      const older = sorted[i + 1];
      const newer = sorted[i - 1];
      row.first =
        older === undefined ||
        older.kind !== 'message' ||
        older.message.sender_id !== row.message.sender_id ||
        // The divider belongs to the row it opens, so a row that opens a day is
        // always the start of a run.
        row.opensDay;
      row.last =
        newer === undefined ||
        newer.kind !== 'message' ||
        newer.message.sender_id !== row.message.sender_id ||
        // ...and the row below a divider closes the run it was in.
        newer.opensDay;
    }

    return sorted;
  }, [messages, selfId, callRecords, sessionEvents, notifiedAt, name]);

  /*
   * Scroll to bottom for MY OWN send; for anything else, only if already
   * near the bottom — otherwise count it and let the page-down button say
   * so (2026-09-17 audit, Amit's call on the Telegram-parity sweep).
   *
   * This replaces the previous rule (force offset 0 on ANY new row,
   * including while scrolled up reading history), which items 5/12 in the
   * product spec were read as requiring. Telegram's own rule is narrower —
   * `if (obj.isOut() && obj.wasJustSent) { scrollToLastMessage(true, false);
   * return; }`, ChatActivity.java — and increments a page-down badge for
   * everything else. `rows[0].mine` (message rows only; a call record or
   * system row is nobody's "own send") is this app's equivalent of
   * `isOut() && wasJustSent`: the only way a row I sent can newly appear at
   * the front of a newest-first list is that I just sent it.
   */
  const [scrolledAwayFromLatest, setScrolledAwayFromLatest] = useState(false);
  const scrolledAwayFromLatestRef = useRef(false);
  const [unreadBelow, setUnreadBelow] = useState(0);

  const scrollToLatest = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setUnreadBelow(0);
  }, []);

  const prevRowsLen = useRef(0);
  useEffect(() => {
    const len = rows.length;
    if (len > prevRowsLen.current) {
      prevRowsLen.current = len;
      const newest = rows[0];
      const mine = newest?.kind === 'message' && newest.mine;
      if (!mine && scrolledAwayFromLatestRef.current) {
        // Not mine, and the member is reading history: say so, don't yank.
        setUnreadBelow(n => n + 1);
        return;
      }
      setUnreadBelow(0);
      // W5#6: a message arriving during a push transition triggers scrollToOffset
      // + FlashList re-layout mid-animation. Gate on the lock and defer to after
      // the transition settles. Safety: if setTransitioning(false) is never called
      // (App.tsx PushedLayer write side not yet wired), the else branch runs the
      // scroll immediately — no insert is ever permanently stranded.
      if (transitioning.value) {
        return onTransitionSettled(() => {
          // FlashList v2: wait one frame after the settle so cells are committed.
          requestAnimationFrame(() => {
            listRef.current?.scrollToOffset({ offset: 0, animated: true });
          });
        });
      }
      // FlashList v2 commits its native cells after React publishes `data`.
      // Waiting one frame prevents an offset-0 request from landing against the
      // old layout and becoming a no-op when a batch arrives after invalidation.
      const frame = requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: true });
      });
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
        // A reply outlives its parent's deletion — `reply_to_id` is not touched
        // by delete_message — so the quote has to say what became of it rather
        // than render the blank line a null body would give. Same sentence the
        // tombstone itself uses, so the two read as one fact.
        body: isDeleted(m) ? tombstoneText(m.sender_id === selfId) : m.body,
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

  // What the balance still buys, aged locally from the server's one-snapshot
  // figure (migration 062) — never recomputed from `balance` here, because the
  // client cannot tell whether the current minute has been deducted yet and a
  // guess jumps by ±60 s on every refetch. Null until billing has started.
  const sessionRemaining =
    sessionStartedAt === null
      ? null
      : secondsRemainingNow(activeSession?.seconds_remaining, sessionSyncedAt, sessionNow);
  const countingDown = showsCountdown(sessionRemaining);
  // Per second ONLY inside the last five minutes; above that a coarse tick
  // keeps the minutes label honest without 60 repaints a minute (goal item 5,
  // 2026-09-05: "ticking per second only when ≤5 mins left").
  const tickMs = clockTickMs(sessionRemaining);

  // Display time follows the server's authoritative start timestamp. The local
  // interval only repaints the clock; it never drives billing or balance.
  useEffect(() => {
    if (sessionStartedAt === null) {
      return;
    }
    setSessionNow(Date.now());
    const timer = setInterval(() => setSessionNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [sessionStartedAt, tickMs]);

  // Elapsed time is no longer in the bar — a clock counting UP beside a balance
  // counting down was two numbers about the same money — but the leave dialog
  // still quotes it ("has been running for 2:13").
  const sessionElapsed =
    sessionStartedAt === null
      ? null
      : Math.max(0, Math.floor((sessionNow - Date.parse(sessionStartedAt)) / 1000));
  const sessionClock = sessionElapsed === null ? null : formatClock(sessionElapsed);

  // "Need more time?" when the live session is inside the countdown window —
  // the same threshold the bar's numerals use, from the same server figure.
  // Member-only: providers do not recharge; their wallet is earnings.
  const showExtendCard =
    isMemberSide &&
    sessionIsActive &&
    countingDown &&
    sessionRemaining !== null &&
    sessionRemaining > 0 &&
    !extendCardDismissed;

  const showPinnedExtend = showExtendCard && !extendScrolledAway;
  /*
   * The talk bar is the COUNTDOWN, and nothing else (Amit, 2026-09-07: "Dont
   * need two timers -- only one countdown which activates when <=5 mins is left
   * with dynamic timer and rechage button").
   *
   * It used to show for the whole of any chat with a loaded balance, reading
   * "240 min of talk time left" — a second, coarser time display sitting above
   * the real countdown's slot. Two figures for one fact, and the always-present
   * one was the less useful of the two: it repainted every 15 s, carried no
   * seconds, and mostly said "you have plenty".
   *
   * Now it is gated on `countingDown`, so it is the last five minutes of a live
   * session or nothing. `showsCountdown` already owned that threshold
   * (sessionClock.ts), and `clockTickMs` already returns the 1 s tick for
   * exactly this window — so the bar is on screen only when the clock beneath
   * it is genuinely moving per second. That is the whole point: it appears
   * BECAUSE something is running out.
   *
   * The balance itself has not gone anywhere. `TokenCounter` in the header
   * carries it permanently and opens Recharge, which is where a member who
   * wants to know their balance without being warned about it should look.
   *
   * The extend-card clause stays: the card owns the top band while it is
   * pinned, and two things cannot occupy one band.
   */
  const showStickyRecharge =
    isMemberSide && countingDown && (!showExtendCard || extendScrolledAway);

  useEffect(() => {
    if (!showExtendCard) {
      setExtendScrolledAway(false);
    }
  }, [showExtendCard]);

  /*
   * M18 (2026-09-17 audit) flagged this as JS-thread-only, and moving it onto
   * the UI thread via useAnimatedScrollHandler was tried and reverted in this
   * same pass: FlashList v2 wrapped in Animated.createAnimatedComponent loses
   * its own imperative ref shape (scrollToOffset) under this Reanimated
   * version — confirmed by tsc, not a hunch — and the known upstream fix for
   * that combination is version-sensitive
   * (software-mansion/react-native-reanimated#3889, #3899, #3938). `listRef`
   * is load-bearing for the force-scroll effect and the page-down button
   * (X5), so breaking it silently to save a bridge crossing during scroll is
   * the wrong trade with no device to verify the fix on. Left as a plain
   * callback; a real fix wants `useAnimatedRef`/`useScrollOffset` (the
   * currently-documented alternative to wrapping the component) tried on a
   * device, not blind.
   */
  const onTranscriptScroll = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      // Inverted FlashList: offset grows as the user scrolls toward older
      // messages (visual top), 0 is the newest message. Tracked here
      // unconditionally (2026-09-17 audit) so the page-down button knows
      // when to appear regardless of the extend card's own, separate
      // 64dp threshold below.
      const away = e.nativeEvent.contentOffset.y > PAGE_DOWN_THRESHOLD;
      scrolledAwayFromLatestRef.current = away;
      setScrolledAwayFromLatest(prev => (prev === away ? prev : away));
      if (!away) {
        setUnreadBelow(0);
      }
      if (!showPinnedExtend) {
        return;
      }
      // Past one card-height, treat extend as out of sight.
      if (e.nativeEvent.contentOffset.y > 64) {
        setExtendScrolledAway(true);
      }
    },
    [showPinnedExtend],
  );

  // The End chip confirms too: a paid session is money, and the chip sits a
  // thumb-width from Recharge in the same bar. It ended the session on a single
  // tap until 2026-09-06 (goal item 6: "session exit button + dialog").
  const requestEnd = useCallback(() => {
    if (!activeSession) return;
    setSessionNow(Date.now());
    setLeaveIntent('end');
    setLeaveDialogVisible(true);
  }, [activeSession]);

  const confirmEnd = useCallback(() => {
    if (!activeSession) {
      setLeaveDialogVisible(false);
      return;
    }
    endSessionMutate(
      { sessionId: activeSession.id, reason: 'manual' },
      {
        onSuccess: () => setLeaveDialogVisible(false),
        onError: () => {
          setLeaveDialogVisible(false);
          setNotice('Could not end session. Check your connection and try again.');
        },
      },
    );
  }, [activeSession, endSessionMutate, setNotice]);

  /**
   * `onBack` wrapped with the draft purge (X6, 2026-09-17 audit): leaving the
   * chat back to Home is one of Amit's three named exits, the other two being
   * a call (see `startCall` below) and the app closing (already covered —
   * nothing reaches this chat again without going through one of the other
   * two first). Every path back to Home funnels through here rather than a
   * raw `onBack()`, so there is exactly one place this can be missed.
   */
  const leaveChat = useCallback(() => {
    if (conversationId !== undefined) {
      clearChatDraft(conversationId);
    }
    onBack();
  }, [conversationId, onBack]);

  /**
   * Back is conditionally intercepted only while a paid session exists. Android
   * recommends enabling a back callback only for the state that needs a decision;
   * ordinary chat navigation remains immediate.
   * https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture
   */
  const requestLeave = useCallback(() => {
    if (!activeSession) {
      leaveChat();
      return;
    }
    // The dialog quotes the elapsed time, and above the five-minute mark the
    // clock only repaints every 15 s — re-anchor so the figure is exact at open.
    setSessionNow(Date.now());
    setLeaveIntent('leave');
    setLeaveDialogVisible(true);
  }, [
    activeSession,
    leaveChat,
  ]);

  const confirmLeave = useCallback(() => {
    if (!activeSession) {
      setLeaveDialogVisible(false);
      leaveChat();
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
          // The edge-watcher above cannot see this end: onBack() unmounts this
          // screen in the same tick, long before the invalidated
          // get_active_session refetch can flip activeSession to null. So the
          // leave-and-end path — the ordinary way out of a chat — ended every
          // chat session without ever asking how it went. The End chip
          // (confirmEnd) stays on screen, so the watcher still covers that one.
          if (isMemberSide && name !== '') {
            requestReview(activeSession.id, name);
          }
          leaveChat();
        },
        onError: () => {
          setLeaveDialogVisible(false);
          setNotice('Could not end session. Check your connection and try again.');
        },
      },
    );
  }, [
    activeSession,
    endSessionMutate,
    isMemberSide,
    leaveChat,
    name,
    requestReview,
    setNotice,
  ]);

  /*
   * The chat covers Home, and Home stays mounted underneath it (App.tsx renders
   * this screen as an overlay so returning to Home never remounts its lists).
   * A guard held by a covered screen is therefore still on the stack: with
   * Home's search field open behind it, the system back button went to HOME's
   * search guard, which returned true, and the chat never popped — while the
   * app-bar arrow, which calls `requestLeave` directly, left every time. The
   * barrier is the floor: guards registered below it are covered and are not
   * asked. See the incident note in src/lib/backGuard.ts. (2026-09-13.)
   */
  useBackBarrier();

  /*
   * One press per thing that is open, innermost first, and then the screen —
   * which is what back means everywhere else in the app (the emoji/attach panel
   * runs the same ladder inside Composer). Ordering lives in the LADDER and not
   * in the stack on purpose: a reply bar and a paid session can appear in
   * either order, and two separate guards would have made "what does back do"
   * depend on which happened first.
   *
   * The last rung DECLINES rather than calling `requestLeave`, so a chat with
   * nothing open and nothing to protect pops through App.tsx's route handler.
   * That is the same landing as the app-bar arrow — both resolve
   * `memberParent()` and both `resetConversation()` — and it keeps the screen
   * honest about Android's guidance to intercept only in the state that needs a
   * decision.
   * https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture
   */
  const backGuard = useCallback(() => {
    if (replyTo !== null) {
      setReplyTo(null);
      return true;
    }
    if (activeSession) {
      // Back must not silently leave a paid session: same dialog as the arrow.
      requestLeave();
      return true;
    }
    return false;
  }, [activeSession, replyTo, requestLeave]);
  useBackGuard(activeSession || replyTo !== null ? backGuard : null);

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

  /*
   * Edit and delete (migration 103). Both open something rather than acting:
   * an edit needs the new text, and a delete is irreversible for the other
   * person too, which is the case M3 says a confirmation dialog is for.
   * https://m3.material.io/components/dialogs/guidelines
   */
  const beginEdit = useCallback((target: ActionTarget) => {
    setEditing(target);
    setEditDraft(target.body ?? '');
  }, []);
  const beginDelete = useCallback((target: ActionTarget) => {
    setDeleting(target);
  }, []);

  const commitEdit = useCallback(async () => {
    if (editing === null) {
      return;
    }
    setEditBusy(true);
    const ok = await editMessage(editing.id, editDraft);
    setEditBusy(false);
    // Stays open on failure, with the text still in the field: the notice says
    // why, and closing would throw away what they typed to no purpose.
    if (ok) {
      setEditing(null);
      setEditDraft('');
    }
  }, [editing, editDraft, editMessage]);

  const commitDelete = useCallback(async () => {
    if (deleting === null) {
      return;
    }
    setDeleteBusy(true);
    await deleteMessage(deleting.id);
    setDeleteBusy(false);
    // Closed either way. A refusal has already surfaced a notice, and leaving a
    // destructive dialog up invites a second tap at the same refusal.
    setDeleting(null);
  }, [deleting, deleteMessage]);

  /** Tapping a photo bubble opens it full screen; see `<MediaViewer />` below. */
  const openImage = useCallback((image: ImageBody) => setViewerImage(image), []);
  const closeImage = useCallback(() => setViewerImage(null), []);

  /**
   * `onStartCall` wrapped with the draft purge (X6, 2026-09-17 audit) — the
   * second of Amit's three named exits. Every call-start in this screen goes
   * through here, not the raw prop, for the same one-place-to-miss-it reason
   * `leaveChat` wraps `onBack`.
   */
  const startCall = useCallback(
    (channel: 'audio' | 'video') => {
      if (conversationId !== undefined) {
        clearChatDraft(conversationId);
      }
      onStartCall?.(channel);
    },
    [conversationId, onStartCall],
  );

  /** Re-dial from a missed/declined call row. `medium` is the row's own. */
  const callBack = useCallback(
    (medium: 'voice' | 'video') => startCall(medium === 'video' ? 'video' : 'audio'),
    [startCall],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<(typeof rows)[number]>) => {
      // Call log row. A connected call is a muted, non-interactive entry; a
      // missed/declined/failed one is tappable to call back — but only when a
      // call of that medium can actually start right now (calls enabled, and no
      // non-chat session already live), otherwise the tap would dead-end.
      if (item.kind === 'call') {
        const busy = activeSession != null && activeSession.channel !== 'chat';
        const allowed = item.call.medium === 'video' ? canStartVideo : canStartAudio;
        return (
          <View style={styles.turn}>
            {item.opensDay ? <DayDivider iso={item.call.created_at} /> : null}
            <CallLogRow
              call={item.call}
              onCallBack={onStartCall && allowed && !busy ? callBack : undefined}
            />
          </View>
        );
      }

      // System message: a centered, non-interactive session boundary / notice.
      if (item.kind === 'system') {
        return (
          <View style={styles.turn}>
            {item.opensDay ? <DayDivider iso={item.sortAt} /> : null}
            <SystemMessageRow text={item.text} icon={item.icon} />
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
      /*
       * A tombstone is checked FIRST, because migration 103 nulls every payload
       * column together: a deleted voice note has no `voice_path`, so it would
       * otherwise fall through to the "Voice note" fallback below and claim a
       * recording that is gone.
       */
      const deleted = isDeleted(message);
      // Only reached when `voice` and `image` are unset, which the payload
      // constraint guarantees means the row has a body. The fallback covers a row
      // that somehow has none rather than rendering an empty bubble.
      const text = deleted
        ? tombstoneText(mine)
        : (message.body ?? (image !== undefined ? 'Photo' : 'Voice note'));
      const edited = editedAt(message) !== null;
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
              // WhatsApp puts the tail on the oldest bubble of a run; `first`
              // already marks exactly that (sender differs from the older neighbour).
              tail={first}
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
              edited={edited}
              deleted={deleted}
              /*
               * The two owner actions are passed ONLY when the server would
               * accept them. `canEditMessage` mirrors every clause of migration
               * 103's `edit_message` — same sender, still visible, text (not
               * voice or photo), a live send rather than an automated opener,
               * and inside the fifteen-minute window — so the Edit row is absent
               * rather than offered-and-refused once the window has closed. The
               * server re-decides all of it regardless; this only controls what
               * the menu draws.
               */
              onEditMessage={
                canEditMessage(message, selfId) ? beginEdit : undefined
              }
              onDeleteMessage={
                canDeleteMessage(message, selfId) ? beginDelete : undefined
              }
              chosenReaction={chosen}
              onOpenImage={openImage}
              /*
               * A failed send keeps its bubble and offers a retry, rather than
               * vanishing. Three shapes:
               *   - text: replay through the same idempotent send path, with
               *     the original nonce and created_at (unchanged).
               *   - image / voice, upload already landed (`keepFailed`, not
               *     `withdraw` — see attachments.ts / voice.ts): retry is the
               *     RPC alone, via useRetryImageSend / useRetryVoiceSend
               *     (2026-09-17 audit). This is NOT the outbox's cross-launch
               *     media replay (lib/outbox.ts explains why that is not
               *     attempted) — it only ever fires within the same session,
               *     on a row whose object already exists in the bucket.
               *   - image / voice whose upload itself never completed
               *     (`withdraw`): the bubble is gone, so this branch is never
               *     reached for that case — there is nothing left to retry.
               */
              failed={message.failed === true}
              onRetry={
                message.failed !== true
                  ? undefined
                  : message.body !== null
                    ? () => {
                        void sendRef.current(message.body ?? '', message.reply_to_id, {
                          nonce: message.id.slice(PENDING_PREFIX.length),
                          createdAt: message.created_at,
                        });
                      }
                    : message.attachment_path !== null
                      ? () => {
                          void retryImage(message);
                        }
                      : message.voice_path !== null
                        ? () => {
                            void retryVoice(message);
                          }
                        : undefined
              }
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
              // Mirrored tail on the oldest bubble of the peer's run.
              tail={first}
              // Only live arrivals animate in; history and paged-in rows mount
              // still. See `arrivalCutoff`.
              animate={Date.parse(message.created_at) > arrivalCutoff.current}
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
              edited={edited}
              deleted={deleted}
              chosenReaction={chosen}
              onOpenImage={openImage}
            />
          )}
        </View>
      );
    },
    [
      // `avatarUrl` and `initial` left with the transcript avatar (see
      // Turn.tsx's PeerTurnView): they are still read by the header identity
      // block and by PeerTyping, but no longer by a row, so keeping them here
      // would re-render every bubble whenever the peer changed their photo.
      activeSession,
      beginDelete,
      beginEdit,
      callBack,
      canStartAudio,
      canStartVideo,
      name,
      onStartCall,
      openImage,
      parents,
      reactOnMessage,
      reactionRows,
      reportMessage,
      retryImage,
      retryVoice,
      selfId,
      styles,
      swipeReply,
      tallies,
      voicePlayer,
    ],
  );

  const header = useCallback(
    () => <PeerTyping name={name} />,
    [name],
  );
  // On an inverted list the footer renders at the visual TOP, so this reserves
  // the frosted bar's height there: the oldest message scrolls clear of the
  // frost instead of resting permanently behind it. (The extend card is NOT
  // here — a ListFooterComponent on FlashList v2's inverted list does not land
  // at the visual top reliably; the card is pinned inside the Frost header
  // instead, which auto-grows barHeight so this spacer still tracks it.)
  // Permanently stable. FlashList does `React.createElement(ListFooterComponent)`,
  // so a callback whose identity changed with `barHeight` changed the element
  // TYPE and React unmounted and remounted the spacer — on an inverted list that
  // is the visual-top spacer, remounting exactly while the talk strip plays its
  // barIn/barOut. `BarSpacer` subscribes to the height itself instead.
  const footer = useCallback(() => <BarSpacer />, []);
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
  /*
   * A failed fetch is not the same thing as an empty thread (2026-09-17
   * audit). Before this, an errored `messages`/`threads` query fell straight
   * into `empty` below — the exact same "Say hi" first-contact state a
   * BRAND NEW conversation shows — because `rows` collapses to `[]` on
   * either `undefined` or a thrown query. A member on a flaky connection
   * opening a real conversation with history got no signal that the fetch
   * failed and no way to retry short of leaving the screen.
   *
   * Checked and given its own branch BEFORE `empty`, not folded into it:
   * this is deliberately NOT claiming a real transcript was lost (this
   * product's sessions are ephemeral by design, ADR-0020 — a genuinely
   * empty conversation between paid sessions is the correct, working
   * state) — only that THIS fetch, right now, did not succeed and should
   * say so rather than look identical to "nothing has ever happened here".
   */
  const loadError = messagesError || threadsError;
  const empty = !loading && !loadError && rows.length === 0;

  /*
   * `imeSpace`, `bodyInset`, `panelCeiling`, `listPad` and `composerInset` are
   * derived together in src/lib/imeGeometry.ts, from one input set, so they
   * cannot drift by a commit. The measured 96px/34dp note that argued for them
   * moved with them. Nothing in this body reads one — the leaves do.
   */

  return (
    <ImeGeometryProvider value={ime}>
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
       * inverted list reserves the bar's measured height at its visual top (the
       * `BarSpacer` footer, see below) so the oldest message can still scroll
       * clear of the frost.
       */}
      <Frost
        edge="bottom"
        style={[styles.barStack, { paddingTop: insets.top }]}
        onLayout={e => ime.getState().set({ barHeight: e.nativeEvent.layout.height })}>
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
          highlight="dim"
          size={28}
          style={styles.navButton}>
          <Icon name="chevronLeft" size={TOKENS.icon.md} />
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
          // Long-press to rename the chat with a private label (migration 098).
          // Only offered once the conversation exists — there is nothing to label
          // before then.
          onLongPress={
            conversationId !== undefined ? () => setRenaming(true) : undefined
          }
          testID="open-safety"
          accessibilityLabel={
            onOpenProfile !== undefined ? `${name}. View profile` : `${name}. Block or report`
          }
          accessibilityHint={
            conversationId !== undefined
              ? 'Long press to rename this chat'
              : onOpenProfile !== undefined
                ? 'Opens their profile'
                : 'Opens safety options'
          }
          press="none"
          highlight="dim"
          style={styles.identity}>
          {/* 42, not 30 (Amit, 2026-09-07: "dp size too small on chat header").
              Taken from the reference rather than guessed: ChatAvatarContainer
              sets `avatarImageView.setRoundRadius(dp(21))` (:265, and again at
              :1487), and a circular avatar's round radius is half its side — so
              the 1:1 chat header carries a 42dp picture. Ours was 30, which is
              the size a LIST ROW wants, not a header.
              It still fits: the header's `minHeight` is `layout.appBarSmall`
              (64dp), and the row centres on one axis, so a 42dp avatar and the
              40dp two-line text column stay concentric. */}
          <Avatar initial={initial} uri={avatarUrl} size={42} online={presence.here} />
          {/* The two-line reservation is on the COLUMN, and the column centres
              whatever it actually has inside it — see IDENTITY_LINES. That is
              what puts the name on the avatar's axis in the one-line state,
              which a blank presence row could not do. */}
          <View style={[styles.identityText, { minHeight: IDENTITY_LINES * fontScale }]}>
            <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleMediumEmphasized} testID="chat-title" allowFontScaling numberOfLines={1} style={styles.title}>
              {name}
            </Text>
            {/* Renders nothing when it has nothing to say, the way M3's own bar
                composes no subtitle row when there is no subtitle. The height it
                would have taken is reserved by the minHeight above, so the
                header still does not change height as presence arrives and
                goes. */}
            <HeaderSubtitle presence={presence} />
          </View>
        </Pressable>
        </View>
        {/* Rendered and disabled rather than hidden so flipping either admin
            control never changes the header geometry. A pending session or a
            live non-chat session blocks both: tapping Call/Video while a chat
            session is live upgrades to the call (start_call ends the chat
            session first — migration 073). A live audio/video session or an
            in-flight ring still returns BUSY from the server. */}
        {/* Real Pressables, not Views posing as buttons: TalkBack now announces a
            control that actually does something, and the disabled state is an
            honest gate (CALLS_ENABLED) rather than a role that never fires. */}
        <Pressable
          onPress={() => startCall('video')}
          disabled={
            !canStartVideo ||
            (activeSession != null && activeSession.channel !== 'chat')
          }
          testID="call-video"
          accessibilityLabel={`Video call ${name}`}
          press="none"
          size={28}
          style={[
            styles.navButton,
            (!canStartVideo ||
              (activeSession != null && activeSession.channel !== 'chat')) &&
              styles.navDisabled,
          ]}>
          <Icon name="video" size={TOKENS.icon.md} color={theme.color.text.secondary} />
        </Pressable>
        <Pressable
          onPress={() => startCall('audio')}
          disabled={
            !canStartAudio ||
            (activeSession != null && activeSession.channel !== 'chat')
          }
          testID="call-voice"
          accessibilityLabel={`Voice call ${name}`}
          press="none"
          size={28}
          style={[
            styles.navButton,
            (!canStartAudio ||
              (activeSession != null && activeSession.channel !== 'chat')) &&
              styles.navDisabled,
          ]}>
          {/* 18, not 20: Lucide's phone glyph fills more of its em vertically than
              the video glyph, so at a matched fontSize it read visibly taller next
              to it (#1). Two points down evens the pair. */}
          {/*
            * 19, not icon.md (20), and this is an OPTICAL correction rather
            * than a drift. Measured on the Redmi at density 440: the video
            * glyph's ink is 19.3 x 19.3dp and the handset's is 19.6 x 20.0dp
            * at the SAME size token — the outlines differ, so equal `size`
            * gives unequal ink and the call button read as the larger of the
            * two (Amit spotted it). Dropping one step brings the handset's ink
            * to ~19.0 and the pair to within 0.3dp.
            *
            * Same class of departure as the 28pt carousel glyph: the token
            * scale exists to stop arbitrary values, not to override a measured
            * one. Exempted in __tests__/iconScale.test.ts with this reason.
            */}
          <Icon name="call" size={CALL_GLYPH_SIZE} color={theme.color.text.secondary} />
        </Pressable>
        {/* END, and it lives HERE rather than in the talk bar (Amit, 2026-09-07).
            The bar now appears only inside the last five minutes — "only one
            countdown which activates when <=5 mins is left with dynamic timer
            and rechage button" — and that countdown slot belongs to Recharge.
            Leaving End in the bar would have meant a member could not end a
            session they were paying for until it had nearly run out, which is
            the one moment ending it no longer saves them anything.
            Rendered only while a session is live: an End button with nothing to
            end is a control that lies about what state you are in. */}
        {activeSession ? (
          <Pressable
            onPress={requestEnd}
            /* `disabled` while the request is in flight, not `busy`. `busy` is
               the held-compression state that pairs with `busyLabel` — the
               participle a Button swaps into its label — and an icon-only
               control has no label to swap. contract.test's "narrates every
               mutation a button starts" counts the two props together for
               exactly that reason, so this says "not now" rather than
               pretending to narrate. The outcome arrives as the dialog. */
            disabled={endingSession}
            testID="chat-end-session"
            accessibilityLabel="End paid session"
            accessibilityHint="Stops the per-minute charge"
            press="none"
            size={28}
            shape="circle"
            style={styles.navButton}>
            {/*
              * `logout` (a door with an arrow out), not `stop`.
              *
              * Amit, 2026-09-08: an exit icon, not a stop icon. They say
              * different things — a stop square reads as halting a process, a
              * recording or a playback, while what this control does is LEAVE a
              * session. The door is what the member is actually doing. Danger
              * red is kept: it is still the one destructive control in the
              * header.
              */}
            <Icon name="logout" size={TOKENS.icon.md} color={theme.color.state.danger} />
          </Pressable>
        ) : null}
        {/*
          * The wallet pill is GONE from the chat header (Amit, 2026-09-08).
          *
          * It was competing with the countdown for the same glance: during a
          * session the member needs to know how long they have, and a raw token
          * balance beside it is a second number answering a question they did
          * not ask. Balance lives on Home and in Recharge.
          *
          * The provider's earnings pill stays, because a provider has no
          * countdown — the number IS their reason to look at the header.
          */}
        {isMemberSide ? null : (
        <TokenCounter
          variant="earnings"
          balance={earnings?.provider_tokens ?? 0}
          onPress={onOpenEarnings ?? openWallet}
        />
        )}
      </View>

      {/* Recharge talk-bar: hidden while the extend card owns the top band;
          slides in from the top once the transcript has scrolled the extend
          card out of sight (or when extend is not eligible). */}
      {/* Item 4: when the other person is away and we actually pinged them,
          say so. A persistent line rather than a 4s notice, because it is a
          STATE of this conversation ("they know you are here") and not an
          event — and it renders only on `alerted`, which the server sets only
          when a push really went out. */}
      {openAlert?.alerted === true ? (
        <View style={styles.notifiedBar} testID="peer-notified">
          <Text allowFontScaling style={styles.notifiedText}>
            {`${name} knows you are here.`}
          </Text>
        </View>
      ) : null}

      {showStickyRecharge ? (
        <Animated.View
          entering={barIn}
          exiting={barOut}
          style={[styles.talkBar, styles.talkBarLow]}>
          <View style={styles.talkDot} />
          {/* ONE time display, and no branch to choose it.
              The bar exists only while `countingDown` is true, so this is
              always the ticking `m:ss` — the old "N min of talk time left"
              alternative was the second timer Amit asked to remove, and the
              `formatMinutes`/`estimatedTalkSeconds` fallback it needed has gone
              with it.
              `allowFontScaling={false}` on purpose: a monospaced clock that
              grows with the system font pushes the Recharge button off a 360dp
              bar, and this is the one string a member reads glancing, not
              reading. */}
          <Text
            allowFontScaling={false}
            testID="chat-session-timer"
            style={styles.talkTimer}>
            {formatClock(sessionRemaining ?? 0)}
          </Text>
          <Text allowFontScaling style={styles.talkText}>
            left
          </Text>
          {/* Recharge, not End. End is in the header now, live for the whole
              session rather than only its last five minutes. */}
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
          {/* The card carries the countdown, because it OWNS this window.
              `showStickyRecharge` hides the talk bar for exactly as long as
              this card is up, and the talk bar was the only place the m:ss
              numerals appeared — so the last five minutes, the one stretch the
              per-second clock exists for, showed a timeless "Need more time?"
              instead. Asking the question without printing the answer is the
              worst of both. `sessionRemaining` is non-null whenever this card
              renders (it is in `showExtendCard`), so there is no fallback to
              invent. */}
          <View style={styles.extendCardContent}>
            <View style={styles.extendCardHeadline}>
              <Text
                allowFontScaling={false}
                testID="chat-extend-timer"
                style={styles.extendCardTimer}>
                {formatClock(sessionRemaining ?? 0)}
              </Text>
              <Text allowFontScaling style={styles.extendCardTitle}>
                left
              </Text>
            </View>
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
            highlight="dim"
            size={28}
            // Circle, not the square touch box: this box sets no radius, so the
            // `dim` fill painted a solid 28dp square behind a 12pt glyph. Icon-only
            // controls take borderless (circular) ink, not the bounded rectangular
            // kind. https://developer.android.com/training/material/animations
            shape="circle"
            style={styles.extendCardClose}>
            <Icon name="close" size={TOKENS.icon.xs} color={theme.color.text.secondary} />
          </Pressable>
        </View>
      ) : null}
      </Frost>

      <View style={styles.body}>
        {/* The chat wallpaper deferred until after the open animation (A1):
            ~800 View+Text nodes mount after InteractionManager fires so they
            don't compete with SlideInRight for frame budget. The transcript
            sits above it, so the 1-frame delay is invisible. */}
        {wallpaperReady ? <ChatWallpaper /> : null}
        {loading ? (
          <View style={styles.loading}>
            <LoadingIndicator size={48} />
          </View>
        ) : loadError ? (
          // See `loadError`'s own docblock above: distinct from `empty` on
          // purpose, so a failed fetch never reads as "nothing has ever
          // happened here".
          <View style={[styles.loading, styles.loadErrorGap]}>
            <Text allowFontScaling style={styles.emptyName}>
              Couldn&apos;t load this chat
            </Text>
            <View style={styles.loadErrorRetry}>
              <Button
                label="Try Again"
                onPress={() => {
                  void refetchMessages();
                  void refetchThreads();
                }}
              />
            </View>
          </View>
        ) : empty ? (
          /*
           * An entrance, because this is the moment the member learns a real
           * person is on the other end.
           *
           * The branch replaces a spinner, so without one the avatar, the name
           * and the typing indicator all hard-cut into place the instant
           * loading resolves — the product's defining spatial event delivered
           * as a jump cut. `rowIn(0)` is the same arrival every provider row in
           * the app already uses (opacity on effects timing, 12dp of travel on
           * `spatialSlow`), so the person arrives the way people arrive
           * everywhere else here rather than in a bespoke way.
           *
           * Occasional tier: a first visit to any conversation, or any return
           * while the thread is still empty.
           */
          <Animated.View entering={rowIn(0)} style={styles.empty}>
            <View style={styles.emptyMark}>
              <Avatar initial={initial} uri={avatarUrl} size={56} tone="warm" breathing />
            </View>
            <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized} allowFontScaling style={styles.emptyName}>
              {name}
            </Text>
            {/* Also here, not only inside the list. The empty branch *replaces*
                the FlashList, so PeerTyping was unmounted in exactly the case it
                is most wanted: a new peer typing the first message in a thread
                showed nothing at all. */}
            <View style={styles.starters}>
              <PeerTyping name={name} />
            </View>
          </Animated.View>
        ) : (
          <Transcript
            listRef={listRef}
            rows={rows}
            renderItem={renderItem}
            header={header}
            footer={footer}
            onScroll={onTranscriptScroll}
          />
        )}

        <PageDownButton
          visible={scrolledAwayFromLatest}
          count={unreadBelow}
          onPress={scrollToLatest}
        />

        {/*
         * The search scrim is GONE, with the expansion it existed for.
         *
         * Telegram's `ScrimDrawable` (black at alpha 102 of 255, ramped with
         * `setStickersExpanded`, ChatActivityEnterView.java:13891-13906) made the
         * expansion read as a panel OVER the chat rather than the chat leaving.
         * The panel is now a docked tray capped at the keyboard's height (Amit,
         * 2026-09-05: "should be like whatsapp docked right"), so it never covers
         * the conversation and there is nothing to wash out. A scrim over content
         * the user can still see and scroll would just be a grey veil.
          */}
        {/*
         * The bottom stack: notices, first-move pills and the composer dock,
         * lifted OUT of the layout flow.
         *
         * It used to be in flow, which meant the emoji panel's height came out of
         * the transcript's — and when search expanded the panel to fill the chat
         * area, the transcript was squeezed to nothing and the conversation
         * visibly disappeared (Amit, 2026-09-04: "Emoji Searching is taking whole
         * screen space").
         *
         * Telegram's panel does occupy the same area, but it OVERLAYS: the
         * composer and the panel are translated up together and a 40% scrim is
         * drawn over the chat behind them (`ChatActivityEnterView.java:13706-13716`
         * for the translation, `ScrimDrawable:13905` for `alpha = 102`). The chat
         * stays where it is and stays visible through the scrim. Absolute
         * positioning is what lets us do the same: the panel grows over the
         * transcript instead of out of it, so the viewport is stable by
         * construction.
         *
         * The transcript's pad (`listPad`, derived in src/lib/imeGeometry.ts)
         * keeps the newest message clear of the collapsed dock, and is
         * deliberately NOT grown by the search expansion — that is what the
         * scrim is for.
         */}
        <DockStack>
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
        <DockFrost>
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
                highlight="dim"
                size={32}
                // Circle, not the square touch box — this box sets no radius, so
                // the `dim` fill painted a solid 32dp square behind a 12pt glyph.
                // https://developer.android.com/training/material/animations
                shape="circle"
                style={styles.replyClose}>
                <Icon name="close" size={TOKENS.icon.xs} color={theme.color.text.secondary} />
              </Pressable>
            </View>
          ) : null}

          {/*
            * 082: the way back in after a decline.
            *
            * A control the member reaches for, deliberately NOT a prompt. The
            * whole defect was being asked repeatedly; replacing the prompt with
            * a quieter prompt would have kept the shape of the problem. So the
            * composer is closed and this sits where the composer was — one
            * button, no dialog, nothing that appears by itself.
            */}
          {offerExplicitStart ? (
            <View style={styles.startSessionRow}>
              <Button
                label="Start session"
                onPress={() => {
                  if (conversationId === undefined) {
                    return;
                  }
                  resumeConsent.mutate({ conversationId });
                }}
                busy={resumeConsent.isPending}
                busyLabel="Starting"
                testID="chat-start-session"
              />
            </View>
          ) : null}

          <Composer
            conversationId={conversationId}
            onSend={onSend}
            onSendVoice={onSendVoice}
            onSendImage={onSendImage}
            onTyping={notifyTyping}
            onRecording={notifyRecording}
            onRecordingEnded={notifyRecordingEnded}
            disabled={
              conversationId === undefined ||
              chatClosed ||
              awaitingMemberConsent ||
              offerExplicitStart
            }
            /*
             * "Message", full stop, whenever the field can actually be typed in
             * (Amit, 2026-09-13: "composer placeholder text should be just
             * Message").
             *
             * It was a five-way ladder: "Say hello" before the first message,
             * "<name> is on their way" while the provider joined, "Reply" when
             * a quote was armed, "Message" otherwise. Each was a small piece of
             * narration in the one place a member is about to type, and the
             * field changing its own label under them is noise rather than
             * help — the reply state is already shown by the reply bar above
             * the field, and "on their way" by the header's presence line.
             *
             * The three DISABLED states keep their text, and that is not a
             * hedge against the instruction: a greyed-out field saying
             * "Message" would be the app declining to say why it will not take
             * one. Those strings are the reason the field is off, not a prompt
             * to write.
             */
            placeholder={
              chatClosed
                ? `${name} is not taking chats right now`
                : offerExplicitStart
                  ? 'Start a session to keep talking'
                  : awaitingMemberConsent
                    ? 'Say yes above when you are ready'
                    : 'Message'
            }
            sendHaloKey={sendHaloKey}
            onFocusChange={onComposerFocus}
            onPanelChange={onPanelChange}
            onPanelSearchChange={onPanelSearchChange}
          />
        </DockFrost>
        </DockStack>
      </View>

      <SafetySheet
        visible={safety.open}
        onClose={() => setSafety({ open: false, messageId: null })}
        conversationId={conversationId}
        peerId={providerId}
        peerName={name}
        messageId={safety.messageId}
      />

      <RenameChatSheet
        visible={renaming}
        onClose={() => setRenaming(false)}
        conversationId={conversationId}
        currentLabel={customLabel}
        peerName={peerName}
      />

      {/*
        * Editing a message (migration 103).
        *
        * The body names the fifteen-minute window and says the other person
        * will be told, because both are true and neither is discoverable from
        * the UI otherwise: the server refuses a late edit, and `edited_at` puts
        * "Edited" on the bubble on both devices. An app that quietly rewrote
        * somebody's transcript would be the version of this feature worth
        * refusing to build.
        */}
      <Sheet
        visible={editing !== null}
        testID="edit-message"
        title="Edit message"
        body="You can edit for 15 minutes after sending. They will see that it was edited."
        onClose={() => setEditing(null)}
        onCancel={() => setEditing(null)}>
        {/* `M3Field`, not the bare `TextField`: "Every labelled text and numeric
            input goes through this", and it already owns the outlined container,
            the focus stroke and the multiline padding. No `label` — the sheet's
            own title says what this field is, and a second "Message" above it
            would be the same word twice. */}
        <M3Field
          testID="edit-message-input"
          containerStyle={styles.editInput}
          style={styles.editInputBox}
          accessibilityLabel="Message text"
          value={editDraft}
          onChangeText={setEditDraft}
          // The same ceiling `messages.body`'s CHECK enforces, so the field
          // stops where the database would rather than failing after a tap.
          maxLength={4000}
          multiline
          autoFocus
        />
        <Button
          label="Done"
          busy={editBusy}
          // "Updating", not the obvious word for it: `chatSurface.test.ts` bans
          // the whole save/download/export/share family from every chat-media
          // surface, and this screen is one. The ban is about a route that takes
          // media OUT of the app and this button is nothing of the kind — but a
          // closed word list only works if it stays closed.
          busyLabel="Updating"
          disabled={editDraft.trim() === ''}
          onPress={() => {
            void commitEdit();
          }}
          testID="edit-message-done"
        />
      </Sheet>

      {/*
        * Deleting. Destructive and visible to the other person, which is the
        * pair of facts the body has to carry — "Delete for everyone" without
        * saying what is left behind would be a promise the tombstone does not
        * keep.
        */}
      <ConfirmDialog
        visible={deleting !== null}
        testID="delete-message"
        title="Delete this message?"
        body="It will be removed from the chat. They will see that a message was deleted."
        cancelLabel="Keep"
        confirmLabel="Delete"
        destructive
        busy={deleteBusy}
        busyLabel="Deleting"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          void commitDelete();
        }}
      />

      <ConfirmDialog
        visible={awaitingMemberConsent}
        testID="chat-session-consent"
        title={
          theyOpenedTheChat
            ? `Hey, ${name} wants to have a chat with you`
            : `Hey, ${name} is here`
        }
        body={
          theyOpenedTheChat
            ? 'Keep it kind. No sexual or abusive talk. You are only charged once you both start.'
            : 'They are ready when you are. Keep it kind. No sexual or abusive talk. You are only charged once you both start.'
        }
        cancelLabel="Decline"
        confirmLabel="Start session"
        busy={confirmChat.isPending || declineChatRequest.isPending}
        busyLabel="Just a moment"
        onCancel={() => {
          if (pendingRequest == null || conversationId === undefined) {
            return;
          }
          declineChatRequest.mutate({
            requestId: pendingRequest.id,
            conversationId,
          });
        }}
        onConfirm={() => {
          if (pendingRequest == null || conversationId === undefined) {
            return;
          }
          confirmChat.mutate(
            { requestId: pendingRequest.id, conversationId },
            {
              onSuccess: () => setNotice('You are in', 'confirm'),
              onError: err => {
                const msg = err instanceof Error ? err.message : '';
                if (msg.toLowerCase().includes('insufficient')) {
                  setNotice('Your balance is empty. Top up to keep going.');
                  openRefill();
                  return;
                }
                setNotice('Could not start just now.');
              },
            },
          );
        }}
      />

      {/* One dialog, two intents: back (end and leave) and the End chip (end,
          stay). Both confirm — see `requestEnd`. */}
      <ConfirmDialog
        visible={leaveDialogVisible}
        testID="chat-leave-dialog"
        title={leaveIntent === 'end' ? 'Done for now?' : 'Leave this chat?'}
        body={
          sessionIsActive
            ? `This chat has been going for ${sessionClock ?? '0:00'}.${
                leaveIntent === 'end' ? ' This stops the chat and the charge.' : ''
              }`
            : leaveIntent === 'end'
              ? 'You are still connecting. Stopping now cancels it.'
              : 'You are still connecting. Leaving will end it.'
        }
        cancelLabel={leaveIntent === 'end' ? 'Keep going' : 'Stay'}
        confirmLabel="End chat"
        destructive
        busy={endingSession}
        busyLabel="Ending…"
        onCancel={() => setLeaveDialogVisible(false)}
        onConfirm={leaveIntent === 'end' ? confirmEnd : confirmLeave}
      />

      {/* The full-screen photo. A sibling of the other Modal-hosted surfaces and
          never open at the same time as one: the tap that opens it is Exclusive
          with the long press that opens the reaction strip, so the two cannot
          both resolve. */}
      <MediaViewer image={viewerImage} onClose={closeImage} />
    </View>
    </ImeGeometryProvider>
  );
}

/**
 * The transcript, wrapped so `listPad` can change without rendering the screen.
 *
 * `contentContainerStyle` stays a PLAIN style object. That is the mechanism the
 * 96px fix was measured against on a device, and a re-render refactor is not the
 * place to swap it for an animated spacer — if that is ever wanted it needs its
 * own change and its own device pass.
 */
interface TranscriptProps {
  listRef: React.RefObject<FlashListRef<TranscriptRow> | null>;
  rows: TranscriptRow[];
  renderItem: ListRenderItem<TranscriptRow>;
  header: () => React.ReactElement;
  footer: () => React.ReactElement;
  onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => void;
}

const Transcript = memo(function TranscriptView({
  listRef,
  rows,
  renderItem,
  header,
  footer,
  onScroll,
}: TranscriptProps) {
  const styles = useStyles(makeStyles);
  const listPad = useListPad();
  return (
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
      contentContainerStyle={[styles.list, { paddingTop: listPad }]}
      keyboardDismissMode="interactive"
      keyboardShouldPersistTaps="handled"
      onScroll={onScroll}
      scrollEventThrottle={16}
      // Two recycle pools: message bubbles and call-log rows have very
      // different heights and layouts. Keeping them separate prevents
      // FlashList from handing a recycled bubble cell to a call row (or
      // vice versa), which would produce a visible layout jump on scroll.
      getItemType={item => item.kind}
      showsVerticalScrollIndicator={false}
      {...SCROLL_PHYSICS}
    />
  );
});

/** The dock, lifted clear of the IME. */
function DockStack({ children }: { children: React.ReactNode }) {
  const styles = useStyles(makeStyles);
  const ime = useImeStore();
  const bodyInset = useBodyInset();
  // Reads `emojiSearching` from the store rather than from a captured render
  // value, so the guard cannot go stale inside a closure.
  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      const state = ime.getState();
      if (!state.emojiSearching) {
        state.set({ dockHeight: e.nativeEvent.layout.height });
      }
    },
    [ime],
  );
  return (
    <View
      style={[styles.dockStack, { transform: [{ translateY: -bodyInset }] }]}
      onLayout={onLayout}>
      {children}
    </View>
  );
}

/** The dock's frosted plate. */
function DockFrost({ children }: { children: React.ReactNode }) {
  const composerInset = useComposerInset();
  const focused = useComposerFocused();
  return (
    <Frost
      // No hairline at all. The dock carries no fill, so a top border was
      // drawing a line across the transcript with nothing on the other side
      // of it (Amit, 2026-09-04); the blur alone separates the two.
      tint="none"
      blur={!focused}
      style={{ paddingBottom: composerInset }}>
      {children}
    </Frost>
  );
}

/** Reserves the frosted top bar at the inverted list's visual top. */
function BarSpacer() {
  const barHeight = useBarHeight();
  return <View style={{ height: barHeight }} />;
}

/**
 * The page-down button (2026-09-17 audit, Amit's call on the Telegram-parity
 * sweep: "Match Telegram" — see the force-scroll effect's own docblock for
 * the rule this button is the other half of).
 *
 * `useListPad()`, not `useComposerInset()`: the button floats just clear of
 * the newest message, and `listPad` is the exact number the transcript
 * already reserves for that (dock height + the keyboard lift), while
 * `composerInset` is only the dock's OWN internal bottom padding — using it
 * here would park the button behind the dock instead of above it. A leaf for
 * the same reason `Transcript`/`DockStack`/`DockFrost`/`BarSpacer` are: only
 * this small component re-renders when the keyboard or the dock's height
 * changes, not the whole screen (`__tests__/contract.test.ts`, "keeps the
 * owner holding the handle").
 */
function PageDownButton({
  visible,
  count,
  onPress,
}: {
  visible: boolean;
  count: number;
  onPress: () => void;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const listPad = useListPad();
  if (!visible) {
    return null;
  }
  return (
    <Animated.View
      entering={pageDownIn}
      exiting={pageDownOut}
      style={[styles.pageDown, { bottom: listPad + TOKENS.space.sm }]}
      pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        testID="chat-pagedown"
        accessibilityLabel={
          count > 0 ? `${count} new messages, scroll to latest` : 'Scroll to latest'
        }
        press="chip"
        highlight="dim"
        shape="circle"
        size={40}
        style={styles.pageDownButton}>
        <View style={styles.pageDownGlyph}>
          <Icon name="arrowUp" size={TOKENS.icon.md} color={theme.color.text.secondary} />
        </View>
      </Pressable>
      <Badge count={count} testID="chat-pagedown-badge" />
    </Animated.View>
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
    // The M3 small top app bar's container height, stated rather than left to
    // arithmetic. `AppBarSmallTokens.ContainerHeight = 64.0.dp`, and the measure
    // policy floors the bar at it — `max(height.roundToPx(), titlePlaceable.height)`
    // — rather than letting it shrink to its content. 8 + 44 + 12 already lands
    // on 64; this is what keeps it there if the identity block ever gets shorter.
    minHeight: TOKENS.layout.appBarSmall,
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
  notifiedBar: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space.xs,
    backgroundColor: t.color.bg.sunken,
  },
  notifiedText: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.secondary,
    textAlign: 'center',
  },
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
  // accentStrong, not accent — and note `talkDot` above keeps the bright step
  // deliberately, so the difference is not an inconsistency.
  //
  // A dot is a non-text mark and clears the 3:1 minimum in light; this pill
  // carries `talkRechargeLabel`, white 12dp Bold. developer.android.com/guide/
  // topics/ui/accessibility/apps ("Increase text visibility"): "If the text is
  // smaller than 18sp ... at least 4.5:1." bg/accent measured 3.44:1 light and
  // 2.59:1 dark under this label — it fails the 3:1 non-text floor in dark too,
  // so there was no reading of the rule that saved it. bg/accentStrong is
  // 5.19:1 / 6.13:1, the same fill the member's own bubble uses, and
  // design/tokens.json names it for exactly this: bg/accent "must NEVER sit
  // under small white text; that is what bg/accentStrong is for".
  talkRecharge: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space['2xs'],
    borderRadius: TOKENS.radius.pill,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.accentStrong,
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
  // `flex: 1` is the horizontal fill (the main axis of `identity`).
  // `justifyContent` centres the one-or-two lines inside the height reserved by
  // IDENTITY_LINES, which is what M3 does with a title block shorter than its
  // container: `Arrangement.Center -> (contentHeight - titlePlaceable.height) / 2`
  // (androidx.compose.material3 AppBar.kt, `placeTopAppBar`).
  //
  // No marginTop, marginBottom or translateY nudge here or on `title`: every M3
  // role carries `LineHeightStyle(alignment = Center, trim = None)`
  // (TypographyTokens.kt), and RN 0.86's CustomLineHeightSpan splits the leading
  // the same way, so block centring IS the spec and a hand-tuned offset would be
  // a departure from it.
  identityText: {
    flex: 1,
    justifyContent: 'center',
  },
  title: {
    ...TOKENS.typography.titleMediumEmphasized,
    color: t.color.text.primary,
  },
  body: {
    flex: 1,
  },
  /*
   * Anchored to the bottom of the body and drawn over the transcript. `bottom: 0`
   * with no height, so it is exactly as tall as its content; the keyboard lift is
   * a translation rather than a layout change, which is how Telegram moves the
   * same stack (`setTranslationY` on the enter view and the emoji view together).
   */
  dockStack: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  /*
   * Right-aligned on the same `md` (16) gutter the transcript's own content
   * column uses (see `list` below), so its outer edge lines up with a bubble's.
   * `bottom` is set inline per-render from `listPad` — see `PageDownButton`.
   */
  pageDown: {
    position: 'absolute',
    right: TOKENS.space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // `bg/raised`: a surface floating over the transcript, not part of the dock
  // or the wallpaper beneath it — the same role the extend card's own white
  // plate carries, at `elevation.composer` rather than `.card` because this
  // sits at the dock's visual layer, right above it, not inside the list.
  pageDownButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.color.bg.raised,
    ...TOKENS.elevation.composer,
  },
  // `arrowUp` is the app's only vertical chevron (see icons.generated.ts); a
  // page-DOWN button is the same glyph turned around, not a second icon.
  pageDownGlyph: {
    transform: [{ rotate: '180deg' }],
  },
  /*
   * The transcript's content column, and one half of the chat's horizontal grid.
   *
   * `md` (16) is the same token Composer's `row.paddingHorizontal` and the reply
   * strip's `marginHorizontal` read, so an outgoing bubble's outer edge and the
   * composer capsule's outer edge land on the same x: 16 + 0 of bubble margin on
   * one side, 16 + 0 of bar margin on the other. FlashList honours it — for a
   * vertical list the cell width comes from the padded inner container — so the
   * column really is [16, W-16].
   *
   * BOTH halves now. This comment used to end by excusing the incoming side —
   * "deliberately inset further by the always-reserved 26dp avatar slot plus its
   * 8dp gap; that is the avatar's column, not a different grid" — which was a
   * 34dp asymmetry described as if it were intentional geometry. The avatar is
   * gone (Turn.tsx's PeerTurnView carries the decision and the arithmetic), so an
   * incoming bubble's left edge is 16 and an outgoing bubble's right edge is
   * W-16: the same two columns the capsule sits in.
   *
   * (An earlier version of this comment described a 40% scrim that no longer
   * exists anywhere in this file.)
   */
  list: {
    paddingHorizontal: TOKENS.space.md,
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
  /*
   * The reply strip needs its own surface, for the same reason the composer
   * capsule does.
   *
   * It was text and a rule on bare background, sitting on a dock that carries no
   * fill. So "Replying to X" and the quoted line rendered straight over the
   * transcript and collided with the bubbles behind them - on the S22 the quote
   * ran through a coral bubble and the dismiss cross landed on top of it, both
   * illegible (2026-09-05).
   *
   * Telegram's reply chrome sits INSIDE the composer's own translucent surface,
   * above the field. Ours is a sibling of the capsule rather than a child, so it
   * takes the same capsule treatment: same fill, same hairline, same radius. It
   * occludes what is behind it, which is the whole job.
   */
  /** Gap between the edit field and the sheet's Done button. */
  editInput: {
    marginBottom: TOKENS.space.md,
  },
  /*
   * Taller than `M3Field`'s multiline minimum (56, the M3 container height) for
   * one reason: the field opens holding a message that already exists, so it is
   * being READ before it is edited, and a three-line box is what stops a
   * paragraph arriving as a scrolling slot. Capped so a long message still
   * leaves the Done button on screen above the keyboard.
   */
  editInputBox: {
    minHeight: 88,
    maxHeight: 200,
  },
  replyBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
    /*
     * FOLLOWS THE CAPSULE, not the transcript — `TELEGRAM_ISLAND_INSET` (7).
     *
     * This used to be `space.md` (16) to match both `list.paddingHorizontal`
     * and Composer's `row.paddingHorizontal`, because it had once been `xs` (8)
     * and the dock showed TWO gutters at once — the strip 8dp from the edge and
     * the capsule directly under it 16dp.
     *
     * The capsule moved to Telegram's 7dp island inset on 2026-09-12, so
     * holding this at 16 would recreate that exact defect with the numbers
     * swapped. The strip and the capsule are one floating island and share one
     * inset; the transcript keeps its own 16dp content grid, which is what
     * Telegram does too (its input island is wider than its bubbles).
     */
    marginHorizontal: TELEGRAM_ISLAND_INSET,
    marginBottom: TOKENS.space['2xs'],
    paddingVertical: TOKENS.space.xs,
    paddingHorizontal: TOKENS.space.sm,
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border.hairline,
    backgroundColor: t.color.bg.raised,
    overflow: 'hidden',
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
  // The failed-fetch state (loadError, above): same centered layout as
  // `loading`, plus the gap `empty` already uses between its own stacked
  // elements, and the same retry-button spacing App.tsx's boot-level error
  // screen uses (`retryWrap`) so the app has one house style for "this
  // failed, try again" rather than two.
  loadErrorGap: {
    gap: TOKENS.space.xs,
    paddingHorizontal: TOKENS.space['2xl'],
  },
  loadErrorRetry: {
    alignSelf: 'stretch',
    paddingTop: TOKENS.space.xs,
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
  extendCardHeadline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: TOKENS.space['2xs'],
  },
  extendCardTimer: {
    // The same treatment the talk bar gives this exact number: `numeralMedium`
    // plus a reserved width, so m:ss does not reflow the row as digits change.
    // One clock, one type role, wherever it happens to be drawn.
    ...TOKENS.typography.numeralMedium,
    color: t.color.text.primary,
    minWidth: 42,
  },
  extendCardTitle: {
    ...TOKENS.typography.labelMediumEmphasized,
    color: t.color.text.primary,
  },
  extendCardSubtitle: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.secondary,
  },
  /*
   * ACCENT since 2026-09-08, and it was `bg/inverse` — Amit: "all prompts CTAs
   * should also follow our token system not black and white".
   *
   * "Extend" is the one action on this card (the other control dismisses it),
   * and it appears at the moment a member is about to run out of paid time. A
   * black pill at the point of purchase, on a screen whose header pill and send
   * button are both accent, was the inconsistency he means.
   *
   * `accentStrong` rather than `accent`, for the reason check-contrast records
   * on the token: a label on the bright step measures 3.01:1 in light and the
   * deep step is the one that carries text (4.52:1). Unlike
   * ProviderDetailScreen's `actionDark`, which stays inverse on purpose — it is
   * the SECOND of three actions in a row whose first is already accent, and
   * making both accent would delete the hierarchy rather than fix a colour.
   */
  extendCardButton: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space['2xs'],
    borderRadius: TOKENS.radius.pill,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.accentStrong,
  },
  extendCardButtonLabel: {
    ...TOKENS.typography.labelMediumEmphasized,
    color: t.color.text.onAccent,
  },
  /*
   * The declined-state Start control sits where the composer's text row would,
   * so the dock does not change height when it swaps in.
   */
  startSessionRow: {
    paddingHorizontal: TOKENS.space.md,
    paddingVertical: TOKENS.space.xs,
  },
  extendCardClose: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
