/**
 * The phone field's formatting logic, tested as functions.
 *
 * There is no renderer in this repo's devDependencies — no RNTL, no
 * react-test-renderer — so a component test is not available. That is precisely
 * why `formatPhoneEdit` takes the previous display string instead of reading the
 * caret off a native event: the whole as-you-type behaviour, including the caret,
 * is a pure function of two strings and can be driven from here.
 *
 * Every case below is a real sequence a thumb or a clipboard produces, written
 * as behaviour rather than as an assertion about the source text.
 */
import {
  IN_MOBILE_DIGITS,
  IN_MOBILE_DISPLAY_LENGTH,
  INDIA,
  PHONE_COUNTRIES,
  countryForDialCode,
  formatNationalDigits,
  formatPhoneEdit,
  isCompleteNationalNumber,
  nationalDisplayLength,
  normalisePhone,
  retargetPhone,
  toNationalDigits,
  type CountryIso,
  type PhoneCountry,
} from '../src/lib/phone';

/** Types `text` one character at a time into an empty field, as the IME does. */
function typeAll(
  text: string,
  country: PhoneCountry = INDIA,
): { display: string; digits: string; caret: number } {
  let display = '';
  let digits = '';
  let caret = 0;
  for (const ch of text) {
    const edit = formatPhoneEdit(
      display.slice(0, caret) + ch + display.slice(caret),
      display,
      country,
    );
    display = edit.display;
    digits = edit.digits;
    caret = edit.caret;
  }
  return { display, digits, caret };
}

/** By ISO, so a test can name a country without repeating the lookup. */
const BY_ISO = Object.fromEntries(
  PHONE_COUNTRIES.map(c => [c.iso, c]),
) as Record<CountryIso, PhoneCountry>;
const { US, GB, AE, SG, AU } = BY_ISO;
const IN = BY_ISO.IN;

describe('formatNationalDigits — 5-5, per libphonenumber IN metadata', () => {
  it('groups a complete number as five and five', () => {
    expect(formatNationalDigits('9876543210')).toBe('98765  43210');
  });

  it('is NOT the US 3-3-4', () => {
    expect(formatNationalDigits('9876543210')).not.toBe('987 654 3210');
  });

  it('formats partial input without a trailing separator', () => {
    expect(formatNationalDigits('')).toBe('');
    expect(formatNationalDigits('9')).toBe('9');
    expect(formatNationalDigits('98765')).toBe('98765');
    // The separator appears with the sixth digit, not after the fifth: a
    // trailing space would put the caret past a character nobody typed.
    expect(formatNationalDigits('987654')).toBe('98765  4');
  });

  it('uses two ASCII spaces, both of which normalisePhone discards', () => {
    // Widened from one space 2026-09-12 (Amit, on the S22: "no visible
    // separators") — one space at 16dp Bold read as continuous digits, not a
    // group break. Still ASCII, still discarded identically by the strip.
    const display = formatNationalDigits('9876543210');
    expect(display).toContain('  ');
    expect(display.replace(/[^\d]/g, '')).toBe('9876543210');
  });

  it('declares a display length that matches what it produces', () => {
    expect(formatNationalDigits('9876543210')).toHaveLength(IN_MOBILE_DISPLAY_LENGTH);
    expect(IN_MOBILE_DIGITS).toBe(10);
  });
});

describe('toNationalDigits — ten digits out, whatever goes in', () => {
  it('caps at ten digits', () => {
    expect(toNationalDigits('98765432109999')).toHaveLength(IN_MOBILE_DIGITS);
    expect(toNationalDigits('9876543210')).toBe('9876543210');
  });

  it('strips a +91 country code only when the length makes it unambiguous', () => {
    expect(toNationalDigits('+919876543210')).toBe('9876543210');
    expect(toNationalDigits('+91 98765 43210')).toBe('9876543210');
    expect(toNationalDigits('0091 9876543210')).toBe('9876543210');
    // Ten digits beginning 91 is itself a valid mobile number. Stripping here
    // would corrupt it, so it is left alone.
    expect(toNationalDigits('9198765432')).toBe('9198765432');
  });

  it("strips India's national prefix 0 only at eleven digits", () => {
    expect(toNationalDigits('09876543210')).toBe('9876543210');
    // Ten digits cannot start with 0 in a mobile number, but the rule must not
    // fire at ten regardless — it is length-gated, not content-gated.
    expect(toNationalDigits('0987654321')).toBe('0987654321');
  });

  it('ignores every separator a human or a clipboard produces', () => {
    for (const messy of [
      '98765 43210',
      '98765-43210',
      '(98765) 43210',
      ' 9876543210 ',
      '98765 43210',
    ]) {
      expect(toNationalDigits(messy)).toBe('9876543210');
    }
  });

  it('returns nothing for input with no digits', () => {
    expect(toNationalDigits('not a phone')).toBe('');
    expect(toNationalDigits('')).toBe('');
  });
});

describe('formatPhoneEdit — typing forward', () => {
  it('formats as you type and leaves the caret at the end', () => {
    const typed = typeAll('9876543210');
    expect(typed.display).toBe('98765  43210');
    expect(typed.digits).toBe('9876543210');
    expect(typed.caret).toBe(IN_MOBILE_DISPLAY_LENGTH);
  });

  it('inserts the separator on the sixth digit, caret after the digit', () => {
    const five = typeAll('98765');
    expect(five.display).toBe('98765');
    expect(five.caret).toBe(5);

    const six = formatPhoneEdit('987654', '98765');
    expect(six.display).toBe('98765  4');
    // After the '4', i.e. at the end — not stranded before the space.
    expect(six.caret).toBe(8);
  });

  it('hard-caps at ten digits and does not grow the display', () => {
    const eleventh = formatPhoneEdit('98765 432107', '98765 43210');
    expect(eleventh.digits).toHaveLength(IN_MOBILE_DIGITS);
    expect(eleventh.digits).toBe('9876543210');
    expect(eleventh.display).toBe('98765  43210');
    expect(eleventh.caret).toBe(IN_MOBILE_DISPLAY_LENGTH);
  });

  it('counts digits toward the cap, never separators', () => {
    // Twelve characters of display (ten digits + one two-space separator) is
    // a complete number, not an over-long one.
    const full = formatPhoneEdit('9876543210', '');
    expect(full.display).toHaveLength(12);
    expect(isCompleteNationalNumber(full.digits)).toBe(true);
  });
});

describe('formatPhoneEdit — paste', () => {
  it('accepts a +91-prefixed paste into an empty field', () => {
    const edit = formatPhoneEdit('+91 98765 43210', '');
    expect(edit.digits).toBe('9876543210');
    expect(edit.display).toBe('98765  43210');
    expect(edit.caret).toBe(IN_MOBILE_DISPLAY_LENGTH);
  });

  it('accepts a space-laden paste', () => {
    const edit = formatPhoneEdit('  98765   43210  ', '');
    expect(edit.digits).toBe('9876543210');
    expect(edit.display).toBe('98765  43210');
  });

  it('accepts a paste that is too long, truncating to ten', () => {
    const edit = formatPhoneEdit('98765432101234', '');
    expect(edit.digits).toBe('9876543210');
    expect(edit.display).toBe('98765  43210');
    expect(edit.caret).toBe(IN_MOBILE_DISPLAY_LENGTH);
  });

  it('keeps the caret after a paste made into the middle of a number', () => {
    // "987" + paste "77" + "654321"  →  digits 98777654321, capped to ten.
    const edit = formatPhoneEdit('9877765 4321', '98765 4321');
    expect(edit.digits).toBe('9877765432');
    expect(edit.display).toBe('98777  65432');
    // Immediately after the pasted pair — the fifth digit — and so before the
    // separator that the reflow has just pushed to index 5.
    expect(edit.caret).toBe(5);
  });
});

describe('formatPhoneEdit — deletion', () => {
  it('deletes a digit at the end and reflows', () => {
    const edit = formatPhoneEdit('98765 4321', '98765 43210');
    expect(edit.digits).toBe('987654321');
    expect(edit.display).toBe('98765  4321');
    expect(edit.caret).toBe(11);
  });

  it('deletes through a separator rather than re-inserting it', () => {
    // Backspace with the caret just after the space in "98765 43210" removes
    // the space. The separator is formatting, not content, so the digit in
    // front of it goes instead — matching PhoneNumberFormattingTextWatcher.
    const edit = formatPhoneEdit('9876543210', '98765 43210');
    expect(edit.digits).toBe('987643210');
    expect(edit.display).toBe('98764  3210');
    expect(edit.caret).toBe(4);
  });

  it('does not eat a digit when a digit was the thing deleted', () => {
    const edit = formatPhoneEdit('9875 43210', '98765 43210');
    expect(edit.digits).toBe('987543210');
  });

  it('empties cleanly', () => {
    const edit = formatPhoneEdit('', '98765 43210');
    expect(edit.digits).toBe('');
    expect(edit.display).toBe('');
    expect(edit.caret).toBe(0);
    expect(isCompleteNationalNumber(edit.digits)).toBe(false);
  });
});

describe('formatPhoneEdit — mid-string editing keeps the caret on its digit', () => {
  it('holds the caret after an inserted digit, not after a shifted separator', () => {
    // Insert '9' after the first digit of "98765 4321".
    const edit = formatPhoneEdit('998765 4321', '98765 4321');
    expect(edit.digits).toBe('9987654321');
    expect(edit.display).toBe('99876  54321');
    expect(edit.caret).toBe(2);
  });

  it('never returns a caret outside the display it returns', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['9', ''],
      ['98765', '9876'],
      ['987654', '98765'],
      ['98765 43210', '98765 4321'],
      ['9876543210', '98765 43210'],
      ['', '9'],
      ['+919876543210', ''],
      ['98765432109999', ''],
    ];
    for (const [next, previous] of cases) {
      const edit = formatPhoneEdit(next, previous);
      expect(edit.caret).toBeGreaterThanOrEqual(0);
      expect(edit.caret).toBeLessThanOrEqual(edit.display.length);
    }
  });
});

describe('what reaches auth is bare digits', () => {
  it('hands normalisePhone a digit string that needs no stripping', () => {
    const edit = formatPhoneEdit('+91 98765 43210', '');
    // `digits` is what the component keeps in state and what it passes to
    // send(); the separators live only on `display`.
    expect(edit.digits).toMatch(/^\d{10}$/);
    expect(normalisePhone(edit.digits)).toBe('919876543210');
  });

  it('produces the same E.164 whether the formatted or the bare value is used', () => {
    const edit = formatPhoneEdit('9876543210', '');
    expect(normalisePhone(edit.digits)).toBe(normalisePhone(edit.display));
    expect(normalisePhone(edit.digits)).toBe('919876543210');
  });

  it('is complete exactly when normalisePhone will accept it', () => {
    let display = '';
    let digits = '';
    let caret = 0;
    for (const ch of '9876543210') {
      const edit = formatPhoneEdit(display.slice(0, caret) + ch + display.slice(caret), display);
      ({ display, digits, caret } = edit);
      // The send button's enabled state and the ten-digit cap must agree at
      // every intermediate length, or the button lights up on nine digits.
      expect(isCompleteNationalNumber(digits)).toBe(normalisePhone(digits) !== null);
    }
    expect(isCompleteNationalNumber(digits)).toBe(true);
  });
});

/*
 * =====================================================================
 * The six countries the picker offers.
 *
 * Everything asserted below was read out of libphonenumber's own
 * `resources/PhoneNumberMetadata.xml` on 2026-09-07, not from memory. The
 * `<mobile><possibleLengths national=…>` gives the cap; the grouping comes from
 * the `<numberFormat>` whose `leadingDigits` actually select that territory's
 * MOBILE prefixes, which is not always the first rule that looks plausible.
 * =====================================================================
 */

/** One complete national mobile number per territory, for the round trips below. */
const SAMPLE: Record<CountryIso, string> = {
  IN: '9876543210',
  US: '4155550123',
  GB: '7911123456',
  AE: '501234567',
  SG: '81234567',
  AU: '412345678',
};

describe('the country table matches the metadata it cites', () => {
  /*
   * Restating the numbers here is the point: this is the gate that fails if
   * somebody edits a grouping in `phone.ts` without going back to the XML.
   *
   *   IN  <mobile national="10">  (\d{5})(\d{5})        leadingDigits 16|[6-9]
   *   US  <mobile national="10">  (\d{3})(\d{3})(\d{4}) leadingDigits [2-9]
   *   GB  <mobile national="10">  (\d{4})(\d{6})        leadingDigits 7
   *   AE  <mobile national="9">   (\d{2})(\d{3})(\d{4}) leadingDigits 5
   *   SG  <mobile national="8">   (\d{4})(\d{4})        leadingDigits [369]|8(?:0[1-9]|[1-9])
   *   AU  <mobile national="9">   (\d{3})(\d{3})(\d{3}) leadingDigits 14|4
   */
  const EXPECTED: Record<CountryIso, { length: number; groups: readonly number[] }> = {
    IN: { length: 10, groups: [5, 5] },
    US: { length: 10, groups: [3, 3, 4] },
    GB: { length: 10, groups: [4, 6] },
    AE: { length: 9, groups: [2, 3, 4] },
    SG: { length: 8, groups: [4, 4] },
    AU: { length: 9, groups: [3, 3, 3] },
  };

  it('offers exactly the six territories, India first', () => {
    expect(PHONE_COUNTRIES.map(c => c.iso)).toEqual(['IN', 'US', 'GB', 'AE', 'SG', 'AU']);
    expect(PHONE_COUNTRIES[0]).toBe(INDIA);
  });

  it('carries the declared national mobile length and grouping for each', () => {
    for (const country of PHONE_COUNTRIES) {
      const want = EXPECTED[country.iso];
      expect(country.nationalLength).toBe(want.length);
      expect(country.groups).toEqual(want.groups);
    }
  });

  it('never lets a grouping disagree with its own length', () => {
    // A [5,5] on a nine-digit cap would silently drop the last digit from the
    // display while still counting it toward "complete".
    for (const country of PHONE_COUNTRIES) {
      const sum = country.groups.reduce((a, b) => a + b, 0);
      expect(sum).toBe(country.nationalLength);
    }
  });

  it('does not let the US 3-3-4 leak into the countries where it is a trap', () => {
    /*
     * `(\d{3})(\d{3})(\d{4})` exists in the IN, GB and SG metadata too, and in
     * every one of the three it is behind non-mobile leading digits — 140 and
     * the landline area codes for IN, `[1389]` for GB, and for SG a rule that
     * needs ten digits when a Singapore mobile has eight. Picking it on shape
     * alone is the specific mistake this asserts against.
     */
    for (const country of [IN, GB, SG]) {
      expect(country.groups).not.toEqual([3, 3, 4]);
    }
    expect(US.groups).toEqual([3, 3, 4]);
  });

  it('states a national and international prefix only where the metadata gives a literal one', () => {
    // SG's territory element declares no nationalPrefix at all, and its
    // internationalPrefix is the pattern `0[0-3]\d` rather than a literal, so
    // neither can be string-stripped.
    expect(SG.nationalPrefix).toBeNull();
    expect(SG.internationalPrefix).toBeNull();
    expect(IN.nationalPrefix).toBe('0');
    expect(IN.internationalPrefix).toBe('00');
    expect(GB.nationalPrefix).toBe('0');
    expect(AE.nationalPrefix).toBe('0');
    // AU's internationalPrefix attribute is an alternation; the literal comes
    // from preferredInternationalPrefix="0011".
    expect(AU.internationalPrefix).toBe('0011');
    // US nationalPrefix and countryCode coincide, and both are "1".
    expect(US.nationalPrefix).toBe('1');
    expect(US.dialCode).toBe('+1');
  });

  it('resolves a dial code, and falls back to India as the picker does', () => {
    expect(countryForDialCode('+65')).toBe(SG);
    expect(countryForDialCode('+91')).toBe(INDIA);
    // CountryPicker's own fallback is `?? COUNTRIES[0]`, which is India. The
    // two must agree or the pill would show one country while the field counted
    // digits for another.
    expect(countryForDialCode('+999')).toBe(INDIA);
    expect(countryForDialCode('')).toBe(INDIA);
  });
});

describe('grouping per country', () => {
  it('groups a complete number the way the metadata says', () => {
    expect(formatNationalDigits(SAMPLE.IN, IN)).toBe('98765  43210');
    expect(formatNationalDigits(SAMPLE.US, US)).toBe('415  555  0123');
    expect(formatNationalDigits(SAMPLE.GB, GB)).toBe('7911  123456');
    expect(formatNationalDigits(SAMPLE.AE, AE)).toBe('50  123  4567');
    expect(formatNationalDigits(SAMPLE.SG, SG)).toBe('8123  4567');
    expect(formatNationalDigits(SAMPLE.AU, AU)).toBe('412  345  678');
  });

  it('defaults to India when no country is passed, so PhoneVerifySheet is untouched', () => {
    expect(formatNationalDigits(SAMPLE.IN)).toBe(formatNationalDigits(SAMPLE.IN, IN));
    expect(toNationalDigits('+919876543210')).toBe(toNationalDigits('+919876543210', IN));
    expect(isCompleteNationalNumber(SAMPLE.IN)).toBe(true);
    expect(nationalDisplayLength()).toBe(IN_MOBILE_DISPLAY_LENGTH);
  });

  it('emits no trailing separator at a group boundary, in any country', () => {
    // The separator arrives with the first digit of the next group, never after
    // the last digit of the previous one: a trailing space puts the caret past a
    // character nobody typed.
    for (const country of PHONE_COUNTRIES) {
      const digits = SAMPLE[country.iso];
      let at = 0;
      for (const size of country.groups) {
        at += size;
        if (at >= digits.length) {
          break;
        }
        expect(formatNationalDigits(digits.slice(0, at), country)).not.toMatch(/ $/);
        expect(formatNationalDigits(digits.slice(0, at + 1), country)).toMatch(/ \d$/);
      }
    }
  });

  it('adds only characters normalisePhone discards', () => {
    for (const country of PHONE_COUNTRIES) {
      const digits = SAMPLE[country.iso];
      const display = formatNationalDigits(digits, country);
      expect(display.replace(/[^\d]/g, '')).toBe(digits);
      expect(display).toHaveLength(nationalDisplayLength(country));
    }
  });

  it('declares a display length the field can put on maxLength', () => {
    expect(nationalDisplayLength(IN)).toBe(12);
    expect(nationalDisplayLength(US)).toBe(14);
    expect(nationalDisplayLength(GB)).toBe(12);
    expect(nationalDisplayLength(AE)).toBe(13);
    expect(nationalDisplayLength(SG)).toBe(10);
    expect(nationalDisplayLength(AU)).toBe(13);
    // The one PhoneVerifySheet and __tests__/textFields.test.ts both read.
    expect(IN_MOBILE_DISPLAY_LENGTH).toBe(12);
    expect(IN_MOBILE_DIGITS).toBe(10);
  });
});

describe('the cap is the selected country’s, not ten', () => {
  it('stops at the declared length while typing', () => {
    for (const country of PHONE_COUNTRIES) {
      const digits = SAMPLE[country.iso];
      // One digit too many, typed one keystroke at a time.
      const typed = typeAll(`${digits}7`, country);
      expect(typed.digits).toBe(digits);
      expect(typed.digits).toHaveLength(country.nationalLength);
      expect(typed.display).toBe(formatNationalDigits(digits, country));
      expect(typed.caret).toBe(nationalDisplayLength(country));
      expect(isCompleteNationalNumber(typed.digits, country)).toBe(true);
    }
  });

  it('is not complete one digit short, in any country', () => {
    for (const country of PHONE_COUNTRIES) {
      const short = SAMPLE[country.iso].slice(0, -1);
      expect(isCompleteNationalNumber(short, country)).toBe(false);
    }
  });

  it('does not accept India’s ten digits for Singapore', () => {
    // The regression this guards is a fixed ten: it would leave Singapore's
    // submit dark on a complete number and Australia's dark on a complete one.
    expect(isCompleteNationalNumber(SAMPLE.IN, SG)).toBe(false);
    expect(isCompleteNationalNumber(SAMPLE.SG, SG)).toBe(true);
    expect(isCompleteNationalNumber(SAMPLE.AU, AU)).toBe(true);
    expect(isCompleteNationalNumber(SAMPLE.AU, IN)).toBe(false);
  });
});

describe('paste of a +-prefixed international string, per country', () => {
  it('strips the country code at the length where doing so is unambiguous', () => {
    const pastes: ReadonlyArray<readonly [PhoneCountry, string, string]> = [
      [IN, '+91 98765 43210', '9876543210'],
      [US, '+1 (415) 555-0123', '4155550123'],
      [GB, '+44 7911 123456', '7911123456'],
      [AE, '+971 50 123 4567', '501234567'],
      [SG, '+65 8123 4567', '81234567'],
      [AU, '+61 412 345 678', '412345678'],
    ];
    for (const [country, pasted, want] of pastes) {
      const edit = formatPhoneEdit(pasted, '', country);
      expect(edit.digits).toBe(want);
      expect(edit.display).toBe(formatNationalDigits(want, country));
      expect(edit.caret).toBe(nationalDisplayLength(country));
    }
  });

  it('strips the international prefix followed by the country code', () => {
    expect(toNationalDigits('0091 98765 43210', IN)).toBe('9876543210');
    expect(toNationalDigits('0044 7911 123456', GB)).toBe('7911123456');
    expect(toNationalDigits('00971 50 123 4567', AE)).toBe('501234567');
    expect(toNationalDigits('011 1 415 555 0123', US)).toBe('4155550123');
    // AU's literal is preferredInternationalPrefix 0011, not 00.
    expect(toNationalDigits('0011 61 412 345 678', AU)).toBe('412345678');
  });

  it('strips the national prefix only where the territory declares one', () => {
    expect(toNationalDigits('09876543210', IN)).toBe('9876543210');
    expect(toNationalDigits('07911 123456', GB)).toBe('7911123456');
    expect(toNationalDigits('0412 345 678', AU)).toBe('412345678');
    expect(toNationalDigits('050 123 4567', AE)).toBe('501234567');
    // Singapore declares none, so a leading 0 is data. It survives, and the
    // over-long string is truncated to eight rather than shifted by one.
    expect(toNationalDigits('081234567', SG)).toBe('08123456');
  });

  it('truncates an over-long paste to the country’s own cap', () => {
    for (const country of PHONE_COUNTRIES) {
      const edit = formatPhoneEdit('12345678901234567890', '', country);
      expect(edit.digits).toHaveLength(country.nationalLength);
      expect(edit.caret).toBeLessThanOrEqual(edit.display.length);
    }
  });
});

describe('backspace across a separator, in a country with more than one', () => {
  /*
   * India has one separator, so a two- and a three-group country are the cases
   * that were never exercised. Deleting a separator deletes the digit in front
   * of it and reflows, matching PhoneNumberFormattingTextWatcher.
   * https://developer.android.com/reference/android/telephony/PhoneNumberFormattingTextWatcher
   */
  it('eats the digit before the first separator (US, 3-3-4)', () => {
    const edit = formatPhoneEdit('415 5550123', '415 555 0123', US);
    expect(edit.digits).toBe('415550123');
    expect(edit.display).toBe('415  550  123');
    expect(edit.caret).toBe(7);
  });

  it('eats the digit before the first separator (AE, 2-3-4)', () => {
    const edit = formatPhoneEdit('50123 4567', '50 123 4567', AE);
    expect(edit.digits).toBe('51234567');
    expect(edit.display).toBe('51  234  567');
    expect(edit.caret).toBe(1);
  });

  it('eats the digit before the second separator (AU, 3-3-3)', () => {
    const edit = formatPhoneEdit('412 345678', '412 345 678', AU);
    expect(edit.digits).toBe('41234678');
    expect(edit.display).toBe('412  346  78');
    expect(edit.caret).toBe(7);
  });

  it('does not eat a digit when a digit was the thing deleted, in any country', () => {
    for (const country of PHONE_COUNTRIES) {
      const digits = SAMPLE[country.iso];
      const display = formatNationalDigits(digits, country);
      // Drop the final character, which is always a digit.
      const edit = formatPhoneEdit(display.slice(0, -1), display, country);
      expect(edit.digits).toBe(digits.slice(0, -1));
    }
  });

  it('empties cleanly in any country', () => {
    for (const country of PHONE_COUNTRIES) {
      const edit = formatPhoneEdit('', formatNationalDigits(SAMPLE[country.iso], country), country);
      expect(edit.digits).toBe('');
      expect(edit.display).toBe('');
      expect(edit.caret).toBe(0);
    }
  });
});

describe('switching country under a number already typed', () => {
  it('truncates to the new cap rather than keeping digits it cannot hold', () => {
    /*
     * The decision, stated on `retargetPhone`: over-long digits are cut, not
     * kept-and-flagged. Keeping them would break the invariant that state never
     * holds more digits than the cap — which is what stops an eleven-digit value
     * reaching normalisePhone and being turned into an E.164 string for a number
     * the field is calling invalid.
     */
    const edit = retargetPhone(SAMPLE.IN, SG);
    expect(edit.digits).toBe('98765432');
    expect(edit.digits).toHaveLength(SG.nationalLength);
    expect(edit.display).toBe('9876  5432');
    // Caret after the last surviving digit: the whole string was rewritten, so
    // no earlier offset still means what it meant.
    expect(edit.caret).toBe(edit.display.length);
    expect(isCompleteNationalNumber(edit.digits, SG)).toBe(true);
  });

  it('re-groups without losing anything when the new country is long enough', () => {
    const edit = retargetPhone(SAMPLE.IN, US);
    expect(edit.digits).toBe(SAMPLE.IN);
    expect(edit.display).toBe('987  654  3210');
    expect(edit.caret).toBe(14);
  });

  it('re-groups a partial number too', () => {
    // Four digits typed for India, then the member picks Australia.
    const edit = retargetPhone('4123', AU);
    expect(edit.digits).toBe('4123');
    expect(edit.display).toBe('412  3');
    expect(edit.caret).toBe(6);
  });

  it('leaves a number the new country can hold exactly alone', () => {
    for (const country of PHONE_COUNTRIES) {
      const digits = SAMPLE[country.iso];
      const edit = retargetPhone(digits, country);
      expect(edit.digits).toBe(digits);
      expect(edit.display).toBe(formatNationalDigits(digits, country));
    }
  });

  it('is lossy in one direction and says so', () => {
    // Down then back up does NOT restore the original. That is the cost of
    // truncating, and it is asserted so nobody "fixes" it by stashing the
    // dropped digits somewhere the cap cannot see them.
    const down = retargetPhone(SAMPLE.IN, SG);
    const backUp = retargetPhone(down.digits, IN);
    expect(backUp.digits).toBe('98765432');
    expect(backUp.digits).not.toBe(SAMPLE.IN);
    expect(isCompleteNationalNumber(backUp.digits, IN)).toBe(false);
  });

  it('never returns a caret outside the display it returns', () => {
    for (const from of PHONE_COUNTRIES) {
      for (const to of PHONE_COUNTRIES) {
        const edit = retargetPhone(SAMPLE[from.iso], to);
        expect(edit.caret).toBeGreaterThanOrEqual(0);
        expect(edit.caret).toBeLessThanOrEqual(edit.display.length);
        expect(edit.digits.length).toBeLessThanOrEqual(to.nationalLength);
        expect(edit.display.replace(/[^\d]/g, '')).toBe(edit.digits);
      }
    }
  });

  it('keeps typing correct after the switch', () => {
    // Switch to Australia with three digits down, then finish the number.
    let { digits, display, caret } = retargetPhone('412', AU);
    for (const ch of '345678') {
      const edit = formatPhoneEdit(display.slice(0, caret) + ch + display.slice(caret), display, AU);
      ({ digits, display, caret } = edit);
    }
    expect(digits).toBe(SAMPLE.AU);
    expect(display).toBe('412  345  678');
    expect(caret).toBe(13);
  });
});

describe('the caret stays on its digit in every country', () => {
  it('never lands outside the display, for any edit in any country', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['9', ''],
      ['4155', '415'],
      ['415 5', '415'],
      ['7911 12', '7911 1'],
      ['50 1', '50'],
      ['8123 4', '8123'],
      ['412 345 678', '412 345 67'],
      ['', '9'],
      ['+6581234567', ''],
      ['12345678901234567890', ''],
    ];
    for (const country of PHONE_COUNTRIES) {
      for (const [next, previous] of cases) {
        const edit = formatPhoneEdit(next, previous, country);
        expect(edit.caret).toBeGreaterThanOrEqual(0);
        expect(edit.caret).toBeLessThanOrEqual(edit.display.length);
      }
    }
  });

  it('holds the caret after an inserted digit, not after a shifted separator', () => {
    // Insert '9' at the head of a US number: both separators shift right by a
    // digit, the eleventh digit falls off the cap, and the caret must stay
    // immediately after the '9' that was typed rather than following a space.
    const edit = formatPhoneEdit('9415 555 0123', '415 555 0123', US);
    expect(edit.digits).toBe('9415555012');
    expect(edit.display).toBe('941  555  5012');
    expect(edit.caret).toBe(1);
  });

  it('holds the caret after a digit inserted before the last group (AU)', () => {
    // '412 345 678' with a '9' typed after the sixth digit. The second
    // separator moves and the last digit is pushed off the nine-digit cap.
    const edit = formatPhoneEdit('412 3459 678', '412 345 678', AU);
    expect(edit.digits).toBe('412345967');
    expect(edit.display).toBe('412  345  967');
    // Index 9 is immediately after the inserted '9', which the reflow has just
    // moved across the separator into the last group.
    expect(edit.caret).toBe(11);
  });
});

describe('bare digits are what reach the sign-in call', () => {
  it('turns dial code plus bare digits into E.164 for every country', () => {
    /*
     * The sign-in path is OnboardingScreen's `fullPhone` → `sendPhoneOtp` →
     * `normalisePhone`, and `fullPhone` is `` `${dialCode} ${phone}` ``. This is
     * that string, built the same way, for each country.
     */
    for (const country of PHONE_COUNTRIES) {
      const edit = formatPhoneEdit(formatNationalDigits(SAMPLE[country.iso], country), '', country);
      expect(edit.digits).toMatch(/^\d+$/);
      expect(edit.digits).toHaveLength(country.nationalLength);
      expect(normalisePhone(`${country.dialCode} ${edit.digits}`)).toBe(
        `${country.dialCode.slice(1)}${edit.digits}`,
      );
    }
  });

  it('does not guess India when the string already states a country code', () => {
    /*
     * The bug this pins had shipped: `+65` plus eight digits is exactly ten
     * digits, so the bare-ten-digits-are-Indian rule fired and prepended 91.
     * The OTP for every Singapore sign-in went to +91 6581234567.
     */
    expect(normalisePhone('+65 8123 4567')).toBe('6581234567');
    expect(normalisePhone('+65 8123 4567')).not.toBe('916581234567');
    // Australia came to eleven digits and survived by luck; assert it anyway.
    expect(normalisePhone('+61 412345678')).toBe('61412345678');
  });

  it('still guesses India for a bare ten-digit number, which is what the sheet sends', () => {
    expect(normalisePhone('9876543210')).toBe('919876543210');
    expect(normalisePhone('98765 43210')).toBe('919876543210');
    // And still refuses something too short to be a number at all.
    expect(normalisePhone('12345')).toBeNull();
    expect(normalisePhone('')).toBeNull();
  });

  it('never lights the submit on something normalisePhone would refuse', () => {
    /*
     * The direction that matters. `canSend` is `isCompleteNationalNumber`, and
     * `sendPhoneOtp` gates on `normalisePhone`, so complete MUST imply
     * acceptable or the button lights up and the request fails.
     *
     * The converse is deliberately not asserted: `normalisePhone` is a
     * plausibility check on an already-assembled E.164 string and will accept a
     * partial Indian number that happens to be as long as a complete
     * Singaporean one. Completeness is `isCompleteNationalNumber`'s job, and
     * that is the one the button reads.
     */
    for (const country of PHONE_COUNTRIES) {
      let display = '';
      let digits = '';
      let caret = 0;
      for (const ch of SAMPLE[country.iso]) {
        const edit = formatPhoneEdit(
          display.slice(0, caret) + ch + display.slice(caret),
          display,
          country,
        );
        ({ display, digits, caret } = edit);
        if (isCompleteNationalNumber(digits, country)) {
          expect(normalisePhone(`${country.dialCode} ${digits}`)).not.toBeNull();
        }
      }
      // Complete exactly at the end, never before it.
      expect(isCompleteNationalNumber(digits, country)).toBe(true);
      expect(
        isCompleteNationalNumber(digits.slice(0, -1), country),
      ).toBe(false);
    }
  });
});
