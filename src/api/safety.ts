/**
 * The user's own safety controls.
 *
 * Blocking is the remedy that needs no operator and no waiting, so it is a
 * direct table write under RLS. Reporting goes through `submit_report` because
 * it has to verify participation and snapshot the evidence, neither of which a
 * client can be trusted to do.
 *
 * Note what is absent: there is no "am I blocked by them" query. The database
 * deliberately offers no way to ask, because telling someone they have been
 * blocked is what turns a block into an invitation to make a second account.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Block, MyReport, ReportReason } from '../lib/database.types';
import { track } from '../lib/telemetry';
import { errorTick, tick } from '../lib/haptics';
import { useStore } from '../store/useStore';
import { keys } from './chat';

export const safetyKeys = {
  blocks: ['blocks'] as const,
  myReports: ['my-reports'] as const,
};

/** The session's own block list — the only part of the block graph it may read. */
export function useBlocks() {
  return useQuery<Block[]>({
    queryKey: safetyKeys.blocks,
    queryFn: async () => {
      const { data, error } = await supabase.from('blocks').select('*');
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
    staleTime: 30_000,
  });
}

export function useBlockUser() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<void, Error, string>({
    mutationFn: async (peerId: string) => {
      const { data } = await supabase.auth.getUser();
      const me = data.user?.id;
      if (me === undefined) {
        throw new Error('No session');
      }
      const { error } = await supabase
        .from('blocks')
        .insert({ blocker_id: me, blocked_id: peerId });
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      tick();
      track('user_blocked');
      setNotice('Blocked. They can no longer message you.', 'confirm');
      void queryClient.invalidateQueries({ queryKey: safetyKeys.blocks });
      // The directory and inbox do not change, but the send path now refuses,
      // so anything cached about this thread is stale.
      void queryClient.invalidateQueries({ queryKey: keys.conversationList });
    },
    onError: () => {
      errorTick();
      setNotice('Could not block right now.');
    },
  });
}

export function useUnblockUser() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<void, Error, string>({
    mutationFn: async (peerId: string) => {
      const { error } = await supabase.from('blocks').delete().eq('blocked_id', peerId);
      if (error) {
        throw new Error(error.message);
      }
    },
    onSuccess: () => {
      tick();
      track('user_unblocked');
      setNotice('Unblocked.', 'confirm');
      void queryClient.invalidateQueries({ queryKey: safetyKeys.blocks });
      void queryClient.invalidateQueries({ queryKey: keys.conversationList });
    },
    onError: () => {
      errorTick();
      setNotice('Could not unblock right now.');
    },
  });
}

export interface ReportInput {
  conversationId: string;
  /** The specific message being reported, if any. Drives the evidence snapshot. */
  messageId: string | null;
  reason: ReportReason;
  detail: string | null;
}

export function useSubmitReport() {
  const queryClient = useQueryClient();
  const setNotice = useStore(s => s.setNotice);

  return useMutation<string, Error, ReportInput>({
    mutationFn: async input => {
      const { data, error } = await supabase.rpc('submit_report', {
        p_conversation_id: input.conversationId,
        p_message_id: input.messageId,
        p_reason: input.reason,
        p_detail: input.detail,
      });
      if (error || !data) {
        throw new Error(error?.message ?? 'Could not submit the report');
      }
      return data;
    },
    onSuccess: (_id, input) => {
      // The reason is a closed enum, so it is safe as a prop; the free-text
      // detail is not, and is deliberately never attached.
      track('report_submitted', { reason: input.reason });
      setNotice('Reported. Our team will review this.', 'confirm');
      void queryClient.invalidateQueries({ queryKey: safetyKeys.myReports });
    },
    onError: () => {
      errorTick();
      setNotice('Could not submit the report. Please try again.');
    },
  });
}

/** Closing the loop matters: an unacknowledged report reads as nothing happened. */
export function useMyReports() {
  return useQuery<MyReport[]>({
    queryKey: safetyKeys.myReports,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('my_reports')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) {
        throw new Error(error.message);
      }
      return data;
    },
  });
}

/**
 * Whether *we* have blocked this peer, for rendering Block vs Unblock. Derived
 * from the block list we already hold rather than a second query.
 */
export function useIsBlocked(peerId: string | undefined): boolean {
  const { data } = useBlocks();
  return (data ?? []).some(b => b.blocked_id === peerId);
}
