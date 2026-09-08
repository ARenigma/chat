/**
 * The live conversation: one Realtime channel carrying two different kinds of
 * signal, because they have two different durabilities.
 *
 *   - `postgres_changes` on `messages`, durable. The message exists whether or
 *     not anyone is listening, so the socket is a delivery optimisation, not the
 *     source of truth. A missed event is recovered by the query refetching.
 *   - `broadcast` typing, sub-second and disposable. Never written down.
 *
 * There was a third, and migration 012 is why it is gone. A Realtime `presence`
 * channel answers "is the other person's app in the foreground", which is not
 * presence: nobody agreed to have it published, it cannot be turned off, and in a
 * product about loneliness a dot implying somebody is waiting is a nudge built on
 * a fact we do not have. Presence is now a declared column read from
 * `conversation_peers`, so this channel stopped being read by any screen; the
 * `track()` call was still broadcasting the caller's connection to nobody, which
 * is the worst of both. Typing stays, because it animates while somebody is
 * actually typing, which is a thing they are doing on purpose.
 *
 * Realtime enforces RLS on `postgres_changes`, so a client is only ever sent
 * rows it could have selected. That is why the channel does not filter by
 * participant itself: the database already will not send someone else's
 * conversation. The `conversation_id` filter below is bandwidth, not security.
 */
import { useEffect, useMemo, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { Message } from '../lib/database.types';
import {
  applyReadReceipt,
  mergeIncoming,
  unreadFromPeer,
  type TranscriptMessage,
} from '../lib/transcript';
import { recoverMessageGap, keys } from './chat';
import { useStore } from '../store/useStore';

/** How long a typing broadcast keeps the indicator up without a refresh. */
const TYPING_TTL_MS = 4_000;
/** Minimum gap between outbound typing broadcasts, per keystroke burst. */
const TYPING_THROTTLE_MS = 1_500;

export const messagesKey = (conversationId: string) => ['messages', conversationId] as const;

interface TypingPayload {
  userId: string;
}

export interface LiveConversation {
  /** Call on every keystroke; throttled internally. */
  notifyTyping: () => void;
}

/**
 * Subscribes to a conversation and folds everything it receives into the
 * React Query cache, so the transcript has exactly one source of truth whether a
 * message arrived by refetch or by socket.
 */
export function useLiveConversation(
  conversationId: string | undefined,
  selfId: string | undefined,
): LiveConversation {
  const queryClient = useQueryClient();
  const setPeerTyping = useStore(s => s.setPeerTyping);

  const channelRef = useRef<RealtimeChannel | null>(null);
  const lastTypingSentRef = useRef(0);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (conversationId === undefined || selfId === undefined) {
      return;
    }

    let cancelled = false;
    const key = messagesKey(conversationId);

    const write = (
      fn: (list: readonly TranscriptMessage[]) => TranscriptMessage[],
    ): void => {
      queryClient.setQueryData<TranscriptMessage[]>(key, prev => fn(prev ?? []));
    };

    const channel = supabase.channel(`conversation:${conversationId}`, {
      config: {
        // Our own typing broadcast coming back to us would flicker the peer
        // indicator on our own keystrokes.
        broadcast: { self: false },
      },
    });

    channel
      .on<Message>(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        payload => {
          write(list => mergeIncoming(list, payload.new, selfId));
          if (payload.new.sender_id !== selfId) {
            // A message is a stronger signal than the typing broadcast: they
            // sent it, so they have stopped typing.
            setPeerTyping(false);
          }
        },
      )
      .on<Message>(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        payload => {
          const { id, read_at } = payload.new;
          if (read_at !== null) {
            write(list => applyReadReceipt(list, id, read_at));
          }
        },
      )
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        const from = (payload as TypingPayload | undefined)?.userId;
        if (from === undefined || from === selfId) {
          return;
        }
        setPeerTyping(true);
        if (typingTimerRef.current !== null) {
          clearTimeout(typingTimerRef.current);
        }
        typingTimerRef.current = setTimeout(() => setPeerTyping(false), TYPING_TTL_MS);
      });

    void (async () => {
      // Realtime authorises `postgres_changes` against the caller's JWT, so the
      // socket has to be holding the current one before we subscribe. Without
      // this a token refresh can leave the channel authenticated as the previous
      // session and silently deliver nothing.
      const { data } = await supabase.auth.getSession();
      if (cancelled) {
        return;
      }
      if (data.session?.access_token !== undefined) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED') {
          // No `channel.track()` any more. It published this device's connection
          // for a presence signal nothing reads, which is a fact about somebody
          // leaving their phone unlocked that we have no business broadcasting.
          //
          /*
           * A socket that was down may have missed inserts, so (re)subscribe is
           * where a dropped connection heals itself.
           *
           * It used to `invalidateQueries`, which refetches the newest 100 rows
           * — correct only while fewer than 100 arrived during the outage. Past
           * that the OLDEST missed messages fell off the end of the window and
           * were never fetched, because the transcript has no pagination to
           * reach back for them. A silent hole in the conversation.
           *
           * `recoverMessageGap` walks a CURSOR forward from the newest row we
           * hold until a page comes back short, which is Telegram's shape at a
           * smaller scale, and falls back to the fixed window only when the
           * cache is cold or the gap is enormous.
           */
          void recoverMessageGap(queryClient, conversationId, selfId);
          return;
        }
        /*
         * A channel that FAILED, rather than one that closed.
         *
         * Only `SUBSCRIBED` was handled before, which made the self-healing
         * above conditional on a recovery that may never come: if the socket
         * reconnects but this channel never reaches SUBSCRIBED again — a known
         * edge of Supabase's multiplexed channels — nothing refetches and the
         * transcript is quietly missing every message that arrived in between.
         * No error is thrown, so nothing surfaces it.
         *
         * The refetch is fired HERE too, not just on resubscribe, because the
         * cheap thing to get right is the data: even if the channel is gone for
         * good, the member sees the current transcript instead of a stale one.
         *
         * Telegram's equivalent is unconditional — it does not wait to be told
         * the connection is healthy again; a gap in `pts` triggers
         * `getDifference` regardless of connection state
         * (MessagesController.java:8206). Same instinct, much smaller hammer.
         */
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          // Same cursor walk on failure as on resubscribe: the member sees the
          // current transcript even if this channel never comes back.
          void recoverMessageGap(queryClient, conversationId, selfId);
        }
      });
      channelRef.current = channel;
    })();

    return () => {
      cancelled = true;
      if (typingTimerRef.current !== null) {
        clearTimeout(typingTimerRef.current);
        typingTimerRef.current = null;
      }
      channelRef.current = null;
      setPeerTyping(false);
      void supabase.removeChannel(channel);
    };
  }, [conversationId, selfId, queryClient, setPeerTyping]);

  return useMemo<LiveConversation>(
    () => ({
      notifyTyping: () => {
        const channel = channelRef.current;
        if (channel === null || selfId === undefined) {
          return;
        }
        const now = Date.now();
        if (now - lastTypingSentRef.current < TYPING_THROTTLE_MS) {
          return;
        }
        lastTypingSentRef.current = now;
        void channel.send({
          type: 'broadcast',
          event: 'typing',
          payload: { userId: selfId } satisfies TypingPayload,
        });
      },
    }),
    [selfId],
  );
}

/**
 * Marks the peer's messages read once they are on screen.
 *
 * Batched into one `in` filter rather than a write per message, and it only ever
 * touches `read_at`, the RLS policy rejects marking your own message read, and
 * a trigger rejects any other column, so this is the whole of what a client may
 * write to `messages`.
 */
export function useMarkRead(conversationId: string | undefined, selfId: string | undefined): void {
  const queryClient = useQueryClient();
  const inFlightRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (conversationId === undefined || selfId === undefined) {
      return;
    }
    const key = messagesKey(conversationId);

    const flush = (): void => {
      const list = queryClient.getQueryData<TranscriptMessage[]>(key) ?? [];
      const ids = unreadFromPeer(list, selfId).filter(id => !inFlightRef.current.has(id));
      if (ids.length === 0) {
        return;
      }
      ids.forEach(id => inFlightRef.current.add(id));
      void supabase
        .from('messages')
        .update({ read_at: new Date().toISOString() })
        .in('id', ids)
        .then(({ error }) => {
          if (error) {
            // Left out of `inFlight` so a transient failure retries on the next
            // cache change rather than being swallowed for the session.
            ids.forEach(id => inFlightRef.current.delete(id));
          } else {
            // Dissolve the unread badge in the conversation list. The DB update
            // above changes `unread_count_provider` on the server but the
            // conversation-list query would otherwise sit stale until its next
            // poll. Invalidating here is cheap (one refetch, already stale at
            // 10 s) and the only way the badge disappears promptly.
            void queryClient.invalidateQueries({ queryKey: keys.conversationList });
          }
        });
    };

    flush();
    const unsubscribe = queryClient.getQueryCache().subscribe(event => {
      if (event.query.queryHash === JSON.stringify(key)) {
        flush();
      }
    });
    return unsubscribe;
  }, [conversationId, selfId, queryClient]);
}
