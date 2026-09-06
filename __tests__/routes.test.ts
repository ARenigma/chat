/**
 * Where back goes.
 *
 * Nothing intercepted the back gesture before this, so it quit the app from any
 * screen including from inside a conversation. These pin the parent map; a
 * contract test pins that App.tsx actually consults it.
 */
import {
  memberParent,
  providerParent,
  transitionFor,
  type MemberRoute,
} from '../src/lib/routes';

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
  });

  it('sends top-level tabs back to Home', () => {
    expect(memberParent({ name: 'chatsList' })).toEqual({ name: 'home' });
    expect(memberParent({ name: 'calls' })).toEqual({ name: 'home' });
    expect(memberParent({ name: 'favourites' })).toEqual({ name: 'home' });
    expect(memberParent({ name: 'settings' })).toEqual({ name: 'home' });
  });
});

describe('providerParent', () => {
  it('is a two-screen tree', () => {
    expect(providerParent({ name: 'home' })).toBeNull();
    expect(providerParent({ name: 'chat', peerId: 'm1' })).toEqual({ name: 'home' });
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
    call: { name: 'call', providerId: 'p1', direction: 'out', callId: null, medium: 'voice' },
    apply: { name: 'apply', from: 'home' },
    applicationStatus: { name: 'applicationStatus' },
    blocked: { name: 'blocked' },
    chatsList: { name: 'chatsList' },
    calls: { name: 'calls' },
    favourites: { name: 'favourites' },
    settings: { name: 'settings' },
    transactions: { name: 'transactions' },
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
      'call',
      'apply',
      'applicationStatus',
      'blocked',
      'chatsList',
      'transactions',
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
