import React, { memo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useTheme, useThemeMode } from '../theme/ThemeProvider';

/**
 * Chat wallpaper — denser doodle pattern, dulled like WhatsApp.
 *
 * Density is baked into the JPG (the doodle sheet is tiled at ~48% scale into
 * a phone-sized canvas with a wash). Runtime is a single `cover` Image — the
 * same path that worked before — because RN Android `resizeMode="repeat"` was
 * stretching one tile and looking broken.
 *
 * In light mode a faint blush wash (`bg.accentTint`, the secondary/blush
 * surface) sits over the doodles so the whole transcript carries the same pink
 * hue as the rest of the product rather than reading neutral-grey — user
 * 2026-08-31, "only change the hue a little". Kept low so the doodles still
 * read; the exact opacity is a device-tuned value.
 *
 * In dark mode there is no hue at all (user 2026-09-01). The wash instead lifts
 * the near-black doodle sheet onto the palette's charcoal base, because the JPG
 * is an AMOLED black and the rest of dark mode is WhatsApp charcoal #0B141A —
 * an unwashed transcript would be the one screen darker than the app around it.
 * https://developer.android.com/develop/ui/views/theming/darktheme
 *
 * Non-interactive and behind everything.
 */
const WASH_OPACITY = 0.2;
/** Opaque enough to set the charcoal base, low enough to leave the doodles legible. */
const DARK_WASH_OPACITY = 0.85;

function ChatWallpaperView() {
  const { isDark } = useThemeMode();
  const theme = useTheme();
  const source = isDark
    ? require('../../assets/chat-wallpaper-dark.jpg')
    : require('../../assets/chat-wallpaper-light.jpg');

  return (
    <View pointerEvents="none" style={styles.host}>
      <Image source={source} resizeMode="cover" style={styles.wallpaper} />
      <View
        style={[
          styles.wash,
          isDark
            ? { backgroundColor: theme.color.bg.base, opacity: DARK_WASH_OPACITY }
            : { backgroundColor: theme.color.bg.accentTint, opacity: WASH_OPACITY },
        ]}
      />
    </View>
  );
}

export const ChatWallpaper = memo(ChatWallpaperView);

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  wallpaper: {
    ...StyleSheet.absoluteFill,
  },
  wash: {
    ...StyleSheet.absoluteFill,
  },
});
