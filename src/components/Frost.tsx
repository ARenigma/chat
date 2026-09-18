import React from 'react';
import { StyleSheet, View, type ViewProps } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { BLUR_SURFACE_AVAILABLE, BlurSurface } from './BlurSurface';

interface Props extends ViewProps {
  children: React.ReactNode;
  /**
   * Which edge carries the separating shadow.
   *
   * `top` for a bottom-anchored bar, `bottom` for a top one. Omit it for a bar
   * that should read as nothing at all.
   *
   * **This used to be a hairline, and the reference does not draw one.** Above
   * its composer the reference app draws `chat_composeShadowDrawable`, a nine-patch
   * shadow (`ChatActivityEnterView.java:4698-4707`) — which is why its bar reads
   * as separated from the transcript without a visible line anywhere. A hairline
   * was tried here and removed for drawing "a line across the transcript with
   * nothing on the other side of it" (Amit, 2026-09-04); the shadow is what the
   * reference uses instead of either.
   */
  edge?: 'top' | 'bottom';
  /**
   * The surface wash over the blur. `glass` (default) is the bar plate. `none`
   * leaves the blur untinted, for a bar meant to read as a lens rather than a
   * surface.
   */
  tint?: 'glass' | 'none';
  /** Whether to blur at all. `false` paints the tint as a solid plate. */
  blur?: boolean;
}

/**
 * A fixed bar the content scrolls UNDER, filled with a real frosted backdrop
 * blur of whatever passes behind it. The one place a blur lives, so every dock
 * — nav bar, chat header, chat composer — frosts identically.
 *
 * **Requires a `BlurRoot` ancestor** (App.tsx wraps the app in one). Without one
 * the native surface logs once and paints the tint solid, which is a degraded
 * look and not a crash.
 *
 * ---------------------------------------------------------------------------
 * History, because this reversed twice and the second reversal matters
 * ---------------------------------------------------------------------------
 * First it was translucent `bg/chrome` standing in for a blur, because
 * `@react-native-community/blur` rendered a full-window white veil under the New
 * Architecture. Then it was `@sbaiahmed1/react-native-blur`, and this docstring
 * claimed that library used Android's `RenderEffect`.
 *
 * **That claim was wrong**, and it was load-bearing. The library rasterises the
 * backdrop on the CPU — `Bitmap.createBitmap(..., ARGB_8888)` plus a software
 * `Canvas` (`SharedBackdropCapture.kt:72-74`) — driven by a
 * `ViewTreeObserver.OnPreDrawListener` installed on the decor view
 * (`ReactNativeBlurView.kt:145-163`). That is a full-screen CPU capture on every
 * root pre-draw, and this component is mounted twice on the chat screen over a
 * scrolling transcript.
 *
 * It now runs on our own `BlurSurface`: a `RenderNode` carrying a
 * `RenderEffect` blur chained with a saturation boost, recorded once per frame
 * at a fraction of screen resolution and composited by the GPU. Which is what
 * the reference actually does (`SizeNotifierFrameLayout.java:997-1002`), and the
 * reference also treats it as OPTIONAL: `chatBlurEnabled()` requires the user to
 * turn it on and returns false outright on a low-performance device
 * (`SharedConfig.java:1752`). Ours is on by default, which is a deviation and a
 * deliberate one — the frost is part of this app's identity in a way it is not
 * part of the reference app's.
 *
 * The tint is not decoration either. It is composited at 70% over the blur, so
 * only about a third of the blur shows through — the reference's
 * `key_chat_BlurAlpha = 0xB2000000` (`ThemeColors.java:660`). A frosted bar is
 * mostly a plate; treating it as glass is what made the earlier version both
 * expensive and wrong.
 */
export function Frost({
  children,
  style,
  edge,
  tint = 'glass',
  blur = true,
  ...rest
}: Props) {
  const theme = useTheme();
  /*
   * The blur is a SIBLING behind the children, not their parent.
   *
   * `PappalBlurSurface` is a leaf that paints a region of the root's blurred
   * node; it has no children of its own. The bar's own content sits over it,
   * and the root leaves this whole subtree out of the recording (see
   * `blurBehindViews` in BlurPackage.kt), so the icons and text are not blurred
   * into their own backdrop.
   */
  return (
    <View {...rest} style={[style, styles.clip]}>
      {BLUR_SURFACE_AVAILABLE ? (
        <BlurSurface
          style={styles.fill}
          enabled={blur}
          /*
           * The TOKEN STRING, not a number we converted ourselves.
           *
           * `@ReactProp(customType = "Color")` means React Native normalises this
           * value before it crosses the bridge, and its normaliser REJECTS any
           * negative number - which is exactly what a signed 32-bit ARGB int is.
           * Verified: normalizeColor(-1929379841) returns null, while
           * normalizeColor('rgba(255,255,255,0.55)') returns 4294967180.
           *
           * A rejected value is not sent at all, so the native view kept its
           * default and every frosted bar in the app painted that default
           * instead of the glass tint. It was Color.BLACK, so the chat header,
           * composer and nav bar rendered as solid black slabs (Amit, S22 and
           * Redmi, 2026-09-05). Converting by hand was the whole mistake; RN
           * already does it, correctly, for every colour prop in the framework.
           */
          tintColor={tint === 'none' ? 'transparent' : theme.color.bg.glass}
        />
      ) : (
        /*
         * No native blur in this binary — an old APK under a newer JS bundle, or
         * a platform without the module. The plate alone is the correct
         * degradation: it is what the reference draws when its own blur is off
         * (`SizeNotifierFrameLayout.java:976-979`).
         */
        <View
          style={[
            styles.fill,
            /*
             * OPAQUE. `bg.chrome` is rgba(...,0.80), which is correct ONLY when
             * there is a blur behind it to supply the other 20%. With the blur
             * off there is nothing behind it, so 20% of the transcript showed
             * straight through the bar: call pills and message text ghosted
             * across the chat header (Redmi, 2026-09-05).
             *
             * A translucent plate with nothing behind it is not glass, it is a
             * ghost. `bg.base` is the opaque page colour, so the bar occludes -
             * which is the entire job of a bar the content scrolls under.
             */
            tint === 'none' ? null : { backgroundColor: theme.color.bg.base },
          ]}
        />
      )}
      {edge !== undefined ? (
        <View
          style={[
            styles.shadow,
            edge === 'top' ? styles.shadowTop : styles.shadowBottom,
          ]}
        />
      ) : null}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
  fill: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  /*
   * The nine-patch shadow's stand-in: a 3dp band at low alpha. Stated as an
   * approximation rather than passed off as the reference's drawable, which is a
   * real nine-patch asset we do not have and cannot fabricate from a colour.
   */
  shadow: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  shadowTop: { top: -3 },
  shadowBottom: { bottom: -3 },
});
