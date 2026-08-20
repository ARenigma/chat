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
