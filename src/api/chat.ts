import { useCallback, useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import type {
  ClaimResult,
  ConversationSummary,
  Message,
  Profile,
  ProviderSummary,
  SendError,
} from '../lib/database.types';
import { canSend } from '../lib/tokenLedger';
import { errorTick, tick } from '../lib/haptics';
import {
  PENDING_PREFIX,
  insertOptimistic,
  markFailed,
  settleOptimistic,
  type TranscriptMessage,
} from '../lib/transcript';
import { newUuid } from '../lib/ids';
import {
  dequeue,
  enqueue,
  pendingFor,
  recordAttempt,
} from '../lib/outboxStore';
import { track } from '../lib/telemetry';
import { useStore } from '../store/useStore';
import { messagesKey } from './realtime';
import { sendResultFrom } from '../lib/sendErrors';

/** Newest-first: the transcript renders into an inverted list. */
const PAGE_SIZE = 100;

export const keys = {
  profile: ['profile'] as const,
  providers: ['providers'] as const,
  conversationList: ['conversation-list'] as const,
  conversation: (providerId: string) => ['conversation', providerId] as const,
  messages: messagesKey,
};

/** Wallet debit is a member problem. Thread side beats a stale profile cache. */
export function memberPaysInThread(
  queryClient: QueryClient,
  conversationId: string,
): boolean {
  const list = queryClient.getQueryData<ConversationSummary[]>(keys.conversationList);
  const row = list?.find(c => c.conversation_id === conversationId);
  return row?.i_am_member ?? true;
}

const NOTICE: Record<SendError, string> = {
  INSUFFICIENT_BALANCE: 'You are out of tokens.',
  POLICY_REQUIRED: 'Accept the latest Terms and Privacy Policy to continue.',
  BAD_REQUEST: 'That message could not be sent.',
  UNAUTHORIZED: 'Session expired. Reopen the app to continue.',
  FORBIDDEN: 'That conversation is not available.',
  NOT_FOUND: 'That conversation no longer exists.',
  // Deliberately does not say who blocked whom. The database will not tell us,
  // and surfacing it would turn a block into an invitation to make a new account.
  BLOCKED: 'You can no longer message each other.',
  SUSPENDED: 'Your account is under review and cannot send messages.',
  RATE_LIMITED: 'Slow down a moment, then try again.',
  // Names the channel, not the person: they have not gone away, they are not
  // taking this one. The call buttons carry the same fact before it is tapped.
  CHANNEL_DISABLED_BY_PROVIDER: 'They are not taking chats right now.',
};


async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getUser();
  if (!data.user) {
    throw new Error('No session');
  }
  return data.user.id;
}

/** The session's own profile id, every "is this mine" comparison needs it. */
export function useSelfId() {
  return useQuery<string>({
    queryKey: ['self'],
    queryFn: requireUserId,
    staleTime: Infinity,
  });
}

/** Profile + the authoritative token balance, mirrored into the store. */
export function useProfile() {
  const setBalance = useStore(s => s.setBalance);

  const query = useQuery<Profile>({
    queryKey: keys.profile,
    queryFn: async () => {
      const userId = await requireUserId();
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    staleTime: 15_000,
  });

  useEffect(() => {
    if (query.data) {
      setBalance(query.data.token_balance);
    }
  }, [query.data, setBalance]);

  return query;
}

/**
 * The provider directory.
 *
 * Server-supplied, where the persona list was a compile-time constant. Reading
 * the `provider_directory` view rather than `profiles` is deliberate: the view
 * names its columns explicitly, so a column added to `profiles` later cannot
 * leak into the directory by accident.
 */
export function useProviders() {
  return useQuery<ProviderSummary[]>({
    queryKey: keys.providers,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('provider_directory')
        .select('*')
        .order('is_available', { ascending: false })
        .order('created_at', { ascending: true });
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    staleTime: 30_000,
  });
}

/**
 * Chat history: every thread this session is part of, newest activity first.
 *
 * Reads the `conversation_summaries` view, which carries the peer's name, the
 * last message and the unread count in one row. Doing that client-side would be
 * two extra round trips per thread, and the view is `security_invoker` so RLS
 * still guarantees it can only ever return your own threads.
 */
export function useConversations() {
  return useQuery<ConversationSummary[]>({
    queryKey: keys.conversationList,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversation_summaries')
        .select('*')
        .order('last_session_at', { ascending: false, nullsFirst: false });
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    staleTime: 10_000,
  });
}

/** One RPC: resolves this member's thread with a provider, creating it once. */
export function useConversationId(providerId: string | null) {
  return useQuery<string>({
    queryKey: keys.conversation(providerId ?? ''),
    enabled: providerId !== null,
    staleTime: Infinity,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('open_conversation', {
        p_provider_id: providerId as string,
      });
      if (error || !data) {
        throw new Error(error?.message ?? 'Could not open the conversation');
      }
      return data;
    },
  });
}

export function useMessages(conversationId: string | undefined) {
  // TranscriptMessage rather than Message: rows that have settled carry a
  // client-only `localKey`, which the list keys on so a confirmation does not
  // remount the bubble. See lib/transcript.ts.
  return useQuery<TranscriptMessage[]>({
    queryKey: keys.messages(conversationId ?? ''),
    enabled: conversationId !== undefined,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId as string)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
  });
}

/**
 * Prefetch messages for a conversation into the React Query cache.
 *
 * Called on `onPressIn` from the CHATS rail so the fetch is already in flight
 * when the navigation animation finishes and ChatScreen mounts. No-op if the
 * data is already fresh in cache (React Query's default behaviour).
 */
export function prefetchMessages(qc: QueryClient, conversationId: string): void {
  void qc.prefetchQuery({
    queryKey: keys.messages(conversationId),
    queryFn: async () => {
      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(PAGE_SIZE);
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
  });
}

/**
 * The send path: one RPC, one transaction.
 *
 * The Edge Function this replaced had to debit, call a model, then insert,
 * three steps that could fail apart, which is why it carried refund logic.
 * `send_message` debits and inserts in a single statement pair, so a failure
 * leaves nothing behind and there is no refund to get wrong.
 *
 * The optimistic row still exists, for a different reason: it puts the bubble on
 * screen on the same frame as the keypress. It is settled by whichever comes
 * back first, the RPC response or the Realtime INSERT.
 */
export function useSendMessage(conversationId: string | undefined, selfId: string | undefined) {
  const queryClient = useQueryClient();
  const setSending = useStore(s => s.setSending);
  const setBalance = useStore(s => s.setBalance);
  const setNotice = useStore(s => s.setNotice);
  const openRefill = useStore(s => s.openRefill);

  return useCallback(
    async (
      raw: string,
      replyToId: string | null = null,
      /*
       * A REPLAY of an already-queued send, rather than a new one.
       *
       * Supplied by `useOutboxReplay` when draining the persisted queue: the
       * nonce and timestamp must be the ORIGINALS, or the replay is a different
       * message. Reusing the nonce is what makes it safe — migration 081
       * collapses it if the first attempt in fact landed.
       */
      resume?: { readonly nonce: string; readonly createdAt: string },
    ): Promise<boolean> => {
      const body = raw.trim();
      if (body === '' || conversationId === undefined || selfId === undefined) {
        return false;
      }
      // Providers never pay to reply — balance is a member wallet. A provider at
      // 0 tokens (the normal state) used to open refill and abort before the RPC,
      // so accepting a pending chat request by sending never left the device.
      if (memberPaysInThread(queryClient, conversationId) && !canSend(useStore.getState().balance)) {
        errorTick();
        openRefill();
        return false;
      }

      tick();
      const key = keys.messages(conversationId);
      /*
       * The idempotency key, and the local row's identity, are the SAME value.
       *
       * `pending-${Date.now()}` collided whenever two sends landed in one
       * millisecond — which is exactly the case that produced two "launch test"
       * rows 5 ms apart in production. A uuid cannot collide, and reusing it as
       * the nonce means the retry of a send is provably the same send.
       */
      const nonce = resume?.nonce ?? newUuid();
      const pendingId = `${PENDING_PREFIX}${nonce}`;
      const optimistic: Message = {
        id: pendingId,
        conversation_id: conversationId,
        sender_id: selfId,
        body,
        // Carried on the optimistic row so the quote block renders on the same
        // frame as the keypress. Without it a reply appears as a plain bubble and
        // then grows a quote when the server confirms, which is the one place a
        // reply looks like a bug.
        reply_to_id: replyToId,
        // 011 made `body` nullable so a row can carry audio instead. Stating the
        // voice columns here rather than leaving them off means a voice send path
        // has to be written, not inherited by accident.
        voice_path: null,
        voice_duration_ms: null,
        voice_peaks: null,
        // Text send: no attachment. Stated rather than left off for the same
        // reason as the voice columns, so an image path has to be written.
        attachment_path: null,
        attachment_type: null,
        attachment_width: null,
        attachment_height: null,
        // Unknown until the RPC returns; a member's own optimistic row never
        // gates the timer (that gate reads live PROVIDER messages), so null here
        // is safe. Filled from the confirmed row below.
        session_id: null,
        // A human send is always live; only the server writes automated openers.
        origin: 'live',
        // A replay keeps its original timestamp, so a message written before a
        // crash sorts where it was written rather than jumping to the bottom of
        // the thread when it finally lands.
        created_at: resume?.createdAt ?? new Date().toISOString(),
        read_at: null,
      };

      queryClient.setQueryData<TranscriptMessage[]>(key, prev =>
        insertOptimistic(prev ?? [], optimistic),
      );
      setSending(true);

      /*
       * Persist the intent BEFORE the request. That ordering is the whole
       * mechanism, and it is Telegram's: a row at `send_state = 1` exists
       * before the network is touched, so a process kill in the window between
       * tapping send and the server answering loses nothing
       * (MessagesStorage.java:551, replayed from ApplicationLoader.java:259).
       *
       * Safe to replay because the nonce goes with it — see `lib/outbox.ts`.
       */
      if (resume === undefined) {
        enqueue({
          nonce,
          conversationId,
          body,
          replyToId: replyToId ?? null,
          createdAt: optimistic.created_at,
          attempts: 1,
        });
      } else {
        // Already queued; count the attempt instead of re-adding it, so the
        // replay cap in `useOutboxReplay` can actually be reached.
        recordAttempt(nonce);
      }

      const { data, error } = await supabase.rpc('send_message_idempotent', {
        p_client_nonce: nonce,
        p_conversation_id: conversationId,
        p_body: body,
        p_reply_to_id: replyToId,
      });
      setSending(false);

      const result = sendResultFrom(data, error);

      if (result === null || !result.success) {
        /*
         * The bubble STAYS, marked failed. It used to be spliced out, which
         * meant the member watched their message vanish and had to retype it.
         *
         * The outbox entry stays too — but only for a failure that retrying
         * could plausibly fix. A refusal (blocked, rate limited, no balance)
         * would replay forever against a server that will keep saying no, so
         * those are dropped from the queue and left on screen as failed.
         */
        const worthRetrying = result === null || result.error === undefined;
        if (!worthRetrying) {
          dequeue(nonce);
        }
        queryClient.setQueryData<TranscriptMessage[]>(key, prev =>
          markFailed(prev ?? [], pendingId),
        );
        const code = result?.error;
        // The rejection *reason* is the signal worth watching: a spike in
        // BLOCKED or RATE_LIMITED is an abuse signal, not a bug report.
        track('send_rejected', { reason: code ?? 'network' });
        setNotice(
          code !== undefined ? NOTICE[code] : 'Could not send. Check your connection.',
        );
        errorTick();
        if (code === 'INSUFFICIENT_BALANCE') {
          openRefill();
        }
        // The balance may have moved for reasons unrelated to this send.
        void queryClient.invalidateQueries({ queryKey: keys.profile });
        return false;
      }

      const confirmed: Message | null =
        result.message_id !== undefined && result.created_at !== undefined
          ? {
              id: result.message_id,
              conversation_id: conversationId,
              sender_id: selfId,
              body,
              reply_to_id: replyToId,
              voice_path: null,
              voice_duration_ms: null,
              voice_peaks: null,
              attachment_path: null,
              attachment_type: null,
              attachment_width: null,
              attachment_height: null,
              session_id: result.session_id ?? null,
              origin: 'live',
              created_at: result.created_at,
              read_at: null,
            }
          : null;

      // Landed — or was collapsed by the nonce, which is the same outcome.
      dequeue(nonce);
      queryClient.setQueryData<TranscriptMessage[]>(key, prev =>
        settleOptimistic(prev ?? [], pendingId, confirmed),
      );

      if (typeof result.new_balance === 'number') {
        setBalance(result.new_balance);
      }
      track(replyToId === null ? 'message_sent' : 'reply_sent');
      // The inbox preview and unread counts are now stale.
      void queryClient.invalidateQueries({ queryKey: keys.conversationList });
      return true;
    },
    [conversationId, selfId, queryClient, setSending, setBalance, setNotice, openRefill],
  );
}

/**
 * Call log for a conversation: ended/missed/declined/failed calls only.
 * The display-only inline rows in the transcript read from this.
 */
export interface CallRecord {
  id: string;
  conversation_id: string;
  medium: 'voice' | 'video';
  status: 'ended' | 'missed' | 'declined' | 'failed';
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
}

export function useCalls(conversationId: string | undefined) {
  return useQuery<CallRecord[]>({
    queryKey: ['calls', conversationId ?? ''],
    enabled: conversationId !== undefined,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('calls')
        .select('id, conversation_id, medium, status, started_at, ended_at, created_at')
        .eq('conversation_id', conversationId as string)
        .in('status', ['ended', 'missed', 'declined', 'failed'])
        .order('created_at', { ascending: false });
      if (error) {
        throw new Error(error.message);
      }
      return (data ?? []) as CallRecord[];
    },
    staleTime: 30_000,
  });
}

/** The refill trigger behind the low-balance sheet. */
export function useClaimTokens() {
  const queryClient = useQueryClient();
  const setBalance = useStore(s => s.setBalance);
  const setNotice = useStore(s => s.setNotice);
  const closeRefill = useStore(s => s.closeRefill);

  return useMutation<ClaimResult>({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc('claim_daily_tokens');
      if (error || !data) {
        throw new Error(error?.message ?? 'Refill failed');
      }
      return data;
    },
    onSuccess: result => {
      if (result.success && typeof result.new_balance === 'number') {
        setBalance(result.new_balance);
        closeRefill();
        void queryClient.invalidateQueries({ queryKey: keys.profile });
        return;
      }
      setNotice(
        result.error === 'TOO_SOON'
          ? 'Your next free refill unlocks within 24 hours.'
          : 'Refill unavailable right now.',
      );
    },
    onError: () => setNotice('Refill unavailable right now.'),
  });
}

/**
 * How many times a queued send is replayed automatically before it is left to
 * the member.
 *
 * A cap, not a retry policy. Anything still failing after five launches is
 * failing for a reason a sixth attempt will not change, and an uncapped replay
 * on every mount is an infinite loop with a network call in it. The bubble
 * stays on screen marked failed, so nothing is lost — it just stops trying by
 * itself, which is the honest state to be in.
 */
export const REPLAY_LIMIT = 5;

/**
 * Drain the persisted outbox for this conversation.
 *
 * Telegram's `checkUnsentMessages()` (ApplicationLoader.java:259), scoped to
 * one thread rather than run globally at boot: we have no local transcript to
 * replay into, so a queued send is only meaningful once the screen that shows
 * it is open. That is a real difference from Telegram, and it means a queued
 * message is sent when the member next opens THAT chat rather than at launch.
 *
 * Runs on mount and whenever the app returns to the foreground — the two
 * moments at which connectivity has plausibly changed. Deliberately NOT on a
 * timer: a queue that retries on a clock is a queue that retries while the
 * member is watching it fail.
 */
export function useOutboxReplay(
  conversationId: string | undefined,
  send: (
    raw: string,
    replyToId?: string | null,
    resume?: { readonly nonce: string; readonly createdAt: string },
  ) => Promise<boolean>,
): void {
  /*
   * `send` through a ref. It is recreated on most renders, and taking it as a
   * dependency would re-run the drain on every one of them — replaying the
   * queue dozens of times per second while the screen is alive.
   */
  const sendRef = useRef(send);
  sendRef.current = send;

  useEffect(() => {
    if (conversationId === undefined) {
      return;
    }
    let cancelled = false;

    const drain = () => {
      for (const entry of pendingFor(conversationId)) {
        if (entry.attempts >= REPLAY_LIMIT) {
          continue;
        }
        if (cancelled) {
          return;
        }
        // Sequential would be tidier but a queue of two or three short strings
        // does not justify serialising them, and each is independently
        // idempotent, so an interleaved failure cannot corrupt another.
        void sendRef.current(entry.body, entry.replyToId, {
          nonce: entry.nonce,
          createdAt: entry.createdAt,
        });
      }
    };

    drain();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        drain();
      }
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [conversationId]);
}
