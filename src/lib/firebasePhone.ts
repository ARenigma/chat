import {
  getAuth,
  signInWithPhoneNumber,
  signOut,
  type ConfirmationResult,
} from '@react-native-firebase/auth';

/**
 * The Firebase side of phone sign-in, kept to three calls behind one small
 * interface so `src/api/auth.ts` never touches the Firebase SDK directly. Uses
 * the modular RNFB API (the same style index.js uses for messaging).
 *
 * WHY FIREBASE AT ALL. The app already carries Supabase-native phone OTP
 * (`signInWithOtp`/`verifyOtp` + the `send-sms` hook → MSG91/Fast2SMS), and that
 * path still exists behind `AUTH_PHONE_PROVIDER`. Firebase is the *active* path
 * while testing because its daily SMS quota is free and its console test numbers
 * need no carrier, no DLT template and no Play Integrity — the three things
 * blocking the Supabase/MSG91 path today (Amit, 2026-08-27).
 *
 * WHY IT DOES NOT OWN THE SESSION. Firebase issues its own ID token; our RLS
 * rests on a Supabase `auth.uid()` UUID. So Firebase only *proves the number*:
 * the ID token is handed to the `exchange-firebase-token` Edge Function, which
 * mints a real Supabase session. Once that session exists the Firebase session
 * is dead weight and is signed out — see `firebaseSignOut`. This is the same
 * "Supabase stays the only thing that can mint a session" rule the Supabase OTP
 * path was written to keep.
 */

/**
 * The confirmation handle from `signInWithPhoneNumber`, held between the send and
 * verify steps. Module-level because the two are separate calls from the UI and
 * the SDK gives no way to reconstruct it from the code alone. Exactly one is ever
 * in flight; a new send replaces the old.
 */
let pending: ConfirmationResult | null = null;

/** Ask Firebase to send a code to an E.164 number (with the leading +). */
export async function firebaseSendOtp(phoneE164: string): Promise<void> {
  pending = await signInWithPhoneNumber(getAuth(), phoneE164);
}

/**
 * Confirm the typed code and return a fresh Firebase ID token for the exchange.
 * Throws on a wrong/expired code (the caller maps that to a failure result).
 */
export async function firebaseConfirmOtp(code: string): Promise<string> {
  if (pending === null) {
    throw new Error('Send a code first.');
  }
  const credential = await pending.confirm(code);
  const user = credential?.user ?? getAuth().currentUser;
  if (user == null) {
    throw new Error('Could not verify that code.');
  }
  // `false`: the token minted right after phone sign-in is fine; no custom claim
  // is set on the Firebase side (the Supabase session carries the role), so there
  // is nothing to force-refresh for.
  const idToken = await user.getIdToken(false);
  pending = null;
  return idToken;
}

/**
 * Drop the Firebase session once the Supabase session is the source of truth.
 * Best-effort: a failure here does not un-sign-in the user from Supabase, so it
 * is swallowed rather than surfaced.
 */
export async function firebaseSignOut(): Promise<void> {
  try {
    if (getAuth().currentUser != null) {
      await signOut(getAuth());
    }
  } catch {
    // no-op: the Supabase session is what the app runs on.
  }
}
