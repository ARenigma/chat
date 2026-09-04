#!/usr/bin/env node
/**
 * Generates `src/lib/emoji.generated.ts` from `@emoji-mart/data`.
 *
 * Same shape as `gen-tokens.mjs`: a committed, typed, never-hand-edited data
 * file, produced by a script from a source of truth, with `--check` turning
 * drift into a build failure. The source here is a devDependency rather than a
 * JSON in `design/`, and that is the point of the exercise (Amit, 2026-09-04):
 * the hand-typed ~300-emoji list in emoji.ts was a keyboard nobody could search
 * past, and typing 1,870 entries by hand is how a dataset acquires typos. The
 * package ships NO runtime code into the bundle, no render layer, no native
 * code; only its `native.json` is read, here, at generation time. What ships is
 * this script's output, which is why RULE 5 is satisfied rather than bent.
 *
 * Set 15 is read deliberately (the newest the package carries, Emoji 15.0).
 * Older sets exist in the package and picking one would freeze every user at
 * that year's emoji. Gating by what the device font can draw is a RUNTIME
 * question answered in emoji.ts from `Platform.Version`, so the data carries the
 * emoji version (`v`) instead of pre-filtering.
 *
 * Skin tones are emitted PRE-COMPOSED, straight from the source, never built by
 * appending a Fitzpatrick modifier at runtime. The old `char + tone` rule broke
 * on every ZWJ sequence (a couple, a family, a handshake) where the modifier
 * belongs INSIDE the sequence, once per person, and on a trailing VS16 where it
 * has to replace the selector. The source already has the right six strings for
 * each of those, so the picker just indexes them.
 *
 * `--check` regenerates in memory and exits non-zero if the committed file
 * differs. Deterministic: no dates, source order preserved, so two machines
 * produce identical bytes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUTPUT = join(ROOT, 'src/lib/emoji.generated.ts');
const CHECK = process.argv.includes('--check');

const require = createRequire(import.meta.url);
const PKG = '@emoji-mart/data';
const SET = 15;
const pkgVersion = require(`${PKG}/package.json`).version;
const INPUT = require.resolve(`${PKG}/sets/${SET}/native.json`);
const data = JSON.parse(readFileSync(INPUT, 'utf8'));

function fail(message) {
  console.error(`emoji FAILED: ${message}`);
  process.exit(1);
}

/*
 * The source's category ids, asserted exactly. A renamed or reordered category
 * upstream must fail here, by name, rather than silently emptying a tab or
 * shuffling the order the picker shows them in.
 */
const EXPECTED_SOURCE_CATEGORIES = [
  'people',
  'nature',
  'foods',
  'activity',
  'places',
  'objects',
  'symbols',
  'flags',
];
const sourceIds = data.categories.map(c => c.id);
if (JSON.stringify(sourceIds) !== JSON.stringify(EXPECTED_SOURCE_CATEGORIES)) {
  fail(
    `category ids drifted. Expected ${JSON.stringify(
      EXPECTED_SOURCE_CATEGORIES,
    )}, got ${JSON.stringify(sourceIds)}.`,
  );
}

/*
 * Our tab ids. The source's `people` is one bucket of 529 that starts with the
 * smileys and moves to hands and bodies at `wave`; every keyboard shows those as
 * two tabs, so it is split there. `foods` and `places` are renamed to the tab
 * ids emoji.ts has always used, so EmojiPicker and the recents store see no
 * change.
 */
const RENAME = { foods: 'food', places: 'travel' };

/** The alias ids that resolve to each emoji, so `satisfied` still finds 😆. */
const aliasesFor = new Map();
for (const [alias, target] of Object.entries(data.aliases)) {
  if (!(target in data.emojis)) {
    fail(`alias '${alias}' points at unknown emoji '${target}'.`);
  }
  const list = aliasesFor.get(target) ?? [];
  list.push(alias);
  aliasesFor.set(target, list);
}

/**
 * The search tokens. A re-expression of the string emoji-mart builds for its
 * own SearchIndex: the id (whole, and split, so `zany` finds `zany_face` while
 * an exact-id match can still key on the real id), the name split on the same
 * separators, the keywords, the aliases, and the emoticons, all lowercased and
 * deduped. Stored space-joined; emoji.ts rebuilds the comma-delimited haystack.
 */
const SPLIT = /[-_|\s]+/;
function tokens(emoji) {
  const raw = [
    emoji.id,
    ...emoji.id.split(SPLIT),
    ...emoji.name.split(SPLIT),
    ...emoji.keywords,
    ...(aliasesFor.get(emoji.id) ?? []),
    ...(emoji.emoticons ?? []),
  ]
    .map(t => t.toLowerCase().trim())
    .filter(t => t !== '');
  return [...new Set(raw)].join(' ');
}

/** Only `'` and `\` need escaping inside a single-quoted TS literal. */
const lit = s => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

const entries = [];
const ranges = [];
let toned = 0;

function push(id) {
  const e = data.emojis[id];
  if (e === undefined) {
    fail(`category lists '${id}' but it is not in emojis.`);
  }
  if (e.skins.length !== 1 && e.skins.length !== 6) {
    fail(
      `'${id}' has ${e.skins.length} skins; only 1 (no tone) or 6 (base + 5 tones) is understood.`,
    );
  }
  const parts = [`n: ${lit(e.skins[0].native)}`, `k: ${lit(tokens(e))}`];
  if (e.skins.length === 6) {
    toned += 1;
    parts.push(
      `s: [${e.skins
        .slice(1)
        .map(s => lit(s.native))
        .join(', ')}]`,
    );
  }
  if (typeof e.version !== 'number') {
    fail(`'${id}' has no numeric version.`);
  }
  if (e.version > 4) {
    parts.push(`v: ${e.version}`);
  }
  entries.push(`  { ${parts.join(', ')} },`);
}

function range(id, ids) {
  const start = entries.length;
  for (const emojiId of ids) {
    push(emojiId);
  }
  ranges.push(`  { id: '${id}', start: ${start}, end: ${entries.length} },`);
}

for (const category of data.categories) {
  if (category.id === 'people') {
    const at = category.emojis.indexOf('wave');
    if (at <= 0) {
      fail(
        `'wave' is at index ${at} of 'people'; the smileys/people split needs it present and not first.`,
      );
    }
    range('smileys', category.emojis.slice(0, at));
    range('people', category.emojis.slice(at));
    continue;
  }
  range(RENAME[category.id] ?? category.id, category.emojis);
}

const header = `/**
 * GENERATED FILE, DO NOT EDIT.
 *
 * Source: node_modules/${PKG}/sets/${SET}/native.json (${PKG}@${pkgVersion},
 * a devDependency; nothing from the package is imported at runtime).
 * Regenerate with \`npm run emoji\`. \`npm run emoji:check\` fails on drift.
 *
 * Emoji glyphs are Unicode and carry no licence. The keyword index alongside
 * them is emoji-mart's and ships in the bundle, so its notice travels with it:
 * Copyright (c) Missive, MIT.
 *
 * Skin-toned variants (\`s\`) are pre-composed strings from the source, never
 * assembled by appending a modifier. \`v\` is the Emoji version the glyph
 * arrived in, present only when above 4; emoji.ts hides what the device font
 * cannot draw.
 */

export interface GeneratedEmoji {
  /** The base native string, no skin tone applied. */
  n: string;
  /** Space-separated lowercase search tokens: id, name words, keywords, aliases, emoticons. */
  k: string;
  /** The five pre-composed toned variants (light to dark), only when the source has them. */
  s?: readonly string[];
  /** Emoji version, only when > 4. Absent means any device this app installs on can draw it. */
  v?: number;
}

export type GeneratedCategoryId =
  | 'smileys'
  | 'people'
  | 'nature'
  | 'food'
  | 'activity'
  | 'travel'
  | 'objects'
  | 'symbols'
  | 'flags';

/** A half-open [start, end) slice of EMOJI. Contiguous, in tab order. */
export interface GeneratedRange {
  id: GeneratedCategoryId;
  start: number;
  end: number;
}

export const SOURCE = { pkg: '${PKG}', version: '${pkgVersion}', set: ${SET} } as const;
`;

const body = `
export const RANGES: readonly GeneratedRange[] = [
${ranges.join('\n')}
];

export const EMOJI: readonly GeneratedEmoji[] = [
${entries.join('\n')}
];
`;

const generated = header + body;

/*
 * The clean-room boundary (ADR-0025) is asserted on the output as well as by
 * contract.test.ts, because a keyword list is exactly the kind of text where a
 * stray identifier could arrive from upstream unnoticed.
 */
if (/org\.telegram|TMessagesProj|DrKLO/.test(generated)) {
  fail('output contains a forbidden reference identifier.');
}

if (CHECK) {
  let current = '';
  try {
    current = readFileSync(OUTPUT, 'utf8');
  } catch {
    console.error(
      'emoji:check FAILED, src/lib/emoji.generated.ts does not exist',
    );
    process.exit(1);
  }
  if (current !== generated) {
    console.error(
      'emoji:check FAILED, src/lib/emoji.generated.ts is stale. Run `npm run emoji`.',
    );
    process.exit(1);
  }
  console.log(
    `emoji:check OK, ${entries.length} emoji, ${toned} toned, ${ranges.length} categories`,
  );
  process.exit(0);
}

writeFileSync(OUTPUT, generated);
console.log(
  `emoji OK, ${entries.length} emoji, ${toned} toned, ${ranges.length} categories ` +
    `from ${PKG}@${pkgVersion} set ${SET} -> src/lib/emoji.generated.ts ` +
    `(${Buffer.byteLength(generated)} bytes)`,
);
