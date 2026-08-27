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
 * The media itself is WebRTC P2P (src/api/callSession.ts): SDP + ICE ride a
 * Realtime broadcast channel keyed on the call id and are never stored, exactly
 * as the 011 note intended.
 */
import { useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { ENV } from '../lib/env';
import type { CallMedium, CallResult } from '../lib/database.types';

/**
 * Calling is ON. The client media layer (WebRTC + Realtime signalling) exists
 * now, so `start_call` no longer rings a phone that can never connect. Off for
 * years precisely so a control could not accept a tap and silently fail; this is
 * the commit that lands the media path, which is the only thing that earns the
 * flip.
 */
export const CALLS_ENABLED = true;

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

/** Ring someone. Returns the call id, or the reason it was refused. */
export async function startCall(
  conversationId: string,
  medium: CallMedium,
): Promise<CallResult | null> {
  const { data, error } = await supabase.rpc('start_call', {
    p_conversation_id: conversationId,
    p_medium: medium,
  });
  return error ? null : (data as CallResult);
}

/** Pick up. Moves the call to active and bills minute one. */
export async function answerCall(callId: string): Promise<CallResult | null> {
  const { data, error } = await supabase.rpc('answer_call', { p_call_id: callId });
  return error ? null : (data as CallResult);
}

/** Keep-alive + settle while a call is up; the ticker reads `last_seen_at`. */
export async function heartbeatCall(callId: string): Promise<CallResult | null> {
  const { data, error } = await supabase.rpc('heartbeat_call', { p_call_id: callId });
  return error ? null : (data as CallResult);
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
  return error ? null : (data as CallResult);
}

/** What a fresh ring hands the callee's app so it can raise the incoming screen. */
export interface IncomingCall {
  callId: string;
  conversationId: string;
  callerId: string;
  medium: CallMedium;
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
          };
          if (row.status === 'ringing') {
            onIncoming({
              callId: row.id,
              conversationId: row.conversation_id,
              callerId: row.caller_id,
              medium: row.medium,
            });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selfId, onIncoming]);
}
