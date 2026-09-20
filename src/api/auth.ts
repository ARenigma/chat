import { Linking } from 'react-native';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { reportSwallowed } from '../lib/sentry';
import {
  GoogleCredentialError,
  credentialSheetAvailable,
  requestGoogleCredential,
} from '../lib/googleCredential';
import {
  TruecallerOAuthError,
  requestTruecallerAuth,
} from '../lib/truecallerOAuth';
export { truecallerAvailable } from '../lib/truecallerOAuth';
import { AUTH_REDIRECT_URL, ENV } from '../lib/env';
import { normalisePhone } from '../lib/phone';
import { storage } from '../lib/storage';
import {
  parsePendingTruecallerGoogleLink,
  parseTruecallerExchange,
  serializePendingTruecallerGoogleLink,
} from '../lib/truecallerAuthDomain';
import {
  firebaseConfirmOtp,
  firebaseSendOtp,
  firebaseSignOut,
} from '../lib/firebasePhone';

/**
 * Google. No Facebook, no phone, no password, no anonymous session.
 *
 * This is the third identity model this app has had, so the reasoning is worth
 * keeping in one place. See ADR-0004 for the decision record.
 *
 *   1. **Anonymous**, best onboarding imaginable, but no accountability at all:
 *      a banned user reinstalled and was back in ten seconds with a fresh
 *      wallet, which made every control in migration 005 decorative.
 *   2. **Phone + OTP**, strongest accountability available without asking for
 *      ID, because a number costs money to replace. Abandoned on cost: SMS is
 *      billed per message and DLT registration is weeks of lead time in India.
 *   3. **Google** (here), free to us, and an account that is harder
 *      to churn than an anonymous row while being easier than a phone number.
 *
 * Being clear about what this costs: a social account is **weaker
 * accountability than a phone number**. Google accounts are free and
 * unlimited, so a determined banned user can return. Suspension and bans are
 * therefore friction rather than a wall, and the compensating controls are the
 * ones that do not depend on identity, rate limits, the report history on a
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
 * credentials, `enable_facebook = false` in the Supabase config, so every tap
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
 * Phone + OTP is built below and switched off, see PHONE_AUTH_ENABLED.
 */
export type SocialProvider = 'google';

export const PROVIDER_LABEL: Record<SocialProvider, string> = {
  google: 'Continue with Google',
};

// Defined in src/config.ts — the single home for all feature flags.
// Imported here so the function bodies in this file can reference it directly,
// and re-exported so callers that import from auth.ts keep working.
// A contract test asserts this flag: see contract.test.ts 'phone sign-in stays off'.
import { PHONE_AUTH_ENABLED } from '../config';
export { PHONE_AUTH_ENABLED };

/**
 * Which mechanism delivers and verifies the phone OTP. Build-time, not runtime —
 * "test both" is a rebuild, not a toggle, and both paths are kept code-complete.
 *
 *   'firebase' — Firebase phone auth (active, Amit 2026-08-27). Free SMS quota
 *                and console test numbers, so it works before any DLT/carrier
 *                setup. Firebase only proves the number; a Supabase session is
 *                minted by the `exchange-firebase-token` Edge Function so RLS
 *                (auth.uid()) is unchanged. See src/lib/firebasePhone.ts.
 *   'supabase' — the Supabase-native path: signInWithOtp/verifyOtp with the
 *                `send-sms` hook, which now delivers the code over the WhatsApp
 *                Cloud API. Kept behind this flag; flip to it (WhatsApp primary,
 *                Firebase as the "Get SMS" fallback) once the WhatsApp template
 *                and token are live.
 *
 * OnboardingScreen calls sendPhoneOtp/verifyPhoneOtp and never learns
 * which path ran — the flag lives entirely here.
 */
export type PhoneAuthProvider = 'firebase' | 'supabase';
export const AUTH_PHONE_PROVIDER: PhoneAuthProvider = 'supabase';

/**
 * Whether to try Credential Manager before the browser.
 *
 * On. It was off for one concrete reason — Credential Manager
 * authenticates against an **Android** OAuth client (`client_type 1`) keyed on
 * the package name and signing SHA-1, and the Google Cloud project had only the
 * **Web** client (`client_type 3`). With no Android client the sheet returned
 * GMS status 16, androidx mapped 16 to `GetCredentialCancellationException`, the
 * native module mapped that to `code: 'cancelled'` (correctly — 16 *is* the
 * cancellation code), and `signInWithGoogle` treated the cancel as a deliberate
 * choice and did nothing: the "doesn't let me continue" report.
 *
 * Two Android clients exist locally — one per signing cert, both in
 * `android/app/google-services.json`:
 *   debug  5e8f16062ea3cd2c4a0d547876baa6f38cabf625
 *   upload 4910a1ff7ac9cb1ab11bb46386bf6a7ec4726553
 * The Play App Signing certificate must also be registered before the
 * Play-delivered APK can exchange a credential. The browser remains the fallback for
 * any device that cannot show a sheet (no/stale Play services); it authenticates
 * against the Web client, which is still present.
 *
 * If this is ever flipped back off, sign-in still works — it goes straight to
 * the browser, which needs none of the above.
 */
export const CREDENTIAL_MANAGER_ENABLED = true;

/**
 * The OTP flow has a state the OAuth flow does not: a code is in the air and
 * nothing has been decided yet. Reusing AuthCallbackResult would have meant
 * either overloading `signedIn` to also mean "sent", or a boolean beside it,
 * both of which lose the distinction the UI needs to switch from the phone field
 * to the code field.
 */
export type OtpResult =
  | { status: 'sent' }
  | { status: 'signedIn' }
  | { status: 'failed'; message: string };

/**
 * Ask Supabase to issue a code. Supabase generates and stores it, then calls the
 * send-sms hook, which delivers it over the WhatsApp Cloud API.
 *
 * This function never sees the code, which is the point of choosing the hook over
 * sending it ourselves: Supabase Auth stays the only thing that can mint a
 * session, so RLS keeps resting on `auth.uid()` rather than on our own signing.
 */
export async function sendPhoneOtp(phone: string): Promise<OtpResult> {
  if (!PHONE_AUTH_ENABLED) {
    return { status: 'failed', message: 'Phone sign-in is not available yet.' };
  }
  const normalised = normalisePhone(phone);
  if (normalised === null) {
    return {
      status: 'failed',
      message: 'That does not look like a phone number.',
    };
  }
  if (AUTH_PHONE_PROVIDER === 'firebase') {
    try {
      await firebaseSendOtp(`+${normalised}`);
      return { status: 'sent' };
    } catch (err) {
      return {
        status: 'failed',
        message: describeOtpError(err instanceof Error ? err.message : ''),
      };
    }
  }
  const { error } = await supabase.auth.signInWithOtp({
    phone: `+${normalised}`,
  });
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
    return {
      status: 'failed',
      message: 'That does not look like a phone number.',
    };
  }
  if (AUTH_PHONE_PROVIDER === 'firebase') {
    return verifyFirebasePhone(token);
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
 * The Firebase verify path: confirm the code with Firebase, hand its ID token to
 * the exchange Edge Function for a real Supabase session, install that session,
 * then drop the now-redundant Firebase session. Returns 'signedIn' only after
 * `setSession` resolves, so the App.tsx boot re-read (attempt bump) finds it.
 */
async function verifyFirebasePhone(token: string): Promise<OtpResult> {
  let idToken: string;
  try {
    idToken = await firebaseConfirmOtp(token.trim());
  } catch (err) {
    return {
      status: 'failed',
      message: describeOtpError(err instanceof Error ? err.message : ''),
    };
  }

  let session: { access_token: string; refresh_token: string };
  try {
    const response = await fetch(
      `${ENV.supabaseUrl}/functions/v1/exchange-firebase-token`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          // The function is not JWT-verified (there is no Supabase session yet);
          // the anon key satisfies the platform gateway, and the Firebase ID
          // token in the body is what actually authenticates the caller.
          apikey: ENV.supabaseAnonKey,
          Authorization: `Bearer ${ENV.supabaseAnonKey}`,
        },
        body: JSON.stringify({ idToken }),
      },
    );
    if (!response.ok) {
      return {
        status: 'failed',
        message: 'Could not finish signing in. Please try again.',
      };
    }
    session = (await response.json()) as {
      access_token: string;
      refresh_token: string;
    };
  } catch {
    return {
      status: 'failed',
      message: 'Could not finish signing in. Please try again.',
    };
  }

  if (!session.access_token || !session.refresh_token) {
    return {
      status: 'failed',
      message: 'Could not finish signing in. Please try again.',
    };
  }

  const { error } = await supabase.auth.setSession({
    access_token: session.access_token,
    refresh_token: session.refresh_token,
  });
  if (error != null) {
    return {
      status: 'failed',
      message: 'Could not finish signing in. Please try again.',
    };
  }
  // The Supabase session is the source of truth now; the Firebase one is spent.
  await firebaseSignOut();
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
    return 'That code has expired, send a new one.';
  }
  if (text.includes('invalid') || text.includes('incorrect')) {
    return 'That code is not right. Check the last digits.';
  }
  if (
    text.includes('rate') ||
    text.includes('too many') ||
    text.includes('limit')
  ) {
    return 'Too many attempts. Wait a minute and try again.';
  }
  if (text.includes('sms') || text.includes('provider')) {
    return 'We could not send a code right now. Try Google instead.';
  }
  return 'Could not verify that code. Please try again.';
}

export interface CurrentSessionResult {
  session: Session | null;
  /**
   * True when `session` came back null because the auth server could not be
   * reached to refresh an expired token — not because there is genuinely no
   * stored session (H6, 2026-09-17 audit: "cold launch offline can sign a
   * signed-in member out"). A member who has not opened the app in a while
   * has an access token past its real expiry by the time they cold-launch,
   * so GoTrueClient's own offline-refresh fallback (which only preserves the
   * session within the last ~minute before real expiry, see
   * `@supabase/auth-js`'s `__loadSession`) has nothing left to hand back and
   * genuinely returns `session: null` — indistinguishable, to the caller,
   * from an actual sign-out unless this flag says otherwise.
   */
  retryableError: boolean;
}

export async function currentSession(): Promise<CurrentSessionResult> {
  const { data, error } = await supabase.auth.getSession();
  // A read error (corrupt storage, unreachable auth) is not the same as "no
  // session", but both land the boot on the sign-in screen. Surface the error so
  // a persistent failure is not indistinguishable from a clean sign-out. The
  // session (possibly null) is still returned; the caller routes on it. (audit)
  if (error) {
    reportSwallowed('currentSession', error);
  }
  return {
    session: data.session,
    retryableError: error !== null && isAuthRetryableFetchError(error),
  };
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
 * How a Google sign-in attempt ended.
 *
 * Two outcomes and not a boolean, because the two live paths differ in the one
 * way that matters to the caller: whether there is a session when this resolves.
 *
 *   `session`    — Credential Manager returned an ID token and Supabase minted a
 *                  session from it. The app is signed in RIGHT NOW.
 *   `redirected` — the system browser was opened. This resolves as soon as the
 *                  browser is up, long before the user has consented, and the
 *                  session arrives later through `handleAuthDeepLink`.
 *
 * A caller that treats `redirected` as success advances to a signed-in tree with
 * no session and every query there hangs. That exact bug has already shipped
 * once here, which is why this is a union and not a `void`.
 */
export type GoogleResult = 'session' | 'redirected';

export { GoogleCredentialError } from '../lib/googleCredential';

/**
 * Why Truecaller is the new primary sign-in.
 *
 * Phone-verified, one-tap, zero OTP, zero SMS cost, and zero Truecaller
 * profile data collected — the server requests only `openid` + `phone`.
 * It replaces Google as the primary CTA because it delivers both Google's
 * "stay in the app" experience and phone-number accountability — which Google
 * cannot provide. WhatsApp OTP is the first fallback (existing path), Google
 * the final fallback (existing wallet/history continuity for pre-Truecaller
 * members and devices without the app).
 */

export { TruecallerOAuthError } from '../lib/truecallerOAuth';

/**
 * How a Truecaller sign-in attempt ended.
 *
 *   'session'   — exchange succeeded, Supabase session installed, signed in.
 *   'no_owner'  — Truecaller verified the phone but no Supabase user owns it.
 *                 The caller receives the opaque challenge and must ask the
 *                 member "New here?" or "Already use Google?" before proceeding.
 *
 * Cancellation and unavailability throw TruecallerOAuthError (not a result).
 */
export type TruecallerResult =
  | { status: 'session' }
  | { status: 'no_owner'; challenge: string };

const TRUECALLER_GOOGLE_LINK_KEY = 'auth.truecallerGoogleLink';
const TRUECALLER_CHALLENGE_TTL_MS = 10 * 60 * 1000;

/**
 * Persist only the opaque, one-time server challenge while browser Google OAuth
 * leaves the app. The verified phone/subject never enter JS storage. The record
 * expires with the server-side challenge and is removed on every terminal path.
 */
export function stageTruecallerGoogleLink(challenge: string): void {
  storage.set(
    TRUECALLER_GOOGLE_LINK_KEY,
    serializePendingTruecallerGoogleLink(
      challenge,
      Date.now() + TRUECALLER_CHALLENGE_TTL_MS,
    ),
  );
}

function pendingTruecallerGoogleLink(): string | null {
  const raw = storage.get(TRUECALLER_GOOGLE_LINK_KEY);
  const pending = parsePendingTruecallerGoogleLink(raw, Date.now());
  if (pending !== null) return pending.challenge;
  storage.remove(TRUECALLER_GOOGLE_LINK_KEY);
  return null;
}

export function clearPendingTruecallerGoogleLink(): void {
  storage.remove(TRUECALLER_GOOGLE_LINK_KEY);
}

/**
 * Sign in with Truecaller: consent sheet → server PKCE exchange →
 * verified-phone account resolution → Supabase session.
 *
 * Throws TruecallerOAuthError on cancellation (`reason: 'cancelled'`),
 * unavailability (`reason: 'unavailable'`), or hard failure (`reason: 'failed'`).
 *
 * Cancellation must never be shown to the user — it is a deliberate choice,
 * not an error. Unavailability should route silently to WhatsApp OTP.
 */
export async function signInWithTruecaller(): Promise<TruecallerResult> {
  // Get the authorization code + PKCE verifier from the native SDK.
  const { authorizationCode, codeVerifier } = await requestTruecallerAuth();

  // Exchange on the server: Truecaller token endpoint → userinfo → identity resolution.
  let response: Response;
  try {
    response = await fetch(
      `${ENV.supabaseUrl}/functions/v1/exchange-truecaller-code`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: ENV.supabaseAnonKey,
          Authorization: `Bearer ${ENV.supabaseAnonKey}`,
        },
        body: JSON.stringify({ authorizationCode, codeVerifier }),
      },
    );
  } catch {
    throw new TruecallerOAuthError('failed', 'Could not reach the sign-in server.');
  }

  if (!response.ok) {
    throw new TruecallerOAuthError(
      'failed',
      'Could not complete Truecaller sign-in. Please try again.',
    );
  }

  const outcome = parseTruecallerExchange(await response.json());

  // No-owner: first time this phone number appears on Pappal.
  if (outcome.status === 'no_owner') {
    return { status: 'no_owner', challenge: outcome.challenge };
  }

  // Matched user: install the session.
  if (outcome.status === 'session') {
    const { error } = await supabase.auth.setSession({
      access_token: outcome.accessToken,
      refresh_token: outcome.refreshToken,
    });
    if (error != null) {
      throw new TruecallerOAuthError('failed', 'Could not complete sign-in. Please try again.');
    }
    return { status: 'session' };
  }

  throw new TruecallerOAuthError('failed', 'Unexpected response from the sign-in server.');
}

/**
 * Confirm a "New here?" continuity choice: consume the pending challenge and
 * create a Supabase account for the verified Truecaller phone.
 */
export async function confirmTruecallerNewUser(challenge: string): Promise<void> {
  let response: Response;
  try {
    response = await fetch(
      `${ENV.supabaseUrl}/functions/v1/truecaller-confirm-new-user`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: ENV.supabaseAnonKey,
          Authorization: `Bearer ${ENV.supabaseAnonKey}`,
        },
        body: JSON.stringify({ challenge }),
      },
    );
  } catch {
    throw new TruecallerOAuthError('failed', 'Could not reach the sign-in server.');
  }
  if (!response.ok) {
    throw new TruecallerOAuthError('failed', 'Could not create your account. Please try again.');
  }
  const outcome = parseTruecallerExchange(await response.json());
  if (outcome.status === 'session') {
    const { error } = await supabase.auth.setSession({
      access_token: outcome.accessToken,
      refresh_token: outcome.refreshToken,
    });
    if (error != null) {
      throw new TruecallerOAuthError('failed', 'Could not complete sign-in. Please try again.');
    }
    return;
  }
  throw new TruecallerOAuthError(
    'failed',
    'Unexpected response while creating your account.',
  );
}

/**
 * Link a Truecaller identity to the currently signed-in Google account.
 * The `challenge` must come from a prior `signInWithTruecaller()` no-owner result.
 */
export async function linkTruecallerToCurrentAccount(challenge: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new TruecallerOAuthError('failed', 'You must be signed in to link accounts.');
  let response: Response;
  try {
    response = await fetch(
      `${ENV.supabaseUrl}/functions/v1/truecaller-link-account`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          apikey: ENV.supabaseAnonKey,
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({ challenge }),
      },
    );
  } catch {
    throw new TruecallerOAuthError('failed', 'Could not reach the sign-in server.');
  }
  if (!response.ok) {
    throw new TruecallerOAuthError('failed', 'Could not link your account. Please try again.');
  }
}

/**
 * Sign in with Google: Credential Manager's explicit-button flow, falling back
 * to the browser.
 *
 * The seam exists so the onboarding screen never learns which mechanism ran.
 * Credential Manager is tried first because it keeps the user
 * inside the app — the only step of the onboarding that used to leave it — and
 * because it returns a session synchronously, so the flow can carry straight on
 * to the completion beat instead of waiting on a deep link.
 *
 * **Cancellation propagates; everything else falls back.** Somebody dismissing
 * the sheet has made a decision, and reopening the browser underneath them would
 * override it. Every other failure — no Play services, stale Play services, an
 * unregistered signing certificate — is the device being unable to show a sheet,
 * not the user declining, and the browser handles all of them.
 *
 * The nonce is checked: `skip_nonce_check = false` in `supabase/config.toml`.
 * Google embedded the SHA-256 in the token and Supabase is handed the original,
 * which is why the native side returns both.
 */
export async function signInWithGoogle(): Promise<GoogleResult> {
  if (CREDENTIAL_MANAGER_ENABLED && credentialSheetAvailable()) {
    try {
      const { idToken, rawNonce } = await requestGoogleCredential();
      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
        nonce: rawNonce,
      });
      if (error != null) {
        // `null` code: this is not an OAuth callback, so there is no `error=`
        // parameter to interpret — only Supabase's own message.
        throw new Error(describeCallbackError(null, error.message));
      }
      return 'session';
    } catch (error) {
      if (
        error instanceof GoogleCredentialError &&
        error.reason === 'cancelled'
      ) {
        throw error;
      }
      if (!(error instanceof GoogleCredentialError)) {
        // Supabase rejected a token the sheet produced. That is a real failure
        // and retrying it through the browser would fail the same way, so it is
        // surfaced rather than swallowed by the fallback below.
        throw error;
      }
      // Fall through to the browser.
    }
  }
  await signInWith('google');
  return 'redirected';
}

/**
 * The three things an OAuth callback can mean. A boolean could not express the
 * middle one, which is exactly the bug this replaced: an `error=` callback was
 * reported as `true` ("handled"), the app advanced to the signed-in tree with no
 * session, and every query there hung, producing a permanent spinner and no
 * clue why. Observed end-to-end on an emulator: Supabase returned
 * `error=server_error, Unable to exchange external code`, and the app showed a
 * blank loading screen.
 */
export type AuthCallbackResult =
  | { status: 'ignored' }
  | { status: 'signedIn' }
  | { status: 'failed'; message: string };

/** Maps Supabase/Google callback errors onto something a person can act on. */
function describeCallbackError(
  code: string | null,
  description: string | null,
): string {
  const detail = (description ?? '').replace(/\+/g, ' ');
  if (/Unable to exchange external code/i.test(detail)) {
    // The provider accepted the user and rejected us. Almost always a client
    // secret that does not match the client id it is paired with.
    return 'Sign-in is misconfigured on our side. Nothing you did wrong, we are on it.';
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
export async function handleAuthDeepLink(
  url: string,
): Promise<AuthCallbackResult> {
  const e2eUrl = 'companionchat://e2e-auth';
  if (
    url === e2eUrl ||
    url.startsWith(`${e2eUrl}?`) ||
    url.startsWith(`${e2eUrl}#`)
  ) {
    // Maestro cannot automate Google/Facebook system-owned OAuth UI. A local
    // harness may inject a short-lived Supabase session through this private
    // deep link; production builds categorically ignore it.
    if (!__DEV__) {
      return { status: 'ignored' };
    }
    const raw = url.slice(e2eUrl.length).replace(/^[?#]/, '');
    const params = new URLSearchParams(raw);
    const accessToken = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    if (accessToken == null || refreshToken == null) {
      return {
        status: 'failed',
        message: 'The local test session is incomplete.',
      };
    }
    const { error } = await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
    return error == null
      ? { status: 'signedIn' }
      : {
          status: 'failed',
          message: 'Could not install the local test session.',
        };
  }

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
    // A staged Truecaller→Google link belongs to this one OAuth attempt. If
    // Google denies/fails it, leaving the challenge in MMKV would let a later,
    // unrelated Google sign-in consume it and bind the abandoned Truecaller
    // identity to the wrong account.
    clearPendingTruecallerGoogleLink();
    return {
      status: 'failed',
      message: describeCallbackError(error, params.get('error_description')),
    };
  }

  const code = params.get('code');
  if (code == null) {
    clearPendingTruecallerGoogleLink();
    return {
      status: 'failed',
      message: 'The sign-in response was incomplete. Please try again.',
    };
  }

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(
    code,
  );
  if (exchangeError) {
    clearPendingTruecallerGoogleLink();
    return {
      status: 'failed',
      message: 'Could not finish signing in. Please try again.',
    };
  }

  // Browser Google fallback for a pending Truecaller continuity link. The
  // onboarding screen was unmounted while the browser owned focus, so the
  // opaque challenge was staged in MMKV. Link before reporting signedIn; if
  // linking fails, sign back out so App.tsx never enters a Google session whose
  // Truecaller identity was silently lost.
  const pendingChallenge = pendingTruecallerGoogleLink();
  if (pendingChallenge !== null) {
    try {
      await linkTruecallerToCurrentAccount(pendingChallenge);
      clearPendingTruecallerGoogleLink();
    } catch {
      clearPendingTruecallerGoogleLink();
      await supabase.auth.signOut();
      return {
        status: 'failed',
        message: 'Google sign-in worked, but we could not link your verified number. Please retry.',
      };
    }
  }
  return { status: 'signedIn' };
}

export async function signOut(): Promise<void> {
  clearPendingTruecallerGoogleLink();
  // Two independent sessions can exist after a Firebase phone sign-in — the
  // Supabase one the app runs on, and a Firebase one that is normally already
  // dropped at verify time. Sign both out so a stale Firebase session can never
  // silently re-mint a Supabase session on a later exchange.
  await firebaseSignOut();
  await supabase.auth.signOut();
}

/**
 * Play Store "Data deletion" requirement: one atomic server-side delete of the
 * auth user, which cascades to profile -> conversations -> messages.
 *
 * One thing survives, deliberately: abuse reports, de-identified. See the
 * retention note in migration 005, a report has to outlive the reported
 * message, or deleting your account destroys the case against you.
 */
export async function deleteAccount(): Promise<void> {
  const { error } = await supabase.rpc('delete_user_account');
  if (error) {
    throw new Error(error.message);
  }
  await firebaseSignOut();
  await supabase.auth.signOut();
}
