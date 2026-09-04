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
import type { StyleProp, ViewStyle } from 'react-native';

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
