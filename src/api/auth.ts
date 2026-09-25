import { Linking } from 'react-native';
import { isAuthRetryableFetchError, type Session } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { SESSION_STORAGE_KEY, signOutClient, supabase } from '../lib/supabase';
import type { Database } from '../lib/database.types';
import { clearAllConversations } from '../lib/conversations';
import { clearOutbox } from '../lib/outboxStore';
import { resetViewingSignals } from '../lib/viewingConversation';
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
import {
  AUTH_REDIRECT_URL,
  ENV,
  TRUECALLER_LINK_REDIRECT_URL,
} from '../lib/env';
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
import { signedInOnDevice, storedAccountId, stopPush, unregisterPush } from '../lib/push';
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
  await afterPendingSignOut();
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
  await afterPendingSignOut();
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
export async function signInWith(
  provider: SocialProvider,
  redirectTo: string = AUTH_REDIRECT_URL,
): Promise<void> {
  await afterPendingSignOut();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: { redirectTo, skipBrowserRedirect: true },
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

interface PendingTruecallerGoogleLinkState {
  readonly challenge: string | null;
  readonly hadRecord: boolean;
}

function pendingTruecallerGoogleLink(): PendingTruecallerGoogleLinkState {
  const raw = storage.get(TRUECALLER_GOOGLE_LINK_KEY);
  if (raw === null) {
    return { challenge: null, hadRecord: false };
  }
  const pending = parsePendingTruecallerGoogleLink(raw, Date.now());
  if (pending !== null) {
    return { challenge: pending.challenge, hadRecord: true };
  }
  storage.remove(TRUECALLER_GOOGLE_LINK_KEY);
  return { challenge: null, hadRecord: true };
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
  await afterPendingSignOut();
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
  await afterPendingSignOut();
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
export async function signInWithGoogle(options?: {
  readonly truecallerLink?: boolean;
}): Promise<GoogleResult> {
  await afterPendingSignOut();
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
  await signInWith(
    'google',
    options?.truecallerLink === true
      ? TRUECALLER_LINK_REDIRECT_URL
      : AUTH_REDIRECT_URL,
  );
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
  await afterPendingSignOut();
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
  const isTruecallerLinkCallback = url.startsWith(
    TRUECALLER_LINK_REDIRECT_URL,
  );
  const callbackBase = isTruecallerLinkCallback
    ? TRUECALLER_LINK_REDIRECT_URL
    : AUTH_REDIRECT_URL;
  const raw = url.slice(callbackBase.length).replace(/^[?#]/, '');
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
  const pendingLink = pendingTruecallerGoogleLink();
  if (!isTruecallerLinkCallback) {
    // This is an ordinary Google sign-in. A pending challenge means a previous
    // Truecaller-link browser attempt was abandoned without a callback. Clear
    // it rather than binding that identity to this unrelated Google session.
    if (pendingLink.hadRecord) {
      clearPendingTruecallerGoogleLink();
    }
    return { status: 'signedIn' };
  }
  if (pendingLink.hadRecord && pendingLink.challenge === null) {
    // This Google callback belongs to an explicit Truecaller-link attempt, but
    // the opaque challenge expired while the browser was open. Do not silently
    // enter Google-only state: that would make later Truecaller sign-ins look
    // unowned again. Remove the fresh session and require a new Truecaller proof.
    // Through `signOut`, like every take-back below: local scope, on a client
    // of its own, and tracked (see the sign-out notes). The bare
    // `supabase.auth.signOut()` is auth-js's GLOBAL scope, which revoked every
    // session of that Google account, on every device, over a failed link.
    await signOut();
    return {
      status: 'failed',
      message:
        'Your verified-number link expired while signing in. Start with Truecaller again.',
    };
  }
  if (pendingLink.challenge !== null) {
    try {
      await linkTruecallerToCurrentAccount(pendingLink.challenge);
      clearPendingTruecallerGoogleLink();
      return { status: 'signedIn' };
    } catch {
      clearPendingTruecallerGoogleLink();
      await signOut();
      return {
        status: 'failed',
        message: 'Google sign-in worked, but we could not link your verified number. Please retry.',
      };
    }
  }
  // A marked link callback without a staged challenge cannot be trusted to
  // identify what Truecaller proof it belongs to.
  await signOut();
  return {
    status: 'failed',
    message: 'The verified-number link was not found. Start with Truecaller again.',
  };
}

/*
 * Sign-out, in two halves: the device first, then the server.
 *
 * The DEVICE half is the stored session going, and it is the first thing a
 * sign-out does, synchronously, before any await. It used to be the last:
 * auth-js removes the stored session only after `/logout` returns
 * (`_signOut` calls `admin.signOut`, then `_removeSession`), and this app ran
 * the push teardown before even that, so the session sat in MMKV for as long
 * as the network took, up to STOP_DRAIN_MS plus two 30 s request ceilings. A
 * person who tapped Sign out and swiped the app away in that window launched
 * straight back into the account they had just left. MMKV is synchronous
 * (src/lib/storage.ts), so removing the key is done the moment it is called;
 * `supabase.auth.signOut({ scope: 'local' })` then finds nothing stored, makes
 * no request, and does the rest of auth-js's local clean-up (the PKCE
 * verifiers, SIGNED_OUT to every listener). A refresh already on the wire
 * sees the key gone and discards what it got back (auth-js's commit guard in
 * `_callRefreshToken`). This half also takes the account's notifications and
 * shortcuts off the device and forgets the chat and ring signals.
 *
 * The SERVER half needs the old account's identity: the push_tokens row is
 * deleted as that account (unregister_push_token, migration 143), and
 * `/logout` revokes its session. Both
 * run on a client of their own that holds the dropped session in memory
 * (`signOutClient`), never on the app's client, which may by then hold the
 * next account's session: ending the old session through the app's client is
 * what ended new ones, because the stale call removed whatever session was
 * stored when it returned. `/logout` is scoped to that one session
 * (`scope: 'local'`), not every session of the user as the bare `signOut()`
 * default does: a person who signs straight back into the same account would
 * otherwise have the new session revoked by the old sign-out's request
 * arriving after it. Signing out on this device no longer signs the same
 * account out on another; that is the deviation, stated.
 *
 * Until the server half is done, the dropped session is kept under
 * PENDING_SIGN_OUT_KEY, so a process that dies first finishes it on the next
 * launch (`resumePendingSignOuts`), or at the next push that reaches the
 * phone (`finishPendingSignOuts`, from `handleBackgroundPush`); otherwise the
 * push row would keep delivering the old account's messages to a signed-out
 * phone. Delivering, not showing: both push handlers post nothing while no
 * session is stored. It is the same credential MMKV held a moment before,
 * under another name, for as long as the requests take.
 *
 * So a sign-in waits only for the device half (`afterPendingSignOut`), which
 * makes no request and is over in a few native calls. It used to wait for the
 * whole chain with no cap; now there is nothing slow left to wait for.
 */
let signOutInFlight: Promise<void> = Promise.resolve();

/** Recorded before it runs any step, so a sign-in during it waits for it. */
function trackSignOut(run: Promise<void>): void {
  const previous = signOutInFlight;
  signOutInFlight = Promise.all([previous, run.catch(() => undefined)]).then(
    () => undefined,
  );
}

/** Held by every sign-in entry point before it starts a session. */
async function afterPendingSignOut(): Promise<void> {
  await signOutInFlight;
}

/** Dropped sessions whose server half has not finished, oldest first. */
const PENDING_SIGN_OUT_KEY = 'auth.pendingSignOut';

interface PendingSignOut {
  /** The stored session exactly as auth-js wrote it. */
  readonly session: string;
  /** Whether this device's push registration still has to be revoked. */
  readonly push: boolean;
  /** When it was dropped (ms), for the age cap below. Absent on older entries. */
  readonly at?: number;
}

/*
 * How long a dropped session's tokens stay on the device waiting for the
 * server half. A phone that stays offline used to keep a live, reusable
 * credential on disk indefinitely after a "sign out". Past this it is thrown
 * away unfinished: the server session then lapses on its own rather than
 * being ended, which is the lesser risk than a stored credential.
 */
const PENDING_SIGN_OUT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function readPending(): PendingSignOut[] {
  const raw = storage.get(PENDING_SIGN_OUT_KEY);
  if (raw === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter(
          (entry): entry is PendingSignOut =>
            typeof entry === 'object' &&
            entry !== null &&
            typeof (entry as PendingSignOut).session === 'string' &&
            typeof (entry as PendingSignOut).push === 'boolean' &&
            !(
              typeof (entry as PendingSignOut).at === 'number' &&
              Date.now() - ((entry as PendingSignOut).at as number) > PENDING_SIGN_OUT_MAX_AGE_MS
            ),
        )
      : [];
  } catch {
    return [];
  }
}

function writePending(entries: readonly PendingSignOut[]): void {
  if (entries.length === 0) {
    storage.remove(PENDING_SIGN_OUT_KEY);
  } else {
    storage.set(PENDING_SIGN_OUT_KEY, JSON.stringify(entries));
  }
}

function forgetPending(entry: PendingSignOut): void {
  writePending(readPending().filter(other => other.session !== entry.session));
}

/** The entry's push half is done; a retry has only the session to end. */
function markPushDone(entry: PendingSignOut): void {
  writePending(
    readPending().map(other =>
      other.session === entry.session ? { session: other.session, push: false, at: other.at } : other,
    ),
  );
}

/**
 * The device half. Everything before the first `await` runs the moment this
 * is called, which is the point: from then on no launch finds the session.
 * `remember` keeps the dropped session for the server half; account deletion
 * passes false, since there is no session left on the server to end.
 */
function leaveDevice(remember: { push: boolean } | null): {
  local: Promise<void>;
  pending: PendingSignOut | null;
} {
  const stored = storage.get(SESSION_STORAGE_KEY);
  const pending =
    stored !== null && remember !== null ? { session: stored, push: remember.push, at: Date.now() } : null;
  if (pending !== null) {
    writePending([...readPending(), pending]);
  }
  storage.remove(SESSION_STORAGE_KEY);
  // The queued sends are this account's too, and have no owner to be told
  // apart by (outboxStore.ts `clearOutbox`).
  clearOutbox();
  resetViewingSignals();
  clearPendingTruecallerGoogleLink();
  const local = (async () => {
    await clearAllConversations();
    // Two independent sessions can exist after a Firebase phone sign-in — the
    // Supabase one the app runs on, and a Firebase one that is normally already
    // dropped at verify time. Sign both out so a stale Firebase session can never
    // silently re-mint a Supabase session on a later exchange.
    await firebaseSignOut();
    // Nothing is stored any more, so this makes no request (see above).
    await supabase.auth.signOut({ scope: 'local' });
  })();
  return { local, pending };
}

/** The stored session's two tokens, or null for anything that is not one. */
function tokensOf(entry: PendingSignOut): { access_token: string; refresh_token: string } | null {
  try {
    const parsed = JSON.parse(entry.session) as { access_token?: unknown; refresh_token?: unknown };
    return typeof parsed.access_token === 'string' && typeof parsed.refresh_token === 'string'
      ? { access_token: parsed.access_token, refresh_token: parsed.refresh_token }
      : null;
  } catch {
    return null;
  }
}

/**
 * The server half's client, authenticated as the dropped session, or null
 * when it cannot be (no session, or the server refused it). `setSession`
 * refreshes an access token that has already expired, in that client's memory
 * only, so an old token still gets the delete and the `/logout` through.
 */
async function authenticateAs(entry: PendingSignOut): Promise<SupabaseClient<Database> | null> {
  const tokens = tokensOf(entry);
  if (tokens === null) {
    return null;
  }
  const client = signOutClient();
  const { error } = await client.auth.setSession(tokens);
  if (error) {
    throw error;
  }
  return client;
}

/**
 * How much of the push registration a server half takes down.
 *
 *   - `device`: all of it (`stopPush`): registration halted, the row deleted
 *     as the old account, the FCM token deleted. Only while nobody is signed
 *     in on this device, because `halt` stops whatever listeners are running
 *     and `deleteToken` revokes whatever token the device holds, both of
 *     which are the next account's once somebody has signed in.
 *   - `account`: only the old account's row, as that account
 *     (`unregisterPush`), for a retry that runs with somebody signed in.
 *   - `none`: nothing; the entry's push half is done, or never started.
 */
type PushHalf = 'device' | 'account' | 'none';

/**
 * The server half: the push registration (`push`), then the session.
 *
 * Kept for the next attempt when it failed on the network, and when the push
 * half did not finish: then `/logout` is not sent at all, because the old
 * session is the only identity that can still delete the old account's row,
 * and a revoked session cannot. That used to be swallowed: a failed token
 * delete and a row delete that matched nothing (migration 143) went on to
 * `/logout`, forgot the entry, and the row kept delivering. A push half that
 * finished is written down (`markPushDone`), so a retry after a failed
 * `/logout` never tears push down twice. A refusal (a session already
 * revoked) is final and is dropped, push half or not: nothing is left that
 * could delete as that account.
 */
async function tellServer(entry: PendingSignOut | null, push: PushHalf): Promise<void> {
  const account = entry === null ? Promise.resolve(null) : authenticateAs(entry);
  // Started now, not after the account resolves: `stopPush` halts
  // registration and sets the teardown `startPush` waits on in its first
  // step, and only its row delete waits for the account.
  const pushDone =
    push === 'device'
      ? stopPush(account.catch(() => null))
      : push === 'account'
        ? unregisterPush(account.catch(() => null))
        : Promise.resolve(true);
  let retry = false;
  try {
    const client = await account;
    const pushed = await pushDone;
    if (entry !== null && push !== 'none' && pushed) {
      markPushDone(entry);
    }
    if (client !== null) {
      if (pushed) {
        const { error } = await client.auth.signOut({ scope: 'local' });
        retry = error !== null && isAuthRetryableFetchError(error);
      } else {
        retry = true;
      }
    }
  } catch (err) {
    const pushed = await pushDone.catch(() => false);
    if (entry !== null && push !== 'none' && pushed) {
      markPushDone(entry);
    }
    // A refused old session is final for /logout, but a device teardown that
    // failed can still be retried without it (its token revoke needs no
    // session), so the entry is kept for that.
    retry = isAuthRetryableFetchError(err) || (!pushed && push === 'device');
    if (!isAuthRetryableFetchError(err)) {
      reportSwallowed('signOut.server', err);
    }
  }
  if (entry !== null && !retry) {
    forgetPending(entry);
  }
}

/**
 * Sign out without the caller waiting. The device half is done when this
 * returns (see above), recorded at once so a sign-in waits for its native
 * steps; the server half, push registration included, runs behind it and is
 * what the returned promise settles on.
 */
export function beginSignOut(): Promise<void> {
  const { local, pending } = leaveDevice({ push: true });
  trackSignOut(local);
  // The whole teardown: the device half has just removed the only session
  // stored, so nobody is signed in to take it from.
  const server = trackServerHalf(tellServer(pending, 'device'));
  return Promise.all([local, server]).then(() => undefined);
}

/**
 * The same sign-out without the push teardown, for a session that never got
 * that far: a Google session a failed Truecaller link has to take back
 * (OnboardingScreen).
 */
export function signOut(): Promise<void> {
  const { local, pending } = leaveDevice({ push: false });
  trackSignOut(local);
  const server = trackServerHalf(tellServer(pending, 'none'));
  return Promise.all([local, server]).then(() => undefined);
}

/**
 * Every server half this process has started, settled or not. A retry waits
 * for them before it reads the pending list, so it never runs the same
 * entry's `/logout` and row delete a second time while the first is still on
 * the wire. Never rejects.
 */
let serverHalves: Promise<void> = Promise.resolve();

function trackServerHalf(run: Promise<void>): Promise<void> {
  serverHalves = Promise.all([serverHalves, run.catch(() => undefined)]).then(() => undefined);
  return run;
}

/** The retry running now, if one is; a second caller shares it. */
let finishing: Promise<void> | null = null;

/**
 * Finish the server half of every sign-out still pending, oldest first, one
 * at a time. Not latched: the FCM background handler calls it on every push
 * that reaches a phone with nobody signed in (`handleBackgroundPush` in
 * src/lib/push.ts), which is exactly the phone whose push row a failed server
 * half left behind, and a headless process never mounts the boot effect that
 * calls `resumePendingSignOuts`.
 *
 * One at a time because each entry with `push` runs a `stopPush` teardown,
 * and two in parallel raced each other's `deleteToken` against the next
 * sign-in's registration; `stopPush` chains its teardowns for the same
 * reason. A push teardown runs through `stopPush`, so a `startPush` for
 * whoever signs in next waits for it.
 *
 * Whether somebody is signed in is asked again for EVERY entry, after the
 * wait for the halves on the wire, and never taken from the caller. It used
 * to be checked only by whoever triggered the retry: the online listener
 * called this with nobody signed in, it parked on a first attempt still on
 * the wire, somebody signed in and their `startPush` got past its teardown
 * wait, and the retry then ran the full `stopPush`, whose `halt` removed the
 * new account's listeners and whose `deleteToken` revoked its token. With
 * somebody signed in, only the old account's own row is deleted (`account`),
 * which cannot touch theirs. The check is synchronous and `stopPush` sets the
 * teardown in the same step, so a sign-in after it waits for that teardown.
 */
export function finishPendingSignOuts(): Promise<void> {
  if (finishing === null) {
    finishing = (async () => {
      await serverHalves;
      for (const entry of readPending()) {
        // Tracked like every server half, so a sign-out that starts while
        // this retry is on the wire waits for it instead of racing its
        // stopPush and deleteToken.
        await trackServerHalf(tellServer(entry, pushHalfFor(entry)));
      }
    })().finally(() => {
      finishing = null;
    });
  }
  return finishing;
}

/**
 * Which push half an entry still owes, asked at the moment it runs.
 *
 * `account` deletes the old session's row as that session, which is only
 * someone else's row to spare when someone ELSE signed in. The same person
 * signing back in re-registered the same token under the same id, so the
 * row the old session would delete (`where token = ... and user_id =
 * auth.uid()`, migration 143) is the live registration: a flaky sign-out,
 * then a sign-in, then a cold start, and the phone stopped getting that
 * account's pushes. Their push half is done by their own sign-in; only the
 * old session is left to end.
 */
function pushHalfFor(entry: PendingSignOut): PushHalf {
  if (!entry.push) {
    return 'none';
  }
  if (!signedInOnDevice()) {
    return 'device';
  }
  const signedIn = storedAccountId();
  if (signedIn !== null && sessionOwner(entry) === signedIn) {
    markPushDone(entry);
    return 'none';
  }
  return 'account';
}

/** The user a pending entry's session belongs to, or null when it names none. */
function sessionOwner(entry: PendingSignOut): string | null {
  try {
    const id = (JSON.parse(entry.session) as { user?: { id?: unknown } } | null)?.user?.id;
    return typeof id === 'string' ? id : null;
  } catch {
    return null;
  }
}

let resumed = false;

/**
 * Finish the server half of any sign-out a dead process left undone. Once per
 * process, from boot, in the background (`finishPendingSignOuts`).
 */
export function resumePendingSignOuts(): Promise<void> {
  if (resumed) {
    return Promise.resolve();
  }
  resumed = true;
  return finishPendingSignOuts();
}

/**
 * The device half for a session that died on its own: the boot found one
 * stored, and auth-js dropped it when its refresh was refused (revoked on the
 * server, or the account gone). Nothing reached `beginSignOut`, so nothing
 * cleared what the account had left here: its queued sends replayed as
 * whoever signed in next (`useGlobalOutboxDrain`), and its notifications,
 * shortcuts and viewing signals stayed. No server half: the server already
 * refused the session, so there is no `/logout` to send and no identity left
 * to delete its row as. Recorded like any sign-out, so a sign-in waits for it.
 */
export function forgetDeadSession(): Promise<void> {
  const { local } = leaveDevice(null);
  trackSignOut(local);
  return local;
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
  // Only the device half: the user row is gone, and its sessions and push
  // rows went with it (auth.users cascades), so there is nothing left for a
  // `/logout` to end. Recorded like any sign-out, so a sign-in waits for it.
  const { local } = leaveDevice(null);
  trackSignOut(local);
  await local;
}
