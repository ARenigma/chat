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
  GestureDetector,
  GestureHandlerRootView,
  useExclusiveGestures,
  useLongPressGesture,
  usePanGesture,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import {
  bubbleArrive,
  bubbleLaunch,
  springTo,
  useAfterTransition,
} from '../theme/motion';
import { longPress as longPressHaptic, tick } from '../lib/haptics';
import type { ReactionEmoji } from '../lib/database.types';
import type { VoicePlayer } from '../lib/voice';
import { useAttachmentUrl } from '../api/attachments';
import { useStore } from '../store/useStore';
import { BubbleTime } from './BubbleTime';
import { Icon } from './Icon';
import { ProgressBar } from './ProgressBar';
import { ReactionStrip } from './ReactionStrip';
import { VoiceNote } from './VoiceNote';

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
/**
 * The bubble tail, 8x13dp.
 *
 * Straight from WhatsApp's own `tail-out.svg`, whose viewBox is "0 0 8 13" —
 * and the shape is confirmed on the Redmi: a wedge at the bubble's TOP corner,
 * widest at the top, tapering to a point 13dp below. Not the bottom corner,
 * which is where iMessage puts its tail and where most clones put theirs.
 *
 * DEPARTURE, stated because RULE 1 asks for it: WhatsApp's tail is a bezier
 * with a ~1.4px rounded tip; ours is a straight taper. It is drawn with the
 * border trick (a zero-size View with one coloured and one transparent border)
 * because `react-native-svg` is banned by RULE 5 — it throws
 * `synchronouslyUpdateUIProps` inside Reanimated views and kills touch on the
 * whole subtree, which is exactly the subtree a chat bubble lives in. At 8dp
 * the curvature is under a pixel of difference; the tip radius is not
 * reproducible this way and is the one visible compromise.
 */
export const TAIL_W = 8;
export const TAIL_H = 13;

export const MEDIA_INSET = 3;

/** Concentric with the bubble's corner: `inner = outer - inset`. */
export function mediaInnerRadius(): number {
  return BUBBLE_RADIUS - MEDIA_INSET;
}

/** The widest a photo bubble draws; height follows the image's own aspect. */
const MEDIA_WIDTH = 240;
const MEDIA_MIN_HEIGHT = 120;
const MEDIA_MAX_HEIGHT = 320;

/**
 * The one standard accessibility action a photo bubble offers.
 *
 * `'activate'` is "engaged when a screen reader user double taps the component"
 * (https://reactnative.dev/docs/accessibility), and it is how the photo becomes
 * openable at all with TalkBack on: the tap that opens the viewer for everyone
 * else is a native RNGH recogniser, which a screen reader cannot see.
 *
 * Hoisted to module scope so it is not a fresh array on every render of every
 * photo in the transcript.
 */
const ACTIVATE_ACTION = [{ name: 'activate' as const }];

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
  /**
   * Tapping a photo opens it full screen.
   *
   * The viewer itself is hosted by ChatScreen, not here: a Modal declared inside
   * a FlashList cell unmounts with the cell when the list recycles it, and the
   * transcript recycles while a paid session is delivering messages.
   */
  onOpenImage?: (image: ImageBody) => void;
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
  failed,
  onAccent,
}: {
  timestamp: string;
  receipt?: 'sent' | 'read';
  failed?: boolean;
  onAccent: boolean;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  /*
   * WhatsApp's own split (2026-09-08), and the split is the finding: only the
   * READ tick has a colour of its own. Sent and delivered have no token in
   * WhatsApp's design system at all — they inherit the bubble's deemphasized
   * content colour, which is the same value the timestamp uses. So "the grey
   * tick" is not a grey; it is the timestamp colour, and treating it as its own
   * hex is what produced the hardcoded rgba this replaces.
   *
   * One value per mode covers BOTH bubbles, so there is no longer an
   * `onAccent` branch here — the previous white-on-coral / dark-on-light-coral
   * fork existed only because the outgoing bubble was the accent.
   */
  const readColor = theme.color.bubble.tickRead;
  const sentColor = theme.color.bubble.meta;
  /*
   * White on the coral bubble rather than the danger red: `danger` against
   * `accentStrong` is red on coral, which is both unreadable and reads as
   * decoration. On the bubble the MARK carries the meaning and full-strength
   * white is what makes it legible; off the bubble, danger is correct.
   */
  // Danger red on both bubbles now: the outgoing fill is pale in light and deep
  // in dark, and `state/danger` is authored per mode to sit on either.
  const failColor = theme.color.state.danger;
  return (
    <View style={styles.metaRow}>
      <Text
        allowFontScaling={false}
        numberOfLines={1}
        style={onAccent ? styles.inlineTimeOnAccent : styles.inlineTimePeer}>
        {timestamp}
      </Text>
      {/*
        * A failed send shows a warning mark INSTEAD of a tick, never both. A
        * check next to "not sent" is the single most misleading thing this
        * bubble could say.
        */}
      {failed === true ? (
        /*
         * `close`, not a dedicated warning glyph, and that is a deliberate
         * stop rather than a shortcut: this icon set has 48 glyphs and none of
         * them is an alert. Adding one means editing `design/icons.json` and
         * regenerating (RULE 4), and WHICH warning mark the brand uses —
         * exclamation in a circle, triangle, filled or outlined — is a creative
         * decision that belongs to Amit, not one to make silently mid-refactor
         * (CLAUDE.md, structural vs creative). An X beside a timestamp is
         * unambiguously "did not send" in the meantime.
         */
        <Icon name="close" size={TOKENS.icon.xs} color={failColor} />
      ) : receipt !== undefined ? (
        <Icon
          name={receipt === 'read' ? 'checkCheck' : 'check'}
          size={TOKENS.icon.xs}
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
  failed,
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
  failed?: boolean;
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
          <MetaRow timestamp={timestamp} receipt={receipt} failed={failed} onAccent={onAccent} />
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
        <MetaRow timestamp={timestamp} receipt={receipt} failed={failed} onAccent={onAccent} />
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
  onTap,
}: {
  image: ImageBody;
  onAccent: boolean;
  pending: boolean;
  /** Rendered INSIDE the image box. See `mediaTime`. */
  timestamp?: string;
  receipt?: 'sent' | 'read';
  /**
   * Open the photo full screen. Taken here ONLY for the screen-reader path: the
   * pointer gesture that does the same thing lives on `InteractiveBubble`, and
   * TalkBack cannot see an RNGH recogniser.
   */
  onTap?: () => void;
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
  const afterTransition = useAfterTransition();

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
        {/* Held back until the screen transition settles.
            A photo decode is the most expensive thing a bubble does, and it was
            landing inside the push animation — measured on the S22 at 60Hz, a
            push/pop ran a 15.40ms median frame against Telegram's 7.55ms.
            The grey placeholder underneath is not a compromise invented for
            this: it is the state a photo already shows while its signed URL is
            resolving, so holding the Image back for a few frames reuses a
            designed appearance rather than inventing an empty one.
            `useAfterTransition` falls back to an idle callback, so a photo can
            never be stranded by a lock that fails to lower. */}
        {uri !== undefined && afterTransition ? (
          <Image
            testID="bubble-image"
            source={{ uri }}
            style={styles.mediaImage}
            resizeMode="cover"
            /* The photo is now openable, so it declares itself a control and
               offers the standard `activate` action TalkBack raises on a double
               tap. `imagebutton` is "used when the element should be treated as
               a button and is also an image".
               https://reactnative.dev/docs/accessibility
               Deliberately NOT on the InteractiveBubble wrapper: an
               accessibilityLabel there REPLACES the concatenated child text and
               made the whole transcript unreadable once before
               (platform.test.ts pins that rule). */
            accessible
            accessibilityRole="imagebutton"
            accessibilityActions={ACTIVATE_ACTION}
            onAccessibilityAction={onTap}
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
        {pending || uri === undefined || !afterTransition ? (
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
                size={TOKENS.icon.xs}
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
  /** Draw the mirrored tail. First bubble of a run — see MineProps.tail. */
  tail?: boolean;
  message: string;
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
 * Both sides are `maxWidth: '80%'` now, and as of the avatar removal below that
 * is finally TRUE rather than merely written down. They disagreed twice: first
 * the peer column was width-limited by a `paddingRight` and mine by a percentage
 * (274pt against 262pt on a 360pt screen), and then both read `'80%'` while the
 * peer's 80% was taken of a column already 34dp narrower than mine.
 *
 * THE IN-TRANSCRIPT AVATAR IS GONE, and this is the third reversal in this file.
 *
 * It was a 26dp `slot` plus `peerRow`'s `space.xs` gap, so an incoming bubble's
 * left edge sat at 16 + 26 + 8 = 50dp while the composer capsule's left edge and
 * the outgoing bubble's right edge both sat 16dp from their side. One grid on one
 * edge and a different grid on the other is the thing this file and
 * `Composer.tsx`'s CAPSULE_MIN_H are jointly about; `chatSurface.test.ts` could
 * only ever assert the outgoing half of it because the incoming half was wrong.
 *
 * Amit, asked directly and answering directly: "Remove it, align the grid."
 * The supporting facts, all checkable: this app is exclusively 1:1, so an avatar
 * in the transcript identifies nobody — Telegram shows none in a 1:1 thread,
 * which is exactly why its input bar traces its bubble grid; and the chat header
 * already carries the peer's photo, name and presence (`ChatScreen`'s identity
 * block, 30dp `Avatar` + `HeaderSubtitle`), so nothing is lost, only repeated.
 *
 * What that removes with it: `AVATAR_SLOT`, the `slot` spacer, the `initial` and
 * `avatarUri` props, the `first` prop, `peerColumn`, and `peerRow`'s row
 * direction and gap. `peerRow` is now the mirror of `myColumn` — full width,
 * `2xs` gap, aligned to its own side — which is the symmetry the paragraphs above
 * argue for, expressed in the layout instead of asserted in a comment.
 *
 * `first` still exists in `ChatScreen`, where it drives `turnOpensGroup`'s larger
 * top padding. Grouping survives the avatar; it was never the avatar's job.
 */
function PeerTurnView({
  message,
  timestamp,
  tail,
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
  onOpenImage,
}: PeerProps) {
  const styles = useStyles(makeStyles);
  const target = useMemo<ActionTarget | null>(
    () =>
      messageId !== undefined
        ? { id: messageId, mine: false, author: author ?? '', body: rawBody ?? null }
        : null,
    [messageId, author, rawBody],
  );
  // Built here rather than inline in the JSX so the bubble's `memo` still holds:
  // `image` has a stable identity from ChatScreen's `rows` memo and
  // `onOpenImage` is a stable useCallback, so this closure is stable too.
  const openImage = useCallback(() => {
    if (image !== undefined) {
      onOpenImage?.(image);
    }
  }, [image, onOpenImage]);
  return (
    <Animated.View
      entering={animate === true ? bubbleArrive : undefined}
      style={styles.peerRow}
    >
      <View
        style={[
          styles.bubbleStack,
          reactions && reactions.length > 0 ? styles.bubbleStackWithReaction : null,
        ]}>
        {/*
          * The tail sits in the STACK, not inside the bubble, so the bubble's
          * own clipping cannot cut it off and it costs the text box no width.
          * `pointerEvents="none"` because it is decoration — a tap near it must
          * reach the bubble's own target, not a triangle.
          */}
        {tail === true ? (
          <View style={styles.tailPeer} pointerEvents="none" testID="bubble-tail-peer" />
        ) : null}
        <InteractiveBubble
          mine={false}
          target={target}
          bubbleStyle={[styles.peerBubble, tail === true && styles.tailCornerPeer]}
          media={image !== undefined}
          onTap={image !== undefined ? openImage : undefined}
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
              onTap={openImage}
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
  /**
   * Draw the tail. True for the FIRST bubble of a run from this sender, which
   * is where WhatsApp puts it — subsequent bubbles in a run have all four
   * corners rounded and no tail.
   */
  tail?: boolean;
  /**
   * The send failed and this bubble is saying so instead of disappearing.
   *
   * Telegram's `MESSAGE_SEND_STATE_SEND_ERROR` (MessageObject.java:135). The
   * bubble stays exactly where it was written, so the member can see what they
   * said and act on it, rather than watching their words vanish and having to
   * remember them.
   */
  failed?: boolean;
  /**
   * Tap the failed bubble to send it again. Undefined when a retry cannot
   * honestly be offered — a media send whose local file may be gone.
   */
  onRetry?: () => void;
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
  tail,
  failed,
  onRetry,
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
  onOpenImage,
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
  // See the twin in PeerTurnView: stable identity, so `memo` still holds.
  const openImage = useCallback(() => {
    if (image !== undefined) {
      onOpenImage?.(image);
    }
  }, [image, onOpenImage]);
  return (
    <Animated.View entering={isNew === true ? bubbleLaunch : undefined} style={styles.myColumn}>
      <View
        style={[
          styles.bubbleStack,
          styles.bubbleStackEnd,
          reactions && reactions.length > 0 ? styles.bubbleStackWithReaction : null,
        ]}>
        {/*
          * In the STACK, not inside the bubble: the bubble clips its own
          * overflow for media, and the stack is `overflow: visible`.
          * `pointerEvents="none"` — decoration must not steal a tap from the
          * bubble's target.
          */}
        {tail === true ? (
          <View style={styles.tailMine} pointerEvents="none" testID="bubble-tail-mine" />
        ) : null}
        <InteractiveBubble
          mine
          target={target}
          bubbleStyle={[
            styles.bubble,
            pending === true && styles.pending,
            tail === true && styles.tailCornerMine,
          ]}
          media={image !== undefined}
          /*
           * A failed bubble is a retry button. `onRetry` wins over `openImage`
           * because a media send that did not land has nothing to open — the
           * bubble is showing a local pick, and tapping it should send it, not
           * enlarge it.
           */
          onTap={
            failed === true && onRetry !== undefined
              ? onRetry
              : image !== undefined
                ? openImage
                : undefined
          }
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
              onTap={openImage}
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
                failed={failed}
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

/**
 * The drag that ACTIVATES a swipe-reply, and the ceiling on how far a TAP may
 * travel and still count.
 *
 * One number with two consumers on purpose. Under it the pan cannot have
 * activated, so a drag that quotes a message can never also open the photo
 * viewer; over it the finger was never tapping. Two independently-chosen numbers
 * would leave a band where both gestures are true at once.
 */
const REPLY_ACTIVATE = 16;

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
  onTap,
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
  /** Set on a photo bubble: a tap opens the full-screen viewer. */
  onTap?: () => void;
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

  /*
   * Swipe-to-reply. `.activeOffsetX([...])`/`.failOffsetY([...])` became config
   * keys with the same names and the same array shape when the builder was
   * deprecated in RNGH 3 — the guide's rule is that modifiers move into the
   * config object verbatim, and the three renamed callbacks are `onStart` ->
   * `onActivate`, `onEnd` -> `onDeactivate`, `onTouchesCancelled` ->
   * `onTouchesCancel`.
   * https://docs.swmansion.com/react-native-gesture-handler/docs/guides/upgrading-to-3/
   * https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/use-pan-gesture
   */
  const pan = usePanGesture({
    activeOffsetX: [-REPLY_ACTIVATE, REPLY_ACTIVATE],
    failOffsetY: [-12, 12],
    onUpdate: e => {
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
    },
    onDeactivate: () => {
      if (Math.abs(tx.value) >= REPLY_TRIGGER) {
        runOnJS(triggerReply)();
      }
      tx.value = springTo(0, 'smooth');
      crossed.value = false;
    },
  });

  /*
   * The long-press reaction strip, and the tap that opens a photo.
   *
   * Both are declared unconditionally and switched with `enabled`, which is the
   * one structural change this migration makes and is stated here per RULE 1.
   * The builder let the composition be assembled by a ternary chain, because
   * `Gesture.LongPress()` was a plain constructor; `useLongPressGesture` is a
   * hook, so it and `useTapGesture` run on every render whatever the props are,
   * and their native handlers are created either way
   * (`useGesture` calls `NativeProxy.createGestureHandler` in an effect keyed
   * only on the handler tag). Selecting a subtree afterwards would therefore
   * save nothing and would make the composed tree's SHAPE depend on props.
   *
   * `enabled: false` is equivalent to leaving the gesture out, and on Android
   * that is decidable rather than hopeful: `recordViewHandlersForPointer` skips
   * a handler when `!handler.isEnabled` before it is ever added to the
   * orchestrator's list, and `hasOtherHandlerToWaitFor` only looks at handlers
   * in that list — so a disabled long press cannot strand the tap that waits for
   * it (android/.../core/GestureHandlerOrchestrator.kt).
   *
   * The `target === null` case this covers: an outgoing photo that is still
   * uploading has no action target and therefore no long press, and it must
   * still open from its local file.
   */
  const longPress = useLongPressGesture({
    enabled: target !== null,
    // The Android system long-press timeout, which is what Telegram opens the
    // reaction menu on (ReactionsContainerLayout.java:2262). Was 400ms.
    minDuration: 500,
    onActivate: () => {
      runOnJS(longPressHaptic)();
      runOnJS(openStrip)();
    },
  });

  /*
   * Tap opens the photo. Two bounds, and both are load-bearing.
   *
   * EXCLUSIVE with the long press, in that order. RNGH: "Only one of the
   * provided gestures can become active. Priority is determined by the order of
   * the arguments, where the first gesture has the highest priority, and the
   * last has the lowest", and "A gesture can activate only after all
   * higher-priority gestures before it have failed". So a 500ms hold opens the
   * reaction strip and does NOT also open the viewer when the finger lifts.
   * Simultaneous would do exactly that, because RNGH's Android tap defaults to
   * `DEFAULT_MAX_DURATION_MS: Long = 500` (TapGestureHandler.kt) - the same 500
   * the strip is built on, so the two would resolve together on every hold.
   * https://docs.swmansion.com/react-native-gesture-handler/docs/composition/use-exclusive-gestures
   *
   * `maxDistance: REPLY_ACTIVATE` is the pan's own activation offset. RNGH's
   * Android tap has NO distance limit by default (`maxDist = MAX_VALUE_IGNORE`,
   * TapGestureHandler.kt), and `pan` runs simultaneously rather than competing,
   * so without this bound a completed swipe-to-reply would ALSO register as a
   * tap and open the viewer on top of the quote it just made.
   * https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/use-tap-gesture
   */
  const openViewer = onTap;
  const tap = useTapGesture({
    enabled: openViewer !== undefined,
    maxDistance: REPLY_ACTIVATE,
    onDeactivate: e => {
      // `!e.canceled` is the old `onEnd`'s `success`: "the logic is inverted —
      // `canceled: true` corresponds to the old `success: false`"
      // (docs/guides/upgrading-to-3/).
      if (!e.canceled && openViewer !== undefined) {
        runOnJS(openViewer)();
      }
    },
  });

  /*
   * The nesting is supported and deliberate. `traverseAndConfigureRelations`
   * seeds the live simultaneous set from the root Simultaneous node's tags, then
   * DELETES a non-simultaneous child's tags on the way into it — so descending
   * into the exclusive pair leaves only `pan` in the set. The drag ends up
   * simultaneous with both discretes, while the tap keeps the long press in its
   * `waitFor` and cannot activate until the hold has failed
   * (v3/detectors/utils.ts).
   */
  const discrete = useExclusiveGestures(longPress, tap);
  const composed = useSimultaneousGestures(pan, discrete);
  /*
   * Truthy iff the long-press strip is available — used for the accessibility
   * hint below rather than for a LABEL, because a label here replaces the
   * concatenated child text and made the whole transcript unreadable once.
   *
   * ------------------------------------------------------------------------
   * AUDIT NOTE (2026-09-07), recorded because a claim about it was checked and
   * found wrong, and because what IS wrong is worth knowing.
   * ------------------------------------------------------------------------
   * The claim: "the TalkBack `activate` path on the photo may be unreachable on
   * API 24-25 because this wrapper already carries an accessibilityHint, and
   * minSdk is 24." It is not. Read in RN 0.86:
   *
   *   - `ReactAccessibilityDelegate.setDelegate` installs its delegate only when
   *     the view has an `accessibility_role`, `accessibility_state`,
   *     `accessibility_actions`, `react_test_id`, `accessibility_collection_item`,
   *     `accessibility_links` or `role` tag. `accessibility_hint` is NOT in that
   *     list, and this Animated.View has none of the others.
   *   - Even with a delegate, the hint maps to `info.tooltipText` and nothing
   *     else, and `hasContentToAnnounce` (the condition that synthesises
   *     `info.contentDescription = getTalkbackDescription(host, info)`) does not
   *     include the hint.
   *
   * So this wrapper is not an accessibility node, does not set a
   * contentDescription, and does not hide its descendants on ANY API level. The
   * photo's own `accessibilityRole="imagebutton"` + `accessibilityActions` node
   * inside MediaBubble keeps its focus and its `activate` action from 24 up.
   *
   * What the reading DID turn up: because no delegate is installed here, this
   * hint is inert on every API level — "Long press for message actions" is never
   * announced. Fixing that means making the bubble wrapper an accessibility node
   * (an `accessibilityActions` entry is the cheapest tag that installs the
   * delegate), which collapses the bubble into one TalkBack node and would take
   * the photo's own `activate` node with it. That is a transcript-wide
   * accessibility change, not a nit, and it is deliberately NOT made here.
   */
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
          <Icon name="reply" size={TOKENS.icon.md} color={theme.color.text.secondary} />
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
    /*
     * The incoming column, and the exact mirror of `myColumn` below.
     *
     * It was `flexDirection: 'row'` with a 26dp avatar `slot` and a `space.xs`
     * gap in front of the bubble, which pushed an incoming bubble's left edge to
     * 16 + 26 + 8 = 50dp against the composer capsule's 16dp. With the avatar
     * gone (see PeerTurnView) there is one child, so there is no row: full width,
     * aligned to the leading edge, `2xs` between the bubble and its reaction
     * chip. `bubbleStack`'s `maxWidth: '80%'` is now taken of the SAME width the
     * outgoing side measures against, which is what makes the two `'80%'`s equal.
     */
    peerRow: {
      width: '100%',
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
      /*
       * From the WhatsApp APK, and only the parts that survived verification.
       *
       * message_text carries paddingLeft 8 / paddingTop 2 / paddingRight 8 /
       * paddingBottom 3, and a parent two elements up adds a further 2dp on the
       * right and bottom — which the first research pass missed and attributed
       * to a programmatic background. So the effective inset is 8/2/10/5, and
       * implementing the un-corrected 8/3 would put the text 2dp too close to
       * the right and bottom edges.
       *
       * Deliberately NOT space tokens: 2, 5 and 10 are not on the 4dp scale,
       * and rounding them to it would silently discard the measurement. The
       * `$bubbleNote` in design/tokens.json argues the same for the radius,
       * which is why the radius here is still OURS (22) and not a guess at
       * WhatsApp's.
       *
       * min-height 30dp is the one clean token: layout.bubbleMinHeight, read
       * from eleven of thirteen conversation-row layouts and reproduced by an
       * adversarial second pull of the APK.
       */
      minHeight: TOKENS.layout.bubbleMinHeight,
      justifyContent: 'center',
      paddingLeft: 8,
      paddingTop: 2,
      paddingRight: 10,
      paddingBottom: 5,
      backgroundColor: t.color.bubble.theirs,
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
      /*
       * WhatsApp's outgoing fill (2026-09-08), not the accent any more.
       *
       * The change is not a hue swap: `bg/accentStrong` was a DEEP colour under
       * white text, and `bubble/mine` is a PALE green under near-black text in
       * light mode. Anything drawing inside this bubble must read `bubble/text`
       * and `bubble/meta` rather than assume white — which is why the metadata
       * colours below stopped being hardcoded rgba.
       */
      backgroundColor: t.color.bubble.mine,
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
    /*
     * The media frame IS the bubble, so it takes the bubble tokens.
     *
     * These were `bg/accentStrong` and `bg/sunken` — correct while the text
     * bubble used those same two tokens. After the WhatsApp change the text
     * bubble moved to `bubble/mine` (#D9FDD3, pale) and these did not, so a
     * photo I sent got a heavy dark-green frame while my words got a pale one.
     * Caught by looking at the Redmi, not by a test: both values are valid
     * colours from the palette, so nothing could fail.
     */
    /*
     * The tail wedges. `borderTopWidth` carries the fill and the side border is
     * transparent, which renders a right triangle: flat along the top, vertical
     * against the bubble, point at the bottom. Mirrored per side.
     *
     * Positioned OUTSIDE the bubble (negative offset) so it does not eat into
     * the text box, and the bubble must therefore not clip its overflow.
     */
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
    /*
     * The tail-side corner squares off when a tail is present — measured at
     * ~1dp on WhatsApp against 9dp on the other three. Without this the tail
     * appears to float away from a rounded corner instead of growing out of it.
     */
    tailCornerMine: { borderTopRightRadius: 1 },
    tailCornerPeer: { borderTopLeftRadius: 1 },
    mediaFrameMine: {
      backgroundColor: t.color.bubble.mine,
    },
    mediaFramePeer: {
      backgroundColor: t.color.bubble.theirs,
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
      color: t.color.bubble.text,
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
      /*
       * `bubble/meta`, the same token the sent/delivered tick uses — because in
       * WhatsApp they ARE the same value (the tick has no colour of its own).
       * Previously `text/onAccent`, which was right only while the bubble was
       * the accent fill.
       */
      color: t.color.bubble.meta,
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
