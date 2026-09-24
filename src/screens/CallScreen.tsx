import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DeviceEventEmitter,
  Image,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, {
  clamp,
  FadeIn,
  ReduceMotion,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import { LIGHT, TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import type { CallResult, ProviderSummary } from '../lib/database.types';
import type { CallMedium } from '../lib/database.types';
import { initialOf } from '../lib/display';
import { avatarImageSource, clayFraming, isClayUri } from '../lib/clayAvatars';
import { useConversationId, useConversations, useProviders, useSelfId } from '../api/chat';
import { answerCall, endCall, getVideoSwitchQuote, heartbeatCall, requestVideoSwitch, respondVideoSwitch, startCall, useCallEnded, useVideoSwitch, type VideoSwitchQuote, type VideoSwitchResult } from '../api/calls';
import { VIDEO_SWITCH_REQUEST_TTL_MS } from '../lib/videoSwitch';
import { useEconomicsConfig, FALLBACK_ECONOMICS } from '../api/appConfig';
import { DURATION, EASE_OUT } from '../theme/motion';
import { useCallSession } from '../api/callMedia';
import { CallVideoView } from '../api/callMedia/CallVideoView';
import type { CallVideoSource } from '../api/callMedia/types';
import { useSessionLease } from '../api/sessions';
import {
  startCallForegroundService,
  stopCallForegroundService,
} from '../lib/conversations';
import { useStore } from '../store/useStore';
import { CallRing } from '../components/CallRing';
import { CallingDots } from '../components/CallingDots';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Icon, type IconName } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { track } from '../lib/telemetry';
import { useBackBarrier, useBackGuard } from '../lib/backGuard';
import { setKeepScreenOn } from '../lib/windowChrome';

/** Which way the call goes. Outgoing dials; incoming rings and offers answer. */
export type CallDirection = 'out' | 'in';

interface Props {
  /** The peer: the provider being called, or the caller ringing us. */
  providerId: string;
  direction: CallDirection;
  /** Set for an incoming call; null outgoing until `start_call` returns one. */
  callId: string | null;
  /** 'voice' for audio-only; 'video' auto-enables the camera on connect. */
  medium: CallMedium;
  /** Decline (incoming, ringing) or hang up (in call). Leaving the screen ends it. */
  onEnd: () => void;
}

/** How long between heartbeats while a call is up; the ticker reads last_seen_at. */
const HEARTBEAT_MS = 20_000;

/**
 * How long a call may ring before this device gives up, per side.
 *
 * Ported from the reference app, which bounds a ring on BOTH sides and does not rely on
 * the server to do it: `callReceiveTimeout` = 20 s for the caller and
 * `callRingTimeout` = 90 s for the callee (MessagesController.java:1588-1589,
 * scheduled at VoIPService.java:1151 and 1806).
 *
 * We had neither. The only bound was `meter_active_calls`, which marks a
 * `ringing` call missed after 45 s but is driven by pg_cron on a one-minute
 * tick — so a call could genuinely ring for **1 m 45 s** with the callee's
 * screen lit and the foreground service up. Two bounds, because either alone
 * has a hole: the client is fast and precise but dies with the process; the
 * cron sweep is slow but survives anything. the reference app's pattern exactly.
 *
 * Shorter than the reference app's on the callee side (60 s, not 90 s) because a ring
 * here holds a paid session request open, and 90 s of ringing on a per-minute
 * product is most of a chargeable minute spent on a phone nobody answered.
 */
const RING_TIMEOUT_OUT_MS = 30_000;
const RING_TIMEOUT_IN_MS = 60_000;

/*
 * How long 'connecting' may last before this side gives up (2026-09-17
 * audit). the reference app's own equivalent is `callConnectTimeout`, 30 s
 * (VoIPService.java:3412-3413, cited when this file's media-adapter
 * comments were written) — matched here rather than picked arbitrarily.
 *
 * Needed because of what THIS migration changes: the caller's phase used to
 * leave 'ringing' only once media actually connected, so the 30 s ring
 * timer was — by accident — also the caller's only bound on a hung media
 * join. Now that an 'active' call row moves the caller straight to
 * 'connecting' the moment the callee answers (see the useCallEnded
 * callback below), a media join that never completes would otherwise wait
 * forever with nothing watching it.
 */
const MEDIA_CONNECT_TIMEOUT_MS = 30_000;

/*
 * How long a mid-call reconnect is given before this side gives up
 * (2026-09-17 audit). Same 30 s as MEDIA_CONNECT_TIMEOUT_MS and the same
 * the reference app precedent (callConnectTimeout) — a reconnect and a fresh
 * connect are the same kind of wait from the user's point of view, so they
 * share one bound rather than each inventing its own number.
 */
const RECONNECT_TIMEOUT_MS = 30_000;

/*
 * Not a code any RPC returns — src/api/calls.ts synthesises it when the RPC
 * RAISES. Worth its own sentence rather than falling through to the generic
 * "Could not start the call", because it says the two things a member actually
 * needs: it is not their phone, and it did not cost them anything. The
 * 2026-09-08 outage said "Check your connection" for a whole day while a check
 * constraint rejected every call.
 *
 * A named constant because two call sites need it and `START_NOTICE` is a
 * `Record<string, string>`, so reading a key off it is `string | undefined`.
 */
const SERVER_ERROR_NOTICE =
  'Something went wrong on our side. Nothing was charged.';

/** start_call refusals, in words. */
const START_NOTICE: Record<string, string> = {
  INSUFFICIENT_BALANCE: 'Your balance is too low to call.',
  BUSY: 'One of you is already on a call.',
  BLOCKED: 'You can no longer call each other.',
  SUSPENDED: 'Your account is under review and cannot call.',
  RATE_LIMITED: 'A few too many calls just now. Try again in a bit.',
  FORBIDDEN: 'That conversation is not available.',
  NOT_FOUND: 'That conversation is gone.',
  VOICE_CALLS_DISABLED: 'Voice chats are taking a short break.',
  VIDEO_CALLS_DISABLED: 'Video chats are taking a short break.',
  SERVER_ERROR: SERVER_ERROR_NOTICE,
};

type Phase = 'starting' | 'ringing' | 'connecting' | 'active' | 'incoming';

/**
 * The call, over WebRTC. One screen for both directions, driven by phase.
 *
 * Outgoing: resolves the conversation from the peer, calls `start_call`, then
 * runs the session as the offerer while it rings. Incoming: Decline plus
 * Accept (provider) or Start session (member). Either confirm calls
 * `answer_call` (which starts the meter) and runs
 * the session as the answerer. `useCallSession` carries the media; this screen
 * carries the server row (start/answer/heartbeat/end) and the UI.
 *
 * Leaving the screen ends the call: an unmount hangs up on the server if the
 * call was live, so End, Decline, and the hardware back button all resolve
 * through one path.
 *
 * Video: every call negotiates a video transceiver from the start (camera off).
 * Toggling uses RTCRtpSender.replaceTrack so no renegotiation is needed. If the
 * call was started as `medium='video'`, the camera is auto-enabled on connect.
 */
export function CallScreen({ providerId, direction, callId: incomingCallId, medium, onEnd }: Props) {
  /*
   * This screen covers Home, and Home stays mounted underneath it (App.tsx
   * renders pushed screens as overlays so returning never remounts Home's
   * lists). Without this barrier Home's search guard — live whenever its search
   * field is open — still hears the hardware back press from up here, closes a
   * field nobody can see, and reports the press handled, so this screen never
   * pops. See src/lib/backGuard.ts.
   */
  useBackBarrier();

  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const setNotice = useStore(s => s.setNotice);
  const openRefill = useStore(s => s.openRefill);
  const { data: providers } = useProviders();
  const provider = useMemo<ProviderSummary | null>(
    () => (providers ?? []).find(p => p.id === providerId) ?? null,
    [providers, providerId],
  );
  /*
   * Which side of this thread we are on, and who the review sheet should name.
   *
   * Same source and the same reason as the chat
   * (`resolveChatV2Conversation` in `src/chat-v2/rows.ts`):
   * `i_am_member` on the summary row, never `profiles.role`, because migration
   * 007 lets a member admitted as a provider keep the threads they paid for —
   * and because this screen serves the provider tree too, where `providerId` is
   * a *member's* profile id that `provider_directory` will never contain, so
   * the directory lookup above cannot answer the question.
   *
   * Defaults to true for the one case the list cannot cover: a member calling
   * straight from the directory, before any summary row for that thread has
   * reached this device. Defaulting the other way would silently swallow the
   * review after every first call — the call whose rating matters most.
   *
   * That optimism used to be defended here as costing "at worst one sheet whose
   * Send fails", on the grounds that `submit_session_review` refuses anybody but
   * the session's member (066:109). It was the wrong trade: a provider being
   * asked to rate a member is a question this product does not have, and a
   * server error is not an answer to it. 2026-09-13 the sheet stopped taking
   * either screen's word for it — `useWasTheMember`
   * (SessionFeedbackSheet.tsx) reads `paid_sessions.member_id` before it can
   * open — so the default below is free to stay optimistic for the UI without
   * that optimism ever reaching a provider's screen.
   *
   * The last-resort name is the chat's ('Conversation'), not a new string:
   * both paths fill the same sheet title, and a second word for the same hole
   * is how two screens end up disagreeing about the same missing peer.
   */
  const { data: threads } = useConversations();
  const peerThread = threads?.find(t => t.peer_id === providerId);
  const isMemberSide = peerThread?.i_am_member ?? true;
  const reviewPeerName =
    peerThread?.peer_display_name ?? provider?.display_name ?? 'Conversation';

  /*
   * Who this call names and pictures — resolved from the summary row FIRST, the
   * provider directory only as a fallback. `useProviders()` is the provider
   * *directory* and holds no members, so on the provider's own screen the peer
   * is a member the directory will never contain: reading `provider.*` there
   * left the provider looking at "Incoming call" and a blank ring while the
   * member saw a name and a face. `peerThread` (useConversations) carries
   * `peer_display_name` and `peer_avatar_url` for BOTH directions, so it is the
   * identity source and the directory is the pre-first-summary fallback the
   * member side used to lean on.
   */
  const peerName =
    peerThread?.peer_display_name ??
    provider?.display_name ??
    (direction === 'in' ? 'Incoming call' : 'Calling');
  const name = peerName;
  const peerAvatarUrl =
    peerThread?.peer_avatar_url ?? provider?.avatar_url ?? null;
  const initial = initialOf(
    peerThread?.peer_display_name ?? provider?.display_name,
  );
  // A member's avatar_url is always a `clay:<seed>` sentinel naming a bundled
  // PNG, so it must not reach <Image> as a uri. avatarImageSource resolves both
  // shapes; the clay art is drawn wider than its box and needs clayFraming.
  const faceSource = avatarImageSource(peerAvatarUrl, AVATAR, AVATAR, 75);
  const backdropSource = avatarImageSource(
    peerAvatarUrl,
    windowWidth,
    windowHeight,
    60,
  );
  const peerIsClay = peerAvatarUrl !== null && isClayUri(peerAvatarUrl);
  const [faceFailed, setFaceFailed] = useState(false);
  const [backdropFailed, setBackdropFailed] = useState(false);

  const [callId, setCallId] = useState<string | null>(incomingCallId);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [accepted, setAccepted] = useState(direction === 'out');
  // An upgrade-from-audio call already has a callId on mount — skip 'starting'
  // and go straight to 'ringing'. Normal outgoing calls start with null callId.
  const [phase, setPhase] = useState<Phase>(
    direction === 'in' ? 'incoming' : incomingCallId !== null ? 'ringing' : 'starting',
  );
  const [upgrading, setUpgrading] = useState(false);
  /**
   * In-place media upgrade (migration 123): a pending request from the PEER
   * to switch audio↔video on the live call. Shown as a consent dialog.
   * null = no request pending; `requestedBy` is the peer's id.
   */
  const [videoRequestFrom, setVideoRequestFrom] = useState<string | null>(null);
  /**
   * The call's medium NOW. `medium` is the route prop and never changes, so
   * after an accepted switch to video everything keyed on it (layout, keep
   * screen on, the button, the lease channel) stayed on voice.
   */
  const [liveMedium, setLiveMedium] = useState<CallMedium>(medium);
  const liveMediumRef = useRef(liveMedium);
  liveMediumRef.current = liveMedium;
  /** The member confirms the price before asking to switch (132). */
  const [videoPriceVisible, setVideoPriceVisible] = useState(false);
  const [memberConsented, setMemberConsented] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  /*
   * M23 (2026-09-17 audit): the other party's own outgoing call to us landed
   * in this same conversation while ours was still resolving (migration 120's
   * ALREADY_RINGING). Their call — not the one this screen was about to place
   * — is the one to answer, so its id is held separately from `callId` until
   * the dialog below is confirmed.
   */
  const [alreadyRingingCallId, setAlreadyRingingCallId] = useState<string | null>(null);
  // Back must not silently end a call. Leaving this screen hangs up (unmount →
  // endCall), so a bare hardware back was a one-tap hang-up with no confirm.
  // The red button stays immediate — that IS the explicit intent, as on every
  // phone — but back asks first (goal item 6, 2026-09-05: "no back mid-session").
  const [leaveDialogVisible, setLeaveDialogVisible] = useState(false);
  const backGuard = useCallback(() => {
    setLeaveDialogVisible(true);
    return true;
  }, []);
  useBackGuard(backGuard);

  // Outgoing needs the conversation the call belongs to; a member calling a
  // provider resolves it exactly as opening a chat does.
  const { data: openedId } = useConversationId(direction === 'out' ? providerId : null);
  // For an incoming call (provider receiving), the conversation is in peerThread.
  // (Reserved for future use — in-place upgrade no longer needs it.)
  const _conversationId = openedId ?? peerThread?.conversation_id; void _conversationId;

  // End on unmount if the call was live, so End / Decline / hardware-back all
  // hang up through one path. Refs so the cleanup sees the latest without
  // re-subscribing.
  const callIdRef = useRef<string | null>(callId);
  callIdRef.current = callId;
  useEffect(
    () => () => {
      if (callIdRef.current !== null) {
        void endCall(callIdRef.current);
      }
      stopCallForegroundService();
    },
    [],
  );

  /*
   * The call is over — ask the member how it went (goal item 14).
   *
   * The chat has done this since 066 for a session that ends in a thread
   * (`askReview` in `src/chat-v2/useChatV2Controller.ts`), and the store's
   * own comment on `requestReview`
   * ("if a call and its chat both notice the same session ending") describes
   * this half as if it existed. It did not. Every voice or video session that
   * ended while the member was on THIS screen — which is every call that is not
   * abandoned back into the chat — was never rated, and the directory's ratings
   * were therefore a chat-only measurement.
   *
   * Unmount is the trigger because unmount is already this screen's single
   * exit. End Call, Decline, the back-guard dialog, a peer hang-up noticed by
   * the heartbeat (`status === 'ended'`), a media failure (`connState ===
   * 'failed'`) and a server-side end for an exhausted balance all funnel into
   * `onEnd`, which pops the route and unmounts us; the effect above is the
   * proof, because it is how the server learns the call ended at all. Five
   * separate triggers for one exit is five chances to miss one.
   *
   * Declared AFTER that effect on purpose: React runs cleanups in declaration
   * order, so `endCall` is in flight before the sheet opens, and
   * `submit_session_review` refuses a session whose status is not yet 'ended'
   * (066:115). `end_call` is what ends it (037:1152).
   *
   * TWO conditions, and they answer different questions.
   *
   * `sessionId !== null` asks "did this bill anything". `start_call` (044:196)
   * hands back a `session_request_id` and no session, so a refused start, a
   * call cancelled while ringing and a declined incoming ring all reach here
   * with nothing to rate.
   *
   * `connectedTrackedRef` asks "was there ever a call to have an opinion
   * about", and it is the one Amit named (2026-09-07: "session end review
   * should not fire when there was no connection"). It is needed because the
   * first condition is not sufficient: `answer_call` (037:1008) creates the
   * paid_sessions row for a call that has not connected yet, so a call that was
   * answered and then failed to connect has a session id and nothing whatsoever
   * to review. Asking "how was your session?" about a call that never audibly
   * happened is worse than not asking — it invites a one-star rating of the
   * network onto a provider's directory average.
   *
   * The latch is reused rather than added: it already exists to fire
   * `call_answered` exactly once (:325), is set only in the
   * `connState === 'connected'` branch, and is never reset — so at cleanup it
   * means "media connected at least once during this screen's life", which is
   * exactly the question. Reading `connState` here would not work: by unmount
   * it has moved to `closed`.
   *
   * It is declared BELOW this effect (:281) and that is safe rather than
   * lucky: the only read is inside the returned cleanup, which cannot run
   * until the whole component body has evaluated. Nothing reads it during
   * render, so there is no temporal-dead-zone hazard.
   *
   * A NOTE THAT USED TO SAY THE OPPOSITE. This block previously claimed a
   * failed-after-answer call "is still CHARGED for its first minute" and asked
   * for a refund path. That was true of the pre-037 model and is not true now:
   * `accept_session_request` (086:174) inserts the session at `pending_leases`
   * and debits nothing, and the first `deduct_tokens` happens in
   * `claim_session_lease` (037:439) only once both sides hold a `connected`
   * lease. A call that never connects bills zero, so a refund path would credit
   * tokens that were never taken. The real hole was on this client — it
   * asserted a `connected` lease before media existed — and that is fixed at
   * `useSessionLease` above, where the untrue claim was being made.
   *
   * The one end left uncovered is a hang-up in the same second the media
   * connected, before the first heartbeat has answered with the id — the id is
   * the review's primary key, so there is no row to write the rating against.
   *
   * Member side only, and that is the schema's decision rather than a product
   * one: `submit_session_review` raises `only the member may review` whenever
   * `auth.uid() <> paid_sessions.member_id` (066:109).
   *
   * `isMemberSideRef` is the first filter, not the guarantee. It reads the
   * conversation summary row, which defaults to "member" when that row has not
   * arrived (:177), so on its own it can put the sheet in front of a provider.
   * The sheet asks the session row the same question before it opens, and
   * declines to open on anything but a `member_id` that matches this account.
   * Kept here as well because the cheap check spares the round trip on the
   * overwhelmingly common path, and because a screen that knows it is the
   * provider should not be raising the notice in the first place.
   */
  const requestReview = useStore(s => s.requestReview);
  // Refs for the same reason `callIdRef` has one: the cleanup must see the
  // latest values without the effect re-subscribing on every heartbeat.
  const sessionIdRef = useRef<string | null>(sessionId);
  sessionIdRef.current = sessionId;
  const isMemberSideRef = useRef(isMemberSide);
  isMemberSideRef.current = isMemberSide;
  const reviewPeerNameRef = useRef(reviewPeerName);
  reviewPeerNameRef.current = reviewPeerName;
  useEffect(
    () => () => {
      const billed = sessionIdRef.current;
      if (billed !== null && isMemberSideRef.current && connectedTrackedRef.current) {
        requestReview(billed, reviewPeerNameRef.current);
      }
    },
    [requestReview],
  );

  // Outgoing: place the call once the conversation resolves.
  useEffect(() => {
    if (direction !== 'out' || callId !== null || openedId === undefined) {
      return;
    }
    const needsConsent = isMemberSide && incomingCallId === null;
    if (needsConsent && !memberConsented) {
      return;
    }
    let live = true;
    void startCall(openedId, medium).then((r: CallResult | null) => {
      if (!live) {
        return;
      }
      if (r && r.success && r.call_id) {
        track('call_started', {
          backend: r.media_backend ?? 'current',
          direction,
          medium,
        });
        setCallId(r.call_id);
        setSessionId(r.session_id ?? null);
        setPhase('ringing');
      } else {
        const code = r?.error;
        /*
         * `sqlstate` is only ever set on a synthesised SERVER_ERROR, and it is
         * the difference between "calls are down" and "one member had bad
         * wifi" in the events table. Before this, a raised RPC returned null,
         * so `reason` was literally 'network' for a schema fault — the
         * analytics agreed with the wrong message on the screen.
         *
         * Empty string rather than omitted: EventProps takes primitives only.
         * The key clears telemetryGuard's FORBIDDEN_PROP_KEY, and the value is
         * five characters of SQLSTATE, never row data.
         */
        track('call_rejected', {
          reason: code ?? 'network',
          medium,
          sqlstate: r?.sqlstate ?? '',
        });
        if (code === 'ALREADY_RINGING' && r?.call_id) {
          setAlreadyRingingCallId(r.call_id);
          return;
        }
        if (code === 'INSUFFICIENT_BALANCE' && !isMemberSide) {
          setNotice('Their balance is too low to start this call.');
        } else {
          setNotice(code ? (START_NOTICE[code] ?? 'Could not start the call.') : 'Could not start just now. Check your connection.');
          if (code === 'INSUFFICIENT_BALANCE') {
            openRefill();
          }
        }
        onEnd();
      }
    });
    return () => {
      live = false;
    };
  }, [direction, openedId, callId, medium, isMemberSide, incomingCallId, memberConsented, onEnd, setNotice, openRefill]);

  useEffect(() => {
    if (callId === null) return;
    // Declare the MICROPHONE foreground-service type from the FIRST start, not
    // only once media is ready (below). Android 14 (targetSdk 34+) SILENTLY
    // drops microphone capture for a foreground service that started without
    // FOREGROUND_SERVICE_TYPE_MICROPHONE — and Agora begins capturing the mic
    // as it joins the channel, before `mediaReady` flips. Starting the type
    // late meant the very first buffers were dropped, which on a real device
    // is "the call connects but there is no audio."
    // https://developer.android.com/about/versions/14/changes/fgs-types-required#microphone
    //
    // `name` is deliberately NOT a dependency (M22, 2026-09-17 audit): this
    // effect owns the service's LIFECYCLE (start once, stop once on
    // unmount/call-end), and `name` starts as a placeholder ("Incoming
    // call"/"Calling") until peerThread/provider resolve, then changes once.
    // With `name` in these deps that one change re-ran this whole effect,
    // and its cleanup below is a TRUE stop — CallForegroundService.stop()
    // calls stopService(), which tears the Android service down (onDestroy)
    // — immediately followed by a fresh start(): a visible notification
    // flicker and a brief gap out of the promoted foreground state. The
    // effect below refreshes the notification's name once it resolves,
    // without touching this one's lifecycle.
    startCallForegroundService(name, direction === 'in', true);
    return stopCallForegroundService;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [callId, direction]);

  /*
   * Refreshes the notification's displayed name once it resolves (M22),
   * WITHOUT tearing the service down the way including `name` in the effect
   * above used to. Calling startCallForegroundService again on an
   * ALREADY-RUNNING service just redelivers a new onStartCommand, which
   * re-posts the SAME notification ID (ServiceCompat.startForeground) — the
   * exact mechanism accept() (below) already relies on to move the running
   * service from ringing to connected, restart without a stop.
   * `startedRef` skips this effect's own first run: the effect above already
   * started the service with whatever `name` this render has.
   */
  const startedRef = useRef(false);
  useEffect(() => {
    if (callId === null) return;
    if (!startedRef.current) {
      startedRef.current = true;
      return;
    }
    startCallForegroundService(name, direction === 'in', true);
  }, [callId, name, direction]);

  const enabled = callId !== null && accepted;
  const {
    connState,
    backend,
    mediaReady,
    muted,
    mediaWarning,
    toggleMute,
    speakerOn,
    setSpeaker,
    localVideo,
    remoteVideo,
    videoEnabled,
    remoteVideoEnabled,
    remoteAudioMuted,
    enableVideo,
    disableVideo,
    switchCamera,
    // A video call starts on the speaker, a voice call on the earpiece.
  } = useCallSession(callId, direction === 'out', enabled, medium === 'video');
  const queryClient = useQueryClient();
  const connectedTrackedRef = useRef(false);
  // Assigned once `accept` exists, below. Read by the notification 'answer'
  // handler, which is registered above `accept`'s declaration.
  const acceptRef = useRef<() => void>(() => undefined);
  const backendRef = useRef(backend);
  const phaseRef = useRef(phase);
  backendRef.current = backend;
  phaseRef.current = phase;

  useEffect(
    () => () => {
      if (phaseRef.current === 'active') {
        track('call_ended', {
          backend: backendRef.current,
          medium,
          reason: 'hangup',
        });
      }
    },
    [medium],
  );

  useEffect(() => {
    if (callId !== null && mediaReady) {
      // Media is open, so the call is connected: always the ongoing style, even
      // if it arrived as an incoming ring.
      startCallForegroundService(name, false, true, videoEnabled);
    }
  }, [callId, mediaReady, name, videoEnabled]);

  /*
   * FLAG_KEEP_SCREEN_ON: hold the display bright during an active video call
   * so the user is not plunged into darkness mid-conversation.
   *
   * On during: media connected AND camera is either on (the member's own feed is
   * publishing) OR video is the channel's medium (we are watching the peer even
   * if our own feed is off). Off when the call ends, camera is disabled, or the
   * call never connected. Voice calls are excluded — those use proximity lock in
   * CallForegroundService to dim when near the ear.
   *
   * https://developer.android.com/develop/background-work/background-tasks/awake/screen-on
   */
  const keepScreenOn = liveMedium === 'video' && mediaReady;
  useEffect(() => {
    setKeepScreenOn(keepScreenOn);
    return () => setKeepScreenOn(false);
  }, [keepScreenOn]);

  /*
   * The lease has to tell the TRUTH about media, because billing reads it.
   *
   * `claim_session_lease` (037:427-441) starts the meter — the first
   * `deduct_tokens`, `minutes_billed = 1` — only when BOTH participants hold a
   * lease of kind `connected` inside the 30 s window, and for a call it
   * requires that `connected` kind specifically rather than mere presence.
   * That gate is the thing standing between a member and being charged for a
   * call that never audibly happened.
   *
   * This passed `'connected'` unconditionally, from the moment a session id
   * existed. On the callee that id arrives from `answer_call` BEFORE any media
   * is up, so this device asserted "my media is connected" while it was still
   * negotiating — a claim the billing gate believes. Paired with a caller whose
   * media genuinely was up, that bills minute one for a call the callee could
   * not hear.
   *
   * `connState === 'connected'` is `mediaReady` (agora.ts:302) and is set from
   * `onUserJoined`, not from joining Agora's edge — the adapter is explicit
   * that "Joining Agora's edge is not the same as the other endpoint
   * answering" (agora.ts:143-145). So this now says `connected` when, and only
   * when, there is a remote endpoint in the channel.
   *
   * `'foreground'` before then, not "no lease at all": presence is real and the
   * server wants it (it is what advances a chat session and what the 30 s
   * expiry sweeps), it just is not media.
   */
  useSessionLease(
    sessionId
      ? { id: sessionId, channel: liveMedium === 'voice' ? 'audio' : 'video' }
      : null,
    connState === 'connected' ? 'connected' : 'foreground',
  );

  // Keep the latest enableVideo in a ref so the connection effect can call it
  // without becoming a dependency that changes on every render.
  const enableVideoRef = useRef(enableVideo);
  enableVideoRef.current = enableVideo;

  /*
   * One end, and the FIRST one wins — because there are now two detectors and
   * they disagree about wording.
   *
   * A peer hang-up trips both: Agora reports the channel closed
   * (`connState === 'closed'`) and the peer's own `end_call` updates the row,
   * which arrives through `useCallEnded`. A decline trips only the second, and
   * it is the one that knows the word "declined" — so if the media detector
   * were allowed to run afterwards it would replace a true "Declined." with a
   * generic "Call ended." The latch keeps whichever fired first, which is
   * whichever actually knows what happened.
   *
   * A ref rather than state: this must be read and set inside the same tick a
   * handler runs in, and re-rendering on it would do nothing but re-run the
   * effects that already fired.
   */
  const endedRef = useRef(false);
  const finish = useCallback(
    (notice: string) => {
      if (endedRef.current) {
        return;
      }
      endedRef.current = true;
      /*
       * A call is the one paid session with no `useSessionRealtime` subscription
       * (that hook is keyed by conversation and lives in the chat's controller), so the
       * per-minute profile invalidation there never reaches this screen. Without
       * this the member walked out of a ten-minute call with the balance they
       * walked in with, until something else happened to refetch it.
       */
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      setNotice(notice);
      onEnd();
    },
    [onEnd, setNotice, queryClient],
  );

  // Media connected → active; failed → tell the user and leave. When the call
  // was started as video, auto-enable the camera once the connection is live.
  useEffect(() => {
    if (connState === 'connected') {
      setPhase('active');
      if (!connectedTrackedRef.current) {
        connectedTrackedRef.current = true;
        track('call_answered', { backend, medium });
      }
      if (callId !== null) {
        void heartbeatCall(callId).then(result => {
          if (result?.session_id) setSessionId(result.session_id);
        });
      }
      // The LIVE medium, not the route prop: a switch accepted before this
      // device's media connected must still turn the camera on here, because
      // enableVideo was a no-op without an engine at the moment of acceptance.
      if (liveMediumRef.current === 'video') {
        void enableVideoRef.current();
      }
    } else if (connState === 'failed') {
      // Telemetry (#3): a media failure the user would otherwise have to report.
      // The events allowlist carries 'call_media_failed' (migration 108); the
      // payload names only the backend and medium, never identity.
      track('call_media_failed', { backend, medium });
      finish('The call could not connect.');
    } else if (connState === 'closed') {
      /*
       * THE OTHER SIDE LEFT. Nothing handled this, and it is the common end of
       * a call rather than an edge case.
       *
       * `'closed'` has exactly one source: Agora's `onUserOffline`
       * (agora.ts:127-130), which fires the instant the remote party leaves the
       * channel — so it means "the peer hung up", never "we are still dialling"
       * (that is `'connecting'`, the initial state) and never a local failure
       * (that is `'failed'`). Acting on it cannot fire early.
       *
       * Without this branch the remaining side kept a fully live `active`
       * screen — running timer, live mute and camera controls — until the
       * 20 s `HEARTBEAT_MS` tick happened to read `status === 'ended'` back
       * from the server. Up to twenty seconds of a call that one party had
       * already left, which reads as the app having hung.
       *
       * "Call ended." is the same copy the heartbeat path uses for the same
       * fact, so the two routes to this end say one thing.
       */
      finish('Call ended.');
    }
  }, [backend, callId, connState, medium, finish]);

  /*
   * The server said this call is over — decline, cancel, or a server-side end.
   *
   * The ring timeout below can only ever say "No answer.", because until this
   * hook there was nothing watching the row while it rang (see `useCallEnded`
   * in api/calls.ts for the full defect). `declined` is a different fact from
   * `missed` and the server has always recorded which one happened; this is
   * where that word finally reaches the person who needs it.
   *
   * Registered for every phase, not just ringing: it also beats the 20 s
   * heartbeat to a server-side end mid-call (an exhausted balance), which is
   * the same class of stale-screen problem as the peer hang-up above.
   *
   * No notice for our OWN hang-up: the unmount cleanup calls `endCall`, which
   * updates the row, which echoes back here — but by then this screen is gone,
   * so there is nothing to tell and nobody to tell it to.
   */
  const endedNotice = useCallback(
    (ended: { status: string; endReason: string | null }) => {
      if (ended.status === 'declined') {
        finish(direction === 'out' ? 'Declined.' : 'Call declined.');
      } else if (ended.status === 'missed') {
        finish(direction === 'out' ? 'No answer.' : 'You missed the call.');
      } else if (ended.status === 'failed') {
        finish('The call could not connect.');
      } else if (ended.endReason === 'balance_exhausted') {
        finish('Your balance ran out.');
      } else {
        finish('Call ended.');
      }
    },
    [direction, finish],
  );
  /*
   * The callee answered (2026-09-17 audit): move off 'ringing' the moment
   * the server says so, not the moment media happens to join. This is what
   * stops the ring timeout below from outrunning a real answer — see
   * useCallEnded's own docblock in api/calls.ts for the full defect.
   * Guarded on 'ringing' specifically so a callee's OWN screen (whose phase
   * is 'incoming', never 'ringing') and a call already past this point
   * cannot be pushed backwards or replayed.
   */
  const onCalleeAnswered = useCallback(() => {
    if (phaseRef.current === 'ringing') {
      setPhase('connecting');
    }
  }, []);
  useCallEnded(callId, endedNotice, onCalleeAnswered);

  /*
   * In-place media upgrade (migration 123): subscribe to upgrade requests
   * from the peer and route them to the consent dialog. When the peer accepts
   * our own request, enable the camera on the Agora channel.
   */
  const { data: selfId } = useSelfId();
  /**
   * The price shown in both switch dialogs, from the SERVER (134): the rates
   * pinned to this session's economics version, which is what the bill uses.
   * The cached app config is only the fallback while the quote loads.
   */
  const { data: economics } = useEconomicsConfig();
  const [quote, setQuote] = useState<VideoSwitchQuote | null>(null);
  const loadQuote = useCallback(() => {
    if (callId !== null) void getVideoSwitchQuote(callId).then(setQuote);
  }, [callId]);
  const videoRate =
    quote?.video_rate ?? economics?.video_rate_tokens_per_min ?? FALLBACK_ECONOMICS.video_rate_tokens_per_min;
  const videoExtra =
    quote?.extra_now ??
    Math.max(
      0,
      videoRate - (economics?.audio_rate_tokens_per_min ?? FALLBACK_ECONOMICS.audio_rate_tokens_per_min),
    );

  // Whether THIS device made the pending request. Known locally (we sent it)
  // rather than read off the row: by the time a missed or late UPDATE
  // arrives, the server has already cleared `upgrade_requested_by`.
  const askedRef = useRef(false);
  const askTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearAsk = () => {
    askedRef.current = false;
    if (askTimer.current !== null) clearTimeout(askTimer.current);
    askTimer.current = null;
  };
  useEffect(() => clearAsk, []);

  useVideoSwitch(
    callId,
    selfId,
    /* onRequest: the peer asked; the consent dialog is ours to answer */
    requestedBy => {
      loadQuote();
      setVideoRequestFrom(requestedBy);
    },
    /* onResolved: both sides hear the server's recorded outcome */
    (result: VideoSwitchResult) => {
      const iAsked = askedRef.current;
      clearAsk();
      setVideoRequestFrom(null);
      setUpgrading(false);
      if (result === 'accepted') {
        setLiveMedium('video');
        // A video call is held away from the ear: speaker, as a call started
        // as video already defaults to.
        setSpeaker(true);
        void enableVideoRef.current();
        return;
      }
      if (!iAsked) return;
      setNotice(
        result === 'declined'
          ? `${name} would rather stay on voice.`
          : result === 'insufficient_balance'
            ? 'Not enough balance to switch to video.'
            : `${name} didn't answer. You're still on voice.`,
      );
    },
  );

  const askForVideo = () => {
    if (callId === null) return;
    setUpgrading(true);
    askedRef.current = true;
    // The server only records 'expired' if the peer answers late, so an
    // ignored request must end here or the button stays on "Requesting".
    askTimer.current = setTimeout(() => {
      if (!askedRef.current) return;
      clearAsk();
      setUpgrading(false);
      setNotice(`${name} didn't answer. You're still on voice.`);
    }, VIDEO_SWITCH_REQUEST_TTL_MS);
    void requestVideoSwitch(callId).then(r => {
      if (!r?.success) {
        clearAsk();
        setUpgrading(false);
        setNotice(
          r?.error === 'UPGRADE_PENDING'
            ? 'Already asked. Waiting for an answer.'
            : r?.error === 'VIDEO_DISABLED'
              ? 'Video calls are paused right now.'
              : 'Could not ask to switch to video.',
        );
      }
    });
  };

  /*
   * Give up on an unanswered ring.
   *
   * Keyed on the phase rather than on a timestamp, so the window restarts if
   * the phase legitimately re-enters (a video upgrade remounts this screen with
   * a fresh callId, and that new ring deserves its own full window).
   *
   * `onEnd()` rather than a bespoke "missed" path: unmounting runs the existing
   * cleanup, which calls `endCall(callIdRef.current)` and stops the foreground
   * service. The server then records the end reason it already records for a
   * hang-up during ringing — there is no second code path to keep in step.
   */
  useEffect(() => {
    if (phase !== 'ringing' && phase !== 'incoming') {
      return;
    }
    const limit = phase === 'ringing' ? RING_TIMEOUT_OUT_MS : RING_TIMEOUT_IN_MS;
    const id = setTimeout(() => {
      finish(phase === 'ringing' ? 'No answer.' : 'You missed the call.');
    }, limit);
    return () => clearTimeout(id);
  }, [phase, finish]);

  /*
   * Give up on a media join that never completes (2026-09-17 audit).
   *
   * A gap this migration opens rather than closes on its own: the caller's
   * phase now leaves 'ringing' the moment the SERVER says the callee
   * answered (`onCalleeAnswered`, above), not the moment Agora actually
   * connects — which used to mean the 30 s ring timer was, by accident,
   * also the only bound on a hung media join. `MEDIA_CONNECT_TIMEOUT_MS`
   * replaces that accidental coverage on purpose, at the same 30 s
   * the reference app uses for the equivalent (`callConnectTimeout`).
   *
   * Applies to `'connecting'` from either side that reaches it — the
   * caller via `onCalleeAnswered`, the callee via their own `accept()` — so
   * both are protected by the same bound rather than trusting whichever
   * path happened to still be timed.
   */
  useEffect(() => {
    if (phase !== 'connecting') {
      return;
    }
    const id = setTimeout(() => {
      finish('Could not connect.');
    }, MEDIA_CONNECT_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [phase, finish]);

  /*
   * Give up on a reconnect that never recovers (2026-09-17 audit).
   *
   * `connState === 'reconnecting'` (agora.ts: either side's link dropped, or
   * the peer's media timed out) deliberately does NOT change `phase` — the
   * call stays 'active' and its timer keeps running, because the server
   * keeps billing through a reconnect and freezing the clock would only
   * make the screen understate what is being charged (see CallConnState's
   * own docblock). But a link that never recovers still has to end
   * eventually, bounded the same way a fresh connect is
   * (RECONNECT_TIMEOUT_MS) rather than left to whatever later mechanism —
   * the 20 s heartbeat, the 30 s session lease grace — happens to notice
   * first.
   */
  useEffect(() => {
    if (connState !== 'reconnecting') {
      return;
    }
    const id = setTimeout(() => {
      finish('Connection lost.');
    }, RECONNECT_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [connState, finish]);

  /*
   * Something OUTSIDE the app ended this call.
   *
   * Two sources, one event, because from here they need the same response:
   *
   *   'hangUp'         the Hang up action on the call notification
   *                    (CallActionReceiver.kt:26). **Nothing listened to this
   *                    before.** The receiver stopped the foreground service
   *                    and JS never learned, so the call kept running and
   *                    billing until the server's 90 s lease sweep noticed. A
   *                    notification button that appears to hang up and does not
   *                    is worse than no button.
   *   'audioFocusLost' the user answered a cellular call
   *                    (CallAudioFocusManager.kt). the reference app's OFFHOOK hang-up,
   *                    reached through audio focus so it costs no permission —
   *                    the reasoning is on the native side.
   *   'decline'        the Decline action while ringing (CallActionReceiver.kt:22).
   *   'answer'         the Answer action while ringing (CallActionReceiver.kt:19).
   *
   * The last two were emitted by the receiver and handled by NOBODY — the same
   * defect as 'hangUp' above, one screen further back: the notification's two
   * most prominent buttons did nothing when the app was already running, and the
   * caller went on ringing until the 30s sweep. Found on a device 2026-09-08.
   *
   * `answer` goes through a ref rather than the dep array because `accept` is
   * declared further down this component; naming it here would read a `const`
   * in its own temporal dead zone during render.
   *
   * Registered for every phase, not just `active`: a ring interrupted by a
   * cellular call should also stop.
   */
  useEffect(() => {
    const sub = DeviceEventEmitter.addListener('callAction', (action: string) => {
      if (action === 'hangUp' || action === 'audioFocusLost' || action === 'decline') {
        onEnd();
      } else if (action === 'answer' && phaseRef.current === 'incoming') {
        /*
         * 'incoming', not 'ringing' (2026-09-17 audit). The callee's own
         * phase starts at 'incoming' and never becomes 'ringing' -- that
         * value is reserved for the CALLER's outgoing-ring state (see the
         * initial-phase logic above: `direction === 'in' ? 'incoming' : ...
         * 'ringing'`). The green Answer action on the CallStyle notification
         * fires this same event on the CALLEE's device, so the guard as
         * written could never once be true: the button looked live and did
         * nothing, on every incoming call, whenever the app was already
         * running.
         *
         * Only while incoming, still: answering an already-connected call
         * (phase 'connecting' or 'active') would fire a second answer_call
         * and claim a lease this screen already holds.
         */
        acceptRef.current();
      }
    });
    return () => sub.remove();
  }, [onEnd]);

  // The in-call timer, once live.
  useEffect(() => {
    if (phase !== 'active') {
      return;
    }
    const id = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(id);
  }, [phase]);

  // Heartbeat + settle while active. If the server ends it (out of tokens), leave.
  useEffect(() => {
    if (phase !== 'active' || callId === null) {
      return;
    }
    const id = setInterval(() => {
      void heartbeatCall(callId).then(r => {
        if (r?.session_id) setSessionId(r.session_id);
        if (r?.success && r.status === 'ended') {
          finish('Call ended.');
        }
      });
    }, HEARTBEAT_MS);
    return () => clearInterval(id);
  }, [phase, callId, finish]);

  const accept = useCallback(() => {
    if (callId === null) {
      return;
    }
    setAccepted(true);
    setPhase('connecting');
    /*
     * Stop the ring THE INSTANT the call is answered, not once the peer's
     * media joins (2026-09-17 audit). `CallForegroundService.kt` starts
     * looping the device ringtone under `isIncoming=true` and only stops it
     * (`stopRinging()`, gated on `if (isIncoming) startRinging() else
     * stopRinging()`) when the service is restarted with `isIncoming=false` —
     * and until this call, the only place that restart happened was the
     * `mediaReady` effect below, which fires only after Agora actually joins
     * the channel. Tapping Answer and having the phone keep ringing for a
     * beat is the first thing that happens on every incoming call, and it
     * reads as "the button did not work."
     *
     * `includeCamera` is left at its default (false) here, exactly like the
     * FIRST `startCallForegroundService` call on mount below (line ~432):
     * this restart's job is only to silence the ring and switch the
     * notification to its ongoing style. The `mediaReady` effect is still
     * the one place that adds the camera foreground-service type, once
     * `videoEnabled` actually reflects whether the session is video — a
     * value this callback's own closure cannot see correctly yet, since
     * `setAccepted(true)` two lines up has not re-rendered.
     */
    startCallForegroundService(name, false, true);
    void answerCall(callId).then(result => {
      if (!result?.success) {
        /*
         * "No longer available" is a claim about the CALL — that the other
         * side hung up or it was already answered — and it is false when the
         * RPC raised. The call is still ringing; our server failed. Saying the
         * former sends the member back to a directory to try someone else for
         * a fault that will repeat.
         */
        setNotice(
          result?.error === 'SERVER_ERROR'
            ? SERVER_ERROR_NOTICE
            : 'This call is no longer available.',
        );
        onEnd();
        return;
      }
      setSessionId(result.session_id ?? null);
    });
  }, [callId, onEnd, setNotice, name]);
  acceptRef.current = accept;

  /*
   * M23: confirms the ALREADY_RINGING dialog. Takes the existing call's id
   * as a parameter rather than reading `callId` state, because `accept`
   * above closes over `callId` and this fires before `setCallId` below has
   * committed — a stale closure would still answer the call this screen was
   * trying (and failing) to place, not the one actually ringing.
   */
  const answerInstead = useCallback(
    (existingCallId: string) => {
      setAlreadyRingingCallId(null);
      setCallId(existingCallId);
      setAccepted(true);
      setPhase('connecting');
      startCallForegroundService(name, false, true);
      void answerCall(existingCallId).then(result => {
        if (!result?.success) {
          setNotice(
            result?.error === 'SERVER_ERROR'
              ? SERVER_ERROR_NOTICE
              : 'This call is no longer available.',
          );
          onEnd();
          return;
        }
        setSessionId(result.session_id ?? null);
      });
    },
    [onEnd, setNotice, name],
  );

  /*
   * L1 (2026-09-17 audit): the mic/camera stopping mid-call used to be
   * silent — nothing told the member their own audio or video had actually
   * stopped reaching the other side. `mediaWarning` (agora.ts) is null for
   * the member's own mute/camera-off, so this only fires for a real device
   * problem (busy, no permission, capture failed, an interrupting call).
   * One-shot on the transition INTO a warning, matching every other notice
   * on this screen — no separate "you're back" toast on recovery.
   */
  useEffect(() => {
    if (mediaWarning === 'mic') {
      setNotice("Your mic stopped. Check if another app is using it.");
    } else if (mediaWarning === 'camera') {
      setNotice("Your camera stopped. Check if another app is using it.");
    }
  }, [mediaWarning, setNotice]);

  const timer = `${Math.floor(elapsed / 60)}:${(elapsed % 60).toString().padStart(2, '0')}`;
  // #4: the coral gradient read as "very ugly" on a real call. A call wants a
  // calm, dim surface — a near-black vertical fall, with the peer's own photo
  // blurred behind it (below) when there is one. Raw dark hex, deliberately
  // outside the accent palette (asserted EXEMPT in theme.test).
  const calmGradient = 'linear-gradient(180deg, #1C1C24 0%, #0B0B10 100%)';
  // Status words carry NO trailing "…": the animated CallingDots supply the
  // ellipsis for every waiting phase (user 2026-08-31, copied from the reference
  // where the dots fill in sequence). The timer phase has no dots.
  const incomingLabel = isMemberSide
    ? medium === 'video'
      ? 'wants a video chat'
      : 'wants a voice chat'
    : medium === 'video'
      ? 'wants a video chat'
      : 'calling you';
  const status =
    // A reconnect keeps `phase` at 'active' on purpose (the timer beneath
    // this line is still counting, and still being billed) — but the status
    // WORD says so, rather than a running clock silently standing in for a
    // healthy call during a network blip (2026-09-17 audit).
    phase === 'active' && connState === 'reconnecting'
      ? 'Reconnecting'
      : phase === 'active'
        ? timer
        : phase === 'incoming'
          ? incomingLabel
          : phase === 'ringing'
            ? 'Ringing'
            : phase === 'connecting'
              ? 'Connecting'
              : 'Calling';

  const showRemoteVideo = remoteVideoEnabled && remoteVideo !== null;
  // `connState === 'reconnecting'` added alongside the phases: 'Reconnecting'
  // is a waiting word like 'Ringing'/'Connecting'/'Calling' and gets the same
  // animated ellipsis, even though `phase` itself stays 'active' throughout.
  const pulsing =
    phase === 'ringing' ||
    phase === 'connecting' ||
    phase === 'incoming' ||
    phase === 'starting' ||
    (phase === 'active' && connState === 'reconnecting');

  return (
    <View style={styles.root}>
      <View style={[styles.fill, { experimental_backgroundImage: calmGradient }]} />

      {/*
        * Background (#4/#5): the live remote video (crisp) when there is one, else
        * the peer's own photo blurred to a soft wash behind the dim — never the
        * raw face bleeding edge to edge, which read as harsh. The crisp face
        * lives in the centred ring below. `peerAvatarUrl` resolves the peer for
        * BOTH sides (member and provider), so each finally sees the other.
        */}
      {showRemoteVideo ? (
        <Animated.View
          testID="call-remote-video"
          entering={videoFadeIn}
          style={StyleSheet.absoluteFill}>
          <CallVideoView
            key={`agora-${remoteVideo.uid}-${remoteVideo.local ? 'local' : 'remote'}`}
            source={remoteVideo}
            objectFit="cover"
            zOrder={0}
            style={StyleSheet.absoluteFill}
          />
        </Animated.View>
      ) : backdropSource !== null && !backdropFailed ? (
        <>
          <Image
            source={backdropSource}
            resizeMode="cover"
            blurRadius={CALL_BG_BLUR}
            style={StyleSheet.absoluteFill}
            onError={() => setBackdropFailed(true)}
            accessibilityIgnoresInvertColors
          />
          <View style={styles.bgDim} />
        </>
      ) : null}

      <View style={[styles.topMeta, { paddingTop: insets.top + TOKENS.space.md }]}>
        <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.headlineSmallEmphasized} allowFontScaling numberOfLines={1} style={styles.name}>
          {name}
        </Text>
        {phase === 'active' ? (
          <Text maxFontSizeMultiplier={TOKENS.fontScaleCap.titleLargeEmphasized} allowFontScaling testID="call-status" style={styles.timer}>
            {status}
          </Text>
        ) : (
          <View style={styles.statusRow}>
            <Text allowFontScaling testID="call-status" style={styles.status}>
              {status}
            </Text>
            <CallingDots />
          </View>
        )}
        {phase === 'incoming' && isMemberSide ? (
          <Text allowFontScaling style={styles.status}>
            Keep it kind. No sexual or abusive talk
          </Text>
        ) : null}
        {/*
         * The peer muted their mic (M25, 2026-09-17 audit). Video muting is
         * self-evident (no picture); audio muting is not — silence and "they
         * muted" read identically without this. `phase === 'active'` only:
         * the field is meaningless before the call is actually connected.
         */}
        {phase === 'active' && remoteAudioMuted ? (
          <View style={styles.remoteMutedRow}>
            <Icon name="micOff" size={TOKENS.icon.xs} color="rgba(255,255,255,0.85)" />
            <Text allowFontScaling testID="call-remote-muted" style={styles.status}>
              {name} muted their mic
            </Text>
          </View>
        ) : null}
      </View>

      {/*
        * The centred, ringed avatar is now the ONE place the peer's face appears
        * on a non-video call: a crisp circular crop of their photo (the blurred
        * copy behind is only ambient wash), or the initial mark when there is no
        * photo. CallRing clips the child to the circle. Shown for every
        * non-video state — the halo pulses while ringing and settles once active.
        */}
      {!showRemoteVideo ? (
        <View style={styles.center} pointerEvents="none">
          <CallRing size={AVATAR} active={pulsing}>
            <View style={styles.avatarNeutral}>
              <Text allowFontScaling={false} style={styles.avatarInitial}>
                {initial}
              </Text>
            </View>
            {faceSource !== null && !faceFailed ? (
              <Image
                source={faceSource}
                resizeMode="cover"
                style={[
                  styles.avatarPhoto,
                  peerIsClay ? clayFraming(AVATAR) : null,
                ]}
                onError={() => setFaceFailed(true)}
                accessibilityIgnoresInvertColors
              />
            ) : null}
          </CallRing>
        </View>
      ) : null}

      {videoEnabled && localVideo !== null ? (
        <LocalVideoPip source={localVideo} />
      ) : null}

      {/*
        * Control row — size, spacing, and labels match the WhatsApp outgoing
        * call capture (2026-08-30): four equal circles, End Call solid red,
        * secondary pills translucent white glass, Start Video filled white when
        * off / outlined when on. Incoming keeps Decline | Accept at the edges.
        */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + TOKENS.space.lg }]}>
        {phase === 'incoming' ? (
          <View style={styles.incomingRow}>
            <CallAction testID="call-decline" glyph="callEnd" label="Decline" tone="danger" onPress={onEnd} />
            <CallAction
              testID="call-accept"
              glyph="call"
              label={isMemberSide ? 'Start session' : 'Accept'}
              tone="accept"
              onPress={accept}
            />
          </View>
        ) : (
          <View style={styles.bar}>
            <BarButton
              testID="call-speaker"
              glyph={speakerOn ? 'speaker' : 'speakerOff'}
              active={speakerOn}
              onPress={() => setSpeaker(!speakerOn)}
              label="Speaker"
            />
            <BarButton
              testID="call-video-toggle"
              glyph={liveMedium === 'voice' ? 'video' : videoEnabled ? 'video' : 'videoOff'}
              active={liveMedium === 'video' && !videoEnabled}
              fill={liveMedium === 'video' && videoEnabled ? 'ghost' : 'solid'}
              disabled={liveMedium === 'voice' ? (phase !== 'active' || upgrading || callId === null) : false}
              onPress={() => {
                if (liveMedium === 'voice') {
                  if (phase !== 'active' || callId === null) return;
                  // The member pays, so they see the price before asking.
                  if (isMemberSide) {
                    loadQuote();
                    setVideoPriceVisible(true);
                    return;
                  }
                  askForVideo();
                } else if (videoEnabled) {
                  disableVideo();
                } else {
                  void enableVideo();
                }
              }}
              onLongPress={liveMedium === 'video' && videoEnabled ? switchCamera : undefined}
              label={liveMedium === 'voice' ? (upgrading ? 'Requesting' : 'Switch to Video') : videoEnabled ? 'Camera off' : 'Start Video'}
            />
            <BarButton
              testID="call-mute"
              glyph={muted ? 'micOff' : 'mic'}
              active={muted}
              onPress={toggleMute}
              label="Mute"
            />
            <BarButton testID="call-end" glyph="callEnd" tone="danger" onPress={onEnd} label="End Call" />
          </View>
        )}
      </View>
      <ConfirmDialog
        visible={
          isMemberSide && direction === 'out' && incomingCallId === null && !memberConsented && callId === null
        }
        testID="call-session-consent"
        title={medium === 'video' ? `Video chat with ${name}?` : `Call ${name}?`}
        body="Keep it kind. No sexual or abusive talk. Charging starts when they pick up."
        cancelLabel="Not now"
        confirmLabel={medium === 'video' ? 'Video them' : 'Call them'}
        onCancel={onEnd}
        onConfirm={() => setMemberConsented(true)}
      />
      {/* Copy follows the phase: a live call ends, a ringing one is cancelled,
          an incoming one is declined. One dialog, one exit path (`onEnd`). */}
      <ConfirmDialog
        visible={leaveDialogVisible}
        testID="call-leave-dialog"
        title={
          phase === 'active' ? 'End the call?' : phase === 'incoming' ? 'Not now?' : 'Hang up?'
        }
        body={
          phase === 'active'
            ? 'This hangs up for both of you.'
            : phase === 'incoming'
              ? `${name} is waiting on you.`
              : `Leave before ${name} picks up?`
        }
        cancelLabel="Stay"
        confirmLabel={phase === 'active' ? 'Hang up' : phase === 'incoming' ? 'Decline' : 'Hang up'}
        destructive
        onCancel={() => setLeaveDialogVisible(false)}
        onConfirm={() => {
          setLeaveDialogVisible(false);
          onEnd();
        }}
      />
      <ConfirmDialog
        visible={alreadyRingingCallId !== null}
        testID="call-already-ringing"
        title={`${name} is calling you too`}
        body="You were about to call each other at the same time. Answer their call instead?"
        cancelLabel="Not now"
        confirmLabel="Answer"
        onCancel={onEnd}
        onConfirm={() => {
          if (alreadyRingingCallId !== null) {
            answerInstead(alreadyRingingCallId);
          }
        }}
      />
      {/* Switch-to-video consent (132). Only the party who did NOT ask sees it;
          the member (who pays) is told the price. */}
      <ConfirmDialog
        visible={videoRequestFrom !== null}
        testID="call-upgrade-request"
        title="Switch to video?"
        body={
          isMemberSide
            ? `${name} wants to switch to video. Video is ₹${videoRate}/min. This minute is topped up by ₹${videoExtra}, and nothing already paid is charged again. Your camera will turn on.`
            : `${name} wants to switch to video. Your camera will turn on.`
        }
        cancelLabel="Stay on voice"
        confirmLabel="Switch"
        onCancel={() => {
          if (callId) void respondVideoSwitch(callId, false);
          setVideoRequestFrom(null);
        }}
        onConfirm={() => {
          if (callId) {
            void respondVideoSwitch(callId, true).then(r => {
              if (!r.success) {
                setNotice(
                  r.error === 'INSUFFICIENT_BALANCE'
                    ? 'Not enough balance to switch to video.'
                    : r.error === 'EXPIRED'
                      ? 'That request timed out. You\'re still on voice.'
                      : 'Could not switch to video.',
                );
              }
            });
          }
          setVideoRequestFrom(null);
        }}
      />
      <ConfirmDialog
        visible={videoPriceVisible}
        testID="call-video-price"
        title="Switch to video?"
        body={`Video is ₹${videoRate}/min. If ${name} agrees, this minute is topped up by ₹${videoExtra}, and nothing already paid is charged again.`}
        cancelLabel="Not now"
        confirmLabel="Ask"
        onCancel={() => setVideoPriceVisible(false)}
        onConfirm={() => {
          setVideoPriceVisible(false);
          askForVideo();
        }}
      />
    </View>
  );
}

/** Incoming Decline / Accept (or Start session for the member). */
function CallAction({
  glyph,
  label,
  tone,
  onPress,
  testID,
}: {
  glyph: IconName;
  label: string;
  tone: 'danger' | 'accept';
  onPress: () => void;
  testID: string;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.actionSlot}>
      <Pressable
        onPress={onPress}
        testID={testID}
        accessibilityLabel={label}
        press="none"
        highlight="dim"
        size={72}
        style={[styles.action, tone === 'danger' ? styles.danger : styles.accept]}>
        <Icon name={glyph} size={TOKENS.icon.xl} color={LIGHT.color.text.onAccent} />
      </Pressable>
      <Text allowFontScaling style={styles.actionLabel}>
        {label}
      </Text>
    </View>
  );
}

/**
 * WhatsApp outgoing control: equal ~56dp circles with captions under.
 * Secondary = translucent white glass; video "off" = solid white; End = red.
 */
function BarButton({
  glyph,
  active = false,
  tone,
  fill = 'ghost',
  onPress,
  onLongPress,
  label,
  testID,
  disabled = false,
}: {
  glyph: IconName;
  active?: boolean;
  tone?: 'danger';
  fill?: 'ghost' | 'solid';
  onPress: () => void;
  onLongPress?: () => void;
  label: string;
  testID: string;
  disabled?: boolean;
}) {
  const styles = useStyles(makeStyles);
  // An active ghost toggle takes the SOLID treatment, not a 20% alpha nudge on
  // the same white-on-translucent: inverting the ink is the only change at this
  // size a user reliably reads as "on".
  const solid = fill === 'solid' || (active && tone !== 'danger');
  const fg =
    tone === 'danger'
      ? LIGHT.color.text.onAccent
      : solid
        ? LIGHT.color.text.primary
        : LIGHT.color.text.onAccent;
  return (
    <View style={styles.barSlot}>
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        testID={testID}
        accessibilityLabel={label}
        // The Pressable owns the disabled state: it dims to 0.45, blocks the
        // press, AND sets accessibilityState.disabled so a screen reader stops
        // announcing an inert control as actionable. Previously `disabled` only
        // dimmed the outer View and no-op'd onPress, leaving the a11y state
        // false. (2026-09-09 audit)
        disabled={disabled}
        // Toggle state (Mute/Speaker/Camera) reaches accessibilityState.selected,
        // so TalkBack announces on/off instead of only the static label. Undefined
        // for non-toggles like End Call, which the primitive then omits. (audit)
        selected={active}
        press="none"
        highlight="dim"
        size={BTN}
        style={[
          styles.barButton,
          tone === 'danger' && styles.danger,
          tone !== 'danger' && solid && styles.barButtonSolid,
          tone !== 'danger' && !solid && styles.barButtonGhost,
        ]}>
        <Icon name={glyph} size={TOKENS.icon.lg} color={fg} />
      </Pressable>
      <Text allowFontScaling style={[styles.barLabel, disabled && styles.barSlotDisabled]}>
        {label}
      </Text>
    </View>
  );
}

/** Face diameter — WhatsApp capture ~140–160 logical on a tall phone. */
const AVATAR = 148;
/** How soft the peer photo blurs into the background wash (#4). */
const CALL_BG_BLUR = 40;
const BTN = 56;
/**
 * Clearance for the labelled control row above the home indicator.
 * Does NOT include the safe-area inset — LocalVideoPip adds `insets.bottom`
 * so the self-view clears the real button row on every device (the previous
 * fixed `bottom: 120` sat under the buttons once the inset grew).
 */
const CONTROLS_CLEARANCE = 120;
const PIP_WIDTH = 120;
const PIP_HEIGHT = 160;
/** Edge gap between the floating self-view and the screen / control row. */
const PIP_EDGE = TOKENS.space.md;

/**
 * Own-camera picture-in-picture.
 *
 * Default dock: bottom-right, clear of the call-control row (inset-aware).
 * Free movement after that — pan anywhere inside the safe band; release leaves
 * it where the finger stopped (no corner snap). Position via left/top shared
 * values (not animated width/height) so Yoga stays out of the drag path.
 *
 * Frequency: occasional during a video call, finger-driven — the motion is the
 * finger itself; no enter/exit animation on the PIP.
 */
function LocalVideoPip({ source }: { source: CallVideoSource }) {
  const styles = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width: windowW, height: windowH } = useWindowDimensions();

  const dockLeft = windowW - PIP_EDGE - PIP_WIDTH;
  const dockTop =
    windowH - insets.bottom - CONTROLS_CLEARANCE - PIP_EDGE - PIP_HEIGHT;
  const minLeft = PIP_EDGE;
  const maxLeft = Math.max(minLeft, windowW - PIP_EDGE - PIP_WIDTH);
  const minTop = insets.top + PIP_EDGE;
  const maxTop = Math.max(
    minTop,
    windowH - insets.bottom - CONTROLS_CLEARANCE - PIP_EDGE - PIP_HEIGHT,
  );
  // Translate limits relative to the default dock origin.
  const minTX = minLeft - dockLeft;
  const maxTX = maxLeft - dockLeft;
  const minTY = minTop - dockTop;
  const maxTY = maxTop - dockTop;

  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startTX = useSharedValue(0);
  const startTY = useSharedValue(0);

  // Keep the viewfinder on-screen when the window or insets change. Remount
  // (video off→on) re-initialises shared values at the default dock (0,0).
  useEffect(() => {
    tx.value = clamp(tx.value, minTX, maxTX);
    ty.value = clamp(ty.value, minTY, maxTY);
  }, [tx, ty, minTX, maxTX, minTY, maxTY]);

  /*
   * RNGH 3: usePanGesture — same pattern as MediaViewer. Stay where released
   * (free movement); only clamp so the viewfinder cannot cover the control
   * row or leave the screen. Drag via translateX/Y — never left/top — so Yoga
   * stays out of the frame path (animate-expo).
   * https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/use-pan-gesture
   */
  const pan = usePanGesture({
    onActivate: () => {
      startTX.value = tx.value;
      startTY.value = ty.value;
    },
    onUpdate: e => {
      tx.value = clamp(startTX.value + e.translationX, minTX, maxTX);
      ty.value = clamp(startTY.value + e.translationY, minTY, maxTY);
    },
  });

  const pipStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }],
  }));

  return (
    <GestureDetector gesture={pan}>
      <Animated.View
        testID="call-local-pip"
        entering={videoFadeIn}
        accessibilityLabel="Your video"
        accessibilityHint="Drag to move"
        style={[
          styles.localPip,
          { left: dockLeft, top: dockTop },
          pipStyle,
        ]}
      >
        <CallVideoView
          source={source}
          objectFit="cover"
          mirror
          zOrder={1}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </GestureDetector>
  );
}

/**
 * The switch to video (rare) fades the picture in rather than cutting from the
 * blurred photo to a live face; purpose: preventing a jarring change. Standard
 * duration (DURATION.base), decelerate (EASE_OUT), opacity only.
 *
 * Honours Android's "Remove animations" accessibility setting through
 * `ReduceMotion.System`, which Reanimated maps to the platform animator scale
 * (https://docs.swmansion.com/react-native-reanimated/docs/guides/accessibility,
 * https://developer.android.com/guide/topics/ui/accessibility/principles —
 * "Remove animations"). Device-locatable: `call-remote-video` / `call-local-pip`.
 * Asserted in __tests__/platform.test.ts.
 */
const videoFadeIn = FadeIn.duration(DURATION.base)
  .easing(EASE_OUT)
  .reduceMotion(ReduceMotion.System);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      // The calm dark base (#4). Raw hex, deliberately off the accent palette;
      // the gradient fill and blurred photo sit on top of it.
      flex: 1,
      backgroundColor: '#0B0B10',
    },
    fill: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    bgDim: {
      // Dims the blurred peer photo so the white name/status and the crisp
      // centred face read cleanly over it. Heavier than the old bleed scrim
      // because the photo underneath is now a soft wash, not the subject.
      ...StyleSheet.absoluteFill,
      backgroundColor: 'rgba(0,0,0,0.45)',
    },
    topMeta: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      zIndex: 2,
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      paddingHorizontal: TOKENS.space['2xl'],
    },
    center: {
      ...StyleSheet.absoluteFill,
      alignItems: 'center',
      justifyContent: 'center',
      paddingBottom: CONTROLS_CLEARANCE,
    },
    avatarFill: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Sits on top of the initial rather than replacing it, so a photo that
    // fails to load degrades to the letter instead of an empty ring.
    avatarPhoto: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    // A lift off the fixed #0B0B10 call surface rather than a theme token: this
    // screen is dark in both modes, and the previous fill was state/available,
    // the presence green, which read as a status badge on a face.
    avatarNeutral: {
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(255,255,255,0.14)',
    },
    avatarInitial: {
      fontFamily: TOKENS.face.semibold,
      fontSize: 56,
      lineHeight: 64,
      color: LIGHT.color.text.onAccent,
    },
    name: {
      ...TOKENS.typography.headlineSmallEmphasized,
      color: LIGHT.color.text.onAccent,
      textAlign: 'center',
    },
    timer: {
      ...TOKENS.typography.titleLargeEmphasized,
      /*
       * TABULAR FIGURES, and this is the single place in the app that needs
       * them most: a mm:ss timer that reticks every second.
       *
       * With proportional figures the digits have different widths, so the
       * whole string shifts sideways as it counts — 1:11 is visibly narrower
       * than 0:08 — and it does that once a second, on screen, for the length
       * of a paid call. Tabular figures give every digit the same advance so
       * only the glyphs change.
       *
       * Added rather than swapping to a `numeral*` token because those are
       * 24/32 and this is 22/28; taking one would resize the timer to fix its
       * jitter. Geist ships `tnum` (verified in its GSUB table), so the feature
       * is available on the family already in use — no mono font needed, and a
       * mono face here would look like a terminal rather than a call.
       */
      fontVariant: ['tabular-nums'],
      color: LIGHT.color.text.onAccent,
    },
    statusRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Same row shape as statusRow, plus the gap an icon+label pair needs —
    // not added to statusRow itself, which the ringing/connecting dots row
    // above also uses and did not ask for a gap.
    remoteMutedRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: TOKENS.space.hair,
    },
    status: {
      ...TOKENS.typography.bodyMedium,
      color: 'rgba(255,255,255,0.85)',
      letterSpacing: 0.3,
    },
    controls: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
      paddingHorizontal: TOKENS.space.md,
      zIndex: 2,
    },
    incomingRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: TOKENS.space['2xl'],
    },
    actionSlot: {
      alignItems: 'center',
      gap: TOKENS.space.xs,
    },
    action: {
      width: 72,
      height: 72,
      borderRadius: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    actionLabel: {
      ...TOKENS.typography.bodySmall,
      color: LIGHT.color.text.onAccent,
      textAlign: 'center',
    },
    bar: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      justifyContent: 'space-around',
    },
    barSlot: {
      alignItems: 'center',
      gap: TOKENS.space.xs,
      width: 76,
    },
    barSlotDisabled: {
      // Matches the Pressable's own disabled dim (0.45) so the icon and its
      // label fade to the same level. (2026-09-09 review)
      opacity: 0.45,
    },
    barButton: {
      width: BTN,
      height: BTN,
      borderRadius: BTN / 2,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Translucent white glass over the photo/gradient, NOT lavender: WhatsApp's
    // secondary call controls are a frosted white, and a purple tint here read as
    // a second brand colour the palette does not have (user 2026-08-31).
    barButtonGhost: {
      backgroundColor: 'rgba(255,255,255,0.22)',
    },
    // The "on" state (mute active, speaker on, camera off) lifts the same glass
    // brighter rather than switching hue.
    barButtonActive: {
      backgroundColor: 'rgba(255,255,255,0.42)',
    },
    barButtonSolid: {
      backgroundColor: LIGHT.color.bg.base,
    },
    barLabel: {
      ...TOKENS.typography.bodySmall,
      color: LIGHT.color.text.onAccent,
      textAlign: 'center',
    },
    danger: {
      backgroundColor: '#E53935',
    },
    accept: {
      backgroundColor: t.color.state.available,
    },
    localPip: {
      position: 'absolute',
      // Default dock left/top set inline; free movement is translateX/Y.
      width: PIP_WIDTH,
      height: PIP_HEIGHT,
      borderRadius: TOKENS.radius.lg,
      borderCurve: 'continuous',
      overflow: 'hidden',
      // Below the control row (zIndex 2) so a missed clamp never steals taps
      // from End / Mute; above the remote video fill.
      zIndex: 1,
      elevation: 4,
    },
  });
