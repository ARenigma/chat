import { useEffect, useState } from 'react';
import { useKeyboardState } from 'react-native-keyboard-controller';
import { useViewingCovered } from '../lib/viewingConversation';

/**
 * Whether the chat should ignore the keyboard right now.
 *
 * While a sheet covers the chat, the keyboard belongs to the sheet's field, so
 * the dock and the list stay put (useViewingCovered). The cover lifts the
 * moment the sheet closes, but a keyboard the sheet opened is still on its way
 * down then, and a chat that started following it at that instant jumped its
 * composer up to the falling keyboard and rode it back down for a few frames
 * (frame capture, S22, 2026-09-29). So the freeze holds past the cover until
 * the keyboard has actually gone.
 */
export function useChatKeyboardFrozen(): boolean {
  const covered = useViewingCovered();
  const keyboardVisible = useKeyboardState(state => state.isVisible);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (covered) {
      setHeld(true);
      return;
    }
    if (!keyboardVisible) {
      setHeld(false);
      return;
    }
    // Backstop: the hold must end even if the keyboard state never reports
    // hidden (a stale reading was suspected on Android 14, 2026-10-01). A
    // chat frozen for good would leave the composer under the real keyboard.
    // 600 ms outlasts the IME's own exit animation.
    const release = setTimeout(() => setHeld(false), 600);
    return () => clearTimeout(release);
  }, [covered, keyboardVisible]);

  return covered || held;
}
