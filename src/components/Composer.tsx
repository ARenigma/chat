import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  BackHandler,
  StyleSheet,
  Text,
  type TextInput,
  View,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { KEYBOARD_CUBIC, M3, fadeSwapFast, fadeSwapOutFast, useCrossfade } from '../theme/motion';
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
import { useStore } from '../store/useStore';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { SendButton } from './SendButton';
import { readDraftText, writeDraftText } from '../lib/chatDraft';
import { Waveform } from './Waveform';
import { TextField } from './TextField';

/**
 * How far the reference app insets its input island from each screen edge, in dp.
 *
 * `createFrame(MATCH_PARENT, WRAP_CONTENT, Gravity.LEFT | Gravity.BOTTOM,
 * 7, 0, 7, 0)` — ChatActivity.java:8078 — with no further margin on the
 * container (ChatInputViewsContainer.java:42-43) and `setPadding(dp(7))` on its
 * blurred background at :81 agreeing. See the note on `row.paddingHorizontal`
 * for why this is a named constant rather than the nearest space token.
 */
export const COMPOSER_ISLAND_INSET = 7;

/**
 * Input field height bounds (dp).
 *
 * MIN matches the previous `minHeight: 36` so the single-line capsule is unchanged.
 * MAX encodes 6 lines — `TEXT_HEIGHT_MAX = 6` in the reference app
 * (ChatActivityEnterView.java:5778) — at lineHeight 20 plus paddingTop+Bottom 4+4:
 * 6×20 + 8 = 128dp, kept at the existing 132 cap for a hair of breathing room.
 *
 * Both constants are referenced by `onContentSizeChange` (animation) and the
 * contract test; one number cannot drift from the other.
 */
export const MIN_INPUT_H = 36;
export const MAX_INPUT_H = 132;

/**
 * The shortest the capsule may be and still PAINT `TOKENS.radius.bubble`.
 *
 * This is the number that makes "the composer shares the bubbles' roundness"
 * true rather than merely declared. CSS Backgrounds 3, Overlapping Curves:
 * "let f = min(Li/Si) ... if f < 1, then all corner radii are reduced by
 * multiplying them by f", where Lleft = Lright = the height of the box and Si is
 * the sum of that side's two radii. React Native implements exactly that on
 * Android — `BorderRadiusStyle.ensureNoOverlap()` computes
 * `leftEdgeRadiiScale = minOf(height / (topLeft.vertical + bottomLeft.vertical), 1f)`
 * and multiplies every corner by it.
 * https://www.w3.org/TR/css-backgrounds-3/#corner-overlap
 *
 * The capsule's trailing mic/send slot is 40dp tall, so before this the bar
 * laid out at 40, declared a
 * 22dp corner and PAINTED 22 x 40/44 = 20 — while a one-line message bubble is
 * about 54dp tall and painted a true 22. Two silhouettes, one grid, and nothing
 * in the code said why. 2 x radius.bubble is the height at which the scale
 * factor reaches 1 and the two coincide.
 *
 * Derived from the same token `Turn.tsx`'s BUBBLE_RADIUS reads, so the corner
 * and the height that lets it be drawn cannot drift apart.
 */
/*
 * The composer capsule's height, no longer derived from the bubble.
 *
 * It was `TOKENS.radius.bubble * 2`, which is the height at which a pill's two
 * corner arcs exactly meet — sound while the bubble radius WAS a pill radius
 * (22dp -> 44dp tall). WhatsApp's bubble is 9dp (measured on the Redmi), and
 * that derivation would give an 18dp-tall text input.
 *
 * So it is now the platform's minimum touch target. WhatsApp's own capsule
 * measures 46.2dp, which is BELOW Android's 48dp minimum — the same corner they
 * cut on their 38dp Call button — so this is a deliberate 1.8dp departure from
 * "exactly WhatsApp" in favour of the accessibility floor.
 * https://support.google.com/accessibility/android/answer/7101858
 */
export const CAPSULE_MIN_H = TOKENS.interaction.minTarget;

/**
 * The line geometry MIN/MAX are built from, named so the growth handler can
 * quantise to whole lines instead of chasing a pixel measurement.
 *
 * 6 lines is the reference app's cap (ChatActivityEnterView.java:5778); 20 is the
 * field's lineHeight and 8 its paddingTop + paddingBottom, which is exactly
 * how MAX_INPUT_H's 6x20 + 8 = 128 was derived above.
 */
export const INPUT_LINE_H = 20;
export const INPUT_PAD_V = 8;
export const MAX_INPUT_LINES = 6;

/**
 * The Bézier curve the reference app uses for its bar-growth animator.
 *
 * Source: ChatListItemAnimator.java:47
 *   `new CubicBezierInterpolator(0.199..., 0.011..., 0.279..., 0.910...)`
 * Already tokenised as `TOKENS.motion.m3.easing.keyboard`; consumed here via the
 * `M3` import from motion.ts so the value cannot drift between the dock travel and
 * the multi-line growth.
 *
 * Duration: ChatListItemAnimator.java:46 `DEFAULT_DURATION = 250`
 *   → `M3.duration.medium1`.  Used at the call-site, not here, so it is visible
 *   in the withTiming call without hunting.
 */
/*
 * `KEYBOARD_CUBIC` comes from motion.ts rather than being rebuilt here. This
 * file used to destructure `M3.easing.keyboard` and call `Easing.bezier` on it
 * — the identical curve motion.ts already exports under that name, derived
 * from the identical four token numbers (art-direction rule 2, DESIGN.md).
 */
const KEYBOARD_EASING = KEYBOARD_CUBIC;

interface Props {
  /**
   * Keys the draft persisted across an AppState backgrounding (X6, 2026-09-17
   * audit) — `undefined` while the conversation id is still resolving, which
   * simply defers the restore/persist effects until it arrives.
   */
  conversationId: string | undefined;
  onSend: (text: string) => void;
  /** A finished recording, ready to upload. Both roles get this: the provider
   *  tree renders the same ChatScreen, and voice notes are in scope for both. */
  onSendVoice: (draft: VoiceDraft) => void;
  disabled: boolean;
  placeholder: string;
  sendHaloKey: number;
  /**
   * Fired per keystroke so the other side can be shown a typing indicator. The
   * throttling lives in the Realtime layer, not here, the composer should not
   * have to know how often a broadcast is affordable.
   */
  onTyping?: () => void;
  /** Held while a voice note records, so the peer sees "recording" not silence. */
  onRecording?: () => void;
  /** Mic released, by any route including unmount. */
  onRecordingEnded?: () => void;
  /**
   * Fired when the field takes or loses focus, so the dock behind it can drop
   * its frost entirely while composing — the composer becomes a floating capsule
   * over the transcript rather than a bar (Amit, 2026-09-04).
   */
  onFocusChange?: (focused: boolean) => void;
  /** Reports the measured composer row height for adjacent overlays. */
  onDockGeometry?: (h: number) => void;
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
 * How often the recording signal is re-sent while the mic is held.
 *
 * Matches the typing throttle in api/realtime.ts: the sender throttles at that
 * interval anyway, so pinging faster would be discarded and pinging slower
 * would let the peer's 4s TTL expire mid-note.
 */
const RECORD_PING_MS = 1_500;

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
 * It also costs a `usePanGesture` inside a row that lives above an inverted
 * list, where a horizontal pan and the list's scroll have to be taught not to
 * fight. `contract.test.ts` enumerates every file that declares a gesture,
 * precisely so the next pan is a decision rather than a copy, and this one
 * cannot be verified anywhere but on a device.
 *
 * So: tap the mic, watch the meter, tap stop, then send or discard. If the hold
 * is added later it belongs on top of this, not instead of it.
 */
function ComposerView({
  conversationId,
  onSend,
  onSendVoice,
  disabled,
  placeholder,
  sendHaloKey,
  onTyping,
  onRecording,
  onRecordingEnded,
  onFocusChange,
  onDockGeometry,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const setNotice = useStore(s => s.setNotice);
  const [value, setValue] = useState('');
  const [mode, setMode] = useState<Mode>('idle');

  /*
   * Restores a draft persisted across an AppState backgrounding (X6,
   * 2026-09-17 audit — Amit's rule: the draft survives backgrounding,
   * including an OS process kill while backgrounded, and is purged only on
   * an intentional exit; see `chatDraft.ts` and ChatScreen's own purge calls
   * on leaving to Home or into a call).
   *
   * `conversationId` resolves asynchronously (ChatScreen's own comment on
   * `knownThread`/`openedId`), so this cannot be the `useState` initializer —
   * it has to be an effect that fires once the id actually arrives. Guarded
   * on `value === ''` so it can never clobber a character the member has
   * already typed in the brief window before the id resolves.
   */
  const restoredFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (conversationId === undefined || conversationId === restoredFor.current) {
      return;
    }
    restoredFor.current = conversationId;
    setValue(current => (current === '' ? readDraftText(conversationId) : current));
  }, [conversationId]);

  // Read by the AppState listener below without being in its dep array — the
  // listener is registered once for lifetime (same idiom as App.tsx's
  // `bootPhaseRef`), not re-subscribed on every keystroke.
  const valueRef = useRef(value);
  valueRef.current = value;
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;

  /*
   * Tell the peer a voice note is being recorded, for as long as it is.
   *
   * Keyed on `mode` rather than hooked into each transition because there are
   * six paths out of 'recording' (send, review, cancel, backgrounded, a call
   * arriving, unmount) and a signal that leaks on any one of them leaves the
   * other person watching an indicator for something that stopped.
   *
   * Re-pinged on an interval because the receiver drops the indicator after a
   * TTL, and a voice note outlasts it. the reference app does the same thing for the
   * same reason (MessagesController.java:11441).
   */
  useEffect(() => {
    if (mode !== 'recording' || onRecording === undefined) {
      return;
    }
    onRecording();
    const ping = setInterval(onRecording, RECORD_PING_MS);
    return () => {
      clearInterval(ping);
      onRecordingEnded?.();
    };
  }, [mode, onRecording, onRecordingEnded]);
  /** The row stays in normal flex flow below the transcript. */
  const [rowHeight, setRowHeight] = useState(0);
  useEffect(() => {
    onDockGeometry?.(rowHeight);
  }, [onDockGeometry, rowHeight]);
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<readonly number[]>([]);
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  // The live handle, in a ref rather than state: nothing renders from it, and a
  // stop that raced a re-render would otherwise stop a recorder that had already
  // been replaced.
  const handle = useRef<RecordingHandle | null>(null);
  // The field ref is used by hardware-back handling.
  const inputRef = useRef<TextInput>(null);
  /** Read inside the `hardwareBackPress` callback below — see its own comment. */
  const fieldFocusedRef = useRef(false);
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
   * Animated height of the text-input wrapper.
   *
   * `onContentSizeChange` measures the content, clamps it to [MIN_INPUT_H,
   * MAX_INPUT_H], and drives this value over 250ms on the keyboard's Bézier
   * (the reference app DEFAULT_INTERPOLATOR, ChatListItemAnimator.java:47) so the capsule
   * grows and shrinks with each added or removed line — no jump, no dip.
   *
   * Using a shared value rather than state so the animation starts on the UI
   * thread the same frame the content size changes, not one commit later.
   */
  const inputH = useSharedValue(MIN_INPUT_H);
  /** Last settled line count, so an identical remeasure starts no animation. */
  const lineCountRef = useRef(1);
  // RULE 1 §6 STATED DEPARTURE — animates `height` on the in-flow input
  // wrapper, a real Yoga cost every frame of the 250ms grow. The rule says
  // animate transform/opacity only. The departure is correct here: a
  // multi-line TextInput cannot be height-constrained via transform without
  // breaking text layout — the text node must actually reflow inside a taller
  // container. Bounded at M3.duration.medium1 = 250ms, and guarded by
  // `lineCountRef` so only an actual line-count change starts the animation
  // (identical remeasures do nothing). Unproven on low-end hardware — a frame
  // trace on the Redmi is the open question before calling this solved.
  const inputHStyle = useAnimatedStyle(() => ({ height: inputH.value }));

  const ready = value.trim().length > 0 && !disabled;
  // Cross-fades the trailing slot between mic (empty) and send (has text).
  const trailing = useCrossfade(ready);

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

  const onFieldFocus = useCallback(() => {
    fieldFocusedRef.current = true;
    onFocusChange?.(true);
  }, [onFocusChange]);
  const onFieldBlur = useCallback(() => {
    fieldFocusedRef.current = false;
    onFocusChange?.(false);
  }, [onFocusChange]);

  /**
   * Back dismisses the keyboard before it leaves the chat.
   *
   * A back press with the keyboard up otherwise falls through to App.tsx's single
   * global `hardwareBackPress` subscription — which treats back as "leave the
   * conversation." Android normally swallows back-while-focused as an IME
   * dismiss before JS ever sees it, but under this app's edge-to-edge IME
   * handling that swallow and the JS event can both fire, so the global
   * handler's navigation and the OS's own keyboard-dismiss raced: found on
   * device (S22) as the chat screen's own scroll position and touch targets
   * going stale directly under the composer after backing out of the
   * keyboard while scrolled up in history — the Chats list underneath had
   * begun re-mounting while ChatScreen was still on screen. `fieldFocusedRef`
   * rather than the `composerFocused` store field: this must be read inside a
   * `BackHandler` callback, not a render, and the store's own rule is that
   * only leaf hook consumers subscribe to it.
   */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!fieldFocusedRef.current) {
        return false;
      }
      inputRef.current?.blur();
      return true;
    });
    return () => sub.remove();
  }, []);

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

  /*
   * Writes the draft to MMKV on the same `background` transition, so it
   * survives whatever Android does to the process next — same trigger as the
   * mic-cancel effect above, same `background`-only reasoning, kept as a
   * separate effect because the two are unrelated concerns that happen to
   * share a signal.
   *
   * There is deliberately no purge here: leaving the field non-empty on the
   * way out is exactly the case this exists for. Purging on an intentional
   * exit is ChatScreen's job (it owns the navigation), not this component's.
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      const id = conversationIdRef.current;
      if (next === 'background' && id !== undefined) {
        writeDraftText(id, valueRef.current);
      }
    });
    return () => sub.remove();
  }, []);

  const sendDraft = useCallback(() => {
    if (draft === null) {
      return;
    }
    onSendVoice(draft);
    setDraft(null);
    setMode('idle');
  }, [draft, onSendVoice]);

  if (mode === 'recording') {
    return (
      /*
       * Keyed by `mode` (M12, 2026-09-17 audit): idle → recording → review
       * used to be a hard cut between three early-return trees. A deliberate
       * mic tap, not a keyboard-frequency event, so the same fadeSwapFast/
       * fadeSwapOutFast pair the Notify button and HeaderSubtitle use fits —
       * the idle branch itself is untouched, since typing is the composer's
       * 100+/day default state and the project's own motion gate says that
       * tier gets nothing.
       */
      <Animated.View
        key={mode}
        entering={fadeSwapFast}
        exiting={fadeSwapOutFast}
        style={styles.row}>
        <View style={styles.panel}>
          <Pressable
            onPress={() => {
              void discard();
            }}
            testID="voice-cancel"
            accessibilityLabel="Cancel recording"
            press="none"
            highlight="dim"
            size={32}
            // Circle, not the square touch box: `panelButton` sets no radius, so
            // the `dim` fill painted a solid 32dp square behind a 14pt glyph.
            // Icon-only controls take borderless (circular) ink here, not the
            // bounded rectangular kind.
            // https://developer.android.com/training/material/animations
            shape="circle"
            style={styles.panelButton}
          >
            <Icon name="close" size={TOKENS.icon.sm} color={theme.color.text.secondary} />
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
            highlight="dim"
            size={32}
            style={styles.stop}
          >
            <Icon name="stop" size={TOKENS.icon.sm} color={theme.color.text.primary} />
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  if (mode === 'review' && draft !== null) {
    return (
      <Animated.View
        key={mode}
        entering={fadeSwapFast}
        exiting={fadeSwapOutFast}
        style={styles.row}>
        <View style={styles.panel}>
          <Pressable
            onPress={() => {
              void discard();
            }}
            testID="voice-discard"
            accessibilityLabel="Discard this recording"
            press="none"
            highlight="dim"
            size={32}
            // Same as voice-cancel above: `panelButton` has no radius of its own,
            // so the `dim` fill needs the circle or it paints a 32dp square.
            // https://developer.android.com/training/material/animations
            shape="circle"
            style={styles.panelButton}
          >
            <Icon name="close" size={TOKENS.icon.sm} color={theme.color.text.secondary} />
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
      </Animated.View>
    );
  }

  return (
    <>
    <View>
    {/* Measured because the row grows with the field (up to six lines) and
        with font scale. */}
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
        {/*
          * The wrapper's height is the animated value; the field inside fills
          * it via `flex: 1`. `onContentSizeChange` reports the natural content
          * height (all lines, regardless of the container) so it drives the
          * animation even while the field is constrained to a smaller size.
          * the reference app: bar growth 250ms on DEFAULT_INTERPOLATOR
          * (ChatListItemAnimator.java:46-47; ChatActivity.java:7896-7940).
          */}
        <Animated.View style={[styles.inputWrapper, inputHStyle]}>
          <TextField
            ref={inputRef}
            testID="composer-input"
            nativeID="composer-input"
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
            /*
             * The three composer hints used to end "…costs one token" — on the
             * field, the attach button and the mic. All three were false, not
             * merely old vocabulary: migration 037 made `spend_chat_minute` a
             * no-op and billing became per-minute on a live session, so nothing
             * here is charged per item. TalkBack users were being quoted a
             * price that does not exist.
             *
             * The two that describe a real non-obvious outcome kept a hint with
             * the price claim removed. This one lost its hint entirely, because
             * once the false half is gone the rest only restates the label —
             * which the accessibility guidance names as the thing a hint must
             * not do:
             * developer.android.com/guide/topics/ui/accessibility/principles
             */
            accessibilityLabel="Message"
            underlineColorAndroid="transparent"
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            onContentSizeChange={e => {
              /*
               * QUANTISED TO WHOLE LINES, and only animated when the line count
               * actually changes.
               *
               * Animating the raw content height looked right and measured
               * wrong. Frame-stepped on the Redmi at 60fps while typing a
               * message that wrapped to three lines: the capsule's top edge
               * jumped DOWN 80px in a single frame (1376 -> 1456) and again by
               * 40px (1405 -> 1445), and overshot its resting height by 8px
               * across 17 frames. Android's TextInput fires
               * `onContentSizeChange` repeatedly mid-layout and reports
               * transient heights while a line is wrapping; each one restarted
               * a 250ms animation toward a different target, and the restarts
               * are the dip.
               *
               * the reference app sizes from the LINE COUNT, not the pixel height
               * (ChatActivityEnterView.java:5778 caps it at 6). Rounding to a
               * line makes a transient measurement land on the same integer as
               * the settled one, so it produces no animation at all — the dip
               * becomes unrepresentable rather than merely unlikely.
               */
              const lines = Math.min(
                MAX_INPUT_LINES,
                Math.max(
                  1,
                  Math.round(
                    (e.nativeEvent.contentSize.height - INPUT_PAD_V) / INPUT_LINE_H,
                  ),
                ),
              );
              if (lines === lineCountRef.current) {
                return;
              }
              lineCountRef.current = lines;
              inputH.value = withTiming(lines * INPUT_LINE_H + INPUT_PAD_V, {
                duration: M3.duration.medium1,
                easing: KEYBOARD_EASING,
              });
            }}
          />
        </Animated.View>
      </View>

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
            accessibilityHint="Recording starts on tap and stops when you tap stop"
            press="none"
            highlight="material"
            size={40}
            style={styles.mic}>
            {/* `icon.lg` (24) — see the emoji button's own comment for the
                the reference app measurement this matches. */}
            <Icon name="mic" size={TOKENS.icon.lg} color={theme.color.text.secondary} />
          </Pressable>
        </Animated.View>
        <Animated.View
          style={[styles.trailingLayer, trailing.shownStyle]}
          pointerEvents={ready ? 'auto' : 'none'}>
          <SendButton onPress={submit} disabled={!ready} sendHaloKey={sendHaloKey} />
        </Animated.View>
      </View>
      </View>
    </View>
    </View>

    </>
  );
}

export const Composer = memo(ComposerView);

const makeStyles = (t: Theme) => StyleSheet.create({
  row: {
    /*
     * Measured off the reference app on the SAME device rather than read off its source
     * (S22 Ultra, 1080x2316, density 2.8125), because the source dp and what the
     * bar actually renders at have disagreed before.
     *
     * With the IME up, the reference app's emoji button occupies [29,1232]-[153,1356] and
     * the IME frame starts at 1382 — so there are 26px, 9.2dp, between the bottom
     * of the composer's controls and the top of the keyboard. Idle, the same 26px
     * sits between the controls and the top of the navigation bar. Ours was 7px:
     * the pill was very nearly touching the keyboard (Amit, 2026-09-04: "distance
     * between pill and IME edge should be exactly as the reference app").
     *
     * `xs` (8dp) plus the button's own 1dp of optical inset lands on the measured
     * 9.2dp; the horizontal inset of 8dp already matched the reference app's 10.3dp
     * closely enough that changing it would move the pill for no visible gain.
     */
    /*
     * THE REFERENCE 7dp, read from source rather than approximated.
     *
     * `chatInputBubbleContainer.addView(chatActivityEnterView,
     * LayoutHelper.createFrame(MATCH_PARENT, WRAP_CONTENT,
     * Gravity.LEFT | Gravity.BOTTOM, 7, 0, 7, 0))` — ChatActivity.java:8078 —
     * and the container it goes into adds no horizontal margin of its own
     * (`createFrame(MATCH_PARENT, WRAP_CONTENT, Gravity.BOTTOM)`,
     * ChatInputViewsContainer.java:42-43). `blurredBackgroundDrawable
     * .setPadding(dp(7))` at :81 corroborates it. Clone at
     * the local reference checkout; measured facts only (ADR-0025).
     *
     * WAS `space.md` (16), chosen so the capsule's outer edges lined up with the
     * message bubbles' edges — both reading `list.paddingHorizontal`. That was a
     * real property and it is knowingly given up here: Amit asked for the input
     * box's width to match the reference app exactly (2026-09-12), and the reference app's input
     * island is deliberately WIDER than its bubbles. Two references in one
     * control is the thing to avoid, so the corner (radius.composer, now 22)
     * and the inset (7) both come from the reference app now.
     *
     * 7 is not on the space scale and must not be rounded onto it — 8 would be
     * "close enough" in exactly the way this file has been burned by before. It
     * is a measured source value, which this repo keeps as a named constant
     * (the `SOURCE_METRICS` / `RIPPLE` precedent).
     */
    paddingHorizontal: COMPOSER_ISLAND_INSET,
    paddingTop: TOKENS.space['2xs'],
    paddingBottom: TOKENS.space.xs,
    backgroundColor: 'transparent',
  },
  // One capsule containing the text field and the mic/send trailing control.
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: TOKENS.space.xs,
    // Trailing inset is smaller than the field's own, because the mic disc now
    // sits inside the capsule and brings its own optical padding.
    paddingLeft: TOKENS.space.hair,
    paddingRight: TOKENS.space.hair,
    /*
     * CAPSULE_MIN_H, not the 40dp the children add up to, and this is a
     * correctness fix rather than a taste one: at 40 the declared corner below
     * was scaled down by RN Android's corner-overlap clamp while the message
     * bubbles painted a true 22, so the capsule and the bubble scrolling under
     * it traced different silhouettes. See CAPSULE_MIN_H for the rule and its
     * source (`TOKENS.interaction.minTarget`, the 48dp a11y minimum touch
     * target — not 44, which this comment and `paddingVertical` both assumed
     * until Amit found the send button sitting closer to the capsule's bottom
     * edge than its top, 2026-09-18). `space.hair` (2dp) padding only ever
     * matched a 44dp floor; against the real 48dp one it left 4dp of slack
     * `alignItems: 'flex-end'` puts entirely above the (bottom-anchored)
     * icons rather than splitting it, since a genuinely-idle capsule never
     * grows past its own minHeight for the icons to be "anchored against".
     * `space['2xs']` (4dp) each side makes the declared box exactly
     * CAPSULE_MIN_H on its own — 4 + 40 + 4 = 48 — so there is no slack left
     * for flex-end to place unevenly. `minHeight` stays as the floor so a
     * real multi-line field can still grow past it, at which point flex-end
     * correctly keeps every icon pinned to the last line, which is what it
     * is for.
     */
    minHeight: CAPSULE_MIN_H,
    paddingVertical: TOKENS.space['2xs'],
    /*
     * `radius.bubble` (22dp) rather than `radius.pill` (999).
     *
     * The SAME corner as the message bubbles (Turn.tsx reads the same token for
     * both mine/peer), which is what makes the edges read as one continuous grid
     * as the transcript scrolls past the composer. `radius.pill` at a tall
     * multi-line height looks like a stadium; this looks like a bubble. One
     * token, two components, zero drift — and paired with `minHeight` above,
     * because a box shorter than twice its corner cannot draw that corner.
     */
    borderRadius: TOKENS.radius.composer,
    borderCurve: 'continuous',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.color.border.hairline,
    // `raised` is white in light and the elevated grey in dark; a literal white
    // would glare against a dark transcript.
    backgroundColor: t.color.bg.raised,
    overflow: 'hidden',
  },
  field: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: TOKENS.space.xs,
    // Zero. The 40dp of children is the capsule's CONTENT height; the capsule
    // itself is CAPSULE_MIN_H (44) because a 40dp box cannot paint a 22dp
    // corner. That 4dp lives on `inputBar`'s own paddingVertical, where it is
    // symmetric — any field padding here would stack on top of the 40 and push
    // the capsule taller still.
    paddingVertical: 0,
    // No nested surface: inputBar owns the capsule.
  },
  /*
   * Animated wrapper for the text field.
   *
   * `flex: 1` fills the remaining horizontal space in the `field` row (replacing
   * the `flex: 1` that was on `input` directly). The vertical size is driven by
   * the `inputHStyle` shared value, not by any style here, so the compiler cannot
   * accidentally add a height literal.
   *
   * `overflow: 'hidden'` is omitted: `inputBar` already clips via its own
   * overflow, and a second clip here would be redundant.
   */
  inputWrapper: {
    flex: 1,
  },
  input: {
    /*
     * `flex: 1` fills the wrapper's height in the column direction (Animated.View
     * defaults to column; its height comes from `inputHStyle`).
     *
     * `minHeight` and `maxHeight` are removed — the wrapper is the height-owning
     * element now. MIN_INPUT_H and MAX_INPUT_H are enforced in `onContentSizeChange`.
     *
     * the reference app source: 16sp text, includeFontPadding false, bottom gravity, max
     * 6 lines — ChatActivityEnterView.java:5779,5781,5778,5750.
     * Measured on S22 Ultra: single-line field 40dp (density 2.8125×).
     */
    flex: 1,
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
    /*
     * The same corner as the typing capsule and the bubbles, so all three
     * composer modes trace one silhouette in the same slot. `radius.pill` here
     * was clamped to 25 by the corner-overlap rule at this 50dp height (see
     * CAPSULE_MIN_H) and read as a stadium beside a 22dp bubble. 50 > 44, so
     * this corner paints unscaled.
     */
    borderRadius: TOKENS.radius.composer,
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
