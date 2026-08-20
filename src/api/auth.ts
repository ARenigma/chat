import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

/**
 * Phone number and OTP. Nothing else.
 *
 * This replaced anonymous-first sign-in, and it is worth being clear about what
 * that cost and what it bought, because the trade is not obviously good.
 *
 * Lost: "a usable session on the first frame, nothing to fill in." That was the
 * sharpest thing about the product and it is gone. There is now a form between
 * the launcher and the app, and some people will not fill it in.
 *
 * Bought: identity that persists. Every safety control built in migration 005 —
 * suspension, bans, rate limits, the report history that makes a repeat offender
 * visible — assumed the account meant something. Against anonymous sessions all
 * of it was theatre: a banned user reinstalled and was back in ten seconds with
 * a fresh row and a fresh wallet. A phone number is scarce, costs money to
 * replace, and is the cheapest accountability available without asking for ID.
 *
 * Deleted with the anonymous path: Google, Facebook, email and manual identity
 * linking. There is nothing to link *to* any more — the phone number is the
 * account, not an upgrade to it.
 */

/** E.164, which is what Supabase and every SMS gateway expect. */
export function normalisePhone(raw: string, defaultCountryCode = '+91'): string {
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) {
    return digits;
  }
  // A bare 10-digit number is the common case in the launch market; anything
  // longer is assumed to already carry a country code.
  return digits.length <= 10 ? `${defaultCountryCode}${digits}` : `+${digits}`;
}

export function looksLikePhone(raw: string): boolean {
  // Deliberately loose. The gateway is the authority on whether a number is
  // reachable, and a regex that is stricter than the gateway rejects real people.
  return /^\+\d{8,15}$/.test(normalisePhone(raw));
}

export async function currentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Step 1: send the code.
 *
 * `shouldCreateUser` is true because signing in and signing up are the same act
 * here — there is no separate registration, which is the one part of the old
 * onboarding promise that survives.
 */
export async function requestOtp(phone: string): Promise<void> {
  const { error } = await supabase.auth.signInWithOtp({
    phone: normalisePhone(phone),
    options: { shouldCreateUser: true },
  });
  if (error) {
    throw new Error(error.message);
  }
}

/** Step 2: exchange the code for a session. */
export async function verifyOtp(phone: string, code: string): Promise<Session> {
  const { data, error } = await supabase.auth.verifyOtp({
    phone: normalisePhone(phone),
    token: code.trim(),
    type: 'sms',
  });
  if (error || !data.session) {
    throw new Error(error?.message ?? 'That code did not work');
  }
  return data.session;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
}

/**
 * Play Store "Data deletion" requirement: one atomic server-side delete of the
 * auth user, which cascades to profile -> conversations -> messages.
 *
 * One thing survives, deliberately: abuse reports, de-identified. See the
 * retention note in migration 005 — a report has to outlive the reported
 * message or deleting your account destroys the case against you.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_user_account');
  if (error) {
    throw new Error(error.message);
  }
  await supabase.auth.signOut();
}
