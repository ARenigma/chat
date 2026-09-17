/**
 * Calls: the RPC bindings, the media flag, and the incoming-call subscription.
 *
 * Migration 011 owns the authoritative half — `start_call`, `answer_call`,
 * `heartbeat_call`, `end_call`, the per-minute meter (`settle_call` /
 * `meter_active_calls`), the one-live-call indexes, and the blocking/suspension
 * gates. The client never writes the `calls` table (it has no INSERT/UPDATE
 * policy); every transition goes through these definer RPCs so the meter and the
 * row cannot come apart.
 *
 * Media transport is vendor-selected by `calls.media_backend` (default agora).
 * The client adapter is `src/api/callMedia`; CallScreen never imports an SDK.
 */
import { useEffect, useRef } from 'react';
import type { PostgrestError } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { reportSwallowed } from '../lib/sentry';
import { ENV } from '../lib/env';
import type {
  CallMediaBackend,
  CallMedium,
  CallResult,
} from '../lib/database.types';

// Defined in src/config.ts — the single home for all feature flags.
export { CALLS_ENABLED } from '../config';

/**
 * ICE servers. Google's public STUN is always included; a TURN relay is
 * added only when `TURN_URL` is set in the environment so that development
 * runs STUN-only without requiring credentials. TURN credentials are read
 * exclusively from ENV — never hardcoded.
 */
export const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  ...(ENV.turnUrl
    ? [{ urls: ENV.turnUrl, username: ENV.turnUsername, credential: ENV.turnCredential }]
    : []),
];

/**
 * What a RAISED rpc becomes, so a server fault stops looking like a dead phone.
 *
 * THE DEFECT THIS REPLACES. All four call RPCs used to end
 * `return error ? null : (data as CallResult)`. `start_call` and its siblings
 * report their ordinary refusals STRUCTURALLY — `{success:false, error:'BUSY'}`
 * and so on — so a non-null `error` never means "the member did something we
 * refuse". It means the function RAISED, or the transport failed. Collapsing
 * that to `null` threw away the only description of what went wrong, and
 * CallScreen's no-code branch then told the member "Could not start just now.
 * Check your connection." while telemetry recorded `reason: 'network'`.
 *
 * On 2026-09-08 that cost a day. `assign_call_media_backend` wrote a
 * `media_assignment_kind` its check constraint had not been widened to accept
 * (migration 089), every `start_call` raised 23514, and both the screen and the
 * analytics asserted a network fault for a schema fault. The only way in was to
 * patch a `console.warn` into this file and read logcat.
 *
 * So a raise now returns a RESULT rather than nothing: `SERVER_ERROR` plus the
 * SQLSTATE. `sqlstate` is safe to carry — Postgres puts the constraint name in
 * `message`/`code` and the offending ROW in `details`, and `details` is
 * deliberately dropped here rather than logged, because for `messages` it would
 * be the body of somebody's message.
 *
 * NO `track()` here, deliberately. The events table has a trigger that raises
 * `unknown event name` (22023) for any name outside its allowlist
 * (033:80-93), so inventing an `rpc_raised` event without a migration would be
 * the SAME defect this function exists to surface — a writer emitting a value
 * its constraint forbids. The existing, allowlisted `call_rejected` carries it
 * instead, from CallScreen, where `props.reason` is already the field for
 * "why did this call never ring".
 */
function raised(error: PostgrestError): CallResult {
  return { success: false, error: 'SERVER_ERROR', sqlstate: error.code };
}

/** Ring someone. Returns the call id, or the reason it was refused. */
export async function startCall(
  conversationId: string,
  medium: CallMedium,
): Promise<CallResult | null> {
  const { data, error } = await supabase.rpc('start_call', {
    p_conversation_id: conversationId,
    p_medium: medium,
  });
  return error ? raised(error) : (data as CallResult);
}

/** Pick up. Moves the call to active and bills minute one. */
export async function answerCall(callId: string): Promise<CallResult | null> {
  const { data, error } = await supabase.rpc('answer_call', { p_call_id: callId });
  return error ? raised(error) : (data as CallResult);
}

/** Keep-alive + settle while a call is up; the ticker reads `last_seen_at`. */
export async function heartbeatCall(callId: string): Promise<CallResult | null> {
  const { data, error } = await supabase.rpc('heartbeat_call', { p_call_id: callId });
  return error ? raised(error) : (data as CallResult);
}

/** Hang up or decline. `media_failed` is the one reason the server cannot infer. */
export async function endCall(
  callId: string,
  reason: 'hangup' | 'media_failed' = 'hangup',
): Promise<CallResult | null> {
  const { data, error } = await supabase.rpc('end_call', {
    p_call_id: callId,
    p_reason: reason,
  });
  return error ? raised(error) : (data as CallResult);
}

/** How a call finished, as the server recorded it. See `end_call` (037:1111). */
export interface CallEnded {
  status: 'ended' | 'missed' | 'declined' | 'failed';
  endReason: string | null;
}

/**
 * The other side ended it — told to this device the moment it happens.
 *
 * WHY THIS EXISTS. `useIncomingCalls` below subscribes to INSERTs only, which
 * is everything the CALLEE needs (a fresh ring). Nothing watched UPDATEs, so
 * the CALLER learned about a decline in one of two ways: not at all while
 * ringing (the heartbeat poll is gated on `phase === 'active'`), or 20 s late
 * once a call was up. Concretely, a callee who declined instantly left the
 * caller's screen saying "Ringing" for the full 30 s ring timeout and then
 * "No answer." — which is a false statement about what the other person did.
 *
 * The DISTINCTION already exists server-side and was simply never read:
 * `end_call` writes `declined` when the callee ends a ringing call and
 * `missed` when the caller does (037:1155-1160). This hook carries that word
 * back so the copy can be true.
 *
 * Realtime enforces RLS on `postgres_changes` and "Participants read their
 * calls" (011:751) scopes `calls` to its two parties, so the `id` filter is
 * bandwidth rather than security — the same reasoning as the `callee_id`
 * filter below.
 */
export function useCallEnded(
  callId: string | null,
  onEnded: (ended: CallEnded) => void,
  /*
   * Non-terminal, unlike everything else this hook reports (2026-09-17
   * audit). `answer_call` sets `calls.status = 'active'` the INSTANT the
   * callee taps Accept — long before their media joins the channel, which
   * is a separate, later step (`paid_sessions` activates only once both
   * sides hold a connected lease). The caller's own phase used to leave
   * 'ringing' only at that later media-connect moment, so a callee who
   * answered but whose media took its time left the caller's own 30 s ring
   * timer running against someone who had already picked up — "No answer."
   * on a call that was, in fact, answered.
   *
   * Reuses this hook's own channel rather than opening a second
   * subscription to the same row: it is already watching every UPDATE on
   * `calls` filtered to this id, `active` was simply never one of the
   * statuses passed upward.
   */
  onAnswered?: () => void,
): void {
  // A ref so a re-render with a fresh closure does not tear down and re-open
  // the socket mid-ring — the window this hook exists to cover is ~2 s long.
  const handler = useRef(onEnded);
  handler.current = onEnded;
  const answeredHandler = useRef(onAnswered);
  answeredHandler.current = onAnswered;

  useEffect(() => {
    if (callId === null) {
      return;
    }
    const terminal = ['ended', 'missed', 'declined', 'failed'] as const;
    const dispatch = (row: { status: string; end_reason: string | null }) => {
      if (row.status === 'active') {
        answeredHandler.current?.();
        return;
      }
      const hit = terminal.find(s => s === row.status);
      if (hit !== undefined) {
        handler.current({ status: hit, endReason: row.end_reason });
      }
    };
    /*
     * Recover a status change that landed while the socket was down
     * (2026-09-17 audit). This channel used to be a bare `.subscribe()` —
     * no status callback at all, so a CHANNEL_ERROR/TIMED_OUT reconnect
     * (a known edge of Supabase's multiplexed channels — see realtime.ts's
     * own docblock) simply lost whatever UPDATE happened in between. Read
     * the row directly on every (re)subscribe and dispatch through the
     * SAME handler the live payload uses, so a missed 'active' or a missed
     * terminal status is not silently dropped.
     */
    const recoverStatus = async () => {
      const { data, error } = await supabase
        .from('calls')
        .select('status, end_reason')
        .eq('id', callId)
        .maybeSingle();
      if (error) {
        reportSwallowed('recoverCallStatus', error);
        return;
      }
      if (data) {
        dispatch(data);
      }
    };
    const channel = supabase
      .channel(`call-status:${callId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'calls',
          filter: `id=eq.${callId}`,
        },
        payload => dispatch(payload.new as { status: string; end_reason: string | null }),
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          void recoverStatus();
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [callId]);
}

/** What a fresh ring hands the callee's app so it can raise the incoming screen. */
export interface IncomingCall {
  callId: string;
  conversationId: string;
  callerId: string;
  medium: CallMedium;
  mediaBackend: CallMediaBackend;
  mediaExperimentId: string | null;
}

/**
 * Ring detection, foreground. Subscribes to INSERTs on `calls` where this user
 * is the callee and the row is still ringing, and hands them up so the app can
 * raise the incoming-call screen.
 *
 * Realtime enforces RLS on `postgres_changes`, so the socket only ever delivers
 * calls this user is a party to; the `callee_id` filter is bandwidth, not
 * security (the same reasoning as the conversation channel). A killed app is a
 * separate path — `pending_call_pushes` + FCM — and not this hook's job.
 */
export function useIncomingCalls(
  selfId: string | undefined,
  onIncoming: (call: IncomingCall) => void,
): void {
  useEffect(() => {
    if (selfId === undefined) {
      return;
    }
    async function recoverRinging() {
      const { data, error } = await supabase
        .from('calls')
        .select(
          'id, conversation_id, caller_id, medium, status, media_backend, media_experiment_id',
        )
        .eq('callee_id', selfId as string)
        .eq('status', 'ringing')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      // Best-effort recovery of a ring that arrived while the socket was down, so
      // it does not throw — but a persistent failure here means silently missed
      // calls, which must not be invisible. (2026-09-10 audit)
      if (error) {
        reportSwallowed('recoverRinging', error);
        return;
      }
      if (data && data.status === 'ringing') {
        onIncoming({
          callId: data.id,
          conversationId: data.conversation_id,
          callerId: data.caller_id,
          medium: data.medium,
          mediaBackend: data.media_backend,
          mediaExperimentId: data.media_experiment_id,
        });
      }
    }

    const channel = supabase
      .channel(`incoming-calls:${selfId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'calls',
          filter: `callee_id=eq.${selfId}`,
        },
        payload => {
          const row = payload.new as {
            id: string;
            conversation_id: string;
            caller_id: string;
            medium: CallMedium;
            status: string;
            media_backend: CallMediaBackend;
            media_experiment_id: string | null;
          };
          if (row.status === 'ringing') {
            onIncoming({
              callId: row.id,
              conversationId: row.conversation_id,
              callerId: row.caller_id,
              medium: row.medium,
              mediaBackend: row.media_backend,
              mediaExperimentId: row.media_experiment_id,
            });
          }
        },
      )
      .subscribe(status => {
        // CHANNEL_ERROR / TIMED_OUT as well as SUBSCRIBED (2026-09-17
        // audit): this channel is the one that carries a fresh incoming
        // ring, and a reconnect that never repairs is a missed call with
        // no second chance once the ring times out server-side.
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          void recoverRinging();
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selfId, onIncoming]);
}
