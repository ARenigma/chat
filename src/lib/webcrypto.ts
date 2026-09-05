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
          out.push(
            0xe0 | (code >> 12),
            0x80 | ((code >> 6) & 0x3f),
            0x80 | (code & 0x3f),
          );
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

/**
 * The decoding half. `TextDecoder` is not part of the supabase-js capability
 * gate, so its absence throws at use rather than degrading: on the API 29
 * device the callee's WebRTC signalling died with
 * `ReferenceError: Property 'TextDecoder' doesn't exist` immediately after
 * `addTransceiver`, so no answer SDP was ever produced and the caller rang
 * until the 30s timeout while the ledger row already read 'active'.
 *
 * Only UTF-8 is implemented, and an unknown encoding throws for the same reason
 * `subtle.digest` does: decoding as something other than what was asked is
 * worse than not decoding at all.
 */
export class Utf8TextDecoder {
  readonly encoding: string;

  constructor(encoding = 'utf-8') {
    const normalised = encoding.toLowerCase();
    if (normalised !== 'utf-8' && normalised !== 'utf8') {
      throw new RangeError(
        `TextDecoder polyfill supports utf-8 only, got ${encoding}`,
      );
    }
    this.encoding = 'utf-8';
  }

  decode(input?: ArrayBuffer | ArrayBufferView): string {
    if (input === undefined) return '';
    const bytes =
      input instanceof Uint8Array
        ? input
        : ArrayBuffer.isView(input)
        ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
        : new Uint8Array(input);
    /* eslint-disable no-bitwise -- as in TextEncoder above: UTF-8 is defined
         in terms of shifts and masks. Scoped to this function only. */
    let out = '';
    for (let i = 0; i < bytes.length; ) {
      const byte = bytes[i] as number;
      let code: number;
      let width: number;
      if (byte < 0x80) {
        code = byte;
        width = 1;
      } else if ((byte & 0xe0) === 0xc0) {
        code = byte & 0x1f;
        width = 2;
      } else if ((byte & 0xf0) === 0xe0) {
        code = byte & 0x0f;
        width = 3;
      } else {
        code = byte & 0x07;
        width = 4;
      }
      // A truncated sequence decodes to U+FFFD, as the spec requires, rather
      // than reading past the end of the buffer.
      if (i + width > bytes.length) {
        out += '\uFFFD';
        break;
      }
      for (let j = 1; j < width; j += 1) {
        code = (code << 6) | ((bytes[i + j] as number) & 0x3f);
      }
      if (code > 0xffff) {
        const astral = code - 0x10000;
        out += String.fromCharCode(
          0xd800 + (astral >> 10),
          0xdc00 + (astral & 0x3ff),
        );
      } else {
        out += String.fromCharCode(code);
      }
      i += width;
    }
    return out;
    /* eslint-enable no-bitwise */
  }
}

if (typeof globalScope.TextDecoder === 'undefined') {
  globalScope.TextDecoder = Utf8TextDecoder;
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
