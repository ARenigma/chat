jest.mock('react-native-reanimated', () => ({ useReducedMotion: () => false }));
jest.mock('../src/theme/motion', () => ({ REORDER_MS: 140 }));
import { rowsChanged } from '../src/lib/reorder';

describe('rowsChanged', () => {
  it('animates a conversation moving to the top', () => {
    expect(rowsChanged('a\nb\nc', 'c\na\nb')).toBe(true);
  });
  it('animates a conversation arriving or leaving', () => {
    expect(rowsChanged('a\nb', 'x\na\nb')).toBe(true);
    expect(rowsChanged('a\nb', 'a')).toBe(true);
  });
  it('does not animate the first rows appearing, or nothing changing', () => {
    expect(rowsChanged(null, 'a\nb')).toBe(false);
    expect(rowsChanged('', 'a\nb')).toBe(false);
    expect(rowsChanged('a\nb', 'a\nb')).toBe(false);
    expect(rowsChanged('a\nb', '')).toBe(false);
  });
});
