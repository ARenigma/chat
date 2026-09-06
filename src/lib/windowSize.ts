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
export const WIDTH_MEDIUM_MIN = 600;
/** Width at which the window becomes expanded. */
export const WIDTH_EXPANDED_MIN = 840;
/** Height at which the window leaves compact. */
export const HEIGHT_MEDIUM_MIN = 480;
/** Height at which the window becomes expanded. */
export const HEIGHT_EXPANDED_MIN = 900;

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

/**
 * The emoji grid's horizontal padding, in dp. Telegram's own
 * (`EmojiView.java:1751`, recorded in design/references/telegram.md); it lives
 * here because the column count is computed from the same number.
 */
export const EMOJI_GRID_PAD = 5;

/**
 * The narrowest the grid's column count may go. Eight is what a 393dp phone fits
 * at a comfortable 44dp target — the same count every system keyboard uses at
 * this width.
 */
export const EMOJI_MIN_COLUMNS = 8;

/** The cell size the count exists to preserve, in dp. */
export const EMOJI_TARGET_CELL = 48;

/**
 * Columns in the emoji grid: the CELL is held and the count grows with the
 * window, rather than eight columns stretching to fill it.
 *
 * Eight was a constant, so on the Redmi Note 7 Pro in landscape (851dp) each
 * cell came to 105dp and one row of emoji no longer fitted inside the panel
 * holding it — the first row of search results was cut in half by the keyboard
 * (measured 2026-09-06).
 *
 * "Avoid stretched UI components: Layouts designed for standard, portrait phone
 * screens can fail to accommodate other aspect ratios... Add a maximum width to
 * components to avoid stretching."
 * https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability
 *
 * Portrait is arithmetically unchanged: 383/48 floors to 7, the floor wins, and
 * the cell stays the 47dp it has always been.
 */
export function emojiGridColumns(windowWidthDp: number): number {
  const usable = windowWidthDp - EMOJI_GRID_PAD * 2;
  return Math.max(EMOJI_MIN_COLUMNS, Math.floor(usable / EMOJI_TARGET_CELL));
}
