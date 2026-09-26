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
    what: 'previews in a card; the explore row rate on the name line',
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
  /*
   * THE CORAL, re-registered 2026-09-26 when every coral role was pinned to one
   * ramp (design/tokens.json `color.ramp`, Bluesky's alf model). Every fill is
   * step 500 in both modes, so the rows below that used to exist to PROHIBIT a
   * label on the pale "bright" coral are now rows that PERMIT one: white on
   * step 500 is 5.19:1, the same number in light and dark. What changed shape
   * is the ink: accent text is 500 light / 300 dark, text on a tint is its own
   * role (800 / 300), and the own bubble takes white.
   */
  {
    fg: 'text/onAccent',
    bg: 'bg/accentStrong',
    target: 4.5,
    what: 'the label on a filled accent control',
  },
  /*
   * The pair whose ABSENCE was once the defect (white labels shipped on the pale
   * coral at 3.44:1 on five surfaces while this file reported all green), kept
   * registered for that reason. It now passes at the full 4.5: bg/accent and
   * bg/accentStrong are the same step, so there is no longer a coral that must
   * not carry text. developer.android.com/guide/topics/ui/accessibility/apps
   * ("Increase text visibility") puts every label under 18sp at 4.5:1.
   */
  {
    fg: 'text/onAccent',
    bg: 'bg/accent',
    target: 4.5,
    what: 'a label on the accent fill (spotlight CTA, recharge pill, push gate, the explore row CTA while pressed)',
  },
  /*
   * The chat bubbles. Your own bubble is the brand fill, step 500 in both
   * modes, so it takes white ink (bubble/text); the peer's bubble is neutral
   * and takes text/primary, which is what ChatMessageCellV2 reads for it. The
   * one bubble/text value served both bubbles only while the outgoing fill was
   * pale in light, and that fill is gone.
   *
   * `bubble/meta` is rgba, which this reader cannot parse, so it is composited
   * over the bubble in BUBBLE_META below rather than left as a named gap.
   */
  {
    fg: 'bubble/text',
    bg: 'bubble/mine',
    target: 4.5,
    what: 'your own message, and the quote inside it',
  },
  {
    fg: 'text/onAccent',
    bg: 'bubble/mine',
    target: 4.5,
    what: 'the voice note player ink on your own bubble',
  },
  {
    fg: 'text/primary',
    bg: 'bubble/theirs',
    target: 4.5,
    what: 'their message, and the quote inside it',
  },
  {
    fg: 'bubble/tickRead',
    bg: 'bubble/mine',
    target: 3,
    what: 'the read tick on your own bubble',
    exempt:
      'a non-text indicator, and never the only signal that a message was read: read is the two-glyph checkCheck, sent is the single check. 3:1 is the non-text target from developer.android.com/guide/topics/ui/accessibility/apps',
  },
  /*
   * The reply-quote rule, a 2dp bar beside a quoted message. On your own bubble
   * it takes the bubble's own ink, because no coral can be seen on a coral
   * fill; on the peer's it takes text/accent, because bg/accent (step 500) is
   * 2.61:1 on the dark peer bubble #232E3B and step 300 is 5.67:1.
   */
  {
    fg: 'bubble/text',
    bg: 'bubble/mine',
    target: 3,
    what: 'the reply-quote rule inside your own bubble (non-text)',
    exempt:
      'a 2dp rule, not text: 3:1 is the non-text target from developer.android.com/guide/topics/ui/accessibility/apps. Never the only signal, the quoted author and body sit beside it',
  },
  {
    fg: 'text/accent',
    bg: 'bubble/theirs',
    target: 3,
    what: 'the reply-quote rule inside their bubble (non-text)',
    exempt: 'same rule, other fill, see the row above',
  },
  {
    fg: 'text/onInverse',
    bg: 'bg/inverse',
    target: 4.5,
    what: "the primary button label; the explore row's away Notify while pressed",
  },
  /*
   * Accent INK. Step 500 light, 300 dark. The decision named 400 for dark and
   * 400 is 4.84:1 on the dark base, but 4.34:1 on the dark card, and this ink
   * is on the card (the sheet bar's Cancel/Done, ProviderRow's CTA label), so
   * the card row below is the one that set the step.
   */
  {
    fg: 'text/accent',
    bg: 'bg/base',
    target: 4.5,
    what: 'links, the retry status, accent figures',
  },
  {
    fg: 'text/accent',
    bg: 'bg/raised',
    target: 4.5,
    what: 'accent text in a card or sheet (sheet bar actions, row CTA label)',
  },
  {
    fg: 'text/accent',
    bg: 'bg/grouped',
    target: 4.5,
    what: 'a link on the grouped settings page',
  },
  {
    fg: 'bg/accent',
    bg: 'bg/base',
    target: 3,
    what: 'a coral mark on the page: the tonal Notify outline, the unread ring, the typing dots',
    exempt:
      'a non-text boundary or mark, never the only signal (the Notify label, the unread badge, the "typing" word carry it in text). 3:1 is the non-text target from developer.android.com/guide/topics/ui/accessibility/apps',
  },
  {
    fg: 'border/accent',
    bg: 'bg/base',
    target: 3,
    what: 'a selection ring on an avatar, a suggestion or the primary photo',
    exempt:
      'non-text, 3:1. The primary photo also carries a check badge, a suggestion also fills the field, an avatar choice also changes the preview',
  },
  /*
   * The outline of ProviderRow's CTA AT REST, which sits on the card fill and is
   * that control's only boundary. bg/accent there is 2.91:1 in dark, under 3,
   * so the stroke takes the accent INK instead: 6.25:1.
   */
  {
    fg: 'text/accent',
    bg: 'bg/raised',
    target: 3,
    what: "the explore row CTA's resting outline on the card (non-text)",
  },
  /*
   * ...and the same CTA WHILE PRESSED, which is the one place bg/accent meets
   * the card with nothing between them. Since 2026-09-27 the press is one solid
   * coral shape with the outline faded out under it (Amit, on the S22: remove
   * the rim), so the fill's own edge is the boundary for the length of a press:
   * 5.19:1 light, 2.91:1 dark, under the nominal 3.
   *
   * Named rather than waived. The target is a FLOOR for this transient state,
   * set under today's 2.91 so a ramp change that sinks the pressed coral into
   * the card still fails here.
   */
  {
    fg: 'bg/accent',
    bg: 'bg/raised',
    target: 2.8,
    what: 'the explore row CTA fill while pressed, its own edge on the card (non-text)',
    exempt:
      'transient press feedback under the finger (100-150ms), not the boundary the control is found by: the resting outline is registered above at 6.25:1 and returns on release, and the label on the fill is text/onAccent at 5.19:1. Owner decision 2026-09-27',
  },
  /*
   * The coral WASH (step 50 light / 950 dark) and what sits on it.
   *
   * text/accent is NOT registered here and must not be used here: step 500 on
   * step 50 is 4.4986:1, a fraction under the 4.5 floor for the 12-14sp labels
   * these pills carry. The wash has its own ink, text/onAccentTint (800 / 300).
   * The tonal Notify button keeps its 1dp stroke because the wash against the
   * page is 1.17:1 light / 1.01:1 dark, i.e. no boundary at all on its own.
   */
  {
    fg: 'text/onAccentTint',
    bg: 'bg/accentTint',
    target: 4.5,
    what: 'a label on the wash: reroll, retry, warm chip, tonal Notify, offer banner',
  },
  {
    fg: 'text/primary',
    bg: 'bg/accentTint',
    target: 4.5,
    what: 'the talk-time timer on the low-balance bar, the UPI row check',
  },
  {
    fg: 'text/secondary',
    bg: 'bg/accentTint',
    target: 4.5,
    what: 'the low-balance bar and extend card copy',
  },
  {
    fg: 'text/accent',
    bg: 'bg/accentTint',
    target: 3,
    what: 'the active nav glyph on its tint indicator (non-text)',
    exempt:
      'a glyph, not a label: 3:1 is the non-text target. The destination label under it is text, and the indicator pill is a second signal',
  },
  /*
   * The bottom bar's selected glyph on its own pill (src/shell/bottom-bar,
   * nav-migration step 5). The pill is bg/navIndicator, not the wash, because
   * the wash's dark step 950 is 1.005:1 against the dark bar; 900 is the step
   * that separates from the bar as much as the light pill does (1.13 vs 1.16).
   * The glyph stays text/accent: bg/accent (step 500) on 900 is 2.87:1, under
   * the 3:1 non-text floor, so dark keeps the 300 ink (6.16:1).
   */
  {
    fg: 'text/accent',
    bg: 'bg/navIndicator',
    target: 3,
    what: 'the selected bottom-bar glyph on its indicator pill (non-text)',
  },
  /*
   * Glyph ink on the state fills of the ring and suggestion prompts. These took
   * text/onAccent while it was near-black in dark; when that went white for
   * the step-500 coral, the dark state fills (both LIGHT colours) would have
   * lost their glyphs, so the ink moved to its own role with the old values.
   */
  {
    fg: 'text/onState',
    bg: 'state/danger',
    target: 3,
    what: 'the decline glyph on the ring prompt (non-text)',
  },
  {
    fg: 'text/onState',
    bg: 'state/available',
    target: 3,
    what: 'the accept glyph on the ring prompt (non-text)',
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
  /*
   * The category INK straight on the card, since the explore row's category
   * stopped being a chip (2026-09-26): a filled glyph and the word, both in the
   * category's text-safe tone. 4.5 because the word is text under 18sp; the
   * glyph beside it is non-text and passes the same number with room to spare.
   */
  {
    fg: 'text/listener',
    bg: 'bg/raised',
    target: 4.5,
    what: 'the Listener category mark and word on a directory card',
  },
  {
    fg: 'text/astrologer',
    bg: 'bg/raised',
    target: 4.5,
    what: 'the Astrologer category mark and word on a directory card',
  },
  /*
   * The filled verified seal beside the name, Bluesky's verified blue. A mark,
   * not text, so the 3:1 non-text floor; and never the only statement of the
   * fact, which the card's spoken label and the directory's own filter carry.
   */
  {
    fg: 'mark/verified',
    bg: 'bg/raised',
    target: 3,
    what: 'the verified seal beside a provider name on the card (non-text)',
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
  /*
   * The wallet pill between ten minutes and an hour: NEUTRAL since 2026-09-26
   * (Amit), the page colour with a 1dp outline and primary ink, where it used
   * to be a lime fill (text/token on bg/token). Its label is the balance, so
   * the ink takes 4.5; the outline is registered at the input-outline floor
   * because the figure inside, not the stroke, is what a member reads.
   */
  {
    fg: 'text/primary',
    bg: 'bg/base',
    target: 4.5,
    what: 'the neutral (10m to 1h) wallet pill balance',
  },
  {
    fg: 'border/strong',
    bg: 'bg/base',
    target: 1.5,
    what: 'the neutral wallet pill outline',
    exempt:
      'the same outline recipe as an input: the balance inside carries the meaning at 17.01:1 / 16.84:1, the stroke only draws the pill',
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
  /*
   * The directory CTA while the provider is FREE (ProviderRow, 2026-09-27):
   * green outline and label at rest, solid green with text/onState while
   * pressed. text/available is the text-safe member; state/available (the
   * dot) is 3.84:1 in light and cannot carry a label.
   */
  {
    fg: 'text/available',
    bg: 'bg/raised',
    target: 4.5,
    what: 'the explore row CTA label and glyph while the provider is free',
  },
  {
    fg: 'text/available',
    bg: 'bg/raised',
    target: 3,
    what: "the explore row CTA's resting outline while free (non-text)",
  },
  {
    fg: 'text/onState',
    bg: 'bg/available',
    target: 4.5,
    what: 'the explore row CTA label on its green fill while pressed',
  },
  {
    fg: 'bg/available',
    bg: 'bg/raised',
    target: 3,
    what: 'the explore row CTA green fill while pressed, its own edge on the card (non-text)',
  },
  /*
   * ...and while the provider is BUSY: state/danger outline, label and the
   * "wait ~Nm" line under the button (textXs, so the full 4.5), and the same
   * garnet as the pressed fill under text/onState.
   */
  {
    fg: 'text/onState',
    bg: 'state/danger',
    target: 4.5,
    what: 'the explore row busy CTA label on its fill while pressed',
  },
  {
    fg: 'state/danger',
    bg: 'bg/raised',
    target: 3,
    what: "the explore row busy CTA's outline, and its pressed fill's edge, on the card (non-text)",
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
 * `featuredMeta`), the same reason `bubble/meta`'s rgba is
 * named as a gap above rather than parsed — this file's token reader only
 * takes six-digit hex from design/tokens.json. If any of these five values
 * change in HomeScreen.tsx, this block has to change with them by hand.
 */
// featuredScrim holds 0.62 from 0% to 38% of the card's height (2026-09-26,
// the 150x200 portrait card), and the whole text block is the bottom 36%, so
// every line sits on the full 62% rather than only the bottom edge.
const SCRIM_OPACITY_AT_TEXT = 0.62;
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
  /*
   * The name took the row's name role on the portrait card: 16px Bold is NOT
   * large text (large is >=18.66px bold), so it needs the full 4.5 where the
   * old 24px name needed 3. The tagline is gone from the card (it held about
   * 18 characters at 126dp), so it is gone from here.
   */
  {
    what: 'featuredName (titleMediumEmphasized, 16px Bold — not large text)',
    color: '#ffffff',
    alpha: 1,
    target: 4.5,
  },
  {
    what: 'featuredAge (bodySmall, 12px Regular)',
    color: '#ffffff',
    alpha: 0.82,
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

/*
 * `bubble/meta` on your own bubble, composited rather than skipped.
 *
 * The clock and the sent tick are translucent white over the step-500 fill,
 * and WCAG measures the pixel that lands, so the token's rgba is parsed and
 * blended over `bubble/mine` here. Read from design/tokens.json rather than
 * hand-copied, unlike the hero block above, because both halves ARE tokens.
 * The target is the timestamp exemption the thread-bubble row states: glanceable
 * metadata beside a message that already passes at 4.5, never the only carrier
 * of when it was sent.
 */
const parseRgba = value => {
  const m = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value);
  if (!m) {
    return null;
  }
  const toHex = n => Number(n).toString(16).padStart(2, '0');
  return {
    hex: `#${toHex(m[1])}${toHex(m[2])}${toHex(m[3])}`,
    alpha: Number(m[4]),
  };
};

const BUBBLE_META = { fg: 'bubble/meta', bg: 'bubble/mine', target: 3 };
for (const mode of ['Light', 'Dark']) {
  const fg = parseRgba(T[BUBBLE_META.fg][mode]);
  const bg = T[BUBBLE_META.bg][mode];
  if (!fg) {
    console.error(
      `bubble/meta ${mode} is not rgba(r,g,b,a): ${T[BUBBLE_META.fg][mode]}`,
    );
    failures += 1;
    continue;
  }
  const landed = composite(fg.hex, fg.alpha, bg);
  const r = ratio(landed, bg);
  const ok = r >= BUBBLE_META.target;
  if (!ok) {
    failures += 1;
  }
  rows.push(
    `${ok ? '  ok  ' : '  FAIL'} ${mode.padEnd(5)} ${BUBBLE_META.fg.padEnd(
      16,
    )} on ${BUBBLE_META.bg.padEnd(16)} ` +
      `${r.toFixed(2).padStart(6)}:1  (needs ${
        BUBBLE_META.target
      })  the clock and sent tick on your bubble, composited to ${landed}` +
      '\n           exempt: glanceable metadata, same exemption as the thread-bubble timestamp',
  );
}

console.log(rows.join('\n'));
if (failures > 0) {
  console.error(`\ncontrast FAILED, ${failures} pair(s) below target`);
  process.exit(1);
}
console.log(
  `\ncontrast OK, ${
    PAIRS.length * 2 + HERO_TEXT_PAIRS.length + 2
  } pairs meet WCAG AA targets`,
);
