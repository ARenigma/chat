/**
 * Identifier validation.
 *
 * Providers and conversations are addressed by UUID now, not by a hardcoded
 * persona slug. The app persists the last-opened provider across relaunches, so
 * whatever comes back out of AsyncStorage has to be checked before it is handed
 * to an RPC, a malformed value should render the picker, not throw at boot.
 */

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/**
 * A v4 UUID, for the one thing the client has to name for itself: the storage
 * key a voice recording is uploaded under.
 *
 * `crypto.getRandomValues` rather than `Math.random`, and that is not caution for
 * its own sake. The key is the object's whole identity in a bucket the two
 * participants can read, so a guessable key is a guessable object name. The
 * polyfill in `webcrypto.ts` is backed by the platform CSPRNG.
 *
 * Hand-rolled rather than reached for from a library, because `crypto.randomUUID`
 * is absent under Hermes and adding a dependency for sixteen bytes and two bit
 * masks would be the wrong trade.
 */
export function newUuid(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  /* eslint-disable no-bitwise -- setting the version and variant fields of a
     UUID is bit manipulation by definition, and the arithmetic spelling of the
     same two lines is harder to check against RFC 4122 than the masks are. */
  // Version 4 and the RFC 4122 variant, so the value satisfies `isUuid` as well
  // as the `voice_path_is_scoped` constraint in migration 011.
  bytes[6] = ((bytes[6] as number) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
  /* eslint-enable no-bitwise */
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}
