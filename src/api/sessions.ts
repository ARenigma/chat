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

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  /** Whole minutes Postgres has deducted so far; 1 at activation (minute 1 is prepaid). */
  minutes_billed: number;
  /** When the next minute is due; the cron deducts at its first tick at or after this. */
  next_bill_at: string | null;
  /**
   * Member only: `(next_bill_at − now) + floor(balance ÷ rate) × 60`, read in
   * one server snapshot so the chat countdown never jumps when the cron
   * catches up on a minute (migration 062). Null for the provider, before
   * activation, and on a server older than 062. Age it with
   * `secondsRemainingNow`; never recompute it from `balance` on the client.
   */
  seconds_remaining: number | null;
}

export interface PendingSessionRequest {
  id: string;
  channel: SessionChannel;
  status: string;
  /** Set when the provider has joined; member then confirms billing. */
  responded_at: string | null;
  initiator_id: string;
  recipient_id: string;
  expires_at: string;
  created_at: string;
}

const sessionKeys = {
  active: (conversationId: string) =>
    ['session', 'active', conversationId] as const,
  pendingRequest: (conversationId: string) =>
    ['session', 'pending-request', conversationId] as const,
};

/**
 * Realtime is an invalidation hint only. Every event is followed by an RPC
 * read, so Postgres remains authoritative for status and billing state.
 */
export function useSessionRealtime(conversationId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!conversationId) return;

    const invalidate = () => {
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.active(conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.pendingRequest(conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: ['conversation-list'] });
      // Settlement hides all session content server-side (migration 045). The
      // party that did not call end_session only learns via this session-state
      // channel, so refetch the transcript here too: RLS now returns nothing for
      // the hidden rows, clearing the chat for BOTH participants. A refetch
      // mid-session is cheap and returns the same visible rows.
      void queryClient.invalidateQueries({
        queryKey: ['messages', conversationId],
      });
    };

    const channel = supabase
      .channel(`session-state:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'session_requests',
          filter: `conversation_id=eq.${conversationId}`,
        },
        invalidate,
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'paid_sessions',
          filter: `conversation_id=eq.${conversationId}`,
        },
        invalidate,
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED') invalidate();
      });

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [conversationId, queryClient]);
}

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
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.pendingRequest(conversationId),
      });
    },
  });
}

/**
 * What `announce_chat_open` answered (migration 068, goal items 3 and 4).
 *
 * `alerted` is true ONLY when a push was actually dispatched, which is what
 * makes "{name} knows you are here" safe to render. Every other outcome carries the
 * reason, so the screen can stay silent about a doorbell it did not ring.
 */
export interface ChatOpenAlert {
  alerted: boolean;
  reason: string | null;
  peer_present?: boolean;
}

/**
 * Tell the other participant this chat was just opened, once per visit.
 *
 * A mutation dressed as a mount effect rather than a query: it has a side
 * effect and must fire exactly once per conversation opened, which is the one
 * thing a `useQuery` with a staleTime cannot promise.
 */
export function useAnnounceChatOpen(
  conversationId: string | undefined,
  enabled: boolean,
): ChatOpenAlert | null {
  const [result, setResult] = useState<ChatOpenAlert | null>(null);

  useEffect(() => {
    if (conversationId === undefined || !enabled) {
      return;
    }
    let live = true;
    setResult(null);
    void supabase
      .rpc('announce_chat_open', { p_conversation_id: conversationId })
      .then(({ data, error }) => {
        if (!live || error || data === null) {
          return;
        }
        setResult(data as unknown as ChatOpenAlert);
      });
    return () => {
      live = false;
    };
  }, [conversationId, enabled]);

  return result;
}

/** A chat request ringing at the provider right now (goal item 13). */
export interface IncomingChatRequest {
  requestId: string;
  conversationId: string;
  /** The member who asked. Members have no directory row, so this is all we get. */
  initiatorId: string;
  expiresAt: string;
}

/**
 * Chat requests arriving for this provider, live.
 *
 * The same shape as `useIncomingCalls` (api/calls.ts) and for the same reason:
 * an INSERT the recipient is subscribed to is the only signal that arrives
 * while they are looking at another screen. Filtered to chat, because a call
 * request already rings through the call path and two rings for one event is a
 * bug the member cannot see.
 */
export function useIncomingChatRequests(
  selfId: string | undefined,
  onIncoming: (request: IncomingChatRequest) => void,
): void {
  useEffect(() => {
    if (selfId === undefined) {
      return;
    }

    // Recovery fetch: if the provider opened the app after the INSERT arrived
    // (wrong account, late open, etc.) the realtime INSERT will never fire.
    // On subscribe we fetch any still-pending chat request for this recipient
    // and surface it once, allowing the store's de-dup guard to ignore it if
    // one was already set by a concurrent INSERT event.
    async function recoverPending() {
      // `session_requests` is not in the generated types — same situation as the
      // realtime subscription above which uses channel.on() without type checks.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = (await (supabase as any)
        .from('session_requests')
        .select('id, conversation_id, initiator_id, expires_at')
        .eq('recipient_id', selfId as string)
        .eq('channel', 'chat')
        .eq('status', 'pending')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()) as {
        data: { id: string; conversation_id: string; initiator_id: string; expires_at: string } | null;
      };
      if (result.data) {
        onIncoming({
          requestId: result.data.id,
          conversationId: result.data.conversation_id,
          initiatorId: result.data.initiator_id,
          expiresAt: result.data.expires_at,
        });
      }
    }

    const channel = supabase
      .channel(`incoming-chat-requests:${selfId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'session_requests',
          filter: `recipient_id=eq.${selfId}`,
        },
        payload => {
          const row = payload.new as {
            id: string;
            conversation_id: string;
            initiator_id: string;
            channel: SessionChannel;
            status: string;
            expires_at: string;
          };
          if (row.channel === 'chat' && row.status === 'pending') {
            onIncoming({
              requestId: row.id,
              conversationId: row.conversation_id,
              initiatorId: row.initiator_id,
              expiresAt: row.expires_at,
            });
          }
        },
      )
      .subscribe(status => {
        if (status === 'SUBSCRIBED') {
          void recoverPending();
        }
      });
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selfId, onIncoming]);
}

/**
 * The recipient says no (migration 067).
 *
 * Idempotent server-side, so a decline racing an expiry is not an error the
 * provider has to see.
 */
export function useDeclineSessionRequest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId }: { requestId: string; conversationId: string }) => {
      const { error } = await supabase.rpc('decline_session_request', {
        p_request_id: requestId,
      });
      if (error) throw error;
    },
    onSuccess: (_void, { conversationId }) => {
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.pendingRequest(conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: ['conversation-list'] });
    },
  });
}

/** Member confirms chat billing after the provider has joined (076). */
export function useConfirmChatSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ requestId }: { requestId: string; conversationId: string }) => {
      const { data, error } = await supabase.rpc('confirm_chat_session', {
        p_request_id: requestId,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (_id, { conversationId }) => {
      void queryClient.invalidateQueries({ queryKey: sessionKeys.active(conversationId) });
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.pendingRequest(conversationId),
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
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.pendingRequest(conversationId),
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
      void queryClient.invalidateQueries({ queryKey: ['messages'] });
      void queryClient.invalidateQueries({ queryKey: ['conversation-list'] });
    },
  });
}

/**
 * Reads the live session (pending_leases or active) for a conversation.
 * Returns null if no session exists. Invalidated after accept/end mutations
 * and also by Realtime (caller is responsible for subscription wiring).
 * Migration 037.
 */
export function useActiveSession(conversationId: string | undefined) {
  return useQuery<PaidSession | null>({
    queryKey: sessionKeys.active(conversationId ?? ''),
    enabled: conversationId !== undefined,
    staleTime: 15_000,
    // Realtime re-syncs this on every paid_sessions change (each cron tick), but
    // the countdown is aged from `dataUpdatedAt`, so while billing is live it
    // also re-anchors on its own every 30 s: a socket that drops for a while
    // must not leave the clock drifting from the server's figure.
    refetchInterval: query =>
      query.state.data?.next_bill_at != null && query.state.data.ended_at == null ? 30_000 : false,
    queryFn: async () => {
      if (!conversationId) return null;
      const { data, error } = await supabase.rpc('get_active_session', {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
      if (!data) return null;
      // The RPC returns JSONB; cast to the known shape.
      return data as unknown as PaidSession;
    },
  });
}

/**
 * Reads the most recent non-expired pending session request for a conversation
 * visible to the caller. Returns null if none.
 * Migration 037.
 */
export function usePendingSessionRequest(conversationId: string | undefined) {
  return useQuery<PendingSessionRequest | null>({
    queryKey: sessionKeys.pendingRequest(conversationId ?? ''),
    enabled: conversationId !== undefined,
    staleTime: 10_000,
    queryFn: async () => {
      if (!conversationId) return null;
      const { data, error } = await supabase.rpc('get_pending_session_request', {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
      if (!data) return null;
      return data as unknown as PendingSessionRequest;
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
export function useSessionLease(
  session: Pick<PaidSession, 'id' | 'channel'> | null,
  kind: 'foreground' | 'connected' = 'foreground',
): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const queryClient = useQueryClient();
  const sessionId = session?.id ?? null;
  const channel = session?.channel ?? null;

  const sendHeartbeat = useCallback(async () => {
    if (!sessionId) return;
    try {
      const { data, error } = await supabase.rpc('claim_session_lease', {
        p_session_id: sessionId,
        p_kind: kind,
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
  }, [sessionId, kind, queryClient]);

  useEffect(() => {
    if (!sessionId) return;

    const start = () => {
      if (intervalRef.current !== null) return;
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
    // A clean background transition ends text immediately. Connected calls are
    // kept alive by CallForegroundService; their lease heartbeat therefore
    // continues instead of applying the text-session rule.
    // https://developer.android.com/develop/background-work/services/fgs/service-types#phone-call
    const subscription =
      channel === 'chat'
        ? AppState.addEventListener('change', (state: AppStateStatus) => {
            if (state !== 'active') {
              stop();
              void supabase.rpc('end_session', {
                p_session_id: sessionId,
                p_end_reason: 'background',
                p_report_reason: null,
                p_report_message_ids: null,
                p_report_statement: null,
              });
            } else {
              start();
            }
          })
        : null;

    return () => {
      stop();
      subscription?.remove();
    };
  }, [sessionId, channel, sendHeartbeat]);
}
