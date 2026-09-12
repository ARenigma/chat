/**
 * Phone number normalisation and as-you-type formatting, kept pure and free of
 * imports.
 *
 * It started in `src/api/auth.ts` and moved here the moment a test tried to
 * import it: `api/` modules pull in `react-native` and `@supabase/supabase-js`,
 * so importing one drags a native runtime into a test that only wanted to check
 * string handling. `lib/` is the half of the codebase that can be reasoned about
 * without a device, and this belongs in it.
 *
 * **Everything numbering-related in this file comes out of libphonenumber's own
 * metadata**, read on 2026-09-07 from
 * https://raw.githubusercontent.com/google/libphonenumber/master/resources/PhoneNumberMetadata.xml
 * — not from memory, and not from "what a number from there looks like". The
 * per-territory citations are on `PHONE_COUNTRIES` below, one block each, with
 * the exact `<mobile>` and `<numberFormat>` lines they were derived from so a
 * reader can check the claim against the file.
 */

/** Default country when the user types a bare local number. India. */
const DEFAULT_COUNTRY = '91';

/** The territories `CountryPicker` offers. Its `Record` keys are checked against this. */
export type CountryIso = 'IN' | 'US' | 'GB' | 'AE' | 'SG' | 'AU';

/**
 * One territory's numbering rules, as far as a mobile-number field needs them.
 *
 * Deliberately not a general phone library. There is no `nationalNumberPattern`
 * here and there should not be: validating which *prefixes* are handsets needs
 * the multi-kilobyte regexes libphonenumber ships, and RULE 5 rules out taking
 * the dependency for a field whose job is to group digits and stop at the right
 * count. What this carries is the two facts that job needs — how many digits,
 * and where the spaces go — plus the prefixes a paste has to survive.
 */
export interface PhoneCountry {
  /** libphonenumber's `<territory id=…>`. */
  readonly iso: CountryIso;
  /** With the `+`, because that is what `CountryPicker` stores and shows. */
  readonly dialCode: string;
  /**
   * `<mobile><possibleLengths national=…>`.
   *
   * All six territories declare exactly ONE national mobile length, checked
   * against the metadata rather than assumed — see the note under
   * `PHONE_COUNTRIES` about the two that were expected to declare more.
   */
  readonly nationalLength: number;
  /**
   * Digit-group sizes from the `<numberFormat>` whose `leadingDigits` actually
   * select this territory's mobile prefixes. Sums to `nationalLength`.
   */
  readonly groups: readonly number[];
  /** `<territory nationalPrefix=…>`, or null where the territory declares none. */
  readonly nationalPrefix: string | null;
  /**
   * A LITERAL international dialling prefix, or null.
   *
   * Null where the metadata gives a pattern rather than a literal and the
   * territory has no `preferredInternationalPrefix` to fall back on, because a
   * pattern cannot be string-compared and this file does not run regexes over
   * clipboard content.
   */
  readonly internationalPrefix: string | null;
}

/*
 * The six territories, in picker order, India first.
 *
 * **Read the length off `<mobile>`, and the grouping off the `<numberFormat>`
 * whose `leadingDigits` match the MOBILE prefixes — never off the first
 * plausible-looking rule.** Four of these six territories carry a
 * `(\d{3})(\d{3})(\d{4})` rule, and in three of them it is behind non-mobile
 * leading digits. Reaching for 3-3-4 because it is the shape a phone number
 * "usually" has would be wrong for India, wrong for Singapore and wrong for the
 * United Kingdom, in each case while looking right.
 *
 * **Two territories were expected to declare several mobile lengths and do
 * not.** `AU` is `<possibleLengths national="9"/>` and `GB` is
 * `national="10"`, both single-valued in the metadata as read. So no country
 * here needs a cap that is the maximum of a set — the cap is simply the
 * declared length. What DOES vary in `GB` is the grouping, and it varies by
 * PREFIX rather than by length; that is recorded on the `GB` entry.
 *
 * `US` is the one territory declaring a second length, `localOnly="7"`, and it
 * is deliberately ignored: a local-only number cannot be dialled from outside
 * its own area, so it cannot be turned into the E.164 string `sendPhoneOtp`
 * needs. Ten is the only length this field can accept.
 */
export const PHONE_COUNTRIES: readonly PhoneCountry[] = [
  /*
   * India — ten digits, five and five.
   *
   * <territory id="IN" countryCode="91" internationalPrefix="00" nationalPrefix="0">
   *   <mobile><possibleLengths national="10"/>
   *   <numberFormat pattern="(\d{5})(\d{5})">
   *     <leadingDigits>16|[6-9]</leadingDigits>
   *     <format>$1 $2</format>
   *
   * `leadingDigits` `16|[6-9]` is exactly the mobile set: `<mobile>`'s
   * `nationalNumberPattern` admits leading 6, 7, 8 and 9, plus a `160[01]`
   * branch — so `AsYouType('IN')` on a mobile number emits `98765 43210`.
   *
   * The US-style 3-3-4 does appear in the IN metadata, as
   * `(\d{3})(\d{3})(\d{4})` behind `leadingDigits` 140 (UAN) and the
   * three-digit landline area codes. Applying it to a mobile number would be a
   * different country's convention wearing ours.
   */
  {
    iso: 'IN',
    dialCode: '+91',
    nationalLength: 10,
    groups: [5, 5],
    nationalPrefix: '0',
    internationalPrefix: '00',
  },
  /*
   * United States — ten digits, three-three-four.
   *
   * <territory id="US" countryCode="1" internationalPrefix="011" nationalPrefix="1">
   *   <mobile><possibleLengths national="10" localOnly="7"/>
   *   <numberFormat pattern="(\d{3})(\d{3})(\d{4})">
   *     <leadingDigits>[2-9]</leadingDigits>
   *     <format>($1) $2-$3</format>
   *
   * This is the one territory of the six whose `<format>` is not a plain space
   * join. **We render `415 555 0123`, not `(415) 555-0123`, and that is a
   * stated departure (RULE 1 §6), not an oversight.** Three reasons, in order
   * of weight: a `)` cannot be emitted until the group after it has a digit, so
   * an as-you-type parenthesis is either unclosed on screen at three digits or
   * it is a trailing separator sitting in front of the caret — the exact
   * objection `formatNationalDigits` already makes to a trailing space; the
   * literal characters would make the displayed length depend on the template
   * rather than on `nationalLength + groups.length - 1`, which is the figure
   * `maxLength` is computed from; and the group sizes, which are what carry the
   * "this number is complete" cue Amit asked for, are identical either way. The
   * template is recorded here so the choice can be revisited with the metadata
   * in hand.
   *
   * `nationalPrefix="1"` and `countryCode="1"` coincide, so an eleven-digit
   * `1`-led paste strips to the same ten digits whichever rule is credited.
   */
  {
    iso: 'US',
    dialCode: '+1',
    nationalLength: 10,
    groups: [3, 3, 4],
    nationalPrefix: '1',
    internationalPrefix: '011',
  },
  /*
   * United Kingdom — ten digits, four then six.
   *
   * <territory id="GB" countryCode="44" internationalPrefix="00" nationalPrefix="0">
   *   <mobile><possibleLengths national="10"/>
   *   <numberFormat pattern="(\d{4})(\d{6})">
   *     <leadingDigits>7</leadingDigits>
   *     <format>$1 $2</format>
   *
   * So `07911 123456` is national `7911123456` and displays `7911 123456`.
   *
   * **Two traps here, both checked.** The 3-3-4 rule exists in GB too,
   * `(\d{3})(\d{3})(\d{4})` behind `leadingDigits` `[1389]` — geographic,
   * corporate and premium ranges, never a handset. And GB grouping genuinely
   * varies by prefix rather than by length: an earlier rule
   * `(\d{2})(\d{4})(\d{4})` with `leadingDigits` `[25]|7(?:0|6(?:[03-9]|2[356]))`
   * wins for the `70` and `76` ranges, which `<mobile>` does include, so
   * libphonenumber renders those 2-4-4. Those are personal-numbering and pager
   * ranges rather than handsets, and honouring them would mean carrying
   * `leadingDigits` regexes into the app for a case a member of this app will
   * not type. 4-6 is the rule for `71`–`79`, which is every real UK mobile.
   */
  {
    iso: 'GB',
    dialCode: '+44',
    nationalLength: 10,
    groups: [4, 6],
    nationalPrefix: '0',
    internationalPrefix: '00',
  },
  /*
   * United Arab Emirates — nine digits, two-three-four.
   *
   * <territory id="AE" countryCode="971" internationalPrefix="00" nationalPrefix="0">
   *   <mobile><nationalNumberPattern>5[02-68]\d{7}</nationalNumberPattern>
   *          <possibleLengths national="9"/>
   *   <numberFormat pattern="(\d{2})(\d{3})(\d{4})">
   *     <leadingDigits>5</leadingDigits>
   *     <format>$1 $2 $3</format>
   *
   * `<mobile>` is `5[02-68]…`, and `leadingDigits` `5` is the rule that selects
   * it, so `50 123 4567`. The earlier `(\d)(\d{3})(\d{4})` rule behind
   * `[236]|[479][2-8]` is the eight-digit landline shape and does not apply.
   */
  {
    iso: 'AE',
    dialCode: '+971',
    nationalLength: 9,
    groups: [2, 3, 4],
    nationalPrefix: '0',
    internationalPrefix: '00',
  },
  /*
   * Singapore — eight digits, four and four.
   *
   * <territory id="SG" countryCode="65" internationalPrefix="0[0-3]\d">
   *   <mobile><nationalNumberPattern>80[1-9]\d{5}|(?:8[1-9]|9[0-8])\d{6}</nationalNumberPattern>
   *          <possibleLengths national="8"/>
   *   <numberFormat pattern="(\d{4})(\d{4})">
   *     <leadingDigits>[369]|8(?:0[1-9]|[1-9])</leadingDigits>
   *     <format>$1 $2</format>
   *
   * `leadingDigits` `[369]|8(?:0[1-9]|[1-9])` is written to match exactly the
   * `<mobile>` pattern above (8 and 9, with `800` excluded), so `8123 4567`.
   *
   * **The clearest instance of the 3-3-4 trap.** SG also carries
   * `(\d{3})(\d{3})(\d{4})` behind `leadingDigits` `8` — the same leading digit
   * as a mobile — but it sits AFTER the 4-4 rule and its pattern needs ten
   * digits, and a Singapore mobile is eight. Matching on the prefix alone would
   * have picked it.
   *
   * `internationalPrefix` is null: the metadata gives `0[0-3]\d`, a pattern
   * rather than a literal, and there is no `preferredInternationalPrefix`.
   * `nationalPrefix` is null too — the territory element declares none, so a
   * leading `0` here is data, not a prefix to strip.
   */
  {
    iso: 'SG',
    dialCode: '+65',
    nationalLength: 8,
    groups: [4, 4],
    nationalPrefix: null,
    internationalPrefix: null,
  },
  /*
   * Australia — nine digits, three-three-three.
   *
   * <territory id="AU" countryCode="61" nationalPrefix="0"
   *            preferredInternationalPrefix="0011"
   *            internationalPrefix="001[14-689]|14(?:1[14]|34|4[17]|[56]6|7[47]|88)0011">
   *   <mobile><nationalNumberPattern>4(?:79[01]|83[0-36-9]|95[0-3])\d{5}|4(?:[0-36]\d|…)\d{6}</nationalNumberPattern>
   *          <possibleLengths national="9"/>
   *   <numberFormat pattern="(\d{3})(\d{3})(\d{3})">
   *     <leadingDigits>14|4</leadingDigits>
   *     <format>$1 $2 $3</format>
   *
   * `<mobile>` is entirely `4…`, and `leadingDigits` `14|4` is the rule that
   * takes it, so `412 345 678` — and `0412 345 678` with the national prefix,
   * which is how it is written locally and what the strip below handles.
   *
   * `internationalPrefix` uses the literal `preferredInternationalPrefix`
   * `0011`, because the `internationalPrefix` attribute is an alternation.
   */
  {
    iso: 'AU',
    dialCode: '+61',
    nationalLength: 9,
    groups: [3, 3, 3],
    nationalPrefix: '0',
    internationalPrefix: '0011',
  },
];

/** India. The default, and the fallback for an unrecognised dial code. */
export const INDIA: PhoneCountry = PHONE_COUNTRIES[0]!;

/**
 * The `PhoneCountry` for a `CountryPicker` value like `'+65'`.
 *
 * Falls back to India rather than throwing, and deliberately mirrors
 * `CountryPicker`'s own `?? COUNTRIES[0]` fallback: the two must agree about
 * what an unknown dial code means, or the pill would show one country while the
 * field counted digits for another.
 */
export function countryForDialCode(dialCode: string): PhoneCountry {
  return PHONE_COUNTRIES.find(c => c.dialCode === dialCode) ?? INDIA;
}

/** `'+91'` → `'91'`. The E.164 country code without its plus. */
function dialDigits(country: PhoneCountry): string {
  return country.dialCode.slice(1);
}

/**
 * An Indian mobile number is ten digits, written and read aloud as five-and-five.
 *
 * Kept as a named export because `PhoneVerifySheet` is India-only by design —
 * it has no country picker — and because `__tests__/textFields.test.ts` asserts
 * the sheet's `maxLength` against it. Both are now views onto the `IN` entry of
 * `PHONE_COUNTRIES` above, where the metadata citation lives.
 */
export const IN_MOBILE_DIGITS = INDIA.nationalLength;

/**
 * Two ASCII spaces, not one — widened 2026-09-12 (Amit, on the S22: "no
 * visible separators"). At 16dp Bold with the field's 0.15 letterSpacing, a
 * single space between two five-digit groups read as continuous digits, not
 * a break. Still ASCII, still a character `normalisePhone` already discards —
 * the `[^\d]` strip below removes any run of non-digit characters identically
 * regardless of length, and so does every caret-math helper in this file
 * (`isDigitAt`/`offsetAfterDigit`/`digitsBefore`), which only ever counts
 * DIGITS and treats everything else as one opaque gap. Widening it is
 * therefore a rendering-only change: no digit-extraction or caret logic
 * needed to move, only `nationalDisplayLength` below, which sizes the gap
 * into its arithmetic rather than assuming 1.
 *
 * One separator width for all six countries. Five of the six declare a plain
 * `$1 $2`-style space join; only `US` differs, and the note on that entry
 * explains why its `($1) $2-$3` template is recorded but not rendered.
 */
const GROUP_SEPARATOR = '  ';

/**
 * Longest string the field can display for `country`: its digits plus its
 * separators.
 *
 * This is the number that goes on `maxLength`, and it is doing real work rather
 * than belt-and-braces. React Native's `TextInput` docs say a controlled `value`
 * "may cause flickering - one common cause is preventing edits by keeping value
 * the same", and name the remedy outright: "set/update `maxLength` to prevent
 * unwanted edits without flicker". Capping in JS alone is exactly the
 * keep-the-value-the-same case they are describing, because the digit past the
 * cap would reach JS, be dropped, and the unchanged value would be pushed back
 * at the native view. With `maxLength` the native view refuses the keystroke
 * first.
 * https://reactnative.dev/docs/textinput#maxlength
 * https://reactnative.dev/docs/textinput#value
 *
 * "set/UPDATE" is the operative word once there is a country picker: the cap
 * moves when the selection moves, from 12 for the United States down to 9 for
 * Singapore, and the prop has to move with it.
 *
 * Each separator is `GROUP_SEPARATOR.length` wide, not 1 — the reservation has
 * to grow with the separator or a two-space gap gets truncated by the same
 * `maxLength` that exists to prevent truncation elsewhere.
 */
export function nationalDisplayLength(country: PhoneCountry = INDIA): number {
  return (
    country.nationalLength + (country.groups.length - 1) * GROUP_SEPARATOR.length
  );
}

/**
 * A dashed shape showing how many digits the country takes and where the gaps
 * fall — `----- -----` for India, `--- --- ----` for the US.
 *
 * For a field placeholder. Derived from `groups` and the real GROUP_SEPARATOR
 * rather than written out per country, so it is correct for every entry in
 * PHONE_COUNTRIES by construction and moves with the separator if that ever
 * widens again.
 *
 * A dash, not a digit example: an example number would read better but needs a
 * sourced, valid number for each of the six countries, and every other number in
 * this file is quoted from libphonenumber metadata. A shape needs no source.
 * (`PhoneVerifySheet` does use a real example, and can, because it is India-only
 * by design — see the note on IN_MOBILE_DIGITS.)
 */
export function placeholderShape(country: PhoneCountry = INDIA): string {
  return country.groups.map(n => '-'.repeat(n)).join(GROUP_SEPARATOR);
}

/** India's display length: 10 digits + one 2-wide separator = 12. */
export const IN_MOBILE_DISPLAY_LENGTH = nationalDisplayLength(INDIA);

/**
 * Digits of a national mobile number, from anything a human or the clipboard can
 * produce. Never longer than `country.nationalLength`.
 *
 * Three prefixes are stripped, and each only at a length where doing so is
 * unambiguous — which matters, because mobile numbers legitimately begin with
 * the same digits some of these prefixes do (an Indian mobile can start 9, and
 * India's country code is 91):
 *
 *   - the international prefix followed by the country code, at
 *     `nationalLength + both`. `0091 98765 43210` is how a number gets copied
 *     out of a contact card saved for international dialling. Skipped where the
 *     territory declares no literal international prefix (`SG`).
 *   - the bare country code, at `nationalLength + its length`.
 *     `919876543210` is a country code plus a subscriber number. Ten digits
 *     beginning `91` (`9198765432`) is left alone, because that is itself a
 *     valid Indian mobile number and guessing would corrupt it.
 *   - the national prefix, at `nationalLength + its length`. India's and the
 *     UK's and Australia's is `0`, and it is what people copy off a printed
 *     listing — `07911 123456`, `0412 345 678`. Skipped where the territory
 *     declares none (`SG`), so a leading `0` there is kept as data.
 *
 * Every rule is gated on an exact total length, never on the leading characters
 * alone. That is what keeps them safe, and gating on length also stops a rule
 * firing mid-typing — typing `0` shows `0` rather than silently vanishing.
 *
 * Anything still over the cap is truncated from the right, so a paste of junk
 * cannot smuggle an over-long value downstream. That same truncation is what
 * `retargetPhone` reuses when the country changes under a number already typed.
 */
export function toNationalDigits(
  input: string,
  country: PhoneCountry = INDIA,
): string {
  let digits = input.replace(/[^\d]/g, '');
  const cc = dialDigits(country);
  const n = country.nationalLength;
  const intl = country.internationalPrefix;
  const np = country.nationalPrefix;
  if (
    intl !== null &&
    digits.length === n + intl.length + cc.length &&
    digits.startsWith(`${intl}${cc}`)
  ) {
    digits = digits.slice(intl.length + cc.length);
  } else if (digits.length === n + cc.length && digits.startsWith(cc)) {
    digits = digits.slice(cc.length);
  } else if (
    np !== null &&
    digits.length === n + np.length &&
    digits.startsWith(np)
  ) {
    digits = digits.slice(np.length);
  }
  return digits.slice(0, n);
}

/**
 * Bare digits to the displayed `98765 43210` — or `415 555 0123`, or
 * `8123 4567`, whichever the country's grouping is.
 *
 * Partial input formats too — five Indian digits is `98765`, six is `98765 4` —
 * because this runs on every keystroke and a formatter that only handles the
 * complete number is a formatter that does nothing until the moment it is not
 * needed. No trailing separator is emitted: `98765 ` would put a caret past a
 * space the user never typed.
 */
export function formatNationalDigits(
  digits: string,
  country: PhoneCountry = INDIA,
): string {
  const out: string[] = [];
  let at = 0;
  for (const size of country.groups) {
    if (at >= digits.length) {
      break;
    }
    out.push(digits.slice(at, at + size));
    at += size;
  }
  return out.join(GROUP_SEPARATOR);
}

/**
 * `charCodeAt` rather than a regex per character: this runs in a loop on every
 * keystroke, and it sidesteps the `noUncheckedIndexedAccess` dance that indexing
 * a string by number otherwise needs.
 */
function isDigitAt(s: string, i: number): boolean {
  const c = s.charCodeAt(i);
  return c >= 0x30 && c <= 0x39;
}

/** Index in `display` that sits immediately after its `count`-th digit. */
function offsetAfterDigit(display: string, count: number): number {
  if (count <= 0) {
    return 0;
  }
  let seen = 0;
  for (let i = 0; i < display.length; i += 1) {
    if (isDigitAt(display, i)) {
      seen += 1;
      if (seen === count) {
        return i + 1;
      }
    }
  }
  return display.length;
}

/** How many digits of `display` sit strictly before index `offset`. */
function digitsBefore(display: string, offset: number): number {
  let n = 0;
  const end = Math.min(offset, display.length);
  for (let i = 0; i < end; i += 1) {
    if (isDigitAt(display, i)) {
      n += 1;
    }
  }
  return n;
}

/** What `formatPhoneEdit` returns: the two values state needs, plus the caret. */
export interface PhoneEdit {
  /** Bare national digits. This is what goes to state and downstream to auth. */
  readonly digits: string;
  /** The separator-formatted string. Display only — it goes on `value`, nowhere else. */
  readonly display: string;
  /** Where to put the caret, as an index into `display`. */
  readonly caret: number;
}

/**
 * One keystroke, paste or deletion, resolved into digits + display + caret.
 *
 * **Why the caret is computed here rather than left to the platform.** Inserting
 * a separator makes the display longer than what the user typed, so every index
 * after the insertion point shifts. React Native's `TextInput` is a controlled
 * component — "the native value will be forced to match this value prop"
 * (https://reactnative.dev/docs/textinput#value) — and when that forced value is
 * a different length from what the native view had, the caret has to be told
 * where to go or it lands in the wrong place. The prop for that is `selection`:
 * "The start and end of the text input's selection. Set start and end to the
 * same value to position the cursor."
 * https://reactnative.dev/docs/textinput#selection
 *
 * **Why it takes the previous display instead of the native caret.** The obvious
 * implementation reads the caret out of `onSelectionChange` and formats in
 * `onChangeText`, which makes correctness depend on the order two native events
 * arrive in. This derives the edit position from the two strings instead, by
 * common prefix and common suffix, so it is a pure function of its arguments and
 * the same for a keystroke, a mid-string edit and a paste. That is also what
 * makes it testable with no renderer, which this repo has no way to provide.
 *
 * **The caret is anchored to a digit, never to an offset.** Everything is
 * converted to "how many digits precede the caret", and only mapped back to a
 * string index once the new display exists. Separators moving around underneath
 * therefore cannot drag the caret with them — and since a country switch moves
 * every separator at once, that property is what makes the switch survivable.
 *
 * `previous` is the display string currently on screen. Pass `''` for a fresh
 * field. `country` decides the cap and the grouping, and must be the one the
 * picker is showing.
 */
export function formatPhoneEdit(
  next: string,
  previous: string,
  country: PhoneCountry = INDIA,
): PhoneEdit {
  // Where the edit happened: the span between the common prefix and the common
  // suffix is what changed, and the caret ends at the far end of the new span.
  const shorter = Math.min(next.length, previous.length);
  let head = 0;
  while (head < shorter && next[head] === previous[head]) {
    head += 1;
  }
  let tail = 0;
  while (
    tail < shorter - head &&
    next[next.length - 1 - tail] === previous[previous.length - 1 - tail]
  ) {
    tail += 1;
  }
  const caretInNext = next.length - tail;

  let digits = toNationalDigits(next, country);
  let before = Math.min(digitsBefore(next, caretInNext), digits.length);

  /*
   * Backspace over a separator has to eat the digit in front of it.
   *
   * Without this the separator is simply re-inserted and the keypress reads as
   * broken — the user pressed delete and nothing moved. The condition is
   * deliberately narrow: the digits came out identical AND the string got
   * shorter, which can only mean the removed character was a separator. A
   * deletion that took a digit changes the digit string and is left alone.
   *
   * This matches the platform's own behaviour. Android's
   * `PhoneNumberFormattingTextWatcher` treats separators as formatting rather
   * than content, so deleting one deletes through it.
   * https://developer.android.com/reference/android/telephony/PhoneNumberFormattingTextWatcher
   */
  if (
    next.length < previous.length &&
    digits === toNationalDigits(previous, country) &&
    before > 0
  ) {
    digits = digits.slice(0, before - 1) + digits.slice(before);
    before -= 1;
  }

  const display = formatNationalDigits(digits, country);
  return { digits, display, caret: offsetAfterDigit(display, before) };
}

/**
 * The same number, re-read as `to`'s. What the country picker hands back.
 *
 * **Over-long digits are truncated from the right, not kept and flagged.** The
 * alternative — hold all ten digits while Singapore is selected and mark the
 * field invalid — was rejected for three reasons:
 *
 *   1. It breaks the invariant that state can never hold more digits than the
 *      cap. That invariant is what lets `maxLength` and the JS cap agree, and it
 *      is what stops an over-long value reaching `normalisePhone`, which would
 *      happily turn eleven digits into an E.164 string for a number the field
 *      was calling invalid.
 *   2. Truncation is already this file's rule for the same situation. A paste of
 *      fourteen digits is cut to the cap by `toNationalDigits`; a country switch
 *      is the same over-long value arriving by a different door, and two rules
 *      for one situation is how they drift apart.
 *   3. It is visible rather than silent, which is the actual requirement. The
 *      display re-groups and shortens in the same frame the dial code changes,
 *      so the digits that no longer fit are seen to go. Clearing the field
 *      instead would throw away the leading digits too, and those are the ones
 *      the member typed first and the ones most likely still correct after a
 *      mis-tapped country.
 *
 * The caret lands after the last surviving digit: the whole string has just been
 * rewritten, so there is no earlier position that still means what it meant.
 */
export function retargetPhone(digits: string, to: PhoneCountry): PhoneEdit {
  const kept = toNationalDigits(digits, to);
  const display = formatNationalDigits(kept, to);
  return { digits: kept, display, caret: display.length };
}

/** True when the field holds a complete national number for `country`. */
export function isCompleteNationalNumber(
  digits: string,
  country: PhoneCountry = INDIA,
): boolean {
  return digits.length === country.nationalLength;
}

/** E.164 permits at most fifteen digits including the country code. */
const E164_MAX_DIGITS = 15;

/**
 * Shortest country-code-plus-subscriber string the picker can produce.
 *
 * Ten, from Singapore: `+65` and eight national digits. Derived rather than
 * written down, so adding a country with a shorter number cannot leave a floor
 * behind that rejects it.
 */
const E164_MIN_DIGITS = Math.min(
  ...PHONE_COUNTRIES.map(c => dialDigits(c).length + c.nationalLength),
);

/**
 * To E.164 without the leading `+`, digits only, country code included.
 *
 * Returns null rather than throwing, because the caller is a text field and an
 * incomplete number is the normal state of one, not an error.
 *
 * **A leading `+` means the country code is already in the string, and that
 * changes two things.** This function is reached two ways: from
 * `PhoneVerifySheet`, which passes bare Indian national digits, and from
 * `sendPhoneOtp`/`verifyPhoneOtp`, which are handed `"+65 8123 4567"` — the dial
 * code the picker is showing, then the national digits. For the second shape:
 *
 *   - the ten-digit India guess below must NOT fire. `+65` plus eight digits is
 *     exactly ten digits, so before this distinction existed a Singapore
 *     sign-in had `91` prepended to it and the OTP went to `+916581234567`, an
 *     Indian number. Australia (`+61`, nine) came to eleven and survived by
 *     luck; Singapore was the one length that collided.
 *   - the eleven-digit floor must not fire either. That floor exists to reject a
 *     bare national number that lost its country code, which cannot be the case
 *     when the country code is right there in the string. A valid `+65` number
 *     is ten digits total, and `E164_MIN_DIGITS` is derived from the picker's
 *     own shortest country rather than guessed.
 */
export function normalisePhone(
  input: string,
  defaultCountry = DEFAULT_COUNTRY,
): string | null {
  const digits = input.replace(/[^\d]/g, '');
  if (digits.length === 0) {
    return null;
  }
  const explicit = input.trimStart().startsWith('+');
  // A bare ten-digit number is Indian, and guessing is deliberate: the field
  // shows +91, so somebody typing ten digits has already said which country they
  // mean. Rejecting it would be pedantry about a prefix already on screen. It is
  // only a guess when nothing else said which country — hence `!explicit`.
  const withCountry =
    !explicit && digits.length === IN_MOBILE_DIGITS
      ? `${defaultCountry}${digits}`
      : digits;
  // Below eleven, with no country code stated, cannot be a country code plus a
  // subscriber number. With one stated, the floor is the shortest E.164 the
  // picker can build.
  const floor = explicit ? E164_MIN_DIGITS : 11;
  return withCountry.length >= floor && withCountry.length <= E164_MAX_DIGITS
    ? withCountry
    : null;
}
