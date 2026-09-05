/**
 * BlurSurface — JS wrappers for the PappalBlurRoot and PappalBlurSurface
 * Android native view managers.
 *
 * The hardware blur is implemented in BlurPackage.kt using a RenderNode that
 * carries a RenderEffect blur+saturation chain (API 31, Android 12+). Below
 * API 31 the native views fall back to a solid tint rect automatically — no
 * JS code needs to branch on platform version.
 *
 * Usage:
 *   <BlurRoot style={StyleSheet.absoluteFill}>
 *     <ScrollContent />
 *     <BlurSurface
 *       style={styles.toolbar}
 *       tintColor={0x00000000}
 *       tintAlpha={0.70}
 *       blurRadius={60}
 *       enabled
 *     />
 *   </BlurRoot>
 *
 * BLUR_SURFACE_AVAILABLE is false on iOS (Android-only module) and on an
 * Android device running an old APK where the native side has not been rebuilt.
 * When false, callers should render a plain View with a background colour
 * instead of mounting BlurRoot/BlurSurface.
 */
import { Platform, UIManager, requireNativeComponent } from 'react-native';
import type { ColorValue, StyleProp, ViewStyle } from 'react-native';

// ─── BlurRoot ────────────────────────────────────────────────────────────────

/**
 * Props for the PappalBlurRoot native view.
 *
 * PappalBlurRoot is a plain FrameLayout from JS's perspective — it has no
 * configurable props beyond the standard View props. All blur configuration
 * lives on its PappalBlurSurface children.
 */
export interface BlurRootProps {
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

/**
 * Whether a real GPU backdrop blur can be drawn on this device, in this build.
 *
 * False in three situations:
 *   1. iOS — this module is Android-only.
 *   2. The JS bundle is newer than the native binary (OTA update before APK
 *      update). UIManager.hasViewManagerConfig is the canonical check and
 *      catches this case; Platform.OS === 'android' alone does not.
 *   3. **API < 31.** RenderEffect.createBlurEffect is API 31, and
 *      PappalBlurSurface.onDraw gates on exactly that
 *      (`SDK_INT >= 31 && canvas.isHardwareAccelerated`), so on Android 7–11 the
 *      native view can ONLY ever reach drawSolidFallback. Mounting it there buys
 *      a native view per bar and a canvas.drawRect per bar per frame to achieve
 *      what a plain RN View with a background does for free — on precisely the
 *      devices with the least to spare. Checking here means those devices never
 *      create the view at all.
 *      https://developer.android.com/reference/android/graphics/RenderEffect#createBlurEffect(float,%20float,%20android.graphics.RenderEffect,%20android.graphics.Shader.TileMode)
 *
 * `Platform.Version` is the API level as a number on Android.
 */
const BLUR_MIN_API = 31;

export const BLUR_SURFACE_AVAILABLE: boolean =
  Platform.OS === 'android' &&
  typeof Platform.Version === 'number' &&
  Platform.Version >= BLUR_MIN_API &&
  UIManager.hasViewManagerConfig('PappalBlurSurface') &&
  UIManager.hasViewManagerConfig('PappalBlurRoot');

/**
 * The native PappalBlurRoot view.
 *
 * requireNativeComponent defers the registry lookup to render time and does
 * not throw at import time, so this export is safe to import unconditionally.
 * Guard rendering behind BLUR_SURFACE_AVAILABLE.
 */
export const BlurRoot = requireNativeComponent<BlurRootProps>('PappalBlurRoot');

// ─── BlurSurface ─────────────────────────────────────────────────────────────

/**
 * Props accepted by the PappalBlurSurface native view manager.
 *
 * All props are optional. Defaults match Telegram's chat blur configuration:
 * tintAlpha 0.70 = key_chat_BlurAlpha 0xB2/255 (ThemeColors.java:660),
 * blurRadius 60 = HIGH-class radius (SizeNotifierFrameLayout.java:952).
 */
export interface BlurSurfaceProps {
  style?: StyleProp<ViewStyle>;
  /**
   * ARGB tint colour composited OVER the blur.
   *
   * A COLOUR STRING, e.g. 'rgba(255,255,255,0.55)' or '#0B141A' or
   * 'transparent'. Not a number.
   *
   * The native side declares this `@ReactProp(customType = "Color")`, which
   * hands the value to React Native's colour normaliser before it crosses the
   * bridge. That normaliser REJECTS negative numbers, and a signed 32-bit ARGB
   * int - the obvious thing to reach for on Android - is negative for any
   * colour with alpha above 0x7F. A rejected value is dropped rather than sent,
   * so the view silently keeps its default.
   *
   * That is not hypothetical: this prop used to take a hand-converted signed
   * int and every frosted bar in the app painted the native default instead of
   * the tint. Verified with RN's own normaliser:
   *   normalizeColor(-1929379841)              -> null
   *   normalizeColor('rgba(255,255,255,0.55)') -> 4294967180
   *
   * A number is still accepted by the type, because RN accepts one - but it
   * must be the UNSIGNED 0xRRGGBBAA form RN documents, never a signed ARGB int.
   * Passing the token string is simpler and cannot be got wrong.
   */
  tintColor?: ColorValue;
  /**
   * Opacity of the tint overlay in [0, 1].
   *
   * Default 0.70 matches Telegram's key_chat_BlurAlpha (70%). At this value
   * the blur is ~30% visible — enough to show depth without becoming a lens.
   * A lower value lets more blur through; higher approaches a solid plate.
   */
  tintAlpha?: number;
  /**
   * Blur radius in downscaled-pixel space (passed to RenderEffect.createBlurEffect).
   *
   * Default 60 matches Telegram's HIGH-class radius. The perceived blur in
   * screen space is radius × DOWNSCALE (DOWNSCALE = 6 in BlurPackage.kt).
   */
  blurRadius?: number;
  /**
   * Whether to use the hardware blur path.
   *
   * false → the native view draws a solid tintColor rect at full opacity
   * (the same fallback used on API < 31).  Useful for temporarily disabling
   * the blur during heavy animations without unmounting the view.
   */
  enabled?: boolean;
}

/**
 * The native PappalBlurSurface view.
 *
 * Must be a child of BlurRoot (or a descendant at any depth). If no BlurRoot
 * ancestor is found at attach time the native view logs a warning and renders
 * the solid fallback rather than crashing.
 */
export const BlurSurface =
  requireNativeComponent<BlurSurfaceProps>('PappalBlurSurface');
