/**
 * Where back goes.
 *
 * Nothing intercepted the back gesture before this, so it quit the app from any
 * screen including from inside a conversation. These pin the parent map; a
 * contract test pins that App.tsx actually consults it.
 */
import { memberParent, providerParent } from '../src/lib/routes';

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
    });
  });

  it('sends every other member screen back to Home', () => {
    expect(memberParent({ name: 'providerDetail', providerId: 'p1' })).toEqual({ name: 'home' });
    expect(memberParent({ name: 'apply' })).toEqual({ name: 'home' });
    expect(memberParent({ name: 'applicationStatus' })).toEqual({ name: 'home' });
  });
});

describe('providerParent', () => {
  it('is a two-screen tree', () => {
    expect(providerParent({ name: 'home' })).toBeNull();
    expect(providerParent({ name: 'chat', peerId: 'm1' })).toEqual({ name: 'home' });
  });
});
