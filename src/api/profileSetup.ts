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

/** Product rule: first-run UI belongs only to members with an empty wallet. */
export function isFirstUser(profile: Profile | undefined): boolean {
  return profile?.role === 'member' && profile.token_balance === 0;
}

/** One authoritative profile read for post-auth routing and inline onboarding. */
export async function getSignedInProfile(): Promise<Profile | null> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (userId === undefined) {
    return null;
  }
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  if (error) {
    return null;
  }
  return data as Profile;
}

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

/**
 * True when a member has never answered the language step.
 *
 * `preferred_languages` is `not null default '{}'` (migration 072), so "never
 * asked" and "asked and skipped" are the same empty array and this returns true
 * for both. That is deliberate and it is the cost of the skippable decision:
 * a member who skipped is asked again if they somehow re-enter onboarding.
 * They cannot in practice — onboarding only runs for a member with no session,
 * and `isFirstUser` gates it to a zero-balance member on top — and buying a
 * "declined" state would mean a third value on the column that no reader other
 * than this one line would ever distinguish.
 */
export function needsLanguagePreference(profile: Profile | undefined): boolean {
  return (
    profile?.role === 'member' &&
    (profile.preferred_languages ?? []).length === 0
  );
}

/**
 * Write the member's language preference.
 *
 * A plain UPDATE, and NOT an RPC — the one place this deliberately differs from
 * `setMemberAgeBracket` next door. `age_bracket` needs a SECURITY DEFINER RPC
 * because migration 063 makes it un-writable by a client: a member who can type
 * their own age band can defeat the 18+ gate. This column is the member's own
 * preference about their own feed, it is absent from that guard by design, and
 * the owner-only RLS policy from 003 already restricts the write to their own
 * row. An RPC here would add a definer function whose entire body is the
 * statement RLS was going to allow anyway.
 *
 * Idempotent, so the retry the caller offers on a transient error is safe.
 */
export async function setPreferredLanguages(
  languages: readonly string[],
): Promise<void> {
  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id;
  if (userId === undefined) {
    throw new Error('Not signed in.');
  }
  const { error } = await supabase
    .from('profiles')
    .update({ preferred_languages: [...languages] })
    // Redundant against the RLS policy and kept anyway: an UPDATE with no
    // filter is one policy change away from being an UPDATE of every row, and
    // this is the cheapest possible guard against that.
    .eq('id', userId);
  if (error) {
    throw new Error(error.message);
  }
}

export function useSetPreferredLanguages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setPreferredLanguages,
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
