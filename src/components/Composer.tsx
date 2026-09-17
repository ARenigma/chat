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
import { DOCK_DELAY_MS, EASE_OUT, KEYBOARD_CUBIC, M3, dockTo, fadeSwapFast, fadeSwapOutFast, useCrossfade } from '../theme/motion';
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
import {
  MAX_ATTACHMENT_BYTES,
  MAX_PICK,
  PHOTO_MAX_DIMENSION,
  type ImageDraft,
} from '../lib/attachments';
import { useStore } from '../store/useStore';
import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { SendButton } from './SendButton';
import { AttachPanel } from './AttachPanel';
import { EmojiPicker } from './EmojiPicker';
import { readKeyboardHeight, writeKeyboardHeight } from '../lib/keyboardPanel';
import { readDraftText, writeDraftText } from '../lib/chatDraft';
import { usePanelCeiling } from '../lib/imeGeometry';
import { Waveform } from './Waveform';
import { TextField } from './TextField';

/** The camera button's slot width, animated to zero when the send takes over. */
const CAMERA_SLOT = 40;

/**
 * How far Telegram insets its input island from each screen edge, in dp.
 *
 * `createFrame(MATCH_PARENT, WRAP_CONTENT, Gravity.LEFT | Gravity.BOTTOM,
 * 7, 0, 7, 0)` — ChatActivity.java:8078 — with no further margin on the
 * container (ChatInputViewsContainer.java:42-43) and `setPadding(dp(7))` on its
 * blurred background at :81 agreeing. See the note on `row.paddingHorizontal`
 * for why this is a named constant rather than the nearest space token.
 */
export const TELEGRAM_ISLAND_INSET = 7;

/**
 * The emoji button's square. Telegram's is 44 and sits outside the field; ours is
 * inside the capsule, so it matches the capsule's own height instead — a 44 here
 * would make the capsule taller than the 40 measured on device.
 *
 * 40, NOT 36, and the two dp matter because the row is bottom-aligned. Measured
 * on the S22 (Amit, 2026-09-12: "message input box elements are not aligned"):
 *
 *     Emoji   [58,2132][160,2234]   102px tall, centre 2183
 *     Field   [181,2132][691,2234]  102px tall, centre 2183
 *     Camera  [781,2121][893,2234]  113px tall, centre 2177.5
 *     Mic     [916,2121][1028,2234] 113px tall, centre 2177.5
 *
 * The camera and the mic are `CAMERA_SLOT`/40; this was 36. Under the capsule's
 * `alignItems: 'flex-end'` every child sits on the same floor, so a shorter one
 * has a higher centre — 2dp higher, 5.6px at this density, which is what reads
 * as the row being out of line. 40 is also what the paragraph above is really
 * asking for: the capsule's usable height is `CAPSULE_MIN_H` (44) minus its
 * `space.hair` padding top and bottom, which is exactly 40.
 */
const EMOJI_BUTTON = 40;

/**
 * The emoji/keyboard glyph, 19 and not `icon.md` (20) — an OPTICAL correction,
 * measured, not a taste adjustment.
 *
 * Amit, 2026-09-13: "emoji icon should be same size as clip/mic". They already
 * WERE the same token and the same height: measured on an S22 at density 450,
 * all three ink exactly 22.0dp tall. What differs is width, because the glyphs
 * are different shapes — `smile` is a closed circle that traces its full box at
 * 22.0dp wide, `paperclip` is an open form at 20.6dp, and `mic` is a narrow
 * body at 16.4dp. A circle at the same nominal size as an open form reads
 * larger, which is the oldest problem in icon drawing and the reason Material's
 * keylines give circles and rectangles different dimensions inside one grid.
 *
 * 19 lands the circle at ~20.9dp of ink, within 0.3dp of the paperclip beside
 * it. The mic is deliberately NOT the target: a microphone is a narrow object
 * and matching a circle to it would leave the circle looking shrunken.
 *
 * Same class of exception as the chat header's handset, which is pinned at a
 * non-step size for the same reason — two controls in one row must present the
 * same INK, not the same number. Exempted by name in __tests__/iconScale.test.ts.
 */
const EMOJI_GLYPH_SIZE = 19;

/**
 * Input field height bounds (dp).
 *
 * MIN matches the previous `minHeight: 36` so the single-line capsule is unchanged.
 * MAX encodes 6 lines — `TEXT_HEIGHT_MAX = 6` in Telegram
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
 * The capsule's children are 40dp at their tallest (CAMERA_SLOT and the
 * trailing mic/send slot), so before this the bar laid out at 40, declared a
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
 * 6 lines is Telegram's cap (ChatActivityEnterView.java:5778); 20 is the
 * field's lineHeight and 8 its paddingTop + paddingBottom, which is exactly
 * how MAX_INPUT_H's 6x20 + 8 = 128 was derived above.
 */
export const INPUT_LINE_H = 20;
export const INPUT_PAD_V = 8;
export const MAX_INPUT_LINES = 6;

/**
 * The Bézier curve Telegram uses for its bar-growth animator.
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
  /**
   * A picked photo, ready to upload. Same shape of contract as onSendVoice,
   * except the return is awaited (2026-09-17 audit): picking several photos
   * at once must send them one at a time, in order, not fire every upload
   * simultaneously and let the server's arrival order become the send order.
   */
  onSendImage: (draft: ImageDraft) => void | Promise<void>;
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
  onSendImage,
  disabled,
  placeholder,
  sendHaloKey,
  onTyping,
  onRecording,
  onRecordingEnded,
  onFocusChange,
  onPanelChange,
  onPanelSearchChange,
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
   * TTL, and a voice note outlasts it. Telegram does the same thing for the
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
  /**
   * Whether the IME is up, as a ref.
   *
   * Read by the toggles to decide whether the slot's travel animates, so it has
   * to be current at the moment of the tap rather than at the last render — a
   * state read here is one render behind and produces exactly the double
   * movement the guard exists to prevent.
   */
  const keyboardUpRef = useRef(false);
  /** The input row's measured height, so the expanded panel can subtract it. */
  const [rowHeight, setRowHeight] = useState(0);
  const { width: winW, height: winH } = useWindowDimensions();
  const landscape = winW > winH;
  const insets = useSafeAreaInsets();
  const [panelHeight, setPanelHeight] = useState(() => readKeyboardHeight(landscape));
  /**
   * The tallest the panel may be while the keyboard is also up, in px: the space
   * between the bottom of the frosted header and the top of the keyboard.
   * Ignored outside search, where the panel is exactly the keyboard's size.
   *
   * READ, not received. It is `winH - barHeight - imeSpace`, and both of those
   * terms now live in the chat screen's IME store — a prop would be only as
   * fresh as its owner's last render, and the screen deliberately no longer
   * renders when they change (src/lib/imeGeometry.ts). It changes far less often
   * than that sounds: `keyboardHeight` is sticky, so an ordinary show/hide does
   * not move it at all — only a genuinely different IME height, a rotation, or
   * the top bar resizing.
   *
   * NOTE this is not the same number as `panelHeight` above, deliberately: the
   * panel uses `readKeyboardHeight`'s clamped, persisted, per-orientation value
   * while the ceiling is built from the raw measured height. They can disagree
   * for a keyboard outside the clamp band; that divergence predates this and is
   * recorded in imeGeometry.ts rather than silently unified here.
   */
  const panelCeiling = usePanelCeiling();
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
      keyboardUpRef.current = true;
      const h = e.endCoordinates.height;
      writeKeyboardHeight(h, landscape);
      setPanelHeight(readKeyboardHeight(landscape));
      if (!searchingRef.current) {
        /*
         * The keyboard is arriving, so it is the movement — the surface must go
         * without a travel of its own or the two cross each other. Telegram's
         * hide path has the same `!keyboardVisible` guard as its show path
         * (`ChatActivityEnterView.java:12730`).
         */
        animateNext.current = false;
        setEmojiOpen(false);
        setAttachOpen(false);
      }
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      keyboardUpRef.current = false;
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
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
      // Back with no keyboard coming: the surface's own travel is all there is.
      animateNext.current = true;
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

  /**
   * The docked slot's travel.
   *
   * `slotY` is how far the surface is pushed DOWN out of its place: its own
   * height while closed, zero while open. Driving translation rather than
   * height means the panel's content is laid out once and then moved, which is
   * what Telegram does (`currentView.setTranslationY(...)` then animate to 0)
   * and is why the swap costs no measure pass.
   *
   * `animateNext` is the `!keyboardVisible` guard: set false when the keyboard
   * is on screen at the moment of the swap, because the keyboard going down is
   * already the movement.
   */
  const surfaceOpen = emojiOpen || attachOpen;
  const slotHeight = panelHeight + insets.bottom;
  const dockY = useSharedValue(0);
  /**
   * Animated height of the text-input wrapper.
   *
   * `onContentSizeChange` measures the content, clamps it to [MIN_INPUT_H,
   * MAX_INPUT_H], and drives this value over 250ms on the keyboard's Bézier
   * (Telegram DEFAULT_INTERPOLATOR, ChatListItemAnimator.java:47) so the capsule
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
  const animateNext = useRef(true);
  const dockStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dockY.value }],
  }));
  /**
   * Which surface is DRAWN, as opposed to which one is open.
   *
   * They differ for exactly one interval: the close. A surface hidden the
   * instant its state flips has nothing left on screen to travel, so the slide
   * out would never be seen. Telegram sets `GONE` in the animator's
   * `onAnimationEnd` for the same reason (`ChatActivityEnterView.java:12736`);
   * this is that callback, as a timer over the same total the travel takes.
   */
  const [shown, setShown] = useState<'emoji' | 'attach' | null>(null);
  useEffect(() => {
    if (emojiOpen) {
      setShown('emoji');
      return;
    }
    if (attachOpen) {
      setShown('attach');
      return;
    }
    const settle = setTimeout(
      () => setShown(null),
      DOCK_DELAY_MS + TOKENS.motion.m3.duration.medium1,
    );
    return () => clearTimeout(settle);
  }, [emojiOpen, attachOpen]);

  /**
   * Settle gate for the camera tile (W3#2).
   *
   * CameraX cannot configure a capture session on a TextureView that is still
   * mid-travel — the surface is zero-sized or partially clipped, and the native
   * layer logs "Unable to configure camera … not done within 5000ms" while the
   * tile renders black. Verified on the API-36 emulator 2026-09-04. `slotSettled`
   * starts false whenever the attach surface is not shown. When it becomes shown
   * we wait for the dock's animation window before flipping true, so CameraX only
   * binds to a surface that is already in its final position.
   *
   * Three cases, each with a different wait:
   *   – panel-to-panel swap (emoji → attach): dock height unchanged, no travel;
   *     settle immediately.
   *   – opened with keyboard up (`animateNext` false): keyboard exit is the
   *     motion; dock doesn't travel; settle immediately.
   *   – opened from closed with animation: wait DOCK_DELAY_MS + medium1 (300ms).
   *
   * The timeout expression mirrors the `setShown(null)` teardown timer above so
   * both always agree on when the animation has finished.
   *
   * `prevShownRef` tracks the value of `shown` from the PREVIOUS effect run, which
   * is `shown` one state-change earlier — the standard pattern for "previous value"
   * without lifting state. It is updated at the end of each effect body, so the
   * next run reads the prior value before overwriting it.
   */
  const prevShownRef = useRef<'emoji' | 'attach' | null>(null);
  const [slotSettled, setSlotSettled] = useState(false);
  useEffect(() => {
    const prev = prevShownRef.current;
    prevShownRef.current = shown;
    if (shown !== 'attach') {
      setSlotSettled(false);
      return;
    }
    // Emoji → attach swap: dock height does not change, no slide occurs.
    if (prev !== null) {
      setSlotSettled(true);
      return;
    }
    // Keyboard was up: its own exit is the motion; dock stays put.
    if (!animateNext.current) {
      setSlotSettled(true);
      return;
    }
    // Dock sliding in from closed: wait for DOCK_DELAY_MS (50) + medium1 (250).
    const t = setTimeout(
      () => setSlotSettled(true),
      DOCK_DELAY_MS + TOKENS.motion.m3.duration.medium1,
    );
    return () => clearTimeout(t);
  }, [shown]);

  /**
   * The travel, keyed on WHETHER a surface is drawn — not on which one.
   *
   * `shown` flipping 'emoji' to 'attach' must not animate: the dock's height
   * does not change, so there is nothing to travel. Telegram has the same guard
   * from the other direction — `currentHeight - previousHeight` is zero when a
   * panel was already visible, so its animator moves nothing
   * (`ChatActivityEnterView.java:12700`).
   *
   * The offset is PRIMED in the toggle, not here. Setting it in an effect put it
   * one commit behind the layout, and the panel rendered at full height with no
   * offset for a single frame before the travel began — visible as a flash when
   * stepped frame by frame at 60fps.
   */
  const drawn = shown !== null;
  useEffect(() => {
    if (drawn) {
      dockY.value = dockTo(0, animateNext.current);
      return;
    }
    // The dock has just lost the panel's height, so it is already where the
    // travel was heading. Release the offset in the same commit.
    dockY.value = 0;
  }, [drawn, dockY]);

  /** Push the pair down as the surface leaves, while it is still drawn. */
  useEffect(() => {
    if (!surfaceOpen && drawn) {
      dockY.value = dockTo(slotHeight, animateNext.current);
    }
  }, [surfaceOpen, drawn, slotHeight, dockY]);

  /**
   * Offset the dock by a panel's height BEFORE the panel is laid out.
   *
   * The dock is bottom-anchored, so showing the panel makes it taller and the
   * row jumps up by that much in the same commit. Pre-offsetting cancels the
   * jump, and the effect above then animates the offset away — so what is seen
   * is the pair rising smoothly out of the bottom edge. This has to happen on
   * the tap, synchronously with the state change; from an effect it lands a
   * commit late and the un-offset frame shows.
   *
   * No-op when a surface is already drawn: swapping emoji for attach changes no
   * height and must not move anything.
   */
  const primeDock = useCallback(() => {
    if (shown === null) {
      dockY.value = slotHeight;
    }
  }, [shown, slotHeight, dockY]);

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
      // M3 short2 = 100ms. Telegram fades its attach icons in 100ms
      // (`ChatActivityEnterView.java:7947`). `duration.fast` (170ms) was
      // the mic↔send reveal timing — a different action on a different path.
      // Using the token via the M3 export from motion.ts, not a raw literal.
      duration: M3.duration.short2,
      // EASE_OUT: a collapse is an exit, and an exit must not have an ease-in
      // phase. Without an explicit easing, Reanimated defaults to
      // Easing.inOut(Easing.quad), which starts with an ease-in — the one
      // curve that is always wrong for something disappearing.
      easing: EASE_OUT,
    });
  }, [ready, cameraOpen]);
  // RULE 1 §6 STATED DEPARTURE — this style animates `width` and `marginLeft`,
  // which are layout properties that trigger Yoga on every frame. The rule
  // says animate transform/opacity only. The departure is load-bearing: an
  // absolutely-positioned slot would leave a hole in the capsule instead of
  // reclaiming the space as the camera collapses, and the whole point of the
  // animation is that the text-input capsule grows into the freed space. Width
  // is what does that; there is no transform equivalent. Bounded at
  // M3.duration.short2 = 100ms. Unproven on a low-end device — a frame trace
  // on the Redmi is the open question before calling this solved.
  const cameraStyle = useAnimatedStyle(() => ({
    opacity: cameraOpen.value,
    width: CAMERA_SLOT * cameraOpen.value,
    // The gap collapses with it, or the capsule stops short of the send button.
    marginLeft: TOKENS.space.xs * cameraOpen.value,
    // Pinches to half-width as it collapses (scaleX 0.5 at value=0, 1 at value=1)
    // so the icon reads as withdrawing rather than cutting out. Width still drives
    // the actual space reclaim; scaleX is the visual read.
    transform: [{ scaleX: 0.5 + 0.5 * cameraOpen.value }],
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
    // Opened from the keyboard: no travel, the keyboard's own exit is it.
    animateNext.current = !keyboardUpRef.current;
    primeDock();
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
  }, [attachOpen, leaveSearch, primeDock]);

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
    animateNext.current = !keyboardUpRef.current;
    primeDock();
    setAttachOpen(false);
    setPanelMounted(true);
    setEmojiOpen(true);
    Keyboard.dismiss();
  }, [emojiOpen, leaveSearch, primeDock]);

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

  /**
   * Validate all picked / captured assets and hand each photo up in turn.
   *
   * Shared by the gallery picker (which may return up to MAX_PICK photos via
   * Android's `PickMultipleVisualMedia`) and the camera (which returns exactly
   * one). Looping here so every asset goes through the same size and
   * readability checks — the division of labour the mic button has with
   * `onSendVoice`.
   *
   * The panel closes once after the first successful send. Telegram dismisses
   * its whole attach sheet on a successful send (`ChatAttachAlert.dismiss()`),
   * and leaving ours open puts a live viewfinder under the message that was
   * just sent — which reads as "it did not go". Only on the success path: a
   * refused pick (too large, unreadable) leaves the panel up so the next
   * attempt is one tap, not four.
   *
   * https://github.com/react-native-image-picker/react-native-image-picker
   */
  /*
   * Sends are AWAITED, one at a time, not fired together (2026-09-17 audit).
   * `selectionLimit: MAX_PICK` lets a member pick several photos in one pass,
   * and until this fix every asset in `result.assets` was handed to
   * `onSendImage` in the same synchronous loop with no `await` — ten photos
   * meant ten uploads competing for one link and ten `send_message_idempotent`
   * calls racing the server, so the thread ended up in whatever order the
   * network happened to finish them, not the order the member picked them in.
   * A `for...of` with `await` costs nothing on the common one-photo case and
   * makes the ten-photo case deterministic.
   */
  const handleAssets = useCallback(
    async (result: ImagePickerResponse | null) => {
      if (result === null || result.didCancel) {
        return;
      }
      let sentAny = false;
      for (const asset of result.assets ?? []) {
        if (
          asset.uri === undefined ||
          asset.width === undefined ||
          asset.height === undefined
        ) {
          setNotice('That photo could not be read.');
          errorTick();
          continue;
        }
        if (asset.fileSize !== undefined && asset.fileSize > MAX_ATTACHMENT_BYTES) {
          setNotice('That photo is too large. Pick one under 10 MB.');
          errorTick();
          continue;
        }
        sentAny = true;
        await onSendImage({
          uri: asset.uri,
          width: asset.width,
          height: asset.height,
          mime: asset.type ?? null,
        });
      }
      if (sentAny) {
        setAttachOpen(false);
      }
    },
    [onSendImage, setNotice],
  );

  /**
   * Pick from the library. The Android 13+ system photo picker needs no
   * permission at all, so there is nothing to request here.
   *
   * `selectionLimit: MAX_PICK` routes through `PickMultipleVisualMedia` on
   * Android (react-native-image-picker v7.x, ImagePickerModuleImpl.java:154),
   * which is the same system Photo Picker as the single-select path — no extra
   * permission, no Play policy risk. Multi-select was confirmed supported in
   * v7.2.3 (installed); no version bump needed (RULE 5).
   *
   * https://developer.android.com/training/data-storage/shared/photopicker
   */
  const pickImage = useCallback(async () => {
    if (disabled) {
      return;
    }
    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: MAX_PICK,
      quality: 0.9,
      maxWidth: PHOTO_MAX_DIMENSION,
      maxHeight: PHOTO_MAX_DIMENSION,
    }).catch(() => null);
    void handleAssets(result);
  }, [disabled, handleAssets]);

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
    const result = await launchCamera({
      mediaType: 'photo',
      quality: 0.9,
      saveToPhotos: false,
      maxWidth: PHOTO_MAX_DIMENSION,
      maxHeight: PHOTO_MAX_DIMENSION,
    }).catch(() => null);
    void handleAssets(result);
  }, [disabled, handleAssets, setNotice]);

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
    {/*
      * The whole dock travels, not just the panel.
      *
      * Telegram offsets the panel by its own height and animates it back to zero
      * (`currentView.setTranslationY(currentHeight - previousHeight)` then
      * `ObjectAnimator ... TRANSLATION_Y ... 0`,
      * `ChatActivityEnterView.java:12700-12706`). Applying that to the panel
      * ALONE does not work in this layout: the dock is anchored to the bottom,
      * so the row's position comes from the dock's height, and the height
      * changes the moment the panel is shown or hidden. The panel would slide
      * while the row jumped.
      *
      * Same trick, one level up: the row and the panel are offset together by
      * however much of the panel is still hidden. Showing the panel makes the
      * dock taller (the row jumps up by a panel) and the offset cancels it
      * exactly, then animates away — so the pair rises smoothly out of the
      * bottom edge. Hiding is the reverse, and the offset is released on the
      * same frame the panel stops being laid out, so the two cancel and there is
      * no snap. Zero layout work during the travel: it is one transform on one
      * node.
      */}
    <Animated.View style={dockStyle}>
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
          {/* `icon.md` (20), the same as the camera and the mic across the
              capsule. This was `icon.lg` (24) with nothing recording why, and a
              4dp difference between the leading glyph and the two trailing ones
              is visible at this size — the second half of "the elements are not
              aligned" (Amit, 2026-09-12); the first half was the 36dp button in
              a row of 40s. Three controls in one capsule, one glyph size. */}
          {/*
            * The glyph CROSS-FADES rather than cutting (2026-09-12).
            *
            * It was `name={emojiOpen ? 'keyboard' : 'smile'}` on a bare Icon —
            * a hard swap, which is the one thing a toggle should not do,
            * because the whole job of a toggle's feedback is to say "your tap
            * landed and this is now the other state". An instant substitution
            * is indistinguishable from a re-render.
            *
            * `key` is what makes it work: changing the key remounts the view,
            * which is what gives Reanimated an entering animation to run.
            * Without it the same node just takes a new prop and nothing
            * animates.
            *
            * `fadeSwapFast` (DURATION.fast, 170ms, EASE_OUT) rather than
            * `fadeSwap`, by the frequency rule in DESIGN.md: this button is
            * pressed many times per conversation, and the budget for something
            * at that frequency is ~200ms. It is also the builder the app
            * already uses for exactly this — a control that has just changed
            * what it says about itself.
            */}
          <Animated.View key={emojiOpen ? 'keyboard' : 'smile'} entering={fadeSwapFast} exiting={fadeSwapOutFast}>
            <Icon
              name={emojiOpen ? 'keyboard' : 'smile'}
              size={EMOJI_GLYPH_SIZE}
              color={theme.color.text.secondary}
            />
          </Animated.View>
        </Pressable>
        {/*
          * The wrapper's height is the animated value; the field inside fills
          * it via `flex: 1`. `onContentSizeChange` reports the natural content
          * height (all lines, regardless of the container) so it drives the
          * animation even while the field is constrained to a smaller size.
          * Telegram: bar growth 250ms on DEFAULT_INTERPOLATOR
          * (ChatListItemAnimator.java:46-47; ChatActivity.java:7896-7940).
          */}
        <Animated.View style={[styles.inputWrapper, inputHStyle]}>
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
               * Telegram sizes from the LINE COUNT, not the pixel height
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
          accessibilityHint="Camera or photos"
          press="none"
          highlight="material"
          size={40}
          style={styles.camera}>
          {/*
            * A PAPERCLIP, not a camera (Amit, 2026-09-13: "replace camera with
            * clip icon in text input box").
            *
            * The control opens the attach panel, which is a camera AND a photo
            * library — so a camera glyph named only half of what is behind it,
            * and named the half that is not the common case. A clip is the
            * conventional mark for "attach something", which is what this is.
            *
            * The accessibility label already said "Add media" with the hint
            * "Camera or photos", so the spoken name was right while the drawn
            * one was narrower. They agree now.
            */}
          <Icon name="clip" size={TOKENS.icon.md} color={theme.color.text.secondary} />
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
            accessibilityHint="Recording starts on tap and stops when you tap stop"
            press="none"
            highlight="material"
            size={40}
            style={styles.mic}>
            <Icon name="mic" size={TOKENS.icon.md} color={theme.color.text.secondary} />
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
      {/*
        * One animated slot for both docked surfaces.
        *
        * Telegram translates the panel by its own height and animates it to 0
        * over `keyboardDuration` (250ms) on the keyboard's cubic, starting the
        * animator 50ms late — and ONLY when the keyboard is not already visible
        * (`showPopup`, `ChatActivityEnterView.java:12687,:12710`). A swap made
        * with the keyboard up is deliberately not animated there, because the
        * keyboard sliding away IS the animation; animating on top of it reads as
        * a stutter. `dockTo` carries all three of those facts.
        */}
      <View pointerEvents={surfaceOpen ? 'auto' : 'none'}>
      {panelMounted ? (
      <EmojiPicker
        visible={shown === 'emoji'}
        /*
         * ONE height, searching or not: the keyboard's.
         *
         * Search used to expand the panel to fill from under the header down to
         * the composer - Telegram's `setStickersExpanded` - with a scrim over the
         * conversation behind it. That is what Amit rejected (2026-09-05: "emoji
         * search taking full screen but should be like whatsapp docked right").
         *
         * WhatsApp keeps the panel exactly keyboard-sized and lets the results
         * scroll inside it, so the conversation never leaves the screen and the
         * viewport does not move when the query changes. It is also strictly less
         * machinery: no expansion, no scrim, no second height to keep in step
         * with the dock. Matching the reference is this project's default, not an
         * obligation - and here the product asked for the other app.
         */
        /*
         * DOCKED, never expanded. Capped by the space above the keyboard.
         *
         * Search used to EXPAND the panel to fill from under the header down to
         * the composer - Telegram's `setStickersExpanded` - with a scrim over the
         * conversation behind it. Amit rejected that (2026-09-05: "emoji search
         * taking full screen but should be like whatsapp docked right").
         *
         * WhatsApp keeps the results in a docked tray. But while search has focus
         * the keyboard is up TOO, so the panel cannot simply stay a keyboard tall
         * - that would stack two keyboards plus the header and overflow the
         * screen. It takes whichever is SMALLER: its normal keyboard height, or
         * everything the header and the raised keyboard leave over. So it never
         * grows beyond a keyboard and never overflows.
         *
         * `Math.min`, where this was `Math.max`. That one word was the whole
         * difference between a docked tray and a full-screen takeover.
         */
        height={
          emojiSearching
            ? Math.max(0, Math.min(panelHeight, panelCeiling - rowHeight))
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
          visible={shown === 'attach'}
          height={panelHeight + insets.bottom}
          cameraGranted={cameraGranted}
          slotSettled={slotSettled}
          onCamera={() => {
            void takePhoto();
          }}
          onGallery={() => {
            void pickImage();
          }}
        />
      ) : null}
      </View>
    </Animated.View>


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
    /*
     * TELEGRAM'S OWN 7dp, read from source rather than approximated.
     *
     * `chatInputBubbleContainer.addView(chatActivityEnterView,
     * LayoutHelper.createFrame(MATCH_PARENT, WRAP_CONTENT,
     * Gravity.LEFT | Gravity.BOTTOM, 7, 0, 7, 0))` — ChatActivity.java:8078 —
     * and the container it goes into adds no horizontal margin of its own
     * (`createFrame(MATCH_PARENT, WRAP_CONTENT, Gravity.BOTTOM)`,
     * ChatInputViewsContainer.java:42-43). `blurredBackgroundDrawable
     * .setPadding(dp(7))` at :81 corroborates it. Clone at
     * ~/references/telegram; measured facts only (ADR-0025).
     *
     * WAS `space.md` (16), chosen so the capsule's outer edges lined up with the
     * message bubbles' edges — both reading `list.paddingHorizontal`. That was a
     * real property and it is knowingly given up here: Amit asked for the input
     * box's width to match Telegram exactly (2026-09-12), and Telegram's input
     * island is deliberately WIDER than its bubbles. Two references in one
     * control is the thing to avoid, so the corner (radius.composer, now 22)
     * and the inset (7) both come from Telegram now.
     *
     * 7 is not on the space scale and must not be rounded onto it — 8 would be
     * "close enough" in exactly the way this file has been burned by before. It
     * is a measured source value, which this repo keeps as a named constant
     * (the `SOURCE_METRICS` / `RIPPLE` precedent).
     */
    paddingHorizontal: TELEGRAM_ISLAND_INSET,
    paddingTop: TOKENS.space['2xs'],
    paddingBottom: TOKENS.space.xs,
    backgroundColor: 'transparent',
  },
  /*
   * THE CAPSULE. One floating pill that contains everything.
   *
   * The surface used to live on `field`, one level in, with the camera and the
   * mic/send sitting OUTSIDE it on bare background. The dock behind them carries
   * no fill (`tint="none"`, and `blur` off entirely while composing), so those
   * two icons had nothing behind them at all and the transcript ran straight
   * through: message bubbles collided with the camera and mic glyphs, and with
   * the reply strip above them. Seen on the S22 2026-09-05, and it is the same
   * defect in both places.
   *
   * Telegram puts the emoji, the field, the attach clip and the mic INSIDE a
   * single translucent pill - captured from the reference on this device: there
   * is no icon outside it, which is exactly why nothing can ever collide. The
   * pill occludes. Moving our surface up one level reproduces that, and it also
   * honours "no bar bg" (Amit, 2026-09-04) rather than contradicting it: there
   * is still no full-width bar, only a floating capsule.
   */
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: TOKENS.space.xs,
    // Trailing inset is smaller than the field's own, because the mic disc now
    // sits inside the capsule and brings its own optical padding.
    paddingLeft: TOKENS.space.hair,
    paddingRight: TOKENS.space.hair,
    /*
     * 44dp, not the 40 the children add up to, and this is a correctness fix
     * rather than a taste one: at 40 the declared corner below was scaled to
     * 22 x 40/44 = 20 by RN Android's corner-overlap clamp while the message
     * bubbles painted a true 22, so the capsule and the bubble scrolling under
     * it traced different silhouettes. See CAPSULE_MIN_H for the rule and its
     * source. `space.hair` (2) top and bottom is the mechanism — it takes the
     * 40dp of children to the floor and keeps them optically centred under
     * `alignItems: 'flex-end'` — and `minHeight` is the floor itself, stated so
     * the requirement survives a change to the children.
     */
    minHeight: CAPSULE_MIN_H,
    paddingVertical: TOKENS.space.hair,
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
    /*
     * The trailing inset is `space.xs`, matching `gap` above, so every gap in
     * the row is the same 8dp (Amit, 2026-09-13: "the input box padding around
     * buttons is unequal").
     *
     * It was `space.md`. Measured on an S22: emoji-to-text 8dp, clip-to-mic
     * 8dp, and text-to-clip THIRTY-TWO — the 16 here plus the camera slot's own
     * 8dp margin plus the capsule edge. The comment justified it as "the text's
     * breathing room", which is a real need, but 16 was twice what any other
     * gap in the capsule got and it read as the field stopping early.
     *
     * The LEADING inset stays `space.hair`: the emoji button is the capsule's
     * first child and carries its own 40dp press disc, so the visible gap there
     * is the disc's own edge, not this number. The two are asymmetric in the
     * style precisely so the rendered gaps come out equal.
     *
     * ZERO in the end, not 8, and that is the point: the clip slot already
     * carries `marginLeft: space.xs` in `cameraStyle` (it animates, which is
     * why the gap has to live there and not here). Any padding on this side
     * STACKS on top of it. 16 gave 32dp, 8 gave 24dp, and 0 gives the single
     * 8dp gap every other control in the capsule gets. Measured on device each
     * time rather than reasoned about, because the two owners of this gap are
     * in different files.
     */
    paddingLeft: TOKENS.space.hair,
    paddingRight: 0,
    // Zero. The 40dp of children is the capsule's CONTENT height; the capsule
    // itself is CAPSULE_MIN_H (44) because a 40dp box cannot paint a 22dp
    // corner. That 4dp lives on `inputBar`'s own paddingVertical, where it is
    // symmetric — any field padding here would stack on top of the 40 and push
    // the capsule taller still.
    paddingVertical: 0,
    /*
     * No surface of its own any more - the capsule moved up to `inputBar` so the
     * camera and mic are inside it. A second rounded fill here would draw a pill
     * inside a pill.
     */
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
     * Telegram source: 16sp text, includeFontPadding false, bottom gravity, max
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
