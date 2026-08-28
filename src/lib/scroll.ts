import type { ScrollViewProps } from 'react-native';

/**
 * One scroll feel, applied to every scrollable so the app decelerates the same
 * way everywhere.
 *
 * `decelerationRate: 'fast'` (~0.99) rather than the RN default 'normal' (~0.998):
 * on Android the default coasts too long and reads as "floaty", where the native
 * RecyclerView fling stops sooner. 'fast' is the closest RN gets to the platform
 * fling on a moderate swipe. (On a hard fling Android's OverScroller ignores the
 * prop — a known RN limitation, RN #35171 — so this is the best a FlatList can do
 * short of a native list.)
 *
 * `overScrollMode: 'auto'` keeps the Android 12+ rubber-band STRETCH at the list
 * ends, which is the stock-Android feel; 'never' would strip it. Spread onto every
 * FlatList/ScrollView via `{...SCROLL_PHYSICS}`.
 */
export const SCROLL_PHYSICS = {
  decelerationRate: 'fast',
  overScrollMode: 'auto',
} as const satisfies Partial<ScrollViewProps>;
