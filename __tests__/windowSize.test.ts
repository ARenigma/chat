import {
  CONTENT_COLUMN_MAX,
  EMOJI_GRID_PAD,
  EMOJI_MIN_COLUMNS,
  contentColumnWidth,
  emojiGridColumns,
  heightSizeClass,
  widthSizeClass,
} from '../src/lib/windowSize';

describe('window size classes', () => {
  it('uses the published Android width breakpoints', () => {
    // https://developer.android.com/develop/ui/views/layout/use-window-size-classes
    expect(widthSizeClass(411)).toBe('compact');
    expect(widthSizeClass(599)).toBe('compact');
    expect(widthSizeClass(600)).toBe('medium');
    expect(widthSizeClass(839)).toBe('medium');
    expect(widthSizeClass(840)).toBe('expanded');
    expect(widthSizeClass(1280)).toBe('expanded');
  });

  it('uses the published Android height breakpoints', () => {
    expect(heightSizeClass(411)).toBe('compact');
    expect(heightSizeClass(479)).toBe('compact');
    expect(heightSizeClass(480)).toBe('medium');
    expect(heightSizeClass(899)).toBe('medium');
    expect(heightSizeClass(900)).toBe('expanded');
  });

  it('does not stretch the phone column on medium or expanded widths', () => {
    expect(contentColumnWidth(411)).toBe(411);
    expect(contentColumnWidth(600)).toBe(CONTENT_COLUMN_MAX);
    expect(contentColumnWidth(1280)).toBe(CONTENT_COLUMN_MAX);
  });

  it('grows the emoji grid by columns rather than by cell', () => {
    // "Avoid stretched UI components ... Add a maximum width to components to
    // avoid stretching."
    // https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability
    //
    // Eight columns was a constant, so on the Redmi Note 7 Pro in landscape
    // (851dp) each cell came to 105dp and one row of emoji no longer fitted in
    // the panel holding it: the first row of search results was cut in half by
    // the keyboard.
    const cell = (w: number) =>
      Math.floor((w - EMOJI_GRID_PAD * 2) / emojiGridColumns(w));
    expect(Math.floor((851 - EMOJI_GRID_PAD * 2) / EMOJI_MIN_COLUMNS)).toBe(105);

    // Portrait is arithmetically untouched — the floor wins at every phone width.
    for (const w of [320, 360, 393, 411]) {
      expect(emojiGridColumns(w)).toBe(EMOJI_MIN_COLUMNS);
    }
    expect(cell(393)).toBe(47);

    // Landscape and tablets take more columns at the same size instead.
    expect(emojiGridColumns(851)).toBe(17);
    for (const w of [320, 360, 393, 411, 600, 851, 1280]) {
      expect(cell(w)).toBeLessThanOrEqual(50);
      // The floor is what makes the smallest cell, and it is the one the
      // eight-column constant already produced on a 320dp phone. Unchanged here
      // deliberately: widening the grid on the narrowest device this app installs
      // on is a separate decision from not stretching it on the widest.
      expect(cell(w)).toBeGreaterThanOrEqual(38);
    }
    expect(cell(320)).toBe(38);
  });
});
