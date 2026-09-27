/**
 * Material / Android window size classes, in density-independent pixels.
 *
 * Width breakpoints from
 * https://developer.android.com/develop/ui/views/layout/use-window-size-classes
 * and the matching Compose table at
 * https://developer.android.com/develop/ui/compose/layouts/adaptive/use-window-size-classes
 *
 *   compact  < 600
 *   medium   600–839
 *   expanded ≥ 840
 *
 * Height classes exist on the same page (compact < 480) and are exported so a
 * short landscape window can be detected without inventing a second scale.
 *
 * `contentColumnWidth` is the structural large-screen rule for this app: do not
 * stretch a phone-designed column across a tablet. Two-pane list/detail is a
 * later product decision, not a substitute for this floor.
 */

export type WidthSizeClass = 'compact' | 'medium' | 'expanded';
export type HeightSizeClass = 'compact' | 'medium' | 'expanded';

/** Width at which the window leaves compact. */
const WIDTH_MEDIUM_MIN = 600;
/** Width at which the window becomes expanded. */
const WIDTH_EXPANDED_MIN = 840;
/** Height at which the window leaves compact. */
const HEIGHT_MEDIUM_MIN = 480;
/** Height at which the window becomes expanded. */
const HEIGHT_EXPANDED_MIN = 900;

/** Phone-column width used on medium and expanded windows. */
export const CONTENT_COLUMN_MAX = 600;

export function widthSizeClass(widthDp: number): WidthSizeClass {
  if (widthDp < WIDTH_MEDIUM_MIN) return 'compact';
  if (widthDp < WIDTH_EXPANDED_MIN) return 'medium';
  return 'expanded';
}

export function heightSizeClass(heightDp: number): HeightSizeClass {
  if (heightDp < HEIGHT_MEDIUM_MIN) return 'compact';
  if (heightDp < HEIGHT_EXPANDED_MIN) return 'medium';
  return 'expanded';
}

export function contentColumnWidth(windowWidthDp: number): number {
  return widthSizeClass(windowWidthDp) === 'compact'
    ? windowWidthDp
    : Math.min(windowWidthDp, CONTENT_COLUMN_MAX);
}
