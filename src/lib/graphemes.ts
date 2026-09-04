/**
 * Emoji-aware backspace for the composer's own delete key.
 *
 * When the emoji panel replaces the IME the keyboard's backspace goes with it,
 * so the composer draws one and has to decide how much of the draft one press
 * removes. `Array.from(s).slice(0, -1)` removes one *code point*, which for a
 * toned thumbs-up (`1F44D 1F3FD`) strips the tone and leaves the yellow hand,
 * and for a family (`1F468 200D 1F469 200D 1F467 200D 1F466`) peels off one
 * person and a dangling joiner per press. Gboard deletes the whole emoji, and a
 * key that does less than the one it replaced reads as broken.
 *
 * Why a hand-rolled walker and not `Intl.Segmenter`: Hermes implements the
 * ECMA-402 7th-edition surface and does not ship `Intl.Segmenter`
 * (https://github.com/facebook/hermes/blob/main/doc/IntlAPIs.md), and the
 * polyfill is ~300KB of segmentation tables for a single call site. This file is
 * the part of UAX #29 that emoji actually exercise, walked backwards from the end
 * of the string so it costs nothing on a long draft (RULE 5: no dependency whose
 * failure mode is a third of the JS bundle). Amit, 2026-09-04.
 *
 * DELIBERATE LIMIT — do not "complete" this into a full grapheme segmenter.
 * Indic matras, Thai/Lao vowel signs, Hangul jamo and other combining marks are
 * deleted per code point: `कि` (`0915 093F`) → `क`. That is what Gboard's
 * backspace does for those scripts (the vowel sign goes first, then the
 * consonant), so matching the keyboard here is the correct behaviour and not a
 * gap. `__tests__/graphemes.test.ts` asserts it as chosen.
 *
 * The rules, in the order they are applied to the code point at the end of the
 * string (Unicode TR51 ED-14..ED-17, the emoji sequence grammar):
 *   1. one code point always goes;
 *   2. TAG characters (`E0020..E007F`, including CANCEL TAG `E007F`) are a
 *      tag_spec; keep consuming until the base (`1F3F4` for subdivision flags);
 *   3. COMBINING ENCLOSING KEYCAP `20E3` takes its keycap base, and the `FE0F`
 *      between them if present (`1 FE0F 20E3`);
 *   4. variation selectors `FE0E`/`FE0F` and Fitzpatrick modifiers
 *      `1F3FB..1F3FF` take their base; a base that is itself `FE0F` takes one
 *      more (`270C FE0F` is one glyph);
 *   5. REGIONAL INDICATORS `1F1E6..1F1FF` pair up from the left, so a run of even
 *      length ending here means this one is the second half of a flag; an odd
 *      run means the last indicator is alone and goes by itself;
 *   6. ZWJ `200D` joins the element before it into this cluster; that element is
 *      itself re-checked for rule 4 (`1F9D1 1F3FD 200D 1F91D 200D 1F9D1 1F3FF`);
 *   7. anything else is one code point.
 *
 * Never throws: a lone surrogate is one 16-bit unit that matches no rule and is
 * deleted on its own, which is also what makes the string valid again.
 */

const HIGH_SURROGATE_MIN = 0xd800;
const HIGH_SURROGATE_MAX = 0xdbff;
const LOW_SURROGATE_MIN = 0xdc00;
const LOW_SURROGATE_MAX = 0xdfff;

const ZERO_WIDTH_JOINER = 0x200d;
const COMBINING_ENCLOSING_KEYCAP = 0x20e3;
const VARIATION_SELECTOR_15 = 0xfe0e;
const VARIATION_SELECTOR_16 = 0xfe0f;
const FITZPATRICK_MIN = 0x1f3fb;
const FITZPATRICK_MAX = 0x1f3ff;
const REGIONAL_INDICATOR_MIN = 0x1f1e6;
const REGIONAL_INDICATOR_MAX = 0x1f1ff;
const TAG_MIN = 0xe0020;
const TAG_MAX = 0xe007f;

const isHighSurrogate = (unit: number): boolean =>
  unit >= HIGH_SURROGATE_MIN && unit <= HIGH_SURROGATE_MAX;
const isLowSurrogate = (unit: number): boolean =>
  unit >= LOW_SURROGATE_MIN && unit <= LOW_SURROGATE_MAX;
const isModifier = (cp: number): boolean =>
  cp === VARIATION_SELECTOR_15 ||
  cp === VARIATION_SELECTOR_16 ||
  (cp >= FITZPATRICK_MIN && cp <= FITZPATRICK_MAX);
const isRegionalIndicator = (cp: number): boolean =>
  cp >= REGIONAL_INDICATOR_MIN && cp <= REGIONAL_INDICATOR_MAX;
const isTag = (cp: number): boolean => cp >= TAG_MIN && cp <= TAG_MAX;

/**
 * Width in UTF-16 units of the code point that ends at `end` (exclusive).
 * Two only when the pair is well formed; a lone surrogate is one unit.
 */
function prevWidth(s: string, end: number): number {
  return end >= 2 && isLowSurrogate(s.charCodeAt(end - 1)) && isHighSurrogate(s.charCodeAt(end - 2))
    ? 2
    : 1;
}

/** The code point that ends at `end` (exclusive). Caller guarantees `end > 0`. */
function prevCodePoint(s: string, end: number): number {
  const width = prevWidth(s, end);
  // `codePointAt` on a well-formed pair's high half returns the full code point;
  // on a lone surrogate it returns the surrogate itself, which matches no rule.
  return s.codePointAt(end - width) ?? s.charCodeAt(end - 1);
}

/**
 * How many UTF-16 units the last user-perceived emoji cluster occupies. `0` for
 * the empty string; otherwise at least `1`.
 */
export function lastGraphemeLength(s: string): number {
  const end = s.length;
  if (end === 0) {
    return 0;
  }

  // The cursor: everything in [start, end) has been claimed by the cluster.
  let start = end;
  const consume = (): number => {
    const cp = prevCodePoint(s, start);
    start -= prevWidth(s, start);
    return cp;
  };

  // Rule 1.
  const last = consume();

  // Rule 2. A tag_spec is always terminal, and its base is the code point right
  // before the first tag, so this is the whole cluster.
  if (isTag(last)) {
    let cp = last;
    while (start > 0 && isTag(cp)) {
      cp = consume();
    }
    return end - start;
  }

  // Rule 3. `keycap_base [FE0F] 20E3`; nothing joins onto a keycap.
  if (last === COMBINING_ENCLOSING_KEYCAP) {
    if (start > 0 && consume() === VARIATION_SELECTOR_16 && start > 0) {
      consume();
    }
    return end - start;
  }

  // Rule 5. Count the run of indicators ending here (including `last`); an even
  // run means `last` closes a pair. Flags never join, so this is terminal.
  if (isRegionalIndicator(last)) {
    let run = 1;
    for (let at = start; at > 0 && isRegionalIndicator(prevCodePoint(s, at)); at -= prevWidth(s, at)) {
      run += 1;
    }
    if (run % 2 === 0) {
      consume();
    }
    return end - start;
  }

  // Rule 4, on the element that ended the string.
  const takeBase = (element: number): void => {
    if (isModifier(element) && start > 0) {
      const base = consume();
      if (base === VARIATION_SELECTOR_16 && start > 0) {
        consume();
      }
    }
  };
  takeBase(last);

  // Rule 6. Each joiner pulls in the element before it, and that element gets
  // rule 4 again, because tone sits on each person in a multi-person sequence.
  while (start > 0 && s.charCodeAt(start - 1) === ZERO_WIDTH_JOINER) {
    start -= 1;
    if (start === 0) {
      break;
    }
    takeBase(consume());
  }

  // Rule 7 is what remains when nothing above claimed more than `last`.
  return end - start;
}

/** The draft with its last user-perceived character removed. */
export function deleteLastGrapheme(s: string): string {
  return s.slice(0, s.length - lastGraphemeLength(s));
}
