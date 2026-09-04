import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_EMOJI,
  EMOJI_BY_CATEGORY,
  EMOJI_CATEGORIES,
  SOURCE,
  TONES,
  emojiForNative,
  searchEmoji,
  supportedEmojiVersion,
  withTone,
} from '../src/lib/emoji';

const ROOT = join(__dirname, '..');

describe('the generated dataset', () => {
  it('is big enough to be a keyboard rather than a shortlist', () => {
    // The hand-typed list this replaced had ~300 entries and a search that
    // found nothing. If a regeneration ever collapses the set, that is the
    // symptom, and it is silent on device.
    expect(ALL_EMOJI.length).toBeGreaterThan(1500);
  });

  it('names its source, so the licence notice is checkable', () => {
    expect(SOURCE.pkg).toBe('@emoji-mart/data');
    expect(SOURCE.set).toBe(15);
    const header = readFileSync(
      join(ROOT, 'src/lib/emoji.generated.ts'),
      'utf8',
    ).slice(0, 1200);
    expect(header).toContain('GENERATED FILE, DO NOT EDIT');
    expect(header).toContain('Missive');
    expect(header).toContain('MIT');
  });

  it('ships nothing from the package at runtime (RULE 5)', () => {
    // The devDependency is read by the generator only. If any file under src/
    // imports it, the package and its transitive weight enter the bundle.
    const generator = readFileSync(join(ROOT, 'scripts/gen-emoji.mjs'), 'utf8');
    expect(generator).toContain('@emoji-mart/data');
    for (const file of ['src/lib/emoji.ts', 'src/lib/emoji.generated.ts']) {
      expect(readFileSync(join(ROOT, file), 'utf8')).not.toMatch(
        /from ['"]@emoji-mart/,
      );
    }
  });

  it('has a non-empty slice behind every tab', () => {
    for (const c of EMOJI_CATEGORIES) {
      if (c.id === 'recent') {
        continue;
      }
      expect(EMOJI_BY_CATEGORY[c.id].length).toBeGreaterThan(0);
    }
  });

  it('has a tab for every category and no orphan category', () => {
    const tabs = EMOJI_CATEGORIES.filter(c => c.id !== 'recent').map(c => c.id);
    expect([...tabs].sort()).toEqual(Object.keys(EMOJI_BY_CATEGORY).sort());
  });
});

describe('the device font gate', () => {
  // A glyph the system font cannot draw renders as a tofu box. The mapping is
  // per Android release; these are the boundaries that matter for this app.
  it.each([
    [24, 4],
    [26, 5],
    [28, 11],
    [29, 12.1],
    [31, 13.1],
    [33, 14],
    [34, 15],
    [36, 15.1],
  ])('API %i draws up to Emoji %s', (api, version) => {
    expect(supportedEmojiVersion(api)).toBe(version);
  });

  it('never goes backwards as the API level rises', () => {
    for (let api = 24; api < 40; api += 1) {
      expect(supportedEmojiVersion(api + 1)).toBeGreaterThanOrEqual(
        supportedEmojiVersion(api),
      );
    }
  });
});

describe('skin tones', () => {
  const raisedHand = ALL_EMOJI.find(e => e.char === '✋');
  const astronaut = ALL_EMOJI.find(e => e.char === '🧑‍🚀');

  it('carries five pre-composed variants, not a modifier to append', () => {
    expect(raisedHand?.skins).toHaveLength(5);
    // The dark variant is the base with the modifier in the right place — which
    // for a bare glyph is the end, and for a ZWJ sequence is not.
    expect(withTone(raisedHand!, TONES[5]!)).toBe('✋🏿');
  });

  it('tones a ZWJ sequence inside the sequence, not after it', () => {
    const toned = withTone(astronaut!, TONES[3]!);
    expect(toned).toBe('🧑🏽‍🚀');
    // The failure this replaces: '🧑‍🚀' + '🏽' put the modifier after the rocket.
    expect(toned).not.toBe('🧑‍🚀\u{1F3FD}');
  });

  it('leaves an emoji that takes no tone alone', () => {
    const pizza = ALL_EMOJI.find(e => e.char === '🍕');
    expect(pizza?.skins).toBeUndefined();
    expect(withTone(pizza!, TONES[5]!)).toBe('🍕');
  });

  it('finds the base entry from an already-toned string', () => {
    expect(emojiForNative('✋🏿')?.char).toBe('✋');
    expect(emojiForNative('🧑🏽‍🚀')?.char).toBe('🧑‍🚀');
  });
});

describe('search', () => {
  it('anchors at word starts, so short queries are not noise', () => {
    const hits = searchEmoji('and');
    // Substring matching put 'raised hand' under 'and'. Word-start does not.
    expect(hits.some(e => e.char === '✋')).toBe(false);
    expect(searchEmoji('hand').some(e => e.char === '✋')).toBe(true);
  });

  it('matches the id, the name and the aliases', () => {
    expect(searchEmoji('pizza').some(e => e.char === '🍕')).toBe(true);
    expect(searchEmoji('india').some(e => e.char === '🇮🇳')).toBe(true);
    expect(searchEmoji('joy').some(e => e.char === '😂')).toBe(true);
  });

  it('returns nothing for a blank query so the caller browses instead', () => {
    expect(searchEmoji('')).toHaveLength(0);
    expect(searchEmoji('   ')).toHaveLength(0);
  });

  it('is fast enough to run on every keystroke', () => {
    const started = process.hrtime.bigint();
    for (const q of ['a', 'sm', 'smi', 'smil', 'smile']) {
      searchEmoji(q);
    }
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    expect(ms).toBeLessThan(50);
  });
});
