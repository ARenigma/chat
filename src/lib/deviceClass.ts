/**
 * Device performance class, reported by the native DeviceClassModule.
 *
 * Three tiers drive blur quality in Frost:
 *   low     — blur off; Frost shows the plate (bg.chrome) fallback
 *   average — blurRounds reduced (1 vs the default)
 *   high    — full blur at default blurRounds
 *
 * The API-31 gate in BlurSurface.tsx already handles Android 7–11 (no
 * RenderEffect). This module fills the remaining gap: API 31+ devices with
 * very low RAM (e.g. cheap Android One with 1–2 GB) that the API-level guard
 * cannot catch.
 *
 * https://developer.android.com/reference/android/app/ActivityManager#isLowRamDevice()
 */
import { NativeModules, Platform } from 'react-native';

export type DeviceClass = 'low' | 'average' | 'high';

const _module = NativeModules.DeviceClass as
  | { getDeviceClass(): DeviceClass }
  | undefined;

/**
 * The device class, resolved once at module load time (synchronous native call).
 *
 * Synchronous because:
 *   1. It is needed before the first frame to decide whether BlurSurface mounts.
 *   2. The native call is a single ActivityManager query — no I/O — so the JS
 *      thread cost is the same as any other synchronous import.
 *
 * On iOS or when the native module is absent (OTA-skew window between a JS
 * update and an APK update), defaults to 'high' so the user gets the designed
 * experience rather than a silently-degraded one.
 */
export const DEVICE_CLASS: DeviceClass =
  Platform.OS === 'android' && _module != null
    ? _module.getDeviceClass()
    : 'high';

/** True when blur should be suppressed entirely (low-RAM device). */
export const BLUR_DISABLED = DEVICE_CLASS === 'low';

/** True when blur should run at reduced quality (blurRounds = 1). */
export const BLUR_REDUCED = DEVICE_CLASS === 'average';
