/**
 * Hardware back leaves search, the way the search bar's arrow does, on a tab
 * root (Home, Favourites, and both You tabs).
 *
 * Focus-scoped (https://reactnavigation.org/docs/custom-android-back-button-handling):
 * the listener exists only while this screen is focused AND searching, so it
 * is registered after the NavigationContainer's own and RN consults it first
 * (listeners run last-registered-first), and a covered tab root never hears a
 * press meant for the screen on top. Search is the temporary UI state that
 * back dismisses before the screen itself is left, and it is intercepted only
 * in that state (https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture).
 * nav-migration §4, handler 2.
 */

import { useCallback } from 'react';
import { BackHandler } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';

export function useSearchBack(searching: boolean, closeSearch: () => void): void {
  useFocusEffect(
    useCallback(() => {
      if (!searching) {
        return undefined;
      }
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        closeSearch();
        return true;
      });
      return () => sub.remove();
    }, [searching, closeSearch]),
  );
}
