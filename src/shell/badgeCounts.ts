/**
 * The counts the bottom bar badges show, one hook per badged tab.
 *
 * Both read the one conversation list query, so a badge costs no request of
 * its own. Pure reducers are exported so they can be tested without a query.
 */

import { useMemo } from 'react';
import { useConversations } from '../api/chat';
import type { ConversationSummary } from '../lib/database.types';

type Threads = readonly ConversationSummary[] | undefined;

/** Member Home: every unread message across every thread, on the side I am on. */
function totalUnread(threads: Threads): number {
  return (threads ?? []).reduce(
    (sum, c) =>
      sum + (c.i_am_member ? Number(c.unread_count_member) : Number(c.unread_count_provider)),
    0,
  );
}

/**
 * Provider Chats: people waiting, i.e. WORK threads (I am not the member) with
 * anything unread. Their own member-side threads are not somebody waiting on
 * them (the provider Chats badge; ProviderHomeScreen reads it since step 6).
 */
function waitingCount(threads: Threads): number {
  return (threads ?? []).filter(
    t => !t.i_am_member && Number(t.unread_count_provider) > 0,
  ).length;
}

export function useMemberUnreadTotal(): number {
  const { data } = useConversations();
  return useMemo(() => totalUnread(data), [data]);
}

export function useProviderWaitingCount(): number {
  const { data } = useConversations();
  return useMemo(() => waitingCount(data), [data]);
}

/** The badge source for a tab that has none. */
export function useNoBadge(): number {
  return 0;
}
