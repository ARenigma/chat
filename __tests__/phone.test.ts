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
  formatNationalDigits,
  formatPhoneEdit,
  isCompleteNationalNumber,
  normalisePhone,
  toNationalDigits,
} from '../src/lib/phone';

/** Types `text` one character at a time into an empty field, as the IME does. */
function typeAll(text: string): { display: string; digits: string; caret: number } {
  let display = '';
  let digits = '';
  let caret = 0;
  for (const ch of text) {
    const edit = formatPhoneEdit(display.slice(0, caret) + ch + display.slice(caret), display);
    display = edit.display;
    digits = edit.digits;
    caret = edit.caret;
  }
  return { display, digits, caret };
}

describe('formatNationalDigits — 5-5, per libphonenumber IN metadata', () => {
  it('groups a complete number as five and five', () => {
    expect(formatNationalDigits('9876543210')).toBe('98765 43210');
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
    expect(formatNationalDigits('987654')).toBe('98765 4');
  });

  it('uses exactly one ASCII space, which normalisePhone discards', () => {
    const display = formatNationalDigits('9876543210');
    expect(display).toContain(' ');
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
    expect(typed.display).toBe('98765 43210');
    expect(typed.digits).toBe('9876543210');
    expect(typed.caret).toBe(IN_MOBILE_DISPLAY_LENGTH);
  });

  it('inserts the separator on the sixth digit, caret after the digit', () => {
    const five = typeAll('98765');
    expect(five.display).toBe('98765');
    expect(five.caret).toBe(5);

    const six = formatPhoneEdit('987654', '98765');
    expect(six.display).toBe('98765 4');
    // After the '4', i.e. at the end — not stranded before the space.
    expect(six.caret).toBe(7);
  });

  it('hard-caps at ten digits and does not grow the display', () => {
    const eleventh = formatPhoneEdit('98765 432107', '98765 43210');
    expect(eleventh.digits).toHaveLength(IN_MOBILE_DIGITS);
    expect(eleventh.digits).toBe('9876543210');
    expect(eleventh.display).toBe('98765 43210');
    expect(eleventh.caret).toBe(IN_MOBILE_DISPLAY_LENGTH);
  });

  it('counts digits toward the cap, never separators', () => {
    // Eleven characters of display is a complete number, not an over-long one.
    const full = formatPhoneEdit('9876543210', '');
    expect(full.display).toHaveLength(11);
    expect(isCompleteNationalNumber(full.digits)).toBe(true);
  });
});

describe('formatPhoneEdit — paste', () => {
  it('accepts a +91-prefixed paste into an empty field', () => {
    const edit = formatPhoneEdit('+91 98765 43210', '');
    expect(edit.digits).toBe('9876543210');
    expect(edit.display).toBe('98765 43210');
    expect(edit.caret).toBe(IN_MOBILE_DISPLAY_LENGTH);
  });

  it('accepts a space-laden paste', () => {
    const edit = formatPhoneEdit('  98765   43210  ', '');
    expect(edit.digits).toBe('9876543210');
    expect(edit.display).toBe('98765 43210');
  });

  it('accepts a paste that is too long, truncating to ten', () => {
    const edit = formatPhoneEdit('98765432101234', '');
    expect(edit.digits).toBe('9876543210');
    expect(edit.display).toBe('98765 43210');
    expect(edit.caret).toBe(IN_MOBILE_DISPLAY_LENGTH);
  });

  it('keeps the caret after a paste made into the middle of a number', () => {
    // "987" + paste "77" + "654321"  →  digits 98777654321, capped to ten.
    const edit = formatPhoneEdit('9877765 4321', '98765 4321');
    expect(edit.digits).toBe('9877765432');
    expect(edit.display).toBe('98777 65432');
    // Immediately after the pasted pair — the fifth digit — and so before the
    // separator that the reflow has just pushed to index 5.
    expect(edit.caret).toBe(5);
  });
});

describe('formatPhoneEdit — deletion', () => {
  it('deletes a digit at the end and reflows', () => {
    const edit = formatPhoneEdit('98765 4321', '98765 43210');
    expect(edit.digits).toBe('987654321');
    expect(edit.display).toBe('98765 4321');
    expect(edit.caret).toBe(10);
  });

  it('deletes through a separator rather than re-inserting it', () => {
    // Backspace with the caret just after the space in "98765 43210" removes
    // the space. The separator is formatting, not content, so the digit in
    // front of it goes instead — matching PhoneNumberFormattingTextWatcher.
    const edit = formatPhoneEdit('9876543210', '98765 43210');
    expect(edit.digits).toBe('987643210');
    expect(edit.display).toBe('98764 3210');
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
    expect(edit.display).toBe('99876 54321');
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
