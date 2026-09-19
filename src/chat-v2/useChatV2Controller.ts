/**
 * Everything the V2 chat shell needs to know about a conversation, and nothing
 * about how it is laid out.
 *
 * This is the seam. `ChatScreenV2` owns the whole keyboard hierarchy — the
 * gesture area, the chat scroll view and the sticky composer — and nothing
 * else; this hook owns the domain and renders nothing. The split is the point
 * of the slice: the reason the previous port attempt failed was two layout
 * authorities in one tree, so the new shell is allowed exactly one, and the
 * domain is not it. A contract test holds the line by grepping this file for
 * the keyboard components and the inset hook.
 *
 * It composes the app's EXISTING hooks — `src/api/chat`, `src/api/realtime`,
 * `src/api/sessions`, `src/api/reactions`, `src/api/voice`,
 * `src/api/attachments` — rather than re-deriving any of them. Nothing here
 * imports `src/screens/ChatScreen.tsx`, `Turn.tsx`, `Composer.tsx`,
 * `imeGeometry`, `keyboardEngine` or `keyboardPanel`; a contract test asserts
 * that, because the whole value of this directory is that V1 keeps working
 * while V2 is built beside it.
 *
 * The session chrome arrived here on 2026-09-19, and the reason it is safe to
 * hold both is that a ROUTE picks one screen: `chat` mounts whichever
 * `CHAT_SCREEN` names and `chatV2` mounts V2, so V1 and V2 are never in the
 * tree together and cannot race the opener cursor or end the same session
 * twice. What this hook owns now that V1 also owns:
 *   - the automated-opener orchestrator, behind `chatV2OwnsOpeners`;
 *   - the consent pair (confirm / decline) and the resume after a decline;
 *   - the countdown's aged figure, its tick, and the elapsed clock;
 *   - ending a session, and the review prompt on the edge one ends;
 *   - the private conversation label, and the provider's earnings figure.
 * The SURFACES those feed — dialogs, sheets, the band, the header — are the
 * screen's, not this hook's: it still renders nothing.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CALLS_ENABLED } from '../api/calls';
import { useKillSwitches } from '../api/appConfig';
import { useRetryImageSend } from '../api/attachments';
import {
  canDeleteMessage,
  canEditMessage,
  useCalls,
  useConversationId,
  useConversations,
  useDeleteMessage,
  useEditMessage,
  useLiveMessageEdits,
  useMessages,
  useOutboxReplay,
  useProfile,
  useProviders,
  useSelfId,
  useSendMessage,
} from '../api/chat';
import { useLiveConversation, useMarkRead } from '../api/realtime';
import { useReactions, useToggleReaction } from '../api/reactions';
import {
  useActiveSession,
  useAnnounceChatOpen,
  useChatConsent,
  useConfirmChatSession,
  useDeclineSessionRequest,
  useEndSession,
  usePendingSessionRequest,
  useResumeChatConsent,
  useSessionEvents,
  useSessionLease,
  useSessionRealtime,
  type PaidSession,
} from '../api/sessions';
import { useEarnings } from '../api/provider';
import { useConversationLabels } from '../api/conversationLabels';
import {
  useRetryVoiceSend,
  useSendVoiceNote,
  useVoicePlayer,
} from '../api/voice';
import type { ReactionEmoji } from '../lib/database.types';
import { clearChatDraft } from '../lib/chatDraft';
import { initialOf } from '../lib/display';
import { readPresence, type PresenceRead } from '../lib/presence';
import {
  clockTickMs,
  formatClock,
  secondsRemainingNow,
} from '../lib/sessionClock';
import {
  ownReaction,
  tallyByMessage,
  type ReactionTally,
} from '../lib/reactions';
import { isPending, PENDING_PREFIX } from '../lib/transcript';
import type { VoiceDraft, VoicePlayer } from '../lib/voice';
import {
  selectPeerActivity,
  useStore,
  type PeerActivity,
} from '../store/useStore';
import {
  chatV2ConsentFailure,
  chatV2MessageActions,
  type ChatV2MessageActions,
} from './cells';
import {
  chatV2ComposerState,
  chatV2LoadState,
  chatV2MutationInputs,
} from './chatState';
import {
  chatV2HasLiveMessage,
  chatV2OwnsOpeners,
} from './openers';
import {
  chatV2HasLiveProviderMessage,
  chatV2ReviewOnEnd,
  chatV2SessionStartedAt,
} from './session';
import { useChatV2Openers } from './useChatV2Openers';
import {
  buildChatV2Rows,
  chatV2MessageText,
  chatV2RetryKind,
  resolveChatV2Conversation,
  unreadAnchorOf,
  type ChatV2MessageRow,
  type ChatV2Notice,
  type ChatV2Row,
} from './rows';

/** Stable empty tally map, so a thread with no reactions never re-renders. */
const NO_TALLIES: ReadonlyMap<string, ReactionTally[]> = new Map();

export interface ChatV2Controller {
  /* ---- identity, for the header --------------------------------------- */
  conversationId: string | undefined;
  /** Which side of the thread we are on; not `profiles.role`. */
  isMemberSide: boolean;
  /** Blank, never 'Conversation', while the sources are still loading. */
  peerName: string;
  /**
   * What the header prints: the private label (migration 098) when this person
   * has set one, and the peer's own name otherwise. Only they see it.
   */
  displayName: string;
  /** The label itself, so the rename sheet opens on what is already set. */
  customLabel: string | undefined;
  peerInitial: string;
  peerAvatarUrl: string | null;
  presence: PresenceRead;
  /** The peer is typing or holding the mic, from the realtime channel. */
  peerActivity: PeerActivity | null;
  /**
   * A push really went out to an away peer. Server-gated on presence, balance
   * and cooldown, so the bar it drives can never claim a notification that was
   * not sent.
   */
  peerNotified: boolean;

  /* ---- the transcript -------------------------------------------------- */
  /** Newest first: the `inverted` FlashList convention. */
  rows: readonly ChatV2Row[];
  loading: boolean;
  loadError: boolean;
  empty: boolean;
  refetch: () => void;

  /* ---- sending --------------------------------------------------------- */
  /** `replyToId` is the quoted parent, or null for a plain send. */
  sendText: (text: string, replyToId?: string | null) => Promise<boolean>;
  sendVoice: (draft: VoiceDraft, replyToId?: string | null) => Promise<boolean>;
  /** Re-fires a failed row through the path that matches its payload. */
  retryRow: (row: ChatV2MessageRow) => void;
  retryMessage: (messageId: string) => void;
  notifyTyping: () => void;
  notifyRecording: () => void;
  notifyRecordingEnded: () => void;

  /* ---- reactions ------------------------------------------------------- */
  tallies: ReadonlyMap<string, ReactionTally[]>;
  chosenReactionOf: (messageId: string) => ReactionEmoji | null;
  toggleReaction: (messageId: string, emoji: ReactionEmoji) => void;

  /* ---- acting on one message ------------------------------------------- */
  /**
   * What a long press on this message may offer. Decided here because only the
   * controller holds `selfId` and can ask `canEditMessage` — the cell knows
   * only whether to arm the recogniser.
   */
  actionsFor: (messageId: string) => ChatV2MessageActions;
  /** Author and preview for the reply strip and the edit field. */
  targetOf: (messageId: string) => ChatV2MessageTarget | undefined;
  editMessage: (messageId: string, body: string) => Promise<boolean>;
  deleteMessage: (messageId: string) => Promise<boolean>;

  /* ---- media ----------------------------------------------------------- */
  /** One playhead for the whole transcript; there is one native player. */
  voicePlayer: VoicePlayer;

  /* ---- read receipts --------------------------------------------------- */
  /** Wire to the list's `onViewableItemsChanged`, not to arrival. */
  markVisible: (visibleIds: readonly string[]) => void;

  /* ---- the draft ------------------------------------------------------- */
  /**
   * Throw away the stored draft for this thread.
   *
   * Called on an INTENTIONAL exit only — leaving the chat, or starting a call.
   * A backgrounded app keeps its draft; that is the case the draft exists for.
   */
  purgeDraft: () => void;

  /* ---- session / consent / composer ------------------------------------ */
  activeSession: PaidSession | null;
  awaitingMemberConsent: boolean;
  offerExplicitStart: boolean;
  chatClosed: boolean;
  composerDisabled: boolean;
  composerPlaceholder: string;
  /** The way back in after a decline. No-op until the thread exists. */
  startSession: () => void;
  startingSession: boolean;
  canStartAudio: boolean;
  canStartVideo: boolean;
  /** A non-chat session is live, so a second call cannot start. */
  sessionBusy: boolean;

  /* ---- the pending consent prompt -------------------------------------- */
  /** The other person opened this chat, which changes what is being agreed to. */
  theyOpenedTheChat: boolean;
  /** Accept the pending request and start billing. Reports its own failure. */
  acceptConsent: () => void;
  /** Refuse, for this CONVERSATION rather than for this one request (082). */
  declineConsent: () => void;
  consentBusy: boolean;

  /* ---- the countdown --------------------------------------------------- */
  /** True only while `paid_sessions.status` is 'active'. */
  sessionIsActive: boolean;
  /** Seconds the balance still buys, aged locally from the server snapshot. */
  sessionRemaining: number | null;
  /** m:ss of how long this session has been running, for the leave dialog. */
  sessionElapsedClock: string | null;
  /** Re-anchor the clock before quoting it — above five minutes it is coarse. */
  syncSessionClock: () => void;

  /* ---- ending ---------------------------------------------------------- */
  /**
   * Ends the live session. `onEnded` runs only once the server has accepted —
   * an optimistic exit would leave the member believing a charge had stopped
   * that had not. `onFailed` runs after the refusal notice, so the caller can
   * put its dialog away rather than leaving one up at the same refusal.
   */
  endSession: (handlers?: {
    onEnded?: () => void;
    onFailed?: () => void;
  }) => void;
  endingSession: boolean;
  /** Ask for a rating on a session that has just ended. Member side only. */
  askReview: (sessionId: string) => void;

  /* ---- the provider's wallet ------------------------------------------- */
  /** Earnings tokens, for the provider-side header pill. Null while loading. */
  earningsTokens: number | null;
}

/** The message a reply strip quotes, or an edit field is editing. */
export interface ChatV2MessageTarget {
  messageId: string;
  mine: boolean;
  author: string;
  /** The raw body, which is null on a voice note or a photo. */
  body: string | null;
  /** What to show when there is no body — 'Voice note', 'Photo'. */
  preview: string;
}

export function useChatV2Controller(
  providerId: string,
  benchmarkReadOnly = false,
): ChatV2Controller {
  // Mirrors the authoritative balance into the store, which is what both send
  // paths gate on before they spend anything.
  useProfile();
  const setNotice = useStore(s => s.setNotice);
  const openRefill = useStore(s => s.openRefill);
  const requestReview = useStore(s => s.requestReview);
  const { data: selfId } = useSelfId();
  const { data: providers } = useProviders();
  const {
    data: threads,
    isError: threadsError,
    refetch: refetchThreads,
  } = useConversations();

  /*
   * Resolved twice from one function rather than once from two: the hook below
   * has to know whether the RPC is needed BEFORE its answer exists, and a
   * second inline `threads.find` here is how the two copies drift.
   *
   * The RPC runs only for a thread the cached list does not hold. A known
   * thread already carries its id, so reopening a chat costs one round trip
   * (messages) instead of two — and the provider side, where `providerId` is a
   * MEMBER's profile id that `open_conversation` would reject, never asks.
   */
  const needsOpen = useMemo(
    () => resolveChatV2Conversation(threads, providerId, undefined).needsOpen,
    [threads, providerId],
  );
  const openMutationInputs = chatV2MutationInputs({
    benchmarkReadOnly,
    conversationId: undefined,
    selfId,
    providerId,
    needsOpen,
  });
  const {
    data: openedId,
    isError: openError,
    refetch: refetchOpen,
  } = useConversationId(openMutationInputs.openProviderId);
  const { knownThread, conversationId, isMemberSide } = useMemo(
    () => resolveChatV2Conversation(threads, providerId, openedId),
    [threads, providerId, openedId],
  );
  const mutationInputs = chatV2MutationInputs({
    benchmarkReadOnly,
    conversationId,
    selfId,
    providerId,
    needsOpen,
  });

  const {
    data: messages,
    isPending: messagesPending,
    isError: messagesError,
    refetch: refetchMessages,
  } = useMessages(conversationId);
  const { data: callRecords } = useCalls(conversationId);
  const { data: sessionEvents } = useSessionEvents(conversationId);
  /*
   * `dataUpdatedAt` is the instant the server's snapshot was taken — the only
   * moment `seconds_remaining` was exactly right, and what the countdown below
   * is aged from. Recomputing it from `balance` would jump by ±60s on every
   * refetch, because the client cannot tell whether the current minute has
   * been deducted yet (migration 062).
   */
  const { data: activeSession = null, dataUpdatedAt: sessionSyncedAt } =
    useActiveSession(conversationId);
  const { data: pendingRequest } = usePendingSessionRequest(conversationId);
  const { data: chatConsent } = useChatConsent(conversationId);
  const resumeConsent = useResumeChatConsent();
  const confirmChat = useConfirmChatSession();
  const declineRequest = useDeclineSessionRequest();
  const { mutate: endSessionMutate, isPending: endingSession } = useEndSession();
  /*
   * The provider's wallet. Fetched on both sides because the hook is
   * unconditional and the query is cheap and shared — the HEADER is what
   * decides the pill is a provider-only control.
   */
  const { data: earnings } = useEarnings();
  const { data: conversationLabels } = useConversationLabels();

  useSessionRealtime(conversationId);
  useSessionLease(benchmarkReadOnly ? null : activeSession);

  const { notifyTyping, notifyRecording, notifyRecordingEnded } =
    useLiveConversation(
      mutationInputs.liveConversationId,
      mutationInputs.liveSelfId,
    );
  // An edit or a delete made on the OTHER device. `useLiveConversation` reads
  // only `read_at` off the UPDATE it receives; this is the rest of that event.
  useLiveMessageEdits(conversationId, selfId);
  const markVisible = useMarkRead(
    mutationInputs.markReadConversationId,
    mutationInputs.markReadSelfId,
  );

  const send = useSendMessage(
    mutationInputs.outboxConversationId,
    mutationInputs.liveSelfId,
  );
  /*
   * Replay anything the persisted outbox still holds for this thread. Safe
   * because every entry carries its original nonce, so a replay of a send that
   * actually landed is collapsed by migration 081 rather than duplicated.
   */
  useOutboxReplay(mutationInputs.outboxConversationId, send);
  /*
   * `send` behind a ref for the retry tap: a retry does not need to be
   * reactive, it needs to be current when tapped, and taking `send` as a
   * dependency of the row callbacks would re-render every bubble whenever its
   * identity changed.
   */
  const sendRef = useRef(send);
  sendRef.current = send;
  const sendVoiceNote = useSendVoiceNote(
    mutationInputs.outboxConversationId,
    mutationInputs.liveSelfId,
  );
  // Retry-only siblings: the object already uploaded and only
  // `send_message_idempotent` failed, so retrying is the RPC alone.
  const retryImage = useRetryImageSend(
    mutationInputs.outboxConversationId,
    mutationInputs.liveSelfId,
  );
  const retryVoice = useRetryVoiceSend(
    mutationInputs.outboxConversationId,
    mutationInputs.liveSelfId,
  );
  const voicePlayer = useVoicePlayer();

  /*
   * Reactions for the loaded page. Pending rows are excluded: their ids are
   * `pending-…`, which no server row can carry, so including them would churn
   * the query key on every send for no result.
   */
  const messageIds = useMemo(
    () => (messages ?? []).filter(m => !isPending(m)).map(m => m.id),
    [messages],
  );
  const { data: reactionRows } = useReactions(conversationId, messageIds);
  const toggle = useToggleReaction(mutationInputs.outboxConversationId);
  const tallies = useMemo(
    () =>
      reactionRows === undefined
        ? NO_TALLIES
        : tallyByMessage(reactionRows, selfId),
    [reactionRows, selfId],
  );
  const chosenReactionOf = useCallback(
    (messageId: string) =>
      ownReaction(
        tallies.get(messageId),
        reactionRows ?? [],
        messageId,
        selfId,
      ),
    [tallies, reactionRows, selfId],
  );
  const toggleReaction = useCallback(
    (messageId: string, emoji: ReactionEmoji) => {
      if (benchmarkReadOnly) {
        return;
      }
      void toggle(messageId, emoji);
    },
    [benchmarkReadOnly, toggle],
  );

  /*
   * The divider's anchor, snapshotted once per conversation. Read receipts are
   * viewport-gated, so messages keep arriving at `read_at !== null` as they
   * scroll into view; recomputing this from live data would make the divider
   * retreat and vanish exactly as the member reads past it.
   *
   * `selfId` is a separate query and is not guaranteed to resolve before
   * `messages` does — locking the ref on a run where it was still undefined
   * would permanently snapshot "nothing unread". Both are awaited.
   */
  const [unreadAnchorId, setUnreadAnchorId] = useState<string | null>(null);
  const anchorComputedFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (
      conversationId === undefined ||
      messages === undefined ||
      selfId === undefined ||
      anchorComputedFor.current === conversationId
    ) {
      return;
    }
    anchorComputedFor.current = conversationId;
    setUnreadAnchorId(unreadAnchorOf(messages, selfId));
  }, [conversationId, messages, selfId]);

  /* ---- identity --------------------------------------------------------- */
  const provider = providers?.find(p => p.id === providerId);
  /*
   * The thread first, the directory only as a fallback: `provider_directory`
   * contains providers by construction, and on the provider side `providerId`
   * is a member's profile id, so the directory lookup misses every time.
   *
   * Blank rather than 'Conversation' while either source is still loading —
   * the literal is the genuine dead end (no summary row and no directory row),
   * not the cold-open state.
   */
  const nameFromData = knownThread?.peer_display_name ?? provider?.display_name;
  const identityLoading = threads === undefined || providers === undefined;
  const peerName = nameFromData ?? (identityLoading ? '' : 'Conversation');
  /*
   * A private custom label (migration 098) overrides the peer's name in THIS
   * person's own header and nowhere else — resolved client-side, so the shared
   * conversation is untouched. Long-pressing the identity block renames it.
   */
  const customLabel =
    conversationId === undefined
      ? undefined
      : conversationLabels?.get(conversationId);
  const displayName = customLabel ?? peerName;
  const peerAvatarUrl =
    knownThread?.peer_avatar_url ?? provider?.avatar_url ?? null;
  /*
   * A member has no listing switch, so `peer_available` is false for one by
   * construction. Passing that through would tell a provider the person they
   * are talking to is away, which is a claim nobody made — null instead.
   */
  const presence = readPresence(
    knownThread !== undefined
      ? knownThread.peer_is_provider
        ? knownThread.peer_available
        : null
      : provider?.is_available,
  );
  const peerActivity = useStore(selectPeerActivity);

  /* ---- the ping confirmation ------------------------------------------- */
  const openAlert = useAnnounceChatOpen(
    mutationInputs.announceConversationId,
    mutationInputs.announceEnabled,
  );
  /*
   * A one-time confirmation that an away peer was actually pinged. Stamped
   * once so the row does not resort on every render, and client-only: it is a
   * confirmation of the action just taken, not durable history.
   */
  const [notifiedAt, setNotifiedAt] = useState<string | null>(null);
  useEffect(() => {
    if (openAlert?.alerted === true && notifiedAt === null) {
      setNotifiedAt(new Date().toISOString());
    }
  }, [openAlert?.alerted, notifiedAt]);
  const notice: ChatV2Notice | null = useMemo(
    () =>
      notifiedAt === null || displayName === ''
        ? null
        : {
            at: notifiedAt,
            text: `${displayName} has been notified. They'll join you here soon.`,
            icon: 'bell',
          },
    [notifiedAt, displayName],
  );
  /** Whether a push really went out, which is what the header bar renders. */
  const peerNotified = openAlert?.alerted === true;

  /* ---- the automated openers ------------------------------------------- */
  /*
   * Gated on data this screen has already fetched rather than on the RPC's
   * answer. `insert_next_opener` alone knows whether a conversation has a live
   * message, so asking it first meant every reopen of an established thread
   * flashed a fake "typing…" for up to 2.2s while the round trip came back
   * with nothing to do.
   */
  useChatV2Openers({
    providerId,
    enabled: chatV2OwnsOpeners({
      isMemberSide,
      benchmarkReadOnly,
      messagesLoaded: messages !== undefined,
      hasLiveMessage: chatV2HasLiveMessage(messages),
    }),
  });

  /* ---- rows ------------------------------------------------------------- */
  const rows = useMemo(
    () =>
      buildChatV2Rows({
        messages,
        calls: callRecords,
        sessionEvents,
        selfId,
        unreadAnchorId,
        notice,
        // The label, when there is one: a quote in a renamed thread names the
        // person the way the header does, not the way the directory does.
        peerName: displayName,
      }),
    [
      messages,
      callRecords,
      sessionEvents,
      selfId,
      unreadAnchorId,
      notice,
      displayName,
    ],
  );

  /*
   * One index for every lookup a long press, a reply or a retry needs.
   *
   * Keyed on the SERVER id rather than on the row key, because that is what
   * every one of those callers carries: a reaction, an edit and a delete all
   * name a message id, not a recycle key.
   */
  const rowsByMessageId = useMemo(() => {
    const index = new Map<string, ChatV2MessageRow>();
    for (const row of rows) {
      if (row.kind === 'message') {
        index.set(row.message.id, row);
      }
    }
    return index;
  }, [rows]);

  /*
   * Spinner / failure / first contact, decided in one pure place so the three
   * cannot overlap. See `chatV2LoadState` for each rule and the defect it
   * came from; the rules are asserted as values, not grepped out of here.
   */
  const { loading, loadError, empty } = chatV2LoadState({
    threadsLoaded: threads !== undefined,
    threadsError,
    knownThread: knownThread !== undefined,
    conversationResolved: conversationId !== undefined,
    messagesLoaded: messages !== undefined,
    messagesPending,
    messagesError,
    openError,
    rowCount: rows.length,
  });
  /*
   * Retry every query the transcript depends on, including the RPC that
   * creates the conversation. Leaving `open_conversation` out was the reason
   * a failed open had no way back: the button refetched two queries that were
   * disabled because there was no conversation id to run them against.
   */
  const refetch = useCallback(() => {
    void refetchMessages();
    void refetchThreads();
    void refetchOpen();
  }, [refetchMessages, refetchThreads, refetchOpen]);

  /* ---- sending ---------------------------------------------------------- */
  const sendText = useCallback(
    (text: string, replyToId: string | null = null) =>
      benchmarkReadOnly ? Promise.resolve(false) : send(text, replyToId),
    [benchmarkReadOnly, send],
  );
  const sendVoice = useCallback(
    (draft: VoiceDraft, replyToId: string | null = null) =>
      benchmarkReadOnly
        ? Promise.resolve(false)
        : sendVoiceNote(draft, replyToId),
    [benchmarkReadOnly, sendVoiceNote],
  );
  /*
   * A failed send keeps its bubble and offers a retry rather than vanishing.
   * Text replays through the same idempotent path with its original nonce and
   * `created_at`; an image or a voice note whose UPLOAD landed replays the RPC
   * alone. Which of the three it is comes from `chatV2RetryKind`, which reads
   * the row's resolved payload rather than guessing from the body — see there
   * for the captioned-voice-note case the body-first ladder got wrong.
   */
  const retryRow = useCallback(
    (row: ChatV2MessageRow) => {
      if (benchmarkReadOnly) {
        return;
      }
      const { message } = row;
      switch (chatV2RetryKind(row)) {
        case 'voice':
          void retryVoice(message);
          return;
        case 'image':
          void retryImage(message);
          return;
        case 'text':
          void sendRef.current(message.body ?? '', message.reply_to_id, {
            nonce: message.id.slice(PENDING_PREFIX.length),
            createdAt: message.created_at,
          });
          return;
        default:
          return;
      }
    },
    [benchmarkReadOnly, retryImage, retryVoice],
  );
  /** The same retry, reached by the id a failed cell carries. */
  const retryMessage = useCallback(
    (messageId: string) => {
      const row = rowsByMessageId.get(messageId);
      if (row !== undefined) {
        retryRow(row);
      }
    },
    [retryRow, rowsByMessageId],
  );

  /* ---- acting on one message -------------------------------------------- */
  const editMessageRpc = useEditMessage(mutationInputs.outboxConversationId);
  const deleteMessageRpc = useDeleteMessage(
    mutationInputs.outboxConversationId,
  );
  /*
   * `canEditMessage` and `canDeleteMessage` mirror every clause the server
   * re-decides, so a message past its fifteen-minute window simply has no Edit
   * row rather than one that is offered and then refused.
   */
  const actionsFor = useCallback(
    (messageId: string): ChatV2MessageActions => {
      if (benchmarkReadOnly) {
        return chatV2MessageActions({
          mine: false,
          pending: true,
          failed: false,
          deleted: true,
          canEdit: false,
          canDelete: false,
        });
      }
      const row = rowsByMessageId.get(messageId);
      if (row === undefined) {
        return chatV2MessageActions({
          mine: false,
          pending: true,
          failed: false,
          deleted: true,
          canEdit: false,
          canDelete: false,
        });
      }
      return chatV2MessageActions({
        mine: row.mine,
        pending: row.pending,
        failed: row.failed,
        deleted: row.deleted,
        canEdit: canEditMessage(row.message, selfId),
        canDelete: canDeleteMessage(row.message, selfId),
      });
    },
    [benchmarkReadOnly, rowsByMessageId, selfId],
  );
  const targetOf = useCallback(
    (messageId: string): ChatV2MessageTarget | undefined => {
      const row = rowsByMessageId.get(messageId);
      if (row === undefined) {
        return undefined;
      }
      return {
        messageId,
        mine: row.mine,
        author: row.mine ? 'You' : displayName,
        body: row.message.body,
        preview: chatV2MessageText(row),
      };
    },
    [displayName, rowsByMessageId],
  );

  /* ---- session, consent, and what the composer may do ------------------- */
  const { data: killSwitches } = useKillSwitches();
  const peerOffersChat = provider?.chat_enabled ?? true;
  const canStartAudio =
    (killSwitches?.voice_calls_enabled ?? true) &&
    CALLS_ENABLED &&
    (provider?.audio_enabled ?? true);
  const canStartVideo =
    (killSwitches?.video_calls_enabled ?? true) &&
    CALLS_ENABLED &&
    (provider?.video_enabled ?? true);
  /*
   * A call already in progress on another channel. Offering a call-back from a
   * missed-call row while one is live would dead-end at the call screen, which
   * is the case `chatV2CallModel` refuses to make tappable.
   */
  const sessionBusy =
    activeSession !== null && activeSession.channel !== 'chat';
  /*
   * 082: a decline is a fact about the CONVERSATION, not about one request.
   * Without that, the member was re-asked on every exchange.
   */
  const consentDeclined = chatConsent?.declined === true;
  const awaitingMemberConsent =
    isMemberSide &&
    !consentDeclined &&
    pendingRequest != null &&
    pendingRequest.channel === 'chat' &&
    pendingRequest.responded_at != null &&
    activeSession == null;
  const offerExplicitStart =
    isMemberSide && consentDeclined && activeSession == null;
  const chatClosed =
    isMemberSide &&
    !peerOffersChat &&
    activeSession === null &&
    pendingRequest === null;
  const {
    disabled: domainComposerDisabled,
    placeholder: domainComposerPlaceholder,
  } =
    chatV2ComposerState({
      conversationResolved: conversationId !== undefined,
      openError,
      chatClosed,
      awaitingMemberConsent,
      offerExplicitStart,
      peerName: displayName,
    });
  const composerDisabled = domainComposerDisabled;
  const composerPlaceholder = benchmarkReadOnly
    ? 'Benchmark read-only'
    : domainComposerPlaceholder;
  /*
   * The way back in after a decline — and it has to SAY something when it
   * fails. A mutation with no `onError` is a button that looks like it did
   * nothing, and the commonest failure here is the one the member can actually
   * fix: an empty balance, which opens the recharge sheet. Which of the two it
   * is comes from `chatV2ConsentFailure`, asserted as values.
   */
  const startSession = useCallback(() => {
    if (benchmarkReadOnly || conversationId === undefined) {
      return;
    }
    resumeConsent.mutate(
      { conversationId },
      {
        onError: error => {
          const failure = chatV2ConsentFailure(error);
          setNotice(failure.notice);
          if (failure.refill) {
            openRefill();
          }
        },
      },
    );
  }, [
    benchmarkReadOnly,
    conversationId,
    openRefill,
    resumeConsent,
    setNotice,
  ]);

  /* ---- the pending consent prompt --------------------------------------- */
  const theyOpenedTheChat =
    pendingRequest != null &&
    selfId != null &&
    pendingRequest.initiator_id !== selfId;
  /*
   * Accepting and resuming are two RPCs with one failure vocabulary, so they
   * share `chatV2ConsentFailure`: an empty balance names the action and opens
   * the sheet that performs it, anything else says so plainly. A mutation with
   * no `onError` is a button that looks like it did nothing.
   */
  const acceptConsent = useCallback(() => {
    if (
      benchmarkReadOnly ||
      conversationId === undefined ||
      pendingRequest == null
    ) {
      return;
    }
    confirmChat.mutate(
      { requestId: pendingRequest.id, conversationId },
      {
        onSuccess: () => setNotice('You are in', 'confirm'),
        onError: error => {
          const failure = chatV2ConsentFailure(error);
          setNotice(failure.notice);
          if (failure.refill) {
            openRefill();
          }
        },
      },
    );
  }, [
    benchmarkReadOnly,
    confirmChat,
    conversationId,
    openRefill,
    pendingRequest,
    setNotice,
  ]);
  const declineConsent = useCallback(() => {
    if (
      benchmarkReadOnly ||
      conversationId === undefined ||
      pendingRequest == null
    ) {
      return;
    }
    declineRequest.mutate({ requestId: pendingRequest.id, conversationId });
  }, [benchmarkReadOnly, conversationId, declineRequest, pendingRequest]);

  /* ---- the countdown ---------------------------------------------------- */
  /*
   * Postgres owns metering (ADR-0020). Everything below only AGES the server's
   * one-snapshot figure and decides how often to repaint it; there is
   * deliberately no local minute timer and no balance arithmetic.
   */
  const sessionIsActive = activeSession?.status === 'active';
  const sessionStartedAt = chatV2SessionStartedAt({
    status: activeSession?.status ?? null,
    startedAt: activeSession?.started_at ?? null,
    hasLiveProviderMessage: chatV2HasLiveProviderMessage(
      messages,
      activeSession,
    ),
  });
  const [sessionNow, setSessionNow] = useState(() => Date.now());
  const sessionRemaining =
    sessionStartedAt === null
      ? null
      : secondsRemainingNow(
          activeSession?.seconds_remaining,
          sessionSyncedAt,
          sessionNow,
        );
  /*
   * Per second ONLY inside the last five minutes. Above that a minutes label
   * that ticked would pull the eye sixty times a minute to a number that does
   * not matter yet.
   */
  const tickMs = clockTickMs(sessionRemaining);
  useEffect(() => {
    if (sessionStartedAt === null) {
      return;
    }
    setSessionNow(Date.now());
    const timer = setInterval(() => setSessionNow(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [sessionStartedAt, tickMs]);
  const sessionElapsedClock =
    sessionStartedAt === null
      ? null
      : formatClock(
          Math.max(
            0,
            Math.floor((sessionNow - Date.parse(sessionStartedAt)) / 1000),
          ),
        );
  /** Above five minutes the clock repaints every 15s — re-anchor before quoting it. */
  const syncSessionClock = useCallback(() => setSessionNow(Date.now()), []);

  /* ---- ending, and asking how it went ----------------------------------- */
  const askReview = useCallback(
    (sessionId: string) => {
      if (benchmarkReadOnly || !isMemberSide || displayName === '') {
        return;
      }
      requestReview(sessionId, displayName);
    },
    [benchmarkReadOnly, displayName, isMemberSide, requestReview],
  );
  const endSession = useCallback(
    (handlers?: { onEnded?: () => void; onFailed?: () => void }) => {
      if (benchmarkReadOnly || activeSession === null) {
        // Nothing to end, so the caller's "and then leave" still has to run —
        // this is the ordinary back-out of a chat with no session in it.
        handlers?.onEnded?.();
        return;
      }
      endSessionMutate(
        // 'manual' is the CHECK-allowed reason for an intentional participant
        // exit (migration 030). A bespoke string fails the constraint and
        // leaves the member stuck in a billed session.
        { sessionId: activeSession.id, reason: 'manual' },
        {
          onSuccess: () => handlers?.onEnded?.(),
          onError: () => {
            setNotice(
              'Could not end session. Check your connection and try again.',
            );
            handlers?.onFailed?.();
          },
        },
      );
    },
    [activeSession, benchmarkReadOnly, endSessionMutate, setNotice],
  );
  /*
   * The review prompt fires on the EDGE a live session ends — including ends
   * the other side made, and the server's own timeout. The leave path asks
   * separately (`askReview` from the screen), because `onBack()` unmounts this
   * hook in the same tick and the watcher would never see that transition.
   */
  const liveSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const live =
      activeSession != null && activeSession.ended_at === null
        ? activeSession.id
        : null;
    const previous = liveSessionRef.current;
    if (live !== null) {
      liveSessionRef.current = live;
      return;
    }
    const ended = chatV2ReviewOnEnd({
      previousLiveId: previous,
      liveId: live,
      isMemberSide,
      peerName: displayName,
    });
    if (previous !== null) {
      liveSessionRef.current = null;
    }
    if (ended !== null) {
      askReview(ended);
    }
  }, [activeSession, askReview, displayName, isMemberSide]);

  /* ---- the draft -------------------------------------------------------- */
  const purgeDraft = useCallback(() => {
    if (conversationId !== undefined) {
      clearChatDraft(conversationId);
    }
  }, [conversationId]);

  return {
    conversationId,
    isMemberSide,
    peerName,
    displayName,
    customLabel,
    peerInitial: initialOf(displayName),
    peerAvatarUrl,
    presence,
    peerActivity,
    peerNotified,
    rows,
    loading,
    loadError,
    empty,
    refetch,
    sendText,
    sendVoice,
    retryRow,
    retryMessage,
    notifyTyping,
    notifyRecording,
    notifyRecordingEnded,
    tallies,
    chosenReactionOf,
    toggleReaction,
    actionsFor,
    targetOf,
    editMessage: benchmarkReadOnly
      ? async () => false
      : editMessageRpc,
    deleteMessage: benchmarkReadOnly
      ? async () => false
      : deleteMessageRpc,
    voicePlayer,
    markVisible,
    purgeDraft,
    activeSession,
    awaitingMemberConsent: benchmarkReadOnly ? false : awaitingMemberConsent,
    offerExplicitStart: benchmarkReadOnly ? false : offerExplicitStart,
    chatClosed,
    composerDisabled,
    composerPlaceholder,
    startSession,
    startingSession: benchmarkReadOnly ? false : resumeConsent.isPending,
    canStartAudio: benchmarkReadOnly ? false : canStartAudio,
    canStartVideo: benchmarkReadOnly ? false : canStartVideo,
    sessionBusy,
    theyOpenedTheChat,
    acceptConsent,
    declineConsent,
    consentBusy: confirmChat.isPending || declineRequest.isPending,
    sessionIsActive,
    sessionRemaining,
    sessionElapsedClock,
    syncSessionClock,
    endSession,
    endingSession,
    askReview,
    earningsTokens: earnings?.provider_tokens ?? null,
  };
}
