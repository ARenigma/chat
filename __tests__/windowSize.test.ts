import {
  CONTENT_COLUMN_MAX,
  contentColumnWidth,
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
});
