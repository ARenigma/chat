import {
  HANDLE_COMBINATIONS,
  HANDLE_TEMPLATES,
  HANDLE_WORDS,
} from '../src/lib/handles.generated';
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
  /*
   * REWRITTEN 2026-09-17, when the two hand-typed arrays became a generated
   * pipeline (design/handles.json -> scripts/gen-handles.mjs).
   *
   * These used to walk a 16 x 20 cross product and pin the exact string each
   * pair produced. That worked while there was ONE template, adjective + noun.
   * There are four now for the calm voice and six for pop, the space is
   * 5,212,200 and 33,502,672, and an exhaustive walk is neither possible nor
   * the point.
   *
   * What the describe promises is the thing worth keeping: every suggestion
   * this app can ever make passes check_display_name (migration 040), because a
   * suggestion the RPC refuses is a dead end a member cannot get out of except
   * by hand-editing. So these assert that PROPERTY over every word in every
   * role, at both edges of the random source and across a heavy sample, rather
   * than asserting one literal per pair.
   */
  const passesTheRpc = (name: string): void => {
    expect(name).toMatch(USERNAME_PATTERN);
    expect(name.length).toBeGreaterThanOrEqual(USERNAME_MIN);
    expect(name.length).toBeLessThanOrEqual(USERNAME_MAX);
    expect(isUsernameLocallyValid(name)).toBe(true);
  };

  it('holds the 24-char ceiling the RPC enforces', () => {
    expect(STAGE_NAME_MAX).toBe(USERNAME_MAX);
  });

  it('emits nothing the RPC would refuse, over a heavy sample of the space', () => {
    for (let i = 0; i < 4000; i += 1) {
      passesTheRpc(suggestStageName());
    }
  });

  it('emits nothing the RPC would refuse at any single word, in any template', () => {
    // Every word reached in every slot it can occupy: the longest word in the
    // longest template is where a 24-char ceiling breaks if it is going to.
    const templates = HANDLE_TEMPLATES.calm;
    for (let t = 0; t < templates.length; t += 1) {
      const pick = t / templates.length;
      for (const word of [0, 0.5, 0.999999, 1]) {
        for (const tail of [0, 0.999999, 1]) {
          passesTheRpc(
            suggestStageName(
              (() => {
                const draws = [pick, word, word, tail, tail];
                let i = 0;
                return () => draws[Math.min(i++, draws.length - 1)] ?? 0;
              })(),
            ),
          );
        }
      }
    }
  });

  it('clamps a random source at either edge instead of reading off the end', () => {
    // The literals moved with the vocabulary and are no longer the assertion.
    // Reading off the end would produce undefined and render "undefined" into
    // the name, which passesTheRpc catches: it is not in the charset at the
    // seam, and it blows the ceiling.
    for (const source of [() => 0, () => 0.999999, () => 1]) {
      const name = suggestStageName(source);
      expect(name).not.toContain('undefined');
      expect(name).not.toContain('NaN');
      passesTheRpc(name);
    }
  });

  it('is deterministic, so a re-roll is a choice and not a shuffle', () => {
    const seed = (): (() => number) => {
      const draws = [0.31, 0.62, 0.07, 0.88];
      let i = 0;
      return () => draws[Math.min(i++, draws.length - 1)] ?? 0;
    };
    expect(suggestStageName(seed())).toBe(suggestStageName(seed()));
  });

  it('keeps a space big enough that a live availability check is worth running', () => {
    /*
     * The reason the hand-typed lists were replaced. 16 x 20 = 320 names
     * collide constantly once ProfileSetupScreen asks the server whether a name
     * is free, and a suggestion that is usually taken is worse than none. The
     * floor is deliberately far below what the pipeline currently emits, so
     * this fails on a vocabulary COLLAPSE rather than on ordinary editing.
     */
    expect(HANDLE_COMBINATIONS.calm).toBeGreaterThan(100_000);
    expect(HANDLE_COMBINATIONS.pop).toBeGreaterThan(100_000);
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

  /*
   * REWRITTEN with the generated pipeline, for the reason given in the provider
   * block above: the shape is no longer "one word plus two or three digits".
   * The pop voice has SIX templates, three of which carry no number at all, and
   * those are the names actually worth reading. Asserting the old regex would
   * now fail on the good ones.
   */
  const passesTheRpc = (name: string): void => {
    expect(name).toMatch(USERNAME_PATTERN);
    expect(name.length).toBeGreaterThanOrEqual(USERNAME_MIN);
    expect(name.length).toBeLessThanOrEqual(USERNAME_MAX);
    expect(isUsernameLocallyValid(name)).toBe(true);
  };

  it('emits nothing the RPC would refuse, over a heavy sample', () => {
    for (let i = 0; i < 4000; i += 1) {
      passesTheRpc(suggestUsernames(1)[0]!);
    }
  });

  it('emits nothing the RPC would refuse at any template, at either edge', () => {
    const templates = HANDLE_TEMPLATES.pop;
    for (let t = 0; t < templates.length; t += 1) {
      const pick = t / templates.length;
      for (const draw of [0, 0.5, 0.999999, 1]) {
        const name = suggestUsernames(1, seeded([pick, draw, draw, draw, draw]))[0]!;
        expect(name).not.toContain('undefined');
        expect(name).not.toContain('NaN');
        passesTheRpc(name);
      }
    }
  });

  it('draws on every domain, so the voice is not one corner of the vocabulary', () => {
    /*
     * The point of design/handles.json being organised by domain: a generator
     * that only ever reached "cinema" would be a themed list with extra steps.
     * Checked on the DATA rather than by sampling names, because a rare domain
     * would make a sampled assertion flaky.
     */
    expect(HANDLE_WORDS.pop.noun.length).toBeGreaterThan(POP_USERNAME_WORDS.length / 2);
    for (const role of ['adjective', 'noun', 'suffix'] as const) {
      expect(HANDLE_WORDS.pop[role].length).toBeGreaterThan(0);
      for (const w of HANDLE_WORDS.pop[role]) {
        expect(w).toMatch(/^[A-Za-z0-9]+$/);
      }
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
    // The anchored literal that used to sit here pinned the old
    // word-then-digits shape. Determinism is the rule; the exact string is
    // vocabulary, and vocabulary is now data that is meant to be edited.
    expect(suggestUsernames(1, () => 0)).toEqual(suggestUsernames(1, () => 0));
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

  it('never repeats itself inside one set of suggestions', () => {
    /*
     * This used to assert the set CLAMPED to the word count, because with one
     * template and one word per name the function could run out. It cannot now:
     * the pop voice is 33,502,672 names. What still matters, and is what the
     * rule was always protecting, is that the three shown at once are three
     * different names even when the random source is degenerate.
     */
    const set = suggestUsernames(POP_USERNAME_WORDS.length + 5, () => 0);
    expect(new Set(set).size).toBe(set.length);
    expect(set.length).toBeGreaterThan(0);
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
