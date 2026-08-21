/**
 * Which update flow to offer, and whether to ask at all.
 *
 * Kept separate from the native module and free of imports, because this is the
 * only part of in-app updates that can be tested without Google Play. The
 * bridge reports what Play says; every judgement is here.
 *
 * The judgements, in order of how much they matter:
 *
 *   1. **Flexible by default.** An immediate update is a full-screen block that
 *      Play will not let the user dismiss. Doing that to someone who is mid
 *      conversation — in an app whose entire purpose is that a person is
 *      listening — is worse than shipping the update a day later.
 *   2. **Immediate only when Play says it is urgent**, i.e. an update priority
 *      of 4 or 5. Priority is set per release when rolling out, so this is a
 *      decision made at release time rather than guessed here.
 *   3. **Immediate when very stale.** Someone who has not updated in a month is
 *      running code we may have shipped safety fixes past. Thirty days is the
 *      point where a block becomes the lesser harm.
 *   4. **Ask about a flexible update at most once a week.** A prompt that
 *      reappears every launch is a prompt people learn to dismiss without
 *      reading, which then also gets the urgent ones dismissed.
 */

/** Exactly what the native `check()` resolves. */
export interface UpdateStatus {
  available: boolean;
  immediateInProgress: boolean;
  downloaded: boolean;
  flexibleAllowed: boolean;
  immediateAllowed: boolean;
  /** Play's per-release priority, 0–5. Set at rollout time, not by the client. */
  priority: number;
  /** Days this client has been behind, or -1 when Play does not know. */
  stalenessDays: number;
  availableVersionCode: number;
}

export type UpdateAction =
  /** Resume a full-screen update the user already started. */
  | { kind: 'resumeImmediate' }
  /** Block until updated: Play says urgent, or the client is very stale. */
  | { kind: 'immediate'; because: 'priority' | 'stale' }
  /** Download in the background and offer to restart later. */
  | { kind: 'flexible' }
  /** Downloaded and waiting for a restart the user has to agree to. */
  | { kind: 'promptRestart' }
  | { kind: 'none' };

export const HIGH_PRIORITY = 4;
export const STALE_DAYS_FOR_IMMEDIATE = 30;
export const FLEXIBLE_PROMPT_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * `lastPromptedAt` is a millisecond timestamp, or null if never asked. Passed in
 * rather than read here so this stays pure — the caller owns storage.
 */
export function decideUpdateAction(
  status: UpdateStatus,
  now: number,
  lastPromptedAt: number | null,
): UpdateAction {
  // Before anything else: a downloaded update is further along than an available
  // one, and a half-finished immediate update is further still. Both outrank
  // starting something new.
  if (status.immediateInProgress) {
    return { kind: 'resumeImmediate' };
  }
  if (status.downloaded) {
    return { kind: 'promptRestart' };
  }
  if (!status.available) {
    return { kind: 'none' };
  }

  if (status.immediateAllowed) {
    if (status.priority >= HIGH_PRIORITY) {
      return { kind: 'immediate', because: 'priority' };
    }
    // -1 means Play does not know how stale this client is, which must not read
    // as "not stale" — hence the explicit lower bound rather than a truthy test.
    if (
      status.stalenessDays >= 0 &&
      status.stalenessDays >= STALE_DAYS_FOR_IMMEDIATE
    ) {
      return { kind: 'immediate', because: 'stale' };
    }
  }

  if (status.flexibleAllowed) {
    const due =
      lastPromptedAt === null ||
      now - lastPromptedAt >= FLEXIBLE_PROMPT_INTERVAL_MS;
    return due ? { kind: 'flexible' } : { kind: 'none' };
  }

  return { kind: 'none' };
}

/** What the user is told. Never a version number: it means nothing to them. */
export function updateNotice(action: UpdateAction): string | null {
  switch (action.kind) {
    case 'promptRestart':
      return 'An update is ready. Restart to finish.';
    case 'immediate':
      return action.because === 'stale'
        ? 'This version is too old to keep using. Updating now.'
        : 'An important update is required.';
    default:
      return null;
  }
}
