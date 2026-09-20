import { findNodeHandle, NativeModules, Platform } from 'react-native';
import type { Component, RefObject } from 'react';

/**
 * Activity backdrop blur while an M3 Paper sheet is up.
 *
 * Ref-counted so Payment stacked on Recharge does not clear the blur when the
 * inner sheet closes. No-op below API 31 and in Jest (module absent).
 */
const native = (
  NativeModules as {
    WindowChrome?: {
      setActivityBlur: (enabled: boolean) => void;
      getRefreshRate: () => Promise<number | null>;
      secureModal: (tag: number, secure: boolean) => void;
      setKeepScreenOn: (enabled: boolean) => void;
    };
  }
).WindowChrome;

/**
 * Apply FLAG_SECURE to an RN Modal's OWN Dialog window.
 *
 * MainActivity secures the activity window, but each RN `Modal` is a separate
 * Dialog window that does NOT inherit it, so a screenshot over an open sheet or
 * the full-screen media viewer is otherwise not blocked. Call from the modal's
 * `onShow` (the native dialog exists by then), passing the modal's ref; this
 * resolves its node handle and hands it to the native side, which sets the flag
 * on the dialog window. No-op off Android, in Jest, or on any build that does
 * not block screenshots (the native side gates on BuildConfig.BLOCK_SCREENSHOTS,
 * matching the activity — debug and named-tester builds stay capturable).
 *
 * MUST be verified with `adb exec-out screencap` returning black over the open
 * modal on a release/closedTest build; a screenshot block cannot be unit-tested.
 *
 * FABRIC CAVEAT (newArchEnabled=true): `findNodeHandle` is legacy and can return
 * null for Fabric-managed views. RN's `Modal` still renders through the legacy
 * `ReactModalHostView` even under Fabric in the current version, so the tag
 * resolves today — but this is an implementation detail. If an RN upgrade moves
 * Modal onto a pure-Fabric host, `tag` goes null and this degrades to a NO-OP
 * (protection silently lost, no crash). The `adb screencap` check above is the
 * only thing that catches that regression; run it after any RN bump.
 */
export function secureModal(ref: RefObject<Component | null>): void {
  if (Platform.OS !== 'android' || native?.secureModal === undefined) return;
  const tag = findNodeHandle(ref.current);
  if (tag != null) native.secureModal(tag, true);
}

let holders = 0;

export function setSheetBackdropBlur(on: boolean): void {
  if (Platform.OS !== 'android' || native === undefined) return;
  holders = Math.max(0, holders + (on ? 1 : -1));
  native.setActivityBlur(holders > 0);
}

/**
 * What the display is ACTUALLY refreshing at, in Hz, or null if it cannot be
 * read (not Android, no activity attached, module absent in Jest).
 *
 * `perfTelemetry` infers this from `requestAnimationFrame` deltas, which works
 * but needs ~20 frames to settle and cannot distinguish a 60 Hz panel from a
 * 120 Hz panel dropping every other frame. This reads the current mode, so it
 * also reports whether MainActivity's `preferredDisplayModeId` vote actually
 * won.
 */
export async function readRefreshRate(): Promise<number | null> {
  if (Platform.OS !== 'android' || native?.getRefreshRate === undefined) return null;
  try {
    const hz = await native.getRefreshRate();
    return typeof hz === 'number' && hz > 1 ? hz : null;
  } catch {
    // A perf signal is never worth a crash.
    return null;
  }
}

/**
 * Hold FLAG_KEEP_SCREEN_ON on the Activity window while a video call is active
 * so the display does not dim or lock while the user is watching the remote feed.
 *
 * Pass `true` when the video call becomes active; `false` when it ends or when
 * the camera is disabled. Do NOT use for voice-only calls — those use the
 * proximity wake lock in CallForegroundService to blank the screen while near
 * the ear.
 *
 * https://developer.android.com/develop/background-work/background-tasks/awake/screen-on
 * https://developer.android.com/reference/android/view/WindowManager.LayoutParams#FLAG_KEEP_SCREEN_ON
 */
export function setKeepScreenOn(enabled: boolean): void {
  if (Platform.OS !== 'android' || native?.setKeepScreenOn === undefined) return;
  native.setKeepScreenOn(enabled);
}
