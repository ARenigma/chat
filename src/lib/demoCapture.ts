/**
 * Demo-capture gate — JS side.
 *
 * Lifts FLAG_SECURE on the activity window for signed-in dev accounts in the
 * `internal` build variant. Two independent gates must both pass before
 * capture is unblocked:
 *
 *   1. Build variant (compile-time): `BuildConfig.ALLOW_DEV_CAPTURE` is
 *      `true` only in the `internal` variant. The native `setDemoCaptureEnabled`
 *      method short-circuits in `release` before reading `enabled` — the
 *      release APK cannot reach the `clearFlags` branch at all.
 *      https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_SECURE
 *
 *   2. Account (runtime): the signed-in email must end with `@example.test`.
 *      This is the dev-seed domain established in `scripts/seed-dev.sql` and
 *      `scripts/unseed-dev.sql`. No production Supabase project can register
 *      verified users under `.test` TLDs (RFC 2606), so this is a closed set
 *      that cannot accidentally include real members.
 *
 * Call `applyDemoCapturePolicy(email)` on every auth-state change.
 * Pass `null` or `undefined` on sign-out to restore FLAG_SECURE immediately.
 *
 * No-op on iOS (NativeModules.WindowChrome is undefined outside Android).
 */

import { NativeModules, Platform } from 'react-native';

// ---------------------------------------------------------------------------
// Dev-account domain. Must match the email convention in scripts/seed-dev.sql
// (`seed.*@example.test`) and scripts/unseed-dev.sql. Exported so the
// platform test can assert the exact string without duplicating it.
// ---------------------------------------------------------------------------
/** @internal exported only for the platform-test assertion */
const DEV_EMAIL_DOMAIN = '@example.test';

const native = (
  NativeModules as {
    WindowChrome?: {
      setDemoCaptureEnabled: (enabled: boolean) => void;
    };
  }
).WindowChrome;

/**
 * Apply the demo-capture policy for the currently signed-in email.
 *
 * - Pass the user's email to potentially lift FLAG_SECURE (if both gates pass).
 * - Pass `null` or `undefined` (i.e. on sign-out) to restore FLAG_SECURE.
 *
 * The native layer enforces the build-variant gate independently; this
 * function only drives the account check.
 */
export function applyDemoCapturePolicy(email: string | null | undefined): void {
  if (Platform.OS !== 'android' || native?.setDemoCaptureEnabled === undefined) return;
  const isDevAccount = typeof email === 'string' && email.endsWith(DEV_EMAIL_DOMAIN);
  native.setDemoCaptureEnabled(isDevAccount);
}
