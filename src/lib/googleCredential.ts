import { NativeModules } from 'react-native';

/**
 * The native Credential Manager bridge, and nothing else.
 *
 * Deliberately thin, like `src/lib/appUpdate.ts` over `InAppUpdateModule`: the
 * native side can only be exercised on a real device with Play services, so the
 * only thing here is the shape of the call and the meaning of each failure.
 * Everything that decides what to DO about a failure lives in `src/api/auth.ts`,
 * where it can be read and reasoned about without an emulator.
 */

export interface GoogleCredentialResult {
  /** The Google ID token, to be exchanged with Supabase for a session. */
  readonly idToken: string;
  /**
   * The unhashed nonce. Google received its SHA-256 and embedded that in the
   * token; Supabase needs the original to check the two against each other.
   * Sending the hash here instead fails verification in a way whose error
   * message does not say which of the two values was wrong.
   */
  readonly rawNonce: string;
}

interface Native {
  signIn(): Promise<GoogleCredentialResult>;
}

const native = (NativeModules as { GoogleCredential?: Native }).GoogleCredential;

/**
 * Whether the sheet is available at all.
 *
 * False in Jest, in a bare debug build without the native module, and on any
 * device where the package failed to register. Callers must have a path for
 * this rather than assuming the module exists, because the alternative is a
 * `TypeError` on a button press.
 */
export function credentialSheetAvailable(): boolean {
  return native !== undefined;
}

/**
 * Why an attempt ended, when it did not produce a token.
 *
 * `cancelled` is not an error and must never be shown. Somebody tapped outside
 * the sheet; telling them "sign-in failed" for that is the kind of small lie
 * that makes an app feel broken. `unavailable` means this device cannot show
 * the button flow and the browser has to do it.
 */
export type GoogleCredentialFailure = 'cancelled' | 'unavailable';

export class GoogleCredentialError extends Error {
  constructor(readonly reason: GoogleCredentialFailure, message: string) {
    super(message);
    this.name = 'GoogleCredentialError';
  }
}

/** Open the sheet. Rejects with `GoogleCredentialError` on every failure path. */
export async function requestGoogleCredential(): Promise<GoogleCredentialResult> {
  if (native === undefined) {
    throw new GoogleCredentialError('unavailable', 'Credential Manager is not available.');
  }
  try {
    return await native.signIn();
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'cancelled') {
      throw new GoogleCredentialError('cancelled', 'Sign-in was dismissed.');
    }
    /*
     * Everything else is `unavailable` rather than a hard failure, and that is
     * the important choice in this file. A device with no Play services, an
     * out-of-date Play services, or a build whose SHA-1 is not registered
     * against the OAuth client all land here — and all of them are recoverable
     * by falling back to the browser. Treating them as fatal would strand a real
     * user on a button that never works.
     */
    throw new GoogleCredentialError(
      'unavailable',
      (error as { message?: string }).message ?? 'Could not open the sign-in sheet.',
    );
  }
}
