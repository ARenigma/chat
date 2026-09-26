/**
 * Pure URL parsers for Pappal's deep-link scheme.
 *
 * These live here rather than in App.tsx so they can be unit-tested without
 * booting the React Native runtime. App.tsx imports them from here and
 * calls them exactly as it did the inline code before (same behaviour).
 *
 * Parsers always validate the full URL shape and any UUID fields before
 * returning a value, because deep-link URLs are remote input.
 * https://developer.android.com/privacy-and-security/risks/unsafe-use-of-deeplinks
 *
 * Parsed with regex rather than URLSearchParams: Hermes does not ship it.
 */

import { isUuid } from '../ids';
import type { CallMedium } from './types';

// ---------------------------------------------------------------------------
// Chat-V2 seam
// ---------------------------------------------------------------------------

/**
 * Parses the development/internal-only V2 chat deep link.
 *
 * Returns the peer UUID or null. `routeCapabilityEnabled` must be true
 * (`__DEV__ || allowBenchmarkRoutes`); release always returns null.
 *
 * Moved from src/lib/routes.ts.
 */
export function parseChatV2Url(
  url: string,
  routeCapabilityEnabled: boolean,
): string | null {
  if (!routeCapabilityEnabled) {
    return null;
  }
  const peerId = url.match(/^companionchat:\/\/chat-v2\/([^/?#]+)$/)?.[1];
  return peerId !== undefined && isUuid(peerId) ? peerId : null;
}

// ---------------------------------------------------------------------------
// Account-link classification
// ---------------------------------------------------------------------------

/**
 * Whether a deep link opens something that belongs to a signed-in account.
 *
 * App.tsx drops these links when no session is stored instead of holding
 * them for the next sign-in. OAuth callbacks and the call-sim harness link
 * are not account links — the callback is how a session arrives at all.
 *
 * Moved from src/lib/routes.ts.
 */
export function isAccountLink(url: string): boolean {
  return /^companionchat:\/\/(peer|call|chat-v2)\//.test(url);
}

/**
 * Whether an account link may open for `account` (the currently signed-in
 * user id). Links carry `for=<uid>` (migration 143) so a notification for a
 * previous account cannot open a peer inside the next one.
 *
 * A missing `for` param (pre-143 posts, V2 seam) is treated as "mine".
 * A `for` value that is not a UUID is not ours and opens nothing.
 *
 * Moved from src/lib/routes.ts.
 */
export function linkIsForAccount(
  url: string,
  account: string | null,
): boolean {
  const query = url.split('#')[0]?.split('?')[1] ?? '';
  const recipient = query.match(/(?:^|&)for=([^&]*)/)?.[1];
  if (recipient === undefined) {
    return true;
  }
  return isUuid(recipient) && recipient === account;
}

// ---------------------------------------------------------------------------
// Peer link  companionchat://peer/<id>
// ---------------------------------------------------------------------------

/**
 * Parses a conversation notification / launcher-shortcut deep link.
 *
 * Returns the peer UUID or null. A query string is stripped so a
 * harness-augmented URI (e.g. `peer/<id>?for=<uid>`) still routes.
 *
 * Extracted from App.tsx (the same regex and isUuid guard, now a pure fn).
 */
export function parsePeerUrl(url: string): string | null {
  const raw = url.match(/^companionchat:\/\/peer\/(.+)$/)?.[1];
  if (raw === undefined) {
    return null;
  }
  // Strip query string — harness-augmented URIs carry `for=<uid>`.
  const peerId = raw.split('?')[0] ?? raw;
  return isUuid(peerId) ? peerId : null;
}

// ---------------------------------------------------------------------------
// Call link  companionchat://call/<peer>?callId=&action=&medium=
// ---------------------------------------------------------------------------

export type ParsedCall = {
  peerId: string;
  callId: string;
  /** Defaults to 'answer' when the param is absent. */
  action: string;
  /** Defaults to 'voice' when the param is absent (pre-fix notifications). */
  medium: CallMedium;
};

/**
 * Parses a CallStyle notification deep link (Answer / Decline / body tap).
 *
 * Returns null when the URL doesn't match or either UUID is invalid.
 * Extracted from App.tsx (same regexes and defaults, now a pure fn).
 */
export function parseCallUrl(url: string): ParsedCall | null {
  const m = url.match(/^companionchat:\/\/call\/([^?]+)\?(.*)$/);
  if (!m) {
    return null;
  }
  const peerId = m[1] ?? '';
  const qs = m[2] ?? '';
  const callId = qs.match(/callId=([^&]+)/)?.[1];
  if (!isUuid(peerId) || callId === undefined || !isUuid(callId)) {
    return null;
  }
  const action = qs.match(/action=([^&]+)/)?.[1] ?? 'answer';
  // `medium` is sent by callActionIntent since the notification fix. The
  // 'voice' fallback handles a notification posted by an older build.
  const medium = (qs.match(/medium=([^&]+)/)?.[1] ?? 'voice') as CallMedium;
  return { peerId, callId, action, medium };
}
