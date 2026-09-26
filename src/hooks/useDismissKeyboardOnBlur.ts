/**
 * Closes the IME when the screen loses focus, on a push as well as a pop.
 *
 * A keyboard raised for a field on a covered screen is typing into nothing,
 * and Android does not close it for us when the window stays the same
 * (https://developer.android.com/develop/ui/views/touch-and-input/keyboard-input/visibility).
 * It also keeps react-native-keyboard-controller from scrolling a detached
 * view after the pop (KC #1644/#1645, screens #4720; nav-migration R1).
 * Used by Chat, the Home, Favourites and Settings search, and Apply (§4).
 */

import { useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { KeyboardController } from 'react-native-keyboard-controller';

export function useDismissKeyboardOnBlur(): void {
  useFocusEffect(
    useCallback(
      () => () => {
        void KeyboardController.dismiss();
      },
      [],
    ),
  );
}
