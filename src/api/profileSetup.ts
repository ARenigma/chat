import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Profile } from '../lib/database.types';
import { isUsernameLocallyValid } from '../lib/username';
import { keys } from './chat';

/**
 * The four adult-only age bands, ordered youngest-first.
 *
 * No "Under 18" chip: the product is adults only and the declaration is
 * soft self-certification rather than a hard gate, so the picker only offers
 * bands we are prepared to serve. The check constraint in migration 043
 * enforces the same four values at the database layer.
 */
export const AGE_BRACKETS = ['18-24', '25-34', '35-44', '45+'] as const;
export type AgeBracket = (typeof AGE_BRACKETS)[number];

/**
 * True when a member has not yet declared their age band.
 *
 * Only checked for members; providers do not use this gate. Null `profile`
 * (unauthenticated) returns false — the gate runs after auth.
 */
export function needsAgeBracket(profile: Profile | undefined): boolean {
  return profile?.role === 'member' && profile.age_bracket === null;
}

export async function setMemberAgeBracket(bracket: AgeBracket): Promise<void> {
  const { error } = await supabase.rpc('set_member_age_bracket', {
    p_bracket: bracket,
  });
  if (error) {
    throw new Error(error.message);
  }
}

export function useSetAgeBracket() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setMemberAgeBracket,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.profile });
    },
  });
}

export type DisplayNameStatus = 'available' | 'taken' | 'invalid';

export interface DisplayNameCheck {
  status: DisplayNameStatus;
  message: string;
}

export function needsProfileSetup(profile: Profile | undefined): boolean {
  return profile?.role === 'member' && profile.profile_completed_at == null;
}

export async function checkDisplayName(name: string): Promise<DisplayNameCheck> {
  const { data, error } = await supabase.rpc('check_display_name', {
    p_name: name.trim(),
  });
  if (error) {
    throw new Error(error.message);
  }
  const row = data as { status?: string; message?: string } | null;
  const status = (row?.status ?? 'invalid') as DisplayNameStatus;
  return {
    status,
    message: row?.message ?? '',
  };
}

export function useCheckDisplayName(name: string, enabled: boolean) {
  const trimmed = name.trim();
  const [debounced, setDebounced] = useState(trimmed);

  useEffect(() => {
    if (!enabled || !isUsernameLocallyValid(trimmed)) {
      setDebounced('');
      return;
    }
    const t = setTimeout(() => setDebounced(trimmed), 300);
    return () => clearTimeout(t);
  }, [trimmed, enabled]);

  return useQuery({
    queryKey: ['display-name-check', debounced],
    queryFn: () => checkDisplayName(debounced),
    enabled: enabled && debounced.length >= 3,
    staleTime: 10_000,
  });
}

export function useClaimMemberProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      displayName,
      avatarSeed,
    }: {
      displayName: string;
      avatarSeed: string;
    }) => {
      const { data, error } = await supabase.rpc('claim_member_profile', {
        p_display_name: displayName.trim(),
        p_avatar_seed: avatarSeed,
      });
      if (error) {
        throw new Error(error.message);
      }
      const result = data as { status?: string; message?: string };
      if (result.status !== 'ok') {
        throw new Error(result.message ?? 'Could not save profile');
      }
      return result;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: keys.profile });
    },
  });
}
