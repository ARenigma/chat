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
