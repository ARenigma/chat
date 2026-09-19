import React, { memo, useCallback, useMemo, useRef } from 'react';
import {
  Image,
  StyleSheet,
  Text,
  View,
  type AccessibilityActionEvent,
  type StyleProp,
  type TextStyle,
  type View as RNView,
} from 'react-native';
import {
  GestureDetector,
  useExclusiveGestures,
  useLongPressGesture,
  usePanGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useAttachmentUrl } from '../api/attachments';
import { Icon } from '../components/Icon';
import { Pressable } from '../components/Pressable';
import { ProgressBar } from '../components/ProgressBar';
import { VoiceNote } from '../components/VoiceNote';
import type { ReactionEmoji } from '../lib/database.types';
import { longPress as longPressHaptic, tick } from '../lib/haptics';
import type { ReactionTally } from '../lib/reactions';
import type { VoicePlayer } from '../lib/voice';
import { useStore } from '../store/useStore';
import { springTo } from '../theme/motion';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import {
  CHAT_V2_BUBBLE_PADDING,
  CHAT_V2_META_FONT_SIZE,
  CHAT_V2_META_GAP,
  CHAT_V2_META_LINE_HEIGHT,
  chatV2CellA11yActions,
  chatV2MediaState,
  chatV2MetaSlot,
  chatV2MetaText,
  sameMessageCell,
  type ChatV2A11yAction,
  type ChatV2MessageCellFacts,
} from './cells';
import type { ChatV2ImageBody, ChatV2VoiceBody } from './rows';

/** Window-space rect of the pressed bubble, for the anchored action surface. */
export interface ChatV2Anchor {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The tail wedge, 8x13dp, from WhatsApp's own `tail-out.svg` viewBox.
 *
 * Drawn with the border trick (a zero-size View with one coloured and one
 * transparent border) because `react-native-svg` is banned by RULE 5 — it
 * throws `synchronouslyUpdateUIProps` inside Reanimated views and kills touch
 * on the whole subtree, which is the subtree a chat bubble lives in.
 */
const TAIL_W = 8;
const TAIL_H = 13;

/** The 3dp frame between a media bubble's edge and the photo inside it. */
const MEDIA_INSET = 3;
const MEDIA_WIDTH = 240;
const MEDIA_MIN_HEIGHT = 120;
const MEDIA_MAX_HEIGHT = 320;

/** Drag that commits a swipe-reply, and the ceiling a tap may travel. */
const REPLY_ACTIVATE = 16;
const REPLY_TRIGGER = 50;
const REPLY_MAX_DRAG = 72;

export interface ChatV2MessageCellProps extends ChatV2MessageCellFacts {
  /** Resolved once per data change, so the identity is stable for the memo. */
  voice?: ChatV2VoiceBody;
  image?: ChatV2ImageBody;
  /** One playhead for the whole transcript; there is one native player. */
  voicePlayer: VoicePlayer;
  /**
   * Whether a long press has anything to open. The POLICY — which surface,
   * which items — is the screen's, because only it knows `selfId` and the edit
   * window; this only says whether to arm the recogniser at all.
   */
  actionable: boolean;
  mutationsDisabled?: boolean;
  onLongPress: (messageId: string, mine: boolean, anchor: ChatV2Anchor) => void;
  onSwipeReply: (messageId: string) => void;
  onRetry: (messageId: string) => void;
  onOpenImage: (image: ChatV2ImageBody) => void;
}

/**
 * The bottom-right metadata: clock, "Edited", and the delivery mark.
 *
 * `allowFontScaling={false}` is load-bearing rather than a style choice. The
 * slot this row sits in is COMPUTED (see `chatV2MetaSlot`), and a meta row that
 * grew with the system font would outgrow its own reserve and sit on a glyph.
 * The message body scales normally; only this fixed-width disclosure does not.
 * https://reactnative.dev/docs/text#allowfontscaling
 */
function MetaRow({
  stamp,
  edited,
  receipt,
  failed,
  mine,
}: {
  stamp: string;
  edited: boolean;
  receipt: 'sent' | 'read' | undefined;
  failed: boolean;
  mine: boolean;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  return (
    <View style={styles.metaRow}>
      <Text
        testID={edited ? 'chat-v2-edited' : undefined}
        allowFontScaling={false}
        numberOfLines={1}
        style={[
          styles.metaText,
          mine ? styles.metaTextMine : styles.metaTextPeer,
        ]}
      >
        {chatV2MetaText({ stamp, edited })}
      </Text>
      {/* A failed send shows a mark INSTEAD of a tick, never both: a check
          beside "not sent" is the most misleading thing a bubble could say. */}
      {failed ? (
        <Icon
          name="close"
          size={TOKENS.icon.xs}
          color={theme.color.state.danger}
        />
      ) : receipt !== undefined ? (
        <Icon
          name={receipt === 'read' ? 'checkCheck' : 'check'}
          size={TOKENS.icon.xs}
          color={
            receipt === 'read'
              ? theme.color.bubble.tickRead
              : theme.color.bubble.meta
          }
        />
      ) : null}
    </View>
  );
}

/** The quoted parent of a reply, inside the bubble and never a bubble itself. */
function QuoteBlock({ author, body }: { author: string; body: string }) {
  const styles = useStyles(makeStyles);
  return (
    <View testID="chat-v2-quote" style={styles.quote}>
      <Text allowFontScaling numberOfLines={1} style={styles.quoteAuthor}>
        {author}
      </Text>
      <Text allowFontScaling numberOfLines={2} style={styles.quoteBody}>
        {body}
      </Text>
    </View>
  );
}

/**
 * The text body with WhatsApp's inline clock, reserved rather than measured.
 *
 * The slot is a zero-content spacer at the END of the message text, so the
 * text's own intrinsic width becomes `max(widest line, last line + slot)` and
 * the bubble hugs exactly the width WhatsApp would give it. The real meta is
 * overlaid absolutely on the bottom-right of that reserve, so it never takes
 * part in line breaking. If the last line plus the spacer do not fit, the
 * spacer wraps and carries the clock's slot to a line of its own — the
 * "multi-line message" case, out of the text's own line breaking rather than
 * out of a branch.
 *
 * V1 measured the meta with `onLayout` and started the reserve at ZERO, so the
 * first frame of a `Hi` reserved nothing, wrapped the clock onto a second line,
 * and snapped back a frame later. `chatV2MetaSlot` is the fix: the width is
 * known before anything is laid out, so the first frame is the final frame.
 */
function TextBody({
  text,
  textStyle,
  testID,
  stamp,
  edited,
  receipt,
  failed,
  mine,
}: {
  text: string;
  textStyle: StyleProp<TextStyle>;
  testID: string;
  stamp: string;
  edited: boolean;
  receipt: 'sent' | 'read' | undefined;
  failed: boolean;
  mine: boolean;
}) {
  const styles = useStyles(makeStyles);
  const slot = chatV2MetaSlot({ stamp, edited, receipt, failed });
  return (
    <View style={styles.textBubble}>
      <Text
        testID={testID}
        allowFontScaling
        style={[textStyle, styles.messageText]}
      >
        {text}
        <View style={[styles.metaSpacer, { width: slot + CHAT_V2_META_GAP }]} />
      </Text>
      <View style={styles.metaOverlay}>
        <MetaRow
          stamp={stamp}
          edited={edited}
          receipt={receipt}
          failed={failed}
          mine={mine}
        />
      </View>
    </View>
  );
}

/**
 * A photo inside a 3dp frame whose corner is concentric with the image's.
 *
 * The source is the local pick while the row is optimistic, then a signed URL
 * minted from the bucket path. `useAttachmentUrl` is a no-op until there is a
 * real path, so a pending bubble pays for no credential.
 */
function MediaBody({
  image,
  mine,
  pending,
  failed,
  retryEnabled,
  stamp,
  receipt,
  onRetry,
  a11yActions,
  onA11yAction,
}: {
  image: ChatV2ImageBody;
  mine: boolean;
  pending: boolean;
  failed: boolean;
  retryEnabled: boolean;
  stamp: string;
  receipt: 'sent' | 'read' | undefined;
  onRetry: () => void;
  a11yActions: readonly ChatV2A11yAction[];
  onA11yAction: (event: AccessibilityActionEvent) => void;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const { data: signedUrl } = useAttachmentUrl(
    image.localUri ? null : image.path,
  );
  const uri = image.localUri ?? signedUrl;
  const ratio =
    image.width <= 0 || image.height <= 0 ? 1 : image.width / image.height;
  const height = Math.max(
    MEDIA_MIN_HEIGHT,
    Math.min(MEDIA_MAX_HEIGHT, Math.round(MEDIA_WIDTH / ratio)),
  );
  const uploadFraction = useStore(s => s.uploadProgress[image.messageId]);
  const mediaState = chatV2MediaState({
    pending,
    failed,
    hasSource: uri !== undefined,
  });

  return (
    <View
      style={[
        styles.mediaFrame,
        mine ? styles.mediaFrameMine : styles.mediaFramePeer,
      ]}
    >
      <View style={[styles.mediaInner, { height }]}>
        {uri !== undefined ? (
          <Image
            testID="chat-v2-image"
            source={{ uri }}
            style={styles.mediaImage}
            resizeMode="cover"
            /* The photo is the accessibility node for this bubble: the tap that
               opens the viewer — or retries the send — is an RNGH recogniser,
               which a screen reader cannot see, and `accessibilityActions`
               both installs the delegate and gives TalkBack somewhere to send
               the action. https://reactnative.dev/docs/accessibility */
            accessible
            accessibilityRole="imagebutton"
            accessibilityActions={[...a11yActions]}
            onAccessibilityAction={onA11yAction}
            accessibilityLabel={
              mediaState === 'failed'
                ? retryEnabled
                  ? 'Photo not sent. Activate to retry.'
                  : 'Photo not sent.'
                : mediaState === 'uploading'
                ? 'Sending photo'
                : 'Photo'
            }
          />
        ) : null}
        {/*
         * A failed send says so and offers the way back, rather than turning a
         * progress bar forever. The whole bubble is already the retry target;
         * this is what makes that legible, and the danger mark is what stops
         * the row reading as "still working".
         */}
        {mediaState === 'failed' ? (
          <View testID="chat-v2-image-failed" style={styles.mediaFailed}>
            <Icon
              name="close"
              size={TOKENS.icon.md}
              color={theme.color.text.onAccent}
            />
            <Text allowFontScaling style={styles.mediaFailedLabel}>
              Not sent
            </Text>
            {retryEnabled ? (
              <Pressable
                testID="chat-v2-image-retry"
                accessibilityRole="button"
                accessibilityLabel="Retry sending photo"
                press="chip"
                size={TOKENS.interaction.minTarget}
                style={styles.mediaRetry}
                onPress={onRetry}
              >
                <Text allowFontScaling style={styles.mediaRetryLabel}>
                  Retry
                </Text>
              </Pressable>
            ) : null}
          </View>
        ) : mediaState === 'uploading' || mediaState === 'resolving' ? (
          <View style={styles.mediaScrim}>
            <View style={styles.mediaProgress}>
              {/* M3 linear progress: determinate once the upload has reported a
                  byte, indeterminate while the signed URL is still resolving.
                  https://m3.material.io/components/progress-indicators/guidelines */}
              <ProgressBar
                progress={
                  mediaState === 'uploading' ? uploadFraction : undefined
                }
                color={theme.color.text.onAccent}
                trackColor={styles.mediaProgressTrack.backgroundColor as string}
                testID="chat-v2-upload-progress"
              />
            </View>
          </View>
        ) : null}
        {/* The stamp belongs to the PHOTO, so it lives inside the image's own
            clipped box and cannot escape a frame that was capped narrower. */}
        <View style={styles.mediaMeta} pointerEvents="none">
          <Text allowFontScaling={false} style={styles.mediaStamp}>
            {stamp}
          </Text>
          {receipt !== undefined ? (
            <Icon
              name={receipt === 'read' ? 'checkCheck' : 'check'}
              size={TOKENS.icon.xs}
              color={
                receipt === 'read'
                  ? theme.color.media.tickRead
                  : theme.color.media.meta
              }
            />
          ) : null}
        </View>
      </View>
    </View>
  );
}

function ChatMessageCellV2View(props: ChatV2MessageCellProps) {
  const {
    messageId,
    text,
    mine,
    first,
    pending,
    failed,
    deleted,
    edited,
    stamp,
    receipt,
    quoteAuthor,
    quoteBody,
    tallies,
    voice,
    image,
    voicePlayer,
    actionable,
    mutationsDisabled = false,
    onLongPress,
    onSwipeReply,
    onRetry,
    onOpenImage,
  } = props;
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const bubbleRef = useRef<RNView>(null);
  const tx = useSharedValue(0);

  const openActions = useCallback(() => {
    const node = bubbleRef.current;
    if (node === null) {
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      onLongPress(messageId, mine, { x, y, width, height });
    });
  }, [messageId, mine, onLongPress]);

  /*
   * The same two things without a gesture.
   *
   * TalkBack raises `longpress` and `activate` from its own actions menu, so
   * the reaction strip and the retry are reachable by somebody who cannot hold
   * a finger on a bubble for half a second. This replaces an
   * `accessibilityHint` that was inert — RN installs its delegate for a view
   * with a role, state, actions or test id, and a hint alone installs nothing,
   * so the sentence was never announced. See `chatV2CellA11yActions`.
   */
  const a11yActions = useMemo(
    () =>
      chatV2CellA11yActions({
        actionable,
        failed: failed && !mutationsDisabled,
        // Only a photo has a tap of its own, so only a photo offers `activate`.
        activateLabel: image === undefined ? undefined : 'View photo',
      }),
    [actionable, failed, image, mutationsDisabled],
  );

  const replyToThis = useCallback(() => {
    onSwipeReply(messageId);
  }, [messageId, onSwipeReply]);

  const openImage = useCallback(() => {
    if (image !== undefined) {
      onOpenImage(image);
    }
  }, [image, onOpenImage]);

  const retryThis = useCallback(() => {
    onRetry(messageId);
  }, [messageId, onRetry]);

  const onA11yAction = useCallback(
    (event: AccessibilityActionEvent) => {
      if (event.nativeEvent.actionName === 'longpress') {
        openActions();
        return;
      }
      if (failed && !mutationsDisabled) {
        retryThis();
        return;
      }
      openImage();
    },
    [failed, mutationsDisabled, openActions, openImage, retryThis],
  );

  /*
   * Swipe to quote-reply. Everything per frame is a shared value on the UI
   * thread, and `onUpdate` does nothing but write one — no hop back to the RN
   * runtime, which at 60-120 frames a second is the single biggest cause of
   * jank in a gesture.
   * https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/use-pan-gesture
   */
  const pan = usePanGesture({
    enabled: actionable,
    activeOffsetX: [-REPLY_ACTIVATE, REPLY_ACTIVATE],
    failOffsetY: [-12, 12],
    onUpdate: e => {
      // Peer drags right, mine drags left: both toward the screen edge. Hard
      // clamp with no rubber-band, which is the reference app's own behaviour.
      tx.set(
        mine
          ? Math.max(-REPLY_MAX_DRAG, Math.min(0, e.translationX))
          : Math.max(0, Math.min(REPLY_MAX_DRAG, e.translationX)),
      );
    },
    onDeactivate: e => {
      if (Math.abs(tx.get()) >= REPLY_TRIGGER) {
        runOnJS(replyToThis)();
      }
      // The finger's release velocity carries into the settle, so an
      // interrupted drag continues from where it was rather than starting cold.
      tx.set(springTo(0, 'smooth', e.velocityX));
    },
  });

  /*
   * One haptic as the drag crosses the commit threshold, and exactly one.
   *
   * A reaction rather than a branch inside `onUpdate`: it fires when the
   * derived boolean CHANGES, so crossing back and forth taps once each way and
   * holding past the line taps nothing — without a latch of its own to get
   * wrong, and without putting a scheduling call in a per-frame handler.
   */
  useAnimatedReaction(
    () => Math.abs(tx.get()) >= REPLY_TRIGGER,
    (crossed, previous) => {
      if (crossed && previous === false) {
        runOnJS(tick)();
      }
    },
  );

  /*
   * Long press opens the actions; tap opens the photo, or retries a failed
   * send. Exclusive in that order, so a 500ms hold cannot also fire the tap
   * when the finger lifts — RNGH's Android tap has a 500ms default max
   * duration, which is the same 500 the hold is built on.
   * https://docs.swmansion.com/react-native-gesture-handler/docs/composition/use-exclusive-gestures
   */
  const hold = useLongPressGesture({
    enabled: actionable,
    // The Android system long-press timeout.
    // https://developer.android.com/reference/android/view/ViewConfiguration#getLongPressTimeout()
    minDuration: 500,
    onActivate: () => {
      runOnJS(longPressHaptic)();
      runOnJS(openActions)();
    },
  });

  const onTap = failed && !mutationsDisabled
    ? retryThis
    : image !== undefined
    ? openImage
    : undefined;
  const tap = useTapGesture({
    enabled: onTap !== undefined,
    // The pan's own activation offset, so a completed swipe-reply cannot also
    // register as a tap and open the viewer on top of the quote it just made.
    maxDistance: REPLY_ACTIVATE,
    onDeactivate: e => {
      if (!e.canceled && onTap !== undefined) {
        runOnJS(onTap)();
      }
    },
  });

  const discrete = useExclusiveGestures(hold, tap);
  const composed = useSimultaneousGestures(pan, discrete);

  const slide = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.get() }],
  }));
  // The reply arrow the bubble uncovers as it slides: it fills in from 20dp and
  // is full at the commit threshold. Interpolated on the UI thread, so the
  // reveal costs no React render.
  const reveal = useAnimatedStyle(() => {
    const d = Math.abs(tx.get());
    return {
      opacity: interpolate(d, [20, REPLY_TRIGGER], [0, 1], 'clamp'),
      transform: [
        { scale: interpolate(d, [20, REPLY_TRIGGER], [0.6, 1], 'clamp') },
      ],
    };
  });

  const textStyle = mine ? styles.textMine : styles.textPeer;
  const hasTallies = tallies !== undefined && tallies.length > 0;

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowPeer]}>
      {actionable ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.replyReveal,
            mine ? styles.replyRevealMine : styles.replyRevealPeer,
            reveal,
          ]}
        >
          <Icon
            name="reply"
            size={TOKENS.icon.md}
            color={theme.color.text.secondary}
          />
        </Animated.View>
      ) : null}
      <View
        style={[
          styles.stack,
          mine ? styles.stackMine : styles.stackPeer,
          hasTallies ? styles.stackWithTally : null,
        ]}
      >
        {/* The tail sits in the STACK, not inside the bubble, so the bubble's
            own clipping cannot cut it and it costs the text box no width. */}
        {first ? (
          <View
            testID={mine ? 'chat-v2-tail-mine' : 'chat-v2-tail-peer'}
            pointerEvents="none"
            style={mine ? styles.tailMine : styles.tailPeer}
          />
        ) : null}
        <GestureDetector gesture={composed}>
          <Animated.View
            ref={bubbleRef}
            /*
             * The actions ride on the BUBBLE for a text or voice row, whose
             * only content is its own text, and on the IMAGE for a photo — see
             * MediaBody. Putting them here for a photo too would collapse the
             * picture's own `imagebutton` node into this one and take its
             * `activate` with it, which is the trade V1 recorded and did not
             * make. https://reactnative.dev/docs/accessibility
             */
            accessibilityActions={
              image === undefined && a11yActions.length > 0
                ? [...a11yActions]
                : undefined
            }
            onAccessibilityAction={
              image === undefined && a11yActions.length > 0
                ? onA11yAction
                : undefined
            }
            style={[
              image === undefined ? styles.bubble : null,
              image === undefined && mine ? styles.bubbleMine : null,
              image === undefined && !mine ? styles.bubblePeer : null,
              image === undefined && first
                ? mine
                  ? styles.tailCornerMine
                  : styles.tailCornerPeer
                : null,
              pending && !failed ? styles.pendingBubble : null,
              slide,
            ]}
          >
            {image !== undefined ? (
              <MediaBody
                image={image}
                mine={mine}
                pending={pending}
                failed={failed}
                retryEnabled={!mutationsDisabled}
                stamp={stamp}
                receipt={receipt}
                onRetry={retryThis}
                a11yActions={a11yActions}
                onA11yAction={onA11yAction}
              />
            ) : deleted ? (
              /* The tombstone comes first: migration 103 nulls every payload
                 column together, so a deleted voice note has no `voice_path`
                 and every other branch would render an empty bubble. */
              <View style={styles.tombstoneBody}>
                <View style={styles.tombstoneRow}>
                  <Icon
                    name="block"
                    size={TOKENS.icon.xs}
                    color={theme.color.text.tertiary}
                  />
                  <Text
                    testID={
                      mine ? 'chat-v2-message-mine' : 'chat-v2-message-peer'
                    }
                    allowFontScaling
                    style={[textStyle, styles.tombstoneText]}
                  >
                    {text}
                  </Text>
                </View>
                {/* No receipt: a read tick on a message that no longer exists
                    is a claim about nothing. The clock stays, because WHEN it
                    was said is still true and is what holds its place. */}
                <MetaRow
                  stamp={stamp}
                  edited={false}
                  receipt={undefined}
                  failed={false}
                  mine={mine}
                />
              </View>
            ) : voice !== undefined ? (
              <View style={styles.voiceBody}>
                <VoiceNote
                  messageId={voice.messageId}
                  path={voice.path}
                  durationMs={voice.durationMs}
                  peaks={voice.peaks}
                  /*
                   * False on BOTH sides, which is a correction rather than an
                   * omission. `onAccent` paints the player's ink in
                   * `text/onAccent` — white in light mode — and it was written
                   * for an outgoing bubble that WAS the accent fill. This
                   * bubble is `bubble/mine`, pale coral in light, so white ink
                   * on it is a contrast failure. `text/secondary` is authored
                   * per mode and reads on both fills.
                   */
                  onAccent={false}
                  pending={pending}
                  onToggle={voicePlayer.toggle}
                  onCycleSpeed={voicePlayer.cycleSpeed}
                  speed={voicePlayer.speed}
                />
                <MetaRow
                  stamp={stamp}
                  edited={edited}
                  receipt={receipt}
                  failed={failed}
                  mine={mine}
                />
              </View>
            ) : (
              <>
                {quoteAuthor !== undefined ? (
                  <QuoteBlock
                    author={quoteAuthor}
                    body={quoteBody ?? 'Voice note'}
                  />
                ) : null}
                <TextBody
                  text={text}
                  textStyle={textStyle}
                  testID={
                    mine ? 'chat-v2-message-mine' : 'chat-v2-message-peer'
                  }
                  stamp={stamp}
                  edited={edited}
                  receipt={receipt}
                  failed={failed}
                  mine={mine}
                />
              </>
            )}
          </Animated.View>
        </GestureDetector>
        {/*
         * Applied reactions, stuck to the bubble's trailing corner.
         *
         * Rendered off the tallies alone, with no `mine` guard: a 1:1 thread's
         * only possible reaction on my own message is THEIRS, and hiding it
         * would drop the one tally that can exist there. What my own bubble
         * does not get is the PICKER — see `chatV2MessageActions`.
         */}
        {hasTallies ? (
          <View
            testID={mine ? 'chat-v2-tally-mine' : 'chat-v2-tally-peer'}
            style={[
              styles.tallyAttach,
              mine ? styles.tallyAttachMine : styles.tallyAttachPeer,
            ]}
          >
            <ChatV2ReactionTally tallies={tallies} />
          </View>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The pills under a bubble. A count only appears at two, because two is the
 * maximum in a 1:1 thread and a "1" beside one emoji is a number that can never
 * be anything else.
 */
function ChatV2ReactionTally({
  tallies,
}: {
  tallies: readonly ReactionTally[];
}) {
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.tallyRow}>
      {tallies.map(tally => (
        <View
          key={tally.emoji}
          style={[styles.tallyPill, tally.mine ? styles.tallyPillMine : null]}
        >
          <Text allowFontScaling={false} style={styles.tallyEmoji}>
            {tally.emoji as ReactionEmoji}
          </Text>
          {tally.count > 1 ? (
            <Text allowFontScaling={false} style={styles.tallyCount}>
              {tally.count}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/**
 * Compared on the facts, not on the row object.
 *
 * `buildChatV2Rows` runs whenever `messages` changes, and react-query hands
 * back a fresh array for a single `read_at`, so every row object is new on
 * every receipt. A reference compare would re-render the whole transcript for
 * one tick; comparing what the cell PAINTS re-renders the bubble it is about.
 *
 * The callbacks are deliberately not compared: all five are `useCallback`s on
 * the screen with stable dependencies, so including them would only reopen the
 * hole this comparator closes.
 */
function areEqual(
  a: ChatV2MessageCellProps,
  b: ChatV2MessageCellProps,
): boolean {
  return (
    sameMessageCell(a, b) &&
    a.actionable === b.actionable &&
    // `useVoicePlayer` memoises its object and changes identity only when the
    // playback rate does, which is exactly when the speed pill must repaint.
    a.voicePlayer === b.voicePlayer
  );
}

export const ChatMessageCellV2 = memo(ChatMessageCellV2View, areEqual);

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    row: {
      width: '100%',
      justifyContent: 'center',
    },
    rowMine: {
      alignItems: 'flex-end',
    },
    rowPeer: {
      alignItems: 'flex-start',
    },
    stack: {
      position: 'relative',
      // Owned here, where the parent has a definite row width. A percentage
      // max-width on the shrink-wrapped bubble itself creates circular Android
      // measurement: the wrapper shrinks to the text while the text measures
      // against the wrapper.
      maxWidth: '80%',
      overflow: 'visible',
    },
    stackMine: {
      alignSelf: 'flex-end',
    },
    stackPeer: {
      alignSelf: 'flex-start',
    },
    // Room under the bubble for the stuck tally, so it does not collide with
    // the next cell of the inverted list.
    stackWithTally: {
      paddingBottom: 14,
      marginBottom: TOKENS.space['2xs'],
    },
    bubble: {
      maxWidth: '100%',
      /*
       * WhatsApp's measured insets, and IDENTICAL on both sides. V1 gave mine
       * `space.md`/`space.xs` and theirs 8/2/10/5, which is why a one-word
       * exchange came out two different heights; `chatV2BubbleHeight` asserts
       * the parity these four numbers produce.
       */
      paddingLeft: CHAT_V2_BUBBLE_PADDING.left,
      paddingTop: CHAT_V2_BUBBLE_PADDING.top,
      paddingRight: CHAT_V2_BUBBLE_PADDING.right,
      paddingBottom: CHAT_V2_BUBBLE_PADDING.bottom,
      minHeight: TOKENS.layout.bubbleMinHeight,
      justifyContent: 'center',
      borderRadius: TOKENS.radius.bubble,
      borderCurve: 'continuous',
      overflow: 'visible',
    },
    bubbleMine: {
      backgroundColor: t.color.bubble.mine,
    },
    bubblePeer: {
      backgroundColor: t.color.bubble.theirs,
    },
    // Not a spinner: the bubble is already on screen and will almost always
    // confirm, so a spinner would promise more uncertainty than there is.
    pendingBubble: {
      opacity: 0.55,
    },
    tailMine: {
      position: 'absolute',
      top: 0,
      right: -TAIL_W,
      width: 0,
      height: 0,
      borderTopWidth: TAIL_H,
      borderTopColor: t.color.bubble.mine,
      borderRightWidth: TAIL_W,
      borderRightColor: 'transparent',
    },
    tailPeer: {
      position: 'absolute',
      top: 0,
      left: -TAIL_W,
      width: 0,
      height: 0,
      borderTopWidth: TAIL_H,
      borderTopColor: t.color.bubble.theirs,
      borderLeftWidth: TAIL_W,
      borderLeftColor: 'transparent',
    },
    // The tail-side corner squares off so the wedge grows out of the bubble
    // rather than floating away from a rounded corner.
    tailCornerMine: {
      borderTopRightRadius: 1,
    },
    tailCornerPeer: {
      borderTopLeftRadius: 1,
    },
    replyReveal: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
    },
    replyRevealMine: {
      right: TOKENS.space.xs,
    },
    replyRevealPeer: {
      left: TOKENS.space.xs,
    },
    textBubble: {
      minWidth: 0,
      flexShrink: 1,
      alignItems: 'flex-start',
    },
    messageText: {
      flexShrink: 1,
    },
    textMine: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.bubble.text,
    },
    textPeer: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    // The transparent reserve inside the message Text. Zero content, so nothing
    // paints and nothing can double-paint — which is what defeated V1's first
    // attempt at this (a transparent COPY of the timestamp, which Android drew).
    metaSpacer: {
      height: 1,
    },
    metaOverlay: {
      position: 'absolute',
      right: 0,
      bottom: 0,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-end',
      gap: TOKENS.space.hair,
      height: CHAT_V2_META_LINE_HEIGHT,
      // Refusing to shrink is what stops the clock breaking mid-word: it either
      // fits beside the text or takes its own line whole, which are the only
      // two states this layout has.
      flexShrink: 0,
    },
    metaText: {
      ...TOKENS.typography.bodySmall,
      fontSize: CHAT_V2_META_FONT_SIZE,
      lineHeight: CHAT_V2_META_LINE_HEIGHT,
    },
    metaTextMine: {
      color: t.color.bubble.meta,
    },
    metaTextPeer: {
      color: t.color.text.tertiary,
    },
    voiceBody: {
      alignItems: 'flex-end',
    },
    tombstoneBody: {
      alignItems: 'flex-end',
    },
    tombstoneRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space['2xs'],
      flexShrink: 1,
    },
    // Italic and deemphasized: this line is the app speaking about a message,
    // not the message.
    tombstoneText: {
      fontStyle: 'italic',
      color: t.color.text.tertiary,
    },
    quote: {
      borderLeftWidth: 2,
      borderLeftColor: t.color.bg.accentStrong,
      paddingLeft: TOKENS.space.xs,
      marginBottom: TOKENS.space['2xs'],
      gap: 1,
    },
    quoteAuthor: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.bubble.text,
    },
    quoteBody: {
      ...TOKENS.typography.bodySmall,
      color: t.color.bubble.text,
    },
    mediaFrame: {
      width: MEDIA_WIDTH + MEDIA_INSET * 2,
      maxWidth: '100%',
      padding: MEDIA_INSET,
      borderRadius: TOKENS.radius.bubble,
      borderCurve: 'continuous',
      overflow: 'hidden',
    },
    mediaFrameMine: {
      backgroundColor: t.color.bubble.mine,
    },
    mediaFramePeer: {
      backgroundColor: t.color.bubble.theirs,
    },
    mediaInner: {
      width: '100%',
      // Concentric with the frame: `inner = outer - inset`, so the picture
      // reads as inside the bubble rather than pasted onto it.
      borderRadius: TOKENS.radius.bubble - MEDIA_INSET,
      borderCurve: 'continuous',
      overflow: 'hidden',
      backgroundColor: t.color.bg.hover,
    },
    mediaImage: {
      width: '100%',
      height: '100%',
    },
    mediaScrim: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: t.color.media.uploading,
    },
    mediaProgress: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
    },
    // The one value the progress track needs that no token carries: a white at
    // 35% is the only fill guaranteed to read as a track against arbitrary
    // photo content, whatever the mode. Named here rather than inlined so the
    // literal has one home and the gate can see it is deliberate.
    mediaProgressTrack: {
      backgroundColor: 'rgba(255,255,255,0.35)',
    },
    /*
     * The failed state. A scrim heavy enough to carry white copy over any
     * photograph, a danger mark, and the retry spelled out — the bubble's own
     * tap does the same thing, but a photo that just failed is precisely the
     * moment not to rely on an affordance nobody can see.
     */
    mediaFailed: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      gap: TOKENS.space['2xs'],
      backgroundColor: t.color.media.scrim,
    },
    mediaFailedLabel: {
      ...TOKENS.typography.labelMedium,
      color: t.color.text.onAccent,
    },
    mediaRetry: {
      minHeight: TOKENS.interaction.minTarget,
      justifyContent: 'center',
      paddingHorizontal: TOKENS.space.md,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.text.onAccent,
    },
    mediaRetryLabel: {
      ...TOKENS.typography.labelLarge,
      color: t.color.text.onAccent,
    },
    mediaMeta: {
      position: 'absolute',
      right: 6,
      bottom: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: t.color.media.scrim,
      borderRadius: TOKENS.radius.xs,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    mediaStamp: {
      ...TOKENS.typography.bodySmall,
      fontSize: CHAT_V2_META_FONT_SIZE,
      lineHeight: CHAT_V2_META_LINE_HEIGHT,
      color: t.color.media.meta,
    },
    tallyAttach: {
      position: 'absolute',
      bottom: 2,
      zIndex: 2,
    },
    tallyAttachMine: {
      right: 10,
    },
    tallyAttachPeer: {
      left: 10,
    },
    tallyRow: {
      flexDirection: 'row',
      gap: TOKENS.space.hair,
    },
    tallyPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.hair,
      paddingHorizontal: 5,
      paddingVertical: TOKENS.space.hair,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.sunken,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      elevation: 2,
    },
    // My own reaction is marked by the weight of the border, not by colour: the
    // accent budget is spent on the bubble itself.
    tallyPillMine: {
      borderColor: t.color.border.strong,
    },
    tallyEmoji: {
      fontSize: 13,
      lineHeight: 16,
    },
    tallyCount: {
      ...TOKENS.typography.numeralSmall,
      color: t.color.text.secondary,
    },
  });
