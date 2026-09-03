import { NativeModules } from 'react-native';

/**
 * The native Cashfree 1-Click Onboarding bridge, and nothing else.
 *
 * Deliberately thin, like `src/lib/googleCredential.ts` over the Credential
 * Manager sheet: the native side can only be exercised with the Cashfree sheet on
 * a real device, so the only thing here is the shape of the call and the meaning
 * of each failure. What to DO about an outcome — exchanging the auth_code,
 * persisting the verified account — lives in `src/api/provider.ts`, where it is
 * testable without an emulator.
 */

export interface CashfreeOnboardingResult {
  /** The Cashfree verification id, echoed back for correlation with the server. */
  readonly verificationId: string;
  /**
   * The one-time auth_code. It is NOT the verified data — it is exchanged
   * server-side (Edge function) for an OAuth access token, which then fetches the
   * verified PAN + bank. Nothing sensitive crosses this bridge.
   */
  readonly authCode: string;
  /** Cashfree's terminal status string for the flow. */
  readonly status: string;
}

/** The environment the sheet renders against; matches the Edge functions' env. */
export type CashfreeEnvironment = 'sandbox' | 'production';

interface Native {
  open1ClickOnboarding(
    sessionId: string,
    environment: CashfreeEnvironment,
  ): Promise<CashfreeOnboardingResult>;
}

const native = (NativeModules as { CashfreeOnboarding?: Native }).CashfreeOnboarding;

/**
 * Whether the sheet is available at all.
 *
 * False in Jest and in any build where the package failed to register. Callers
 * must have a path for this — the hand-rolled bank/PAN form stays as the fallback
 * — rather than assuming the module exists, because the alternative is a
 * `TypeError` on a button press.
 */
export function cashfreeOnboardingAvailable(): boolean {
  return native !== undefined;
}

/**
 * Why an attempt ended without an auth_code.
 *
 * `cancelled` is not an error and must never be shown: somebody closed the sheet.
 * `unavailable` means the native module is absent and the caller should fall back
 * to the manual form. `failed` is a real verification failure worth surfacing.
 */
export type CashfreeOnboardingFailure = 'cancelled' | 'unavailable' | 'failed';

export class CashfreeOnboardingError extends Error {
  constructor(
    readonly reason: CashfreeOnboardingFailure,
    message: string,
  ) {
    super(message);
    this.name = 'CashfreeOnboardingError';
  }
}

/**
 * Open the sheet for a server-minted `sessionId`. Rejects with
 * `CashfreeOnboardingError` on every failure path.
 */
export async function startCashfreeOnboarding(
  sessionId: string,
  environment: CashfreeEnvironment,
): Promise<CashfreeOnboardingResult> {
  if (native === undefined) {
    throw new CashfreeOnboardingError(
      'unavailable',
      'Cashfree onboarding is not available.',
    );
  }
  try {
    return await native.open1ClickOnboarding(sessionId, environment);
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === 'cancelled') {
      throw new CashfreeOnboardingError('cancelled', 'Verification was dismissed.');
    }
    if (code === 'no_activity') {
      throw new CashfreeOnboardingError(
        'unavailable',
        'The app is not in the foreground.',
      );
    }
    throw new CashfreeOnboardingError(
      'failed',
      (error as { message?: string }).message ?? 'Verification could not complete.',
    );
  }
}
