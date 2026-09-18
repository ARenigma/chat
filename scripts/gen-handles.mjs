#!/usr/bin/env node
/**
 * Generates `src/lib/handles.generated.ts` from `design/handles.json`.
 *
 * Same shape as `gen-tokens.mjs` and `gen-emoji.mjs`: committed, typed, never
 * hand-edited output, with `--check` turning drift into a build failure. The
 * reason it exists (Amit, 2026-09-17: "bake in username generator library based
 * on our guidelines to take in indian pop references.. not hardcoded word list
 * pls") is that the three arrays previously typed into stageName.ts spanned one
 * template and 320 names. A name we suggest that is already taken is worse than
 * no suggestion, and 320 runs out the moment a live availability check exists.
 *
 * So the vocabulary is DATA, organised by domain so a word can be argued with
 * in review, and the space comes from several declared word-shapes rather than
 * one. This script is where the shapes are proved rather than hoped:
 *
 * 1. Every word is `[A-Z][a-z]+`, which is what makes every concatenation of
 *    words, an underscore and digits satisfy USERNAME_PATTERN in
 *    src/lib/username.ts without the runtime having to check.
 * 2. Every template's LONGEST possible render is measured against the 24-char
 *    ceiling in `check_display_name` (migration 040) and its shortest against
 *    the 3-char floor. A suggestion the RPC would reject is a dead end the
 *    member has to notice and undo, so it must not be emittable at all.
 * 3. The tone rules that the old hand-typed lists carried in prose are enforced
 *    here: no caste, no faith, no body, no living public figure, and no ordinary
 *    first name (a handle that reads as a real person is an impersonation, and
 *    this app puts strangers in a private room together).
 * 4. Numbers never reach six consecutive digits, because `stageNamePii` reads
 *    that as a phone number and we must not suggest a name our own screen warns
 *    about.
 *
 * Deterministic: source order preserved, no dates, so two machines produce
 * identical bytes.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INPUT = join(ROOT, 'design/handles.json');
const OUTPUT = join(ROOT, 'src/lib/handles.generated.ts');
const CHECK = process.argv.includes('--check');
const LABEL = CHECK ? 'handles:check' : 'handles';

function fail(message) {
  console.error(`${LABEL} FAILED: ${message}`);
  process.exit(1);
}

const source = JSON.parse(readFileSync(INPUT, 'utf8'));
const { limits, banned, voices } = source;
const WORD_ROLES = ['adjective', 'noun', 'suffix'];
const WORD_SHAPE = /^[A-Z][a-z]+$/;

const numberDigitsMin = String(limits.number.min).length;
const numberDigitsMax = String(limits.number.max).length;
if (numberDigitsMax >= 6) {
  fail(
    `numbers run to ${numberDigitsMax} digits; stageNamePii reads 6 or more in a row as a phone number.`,
  );
}

const bannedSubstrings = banned.substrings.map(s => s.toLowerCase());
const bannedExact = new Set(banned.exact.map(s => s.toLowerCase()));

/** Every rule a single word has to survive, with the word named in the failure. */
function checkWord(voice, domain, role, word) {
  const where = `${voice}.${domain}.${role} "${word}"`;
  if (!WORD_SHAPE.test(word)) {
    return `${where}: must be one capital then lowercase letters only (this is what keeps every render inside USERNAME_PATTERN and the CamelCase seams readable).`;
  }
  if (word.length < limits.minWordLength) {
    return `${where}: shorter than ${limits.minWordLength} characters.`;
  }
  if (word.length > limits.maxWordLength[role]) {
    return `${where}: ${word.length} characters, over the ${limits.maxWordLength[role]} allowed for a ${role}.`;
  }
  const lower = word.toLowerCase();
  for (const bad of bannedSubstrings) {
    if (lower.includes(bad)) {
      return `${where}: contains "${bad}". This is what a stranger reads at 2am.`;
    }
  }
  if (bannedExact.has(lower)) {
    return `${where}: reads as an ordinary first name, so it reads as a real person.`;
  }
  return null;
}

const problems = [];
const emitted = {};

for (const [voice, spec] of Object.entries(voices)) {
  const pools = { adjective: [], noun: [], suffix: [] };
  const seen = { adjective: new Set(), noun: new Set(), suffix: new Set() };
  const domains = Object.keys(spec.domains);

  for (const [domain, roles] of Object.entries(spec.domains)) {
    for (const [role, words] of Object.entries(roles)) {
      if (!WORD_ROLES.includes(role)) {
        problems.push(`${voice}.${domain}: unknown role "${role}".`);
        continue;
      }
      for (const word of words) {
        const problem = checkWord(voice, domain, role, word);
        if (problem !== null) {
          problems.push(problem);
          continue;
        }
        if (seen[role].has(word)) {
          problems.push(
            `${voice}.${role}: "${word}" appears twice; a duplicate silently biases the draw.`,
          );
          continue;
        }
        seen[role].add(word);
        pools[role].push(word);
      }
    }
  }

  const templates = [];
  let voiceCombinations = 0;
  let wordOnlyCombinations = 0;

  for (const template of spec.templates) {
    const uses = {};
    let maxLength = 0;
    let minLength = 0;
    let combinations = 1;
    let hasNumber = false;
    let broken = false;

    if (template.slots[0] === 'number') {
      // suggestUsernames pins the first slot to walk its pool, and a name that
      // opens with a digit reads as an accident besides.
      problems.push(
        `${voice}.${template.id}: a template cannot start with the number slot.`,
      );
      continue;
    }

    for (const role of template.slots) {
      if (role === 'number') {
        hasNumber = true;
        // Two shapes per number: with the underscore and without.
        combinations *= (limits.number.max - limits.number.min + 1) * 2;
        maxLength += 1 + numberDigitsMax;
        minLength += numberDigitsMin;
        continue;
      }
      const pool = pools[role];
      if (pool === undefined || pool.length === 0) {
        problems.push(`${voice}.${template.id}: slot "${role}" has no words.`);
        broken = true;
        break;
      }
      uses[role] = (uses[role] ?? 0) + 1;
      if (uses[role] > pool.length) {
        problems.push(
          `${voice}.${template.id}: uses ${role} ${uses[role]} times but only ${pool.length} words exist, so the no-repeat walk cannot terminate.`,
        );
        broken = true;
        break;
      }
      // A role used twice never repeats a word, so the second draw picks from
      // one fewer.
      combinations *= pool.length - (uses[role] - 1);
      maxLength += Math.max(...pool.map(w => w.length));
      minLength += Math.min(...pool.map(w => w.length));
    }
    if (broken) {
      continue;
    }

    if (maxLength > limits.maxLength) {
      problems.push(
        `${voice}.${template.id}: longest render is ${maxLength} characters, over check_display_name's ${limits.maxLength}.`,
      );
    }
    if (minLength < limits.minLength) {
      problems.push(
        `${voice}.${template.id}: shortest render is ${minLength} characters, under check_display_name's ${limits.minLength}.`,
      );
    }

    templates.push({ id: template.id, slots: template.slots, combinations });
    voiceCombinations += combinations;
    if (!hasNumber) {
      wordOnlyCombinations += combinations;
    }
  }

  emitted[voice] = {
    domains,
    pools,
    templates,
    combinations: voiceCombinations,
    wordOnly: wordOnlyCombinations,
  };
}

if (problems.length > 0) {
  console.error(`${LABEL} FAILED\n  ${problems.join('\n  ')}`);
  process.exit(1);
}

const voiceNames = Object.keys(emitted);
const list = words => words.map(w => `'${w}'`).join(', ');
const wrap = (words, indent) => {
  const lines = [];
  let line = '';
  for (const word of words) {
    const piece = `'${word}',`;
    if (line !== '' && line.length + piece.length + 1 > 92) {
      lines.push(indent + line);
      line = '';
    }
    line = line === '' ? piece : `${line} ${piece}`;
  }
  if (line !== '') {
    lines.push(indent + line);
  }
  return lines.join('\n');
};

const summary = voiceNames
  .map(
    v =>
      ` * - ${v}: ${emitted[v].pools.adjective.length} adjectives, ${emitted[v].pools.noun.length} nouns, ` +
      `${emitted[v].pools.suffix.length} suffixes, ${emitted[v].templates.length} shapes, ` +
      `${emitted[v].combinations.toLocaleString('en-US')} names ` +
      `(${emitted[v].wordOnly.toLocaleString('en-US')} without a number).`,
  )
  .join('\n');

const generated = `/**
 * GENERATED FILE, DO NOT EDIT.
 *
 * Source: design/handles.json. Regenerate with \`npm run handles\`;
 * \`npm run handles:check\` fails the build when this file has drifted.
 *
 * The vocabulary and word-shapes behind every name the app suggests. The
 * generator proves, before emitting, that no combination here can fail
 * check_display_name (migration 040) or USERNAME_PATTERN in src/lib/username.ts,
 * and that no word breaks the tone rules stageName.ts describes.
 *
${summary}
 */

export type HandleVoice = ${voiceNames.map(v => `'${v}'`).join(' | ')};

/** A slot in a template. 'number' is the trailing two-or-three digits. */
export type HandleWordRole = ${WORD_ROLES.map(r => `'${r}'`).join(' | ')};
export type HandleRole = HandleWordRole | 'number';

export interface HandleTemplate {
  readonly id: string;
  readonly slots: readonly HandleRole[];
  /** How many distinct names this shape can produce. */
  readonly combinations: number;
}

export const HANDLE_MIN_LENGTH = ${limits.minLength};
export const HANDLE_MAX_LENGTH = ${limits.maxLength};
export const HANDLE_NUMBER_MIN = ${limits.number.min};
export const HANDLE_NUMBER_MAX = ${limits.number.max};

/** The domains each voice draws from, in declaration order. For auditing. */
export const HANDLE_DOMAINS: Record<HandleVoice, readonly string[]> = {
${voiceNames.map(v => `  ${v}: [${list(emitted[v].domains)}],`).join('\n')}
};

export const HANDLE_WORDS: Record<
  HandleVoice,
  Record<HandleWordRole, readonly string[]>
> = {
${voiceNames
  .map(
    v => `  ${v}: {
${WORD_ROLES.map(
  r => `    ${r}: [
${wrap(emitted[v].pools[r], '      ')}
    ],`,
).join('\n')}
  },`,
  )
  .join('\n')}
};

export const HANDLE_TEMPLATES: Record<HandleVoice, readonly HandleTemplate[]> = {
${voiceNames
  .map(
    v => `  ${v}: [
${emitted[v].templates
  .map(
    t =>
      `    { id: '${t.id}', slots: [${t.slots
        .map(s => `'${s}'`)
        .join(', ')}], combinations: ${t.combinations} },`,
  )
  .join('\n')}
  ],`,
  )
  .join('\n')}
};

/** Total distinct names per voice, summed over that voice's templates. */
export const HANDLE_COMBINATIONS: Record<HandleVoice, number> = {
${voiceNames.map(v => `  ${v}: ${emitted[v].combinations},`).join('\n')}
};
`;

if (CHECK) {
  let current = '';
  try {
    current = readFileSync(OUTPUT, 'utf8');
  } catch {
    console.error(
      'handles:check FAILED, src/lib/handles.generated.ts does not exist. Run `npm run handles`.',
    );
    process.exit(1);
  }
  if (current !== generated) {
    console.error(
      'handles:check FAILED, src/lib/handles.generated.ts is stale. Run `npm run handles`.',
    );
    process.exit(1);
  }
}

if (!CHECK) {
  writeFileSync(OUTPUT, generated);
}

console.log(
  `${LABEL} OK\n  ` +
    voiceNames
      .map(
        v =>
          `${v}: ${emitted[v].templates.length} shapes, ` +
          `${
            emitted[v].pools.adjective.length +
            emitted[v].pools.noun.length +
            emitted[v].pools.suffix.length
          } words ` +
          `across ${emitted[v].domains.length} domains -> ` +
          `${emitted[v].combinations.toLocaleString('en-US')} names ` +
          `(${emitted[v].wordOnly.toLocaleString('en-US')} without a number)`,
      )
      .join('\n  '),
);
