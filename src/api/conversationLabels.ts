/**
 * Private per-conversation custom names ("rename chat").
 *
 * A label is visible only to the person who set it (migration 098 RLS), so it is
 * resolved CLIENT-side: the inbox and chat header show `label ?? peer_display_name`
 * rather than baking the override into the shared `conversation_summaries` view.
 *
 * Every label fetch and mutation is also written to `conversationLabelCache`
 * (MMKV) so the headless FCM background handler can substitute the label for
 * the sender's real display name without a QueryClient.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { ConversationSummary } from '../lib/database.types';
import {
  setAllLabels,
  setLabel,
  setPeerLabel,
} from '../lib/conversationLabelCache';
import { keys } from './chat';

const labelKeys = {
  all: ['conversation-labels'] as const,
};

interface LabelRow {
  conversation_id: string;
  custom_name: string;
}

/** The caller's own labels, as a `conversationId -> customName` map. */
export function useConversationLabels() {
  const queryClient = useQueryClient();
  return useQuery<Map<string, string>>({
    queryKey: labelKeys.all,
    queryFn: async () => {
      const [sessionResult, labelResult] = await Promise.all([
        supabase.auth.getSession(),
        // `conversation_labels` is not in the generated types yet — same situation
        // as session_requests; a narrow cast keeps the query typed at the call.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase as any)
          .from('conversation_labels')
          .select('conversation_id, custom_name') as Promise<{
          data: LabelRow[] | null;
          error: { message: string } | null;
        }>,
      ]);
      if (labelResult.error) {
        throw new Error(labelResult.error.message);
      }
      const map = new Map(
        (labelResult.data ?? []).map(r => [r.conversation_id, r.custom_name]),
      );

      // Persist to MMKV so push handlers can resolve labels without a QueryClient.
      const userId = sessionResult.data.session?.user.id;
      if (userId !== undefined) {
        // Build the peer index by joining the label map against the in-memory
        // conversation_summaries (already fetched for the inbox). Only when the
        // inbox has loaded: on a cold start the labels can resolve first, and
        // an index built from no summaries is EMPTY, which used to overwrite
        // the persisted one and put real names back into call pushes (B-BS-3).
        // Unloaded, the stored peer index is left as it is.
        const summaries = queryClient.getQueryData<ConversationSummary[]>(
          keys.conversationList,
        );
        let peerIndex: Map<string, string> | undefined;
        if (summaries !== undefined) {
          peerIndex = new Map<string, string>();
          for (const summary of summaries) {
            const label = map.get(summary.conversation_id);
            if (label !== undefined) {
              peerIndex.set(summary.peer_id, label);
            }
          }
        }
        setAllLabels(userId, map, peerIndex);
      }

      return map;
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
    onSuccess: async (_, { conversationId, name }) => {
      void queryClient.invalidateQueries({ queryKey: labelKeys.all });
      // The inbox rows render the resolved name, so refresh them too.
      void queryClient.invalidateQueries({ queryKey: keys.conversationList });

      // Write to MMKV immediately so push handlers see the new label before
      // the server round-trip that invalidateQueries triggers completes.
      const { data } = await supabase.auth.getSession();
      const userId = data.session?.user.id;
      if (userId !== undefined) {
        setLabel(userId, conversationId, name);
        // Also update the peer index if the conversation summary is cached.
        const summaries =
          queryClient.getQueryData<ConversationSummary[]>(keys.conversationList) ?? [];
        const summary = summaries.find(s => s.conversation_id === conversationId);
        if (summary !== undefined) {
          setPeerLabel(userId, summary.peer_id, name || null);
        }
      }
    },
  });
}
