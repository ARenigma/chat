import { useCallback, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import {
  ContactGuardRefusalError,
  contactGuardRefusalFromError,
} from '../lib/contactGuard';
import type { Profile } from '../lib/database.types';
import {
  USERNAME_MAX,
  isUsernameLocallyValid,
  usernameLocalStatus,
} from '../lib/username';
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
    const refusal = contactGuardRefusalFromError(error);
    if (refusal) {
      throw new ContactGuardRefusalError(refusal);
    }
    throw new Error(error.message);
  }
}

type DisplayNameStatus = 'available' | 'taken' | 'invalid';

export interface DisplayNameCheck {
  status: DisplayNameStatus;
  message: string;
}

export function needsProfileSetup(profile: Profile | undefined): boolean {
  return profile?.role === 'member' && profile.profile_completed_at == null;
}

/**
 * `check_display_name` (migration 040) answers BOTH questions in one round
 * trip: the charset/length rules AND `available` vs `taken` against the
 * case-insensitive unique index on `lower(display_name)`. There is nothing for
 * a second RPC to add, so availability has no migration behind it.
 *
 * `signal` is what makes an abandoned check stop. React Query hands the query's
 * own signal to the query function and aborts it once the observer moves to a
 * newer key (query-core `removeObserver`, which cancels only when the signal
 * was consumed) — so passing it through is not decoration, it is the
 * cancellation.
 */
async function checkDisplayName(
  name: string,
  signal?: AbortSignal,
): Promise<DisplayNameCheck> {
  const call = supabase.rpc('check_display_name', { p_name: name.trim() });
  const { data, error } = await (signal === undefined
    ? call
    : call.abortSignal(signal));
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

/**
 * How long the field must be still before a keystroke costs a round trip.
 *
 * 450ms, up from 300. 300ms fires inside the gap between two characters of
 * ordinary typing on a phone, so a nine-character name bought several requests
 * whose answers were all thrown away — and on a slow Indian mobile connection
 * the round trip outlives the gap, so the answer arrives against text that has
 * already moved on. 450ms sits past the typing gap and still lands well inside
 * the second after the member stops, which is where the verdict has to be to
 * feel live rather than submitted.
 */
const USERNAME_CHECK_DEBOUNCE_MS = 450;

export function useCheckDisplayName(name: string, enabled: boolean) {
  const trimmed = name.trim();
  const [debounced, setDebounced] = useState('');

  useEffect(() => {
    // Cleared FIRST, on every change. Without this the key keeps pointing at
    // the previous name for the whole debounce window, so React Query hands
    // back that name's cached verdict and the field reads "already taken"
    // about text the member has since replaced.
    setDebounced('');
    if (!enabled || !isUsernameLocallyValid(trimmed)) {
      return;
    }
    const t = setTimeout(() => setDebounced(trimmed), USERNAME_CHECK_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [trimmed, enabled]);

  return useQuery({
    queryKey: ['display-name-check', debounced],
    queryFn: ({ signal }) => checkDisplayName(debounced, signal),
    enabled: enabled && debounced.length >= 3,
    staleTime: 10_000,
    // A failed check must reach the member as a failed check, quickly. Three
    // silent retries hold the field on "Checking…" for seconds and then report
    // the same thing anyway; the retry offered next to the verdict is the
    // member's, and they can see it.
    retry: false,
  });
}

/**
 * Every state the username field can be in, as one value.
 *
 * `check_failed` is the state this type exists for. It is NOT `taken`: a member
 * whose network dropped for one second would otherwise be told a free name
 * belongs to somebody else, and they would give it up.
 */
export type UsernameVerdict =
  | 'idle'
  | 'too_short'
  | 'invalid_chars'
  | 'too_long'
  | 'checking'
  | 'available'
  | 'taken'
  | 'check_failed';

/**
 * The live availability check, as a state machine the screen can render
 * directly.
 *
 * The local rules are applied first and no request is made until they pass —
 * "at least 3 characters" is knowable without the server, and spending a round
 * trip to be told so would put a spinner in front of an answer we already have.
 */
export function useUsernameVerdict(raw: string): {
  verdict: UsernameVerdict;
  retry: () => void;
} {
  const trimmed = raw.trim();
  const local = usernameLocalStatus(trimmed);
  const localOk = isUsernameLocallyValid(trimmed);
  const { data, isError, refetch } = useCheckDisplayName(trimmed, localOk);

  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  let verdict: UsernameVerdict;
  if (local === 'idle' || local === 'too_short' || local === 'invalid_chars') {
    verdict = local;
  } else if (trimmed.length > USERNAME_MAX) {
    // `usernameLocalStatus` has no `too_long`, and the field's maxLength makes
    // this unreachable today; it is here so that a caller without that cap
    // cannot silently fall through to a request that answers 'invalid'.
    verdict = 'too_long';
  } else if (isError) {
    verdict = 'check_failed';
  } else if (data?.status === 'available') {
    verdict = 'available';
  } else if (data?.status === 'taken') {
    verdict = 'taken';
  } else if (data?.status === 'invalid') {
    verdict = 'invalid_chars';
  } else {
    // Locally valid with no verdict yet: either the debounce is still running
    // or the request is in flight. Both are "we do not know yet", which is what
    // `checking` says, and neither may read as a verdict.
    verdict = 'checking';
  }

  return { verdict, retry };
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
        const refusal = contactGuardRefusalFromError(error);
      if (refusal) {
        throw new ContactGuardRefusalError(refusal);
      }
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
