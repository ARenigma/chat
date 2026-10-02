import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import { AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { Icon } from '../components/Icon';
import { TextField } from '../components/TextField';
import { Waveform } from '../components/Waveform';
import {
  clearChatDraft,
  readDraftText,
  writeDraftText,
} from '../lib/chatDraft';
import { errorTick, tick } from '../lib/haptics';
import { MAX_MESSAGE_CHARS } from '../lib/tokenLedger';
import {
  ensureMicrophone,
  startRecording,
  type RecordingHandle,
} from '../lib/recorder';
import { clock, isSendable, padBars, type VoiceDraft } from '../lib/voice';
import { useStore } from '../store/useStore';
import { fadeSwapFast } from '../theme/motion';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import {
  CHAT_V2_RECORD_PING_MS,
  chatV2TrailingControl,
  type ChatV2ComposerMode,
} from './cells';

/**
 * Lets the screen finish a send it held back. A member's first reply in a
 * conversation with no session waits for the session-start dialog (the send
 * returns false, so the text or recording stays put); once they say yes the
 * screen calls `resend()`, which sends whatever the composer is holding.
 */
export interface ChatComposerV2Handle {
  resend: () => void;
}

interface Props {
  ref?: Ref<ChatComposerV2Handle>;
  bottomInset: number;
  /** Benchmark route may exercise layout but cannot invoke mutations. */
  readOnly?: boolean;
  /**
   * False when the send was refused before it left (the contact guard's
   * precheck): the text stays in the field, where the sender can edit it.
   */
  onSend: (text: string) => boolean;
  /**
   * A finished recording, ready to upload. False keeps it in review, the same
   * contract as `onSend`.
   */
  onSendVoice: (draft: VoiceDraft) => boolean;
  /** Persists the draft across a process death, and is cleared on send. */
  conversationId: string | undefined;
  /**
   * Off while the conversation cannot take a message — no thread yet, chat
   * closed, or consent outstanding. The placeholder carries the reason; a
   * greyed field saying "Message" would be the app declining to say why.
   */
  disabled?: boolean;
  placeholder?: string;
  /** Throttled inside `useLiveConversation`; safe to call per keystroke. */
  onTyping?: () => void;
  onRecording?: () => void;
  onRecordingEnded?: () => void;
  /**
   * False once the chat is covered (navigation step 6). A covered chat stays
   * mounted under the navigator, so what the unmount did has to happen on
   * blur: a recording in progress is discarded (nothing records for a screen
   * nobody is on) and the text draft is saved. Defaults to true.
   */
  focused?: boolean;
  /**
   * Opens the birth-details card. Set only in a member's chat with an
   * astrologer; absent everywhere else, and then no control is drawn.
   */
  onBirthDetails?: () => void;
}

export function ChatComposerV2({
  ref,
  bottomInset,
  readOnly = false,
  onSend,
  onSendVoice,
  conversationId,
  disabled = false,
  placeholder = 'Message',
  onTyping,
  onRecording,
  onRecordingEnded,
  focused = true,
  onBirthDetails,
}: Props) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const setNotice = useStore(s => s.setNotice);
  const [text, setText] = useState('');
  const [mode, setMode] = useState<ChatV2ComposerMode>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [levels, setLevels] = useState<readonly number[]>([]);
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  /*
   * The live recorder, in a ref rather than state: nothing renders from it, and
   * a stop that raced a re-render would stop a recorder that had already been
   * replaced.
   */
  const handle = useRef<RecordingHandle | null>(null);
  /*
   * Which attempt is current, bumped by every start, stop and discard.
   *
   * It covers one gap, and it is the worst failure this feature has: starting
   * the recorder is asynchronous (a permission dialog, then
   * `MediaRecorder.prepare`), so a stop is reachable BEFORE there is a handle
   * to stop. Without this the recorder resolves into a ref nothing is watching
   * and the microphone stays live.
   * https://developer.android.com/reference/android/media/MediaRecorder
   */
  const attempt = useRef(0);

  /* ---- the draft, across a process death -------------------------------- */
  const textRef = useRef(text);
  textRef.current = text;
  const conversationRef = useRef(conversationId);
  conversationRef.current = conversationId;
  const seededFor = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (conversationId === undefined || seededFor.current === conversationId) {
      return;
    }
    seededFor.current = conversationId;
    const stored = readDraftText(conversationId);
    if (stored !== '') {
      setText(stored);
    }
  }, [conversationId]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      const id = conversationRef.current;
      if (next === 'background' && id !== undefined) {
        writeDraftText(id, textRef.current);
      }
    });
    return () => sub.remove();
  }, []);

  /* ---- the recording signal --------------------------------------------- */
  /*
   * Keyed on `mode` rather than hooked into each transition, because there are
   * five ways out of 'recording' (send, review, cancel, backgrounded, unmount)
   * and a signal that leaks on any one of them leaves the other person watching
   * an indicator for something that stopped.
   */
  useEffect(() => {
    if (mode !== 'recording' || onRecording === undefined) {
      return;
    }
    onRecording();
    const ping = setInterval(onRecording, CHAT_V2_RECORD_PING_MS);
    return () => {
      clearInterval(ping);
      onRecordingEnded?.();
    };
  }, [mode, onRecording, onRecordingEnded]);

  const finish = useCallback((next: VoiceDraft | null) => {
    handle.current = null;
    // Under a second is discarded silently: at that length it is a mistap on
    // the mic, and refusing it with a notice would be telling somebody off for
    // brushing a button.
    if (next === null || !isSendable(next.durationMs)) {
      setDraft(null);
      setMode('idle');
      return;
    }
    setDraft(next);
    setMode('review');
  }, []);

  const record = useCallback(async () => {
    if (disabled || readOnly || handle.current !== null) {
      return;
    }
    const mine = attempt.current + 1;
    attempt.current = mine;
    if (!(await ensureMicrophone())) {
      errorTick();
      // A permanent denial is a system setting, not something to retry, so the
      // notice says where the switch is rather than offering a dialog that
      // would never open again.
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
        // Stopped or discarded while the recorder was starting. Stop the
        // hardware rather than storing a handle nothing will reach.
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
  }, [disabled, finish, readOnly, setNotice]);

  const stop = useCallback(async () => {
    const current = handle.current;
    attempt.current += 1;
    if (current === null) {
      // Either the recorder has not finished starting — the bump above cancels
      // it — or `onLimit` already handed a draft over. The mode is left alone
      // deliberately: forcing it to idle would throw away a landed recording.
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

  /*
   * Stop recording the moment the app leaves the foreground.
   *
   * The manifest's permission comment says nothing records while the app is not
   * in the foreground, and the Play Data Safety declaration rests on the same
   * sentence. `background` only, never `inactive`: the permission sheet and the
   * notification shade both move the app to `inactive` without anybody leaving.
   * https://reactnative.dev/docs/appstate
   */
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'background' && handle.current !== null) {
        void discard();
      }
    });
    return () => sub.remove();
  }, [discard]);

  /* ---- losing focus, which is leaving under the navigator ---------------- */
  useEffect(() => {
    if (focused) {
      return;
    }
    const id = conversationRef.current;
    if (id !== undefined) {
      writeDraftText(id, textRef.current);
    }
    if (handle.current !== null) {
      void discard();
    }
  }, [focused, discard]);

  /* ---- leaving the screen mid-recording --------------------------------- */
  useEffect(
    () => () => {
      attempt.current += 1;
      void handle.current?.cancel();
      handle.current = null;
    },
    [],
  );

  const onChangeText = useCallback(
    (next: string) => {
      setText(next);
      onTyping?.();
    },
    [onTyping],
  );

  const send = useCallback(() => {
    if (disabled || readOnly || text.trim() === '') {
      return;
    }
    if (!onSend(text)) {
      return;
    }
    setText('');
    // A sent message is not a draft any more. Purging here rather than letting
    // the next backgrounding write an empty string keeps the stored value and
    // the field honest at every moment in between.
    if (conversationId !== undefined) {
      clearChatDraft(conversationId);
    }
  }, [conversationId, disabled, onSend, readOnly, text]);

  const sendVoice = useCallback(() => {
    if (readOnly || draft === null) {
      return;
    }
    if (!onSendVoice(draft)) {
      return;
    }
    setDraft(null);
    setMode('idle');
  }, [draft, onSendVoice, readOnly]);

  // A held recording is in review; anything else held is the typed text.
  useImperativeHandle(
    ref,
    () => ({ resend: draft !== null ? sendVoice : send }),
    [draft, send, sendVoice],
  );

  const control = chatV2TrailingControl({ mode, text, disabled });

  if (mode === 'recording' || mode === 'review') {
    const recording = mode === 'recording';
    return (
      <Animated.View
        // A deliberate mic tap, not a keyboard-frequency event, so the swap
        // between the capsule and this bar gets a fade rather than a hard cut.
        // Keyed so the two trees are separate entrances, never a morph.
        key={mode}
        entering={fadeSwapFast}
        style={[styles.root, { paddingBottom: bottomInset + TOKENS.space.xs }]}
      >
        <View style={styles.recordBar}>
          <Pressable
            testID="chat-v2-record-discard"
            accessibilityRole="button"
            accessibilityLabel={
              recording ? 'Cancel recording' : 'Discard this recording'
            }
            hitSlop={TOKENS.space.xs}
            style={styles.recordControl}
            onPress={() => {
              void discard();
            }}
          >
            <Icon
              name="delete"
              size={TOKENS.icon.md}
              color={theme.color.state.danger}
            />
          </Pressable>
          <Text
            testID="chat-v2-record-elapsed"
            allowFontScaling={false}
            style={styles.recordClock}
          >
            {clock(recording ? elapsed : draft?.durationMs ?? 0)}
          </Text>
          <View style={styles.recordWave}>
            <Waveform
              peaks={padBars(recording ? levels : draft?.peaks ?? [])}
              // Nothing is unplayed while recording: everything drawn has
              // already happened.
              progress={1}
              tint={theme.color.text.secondary}
              dim={0.45}
              testID="chat-v2-record-wave"
            />
          </View>
          <Pressable
            testID={recording ? 'chat-v2-record-stop' : 'chat-v2-send'}
            accessibilityRole="button"
            accessibilityLabel={
              recording ? 'Stop recording' : 'Send voice note'
            }
            hitSlop={TOKENS.space.xs}
            style={[styles.trailingControl, styles.sendControl]}
            onPress={() => {
              if (recording) {
                void stop();
                return;
              }
              sendVoice();
            }}
          >
            <Icon
              name={recording ? 'stop' : 'send'}
              size={TOKENS.icon.md}
              color={theme.color.text.onAccent}
            />
          </Pressable>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View
      key="idle"
      entering={fadeSwapFast}
      style={[styles.root, { paddingBottom: bottomInset + TOKENS.space.xs }]}
    >
      <View
        style={[
          styles.field,
          onBirthDetails !== undefined ? styles.fieldWithLeading : null,
        ]}
      >
        {onBirthDetails !== undefined ? (
          /*
           * The leading slot, which v2 had emptied (no photo picker): in an
           * astrologer chat it holds the one structured thing worth sending.
           * The category's own glyph, because the icon set has no calendar and
           * this is the astrologer's card. No motion: a composer control, pressed
           * tens of times a day at most, like the mic beside it.
           */
          <Pressable
            testID="chat-v2-birth-details"
            accessibilityRole="button"
            accessibilityLabel="Send birth details"
            disabled={disabled || readOnly}
            hitSlop={TOKENS.space.xs}
            style={styles.trailingControl}
            onPress={onBirthDetails}
          >
            <Icon
              name="astrologer"
              size={TOKENS.icon.md}
              color={
                disabled ? theme.color.text.muted : theme.color.text.secondary
              }
            />
          </Pressable>
        ) : null}
        <TextField
          multiline
          nativeID="chat-v2-input"
          testID="chat-v2-input"
          accessibilityLabel="Message"
          editable={!disabled}
          // The same ceiling `messages.body`'s CHECK enforces (migration 003),
          // so the field stops where the database would rather than failing
          // the send after a tap.
          maxLength={MAX_MESSAGE_CHARS}
          placeholder={placeholder}
          placeholderTextColor={theme.color.text.muted}
          value={text}
          style={styles.input}
          onChangeText={onChangeText}
        />
        {control === 'send' ? (
          <Pressable
            testID="chat-v2-send"
            accessibilityRole="button"
            accessibilityLabel="Send message"
            disabled={readOnly}
            hitSlop={TOKENS.space.xs}
            style={[styles.trailingControl, styles.sendControl]}
            onPress={send}
          >
            <Icon
              name="send"
              size={TOKENS.icon.md}
              color={theme.color.text.onAccent}
            />
          </Pressable>
        ) : (
          <Pressable
            testID="chat-v2-mic"
            accessibilityRole="button"
            accessibilityLabel="Record a voice note"
            disabled={disabled || readOnly}
            hitSlop={TOKENS.space.xs}
            style={[styles.trailingControl, styles.micControl]}
            onPress={() => {
              void record();
            }}
          >
            <Icon
              name="mic"
              size={TOKENS.icon.md}
              color={
                disabled ? theme.color.text.muted : theme.color.text.secondary
              }
            />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    root: {
      width: '100%',
      paddingHorizontal: TOKENS.space.sm,
      paddingTop: TOKENS.space.xs,
      backgroundColor: t.color.bg.base,
    },
    field: {
      minHeight: TOKENS.interaction.minTarget,
      flexDirection: 'row',
      alignItems: 'center',
      borderWidth: 1,
      borderColor: t.color.border.strong,
      borderRadius: TOKENS.radius.pill,
      backgroundColor: t.color.bg.raised,
      paddingLeft: TOKENS.space.md,
      paddingRight: TOKENS.space['2xs'],
      paddingVertical: TOKENS.space['2xs'],
    },
    // The leading control takes the left inset, as the trailing one does the right.
    fieldWithLeading: {
      paddingLeft: TOKENS.space['2xs'],
      gap: TOKENS.space.xs,
    },
    input: {
      ...TOKENS.typography.bodyMedium,
      flex: 1,
      minHeight: 40,
      maxHeight: 120,
      paddingHorizontal: 0,
      // bodyMedium lineHeight 20dp + 8+8 padding = 36dp < 40dp minHeight,
      // so single-line input renders at exactly 40dp. With alignItems:'center'
      // the 40dp send button fills the 40dp content area symmetrically (4dp
      // capsule padding on each side).
      paddingVertical: TOKENS.space.xs,
      color: t.color.text.primary,
      textAlignVertical: 'center',
    },
    // The same capsule, so the swap changes what is inside the bar rather than
    // the bar itself — and the dock's measured height does not move.
    recordBar: {
      minHeight: TOKENS.interaction.minTarget,
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.xs,
      borderWidth: 1,
      borderColor: t.color.border.strong,
      borderRadius: TOKENS.radius.pill,
      backgroundColor: t.color.bg.raised,
      paddingLeft: TOKENS.space.xs,
      paddingRight: TOKENS.space['2xs'],
      paddingVertical: TOKENS.space['2xs'],
    },
    recordControl: {
      width: 40,
      height: 40,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: TOKENS.radius.pill,
    },
    recordClock: {
      ...TOKENS.typography.numeralSmall,
      color: t.color.text.secondary,
    },
    recordWave: {
      flex: 1,
    },
    trailingControl: {
      width: 40,
      height: 40,
      borderRadius: TOKENS.radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendControl: {
      backgroundColor: t.color.bg.accentStrong,
    },
    micControl: {
      backgroundColor: 'transparent',
    },
  });
