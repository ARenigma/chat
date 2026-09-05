import {
  STAGE_NAME_ADJECTIVES,
  STAGE_NAME_MAX,
  STAGE_NAME_NOUNS,
  stageNamePii,
  stageNamePiiMessage,
  suggestStageName,
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
