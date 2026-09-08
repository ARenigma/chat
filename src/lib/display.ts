/**
 * Display helpers for provider identity.
 *
 * Providers choose a display name; there are no portraits yet, so the avatar is
 * a single initial derived from it. Derived rather than stored because a stored
 * initial is a second copy of the same fact that can fall out of step with it.
 */

export function initialOf(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();
  return trimmed === '' ? '?' : (trimmed[0] as string).toUpperCase();
}

export function availabilityLabel(isAvailable: boolean): string {
  return isAvailable ? 'Available now' : 'Away';
}

/**
 * Gender as Astrotalk-style shorthand beside the age: F-24, M-30.
 *
 * Amit, 2026-09-08: "gender letter before age like F-24, M-30".
 *
 * HERE AND NOT IN ProviderRow, which is where it was first written, because a
 * component in this repo cannot be unit-tested: importing a `.tsx` pulls in
 * `react-native-reanimated`, which throws `loadUnpackersWithCode` under jest
 * (there is no renderer in devDependencies). Every gate on a component is
 * therefore a source scan, and a source scan cannot check that 'other' maps to
 * null — only that the words appear. A pure function can be called.
 *
 * 'other' and null both return null rather than a letter. A letter for "other"
 * would either out somebody or invent a category to put them in, and neither is
 * a directory row's business; the age still shows on its own.
 */
export function genderLetter(gender: string | null): string | null {
  if (gender === 'female') {
    return 'F';
  }
  if (gender === 'male') {
    return 'M';
  }
  return null;
}
