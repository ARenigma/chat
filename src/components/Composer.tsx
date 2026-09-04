import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  Keyboard,
  Linking,
  useWindowDimensions,
  PermissionsAndroid,
  StyleSheet,
  Text,
  type TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useCrossfade } from '../theme/motion';
import { requestAndroidPermission } from '../lib/permissions';
import {
  launchCamera,
  launchImageLibrary,
  type ImagePickerResponse,
} from 'react-native-image-picker';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { MAX_MESSAGE_CHARS } from '../lib/tokenLedger';
import { deleteLastGrapheme } from '../lib/graphemes';
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
import { AttachPanel } from './AttachPanel';
import { EmojiPicker } from './EmojiPicker';
import { readKeyboardHeight, writeKeyboardHeight } from '../lib/keyboardPanel';
import { Waveform } from './Waveform';
import { TextField } from './TextField';

/** The camera button's slot width, animated to zero when the send takes over. */
const CAMERA_SLOT = 40;

/**
 * The emoji button's square. Telegram's is 44 and sits outside the field; ours is
 * inside the capsule, so it matches the capsule's own height instead — a 44 here
 * would make the capsule taller than the 40 measured on device.
 */
const EMOJI_BUTTON = 36;

interface Props {
  onSend: (text: string) => void;
  /** A finished recording, ready to upload. Both roles get this: the provider
   *  tree renders the same ChatScreen, and voice notes are in scope for both. */
  onSendVoice: (draft: VoiceDraft) => void;
  /** A picked photo, ready to upload. Same shape of contract as onSendVoice. */
  onSendImage: (draft: ImageDraft) => void;
  disabled: boolean;
  placeholder: string;
  sendHaloKey: number;
  /**
   * Fired per keystroke so the other side can be shown a typing indicator. The
   * throttling lives in the Realtime layer, not here, the composer should not
   * have to know how often a broadcast is affordable.
   */
  onTyping?: () => void;
  /**
   * Fired when the field takes or loses focus, so the dock behind it can drop
   * its frost entirely while composing — the composer becomes a floating capsule
   * over the transcript rather than a bar (Amit, 2026-09-04).
   */
  onFocusChange?: (focused: boolean) => void;
  /**
   * Fired when the docked emoji panel opens or closes. The panel stands in for
   * the keyboard and is sized to it, so the dock must drop its safe-area inset
   * while it is up or the composer sits an inset higher than the keyboard put it.
   */
  onPanelChange?: (open: boolean) => void;
  /**
   * Fired when the emoji panel's own search field takes or loses focus. That is
   * the one case where the keyboard and the panel are up TOGETHER, so the dock
   * has to be lifted above the keyboard while the panel stays open — see
   * `panelCeiling`.
   */
  onPanelSearchChange?: (searching: boolean) => void;
  /**
   * The tallest the panel may be while the keyboard is also up, in px: the space
   * between the bottom of the frosted header and the top of the keyboard. The
   * parent owns it because only the screen knows its own header height. Ignored
   * outside search, where the panel is exactly the keyboard's size.
   */
  panelCeiling?: number;
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
  sendHaloKey,
  onTyping,
  onFocusChange,
  onPanelChange,
  onPanelSearchChange,
  panelCeiling = 0,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const setNotice = useStore(s => s.setNotice);
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<Mode>('idle');
  /**
   * The attach surface, docked in the emoji panel's slot rather than presented
   * as a bottom sheet. Mounted on first open and hidden thereafter, exactly as
   * the emoji panel is, so a swap costs a visibility flip and not a rebuild.
   */
  const [attachOpen, setAttachOpen] = useState(false);
  const [attachMounted, setAttachMounted] = useState(false);
  /**
   * Whether CAMERA is granted, so the panel's first cell can show a live
   * viewfinder rather than an icon. Checked when the panel opens, never
   * requested from there — a permission dialog on panel open would be a prompt
   * the user did not ask for.
   * https://developer.android.com/training/permissions/requesting
   */
  const [cameraGranted, setCameraGranted] = useState(false);
  // Whether the docked emoji panel is open (it replaces the keyboard).
  const [emojiOpen, setEmojiOpen] = useState(false);
  /**
   * Whether the panel's OWN search field has the keyboard — the one state where
   * the keyboard and the panel are up together, so the usual "keyboard appeared,
   * put the panel away" rule has to be suspended. Mirrored into a ref because the
   * `keyboardDidShow` listener is registered once and would otherwise close the
   * panel from a stale closure the instant the search field raised the IME.
   */
  const [emojiSearching, setEmojiSearching] = useState(false);
  const searchingRef = useRef(false);
  /**
   * The panel is mounted on FIRST open and then never unmounted, so the swap
   * costs a visibility flip rather than a full rebuild — Telegram's
   * `createEmojiView()` / `setVisibility` split. Latched here so a user who never
   * opens it never pays for the mount.
   */
  const [panelMounted, setPanelMounted] = useState(false);
  /** The input row's measured height, so the expanded panel can subtract it. */
  const [rowHeight, setRowHeight] = useState(0);
  const { width: winW, height: winH } = useWindowDimensions();
  const landscape = winW > winH;
  const insets = useSafeAreaInsets();
  const [panelHeight, setPanelHeight] = useState(() => readKeyboardHeight(landscape));
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<readonly number[]>([]);
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  // The live handle, in a ref rather than state: nothing renders from it, and a
  // stop that raced a re-render would otherwise stop a recorder that had already
  // been replaced.
  const handle = useRef<RecordingHandle | null>(null);
  // The field, so the emoji button can focus it (and raise the keyboard, where
  // the emoji key lives — a full in-app picker is a follow-up).
  const inputRef = useRef<TextInput>(null);
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
  /**
   * Measure the keyboard, and hand the space back to it when it returns.
   *
   * `keyboardDidShow` is both the measurement (remembered for the next panel
   * open, per orientation) and the signal that the IME has finished coming up —
   * which is when the panel may safely go, not when the button was tapped. Take
   * it down any earlier and there is a frame with neither the panel nor the
   * keyboard, which is the drop-and-spring the swap exists to avoid.
   *
   * The one exception is the panel's own search field. It raises the same IME,
   * and closing the panel on it made emoji search unreachable: the panel vanished
   * and the keystrokes landed in nothing (found on device, 2026-09-04). Telegram
   * treats searching as its own state rather than as "keyboard up" — see
   * `design/references/telegram.md`.
   */
  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', e => {
      const h = e.endCoordinates.height;
      writeKeyboardHeight(h, landscape);
      setPanelHeight(readKeyboardHeight(landscape));
      if (!searchingRef.current) {
        setEmojiOpen(false);
        setAttachOpen(false);
      }
    });
    return () => shown.remove();
  }, [landscape]);

  // One signal for "a docked surface is up", because the dock's arithmetic is
  // the same for either of them.
  useEffect(() => {
    onPanelChange?.(emojiOpen || attachOpen);
  }, [emojiOpen, attachOpen, onPanelChange]);

  useEffect(() => {
    onPanelSearchChange?.(emojiSearching);
  }, [emojiSearching, onPanelSearchChange]);

  /** Keep the ref the keyboard listener reads in step with the state. */
  const onSearchFocusChange = useCallback((focused: boolean) => {
    searchingRef.current = focused;
    setEmojiSearching(focused);
  }, []);

  /**
   * Back closes the panel before it closes the screen.
   *
   * The panel is standing in for the keyboard, and back dismisses a keyboard
   * rather than leaving the chat — so it has to do the same here, or the swap
   * quietly changes what the system back button means (Amit, 2026-09-04: back
   * left the conversation instead of putting the emoji away).
   */
  useEffect(() => {
    if (!emojiOpen && !attachOpen) {
      return;
    }
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      // Searching is a state INSIDE the panel, so back leaves the panel and only
      // puts the search away — one back press per thing that is open, which is
      // what back means everywhere else in the app.
      if (searchingRef.current) {
        Keyboard.dismiss();
        return true;
      }
      setEmojiOpen(false);
      setAttachOpen(false);
      return true;
    });
    return () => sub.remove();
  }, [emojiOpen, attachOpen]);

  /**
   * Closing the panel closes its search with it. Without this the ref stays
   * true, and the next time the composer field raises the keyboard the listener
   * above would decline to put the panel away — a state nobody can get out of.
   */
  useEffect(() => {
    if (!emojiOpen && searchingRef.current) {
      searchingRef.current = false;
      setEmojiSearching(false);
    }
  }, [emojiOpen]);

  const ready = value.trim().length > 0 && !disabled;
  // Cross-fades the trailing slot between mic (empty) and send (has text).
  const trailing = useCrossfade(ready);

  /**
   * The camera's collapse, driven by the same `ready` the trailing slot uses.
   *
   * Animating width (not just opacity) is the point: the reference frame's
   * Writing state has the capsule grow into the space the camera and mic leave,
   * and a zero-opacity button that still occupies 40dp would leave the capsule
   * short with an invisible gap beside it.
   */
  const cameraOpen = useSharedValue(ready ? 0 : 1);
  useEffect(() => {
    cameraOpen.value = withTiming(ready ? 0 : 1, {
      duration: TOKENS.motion.duration.fast,
    });
  }, [ready, cameraOpen]);
  const cameraStyle = useAnimatedStyle(() => ({
    opacity: cameraOpen.value,
    width: CAMERA_SLOT * cameraOpen.value,
    // The gap collapses with it, or the capsule stops short of the send button.
    marginLeft: TOKENS.space.xs * cameraOpen.value,
  }));

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

  /**
   * Swap the keyboard for the panel, or the panel back for the keyboard.
   *
   * Telegram's `ChatActivityEnterView` does not "close the keyboard and open a
   * sheet" — it shows a popup view whose height IS the remembered keyboard
   * height and hides the IME in the same beat, so the composer never moves and
   * the grid appears to be what the keyboard turned into. Mounting the panel
   * BEFORE dismissing is what preserves that: dismiss-then-mount drops the
   * composer to the bottom of the screen for a frame and springs it back.
   */
  /**
   * Leave the search state and hand the focus back to the message field.
   *
   * Telegram does exactly this from two places — the emoji button
   * (`ChatActivityEnterView.java:2701-2707`) and a touch on the composer while
   * the panel is showing (`:5387-5391`): `setSearchingTypeInternal(0)`,
   * `emojiView.closeSearch(false)`, `messageEditText.requestFocus()`. The panel
   * has to be closed EXPLICITLY here, because the IME is already up and
   * `keyboardDidShow` — which is what normally takes the panel down — will not
   * fire a second time. That was the "switch doesn't work after clicking cross
   * on search" defect.
   */
  const leaveSearch = useCallback(() => {
    if (!searchingRef.current) {
      return false;
    }
    searchingRef.current = false;
    setEmojiSearching(false);
    setEmojiOpen(false);
    inputRef.current?.focus();
    return true;
  }, []);

  /**
   * The attach panel and the emoji panel share one slot and are exclusive.
   *
   * Sequenced the way `toggleEmoji` is, and for the same reason: the panel is
   * mounted BEFORE the keyboard is dismissed, so there is never a frame with
   * neither surface up. Opening it also closes the other one — the dock is only
   * ever as tall as one keyboard.
   */
  const toggleAttach = useCallback(() => {
    if (attachOpen) {
      // Back to the keyboard, the same handover the emoji button does.
      inputRef.current?.focus();
      setAttachOpen(false);
      return;
    }
    leaveSearch();
    setEmojiOpen(false);
    setAttachMounted(true);
    setAttachOpen(true);
    Keyboard.dismiss();
    /*
     * Read the permission, do not request it. `check` is silent; a request here
     * would fire a dialog the user never asked for just because they opened a
     * panel. The request happens on the capture tap, in `takePhoto`.
     */
    void PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.CAMERA)
      .then(setCameraGranted)
      .catch(() => setCameraGranted(false));
  }, [attachOpen, leaveSearch]);

  const toggleEmoji = useCallback(() => {
    if (emojiOpen) {
      if (leaveSearch()) {
        return;
      }
      // Back to the keyboard. Focusing raises the IME, and the keyboard-shown
      // listener takes the panel down once it is actually up — again so the two
      // never leave a gap between them.
      inputRef.current?.focus();
      return;
    }
    setAttachOpen(false);
    setPanelMounted(true);
    setEmojiOpen(true);
    Keyboard.dismiss();
  }, [emojiOpen, leaveSearch]);

  /** Insert at the end of the draft, the way a keyboard would. */
  const addEmoji = useCallback(
    (emoji: string) => {
      setValue(current => (current + emoji).slice(0, MAX_MESSAGE_CHARS));
      onTyping?.();
    },
    [onTyping],
  );

  /**
   * The key the keyboard took away when the panel replaced it.
   *
   * `Array.from(...).slice(0, -1)` was wrong for exactly the strings this panel
   * inserts: it iterates CODE POINTS, so one press of backspace over 👩🏽‍🚀 removed
   * the zero-width joiner and left two loose glyphs, and over 🇮🇳 left half a flag.
   * `deleteLastGrapheme` removes one user-perceived character. See
   * `src/lib/graphemes.ts`.
   */
  const backspace = useCallback(() => {
    setValue(current => deleteLastGrapheme(current));
  }, []);

  const onFieldFocus = useCallback(() => {
    // Touching the composer while the panel is searching leaves the search, the
    // same way Telegram's `onTouchEvent` does (`:5386-5391`).
    leaveSearch();
    onFocusChange?.(true);
  }, [leaveSearch, onFocusChange]);
  const onFieldBlur = useCallback(() => onFocusChange?.(false), [onFocusChange]);

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
      // Only `background` — not `inactive`. On Android the permission sheet,
      // multi-window transitions and the notification shade move the app to
      // `inactive` without the user leaving; treating that as cancel made the
      // second voice-note attempt look like "the mic died after the first fire".
      // https://reactnative.dev/docs/appstate
      if (next === 'background' && handle.current !== null) {
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
      /*
       * The panel goes with the send. Telegram dismisses its whole attach sheet
       * on a successful send (`ChatAttachAlert.dismiss()` from the send path),
       * and leaving ours open puts a live viewfinder under the message that was
       * just sent — which reads as "it did not go".
       *
       * Only on the success path: a refused pick (too large, unreadable) leaves
       * the panel up so the next attempt is one tap, not four.
       */
      setAttachOpen(false);
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
    if (disabled) {
      return;
    }
    const outcome = await requestAndroidPermission(
      PermissionsAndroid.PERMISSIONS.CAMERA,
    );
    if (outcome === 'never_ask_again') {
      errorTick();
      // Surface a notice with a direct link to Settings; Alert would block the
      // composer which is disruptive, so we use the store notice + a Linking
      // call so the user can dismiss and continue composing text instead.
      setNotice('Camera blocked. Open Settings to allow it.');
      Linking.openSettings().catch(() => undefined);
      return;
    }
    if (outcome !== 'granted') {
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
            press="none"
            highlight="ios"
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
          <SendButton onPress={sendDraft} disabled={disabled} sendHaloKey={sendHaloKey} />
        </View>
      </View>
    );
  }

  return (
    <>
    {/* Measured, not assumed: the panel's expanded height while searching is
        everything the header and the keyboard leave over, minus this row, and
        the row grows with the field (up to six lines) and with font scale. */}
    <View style={styles.row} onLayout={e => setRowHeight(e.nativeEvent.layout.height)}>
      <View style={styles.inputBar}>
      {/* The capsule. A SOLID themed surface, not a nested blur.

          It used to be a second BlurView sitting on the frosted dock, which made
          the pill a slightly-more-opaque pane of the same glass. The dock now
          carries no fill of its own (and none at all once the keyboard is up), so
          the pill has to be the thing that reads as a surface instead of the bar
          — a floating capsule over the transcript (Amit, 2026-09-04: "bar blurred
          without solid fill but pill stays solid white ... when click to type only
          floating pill and icons"). White in light, the elevated surface in dark,
          both from tokens rather than a literal white that would glare in dark. */}
      <View style={styles.field}>
        {/* Emoji, on the capsule's LEADING edge (Amit, 2026-09-04: "EMOJI should
            be on left corner of pill"). It is the first control in the row in
            Telegram too — `Gravity.BOTTOM | LEFT`, 44x44, leftMargin 2, padding
            7.5 around a 32dp glyph (`ChatActivityEnterView.java:2684,:2721`).

            Smile <-> keyboard, the way Telegram's does: while the panel is up the
            control's job is to bring the keyboard back, so it says so. */}
        <Pressable
          onPress={toggleEmoji}
          disabled={disabled}
          testID="composer-emoji"
          accessibilityLabel={emojiOpen ? 'Keyboard' : 'Emoji'}
          press="none"
          highlight="material"
          size={EMOJI_BUTTON}
          style={styles.emoji}>
          <Icon
            name={emojiOpen ? 'keyboard' : 'smile'}
            size={24}
            color={theme.color.text.secondary}
          />
        </Pressable>
        <TextField
          ref={inputRef}
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
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
        />
      </View>

      {/* Camera. It replaces the old "+" as the single media entry point and
          opens the SAME Camera / Photos chooser, so nothing is reachable only
          from a removed control — the gallery is one obvious tap deeper rather
          than gone (Amit, 2026-09-04).

          It collapses to nothing the moment there is text to send, together with
          the mic, leaving the send button alone beside the capsule (the reference
          frame's Writing state). Width as well as opacity, so the capsule takes
          the freed room instead of leaving a hole. */}
      <Animated.View style={cameraStyle} pointerEvents={ready ? 'none' : 'auto'}>
        <Pressable
          onPress={toggleAttach}
          disabled={disabled || ready}
          testID="composer-attach"
          accessibilityLabel="Add media"
          accessibilityHint="Camera or photos. One photo costs one token"
          press="none"
          highlight="material"
          size={40}
          style={styles.camera}>
          <Icon name="camera" size={22} color={theme.color.text.secondary} />
        </Pressable>
      </Animated.View>

      {/* One trailing control, never two competing — but they cross-fade now
          rather than hard-swapping (send scales up from nothing while the mic
          scales away the instant the field stops being empty). Both are mounted,
          stacked in one fixed slot, and `pointerEvents` gives touches to whichever
          is live so the hidden one cannot be tapped mid-fade. `ready` decides which
          is which; the return key still means the send. */}
      <View style={styles.trailing}>
        <Animated.View
          style={[styles.trailingLayer, trailing.hiddenStyle]}
          pointerEvents={ready ? 'none' : 'auto'}>
          <Pressable
            onPress={() => {
              void record();
            }}
            disabled={disabled || ready}
            testID="voice-record"
            accessibilityLabel="Record a voice note"
            accessibilityHint="Recording starts on tap and stops when you tap stop. One voice note costs one token"
            press="none"
            highlight="material"
            size={40}
            style={styles.mic}>
            <Icon name="mic" size={22} color={theme.color.text.secondary} />
          </Pressable>
        </Animated.View>
        <Animated.View
          style={[styles.trailingLayer, trailing.shownStyle]}
          pointerEvents={ready ? 'auto' : 'none'}>
          <SendButton onPress={submit} disabled={!ready} sendHaloKey={sendHaloKey} />
        </Animated.View>
      </View>
      </View>

      {/* The panel sits IN the dock, under the input row, occupying exactly what
          the IME occupied — so the composer stays where it was and the grid takes
          the space the keyboard just vacated. Telegram's `emojiPadding`, which is
          the whole reason its emoji panel reads as the keyboard changing rather
          than two surfaces trading places.

          `+ insets.bottom` is not decoration and it is the half of the sum that
          was missing. `keyboardDidShow.endCoordinates.height` under edge-to-edge
          reports the IME's height WITHOUT the navigation-bar inset, while the IME
          window itself runs to the bottom of the screen: measured on an S22
          Ultra, RN said 317dp and `dumpsys window` put the IME frame at
          [0,1382][1080,2316] — 332dp, exactly 15dp more, which is the gesture
          nav inset. Sizing the panel from the raw number left it 15dp short, so
          the composer fell by that much on every swap. */}
      {panelMounted ? (
      <EmojiPicker
        visible={emojiOpen}
        /*
         * Two sizes, one rule: the panel occupies whatever the keyboard is not.
         *
         * Not searching — the keyboard is down and the panel takes its exact
         * place. Searching — the keyboard is up UNDER the panel, the dock has
         * been lifted above it by the screen, and the panel expands into every
         * pixel between the header and the keyboard. That expansion is
         * Telegram's (`setStickersExpanded` on search open, height =
         * container − status bar − nav bar − action bar − composer); without it
         * the results would be a keyboard-sized window with a keyboard-sized
         * hole under it.
         */
        height={
          emojiSearching
            ? Math.max(panelCeiling - rowHeight, panelHeight)
            : panelHeight + insets.bottom
        }
        onBackspace={backspace}
        onPick={addEmoji}
        onSearchFocusChange={onSearchFocusChange}
      />
      ) : null}

      {/* The attach surface shares the emoji panel's slot and is exclusive with
          it, so the dock is only ever as tall as one keyboard. Mounted on first
          open and hidden thereafter, for the same reason the emoji panel is. */}
      {attachMounted ? (
        <AttachPanel
          visible={attachOpen}
          height={panelHeight + insets.bottom}
          cameraGranted={cameraGranted}
          onCamera={() => {
            void takePhoto();
          }}
          onGallery={() => {
            void pickImage();
          }}
        />
      ) : null}
    </View>


    </>
  );
}

export const Composer = memo(ComposerView);

const makeStyles = (t: Theme) => StyleSheet.create({
  row: {
    /*
     * Measured off Telegram on the SAME device rather than read off its source
     * (S22 Ultra, 1080x2316, density 2.8125), because the source dp and what the
     * bar actually renders at have disagreed before.
     *
     * With the IME up, Telegram's emoji button occupies [29,1232]-[153,1356] and
     * the IME frame starts at 1382 — so there are 26px, 9.2dp, between the bottom
     * of the composer's controls and the top of the keyboard. Idle, the same 26px
     * sits between the controls and the top of the navigation bar. Ours was 7px:
     * the pill was very nearly touching the keyboard (Amit, 2026-09-04: "distance
     * between pill and IME edge should be exactly as telegram").
     *
     * `xs` (8dp) plus the button's own 1dp of optical inset lands on the measured
     * 9.2dp; the horizontal inset of 8dp already matched Telegram's 10.3dp
     * closely enough that changing it would move the pill for no visible gain.
     */
    paddingHorizontal: TOKENS.space.xs,
    paddingTop: TOKENS.space['2xs'],
    paddingBottom: TOKENS.space.xs,
    backgroundColor: 'transparent',
  },
  // The idle bar: attach button, then the field taking the rest of the width.
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: TOKENS.space.xs,
  },
  attach: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachCircle: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    // Filled with the brand coral (#6): the "+" is the primary media action, so
    // the circle carries the accent rather than a neutral sunken grey.
    backgroundColor: t.color.bg.accent,
  },
  /*
   * The emoji button on the capsule's LEADING edge.
   *
   * Telegram's is the first control in the composer, `Gravity.BOTTOM | LEFT`,
   * a 44dp square with 7.5dp padding around a ~32dp glyph
   * (`ChatActivityEnterView.java:2684,:2721`). Ours is inside the capsule rather
   * than beside it, so it takes the capsule's height instead of 44 — but the
   * side, the bottom gravity and the circular press disc are Telegram's.
   *
   * `alignSelf: flex-end` so a field grown to several lines keeps the glyph on
   * the last line, as Telegram's bottom gravity does, instead of floating it to
   * the vertical middle of a tall capsule.
   */
  emoji: {
    width: EMOJI_BUTTON,
    height: EMOJI_BUTTON,
    // Circular, so the press state layer is a disc and not the rectangle the
    // un-rounded style used to clip it to (Amit, 2026-09-04).
    borderRadius: EMOJI_BUTTON / 2,
    alignSelf: 'flex-end',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The camera, outside the capsule, between it and the send/mic slot. Width is
  // animated (see `cameraStyle`), so nothing here may set one.
  camera: {
    width: CAMERA_SLOT,
    height: CAMERA_SLOT,
    borderRadius: CAMERA_SLOT / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: TOKENS.space.xs,
    // The emoji button is now the capsule's first child, so the LEADING inset
    // only has to clear the button's own press disc and the trailing one is the
    // text's breathing room. (These two were the other way round while the emoji
    // sat on the trailing edge.)
    paddingLeft: TOKENS.space.hair,
    paddingRight: TOKENS.space.md,
    // Zero: the 40dp input is the tallest child and IS the capsule height, so the
    // capsule is a true 40 (Telegram's, measured on device). Any field padding here
    // stacks on top of the 40 input and reads taller than the real app.
    paddingVertical: 0,
    borderRadius: TOKENS.radius.pill,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border.hairline,
    // A SOLID surface, not a nested blur: the dock behind it carries no fill of
    // its own, so the capsule is the only thing that reads as a surface. `raised`
    // is white in light and the elevated grey in dark — a literal white would
    // glare against a dark transcript.
    backgroundColor: t.color.bg.raised,
    overflow: 'hidden',
  },
  input: {
    flex: 1,
    // Mapped to Telegram measured ON DEVICE (S22, density 2.8125×), not the source
    // dp: its composer text is 16sp (glyph extent 17.4dp), NOT the 18 the source
    // constant implied, and its single-line field is ~40dp. The earlier 18/44
    // refactor rendered visibly larger than the real app. So: 16 text, a compact
    // field, includeFontPadding off to sit the glyph tight like Telegram's.
    // Capsule height = minHeight + field paddingVertical·2 ≈ 32 + 8 = 40.
    // Telegram's single-line field is 40dp with the 16sp text centred in it (not a
    // 28dp field with padding around it). So the INPUT itself is 40 and the capsule
    // wraps it with zero field padding — a true 40/40, matching the app on device.
    minHeight: 36,
    maxHeight: 132,
    paddingTop: 4,
    paddingBottom: 4,
    ...TOKENS.typography.bodyLarge,
    lineHeight: 20,
    includeFontPadding: false,
    textAlignVertical: 'center',
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
  // The trailing slot holds the send and mic stacked, OUTSIDE the field capsule
  // and beside it (mirror of the attach "+"). 40 tall so it aligns with the 40dp
  // capsule; the 38dp send/mic centre in it with room to spare.
  trailing: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  trailingLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mic: {
    width: 40,
    height: 40,
    borderRadius: 20,
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
});
