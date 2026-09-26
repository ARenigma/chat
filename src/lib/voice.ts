/**
 * Voice notes, the part with no native code in it.
 *
 * Pure on purpose, for the same reason `transcript.ts` and `telemetryGuard.ts`
 * are: the recorder is a Nitro HybridObject, so anything importing it cannot be
 * loaded by jest at all. The arithmetic is the part worth testing. The microphone
 * is not, and it is in `src/lib/recorder.ts` behind this boundary.
 *
 * Every bound here mirrors migration 011's `message_carries_one_payload`
 * constraint rather than restating a number somebody remembered. A contract test
 * reads the SQL and compares, because the failure mode otherwise is silent: the
 * upload succeeds, the RPC rejects with BAD_REQUEST, and the recording is
 * already sitting in the bucket.
 */
import type { Message } from './database.types';

/**
 * The floor in `voice_duration_ms between 1000 and 180000`.
 *
 * It exists to reject a fat-fingered tap that produced no audio, so the client
 * refuses at the same number rather than uploading first and finding out.
 */
export const MIN_VOICE_MS = 1_000;

/** The ceiling in the same constraint. The recorder stops itself here. */
export const MAX_VOICE_MS = 180_000;

/**
 * Bars in a waveform.
 *
 * Thirty-two rather than the sixty-odd a wide bubble could hold, for two
 * independent reasons that happen to agree. Android caps metering at 10 Hz
 * (`METERING_UPDATE_INTERVAL_MS` in the recorder's own Kotlin), so a three-second
 * note only ever produces about thirty samples, and asking for more bars than the
 * shortest usable recording can fill means every short note is drawn from
 * repeated values. And at 2pt a bar with a 2pt gap, thirty-two bars is 128pt,
 * which still fits inside a bubble beside a play button and a duration on a
 * 320pt-wide screen.
 */
export const VOICE_BARS = 32;

/**
 * Where the loudness scale bottoms out, in dBFS.
 *
 * The recorder reports down to -160, which is its silence sentinel rather than a
 * measurement. Normalising against that squashes every syllable of ordinary
 * speech into the bottom 30% of the range and the meter looks dead. Speech at
 * arm's length on a phone mic lands between about -40 and -5, so -50 is the
 * quietest thing worth drawing.
 */
export const METER_FLOOR_DB = -50;

/**
 * dBFS to 0..1.
 *
 * No curve is applied on top. Decibels are already logarithmic, which is the
 * scale hearing works on, so a second curve would be a preference dressed up as
 * a correction.
 */
export function normaliseDb(db: number): number {
  if (!Number.isFinite(db)) {
    return 0;
  }
  const scaled = (db - METER_FLOOR_DB) / -METER_FLOOR_DB;
  return Math.min(1, Math.max(0, scaled));
}

/**
 * Bucket a run of levels down to a fixed bar count.
 *
 * **Max per bucket, never the mean.** A mean flattens the transients that make
 * speech legible as speech: averaged over half a second, a shouted word and a
 * murmur come out the same height, and every waveform in the app ends up the
 * same shape. The peak is the thing the eye is reading.
 *
 * With fewer samples than bars the nearest sample is repeated rather than
 * interpolated. Interpolation invents intermediate loudness values that were
 * never measured, which is a small lie in the one part of the UI that claims to
 * depict what was said.
 */
export function downsample(samples: readonly number[], bars: number = VOICE_BARS): number[] {
  if (bars <= 0) {
    return [];
  }
  if (samples.length === 0) {
    return new Array<number>(bars).fill(0);
  }
  if (samples.length < bars) {
    return Array.from({ length: bars }, (_, i) => {
      const nearest = Math.min(
        samples.length - 1,
        Math.floor((i * samples.length) / bars),
      );
      return samples[nearest] ?? 0;
    });
  }

  const out: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    const from = Math.floor((i * samples.length) / bars);
    const to = Math.max(from + 1, Math.floor(((i + 1) * samples.length) / bars));
    let peak = 0;
    for (let j = from; j < to; j += 1) {
      const value = samples[j] ?? 0;
      if (value > peak) {
        peak = value;
      }
    }
    out.push(peak);
  }
  return out;
}

/**
 * Exactly VOICE_BARS values, so the waveform and the clipped copy laid over it
 * are the same width without measuring anything.
 *
 * Short runs are padded at the *end*, which is what makes the live meter grow
 * left to right while recording rather than sliding in from the right. Long runs
 * are truncated from the front, so what is on screen is the most recent audio.
 */
export function padBars(peaks: readonly number[], bars: number = VOICE_BARS): number[] {
  const tail = peaks.length > bars ? peaks.slice(peaks.length - bars) : peaks;
  const out = new Array<number>(bars).fill(0);
  for (let i = 0; i < tail.length; i += 1) {
    out[i] = tail[i] ?? 0;
  }
  return out;
}

/**
 * The object key for a recording, and it is not a naming convention: it is the
 * shape two server-side checks authorise against.
 *
 * `voice_path_is_scoped` in 011 pins the whole string to
 * `<uuid>/<uuid>.m4a`, `send_message` refuses a path whose first segment is not
 * the conversation it is being attached to, and the Storage policy authorises a
 * read on that same first segment. So the prefix is the access-control boundary,
 * not a folder.
 */
export function voiceObjectPath(conversationId: string, objectId: string): string {
  return `${conversationId}/${objectId}.m4a`;
}

/**
 * The mirror of `voice_path_is_scoped`. Checked here so a malformed key is a
 * refusal before the upload rather than a rejection after it.
 */
const VOICE_PATH =
  /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\/[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\.m4a$/;

export function isVoicePath(value: unknown): value is string {
  return typeof value === 'string' && VOICE_PATH.test(value.toLowerCase());
}

/**
 * The playback rates offered, and there are three because a fourth is a menu.
 *
 * Declared here rather than beside the player so a type-only import never drags
 * the native recorder into a jest module graph, which is the whole reason this
 * file is pure.
 */
export type PlaybackSpeed = 1 | 1.5 | 2;

export const SPEEDS: readonly PlaybackSpeed[] = [1, 1.5, 2];

/** The next rate in the cycle. Wraps, because a control that dead-ends is a bug. */
export function nextSpeed(current: PlaybackSpeed): PlaybackSpeed {
  const at = SPEEDS.indexOf(current);
  return SPEEDS[(at + 1) % SPEEDS.length] ?? 1;
}

/**
 * The handle a bubble needs to play itself, and the reason it is one object: a
 * bubble is memoised, so three separately-created props would defeat the memo on
 * every render of the list.
 */
export interface VoicePlayer {
  /** Start this note, or stop it if it is the one already playing. */
  toggle: (messageId: string, path: string, durationMs: number) => void;
  cycleSpeed: () => void;
  speed: PlaybackSpeed;
  /**
   * Stop whatever note is playing. For a chat that loses focus while staying
   * mounted (navigation step 6): the unmount stop no longer runs, and audio
   * must not keep playing over the next screen.
   */
  stop: () => void;
}

/** What the recorder produced, once it is known to be sendable. */
export interface VoiceDraft {
  /** Absolute local file path, the one the recorder wrote. */
  file: string;
  durationMs: number;
  /** Peaks captured while recording, already downsampled to VOICE_BARS. */
  peaks: readonly number[];
}

/**
 * Whether a recording may be sent at all.
 *
 * Under a second is discarded silently rather than refused with a notice: at
 * that length it is a mistap on the mic button, and telling someone off for
 * touching a button is worse than doing nothing.
 */
export function isSendable(durationMs: number): boolean {
  return durationMs >= MIN_VOICE_MS && durationMs <= MAX_VOICE_MS;
}

/**
 * A voice payload, or null for a text row. Keeps the branch out of renderItem.
 *
 * The guard tests for a usable value rather than for `=== null`, and that is not
 * belt and braces: it is the difference between degrading and lying.
 *
 * The columns are typed `string | null`, so `=== null` is exhaustive as long as
 * the row really came from a schema that has them. When it did not, the runtime
 * value is `undefined`, which is neither the string nor the null the type
 * promised, so the old check fell through and returned
 * `{ path: undefined, durationMs: undefined }`. That renders a voice note whose
 * duration is `NaN:NaN`, over a text message, with a play button that cannot
 * play anything.
 *
 * Seen on a device: migrations 011 and 012 exist in this repo and had never been
 * applied to the linked project, so every message row came back without
 * `voice_path` at all. A text message rendering as a broken player is a much
 * worse failure than a text message rendering as text, and the schema drift is
 * still there to be fixed separately. This makes the missing case degrade to
 * "text", which is what a row with no voice columns actually is.
 */
export function voiceOf(
  message: Pick<Message, 'voice_path' | 'voice_duration_ms' | 'voice_peaks'>,
): { path: string; durationMs: number; peaks: number[] | null } | null {
  const path = message.voice_path;
  const durationMs = message.voice_duration_ms;
  if (
    typeof path !== 'string' ||
    path === '' ||
    typeof durationMs !== 'number' ||
    !Number.isFinite(durationMs)
  ) {
    return null;
  }
  return { path, durationMs, peaks: message.voice_peaks };
}

/**
 * `m:ss`, floored.
 *
 * Floored rather than rounded because this doubles as the elapsed counter while
 * recording, and a counter that shows 0:01 before a second has passed is a
 * counter that can send an unsendable note.
 */
export function clock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const seconds = total % 60;
  return `${Math.floor(total / 60)}:${seconds < 10 ? '0' : ''}${seconds}`;
}

/** Playhead position as a fraction, clamped, with a zero-length note reading 0. */
export function progressOf(positionMs: number, durationMs: number): number {
  if (durationMs <= 0) {
    return 0;
  }
  return Math.min(1, Math.max(0, positionMs / durationMs));
}
