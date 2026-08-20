import * as Sentry from '@sentry/react-native';
import { ENV } from './env';

/**
 * Crash reporting that cannot leak a conversation.
 *
 * Two layers, because either alone is insufficient:
 *   1. Structural — whole fields that exist to carry payloads (`request.data`,
 *      `breadcrumb.data`, stack-frame locals, anything keyed like content) are
 *      removed outright.
 *   2. Textual — the free-text fields that remain (`message`,
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

export interface ScrubbableFrame {
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
  // captureMessage, so nothing diagnostic is lost — and free-form prose is
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

export function initSentry(): void {
  Sentry.init({
    dsn: ENV.sentryDsn,
    enabled: ENV.sentryDsn !== '',
    environment: ENV.appEnv,
    sendDefaultPii: false,
    enableCaptureFailedRequests: false,
    tracesSampleRate: 0,
    beforeSend: event => sanitizeSentryEvent(event as ScrubbableEvent) as typeof event,
    beforeBreadcrumb: crumb =>
      sanitizeSentryBreadcrumb(crumb as ScrubbableBreadcrumb) as typeof crumb,
  });
}
