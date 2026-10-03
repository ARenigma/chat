import React, { memo } from 'react';
import { StyleSheet } from 'react-native';
import Animated from 'react-native-reanimated';
import { fadeSwapFast, fadeSwapOutFast } from '../theme/motion';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { selectPeerActivity, useStore } from '../store/useStore';
import type { PresenceRead } from '../lib/presence';

/**
 * The subtitle line under the peer's name in the chat header.
 *
 * Subscribes narrowly to `selectPeerActivity` so that typing broadcasts only
 * re-render this small leaf, not the entire chat screen — the same isolation
 * pattern that `PeerTyping` uses for the transcript bubble. `presence` is the
 * server's reading (migration 155) as the controller resolved it, re-read
 * every 15 s while a member's chat with a provider is focused, and not on
 * every keystroke.
 *
 * Priority: recording > typing > the presence line ("Online" or "last seen
 * today at 10:15 am", from `readPresence`) > nothing.
 *
 * The row is dropped entirely when there is nothing to announce, which is what
 * Material 3's own bar does: `TopAppBarLayout` composes the title as a two-child
 * `Column` only `if (subtitle != null)` and as a single `Box` otherwise — it
 * never reserves a blank subtitle line (androidx.compose.material3 AppBar.kt).
 * The header still cannot change height: `ChatHeaderV2`'s `identityText` reserves
 * `IDENTITY_LINES * fontScale` in both states, which is where M3 puts the
 * reservation (`AppBarSmallTokens.ContainerHeight`), and unlike a blank line box
 * it lets the single-line state centre on the 30dp avatar.
 */
function HeaderSubtitleView({ presence }: { presence: PresenceRead }) {
  const styles = useStyles(makeStyles);
  const activity = useStore(selectPeerActivity);

  // "typing…" is a single unicode ellipsis character rather than three
  // full stops, which avoids a ligature mismatch on fonts that collapse "..."
  // into a glyph taller than the cap-height.
  const label = activity === 'recording'
    ? // the reference app says "Recording audio" rather than "typing" here, and the
      // distinction is the point: this app has voice notes, and a peer holding
      // the mic is not typing (MessagesController.java:11210-11213).
      'recording…'
    : activity === 'typing'
    ? 'typing…'
    : (presence.line ?? '');

  // Quiet (tertiary) only when there is nothing active to announce. Typing and
  // "Online" both carry the positive colour so they read as live signals; a
  // last-seen line is a fact about the past and takes the quiet ink.
  const quiet = activity === null && !presence.here;

  // Nothing to say, so nothing rendered. `presence.line` is null for a member
  // peer, a blocked pair, a provider never seen and a peer that has not
  // loaded, which is the DEFAULT state, and the
  // empty line box this used to render is what held the name 8dp above the
  // avatar's centre. src/lib/presence.ts has always documented this behaviour
  // ("the chat header renders the name alone rather than reserving a blank
  // row"); the code now agrees with it.
  //
  // Returning null rather than being conditionally rendered by the header: this
  // component stays MOUNTED and keeps its narrow `selectPeerTyping`
  // subscription, so a typing broadcast still re-renders only this leaf.
  if (label === '') {
    return null;
  }

  return (
    /*
     * Rule 7 (motion.ts): keyed so React remounts the node and Reanimated runs
     * the swap (M14, 2026-09-17 audit), with the fadeSwapFast/fadeSwapOutFast
     * pair the Notify button uses.
     *
     * Keyed by the KIND of line, not by its text (2026-09-27, animate-expo's
     * frequency gate). The typing and recording swap is somebody starting to
     * do something, and keeps its fade. The presence line changing on its own
     * ("Online" to "last seen today at 10:15 am", or a stamp moving on) is seen
     * tens of times a day in a chat that polls it every 15 s, which is the
     * tier that gets nothing: the text changes in place, a hard cut, and the
     * avatar's dot beside it snaps in the same frame (Avatar's PresenceDot is
     * a style swap with no animation). A fade there would announce a change
     * nobody made on purpose.
     */
    <Animated.Text
      key={activity ?? 'presence'}
      entering={fadeSwapFast}
      exiting={fadeSwapOutFast}
      testID="peer-presence"
      allowFontScaling
      numberOfLines={1}
      style={[styles.base, quiet && styles.quiet]}>
      {label}
    </Animated.Text>
  );
}

export const HeaderSubtitle = memo(HeaderSubtitleView);

const makeStyles = (t: Theme) => StyleSheet.create({
  base: {
    ...TOKENS.typography.bodySmall,
    // No tracking, as WhatsApp's status line has none: bodySmall's 0.4 adds
    // ~10dp across "last seen today at 3:35 pm", the difference between the
    // line fitting the header and clipping (S22, 2026-10-03).
    letterSpacing: 0,
    color: t.color.text.positive,
  },
  quiet: {
    color: t.color.text.tertiary,
  },
});
