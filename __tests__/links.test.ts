/**
 * Tests for src/lib/routes/links.ts — pure URL parsers.
 *
 * Parser unit tests are gathered here (not in routes.test.ts / platform.test.ts
 * / callControlsAreWired.test.ts) so they travel with the functions they cover.
 * Tests that were previously scattered have been moved here; the originals were
 * removed to avoid duplication.
 *
 * nav-migration §9 step 2.
 */

import {
  isAccountLink,
  linkIsForAccount,
  parseCallUrl,
  parseChatV2Url,
  parsePeerUrl,
} from '../src/lib/routes/links';

const PEER_ID = '11111111-1111-4111-8111-111111111111';
const CALL_ID = '33333333-3333-4333-8333-333333333333';
const USER_A = '22222222-2222-4222-8222-222222222222';
const USER_B = '44444444-4444-4444-8444-444444444444';

// ---------------------------------------------------------------------------
// parseChatV2Url — moved from routes.test.ts
// ---------------------------------------------------------------------------

describe('parseChatV2Url', () => {
  const url = `companionchat://chat-v2/${PEER_ID}`;

  it('accepts the explicit V2 link in development', () => {
    expect(parseChatV2Url(url, true)).toBe(PEER_ID);
  });

  it('ignores the V2 link in release', () => {
    expect(parseChatV2Url(url, false)).toBeNull();
  });

  it('rejects malformed ids and lookalike routes', () => {
    expect(parseChatV2Url('companionchat://chat-v2/not-a-uuid', true)).toBeNull();
    expect(parseChatV2Url(`companionchat://peer/${PEER_ID}`, true)).toBeNull();
    expect(parseChatV2Url(`${url}?unexpected=true`, true)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// isAccountLink — moved from routes.test.ts
// ---------------------------------------------------------------------------

describe('isAccountLink', () => {
  it.each([
    [`companionchat://peer/${PEER_ID}`, true],
    [`companionchat://call/${PEER_ID}?callId=${PEER_ID}&action=answer&medium=voice`, true],
    [`companionchat://chat-v2/${PEER_ID}`, true],
    // How a session arrives at all, and the harness's capture profile.
    ['companionchat://auth-callback?code=abc', false],
    ['companionchat://auth-callback/truecaller-link?code=abc', false],
    ['companionchat://e2e-auth?access_token=a&refresh_token=r', false],
    ['companionchat://call-sim?resolution=hd', false],
  ])('%s is an account link: %s', (url, expected) => {
    expect(isAccountLink(url)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// linkIsForAccount — moved from routes.test.ts
// ---------------------------------------------------------------------------

describe('linkIsForAccount', () => {
  // A notification's link names the account its push was for (143), so a tap
  // after that account signed out opens nothing in the next one.
  it.each([
    [`companionchat://peer/${PEER_ID}?for=${USER_A}`, USER_A, true],
    [`companionchat://peer/${PEER_ID}?for=${USER_A}`, USER_B, false],
    [`companionchat://peer/${PEER_ID}?for=${USER_A}`, null, false],
    [`companionchat://call/${PEER_ID}?callId=${PEER_ID}&action=answer&medium=voice&for=${USER_A}`, USER_A, true],
    [`companionchat://call/${PEER_ID}?callId=${PEER_ID}&action=answer&medium=voice&for=${USER_A}`, USER_B, false],
    // Not a uuid: not a link this app wrote.
    [`companionchat://peer/${PEER_ID}?for=anyone`, USER_A, false],
    // No `for`: posted before 143, or the V2 seam. Opens as before.
    [`companionchat://peer/${PEER_ID}`, USER_B, true],
    [`companionchat://call/${PEER_ID}?callId=${PEER_ID}&action=answer&medium=voice`, USER_B, true],
  ])('%s for %s opens: %s', (url, account, expected) => {
    expect(linkIsForAccount(url, account)).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// parsePeerUrl
// ---------------------------------------------------------------------------

describe('parsePeerUrl', () => {
  it('returns the peer UUID for a bare peer link', () => {
    expect(parsePeerUrl(`companionchat://peer/${PEER_ID}`)).toBe(PEER_ID);
  });

  it('strips the query string before uuid-checking (harness-augmented URIs)', () => {
    // bdda9ce: a harness URI `peer/<id>?for=<uid>` must still route.
    // parsePeerUrl strips '?' before passing to isUuid — this was previously
    // asserted on App.tsx as `peer.split('?')` / `isUuid(peerId)` but those
    // lines now live inside this function. (Moved from platform.test.ts.)
    expect(parsePeerUrl(`companionchat://peer/${PEER_ID}?for=${USER_A}`)).toBe(PEER_ID);
  });

  it('rejects a non-uuid segment', () => {
    expect(parsePeerUrl('companionchat://peer/not-a-uuid')).toBeNull();
  });

  it('rejects a non-peer scheme', () => {
    expect(parsePeerUrl(`companionchat://call/${PEER_ID}`)).toBeNull();
  });

  it('rejects an empty path', () => {
    expect(parsePeerUrl('companionchat://peer/')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseCallUrl
// ---------------------------------------------------------------------------

describe('parseCallUrl', () => {
  const base = `companionchat://call/${PEER_ID}?callId=${CALL_ID}&action=answer&medium=voice`;

  it('parses a fully-formed answer link', () => {
    const result = parseCallUrl(base);
    expect(result).not.toBeNull();
    expect(result?.peerId).toBe(PEER_ID);
    expect(result?.callId).toBe(CALL_ID);
    expect(result?.action).toBe('answer');
    expect(result?.medium).toBe('voice');
  });

  it('parses a video call link', () => {
    const url = `companionchat://call/${PEER_ID}?callId=${CALL_ID}&action=answer&medium=video`;
    expect(parseCallUrl(url)?.medium).toBe('video');
  });

  it('parses a decline action', () => {
    const url = `companionchat://call/${PEER_ID}?callId=${CALL_ID}&action=decline&medium=voice`;
    expect(parseCallUrl(url)?.action).toBe('decline');
  });

  it('defaults medium to voice when param is absent (pre-fix notifications)', () => {
    // Older notification builds omitted `medium=` from the intent URI.
    // parseCallUrl falls back to 'voice', the same default App.tsx used inline.
    // Previously asserted as `app.toMatch(/medium.*=.*qs\.match.*medium=.*\?.*'voice'/)`;
    // that regex now lives inside this function. (Moved from platform.test.ts.)
    const url = `companionchat://call/${PEER_ID}?callId=${CALL_ID}&action=answer`;
    expect(parseCallUrl(url)?.medium).toBe('voice');
  });

  it('defaults action to answer when param is absent', () => {
    const url = `companionchat://call/${PEER_ID}?callId=${CALL_ID}&medium=voice`;
    expect(parseCallUrl(url)?.action).toBe('answer');
  });

  it('extracts action from the query string (moved from callControlsAreWired.test.ts)', () => {
    // The App.tsx inline `const action = qs.match(/action=([^&]+)/)` was moved
    // into parseCallUrl. This pins the extraction behaviour.
    const decline = `companionchat://call/${PEER_ID}?callId=${CALL_ID}&action=decline&medium=voice`;
    expect(parseCallUrl(decline)?.action).toBe('decline');
    const answer = `companionchat://call/${PEER_ID}?callId=${CALL_ID}&action=answer&medium=video`;
    expect(parseCallUrl(answer)?.action).toBe('answer');
  });

  it('returns null when peerId is not a UUID', () => {
    const url = `companionchat://call/not-a-uuid?callId=${CALL_ID}&action=answer&medium=voice`;
    expect(parseCallUrl(url)).toBeNull();
  });

  it('returns null when callId is not a UUID', () => {
    const url = `companionchat://call/${PEER_ID}?callId=bad-id&action=answer&medium=voice`;
    expect(parseCallUrl(url)).toBeNull();
  });

  it('returns null when callId param is missing', () => {
    const url = `companionchat://call/${PEER_ID}?action=answer&medium=voice`;
    expect(parseCallUrl(url)).toBeNull();
  });

  it('returns null for a non-call scheme', () => {
    expect(parseCallUrl(`companionchat://peer/${PEER_ID}`)).toBeNull();
  });
});
