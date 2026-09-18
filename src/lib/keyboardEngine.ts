/**
 * The IME's UI-thread position, and the settled numbers the layout mirrors.
 *
 * ---------------------------------------------------------------------------
 * Why this exists alongside `useChatImeStore`
 * ---------------------------------------------------------------------------
 * `Keyboard`'s `Did` listeners fire once, at the END of the IME animation, on
 * the JS thread — every frame of the keyboard's travel in between is invisible,
 * so anything that must move WITH the keyboard (the dock, the transcript pad)
 * can only snap after it. `react-native-keyboard-controller` observes the same
 * event the platform animates — `WindowInsetsAnimationCompat` — and reports
 * `height`/`progress` every frame in a worklet, on the UI thread, without a
 * React render.
 * https://developer.android.com/develop/ui/views/layout/insets
 *
 * Two outputs, two consumers:
 * - `height`/`progress` shared values stay on the UI thread for
 *   `useAnimatedStyle` translations. Nothing here re-renders per frame.
 * - `onSettled` fires once per completed movement on the JS thread and mirrors
 *   the numbers into the ChatScreen IME store, so the existing discrete layout
 *   keeps working while surfaces migrate to the shared values one by one.
 *
 * `useGenericKeyboardHandler`, NOT `useKeyboardHandler`: the latter calls
 * `useResizeMode()`, which forces SOFT_INPUT_ADJUST_RESIZE at runtime and would
 * silently undo the manifest's adjustNothing. The generic variant subscribes to
 * the same inset events with no mode side effect.
 *
 * Heights persist through `keyboardPanel.ts`, keyed per orientation, so the
 * docked emoji/attach panels keep opening at exactly the keyboard's size.
 */
import { useCallback, useEffect, useRef } from 'react';
import { useWindowDimensions } from 'react-native';
import {
  runOnJS,
  useSharedValue,
  type SharedValue,
} from 'react-native-reanimated';
import { useGenericKeyboardHandler } from 'react-native-keyboard-controller';
import { writeKeyboardHeight } from './keyboardPanel';

export interface KeyboardSettled {
  /** Settled IME height in dp. 0 when the keyboard is down. */
  height: number;
  /** True when the movement ended with the keyboard up. */
  shown: boolean;
}

export interface KeyboardEngine {
  /** Live IME height in dp, UI thread. Do not read during render. */
  height: SharedValue<number>;
  /** 0 (down) → 1 (up) across the travel, UI thread. */
  progress: SharedValue<number>;
}

export function useKeyboardEngine(
  onSettled?: (s: KeyboardSettled) => void,
): KeyboardEngine {
  const height = useSharedValue(0);
  const progress = useSharedValue(0);
  const { width, height: winH } = useWindowDimensions();
  const landscape = width > winH;

  // The subscriber must not re-subscribe the inset listener: rotation (the
  // `landscape` dep) is the only re-subscription trigger. A ref mirror keeps
  // the worklet's JS callback stable across parent renders.
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);

  const notify = useCallback((h: number, shown: boolean) => {
    settledRef.current?.({ height: h, shown });
  }, []);

  // `landscape` is captured per subscription; a rotation re-subscribes, which
  // is rare enough that a listener re-attach is unmeasurable.
  useGenericKeyboardHandler(
    {
      onStart: e => {
        'worklet';
        if (e.height > 0) {
          height.value = e.height;
        }
      },
      onMove: e => {
        'worklet';
        progress.value = e.progress;
        height.value = e.height;
      },
      onEnd: e => {
        'worklet';
        height.value = e.height;
        progress.value = e.progress;
        // JS-thread work only at rest: persisting the height and notifying the
        // store. Per-frame scheduling back to JS is what makes animations jank.
        if (e.height > 0) {
          runOnJS(writeKeyboardHeight)(e.height, landscape);
        }
        runOnJS(notify)(e.height, e.progress === 1);
      },
    },
    [landscape],
  );

  return { height, progress };
}
