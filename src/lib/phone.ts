/**
 * Phone number normalisation, kept pure and free of imports.
 *
 * It started in `src/api/auth.ts` and moved here the moment a test tried to
 * import it: `api/` modules pull in `react-native` and `@supabase/supabase-js`,
 * so importing one drags a native runtime into a test that only wanted to check
 * string handling. `lib/` is the half of the codebase that can be reasoned about
 * without a device, and this belongs in it.
 */

/** Default country when the user types a bare local number. India. */
const DEFAULT_COUNTRY = '91';

/**
 * An Indian mobile number is ten digits, and it is written and read aloud as
 * five-and-five.
 *
 * This is not a guess and it is not "what feels Indian". It is the grouping
 * libphonenumber itself applies. In `resources/PhoneNumberMetadata.xml`, the
 * `<territory id="IN" countryCode="91" nationalPrefix="0">` block carries one
 * `numberFormat` whose `leadingDigits` are `16|[6-9]`:
 *
 *     <numberFormat pattern="(\d{5})(\d{5})">
 *       <format>$1 $2</format>
 *
 * Indian mobile numbers are exactly the ones that rule selects — `<mobile>`
 * declares `<possibleLengths national="10"/>` and its `nationalNumberPattern`
 * admits only leading 6, 7, 8 or 9 — so `AsYouType('IN')` on a mobile number
 * emits `98765 43210`. Checked against the metadata file itself on 2026-09-07,
 * not from memory.
 * https://github.com/google/libphonenumber/blob/master/resources/PhoneNumberMetadata.xml
 *
 * The US-style 3-3-4 does appear in the IN metadata, but only as
 * `(\d{3})(\d{3})(\d{4})` behind `leadingDigits` 140 (UAN) and the three-digit
 * landline area codes. Applying it to a mobile number would be a different
 * country's convention wearing ours.
 */
export const IN_MOBILE_DIGITS = 10;

/** Where the separators go. Sums to `IN_MOBILE_DIGITS` by construction. */
const IN_MOBILE_GROUPS: readonly number[] = [5, 5];

/**
 * `$1 $2` in the metadata above — one ASCII space, not a hyphen or a NBSP.
 *
 * It has to be a character `normalisePhone` already discards, and it is: the
 * `[^\d]` strip below removes it. See the test that pins that.
 */
const GROUP_SEPARATOR = ' ';

/**
 * Longest string the field can ever display: ten digits plus one separator.
 *
 * This is the number that goes on `maxLength`, and it is doing real work rather
 * than belt-and-braces. React Native's `TextInput` docs say a controlled `value`
 * "may cause flickering - one common cause is preventing edits by keeping value
 * the same", and name the remedy outright: "set/update `maxLength` to prevent
 * unwanted edits without flicker". Capping in JS alone is exactly the
 * keep-the-value-the-same case they are describing, because the eleventh digit
 * would reach JS, be dropped, and the unchanged value would be pushed back at
 * the native view. With `maxLength` the native view refuses the keystroke first.
 * https://reactnative.dev/docs/textinput#maxlength
 * https://reactnative.dev/docs/textinput#value
 */
export const IN_MOBILE_DISPLAY_LENGTH =
  IN_MOBILE_DIGITS + IN_MOBILE_GROUPS.length - 1;

/**
 * Digits of a national Indian mobile number, from anything a human or the
 * clipboard can produce. Never longer than ten.
 *
 * Two prefixes are stripped, and both are stripped only at a length where doing
 * so is unambiguous — which matters, because Indian mobile numbers legitimately
 * begin with 9 and with 6:
 *
 *   - `0091` when there are fourteen digits. `00` is India's international
 *     dialling prefix, declared as `internationalPrefix="00"` on the
 *     `<territory id="IN">` element, and `0091 98765 43210` is how a number gets
 *     copied out of a contact card saved for international dialling.
 *   - `91` when there are twelve digits. `919876543210` is a country code plus a
 *     subscriber number. Ten digits beginning `91` (`9198765432`) is left alone,
 *     because that is itself a valid mobile number and guessing would corrupt it.
 *   - `0` when there are eleven. That is India's national prefix, declared as
 *     `nationalPrefix="0"` on the same element, and it is what people copy off a
 *     printed landline-style listing.
 *
 * Every rule is gated on an exact total length, never on the leading characters
 * alone. That is what keeps them safe: an Indian mobile number starts with 6, 7,
 * 8 or 9 and is ten digits, so none of these prefixes can be subscriber data at
 * the length its rule fires on. Gating on length also stops a rule firing
 * mid-typing — typing `0` shows `0` rather than silently vanishing.
 *
 * Anything still over ten digits is truncated from the right, so a paste of
 * junk cannot smuggle an over-long value downstream.
 */
export function toNationalDigits(input: string): string {
  let digits = input.replace(/[^\d]/g, '');
  const international = `00${DEFAULT_COUNTRY}`;
  if (
    digits.length === IN_MOBILE_DIGITS + international.length &&
    digits.startsWith(international)
  ) {
    digits = digits.slice(international.length);
  } else if (
    digits.length === IN_MOBILE_DIGITS + DEFAULT_COUNTRY.length &&
    digits.startsWith(DEFAULT_COUNTRY)
  ) {
    digits = digits.slice(DEFAULT_COUNTRY.length);
  } else if (digits.length === IN_MOBILE_DIGITS + 1 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits.slice(0, IN_MOBILE_DIGITS);
}

/**
 * Bare digits to the displayed `98765 43210`.
 *
 * Partial input formats too — five digits is `98765`, six is `98765 4` — because
 * this runs on every keystroke and a formatter that only handles the complete
 * number is a formatter that does nothing until the moment it is not needed.
 * No trailing separator is emitted: `98765 ` would put a caret past a space the
 * user never typed.
 */
export function formatNationalDigits(digits: string): string {
  const out: string[] = [];
  let at = 0;
  for (const size of IN_MOBILE_GROUPS) {
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
 * therefore cannot drag the caret with them.
 *
 * `previous` is the display string currently on screen. Pass `''` for a fresh
 * field.
 */
export function formatPhoneEdit(next: string, previous: string): PhoneEdit {
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

  let digits = toNationalDigits(next);
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
    digits === toNationalDigits(previous) &&
    before > 0
  ) {
    digits = digits.slice(0, before - 1) + digits.slice(before);
    before -= 1;
  }

  const display = formatNationalDigits(digits);
  return { digits, display, caret: offsetAfterDigit(display, before) };
}

/** True when the field holds a complete ten-digit national number. */
export function isCompleteNationalNumber(digits: string): boolean {
  return digits.length === IN_MOBILE_DIGITS;
}

/**
 * To E.164 without the leading `+`, digits only, country code included.
 *
 * Returns null rather than throwing, because the caller is a text field and an
 * incomplete number is the normal state of one, not an error.
 */
export function normalisePhone(input: string, defaultCountry = DEFAULT_COUNTRY): string | null {
  const digits = input.replace(/[^\d]/g, '');
  if (digits.length === 0) {
    return null;
  }
  // A bare ten-digit number is Indian, and guessing is deliberate: the field
  // shows +91, so somebody typing ten digits has already said which country they
  // mean. Rejecting it would be pedantry about a prefix already on screen.
  const withCountry = digits.length === 10 ? `${defaultCountry}${digits}` : digits;
  // E.164 allows up to 15 digits including the country code; below 11 cannot be
  // a country code plus a subscriber number.
  return withCountry.length >= 11 && withCountry.length <= 15 ? withCountry : null;
}
