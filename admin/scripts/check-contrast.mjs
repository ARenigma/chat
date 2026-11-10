// WCAG 2.1 contrast check for the key text/background pairs in app/tokens.css.
// Run: node scripts/check-contrast.mjs   (exits 1 if any pair is below its floor)
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/tokens.css', import.meta.url), 'utf8');

function block(start) {
  const i = css.indexOf(start);
  const j = css.indexOf('\n}', i);
  return css.slice(i, j);
}
function vars(b) {
  const out = {};
  for (const m of b.matchAll(/(--[\w-]+):\s*([^;]+);/g))
    out[m[1]] = m[2].trim();
  return out;
}
const dark = vars(block(':root {'));
const light = { ...dark, ...vars(block("[data-theme='light'] {")) };

function parse(v) {
  let m = v.match(/^#([0-9a-f]{6})$/i);
  if (m)
    return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16)).concat(1);
  m = v.match(/^rgb\(\s*(\d+)\s+(\d+)\s+(\d+)(?:\s*\/\s*([\d.]+))?\s*\)$/);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  throw new Error(`cannot parse ${v}`);
}
const over = (fg, bg) =>
  fg.slice(0, 3).map((c, i) => c * fg[3] + bg[i] * (1 - fg[3]));
const lum = ([r, g, b]) => {
  const f = c =>
    (c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground token, background token, floor, label]
const PAIRS = [
  ['--text-primary', '--surface', 4.5],
  ['--text-body', '--surface', 4.5],
  ['--text-secondary', '--surface', 4.5],
  ['--text-tertiary', '--surface', 4.5],
  ['--text-primary', '--shell', 4.5],
  ['--text-body', '--sidebar', 4.5],
  ['--text-secondary', '--sidebar', 4.5],
  ['--text-secondary', '--raised', 4.5],
  ['--text-tertiary', '--raised', 4.5],
  ['--text-primary', '--raised', 4.5],
  ['--text-on-accent', '--accent', 4.5],
  [
    '--text-on-accent',
    '--accent-hover',
    3,
    'on-accent on hover fill (large/UI text floor 3)',
  ],
  ['--accent-fg', '--surface', 4.5],
  ['--accent-fg', '--sidebar', 4.5],
  ['--success-fg', '--surface', 4.5],
  ['--warning-fg', '--surface', 4.5],
  ['--danger-fg', '--surface', 4.5],
  ['--info-fg', '--surface', 4.5],
  ['--neutral-fg', '--surface', 4.5],
  ['--text-quaternary', '--surface', 3, 'decorative icon, non-text floor 3'],
  [
    '--accent',
    '--surface',
    3,
    'accent as a mark (focus/underline/switch), non-text floor 3',
  ],
  [
    '--border-strong',
    '--surface',
    1.2,
    'input border, hairline legibility (informational)',
  ],
];
// Tinted pills: fg on (subtle over surface)
for (const t of ['success', 'warning', 'danger', 'info', 'neutral'])
  PAIRS.push([
    `--${t}-fg`,
    `--${t}-subtle`,
    4.5,
    `${t} pill text on its tint over surface`,
    '--surface',
  ]);
PAIRS.push([
  '--accent-fg',
  '--accent-subtle',
  4.5,
  'accent text on accent tint over surface',
  '--surface',
]);
for (let i = 1; i <= 8; i++)
  PAIRS.push([
    `--chart-${i}`,
    '--surface',
    3,
    'chart series vs panel, non-text floor 3',
  ]);

let fail = 0;
for (const [name, theme] of [
  ['dark', dark],
  ['light', light],
]) {
  console.log(`\n${name.toUpperCase()}`);
  for (const [fgT, bgT, floor, label, under] of PAIRS) {
    const base = parse(theme[under ?? bgT]);
    const bg = over(parse(theme[bgT]), base.slice(0, 3));
    const fg = over(parse(theme[fgT]), bg);
    const r = ratio(fg, bg);
    const ok = r >= floor;
    if (!ok) fail++;
    console.log(
      `${ok ? 'ok  ' : 'FAIL'} ${r
        .toFixed(2)
        .padStart(5)}:1 (>=${floor})  ${fgT} on ${bgT}${
        label ? `  [${label}]` : ''
      }`,
    );
  }
}
process.exit(fail ? 1 : 0);
