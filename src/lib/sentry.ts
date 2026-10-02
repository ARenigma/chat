import * as Sentry from '@sentry/react-native';
import {
  mobileReplayIntegration,
  reactNavigationIntegration,
} from '@sentry/react-native';
import { ENV } from './env';
import {
  SENTRY_ENVIRONMENT,
  SENTRY_VERSION_CODE,
  SENTRY_VERSION_NAME,
} from '../config';

/**
 * Crash reporting that cannot leak a conversation.
 *
 * Two layers, because either alone is insufficient:
 *   1. Structural, whole fields that exist to carry payloads (`request.data`,
 *      `breadcrumb.data`, stack-frame locals, anything keyed like content) are
 *      removed outright.
 *   2. Textual, the free-text fields that remain (`message`,
 *      `exception.value`) are run through `scrubText`, which strips emails,
 *      IPs, phone numbers and bearer/JWT credentials.
 *
 * The types below are structural on purpose: the sanitiser is pure and unit
 * tested without instantiating the SDK. `sanitizeSentryEvent` is the only thing
 * standing between a stack trace and a user's private words, so it is tested
 * directly rather than through Sentry.
 */

export const REDACTED = '[redacted]';

export interface ScrubbableBreadcrumb {
  type?: string;
  category?: string;
  level?: string;
  timestamp?: number;
  message?: string;
  data?: Record<string, unknown>;
}

interface ScrubbableFrame {
  vars?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface ScrubbableEvent {
  message?: string | { formatted?: string; message?: string };
  server_name?: string;
  user?: {
    id?: string;
    email?: string;
    ip_address?: string;
    username?: string;
    phone?: string;
    [key: string]: unknown;
  } | null;
  request?: {
    method?: string;
    url?: string;
    headers?: Record<string, string>;
    cookies?: unknown;
    data?: unknown;
    query_string?: unknown;
    env?: unknown;
  };
  extra?: Record<string, unknown>;
  tags?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  breadcrumbs?: ScrubbableBreadcrumb[];
  exception?: {
    values?: Array<{
      type?: string;
      value?: string;
      stacktrace?: { frames?: ScrubbableFrame[] };
    }>;
  };
}

/** Keys whose values are assumed to be user content and are never sent. */
const CONTENT_KEY = /(message|content|prompt|completion|reply|answer|text|input|query|body|transcript|persona|username|email|phone|password|secret|apikey|api_key|authorization)/i;

const PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\b/g, REDACTED], // JWT
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, `Bearer ${REDACTED}`],
  [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, REDACTED], // email
  [/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, REDACTED], // IPv4
  [/\b(?:[A-F0-9]{1,4}:){3,7}[A-F0-9]{1,4}\b/gi, REDACTED], // IPv6
  [/\+\d[\d\s()-]{7,}\d/g, REDACTED], // E.164-ish phone
  [/\b[A-Za-z0-9_-]{40,}\b/g, REDACTED], // long opaque credential
];

const MAX_DEPTH = 6;

/** Remove identifiers and credentials from a free-text string. */
export function scrubText(input: string): string {
  let out = input;
  for (const [pattern, replacement] of PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

function stripQuery(url: string | undefined): string | undefined {
  if (url === undefined) {
    return undefined;
  }
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

function scrubValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) {
    return REDACTED;
  }
  if (typeof value === 'string') {
    return scrubText(value);
  }
  if (Array.isArray(value)) {
    return value.map(item => scrubValue(item, depth + 1));
  }
  if (typeof value === 'object' && value !== null) {
    return scrubRecord(value as Record<string, unknown>, depth + 1);
  }
  return value;
}

function scrubRecord(record: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    out[key] = CONTENT_KEY.test(key) ? REDACTED : scrubValue(value, depth);
  }
  return out;
}

/**
 * Breadcrumbs are the highest-risk surface: every `console.log` and every fetch
 * becomes one. Console breadcrumbs lose their text entirely; HTTP breadcrumbs
 * keep only method, de-queried URL and status.
 */
export function sanitizeSentryBreadcrumb(
  crumb: ScrubbableBreadcrumb | null,
): ScrubbableBreadcrumb | null {
  if (!crumb) {
    return crumb;
  }
  const next: ScrubbableBreadcrumb = {
    ...(crumb.type === undefined ? {} : { type: crumb.type }),
    ...(crumb.category === undefined ? {} : { category: crumb.category }),
    ...(crumb.level === undefined ? {} : { level: crumb.level }),
    ...(crumb.timestamp === undefined ? {} : { timestamp: crumb.timestamp }),
  };

  if (crumb.category === 'console') {
    next.message = REDACTED;
    return next;
  }

  if (crumb.message !== undefined) {
    next.message = scrubText(crumb.message);
  }

  if (crumb.category === 'http' && crumb.data) {
    const { method, status_code: status, url } = crumb.data as {
      method?: unknown;
      status_code?: unknown;
      url?: unknown;
    };
    next.data = {
      ...(typeof method === 'string' ? { method } : {}),
      ...(typeof status === 'number' ? { status_code: status } : {}),
      ...(typeof url === 'string' ? { url: stripQuery(url) } : {}),
    };
  }

  return next;
}

/** `beforeSend`. Mutates and returns the event, as the SDK expects. */
export function sanitizeSentryEvent(event: ScrubbableEvent | null): ScrubbableEvent | null {
  if (!event) {
    return event;
  }

  delete event.server_name;

  // Identity: an opaque user id is all we keep.
  event.user = event.user?.id ? { id: event.user.id } : undefined;

  if (event.request) {
    event.request = {
      ...(event.request.method === undefined ? {} : { method: event.request.method }),
      ...(stripQuery(event.request.url) === undefined
        ? {}
        : { url: stripQuery(event.request.url) }),
    };
  }

  // `message` is redacted wholesale rather than scrubbed. This app never calls
  // captureMessage, so nothing diagnostic is lost, and free-form prose is
  // exactly what pattern matching cannot classify. Anything that shows up here
  // came from an integration we did not write and is treated as user content.
  // Exception values survive (scrubbed) because the runtime, not the user,
  // writes them.
  if (event.message !== undefined) {
    event.message = REDACTED;
  }

  if (event.extra) {
    event.extra = scrubRecord(event.extra, 0);
  }
  if (event.tags) {
    event.tags = scrubRecord(event.tags, 0);
  }
  if (event.contexts) {
    event.contexts = scrubRecord(event.contexts, 0);
  }

  for (const value of event.exception?.values ?? []) {
    if (value.value !== undefined) {
      value.value = scrubText(value.value);
    }
    for (const frame of value.stacktrace?.frames ?? []) {
      delete frame.vars; // Locals routinely hold the prompt.
    }
  }

  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs
      .map(sanitizeSentryBreadcrumb)
      .filter((c): c is ScrubbableBreadcrumb => c !== null);
  }

  return event;
}

/**
 * Report a swallowed, non-fatal error with a context tag so a persistent
 * failure on a best-effort path (ring/request recovery, session heartbeat) is
 * visible in Sentry instead of vanishing.
 *
 * Only the error's message and its SQLSTATE `code` are forwarded. A Supabase
 * PostgrestError's `details` can carry row values — a message body, a phone
 * number — and must never leave the device (CLAUDE.md security note), so the
 * raw error object is never handed to Sentry; a fresh Error is. The beforeSend
 * scrubber is a second line of defence, not the first. (2026-09-10 audit)
 */
export function reportSwallowed(context: string, error: unknown): void {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code: unknown }).code)
      : undefined;
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error);
  // The device being offline is not a defect in the path that noticed it.
  // ring/request recovery runs on CHANNEL_ERROR and TIMED_OUT, which is when
  // the network is down, so "Network request failed" was filed as a new error
  // per occurrence (PAPPAL-3/5/6/8/9) and a real failure had to be dug out of
  // them. It still reaches Sentry, at warning level and grouped by context, so
  // a path that never gets through stays visible as a climbing count.
  if (isNetworkFailure(message)) {
    Sentry.captureMessage(`[${context}] network unavailable`, {
      level: 'warning',
      fingerprint: ['network-unavailable', context],
      tags: { context, kind: 'network' },
    });
    return;
  }
  Sentry.captureException(new Error(`[${context}] ${message}`), {
    tags: code !== undefined ? { context, sqlstate: code } : { context },
  });
}

/** fetch's own wording on React Native (TypeError) and the usual timeouts. */
export function isNetworkFailure(message: string): boolean {
  return /network request failed|failed to fetch|network request timed out|the network connection was lost/i.test(
    message,
  );
}

/**
 * The react-navigation integration, created by `initSentry` (not at import, so
 * a module that only needs `reportSwallowed` does not construct an SDK
 * integration) and handed the container from Navigation.tsx's `onReady`.
 * https://docs.sentry.io/platforms/react-native/tracing/instrumentation/react-navigation/
 */
let navIntegration: ReturnType<typeof reactNavigationIntegration> | null = null;

/** Called from the NavigationContainer's onReady: screen spans and TTID by route. */
export function registerSentryNavigation(ref: unknown): void {
  navIntegration?.registerNavigationContainer(ref);
}

export function initSentry(): void {
  // release format must match what the Sentry Gradle plugin uploads:
  // com.companionchat@<versionName>+<versionCode>
  // (verified against the existing Sentry project's releases: 1.4.0+10400 maps to
  // com.companionchat@1.4.0+10400)
  const release = `com.companionchat@${SENTRY_VERSION_NAME}+${SENTRY_VERSION_CODE}`;
  const dist = String(SENTRY_VERSION_CODE);

  Sentry.init({
    dsn: ENV.sentryDsn,
    enabled: ENV.sentryDsn !== '',
    // Environment from per-variant BuildConfig.SENTRY_ENVIRONMENT, never from
    // APP_ENV or __DEV__ (internal and closedTest are release builds).
    // https://docs.sentry.io/platforms/react-native/configuration/options/#environment
    environment: SENTRY_ENVIRONMENT,
    release,
    dist,
    sendDefaultPii: false,
    enableCaptureFailedRequests: false,
    // 20 % trace sample rate on all builds; no profiling (not on the free plan).
    tracesSampleRate: 0.2,
    // Slow/frozen frame measurements attached to every root span.
    // https://docs.sentry.io/platforms/react-native/tracing/instrumentation/slow-and-frozen-frames/
    enableNativeFramesTracking: true,
    // Session replay: off for normal sessions, full capture on any error.
    // https://docs.sentry.io/platforms/react-native/session-replay/
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    // Structured logs via Sentry.logger.*; console.* NOT auto-captured
    // (console output may contain user content).
    // https://docs.sentry.io/platforms/react-native/logs/
    enableLogs: true,
    enableAutoConsoleLogs: false,
    // Only this app's explicit `logEvent` calls: native-origin logs are not
    // ours to vet for content.
    logsOrigin: 'js',
    // Propagate sentry-trace/baggage only to our own edge functions.
    // https://docs.sentry.io/platforms/react-native/tracing/trace-propagation/
    tracePropagationTargets: [/\/functions\/v1\//],
    integrations: [
      (navIntegration = reactNavigationIntegration({
        // Time to initial display: navigation dispatch to the first frame.
        // https://docs.sentry.io/platforms/react-native/tracing/instrumentation/react-navigation/#time-to-initial-display
        enableTimeToInitialDisplay: true,
      })),
      // Mask ALL text, images and vectors in every replay frame so no user
      // content ever reaches Sentry's replay storage.
      mobileReplayIntegration({
        maskAllText: true,
        maskAllImages: true,
        maskAllVectors: true,
      }),
    ],
    beforeSend: event => sanitizeSentryEvent(event as ScrubbableEvent) as typeof event,
    beforeBreadcrumb: crumb =>
      sanitizeSentryBreadcrumb(crumb as ScrubbableBreadcrumb) as typeof crumb,
  });
}

// ---------------------------------------------------------------------------
// Structured event logging
// ---------------------------------------------------------------------------

/**
 * Attribute keys that are allowed to cross the Sentry boundary.
 *
 * Everything else is silently dropped: ids and opaque references are safe;
 * user-visible strings (names, messages) are not. The allowlist is the only
 * thing standing between a logEvent call and accidental PII, so it is enforced
 * mechanically in __tests__/sentryTelemetry.test.ts.
 */
const ALLOWED_ATTR_KEYS = new Set([
  'ids',
  'channel',
  'medium',
  'minutes',
  'tokens',
  'status',
  'reason',
  'durationMs',
]);

type AllowedAttrs = Partial<Record<
  'ids' | 'channel' | 'medium' | 'minutes' | 'tokens' | 'status' | 'reason' | 'durationMs',
  string | number | boolean
>>;

/**
 * Emit a structured telemetry event via Sentry Logs.
 *
 * Only the keys in ALLOWED_ATTR_KEYS reach Sentry; any extra key is dropped
 * without throwing, so a call site cannot accidentally send user content by
 * adding an unreviewed attribute.
 *
 * @param name  Short event name, e.g. 'chat_session_start'.
 * @param attrs Attributes from the ALLOWED_ATTR_KEYS set only.
 */
export function logEvent(name: string, attrs?: AllowedAttrs): void {
  if (!attrs) {
    Sentry.logger.info(name);
    return;
  }
  const safe: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(attrs)) {
    if (ALLOWED_ATTR_KEYS.has(k) && v !== undefined) {
      safe[k] = v as string | number | boolean;
    }
  }
  Sentry.logger.info(name, safe);
}
