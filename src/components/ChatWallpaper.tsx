import React, { memo } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useTheme, useThemeMode } from '../theme/ThemeProvider';

/**
 * Chat wallpaper — denser doodle pattern, dulled like WhatsApp.
 *
 * Density is baked into the JPG (the doodle sheet is tiled at 67% scale into
 * a phone-sized canvas with a wash). Runtime is a single `cover` Image — the
 * same path that worked before — because RN Android `resizeMode="repeat"` was
 * stretching one tile and looking broken.
 *
 * 67%, not the 48% it shipped with (Amit, S22 2026-10-03: "chat bg is too
 * zoomed out, zoom it in a little"): about 1.4x larger doodles, two tiles of
 * the light source sheet in design/sources across the phone.
 *
 * In light mode a faint blush wash (`bg.accentTint`, the secondary/blush
 * surface) sits over the doodles so the whole transcript carries the same pink
 * hue as the rest of the product rather than reading neutral-grey — user
 * 2026-08-31, "only change the hue a little". Kept low so the doodles still
 * read; the exact opacity is a device-tuned value.
 *
 * In dark mode there is no hue at all (user 2026-09-01) and no wash: the dark
 * JPG is baked on WhatsApp's own dark chat ground, #0A0A0A (bubble/wallpaper),
 * with the doodles at #242625, both colour-picked from WhatsApp (Amit,
 * 2026-10-03: "make it exactly as whatsapp charcoal/grey"). It used to be an
 * AMOLED black sheet under an 85% wash, which left the doodles about two grey
 * levels above the ground, invisible on the S22. The sheet is the light JPG's
 * doodle mask (median minus luminance, normalised at the 0.5th percentile,
 * gamma 0.7) mapped from ground to doodle, so both modes share one drawing.
 * https://developer.android.com/develop/ui/views/theming/darktheme
 *
 * Non-interactive and behind everything.
 *
 * Source JPGs are 720x1560, not the device's own 1080x2340 (M19, 2026-09-17
 * audit, Amit's call). A full-bleed Image decodes to an in-memory bitmap at
 * roughly its source resolution regardless of the JPEG's own compression —
 * ARGB_8888 is 4 bytes/pixel, so 1080x2340 cost ~10.1MB resident for one
 * wallpaper, just to back a subtle, already-washed-over doodle pattern.
 * 720x1560 is ~44% of that (~4.5MB) with a visually negligible loss on a
 * pattern this understated — RN's `resizeMode="cover"` still scales it to
 * fill the screen either way, so nothing about the layout changes, only the
 * bitmap's own pixel density. A crisper fix exists (an RGB_565 bitmap config
 * halves this again) but needs a native Android module; deferred, not done
 * here. https://developer.android.com/topic/performance/graphics/manage-memory
 */
const WASH_OPACITY = 0.2;

function ChatWallpaperView() {
  const { isDark } = useThemeMode();
  const theme = useTheme();
  const source = isDark
    ? require('../../assets/chat-wallpaper-dark.jpg')
    : require('../../assets/chat-wallpaper-light.jpg');

  return (
    <View pointerEvents="none" style={styles.host}>
      <Image source={source} resizeMode="cover" style={styles.wallpaper} />
      {isDark ? null : (
        <View
          style={[
            styles.wash,
            { backgroundColor: theme.color.bg.accentTint, opacity: WASH_OPACITY },
          ]}
        />
      )}
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
