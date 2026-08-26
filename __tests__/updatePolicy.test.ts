import {
  decideUpdateAction,
  updateNotice,
  FLEXIBLE_PROMPT_INTERVAL_MS,
  HIGH_PRIORITY,
  STALE_DAYS_FOR_IMMEDIATE,
  type UpdateStatus,
} from '../src/lib/updatePolicy';

const NOW = 1_800_000_000_000;

/** Nothing on offer, which is the state Play reports almost all of the time. */
const quiet: UpdateStatus = {
  available: false,
  immediateInProgress: false,
  downloaded: false,
  flexibleAllowed: false,
  immediateAllowed: false,
  priority: 0,
  stalenessDays: -1,
  availableVersionCode: 0,
};

const offered = (over: Partial<UpdateStatus> = {}): UpdateStatus => ({
  ...quiet,
  available: true,
  flexibleAllowed: true,
  immediateAllowed: true,
  availableVersionCode: 2,
  ...over,
});

describe('update policy', () => {
  it('does nothing when Play has nothing', () => {
    expect(decideUpdateAction(quiet, NOW, null)).toEqual({ kind: 'none' });
  });

  /**
   * Order matters more than any individual rule here. A half-finished immediate
   * update and a downloaded flexible one are both further along than "an update
   * exists", and starting a new flow on top of either is how you get a user
   * stuck in a loop that never installs anything.
   */
  it('resumes an interrupted immediate update before anything else', () => {
    const status = offered({ immediateInProgress: true, downloaded: true, priority: 5 });
    expect(decideUpdateAction(status, NOW, null)).toEqual({ kind: 'resumeImmediate' });
  });

  it('prefers finishing a downloaded update over starting another', () => {
    const status = offered({ downloaded: true, priority: 5 });
    expect(decideUpdateAction(status, NOW, null)).toEqual({ kind: 'promptRestart' });
  });

  it('blocks only when Play marks the release urgent', () => {
    expect(decideUpdateAction(offered({ priority: HIGH_PRIORITY }), NOW, null)).toEqual({
      kind: 'immediate',
      because: 'priority',
    });
    // One below the threshold is an ordinary release and must not block someone
    // who is in the middle of a conversation.
    expect(
      decideUpdateAction(offered({ priority: HIGH_PRIORITY - 1 }), NOW, null),
    ).toEqual({ kind: 'flexible' });
  });

  it('blocks a client that is very far behind', () => {
    expect(
      decideUpdateAction(offered({ stalenessDays: STALE_DAYS_FOR_IMMEDIATE }), NOW, null),
    ).toEqual({ kind: 'immediate', because: 'stale' });
    expect(
      decideUpdateAction(
        offered({ stalenessDays: STALE_DAYS_FOR_IMMEDIATE - 1 }),
        NOW,
        null,
      ),
    ).toEqual({ kind: 'flexible' });
  });

  /**
   * Play returns null for staleness when it does not know, which the bridge maps
   * to -1. If that were treated as a number like any other, `-1 >= 30` is false
   * and it happens to work, but a future change to the comparison would make
   * "unknown" mean "not stale" silently. Pinned deliberately.
   */
  it('treats unknown staleness as unknown, not as fresh', () => {
    expect(decideUpdateAction(offered({ stalenessDays: -1 }), NOW, null)).toEqual({
      kind: 'flexible',
    });
  });

  it('never blocks when Play will not allow an immediate flow', () => {
    const status = offered({ immediateAllowed: false, priority: 5, stalenessDays: 90 });
    expect(decideUpdateAction(status, NOW, null)).toEqual({ kind: 'flexible' });
  });

  it('asks about a flexible update at most once a week', () => {
    const justAsked = NOW - 1000;
    expect(decideUpdateAction(offered(), NOW, justAsked)).toEqual({ kind: 'none' });

    const aWeekAgo = NOW - FLEXIBLE_PROMPT_INTERVAL_MS;
    expect(decideUpdateAction(offered(), NOW, aWeekAgo)).toEqual({ kind: 'flexible' });
  });

  it('still blocks for an urgent release inside the cooldown', () => {
    // The cooldown protects people from nagging, not from a security fix.
    const justAsked = NOW - 1000;
    expect(decideUpdateAction(offered({ priority: 5 }), NOW, justAsked)).toEqual({
      kind: 'immediate',
      because: 'priority',
    });
  });

  it('does nothing when neither flow is allowed', () => {
    const status = offered({ flexibleAllowed: false, immediateAllowed: false });
    expect(decideUpdateAction(status, NOW, null)).toEqual({ kind: 'none' });
  });
});

describe('update notices', () => {
  it('only speaks when there is something for a person to do', () => {
    expect(updateNotice({ kind: 'none' })).toBeNull();
    // Play draws its own UI for both of these, so a notice would be a second
    // voice saying the same thing.
    expect(updateNotice({ kind: 'flexible' })).toBeNull();
    expect(updateNotice({ kind: 'resumeImmediate' })).toBeNull();
    expect(updateNotice({ kind: 'promptRestart' })).toBe(
      'An update is ready. Restart to finish.',
    );
  });

  it('says why when it is about to block', () => {
    expect(updateNotice({ kind: 'immediate', because: 'stale' })).toMatch(/too old/);
    expect(updateNotice({ kind: 'immediate', because: 'priority' })).toMatch(/important/);
  });

  it('never shows a version number', () => {
    // A versionCode means nothing to a user and a versionName means little more.
    for (const action of [
      { kind: 'promptRestart' } as const,
      { kind: 'immediate', because: 'stale' } as const,
      { kind: 'immediate', because: 'priority' } as const,
    ]) {
      expect(updateNotice(action)).not.toMatch(/\d/);
    }
  });
});
