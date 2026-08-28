/**
 * Central feature-flag config.
 *
 * All build-time flags that gate UI features live here.  A flag that is off in
 * one place should never be on somewhere else, and having one home makes every
 * flip a one-line change with a clear diff.
 *
 * Flags are re-exported from their original locations (calls.ts, rates.ts,
 * auth.ts) so existing imports across the app do not need to change.
 */
import { APP_ENV } from '@env';

/**
 * Calling is ON. The client media layer (WebRTC + Realtime signalling) exists
 * now, so `start_call` no longer rings a phone that can never connect.
 */
export const CALLS_ENABLED = true;

/**
 * The Calls tab in the bottom nav. Separate from CALLS_ENABLED (in-chat call
 * buttons): the tab can be hidden while the call flow itself remains reachable
 * from the chat header. Flip once a call-log screen is production-ready.
 */
export const CALLS_TAB_ENABLED = false;

/**
 * Whether a real payment can be taken.
 *
 * Off until the UPI intent / Play Billing rail is wired. The Recharge screen
 * shows packs and the Pay button, but does not pretend to charge.
 */
export const PAYMENTS_ENABLED = false;

/**
 * Whether the mock-payment flow is available.
 *
 * True in every non-production build so the pay→success→credit→warning loop
 * can be exercised end-to-end without a live UPI rail. The server-side gate
 * (app_flags.mock_payments) is a second, independent guard.
 */
export const MOCK_PAYMENTS = APP_ENV !== 'production';

/**
 * Phone sign-in: implemented, and on (Firebase path). Flip to false when
 * reverting to the Supabase-native path while DLT registration is pending.
 *
 * Turning it off is one step: flip this to false. Both sendPhoneOtp and
 * verifyPhoneOtp return early when false, so the guard cannot be bypassed
 * by adding a button. See auth.ts for the full DLT/SMS note.
 */
export const PHONE_AUTH_ENABLED = true;
