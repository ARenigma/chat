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
import { UIManager, requireNativeComponent } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';

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
 * Whether the PappalBlurRoot native view manager is registered in the current
 * build. Use this before mounting BlurRoot or BlurSurface.
 *
 * False in two situations:
 *   1. iOS — this module is Android-only.
 *   2. The JS bundle is newer than the native binary (OTA update before APK
 *      update). UIManager.hasViewManagerConfig is the canonical check and
 *      catches this case; Platform.OS === 'android' alone does not.
 */
export const BLUR_SURFACE_AVAILABLE: boolean =
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
   * Pass 0x00000000 for a fully transparent tint (pure blur lens).
   * Pass 0xFF000000 for opaque black (same as the API < 31 fallback).
   * The native side encodes this as a Color prop — pass an integer, not a
   * CSS string.
   */
  tintColor?: number;
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
