#!/usr/bin/env node
/**
 * Generates `src/theme/tokens.generated.ts` from `design/tokens.json`.
 *
 * `design/tokens.json` is the source of truth and this turns it into a typed RN
 * theme. The generated file is never hand-edited.
 *
 * The pipeline used to start in Figma, and the JSON was its export. It no longer
 * does, see the provenance note in the JSON. The generator does not care either
 * way, but the header it writes should not claim a lineage the file does not
 * have.
 *
 * `--check` regenerates in memory and exits non-zero if the committed file
 * differs, which is what makes drift a build failure rather than a surprise.
 *
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
  for (const [name, modes] of Object.entries(spec.color.tokens)) {
    const { group, key } = split(name);
    groups[group] = groups[group] || {};
    groups[group][key] = modes[mode];
  }
  return groups;
}

function render(value, indent) {
  const pad = '  '.repeat(indent);
  if (typeof value === 'string') {
    return `'${value}'`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(v => render(v, indent)).join(', ')}]`;
  }
  const entries = Object.entries(value).map(([k, v]) => {
    const key = /^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`;
    // `as const` on the outer object would otherwise make this a readonly tuple,
    // and a readonly array cannot be spread into RN's TextStyle. The assertion
    // keeps the property readonly (which is correct) while the value stays a
    // mutable array type (which RN requires).
    const suffix = k === 'fontVariant' ? ' as FontVariantList' : '';
    return `${pad}  ${key}: ${render(v, indent + 1)}${suffix},`;
  });
  return `{\n${entries.join('\n')}\n${pad}}`;
}

/**
 * Round-trip the numeric line-height/tracking into RN's absolute units.
 *
 * Deliberately emits **no `fontWeight`**. Each style names its own static face,
 * and on Android a concrete family plus a weight makes the platform synthesise a
 * weight the family already ships, which smears the letterforms and is
 * invisible on the emulator until you look at a screenshot at 3x. The weight
 * lives in the family name and nowhere else; a test forbids `fontWeight` in
 * components and screens so it cannot creep back.
 */
function typography() {
  const out = {};
  for (const [name, t] of Object.entries(spec.typography)) {
    if (name.startsWith('$')) {
      continue;
    }
    out[name] = {
      fontFamily: t.fontFamily,
      fontSize: t.fontSize,
      lineHeight: Math.round((t.fontSize * t.lineHeightPct) / 100),
      letterSpacing: Number(
        ((t.fontSize * t.letterSpacingPct) / 100).toFixed(2),
      ),
      ...(t.tabular === true ? { fontVariant: ['tabular-nums'] } : {}),
    };
  }
  return out;
}

/** Notes and `$`-prefixed keys document the source; they are not theme values. */
function values(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === 'note' || k.startsWith('$')) {
      continue;
    }
    out[k] =
      v !== null && typeof v === 'object' && !Array.isArray(v) ? values(v) : v;
  }
  return out;
}

/**
 * Reanimated `withSpring` configs, straight from the token.
 *
 * The rest thresholds are attached here rather than left to Reanimated's
 * defaults, which allow a spring to sit a fraction of a pixel off target for
 * several frames, cheap to fix, and the difference between a press that ends
 * and one that fades out.
 *
 * Only damping/stiffness/mass are emitted. Passing a `dampingRatio` alongside
 * them would be ambiguous: Reanimated treats the perceptual pair as an
 * alternative parameterisation, not an addition, and would silently ignore the
 * physics. The ratio is exported separately, as documentation.
 */
function springs() {
  const rest = {
    restDisplacementThreshold: spec.motion.rest.displacement,
    restSpeedThreshold: spec.motion.rest.speed,
  };
  const out = {};
  for (const [name, s] of Object.entries(spec.motion.spring)) {
    out[name] = {
      damping: s.damping,
      stiffness: s.stiffness,
      mass: s.mass,
      ...rest,
    };
  }
  return out;
}

/**
 * The derived half of the physics, for humans and for tests.
 *
 * `ratio` is c / (2*sqrt(k*m)): 1 is critically damped, below 1 overshoots,
 * above 1 crawls in. `settleMs` is the 4-time-constant estimate, 4 / (ratio *
 * sqrt(k/m)), near enough to the frame where the eye stops seeing movement.
 *
 * Both are computed rather than written down, so a note claiming "no overshoot"
 * cannot survive someone lowering the damping.
 */
function springMeta() {
  const out = {};
  for (const [name, s] of Object.entries(spec.motion.spring)) {
    const ratio = s.damping / (2 * Math.sqrt(s.stiffness * s.mass));
    const omega = Math.sqrt(s.stiffness / s.mass);
    out[name] = {
      ratio: Number(ratio.toFixed(3)),
      settleMs: Math.round((4 / (ratio * omega)) * 1000),
      overshoots: ratio < 1,
    };
  }
  return out;
}

/**
 * Every sub-block of `spec.motion`, rather than a hand-written list of them.
 *
 * The list this replaced was a trap with a long fuse. Adding a block to
 * tokens.json and not naming it here dropped it silently, and `tokens:check`
 * still passed: it compares generated output against the committed file, and
 * both lacked the block. The failure then surfaced as a typecheck error in
 * motion.ts, a long way from the edit that caused it. Iterating cannot go wrong
 * that way.
 *
 * `spring` is skipped because it is rebuilt below from the physical triplet, and
 * `rest` because `springs()` folds the two settle thresholds into every spring
 * rather than emitting them as a block of their own.
 */
function motion() {
  const out = { spring: springs(), springMeta: springMeta() };
  for (const [name, block] of Object.entries(spec.motion)) {
    if (name.startsWith('$') || name === 'spring' || name === 'rest') {
      continue;
    }
    out[name] = values(block);
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
 * GENERATED FILE, DO NOT EDIT.
 *
 * Source: design/tokens.json (authored directly, the Figma library is stale; see
 * the provenance note in that file).
 * Regenerate with \`npm run tokens\`. \`npm run tokens:check\` fails on drift.
 *
 * System: ${spec.source.system}
 *
 * Accent budget: the coral is for ACTIONS AND STATES ONLY, send, own bubble,
 * unread count, avatar wash, low-balance count, typing dots. Never a page
 * background, never a header, never a divider, never a provider's avatar. That
 * single rule is the difference between friendly and flirty, and a test in
 * __tests__/theme.test.ts enforces it rather than trusting this comment.
 *
 * Contrast: ${spec.source.ratiosMeasured}
 */

/** Widened deliberately, see the fontVariant note in scripts/gen-tokens.mjs. */
type FontVariantList = 'tabular-nums'[];
`;

const body = `
export const LIGHT = ${render(
  {
    color: colorObject('Light'),
    space: values(spec.space),
    radius: values(spec.radius),
    motion: motion(),
    interaction: values(spec.interaction),
    toggle: values(spec.toggle),
    typography: typography(),
    elevation: elevation('Light'),
  },
  0,
)} as const;

export const DARK = ${render(
  {
    color: colorObject('Dark'),
    space: values(spec.space),
    radius: values(spec.radius),
    motion: motion(),
    interaction: values(spec.interaction),
    toggle: values(spec.toggle),
    typography: typography(),
    elevation: elevation('Dark'),
  },
  0,
)} as const;

/**
 * Either mode, and deliberately a union rather than \`typeof LIGHT\`.
 *
 * Both objects are \`as const\`, which makes every hex a literal type, so
 * \`typeof LIGHT\` cannot hold DARK, and a theme-aware stylesheet would only
 * ever typecheck against light mode. The union works because the two shapes are
 * identical: property access resolves, and each colour reads as the union of its
 * two values, which is still a string everywhere it is used.
 */
export type Theme = typeof LIGHT | typeof DARK;

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
      'tokens:check FAILED, src/theme/tokens.generated.ts does not exist',
    );
    process.exit(1);
  }
  if (current !== generated) {
    console.error(
      'tokens:check FAILED, src/theme/tokens.generated.ts is stale.\n' +
        'design/tokens.json changed without regenerating. Run `npm run tokens`.',
    );
    process.exit(1);
  }
  console.log('tokens:check OK, generated theme matches design/tokens.json');
  process.exit(0);
}

writeFileSync(OUTPUT, generated);
const colorCount = Object.keys(spec.color.tokens).length;
console.log(
  `tokens OK, ${colorCount} colours x 2 modes, ` +
    `${Object.keys(values(spec.space)).length} space, ${
      Object.keys(values(spec.radius)).length
    } radius, ` +
    `${Object.keys(typography()).length} type styles, ${
      Object.keys(spec.motion.spring).length
    } springs -> src/theme/tokens.generated.ts`,
);
