import React, { memo, useCallback, useMemo, useRef, useState } from 'react';
import {
  Image,
  Modal,
  Pressable as RNPressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type StyleProp,
  type TextStyle,
  type View as RNView,
  type ViewStyle,
} from 'react-native';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { bubbleArrive, bubbleLaunch, springTo } from '../theme/motion';
import { longPress as longPressHaptic, tick } from '../lib/haptics';
import type { ReactionEmoji } from '../lib/database.types';
import type { VoicePlayer } from '../lib/voice';
import { useAttachmentUrl } from '../api/attachments';
import { useStore } from '../store/useStore';
import { Avatar } from './Avatar';
import { BubbleTime } from './BubbleTime';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';
import { ReactionStrip } from './ReactionStrip';
import { VoiceNote } from './VoiceNote';

const AVATAR_SLOT = 26;

/**
 * Symmetric on all four corners, on both sides, and now a token.
 *
 * It was a hardcoded 18, which is iOS Messages' corner, and it is 22 because of
 * one requirement that 18 could not meet: a picture inside a bubble has to read
 * as being *inside* it rather than pasted onto it, and that needs the image's own
 * corner to be concentric with the bubble's. Concentric means
 * `inner = outer - inset`, so at a 3dp inset the image wants a 19dp corner, and
 * an image at 19 inside a bubble at 18 is visibly wrong: the picture would bulge
 * past the corner it is supposed to sit within.
 *
 * 22 and not 24: at 22 with 16pt of horizontal padding a corner-adjacent glyph in
 * the text still clears the curve, and at 24 it does not. `radius.thread` is 24
 * for the inbox bubble, which can afford the larger corner because it is 72pt
 * tall rather than one line of text.
 *
 * Tails stay out. WhatsApp iOS puts a tail on the first bubble of a run, and
 * taking it back would undo a settled decision: the tail is what made the two
 * sides different shapes, which contradicted the symmetry this component is built
 * on. `radius.tail` is kept in the tokens with a note saying it has no consumer.
 */
const BUBBLE_RADIUS = TOKENS.radius.bubble;

/**
 * The padding between a media bubble's edge and the picture inside it.
 *
 * 3dp, measured off `Pappal Conversation` (60:2): a 246x186 bubble holding a
 * 240x180 image. Exported with `mediaInnerRadius` rather than inlined, because
 * the arithmetic that keeps the two corners concentric is the entire reason the
 * outer radius moved, and it should be impossible to change one without the
 * other.
 *
 * Consumed since 014: `messages` now carries an `attachment_path` into the
 * private `attachments` bucket, and `MediaBubble` below is the reader. The
 * geometry that motivated the radius change is the geometry the photo now uses,
 * `inner = outer - inset`, so the picture reads as inside the bubble.
 */
export const MEDIA_INSET = 3;

/** Concentric with the bubble's corner: `inner = outer - inset`. */
export function mediaInnerRadius(): number {
  return BUBBLE_RADIUS - MEDIA_INSET;
}

/** The widest a photo bubble draws; height follows the image's own aspect. */
const MEDIA_WIDTH = 240;
const MEDIA_MIN_HEIGHT = 120;
const MEDIA_MAX_HEIGHT = 320;

/** The message this one is replying to, rendered inside the bubble above the body. */
export interface Quote {
  author: string;
  /** Null on a voice note. Rendered as a kind rather than as an empty line. */
  body: string | null;
}

/** One emoji and how many of the two people in the thread chose it. */
export interface ReactionTally {
  emoji: ReactionEmoji;
  count: number;
  mine: boolean;
}

/**
 * The payload the actions sheet needs, exported so ChatScreen can type it
 * without duplicating the definition and so Turn.tsx can build it internally.
 */
export interface ActionTarget {
  id: string;
  mine: boolean;
  author: string;
  body: string | null;
}

/**
 * A voice note's payload, built in the transcript memo so its identity is stable
 * and the bubble's `memo` still does its job.
 */
export interface VoiceBody {
  messageId: string;
  path: string;
  durationMs: number;
  /** Stored waveform peaks from migration 023; absent on older rows (FLAT bars are the fallback). */
  peaks?: readonly number[];
}

/**
 * An image payload, built in the transcript memo like VoiceBody so its identity
 * is stable and the bubble's `memo` holds. `localUri` is set only while the row
 * is optimistic, so the pick shows before it is in the bucket; once settled the
 * bubble resolves through a signed URL minted from `path`.
 */
export interface ImageBody {
  messageId: string;
  path: string;
  width: number;
  height: number;
  localUri?: string;
}

interface Shared {
  timestamp?: string;
  quote?: Quote;
  reactions?: readonly ReactionTally[];
  /**
   * Set when this row carries audio instead of text. The three payloads are
   * mutually exclusive by `message_carries_one_payload`, so the bubble renders
   * one and never more than one.
   */
  voice?: VoiceBody;
  /** Set when this row carries a photo. Mutually exclusive with text and voice. */
  image?: ImageBody;
  /** Required whenever `voice` is set: the single playhead, shared by every row. */
  voicePlayer?: VoicePlayer;
  /**
   * Primitive props used to build the long-press handler INSIDE the bubble.
   *
   * Passing the handler as `() => void` from renderItem created a new closure
   * per row per render (because it closed over message-specific values), which
   * broke memo on every balance tick. Instead the parent passes a stable
   * `onRequestActions` (already useCallback'd at the screen level) and the
   * primitive data the bubble needs to build the specific target. The bubble
   * constructs `() => void` itself via useCallback keyed on those primitives.
   */
  messageId?: string;
  author?: string;
  /** The raw database body, which may be null for voice/image messages. */
  rawBody?: string | null;
  /**
   * @deprecated Prefer onSwipeReply + onReact + onReportMessage. Kept so older
   * call sites still typecheck during the WhatsApp-gesture migration.
   */
  onRequestActions?: (target: ActionTarget) => void;
  /** Swipe across the bubble (WhatsApp) to quote-reply. */
  onSwipeReply?: (target: ActionTarget) => void;
  /** React from the thin long-press strip. */
  onReact?: (messageId: string, emoji: ReactionEmoji) => void;
  /** Report from the strip (peer messages only). */
  onReportMessage?: (messageId: string) => void;
  /** Which emoji the caller already has on this message. */
  chosenReaction?: ReactionEmoji | null;
}

/**
 * Bottom-right metadata row inside a bubble: timestamp + optional delivery tick.
 *
 * Shared by both text/voice bubbles (via Body) and media bubbles (via the
 * mediaTime overlay). The receipt icon is INSIDE the bubble on every settled
 * outgoing message, not only the newest — the same WhatsApp pattern the rest of
 * the transcript layout already follows.
 *
 * Receipt colours on the accent fill: green would clash and dark tokens drop
 * below AA. `rgba(255,255,255,0.65)` for sent reads as "muted confirmation";
 * a brighter white-green tint (#85D4A0) for read mirrors a positive state
 * without competing with the bubble's coral.
 */
function MetaRow({
  timestamp,
  receipt,
  onAccent,
}: {
  timestamp: string;
  receipt?: 'sent' | 'read';
  onAccent: boolean;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const readColor = onAccent ? '#85D4A0' : theme.color.text.positive;
  const sentColor = onAccent ? 'rgba(255,255,255,0.65)' : theme.color.text.tertiary;
  return (
    <View style={styles.metaRow}>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={onAccent ? styles.inlineTimeOnAccent : styles.inlineTimePeer}>
        {timestamp}
      </Text>
      {receipt !== undefined ? (
        <Icon
          name={receipt === 'read' ? 'checkCheck' : 'check'}
          size={11}
          color={receipt === 'read' ? readColor : sentColor}
        />
      ) : null}
    </View>
  );
}

/**
 * The audio body, or the text one.
 *
 * A single helper on purpose, so the two bubbles cannot drift into rendering a
 * voice note differently: the whole argument of this file is that both sides are
 * the same shape and only the fill and the side differ.
 */
function Body({
  message,
  voice,
  voicePlayer,
  pending,
  onAccent,
  textStyle,
  testID,
  timestamp,
  receipt,
}: {
  message: string;
  voice: VoiceBody | undefined;
  voicePlayer: VoicePlayer | undefined;
  pending: boolean;
  onAccent: boolean;
  textStyle: StyleProp<TextStyle>;
  testID: string;
  timestamp?: string;
  receipt?: 'sent' | 'read';
}) {
  // Must precede the voice-branch early return: a hook cannot be called
  // conditionally (react-hooks/rules-of-hooks).
  const stamp = useStyles(makeStyles);
  if (voice !== undefined && voicePlayer !== undefined) {
    return (
      <View style={stamp.textBody}>
        <VoiceNote
          messageId={voice.messageId}
          path={voice.path}
          durationMs={voice.durationMs}
          peaks={voice.peaks}
          onAccent={onAccent}
          pending={pending}
          onToggle={voicePlayer.toggle}
          onCycleSpeed={voicePlayer.cycleSpeed}
          speed={voicePlayer.speed}
        />
        {timestamp ? (
          <MetaRow timestamp={timestamp} receipt={receipt} onAccent={onAccent} />
        ) : null}
      </View>
    );
  }
  // ONE clock (+ optional tick) per bubble, right-aligned on its own line.
  //
  // History of what did NOT work, so it is not re-tried: (1) a transparent
  // width-reserve on the last line plus an absolutely-pinned clock rendered BOTH
  // on Android (`color:'transparent'` did not suppress the reserve), showing the
  // time twice. (2) A clock nested inside the message <Text> is under-measured
  // when it is a smaller font, so a short bubble clipped it ("Hi!  8:1"). (3) A
  // flex row wrapped the clock mid-word in a narrow bubble ("8:10 p" / "m"). A
  // block child, right-aligned, measures cleanly and never clips or duplicates.
  return (
    <View style={stamp.textBody}>
      <Text testID={testID} allowFontScaling style={textStyle}>
        {message}
      </Text>
      {timestamp ? (
        <MetaRow timestamp={timestamp} receipt={receipt} onAccent={onAccent} />
      ) : null}
    </View>
  );
}

/**
 * A photo, in a bubble whose 3dp frame is the speaker's colour and whose corner
 * is concentric with the image inside it.
 *
 * The box is a fixed width with the height derived from the image's own aspect,
 * clamped so a panorama does not become a hairline and a tall shot does not eat
 * the screen. The height is known before the bytes arrive (the row carries the
 * intrinsic size), so the bubble reserves its space and the transcript does not
 * reflow when the picture decodes.
 *
 * The source is the local pick while the row is optimistic, then a signed URL.
 * `useAttachmentUrl` is a no-op until there is a real path, so the pending bubble
 * pays for no credential.
 */
function MediaBubble({
  image,
  onAccent,
  pending,
  timestamp,
  receipt,
}: {
  image: ImageBody;
  onAccent: boolean;
  pending: boolean;
  /** Rendered INSIDE the image box. See `mediaTime`. */
  timestamp?: string;
  receipt?: 'sent' | 'read';
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const { data: signedUrl } = useAttachmentUrl(image.localUri ? null : image.path);
  const uri = image.localUri ?? signedUrl;
  const ratio = image.width / image.height;
  /*
   * The height comes from the box's MEASURED width, not from `MEDIA_WIDTH`.
   *
   * `mediaInner` used to be a hard `width: MEDIA_WIDTH` (240dp) inside a frame
   * capped at `maxWidth: '80%'`. When the cap bit, the inner box was wider than
   * its parent and `overflow: hidden` cut it — so the picture was silently
   * cropped on the right, and anything right-anchored inside it (the timestamp)
   * was anchored to an edge that was off-screen. Measured on device: the frame
   * ended at x=1042 while the inner box ran to 1166.
   *
   * Now the frame carries the width and the inner box fills it, so the inner
   * box's right edge IS the visible right edge at every screen size.
   */
  const [boxWidth, setBoxWidth] = useState(MEDIA_WIDTH);
  const height = Math.max(
    MEDIA_MIN_HEIGHT,
    Math.min(MEDIA_MAX_HEIGHT, Math.round(boxWidth / ratio)),
  );

  // Upload fraction (0–1) while bytes are in flight; undefined before the first
  // XHR progress event and after the upload settles.
  const uploadFraction = useStore(s => s.uploadProgress[image.messageId]);

  return (
    <View
      style={[
        styles.mediaBubble,
        onAccent ? styles.mediaFrameMine : styles.mediaFramePeer,
      ]}
    >
      {/* The inner box carries the neutral placeholder fill so a photo still
          resolving its signed URL reads as loading grey, not as the coral frame
          showing through an empty image. The Image paints over it once ready. */}
      <View
        style={[styles.mediaInner, { height }]}
        onLayout={e => setBoxWidth(e.nativeEvent.layout.width)}>
        {uri !== undefined ? (
          <Image
            testID="bubble-image"
            source={{ uri }}
            style={styles.mediaImage}
            resizeMode="cover"
            accessibilityLabel={
              pending && uploadFraction !== undefined
                ? `Sending photo, ${Math.round(uploadFraction * 100)} percent`
                : pending
                ? 'Sending photo'
                : 'Photo'
            }
          />
        ) : null}
        {/* M3 linear determinate progress pinned at the bottom of the image while
            the upload is in flight.  Determinate (progress={fraction}) when the
            XHR has reported at least one byte; indeterminate (progress=undefined)
            before the first event or while minting the signed URL after upload.
            Policy: https://m3.material.io/components/progress-indicators/guidelines
            Colour: theme.color.text.onAccent (#FFF) over the dark scrim is the
            only token that guarantees contrast against any photo content. */}
        {pending || uri === undefined ? (
          <View style={styles.mediaLoading}>
            <View style={styles.mediaProgressBar}>
              <ProgressBar
                progress={pending ? uploadFraction : undefined}
                color={theme.color.text.onAccent}
                trackColor="rgba(255,255,255,0.35)"
                testID="upload-progress"
              />
            </View>
          </View>
        ) : null}
        {/*
         * The timestamp belongs to the PHOTO, so it lives inside the image's own
         * clipped box (Amit, 2026-09-04: "timestamp should be part of photo
         * component like chat right").
         *
         * It used to be a sibling of this whole component, absolutely positioned
         * at `right: 10` of the wrapper around it. `mediaBubble` is
         * `maxWidth: '80%'`, so that wrapper is WIDER than the photo whenever the
         * photo hits the cap — and the chip landed outside the frame with the
         * delivery tick beyond the coral edge entirely. Measured on device:
         * the photo ended at x=936 and the chip ran past it.
         *
         * Inside `mediaInner` it is positioned against the image and clipped by
         * the same `overflow: hidden` and concentric radius, so it cannot escape
         * the picture however the picture is sized.
         */}
        {timestamp !== undefined ? (
          <View style={styles.mediaTime} pointerEvents="none">
            <BubbleTime stamp={timestamp} onAccent />
            {receipt !== undefined && !pending ? (
              <Icon
                name={receipt === 'read' ? 'checkCheck' : 'check'}
                size={11}
                color={receipt === 'read' ? '#85D4A0' : 'rgba(255,255,255,0.65)'}
              />
            ) : null}
          </View>
        ) : null}
      </View>
    </View>
  );
}

interface PeerProps extends Shared {
  message: string;
  initial: string;
  /** Profile image shown before the first bubble in each peer-message group. */
  avatarUri?: string | null;
  /** First of a group shows the avatar; continued turns keep the slot, hide the mark. */
  first: boolean;
  animate?: boolean;
}

/**
 * Both sides are in bubbles, and both bubbles are now the same shape.
 *
 * The first reversal, kept: their words used to sit bare on the page, on the
 * argument that a container adds chrome carrying no information. That was right
 * about chrome and wrong about the product, with one side contained and one side
 * loose, a long thread reads as *your* messages punctuated by captions rather
 * than as two people talking.
 *
 * The second reversal, and this file used to argue the other way: the tail corner
 * is gone. Both bubbles are 18 on all four corners, which is iOS Messages, and
 * **fill and side carry the speaker alone**. The tail was a real cue and it was
 * also the thing making the two sides different shapes, which contradicted the
 * symmetry the paragraph above is about. If it comes back it should come back on
 * both sides or on neither.
 *
 * The incoming fill changed for a measured reason rather than a stylistic one.
 * The white platform surface colour is `#FFFFFF` in light mode, identical to `bg/base`, so an incoming
 * bubble had no fill at all, only a 1px outline, which is the Material
 * outlined-card idiom and was the only thing holding it together. `bg/sunken` is
 * `#E5E5EA`, a real fill, so the border is deleted rather than kept: it was
 * compensating for the missing fill, and a filled bubble with a stroke is neither
 * platform's bubble. `text/primary` on `bg/sunken` measures about 13:1.
 *
 * Both sides are `maxWidth: '80%'` now. They disagreed before, the peer column
 * was width-limited by a `paddingRight` and mine by a percentage, which came to
 * 274pt against 262pt on a 360pt screen.
 *
 * The avatar slot is still always reserved, so the text edge never shifts between
 * a first and a continued turn.
 */
function PeerTurnView({
  message,
  initial,
  avatarUri,
  first,
  timestamp,
  animate,
  quote,
  reactions,
  voice,
  image,
  voicePlayer,
  messageId,
  author,
  rawBody,
  onSwipeReply,
  onReact,
  onReportMessage,
  chosenReaction,
}: PeerProps) {
  const styles = useStyles(makeStyles);
  const target = useMemo<ActionTarget | null>(
    () =>
      messageId !== undefined
        ? { id: messageId, mine: false, author: author ?? '', body: rawBody ?? null }
        : null,
    [messageId, author, rawBody],
  );
  return (
    <Animated.View
      entering={animate === true ? bubbleArrive : undefined}
      style={styles.peerRow}
    >
      <View style={styles.slot}>
        {first ? <Avatar initial={initial} uri={avatarUri} size={26} /> : null}
      </View>
      <View style={styles.peerColumn}>
        <View
          style={[
            styles.bubbleStack,
            reactions && reactions.length > 0 ? styles.bubbleStackWithReaction : null,
          ]}>
          <InteractiveBubble
            mine={false}
            target={target}
            bubbleStyle={styles.peerBubble}
            media={image !== undefined}
            onSwipeReply={onSwipeReply}
            onReact={onReact}
            onReportMessage={onReportMessage}
            chosenReaction={chosenReaction}>
            {image !== undefined ? (
              /* Same fix as the outgoing side: the timestamp is the photo's, so
                 MediaBubble renders it inside the image's clipped box. A peer
                 photo carries no delivery receipt, so none is passed. */
              <MediaBubble
                image={image}
                onAccent={false}
                pending={false}
                timestamp={timestamp}
              />
            ) : (
              <>
                {quote ? <QuoteBlock quote={quote} onAccent={false} /> : null}
                <Body
                  message={message}
                  voice={voice}
                  voicePlayer={voicePlayer}
                  pending={false}
                  onAccent={false}
                  textStyle={styles.peerText}
                  testID="bubble-peer"
                  timestamp={timestamp}
                />
              </>
            )}
          </InteractiveBubble>
          {reactions && reactions.length > 0 ? (
            <View style={[styles.reactionAttach, styles.reactionAttachPeer]}>
              <ReactionRow reactions={reactions} testID="reactions-peer" />
            </View>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

export const PeerTurn = memo(PeerTurnView);

interface MineProps extends Shared {
  message: string;
  /** Pending until the server confirms it; a dimmed bubble says so honestly. */
  pending?: boolean;
  /**
   * Receipt state, rendered inside every settled outgoing bubble (WhatsApp
   * pattern): single check for sent, double check for read. Undefined only while
   * the row is still optimistic (pending).
   */
  receipt?: 'sent' | 'read';
  /**
   * Only newly-sent (optimistic) rows animate in. History bubbles that are
   * already settled should mount silently so opening a chat does not play up
   * to 12 simultaneous launch springs at once.
   */
  isNew?: boolean;
}

/**
 * The signature moment lands here.
 *
 * `bubbleLaunch` starts the bubble narrow-and-tall and lets one `bounce` spring
 * resolve width, height and position together, so it arrives as an object with
 * mass rather than three properties finishing at their own pace. It is the
 * counterpart to the send button's squash: squeezed out of the button, released
 * into the thread.
 *
 * The fill is `accentStrong` rather than `accent` for a measured reason, the
 * lighter coral carries white text at 3.4:1, which is a fail, and this bubble is
 * full of white body copy. The deeper step measures 5.2:1.
 *
 * The metadata under the bubble stacks rather than sitting in a row. iOS Messages
 * puts the receipt on its own line under the last bubble, and a timestamp and the
 * word "Read" side by side read as one string with a space in it.
 */
function MyTurnView({
  message,
  timestamp,
  pending,
  receipt,
  quote,
  reactions,
  voice,
  image,
  voicePlayer,
  isNew,
  messageId,
  author,
  rawBody,
  onSwipeReply,
  onReact,
  onReportMessage,
  chosenReaction,
}: MineProps) {
  const styles = useStyles(makeStyles);
  const target = useMemo<ActionTarget | null>(
    () =>
      !pending && messageId !== undefined
        ? {
            id: messageId,
            mine: true,
            author: author ?? 'You',
            body: rawBody ?? null,
          }
        : null,
    [pending, messageId, author, rawBody],
  );
  return (
    <Animated.View entering={isNew === true ? bubbleLaunch : undefined} style={styles.myColumn}>
      <View
        style={[
          styles.bubbleStack,
          styles.bubbleStackEnd,
          reactions && reactions.length > 0 ? styles.bubbleStackWithReaction : null,
        ]}>
        <InteractiveBubble
          mine
          target={target}
          bubbleStyle={[styles.bubble, pending === true && styles.pending]}
          media={image !== undefined}
          onSwipeReply={onSwipeReply}
          onReact={onReact}
          onReportMessage={onReportMessage}
          chosenReaction={chosenReaction}
          alignEnd>
          {image !== undefined ? (
            <MediaBubble
              image={image}
              onAccent
              pending={pending === true}
              timestamp={timestamp}
              receipt={pending ? undefined : receipt}
            />
          ) : (
            <>
              {quote ? <QuoteBlock quote={quote} onAccent /> : null}
              <Body
                message={message}
                voice={voice}
                voicePlayer={voicePlayer}
                pending={pending === true}
                onAccent
                textStyle={styles.myText}
                testID="bubble-mine"
                timestamp={timestamp}
                receipt={pending ? undefined : receipt}
              />
            </>
          )}
        </InteractiveBubble>
        {reactions && reactions.length > 0 ? (
          <View style={[styles.reactionAttach, styles.reactionAttachMine]}>
            <ReactionRow reactions={reactions} testID="reactions-mine" />
          </View>
        ) : null}
      </View>
    </Animated.View>
  );
}

export const MyTurn = memo(MyTurnView);

/** Drag distance that commits a swipe-reply (Telegram ChatActivity.java:5033). */
const REPLY_TRIGGER = 50;
/** Hard clamp on the drag; Telegram does not rubber-band past this. */
const REPLY_MAX_DRAG = 72;
/** Gap between the reaction strip and the bubble it anchors to. */
const STRIP_GAP = 8;
/** Keep the strip this far from the window edges. */
const STRIP_EDGE = 12;
/** Strip-height estimate, used only to decide above-vs-below placement. */
const STRIP_H_EST = 56;

/**
 * Swipe-to-reply + long-press reaction strip around a bubble.
 *
 * Telegram/WhatsApp gestures: a horizontal drag past 50dp quotes the message,
 * with one KEYBOARD_TAP as it crosses and a reply arrow that fills in behind the
 * bubble; a system-length (500ms) long press fires LONG_PRESS and opens a thin
 * emoji strip anchored on the bubble (not a bottom sheet).
 */
function InteractiveBubble({
  mine,
  target,
  bubbleStyle,
  onSwipeReply,
  onReact,
  onReportMessage,
  chosenReaction,
  alignEnd,
  media,
  children,
}: {
  mine: boolean;
  target: ActionTarget | null;
  bubbleStyle?: StyleProp<ViewStyle>;
  onSwipeReply?: (target: ActionTarget) => void;
  onReact?: (messageId: string, emoji: ReactionEmoji) => void;
  onReportMessage?: (messageId: string) => void;
  chosenReaction?: ReactionEmoji | null;
  alignEnd?: boolean;
  /** When true, MediaBubble owns the frame — do not wrap in bubbleStyle. */
  media?: boolean;
  children: React.ReactNode;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const { width: winW, height: winH } = useWindowDimensions();
  const [stripOpen, setStripOpen] = useState(false);
  // Window-space rect of the bubble, measured when the strip opens, so the
  // Modal-hosted strip can anchor to it.
  const [anchor, setAnchor] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const bubbleRef = useRef<RNView>(null);
  const tx = useSharedValue(0);
  // Latches true once a drag has passed the commit threshold, so the KEYBOARD_TAP
  // haptic fires exactly once per crossing (Telegram fires it once at 50dp, not
  // per frame — ChatActivity.java:5033-5041). Reset when the drag falls back
  // under the threshold or the gesture ends.
  const crossed = useSharedValue(false);

  const closeStrip = useCallback(() => setStripOpen(false), []);

  const openStrip = useCallback(() => {
    if (target === null) {
      return;
    }
    // Measure the bubble in window space, then open — the strip is hosted in a
    // Modal (so a full-screen backdrop can dismiss it on an outside tap) and
    // needs the rect to anchor itself above the bubble.
    const node = bubbleRef.current;
    if (node !== null) {
      node.measureInWindow((x, y, width, height) => {
        setAnchor({ x, y, width, height });
        setStripOpen(true);
      });
    } else {
      setStripOpen(true);
    }
  }, [target]);

  const triggerReply = useCallback(() => {
    if (target !== null && onSwipeReply !== undefined) {
      setStripOpen(false);
      onSwipeReply(target);
    }
  }, [target, onSwipeReply]);

  const pan = Gesture.Pan()
    .activeOffsetX([-16, 16])
    .failOffsetY([-12, 12])
    .onUpdate(e => {
      // Peer: drag right; mine: drag left — both toward the screen edge, like WA.
      // Hard clamp at MAX_DRAG with no rubber-band: Telegram's swipe-to-reply
      // does not spring past its limit (design/references/telegram.md).
      const next = mine
        ? Math.max(-REPLY_MAX_DRAG, Math.min(0, e.translationX))
        : Math.max(0, Math.min(REPLY_MAX_DRAG, e.translationX));
      tx.value = next;
      // One KEYBOARD_TAP as the drag crosses the commit threshold.
      if (Math.abs(next) >= REPLY_TRIGGER) {
        if (!crossed.value) {
          crossed.value = true;
          runOnJS(tick)();
        }
      } else if (crossed.value) {
        crossed.value = false;
      }
    })
    .onEnd(() => {
      if (Math.abs(tx.value) >= REPLY_TRIGGER) {
        runOnJS(triggerReply)();
      }
      tx.value = springTo(0, 'smooth');
      crossed.value = false;
    });

  const longPress = Gesture.LongPress()
    // The Android system long-press timeout, which is what Telegram opens the
    // reaction menu on (ReactionsContainerLayout.java:2262). Was 400ms.
    .minDuration(500)
    .onStart(() => {
      runOnJS(longPressHaptic)();
      runOnJS(openStrip)();
    });

  const composed =
    target === null ? pan : Gesture.Simultaneous(pan, longPress);
  // Truthy iff the long-press strip is available — used for the accessibility hint
  // so TalkBack appends the action description rather than replacing the message.
  const onLongPress = target !== null ? openStrip : undefined;
  const slideStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));
  // The reply arrow the bubble uncovers as it slides: it fills in from 20dp and
  // is full at the commit threshold, the way Telegram's reply icon grows in
  // behind the message (ChatActivity.java:4651-4670). Interpolated rather than
  // Telegram's three-spring chain — the same read at a fraction of the cost.
  const replyRevealStyle = useAnimatedStyle(() => {
    const d = Math.abs(tx.value);
    return {
      opacity: interpolate(d, [20, REPLY_TRIGGER], [0, 1], 'clamp'),
      transform: [
        { scale: interpolate(d, [20, REPLY_TRIGGER], [0.6, 1], 'clamp') },
      ],
    };
  });

  // Where the Modal-hosted strip sits: above the bubble when there is room,
  // below it otherwise; aligned to the speaker's side and clamped to the edges.
  const placement = useMemo(() => {
    if (anchor === null) {
      return null;
    }
    const above = anchor.y - STRIP_GAP - STRIP_H_EST >= STRIP_EDGE;
    const p: { left?: number; right?: number; top?: number; bottom?: number } = above
      ? { bottom: winH - anchor.y + STRIP_GAP }
      : { top: anchor.y + anchor.height + STRIP_GAP };
    if (mine) {
      p.right = Math.max(STRIP_EDGE, winW - (anchor.x + anchor.width));
    } else {
      p.left = Math.max(STRIP_EDGE, anchor.x);
    }
    return p;
  }, [anchor, mine, winW, winH]);

  return (
    <View style={alignEnd ? styles.interactiveEnd : styles.interactiveStart}>
      {target !== null ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.replyReveal,
            mine ? styles.replyRevealMine : styles.replyRevealPeer,
            replyRevealStyle,
          ]}>
          <Icon name="reply" size={18} color={theme.color.text.secondary} />
        </Animated.View>
      ) : null}
      {/*
       * The strip is hosted in a Modal, not inline, so a full-screen backdrop
       * can dismiss it on an outside tap (Amit, 2026-09-03) — an inline strip
       * has nothing behind it to catch a "tap in free space". The backdrop is
       * transparent (no dim), matching the previous inline look; only the
       * dismiss behaviour is new. It anchors to the measured bubble rect.
       */}
      {target !== null ? (
        <Modal
          visible={stripOpen}
          transparent
          animationType="none"
          hardwareAccelerated
          statusBarTranslucent
          onRequestClose={closeStrip}>
          {/* RNGH gestures inside a Modal need their own root; the strip's
              Pressables are gesture-driven. */}
          <GestureHandlerRootView style={styles.fill}>
            <RNPressable
              style={StyleSheet.absoluteFill}
              onPress={closeStrip}
              accessibilityLabel="Dismiss reactions"
            />
            {placement !== null ? (
              <View style={[styles.stripAnchor, placement]} pointerEvents="box-none">
                <ReactionStrip
                  chosen={chosenReaction ?? null}
                  mine={mine}
                  onReact={emoji => {
                    setStripOpen(false);
                    onReact?.(target.id, emoji);
                  }}
                  onReply={() => {
                    setStripOpen(false);
                    onSwipeReply?.(target);
                  }}
                  onReport={
                    !mine && onReportMessage
                      ? () => {
                          setStripOpen(false);
                          onReportMessage(target.id);
                        }
                      : undefined
                  }
                />
              </View>
            ) : null}
          </GestureHandlerRootView>
        </Modal>
      ) : null}
      <GestureDetector gesture={composed}>
        <Animated.View
          ref={bubbleRef}
          accessibilityHint={
            onLongPress ? 'Long press for message actions' : undefined
          }
          style={[!media ? bubbleStyle : null, !media ? styles.bubbleInner : null, slideStyle]}>
          {children}
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

/**
 * The quoted parent of a reply, inside the bubble and never as a bubble of its own.
 *
 * On the coral fill both text lines are `text/onAccent` at **full** opacity, and
 * separation is carried by the rule and the inset instead. `opacity: 0.7` over
 * `bg/accentStrong` composites to roughly 3.9:1, which fails AA for body copy,
 * and neither `check-contrast.mjs` nor the `keeps message text legible on the
 * accent bubble` assertion can see a composited opacity, so the rule has to be
 * that there is no opacity here at all.
 *
 * Non-interactive in v1, deliberately. Tapping to scroll to the parent needs
 * `scrollToIndex` on an inverted variable-height list, which throws on an
 * unmeasured index without `getItemLayout`, and the parent is frequently not in
 * the loaded page at all.
 */
function QuoteBlock({ quote, onAccent }: { quote: Quote; onAccent: boolean }) {
  const styles = useStyles(makeStyles);
  return (
    <View
      style={[
        styles.quote,
        onAccent ? styles.quoteOnAccent : styles.quoteNeutral,
      ]}
    >
      <Text
        allowFontScaling
        numberOfLines={1}
        style={[styles.quoteAuthor, onAccent && styles.quoteTextOnAccent]}
      >
        {quote.author}
      </Text>
      <Text
        allowFontScaling
        numberOfLines={2}
        style={[styles.quoteBody, onAccent && styles.quoteTextOnAccent]}
      >
        {quote.body ?? 'Voice note'}
      </Text>
    </View>
  );
}

/**
 * Applied reactions, stuck to the bubble's trailing corner (WhatsApp).
 *
 * Half-overlapping the edge so the emoji reads as part of the message, not a
 * caption under it. The stack reserves bottom padding so the next turn clears
 * the overhang inside an inverted FlashList cell.
 *
 * A count only appears at two, because two is the maximum in a 1:1 thread and a
 * "1" next to a single emoji is a number that can never be anything else.
 */
function ReactionRow({
  reactions,
  testID,
}: {
  reactions: readonly ReactionTally[];
  testID: string;
}) {
  const styles = useStyles(makeStyles);
  return (
    <View testID={testID} style={styles.reactionRow}>
      {reactions.map(r => (
        <View
          key={r.emoji}
          style={[styles.reactionPill, r.mine && styles.reactionMine]}
        >
          <Text allowFontScaling={false} style={styles.reactionEmoji}>
            {r.emoji}
          </Text>
          {r.count > 1 ? (
            <Text style={styles.reactionCount}>{r.count}</Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    peerRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: TOKENS.space.xs,
    },
    slot: {
      width: AVATAR_SLOT,
    },
    peerColumn: {
      flex: 1,
      alignItems: 'flex-start',
      gap: TOKENS.space['2xs'],
    },
    bubbleStack: {
      position: 'relative',
      alignSelf: 'flex-start',
      // Own the 80% constraint here, where the parent has a definite row width.
      // Putting a percentage max-width on the shrink-wrapped bubble itself
      // creates circular Android measurement: the wrapper shrinks to the text
      // while the text is simultaneously measuring against the wrapper.
      maxWidth: '80%',
      // overflow visible so the stuck reaction is not clipped by the stack.
      overflow: 'visible',
    },
    bubbleStackEnd: {
      alignSelf: 'flex-end',
    },
    // Reserve space below the bubble so the stuck chip has a place to sit
    // without colliding with the next inverted-list cell.
    bubbleStackWithReaction: {
      marginBottom: TOKENS.space['2xs'],
      paddingBottom: 14,
    },
    reactionAttach: {
      position: 'absolute',
      bottom: 2,
      zIndex: 2,
    },
    reactionAttachPeer: {
      left: 10,
    },
    reactionAttachMine: {
      right: 10,
    },
    peerBubble: {
      maxWidth: '100%',
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.xs,
      paddingBottom: TOKENS.space.xs,
      backgroundColor: t.color.bg.sunken,
      borderRadius: BUBBLE_RADIUS,
      borderCurve: 'continuous',
    },
    peerText: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
      flexShrink: 1,
    },
    bubbleInner: {
      overflow: 'visible',
    },
    interactiveStart: {
      alignItems: 'flex-start',
      maxWidth: '100%',
    },
    interactiveEnd: {
      alignItems: 'flex-end',
      maxWidth: '100%',
    },
    // The reply arrow revealed under the sliding bubble. Pinned to the edge the
    // bubble moves away from and vertically centred; it starts under the bubble
    // and is uncovered as the drag opens a gap on that side.
    replyReveal: {
      position: 'absolute',
      top: 0,
      bottom: 0,
      justifyContent: 'center',
      alignItems: 'center',
    },
    replyRevealPeer: {
      left: TOKENS.space.xs,
    },
    replyRevealMine: {
      right: TOKENS.space.xs,
    },
    // Absolute wrapper that positions the Modal-hosted strip against the
    // measured bubble rect (see `placement`).
    stripAnchor: {
      position: 'absolute',
    },
    fill: {
      flex: 1,
    },
    /*
     * Inset from the IMAGE's edges, not the bubble's. 6dp keeps the chip clear of
     * the concentric corner radius at the size this box is clipped to; the frame
     * inset is already accounted for because this sits inside `mediaInner`.
     */
    mediaTime: {
      position: 'absolute',
      right: 6,
      bottom: 6,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: 'rgba(0,0,0,0.35)',
      borderRadius: TOKENS.radius.xs,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    myColumn: {
      width: '100%',
      alignItems: 'flex-end',
      gap: TOKENS.space['2xs'],
    },
    bubble: {
      maxWidth: '100%',
      paddingHorizontal: TOKENS.space.md,
      paddingTop: TOKENS.space.xs,
      paddingBottom: TOKENS.space.xs,
      backgroundColor: t.color.bg.accentStrong,
      borderRadius: BUBBLE_RADIUS,
      borderCurve: 'continuous',
    },
    // Not a spinner. The bubble is already on screen and will almost always
    // confirm; a spinner would promise more uncertainty than there is.
    pending: {
      opacity: 0.55,
    },
    // The photo bubble: a MEDIA_INSET frame in the speaker's colour, corner
    // concentric with the image inside it.
    mediaBubble: {
      /*
       * The frame owns the width; `mediaInner` fills it. `maxWidth: '100%'` so a
       * narrow screen shrinks the whole thing together instead of clipping the
       * picture out of a frame that stayed wide.
       */
      width: MEDIA_WIDTH + MEDIA_INSET * 2,
      maxWidth: '100%',
      padding: MEDIA_INSET,
      borderRadius: BUBBLE_RADIUS,
      borderCurve: 'continuous',
      overflow: 'hidden',
    },
    mediaFrameMine: {
      backgroundColor: t.color.bg.accentStrong,
    },
    mediaFramePeer: {
      backgroundColor: t.color.bg.sunken,
    },
    // The image area: a neutral loading fill under a concentric-radius clip, the
    // Image fills it once its source resolves.
    mediaInner: {
      width: '100%',
      borderRadius: mediaInnerRadius(),
      borderCurve: 'continuous',
      overflow: 'hidden',
      backgroundColor: t.color.bg.hover,
    },
    mediaImage: {
      width: '100%',
      height: '100%',
    },
    // The sending scrim: a dim wash so the picked photo shows through while it
    // uploads rather than the bubble reading as empty or broken.
    mediaLoading: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.28)',
    },
    // M3 linear determinate bar anchored to the bottom of the scrim.
    // Height 4dp (ProgressBar default). Sits above the scrim so it is always
    // readable; the scrim provides the dark background that white needs.
    mediaProgressBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 0,
    },
    myText: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.onAccent,
      flexShrink: 1,
    },
    textBody: {
      minWidth: 0,
      flexShrink: 1,
    },
    // Inline metadata row at the bottom-right of every text/voice bubble.
    // Both timestamp and (for outgoing) delivery tick sit here so they read as
    // one unit rather than two separate labels.
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-end',
      gap: TOKENS.space.hair,
      marginTop: -TOKENS.space.hair,
    },
    // The per-bubble clock inside metaRow. Same metrics as BubbleTime; peer sits
    // in tertiary, mine in muted white.
    inlineTimePeer: {
      ...TOKENS.typography.bodySmall,
      fontSize: 11,
      lineHeight: 16,
      color: t.color.text.tertiary,
    },
    inlineTimeOnAccent: {
      ...TOKENS.typography.bodySmall,
      fontSize: 11,
      lineHeight: 16,
      // Follows the bubble's paired on-colour. Dark mode uses a light coral
      // bubble with dark ink, so a hardcoded white timestamp disappeared.
      color: t.color.text.onAccent,
    },
    // Row inside the photo overlay: timestamp + tick side by side.
    quote: {
      borderLeftWidth: 2,
      paddingLeft: TOKENS.space.xs,
      marginBottom: TOKENS.space['2xs'],
      gap: 1,
    },
    quoteNeutral: {
      borderLeftColor: t.color.border.strong,
    },
    quoteOnAccent: {
      borderLeftColor: t.color.text.onAccent,
    },
    quoteAuthor: {
      ...TOKENS.typography.labelMediumEmphasized,
      color: t.color.text.secondary,
    },
    quoteBody: {
      ...TOKENS.typography.bodySmall,
      color: t.color.text.secondary,
    },
    quoteTextOnAccent: {
      color: t.color.text.onAccent,
    },
    reactionRow: {
      flexDirection: 'row',
      gap: TOKENS.space.hair,
    },
    reactionPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: TOKENS.space.hair,
      paddingHorizontal: 5,
      paddingVertical: TOKENS.space.hair,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      // bg.sunken (#E5E5EA light / #2C2C2E dark) is visible on the wallpaper.
      // The white surface token matches bg.base and is invisible in light mode;
      // contract.test.ts guards against that specific anti-pattern.
      backgroundColor: t.color.bg.sunken,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.hairline,
      shadowColor: '#000',
      shadowOpacity: 0.1,
      shadowRadius: 3,
      shadowOffset: { width: 0, height: 1 },
      elevation: 2,
    },
    // Your own reaction is marked by weight of border, not by colour: the accent
    // budget spends this file's allowance on the message bubble.
    reactionMine: {
      borderColor: t.color.border.strong,
    },
    reactionEmoji: {
      fontSize: 13,
      lineHeight: 16,
    },
    reactionCount: {
      ...TOKENS.typography.numeralSmall,
      color: t.color.text.secondary,
    },
  });
