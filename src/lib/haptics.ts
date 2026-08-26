import { Vibration } from 'react-native';

/**
 * The only reason the app requests `android.permission.VIBRATE`: a 10 ms tick
 * on send and a double tick on failure. No haptics library, `Vibration` ships
 * with React Native.
 */
export function tick(): void {
  Vibration.vibrate(10);
}

export function errorTick(): void {
  Vibration.vibrate([0, 18, 60, 18]);
}
