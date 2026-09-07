import React, { memo } from 'react';
import { StyleSheet, Text } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles } from '../theme/ThemeProvider';
import { selectPeerTyping, useStore } from '../store/useStore';
import type { PresenceRead } from '../lib/presence';

/**
 * The subtitle line under the peer's name in the chat header.
 *
 * Subscribes narrowly to `selectPeerTyping` so that typing broadcasts only
 * re-render this small leaf, not the entire ChatScreen — the same isolation
 * pattern that `PeerTyping` uses for the transcript bubble. `presence` is a
 * stable value derived from the thread row and changes only when the peer
 * updates their declared state, not on every keystroke.
 *
 * Priority: typing > online > last-seen / away / nothing.
 *
 * The row is dropped entirely when there is nothing to announce, which is what
 * Material 3's own bar does: `TopAppBarLayout` composes the title as a two-child
 * `Column` only `if (subtitle != null)` and as a single `Box` otherwise — it
 * never reserves a blank subtitle line (androidx.compose.material3 AppBar.kt).
 * The header still cannot change height: `ChatScreen`'s `identityText` reserves
 * `IDENTITY_LINES * fontScale` in both states, which is where M3 puts the
 * reservation (`AppBarSmallTokens.ContainerHeight`), and unlike a blank line box
 * it lets the single-line state centre on the 30dp avatar.
 */
function HeaderSubtitleView({ presence }: { presence: PresenceRead }) {
  const styles = useStyles(makeStyles);
  const typing = useStore(selectPeerTyping);

  // "typing…" is a single unicode ellipsis character rather than three
  // full stops, which avoids a ligature mismatch on fonts that collapse "..."
  // into a glyph taller than the cap-height.
  const label = typing
    ? 'typing…'
    : presence.here
      ? 'Online'
      : (presence.line ?? '');

  // Quiet (tertiary) only when there is nothing active to announce. Typing and
  // "Online" both carry the positive colour so they read as live signals.
  const quiet = !typing && !presence.here;

  // Nothing to say, so nothing rendered. `presence.line` is null for 'hidden'
  // and for a peer that has not loaded, which is the DEFAULT state, and the
  // empty line box this used to render is what held the name 8dp above the
  // avatar's centre. src/lib/presence.ts has always documented this behaviour
  // ("the chat header renders the name alone rather than reserving a blank
  // row"); the code now agrees with it.
  //
  // Returning null rather than being conditionally rendered by ChatScreen: this
  // component stays MOUNTED and keeps its narrow `selectPeerTyping`
  // subscription, so a typing broadcast still re-renders only this leaf.
  if (label === '') {
    return null;
  }

  return (
    <Text
      testID="peer-presence"
      allowFontScaling
      numberOfLines={1}
      style={[styles.base, quiet && styles.quiet]}>
      {label}
    </Text>
  );
}

export const HeaderSubtitle = memo(HeaderSubtitleView);

const makeStyles = (t: Theme) => StyleSheet.create({
  base: {
    ...TOKENS.typography.bodySmall,
    color: t.color.text.positive,
  },
  quiet: {
    color: t.color.text.tertiary,
  },
});
