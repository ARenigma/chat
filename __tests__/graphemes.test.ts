import { deleteLastGrapheme, lastGraphemeLength } from '../src/lib/graphemes';

/**
 * Node ships `Intl.Segmenter`; Hermes does not, which is the whole reason the
 * walker exists. So the platform segmenter is the *oracle* here and nowhere in
 * the app: it decides what the right answer is, the walker has to match it.
 * Feature-detected so the suite still runs on an engine without it.
 */
interface GraphemeSegmenter {
  segment(input: string): Iterable<{ segment: string }>;
}

/**
 * Declared locally rather than by widening `lib` in tsconfig.
 *
 * The React Native base config lists `lib` explicitly — es2019 plus a handful of
 * named later slices — because that is what Hermes actually implements. Adding
 * `es2022.intl` to reach `Intl.Segmenter` would make it typecheck EVERYWHERE,
 * including in `src/`, where calling it crashes at runtime. The oracle is a test
 * concern, so the type stays a test concern.
 */
const IntlWithSegmenter = Intl as unknown as {
  Segmenter?: new (
    locale?: string,
    options?: { granularity: 'grapheme' },
  ) => GraphemeSegmenter;
};

const segmenter =
  typeof IntlWithSegmenter.Segmenter === 'function'
    ? new IntlWithSegmenter.Segmenter(undefined, { granularity: 'grapheme' })
    : null;

const lastSegment = (s: string): string => {
  let out = '';
  for (const { segment } of segmenter!.segment(s)) {
    out = segment;
  }
  return out;
};

describe('deleteLastGrapheme', () => {
  it.each([
    // [input, expected, why]
    ['ab👍🏽', 'ab', 'Fitzpatrick modifier takes its base'],
    ['x✌️', 'x', 'FE0F presentation selector takes its base'],
    ['x👨‍👩‍👧‍👦', 'x', 'ZWJ family is one cluster'],
    ['x🏳️‍🌈', 'x', 'ZWJ over an FE0F-qualified base'],
    ['🇮🇳', '', 'an even run of regional indicators is a flag'],
    ['🇮🇳🇮', '🇮🇳', 'an odd run leaves the flag and takes the lone indicator'],
    ['x1️⃣', 'x', 'keycap takes FE0F and the digit'],
    ['x🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'x', 'tag sequence runs back to the 1F3F4 base'],
    ['x🧑🏽‍🤝‍🧑🏿', 'x', 'tone on each person of a ZWJ sequence'],
    ['abc', 'ab', 'plain text goes one character at a time'],
    ['', '', 'empty stays empty'],
  ])('%s → %s (%s)', (input, expected) => {
    expect(deleteLastGrapheme(input)).toBe(expected);
  });

  it('deletes Indic combining marks per code point, matching Gboard', () => {
    // Chosen, not missed: `कि` is `0915 093F`, and Gboard's backspace removes the
    // matra first. A full UAX #29 segmenter would remove both, which is the
    // behaviour the file header says not to build. Asserted so an "improvement"
    // fails here and has to argue with the header.
    expect(deleteLastGrapheme('कि')).toBe('क');
    if (segmenter) {
      // And the oracle disagrees, which is the point: this is a deliberate departure.
      expect(lastSegment('कि')).toBe('कि');
    }
  });

  it('never throws on a lone surrogate', () => {
    const highOnly = 'x\uD83D';
    expect(() => deleteLastGrapheme(highOnly)).not.toThrow();
    expect(deleteLastGrapheme(highOnly)).toBe('x');
    expect(deleteLastGrapheme('x\uDC00')).toBe('x');
    // A lone low surrogate right after a pair must not be glued onto it.
    expect(deleteLastGrapheme('👍\uDC00')).toBe('👍');
    expect(lastGraphemeLength('\uD83D')).toBe(1);
  });
});

describe('lastGraphemeLength', () => {
  it('is zero only for the empty string', () => {
    expect(lastGraphemeLength('')).toBe(0);
    expect(lastGraphemeLength('a')).toBe(1);
    expect(lastGraphemeLength('👍')).toBe(2);
  });

  /**
   * Assorted emoji across every shape the walker handles. Each one is a single
   * cluster; deleting it from `'x' + e` must give back `'x'`, and the length it
   * claims must be exactly what the platform segmenter says.
   */
  const EMOJI = [
    // Plain and presentation-selected
    '😀',
    '🎉',
    '❤️',
    '☺️',
    '✌️',
    '©️',
    '™️',
    '⚠️',
    '🅰️',
    '🕴️',
    // Toned
    '👍🏻',
    '👍🏽',
    '👍🏿',
    '☝🏽',
    '🙏🏻',
    '👋🏾',
    '🖐🏽',
    '✍🏿',
    // ZWJ sequences
    '👨‍👩‍👧‍👦',
    '👩‍❤️‍👨',
    '👩‍❤️‍💋‍👨',
    '👨‍💻',
    '👩🏽‍💻',
    '🧑🏽‍🤝‍🧑🏿',
    '👨🏻‍🤝‍👨🏿',
    '🏳️‍🌈',
    '🏳️‍⚧️',
    '🐻‍❄️',
    '🐕‍🦺',
    '😮‍💨',
    '❤️‍🔥',
    '🧑‍🚀',
    '👨🏾‍🦰',
    '👩‍🦽',
    '🏴‍☠️',
    '🧔‍♀️',
    '🙋🏼‍♂️',
    '🏋️‍♀️',
    '⛹🏽‍♀️',
    // Flags
    '🇮🇳',
    '🇺🇸',
    '🇯🇵',
    '🇧🇷',
    // Keycaps
    '1️⃣',
    '#️⃣',
    '*️⃣',
    '0️⃣',
    // Tag sequences
    '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
    '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
    '🏴󠁧󠁢󠁷󠁬󠁳󠁿',
  ];

  it.each(EMOJI)('%s is deleted whole', emoji => {
    expect(deleteLastGrapheme('x' + emoji)).toBe('x');
    expect(deleteLastGrapheme(emoji)).toBe('');
  });

  (segmenter ? it.each(EMOJI) : it.skip.each(EMOJI))(
    '%s agrees with Intl.Segmenter',
    emoji => {
      // The fixture itself must be one cluster, or the oracle would be agreeing
      // about something other than "delete the whole emoji".
      expect(Array.from(segmenter!.segment(emoji))).toHaveLength(1);
      const text = 'x' + emoji;
      expect(lastGraphemeLength(text)).toBe(lastSegment(text).length);
      expect(lastGraphemeLength(emoji + emoji)).toBe(lastSegment(emoji + emoji).length);
    },
  );
});
