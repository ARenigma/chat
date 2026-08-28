import {
  MAX_VOICE_MS,
  METER_FLOOR_DB,
  MIN_VOICE_MS,
  VOICE_BARS,
  clock,
  downsample,
  isSendable,
  isVoicePath,
  normaliseDb,
  padBars,
  progressOf,
  voiceObjectPath,
  voiceOf,
} from '../src/lib/voice';

const CONVERSATION = 'aaaaaaaa-0000-4000-8000-000000000001';
const OBJECT = 'bbbbbbbb-0000-4000-8000-000000000002';

describe('normalising the recorder metering', () => {
  it('treats the silence sentinel and the floor alike', () => {
    // -160 is what the recorder reports for "no signal at all", not a
    // measurement. If it did not clamp to the same place as the floor, every
    // pause between words would render as a negative-height bar.
    expect(normaliseDb(-160)).toBe(0);
    expect(normaliseDb(METER_FLOOR_DB)).toBe(0);
  });

  it('puts full scale at 0 dBFS and the midpoint halfway', () => {
    expect(normaliseDb(0)).toBe(1);
    expect(normaliseDb(METER_FLOOR_DB / 2)).toBeCloseTo(0.5, 5);
  });

  it('clamps a positive reading rather than overflowing the bar', () => {
    // iOS averagePower can read slightly above zero on a clipped frame.
    expect(normaliseDb(3)).toBe(1);
  });

  it('survives a missing reading', () => {
    // `currentMetering` is optional on RecordBackType, so NaN reaches here the
    // first time a listener fires before the recorder has an amplitude.
    expect(normaliseDb(Number.NaN)).toBe(0);
  });
});

describe('downsampling to a fixed bar count', () => {
  it('takes the peak per bucket, not the mean', () => {
    // The case where the two disagree, which is the whole point: a transient in
    // a quiet bucket must survive. The mean of the first bucket is 0.25.
    expect(downsample([0, 0, 0, 1, 0.2, 0.2, 0.2, 0.2], 2)).toEqual([1, 0.2]);
  });

  it('repeats the nearest sample rather than interpolating', () => {
    // Interpolation would put 0.5 in the middle, a loudness nobody measured.
    expect(downsample([0, 1], 4)).toEqual([0, 0, 1, 1]);
  });

  it('fills the full width when there is nothing to draw yet', () => {
    expect(downsample([], 5)).toEqual([0, 0, 0, 0, 0]);
    expect(downsample([0.4])).toHaveLength(VOICE_BARS);
  });

  it('never drops or duplicates a bucket at an awkward length', () => {
    // 41 samples into 40 bars is the off-by-one that shows up as a missing last
    // bar, because the final bucket's `from` and `to` can collapse.
    const samples = Array.from({ length: 41 }, (_, i) => i / 41);
    const bars = downsample(samples);
    expect(bars).toHaveLength(VOICE_BARS);
    expect(bars.every(b => b >= 0 && b <= 1)).toBe(true);
    expect(bars[VOICE_BARS - 1]).toBeGreaterThan(bars[0] as number);
  });

  it('returns nothing for a nonsensical bar count instead of looping', () => {
    expect(downsample([0.5], 0)).toEqual([]);
  });
});

describe('padding to the drawn width', () => {
  it('is always exactly VOICE_BARS long', () => {
    // The clipped copy laid over the base row has the same intrinsic width only
    // if both rows hold the same number of bars. A short run that rendered fewer
    // would put the playhead in the wrong place on every note under three
    // seconds.
    expect(padBars([])).toHaveLength(VOICE_BARS);
    expect(padBars([0.5])).toHaveLength(VOICE_BARS);
    expect(padBars(new Array(200).fill(0.5))).toHaveLength(VOICE_BARS);
  });

  it('pads at the end, so the live meter grows left to right', () => {
    expect(padBars([1, 1], 4)).toEqual([1, 1, 0, 0]);
  });

  it('keeps the most recent audio when there is more than fits', () => {
    expect(padBars([1, 2, 3, 4, 5], 3)).toEqual([3, 4, 5]);
  });
});

describe('the object key is the access-control boundary', () => {
  it('is <conversation>/<object>.m4a, which is what the policy authorises on', () => {
    expect(voiceObjectPath(CONVERSATION, OBJECT)).toBe(`${CONVERSATION}/${OBJECT}.m4a`);
    expect(isVoicePath(voiceObjectPath(CONVERSATION, OBJECT))).toBe(true);
  });

  it('rejects everything the SQL constraint rejects', () => {
    // Each of these is a real mistake rather than a fuzz case: a local file path
    // used as a key, the recorder's own .mp4 extension, a third segment invented
    // to "organise" the bucket, and a traversal attempt.
    expect(isVoicePath('/data/user/0/com.companionchat/files/note.m4a')).toBe(false);
    expect(isVoicePath(`${CONVERSATION}/${OBJECT}.mp4`)).toBe(false);
    expect(isVoicePath(`${CONVERSATION}/${OBJECT}/${OBJECT}.m4a`)).toBe(false);
    expect(isVoicePath(`../${CONVERSATION}/${OBJECT}.m4a`)).toBe(false);
    expect(isVoicePath(`${OBJECT}.m4a`)).toBe(false);
    expect(isVoicePath(null)).toBe(false);
  });
});

describe('what may be sent', () => {
  it('holds the bounds the CHECK constraint holds', () => {
    expect(isSendable(MIN_VOICE_MS)).toBe(true);
    expect(isSendable(MIN_VOICE_MS - 1)).toBe(false);
    expect(isSendable(MAX_VOICE_MS)).toBe(true);
    expect(isSendable(MAX_VOICE_MS + 1)).toBe(false);
  });
});

describe('reading a row', () => {
  const row = (
    path: string | null,
    ms: number | null,
    peaks: number[] | null = null,
  ) => ({
    voice_path: path,
    voice_duration_ms: ms,
    voice_peaks: peaks,
  });

  it('is null for text, so the caller cannot forget the branch', () => {
    expect(voiceOf(row(null, null))).toBeNull();
  });

  it('needs both halves, because a path with no duration cannot be drawn', () => {
    expect(voiceOf(row(`${CONVERSATION}/${OBJECT}.m4a`, null))).toBeNull();
    expect(voiceOf(row(null, 4000))).toBeNull();
  });

  it('carries both when the row is a voice note', () => {
    expect(voiceOf(row(`${CONVERSATION}/${OBJECT}.m4a`, 4000))).toEqual({
      path: `${CONVERSATION}/${OBJECT}.m4a`,
      durationMs: 4000,
      peaks: null,
    });
  });

  it('carries the stored peaks when the row has them (migration 023)', () => {
    const peaks = [0.1, 0.5, 0.9, 0.3];
    expect(voiceOf(row(`${CONVERSATION}/${OBJECT}.m4a`, 4000, peaks))).toEqual({
      path: `${CONVERSATION}/${OBJECT}.m4a`,
      durationMs: 4000,
      peaks,
    });
  });
});

describe('the duration label', () => {
  it('floors, so the counter cannot promise a second that has not passed', () => {
    // 0:01 at 999ms would let someone stop on what looks like a legal recording
    // and get BAD_REQUEST from the RPC.
    expect(clock(999)).toBe('0:00');
    expect(clock(1000)).toBe('0:01');
  });

  it('pads the seconds and rolls the minute', () => {
    expect(clock(9_000)).toBe('0:09');
    expect(clock(59_999)).toBe('0:59');
    expect(clock(60_000)).toBe('1:00');
    expect(clock(MAX_VOICE_MS)).toBe('3:00');
  });

  it('never renders a negative clock', () => {
    expect(clock(-500)).toBe('0:00');
  });
});

describe('the playhead', () => {
  it('is a clamped fraction', () => {
    expect(progressOf(0, 4000)).toBe(0);
    expect(progressOf(2000, 4000)).toBe(0.5);
    // The player reports a position past the duration on the last frame of
    // playback, which would push the clip mask wider than its container.
    expect(progressOf(5000, 4000)).toBe(1);
    expect(progressOf(-1, 4000)).toBe(0);
  });

  it('is zero rather than NaN when the duration is unknown', () => {
    expect(progressOf(1000, 0)).toBe(0);
  });
});

/**
 * The degradation path, added after a device showed `NaN:NaN` over a text
 * message.
 *
 * The columns are typed `string | null`, so a `=== null` guard is exhaustive
 * against a schema that has them. Against one that does not, the value is
 * `undefined` and the guard fell through, producing a voice note with an
 * unplayable path and a NaN duration. Migrations 011 and 012 were local-only at
 * the time, so every row in the live project was missing the columns entirely.
 */
describe('voiceOf degrades to text rather than to a broken player', () => {
  it('returns null for a plain text row', () => {
    expect(voiceOf({ voice_path: null, voice_duration_ms: null, voice_peaks: null })).toBeNull();
  });

  it('returns null when the columns are absent, not just null', () => {
    const rowFromAnOlderSchema = {} as Parameters<typeof voiceOf>[0];
    expect(voiceOf(rowFromAnOlderSchema)).toBeNull();
  });

  it('returns null for a half-present payload', () => {
    expect(voiceOf({ voice_path: 'a/b.m4a', voice_duration_ms: null, voice_peaks: null })).toBeNull();
    expect(voiceOf({ voice_path: null, voice_duration_ms: 4200, voice_peaks: null })).toBeNull();
  });

  it('returns null rather than a NaN duration', () => {
    expect(voiceOf({ voice_path: 'a/b.m4a', voice_duration_ms: NaN, voice_peaks: null })).toBeNull();
  });

  it('rejects an empty path, which is a row that lost its upload', () => {
    expect(voiceOf({ voice_path: '', voice_duration_ms: 4200, voice_peaks: null })).toBeNull();
  });

  it('still returns a real payload unchanged', () => {
    expect(voiceOf({ voice_path: 'c/d.m4a', voice_duration_ms: 4200, voice_peaks: null })).toEqual({
      path: 'c/d.m4a',
      durationMs: 4200,
      peaks: null,
    });
  });
});
