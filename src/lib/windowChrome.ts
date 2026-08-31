import { NativeModules, Platform } from 'react-native';

/**
 * Activity backdrop blur while an M3 Paper sheet is up.
 *
 * Ref-counted so Payment stacked on Recharge does not clear the blur when the
 * inner sheet closes. No-op below API 31 and in Jest (module absent).
 */
const native = (
  NativeModules as { WindowChrome?: { setActivityBlur: (enabled: boolean) => void } }
).WindowChrome;

let holders = 0;

export function setSheetBackdropBlur(on: boolean): void {
  if (Platform.OS !== 'android' || native === undefined) return;
  holders = Math.max(0, holders + (on ? 1 : -1));
  native.setActivityBlur(holders > 0);
}
