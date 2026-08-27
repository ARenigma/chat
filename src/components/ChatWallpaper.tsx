import React, { memo } from 'react';
import { Image, StyleSheet, View } from 'react-native';

/**
 * The chat wallpaper: a faint seamless doodle tile.
 *
 * Amit's call (wave-3 #19): a WhatsApp-style micro-illustration pattern, but
 * original — the asset at assets/wallpaper-tile.png is our own. resizeMode
 * 'repeat' tiles it across the full screen at native resolution (supported in
 * RN 0.86). One Image node replaces the ~800-node View/Text grid, eliminating
 * the jank spike that competed with SlideInRight's first frame.
 *
 * Non-interactive and behind everything; the bubbles remain the reading surface.
 */
function ChatWallpaperView() {
  return (
    <View pointerEvents="none" style={styles.host}>
      <Image
        source={require('../../assets/wallpaper-tile.png')}
        resizeMode="repeat"
        style={styles.wallpaper}
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
    flex: 1,
    opacity: 0.05,
  },
});
