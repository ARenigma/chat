/**
 * Tests for src/lib/routes/actions.ts
 *
 * Covers: glareDecision (all three branches) and every resolveOpenChat rule
 * (nav-migration §3): one chat per peer across tabs, source removal, callEnd
 * with a profile between, replace-in-place for an intent, the conversations
 * tab, an unvisited tab, and the profile sheet's replace.
 */

import {
  chatTabOf,
  glareDecision,
  locateRoute,
  resolveOpenChat,
  type StackLike,
} from '../src/lib/routes/actions';
import type { ActiveCall, IncomingCallIntent } from '../src/lib/routes/actions';

const PEER_A = '11111111-1111-4111-8111-111111111111';
const PEER_B = '22222222-2222-4222-8222-222222222222';
const CALL_ID = '33333333-3333-4333-8333-333333333333';
const CALL_ID_2 = '44444444-4444-4444-8444-444444444444';

// ---------------------------------------------------------------------------
// glareDecision
// ---------------------------------------------------------------------------

describe('glareDecision', () => {
  const base: ActiveCall = {
    seq: 1,
    callId: CALL_ID,
    peerId: PEER_A,
    direction: 'in',
  };
  const intent: IncomingCallIntent = {
    type: 'incomingCall',
    peerId: PEER_B,
    callId: CALL_ID_2,
  };

  it('returns duplicate when callId matches the active call', () => {
    const active: ActiveCall = { ...base, callId: CALL_ID };
    const incoming: IncomingCallIntent = {
      type: 'incomingCall',
      peerId: PEER_B,
      callId: CALL_ID,
    };
    expect(glareDecision(active, incoming)).toBe('duplicate');
  });

  it('returns ownDialRace for an outgoing call with no callId to the same peer', () => {
    // M23 own-dial race: we sent start_call but have not received callId yet,
    // and the Realtime INSERT fires for our own ring.
    const active: ActiveCall = {
      seq: 1,
      callId: null,
      peerId: PEER_A,
      direction: 'out',
    };
    const incoming: IncomingCallIntent = {
      type: 'incomingCall',
      peerId: PEER_A,
      callId: CALL_ID,
    };
    expect(glareDecision(active, incoming)).toBe('ownDialRace');
  });

  it('does not treat an outgoing call to a DIFFERENT peer as ownDialRace', () => {
    const active: ActiveCall = {
      seq: 1,
      callId: null,
      peerId: PEER_A,
      direction: 'out',
    };
    const incoming: IncomingCallIntent = {
      type: 'incomingCall',
      peerId: PEER_B,
      callId: CALL_ID,
    };
    expect(glareDecision(active, incoming)).toBe('busyDecline');
  });

  it('does not treat an outgoing call with a callId as ownDialRace', () => {
    // callId is already resolved — this is a real second call.
    const active: ActiveCall = {
      seq: 1,
      callId: CALL_ID,
      peerId: PEER_A,
      direction: 'out',
    };
    const incoming: IncomingCallIntent = {
      type: 'incomingCall',
      peerId: PEER_A,
      callId: CALL_ID_2,
    };
    expect(glareDecision(active, incoming)).toBe('busyDecline');
  });

  it('returns busyDecline for a genuinely different incoming call', () => {
    expect(glareDecision(base, intent)).toBe('busyDecline');
  });
});

// ---------------------------------------------------------------------------
// resolveOpenChat
// ---------------------------------------------------------------------------

const PEER_C = '55555555-5555-4555-8555-555555555555';

/** A member root: tabs HomeTab/FavouritesTab/YouTab, the focused one first-class. */
function memberRoot(
  focused: number,
  stacks: {
    home?: Array<[string, string, Record<string, unknown>?]>;
    favourites?: Array<[string, string, Record<string, unknown>?]>;
    you?: Array<[string, string, Record<string, unknown>?]>;
  },
): StackLike {
  const stack = (key: string, routes?: Array<[string, string, Record<string, unknown>?]>) =>
    routes === undefined
      ? undefined
      : {
          key,
          index: routes.length - 1,
          routes: routes.map(([name, routeKey, params]) => ({ name, key: routeKey, params })),
        };
  return {
    key: 'tabs',
    index: focused,
    routes: [
      { name: 'HomeTab', key: 'home-tab', state: stack('home-stack', stacks.home) },
      { name: 'FavouritesTab', key: 'fav-tab', state: stack('fav-stack', stacks.favourites) },
      { name: 'YouTab', key: 'you-tab', state: stack('you-stack', stacks.you) },
    ],
  };
}

describe('resolveOpenChat', () => {
  it('does nothing before the navigator is ready', () => {
    expect(resolveOpenChat(undefined, PEER_A, 'intent')).toEqual({ kind: 'noop' });
  });

  it('knows the conversations tab of each role', () => {
    expect(chatTabOf(memberRoot(0, { home: [['Home', 'h']] }))).toBe('HomeTab');
    expect(
      chatTabOf({ key: 't', index: 0, routes: [{ name: 'ChatsTab', key: 'c' }, { name: 'SavedTab', key: 's' }] }),
    ).toBe('ChatsTab');
  });

  describe('rule 1: one chat per peer across the navigator', () => {
    it('returns to a chat already on top without popping', () => {
      const root = memberRoot(0, { home: [['Home', 'h'], ['Chat', 'c1', { peerId: PEER_A }]] });
      expect(resolveOpenChat(root, PEER_A, 'inApp')).toEqual({
        kind: 'popTo',
        tab: null,
        stackKey: 'home-stack',
        count: 0,
        removeSource: undefined,
      });
    });

    it('pops back to a chat covered by a profile in the same tab', () => {
      const root = memberRoot(0, {
        home: [['Home', 'h'], ['Chat', 'c1', { peerId: PEER_A }], ['ProviderDetail', 'pd', { providerId: PEER_A }]],
      });
      const plan = resolveOpenChat(root, PEER_A, 'fromSheet', 'pd');
      // The sheet is above the chat, so the pop removes it: no separate removal.
      expect(plan).toEqual({ kind: 'popTo', tab: null, stackKey: 'home-stack', count: 1, removeSource: undefined });
    });

    it('switches to the tab that holds the chat instead of mounting a second copy', () => {
      const root = memberRoot(1, {
        home: [['Home', 'h'], ['Chat', 'c1', { peerId: PEER_A }], ['ProviderDetail', 'pd']],
        favourites: [['Favourites', 'f']],
      });
      expect(resolveOpenChat(root, PEER_A, 'intent')).toEqual({
        kind: 'popTo',
        tab: 'HomeTab',
        stackKey: 'home-stack',
        count: 1,
        removeSource: undefined,
      });
    });

    it('removes the origin route when the pop does not already take it', () => {
      // A call in Favourites, the chat for that peer in Home.
      const root = memberRoot(1, {
        home: [['Home', 'h'], ['Chat', 'c1', { peerId: PEER_A }]],
        favourites: [['Favourites', 'f'], ['Call', 'call1', { peerId: PEER_A }]],
      });
      expect(resolveOpenChat(root, PEER_A, 'callEnd', 'call1')).toEqual({
        kind: 'popTo',
        tab: 'HomeTab',
        stackKey: 'home-stack',
        count: 0,
        removeSource: { source: 'call1', target: 'fav-stack' },
      });
    });

    it('call end with a profile between pops both, back to the same mounted chat', () => {
      const root = memberRoot(0, {
        home: [
          ['Home', 'h'],
          ['Chat', 'c1', { peerId: PEER_A }],
          ['ProviderDetail', 'pd', { providerId: PEER_A }],
          ['Call', 'call1', { peerId: PEER_A }],
        ],
      });
      expect(resolveOpenChat(root, PEER_A, 'callEnd', 'call1')).toEqual({
        kind: 'popTo',
        tab: null,
        stackKey: 'home-stack',
        count: 2,
        removeSource: undefined,
      });
    });

    it('looks in the focused tab first', () => {
      const root = memberRoot(1, {
        home: [['Home', 'h'], ['Chat', 'c1', { peerId: PEER_A }]],
        favourites: [['Favourites', 'f'], ['Chat', 'c2', { peerId: PEER_A }]],
      });
      const plan = resolveOpenChat(root, PEER_A, 'intent');
      expect(plan.kind === 'popTo' && plan.stackKey).toBe('fav-stack');
    });
  });

  describe('rule 2: an origin route is replaced by its chat', () => {
    it.each(['callEnd', 'requestAccept', 'suggestionAccept', 'fromSheet'] as const)(
      '%s replaces the source route in its own stack',
      origin => {
        const root = memberRoot(0, { home: [['Home', 'h'], ['Source', 'src']] });
        expect(resolveOpenChat(root, PEER_B, origin, 'src')).toEqual({
          kind: 'replace',
          source: 'src',
          target: 'home-stack',
          peerId: PEER_B,
        });
      },
    );

    it('a profile sheet opened over another tab root is replaced there', () => {
      const root = memberRoot(1, { favourites: [['Favourites', 'f'], ['ProviderDetail', 'pd']] });
      expect(resolveOpenChat(root, PEER_B, 'fromSheet', 'pd')).toEqual({
        kind: 'replace',
        source: 'pd',
        target: 'fav-stack',
        peerId: PEER_B,
      });
    });
  });

  describe('rule 3: an intent over another peer\'s chat replaces it in place', () => {
    it('replaces the focused chat (its prevent-remove asks when paid)', () => {
      const root = memberRoot(0, { home: [['Home', 'h'], ['Chat', 'c1', { peerId: PEER_A }]] });
      expect(resolveOpenChat(root, PEER_B, 'intent')).toEqual({
        kind: 'replace',
        source: 'c1',
        target: 'home-stack',
        peerId: PEER_B,
      });
    });

    it('an in-app open over a chat pushes instead', () => {
      const root = memberRoot(0, { home: [['Home', 'h'], ['Chat', 'c1', { peerId: PEER_A }]] });
      expect(resolveOpenChat(root, PEER_B, 'inApp').kind).toBe('push');
    });
  });

  describe('rule 4: push', () => {
    it('an intent from another tab switches to the conversations tab and pushes there', () => {
      const root = memberRoot(2, { home: [['Home', 'h']], you: [['You', 'y'], ['Usage', 'u']] });
      expect(resolveOpenChat(root, PEER_C, 'intent')).toEqual({
        kind: 'push',
        tab: 'HomeTab',
        target: 'home-stack',
        peerId: PEER_C,
      });
    });

    it('an intent into a conversations tab never visited creates its stack with the chat above its root', () => {
      const root = memberRoot(1, { favourites: [['Favourites', 'f']] });
      expect(resolveOpenChat(root, PEER_C, 'intent')).toEqual({
        kind: 'navigateNested',
        tab: 'HomeTab',
        peerId: PEER_C,
      });
    });

    it('an in-app open pushes into the focused stack, whatever tab it is', () => {
      const root = memberRoot(1, { home: [['Home', 'h']], favourites: [['Favourites', 'f']] });
      expect(resolveOpenChat(root, PEER_C, 'inApp')).toEqual({
        kind: 'push',
        tab: null,
        target: 'fav-stack',
        peerId: PEER_C,
      });
    });

    it('routes a provider intent to ChatsTab', () => {
      const root: StackLike = {
        key: 'tabs',
        index: 2,
        routes: [
          { name: 'ChatsTab', key: 'c', state: { key: 'chats-stack', index: 0, routes: [{ name: 'Chats', key: 'ch' }] } },
          { name: 'SavedTab', key: 's' },
          { name: 'YouTab', key: 'y', state: { key: 'you-stack', index: 0, routes: [{ name: 'You', key: 'yo' }] } },
        ],
      };
      expect(resolveOpenChat(root, PEER_C, 'intent')).toEqual({
        kind: 'push',
        tab: 'ChatsTab',
        target: 'chats-stack',
        peerId: PEER_C,
      });
    });
  });

  it('never reuses another peer\'s chat by name', () => {
    // A same-name navigate would match chat A for peer B; the planner matches by peer.
    const root = memberRoot(0, { home: [['Home', 'h'], ['Chat', 'c1', { peerId: PEER_A }], ['Usage', 'u']] });
    const plan = resolveOpenChat(root, PEER_B, 'inApp');
    expect(plan).toEqual({ kind: 'push', tab: null, target: 'home-stack', peerId: PEER_B });
  });
});

describe('locateRoute', () => {
  it('finds a route in any tab stack, and nothing in an unvisited tab', () => {
    const root = memberRoot(0, { home: [['Home', 'h'], ['Chat', 'c1']], favourites: [['Favourites', 'f']] });
    expect(locateRoute(root, 'c1')).toMatchObject({ index: 1, stack: { key: 'home-stack' } });
    expect(locateRoute(root, 'nope')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Imperative helpers, against a fake container
// ---------------------------------------------------------------------------

jest.mock('../src/lib/routes/navigationRef', () => {
  const fake = {
    root: undefined as unknown,
    dispatched: [] as unknown[],
    isReady: () => fake.root !== undefined,
    getRootState: () => fake.root,
    getCurrentRoute: () => undefined,
    dispatch: (action: unknown) => {
      fake.dispatched.push(action);
    },
  };
  return { navigationRef: fake };
});

const { navigationRef: fakeRef } = require('../src/lib/routes/navigationRef') as {
  navigationRef: { root: unknown; dispatched: unknown[] };
};
const actions = require('../src/lib/routes/actions') as typeof import('../src/lib/routes/actions');

describe('removeSelf', () => {
  beforeEach(() => {
    fakeRef.dispatched.length = 0;
  });

  it('removes a route that is NOT on top, by its own key and its stack key', () => {
    fakeRef.root = memberRoot(0, {
      home: [['Home', 'h'], ['ChatRequest', 'ring'], ['Call', 'call1']],
    });
    actions.removeSelf('ring', 'home-stack');
    expect(fakeRef.dispatched).toEqual([
      expect.objectContaining({ type: 'POP', payload: { count: 1 }, source: 'ring', target: 'home-stack' }),
    ]);
  });

  it('leaves a route that is already gone, or a stack root, alone', () => {
    fakeRef.root = memberRoot(0, { home: [['Home', 'h'], ['Chat', 'c1']] });
    actions.removeSelf('replaced-already', 'home-stack');
    actions.removeSelf('h', 'home-stack');
    actions.removeSelf('c1', 'some-other-stack');
    expect(fakeRef.dispatched).toEqual([]);
  });
});

describe('applyChatPlan', () => {
  beforeEach(() => {
    fakeRef.dispatched.length = 0;
    fakeRef.root = memberRoot(0, { home: [['Home', 'h']] });
  });

  it('targets every action at the stack it plans for', () => {
    actions.applyChatPlan({ kind: 'push', tab: null, target: 'home-stack', peerId: PEER_A });
    actions.applyChatPlan({ kind: 'replace', source: 'src', target: 'home-stack', peerId: PEER_B });
    actions.applyChatPlan({ kind: 'popTo', tab: null, stackKey: 'home-stack', count: 2 });
    expect(fakeRef.dispatched).toEqual([
      expect.objectContaining({ type: 'PUSH', payload: { name: 'Chat', params: { peerId: PEER_A } }, target: 'home-stack' }),
      expect.objectContaining({ type: 'REPLACE', source: 'src', target: 'home-stack' }),
      expect.objectContaining({ type: 'POP', payload: { count: 2 }, target: 'home-stack' }),
    ]);
  });

  it('switches tab first, then acts on that tab stack', () => {
    actions.applyChatPlan({ kind: 'push', tab: 'HomeTab', target: 'home-stack', peerId: PEER_A });
    expect(fakeRef.dispatched).toEqual([
      expect.objectContaining({ type: 'NAVIGATE', payload: { name: 'HomeTab' } }),
      expect.objectContaining({ type: 'PUSH', target: 'home-stack' }),
    ]);
  });

  it('asks a focused paid chat before a plan leaves its tab', () => {
    const { setFocusedChat } = require('../src/lib/routes/focusedChat') as typeof import('../src/lib/routes/focusedChat');
    let held: (() => void) | null = null;
    const release = setFocusedChat({ peerId: PEER_B, requestAway: proceed => { held = proceed; } });
    actions.applyChatPlan({ kind: 'push', tab: 'HomeTab', target: 'home-stack', peerId: PEER_A });
    expect(fakeRef.dispatched).toEqual([]);
    expect(held).not.toBeNull();
    (held as unknown as () => void)();
    expect(fakeRef.dispatched).toHaveLength(2);
    release();
  });
});
