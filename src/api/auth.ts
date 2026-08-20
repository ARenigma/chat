import { Linking } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { AUTH_REDIRECT_URL } from '../lib/env';

/**
 * Google or Facebook. No phone, no password, no anonymous session.
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
 *   3. **Google / Facebook** (here) — free to us, and an account that is harder
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
 * There is a second, subtler cost worth naming: Facebook and Google both learn
 * that the user signed into *this* app. For an app about loneliness, that is a
 * disclosure some people will not want to make, and it is not a disclosure a
 * phone number required. It is the main argument for offering Apple sign-in on
 * iOS later, which supports private relay.
 */

/**
 * The providers we support.
 *
 * Instagram is absent and cannot be added: Meta shut down the Instagram Basic
 * Display API in December 2024, and Instagram sign-in now runs through Facebook
 * Login for Business. "Log in with Instagram" is, in practice, `facebook`.
 *
 * Apple is absent because there is no iOS build yet. It becomes *mandatory* the
 * moment one ships with these two, under App Store guideline 4.8.
 */
export type SocialProvider = 'google' | 'facebook';

export const PROVIDER_LABEL: Record<SocialProvider, string> = {
  google: 'Continue with Google',
  facebook: 'Continue with Facebook',
};

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
