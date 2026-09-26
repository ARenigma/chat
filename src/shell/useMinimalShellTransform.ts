/**
 * The bottom bar's hide/show style, derived on the UI thread from the
 * minimal-shell `footerMode` and the bar's measured height.
 *
 * Opacity `(1 - v)^2` (so the bar is mostly gone before it has moved far) and
 * translateY `0 -> footerHeight`, both from Bluesky. Under the OS reduced-motion
 * setting the translate is omitted and only the fade remains: reduced motion
 * means fewer and gentler, keep the opacity that explains the change, drop the
 * movement (animate-expo step 9). The fade still runs because `footerMode`
 * springs with `ReduceMotion.Never` (minimalMode.tsx).
 *
 * adapted from bluesky-social/social-app src/lib/hooks/useMinimalShellTransform.ts
 * (MIT), see THIRD_PARTY_LICENSES.md
 */

import { interpolate, useAnimatedStyle, useReducedMotion } from 'react-native-reanimated';
import { useMinimalShellMode } from './minimalMode';
import { useShellLayout } from './shellLayout';

export function useMinimalShellFooterTransform() {
  const { footerMode } = useMinimalShellMode();
  const { footerHeight } = useShellLayout();
  // Captured at app start and constant, so the style's key set never changes.
  const reduced = useReducedMotion();

  return useAnimatedStyle(() => {
    const v = footerMode.get();
    const opacity = (1 - v) * (1 - v);
    if (reduced) {
      return { opacity };
    }
    return {
      opacity,
      transform: [{ translateY: interpolate(v, [0, 1], [0, footerHeight.get()]) }],
    };
  });
}
