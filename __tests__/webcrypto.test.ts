import { Utf8TextDecoder, digestSha256, webCryptoIsReady } from '../src/lib/webcrypto';

/**
 * Note on what is under test. The polyfill installs itself only when the runtime
 * lacks `crypto.subtle`, and Node has had it since 19, so asserting through
 * `crypto.subtle.digest` here would exercise Node's implementation and none of
 * ours. The digest is therefore imported and called directly.
 */

/**
 * The polyfill exists to satisfy one specific capability gate in
 * `@supabase/auth-js`:
 *
 *   typeof crypto !== 'undefined' && typeof crypto.subtle !== 'undefined'
 *     && typeof TextEncoder !== 'undefined'
 *
 * If that gate fails, PKCE degrades twice over: the verifier is generated with
 * Math.random() and sent unhashed as the challenge. So these tests assert the
 * gate itself, not an implementation detail.
 */
describe('webcrypto polyfill', () => {
  it('satisfies the capability gate supabase-js checks', () => {
    expect(webCryptoIsReady()).toBe(true);
  });

  it('produces the known SHA-256 digest of "abc"', async () => {
    // The canonical FIPS 180-4 test vector. A polyfill that returns *a* digest
    // is worthless; it has to return the right one.
    const digest = await digestSha256('SHA-256', new TextEncoder().encode('abc'));
    const hex = Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    expect(hex).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('encodes multi-byte UTF-8 the same way the spec does', () => {
    // Hand-rolled encoders get astral-plane characters wrong; this is a
    // surrogate pair and a 3-byte character.
    expect(Array.from(new TextEncoder().encode('é'))).toEqual([0xc3, 0xa9]);
    expect(Array.from(new TextEncoder().encode('अ'))).toEqual([0xe0, 0xa4, 0x85]);
    expect(Array.from(new TextEncoder().encode('😀'))).toEqual([0xf0, 0x9f, 0x98, 0x80]);
  });

  it('refuses an algorithm it has not implemented rather than guessing', async () => {
    await expect(
      digestSha256('SHA-512', new TextEncoder().encode('x')),
    ).rejects.toThrow(/not implemented/);
  });

  /**
   * Imported directly for the same reason as the digest: Node ships
   * `TextDecoder`, so the installer defers and asserting through the global
   * would test Node rather than this file. A missing `TextDecoder` on API 29
   * threw inside WebRTC signalling, so the callee never produced an answer SDP.
   */
  it('decodes multi-byte UTF-8 the same way the spec does', () => {
    const decode = (bytes: number[]) =>
      new Utf8TextDecoder().decode(new Uint8Array(bytes));
    expect(decode([0xc3, 0xa9])).toBe('é');
    expect(decode([0xe0, 0xa4, 0x85])).toBe('अ');
    expect(decode([0xf0, 0x9f, 0x98, 0x80])).toBe('😀');
    expect(new Utf8TextDecoder().decode()).toBe('');
  });

  it('replaces a truncated sequence rather than reading past the buffer', () => {
    expect(new Utf8TextDecoder().decode(new Uint8Array([0x61, 0xf0, 0x9f]))).toBe('a\uFFFD');
  });

  it('refuses an encoding it has not implemented rather than guessing', () => {
    expect(() => new Utf8TextDecoder('utf-16le')).toThrow(/utf-8 only/);
  });

  it('provides a random source that is not Math.random', () => {
    const a = new Uint32Array(8);
    const b = new Uint32Array(8);
    crypto.getRandomValues(a);
    crypto.getRandomValues(b);
    expect(Array.from(a)).not.toEqual(Array.from(b));
    expect(Array.from(a).every(n => n === 0)).toBe(false);
  });
});
