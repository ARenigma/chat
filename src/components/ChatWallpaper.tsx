import React, { memo } from 'react';
import { StyleSheet, View } from 'react-native';
import { TOKENS, type Theme } from '../theme/tokens';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { Icon, type IconName } from './Icon';

/**
 * The chat wallpaper: a faint doodle field, ours.
 *
 * Amit's call (wave-3 #19): drop the coral wash behind the transcript for a
 * WhatsApp-style micro-illustration pattern — but ORIGINAL, because WhatsApp's
 * doodle art is copyrighted and cannot be copied. So this tiles our own icon
 * glyphs (the ones the product is already made of: a heart, a chat bubble, a
 * listening ear, a moment of calm, a star) at ~5% opacity in the theme's ink, a
 * quiet hand-drawn-feeling texture that reads as "warmth in the room" and follows
 * light/dark for free. No SVG (banned here) and no image asset — just the font.
 *
 * Non-interactive and behind everything; the bubbles remain the reading surface.
 */
const GLYPHS: readonly IconName[] = ['heart', 'chat', 'listen', 'unwind', 'star', 'people'];

// A dense micro-glyph field (Amit, 2026-08-27): hundreds of tiny marks rather
// than a sparse scatter, WhatsApp's texture density. A fixed count keeps this a
// pure, memoisable static field rather than a measured layout; it is behind
// everything, non-interactive, and each glyph is a single <Text>.
const CELLS: IconName[] = Array.from(
  { length: 600 },
  (_, i) => GLYPHS[i % GLYPHS.length] ?? 'heart',
);

function ChatWallpaperView() {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  return (
    <View pointerEvents="none" style={styles.wallpaper}>
      <View style={styles.grid}>
        {CELLS.map((glyph, i) => (
          <View
            key={i}
            style={[styles.cell, i % 2 === 0 ? styles.tiltA : styles.tiltB]}>
            <Icon name={glyph} size={13} color={theme.color.text.primary} />
          </View>
        ))}
      </View>
    </View>
  );
}

export const ChatWallpaper = memo(ChatWallpaperView);

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    wallpaper: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      // The whole field is a whisper; the ink comes from the theme so it inverts
      // in dark mode without a second colour.
      opacity: 0.05,
      overflow: 'hidden',
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      // A touch of negative offset so the pattern bleeds past the edges rather
      // than starting flush in the top-left corner.
      marginTop: -TOKENS.space.md,
      marginLeft: -TOKENS.space.md,
    },
    cell: {
      width: 28,
      height: 28,
      alignItems: 'center',
      justifyContent: 'center',
    },
    // Alternating slight rotations give the tiling a hand-placed, doodle feel
    // rather than a rigid grid.
    tiltA: {
      transform: [{ rotate: '-12deg' }],
    },
    tiltB: {
      transform: [{ rotate: '14deg' }],
    },
  });
