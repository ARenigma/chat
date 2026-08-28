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
 * The row is always rendered (even as an empty string) so the header does
 * not jump height when presence data arrives or the peer starts typing.
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
    ...TOKENS.typography.captionSmall,
    color: t.color.text.positive,
  },
  quiet: {
    color: t.color.text.tertiary,
  },
});
