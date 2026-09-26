/**
 * The sequential automated-opener loop, and the only copy of it in the V2
 * slice.
 *
 * Shows the peer typing, waits a bounded length-aware beat, inserts exactly
 * one opener, refreshes the two queries it invalidated, pauses, repeats. The
 * server owns idempotence (`insert_next_opener` holds a per-conversation row
 * lock and a count cursor), so a remount or a process interruption cannot
 * duplicate a greeting; what this owes is a loop that stops — on unmount, on
 * the first refusal, and on the step that reports itself done.
 *
 * Everything decidable without a round trip is decided by `openers.ts` and
 * asserted there as values. This file is the effect: a timer, an RPC and a
 * cancellation flag.
 */
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useStore } from '../store/useStore';
import { CHAT_V2_OPENER_PAUSE_MS, chatV2OpenerBeat } from './openers';

/** One step of `insert_next_opener`, as migration 045 returns it. */
interface OpenerStep {
  conversation_id: string;
  inserted: boolean;
  done: boolean;
  /** The body of the opener the NEXT step will insert, for the beat's length. */
  next_body: string | null;
}

export function useChatV2Openers(input: {
  /** The PEER's profile id, which is what the RPC takes. */
  providerId: string;
  /** `chatV2OwnsOpeners` — this screen, this side, this thread. */
  enabled: boolean;
  /**
   * The thread the simulated typing belongs to, so the indicator is tagged
   * like a real one and cannot light another mounted chat (nav step 6).
   */
  conversationId?: string;
}): void {
  const { providerId, enabled, conversationId } = input;
  const queryClient = useQueryClient();
  const setPeerActivity = useStore(s => s.setPeerActivity);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    let cancelled = false;
    /*
     * The pending timer is tracked so the cleanup can clear it immediately
     * rather than waiting for it to fire. Without this, an unmount during a
     * wait leaves a live handle that resolves into a gone component, and the
     * promise never unblocks, so the loop leaks until GC.
     */
    let pendingTimer: ReturnType<typeof setTimeout> | undefined;
    const wait = (ms: number) =>
      new Promise<void>(resolve => {
        pendingTimer = setTimeout(() => {
          pendingTimer = undefined;
          resolve();
        }, ms);
      });

    void (async () => {
      // Null on the first step: nothing is known about what is coming, so the
      // beat is the floor rather than a guess.
      let upcoming: string | null = null;
      for (;;) {
        if (cancelled) {
          break;
        }
        setPeerActivity('typing', conversationId);
        await wait(chatV2OpenerBeat(upcoming));
        if (cancelled) {
          break;
        }
        const { data, error } = await supabase.rpc('insert_next_opener', {
          p_provider_id: providerId,
        });
        setPeerActivity(null, conversationId);
        if (cancelled || error || data === null) {
          break;
        }
        const step = data as OpenerStep;
        void queryClient.invalidateQueries({
          queryKey: ['messages', step.conversation_id],
        });
        void queryClient.invalidateQueries({ queryKey: ['conversation-list'] });
        if (!step.inserted || step.done) {
          break;
        }
        upcoming = step.next_body;
        await wait(CHAT_V2_OPENER_PAUSE_MS);
      }
    })();

    return () => {
      cancelled = true;
      if (pendingTimer !== undefined) {
        clearTimeout(pendingTimer);
        pendingTimer = undefined;
      }
      // The indicator belongs to this loop. Leaving it set would have the peer
      // typing forever on a screen that has gone.
      setPeerActivity(null, conversationId);
    };
  }, [enabled, providerId, conversationId, queryClient, setPeerActivity]);
}
