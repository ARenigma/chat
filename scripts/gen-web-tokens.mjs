#!/usr/bin/env node
/**
 * Emits `web/tokens.css` from `design/tokens.json`.
 *
 * The website and the app have to look like the same product, and the only way
 * that stays true is if neither owns the values. This is the same generator idea
 * as `gen-tokens.mjs` pointed at a different target: one source, two outputs,
 * and a `--check` mode so drift fails a build rather than being noticed in a
 * screenshot months later.
 *
 * Colour becomes two blocks, `:root` for light and a `prefers-color-scheme`
 * media query for dark, so the site follows the visitor's OS with no JavaScript
 * at all. The app has a toggle because it has somewhere to put one; a landing
 * page that ships a theme switcher is shipping a widget nobody asked for.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const INPUT = join(ROOT, 'design/tokens.json');
const OUTPUT = join(ROOT, 'web/tokens.css');
const CHECK = process.argv.includes('--check');

const spec = JSON.parse(readFileSync(INPUT, 'utf8'));

/**
 * App tokens name Android PostScript faces (`Geist-Regular`, `TitanOne`).
 * CSS wants the family the Google Fonts stylesheet actually registers.
 */
function cssFamily(postScript) {
  if (typeof postScript !== 'string') return 'system-ui';
  if (postScript === 'TitanOne') return 'Titan One';
  if (postScript.startsWith('Geist')) return 'Geist';
  return postScript;
}

/** `bg/accentStrong` -> `--bg-accent-strong` */
const varName = name =>
  '--' +
  name
    .replace('/', '-')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();

function colours(mode) {
  return Object.entries(spec.color.tokens)
    .map(([name, values]) => `  ${varName(name)}: ${values[mode]};`)
    .join('\n');
}

function scale(group, prefix) {
  return Object.entries(spec[group])
    .filter(([key]) => !key.startsWith('$'))
    .map(([key, value]) => `  --${prefix}-${key.toLowerCase()}: ${value}px;`)
    .join('\n');
}

const generated = `/* GENERATED FILE, DO NOT EDIT. Run \`npm run tokens:web\`.
 *
 * Source: design/tokens.json, the same file src/theme/tokens.generated.ts comes
 * from. If the site and the app ever look like different products, this file is
 * stale, not wrong.
 *
 * System: ${spec.source.system}
 */

:root {
  color-scheme: light dark;

${colours('Light')}

${scale('space', 'space')}

${scale('layout', 'layout')}

${scale('radius', 'radius')}

  /* Same families as the app, different loading rule.
   *
   * On the web Geist arrives as a variable font from Google Fonts, so a
   * weight axis is honest. In the app the faces are separate static files
   * and asking for a weight makes Android synthesise one it already has,
   * which is why the app names a face per style and forbids fontWeight.
   * Titan One is the wordmark only — one weight, same as assets/fonts. */
  --face-wordmark: '${cssFamily(
    spec.typography.wordmark.fontFamily,
  )}', system-ui, sans-serif;
  --face-display: '${cssFamily(
    spec.typography.displayLarge.fontFamily,
  )}', system-ui, sans-serif;
  --face-title: '${cssFamily(
    spec.typography.titleMedium.fontFamily,
  )}', system-ui, sans-serif;
  --face-label: '${cssFamily(
    spec.typography.labelLarge.fontFamily,
  )}', system-ui, sans-serif;
  --face-body: '${cssFamily(
    spec.typography.bodyLarge.fontFamily,
  )}', system-ui, sans-serif;

  /* The springs, as the closest thing CSS has. A spring is not expressible as a
   * cubic bezier, so these approximate the settle of each one rather than
   * pretending to be it, the app owns the real physics.
   *
   * There is deliberately no bounce curve here. The app's bounce is a spring
   * driving a discrete event (a message leaving), where overshoot is the
   * physics. On the web the only animated thing is a button press, and a press
   * that springs *past* its target and comes back is backwards: you are pushing
   * something down, not throwing it. It also reads as dated, which is what
   * impeccable's bounce-easing rule is about. Exponential deceleration is what
   * a pressed surface actually does. */
  --ease-snap: cubic-bezier(0.32, 0.72, 0.31, 1);
  --ease-smooth: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
  --duration-fast: ${spec.motion.duration.fast}ms;
  --duration-base: ${spec.motion.duration.base}ms;
  --duration-slow: ${spec.motion.duration.slow}ms;
}

@media (prefers-color-scheme: dark) {
  :root {
${colours('Dark')}
  }
}
`;

if (CHECK) {
  let current = '';
  try {
    current = readFileSync(OUTPUT, 'utf8');
  } catch {
    console.error('tokens:web:check FAILED, web/tokens.css does not exist');
    process.exit(1);
  }
  if (current !== generated) {
    console.error(
      'tokens:web:check FAILED, web/tokens.css is stale. Run `npm run tokens:web`.',
    );
    process.exit(1);
  }
  console.log('tokens:web:check OK, web/tokens.css matches design/tokens.json');
  process.exit(0);
}

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, generated);
console.log(
  `tokens:web OK, ${
    Object.keys(spec.color.tokens).length
  } colours x 2 modes -> web/tokens.css`,
);
