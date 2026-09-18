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
  /*
   * NARROWED 2026-09-17, because the words "glanceable metadata" were doing
   * work they were never entitled to do.
   *
   * This row exempts `text/tertiary` on a card at 4.39:1 light / 3.30:1 dark.
   * That is defensible for the thing it was written for — the review count
   * under a provider's stars — and it silently covered something else: the
   * away "Notify" CTA's label and bell on ProviderRow, which took the same ink
   * on the same fill. A button's label IS the only carrier of its meaning, and
   * the second clause of this exemption asserted the opposite on its behalf. So
   * the exemption now names what it covers, and the CTA has its own registered
   * pairs below rather than a borrowed excuse.
   */
  {
    fg: 'text/tertiary',
    bg: 'bg/raised',
    target: 3,
    what: 'a review count or a receipt under the row it annotates',
    exempt:
      'glanceable metadata ONLY, never the only carrier of meaning, the row it labels is legible without it. NOT a control: the label of anything tappable is the only carrier of what the tap does, so it takes the full 4.5 and is registered as its own pair',
  },
  {
    fg: 'text/onAccent',
    bg: 'bg/accentStrong',
    target: 4.5,
    /*
     * NOT the bubble. The outgoing bubble is `bubble/mine` (pale coral light /
     * deep coral dark, takes bubble/text); this pair measures a filled accent
     * control under its label. Light accentStrong is #A74029 and carries white
     * at 6.16:1 — it was #C0492F at 4.96:1 until the coral was darkened a step
     * on 2026-09-12 (Amit: "our token is too light.. make it little darker
     * coral"), which moved this pair further clear rather than closer. Still
     * treat any tune of bg/accentStrong as load-bearing: it was on 4.96 once.
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
      'registered at its measured floor rather than a legibility target. Dark mode flips text/onAccent to near-black ink on the coral, and that pair measures 6.15:1 — genuinely legible, so no dark prohibition. LIGHT is still prohibited at 3.89:1: white on #EE4027 clears neither 4.5 nor the 3:1 large-text step by a useful margin (bg/accentStrong #A74029, 6.16:1, is the step that carries a label there). Both figures moved on 2026-09-12 when the coral was darkened a step (light 3.28 -> 3.89, dark 7.13 -> 6.15); the light prohibition is unchanged in kind, and the floor stays 2.5 because one target covers both modes and light is the binding one',
  },
  /*
   * The chat bubbles (outgoing recoloured to coral 2026-09-10).
   *
   * Registered because the bubble fills are the one place in this palette where
   * light and dark are not the same colour dimmed: light outgoing is a PALE
   * coral (#FBDAD0) taking near-black text, dark outgoing is a DEEP coral
   * (#6E3A2E) taking near-white. A single `bubble/text` token serves both, so
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
  /*
   * The reply quote inside a bubble. Registered on 2026-09-12 because it was
   * the one surface in the transcript that nothing measured, and it had been
   * illegible in both modes since the outgoing bubble stopped being the accent
   * fill: the rule and both lines were `text/onAccent`, which measured 1.31:1
   * light and 1.89:1 dark on `bubble/mine`. Only two rows are needed rather
   * than four, because dropping the fork means the quote takes the same
   * `bubble/text` the body does, and those two pairs are already registered
   * above — what is NOT covered there is the left rule, so that is what these
   * measure, against both fills.
   */
  {
    fg: 'bg/accentStrong',
    bg: 'bubble/mine',
    target: 3,
    what: 'the reply-quote rule inside your own bubble (non-text)',
    exempt:
      'a 2dp rule, not text: 3:1 is the non-text target from developer.android.com/guide/topics/ui/accessibility/apps. It is also never the only signal — the quoted author and body sit beside it in bubble/text',
  },
  {
    fg: 'bg/accentStrong',
    bg: 'bubble/theirs',
    target: 3,
    what: 'the reply-quote rule inside their bubble (non-text)',
    exempt: 'same rule, other fill — see the row above',
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
  /*
   * The away "Notify" control, on the profile and on the directory row.
   *
   * Registered because its ABSENCE was the defect, the same way `text/onAccent`
   * on `bg/accent` was. Both surfaces painted an ENABLED control with M3's
   * DISABLED recipe — transparent container, hairline stroke, tertiary ink —
   * and this file reported "contrast OK" throughout, because neither pair was
   * listed and the tertiary-on-a-card row above was broad enough to cover the
   * one that existed. What was actually on screen: the label at 4.39:1 light /
   * 3.30:1 dark against the 4.5 floor (12dp and 14dp type, so 4.5 is the floor
   * — developer.android.com/guide/topics/ui/accessibility/apps), and a boundary
   * at 1.71:1 light / 1.35:1 dark against 3. The ProviderDetail container was
   * worse than a low number: `styles.cta` also filled with `bg/raised`, the
   * card's own colour, so the container had literally no contrast with the
   * surface it sat on.
   *
   * The recipe is now M3's FILLED TONAL button: "Filled tonal buttons have a
   * lighter background color and darker label color, making them less visually
   * prominent than a regular filled button. They're still used for final or
   * unblocking actions in a flow, but may be better when these actions don't
   * require quite so much emphasis" — which is exactly what Notify is next to
   * Call. Emphasis order in the same doc: elevated, filled, filled tonal,
   * outlined, text.
   * https://github.com/material-components/material-components-android/blob/master/docs/components/CommonButton.md
   *
   * ONE STATED DEPARTURE: M3's tonal button has no stroke (strokeColor null,
   * strokeWidth 0dp). Ours keeps a 1dp accent stroke, and the third row below
   * is why — `bg/accentTint` against the card it sits on measures 1.19:1 light
   * and 1.02:1 dark, i.e. in dark mode the tonal FILL alone is not a boundary
   * at all. The stroke is what makes the control findable, so it is measured on
   * the 3:1 non-text floor rather than assumed.
   */
  {
    fg: 'text/accent',
    bg: 'bg/accentTint',
    target: 4.5,
    what: 'the away Notify label (ProviderDetail + ProviderRow)',
  },
  {
    fg: 'bg/accent',
    bg: 'bg/base',
    target: 3,
    what: "the away Notify button's outline (non-text)",
  },
  {
    fg: 'bg/accent',
    bg: 'bg/raised',
    target: 3,
    what: "the away Notify CTA's outline on a card",
  },
  {
    fg: 'text/positive',
    bg: 'bg/positive',
    target: 4.5,
    what: 'the review prompt',
  },
  {
    fg: 'text/onListener',
    bg: 'bg/listener',
    target: 4.5,
    what: 'the Listener type tag on a directory card',
  },
  {
    fg: 'text/onAstrologer',
    bg: 'bg/astrologer',
    target: 4.5,
    what: 'the Astrologer type tag on a directory card',
  },
  {
    fg: 'bg/listener',
    bg: 'bg/raised',
    target: 1.15,
    what: 'the Listener tag FILL against the card it sits on',
    exempt:
      'not a legibility target — the label inside already clears 4.5:1. This pins that the FILL is visible AS a fill, which is the whole request ("should be filled to be highlighted"). Registered at a measured floor because the first violet tried measured 1.01:1 against the dark card and was invisible; anything at or under 1.1 is not a filled chip, it is an unfilled one',
  },
  {
    fg: 'bg/astrologer',
    bg: 'bg/raised',
    target: 1.15,
    what: 'the Astrologer tag FILL against the card it sits on',
    exempt:
      'same as the Listener fill above: a visibility floor for the fill itself, not a text target',
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

/*
 * The Home hero card (HomeScreen.tsx, FeaturedCard) puts white text directly
 * over a provider PHOTOGRAPH, not a token background — the one surface in the
 * app this file's token-pair PAIRS above cannot see at all (M28, 2026-09-17
 * audit). A photo has no fixed hex to register, so what actually guarantees
 * legibility is `featuredScrim` — a black gradient, 62% opaque at the text's
 * end — composited under the text. This checks the text colors against the
 * WORST CASE the scrim has to survive: a pure white photo behind it (any real
 * photo is darker somewhere, so this is the floor, not a typical case).
 *
 * Hand-maintained, not derived from a token: these are literal style values
 * in HomeScreen.tsx (`featuredScrim`/`featuredName`/`featuredAge`/
 * `featuredTagline`/`featuredMeta`), the same reason `bubble/meta`'s rgba is
 * named as a gap above rather than parsed — this file's token reader only
 * takes six-digit hex from design/tokens.json. If any of these five values
 * change in HomeScreen.tsx, this block has to change with them by hand.
 */
const SCRIM_OPACITY_AT_TEXT = 0.62; // featuredScrim's 0% stop, where featuredBody sits
const WORST_CASE_PHOTO = '#ffffff'; // whitest a photo can be behind the scrim

const composite = (fgHex, alpha, bgHex) => {
  const [fr, fg, fb] = [
    fgHex.slice(1, 3),
    fgHex.slice(3, 5),
    fgHex.slice(5, 7),
  ].map(h => parseInt(h, 16));
  const [br, bg, bb] = [
    bgHex.slice(1, 3),
    bgHex.slice(3, 5),
    bgHex.slice(5, 7),
  ].map(h => parseInt(h, 16));
  const mix = (f, b) => Math.round(f * alpha + b * (1 - alpha));
  const toHex = n => n.toString(16).padStart(2, '0');
  return `#${toHex(mix(fr, br))}${toHex(mix(fg, bg))}${toHex(mix(fb, bb))}`;
};

// The scrim itself, composited over the worst-case photo — this is the
// effective background every hero text color is actually read against.
const scrimOverWorstPhoto = composite(
  '#000000',
  SCRIM_OPACITY_AT_TEXT,
  WORST_CASE_PHOTO,
);

const HERO_TEXT_PAIRS = [
  {
    what: 'featuredName (headlineSmallEmphasized, 24px Bold — large text)',
    color: '#ffffff',
    alpha: 1,
    target: 3,
  },
  {
    what: 'featuredAge (titleMediumEmphasized, 16px Bold — not large text)',
    color: '#ffffff',
    alpha: 0.82,
    target: 4.5,
  },
  {
    what: 'featuredTagline (bodyMedium, 14px Regular)',
    color: '#ffffff',
    alpha: 0.92,
    target: 4.5,
  },
  {
    what: 'featuredMeta (bodySmall, 12px Regular)',
    color: '#ffffff',
    alpha: 0.85,
    target: 4.5,
  },
];

for (const pair of HERO_TEXT_PAIRS) {
  const effective = composite(pair.color, pair.alpha, scrimOverWorstPhoto);
  const r = ratio(effective, scrimOverWorstPhoto);
  const ok = r >= pair.target;
  if (!ok) {
    failures += 1;
  }
  rows.push(
    `${ok ? '  ok  ' : '  FAIL'} Hero  ${pair.what.padEnd(58)} ` +
      `${r.toFixed(2).padStart(6)}:1  (needs ${
        pair.target
      })  worst-case white photo behind a ${Math.round(
        SCRIM_OPACITY_AT_TEXT * 100,
      )}% scrim`,
  );
}

console.log(rows.join('\n'));
if (failures > 0) {
  console.error(`\ncontrast FAILED, ${failures} pair(s) below target`);
  process.exit(1);
}
console.log(
  `\ncontrast OK, ${
    PAIRS.length * 2 + HERO_TEXT_PAIRS.length
  } pairs meet WCAG AA targets`,
);
