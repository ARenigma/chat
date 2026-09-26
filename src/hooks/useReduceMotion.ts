import { type MutableRefObject, useEffect, useRef } from 'react';
import { AccessibilityInfo } from 'react-native';

/**
 * Tracks the OS "reduce motion" accessibility preference and returns a ref
 * whose `.current` is always up to date.
 *
 * A ref rather than state keeps worklet closures from capturing a stale
 * snapshot: the value is read inside Reanimated callbacks (e.g. `onPress` on
 * PressableScale) that run after render, so a ref is the right primitive.
 * Components that need to re-render on a change (rare) should call
 * `useReducedMotion` from react-native-reanimated, which returns a boolean
 * captured at app start.
 *
 * Usage:
 *   const reduceMotion = useReduceMotion();
 *   // inside any callback or effect:
 *   if (!reduceMotion.current) { animate(); }
 */
export function useReduceMotion(): MutableRefObject<boolean> {
  const reduceMotion = useRef(false);

  useEffect(() => {
    void AccessibilityInfo.isReduceMotionEnabled().then(enabled => {
      reduceMotion.current = enabled;
    });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', enabled => {
      reduceMotion.current = enabled;
    });
    return () => sub.remove();
  }, []);

  return reduceMotion;
}
