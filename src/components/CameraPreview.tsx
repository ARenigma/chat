/**
 * CameraPreview — thin JS wrapper around the PappalCameraPreview native view.
 *
 * Renders a live CameraX preview inside a rounded, clipped, animatable tile.
 * The native view is Android-only; on iOS (or in any environment where the
 * native module was not built), CAMERA_PREVIEW_AVAILABLE is false and callers
 * should render a static fallback tile instead.
 *
 * Permission: the CAMERA permission must be granted by the caller before this
 * component is mounted. Use requestAndroidPermission('android.permission.CAMERA')
 * from src/lib/permissions.ts. If the permission is absent the native view
 * renders blank rather than throwing — but callers should not rely on that
 * degradation as a substitute for a proper permission check.
 */
import { UIManager, requireNativeComponent } from 'react-native';
import type { NativeSyntheticEvent, StyleProp, ViewStyle } from 'react-native';

/** Payload of `onStreamStateChange`. */
export interface CameraStreamState {
  /**
   * Whether CameraX currently has frames on this surface.
   *
   * Trustworthy as a "the picture is visible now" signal ONLY because the
   * native view sets `ImplementationMode.COMPATIBLE`. PreviewView's docs are
   * explicit that `STREAMING` guarantees visibility in COMPATIBLE mode and does
   * NOT in PERFORMANCE mode, where the preview "becomes visible slightly after
   * the state changes". If that mode ever changes, this flag stops meaning what
   * its consumers assume and a cross-fade started on it would reveal an empty
   * surface.
   * https://developer.android.com/reference/androidx/camera/view/PreviewView#getPreviewStreamState()
   */
  streaming: boolean;
}

/**
 * Props accepted by the PappalCameraPreview native view manager.
 *
 * facing is optional; the native view defaults to the back camera when the
 * prop is absent. Changing facing at runtime is supported: the native layer
 * unbinds the current camera session and opens a new one.
 */
export interface CameraPreviewProps {
  style?: StyleProp<ViewStyle>;
  /**
   * Which camera to use.
   *
   * "back"  → CameraSelector.DEFAULT_BACK_CAMERA  (default)
   * "front" → CameraSelector.DEFAULT_FRONT_CAMERA
   */
  facing?: 'back' | 'front';
  /**
   * Fires when frames start, and again when they stop.
   *
   * It goes false as well as true: flipping the camera unbinds and rebinds, so
   * there is a real gap with no frames in the middle of a flip, and a consumer
   * holding a placeholder should bring it back for that gap rather than leave a
   * stale last frame on screen.
   *
   * A session that FAILS to negotiate never fires at all. Consumers must treat
   * "no event" as "still not streaming" and keep their placeholder up
   * indefinitely — never start a timer that hides it optimistically.
   */
  onStreamStateChange?: (e: NativeSyntheticEvent<CameraStreamState>) => void;
}

/**
 * Whether the PappalCameraPreview native view manager is registered in the
 * currently installed build.
 *
 * This will be false in two situations:
 *   1. The JS bundle is newer than the native binary (e.g. an OTA JS update
 *      delivered before the user installs the new APK). The view manager is
 *      registered at native startup and absent from an old binary.
 *   2. iOS — this module is Android-only; iOS uses a different camera path.
 *
 * Callers must check this boolean and render a static fallback tile when it
 * is false rather than unconditionally mounting CameraPreview, which would
 * log an unregistered-component warning and render nothing.
 *
 * The check is UIManager.hasViewManagerConfig rather than Platform.OS so that
 * the fallback also activates on Android when the native side is missing —
 * a platform check alone would not catch case 1 above.
 */
export const CAMERA_PREVIEW_AVAILABLE: boolean =
  UIManager.hasViewManagerConfig('PappalCameraPreview');

/**
 * The native PappalCameraPreview view.
 *
 * requireNativeComponent defers registry lookup to render time and does not
 * throw at import time, so this export is safe to import unconditionally.
 * Guard rendering behind CAMERA_PREVIEW_AVAILABLE so the component is only
 * mounted when the native view manager is present.
 */
export const CameraPreview =
  requireNativeComponent<CameraPreviewProps>('PappalCameraPreview');
