/**
 * What a change to the live `calls` row means for the switch-to-video flow
 * (migrations 132/134), as a pure function so it can be tested without a
 * Realtime channel.
 *
 * `seen` carries what this device has already reacted to, so a repeated or
 * re-fetched row (the channel re-subscribes on CHANNEL_ERROR/TIMED_OUT and
 * re-reads the row) never fires an event twice.
 */
import type { CallMedium } from './database.types';

export type VideoSwitchResult =
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'insufficient_balance'
  | 'video_disabled'
  | 'session_ended';

export interface VideoSwitchRow {
  medium?: CallMedium;
  upgrade_requested_by: string | null;
  upgrade_requested_at: string | null;
  upgrade_result: VideoSwitchResult | null;
  upgrade_resolved_at: string | null;
}

export interface VideoSwitchSeen {
  requestAt: string | null;
  resolvedAt: string | null;
}

export type VideoSwitchEvent =
  | { kind: 'request'; requestedBy: string }
  | { kind: 'resolved'; result: VideoSwitchResult; resolvedAt: string };

/** A request older than this has expired server-side (132: 30 s). */
export const VIDEO_SWITCH_REQUEST_TTL_MS = 30_000;
/** A resolution older than this is history, not news. */
const RESOLUTION_FRESH_MS = 60_000;

/** True when `candidate` is strictly later than `seen` (null = never seen). */
const isNewer = (candidate: string, seen: string | null) =>
  seen === null || Date.parse(candidate) > Date.parse(seen);

export function videoSwitchEvents(
  seen: VideoSwitchSeen,
  row: VideoSwitchRow,
  selfId: string,
  nowMs: number,
): { seen: VideoSwitchSeen; events: VideoSwitchEvent[]; medium: CallMedium | null } {
  const events: VideoSwitchEvent[] = [];
  let { requestAt, resolvedAt } = seen;

  /*
   * The server's medium, when this row can be trusted to carry it. Every
   * server-side medium change (an accept, 136's fall back to voice) stamps
   * upgrade_resolved_at in the same UPDATE, so a row at least as new as the
   * latest outcome seen holds the current medium. Not limited to fresh
   * outcomes: a screen subscribing long after an accept still adopts video.
   * A row with no resolution (a pending request) cannot be ordered and says
   * nothing about the medium.
   */
  const medium =
    row.medium !== undefined &&
    row.upgrade_resolved_at !== null &&
    (resolvedAt === null || Date.parse(row.upgrade_resolved_at) >= Date.parse(resolvedAt))
      ? row.medium
      : null;

  if (
    row.upgrade_requested_by !== null &&
    row.upgrade_requested_at !== null &&
    // Strictly newer, not merely different: a re-read that began during a
    // reconnect can land after a newer UPDATE and must not replay the past.
    isNewer(row.upgrade_requested_at, requestAt)
  ) {
    requestAt = row.upgrade_requested_at;
    const age = nowMs - Date.parse(row.upgrade_requested_at);
    // Already resolved: an outcome at or after this request was seen first
    // (a late read of the pending row), so there is nothing left to answer.
    const alreadyResolved =
      resolvedAt !== null && Date.parse(resolvedAt) >= Date.parse(row.upgrade_requested_at);
    if (
      row.upgrade_requested_by !== selfId &&
      age < VIDEO_SWITCH_REQUEST_TTL_MS &&
      !alreadyResolved
    ) {
      events.push({ kind: 'request', requestedBy: row.upgrade_requested_by });
    }
  }

  if (
    row.upgrade_result !== null &&
    row.upgrade_resolved_at !== null &&
    isNewer(row.upgrade_resolved_at, resolvedAt)
  ) {
    resolvedAt = row.upgrade_resolved_at;
    // An outcome older than the latest request answers an EARLIER request (a
    // late re-read of a decline landing after the member asked again). The
    // server clears upgrade_requested_at on resolution, so order is the only
    // link between an outcome and its request.
    const answersAnOlderRequest =
      requestAt !== null && Date.parse(row.upgrade_resolved_at) < Date.parse(requestAt);
    if (
      nowMs - Date.parse(row.upgrade_resolved_at) < RESOLUTION_FRESH_MS &&
      !answersAnOlderRequest
    ) {
      events.push({ kind: 'resolved', result: row.upgrade_result, resolvedAt: row.upgrade_resolved_at });
    }
  }

  return { seen: { requestAt, resolvedAt }, events, medium };
}
