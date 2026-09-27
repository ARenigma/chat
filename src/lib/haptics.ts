import { NativeModules, Vibration } from 'react-native';

/**
 * The haptic beats this app fires, and why they no longer go through
 * `Vibration`.
 *
 * `Vibration.vibrate(ms)` asks the motor for a raw duration. That does two
 * things Android's guidance says not to: it ignores the OEM's tuned waveform for
 * the action, and — the one that matters — it IGNORES THE USER'S TOUCH-FEEDBACK
 * SETTING. Someone who switched haptics off in Settings was being buzzed by this
 * app anyway, on every send and every long-press.
 *
 * `View.performHapticFeedback(HapticFeedbackConstants…)` respects both, and the
 * docs name it as the correct call for any predefined action — they also call
 * the consistency an accessibility consideration. That lives in
 * `HapticsModule.kt`; this file is only the fire points.
 * https://developer.android.com/develop/ui/views/haptics/haptics-principles
 *
 * the reference app's own mapping, for reference:
 *   tick()      → KEYBOARD_TAP  (167 call sites in ui/): send, swipe threshold.
 *   longPress() → LONG_PRESS    (73 call sites): the message action menu/strip.
 */
interface HapticsNative {
  tick(): void;
  longPress(): void;
  confirm(): void;
  reject(): void;
}

const native = NativeModules.PappalHaptics as HapticsNative | undefined;

/**
 * Whether the native module is in this binary.
 *
 * False when a JS bundle lands on an APK built before `HapticsModule.kt` existed
 * — the same OTA-skew window `BLUR_SURFACE_AVAILABLE` guards, and on iOS.
 *
 * The `Vibration` calls below exist ONLY for that window. They are not a second
 * implementation to keep in step: they do not respect the user's setting, which
 * is exactly why they are the last resort rather than the default.
 */
const HAS_NATIVE_HAPTICS = native != null;

/** A light tap: send, the swipe-reply threshold. */
export function tick(): void {
  if (HAS_NATIVE_HAPTICS) {
    native?.tick();
    return;
  }
  Vibration.vibrate(10);
}

/**
 * The heavier beat Android fires when a long-press opens something, for the
 * reaction strip. the reference app uses the system long-press feedback here
 * (`ReactionsContainerLayout.java:2240`).
 */
export function longPress(): void {
  if (HAS_NATIVE_HAPTICS) {
    native?.longPress();
    return;
  }
  Vibration.vibrate(20);
}

/**
 * Something was refused — a wrong OTP.
 *
 * `REJECT` on API 30+, with the native side falling back to `LONG_PRESS` below
 * that. The old double-buzz was an approximation of a waveform the platform
 * already ships.
 */
export function errorTick(): void {
  if (HAS_NATIVE_HAPTICS) {
    native?.reject();
    return;
  }
  Vibration.vibrate([0, 18, 60, 18]);
}

