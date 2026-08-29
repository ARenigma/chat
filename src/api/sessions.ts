/**
 * Paid session API.
 *
 * Wraps the server-authoritative session RPCs (migration 030, landing before
 * launch). Billing begins only when both participants have live leases — this is
 * enforced server-side; the client is only UI.
 *
 * ADR-0020: ephemeral bilateral paid sessions.
 * Migration 030: create_session_request, accept_session_request, end_session,
 *               claim_session_lease.
 */

import { useCallback, useEffect, useRef } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { track } from '../lib/telemetry';

type SessionChannel = 'chat' | 'audio' | 'video';
type SessionStatus =
  | 'pending_leases'
  | 'active'
  | 'warning'
  | 'grace'
  | 'ended'
  | 'reported_hold';

export interface PaidSession {
  id: string;
  conversation_id: string;
  channel: SessionChannel;
  status: SessionStatus;
  member_id: string;
  provider_id: string;
  rate_tokens_per_min: number;
  started_at: string | null;
  ended_at: string | null;
  last_activity_at: string | null;
}

const sessionKeys = {
  active: (conversationId: string) =>
    ['session', 'active', conversationId] as const,
};

/** Start a session request for a conversation/channel. */
export function useCreateSessionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      conversationId,
      channel,
    }: {
      conversationId: string;
      channel: SessionChannel;
    }) => {
      const { data, error } = await supabase.rpc('create_session_request', {
        p_conversation_id: conversationId,
        p_channel: channel,
      });
      if (error) throw error;
      track('session_requested', { channel });
      return data; // request id (string)
    },
    onSuccess: (_requestId, { conversationId }) => {
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.active(conversationId),
      });
    },
  });
}

/** Accept an incoming session request. */
export function useAcceptSessionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    // conversationId is not sent to the RPC; it is only used by onSuccess to
    // invalidate the right cache key. Destructure only what the RPC needs here.
    mutationFn: async ({
      requestId,
    }: {
      requestId: string;
      conversationId: string;
    }) => {
      const { data, error } = await supabase.rpc('accept_session_request', {
        p_request_id: requestId,
      });
      if (error) throw error;
      return data; // session id
    },
    onSuccess: (_sessionId, { conversationId }) => {
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.active(conversationId),
      });
    },
  });
}

/** End a session, with optional content report. */
export function useEndSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      sessionId,
      reason = 'manual',
      reportReason,
      reportMessageIds,
      reportStatement,
    }: {
      sessionId: string;
      reason?: string;
      reportReason?: string;
      reportMessageIds?: string[];
      reportStatement?: string;
    }) => {
      const { error } = await supabase.rpc('end_session', {
        p_session_id: sessionId,
        p_end_reason: reason,
        p_report_reason: reportReason ?? null,
        p_report_message_ids: reportMessageIds ?? null,
        p_report_statement: reportStatement ?? null,
      });
      if (error) throw error;
      track('session_ended', { reason });
    },
    onSuccess: () => {
      // Invalidate all session queries; client clears transcript.
      void queryClient.invalidateQueries({ queryKey: ['session'] });
    },
  });
}

/**
 * 10 s interval; server grace period is 30 s. The gap exists so a single missed
 * heartbeat is not fatal but three consecutive misses (30 s) expire the lease.
 */
const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Sends foreground lease heartbeats while the component is mounted and the app
 * is in the foreground. Stops immediately on background.
 *
 * Mount this in ChatScreen while an active session is running. Unmounting or
 * backgrounding triggers the server-side 30 s grace window, then the session
 * ends automatically. The hook is a no-op when `sessionId` is null.
 */
export function useSessionLease(sessionId: string | null): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queryClient = useQueryClient();

  const sendHeartbeat = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { data, error } = await supabase.rpc('claim_session_lease', {
        p_session_id: sessionId,
        p_kind: 'foreground',
      });
      if (error) throw error;
      // If the server signals the session has ended (e.g. balance exhausted),
      // invalidate so the chat screen picks up the new status.
      if (data === 'ended') {
        void queryClient.invalidateQueries({ queryKey: ['session'] });
      }
    } catch {
      // Heartbeat failure is non-fatal: the server will expire the lease after
      // the 30 s grace period if heartbeats stop arriving.
    }
  }, [sessionId, queryClient]);

  useEffect(() => {
    if (!sessionId) return;

    const start = () => {
      sendHeartbeat().catch(() => undefined);
      intervalRef.current = setInterval(
        () => {
          sendHeartbeat().catch(() => undefined);
        },
        HEARTBEAT_INTERVAL_MS,
      );
    };

    const stop = () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };

    // Send immediately on mount.
    start();

    // Stop heartbeats when the app moves to the background so the server's
    // 30 s grace window starts. Resume when the app comes back to the
    // foreground.
    const subscription = AppState.addEventListener(
      'change',
      (state: AppStateStatus) => {
        if (state !== 'active') {
          stop();
        } else {
          start();
        }
      },
    );

    return () => {
      stop();
      subscription.remove();
    };
  }, [sessionId, sendHeartbeat]);
}
