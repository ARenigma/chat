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
import { useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Block, BlockedPerson, ReportReason } from '../lib/database.types';
import { track } from '../lib/telemetry';
import { errorTick, tick } from '../lib/haptics';
import { useStore } from '../store/useStore';
import { keys } from './chat';

const safetyKeys = {
  blocks: ['blocks'] as const,
  // Nested under `blocks` on purpose. Invalidation matches by prefix, so every
  // write that refreshes the block set refreshes the named list too, and a
  // caller that blocks by another route (block_story_commenter writes the row
  // server-side) invalidates `blocks` once and cannot leave either stale.
  blockedPeople: ['blocks', 'people'] as const,
  myReports: ['my-reports'] as const,
};

/**
 * The session's own block list, the only part of the block graph it may read.
 *
 * Private on purpose. Callers want the answer to "have I blocked this person",
 * never the rows, and `Block[]` in the interface would invite somebody to read
 * `blocker_id` and conclude the list is symmetric. RLS returns only rows where
 * the caller is the blocker, so it never has been.
 */
function useBlocks() {
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

/**
 * Everyone this session has blocked, as a set.
 *
 * This is the module's real interface, and three surfaces need it: the directory
 * hides these people, the inbox rail hides them, and a thread with one of them
 * is marked rather than removed. Before this existed each of those screens knew
 * nothing about blocking, so a block silenced the send path and changed nothing
 * a member could see.
 *
 * Memoised because the set is a dependency of `useMemo` filters in both screens,
 * and a fresh Set every render would defeat them.
 *
 * An empty set while the query is in flight is the right default: it shows one
 * frame of a person you blocked at worst, where the alternative is hiding people
 * you did not block every time the app cold-starts.
 */
export function useBlockedPeerIds(): ReadonlySet<string> {
  const { data } = useBlocks();
  return useMemo(() => new Set((data ?? []).map(b => b.blocked_id)), [data]);
}

/**
 * Everyone this session has blocked, with a name to show: what the Blocked
 * screen lists, most recent first.
 *
 * Its own read rather than the id set above joined to a directory, because no
 * directory holds everyone. The provider directory has no members, so a
 * provider who blocked a member, from a chat or from a comment on their story
 * (152), had a block the app could not show and so could not undo.
 * `blocked_people` resolves every block the caller made to a public name and a
 * clay avatar, and never a phone number or email.
 */
export function useBlockedPeople() {
  return useQuery<BlockedPerson[]>({
    queryKey: safetyKeys.blockedPeople,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('blocked_people')
        .select('blocked_id, display_name, avatar_url, blocked_at')
        .order('blocked_at', { ascending: false });
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
      // Both invalidations matter now. The block list drives what the directory
      // and the inbox rail show, and the send path refuses, so anything cached
      // about this thread is stale too.
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
    onSuccess: (_void, peerId) => {
      tick();
      track('user_unblocked');
      setNotice('Unblocked.', 'confirm');
      // Drop the row before the refetch rather than waiting on it. The delete
      // has already landed, and a refetch that fails keeps the old list, so
      // without this the Blocked screen would go on offering to unblock
      // somebody it just said was unblocked.
      queryClient.setQueryData<BlockedPerson[]>(safetyKeys.blockedPeople, prev =>
        prev?.filter(p => p.blocked_id !== peerId),
      );
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

/**
 * Whether *we* have blocked this peer, for rendering Block vs Unblock. Derived
 * from the block list we already hold rather than a second query.
 */
export function useIsBlocked(peerId: string | undefined): boolean {
  const blocked = useBlockedPeerIds();
  return peerId !== undefined && blocked.has(peerId);
}

/*
 * There was a `useMyReports` here, reading the `my_reports` view. It had no
 * caller and no screen: nothing in the app listed your past reports, so the hook
 * was a surface with nothing behind it. The view and `submit_report` stay, so
 * building that screen later is a hook away.
 *
 * Removed rather than kept for the day it is needed, because the same shape shipped
 * once before as an orphaned ReviewSheet, and dead safety code is worse than
 * missing safety code: it reads as a control that exists.
 */
