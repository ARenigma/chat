import React, { memo } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from 'react-native';
import Animated from 'react-native-reanimated';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { bubbleArrive, bubbleLaunch } from '../theme/motion';
import type { ReactionEmoji } from '../lib/database.types';
import type { VoicePlayer } from '../lib/voice';
import { useAttachmentUrl } from '../api/attachments';
import { Avatar } from './Avatar';
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
 * A voice note's payload, built in the transcript memo so its identity is stable
 * and the bubble's `memo` still does its job.
 */
export interface VoiceBody {
  messageId: string;
  path: string;
  durationMs: number;
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
   * Opens the actions sheet. On both sides now: you could not act on your own
   * message at all before, which made Reply a one-way affordance.
   */
  onLongPress?: () => void;
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
}: {
  message: string;
  voice: VoiceBody | undefined;
  voicePlayer: VoicePlayer | undefined;
  pending: boolean;
  onAccent: boolean;
  textStyle: StyleProp<TextStyle>;
  testID: string;
}) {
  if (voice !== undefined && voicePlayer !== undefined) {
    return (
      <VoiceNote
        messageId={voice.messageId}
        path={voice.path}
        durationMs={voice.durationMs}
        onAccent={onAccent}
        pending={pending}
        onToggle={voicePlayer.toggle}
        onCycleSpeed={voicePlayer.cycleSpeed}
        speed={voicePlayer.speed}
      />
    );
  }
  return (
    <Text testID={testID} allowFontScaling style={textStyle}>
      {message}
    </Text>
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
}: {
  image: ImageBody;
  onAccent: boolean;
  pending: boolean;
}) {
  const styles = useStyles(makeStyles);
  const { data: signedUrl } = useAttachmentUrl(image.localUri ? null : image.path);
  const uri = image.localUri ?? signedUrl;
  const ratio = image.width / image.height;
  const height = Math.max(
    MEDIA_MIN_HEIGHT,
    Math.min(MEDIA_MAX_HEIGHT, Math.round(MEDIA_WIDTH / ratio)),
  );
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
      <View style={[styles.mediaInner, { width: MEDIA_WIDTH, height }]}>
        {uri !== undefined ? (
          <Image
            testID="bubble-image"
            source={{ uri }}
            style={styles.mediaImage}
            resizeMode="cover"
            accessibilityLabel="Photo"
          />
        ) : null}
        {/* Sending, or still minting the URL: a scrim + spinner over the pick,
            WhatsApp-style, so the bubble never sits as an empty coral frame while
            bytes are in flight. */}
        {pending || uri === undefined ? (
          <View style={styles.mediaLoading}>
            <ActivityIndicator color="#FFFFFF" />
          </View>
        ) : null}
      </View>
    </View>
  );
}

interface PeerProps extends Shared {
  message: string;
  initial: string;
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
 * `bg/raised` is `#FFFFFF` in light mode, identical to `bg/base`, so an incoming
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
  first,
  timestamp,
  animate,
  quote,
  reactions,
  voice,
  image,
  voicePlayer,
  onLongPress,
}: PeerProps) {
  const styles = useStyles(makeStyles);
  return (
    <Animated.View
      entering={animate === true ? bubbleArrive : undefined}
      style={styles.peerRow}
    >
      <View style={styles.slot}>
        {first ? <Avatar initial={initial} size={26} /> : null}
      </View>
      <View style={styles.peerColumn}>
        {/* Time above the message (#7, Amit): the stamp leads the group's last
            bubble rather than trailing under it. */}
        {timestamp ? <Text style={styles.stamp}>{timestamp}</Text> : null}
        {/* A plain RN Pressable, not the animated one: a scale spring on a
            long-press over body text reads as an accident, and this must not
            look like a tap target during normal reading. */}
        <Pressable
          onLongPress={onLongPress}
          delayLongPress={450}
          /*
           * `accessibilityHint`, not `accessibilityLabel`. An explicit label
           * REPLACES the concatenated child text for TalkBack, so setting it
           * here made every bubble announce "Long press for message actions"
           * while the message body — the whole product — went unread by a
           * screen reader. A hint appends on Android: TalkBack reads the message,
           * then offers the action. Undefined without a long-press so a pending
           * bubble carries no dangling hint.
           */
          accessibilityHint={
            onLongPress ? 'Long press for message actions' : undefined
          }
        >
          {image !== undefined ? (
            <MediaBubble image={image} onAccent={false} pending={false} />
          ) : (
            <View style={styles.peerBubble}>
              {quote ? <QuoteBlock quote={quote} onAccent={false} /> : null}
              <Body
                message={message}
                voice={voice}
                voicePlayer={voicePlayer}
                pending={false}
                onAccent={false}
                textStyle={styles.peerText}
                testID="bubble-peer"
              />
            </View>
          )}
        </Pressable>
        {reactions && reactions.length > 0 ? (
          <ReactionRow reactions={reactions} testID="reactions-peer" />
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
   * Receipt state, rendered only on the newest message this session sent,
   * repeating it on every bubble is noise, and the newest one answers the
   * question the others would.
   */
  receipt?: 'sent' | 'read';
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
  onLongPress,
}: MineProps) {
  const styles = useStyles(makeStyles);
  return (
    <Animated.View entering={bubbleLaunch} style={styles.myColumn}>
      {/* Time above the message (#7, Amit). The receipt ("Sent"/"Read") still
          trails below, where iOS keeps it. */}
      {timestamp !== undefined ? (
        <Text style={styles.stamp}>{timestamp}</Text>
      ) : null}
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={450}
        /*
         * `accessibilityHint`, not `accessibilityLabel`. An explicit label
         * REPLACES the concatenated child text for TalkBack, so setting it
         * here made every bubble announce "Long press for message actions"
         * while the message body — the whole product — went unread by a
         * screen reader. A hint appends on Android: TalkBack reads the message,
         * then offers the action. Undefined without a long-press so a pending
         * bubble carries no dangling hint.
         */
        accessibilityHint={
          onLongPress ? 'Long press for message actions' : undefined
        }
      >
        {image !== undefined ? (
          <MediaBubble image={image} onAccent pending={pending === true} />
        ) : (
          <View style={[styles.bubble, pending === true && styles.pending]}>
            {quote ? <QuoteBlock quote={quote} onAccent /> : null}
            <Body
              message={message}
              voice={voice}
              voicePlayer={voicePlayer}
              pending={pending === true}
              onAccent
              textStyle={styles.myText}
              testID="bubble-mine"
            />
          </View>
        )}
      </Pressable>
      {reactions && reactions.length > 0 ? (
        <ReactionRow reactions={reactions} testID="reactions-mine" />
      ) : null}
      {receipt !== undefined ? (
        <Text
          testID="read-receipt"
          style={[styles.stamp, receipt === 'read' && styles.receiptRead]}
        >
          {receipt === 'read' ? 'Read' : 'Sent'}
        </Text>
      ) : null}
    </Animated.View>
  );
}

export const MyTurn = memo(MyTurnView);

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
 * Applied reactions, under the bubble rather than overlapping its corner.
 *
 * Overlapping is what iOS does and it needs negative margin plus a z-order on a
 * row inside an inverted windowed list, which is where clipping bugs live. Under
 * the bubble costs one line of height and nothing else.
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
    peerBubble: {
      maxWidth: '80%',
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: 10,
      backgroundColor: t.color.bg.sunken,
      borderRadius: BUBBLE_RADIUS,
      borderCurve: 'continuous',
    },
    peerText: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.primary,
    },
    myColumn: {
      alignItems: 'flex-end',
      gap: TOKENS.space['2xs'],
    },
    bubble: {
      maxWidth: '80%',
      paddingHorizontal: TOKENS.space.md,
      paddingVertical: 10,
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
      maxWidth: '80%',
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
      borderRadius: mediaInnerRadius(),
      borderCurve: 'continuous',
      overflow: 'hidden',
      backgroundColor: t.color.bg.hover,
    },
    mediaImage: {
      width: '100%',
      height: '100%',
    },
    // The sending scrim: a dim wash under a spinner, so the picked photo shows
    // through while it uploads rather than the bubble reading as empty or broken.
    mediaLoading: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.28)',
    },
    myText: {
      ...TOKENS.typography.bodyLarge,
      color: t.color.text.onAccent,
    },
    // Tertiary rather than secondary: a per-bubble timestamp is glanceable
    // metadata, and iOS sets it in tertiaryLabel.
    stamp: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.tertiary,
    },
    receiptRead: {
      ...TOKENS.typography.labelSmall,
    },
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
      ...TOKENS.typography.labelSmall,
      color: t.color.text.secondary,
    },
    quoteBody: {
      ...TOKENS.typography.captionSmall,
      color: t.color.text.secondary,
    },
    quoteTextOnAccent: {
      color: t.color.text.onAccent,
    },
    reactionRow: {
      flexDirection: 'row',
      gap: TOKENS.space['2xs'],
    },
    reactionPill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 2,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: TOKENS.radius.pill,
      borderCurve: 'continuous',
      backgroundColor: t.color.bg.sunken,
    },
    // Your own reaction is marked by weight of border, not by colour: the accent
    // budget spends this file's allowance on the message bubble.
    reactionMine: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: t.color.border.strong,
    },
    reactionEmoji: {
      fontSize: 12,
      lineHeight: 16,
    },
    reactionCount: {
      ...TOKENS.typography.numeralSmall,
      color: t.color.text.secondary,
    },
  });
