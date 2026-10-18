import { useRef } from 'react';
import { LayoutAnimation } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { REORDER_MS } from '../theme/motion';

/** Rows moved, arrived or left — but not the first rows appearing. */
export function rowsChanged(previous: string | null, next: string): boolean {
  return previous !== null && previous !== '' && next !== '' && previous !== next;
}

/**
 * Animates the next layout when a FlashList's rows change order, so a
 * conversation a new message lifts is seen to move instead of teleporting.
 *
 * FlashList recycles its cells, so Reanimated's per-item layout transitions are
 * not the tool; its own guide says to call the list's
 * `prepareForLayoutAnimationRender()` and then `LayoutAnimation.configureNext`
 * before the data change renders, with a unique `keyExtractor`
 * (shopify.github.io/flash-list/docs/guides/layout-animation). That is why this
 * runs during render: by an effect, the reordered frame is already committed and
 * there is nothing left to animate. Calling it twice (StrictMode) is harmless.
 *
 * The first rows (nothing → data) are an arrival, not a move, and never animate.
 * Reduced motion: no animation.
 */
export function useReorderAnimation(
  keys: readonly string[],
  prepare: () => void,
): void {
  const reduced = useReducedMotion();
  const previous = useRef<string | null>(null);
  const signature = keys.join('\n');
  if (!reduced && rowsChanged(previous.current, signature)) {
    prepare();
    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        REORDER_MS,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.opacity,
      ),
    );
  }
  previous.current = signature;
}
