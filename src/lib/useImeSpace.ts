import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * How much room the IME is taking at the bottom of the window, in dp. `0` when
 * it is down.
 *
 * ---------------------------------------------------------------------------
 * Why this exists rather than `KeyboardAvoidingView`
 * ---------------------------------------------------------------------------
 * `KeyboardAvoidingView` has no Android behaviour: every call site in this app
 * passed `behavior={Platform.OS === 'ios' ? 'padding' : undefined}`, and an
 * undefined behaviour makes it a plain `View`. That was survivable back when
 * the window resized under it — but this app is edge-to-edge, and
 * `WindowInsetsCompat` is explicit that under edge-to-edge the window keeps its
 * size and only the insets change:
 *
 *   https://developer.android.com/develop/ui/views/layout/edge-to-edge
 *   https://developer.android.com/develop/ui/views/layout/insets#ime-animations
 *
 * So nothing moved, and the IME simply covered the field being typed into.
 * Found on the Redmi 2026-09-05 on the provider PAN and profile steps.
 *
 * The documented answer is to read `WindowInsetsCompat.Type.ime()` and apply it
 * as padding yourself. `Keyboard`'s `endCoordinates.height` is React Native's
 * view of that same inset, which is why this is a listener and not a layout
 * component.
 *
 * `insets.bottom` is added because `endCoordinates.height` measures the IME
 * alone and EXCLUDES the navigation-bar inset the IME is drawn over. That
 * discrepancy was measured at 15dp on the S22 Ultra — `dumpsys window` put
 * the IME frame at 332dp while RN reported 317 — and it is what made the old
 * chat composer jump 34dp on every emoji-panel swap. The full measurement is
 * recorded in ADR-0027. On a device whose nav bar sits outside the app window
 * (MIUI three-button) the term is simply 0.
 *
 * THIS IS THE FORMS' HOOK, and it is the only one left. The chat had its own
 * arithmetic — `imeGeometry.ts`, deleted on 2026-09-19 — which kept the last
 * measured height and gated on a separate flag, because it had to size a
 * panel that was open precisely when the keyboard was not. There is no such
 * panel any more, and the chat now takes the IME position per frame from
 * `react-native-keyboard-controller` instead. This hook returns 0 the moment
 * the IME hides, because a form only needs padding while the keyboard is
 * actually there.
 */
export function useImeSpace(): number {
  const insets = useSafeAreaInsets();
  const [height, setHeight] = useState(0);

  // `Will` on iOS so padding changes on the same frame the keyboard starts
  // moving; Android only emits the `Did` pair.
  useEffect(() => {
    const show = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      e => setHeight(e.endCoordinates.height),
    );
    const hide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => setHeight(0),
    );
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height === 0 ? 0 : height + insets.bottom;
}
