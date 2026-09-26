import { useCallback, useEffect, useRef } from 'react';
import {
  onlineManager,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import { AppState } from 'react-native';
import { supabase } from '../lib/supabase';
import type {
  ClaimResult,
  ConversationPeer,
  ConversationSummary,
  Message,
  Profile,
  ProviderSummary,
  SendError,
} from '../lib/database.types';
import { canSend } from '../lib/tokenLedger';
import { errorTick, tick } from '../lib/haptics';
import {
  MESSAGE_PAGE_SIZE,
  PENDING_PREFIX,
  insertOptimistic,
  isPending,
  markFailed,
  mergeIncoming,
  settleOptimistic,
  type TranscriptMessage,
} from '../lib/transcript';
import { newUuid } from '../lib/ids';
import {
  dequeue,
  enqueue,
  pendingFor,
  readOutbox,
  recordAttempt,
} from '../lib/outboxStore';
import { track } from '../lib/telemetry';
import { useStore } from '../store/useStore';
import { messagesKey } from './realtime';
import { sendNotice, sendResultFrom } from '../lib/sendErrors';
import { CONTACT_GUARD_NOTICE, contactGuardNotice } from '../lib/contactGuard';
import { openRefill } from '../lib/routes/actions';

/**
 * Newest-first: the transcript renders into an inverted list.
 *
 * Defined in `src/lib/transcript.ts` so the pure row builders can read it too —
 * a full page is how they know older history exists outside the window.
 */
const PAGE_SIZE = MESSAGE_PAGE_SIZE;

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
  INSUFFICIENT_BALANCE: 'Your balance is empty.',
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
  ...CONTACT_GUARD_NOTICE,
};


/*
 * `getSession()`, not `getUser()` (L2, 2026-09-17 audit). `getUser()` is a
 * network round trip to re-validate the JWT server-side; this id is only
 * ever used for a client-side "is this mine" comparison or to shape a query
 * whose RLS policy independently re-checks auth.uid() anyway, never to
 * authorize anything by itself — the same reasoning SessionFeedbackSheet's
 * useWasTheMember already documents for the identical tradeoff. `getSession()`
 * reads the session MMKV already persisted (src/lib/storage.ts), so every
 * caller of `useSelfId()`/`useProfile()` stops paying a network round trip
 * every boot to answer a question the device already has the answer to.
 */
async function requireUserId(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (userId === undefined) {
    throw new Error('No session');
  }
  return userId;
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
    /*
     * Polling, because a provider coming online cannot be pushed here.
     * `provider_directory` is a VIEW, which `postgres_changes` cannot
     * replicate, and `profiles` is neither in the `supabase_realtime`
     * publication nor member-readable (004 dropped that policy deliberately and
     * made this definer view the privacy boundary), so a subscription would
     * deliver zero rows. Without the interval a member sitting on Home never
     * re-reads the directory at all.
     *
     * The pause while backgrounded and the refetch on return both depend on
     * AppState being wired to `focusManager` in App.tsx: React Native has no
     * window-focus event, so TanStack cannot know either on its own.
     * https://tanstack.com/query/latest/docs/framework/react/react-native
     */
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
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

/** How often an open chat re-reads its provider peer's presence. */
export const PEER_PRESENCE_POLL_MS = 15_000;

/** The two presence columns of one thread's peer row (migration 155). */
export type PeerPresenceRow = Pick<ConversationPeer, 'peer_online' | 'peer_last_seen_at'>;

/**
 * The provider peer's presence for ONE open chat, re-read every 15 s.
 *
 * Polling for the same reason as `useProviders`: `conversation_peers` is a
 * view, which `postgres_changes` cannot replicate, and the server's `online`
 * is a derivation over time (a heartbeat within 75 s) that expires without
 * any row changing, so there is no event to push. One row, two columns, by
 * `conversation_id`: the smallest read that answers the header's question,
 * rather than the whole inbox the thread row came from.
 *
 * `enabled` is the caller's "a member's chat with a provider": a member peer's
 * presence is never published (the view returns false and null for one), so
 * polling for it would be a request that can only say nothing. `focused` maps
 * to TanStack's `subscribed`, so a chat under another screen stops polling
 * (https://tanstack.com/query/latest/docs/framework/react/react-native,
 * "Disable queries on out of focus screens"); the app-background pause comes
 * from `refetchIntervalInBackground: false` with AppState wired to
 * `focusManager` in App.tsx. `staleTime` 0, so coming back into focus re-reads
 * at once rather than showing the reading from before the chat was covered.
 *
 * Null data is a real answer (no such thread for this caller, e.g. after a
 * block removes it); undefined is "not read yet". The caller falls back to the
 * thread row or the directory for the second, not the first.
 */
export function usePeerPresence(
  conversationId: string | undefined,
  { enabled, focused }: { enabled: boolean; focused: boolean },
) {
  return useQuery<PeerPresenceRow | null>({
    queryKey: ['peer-presence', conversationId ?? ''],
    enabled: enabled && conversationId !== undefined,
    subscribed: focused,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversation_peers')
        .select('peer_online, peer_last_seen_at')
        .eq('conversation_id', conversationId as string)
        .maybeSingle();
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    staleTime: 0,
    refetchInterval: PEER_PRESENCE_POLL_MS,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
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

/* ---------------------------------------------------------------------------
 * Editing and deleting a message (migration 103)
 * ------------------------------------------------------------------------- */

export function editedAt(message: Message): string | null {
  return message.edited_at ?? null;
}

export function deletedAt(message: Message): string | null {
  return message.deleted_at ?? null;
}

/** A tombstone: the sender took it back and both people can see that. */
export function isDeleted(message: Message): boolean {
  return deletedAt(message) !== null;
}

/**
 * How long a message stays editable, in milliseconds.
 *
 * WhatsApp's fifteen minutes, and the SAME fifteen minutes the server enforces —
 * `public.message_edit_window()` in migration 103 is the one definition and this
 * is its client mirror. Both numbers exist because the server has to refuse a
 * late edit and the client has to stop OFFERING one: an Edit button that is
 * going to come back EDIT_WINDOW_CLOSED is the app lying about what it can do.
 * `__tests__/chatSurface.test.ts` asserts the two agree.
 */
export const EDIT_WINDOW_MS = 15 * 60_000;

/**
 * Whether to draw the Edit action on a bubble at all.
 *
 * Every clause here is one the server also checks, and it is a mirror rather
 * than the enforcement — `edit_message` re-decides all of it against the row it
 * holds, which is where "own messages only" actually lives. A device that lies
 * to itself here gets NOT_FOUND.
 */
export function canEditMessage(
  message: Message,
  selfId: string | undefined,
  now: number = Date.now(),
): boolean {
  return (
    selfId !== undefined &&
    message.sender_id === selfId &&
    !isPending(message) &&
    !isDeleted(message) &&
    // Voice and photo carry no text; re-recording is a new send, not an edit.
    message.body !== null &&
    // An automated opener was written by the server from an approved template
    // and merely attributed to the provider (migration 045).
    message.origin === 'live' &&
    now - Date.parse(message.created_at) <= EDIT_WINDOW_MS
  );
}

/** Whether to draw the Delete action. No time limit — see migration 103. */
export function canDeleteMessage(
  message: Message,
  selfId: string | undefined,
): boolean {
  return (
    selfId !== undefined &&
    message.sender_id === selfId &&
    !isPending(message) &&
    !isDeleted(message) &&
    message.origin === 'live'
  );
}

/** What each server refusal says to the person who tried it. */
const EDIT_NOTICE: Record<string, string> = {
  EDIT_WINDOW_CLOSED: 'That message is too old to edit.',
  NOT_EDITABLE: 'That message cannot be edited.',
  NOT_DELETABLE: 'That message cannot be deleted.',
  NOT_FOUND: 'That message is no longer there.',
  BAD_REQUEST: 'That message could not be changed.',
  UNAUTHORIZED: NOTICE.UNAUTHORIZED,
  SUSPENDED: NOTICE.SUSPENDED,
};

interface MutateResult {
  success?: boolean;
  error?: string;
}

/**
 * The one place the two new RPCs cross the generated types.
 *
 * `supabase.rpc` is keyed on the `Functions` map in
 * `src/lib/database.types.ts`, and `edit_message` / `delete_message` are not on
 * it yet — that file is the hand-kept schema mirror and is owned by another
 * change in this batch. Confining the cast to one four-line function means
 * adding the two entries later deletes this and touches nothing else, rather
 * than leaving an `as never` at each call site for somebody to find.
 */
async function callMessageRpc(
  name: 'edit_message' | 'delete_message',
  args: Readonly<Record<string, string>>,
): Promise<{ result: MutateResult | null; failed: boolean }> {
  const untyped = supabase as unknown as {
    rpc: (
      fn: string,
      params: Readonly<Record<string, string>>,
    ) => Promise<{ data: unknown; error: unknown }>;
  };
  const { data, error } = await untyped.rpc(name, args);
  const result = (data ?? null) as MutateResult | null;
  return { result, failed: error !== null || result === null || result.success !== true };
}

/**
 * Edit one of your own messages.
 *
 * The cache is patched on success rather than optimistically: an edit has no
 * bubble to put on screen (the row is already there), so there is nothing for a
 * pre-emptive write to buy, and patching afterwards means a refusal never has to
 * be rolled back. The Realtime UPDATE arrives independently and folds to the
 * same row — `mergeIncoming` replaces by id, so the two cannot double up.
 */
export function useEditMessage(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useCallback(
    async (messageId: string, raw: string): Promise<boolean> => {
      const body = raw.trim();
      if (body === '' || conversationId === undefined) {
        return false;
      }
      const { result, failed } = await callMessageRpc('edit_message', {
        p_message_id: messageId,
        p_body: body,
      });
      if (failed) {
        const code = result?.error;
        setNotice(
          (contactGuardNotice(result) ?? (code !== undefined ? EDIT_NOTICE[code] : undefined)) ??
            'Could not edit. Check your connection.',
        );
        errorTick();
        return false;
      }
      tick();
      queryClient.setQueryData<TranscriptMessage[]>(
        keys.messages(conversationId),
        prev =>
          (prev ?? []).map(row =>
            row.id === messageId
              ? // Cast for the same reason the accessors above exist: the two
                // columns are not on `Message` yet. It goes when they are.
                ({ ...row, body, edited_at: new Date().toISOString() } as TranscriptMessage)
              : row,
          ),
      );
      return true;
    },
    [conversationId, queryClient, setNotice],
  );
}

/**
 * Delete one of your own messages, leaving a tombstone both people can see.
 *
 * The cached row is rewritten into that tombstone rather than spliced out, which
 * is the client half of the decision migration 103's header argues: a message
 * that silently vanishes from a scrollback is how somebody is made to doubt what
 * they read. Every payload field is cleared to match exactly what the server
 * wrote, so a later refetch cannot disagree with what is already on screen.
 *
 * The inbox is invalidated because `last_preview_kind` and the unread counts are
 * read from a view, and this is the cheapest way to be sure the row on the CHATS
 * rail agrees with the thread.
 */
export function useDeleteMessage(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useCallback(
    async (messageId: string): Promise<boolean> => {
      if (conversationId === undefined) {
        return false;
      }
      const { result, failed } = await callMessageRpc('delete_message', {
        p_message_id: messageId,
      });
      if (failed) {
        const code = result?.error;
        setNotice(
          (code !== undefined ? EDIT_NOTICE[code] : undefined) ??
            'Could not delete. Check your connection.',
        );
        errorTick();
        return false;
      }
      tick();
      queryClient.setQueryData<TranscriptMessage[]>(
        keys.messages(conversationId),
        prev =>
          (prev ?? []).map(row =>
            row.id === messageId
              ? ({
                  ...row,
                  deleted_at: new Date().toISOString(),
                  edited_at: null,
                  body: null,
                  voice_path: null,
                  voice_duration_ms: null,
                  voice_peaks: null,
                  attachment_path: null,
                  attachment_type: null,
                  attachment_width: null,
                  attachment_height: null,
                  localImageUri: undefined,
                } as TranscriptMessage)
              : row,
          ),
      );
      /*
       * No `track()` on either path, and that is a gap rather than a decision:
       * `TelemetryEvent` is a closed union in `src/lib/database.types.ts`, which
       * this change does not own. `message_edited`, `message_deleted` and a
       * shared `message_change_rejected` (with the server's code in
       * `props.reason`, the shape `send_rejected` already uses) belong there —
       * a spike in refusals is the signal worth watching.
       */
      void queryClient.invalidateQueries({ queryKey: keys.conversationList });
      return true;
    },
    [conversationId, queryClient, setNotice],
  );
}

/**
 * Fold a peer's edit or delete into the open transcript.
 *
 * WHY THIS IS A SECOND CHANNEL and not a line in `useLiveConversation`. That
 * hook already subscribes to UPDATE on `messages` and already receives this
 * event — it reads `read_at` off the row and discards everything else, which was
 * correct while a read receipt was the only UPDATE that existed. Generalising it
 * is a one-line change in `src/api/realtime.ts`, and that file belongs to
 * another change in flight; a second channel on the same multiplexed socket is
 * the version of this that cannot collide with it. Collapsing the two is worth
 * doing once both have landed.
 *
 * `mergeIncoming` is what does the work, for the reason it exists: it replaces
 * by id and preserves `localKey`, so an edited bubble keeps its identity and
 * does not remount (and therefore does not replay its send animation).
 */
export function useLiveMessageEdits(
  conversationId: string | undefined,
  selfId: string | undefined,
): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (conversationId === undefined || selfId === undefined) {
      return;
    }
    let cancelled = false;
    const key = keys.messages(conversationId);
    const channel = supabase.channel(`conversation-edits:${conversationId}`);

    channel.on<Message>(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      },
      payload => {
        const row = payload.new;
        // A read receipt is already folded by `useLiveConversation`, and
        // re-merging it here would write the same fact twice and re-render the
        // transcript for nothing.
        if (editedAt(row) === null && !isDeleted(row)) {
          return;
        }
        queryClient.setQueryData<TranscriptMessage[]>(key, prev =>
          mergeIncoming(prev ?? [], row, selfId),
        );
      },
    );

    void (async () => {
      // Same reason `useLiveConversation` does this: Realtime authorises
      // postgres_changes against the JWT the socket is holding, so the token has
      // to be current before subscribing or the channel silently delivers
      // nothing. Whichever of the two hooks subscribes first pays for it.
      const { data } = await supabase.auth.getSession();
      if (cancelled) {
        return;
      }
      if (data.session?.access_token !== undefined) {
        await supabase.realtime.setAuth(data.session.access_token);
      }
      if (cancelled) {
        return;
      }
      /*
       * A status callback, which this channel did not have.
       *
       * `useLiveConversation` heals itself on (re)subscribe because a socket
       * that was down may have missed INSERTs. This one carries UPDATEs, and it
       * was subscribing blind: a CHANNEL_ERROR here meant edits and deletes
       * stopped arriving and nothing ever went looking for the ones missed, so
       * the transcript kept showing a body the peer had already changed.
       *
       * `recoverMessageGap` now repairs both halves (see
       * `fetchMessagesChangedSince`), so the two channels can share one repair.
       *
       * CHANNEL_ERROR / TIMED_OUT are now actually checked (2026-09-17 audit):
       * the comment above already argued for this and the code never did it —
       * only SUBSCRIBED triggered the repair, so the exact failure this
       * paragraph describes was still live. `recoverMessageGap` is safe to
       * call from either status; it is a targeted since-gap fetch, not a
       * full refetch, so calling it once more than strictly necessary costs
       * one extra query, not a user-visible reflow.
       */
      channel.subscribe(status => {
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          void recoverMessageGap(queryClient, conversationId, selfId);
        }
      });
    })();

    return () => {
      cancelled = true;
      void supabase.removeChannel(channel);
    };
  }, [conversationId, selfId, queryClient]);
}

/**
 * Prefetch messages for a conversation into the React Query cache.
 *
 * Called on `onPressIn` from the CHATS rail so the fetch is already in flight
 * when the navigation animation finishes and the chat mounts. No-op if the
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
/**
 * The setters `sendMessageWith` needs, threaded explicitly rather than read
 * from hooks — the one thing that makes it callable from `drainAllOutbox`
 * (2026-09-17 audit, X7), which runs with no component and no conversation
 * screen mounted at all.
 */
interface SendMessageDeps {
  queryClient: QueryClient;
  conversationId: string;
  selfId: string;
  setSending: (sending: boolean) => void;
  setBalance: (balance: number) => void;
  setNotice: (message: string) => void;
  openRefill: () => void;
}

/**
 * The actual send: optimistic row, outbox persistence, the RPC, and settling
 * either the confirmed row or the failure. Split out of `useSendMessage` so
 * `drainAllOutbox` (X7) can replay a queued entry for a conversation with no
 * the chat open for it, through the exact same logic a live send uses —
 * not a second, hand-maintained copy of the idempotency/optimistic-UI rules.
 */
async function sendMessageWith(
  deps: SendMessageDeps,
  raw: string,
  replyToId: string | null = null,
  /*
   * A REPLAY of an already-queued send, rather than a new one.
   *
   * Supplied by `useOutboxReplay`/`drainAllOutbox` when draining the
   * persisted queue: the nonce and timestamp must be the ORIGINALS, or the
   * replay is a different message. Reusing the nonce is what makes it safe —
   * migration 081 collapses it if the first attempt in fact landed.
   */
  resume?: { readonly nonce: string; readonly createdAt: string },
): Promise<boolean> {
  const { queryClient, conversationId, selfId, setSending, setBalance, setNotice } = deps;
  const showRefill = deps.openRefill;
  const body = raw.trim();
  if (body === '') {
    return false;
  }
  // Providers never pay to reply — balance is a member wallet. A provider at
  // 0 tokens (the normal state) used to open refill and abort before the RPC,
  // so accepting a pending chat request by sending never left the device.
  if (memberPaysInThread(queryClient, conversationId) && !canSend(useStore.getState().balance)) {
    errorTick();
    showRefill();
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
    edited_at: null,
    deleted_at: null,
  };

  queryClient.setQueryData<TranscriptMessage[]>(key, prev =>
    insertOptimistic(prev ?? [], optimistic),
  );
  setSending(true);

  /*
   * Persist the intent BEFORE the request. That ordering is the whole
   * mechanism, and it is the reference app's: a row at `send_state = 1` exists
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
    // replay cap in `useOutboxReplay`/`drainAllOutbox` can actually be reached.
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
    /*
     * H7, 2026-09-17 audit: "Check your connection" used to be the fallback
     * for EVERY unmapped failure, including one the server actively
     * responded to and rejected for a reason `sendResultFrom` does not have
     * copy for — a real server-side answer, told to the member as if their
     * own network had failed. postgrest-js's own convention distinguishes
     * the two: a client-side/network failure always carries `code: ''`
     * (never `undefined`) precisely because it never reached PostgREST to
     * get a real one (PostgrestBuilder.ts's own comment: "we don't populate
     * code/hint for client-side network errors since those fields are meant
     * for upstream service errors"). Any OTHER non-empty code is a genuine,
     * if unmapped, server response.
     */
    setNotice(
      code !== undefined
        ? (sendNotice(result, NOTICE) ?? NOTICE[code])
        : error?.code === ''
          ? 'Could not send. Check your connection.'
          : 'Something went wrong on our side. Please try again.',
    );
    errorTick();
    if (code === 'INSUFFICIENT_BALANCE') {
      showRefill();
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
          edited_at: null,
          deleted_at: null,
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
}

export function useSendMessage(conversationId: string | undefined, selfId: string | undefined) {
  const queryClient = useQueryClient();
  const setSending = useStore(s => s.setSending);
  const setBalance = useStore(s => s.setBalance);
  const setNotice = useStore(s => s.setNotice);

  return useCallback(
    (
      raw: string,
      replyToId: string | null = null,
      resume?: { readonly nonce: string; readonly createdAt: string },
    ): Promise<boolean> => {
      if (conversationId === undefined || selfId === undefined) {
        return Promise.resolve(false);
      }
      return sendMessageWith(
        { queryClient, conversationId, selfId, setSending, setBalance, setNotice, openRefill },
        raw,
        replyToId,
        resume,
      );
    },
    [conversationId, selfId, queryClient, setSending, setBalance, setNotice],
  );
}

/**
 * Drains the persisted outbox for EVERY conversation, not just whichever
 * chat happens to be open (X7, 2026-09-17 audit — Amit's call: "Drain on
 * boot", matching the reference app's own `checkUnsentMessages()` scope rather than
 * this app's previous per-screen one; see `useOutboxReplay`'s docblock for
 * why this app started scoped to one thread).
 *
 * Entries are replayed in `readOutbox()`'s own order — oldest first,
 * `withEntry` in `lib/outbox.ts` always appends — so a conversation's own
 * entries stay in the order they were typed, and the queue as a whole drains
 * oldest-first the same way the reference app's global sweep does. No per-conversation
 * grouping needed: `sendMessageWith` reads `entry.conversationId` itself.
 *
 * Safe to run alongside a live `useOutboxReplay` for the same conversation —
 * the RPC is idempotent by nonce (migration 081), so the worst a race can do
 * is one wasted network call, never a duplicate send or a corrupted queue.
 */
export async function drainAllOutbox(queryClient: QueryClient): Promise<void> {
  const entries = readOutbox();
  if (entries.length === 0) {
    return;
  }
  let selfId: string;
  try {
    selfId = await requireUserId();
  } catch {
    // Not signed in (yet, or any more) — nothing to drain against.
    return;
  }
  const { setSending, setBalance, setNotice } = useStore.getState();
  for (const entry of entries) {
    if (entry.attempts >= REPLAY_LIMIT) {
      continue;
    }
    /*
     * Asked again before every entry, never taken from the start of the
     * drain. One send can hang for as long as its RPC does, and a sign-out
     * meanwhile clears the queue (`clearOutbox`) without stopping this loop:
     * the entries it had already read went out one by one under whichever
     * session was stored when each RPC left, the next account's included.
     * An entry no longer queued was cleared (or sent by the open chat's own
     * replay); a session that is no longer the drain's means a different
     * person, or nobody, is signed in now.
     */
    if (!readOutbox().some(queued => queued.nonce === entry.nonce)) {
      continue;
    }
    const current = await requireUserId().catch(() => null);
    if (current !== selfId) {
      return;
    }
    await sendMessageWith(
      {
        queryClient,
        conversationId: entry.conversationId,
        selfId,
        setSending,
        setBalance,
        setNotice,
        openRefill,
      },
      entry.body,
      entry.replyToId,
      { nonce: entry.nonce, createdAt: entry.createdAt },
    );
  }
}

/**
 * The boot-time / foreground-time / reconnect half of X7 (M9 folded in,
 * 2026-09-17 audit): runs `drainAllOutbox` once the app is signed in, again
 * on every return to the foreground, and again the moment the network comes
 * back while the app was already foregrounded the whole time — three moments
 * `useOutboxReplay` cannot cover by itself since it is gated on one
 * conversation's screen being mounted. `ready` is App.tsx's own
 * `boot.phase === 'ready'`, so this never fires ahead of a live session (and
 * never pops the refill sheet over a boot/auth screen a failed replay would
 * otherwise reach for).
 *
 * `onlineManager.subscribe` only calls back on a CHANGE (query-core's own
 * `OnlineManager.setOnline`), so this never drains twice for one reconnect —
 * only the transition into `online` matters here, an `offline` one has
 * nothing to drain against.
 *
 * No cancellation guard on unmount, unlike `useOutboxReplay`: that hook
 * unmounts on every ordinary chat navigation, which this does not — it lives
 * in App.tsx's root, which does not unmount in the running app.
 */
export function useGlobalOutboxDrain(ready: boolean): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!ready) {
      return;
    }
    void drainAllOutbox(queryClient);
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void drainAllOutbox(queryClient);
      }
    });
    const unsubscribeOnline = onlineManager.subscribe(online => {
      if (online) {
        void drainAllOutbox(queryClient);
      }
    });
    return () => {
      sub.remove();
      unsubscribeOnline();
    };
  }, [ready, queryClient]);
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
 * the reference app's `checkUnsentMessages()` (ApplicationLoader.java:259), scoped to
 * one thread rather than run globally at boot: we have no local transcript to
 * replay into, so a queued send is only meaningful once the screen that shows
 * it is open. That is a real difference from the reference app, and it means a queued
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

    /*
     * SEQUENTIAL, not fire-and-forget (2026-09-17 audit).
     *
     * Each replay is independently idempotent, so an interleaved failure
     * genuinely cannot corrupt another — that reasoning was right. What it
     * did not cover is ORDER: `send_message_idempotent` re-stamps
     * `created_at` at the server on every successful call, so three messages
     * typed offline and fired in parallel land in whatever order the network
     * happens to acknowledge them, not the order the member typed them in —
     * and after the next gap-recovery re-sorts by that server timestamp, the
     * member's own conversation reorders itself on their own screen too.
     * Awaiting each entry in turn costs nothing a member notices (this is a
     * queue of a few short strings, not a bulk upload) and makes the
     * replayed order the typed order.
     */
    const drain = async () => {
      for (const entry of pendingFor(conversationId)) {
        if (entry.attempts >= REPLAY_LIMIT) {
          continue;
        }
        if (cancelled) {
          return;
        }
        await sendRef.current(entry.body, entry.replyToId, {
          nonce: entry.nonce,
          createdAt: entry.createdAt,
        });
      }
    };

    void drain();
    const sub = AppState.addEventListener('change', state => {
      if (state === 'active') {
        void drain();
      }
    });
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [conversationId]);
}

/**
 * How many rows one gap page asks for.
 *
 * 50, which is the reference app's own subsequent-page size — they open a chat with 30
 * and page with 50 (ChatActivity.java:3264 and :13811). Deliberately smaller
 * than `PAGE_SIZE`: a gap page is fetched while the member is already looking
 * at the thread, so latency matters more than round trips.
 */
const GAP_PAGE = 50;

/**
 * How many gap pages one recovery will walk before giving up.
 *
 * A bound, not a policy. 20 pages is 1000 messages, past which the honest move
 * is a full refetch rather than an unbounded loop holding the JS thread. It
 * exists because the loop's exit condition depends on the SERVER agreeing that
 * it has run out of rows, and a loop whose termination is somebody else's
 * decision needs a backstop of its own.
 */
const GAP_MAX_PAGES = 20;

/**
 * Fetch everything that arrived after `sinceIso`, oldest-first, one page.
 *
 * Ascending on purpose, unlike `useMessages`: a gap is walked FORWARD from what
 * we already have towards the present, so the cursor advances monotonically and
 * a page boundary cannot skip a row.
 */
async function fetchMessagesSince(
  conversationId: string,
  sinceIso: string,
): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .gt('created_at', sinceIso)
    .order('created_at', { ascending: true })
    .limit(GAP_PAGE);
  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

/**
 * The rows that CHANGED while the socket was down, as opposed to the rows that
 * arrived.
 *
 * `fetchMessagesSince` above can only ever find messages NEWER than the newest
 * one held, because it pages forward on `created_at`. An edit, a soft delete or
 * a read receipt does not move `created_at`: the row keeps the timestamp it was
 * written with, so a message edited or deleted during an outage is invisible to
 * that walk forever. The transcript goes on showing the pre-edit body, or a
 * message the peer deleted, with no error and no spinner. Found by comparing
 * against the reference app on 2026-09-17.
 *
 * the reference app splits the same problem in two and so does this. `getDifference`
 * returns `new_messages` AND `other_updates`, the second carrying
 * `updateEditMessage`, `updateDeleteMessages` and `updateReadHistoryOutbox`
 * (MessagesController.java:17715-17738). We had implemented the first half.
 *
 * Deliberately NOT paged. The forward walk pages because an outage can hide an
 * unbounded number of new messages; the number of OLD messages edited or
 * deleted in the same window is small in any realistic case, so one bounded
 * query is the right shape. If it ever saturates, the caller's existing
 * fall-back to `invalidateQueries` is the correct answer anyway.
 *
 * The cursor is the same `newest` the walk starts from, which over-fetches
 * slightly: a change made BEFORE the outage but after that message was written
 * is re-read. That is harmless. `mergeIncoming` replaces by id, so re-merging a
 * row the cache already holds is a no-op, and over-fetching is the safe
 * direction for a repair path.
 */
async function fetchMessagesChangedSince(
  conversationId: string,
  sinceIso: string,
): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .or(
      `edited_at.gt.${sinceIso},deleted_at.gt.${sinceIso},read_at.gt.${sinceIso}`,
    )
    .order('created_at', { ascending: true })
    .limit(GAP_PAGE);
  if (error) {
    throw new Error(error.message);
  }
  return data ?? [];
}

/**
 * Catch up on everything missed while the socket was down.
 *
 * ---------------------------------------------------------------------------
 * What this replaces, and why the old thing was not enough
 * ---------------------------------------------------------------------------
 * Reconnect used to `invalidateQueries`, which refetches the newest
 * `PAGE_SIZE` (100) rows. That is correct only while fewer than 100 messages
 * arrived during the outage. Past that the OLDEST of the missed messages fall
 * off the end of the page and are never fetched — there is no pagination in the
 * transcript to reach back for them — so they are silently absent. No error, no
 * spinner, just a hole in the conversation.
 *
 * the reference app's answer is a cursor: it pages against `maxMessageId` / `minDate`
 * rather than re-reading a fixed window (ChatActivity.java:13811), and its
 * update layer walks `pts` forward until the server says there is no more
 * (`getDifference`, MessagesController.java:16869). This is the same shape at
 * a much smaller scale: walk forward from the newest row we hold until a page
 * comes back short.
 *
 * ---------------------------------------------------------------------------
 * Why it merges rather than replaces
 * ---------------------------------------------------------------------------
 * `mergeIncoming` is order-independent and idempotent, and it is what settles
 * an optimistic row against its confirmed twin. Replacing the cache wholesale
 * would discard any send still in flight — the exact rows the outbox exists to
 * protect.
 *
 * Falls back to a plain invalidate when the cache is COLD (nothing to page
 * from). A cursor needs a starting point, and "no messages yet" has none.
 */
export async function recoverMessageGap(
  queryClient: QueryClient,
  conversationId: string,
  /*
   * Needed by `mergeIncoming` for the self-send reconciliation: a gap page can
   * legitimately contain a message of MINE that is still sitting in the cache
   * as an optimistic row, and without `selfId` it would be merged as a second
   * bubble beside its own pending twin.
   */
  selfId: string | undefined,
): Promise<void> {
  const key = keys.messages(conversationId);
  const cached = queryClient.getQueryData<TranscriptMessage[]>(key);
  const newest = (cached ?? [])
    .filter(m => !isPending(m))
    .reduce<string | null>(
      (max, m) => (max === null || m.created_at > max ? m.created_at : max),
      null,
    );

  if (newest === null) {
    // Cold cache: no cursor to page from, so the ordinary fetch IS the recovery.
    await queryClient.invalidateQueries({ queryKey: key });
    return;
  }

  /*
   * The other half of the repair, run FIRST so that a transcript showing a
   * deleted message stops showing it even if the forward walk then throws.
   */
  const changed = await fetchMessagesChangedSince(conversationId, newest);
  if (changed.length > 0) {
    queryClient.setQueryData<TranscriptMessage[]>(key, prev => {
      let next = prev ?? [];
      for (const row of changed) {
        next = mergeIncoming(next, row, selfId);
      }
      return next;
    });
  }

  let cursor = newest;
  for (let page = 0; page < GAP_MAX_PAGES; page += 1) {
    const rows = await fetchMessagesSince(conversationId, cursor);
    if (rows.length === 0) {
      return;
    }
    queryClient.setQueryData<TranscriptMessage[]>(key, prev => {
      let next = prev ?? [];
      for (const row of rows) {
        next = mergeIncoming(next, row, selfId);
      }
      return next;
    });
    const last = rows[rows.length - 1];
    if (last === undefined || rows.length < GAP_PAGE) {
      return;
    }
    cursor = last.created_at;
  }
  /*
   * Twenty pages and still more: the device was away long enough that walking
   * is no longer the cheap option. Fall back to the fixed window, which is what
   * the old code always did — the difference is that this is now the LAST
   * resort rather than the only strategy.
   */
  await queryClient.invalidateQueries({ queryKey: key });
}
