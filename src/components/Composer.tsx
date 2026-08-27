import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, StyleSheet, Text, View } from 'react-native';
import {
  launchCamera,
  launchImageLibrary,
  type ImagePickerResponse,
} from 'react-native-image-picker';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { MAX_MESSAGE_CHARS } from '../lib/tokenLedger';
import { errorTick, tick } from '../lib/haptics';
import {
  ensureMicrophone,
  startRecording,
  type RecordingHandle,
} from '../lib/recorder';
import { MAX_VOICE_MS, clock, isSendable, type VoiceDraft } from '../lib/voice';
import { MAX_ATTACHMENT_BYTES, type ImageDraft } from '../lib/attachments';
import { useStore } from '../store/useStore';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { SendButton } from './SendButton';
import { Sheet } from './Sheet';
import { Waveform } from './Waveform';
import { TextField } from './TextField';

interface Props {
  onSend: (text: string) => void;
  /** A finished recording, ready to upload. Both roles get this: the provider
   *  tree renders the same ChatScreen, and voice notes are in scope for both. */
  onSendVoice: (draft: VoiceDraft) => void;
  /** A picked photo, ready to upload. Same shape of contract as onSendVoice. */
  onSendImage: (draft: ImageDraft) => void;
  disabled: boolean;
  placeholder: string;
  bloomKey: number;
  /**
   * Fired per keystroke so the other side can be shown a typing indicator. The
   * throttling lives in the Realtime layer, not here, the composer should not
   * have to know how often a broadcast is affordable.
   */
  onTyping?: () => void;
}

/**
 * Three states, and the row is the same height in all of them so the transcript
 * does not jump when one replaces another.
 *
 * `review` exists because of the three-minute ceiling. Stopping at a cap and
 * sending immediately sends a sentence that was cut off mid-word, so the
 * recording is held with a way out instead. It is also the only place the length
 * is shown before the note leaves.
 */
type Mode = 'idle' | 'recording' | 'review';

/**
 * Composition state is local, lifting the draft into the store would re-render
 * every subscriber on each keystroke for no benefit.
 *
 * The field no longer floats on elevation, and that was not a style preference.
 * `bg/raised` is `#FFFFFF` in light mode and so is `bg/base`, so the field was a
 * white pill on a white page held together by nothing but a shadow. It now has
 * iOS Messages' anatomy: a hairline-bordered capsule on the page colour, inside a
 * bar with a hairline along its top edge, so the transcript reads as scrolling
 * *under* a bar rather than behind a floating card.
 *
 * The honest limit, stated rather than hidden: iOS's real composer bar is
 * translucent `.systemChromeMaterial` and React Native cannot blur a background
 * without a native module. An opaque bar with a top hairline is the correct
 * fallback for that, not a compromise pretending to be the thing.
 *
 * ---------------------------------------------------------------------------
 * Why tap-to-record and not hold-to-talk
 * ---------------------------------------------------------------------------
 * WhatsApp's gesture is hold the mic, slide left to cancel, slide up to lock. It
 * is not copied here, and the reasons are not aesthetic.
 *
 * TalkBack and VoiceOver cannot express "hold and slide", and a sustained hold
 * excludes people with tremor or limited grip. Any hold-to-talk implementation
 * therefore needs a tap path *as well*, for the users a peer-support product
 * should least want to shut out. Having built the tap path, the hold is a second
 * way to do the same thing.
 *
 * It also costs a `Gesture.Pan` inside a row that lives above an inverted list,
 * where a horizontal pan and the list's scroll have to be taught not to fight.
 * `contract.test.ts` asserts that Sheet is still the only file declaring a
 * gesture, precisely so the next pan is a decision rather than a copy, and this
 * one cannot be verified anywhere but on a device.
 *
 * So: tap the mic, watch the meter, tap stop, then send or discard. If the hold
 * is added later it belongs on top of this, not instead of it.
 */
function ComposerView({
  onSend,
  onSendVoice,
  onSendImage,
  disabled,
  placeholder,
  bloomKey,
  onTyping,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const setNotice = useStore(s => s.setNotice);
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<Mode>('idle');
  // Whether the "+" media chooser (Camera / Photos) is open. iMessage's plus.
  const [mediaOpen, setMediaOpen] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<readonly number[]>([]);
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  // The live handle, in a ref rather than state: nothing renders from it, and a
  // stop that raced a re-render would otherwise stop a recorder that had already
  // been replaced.
  const handle = useRef<RecordingHandle | null>(null);
  /**
   * Which attempt is current, bumped by every start, stop, discard and unmount.
   *
   * It exists for one gap, and it is the worst failure this feature has: starting
   * the recorder is asynchronous (a permission dialog on the first run, then
   * `MediaRecorder.prepare`), so stop and unmount are both reachable *before*
   * there is a handle to stop. Without this the recorder resolves afterwards into
   * a ref nothing is watching, and the microphone stays live with no way to turn
   * it off short of killing the app.
   */
  const attempt = useRef(0);
  const ready = value.trim().length > 0 && !disabled;

  const finish = useCallback((next: VoiceDraft | null) => {
    handle.current = null;
    if (next !== null && isSendable(next.durationMs)) {
      setDraft(next);
      setMode('review');
      return;
    }
    // Under a second. Thrown away without a word: at that length it is a mistap
    // on the mic button, and being told off for brushing a button is worse than
    // nothing happening.
    setDraft(null);
    setMode('idle');
  }, []);

  /**
   * Leaving the screen mid-recording must stop the microphone.
   *
   * Without this the recorder keeps running with nothing listening, which is both
   * a privacy claim this app should not have to make and the state that leaves
   * the next `startRecorder` fighting a live one.
   */
  useEffect(
    () => () => {
      attempt.current += 1;
      void handle.current?.cancel();
      handle.current = null;
    },
    [],
  );

  const change = useCallback(
    (next: string) => {
      setValue(next);
      if (next !== '') {
        onTyping?.();
      }
    },
    [onTyping],
  );

  const submit = useCallback(() => {
    if (!ready) {
      return;
    }
    onSend(value);
    setValue('');
  }, [onSend, ready, value]);

  const record = useCallback(async () => {
    if (disabled || handle.current !== null) {
      return;
    }
    const mine = attempt.current + 1;
    attempt.current = mine;
    if (!(await ensureMicrophone())) {
      errorTick();
      // A permanent denial is a system setting, not something to retry, so the
      // notice says where the switch is rather than offering a button that would
      // never open the dialog again.
      setNotice('Voice notes need the microphone. Turn it on in Settings.');
      return;
    }
    if (attempt.current !== mine) {
      return;
    }
    tick();
    setElapsed(0);
    setLevels([]);
    setMode('recording');
    try {
      const started = await startRecording({
        onTick: (ms, window) => {
          setElapsed(ms);
          setLevels(window);
        },
        onLimit: finish,
      });
      if (attempt.current !== mine) {
        // Stopped, discarded or unmounted while the recorder was starting. Stop
        // the hardware rather than storing a handle nothing will ever reach, and
        // put the row back: whoever bumped the attempt could not reset the mode,
        // because at that moment it did not know whether a recorder was coming.
        await started.cancel();
        setMode('idle');
        return;
      }
      handle.current = started;
    } catch {
      handle.current = null;
      setMode('idle');
      errorTick();
      setNotice('The microphone could not be started.');
    }
  }, [disabled, finish, setNotice]);

  const stop = useCallback(async () => {
    const current = handle.current;
    attempt.current += 1;
    if (current === null) {
      // Nothing to stop. Either the recorder has not finished starting, in which
      // case the bump above is what cancels it, or `onLimit` already handed over a
      // draft and moved us to review. The mode is deliberately left alone: forcing
      // it to idle here would throw away a recording that had just landed.
      return;
    }
    tick();
    finish(await current.stop());
  }, [finish]);

  const discard = useCallback(async () => {
    attempt.current += 1;
    await handle.current?.cancel();
    handle.current = null;
    setDraft(null);
    setMode('idle');
  }, []);

  /**
   * Stop recording the moment the app leaves the foreground.
   *
   * Without this the microphone keeps running while the app is backgrounded,
   * which makes two claims false at once: the permission comment in
   * AndroidManifest.xml says "nothing records while the app is not in the
   * foreground", and the Play Data Safety declaration rests on the same
   * sentence. A claim a reviewer can disprove with one press of the home button
   * is worse than no claim.
   *
   * Cancel rather than stop: a recording interrupted by a phone call or a
   * notification shade is not a voice note somebody chose to send, and offering
   * a half-recorded draft on return invites sending it by accident.
   *
   * Found by an adversarial review of this change, not by a test. No gate can see
   * a permission comment disagreeing with runtime behaviour.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next !== 'active' && handle.current !== null) {
        void discard();
      }
    });
    return () => sub.remove();
  }, [discard]);

  const sendDraft = useCallback(() => {
    if (draft === null) {
      return;
    }
    onSendVoice(draft);
    setDraft(null);
    setMode('idle');
  }, [draft, onSendVoice]);

  /**
   * Validate a picker/camera result and hand the photo up.
   *
   * Shared by the gallery and the camera so the size ceiling, the unreadable-asset
   * guard and the `onSendImage` contract are identical for both — the division of
   * labour the mic button has with `onSendVoice`. The size check mirrors the
   * bucket's ceiling so an oversized pick is refused here rather than after the
   * bytes are already on their way.
   */
  const handleAsset = useCallback(
    (result: ImagePickerResponse | null) => {
      if (result === null || result.didCancel) {
        return;
      }
      const asset = result.assets?.[0];
      if (
        asset === undefined ||
        asset.uri === undefined ||
        asset.width === undefined ||
        asset.height === undefined
      ) {
        setNotice('That photo could not be read.');
        errorTick();
        return;
      }
      if (asset.fileSize !== undefined && asset.fileSize > MAX_ATTACHMENT_BYTES) {
        setNotice('That photo is too large. Pick one under 10 MB.');
        errorTick();
        return;
      }
      onSendImage({
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
        mime: asset.type ?? null,
      });
    },
    [onSendImage, setNotice],
  );

  /**
   * Pick from the library. The Android 13+ system photo picker needs no
   * permission at all, so there is nothing to request here.
   */
  const pickImage = useCallback(async () => {
    setMediaOpen(false);
    if (disabled) {
      return;
    }
    tick();
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      quality: 0.9,
    }).catch(() => null);
    handleAsset(result);
  }, [disabled, handleAsset]);

  /**
   * Capture a live photo (#8). Camera capture, unlike the library picker, needs
   * the CAMERA runtime permission — requested here right before use, and a
   * permanent denial points at Settings rather than retrying a dialog Android
   * will not show again.
   */
  const takePhoto = useCallback(async () => {
    setMediaOpen(false);
    if (disabled) {
      return;
    }
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
    );
    if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
      errorTick();
      setNotice('The camera needs permission. Turn it on in Settings.');
      return;
    }
    tick();
    const result = await launchCamera({
      mediaType: 'photo',
      quality: 0.9,
      saveToPhotos: false,
    }).catch(() => null);
    handleAsset(result);
  }, [disabled, handleAsset, setNotice]);

  if (mode === 'recording') {
    return (
      <View style={styles.row}>
        <View style={styles.panel}>
          <Pressable
            onPress={() => {
              void discard();
            }}
            testID="voice-cancel"
            accessibilityLabel="Cancel recording"
            press="none"
            highlight="ios"
            size={32}
            style={styles.panelButton}
          >
            <Icon name="close" size={14} color={theme.color.text.secondary} />
          </Pressable>
          {/* The one red thing in the app, and it earns it: this is the only
              moment the microphone is live, and every recorder on every platform
              marks that with a red dot. */}
          <View style={styles.live} />
          <Text
            testID="voice-elapsed"
            allowFontScaling
            accessibilityLiveRegion="none"
            style={styles.clock}
          >
            {clock(elapsed)}
          </Text>
          <Waveform
            peaks={levels}
            // No unplayed half while recording: everything drawn has happened.
            progress={1}
            tint={theme.color.text.secondary}
            dim={1}
            testID="voice-meter"
          />
          <Pressable
            onPress={() => {
              void stop();
            }}
            testID="voice-stop"
            accessibilityLabel="Stop recording"
            accessibilityHint={`Up to ${clock(MAX_VOICE_MS)}`}
            press="chip"
            size={32}
            style={styles.stop}
          >
            <Icon name="stop" size={14} color={theme.color.text.primary} />
          </Pressable>
        </View>
      </View>
    );
  }

  if (mode === 'review' && draft !== null) {
    return (
      <View style={styles.row}>
        <View style={styles.panel}>
          <Pressable
            onPress={() => {
              void discard();
            }}
            testID="voice-discard"
            accessibilityLabel="Discard this recording"
            press="none"
            highlight="ios"
            size={32}
            style={styles.panelButton}
          >
            <Icon name="close" size={14} color={theme.color.text.secondary} />
          </Pressable>
          <Text testID="voice-length" allowFontScaling style={styles.clock}>
            {clock(draft.durationMs)}
          </Text>
          {/* The peaks the recorder actually measured, shown once. They are not
              stored with the message, so this is the only time the real shape of
              a note is ever on screen. See the note in VoiceNote.tsx. */}
          <Waveform
            peaks={draft.peaks}
            progress={1}
            tint={theme.color.text.secondary}
            dim={1}
          />
          <SendButton onPress={sendDraft} disabled={disabled} bloomKey={bloomKey} />
        </View>
      </View>
    );
  }

  return (
    <>
    <View style={styles.row}>
      <View style={styles.inputBar}>
      {/* The "+" media button (#8, iMessage/Sweprek): one target that opens a
          Camera / Photos chooser, rather than a bare gallery shortcut. Left of the
          field, its own target, so it is reachable whether or not there is text —
          the trailing control is the send/mic either-or, and a third thing crammed
          in there is the "which does return mean" problem the mic note warns of. */}
      <Pressable
        onPress={() => setMediaOpen(true)}
        disabled={disabled}
        testID="composer-attach"
        accessibilityLabel="Add media"
        accessibilityHint="Camera or photos. One photo costs one token"
        press="chip"
        size={32}
        style={styles.attach}>
        <Icon name="plus" size={24} color={theme.color.text.secondary} />
      </Pressable>
      <View style={styles.field}>
        <TextField
          testID="composer-input"
          style={styles.input}
          value={value}
          onChangeText={change}
          placeholder={placeholder}
          // Tertiary, not secondary: iOS's placeholder is tertiaryLabel, and at
          // secondary the hint was close enough to real input to be misread as
          // one.
          placeholderTextColor={theme.color.text.tertiary}
          multiline
          maxLength={MAX_MESSAGE_CHARS}
          allowFontScaling
          returnKeyType="send"
          submitBehavior="submit"
          onSubmitEditing={submit}
          accessibilityLabel="Message"
          accessibilityHint="One message costs one token"
          underlineColorAndroid="transparent"
        />
        {/* One trailing control, never two competing. With text there is a send
            button; with an empty field there is a microphone. A row holding both
            asks which of them the return key means. */}
        {ready ? (
          <SendButton onPress={submit} disabled={!ready} bloomKey={bloomKey} />
        ) : (
          <Pressable
            onPress={() => {
              void record();
            }}
            disabled={disabled}
            testID="voice-record"
            accessibilityLabel="Record a voice note"
            accessibilityHint="Recording starts on tap and stops when you tap stop. One voice note costs one token"
            press="chip"
            size={32}
            style={styles.mic}
          >
            <Icon name="mic" size={24} color={theme.color.text.secondary} />
          </Pressable>
        )}
      </View>
      </View>
    </View>

    {/* The media chooser (#8). A bottom sheet with Camera and Photos, the same
        inset-grouped table idiom the payment and settings lists use, so the app's
        selectable lists read as one system. */}
    <Sheet
      visible={mediaOpen}
      testID="media-sheet"
      title="Send a photo"
      onClose={() => setMediaOpen(false)}
      onCancel={() => setMediaOpen(false)}
      cancelLabel="Cancel">
      <View style={styles.mediaGroup}>
        <Pressable
          onPress={() => {
            void takePhoto();
          }}
          testID="media-camera"
          accessibilityLabel="Take a photo"
          press="none"
          highlight="ios"
          style={[styles.mediaRow, styles.mediaRowFirst]}>
          <View style={styles.mediaIcon}>
            <Icon name="camera" size={22} color={theme.color.text.primary} />
          </View>
          <Text allowFontScaling style={styles.mediaLabel}>
            Camera
          </Text>
        </Pressable>
        <View style={styles.mediaSep} />
        <Pressable
          onPress={() => {
            void pickImage();
          }}
          testID="media-photos"
          accessibilityLabel="Choose a photo"
          press="none"
          highlight="ios"
          style={[styles.mediaRow, styles.mediaRowLast]}>
          <View style={styles.mediaIcon}>
            <Icon name="image" size={22} color={theme.color.text.primary} />
          </View>
          <Text allowFontScaling style={styles.mediaLabel}>
            Photos
          </Text>
        </Pressable>
      </View>
    </Sheet>
    </>
  );
}

export const Composer = memo(ComposerView);

const makeStyles = (t: Theme) => StyleSheet.create({
  row: {
    paddingHorizontal: TOKENS.space.md,
    paddingTop: TOKENS.space.xs,
    paddingBottom: TOKENS.space['2xs'],
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.color.border.hairline,
    backgroundColor: t.color.bg.base,
  },
  // The idle bar: attach button, then the field taking the rest of the width.
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: TOKENS.space.xs,
  },
  attach: {
    width: 32,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: TOKENS.space.xs,
    paddingLeft: TOKENS.space.md,
    paddingRight: 5,
    paddingVertical: 4,
    // Still a capsule: the field is a capsule on iOS too. What changed is what
    // defines its edge.
    borderRadius: TOKENS.radius.pill,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border.hairline,
    backgroundColor: t.color.bg.base,
  },
  input: {
    flex: 1,
    // Shorter (Amit/Sweprek): the field read too tall. 34 min with tighter
    // vertical padding is a compact single-line pill that still grows to 120 for
    // a multi-line draft.
    minHeight: 34,
    maxHeight: 120,
    paddingTop: 7,
    paddingBottom: 7,
    ...TOKENS.typography.bodyMedium,
    color: t.color.text.primary,
  },
  // The same capsule as the field, filled, so the row's height and edge do not
  // change when recording replaces typing.
  panel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
    minHeight: 50,
    paddingLeft: TOKENS.space['2xs'],
    paddingRight: 6,
    borderRadius: TOKENS.radius.pill,
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.sunken,
  },
  panelButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  live: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: t.color.state.danger,
  },
  clock: {
    ...TOKENS.typography.numeralSmall,
    color: t.color.text.secondary,
  },
  mic: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stop: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderCurve: 'continuous',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.color.bg.base,
  },
  // The media chooser rows, same inset-grouped table as PaymentSheet/Settings.
  mediaGroup: {
    alignSelf: 'stretch',
    borderRadius: TOKENS.radius.field,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: t.color.bg.sunken,
  },
  mediaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.sm,
    paddingVertical: TOKENS.space.sm,
    paddingHorizontal: TOKENS.space.md,
    minHeight: 52,
    backgroundColor: t.color.bg.sunken,
  },
  mediaRowFirst: {
    borderTopLeftRadius: TOKENS.radius.field,
    borderTopRightRadius: TOKENS.radius.field,
  },
  mediaRowLast: {
    borderBottomLeftRadius: TOKENS.radius.field,
    borderBottomRightRadius: TOKENS.radius.field,
  },
  mediaIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.color.bg.raised,
  },
  mediaLabel: {
    ...TOKENS.typography.bodyLarge,
    color: t.color.text.primary,
    flex: 1,
  },
  mediaSep: {
    height: StyleSheet.hairlineWidth,
    marginLeft: TOKENS.space.md + 32 + TOKENS.space.sm,
    backgroundColor: t.color.border.hairline,
  },
});
