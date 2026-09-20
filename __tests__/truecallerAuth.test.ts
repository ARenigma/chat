import {
  actionForTruecallerFailure,
  parsePendingTruecallerGoogleLink,
  parseTruecallerExchange,
  serializePendingTruecallerGoogleLink,
} from '../src/lib/truecallerAuthDomain';

const CHALLENGE = 'a'.repeat(64);

describe('Truecaller exchange response', () => {
  it('accepts a complete Supabase session and renames its fields', () => {
    expect(
      parseTruecallerExchange({
        access_token: 'access',
        refresh_token: 'refresh',
      }),
    ).toEqual({
      status: 'session',
      accessToken: 'access',
      refreshToken: 'refresh',
    });
  });

  it('accepts a bounded no-owner challenge', () => {
    expect(
      parseTruecallerExchange({
        status: 'no_owner',
        challenge: CHALLENGE,
      }),
    ).toEqual({ status: 'no_owner', challenge: CHALLENGE });
  });

  it.each([
    null,
    {},
    { access_token: 'access' },
    { refresh_token: 'refresh' },
    { access_token: '', refresh_token: 'refresh' },
    { status: 'no_owner', challenge: 'short' },
    { status: 'no_owner', challenge: 'x'.repeat(257) },
  ])('rejects malformed payload %#', payload => {
    expect(parseTruecallerExchange(payload)).toEqual({ status: 'invalid' });
  });
});

describe('Truecaller → browser Google continuity record', () => {
  it('round-trips an active opaque challenge', () => {
    const raw = serializePendingTruecallerGoogleLink(CHALLENGE, 11_000);
    expect(parsePendingTruecallerGoogleLink(raw, 10_000)).toEqual({
      challenge: CHALLENGE,
      expiresAt: 11_000,
    });
  });

  it('fails closed for expired, corrupt, short, or absent records', () => {
    expect(
      parsePendingTruecallerGoogleLink(
        serializePendingTruecallerGoogleLink(CHALLENGE, 10_000),
        10_000,
      ),
    ).toBeNull();
    expect(parsePendingTruecallerGoogleLink('{', 0)).toBeNull();
    expect(
      parsePendingTruecallerGoogleLink(
        JSON.stringify({ challenge: 'short', expiresAt: 20_000 }),
        10_000,
      ),
    ).toBeNull();
    expect(parsePendingTruecallerGoogleLink(null, 0)).toBeNull();
  });
});

describe('Truecaller terminal outcome policy', () => {
  it('keeps cancellation silent, routes unavailability to WhatsApp, and surfaces failures', () => {
    expect(actionForTruecallerFailure('cancelled')).toBe('return_to_chooser');
    expect(actionForTruecallerFailure('unavailable')).toBe(
      'show_whatsapp_fallback',
    );
    expect(actionForTruecallerFailure('failed')).toBe('show_error');
  });
});
