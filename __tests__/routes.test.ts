/**
 * Where back goes.
 *
 * Nothing intercepted the back gesture before this, so it quit the app from any
 * screen including from inside a conversation. These pin the parent map; a
 * contract test pins that App.tsx actually consults it.
 */
import {
  isAccountLink,
  linkIsForAccount,
  memberParent,
  parseChatV2Url,
  providerParent,
  transitionFor,
  type MemberRoute,
} from '../src/lib/routes';

const PEER_ID = '11111111-1111-4111-8111-111111111111';

describe('memberParent', () => {
  it('returns null at the root so Android can close the app', () => {
    // An app that traps back at its home screen leaves no way out but the task
    // switcher, which is worse than never having handled the gesture.
    expect(memberParent({ name: 'home' })).toBeNull();
  });

  it('returns a conversation to the door it was opened from', () => {
    // Opened from Home, back returns to Home.
    expect(memberParent({ name: 'chat', providerId: 'p1', from: 'home' })).toEqual({
      name: 'home',
    });
    // Opened from a profile, back returns to that profile — carrying the id, so
    // the profile can render again without a lookup.
    expect(memberParent({ name: 'chat', providerId: 'p1', from: 'detail' })).toEqual({
      name: 'providerDetail',
      providerId: 'p1',
      from: 'home',
    });
    // Opened from the extended list, back returns to that list — a second
    // back (chatsList → home) is what leaves for Home. Instagram / Signal.
    expect(memberParent({ name: 'chat', providerId: 'p1', from: 'chatsList' })).toEqual({
      name: 'chatsList',
    });
  });

  it('returns the debug V2 conversation to Home', () => {
    expect(
      memberParent({
        name: 'chatV2',
        providerId: PEER_ID,
        benchmarkReadOnly: false,
      }),
    ).toEqual({
      name: 'home',
    });
  });

  it('routes the provider profile back to the door it was opened from', () => {
    expect(memberParent({ name: 'providerDetail', providerId: 'p1', from: 'home' })).toEqual({
      name: 'home',
    });
    expect(
      memberParent({ name: 'providerDetail', providerId: 'p1', from: 'favourites' }),
    ).toEqual({ name: 'favourites' });
    expect(memberParent({ name: 'providerDetail', providerId: 'p1', from: 'chat' })).toEqual({
      name: 'chat',
      providerId: 'p1',
      from: 'home',
    });
  });

  it('routes the application form back to its opener', () => {
    expect(memberParent({ name: 'apply', from: 'home' })).toEqual({ name: 'home' });
    expect(memberParent({ name: 'apply', from: 'settings' })).toEqual({ name: 'settings' });
    expect(memberParent({ name: 'apply', from: 'applicationStatus' })).toEqual({
      name: 'applicationStatus',
    });
  });

  it('sends the settings sub-screens back to Settings, not Home', () => {
    expect(memberParent({ name: 'applicationStatus' })).toEqual({ name: 'settings' });
    expect(memberParent({ name: 'blocked' })).toEqual({ name: 'settings' });
    expect(memberParent({ name: 'transactions' })).toEqual({ name: 'settings' });
    // Bills & invoices has exactly one door — the Settings row — so back is
    // Settings and not Home. Landing on Home would strand a member who came
    // for a document mid-list.
    expect(memberParent({ name: 'invoices' })).toEqual({ name: 'settings' });
  });

  it('sends top-level tabs back to Home', () => {
    expect(memberParent({ name: 'chatsList' })).toEqual({ name: 'home' });
    expect(memberParent({ name: 'calls' })).toEqual({ name: 'home' });
    expect(memberParent({ name: 'favourites' })).toEqual({ name: 'home' });
    expect(memberParent({ name: 'settings' })).toEqual({ name: 'home' });
  });
});

describe('providerParent', () => {
  it('returns home from chat and payout', () => {
    expect(providerParent({ name: 'home' })).toBeNull();
    expect(providerParent({ name: 'chat', peerId: 'm1' })).toEqual({ name: 'home' });
    // No pushed provider settings any more: the You tab (home) IS the settings.
    expect(providerParent({ name: 'payout' })).toEqual({ name: 'home' });
  });

  it('returns the chat that opened earnings, otherwise the You tab (home)', () => {
    expect(
      providerParent({ name: 'usage', from: 'chat', peerId: 'm1' }),
    ).toEqual({ name: 'chat', peerId: 'm1' });
    expect(providerParent({ name: 'usage', from: 'settings' })).toEqual({
      name: 'home',
    });
  });
});

describe('transitionFor', () => {
  // A sample route for every member route name, so the switch is exercised
  // exhaustively. Adding a route to MemberRoute without a case here fails
  // typecheck (the object literal below stops matching MemberRoute).
  const samples: Record<MemberRoute['name'], MemberRoute> = {
    home: { name: 'home' },
    providerDetail: { name: 'providerDetail', providerId: 'p1', from: 'home' },
    chat: { name: 'chat', providerId: 'p1', from: 'home' },
    chatV2: {
      name: 'chatV2',
      providerId: PEER_ID,
      benchmarkReadOnly: false,
    },
    call: { name: 'call', providerId: 'p1', direction: 'out', callId: null, medium: 'voice' },
    apply: { name: 'apply', from: 'home' },
    applicationStatus: { name: 'applicationStatus' },
    blocked: { name: 'blocked' },
    chatsList: { name: 'chatsList' },
    calls: { name: 'calls' },
    favourites: { name: 'favourites' },
    settings: { name: 'settings' },
    transactions: { name: 'transactions' },
    invoices: { name: 'invoices' },
    usage: { name: 'usage' },
  };

  it('treats Home as the root floor', () => {
    expect(transitionFor(samples.home)).toBe('root');
  });

  it('fades the top-level tab destinations', () => {
    expect(transitionFor(samples.favourites)).toBe('tab');
    expect(transitionFor(samples.calls)).toBe('tab');
    expect(transitionFor(samples.settings)).toBe('tab');
  });

  it('pushes every deeper destination', () => {
    for (const name of [
      'providerDetail',
      'chat',
      'chatV2',
      'call',
      'apply',
      'applicationStatus',
      'blocked',
      'chatsList',
      'transactions',
      // A document list opened from Settings is a push, not a tab: it is deeper
      // than the screen that opened it, so it slides in and the bottom nav goes
      // away with it (`transitionFor(route) !== 'push'` drives the toolbar).
      'invoices',
    ] as const) {
      expect(transitionFor(samples[name])).toBe('push');
    }
  });

  it('classifies every member route', () => {
    for (const route of Object.values(samples)) {
      expect(['root', 'tab', 'push']).toContain(transitionFor(route));
    }
  });

  it('gives every pushed route a parent to go back to', () => {
    for (const route of Object.values(samples)) {
      if (transitionFor(route) === 'push') {
        expect(memberParent(route)).not.toBeNull();
      }
    }
  });
});

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

describe('linkIsForAccount', () => {
  // A notification's link names the account its push was for (143), so a tap
  // after that account signed out opens nothing in the next one.
  const USER_A = '22222222-2222-4222-8222-222222222222';
  const USER_B = '33333333-3333-4333-8333-333333333333';
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
