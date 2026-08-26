/**
 * The WebCrypto surface PKCE needs, which Hermes does not ship.
 *
 * Imported for its side effects, and it must run before any Supabase import.
 *
 * ---------------------------------------------------------------------------
 * Why this exists
 * ---------------------------------------------------------------------------
 * Running the app on a device surfaced this in logcat:
 *
 *   WebCrypto API is not supported. Code challenge method will default to use
 *   plain instead of sha256.
 *
 * That log line understates the problem. Reading `@supabase/auth-js`, there are
 * *two* fallbacks, and the quieter one is the dangerous one:
 *
 *   1. `generatePKCEChallenge` sends the verifier as the challenge (`plain`)
 *      when `crypto.subtle` is missing. Weaker, but the code exchange still
 *      happens server-side against a client secret.
 *   2. `generatePKCEVerifier` falls back to **`Math.random()`** when `crypto` is
 *      undefined entirely. That is the real problem: Math.random is not a CSPRNG,
 *      so the verifier is guessable in principle, and with `plain` the challenge
 *      is the verifier. Together they reduce PKCE to decoration.
 *
 * So both halves are polyfilled:
 *
 *   - `getRandomValues` comes from react-native-get-random-values, which is
 *     backed by the platform CSPRNG (SecRandomCopyBytes / SecureRandom) rather
 *     than anything implemented here. Never hand-roll an RNG.
 *   - `subtle.digest` is SHA-256 from `js-sha256`, a pure-JS implementation with
 *     no native module and no new Gradle dependency. SHA-256 is a public hash of
 *     a value we generated, so a JS implementation is a performance question, not
 *     a security one, unlike the RNG, which is why that one is native.
 *
 * Only `SHA-256` is implemented. Anything else throws rather than silently
 * returning the wrong digest, because a hash function that quietly does
 * something other than what it was asked is worse than one that is absent.
 */
import 'react-native-get-random-values';
import { sha256 } from 'js-sha256';

type Digestible = ArrayBuffer | ArrayBufferView;

function toBytes(data: Digestible): Uint8Array {
  return data instanceof ArrayBuffer
    ? new Uint8Array(data)
    : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

/**
 * The SHA-256 digest itself, exported so it can be tested directly.
 *
 * Necessary because the installer below defers to a real `crypto.subtle` when
 * one already exists, which it does under Node. Testing through the global
 * would therefore test Node's WebCrypto and not a line of this file.
 */
export async function digestSha256(
  algorithm: string | { name: string },
  data: Digestible,
): Promise<ArrayBuffer> {
  const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
  if (name.toUpperCase() !== 'SHA-256') {
    throw new Error(`webcrypto polyfill: ${name} is not implemented`);
  }
  return sha256.arrayBuffer(toBytes(data));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const globalScope = global as any;

if (typeof globalScope.crypto === 'undefined') {
  globalScope.crypto = {};
}

if (typeof globalScope.crypto.subtle === 'undefined') {
  globalScope.crypto.subtle = { digest: digestSha256 };
}

/**
 * Hermes ships TextEncoder in recent versions, but supabase-js checks for it as
 * part of the same capability gate, so a missing one silently reinstates the
 * `plain` fallback. Encoding UTF-8 is unambiguous and safe to provide.
 */
if (typeof globalScope.TextEncoder === 'undefined') {
  globalScope.TextEncoder = class {
    readonly encoding = 'utf-8';
    encode(input = ''): Uint8Array {
      /* eslint-disable no-bitwise -- UTF-8 encoding is bit manipulation by
         definition; expressing it without shifts and masks would be slower and
         far harder to check against the spec. Scoped to this function only. */
      const out: number[] = [];
      for (let i = 0; i < input.length; i += 1) {
        let code = input.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
          const next = input.charCodeAt(i + 1);
          if (next >= 0xdc00 && next <= 0xdfff) {
            code = ((code - 0xd800) << 10) + (next - 0xdc00) + 0x10000;
            i += 1;
          }
        }
        if (code < 0x80) {
          out.push(code);
        } else if (code < 0x800) {
          out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
        } else if (code < 0x10000) {
          out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
        } else {
          out.push(
            0xf0 | (code >> 18),
            0x80 | ((code >> 12) & 0x3f),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f),
          );
        }
      }
      return new Uint8Array(out);
      /* eslint-enable no-bitwise */
    }
  };
}

/** Exported so a test can assert the capability gate supabase-js checks. */
export function webCryptoIsReady(): boolean {
  return (
    typeof globalScope.crypto !== 'undefined' &&
    typeof globalScope.crypto.subtle !== 'undefined' &&
    typeof globalScope.crypto.getRandomValues === 'function' &&
    typeof globalScope.TextEncoder !== 'undefined'
  );
}
