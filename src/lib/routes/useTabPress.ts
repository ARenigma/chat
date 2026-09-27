/**
 * Runs `onPress` whenever the bottom-bar button for `tab` is pressed: a re-tap,
 * a pop back to the tab's root, or arriving from another tab.
 *
 * Not focus-gated, on purpose: a Home left in search on the way to Favourites
 * must hear the Home press that brings it back, and it is not focused yet when
 * that press lands. The handler is read through a ref, so an inline function
 * does not re-subscribe every render.
 */
import { useEffect, useRef } from 'react';
import { listenTabPress } from '../events';

export function useTabPress(tab: string, onPress: () => void): void {
  const handler = useRef(onPress);
  handler.current = onPress;
  useEffect(
    () =>
      listenTabPress(pressed => {
        if (pressed === tab) {
          handler.current();
        }
      }),
    [tab],
  );
}
