import { Vibration } from 'react-native';

/**
 * Why the app requests `android.permission.VIBRATE`: short haptic taps on the
 * interactions Telegram gives one — send, a rejected code, a message long-press,
 * and the swipe-to-reply threshold. No haptics library; `Vibration` ships with
 * React Native.
 *
 * These are the fire POINTS. The plan's Phase 5 swaps the implementation behind
 * them to `performHapticFeedback(KEYBOARD_TAP | LONG_PRESS)` so the OS's own
 * curve and the user's system setting are respected; until then each maps to the
 * closest `Vibration` duration. Telegram's own mapping, for reference:
 *   tick()      → KEYBOARD_TAP  (167 call sites in ui/): send, swipe threshold.
 *   longPress() → LONG_PRESS    (73 call sites): the message action menu/strip.
 */
export function tick(): void {
  Vibration.vibrate(10);
}

/**
 * The heavier tap Android fires on a long-press (`HapticFeedbackConstants
 * .LONG_PRESS`), for opening the reaction strip. Telegram uses the system
 * long-press feedback here (`ReactionsContainerLayout.java:2240`). Slightly
 * longer than `tick` so the "held long enough, menu is opening" beat is distinct
 * from the light send/keyboard tap.
 */
export function longPress(): void {
  Vibration.vibrate(20);
}

export function errorTick(): void {
  Vibration.vibrate([0, 18, 60, 18]);
}
