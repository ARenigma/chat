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
import { NativeModules } from 'react-native';
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
export const PAYMENTS_ENABLED = true;

/**
 * Whether the mock-payment flow is available.
 *
 * True in every non-production build so the pay→success→credit→warning loop
 * can be exercised end-to-end without a live UPI rail. The server-side gate
 * (app_flags.mock_payments) is a second, independent guard.
 */
export const MOCK_PAYMENTS = APP_ENV !== 'production';

/**
 * Non-prod Cashfree WebCheckout.
 *
 * True in every non-production build so the Cashfree sandbox can be exercised
 * end-to-end without real money. Production stays behind PAYMENTS_ENABLED and
 * the UCB/KYC enrolment (ADR-0022).
 */
export const CASHFREE_SANDBOX_CHECKOUT = APP_ENV !== 'production';

/**
 * Phone-code (WhatsApp OTP) sign-in: OFF (Amit, 2026-09-24). Sign-in is the
 * Truecaller sheet with Google as the only alternative; the WhatsApp Cloud API
 * credentials were never set in prod, so the code step delivered nothing.
 *
 * Both sendPhoneOtp and verifyPhoneOtp return early while this is false, so
 * the guard cannot be bypassed by adding a button. Flip to true only once the
 * WhatsApp secrets are live AND resolve_phone_owner covers GoTrue phone OTP.
 *
 * The one exception (2026-09-27): debug and `internal` builds open it, from the
 * compile-time BuildConfig.ALLOW_TEST_PHONE_LOGIN, so a cloud test device with
 * no Truecaller and no Google account can sign in with a Supabase TEST number
 * (fixed code, no message sent). Release and closedTest compile it false, so
 * no Play build shows the route.
 */
export const PHONE_AUTH_ENABLED: boolean =
  (NativeModules.WindowChrome?.getConstants?.() as { allowTestPhoneLogin?: boolean } | undefined)
    ?.allowTestPhoneLogin === true;

/**
 * Sentry environment tag, set per build variant via BuildConfig.SENTRY_ENVIRONMENT.
 *
 * Never derived from APP_ENV or __DEV__: `internal` and `closedTest` are release
 * builds where __DEV__ is false, so those flags cannot distinguish them from
 * production. The native constant is the only reliable per-variant signal.
 *
 * debug → "development", internal → "internal",
 * closedTest → "alpha", release → "production".
 *
 * https://docs.sentry.io/platforms/react-native/configuration/options/#environment
 */
export const SENTRY_ENVIRONMENT: string =
  (
    NativeModules.WindowChrome?.getConstants?.() as
      | { sentryEnvironment?: string }
      | undefined
  )?.sentryEnvironment ?? 'development';

/**
 * Build identity for Sentry release tagging.
 * Format: com.companionchat@<versionName>+<versionCode>
 */
const _wc = NativeModules.WindowChrome?.getConstants?.() as
  | { versionName?: string; versionCode?: number }
  | undefined;
export const SENTRY_VERSION_NAME: string = _wc?.versionName ?? '0.0.0';
export const SENTRY_VERSION_CODE: number = _wc?.versionCode ?? 0;


/**
 * Which theme a FRESH INSTALL opens in.
 *
 * Amit, 2026-09-08: "default app at dark mode ... and all this should be in
 * config for easy experimentation". So the value lives here, as one line to
 * flip, rather than buried in `readStoredMode`.
 *
 * `'dark' | 'light' | 'system'`:
 *   'dark'    ships dark regardless of the device setting. The current choice.
 *   'light'   the previous behaviour, kept because it was a documented
 *             deliberate deviation and may be wanted back.
 *   'system'  follow the device, which is what Android's dark-theme guidance
 *             actually recommends.
 *
 * ONLY the fresh-install default. Any explicit choice the member makes is
 * stored in MMKV and always wins — flipping this does not override somebody
 * who has already been to Appearance, and it must not, or the setting would
 * silently undo itself on upgrade.
 *
 * This is deliberately a compile-time constant and NOT an appConfig domain.
 * A runtime-flippable default would mean the very first frame of a cold start
 * waiting on the network to know what colour to be — and the fallback while it
 * waited would be a flash of the wrong theme, which is the one thing a theme
 * default must never do.
 *
 * https://developer.android.com/develop/ui/views/theming/darktheme
 */
export const THEME_DEFAULT_MODE: 'light' | 'dark' | 'system' = 'dark';

/**
 * Whether an unrated provider is shown a manufactured rating and review count.
 *
 * Amit, 2026-09-08: system ratings until a provider has genuine ones. The
 * numbers, the band and the reasoning live in `src/lib/systemRating.ts`; this
 * is the switch.
 *
 * A compile-time constant and NOT an appConfig domain, deliberately, and for
 * the opposite reason to THEME_DEFAULT_MODE above. That one is compile-time
 * because a network round trip would cost a frame. This one is compile-time
 * because it should be hard to flip: turning fabricated social proof on or off
 * for a live marketplace from an admin console, with no build, no review and no
 * commit naming who did it, is not a knob this app should have. Changing it
 * costs a release, which is the correct price.
 */
export const SYSTEM_RATINGS_ENABLED = true;

/**
 * Idle-home provider suggestion campaign (migration 126, Amit 2026-09-20).
 *
 * When a member idles on Home for 10 s, shows up to three sequential "Ravi is
 * calling"-style prompts, one from each of three distinct available providers,
 * 10 s apart. The copy says "{name} is calling" even though the provider did not
 * initiate it. Honesty trade-off: accepted by Amit explicitly (2026-09-20).
 *
 * Compile-time OFF until device verification completes. Flip to true in a
 * release commit once ARTEMIS tests pass on an S22 — same class of decision as
 * SYSTEM_RATINGS_ENABLED.
 */
export const HOME_SUGGESTIONS_ENABLED = false;
