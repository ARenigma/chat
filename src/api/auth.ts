import { Linking } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { AUTH_REDIRECT_URL } from '../lib/env';
import { normalisePhone } from '../lib/phone';

/**
 * Google. No Facebook, no phone, no password, no anonymous session.
 *
 * This is the third identity model this app has had, so the reasoning is worth
 * keeping in one place. See ADR-0004 for the decision record.
 *
 *   1. **Anonymous** — best onboarding imaginable, but no accountability at all:
 *      a banned user reinstalled and was back in ten seconds with a fresh
 *      wallet, which made every control in migration 005 decorative.
 *   2. **Phone + OTP** — strongest accountability available without asking for
 *      ID, because a number costs money to replace. Abandoned on cost: SMS is
 *      billed per message and DLT registration is weeks of lead time in India.
 *   3. **Google** (here) — free to us, and an account that is harder
 *      to churn than an anonymous row while being easier than a phone number.
 *
 * Being clear about what this costs: a social account is **weaker
 * accountability than a phone number**. Google accounts are free and
 * unlimited, so a determined banned user can return. Suspension and bans are
 * therefore friction rather than a wall, and the compensating controls are the
 * ones that do not depend on identity — rate limits, the report history on a
 * *conversation*, and eventually classification. That is a real regression
 * against the phone model and it should be revisited when SMS is affordable.
 *
 * There is a second, subtler cost worth naming: Google learns that the user
 * signed into *this* app. For an app about loneliness, that is a disclosure some
 * people will not want to make, and it is not one a phone number required. It is
 * the main argument for phone auth and for Apple sign-in on iOS later, which
 * supports private relay.
 */

/**
 * One provider, deliberately.
 *
 * **Facebook was removed** rather than left unfinished. It had a button and no
 * credentials — `enable_facebook = false` in the Supabase config — so every tap
 * produced a failure, which is worse than an absent option: a sign-in screen
 * that offers something it cannot deliver is the first thing a new user
 * experiences. Meta's App Review would also have to be passed before it could
 * ever work, for a second identity nobody asked for.
 *
 * Instagram is absent and cannot be added: Meta shut down the Instagram Basic
 * Display API in December 2024, and Instagram sign-in now runs through Facebook
 * Login for Business. "Log in with Instagram" is, in practice, `facebook`.
 *
 * Apple is absent because there is no iOS build yet. It becomes *mandatory* the
 * moment one ships, under App Store guideline 4.8.
 *
 * Phone + OTP is built below and switched off — see PHONE_AUTH_ENABLED.
 */
export type SocialProvider = 'google';

export const PROVIDER_LABEL: Record<SocialProvider, string> = {
  google: 'Continue with Google',
};

/**
 * Phone sign-in: implemented, and off until the DLT template is approved.
 *
 * This flag exists because of the Facebook mistake, which shipped. A sign-in
 * option that accepts input and then fails is worse than an absent one, and
 * Indian transactional SMS cannot be delivered at all until DLT registration
 * completes — entity, sender ID, then template, one to three weeks. Until then
 * `signInWithOtp` would take a number, look like it worked, and deliver nothing.
 *
 * Turning it on is three things, in this order:
 *   1. DLT template approved, with the SMS-autofill app hash inside it
 *      (ADR-0009 §1 — the hash depends on Google's app signing certificate, so
 *      it cannot be computed before the first Play upload).
 *   2. Uncomment `[auth.hook.send_sms]` in supabase/config.toml and push, with
 *      SEND_SMS_HOOK_SECRET, MSG91_AUTHKEY and MSG91_TEMPLATE_ID set.
 *   3. Flip this to true.
 *
 * A contract test asserts the sign-in screen offers no phone entry while this is
 * false, so the flag cannot be quietly bypassed by adding a button.
 */
export const PHONE_AUTH_ENABLED = false;

/**
 * The OTP flow has a state the OAuth flow does not: a code is in the air and
 * nothing has been decided yet. Reusing AuthCallbackResult would have meant
 * either overloading `signedIn` to also mean "sent", or a boolean beside it —
 * both of which lose the distinction the UI needs to switch from the phone field
 * to the code field.
 */
export type OtpResult =
  | { status: 'sent' }
  | { status: 'signedIn' }
  | { status: 'failed'; message: string };

/**
 * Ask Supabase to issue a code. Supabase generates and stores it, then calls the
 * send-sms hook, which puts it on the network through MSG91.
 *
 * This function never sees the code, which is the point of choosing the hook
 * over the MSG91 widget: Supabase Auth stays the only thing that can mint a
 * session, so RLS keeps resting on `auth.uid()` rather than on our own signing.
 */
export async function sendPhoneOtp(phone: string): Promise<OtpResult> {
  if (!PHONE_AUTH_ENABLED) {
    return { status: 'failed', message: 'Phone sign-in is not available yet.' };
  }
  const normalised = normalisePhone(phone);
  if (normalised === null) {
    return { status: 'failed', message: 'That does not look like a phone number.' };
  }
  const { error } = await supabase.auth.signInWithOtp({ phone: `+${normalised}` });
  if (error != null) {
    return { status: 'failed', message: describeOtpError(error.message) };
  }
  return { status: 'sent' };
}

/** Verify what the user typed. A wrong code is a failure, not a thrown error. */
export async function verifyPhoneOtp(
  phone: string,
  token: string,
): Promise<OtpResult> {
  if (!PHONE_AUTH_ENABLED) {
    return { status: 'failed', message: 'Phone sign-in is not available yet.' };
  }
  const normalised = normalisePhone(phone);
  if (normalised === null) {
    return { status: 'failed', message: 'That does not look like a phone number.' };
  }
  const { error } = await supabase.auth.verifyOtp({
    phone: `+${normalised}`,
    token: token.trim(),
    type: 'sms',
  });
  if (error != null) {
    return { status: 'failed', message: describeOtpError(error.message) };
  }
  return { status: 'signedIn' };
}

/**
 * Supabase's OTP errors in words that say what to do.
 *
 * "Invalid OTP" tells someone nothing about whether to retype or resend, and the
 * difference matters: an expired code needs a new one, a wrong code needs a
 * correction, and a rate limit needs a wait. Three different actions.
 */
function describeOtpError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes('expired')) {
    return 'That code has expired — send a new one.';
  }
  if (text.includes('invalid') || text.includes('incorrect')) {
    return 'That code is not right. Check the last digits.';
  }
  if (text.includes('rate') || text.includes('too many') || text.includes('limit')) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (text.includes('sms') || text.includes('provider')) {
    return 'We could not send a code right now. Try Google instead.';
  }
  return 'Could not verify that code. Please try again.';
}

export async function currentSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

/**
 * Starts the OAuth dance in the **system browser**, not a webview.
 *
 * That is not a style choice: an in-app webview showing a Google consent screen
 * is indistinguishable from a phishing page, and Google blocks it outright
 * (`disallowed_useragent`). `skipBrowserRedirect` hands us the URL so we can
 * open it with `Linking` instead of letting the SDK navigate.
 */
export async function signInWith(provider: SocialProvider): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo: AUTH_REDIRECT_URL, skipBrowserRedirect: true },
  });
  if (error || !data.url) {
    throw new Error(error?.message ?? `Could not start ${provider} sign-in`);
  }
  await Linking.openURL(data.url);
}

/**
 * The three things an OAuth callback can mean. A boolean could not express the
 * middle one, which is exactly the bug this replaced: an `error=` callback was
 * reported as `true` ("handled"), the app advanced to the signed-in tree with no
 * session, and every query there hung — producing a permanent spinner and no
 * clue why. Observed end-to-end on an emulator: Supabase returned
 * `error=server_error, Unable to exchange external code`, and the app showed a
 * blank loading screen.
 */
export type AuthCallbackResult =
  | { status: 'ignored' }
  | { status: 'signedIn' }
  | { status: 'failed'; message: string };

/** Maps Supabase/Google callback errors onto something a person can act on. */
function describeCallbackError(code: string | null, description: string | null): string {
  const detail = (description ?? '').replace(/\+/g, ' ');
  if (/Unable to exchange external code/i.test(detail)) {
    // The provider accepted the user and rejected us. Almost always a client
    // secret that does not match the client id it is paired with.
    return 'Sign-in is misconfigured on our side. Nothing you did wrong — we are on it.';
  }
  if (code === 'access_denied' || /denied/i.test(detail)) {
    return 'Sign-in was cancelled.';
  }
  return 'Could not finish signing in. Please try again.';
}

/**
 * Completes the PKCE exchange for `companionchat://auth-callback?code=...`.
 *
 * PKCE is what makes this safe on a device that cannot keep a client secret:
 * the verifier never leaves the app, so intercepting the redirect is not enough
 * to steal the session.
 */
export async function handleAuthDeepLink(url: string): Promise<AuthCallbackResult> {
  if (!url.startsWith(AUTH_REDIRECT_URL)) {
    return { status: 'ignored' };
  }

  // Supabase puts callback parameters in the fragment as well as the query
  // depending on the failure, so both are parsed.
  const raw = url.slice(AUTH_REDIRECT_URL.length).replace(/^[?#]/, '');
  const params = new URLSearchParams(raw.replace(/^[?#]/, ''));

  if (__DEV__) {
    const names = [...params.keys()].join(',') || '(none)';
    console.warn(
      `auth callback params: ${names}` +
        (params.get('error') != null ? ` | error=${params.get('error')}` : '') +
        (params.get('error_description') != null
          ? ` | ${params.get('error_description')}`
          : ''),
    );
  }

  const error = params.get('error') ?? params.get('error_code');
  if (error != null) {
    return {
      status: 'failed',
      message: describeCallbackError(error, params.get('error_description')),
    };
  }

  const code = params.get('code');
  if (code == null) {
    return { status: 'ignored' };
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return { status: 'failed', message: 'Could not finish signing in. Please try again.' };
  }
  return { status: 'signedIn' };
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
 * message, or deleting your account destroys the case against you.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_user_account');
  if (error) {
    throw new Error(error.message);
  }
  await supabase.auth.signOut();
}
