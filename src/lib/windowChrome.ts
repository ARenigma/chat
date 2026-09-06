import { NativeModules, Platform } from 'react-native';

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
    };
  }
).WindowChrome;

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
