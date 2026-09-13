import {
  POP_USERNAME_WORDS,
  STAGE_NAME_ADJECTIVES,
  STAGE_NAME_MAX,
  STAGE_NAME_NOUNS,
  USERNAME_SUGGESTION_COUNT,
  stageNamePii,
  stageNamePiiMessage,
  suggestStageName,
  suggestUsernames,
} from '../src/lib/stageName';
import { USERNAME_MAX, USERNAME_MIN, USERNAME_PATTERN, isUsernameLocallyValid } from '../src/lib/username';

describe('stageName: every suggestion passes check_display_name', () => {
  it('walks the whole space and every name is 3–24 chars of [A-Za-z0-9_]', () => {
    expect(STAGE_NAME_MAX).toBe(USERNAME_MAX);
    for (let a = 0; a < STAGE_NAME_ADJECTIVES.length; a += 1) {
      for (let n = 0; n < STAGE_NAME_NOUNS.length; n += 1) {
        // Two draws per suggestion: adjective, then noun.
        const draws = [a / STAGE_NAME_ADJECTIVES.length, n / STAGE_NAME_NOUNS.length];
        const name = suggestStageName(() => draws.shift() ?? 0);
        expect(name).toBe(`${STAGE_NAME_ADJECTIVES[a]}${STAGE_NAME_NOUNS[n]}`);
        expect(name).toMatch(USERNAME_PATTERN);
        expect(name.length).toBeGreaterThanOrEqual(USERNAME_MIN);
        expect(name.length).toBeLessThanOrEqual(USERNAME_MAX);
        expect(isUsernameLocallyValid(name)).toBe(true);
      }
    }
  });

  it('clamps a random source at either edge instead of reading off the end', () => {
    expect(suggestStageName(() => 0)).toBe(`${STAGE_NAME_ADJECTIVES[0]}${STAGE_NAME_NOUNS[0]}`);
    expect(suggestStageName(() => 0.999999)).toBe(
      `${STAGE_NAME_ADJECTIVES[STAGE_NAME_ADJECTIVES.length - 1]}${STAGE_NAME_NOUNS[STAGE_NAME_NOUNS.length - 1]}`,
    );
    expect(suggestStageName(() => 1)).toBe(
      `${STAGE_NAME_ADJECTIVES[STAGE_NAME_ADJECTIVES.length - 1]}${STAGE_NAME_NOUNS[STAGE_NAME_NOUNS.length - 1]}`,
    );
  });

  it('never suggests a word a stranger should not read at 2am', () => {
    const banned = /god|devi|shiva|allah|jesus|brahmin|dalit|sexy|hot|babe|baby|queen|king|boss/i;
    for (const w of [...STAGE_NAME_ADJECTIVES, ...STAGE_NAME_NOUNS]) {
      expect(w).not.toMatch(banned);
      // CamelCase seams depend on each word being Capitalised.
      expect(w).toMatch(/^[A-Z][a-z]+$/);
    }
  });
});

describe('stageName: a stage name must not be the person', () => {
  it('catches the real name at a word boundary, in any case, joined or not', () => {
    expect(stageNamePii('AmitListens', 'AMIT RANJAN')).toBe('real_name');
    expect(stageNamePii('amit_r', 'Amit Ranjan')).toBe('real_name');
    expect(stageNamePii('ravilistens', 'Ravi Kumar')).toBe('real_name');
    expect(stageNamePii('TheRealRanjan', 'Amit Ranjan')).toBe('real_name');
    expect(stageNamePii('Priya', 'Priya Sharma')).toBe('real_name');
  });

  it('does not flag a name that merely contains the letters', () => {
    expect(stageNamePii('Gravity', 'Ravi Kumar')).toBeNull();
    expect(stageNamePii('QuietHarbour', 'Amit Ranjan')).toBeNull();
    expect(stageNamePii('Cosmic', 'Om Prakash')).toBeNull();
  });

  it('ignores PAN-name fragments under three letters and copes with no PAN name', () => {
    expect(stageNamePii('OmMeadow', 'Om Prakash')).toBeNull();
    expect(stageNamePii('KindRiver', null)).toBeNull();
    expect(stageNamePii('KindRiver', '   ')).toBeNull();
  });

  it('blocks a phone number, and a phone number outranks a name match', () => {
    expect(stageNamePii('Quiet9876543210', null)).toBe('phone');
    // Split by a separator: no six-digit run, but ten digits in total.
    expect(stageNamePii('Amit_98765_43210', 'Amit Ranjan')).toBe('phone');
    expect(stageNamePii('Quiet22', null)).toBeNull();
    expect(stageNamePii('Room101_Flat2024', null)).toBeNull();
  });

  it('has a sentence for each kind', () => {
    expect(stageNamePiiMessage('phone')).toMatch(/phone number/);
    expect(stageNamePiiMessage('real_name')).toMatch(/real name/);
  });
});

describe('member usernames: every suggestion passes check_display_name', () => {
  /** A source that replays a script and then holds its last value. */
  const seeded = (draws: readonly number[]): (() => number) => {
    let i = 0;
    return () => draws[Math.min(i++, draws.length - 1)] ?? 0;
  };

  it('walks every word at both number edges and stays inside the charset', () => {
    for (let w = 0; w < POP_USERNAME_WORDS.length; w += 1) {
      const draw = w / POP_USERNAME_WORDS.length;
      for (const number of [0, 0.5, 0.999999, 1]) {
        for (const separator of [0, 0.9]) {
          const name = suggestUsernames(1, seeded([draw, number, separator]))[0]!;
          expect(name.startsWith(POP_USERNAME_WORDS[w]!)).toBe(true);
          expect(name).toMatch(USERNAME_PATTERN);
          expect(name.length).toBeGreaterThanOrEqual(USERNAME_MIN);
          expect(name.length).toBeLessThanOrEqual(USERNAME_MAX);
          expect(isUsernameLocallyValid(name)).toBe(true);
        }
      }
    }
  });

  it('is word, then an optional underscore, then two or three digits', () => {
    /*
     * The shape Amit asked for ("baazigar123!") minus the "!": migration 040's
     * check_display_name answers anything outside [a-zA-Z0-9_] with
     * {status:'invalid'}, so a suggestion carrying a "!" could be tapped and
     * would then fail the live check with no way forward but hand-editing. The
     * underscore is the only punctuation the charset has.
     */
    const shape = new RegExp(`^(${POP_USERNAME_WORDS.join('|')})_?\\d{2,3}$`);
    for (let i = 0; i < 400; i += 1) {
      expect(suggestUsernames(1)[0]).toMatch(shape);
    }
  });

  it('never runs to six digits, which stageNamePii reads as a phone number', () => {
    // Not a rule the member screen enforces — the member has no PAN name to
    // give away — but a name we suggest on one screen must not be one the other
    // screen would warn about.
    for (let i = 0; i < 400; i += 1) {
      expect(stageNamePii(suggestUsernames(1)[0]!, null)).toBeNull();
    }
  });

  it('is deterministic: the same draws give the same names', () => {
    const draws = [0.42, 0.17, 0.81];
    expect(suggestUsernames(3, seeded(draws))).toEqual(suggestUsernames(3, seeded(draws)));
    // Anchored rather than only self-consistent, so a change to the draw ORDER
    // (word, then number, then separator) fails here instead of silently
    // reshuffling every suggestion the app has ever made.
    expect(suggestUsernames(1, () => 0)).toEqual([`${POP_USERNAME_WORDS[0]}_10`]);
  });

  it('offers three at a time, all different', () => {
    for (let i = 0; i < 200; i += 1) {
      const set = suggestUsernames();
      expect(set).toHaveLength(USERNAME_SUGGESTION_COUNT);
      expect(new Set(set).size).toBe(USERNAME_SUGGESTION_COUNT);
    }
  });

  it('is still all different when the source returns a constant', () => {
    /*
     * The case that rules out a redraw-until-unique loop. A stubbed or seeded
     * source can return one value forever, and a loop would then either spin or
     * hand back three copies of one name; walking consecutive words cannot.
     */
    for (const constant of [0, 0.5, 1]) {
      const set = suggestUsernames(USERNAME_SUGGESTION_COUNT, () => constant);
      expect(new Set(set).size).toBe(USERNAME_SUGGESTION_COUNT);
    }
  });

  it('clamps a request for more names than there are words', () => {
    // Wrapping the walk is the one way this function could repeat itself.
    const set = suggestUsernames(POP_USERNAME_WORDS.length + 5, () => 0);
    expect(set).toHaveLength(POP_USERNAME_WORDS.length);
    expect(new Set(set).size).toBe(POP_USERNAME_WORDS.length);
  });

  it('keeps the list recognisable, tasteful, and nobody in particular', () => {
    // Same bar as the provider list above, plus the two this list adds: no
    // performer's name (impersonation), and no ordinary first name — "Rahul" is
    // a reference and also what a chunk of the directory is actually called.
    const banned = /god|devi|shiva|allah|jesus|brahmin|dalit|sexy|hot|babe|baby|queen|king|boss/i;
    const people = /^(Rahul|Simran|Anjali|Priya|Raj|Amit|Ravi|Vijay|Geet)$/i;
    for (const w of POP_USERNAME_WORDS) {
      expect(w).not.toMatch(banned);
      expect(w).not.toMatch(people);
      expect(w).toMatch(/^[A-Z][a-z]+$/);
      // Longest word + '_' + three digits must still clear 24.
      expect(w.length).toBeLessThanOrEqual(USERNAME_MAX - 4);
    }
    expect(new Set(POP_USERNAME_WORDS).size).toBe(POP_USERNAME_WORDS.length);
    // Amit's own example, kept as the anchor of the flavour.
    expect(POP_USERNAME_WORDS).toContain('Baazigar');
  });
});
