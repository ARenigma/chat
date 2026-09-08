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
  /*
   * The thread bubble put three more foregrounds onto `bg/sunken` at once.
   *
   * Until Chats became bubbles, the only thing measured against that fill was
   * `text/primary`, because a sunken surface was a search field and a search
   * field holds one kind of text. A bubble holds four: a name, a preview, a
   * timestamp and a presence dot. All three of the new ones pass today, which is
   * exactly why they belong here: the risk is not that the design is wrong now,
   * it is that somebody tunes a grey later and nothing notices.
   */
  {
    fg: 'text/secondary',
    bg: 'bg/sunken',
    target: 4.5,
    what: "a thread bubble's message preview",
  },
  {
    fg: 'text/tertiary',
    bg: 'bg/sunken',
    target: 3,
    exempt:
      'a timestamp is a secondary label beside a name that already passes at 4.5, and it is never the only way to know when a message arrived',
    what: "a thread bubble's timestamp",
  },
  {
    fg: 'state/available',
    bg: 'bg/sunken',
    target: 3,
    what: 'the presence dot on a thread bubble (non-text)',
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
      'glanceable metadata, never the only carrier of meaning, the row it labels is legible without it',
  },
  {
    fg: 'text/onAccent',
    bg: 'bg/accentStrong',
    target: 4.5,
    /*
     * NOT the bubble any more (2026-09-08). The outgoing bubble moved to
     * `bubble/mine`, which is WhatsApp's PALE green and takes dark text; this
     * pair now measures what it always actually measured — a filled accent
     * control under its label. Light is 4.52:1, which clears 4.5 by 0.02, so
     * treat any further tune of bg/accentStrong as load-bearing.
     */
    what: 'the label on a filled accent control',
  },
  /*
   * The bright accent, registered because it must NEVER carry a label.
   *
   * This pair's ABSENCE was the defect. `text/onAccent` was measured against
   * `bg/accentStrong` above and against nothing else, so the file reported "56
   * pairs meet WCAG AA targets" while white 12sp and 14sp labels shipped on
   * `bg/accent` on five surfaces — a spotlight CTA, the talk-time meter's
   * Recharge pill, the wallet ₹ disc, a recharge pack ribbon and the selected
   * age chip. A gate that only measures the pairs somebody remembered to list
   * cannot report the pair somebody forgot, so the forgotten one is listed.
   *
   * developer.android.com/guide/topics/ui/accessibility/apps ("Increase text
   * visibility"): "If the text is smaller than 18sp, or if the text is bold and
   * smaller than 14sp, use foreground and background colors that result in a
   * color contrast ratio of at least 4.5:1. For all other text, set the color
   * contrast ratio to at least 3:1." Every one of those five labels was under
   * 18sp, so 4.5:1 was the floor and 3.44:1 light / 2.59:1 dark was the reality.
   *
   * `target` is the measured floor, not a legibility threshold — the same move
   * `border/hairline` on `bg/raised` makes at 1.2. It cannot be 4.5, and it
   * cannot even be the 3:1 large-text step, because in dark mode the accent is a
   * LIGHT blue (#5FA3DE) and 2.59:1 clears neither. There is no size at which
   * white is legible on this fill in dark, and no ink in the palette rescues it
   * either (`text/primary` on `bg/accent` is 4.95:1 light but 2.70:1 dark, and
   * in dark `text/primary` IS white). So the honest reading is not "large text
   * only" — it is that this pair has no permitted use, which is what
   * design/tokens.json says on the token itself.
   */
  {
    fg: 'text/onAccent',
    bg: 'bg/accent',
    target: 2.5,
    what: 'NOT PERMITTED IN LIGHT — the bright accent under its label',
    exempt:
      'registered at its measured floor rather than a legibility target. UPDATED 2026-09-08 and the update matters: this row used to say no text may sit on bg/accent in EITHER mode, which was true when the dark accent was a light blue under a white label (2.59:1). With WhatsApp green, dark mode flipped text/onAccent to near-black ink and this pair now measures 7.21:1 — genuinely legible, so the dark prohibition is withdrawn rather than left standing as a false claim. LIGHT is still prohibited at 3.01:1: white on #1DAA61 clears neither 4.5 nor the 3:1 large-text step by any useful margin, and bg/accentStrong (4.52:1) is the step that carries a label there. The floor stays 2.5 because one target covers both modes and light is the binding one',
  },
  /*
   * The WhatsApp bubbles (2026-09-08).
   *
   * Registered because the bubble fills are the one place in this palette where
   * light and dark are not the same colour dimmed: light outgoing is a PALE
   * green (#D9FDD3) taking near-black text, dark outgoing is a deep teal
   * (#144D37) taking near-white. A single `bubble/text` token serves both, so
   * these four rows are what prove that one value works against all four fills.
   *
   * `bubble/meta` — the timestamp and the sent/delivered tick — is deliberately
   * NOT registered: it is rgba, and this file's parser reads six-digit hex
   * only. It falls under the same exemption the existing timestamps row states
   * (glanceable metadata, never the only carrier of meaning). Compositing it
   * here would mean hard-coding a blend result that the token itself does not
   * contain, which is worse than naming the gap.
   */
  {
    fg: 'bubble/text',
    bg: 'bubble/mine',
    target: 4.5,
    what: 'your own message',
  },
  {
    fg: 'bubble/text',
    bg: 'bubble/theirs',
    target: 4.5,
    what: 'their message',
  },
  {
    fg: 'bubble/tickRead',
    bg: 'bubble/mine',
    target: 3,
    what: 'the blue read tick on your own bubble',
    exempt:
      'a non-text indicator, and never the only signal that a message was read — the tick doubles from one to two glyphs, so its MEANING survives even where its colour does not; 3:1 is the non-text target from developer.android.com/guide/topics/ui/accessibility/apps',
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
    bg: 'bg/base',
    target: 4.5,
    what: 'the explore row CTA label',
  },
  {
    fg: 'bg/accent',
    bg: 'bg/base',
    target: 3,
    what: 'the outline around the explore row CTA',
    exempt:
      'a non-text boundary, and never the only signal — the label inside it reads "Chat" in text/accent at full AA. 3:1 is the non-text target from developer.android.com/guide/topics/ui/accessibility/apps',
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
  {
    fg: 'text/token',
    bg: 'bg/token',
    target: 4.5,
    what: 'the balance pill (lime mid)',
  },
  {
    fg: 'text/onTokenStrong',
    bg: 'bg/tokenHealthy',
    target: 4.5,
    what: 'the healthy (≥1h) wallet pill',
  },
  {
    fg: 'text/onTokenStrong',
    bg: 'bg/tokenCritical',
    target: 4.5,
    what: 'the critical (<10m) wallet pill',
  },
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
      'a hairline is a seam, not a boundary a user must find, border/strong is what carries meaning',
  },
  {
    fg: 'border/strong',
    bg: 'bg/base',
    target: 1.5,
    what: 'input and toggle outline',
  },
  // bg/grouped is the second page colour, so everything that reads on bg/base
  // has to read on it too. Added with the token rather than after somebody
  // notices a settings footer has gone pale.
  {
    fg: 'text/primary',
    bg: 'bg/grouped',
    target: 4.5,
    what: 'a row label on the grouped page',
  },
  {
    fg: 'text/secondary',
    bg: 'bg/grouped',
    target: 4.5,
    what: 'a section footer under a group',
  },
  {
    fg: 'border/hairline',
    bg: 'bg/grouped',
    target: 1.2,
    what: 'the separator between grouped rows',
    exempt:
      'a hairline is a seam, not a boundary a user must find: border/strong is what carries meaning',
  },
  // The selected cell keeps its label readable, which is the whole reason the
  // iOS highlight is a mid grey and not the accent.
  {
    fg: 'text/primary',
    bg: 'bg/selected',
    target: 4.5,
    what: 'a row label while the cell is held',
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
  console.error(`\ncontrast FAILED, ${failures} pair(s) below target`);
  process.exit(1);
}
console.log(`\ncontrast OK, ${PAIRS.length * 2} pairs meet WCAG AA targets`);
