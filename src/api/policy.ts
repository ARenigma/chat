/**
 * Policy acceptance gate.
 *
 * Wraps the server-authoritative pending_policy_acceptances() RPC and the
 * accept_policy() mutation. The gate is shown in two situations:
 *   1. New users: as a boot-time interstitial immediately after sign-in.
 *   2. Existing users: when pending_policy_acceptances returns non-empty rows
 *      (material change since last accepted version).
 *
 * ADR-0020: policy acceptance is required before any UGC operation.
 * Migration 027 provides the server-authoritative RPCs.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { track } from '../lib/telemetry';
import type { PolicyVersion } from '../lib/database.types';

const policyKeys = {
  pending: ['policy', 'pending'] as const,
} as const;

/**
 * Shape returned by the pending_policy_acceptances() RPC.
 * Differs from PolicyVersion (full table row) in two ways: the PK is called
 * `version_id` (the RPC aliases the column so callers can pass it directly to
 * accept_policy), and only the fields needed for the gate are projected.
 */
type PendingPolicyRow = {
  version_id: string;
  kind: 'terms' | 'privacy';
  url: string;
  summary: string;
  is_material: boolean;
};

/**
 * The subset of PolicyVersion the gate actually uses. `id` is the version_id
 * from the RPC, mapped here so the rest of the codebase talks `p.id` uniformly.
 */
export type PendingPolicy = Pick<PolicyVersion, 'id' | 'kind' | 'url' | 'summary'>;

export function usePendingPolicies() {
  return useQuery({
    queryKey: policyKeys.pending,
    queryFn: async (): Promise<PendingPolicy[]> => {
      const { data, error } = await supabase.rpc('pending_policy_acceptances');
      if (error) throw error;
      return ((data ?? []) as PendingPolicyRow[]).map(r => ({
        id: r.version_id,
        kind: r.kind,
        url: r.url,
        summary: r.summary,
      }));
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useAcceptAllPendingPolicies() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (versionIds: string[]) => {
      for (const id of versionIds) {
        const { error } = await supabase.rpc('accept_policy', {
          p_version_id: id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: policyKeys.pending });
      track('policy_accepted');
    },
  });
}
