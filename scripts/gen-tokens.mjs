#!/usr/bin/env node
/**
 * Generates `src/theme/tokens.generated.ts` from `design/tokens.json`.
 *
 * This is the code half of the design pipeline: Figma variables are the source of
 * truth, `design/tokens.json` is their exported form, and this turns them into a
 * typed RN theme. Neither the JSON nor the TS is hand-edited.
 *
 * `--check` regenerates in memory and exits non-zero if the committed file
 * differs, which is what makes drift a build failure rather than a surprise.
 *
 * The export step upstream of this is manual: reading Figma variables over REST
 * needs an Enterprise plan, so today they come out through the Plugin API. This
 * generator is the part that runs unattended.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INPUT = join(ROOT, 'design/tokens.json');
const OUTPUT = join(ROOT, 'src/theme/tokens.generated.ts');
const CHECK = process.argv.includes('--check');

const spec = JSON.parse(readFileSync(INPUT, 'utf8'));

/** `bg/accentTint` -> `{ group: 'bg', key: 'accentTint' }` */
function split(name) {
  const [group, key] = name.split('/');
  return { group, key };
}

function colorObject(mode) {
  const groups = {};
  for (const [name, values] of Object.entries(spec.color.tokens)) {
    const { group, key } = split(name);
    groups[group] = groups[group] || {};
    groups[group][key] = values[mode];
  }
  return groups;
}

function render(value, indent) {
  const pad = '  '.repeat(indent);
  if (typeof value === 'string') {
    return `'${value}'`;
  }
  if (typeof value === 'number') {
    return String(value);
  }
  const entries = Object.entries(value).map(
    ([k, v]) =>
      `${pad}  ${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`}: ${render(
        v,
        indent + 1,
      )},`,
  );
  return `{\n${entries.join('\n')}\n${pad}}`;
}

/** Round-trip the numeric line-height/tracking into RN's absolute units. */
function typography() {
  const out = {};
  for (const [name, t] of Object.entries(spec.typography)) {
    out[name] = {
      fontSize: t.fontSize,
      fontWeight: t.weight,
      lineHeight: Math.round((t.fontSize * t.lineHeightPct) / 100),
      letterSpacing: Number(
        ((t.fontSize * t.letterSpacingPct) / 100).toFixed(2),
      ),
    };
  }
  return out;
}

function elevation(mode) {
  const out = {};
  for (const [name, e] of Object.entries(spec.elevation)) {
    out[name] = {
      shadowColor: '#000000',
      shadowOffset: { width: 0, height: e.offsetY },
      shadowOpacity:
        mode === 'Dark' ? Number((e.opacity * 3).toFixed(2)) : e.opacity,
      shadowRadius: e.radius / 2,
      elevation: Math.max(1, Math.round(e.radius / 4)),
    };
  }
  return out;
}

const header = `/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * Source: design/tokens.json, exported from Figma file ${spec.source.fileKey}.
 * Regenerate with \`npm run tokens\`. \`npm run tokens:check\` fails on drift.
 *
 * Accent budget: color.bg.accent and color.text.accent appear in exactly five
 * places — send button fill, companion mark wash, low-balance count, typing dots
 * and the presence dot. See the Accent budget page in Figma before adding a
 * sixth. Backgrounds, bubbles, headers, dividers and list rows stay monochrome.
 */
`;

const body = `
export const LIGHT = ${render(
  {
    color: colorObject('Light'),
    space: spec.space,
    radius: spec.radius,
    motion: spec.motion,
    typography: typography(),
    elevation: elevation('Light'),
  },
  0,
)} as const;

export const DARK = ${render(
  {
    color: colorObject('Dark'),
    space: spec.space,
    radius: spec.radius,
    motion: spec.motion,
    typography: typography(),
    elevation: elevation('Dark'),
  },
  0,
)} as const;

export type Theme = typeof LIGHT;

/** The app is light-first; DARK exists for the mode switch, not as a default. */
export const TOKENS: Theme = LIGHT;
`;

const generated = header + body;

if (CHECK) {
  let current = '';
  try {
    current = readFileSync(OUTPUT, 'utf8');
  } catch {
    console.error(
      'tokens:check FAILED — src/theme/tokens.generated.ts does not exist',
    );
    process.exit(1);
  }
  if (current !== generated) {
    console.error(
      'tokens:check FAILED — src/theme/tokens.generated.ts is stale.\n' +
        'design/tokens.json changed without regenerating. Run `npm run tokens`.',
    );
    process.exit(1);
  }
  console.log('tokens:check OK — generated theme matches design/tokens.json');
  process.exit(0);
}

writeFileSync(OUTPUT, generated);
const colorCount = Object.keys(spec.color.tokens).length;
console.log(
  `tokens OK — ${colorCount} colours x 2 modes, ` +
    `${Object.keys(spec.space).length} space, ${
      Object.keys(spec.radius).length
    } radius, ` +
    `${
      Object.keys(spec.typography).length
    } type styles -> src/theme/tokens.generated.ts`,
);
