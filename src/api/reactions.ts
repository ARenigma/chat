/**
 * Reactions: read the rows, toggle one.
 *
 * There is no client write path to `message_reactions` at all, the table has a
 * SELECT policy and nothing else, and that is deliberate rather than an
 * oversight. A reaction lands in the other person's transcript and lights up
 * their device, so it is contact, and contact has to be gated on blocking.
 * `is_blocked_pair` is `SECURITY DEFINER` with no grant to anybody, so an RLS
 * policy (which runs as the caller) cannot consult it. Hence one RPC, which is
 * the same argument that keeps sending behind `send_message`.
 *
 * `toggle_reaction` returns the resulting emoji rather than void, because which of
 * add, replace and remove happened is not derivable from the arguments.
 */
import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { MessageReaction, ReactionEmoji, ReactionResult } from '../lib/database.types';
import { errorTick, tick } from '../lib/haptics';
import { track } from '../lib/telemetry';
import { useStore } from '../store/useStore';

/** Private: the two consumers are both in this file. */
const reactionsKey = (conversationId: string) =>
  ['reactions', conversationId] as const;

const NOTICE: Record<string, string> = {
  BLOCKED: 'You can no longer message each other.',
  SUSPENDED: 'Your account is under review.',
  FORBIDDEN: 'That conversation is not available.',
  NOT_FOUND: 'That message no longer exists.',
  BAD_REQUEST: 'That reaction could not be added.',
  UNAUTHORIZED: 'Session expired. Reopen the app to continue.',
};

/**
 * Every reaction on the loaded page of a transcript.
 *
 * Filtered by message id rather than trusting RLS to scope it: the policy limits
 * the caller to conversations they are in, which is *all* of their threads, and
 * fetching every reaction the user can see in order to render one screen is the
 * kind of query that is fine until somebody has forty conversations.
 *
 * Keyed on the conversation, not on the id list, so opening a thread does not
 * refetch every time a message arrives and lengthens the list.
 */
export function useReactions(conversationId: string | undefined, messageIds: readonly string[]) {
  return useQuery<MessageReaction[]>({
    queryKey: reactionsKey(conversationId ?? ''),
    enabled: conversationId !== undefined && messageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('message_reactions')
        .select('*')
        .in('message_id', messageIds as string[]);
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    staleTime: 10_000,
  });
}

/**
 * Add, replace or remove the caller's reaction on one message.
 *
 * No optimistic update, and that is a decision rather than laziness. The
 * optimistic row in the send path exists because a message must appear on the
 * same frame as the keypress, a bubble that lags is the whole feel of the
 * product. A reaction is applied from a modal sheet that is dismissing anyway, so
 * the round trip is hidden behind the dismissal, and an optimistic tally would
 * have to model all three outcomes (add, replace, remove) and then unwind the
 * right one on a BLOCKED.
 */
export function useToggleReaction(conversationId: string | undefined) {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useCallback(
    async (messageId: string, emoji: ReactionEmoji): Promise<void> => {
      if (conversationId === undefined) {
        return;
      }
      tick();
      const { data, error } = await supabase.rpc('toggle_reaction', {
        p_message_id: messageId,
        p_emoji: emoji,
      });
      const result: ReactionResult | null = error ? null : data;

      if (result === null || !result.success) {
        const code = result?.error;
        setNotice(
          code !== undefined
            ? NOTICE[code] ?? 'That reaction could not be added.'
            : 'Could not react. Check your connection.',
        );
        errorTick();
        return;
      }

      // `emoji: null` is the take-back, and it is the half worth counting: it is
      // the closest thing the product has to a regret signal.
      track(result.emoji === null ? 'reaction_removed' : 'reaction_added');
      void queryClient.invalidateQueries({ queryKey: reactionsKey(conversationId) });
    },
    [conversationId, queryClient, setNotice],
  );
}
