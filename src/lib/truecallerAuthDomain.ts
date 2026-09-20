/**
 * Pure Truecaller auth-response and continuity-state decisions.
 *
 * Kept free of React Native/Supabase imports so Jest executes the real parsing
 * and state rules rather than checking source strings.
 */

export type TruecallerExchangeOutcome =
  | {
      readonly status: 'session';
      readonly accessToken: string;
      readonly refreshToken: string;
    }
  | { readonly status: 'no_owner'; readonly challenge: string }
  | { readonly status: 'invalid' };

/** Interpret the untrusted JSON returned by exchange-truecaller-code. */
export function parseTruecallerExchange(
  value: unknown,
): TruecallerExchangeOutcome {
  if (typeof value !== 'object' || value === null) {
    return { status: 'invalid' };
  }
  const data = value as Record<string, unknown>;
  if (
    data.status === 'no_owner' &&
    typeof data.challenge === 'string' &&
    data.challenge.length >= 32 &&
    data.challenge.length <= 256
  ) {
    return { status: 'no_owner', challenge: data.challenge };
  }
  if (
    typeof data.access_token === 'string' &&
    data.access_token !== '' &&
    typeof data.refresh_token === 'string' &&
    data.refresh_token !== ''
  ) {
    return {
      status: 'session',
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
    };
  }
  return { status: 'invalid' };
}

export interface PendingTruecallerGoogleLink {
  readonly challenge: string;
  readonly expiresAt: number;
}

export function serializePendingTruecallerGoogleLink(
  challenge: string,
  expiresAt: number,
): string {
  return JSON.stringify({ challenge, expiresAt });
}

/** Parse a staged browser-link challenge; expired/corrupt records fail closed. */
export function parsePendingTruecallerGoogleLink(
  raw: string | null,
  now: number,
): PendingTruecallerGoogleLink | null {
  if (raw === null) return null;
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof value.challenge === 'string' &&
      value.challenge.length >= 32 &&
      value.challenge.length <= 256 &&
      typeof value.expiresAt === 'number' &&
      Number.isFinite(value.expiresAt) &&
      value.expiresAt > now
    ) {
      return {
        challenge: value.challenge,
        expiresAt: value.expiresAt,
      };
    }
  } catch {
    // Invalid JSON is an invalid pending link.
  }
  return null;
}

export type TruecallerFailureAction =
  | 'return_to_chooser'
  | 'show_whatsapp_fallback'
  | 'show_error';

/** Product behavior for each native terminal outcome. */
export function actionForTruecallerFailure(
  reason: 'cancelled' | 'unavailable' | 'failed',
): TruecallerFailureAction {
  if (reason === 'cancelled') return 'return_to_chooser';
  if (reason === 'unavailable') return 'show_whatsapp_fallback';
  return 'show_error';
}
