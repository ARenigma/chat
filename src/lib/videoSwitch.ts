/**
 * What a change to the live `calls` row means for the switch-to-video flow
 * (migrations 132/134), as a pure function so it can be tested without a
 * Realtime channel.
 *
 * `seen` carries what this device has already reacted to, so a repeated or
 * re-fetched row (the channel re-subscribes on CHANNEL_ERROR/TIMED_OUT and
 * re-reads the row) never fires an event twice.
 */
export type VideoSwitchResult =
  | 'accepted'
  | 'declined'
  | 'expired'
  | 'insufficient_balance'
  | 'video_disabled';

export interface VideoSwitchRow {
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
  | { kind: 'resolved'; result: VideoSwitchResult };

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
): { seen: VideoSwitchSeen; events: VideoSwitchEvent[] } {
  const events: VideoSwitchEvent[] = [];
  let { requestAt, resolvedAt } = seen;

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
    if (nowMs - Date.parse(row.upgrade_resolved_at) < RESOLUTION_FRESH_MS) {
      events.push({ kind: 'resolved', result: row.upgrade_result });
    }
  }

  return { seen: { requestAt, resolvedAt }, events };
}
