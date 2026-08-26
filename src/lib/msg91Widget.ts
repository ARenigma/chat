/**
 * The MSG91 OTP widget, as three REST calls.
 *
 * ## Why this is not `@msg91comm/sendotp-react-native`
 *
 * That package was read before this was written, and its OTP path is exactly the
 * three `fetch` calls below against the same host: `sendOtpMobile`, `verifyOtp`,
 * `retryOtp`, each posting `{widgetId, tokenAuth, ...body}`. Nothing in the OTP
 * flow is native.
 *
 * What the package does bring is a `BiometricAuth` native module that has
 * nothing to do with OTP, plus a `react-native.config.js` that autolinks it. Its
 * `android/build.gradle` declares its own AGP 8.1.0 classpath, pins
 * `compileSdkVersion 34`, and asks for `com.facebook.react:react-native` with no
 * version, which does not resolve on React Native 0.86. It also ships
 * untranspiled TypeScript as `main`, and its `DefaultWidget` is a second design
 * system: its own modal, theme, and country picker.
 *
 * So the trade was a broken Android build and a foreign UI, against writing three
 * fetches. ADR-0009 §8 records the decision.
 *
 * ## What this deliberately does not do
 *
 * It does not decide anything. No retry policy, no expiry, no phone formatting,
 * no user-facing copy. It reports what MSG91 said, and `src/api/phone.ts` decides
 * what that means. MSG91 puts failures inside HTTP 200 with `type: 'error'`, the
 * same trap `send-sms` and `verify-phone` were both written around, so success
 * here has to be proven rather than assumed.
 *
 * ## The trust boundary
 *
 * `tokenAuth` is the widget's *client* token and ships inside the APK, where it
 * can be extracted. That is by design and it is not the server authkey. The
 * access token this returns is worth nothing on its own: `verify-phone` asks
 * MSG91 which number the token belongs to and stamps that number, so a client
 * cannot claim a number it has not held. Never send a phone number to
 * `verify-phone`; send the token.
 */
import { ENV } from './env';

const BASE = 'https://control.msg91.com/api/v5/widget';

/*
 * There is no phone formatter here. MSG91 wants digits with the country code and
 * no plus, which is exactly what `normalisePhone` in src/lib/phone.ts already
 * returns, and a second one would be a converter between two identical formats.
 */

export type WidgetOutcome =
  | { readonly ok: true; readonly reqId: string }
  | { readonly ok: false; readonly reason: WidgetFailure };

export type VerifyOutcome =
  | { readonly ok: true; readonly accessToken: string }
  | { readonly ok: false; readonly reason: WidgetFailure };

/**
 * Closed set, because the caller renders copy per case and a passthrough of
 * MSG91's message would put vendor English in front of a user.
 *
 * `wrong-code` and `expired` are distinguished where MSG91 lets us, because
 * "that code has expired" and "that code is wrong" send someone to different
 * buttons. `not-configured` is separate from `network` so a missing build value
 * is never reported to a user as a connection problem.
 */
export type WidgetFailure =
  | 'not-configured'
  | 'network'
  | 'wrong-code'
  | 'expired'
  | 'too-many'
  | 'rejected';

interface WidgetConfig {
  readonly widgetId: string;
  readonly tokenAuth: string;
}

function config(): WidgetConfig | null {
  if (ENV.msg91WidgetId === '' || ENV.msg91WidgetToken === '') {
    return null;
  }
  return { widgetId: ENV.msg91WidgetId, tokenAuth: ENV.msg91WidgetToken };
}

/** Whether the phone path can run at all in this build. */
export function widgetConfigured(): boolean {
  return config() !== null;
}

/**
 * MSG91's failure text, mapped to something the UI can act on.
 *
 * Matched case-insensitively on substrings rather than on a code, because the
 * widget endpoints return prose. That is fragile by nature, so the default is
 * `rejected` and the copy for it says nothing specific.
 */
function classify(message: string): WidgetFailure {
  const text = message.toLowerCase();
  if (text.includes('expire')) {
    return 'expired';
  }
  if (text.includes('invalid') || text.includes('incorrect') || text.includes('mismatch')) {
    return 'wrong-code';
  }
  if (text.includes('limit') || text.includes('too many') || text.includes('exceed')) {
    return 'too-many';
  }
  return 'rejected';
}

interface WidgetResponse {
  readonly type?: string;
  readonly message?: unknown;
  readonly hasError?: boolean;
}

/**
 * One request, with every way it can go wrong collapsed into `WidgetFailure`.
 *
 * The 8-second timeout exists because the sign-in screen has a 30-second resend
 * countdown: a request still pending when the countdown ends leaves two live
 * attempts and a spinner nobody can cancel.
 */
async function post(path: string, body: Record<string, string>): Promise<WidgetResponse | null> {
  const cfg = config();
  if (cfg === null) {
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(`${BASE}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ widgetId: cfg.widgetId, tokenAuth: cfg.tokenAuth, ...body }),
      signal: controller.signal,
    });
    // Non-2xx still carries a JSON body with the reason, so it is read the same
    // way rather than thrown on status alone.
    return (await response.json()) as WidgetResponse;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * `message` is the request id on success and the reason on failure. The same
 * field, two meanings, which is why nothing else in the app reads it directly.
 */
function messageOf(response: WidgetResponse): string {
  return typeof response.message === 'string' ? response.message : '';
}

function failed(response: WidgetResponse): boolean {
  return response.type === 'error' || response.hasError === true;
}

/** Sends a code. `identifier` is digits only, country code included, no plus. */
export async function sendOtp(identifier: string): Promise<WidgetOutcome> {
  if (!widgetConfigured()) {
    return { ok: false, reason: 'not-configured' };
  }
  const response = await post('sendOtpMobile', { identifier });
  if (response === null) {
    return { ok: false, reason: 'network' };
  }
  if (failed(response)) {
    return { ok: false, reason: classify(messageOf(response)) };
  }
  const reqId = messageOf(response);
  // A success with no request id cannot be verified against later, so it is a
  // failure here rather than a state that strands the code screen.
  return reqId === ''
    ? { ok: false, reason: 'rejected' }
    : { ok: true, reqId };
}

/** Resends against an existing request. `channel` 11 is SMS in MSG91's numbering. */
export async function retryOtp(reqId: string): Promise<WidgetOutcome> {
  if (!widgetConfigured()) {
    return { ok: false, reason: 'not-configured' };
  }
  const response = await post('retryOtp', { reqId, retryChannel: '11' });
  if (response === null) {
    return { ok: false, reason: 'network' };
  }
  if (failed(response)) {
    return { ok: false, reason: classify(messageOf(response)) };
  }
  // A retry keeps the original reqId: MSG91 replies with a confirmation string,
  // not a new id, and overwriting the id with it would break verification.
  return { ok: true, reqId };
}

/**
 * Verifies the code and returns MSG91's access token.
 *
 * The token goes straight to `verify-phone` and is never stored: it is a
 * single-use assertion about one number, and keeping it would only widen where
 * it can leak from.
 */
export async function verifyOtp(reqId: string, otp: string): Promise<VerifyOutcome> {
  if (!widgetConfigured()) {
    return { ok: false, reason: 'not-configured' };
  }
  const response = await post('verifyOtp', { reqId, otp });
  if (response === null) {
    return { ok: false, reason: 'network' };
  }
  if (failed(response)) {
    return { ok: false, reason: classify(messageOf(response)) };
  }
  const accessToken = messageOf(response);
  return accessToken === ''
    ? { ok: false, reason: 'rejected' }
    : { ok: true, accessToken };
}
