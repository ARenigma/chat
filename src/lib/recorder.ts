/**
 * The microphone and the speaker, behind one module.
 *
 * `react-native-nitro-sound` is the only import of it in the app, for the same
 * reason `supabase.ts` is the only place the client is constructed: this is a
 * native dependency with an untested build surface, and confining it to one file
 * makes replacing it a file-sized decision rather than a search.
 *
 * ---------------------------------------------------------------------------
 * Why this library
 * ---------------------------------------------------------------------------
 * `react-native-audio-recorder-player` is npm-deprecated *in favour of this
 * package*, by the same author, with the deprecation notice naming it. So the
 * obvious candidate is not merely stale, it has been formally retired, which is
 * the `react-native-callkeep` situation with a signpost.
 * `react-native-track-player` has shipped two stable releases in two and a half
 * years, has no recorder at all, and would contribute a foreground service and
 * media permissions to the merged manifest. `expo-av` and `expo-audio` require
 * the `expo` peer, which rewires both native builds. `@dr.pogodin/react-native-
 * audio` is maintained but requires `react-native-permissions`, a second native
 * dependency for something `PermissionsAndroid` already does.
 *
 * nitro-sound is 0.2.19, published fifteen days before this was written, and its
 * own devDependencies pin react-native and @react-native/babel-preset to 0.86.2
 * exactly, so it is developed against this app's version. It is a Nitro
 * HybridObject in Swift and Kotlin rather than a bridge module, and its
 * `react-native-nitro-modules` peer is already installed for react-native-mmkv,
 * so no new native dependency *tree* arrives with it.
 *
 * The honest risk, recorded rather than discovered later: its generated glue was
 * produced with nitrogen 0.36.5 and this app resolves nitro-modules to 0.37.0.
 * No native build in this repo has run against 0.37.0 yet. If the first release
 * build fails on that skew, pin `react-native-nitro-modules` to `0.36.5`, which
 * both nitro-sound and mmkv accept.
 *
 * ---------------------------------------------------------------------------
 * The player is one object
 * ---------------------------------------------------------------------------
 * `Sound` is a singleton with a single `mediaPlayer` field, so starting note B
 * stops note A whether or not anything asked it to. That is why "which note is
 * playing" is one value in the store rather than per-row component state, and
 * why `stopPlayback` is safe to call speculatively.
 */
import { PermissionsAndroid, Platform } from 'react-native';
import Sound, {
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
  OutputFormatAndroidType,
} from 'react-native-nitro-sound';
import { storage } from './storage';
import {
  MAX_VOICE_MS,
  SPEEDS,
  VOICE_BARS,
  downsample,
  normaliseDb,
  type PlaybackSpeed,
  type VoiceDraft,
} from './voice';

/**
 * AAC in an MP4 container on both platforms, so one content type covers both and
 * the bucket's `allowed_mime_types` can be a pair rather than a list.
 *
 * Mono at 32 kbps: this is speech, and a three-minute note comes to roughly
 * 700 KB, comfortably inside the bucket's 2 MiB ceiling. Stereo would double the
 * bytes to record one voice twice.
 */
const AUDIO = {
  AudioSourceAndroid: AudioSourceAndroidType.MIC,
  OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
  AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
  AudioChannels: 1,
  AudioEncodingBitRate: 32_000,
  AudioSamplingRate: 22_050,
} as const;

/**
 * Where the outgoing recording lives, remembered across launches.
 *
 * With no `uri` argument the recorder invents `sound_<timestamp>.mp4` in the
 * app's private directory and nothing ever deletes it, so every cancelled and
 * every already-sent recording would accumulate on disk forever. The app has no
 * filesystem module and adding one to call `unlink` would be a native dependency
 * bought for one line.
 *
 * Instead the first path the recorder chooses is remembered and handed back on
 * every later recording. `MediaRecorder.setOutputFile` and `AVAudioRecorder` both
 * truncate, so at most one outgoing audio file ever exists, and the next
 * recording is what deletes the last one.
 */
const OUT_PATH_KEY = 'voice.outPath';

/** Persisted so a speed choice survives leaving the screen, like a player app. */
const SPEED_KEY = 'voice.speed';

/**
 * How often the playhead reports, in seconds.
 *
 * The library defaults to 60ms, which is about sixteen React re-renders a second
 * of a row holding sixty-odd bar Views. 100ms is the same cadence the recorder's
 * metering is capped at, and over a 128pt waveform it moves the playhead in
 * steps of a couple of points, which is under the width of one bar.
 */
const PLAYBACK_TICK_SECONDS = 0.1;

export function storedSpeed(): PlaybackSpeed {
  const raw = Number(storage.get(SPEED_KEY));
  return SPEEDS.includes(raw as PlaybackSpeed) ? (raw as PlaybackSpeed) : 1;
}

export function rememberSpeed(speed: PlaybackSpeed): void {
  storage.set(SPEED_KEY, String(speed));
}

/**
 * The runtime microphone grant.
 *
 * `PermissionsAndroid` from React Native core rather than
 * `react-native-permissions`: the only thing needed here is one request for one
 * permission, and iOS asks for the microphone on first use from the Info.plist
 * string with no JS call at all.
 *
 * Returns false rather than throwing on a permanent denial, because the caller's
 * correct response is a sentence explaining where the switch is, not an error.
 */
export async function ensureMicrophone(): Promise<boolean> {
  if (Platform.OS !== 'android') {
    return true;
  }
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    {
      title: 'Record a voice note',
      message: 'Only while you hold the button. Nothing is recorded otherwise.',
      buttonPositive: 'Allow',
      buttonNegative: 'Not now',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

interface RecordingCallbacks {
  /**
   * Fires at the recorder's own cadence, which Android caps at 10 Hz. `window`
   * is the trailing VOICE_BARS samples, so the live meter scrolls rather than
   * compressing as the recording gets longer.
   */
  onTick: (elapsedMs: number, window: readonly number[]) => void;
  /**
   * The three-minute ceiling, reached. The recording is stopped and handed over
   * rather than sent: auto-sending at a cap sends a sentence that was cut off.
   */
  onLimit: (draft: VoiceDraft) => void;
}

export interface RecordingHandle {
  /** The finished recording, or null if it produced nothing usable. */
  stop: () => Promise<VoiceDraft | null>;
  /** Stop and throw it away. The file is left to be truncated by the next one. */
  cancel: () => Promise<void>;
}

/** All of it, so a stop cannot leave a listener attached to a dead recorder. */
let active: {
  /** Which recording this is. See the note on the returned handle. */
  session: number;
  file: string;
  levels: number[];
  elapsedMs: number;
  finished: boolean;
} | null = null;

let sessions = 0;

function detach(): void {
  Sound.removeRecordBackListener();
  active = null;
}

export async function startRecording(
  callbacks: RecordingCallbacks,
): Promise<RecordingHandle> {
  // A previous recording that was never stopped, which happens if the screen
  // unmounted mid-record. Stopping is idempotent enough to be worth doing blind.
  if (active !== null) {
    await Sound.stopRecorder().catch(() => undefined);
    detach();
  }

  const remembered = storage.get(OUT_PATH_KEY);
  const file = await Sound.startRecorder(
    remembered ?? undefined,
    AUDIO,
    // Metering on, which is the whole reason a waveform is possible without
    // decoding audio: there is no API anywhere that gives amplitudes for a file
    // you did not record.
    true,
  );
  storage.set(OUT_PATH_KEY, file);
  sessions += 1;
  const session = sessions;
  active = { session, file, levels: [], elapsedMs: 0, finished: false };

  Sound.addRecordBackListener(meta => {
    const current = active;
    if (current === null || current.finished) {
      return;
    }
    current.elapsedMs = meta.currentPosition;
    if (meta.currentMetering !== undefined) {
      current.levels.push(normaliseDb(meta.currentMetering));
    }
    callbacks.onTick(
      current.elapsedMs,
      current.levels.slice(-VOICE_BARS),
    );
    if (current.elapsedMs >= MAX_VOICE_MS) {
      current.finished = true;
      void stop(session).then(draft => {
        if (draft !== null) {
          callbacks.onLimit(draft);
        }
      });
    }
  });

  /**
   * Scoped to this recording, not to "whatever is recording now".
   *
   * The output path is reused between recordings by design, so it cannot be the
   * identity here: a stale handle calling `stop()` would find the *next*
   * recording under the same filename and stop that instead. The session number
   * is what makes a stale handle a no-op.
   */
  return {
    stop: () => stop(session),
    cancel: () => cancel(session),
  };
}

async function stop(session: number): Promise<VoiceDraft | null> {
  const current = active;
  if (current === null || current.session !== session) {
    return null;
  }
  // Read before detaching: `stopRecorder` fires no final tick, so the last
  // observed position is the duration.
  const durationMs = current.elapsedMs;
  const peaks = downsample(current.levels);
  const file = current.file;
  try {
    await Sound.stopRecorder();
  } catch {
    // A recorder that failed to stop has nothing to hand over, and a rejection
    // here would surface as a crash on a screen where the user has just let go
    // of a button.
    detach();
    return null;
  }
  detach();
  return { file, durationMs, peaks };
}

async function cancel(session: number): Promise<void> {
  if (active === null || active.session !== session) {
    return;
  }
  try {
    await Sound.stopRecorder();
  } catch {
    // Nothing to report: the recording is being thrown away either way.
  }
  detach();
}

interface PlaybackCallbacks {
  onPosition: (positionMs: number, durationMs: number) => void;
  onEnd: () => void;
}

/**
 * Play a remote note from a signed URL, without downloading it.
 *
 * `startPlayer` branches on the scheme and hands an `http` URL straight to the
 * platform player, so no received audio is ever written to the recipient's disk.
 * That is the right default for a product that sets FLAG_SECURE: the cost is
 * that a replay refetches, which is a few hundred kilobytes.
 */
export async function startPlayback(
  url: string,
  speed: PlaybackSpeed,
  callbacks: PlaybackCallbacks,
): Promise<void> {
  await stopPlayback();
  Sound.setSubscriptionDuration(PLAYBACK_TICK_SECONDS);
  Sound.addPlayBackListener(meta => {
    callbacks.onPosition(meta.currentPosition, meta.duration);
  });
  Sound.addPlaybackEndListener(() => {
    callbacks.onEnd();
  });
  await Sound.startPlayer(url);
  // After `startPlayer`, never before: `setPlaybackSpeed` throws `No player
  // instance` when nothing is playing, and the rate is not remembered across
  // starts, so it has to be reapplied every time.
  if (speed !== 1) {
    await Sound.setPlaybackSpeed(speed).catch(() => undefined);
  }
}

/** Applied to whatever is playing now. No-op, quietly, if nothing is. */
export async function applySpeed(speed: PlaybackSpeed): Promise<void> {
  await Sound.setPlaybackSpeed(speed).catch(() => undefined);
}

export async function stopPlayback(): Promise<void> {
  Sound.removePlayBackListener();
  Sound.removePlaybackEndListener();
  await Sound.stopPlayer().catch(() => undefined);
}
