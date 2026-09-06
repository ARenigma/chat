/**
 * The usage ledger: what each session cost, or earned.
 *
 * Goal item 2. One RPC serves both roles (migration 069) — the server decides
 * which number the caller is entitled to, so this file never has to, and a
 * member can never be handed a provider's share by a client-side branch.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';

export type UsageChannel = 'chat' | 'audio' | 'video';

export interface UsageRow {
  session_id: string;
  channel: UsageChannel;
  started_at: string | null;
  ended_at: string | null;
  minutes: number;
  /** True when the caller paid for this session; false when they were paid. */
  i_am_member: boolean;
  /** Tokens spent (member) or earned (provider). 1 token = ₹1 (ADR-0021). */
  tokens: number;
  /** Provider only: where their share is in the payout cycle. */
  earnings_status: 'pending' | 'cleared' | 'paid' | 'refunded' | null;
  peer_id: string;
  /** A provider's stage name, or a member's pseudonymous handle. Never a real name. */
  peer_name: string;
}

export const usageKeys = { ledger: ['usage-ledger'] as const };

export function useUsageLedger() {
  return useQuery<UsageRow[]>({
    queryKey: usageKeys.ledger,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_usage_ledger', {});
      if (error) {
        throw new Error(error.message);
      }
      return (data as unknown as UsageRow[] | null) ?? [];
    },
  });
}
