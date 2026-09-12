import type { ScrollViewProps } from 'react-native';

/**
 * One scroll feel, applied to every scrollable so the app decelerates the same
 * way everywhere.
 *
 * `decelerationRate: 'normal'`, and this was reversed (Amit, 2026-09-04: "we
 * dont have any spring/inertia on scroll").
 *
 * It used to be 'fast' (~0.99) on the argument that the platform fling stops
 * sooner than RN's default. That is backwards: 'fast' is the SHORTER coast, and
 * setting it is what removed the inertia — a flick stopped almost where it was
 * released instead of carrying, which is the opposite of the stock Android
 * fling. 'normal' (~0.998) is the long curve the platform actually uses, and
 * restores the carry. (On a hard fling Android's OverScroller ignores the prop
 * either way — RN #35171 — so this only governs moderate swipes, which is most
 * of them.)
 *
 * `overScrollMode: 'auto'` keeps the Android 12+ rubber-band STRETCH at the list
 * ends, which is the stock-Android feel; 'never' would strip it. Spread onto every
 * FlashList/ScrollView via `{...SCROLL_PHYSICS}`.
 */
export const SCROLL_PHYSICS = {
  decelerationRate: 'normal',
  overScrollMode: 'auto',
} as const satisfies Partial<ScrollViewProps>;
