import { Linking } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { AUTH_REDIRECT_URL } from '../lib/env';

/**
 * Zero-friction identity.
 *
 * First launch creates an anonymous Supabase user — no email, no password, no
 * onboarding. The `on_auth_user_created` trigger (migration 002) provisions the
 * profile and its 50 starting tokens, so the very first frame the user sees is
 * already a usable chat.
 *
 * Linking a Google or phone identity later is strictly optional and never
 * blocks the product. It exists so a user can keep their history across a
 * reinstall; `linkIdentity` upgrades the *same* user row, so nothing is lost.
 * (Requires "Manual linking" enabled in the Supabase auth settings.)
 */
export async function ensureSession(): Promise<Session> {
  const { data } = await supabase.auth.getSession();
  if (data.session) {
    return data.session;
  }

  const { data: created, error } = await supabase.auth.signInAnonymously();
  if (error || !created.session) {
    throw new Error(error?.message ?? 'Could not start a session');
  }
  return created.session;
}

export async function isAnonymous(): Promise<boolean> {
  const { data } = await supabase.auth.getUser();
  return data.user?.is_anonymous === true;
}

/** 1-tap Google link: opens the system browser, returns via deep link. */
export async function linkGoogle(): Promise<void> {
  const { data, error } = await supabase.auth.linkIdentity({
    provider: 'google',
    options: { redirectTo: AUTH_REDIRECT_URL, skipBrowserRedirect: true },
  });
  if (error || !data.url) {
    throw new Error(error?.message ?? 'Could not start Google link');
  }
  await Linking.openURL(data.url);
}

/**
 * Completes the PKCE exchange for `companionchat://auth-callback?code=...`.
 * Returns true when the link was ours and consumed.
 */
export async function handleAuthDeepLink(url: string): Promise<boolean> {
  if (!url.startsWith(AUTH_REDIRECT_URL)) {
    return false;
  }
  const code = url.match(/[?&]code=([^&]+)/)?.[1];
  if (!code) {
    return false;
  }
  const { error } = await supabase.auth.exchangeCodeForSession(decodeURIComponent(code));
  if (error) {
    throw new Error(error.message);
  }
  return true;
}

/** Phone link, step 1 of 2: sends the OTP. */
export async function startPhoneLink(phone: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ phone });
  if (error) {
    throw new Error(error.message);
  }
}

/** Phone link, step 2 of 2. */
export async function confirmPhoneLink(phone: string, code: string): Promise<void> {
  const { error } = await supabase.auth.verifyOtp({ phone, token: code, type: 'phone_change' });
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Play Store "Data deletion" requirement: one atomic server-side delete of the
 * auth user, which cascades to profile -> chats -> messages. Nothing is soft
 * deleted and nothing is retained.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_user_account');
  if (error) {
    throw new Error(error.message);
  }
  await supabase.auth.signOut();
}
