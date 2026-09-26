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
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { reportSwallowed } from '../lib/sentry';
import { track } from '../lib/telemetry';
import { keys, useConversationId } from './chat';
import { useStore } from '../store/useStore';
import { usageKeys } from './usage';
import { providerKeys } from './provider';
import { openWallet } from '../lib/routes/actions';

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
  /** Ended chat sessions, for the "Session ended" transcript system rows. */
  events: (conversationId: string) =>
    ['session', 'events', conversationId] as const,
  /** 082: has the member declined a session here? */
  consent: (conversationId: string) =>
    ['session', 'consent', conversationId] as const,
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
      /*
       * THE WALLET. `meter_active_sessions` debits a minute and writes
       * `minutes_billed` / `next_bill_at` back to `paid_sessions` in the same
       * transaction, so this channel already fires once per billed minute — and
       * again on settlement. Invalidating the profile here is therefore the
       * balance following the money that actually moved, with no extra polling.
       *
       * Without it the number never moved. `useProfile` has a 15s staleTime, no
       * refetchInterval, and `refetchOnWindowFocus` is off globally, and NO
       * channel subscribed to `profiles` — so a mounted screen showed the
       * balance from the moment it mounted until the app was restarted or a
       * top-up invalidated it. Amit, from a device 2026-09-08: "Wallet not
       * updating not after session".
       */
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
      // Settlement hides all session content server-side (migration 045). The
      // party that did not call end_session only learns via this session-state
      // channel, so refetch the transcript here too: RLS now returns nothing for
      // the hidden rows, clearing the chat for BOTH participants. A refetch
      // mid-session is cheap and returns the same visible rows.
      void queryClient.invalidateQueries({
        queryKey: ['messages', conversationId],
      });
      /*
       * Settlement fan-out — everything that changes the moment a paid session
       * ends (Amit, 2026-09-20: "session end/start should update in real time
       * both sides on chat screen, usage, billing, invoices etc").
       *
       * session events: the "Chat · N min · HH:MM" system row in the transcript
       * calls: call log rows in the transcript
       * usage-ledger: the per-session usage screen
       * provider-earnings: the provider header pill and home KPIs
       */
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.events(conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: ['calls', conversationId] });
      void queryClient.invalidateQueries({ queryKey: usageKeys.ledger });
      void queryClient.invalidateQueries({ queryKey: providerKeys.earnings });
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
        // CHANNEL_ERROR / TIMED_OUT as well as SUBSCRIBED: the same omission as
        // in realtime.ts, and worse here, because the state this channel
        // carries is whether a paid session is running. A channel that fails
        // without ever resubscribing would leave the screen believing a session
        // is live — or absent — indefinitely.
        if (
          status === 'SUBSCRIBED' ||
          status === 'CHANNEL_ERROR' ||
          status === 'TIMED_OUT'
        ) {
          invalidate();
        }
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
  /**
   * When this direction may ring again. Returned with `reason: 'cooldown'`
   * (068:118) and dropped by this type until 2026-09-17, which is why nothing
   * could render "again in 12m": the one field that makes a persistent
   * "Notified" honest was being parsed away.
   */
  cooldown_until?: string | null;
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

/**
 * The same RPC as an ACTION rather than a report.
 *
 * `useAnnounceChatOpen` above cannot drive a button and was never meant to: it
 * is a mount effect with one `ChatOpenAlert | null` behind it, and its `.then`
 * returns early on `error || data === null` recording nothing, so `null` means
 * in flight AND failed AND never ran. A control needs the three apart.
 *
 * The error is THROWN, and reported on the way past. This path had no Sentry
 * call site at all, which is how a "Notify" button that never called the RPC
 * shipped and stayed invisible.
 */
export function useNotifyPeer(conversationId: string | undefined) {
  return useMutation<ChatOpenAlert, Error, void>({
    mutationFn: async () => {
      if (conversationId === undefined) {
        throw new Error('No conversation to announce');
      }
      const { data, error } = await supabase.rpc('announce_chat_open', {
        p_conversation_id: conversationId,
      });
      if (error) {
        reportSwallowed('announceChatOpen', error);
        throw error;
      }
      if (data === null || data === undefined) {
        const empty = new Error('announce_chat_open returned no answer');
        reportSwallowed('announceChatOpen', empty);
        throw empty;
      }
      return data as unknown as ChatOpenAlert;
    },
  });
}

/**
 * What the away control shows. One vocabulary for both surfaces that draw it.
 *
 * `notified` is the ONLY state that claims the peer knows, and it is reachable
 * from exactly the two answers that earn the claim: a push was dispatched
 * (`alerted`), or one was dispatched recently enough that the server refused to
 * send a second (`cooldown`). That is migration 068's honesty rule
 * ("Returns alerted=true ONLY when a push was actually dispatched, because the
 * 'we have notified them' banner is built from this answer") applied to a
 * button instead of a banner.
 */
export type NotifyState =
  | { kind: 'idle' }
  | { kind: 'pending' }
  | { kind: 'notified'; cooldownUntil: string | null }
  | { kind: 'present' };

export interface NotifyAction {
  state: NotifyState;
  notify: () => void;
}

/**
 * Whole minutes until `iso`, for "again in 12m". Null when there is nothing to
 * count to, which is every outcome except a cooldown.
 */
export function minutesUntil(iso: string | null | undefined): number | null {
  if (iso === undefined || iso === null) {
    return null;
  }
  const ms = Date.parse(iso) - Date.now();
  if (Number.isNaN(ms) || ms <= 0) {
    return null;
  }
  return Math.max(1, Math.ceil(ms / 60_000));
}

const IDLE: NotifyState = { kind: 'idle' };

/**
 * The cooldown 068 enforces, mirrored on the client so a RESTORED "Notified"
 * can expire on its own.
 *
 * It is the server's own fallback: both 068:111 and 111:119 read
 * `chat_open_alert_cooldown_minutes` from the admin `thresholds` domain and
 * `coalesce(..., 30)`. The number is not authoritative here and does not need
 * to be — it only decides how long a restored state is DRAWN. Every claim the
 * control makes about the server is still settled by the server: the restored
 * state stays tappable, and the first tap answers `cooldown` with the real
 * `cooldown_until` (or actually alerts, if the admin window is shorter than
 * this one).
 *
 * `thresholds` does not carry this key in `ThresholdsConfig` yet; threading it
 * through `useThresholdsConfig` is the honest fix and is reported as a
 * cross-file need rather than guessed at here.
 */
const NOTIFY_COOLDOWN_MINUTES = 30;

/**
 * When each provider was last told this member opened their chat.
 *
 * One query for the whole directory rather than one per row: every away card
 * mounts `useNotifyProvider`, and a per-row read would be a request per
 * stranger scrolled past.
 */
const notifyKeys = {
  lastAlerted: ['notify', 'last-alerted'] as const,
};

/**
 * PostgREST returns a one-to-one embed as an object and a one-to-many as an
 * array, and which one it picks depends on its reading of the constraint
 * rather than on anything stated here, so both are accepted.
 */
type ThreadAlertMeta = { provider_alerted_at: string | null };
interface ThreadAlertRow {
  provider_id: string;
  conversation_thread_meta: ThreadAlertMeta | ThreadAlertMeta[] | null;
}

function alertedAtOf(row: ThreadAlertRow): string | null {
  const meta = row.conversation_thread_meta;
  if (meta === null || meta === undefined) {
    return null;
  }
  if (Array.isArray(meta)) {
    return meta[0]?.provider_alerted_at ?? null;
  }
  return meta.provider_alerted_at;
}

/**
 * The honest answer to "have I already rung this bell", read WITHOUT ringing it.
 *
 * `announce_chat_open` cannot be asked: it is the sender, and calling it to
 * discover its own state either burns the cooldown it was meant to report or
 * sends the very push the member is trying not to send twice. What it leaves
 * behind can be read instead — 068:131-140 upserts
 * `conversation_thread_meta.provider_alerted_at` in the same transaction as the
 * dispatch, so that column IS the record of the push, and it is readable by the
 * member under the "Participants read thread meta" policy (030:280-292).
 *
 * `conversations` is read directly rather than through `open_conversation`,
 * which CREATES the thread on first call (api/chat.ts): resolving a
 * conversation id per row in order to look up a timestamp would mint a
 * conversation with everyone in the directory. A row that does not exist is a
 * provider who has never been notified, which is the same answer.
 */
async function readLastAlerted(): Promise<Record<string, string>> {
  // Neither `conversations` embeds nor `conversation_thread_meta` are in the
  // generated types; same cast as the other table reads in this file.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = (await (supabase as any)
    .from('conversations')
    .select('provider_id, conversation_thread_meta(provider_alerted_at)')) as {
    data: ThreadAlertRow[] | null;
    error: { message: string } | null;
  };
  if (error) {
    throw new Error(error.message);
  }
  const byProvider: Record<string, string> = {};
  for (const row of data ?? []) {
    const at = alertedAtOf(row);
    if (at !== null) {
      byProvider[row.provider_id] = at;
    }
  }
  return byProvider;
}

function cooldownEndsAt(alertedAt: string | undefined): string | null {
  if (alertedAt === undefined) {
    return null;
  }
  const at = Date.parse(alertedAt);
  if (Number.isNaN(at)) {
    return null;
  }
  return new Date(at + NOTIFY_COOLDOWN_MINUTES * 60_000).toISOString();
}

/**
 * The state a cold start begins in, which used to be `idle` and was a lie.
 *
 * Force-stop and relaunch left the control reading "Notify" for a provider who
 * had just been notified, so the member tapped again, the server swallowed the
 * second tap on the cooldown, and they believed they had pinged twice when the
 * provider had been pinged once (found on the S22, 2026-09-17).
 *
 * Null once the window has passed, so the claim cannot outlive the cooldown
 * that makes it true. The timers exist because nothing else would re-render at
 * that moment: the interval keeps "again in NNm" honest while a surface stays
 * open, and the timeout lands on expiry itself. Both are armed only for a
 * provider who actually has a live cooldown, so a directory of strangers arms
 * none.
 */
function useRestoredNotifyState(providerId: string): NotifyState | null {
  const selectForProvider = useCallback(
    (rows: Record<string, string>) => cooldownEndsAt(rows[providerId]),
    [providerId],
  );
  const { data: cooldownUntil } = useQuery({
    queryKey: notifyKeys.lastAlerted,
    queryFn: readLastAlerted,
    staleTime: 60_000,
    select: selectForProvider,
  });
  const [, setTick] = useState(0);

  useEffect(() => {
    if (cooldownUntil === null || cooldownUntil === undefined) {
      return;
    }
    const remaining = Date.parse(cooldownUntil) - Date.now();
    if (remaining <= 0) {
      return;
    }
    const minute = setInterval(() => setTick(n => n + 1), 60_000);
    const expiry = setTimeout(() => setTick(n => n + 1), remaining + 1_000);
    return () => {
      clearInterval(minute);
      clearTimeout(expiry);
    };
  }, [cooldownUntil]);

  if (
    cooldownUntil === null ||
    cooldownUntil === undefined ||
    Date.parse(cooldownUntil) <= Date.now()
  ) {
    return null;
  }
  return { kind: 'notified', cooldownUntil };
}

interface NotifyMachine {
  /**
   * Which provider this state belongs to. FlashList RECYCLES a row's component
   * instance under a different item, so state that does not name its subject
   * would show one stranger's "Notified" on another stranger's card.
   */
  forId: string;
  /** Which tap produced it, so a second tap re-fires and a re-render does not. */
  attempt: number;
  state: NotifyState;
}

/**
 * Notify this provider WITHOUT leaving the surface the member is on.
 *
 * the reference app's own in-place notify toggle is the shape:
 * `toggleScheduledNotify()` (FragmentContextView.java:2770-2792) fires the
 * request from the control the finger is on and then says what happened, rather
 * than navigating somewhere to say it. Ours did the opposite: both away controls
 * routed into the chat, so the RPC only ran from the chat's mount effect and
 * the surface that would have shown "Notified" unmounted on the tap that earned
 * it.
 *
 * ONE STATED DEPARTURE from that reference. the reference app flips its local flag
 * BEFORE the server answers (`schedule_start_subscribed = willBeNotified =
 * !willBeNotified`, :2781). We cannot: our server refuses for six different
 * reasons and only two of them mean a push went out, so an optimistic flip
 * would be a claim that the peer knows when nobody has been told. The state
 * moves on the answer, never on the tap.
 *
 * The conversation is resolved LAZILY, on the tap, because `open_conversation`
 * creates the thread on first call (src/api/chat.ts:190-206) — arming it per
 * row would mint a conversation with everyone the member scrolled past.
 *
 * THE STATE SURVIVES A COLD START, from the server rather than from a local
 * flag. See `useRestoredNotifyState`.
 */
export function useNotifyProvider(providerId: string): NotifyAction {
  const setNotice = useStore(s => s.setNotice);
  const queryClient = useQueryClient();
  const [machine, setMachine] = useState<NotifyMachine>({
    forId: providerId,
    attempt: 0,
    state: IDLE,
  });
  const mine = machine.forId === providerId;
  const local = mine ? machine.state : IDLE;
  const restored = useRestoredNotifyState(providerId);
  /*
   * THE SERVER ANSWERS FIRST, AND ONLY UNTIL THIS MEMBER TAPS.
   *
   * `attempt > 0` is what separates "not tapped yet" from "tapped and settled
   * back to idle", and the two must not share an answer: a tap that came back
   * `no_balance` or `peer_present` has just told the member something, and a
   * restored "Notified" arriving on top of it would overwrite the reply to
   * their own action with a fact about an older one. Before the first tap there
   * is nothing to overwrite, and the server's record is the only honest state.
   *
   * A recycled FlashList cell lands here with `mine` false, so `attempt` is 0
   * and the new provider's own restored state applies — the same guard that
   * keeps one stranger's "Notified" off another stranger's card.
   */
  const state = local.kind === 'idle' && (!mine || machine.attempt === 0)
    ? restored ?? IDLE
    : local;

  /*
   * Armed from `local`, NOT from `state`. `useConversationId` calls
   * `open_conversation`, which creates the thread on first call, so arming it
   * from a restored state would mint a conversation for every previously
   * notified provider the moment the directory rendered.
   */
  const conversation = useConversationId(local.kind === 'idle' ? null : providerId);
  const conversationId = conversation.data;
  const notifyPeer = useNotifyPeer(conversationId);
  const { mutate } = notifyPeer;

  /** The tap already answered, so a re-render cannot ring the doorbell twice. */
  const firedRef = useRef('');
  /**
   * When the current tap happened, so a RETRY is not failed by its predecessor.
   * A conversation lookup that errors stays errored in the cache, and re-arming
   * it shows `isError` for the renders before the refetch starts — long enough
   * to report a failure that has not happened yet. `errorUpdatedAt` is when the
   * cached error was recorded, so comparing the two asks the only question that
   * matters: did THIS attempt fail.
   */
  const armedAtRef = useRef(0);
  const lookupFailed =
    conversation.isError && conversation.errorUpdatedAt >= armedAtRef.current;
  const attempt = mine ? machine.attempt : 0;

  useEffect(() => {
    if (local.kind !== 'pending') {
      return;
    }
    const ticket = `${providerId}:${attempt}`;
    if (firedRef.current === ticket) {
      return;
    }
    const settle = (next: NotifyState) => {
      setMachine({ forId: providerId, attempt, state: next });
    };
    if (lookupFailed) {
      firedRef.current = ticket;
      setNotice('Could not notify them. Try again.');
      settle(IDLE);
      return;
    }
    if (conversationId === undefined) {
      return;
    }
    firedRef.current = ticket;
    mutate(undefined, {
      onSuccess: alert => {
        if (alert.alerted) {
          // The push 068 just recorded in `provider_alerted_at` is what a later
          // cold start reads back, so the cached copy of that column has to go.
          void queryClient.invalidateQueries({ queryKey: notifyKeys.lastAlerted });
          settle({ kind: 'notified', cooldownUntil: alert.cooldown_until ?? null });
          return;
        }
        switch (alert.reason) {
          case 'cooldown':
            // Still the truth: a push went out inside the cooldown window, so
            // the peer HAS been told. The only new fact is when we may tell
            // them again.
            settle({ kind: 'notified', cooldownUntil: alert.cooldown_until ?? null });
            break;
          case 'peer_present':
            // They came back between the directory read and this tap. The
            // control stops offering a doorbell for someone standing in the
            // room, and the directory re-reads so its dot agrees.
            settle({ kind: 'present' });
            void queryClient.invalidateQueries({ queryKey: keys.providers });
            break;
          case 'in_session':
            setNotice('Busy right now. Try again in a minute.', 'confirm');
            settle(IDLE);
            break;
          case 'no_balance':
            // The one refusal the member can act on, so it routes instead of
            // explaining.
            setNotice('Top up to notify them.', 'confirm');
            openWallet();
            settle(IDLE);
            break;
          default:
            /*
             * not_configured, forbidden, not_found, unauthorized, and anything
             * a later migration adds. Every one of them means NOBODY WAS TOLD,
             * so the control goes back to offering the action and says so
             * rather than sitting on a silent "Notified".
             *
             * the reference app turns a refusal it has no specific words for into a
             * visible bulletin too, and names the single code it stays quiet
             * for rather than staying quiet by default:
             * BulletinFactory.java:100-113 (`else if (error.code != 406)`).
             */
            setNotice('Could not notify them. Try again.');
            settle(IDLE);
        }
      },
      onError: () => {
        setNotice('Could not notify them. Try again.');
        settle(IDLE);
      },
    });
  }, [
    local.kind,
    attempt,
    providerId,
    conversationId,
    lookupFailed,
    mutate,
    setNotice,
    queryClient,
  ]);

  const notify = useCallback(() => {
    armedAtRef.current = Date.now();
    setMachine(current => ({
      forId: providerId,
      attempt: (current.forId === providerId ? current.attempt : 0) + 1,
      state: { kind: 'pending' },
    }));
  }, [providerId]);

  return { state, notify };
}

/** A chat request ringing at the provider right now (goal item 13). */
export interface IncomingChatRequest {
  requestId: string;
  conversationId: string;
  /** The member who asked. Members have no directory row, so this is all we get. */
  initiatorId: string;
  expiresAt: string;
  /** Server `created_at`: the same instant as the message that opened it (077). */
  createdAt?: string;
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
        .select('id, conversation_id, initiator_id, expires_at, created_at')
        .eq('recipient_id', selfId as string)
        .eq('channel', 'chat')
        .eq('status', 'pending')
        // Not one already answered: a provider's Accept (086) or send (077)
        // sets only `responded_at`, and the request stays `pending` until
        // the member confirms, so every resubscribe rang it again.
        .is('responded_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()) as {
        data: { id: string; conversation_id: string; initiator_id: string; expires_at: string; created_at?: string } | null;
        error: unknown;
      };
      // Best-effort recovery of a request that arrived while the socket was down;
      // a persistent failure means silently missed chat requests. (2026-09-10 audit)
      if (result.error) {
        reportSwallowed('recoverPending', result.error);
        return;
      }
      if (result.data) {
        onIncoming({
          requestId: result.data.id,
          conversationId: result.data.conversation_id,
          initiatorId: result.data.initiator_id,
          expiresAt: result.data.expires_at,
          createdAt: result.data.created_at,
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
            created_at?: string;
          };
          if (row.channel === 'chat' && row.status === 'pending') {
            onIncoming({
              requestId: row.id,
              conversationId: row.conversation_id,
              initiatorId: row.initiator_id,
              expiresAt: row.expires_at,
              createdAt: row.created_at,
            });
          }
        },
      )
      .subscribe(status => {
        // CHANNEL_ERROR / TIMED_OUT as well as SUBSCRIBED (2026-09-17
        // audit) — the same repair the sibling channel above (line ~146)
        // already has, extended to the one that carries an incoming chat
        // request: a reconnect that never repairs is a missed request with
        // no second announcement once it expires server-side.
        if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
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
      refetchAfterDecline(queryClient, conversationId);
    },
  });
}

/**
 * What a landed Decline changes on screen, refetched. Shared by the in-app
 * Decline (`useDeclineSessionRequest`) and the notification's, which runs as
 * a headless task outside any tree and reaches a mounted one by event
 * (`declineFromNotification`, App.tsx). An empty id refetches the list only.
 */
export function refetchAfterDecline(queryClient: QueryClient, conversationId: string): void {
  if (conversationId !== '') {
    void queryClient.invalidateQueries({
      queryKey: sessionKeys.pendingRequest(conversationId),
    });
    // 082 sets the conversation-level flag in the same RPC, so the flag's
    // query has to be refetched or the screen keeps its stale "not declined".
    void queryClient.invalidateQueries({
      queryKey: sessionKeys.consent(conversationId),
    });
  }
  void queryClient.invalidateQueries({ queryKey: ['conversation-list'] });
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
      // Settlement fan-out: usage screen, provider earnings, profile balance.
      void queryClient.invalidateQueries({ queryKey: usageKeys.ledger });
      void queryClient.invalidateQueries({ queryKey: providerKeys.earnings });
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
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

/** One ended chat session, rendered as a "Session ended" system row. */
export interface SessionEvent {
  id: string;
  started_at: string | null;
  ended_at: string;
  minutes_billed: number;
}

/**
 * Ended CHAT sessions in a conversation, for the "Session ended · N min" system
 * rows the transcript interleaves like call logs. Call (audio/video) sessions are
 * excluded — those already render as CallLogRow, and emitting a system row too
 * would double the same event. Scoped by the "Participants read own sessions"
 * RLS policy (migration 030).
 */
export function useSessionEvents(conversationId: string | undefined) {
  return useQuery<SessionEvent[]>({
    queryKey: sessionKeys.events(conversationId ?? ''),
    enabled: conversationId !== undefined,
    staleTime: 15_000,
    queryFn: async () => {
      if (!conversationId) return [];
      // paid_sessions is not in the generated types (queried via RPC elsewhere);
      // cast the table read like the other untyped queries here.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = (await (supabase as any)
        .from('paid_sessions')
        .select('id, started_at, ended_at, minutes_billed')
        .eq('conversation_id', conversationId)
        .eq('channel', 'chat')
        .eq('status', 'ended')
        .not('ended_at', 'is', null)
        .order('ended_at', { ascending: false })
        .limit(50)) as { data: SessionEvent[] | null; error: { message: string } | null };
      if (error) throw new Error(error.message);
      return data ?? [];
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
 * How long a backgrounded TEXT session survives before it is ended.
 *
 * 30 s, matching the server's lease grace (migration 030) rather than being
 * chosen: if the two disagreed, the shorter would win silently and the longer
 * would be dead code. Heartbeats stop the instant the app backgrounds, so this
 * window is billed to nobody — it only decides whether the session is still
 * there when the member comes straight back.
 */
const BACKGROUND_GRACE_MS = 30_000;

/**
 * Sends foreground lease heartbeats while the component is mounted and the app
 * is in the foreground. Stops immediately on background.
 *
 * Mount this in the chat screen while an active session is running. Unmounting or
 * backgrounding triggers the server-side 30 s grace window, then the session
 * ends automatically. The hook is a no-op when `sessionId` is null.
 */
export function useSessionLease(
  session: Pick<PaidSession, 'id' | 'channel'> | null,
  kind: 'foreground' | 'connected' = 'foreground',
): void {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /*
   * The pending end-of-session from a background transition. A ref, not state:
   * nothing renders from it, and it must survive re-renders without restarting
   * the grace window.
   */
  const backgroundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Consecutive heartbeat failures. One miss is nothing (the server has a 30s
  // grace); a run of them means the client may be showing a session the server
  // already ended, so we force a re-sync once it crosses the threshold.
  const heartbeatFailuresRef = useRef(0);
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
      heartbeatFailuresRef.current = 0;
      // If the server signals the session has ended (e.g. balance exhausted),
      // invalidate so the chat screen picks up the new status.
      if (data === 'ended') {
        void queryClient.invalidateQueries({ queryKey: ['session'] });
      }
    } catch (err) {
      // A single miss is non-fatal: the server expires the lease after the 30 s
      // grace if heartbeats stop. But a SUSTAINED failure would leave the client
      // showing a session the server has already ended, so after three
      // consecutive misses force a re-sync of the session status rather than
      // trusting the local "active" state indefinitely. (2026-09-10 audit)
      heartbeatFailuresRef.current += 1;
      if (heartbeatFailuresRef.current >= 3) {
        heartbeatFailuresRef.current = 0;
        reportSwallowed('sessionHeartbeat', err);
        void queryClient.invalidateQueries({ queryKey: ['session'] });
      }
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

    /*
     * Backgrounding a text session: heartbeats stop at once, but the session is
     * ended only after a GRACE WINDOW.
     *
     * This used to call `end_session` synchronously on the first non-active
     * AppState event, which meant glancing at a notification, taking a
     * screenshot, or the OS briefly reporting `inactive` terminated a paid
     * conversation outright, with no way back into it. Amit, 2026-09-08:
     * a grace window matching the server's.
     *
     * `BACKGROUND_GRACE_MS` is 30 s deliberately — the same window the server
     * applies to an expired lease (migration 030). Two different numbers here
     * would mean the client and the server disagreed about when a session was
     * over, and the shorter one would silently win.
     *
     * Heartbeats stop IMMEDIATELY regardless, so nothing is billed for time the
     * member was away: if they never come back, the server's own lease expiry
     * ends the session on exactly the same schedule this timer would have. The
     * grace window costs no tokens; it only decides whether the session is
     * still there when they return within it.
     *
     * Connected calls are exempt and keep heartbeating — CallForegroundService
     * keeps them alive, so the text-session rule does not apply.
     * https://developer.android.com/develop/background-work/services/fgs/service-types#phone-call
     */
    const subscription =
      channel === 'chat'
        ? AppState.addEventListener('change', (state: AppStateStatus) => {
            if (state !== 'active') {
              stop();
              if (backgroundTimerRef.current === null) {
                backgroundTimerRef.current = setTimeout(() => {
                  backgroundTimerRef.current = null;
                  void supabase
                    .rpc('end_session', {
                      p_session_id: sessionId,
                      p_end_reason: 'background',
                      p_report_reason: null,
                      p_report_message_ids: null,
                      p_report_statement: null,
                    })
                    .then(({ error }) => {
                      // The server's own lease expiry ends the session on the
                      // same schedule if this call fails, so it is safe to let it
                      // go — but a persistent failure here is worth seeing rather
                      // than swallowing. (2026-09-10 audit)
                      if (error) reportSwallowed('endSessionBackground', error);
                    });
                }, BACKGROUND_GRACE_MS);
              }
            } else {
              // Back inside the window: cancel the pending end and resume.
              if (backgroundTimerRef.current !== null) {
                clearTimeout(backgroundTimerRef.current);
                backgroundTimerRef.current = null;
              }
              start();
            }
          })
        : null;

    return () => {
      stop();
      /*
       * Cancel a pending background end on unmount rather than letting it fire.
       * Unmount means the screen was left — which has its own end path — and a
       * stray timer would call `end_session` for a session that may already have
       * been ended, or worse, one the member has since resumed.
       */
      if (backgroundTimerRef.current !== null) {
        clearTimeout(backgroundTimerRef.current);
        backgroundTimerRef.current = null;
      }
      subscription?.remove();
    };
  }, [sessionId, channel, sendHeartbeat]);
}

/**
 * Whether the member has declined a paid session in this conversation (082).
 *
 * A separate query from `usePendingSessionRequest` because it answers the
 * question that one CANNOT: after a decline nothing is pending, so that hook
 * returns null and the screen cannot tell "declined" from "never asked". That
 * ambiguity was the bug — the prompt came back on every exchange.
 */
export function useChatConsent(conversationId: string | undefined) {
  return useQuery<{ declined: boolean }>({
    queryKey: sessionKeys.consent(conversationId ?? ''),
    enabled: conversationId !== undefined,
    staleTime: 10_000,
    queryFn: async () => {
      if (!conversationId) return { declined: false };
      const { data, error } = await supabase.rpc('get_chat_consent', {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
      const row = data as { declined?: boolean } | null;
      return { declined: row?.declined === true };
    },
  });
}

/**
 * The member reverses their own decline, and starts the session if the provider
 * is already waiting.
 *
 * Two RPCs rather than one, deliberately: `resume_chat_consent` reports whether
 * a joined request exists, and only then is `confirm_chat_session` called. The
 * alternative — one server function that clears and confirms — would mean the
 * member tapping "Start session" could be billed in the same call that cleared
 * a flag, with no chance for the client to surface the balance check that
 * `confirm_chat_session` performs.
 */
export function useResumeChatConsent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ conversationId }: { conversationId: string }) => {
      const { data, error } = await supabase.rpc('resume_chat_consent', {
        p_conversation_id: conversationId,
      });
      if (error) throw error;
      const row = data as { request_id?: string | null } | null;
      const requestId = row?.request_id ?? null;
      if (requestId !== null) {
        // The provider already joined while we were declined, so there is a
        // request to confirm rather than a conversation to restart.
        const { error: confirmError } = await supabase.rpc('confirm_chat_session', {
          p_request_id: requestId,
        });
        if (confirmError) throw confirmError;
      }
      return { started: requestId !== null };
    },
    onSuccess: (_r, { conversationId }) => {
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.consent(conversationId),
      });
      void queryClient.invalidateQueries({
        queryKey: sessionKeys.pendingRequest(conversationId),
      });
      void queryClient.invalidateQueries({ queryKey: sessionKeys.active(conversationId) });
    },
  });
}
