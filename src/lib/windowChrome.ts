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
