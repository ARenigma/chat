/**
 * How far scroll content must pad its bottom to clear the bottom bar.
 *
 * Computed from the SAME parts the bar is built from, not measured: the slot
 * (`interaction.minTarget`), the clamped navigation inset (`clampBottomInset`,
 * the one clamp the bar also calls) and the hairline. Measuring would give 0 on
 * the first frame and a jump on the second.
 *
 * It replaces every `insets.bottom + NAV_BAR_HEIGHT` (wired in step 7).
 *
 * adapted from bluesky-social/social-app src/lib/hooks/useBottomBarOffset.ts
 * (MIT), see THIRD_PARTY_LICENSES.md. Bluesky's `clamp(60 + inset, 60, 75)`
 * encodes its own bar; this one encodes ours.
 */

import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { INTERACTION } from '../theme/motion';
import { clampBottomInset } from './bottom-bar/BottomBarStyles';

export function useBottomBarOffset(modifier = 0): number {
  const { bottom } = useSafeAreaInsets();
  return INTERACTION.minTarget + clampBottomInset(bottom) + StyleSheet.hairlineWidth + modifier;
}
