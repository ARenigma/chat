import type { FlashListRef } from '@shopify/flash-list';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
} from 'react-native';
import {
  KeyboardController,
  KeyboardGestureArea,
  KeyboardStickyView,
} from 'react-native-keyboard-controller';
import { useSharedValue } from 'react-native-reanimated';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import { Avatar } from '../components/Avatar';
import { Button } from '../components/Button';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon } from '../components/Icon';
import { MediaViewer } from '../components/MediaViewer';
import { RenameChatSheet } from '../components/RenameChatSheet';
import { Sheet } from '../components/Sheet';
import { MemberProfileSheet } from '../components/MemberProfileSheet';
import { M3Field } from '../components/TextField';
import { SafetySheet } from '../screens/SafetySheet';
import { useContactGuardMode } from '../api/appConfig';
import {
  CONTACT_GUARD_NOTICE,
  contactGuardNotice,
  precheckContactGuard,
} from '../lib/contactGuard';
import type { ReactionEmoji } from '../lib/database.types';
import { errorTick } from '../lib/haptics';
import { openRefill } from '../lib/routes/actions';
import { MAX_MESSAGE_CHARS } from '../lib/tokenLedger';
import type { VoiceDraft } from '../lib/voice';
import { useChatKeyboardFrozen } from './useChatKeyboardFrozen';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStore } from '../store/useStore';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { chatV2PageDownBottom, type ChatV2CallPermissions } from './cells';
import { ChatActionsV2, type ChatV2ActionRequest } from './ChatActionsV2';
import { BirthDetailsSheet } from './BirthDetailsSheet';
import { ChatWallpaper } from '../components/ChatWallpaper';
import { ChatComposerV2, type ChatComposerV2Handle } from './ChatComposerV2';
import { ChatHeaderV2 } from './ChatHeaderV2';
import { ChatListV2 } from './ChatListV2';
import type { ChatV2Anchor } from './ChatMessageCellV2';
import { ChatPageDownV2 } from './ChatPageDownV2';
import { ChatSessionBarV2 } from './ChatSessionBarV2';
import { chatV2Arrival, chatV2InitialIndex, chatV2RowIds, chatV2ScrolledAway } from './chatState';
import {
  chatV2RecentOwnTexts,
  type ChatV2ImageBody,
  type ChatV2Row,
} from './rows';
import {
  chatV2ConsentCopy,
  chatV2LeaveCopy,
  chatV2SessionBand,
  type ChatV2LeaveIntent,
} from './session';
import {
  useChatV2Controller,
  type ChatV2MessageTarget,
} from './useChatV2Controller';

interface Props {
  /**
   * The PEER's profile id, whichever side of the thread we are on: a provider
   * id on the member tree, a member id on the provider tree. Every route this
   * screen feeds takes a peer rather than a role, which is what lets one
   * screen serve both trees.
   */
  providerId: string;
  benchmarkReadOnly?: boolean;
  onBack: () => void;
  /**
   * Start a call with this peer. Undefined disables every call affordance in
   * the screen — the header controls and the call-back on a missed row — so a
   * tap never dead-ends.
   */
  onStartCall?: (channel: 'audio' | 'video') => void;
  /**
   * The peer's profile card. Member tree only: on the provider tree the peer
   * is a member with no profile card, and the identity block opens the safety
   * sheet instead.
   */
  onOpenProfile?: (peerId: string) => void;
  /**
   * The chat is in use (navigation step 6; see `ChatV2Gates` in the
   * controller). Defaults to true: the old tree unmounts a covered chat.
   */
  live?: boolean;
  /**
   * The chat is the screen on top. Its true → false edge is the blur cleanup
   * below. Defaults to true.
   */
  focused?: boolean;
  /**
   * What the route adapter needs for `usePreventRemove` (nav-migration §4,
   * 3a), published whenever it changes. The adapter is the chat's single
   * exit: hardware back reaches this screen only through it.
   */
  onGuard?: (guard: ChatV2Guard) => void;
}

/** The chat's removal guard, as its route adapter reads it. */
export interface ChatV2Guard {
  /** A paid session is live: leaving asks first. */
  sessionActive: boolean;
  /** A reply strip is open: hardware back clears it before anything else. */
  replyActive: boolean;
  leaveVisible: boolean;
  clearReply: () => void;
  /** The same dialog the header arrow and back open. */
  openLeave: (intent: ChatV2LeaveIntent) => void;
  /** An intentional exit drops the draft (see `leaveChat`). */
  purgeDraft: () => void;
  /** The thread, once resolved: the adapter resets its peer activity on unmount. */
  conversationId: string | undefined;
}

/** A dock height to lay out against before the first measurement lands. */
const DOCK_ESTIMATE = 64;

/**
 * One card-height of scroll, after which the pinned extend card counts as out
 * of sight and the recharge bar takes the band.
 */
const EXTEND_CARD_HEIGHT = 64;

/**
 * The V2 shell: one layout authority and no domain logic.
 *
 * Keyboard geometry lives here (and only here) — `KeyboardGestureArea` around
 * the pair, `KeyboardChatScrollView` inside the list, `KeyboardStickyView`
 * under the dock. Everything about the CONVERSATION comes from
 * `useChatV2Controller`, which renders nothing. That separation is the whole
 * lesson of the retired port attempt: two systems both believing they own the
 * bottom of the screen is what parked the composer mid-screen.
 */
export function ChatScreenV2({
  providerId,
  benchmarkReadOnly = false,
  onBack,
  onStartCall,
  onOpenProfile,
  live = true,
  focused = true,
  onGuard,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const { bottom } = useSafeAreaInsets();
  // A sheet over the chat owns any keyboard it opens: the dock stays put
  // behind it (useChatKeyboardFrozen).
  const covered = useChatKeyboardFrozen();
  const chat = useChatV2Controller(providerId, benchmarkReadOnly, { live, focused });
  const mutationOnStartCall = benchmarkReadOnly ? undefined : onStartCall;
  const { rows, sendText, sendVoice } = chat;
  const listRef = useRef<FlashListRef<ChatV2Row> | null>(null);

  /* ---- the dock, measured whole ----------------------------------------- */
  /*
   * ONE measurement for every sticky child — the consent row, the start-session
   * row, the reply strip and the composer — and it drives all three consumers:
   * the transcript's extra content padding, the gesture area's offset, and
   * where the page-down control sits.
   *
   * Measuring the composer alone was the defect this replaces: the moment a
   * reply strip appeared, the dock grew by its height and the transcript's
   * padding and the page-down control both stayed where they were, so the
   * newest bubble and the control both went under the dock.
   */
  const [dockHeight, setDockHeight] = useState(DOCK_ESTIMATE + bottom);
  const extraContentPadding = useSharedValue(DOCK_ESTIMATE + bottom);

  const onDockLayout = useCallback(
    (event: LayoutChangeEvent) => {
      const height = Math.ceil(event.nativeEvent.layout.height);

      extraContentPadding.set(height);
      setDockHeight(current => (current === height ? current : height));
    },
    [extraContentPadding],
  );

  /* ---- reply, edit, delete, report -------------------------------------- */
  const [actionRequest, setActionRequest] =
    useState<ChatV2ActionRequest | null>(null);
  const [replyTo, setReplyTo] = useState<ChatV2MessageTarget | null>(null);
  const [editing, setEditing] = useState<ChatV2MessageTarget | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  const [deleting, setDeleting] = useState<ChatV2MessageTarget | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  /*
   * The safety sheet opens from two places with two meanings: a long press on
   * one message reports THAT message, and the header identity reports the
   * THREAD. One piece of state with a nullable id rather than two booleans,
   * so the two can never both be open.
   */
  const [safety, setSafety] = useState<{
    open: boolean;
    messageId: string | null;
  }>({ open: false, messageId: null });
  const [renaming, setRenaming] = useState(false);
  const [viewerImage, setViewerImage] = useState<ChatV2ImageBody | null>(null);
  const [memberProfileVisible, setMemberProfileVisible] = useState(false);

  const { actionsFor, targetOf, chosenReactionOf } = chat;
  const onMessageLongPress = useCallback(
    (messageId: string, mine: boolean, anchor: ChatV2Anchor) => {
      const actions = actionsFor(messageId);
      if (actions.surface === 'none') {
        return;
      }
      setActionRequest({
        messageId,
        mine,
        anchor,
        actions,
        chosenReaction: chosenReactionOf(messageId),
      });
    },
    [actionsFor, chosenReactionOf],
  );
  const closeActions = useCallback(() => setActionRequest(null), []);

  const { toggleReaction } = chat;
  const onReact = useCallback(
    (messageId: string, emoji: ReactionEmoji) => {
      toggleReaction(messageId, emoji);
    },
    [toggleReaction],
  );
  const onReply = useCallback(
    (messageId: string) => {
      setReplyTo(targetOf(messageId) ?? null);
    },
    [targetOf],
  );
  const onReport = useCallback((messageId: string) => {
    setSafety({ open: true, messageId });
  }, []);
  const closeSafety = useCallback(
    () => setSafety({ open: false, messageId: null }),
    [],
  );
  /*
   * Both open something rather than acting. An edit needs the new text, and a
   * delete is irreversible for the other person too, which is the case M3 says
   * a confirmation dialog is for.
   * https://m3.material.io/components/dialogs/guidelines
   */
  const onEdit = useCallback(
    (messageId: string) => {
      const target = targetOf(messageId);
      if (target === undefined) {
        return;
      }
      setEditing(target);
      setEditDraft(target.body ?? '');
    },
    [targetOf],
  );
  const onDelete = useCallback(
    (messageId: string) => {
      setDeleting(targetOf(messageId) ?? null);
    },
    [targetOf],
  );

  const { editMessage, deleteMessage } = chat;
  const commitEdit = useCallback(async () => {
    if (editing === null) {
      return;
    }
    setEditBusy(true);
    const ok = await editMessage(editing.messageId, editDraft);
    setEditBusy(false);
    // Stays open on failure with the text still in the field: the notice says
    // why, and closing would throw away what they typed to no purpose.
    if (ok) {
      setEditing(null);
      setEditDraft('');
    }
  }, [editDraft, editMessage, editing]);
  const commitDelete = useCallback(async () => {
    if (deleting === null) {
      return;
    }
    setDeleteBusy(true);
    await deleteMessage(deleting.messageId);
    setDeleteBusy(false);
    // Closed either way: a refusal has already surfaced a notice, and leaving a
    // destructive dialog up invites a second tap at the same refusal.
    setDeleting(null);
  }, [deleteMessage, deleting]);

  const onOpenImage = useCallback((image: ChatV2ImageBody) => {
    setViewerImage(image);
  }, []);
  const closeImage = useCallback(() => setViewerImage(null), []);

  const { retryMessage } = chat;
  const onRetry = useCallback(
    (messageId: string) => {
      retryMessage(messageId);
    },
    [retryMessage],
  );

  /* ---- sending ---------------------------------------------------------- */
  /*
   * The reply bar clears on send, whichever way the answer was written: a
   * reply composed and then answered with a recording is still a reply.
   */
  /*
   * The contact guard's precheck runs first, and only in enforce mode (it
   * returns null otherwise): a message the server would refuse is explained
   * before the send and never leaves the field. The server still decides, and
   * a predicted block is not sent "once for the strike": strikes are the
   * server's to count, on its own refusals. `false` tells the composer to keep
   * the text so the sender can edit it.
   */
  const guardMode = useContactGuardMode();
  const setNotice = useStore(s => s.setNotice);
  // Read at the moment of send, so a new message does not re-create the
  // composer's handler.
  const rowsRef = useRef(rows);
  rowsRef.current = rows;

  /*
   * The session-start dialog, asked at the moment of sending and never on its
   * own (Amit, 2026-10-03: a provider's message just arrives; replying is what
   * asks). The send returns false so the composer keeps the text or the
   * recording; yes starts the session and `resend()` sends what was held, not
   * now leaves it where it is. `consentGranted` covers the gap between the
   * yes and the session query catching up, so the resend is not asked again.
   */
  const composerRef = useRef<ChatComposerV2Handle>(null);
  const consentGranted = useRef(false);
  const heldBirthDetails = useRef<string | null>(null);
  const [askConsent, setAskConsent] = useState(false);
  const { consentBeforeSend } = chat;
  useEffect(() => {
    if (!consentBeforeSend) {
      consentGranted.current = false;
    }
  }, [consentBeforeSend]);
  const clearReview = useStore(s => s.clearReview);
  const holdForConsent = useCallback(() => {
    if (!consentBeforeSend || consentGranted.current) {
      return false;
    }
    // A new session request supersedes an unanswered review of the last one:
    // left pending it sat stacked under this dialog (B-BS-9, S22, 2026-10-02).
    clearReview();
    setAskConsent(true);
    return true;
  }, [consentBeforeSend, clearReview]);

  const onSend = useCallback(
    (text: string): boolean => {
      const refusal = precheckContactGuard(
        text,
        guardMode,
        chatV2RecentOwnTexts(rowsRef.current, Date.now()),
      );
      if (refusal) {
        setNotice(
          contactGuardNotice(refusal) ?? CONTACT_GUARD_NOTICE.CONTACT_INFO,
        );
        errorTick();
        return false;
      }
      if (holdForConsent()) {
        return false;
      }
      const parent = replyTo;
      setReplyTo(null);
      void sendText(text, parent?.messageId ?? null);
      return true;
    },
    [guardMode, holdForConsent, replyTo, sendText, setNotice],
  );
  /*
   * The birth-details card, astrologer chats only. It sends through `onSend`,
   * so the precheck and the reply strip treat it exactly as typed text.
   */
  const [birthVisible, setBirthVisible] = useState(false);
  const openBirthDetails = useCallback(() => setBirthVisible(true), []);
  const closeBirthDetails = useCallback(() => setBirthVisible(false), []);
  const onBirthDetails =
    chat.peerIsAstrologer && !benchmarkReadOnly ? openBirthDetails : undefined;

  const onSendVoice = useCallback(
    (draft: VoiceDraft) => {
      if (holdForConsent()) {
        return false;
      }
      const parent = replyTo;
      setReplyTo(null);
      void sendVoice(draft, parent?.messageId ?? null);
      return true;
    },
    [holdForConsent, replyTo, sendVoice],
  );
  // The birth-details card sends outside the composer, so it holds its own.
  const onSendBirthDetails = useCallback(
    (body: string) => {
      if (consentBeforeSend && !consentGranted.current) {
        heldBirthDetails.current = body;
        setAskConsent(true);
        return false;
      }
      return onSend(body);
    },
    [consentBeforeSend, onSend],
  );
  const { acceptConsent } = chat;
  const onConsentConfirm = useCallback(() => {
    acceptConsent(
      () => {
        consentGranted.current = true;
        setAskConsent(false);
        const birth = heldBirthDetails.current;
        heldBirthDetails.current = null;
        if (birth === null) {
          composerRef.current?.resend();
        } else if (onSend(birth)) {
          setBirthVisible(false);
        }
      },
      () => setAskConsent(false),
    );
  }, [acceptConsent, onSend]);
  const onConsentCancel = useCallback(() => {
    heldBirthDetails.current = null;
    setAskConsent(false);
  }, []);

  /* ---- leaving, and the three ways a draft dies ------------------------- */
  /*
   * A draft survives the app being killed and does not survive an INTENTIONAL
   * exit. There are two of those from this screen — leaving it, and starting a
   * call — and both funnel through one wrapper each so there is exactly one
   * place either can be missed. Nothing else in this file calls `onBack` or
   * `onStartCall` directly; a test asserts that.
   */
  const { purgeDraft } = chat;
  const leaveChat = useCallback(() => {
    purgeDraft();
    onBack();
  }, [onBack, purgeDraft]);

  /* ---- calls ------------------------------------------------------------ */
  const startCall = useCallback(
    (channel: 'audio' | 'video') => {
      purgeDraft();
      mutationOnStartCall?.(channel);
    },
    [mutationOnStartCall, purgeDraft],
  );
  const onCallBack = useCallback(
    (medium: 'voice' | 'video') => {
      startCall(medium === 'video' ? 'video' : 'audio');
    },
    [startCall],
  );
  // Memoised so the list's prop identity is stable and the cell memo holds.
  const callPermissions = useMemo<ChatV2CallPermissions>(
    () => ({
      canStartAudio: chat.canStartAudio,
      canStartVideo: chat.canStartVideo,
      sessionBusy: chat.sessionBusy,
      callsAvailable: mutationOnStartCall !== undefined,
    }),
    [
      chat.canStartAudio,
      chat.canStartVideo,
      chat.sessionBusy,
      mutationOnStartCall,
    ],
  );

  /* ---- the paid session -------------------------------------------------- */
  /*
   * Dismissal is per VISIT, not persisted: a member who says "not now" and
   * comes back tomorrow is answering a different question, and persisting it
   * would need a key per conversation for a decision worth almost nothing.
   */
  const [extendDismissed, setExtendDismissed] = useState(false);
  const [extendScrolledAway, setExtendScrolledAway] = useState(false);
  const bandInput = {
    isMemberSide: chat.isMemberSide,
    status: chat.activeSession?.status ?? null,
    remaining: chat.sessionRemaining,
    extendDismissed,
  };
  const band = chatV2SessionBand({ ...bandInput, extendScrolledAway });
  /*
   * Whether the card WOULD be offered, ignoring the scroll. The same rule
   * asked a second way rather than a second rule: the scroll latch has to be
   * released when the card stops being eligible at all (the session ended, the
   * balance was topped up), or the next eligible window opens straight into
   * the recharge bar.
   */
  const extendEligible = chatV2SessionBand({
    ...bandInput,
    extendScrolledAway: false,
  }).showExtend;
  useEffect(() => {
    if (!extendEligible) {
      setExtendScrolledAway(false);
    }
  }, [extendEligible]);

  /*
   * One dialog, two intents: back (end the session and leave) and the header's
   * End control (end it and stay). Both are the same irreversible act on the
   * same money, so a second dialog would only be a second place for the copy
   * to drift — see `chatV2LeaveCopy`.
   */
  const [leaveVisible, setLeaveVisible] = useState(false);
  const [leaveIntent, setLeaveIntent] = useState<ChatV2LeaveIntent>('leave');
  const { activeSession, syncSessionClock, endSession, askReview } = chat;
  /*
   * The benchmark route observes and never writes, so it must not OFFER to end
   * a session either: an End control that refuses is worse than no control,
   * and a back press trapped behind a confirmation nobody can satisfy is worse
   * than both.
   */
  const sessionActive = !benchmarkReadOnly && activeSession !== null;
  const openLeave = useCallback(
    (intent: ChatV2LeaveIntent) => {
      // The body quotes the elapsed time, and above five minutes the clock only
      // repaints every 15s — re-anchor so the figure is exact at open.
      syncSessionClock();
      setLeaveIntent(intent);
      setLeaveVisible(true);
    },
    [syncSessionClock],
  );
  const requestLeave = useCallback(() => {
    if (!sessionActive) {
      leaveChat();
      return;
    }
    openLeave('leave');
  }, [leaveChat, openLeave, sessionActive]);
  const requestEnd = useCallback(() => {
    if (!sessionActive) {
      return;
    }
    openLeave('end');
  }, [openLeave, sessionActive]);
  const confirmLeave = useCallback(() => {
    const sessionId = activeSession?.id ?? null;
    const leaving = leaveIntent === 'leave';
    endSession({
      onEnded: () => {
        setLeaveVisible(false);
        /*
         * The controller's edge-watcher cannot see THIS end: `onBack()`
         * unmounts the screen in the same tick, long before the invalidated
         * `get_active_session` refetch can flip `activeSession` to null. So
         * the leave-and-end path — the ordinary way out of a chat — would end
         * every session without ever asking how it went.
         */
        if (leaving) {
          if (sessionId !== null) {
            askReview(sessionId);
          }
          leaveChat();
        }
      },
      // Closed either way, with a notice saying why: leaving a destructive
      // dialog up invites a second tap at the same refusal.
      onFailed: () => setLeaveVisible(false),
    });
  }, [activeSession, askReview, endSession, leaveChat, leaveIntent]);

  /* ---- back -------------------------------------------------------------- */
  /*
   * Hardware back is the route's (`ChatRoute`'s `usePreventRemove`, nav §4
   * 3a): it clears a reply first, asks before leaving a paid session, and
   * otherwise pops. Every sheet and dialog here is an RN Modal, which takes
   * back itself through `onRequestClose` before any listener hears it, so
   * the old ladder's Modal steps (`chatV2BackStep`) never run on back.
   */

  /* ---- the route's guard, and what a blur leaves behind ----------------- */
  const clearReply = useCallback(() => setReplyTo(null), []);
  useEffect(() => {
    onGuard?.({
      sessionActive,
      replyActive: replyTo !== null,
      leaveVisible,
      clearReply,
      openLeave,
      purgeDraft,
      conversationId: chat.conversationId,
    });
  }, [onGuard, sessionActive, replyTo, leaveVisible, clearReply, openLeave, purgeDraft, chat.conversationId]);

  /*
   * On blur, a covered chat leaves nothing above or under the next screen
   * (nav-migration §5, A4). Every Modal this screen owns is closed, because a
   * Modal is its own window and would sit over whatever was pushed; the IME
   * goes, because a keyboard raised for a covered field is typing into
   * nothing (https://developer.android.com/develop/ui/views/touch-and-input/keyboard-input/visibility);
   * and voice playback stops, because the unmount that used to stop it no
   * longer runs. The composer discards a recording and saves the draft on the
   * same edge, and the header closes its menu. The consent dialog is not
   * closed: it is the server's pending request, and it is still pending on
   * return. Never runs in the old tree, where `focused` stays true.
   */
  const stopVoice = chat.voicePlayer.stop;
  const wasFocused = useRef(focused);
  useEffect(() => {
    if (wasFocused.current && !focused) {
      setActionRequest(null);
      setEditing(null);
      setDeleting(null);
      setSafety({ open: false, messageId: null });
      setRenaming(false);
      setViewerImage(null);
      setMemberProfileVisible(false);
      setLeaveVisible(false);
      void KeyboardController.dismiss();
      stopVoice();
    }
    wasFocused.current = focused;
  }, [focused, stopVoice]);

  /* ---- where the transcript sits ---------------------------------------- */
  /*
   * Read in the arrival effect below, which must not re-run when the member
   * scrolls — hence a ref beside the state. The state exists only so the
   * page-down control re-renders.
   */
  const [scrolledAway, setScrolledAway] = useState(false);
  const scrolledAwayRef = useRef(false);
  const [unreadBelow, setUnreadBelow] = useState(0);
  /*
   * The row ids the last commit held. A SET rather than a count, because the
   * badge has to say how many messages arrived and a count cannot tell three
   * from one — nor an arrival from an edit that rebuilt every row object.
   */
  const previousRowIds = useRef<ReadonlySet<string>>(new Set<string>());

  const scrollToLatest = useCallback(() => {
    listRef.current?.scrollToOffset({ offset: 0, animated: true });
    setUnreadBelow(0);
  }, []);

  /*
   * Re-pin to the newest message when the dock's height lands or changes.
   * On a warm open the rows come from cache and pin to offset 0 BEFORE the
   * dock has measured; the dock's height then grows the list's bottom inset
   * (extraContentPadding) and the newest messages sat under the composer by
   * exactly the dock's height until a scroll (S22, 2026-10-04: back + rail
   * re-open, newest row 323px below where it belonged). Only when the member
   * is at the bottom: reading history is never yanked.
   */
  useEffect(() => {
    if (dockHeight === 0 || scrolledAwayRef.current) {
      return;
    }
    // Twice: the inset is applied on the UI thread from the shared value, and
    // on a warm open that can land a frame or two after this commit; one
    // frame alone missed it about one open in three on the S22. The second
    // pin is a no-op when the first already held.
    const pin = () => {
      if (!scrolledAwayRef.current) {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      }
    };
    const frame = requestAnimationFrame(pin);
    const settle = setTimeout(pin, 160);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(settle);
    };
  }, [dockHeight]);

  const onScrollOffset = useCallback(
    (offsetY: number) => {
      const away = chatV2ScrolledAway(offsetY);
      scrolledAwayRef.current = away;
      setScrolledAway(previous => (previous === away ? previous : away));
      if (!away) {
        setUnreadBelow(0);
      }
      /*
       * The extend card's own threshold, and it is deliberately much tighter
       * than the page-down one above: this asks "is the pinned card still in
       * view", which is one card-height, while that asks "is the member
       * reading history", which wants a forgiving margin.
       */
      if (band.showExtend && offsetY > EXTEND_CARD_HEIGHT) {
        setExtendScrolledAway(true);
      }
    },
    [band.showExtend],
  );

  /*
   * The ONLY thing in this screen that scrolls the list, and it scrolls for
   * one reason: a row I just sent appeared at the front. Everything else that
   * arrives while the member is reading history is counted, not chased — see
   * `chatV2Arrival` for the rule, for how much of an arrival is countable
   * mail, and for the defects both replace.
   *
   * Nothing keyboard-shaped may enter this path. The IME lift is native, on
   * the UI thread, inside `KeyboardChatScrollView`; a JS scroll racing it is
   * exactly the double-authority jump this rewrite exists to remove.
   * https://developer.android.com/develop/ui/views/layout/sw-keyboard
   */
  useEffect(() => {
    const { action, peerArrivals } = chatV2Arrival(
      previousRowIds.current,
      rows,
      scrolledAwayRef.current,
    );
    previousRowIds.current = chatV2RowIds(rows);
    if (action === 'idle') {
      return;
    }
    if (action === 'count') {
      // What actually arrived, not one per commit: a reconnect delivers a
      // whole missed stretch in a single batch.
      setUnreadBelow(n => n + peerArrivals);
      return;
    }
    setUnreadBelow(0);
    /*
     * FlashList v2 commits its native cells after React publishes `data`.
     * Waiting one frame stops an offset-0 request landing against the old
     * layout and becoming a no-op when a batch arrives after invalidation.
     */
    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToOffset({ offset: 0, animated: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [rows]);

  /*
   * One-shot: position at the unread divider the first time it appears.
   *
   * This effect runs AFTER the arrival effect (React fires effects in source
   * order within the same commit), so its requestAnimationFrame is queued
   * second and executes after the arrival's pin-to-0, overriding it. Once
   * `unreadScrollDone` is set, subsequent row rebuilds (peer messages
   * arriving, read receipts, edits) do not repeat it — the member is now
   * reading and the normal arrival/page-down logic takes over.
   *
   * The list is inverted, so scroll coordinates run from the visual bottom:
   * `viewPosition: 1` puts the divider at the visual top with the unread
   * messages below it. When they all fit on screen the offset clamps to 0,
   * which is the newest message, same as the arrival pin.
   */
  const unreadScrollDone = useRef(false);
  useEffect(() => {
    if (unreadScrollDone.current) {
      return;
    }
    const index = chatV2InitialIndex(rows);
    if (index === null) {
      return;
    }
    unreadScrollDone.current = true;
    const frame = requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: false, viewPosition: 1 });
    });
    return () => cancelAnimationFrame(frame);
  }, [rows]);

  const consentCopy = chatV2ConsentCopy({
    peerName: chat.displayName,
    theyOpenedTheChat: chat.theyOpenedTheChat,
  });
  const leaveCopy = chatV2LeaveCopy({
    intent: leaveIntent,
    sessionIsActive: chat.sessionIsActive,
    clock: chat.sessionElapsedClock,
  });

  return (
    <SafeAreaView testID="chat-v2-screen" edges={['top']} style={styles.root}>
      <ChatHeaderV2
        focused={focused}
        displayName={chat.displayName}
        peerInitial={chat.peerInitial}
        peerAvatarUrl={chat.peerAvatarUrl}
        presence={chat.presence}
        canStartAudio={chat.canStartAudio}
        canStartVideo={chat.canStartVideo}
        sessionBusy={chat.sessionBusy}
        sessionActive={sessionActive}
        endingSession={chat.endingSession}
        onBack={requestLeave}
        onOpenProfile={
          benchmarkReadOnly
            ? undefined
            : onOpenProfile !== undefined
            ? () => onOpenProfile(providerId)
            : // Provider tree: open the safe member profile sheet.
              () => setMemberProfileVisible(true)
        }
        // Both are writes behind one press, so both are absent on the
        // benchmark route rather than disabled: a report and a rename are the
        // two things this screen can do to a thread without sending a message.
        onOpenSafety={
          benchmarkReadOnly
            ? undefined
            : () => setSafety({ open: true, messageId: null })
        }
        // Only once the conversation exists: there is nothing to label before
        // then, so the long press is absent rather than inert.
        onRename={
          benchmarkReadOnly || chat.conversationId === undefined
            ? undefined
            : () => setRenaming(true)
        }
        onStartCall={mutationOnStartCall === undefined ? undefined : startCall}
        onEndSession={requestEnd}
      />

      <ChatSessionBarV2
        peerNotified={chat.peerNotified}
        displayName={chat.displayName}
        showExtend={band.showExtend}
        showRecharge={band.showRecharge}
        remaining={chat.sessionRemaining}
        onRecharge={openRefill}
        onDismissExtend={() => setExtendDismissed(true)}
      />

      <KeyboardGestureArea
        interpolator="ios"
        offset={dockHeight}
        textInputNativeID="chat-v2-input"
        style={styles.keyboardArea}
      >
        {/* The doodle wallpaper, behind everything and untouchable. v2 shipped
            without it (only v1 mounted it), and 73af7b8 then deleted the
            component as unused; restored 2026-10-03 at Amit's request. */}
        <ChatWallpaper />
        <ChatListV2
          rows={chat.rows}
          listRef={listRef}
          extraContentPadding={extraContentPadding}
          readOnly={benchmarkReadOnly}
          peerName={chat.displayName}
          // Edge-to-edge tappable content must account for system-bar insets.
          // https://developer.android.com/develop/ui/views/layout/edge-to-edge
          safeAreaOffset={bottom}
          onVisibleMessages={chat.markVisible}
          onScrollOffset={onScrollOffset}
          voicePlayer={chat.voicePlayer}
          tallies={chat.tallies}
          callPermissions={callPermissions}
          onMessageLongPress={onMessageLongPress}
          onSwipeReply={onReply}
          onRetry={onRetry}
          onOpenImage={onOpenImage}
          onCallBack={onCallBack}
        />
        {/*
         * A failed fetch is not an empty thread, and neither is a thread that
         * has not loaded yet. All three states sit over the list rather than
         * replacing it, so the keyboard hierarchy above never changes shape.
         */}
        {chat.loading ? (
          <View
            testID="chat-v2-loading"
            style={styles.status}
            pointerEvents="none"
          >
            <Text allowFontScaling style={styles.statusText}>
              Loading…
            </Text>
          </View>
        ) : chat.loadError ? (
          <View testID="chat-v2-error" style={styles.status}>
            <Text allowFontScaling style={styles.statusText}>
              Couldn&apos;t load this chat
            </Text>
            <Pressable
              testID="chat-v2-retry"
              accessibilityRole="button"
              accessibilityLabel="Try again"
              style={styles.retry}
              onPress={chat.refetch}
            >
              <Text allowFontScaling style={styles.retryLabel}>
                Try Again
              </Text>
            </Pressable>
          </View>
        ) : chat.empty ? (
          <View
            testID="chat-v2-empty"
            style={styles.status}
            pointerEvents="none"
          >
            {/*
             * First contact, and it is the moment the member learns a real
             * person is on the other end — so it says who, with their face,
             * rather than only printing an instruction. The breathing mark is
             * the same one the rest of the app uses for "someone is there".
             *
             * No entrance: this branch sits INSIDE the keyboard hierarchy,
             * where the one rule is that nothing hand-rolls motion.
             */}
            <Avatar
              initial={chat.peerInitial}
              uri={chat.peerAvatarUrl}
              size={56}
              tone="warm"
              breathing
            />
            <Text
              allowFontScaling
              maxFontSizeMultiplier={
                TOKENS.fontScaleCap.headlineSmallEmphasized
              }
              numberOfLines={1}
              style={styles.emptyName}
            >
              {/* The label when one is set, so the empty state calls this
                  person what the header just called them. */}
              {chat.displayName}
            </Text>
            <Text allowFontScaling style={styles.statusText}>
              {chat.displayName === '' ? '' : `Say hi to ${chat.displayName}`}
            </Text>
          </View>
        ) : null}

        {/*
         * Page down, in its OWN sticky view with the dock's offset.
         *
         * Two `KeyboardStickyView`s with one offset move as one under the IME,
         * so the control keeps its gap above the dock frame by frame — on the
         * UI thread, with no JS scroll in the path. Its `bottom` clears the
         * whole MEASURED dock (`chatV2PageDownBottom`), so a reply strip
         * appearing pushes it up instead of sliding under it.
         */}
        <KeyboardStickyView
          offset={{ opened: bottom }}
          enabled={!covered}
          style={[
            styles.pageDownDock,
            { bottom: chatV2PageDownBottom(dockHeight) },
          ]}
          pointerEvents="box-none"
        >
          <ChatPageDownV2
            testID="chat-v2-page-down"
            visible={scrolledAway}
            unreadBelow={unreadBelow}
            onPress={scrollToLatest}
          />
        </KeyboardStickyView>

        <KeyboardStickyView
          offset={{ opened: bottom }}
          enabled={!covered}
          style={styles.dock}>
          {/* ONE measured wrapper around every sticky child. See `onDockLayout`. */}
          <View
            testID="chat-v2-dock"
            style={styles.dockBody}
            onLayout={onDockLayout}
          >
            {replyTo !== null ? (
              <View testID="chat-v2-reply" style={styles.replyBar}>
                <View style={styles.replyRule} />
                <View style={styles.replyFill}>
                  <Text
                    allowFontScaling
                    numberOfLines={1}
                    style={styles.replyAuthor}
                  >
                    {`Replying to ${replyTo.author}`}
                  </Text>
                  <Text
                    allowFontScaling
                    numberOfLines={1}
                    style={styles.replyBody}
                  >
                    {replyTo.preview}
                  </Text>
                </View>
                <Pressable
                  testID="chat-v2-reply-cancel"
                  accessibilityRole="button"
                  accessibilityLabel="Cancel reply"
                  hitSlop={TOKENS.space.xs}
                  style={styles.replyClose}
                  onPress={() => setReplyTo(null)}
                >
                  <Icon
                    name="close"
                    size={TOKENS.icon.xs}
                    color={theme.color.text.secondary}
                  />
                </Pressable>
              </View>
            ) : null}
            <ChatComposerV2
              ref={composerRef}
              bottomInset={bottom}
              readOnly={benchmarkReadOnly}
              conversationId={chat.conversationId}
              disabled={chat.composerDisabled}
              placeholder={chat.composerPlaceholder}
              onSend={onSend}
              onBirthDetails={onBirthDetails}
              onSendVoice={onSendVoice}
              onTyping={chat.notifyTyping}
              onRecording={chat.notifyRecording}
              onRecordingEnded={chat.notifyRecordingEnded}
              focused={focused}
            />
          </View>
        </KeyboardStickyView>
      </KeyboardGestureArea>

      {/*
       * Every Modal-hosted surface is a sibling of the keyboard hierarchy, not
       * a child of a list cell: a Modal declared inside a FlashList cell
       * unmounts with the cell when the list recycles it.
       */}
      <ChatActionsV2
        request={actionRequest}
        onClose={closeActions}
        onReact={onReact}
        onReply={onReply}
        onReport={onReport}
        onEdit={onEdit}
        onDelete={onDelete}
      />

      <SafetySheet
        visible={safety.open}
        onClose={closeSafety}
        conversationId={chat.conversationId}
        peerId={providerId}
        peerName={chat.displayName}
        messageId={safety.messageId}
      />

      {/* Safe member profile sheet (provider tree only — when the identity
          tap opens a member's info rather than routing to a provider detail). */}
      <MemberProfileSheet
        visible={memberProfileVisible}
        peerName={chat.peerName}
        peerAvatarUrl={chat.peerAvatarUrl}
        onClose={() => setMemberProfileVisible(false)}
      />

      <BirthDetailsSheet
        visible={birthVisible}
        onClose={closeBirthDetails}
        onSend={onSendBirthDetails}
      />

      {/*
       * The private label (migration 098). Only the person who sets it sees
       * it; clearing the field reverts to the peer's own name, which is why
       * the sheet takes both.
       */}
      <RenameChatSheet
        visible={renaming}
        onClose={() => setRenaming(false)}
        conversationId={chat.conversationId}
        currentLabel={chat.customLabel}
        peerName={chat.peerName}
      />

      {/*
       * The body names the fifteen-minute window and says the other person
       * will be told, because both are true and neither is discoverable
       * otherwise: the server refuses a late edit, and `edited_at` puts
       * "Edited" on the bubble on both devices.
       */}
      <Sheet
        visible={editing !== null}
        testID="chat-v2-edit"
        title="Edit message"
        body="You can edit for 15 minutes after sending. They will see that it was edited."
        onClose={() => setEditing(null)}
        onCancel={() => setEditing(null)}
      >
        <M3Field
          testID="chat-v2-edit-input"
          accessibilityLabel="Message text"
          value={editDraft}
          onChangeText={setEditDraft}
          // The same ceiling `messages.body`'s CHECK enforces, so the field
          // stops where the database would rather than failing after a tap.
          maxLength={MAX_MESSAGE_CHARS}
          multiline
          autoFocus
        />
        <Button
          label="Done"
          busy={editBusy}
          busyLabel="Updating"
          disabled={editDraft.trim() === ''}
          testID="chat-v2-edit-done"
          onPress={() => {
            void commitEdit();
          }}
        />
      </Sheet>

      <ConfirmDialog
        visible={deleting !== null}
        testID="chat-v2-delete"
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

      {/*
       * The one prompt that asks a member to start paying, opened by their
       * own send (`holdForConsent`). Not now refuses nothing: the request
       * stays, the message stays in the composer, and the next send asks
       * again.
       */}
      <ConfirmDialog
        visible={askConsent}
        testID="chat-v2-consent"
        title={consentCopy.title}
        body={consentCopy.body}
        cancelLabel="Not now"
        confirmLabel="Start session"
        busy={chat.consentBusy}
        busyLabel="Just a moment"
        onCancel={onConsentCancel}
        onConfirm={onConsentConfirm}
      />

      {/* One dialog, two intents: back (end and leave) and the header's End
          control (end and stay). See `chatV2LeaveCopy`. */}
      <ConfirmDialog
        visible={leaveVisible}
        testID="chat-v2-leave"
        title={leaveCopy.title}
        body={leaveCopy.body}
        cancelLabel={leaveCopy.cancelLabel}
        confirmLabel={leaveCopy.confirmLabel}
        destructive
        busy={chat.endingSession}
        busyLabel="Ending…"
        onCancel={() => setLeaveVisible(false)}
        onConfirm={confirmLeave}
      />

      <MediaViewer image={viewerImage} onClose={closeImage} />
    </SafeAreaView>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: t.color.bg.base,
    },
    keyboardArea: {
      flex: 1,
      backgroundColor: t.color.bubble.wallpaper,
    },
    status: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      gap: TOKENS.space.sm,
    },
    statusText: {
      ...TOKENS.typography.bodyMedium,
      color: t.color.text.secondary,
    },
    emptyName: {
      ...TOKENS.typography.headlineSmallEmphasized,
      color: t.color.text.primary,
    },
    retry: {
      minHeight: TOKENS.interaction.minTarget,
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space.md,
      borderRadius: TOKENS.radius.pill,
      backgroundColor: t.color.bg.accentStrong,
    },
    retryLabel: {
      ...TOKENS.typography.labelLarge,
      color: t.color.text.onAccent,
    },
    dock: {
      position: 'absolute',
      bottom: 0,
      width: '100%',
    },
    dockBody: {
      width: '100%',
      backgroundColor: t.color.bg.base,
    },
    // Right-aligned above the dock. `box-none` so the empty space beside the
    // control still belongs to the transcript underneath it.
    pageDownDock: {
      position: 'absolute',
      right: TOKENS.space.sm,
    },
    dockRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.sm,
      paddingHorizontal: TOKENS.space.sm,
      paddingTop: TOKENS.space.xs,
    },
    replyBar: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      paddingHorizontal: TOKENS.space.sm,
      paddingTop: TOKENS.space.xs,
    },
    replyRule: {
      width: 2,
      alignSelf: 'stretch',
      borderRadius: 1,
      backgroundColor: t.color.bg.accentStrong,
    },
    replyFill: {
      flex: 1,
      paddingVertical: TOKENS.space['2xs'],
    },
    replyAuthor: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.primary,
    },
    replyBody: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
    replyClose: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: TOKENS.radius.pill,
    },
  });
