/**
 * Identifier validation.
 *
 * Providers and conversations are addressed by UUID now, not by a hardcoded
 * persona slug. The app persists the last-opened provider across relaunches, so
 * whatever comes back out of AsyncStorage has to be checked before it is handed
 * to an RPC — a malformed value should render the picker, not throw at boot.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
