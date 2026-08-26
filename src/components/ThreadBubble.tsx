import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { Avatar } from './Avatar';
import { Pressable } from './Pressable';

/** The avatar in a thread bubble. Exported because the bubble's height derives from it. */
export const BUBBLE_AVATAR = 48;

/**
 * `48 + 12 + 12 = 72`, and the arithmetic is the point.
 *
 * The bubble is exactly its own padding plus its avatar, so the avatar is what
 * sets the height and the two text lines have to fit inside what it leaves. That
 * is why the preview stays one line: a second line would make the text taller
 * than the avatar and every bubble in the list would start disagreeing about its
 * own height.
 */
export const BUBBLE_HEIGHT = BUBBLE_AVATAR + TOKENS.space.sm * 2;

interface Props {
  name: string;
  initial: string;
  /** Already resolved by the caller: a preview, a voice-note label, or a prompt. */
  preview: string;
  /** Already formatted. `New` for somebody you have not spoken to yet. */
  stamp: string;
  /** Zero means no badge. */
  unreadCount: number;
  online: boolean;
  blocked: boolean;
  onPress: () => void;
  accessibilityLabel: string;
  testID?: string;
  /**
   * Named by the caller rather than derived from `testID`.
   *
   * Deriving it looked tidier and silently broke the contract a test already
   * held: the marker has been `thread-blocked-<peerId>` since blocking shipped,
   * and `${testID}-blocked` produces `thread-<peerId>-blocked` instead. The screen
   * owns these names, so the screen passes them.
   */
  blockedTestID?: string;
}

/**
 * A conversation in the Chats list, as a bubble.
 *
 * **Why bubbles here and flat rows in Explore.** They are answering different
 * questions and the two idioms now each have a reason rather than a preference.
 * Chats is a list of *conversations*, and a conversation is already drawn as a
 * bubble one screen deeper, so the inbox is a stack of the same objects seen from
 * further away. Explore is a list of *people*, which is a directory, and a
 * directory is a table: flat rows on the page with an inset hairline, the way iOS
 * Contacts does it. This partially overrides the settled line in
 * `design/references/README.md` that "rows are flat with inset hairlines", and it
 * overrides it deliberately: that line still holds everywhere except here.
 *
 * **No separators, and that is the whole point of bubbles.** The 8pt gap between
 * bubbles is the separation. Adding a hairline as well would be saying it twice,
 * and it is what made an earlier version of this list read as rows wearing
 * rounded corners.
 *
 * **`bg/sunken` and not `bg/raised`.** `bg/raised` is `#FFFFFF` in light mode and
 * so is `bg/base`, so a bubble on `bg/raised` would be invisible against the
 * page. This is the single most repeated bug in this codebase's history: it is
 * exactly what made the incoming message bubble disappear once already. Read the
 * token note before changing a fill here.
 *
 * **`press="card"`, not the `ios` cell flash.** The flat row used the iOS model
 * because a table cell is a table cell: the whole cell fills with `bg/selected`
 * under a finger. A bubble is a card, so it takes the Material model this app
 * already uses for cards, a small scale with a state layer clipped to the
 * bubble's own radius. Filling a rounded card edge to edge reads as the card
 * being replaced rather than pressed.
 */
function ThreadBubbleView({
  name,
  initial,
  preview,
  stamp,
  unreadCount,
  online,
  blocked,
  onPress,
  accessibilityLabel,
  testID,
  blockedTestID,
}: Props) {
  const styles = useStyles(makeStyles);
  const unread = unreadCount > 0;

  return (
    <Pressable
      onPress={onPress}
      testID={testID}
      accessibilityLabel={accessibilityLabel}
      press="card"
      style={styles.bubble}>
      {/* Presence is meaningless for someone who cannot reach you, and a green
          dot on a blocked thread reads as the block having lapsed. */}
      <Avatar
        initial={initial}
        size={BUBBLE_AVATAR}
        online={!blocked && online}
        // The dot's ring has to be painted in the bubble's fill, not the page's,
        // or it cuts a white hole in the corner of the bubble.
        surface="sunken"
      />
      <View style={styles.body}>
        <View style={styles.topLine}>
          <Text allowFontScaling numberOfLines={1} style={styles.name}>
            {name}
          </Text>
          <Text allowFontScaling style={styles.stamp}>
            {stamp}
          </Text>
        </View>
        <View style={styles.bottomLine}>
          {blocked ? (
            <View testID={blockedTestID} style={styles.blocked}>
              <Text allowFontScaling style={styles.blockedLabel}>
                Blocked
              </Text>
            </View>
          ) : null}
          {/* The unread count stays, blocked or not. Those messages arrived
              before the block and are still unread, and hiding the badge would
              also contradict the total in the header. */}
          <Text
            allowFontScaling
            numberOfLines={1}
            style={[styles.preview, unread && styles.previewUnread]}>
            {preview}
          </Text>
          {unread ? (
            <View testID="unread-dot" style={styles.unread}>
              <Text allowFontScaling style={styles.unreadCount}>
                {unreadCount}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
}

export const ThreadBubble = memo(ThreadBubbleView);

const makeStyles = (t: Theme) => StyleSheet.create({
  bubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.sm,
    padding: TOKENS.space.sm,
    marginHorizontal: TOKENS.space.md,
    // Half the 8pt inter-bubble gap on each bubble, so the first and last get the
    // same breathing room as the ones in the middle without the list needing to
    // know which is which.
    marginVertical: TOKENS.space['2xs'],
    borderRadius: TOKENS.radius.thread,
    // iOS-only and a no-op on Android, but it costs nothing and it is what makes
    // a 24pt corner a squircle rather than a circular arc.
    borderCurve: 'continuous',
    backgroundColor: t.color.bg.sunken,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  topLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
  },
  bottomLine: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: TOKENS.space.xs,
  },
  name: {
    ...TOKENS.typography.headline,
    color: t.color.text.primary,
    flex: 1,
  },
  stamp: {
    ...TOKENS.typography.subhead,
    color: t.color.text.tertiary,
  },
  preview: {
    ...TOKENS.typography.subhead,
    color: t.color.text.secondary,
    flex: 1,
  },
  previewUnread: {
    color: t.color.text.primary,
  },
  // Neutral, not the accent coral. Blocked is a state the member chose, not a
  // warning, and it should not compete with the unread badge beside it.
  blocked: {
    paddingHorizontal: TOKENS.space['2xs'],
    paddingVertical: 1,
    borderRadius: TOKENS.radius.sm,
    // On `bg/sunken` the old `bg/sunken` fill would have been invisible, so the
    // chip takes the page colour instead: it is a hole in the bubble rather than
    // a raised pill on it.
    backgroundColor: t.color.bg.base,
  },
  blockedLabel: {
    ...TOKENS.typography.captionSmall,
    color: t.color.text.tertiary,
  },
  unread: {
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: TOKENS.radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.color.bg.accentStrong,
  },
  unreadCount: {
    ...TOKENS.typography.numeralSmall,
    color: t.color.text.onAccent,
  },
});
