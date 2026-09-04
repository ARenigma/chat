/**
 * Cashfree Secure ID two-factor signature (`x-cf-signature`).
 *
 * WHY THIS EXISTS
 *
 * Secure ID requires 2FA on BOTH sandbox and production, and offers two methods:
 * an IP allow-list, or an RSA signature. We cannot use the allow-list. Supabase
 * Edge Functions run on a globally distributed serverless runtime with no static
 * egress IP — Supabase say so explicitly, and the address observed from a real
 * call was 13.232.152.52 on one invocation with no guarantee of the next.
 * Cashfree's own guidance is the same: "If your service uses dynamic IPs,
 * Cashfree recommends using the Signature Generation (Public Key) method
 * instead."
 * https://www.cashfree.com/docs/secure-id/get-started/integration/ip-whitelisting-verification
 * https://supabase.com/docs/guides/troubleshooting/why-supabase-edge-functions-cannot-provide-static-egress-ips-for-whitelisting-3d78b0
 *
 * THE ALGORITHM, from Cashfree's 2FA signature page:
 *   1. `clientId` + '.' + current UNIX time in SECONDS
 *   2. RSA-encrypt that with the public key downloaded from the dashboard,
 *      OAEP padding with SHA-1 (their PHP sample uses
 *      OPENSSL_PKCS1_OAEP_PADDING; their Java sample names
 *      "RSA/ECB/OAEPWithSHA-1AndMGF1Padding")
 *   3. base64 the ciphertext
 *   4. send as the `x-cf-signature` header
 * The signature is valid for five minutes.
 * https://www.cashfree.com/docs/api-reference/vrs/2fa-api-signature-generation
 *
 * SHA-1 is not a security choice we are making. RSA-OAEP's hash is a padding
 * parameter, not a digest of anything secret, and it has to match what the
 * verifying end expects — Cashfree's samples fix it at SHA-1, so it is SHA-1
 * here. Deviating would simply fail to decrypt.
 */

/** Cached between invocations of the same isolate; importKey is not free. */
let cachedKey: CryptoKey | null = null;
let cachedPem: string | null = null;

function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const der = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) {
    der[i] = bin.charCodeAt(i);
  }
  return der;
}

/**
 * The signature for `clientId`, or null when no public key is configured.
 *
 * Null rather than throwing: an account with 2FA set to IP allow-list needs no
 * signature, and sending a bogus one would break a setup that works. The caller
 * omits the header when this returns null, which is exactly the pre-2FA
 * behaviour.
 */
export async function cashfreeSignature(
  clientId: string,
  publicKeyPem: string | undefined,
): Promise<string | null> {
  if (!publicKeyPem || publicKeyPem.trim() === '' || clientId === '') {
    return null;
  }
  try {
    if (cachedKey === null || cachedPem !== publicKeyPem) {
      cachedKey = await crypto.subtle.importKey(
        'spki',
        pemToDer(publicKeyPem),
        { name: 'RSA-OAEP', hash: 'SHA-1' },
        false,
        ['encrypt'],
      );
      cachedPem = publicKeyPem;
    }
    // Seconds, not milliseconds. Cashfree rejects a signature whose timestamp is
    // outside a five-minute window, and milliseconds lands ~55,000 years out.
    const payload = `${clientId}.${Math.floor(Date.now() / 1000)}`;
    const cipher = await crypto.subtle.encrypt(
      { name: 'RSA-OAEP' },
      cachedKey,
      new TextEncoder().encode(payload),
    );
    let binary = '';
    for (const byte of new Uint8Array(cipher)) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  } catch (err) {
    // A malformed key must not take the whole verification down with an opaque
    // 500 — the request is still worth attempting, and Cashfree's own error
    // ("Signature missing in the request") is clearer than ours would be.
    console.error('cashfree signature failed:', (err as Error).message);
    return null;
  }
}
