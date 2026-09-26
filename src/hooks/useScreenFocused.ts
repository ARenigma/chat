/**
 * Whether the screen this component is on is focused, safe OUTSIDE a
 * navigator too: it reads `NavigationContext` directly and is `true` when
 * there is none, so the boot phases and Shell-level Modals (which render
 * shared components like Avatar and Skeleton) do not throw the way
 * `useIsFocused` would. Loops on a surface a push can now cover stop on blur
 * (nav-migration §5): native-stack keeps a covered screen mounted, and Freeze
 * stays off (ruling 7), so nothing else stops them.
 */

import { useContext, useEffect, useState } from 'react';
import { NavigationContext } from '@react-navigation/native';

export function useScreenFocused(): boolean {
  const navigation = useContext(NavigationContext);
  const [focused, setFocused] = useState(() => navigation?.isFocused() ?? true);

  useEffect(() => {
    if (navigation === undefined) {
      return undefined;
    }
    setFocused(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => setFocused(true));
    const offBlur = navigation.addListener('blur', () => setFocused(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation]);

  return focused;
}
