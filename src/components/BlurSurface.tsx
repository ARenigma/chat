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
import type {  StyleProp, ViewStyle } from 'react-native';

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

/**
 * OFF (Amit, 2026-09-05: "if blur is not working then disable it").
 *
 * The GPU path itself works - it was measured blurring live content on the S22
 * (API 36) and the audit records the numbers. What never worked was the LOOK:
 * a translucent white plate over a light cream wallpaper and pale bubbles has
 * almost nothing to reveal, so the blur ran every frame and could not be seen.
 * the reference app's glass reads because its theme is dark and the content behind it is
 * colourful; ours is light on light. That is a palette fact, not a bug we can
 * tune our way out of in an afternoon, and it cost three build cycles to learn.
 *
 * So the plate is now the shipping look on every device. `Frost` already renders
 * exactly that when this is false, which is why turning it off is one constant
 * rather than a refactor. Nothing is deleted: BlurPackage.kt, the view managers
 * and their tests all stay, so flipping this back is a one-line change the day
 * the palette gains a dark theme or a photographic wallpaper worth revealing.
 *
 * Cost of leaving it on, for the record: a native view per Frost, and a
 * RenderNode re-record plus a downscaled composite per bar per frame.
 */
const BLUR_ENABLED = false;

export const BLUR_SURFACE_AVAILABLE: boolean =
  BLUR_ENABLED &&
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

