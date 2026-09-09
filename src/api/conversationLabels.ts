/**
 * Private per-conversation custom names ("rename chat").
 *
 * A label is visible only to the person who set it (migration 098 RLS), so it is
 * resolved CLIENT-side: the inbox and chat header show `label ?? peer_display_name`
 * rather than baking the override into the shared `conversation_summaries` view.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { keys } from './chat';

export const labelKeys = {
  all: ['conversation-labels'] as const,
};

interface LabelRow {
  conversation_id: string;
  custom_name: string;
}

/** The caller's own labels, as a `conversationId -> customName` map. */
export function useConversationLabels() {
  return useQuery<Map<string, string>>({
    queryKey: labelKeys.all,
    queryFn: async () => {
      // `conversation_labels` is not in the generated types yet — same situation
      // as session_requests; a narrow cast keeps the query typed at the call.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = (await (supabase as any)
        .from('conversation_labels')
        .select('conversation_id, custom_name')) as {
        data: LabelRow[] | null;
        error: { message: string } | null;
      };
      if (error) {
        throw new Error(error.message);
      }
      return new Map((data ?? []).map(r => [r.conversation_id, r.custom_name]));
    },
    staleTime: 30_000,
  });
}

/**
 * Set, change, or clear a conversation's private label. An empty name clears it.
 * The server (set_conversation_name) enforces participation and the 40-char cap.
 */
export function useSetConversationName() {
  const queryClient = useQueryClient();
  return useMutation<void, Error, { conversationId: string; name: string }>({
    mutationFn: async ({ conversationId, name }) => {
      // set_conversation_name is not in the generated types yet (added by
      // migration 098); cast the call the same way session_requests does.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = (await (supabase as any).rpc('set_conversation_name', {
        p_conversation_id: conversationId,
        p_name: name,
      })) as { error: { message: string } | null };
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: labelKeys.all });
      // The inbox rows render the resolved name, so refresh them too.
      void queryClient.invalidateQueries({ queryKey: keys.conversationList });
    },
  });
}
