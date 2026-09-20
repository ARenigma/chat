import { NativeModules } from 'react-native';

/**
 * Typed bridge to TruecallerOAuthModule.kt.
 *
 * Thin: no OAuth secrets or phone data are handled here. The module returns only
 * the authorization code and PKCE verifier so the Edge Function can exchange them
 * server-side. The verified phone is fetched by the server and never touches JS.
 *
 * Exactly mirrors CashfreeOnboardingModule and GoogleCredentialModule in keeping
 * all logic in src/api/auth.ts and src/api/provider.ts rather than here.
 */

export interface TruecallerOAuthResult {
  /** Truecaller-issued one-time authorization code. */
  readonly authorizationCode: string;
  /**
   * PKCE verifier for this attempt, generated in MainActivity per the OAuth spec.
   * The server sends it to Truecaller's token endpoint as proof that the code
   * came from a device that also generated the challenge — not an intercepted code.
   * Treat it as a secret: log nothing and send it only over TLS to the Edge Function.
   */
  readonly codeVerifier: string;
}

interface Native {
  signIn(): Promise<TruecallerOAuthResult>;
}

const native = (NativeModules as { TruecallerOAuth?: Native }).TruecallerOAuth;

/**
 * Whether the Truecaller native module is available.
 *
 * False in Jest, bare debug builds without the module, and when the module
 * failed to register. Callers must have a fallback path.
 */
export function truecallerAvailable(): boolean {
  return native !== undefined;
}

/**
 * Why a Truecaller sign-in attempt ended without producing a result.
 *
 * `cancelled` — user dismissed the consent sheet (SDK codes 2/11/14).
 *   The caller must NOT show an error: it is a decision, not a failure.
 *
 * `unavailable` — Truecaller is not installed, not logged in, or the
 *   process was recreated mid-attempt. Fail gracefully to the WhatsApp path.
 *
 * `failed` — configuration error (wrong client ID or SHA-1) or unexpected
 *   SDK error. Show an actionable error and keep the fallbacks visible.
 */
export type TruecallerFailureReason = 'cancelled' | 'unavailable' | 'failed';

export class TruecallerOAuthError extends Error {
  constructor(
    readonly reason: TruecallerFailureReason,
    message: string,
  ) {
    super(message);
    this.name = 'TruecallerOAuthError';
  }
}

/**
 * Open the Truecaller consent sheet and resolve with the authorization code and
 * PKCE verifier. Rejects with TruecallerOAuthError on every failure path.
 */
export async function requestTruecallerAuth(): Promise<TruecallerOAuthResult> {
  if (native === undefined) {
    throw new TruecallerOAuthError(
      'unavailable',
      'TruecallerOAuth native module is not registered.',
    );
  }
  try {
    return await native.signIn();
  } catch (error) {
    const code = (error as { code?: string }).code;
    const reason: TruecallerFailureReason =
      code === 'cancelled' ? 'cancelled' :
      code === 'unavailable' ? 'unavailable' :
      'failed';
    throw new TruecallerOAuthError(
      reason,
      (error as { message?: string }).message ?? 'Truecaller sign-in failed.',
    );
  }
}
