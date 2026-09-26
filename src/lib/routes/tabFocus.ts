/**
 * Whether the tab a screen belongs to is the focused tab.
 *
 * Each tab's stack provides its own `useIsFocused()` here (Navigation.tsx),
 * so a screen can tell "my stack is covered by another tab" apart from "a
 * route in my stack covers me" (`useChatLive`, nav-migration §5). Defaults
 * to true outside a tab navigator.
 */

import { createContext } from 'react';

export const TabFocusedContext = createContext<boolean>(true);
TabFocusedContext.displayName = 'TabFocusedContext';
