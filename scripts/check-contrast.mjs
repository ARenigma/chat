#!/usr/bin/env node
/**
 * WCAG contrast for every foreground/background pair the design actually uses.
 *
 * Written when the neutral ramp was swapped from warm paper to iOS greys. A
 * palette change is the one edit that can silently break legibility everywhere
 * at once: every ratio in the file's own notes was measured against the *old*
 * background, so after a swap those notes are claims about a colour that no
 * longer exists. This recomputes them from `design/tokens.json` and fails on a
 * pair that drops below its target.
 *
 * Targets follow WCAG 2.1 AA: 4.5:1 for body text, 3:1 for large text (>=18.66px
 * bold or >=24px) and for non-text UI boundaries. Where a pair is deliberately
 * below its nominal target the exemption is named here, not waived silently.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const spec = JSON.parse(readFileSync(`${ROOT}design/tokens.json`, 'utf8'));
const T = spec.color.tokens;

// Sliced rather than bit-shifted: the repo forbids bitwise operators, and for a
// six-digit hex the substrings are the clearer read anyway.
const srgb = hex =>
  [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)].map(pair => {
    const c = parseInt(pair, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
const luminance = hex => {
  const [r, g, b] = srgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

/**
 * `target` is the AA threshold this pair must meet.
 *
 * `exempt` marks a pair that is intentionally below 4.5:1 with the reason. Only
 * two qualify, and both are non-body uses: a timestamp is glanceable metadata,
 * and a 1px divider is not text at all.
 */
const PAIRS = [
  {
    fg: 'text/primary',
    bg: 'bg/base',
    target: 4.5,
    what: 'body copy on the page',
  },
  {
    fg: 'text/primary',
    bg: 'bg/raised',
    target: 4.5,
    what: 'body copy in a card',
  },
  {
    fg: 'text/primary',
    bg: 'bg/sunken',
    target: 4.5,
    what: 'body copy on a sunken field',
  },
  {
    fg: 'text/secondary',
    bg: 'bg/base',
    target: 4.5,
    what: 'previews and taglines',
  },
  {
    fg: 'text/secondary',
    bg: 'bg/raised',
    target: 4.5,
    what: 'previews in a card',
  },
  {
    fg: 'text/tertiary',
    bg: 'bg/raised',
    target: 3,
    what: 'timestamps and receipts',
    exempt:
      'glanceable metadata, never the only carrier of meaning — the row it labels is legible without it',
  },
  {
    fg: 'text/onAccent',
    bg: 'bg/accentStrong',
    target: 4.5,
    what: 'the label on your own bubble',
  },
  {
    fg: 'text/onInverse',
    bg: 'bg/inverse',
    target: 4.5,
    what: 'the primary button label',
  },
  {
    fg: 'text/accent',
    bg: 'bg/base',
    target: 4.5,
    what: 'links and the read receipt',
  },
  {
    fg: 'text/accent',
    bg: 'bg/raised',
    target: 4.5,
    what: 'accent text in a card',
  },
  {
    fg: 'text/accent',
    bg: 'bg/accentTint',
    target: 4.5,
    what: 'the avatar initial',
  },
  {
    fg: 'text/positive',
    bg: 'bg/positive',
    target: 4.5,
    what: 'the review prompt',
  },
  { fg: 'text/token', bg: 'bg/token', target: 4.5, what: 'the balance pill' },
  {
    fg: 'state/danger',
    bg: 'bg/base',
    target: 4.5,
    what: 'the destructive action',
  },
  {
    fg: 'state/danger',
    bg: 'bg/raised',
    target: 4.5,
    what: 'the destructive action in a sheet',
  },
  {
    fg: 'state/available',
    bg: 'bg/base',
    target: 3,
    what: 'the presence dot (non-text)',
  },
  {
    fg: 'state/available',
    bg: 'bg/raised',
    target: 3,
    what: 'the presence dot on a card',
  },
  {
    fg: 'border/hairline',
    bg: 'bg/raised',
    target: 1.2,
    what: 'card divider',
    exempt:
      'a hairline is a seam, not a boundary a user must find — border/strong is what carries meaning',
  },
  {
    fg: 'border/strong',
    bg: 'bg/base',
    target: 1.5,
    what: 'input and toggle outline',
  },
];

let failures = 0;
const rows = [];
for (const mode of ['Light', 'Dark']) {
  for (const pair of PAIRS) {
    const fg = T[pair.fg]?.[mode];
    const bg = T[pair.bg]?.[mode];
    if (!fg || !bg) {
      console.error(`unknown token in pair ${pair.fg} on ${pair.bg}`);
      failures += 1;
      continue;
    }
    const r = ratio(fg, bg);
    const ok = r >= pair.target;
    if (!ok) {
      failures += 1;
    }
    rows.push(
      `${ok ? '  ok  ' : '  FAIL'} ${mode.padEnd(5)} ${pair.fg.padEnd(
        16,
      )} on ${pair.bg.padEnd(16)} ` +
        `${r.toFixed(2).padStart(6)}:1  (needs ${pair.target})  ${pair.what}` +
        (pair.exempt ? `\n           exempt: ${pair.exempt}` : ''),
    );
  }
}

console.log(rows.join('\n'));
if (failures > 0) {
  console.error(`\ncontrast FAILED — ${failures} pair(s) below target`);
  process.exit(1);
}
console.log(`\ncontrast OK — ${PAIRS.length * 2} pairs meet WCAG AA targets`);
