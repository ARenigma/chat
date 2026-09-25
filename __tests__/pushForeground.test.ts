import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import type {
  MutateOptions,
  MutationFunctionContext,
  QueryClient,
} from '@tanstack/react-query';
import {
  foregroundPushAction,
  getRingingConversation,
  getViewingConversation,
  setRingingConversation,
  setViewingConversation,
} from '../src/lib/viewingConversation';

/**
 * Chat pushes while the app is open, and keeping this device's token alive.
 *
 * Two defects, one file. A chat push that arrived in the foreground showed
 * NOTHING, anywhere, because `onForegroundPush` handled only calls and nudges;
 * and the FCM token was uploaded once per boot, so a device whose row went
 * missing stayed silent until a cold start. The decision is asserted as a
 * value (`foregroundPushAction`), the wiring is driven end to end against
 * mocked Firebase / Supabase / native module, and the parts only a device can
 * run — the Kotlin — are held by source assertions.
 *
 * The foreground rule is Bluesky's (social-app useNotificationHandler.ts): a
 * chat the person is not looking at shows in the shade AND as a banner, with
 * no sound. On Android that is a channel of its own, not a per-post flag,
 * because NotificationCompat's setSilent also stops the peek; see
 * `CHANNEL_IN_APP` in Conversations.kt.
 */

const ROOT = join(__dirname, '..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

/**
 * Source with `//` and block comments removed, strings kept. Enough of a
 * scanner for the files it reads here: none of them holds a regex literal.
 */
function withoutComments(source: string): string {
  let out = '';
  let quote: string | null = null;
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (quote !== null) {
      if (c === '\\') {
        out += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (c === quote) {
        quote = null;
      }
      out += c;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (source.startsWith('//', i)) {
      const end = source.indexOf('\n', i);
      i = end === -1 ? source.length : end;
      continue;
    }
    if (source.startsWith('/*', i)) {
      const end = source.indexOf('*/', i + 2);
      i = end === -1 ? source.length : end + 2;
      continue;
    }
    out += c;
    i += 1;
  }
  if (quote !== null) {
    throw new Error('withoutComments ended inside a string literal');
  }
  return out;
}

/** The argument text of every `name(` call, parentheses balanced. */
function callArguments(source: string, name: string): string[] {
  const found: string[] = [];
  let at = source.indexOf(`${name}(`);
  while (at !== -1) {
    const open = at + name.length;
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === '(') {
        depth += 1;
      } else if (source[end] === ')') {
        depth -= 1;
        if (depth === 0) {
          break;
        }
      }
    }
    found.push(source.slice(open + 1, end));
    at = source.indexOf(`${name}(`, end);
  }
  return found;
}

const count = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

const A = 'aaaaaaaa-0000-4000-8000-00000000000a';
const B = 'bbbbbbbb-0000-4000-8000-00000000000b';
const PEER = 'cccccccc-0000-4000-8000-00000000000c';
const REQUEST = 'dddddddd-0000-4000-8000-00000000000d';
// Long enough to pass register_push_token's 32-character floor, and
// distinctive enough that a leak into any log line is unmistakable.
const TOKEN = 'fcm-TOKEN-must-never-be-logged-0123456789abcdef';

/* -------------------------------------------------------------------------- */
/* The decision                                                                */
/* -------------------------------------------------------------------------- */

describe('foregroundPushAction', () => {
  it('ignores anything that is not a conversation push', () => {
    expect(foregroundPushAction(null, null)).toBe('ignore');
    expect(foregroundPushAction(null, A)).toBe('ignore');
  });

  it('ignores the conversation on screen, which Realtime has already drawn', () => {
    expect(foregroundPushAction({ conversationId: A }, A)).toBe('ignore');
    // Unless a ring covers it: the chat under an opaque ring is not on screen,
    // so its message goes to the shade silently (Greptile P1 on 6c8e3b7).
    expect(foregroundPushAction({ conversationId: A }, A, true, B)).toBe('show-silent');
  });

  it('shows the in-app banner when no chat is on screen', () => {
    expect(foregroundPushAction({ conversationId: A }, null)).toBe('show-in-app');
  });

  it('shows the in-app banner when a DIFFERENT chat is on screen', () => {
    expect(foregroundPushAction({ conversationId: A }, B)).toBe('show-in-app');
  });

  it('alerts like the background handler when the app is not actually in use', () => {
    // RNFirebase still reports "foreground" for a moment after the screen
    // locks; a post with no sound there is a message nobody hears about.
    expect(foregroundPushAction({ conversationId: A }, null, false)).toBe('show');
    expect(foregroundPushAction({ conversationId: A }, B, false)).toBe('show');
  });

  it('posts a push for the conversation ringing in-app to the shade, silently', () => {
    // The member's first message and the ring are one event: the full-screen
    // ring is already telling it, and a banner over it opened the chat
    // underneath the ring. But dropping it left nothing in the shade once the
    // provider locked the phone or left mid-ring, so it is posted, silenced.
    expect(foregroundPushAction({ conversationId: A }, null, true, A)).toBe('show-silent');
  });

  it('posts it silently even when the chat under the ring is that same conversation', () => {
    // The ring is opaque: a provider still on A's thread when A's member sends
    // again gets the ring over it, and the chat counts as viewed while nobody
    // can see it. `ignore` here left no shade entry for a provider who left.
    expect(foregroundPushAction({ conversationId: A }, A, true, A)).toBe('show-silent');
  });

  it('silences everything while a ring is up, and nothing otherwise', () => {
    const outcomes = new Set<string>();
    for (const viewingId of [null, A, B]) {
      for (const inUse of [true, false]) {
        for (const ringingId of [null, A, B]) {
          const action = foregroundPushAction({ conversationId: A }, viewingId, inUse, ringingId);
          if (action === 'show-silent') {
            outcomes.add(`${String(viewingId)} ${String(inUse)} ${String(ringingId)}`);
          }
        }
      }
    }
    // In use and any ring up, whatever is on screen under the ring.
    expect([...outcomes].sort()).toEqual(
      [
        `${A} true ${A}`, `${B} true ${A}`, `null true ${A}`,
        `${A} true ${B}`, `${B} true ${B}`, `null true ${B}`,
      ].sort(),
    );
  });

  it('shows no banner over a ring, for any conversation, but still posts it', () => {
    // A banner peeking over the full-screen ring was the original complaint;
    // silent keeps the message in the shade without covering the ring.
    expect(foregroundPushAction({ conversationId: A }, null, true, B)).toBe('show-silent');
    expect(foregroundPushAction({ conversationId: A }, B, true, B)).toBe('show-silent');
    // A covered chat's own message is posted, not dropped as "on screen".
    expect(foregroundPushAction({ conversationId: A }, A, true, B)).toBe('show-silent');
  });

  it('still alerts for the ringing conversation when the phone is not in use', () => {
    expect(foregroundPushAction({ conversationId: A }, null, false, A)).toBe('show');
  });

  it('ignores a push sent before this device declined its request, and nothing after', () => {
    // The request's push crosses FCM while the ring crosses one socket, so it
    // can land after an in-app Decline with no ring up and no chat on screen:
    // a banner for a request already answered.
    const declined = 1_790_000_005_000;
    for (const [viewingId, inUse, ringingId] of [
      [null, true, null],
      [B, true, null],
      [null, false, null],
      [null, true, B],
    ] as const) {
      expect(
        foregroundPushAction({ conversationId: A, sentAt: declined - 4_000 }, viewingId, inUse, ringingId, declined),
      ).toBe('ignore');
      expect(
        foregroundPushAction({ conversationId: A, sentAt: declined }, viewingId, inUse, ringingId, declined),
      ).toBe('ignore');
    }
    // Sent after the Decline: an ordinary message, decided as ever.
    expect(
      foregroundPushAction({ conversationId: A, sentAt: declined + 1 }, null, true, null, declined),
    ).toBe('show-in-app');
    expect(
      foregroundPushAction({ conversationId: A, sentAt: declined + 1 }, null, false, null, declined),
    ).toBe('show');
    // No Decline recorded: the time plays no part.
    expect(foregroundPushAction({ conversationId: A, sentAt: declined - 4_000 }, null)).toBe('show-in-app');
  });
});

describe('the viewing-conversation signal', () => {
  afterEach(() => {
    setViewingConversation(null);
    setRingingConversation(null);
  });

  it('starts clear, holds what was set, and clears to null', () => {
    expect(getViewingConversation()).toBeNull();
    setViewingConversation(A);
    expect(getViewingConversation()).toBe(A);
    setViewingConversation(null);
    expect(getViewingConversation()).toBeNull();
  });

  it('keeps the ringing conversation as a signal of its own', () => {
    expect(getRingingConversation()).toBeNull();
    setRingingConversation(A);
    expect(getRingingConversation()).toBe(A);
    // Setting one never moves the other: the ring is not the chat.
    expect(getViewingConversation()).toBeNull();
    setRingingConversation(null);
    expect(getRingingConversation()).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* The wiring, driven                                                          */
/* -------------------------------------------------------------------------- */

type PushModule = typeof import('../src/lib/push');
type ViewingModule = typeof import('../src/lib/viewingConversation');
type RemoteListener = (remote: { data?: Record<string, string> }) => void;

interface Harness {
  push: PushModule;
  viewing: ViewingModule;
  native: {
    notify: jest.Mock;
    notifyChatRequest: jest.Mock;
    notifyCall: jest.Mock;
    notifyEngagement: jest.Mock;
    pushLog: jest.Mock;
    ensureChannel: jest.Mock;
  };
  /** Take the stored session off the device, as a sign-out's device half does. */
  signOutDevice: () => void;
  rpc: jest.Mock;
  getToken: jest.Mock;
  onMessage: jest.Mock;
  onTokenRefresh: jest.Mock;
  unsubscribeRefresh: jest.Mock;
  /** `PermissionsAndroid.request`, i.e. the permission dialog. */
  request: jest.Mock;
  /** AppState listeners currently installed, by anybody. */
  listenerCount: () => number;
  /** Fire an AppState change at every live listener. */
  appState: (next: 'active' | 'background') => void;
  setCurrentState: (next: 'active' | 'background') => void;
  setGranted: (granted: boolean) => void;
  /** Every line written to the PappalPush tag. */
  logs: () => string[];
  /** Who the app's client is signed in as, or null for signed out. */
  setSessionUser: (user: string | null) => void;
  /**
   * Server-side writes to push_tokens, in the order they happen:
   * `register` for every register_push_token the default RPC answers, and
   * `delete` for every row delete. A test that holds an RPC pushes its own.
   */
  events: string[];
}

jest.mock('@react-native-firebase/messaging', () => ({
  AuthorizationStatus: { AUTHORIZED: 1, PROVISIONAL: 2 },
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(),
  deleteToken: jest.fn(async () => undefined),
  onMessage: jest.fn(),
  onTokenRefresh: jest.fn(),
  requestPermission: jest.fn(async () => 1),
}));

jest.mock('../src/lib/supabase', () => ({
  supabase: {
    rpc: jest.fn(),
    from: jest.fn(() => ({
      delete: () => ({ eq: async () => ({ error: null }) }),
    })),
    auth: { getSession: jest.fn() },
  },
  SESSION_STORAGE_KEY: 'sb-test-auth-token',
}));

/*
 * MMKV, as a Map: react-native-mmkv ships ESM jest cannot load, and push.ts
 * reads the stored session from it (`signedInOnDevice`). `load()` starts every
 * test signed in; `signOutDevice` takes the stored session away.
 */
const mockDeviceStorage = new Map<string, string>();
const mockStorageModule = {
  storage: {
    get: (key: string) => mockDeviceStorage.get(key) ?? null,
    set: (key: string, value: string) => {
      mockDeviceStorage.set(key, value);
    },
    remove: (key: string) => {
      mockDeviceStorage.delete(key);
    },
  },
  supabaseStorage: {},
};
jest.mock('../src/lib/storage', () => mockStorageModule);
const STORED_SESSION_KEY = 'sb-test-auth-token';

/**
 * A fresh module graph per test: push.ts holds registration state at module
 * scope, and conversations.ts reads `NativeModules.Conversations` once, at
 * load — so the stub has to be in place before either is required.
 */
function load(): Harness {
  jest.resetModules();
  const rn = require('react-native') as typeof import('react-native');
  const messaging = require('@react-native-firebase/messaging') as {
    getToken: jest.Mock;
    onMessage: jest.Mock;
    onTokenRefresh: jest.Mock;
  };
  const { supabase } = require('../src/lib/supabase') as {
    supabase: { rpc: jest.Mock; auth: { getSession: jest.Mock } };
  };
  // The signed-in account `startPush` starts for (see `sessionUserId`).
  let sessionUser: string | null = 'user-a';
  supabase.auth.getSession.mockImplementation(async () => ({
    data: { session: sessionUser === null ? null : { user: { id: sessionUser } } },
    error: null,
  }));

  const native = {
    notify: jest.fn(async () => true),
    notifyChatRequest: jest.fn(async () => true),
    notifyCall: jest.fn(async () => true),
    notifyEngagement: jest.fn(async () => true),
    pushLog: jest.fn(),
    ensureChannel: jest.fn(async () => undefined),
  };
  (rn.NativeModules as Record<string, unknown>).Conversations = native;

  // The Android 13+ branch, which is the one with a permission to check.
  Object.defineProperty(rn.Platform, 'OS', { value: 'android', configurable: true });
  Object.defineProperty(rn.Platform, 'Version', { get: () => 34, configurable: true });
  let granted = true;
  jest.spyOn(rn.PermissionsAndroid, 'check').mockImplementation(async () => granted);
  jest
    .spyOn(rn.PermissionsAndroid, 'request')
    .mockImplementation(async () => (granted ? 'granted' : 'denied'));

  const listeners = new Set<(next: string) => void>();
  (rn.AppState.addEventListener as jest.Mock).mockImplementation(
    (_type: string, handler: (next: string) => void) => {
      listeners.add(handler);
      return { remove: () => listeners.delete(handler) };
    },
  );
  const setCurrentState = (next: 'active' | 'background') => {
    (rn.AppState as unknown as { currentState: string }).currentState = next;
  };
  setCurrentState('active');

  const unsubscribeRefresh = jest.fn();
  messaging.onTokenRefresh.mockImplementation(() => unsubscribeRefresh);
  messaging.getToken.mockImplementation(async () => TOKEN);
  const events: string[] = [];
  // A sign-out's row delete is unregister_push_token (migration 143); it is
  // recorded under the same name the table delete used to be.
  supabase.rpc.mockImplementation(async (name: string, args?: { p_token?: string }) => {
    if (name === 'unregister_push_token') {
      events.push(`delete push_tokens token=${args?.p_token === TOKEN ? 'TOKEN' : String(args?.p_token)}`);
      return { data: true, error: null };
    }
    events.push('register');
    return { error: null };
  });
  (supabase as unknown as { from: jest.Mock }).from.mockImplementation((table: string) => ({
    delete: () => ({
      eq: async (column: string, value: string) => {
        events.push(`delete ${table} ${column}=${value === TOKEN ? 'TOKEN' : value}`);
        return { error: null };
      },
    }),
  }));

  mockDeviceStorage.clear();
  mockDeviceStorage.set(STORED_SESSION_KEY, '{"access_token":"a","refresh_token":"r"}');

  const push = require('../src/lib/push') as PushModule;
  const viewing = require('../src/lib/viewingConversation') as ViewingModule;

  return {
    push,
    viewing,
    native,
    signOutDevice: () => {
      mockDeviceStorage.delete(STORED_SESSION_KEY);
    },
    rpc: supabase.rpc,
    getToken: messaging.getToken,
    onMessage: messaging.onMessage,
    onTokenRefresh: messaging.onTokenRefresh,
    unsubscribeRefresh,
    request: rn.PermissionsAndroid.request as jest.Mock,
    listenerCount: () => listeners.size,
    appState: next => {
      setCurrentState(next);
      for (const listener of [...listeners]) {
        listener(next);
      }
    },
    setCurrentState,
    setGranted: next => {
      granted = next;
    },
    logs: () => native.pushLog.mock.calls.map(call => String(call[1])),
    setSessionUser: user => {
      sessionUser = user;
    },
    events,
  };
}

const registerCalls = (h: Harness): number =>
  h.rpc.mock.calls.filter(call => call[0] === 'register_push_token').length;

describe('onForegroundPush', () => {
  function subscribe(h: Harness) {
    const handlers = { onCall: jest.fn(), onEngagement: jest.fn() };
    h.push.onForegroundPush(handlers);
    const listener = h.onMessage.mock.calls[0][1] as RemoteListener;
    return { handlers, deliver: (data: Record<string, string>) => listener({ data }) };
  }

  const message = (conversationId: string, extra: Record<string, string> = {}) => ({
    conversationId,
    peerId: PEER,
    senderName: 'Asha',
    sentAt: '1790000000000',
    kind: 'message',
    ...extra,
  });

  it('posts a message for another conversation on the in-app channel, with the background copy', () => {
    const h = load();
    const { deliver } = subscribe(h);
    h.viewing.setViewingConversation(B);
    deliver(message(A));
    expect(h.native.notify).toHaveBeenCalledTimes(1);
    const [conversationId, peerId, sender, body, sentAt, avatar, inApp] =
      h.native.notify.mock.calls[0];
    expect({ conversationId, peerId, sender, body, sentAt, avatar, inApp }).toEqual({
      conversationId: A,
      peerId: PEER,
      sender: 'Asha',
      body: 'wants to have a chat with you',
      sentAt: 1790000000000,
      avatar: '',
      inApp: true,
    });
    // A banner: in-app, and not silenced.
    expect(h.native.notify.mock.calls[0][7]).toBe(false);
    expect(h.logs()).toContain('foreground message: show-in-app');
  });

  it('posts a message in-app when no chat is on screen at all', () => {
    const h = load();
    const { deliver } = subscribe(h);
    deliver(message(A));
    expect(h.native.notify.mock.calls[0][6]).toBe(true);
  });

  it('posts nothing for the conversation on screen', () => {
    const h = load();
    const { deliver } = subscribe(h);
    h.viewing.setViewingConversation(A);
    deliver(message(A));
    expect(h.native.notify).not.toHaveBeenCalled();
    expect(h.native.notifyChatRequest).not.toHaveBeenCalled();
    expect(h.logs()).toContain('foreground message: ignore');
  });

  it('posts the ringing conversation and any other silently while the ring is up', () => {
    // Silently: in the shade (so a provider who leaves mid-ring still has it)
    // with no banner over the ring. Dropping it outright was the defect.
    const h = load();
    const { deliver } = subscribe(h);
    h.viewing.setRingingConversation(A);
    deliver(message(A));
    expect(h.native.notify).toHaveBeenCalledTimes(1);
    expect(h.native.notify.mock.calls[0][0]).toBe(A);
    expect(h.native.notify.mock.calls[0][6]).toBe(true);
    expect(h.native.notify.mock.calls[0][7]).toBe(true);
    expect(h.logs()).toContain('foreground message: show-silent');
    deliver(message(B));
    expect(h.native.notify).toHaveBeenCalledTimes(2);
    expect(h.native.notify.mock.calls[1][0]).toBe(B);
    expect(h.native.notify.mock.calls[1][6]).toBe(true);
    expect(h.native.notify.mock.calls[1][7]).toBe(true);
    // And the chat covered by the ring gets its message posted too.
    h.viewing.setViewingConversation(B);
    deliver(message(B));
    expect(h.native.notify).toHaveBeenCalledTimes(3);
    expect(h.native.notify.mock.calls[2][7]).toBe(true);
    // Once the ring leaves, the chat on screen is ignored again.
    h.viewing.setRingingConversation(null);
    deliver(message(B));
    expect(h.native.notify).toHaveBeenCalledTimes(3);
  });

  it('posts the ringing conversation silently when its own chat is under the ring', () => {
    const h = load();
    const { deliver } = subscribe(h);
    h.viewing.setViewingConversation(A);
    h.viewing.setRingingConversation(A);
    deliver(message(A, { kind: 'contact', requestId: REQUEST }));
    expect(h.native.notifyChatRequest).toHaveBeenCalledTimes(1);
    const call = h.native.notifyChatRequest.mock.calls[0];
    expect([call[0], call[6], call[7]]).toEqual([A, true, true]);
    expect(h.logs()).toContain('foreground contact: show-silent');
  });

  it('posts the ringing request itself silently, with its Accept and Decline', () => {
    const h = load();
    const { deliver } = subscribe(h);
    h.viewing.setRingingConversation(A);
    deliver(message(A, { kind: 'contact', requestId: REQUEST }));
    expect(h.native.notify).not.toHaveBeenCalled();
    expect(h.native.notifyChatRequest).toHaveBeenCalledTimes(1);
    const call = h.native.notifyChatRequest.mock.calls[0];
    expect([call[0], call[3], call[6], call[7]]).toEqual([A, REQUEST, true, true]);
    expect(h.logs()).toContain('foreground contact: show-silent');
  });

  it('routes a contact push to the Accept/Decline notification, in-app', () => {
    const h = load();
    const { deliver } = subscribe(h);
    deliver(message(A, { kind: 'contact', requestId: REQUEST }));
    expect(h.native.notify).not.toHaveBeenCalled();
    expect(h.native.notifyChatRequest).toHaveBeenCalledTimes(1);
    const call = h.native.notifyChatRequest.mock.calls[0];
    expect(call[0]).toBe(A);
    expect(call[3]).toBe(REQUEST);
    expect(call[6]).toBe(true);
    expect(call[7]).toBe(false);
  });

  it('posts nothing for a push that lands after this device declined its request', () => {
    const h = load();
    const { deliver } = subscribe(h);
    // sentAt in `message` is 1790000000000; the Decline landed two seconds on.
    h.viewing.recordDeclined(A, 1_790_000_002_000);
    deliver(message(A));
    expect(h.native.notify).not.toHaveBeenCalled();
    expect(h.logs()).toContain('foreground message: ignore');
    // Another conversation, and a later message for this one, still show.
    deliver(message(B));
    deliver(message(A, { sentAt: '1790000003000' }));
    expect(h.native.notify.mock.calls.map(call => call[0])).toEqual([B, A]);
    // Sign-out forgets it.
    h.viewing.resetViewingSignals();
    deliver(message(A));
    expect(h.native.notify).toHaveBeenCalledTimes(3);
  });

  it('alerts when the delivery lands while AppState is not active', () => {
    const h = load();
    const { deliver } = subscribe(h);
    h.setCurrentState('background');
    deliver(message(A));
    expect(h.native.notify.mock.calls[0][6]).toBe(false);
    expect(h.native.notify.mock.calls[0][7]).toBe(false);
  });

  it('still hands calls and nudges to the app, and draws neither', () => {
    const h = load();
    const { handlers, deliver } = subscribe(h);
    deliver({ kind: 'call', callId: 'call-1', peerId: PEER, conversationId: A });
    deliver({ kind: 'engagement', peerId: PEER, title: 'Someone is around' });
    expect(handlers.onCall).toHaveBeenCalledTimes(1);
    expect(handlers.onEngagement).toHaveBeenCalledTimes(1);
    expect(h.native.notify).not.toHaveBeenCalled();
  });

  it('ignores a payload that is not one of ours', () => {
    const h = load();
    const { deliver } = subscribe(h);
    deliver({ unrelated: 'x' });
    expect(h.native.notify).not.toHaveBeenCalled();
    expect(h.native.notifyChatRequest).not.toHaveBeenCalled();
  });

  it('leaves the background default alone: callers that pass nothing are not in-app', async () => {
    const h = load();
    const conversations = require('../src/lib/conversations') as typeof import('../src/lib/conversations');
    const push = conversations.readConversationPush(message(A));
    expect(push).not.toBeNull();
    await conversations.notifyConversation(push!, 'wants to have a chat with you');
    await conversations.notifyChatRequest({ ...push!, requestId: REQUEST });
    expect(h.native.notify.mock.calls[0][6]).toBe(false);
    expect(h.native.notifyChatRequest.mock.calls[0][6]).toBe(false);
    expect(h.native.notify.mock.calls[0][7]).toBe(false);
    expect(h.native.notifyChatRequest.mock.calls[0][7]).toBe(false);
  });
});

describe('a push for another account is not shown in this one (143)', () => {
  /*
   * The gate used to be "is anyone signed in". A sign-in no longer waits for
   * the previous account's server half, so while its row still delivered,
   * the old account's pushes passed the gate inside the new account's
   * session. The senders now name the row's owner (`recipientId`).
   */
  const USER_A = 'aaaaaaaa-1111-4000-8000-00000000000a';
  const USER_B = 'bbbbbbbb-1111-4000-8000-00000000000b';
  const signedInAs = (user: string) =>
    mockDeviceStorage.set(
      STORED_SESSION_KEY,
      JSON.stringify({ access_token: 'a', refresh_token: 'r', user: { id: user } }),
    );
  const base = { conversationId: A, peerId: PEER, senderName: 'Asha', sentAt: '1790000000000', kind: 'message' };
  const payloads: Array<[string, Record<string, string>, 'notify' | 'notifyChatRequest' | 'notifyCall' | 'notifyEngagement']> = [
    ['a message', base, 'notify'],
    ['a chat request', { ...base, kind: 'contact', requestId: REQUEST }, 'notifyChatRequest'],
    ['a call', { kind: 'call', callId: REQUEST, peerId: PEER, senderName: 'Asha', medium: 'voice' }, 'notifyCall'],
  ];

  it.each(payloads)('drops %s for the previous account in the background, and finishes its sign-out', async (_name, data, poster) => {
    const h = load();
    signedInAs(USER_B);
    const finish = jest.fn(async () => undefined);
    await h.push.handleBackgroundPush({ data: { ...data, recipientId: USER_A } }, finish);
    expect(h.native[poster]).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(h.logs()).toContain('background push: dropped, it is for another account');
  });

  it.each(payloads)('posts %s for the account signed in, in the background', async (_name, data, poster) => {
    const h = load();
    signedInAs(USER_B);
    const finish = jest.fn(async () => undefined);
    await h.push.handleBackgroundPush({ data: { ...data, recipientId: USER_B } }, finish);
    expect(h.native[poster]).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
  });

  it('drops the previous account\'s message and call in the foreground, and posts this account\'s', () => {
    const h = load();
    signedInAs(USER_B);
    const handlers = { onCall: jest.fn(), onEngagement: jest.fn() };
    h.push.onForegroundPush(handlers);
    const deliver = h.onMessage.mock.calls[0][1] as RemoteListener;
    deliver({ data: { ...base, recipientId: USER_A } });
    deliver({ data: { kind: 'call', callId: REQUEST, peerId: PEER, senderName: 'Asha', medium: 'voice', recipientId: USER_A } });
    expect(h.native.notify).not.toHaveBeenCalled();
    expect(handlers.onCall).not.toHaveBeenCalled();
    expect(h.logs()).toContain('foreground push: dropped, it is for another account');
    deliver({ data: { ...base, recipientId: USER_B } });
    expect(h.native.notify).toHaveBeenCalledTimes(1);
  });

  it('takes a push with no recipient, from a sender deployed before 143, as before', async () => {
    const h = load();
    signedInAs(USER_B);
    await h.push.handleBackgroundPush({ data: base }, jest.fn(async () => undefined));
    expect(h.native.notify).toHaveBeenCalledTimes(1);
  });

  it('puts the account on the notification\'s links, and App.tsx opens a link only for it', () => {
    const h = load();
    signedInAs(USER_B);
    const handlers = { onCall: jest.fn(), onEngagement: jest.fn() };
    h.push.onForegroundPush(handlers);
    const deliver = h.onMessage.mock.calls[0][1] as RemoteListener;
    deliver({ data: { ...base, recipientId: USER_B } });
    expect(h.native.notify.mock.calls[0][8]).toBe(USER_B);
    // A value that is not a uuid never reaches the native link builder.
    const { readConversationPush, readCallPush } = require('../src/lib/conversations') as typeof import('../src/lib/conversations');
    expect(readConversationPush({ ...base, recipientId: 'x&action=decline' })?.recipientId).toBeUndefined();
    expect(readCallPush({ kind: 'call', callId: REQUEST, peerId: PEER, recipientId: USER_A })?.recipientId).toBe(USER_A);

    const kotlin = withoutComments(read('android/app/src/main/java/com/companionchat/Conversations.kt'));
    expect(kotlin).toContain('.setData(withRecipient(Uri.parse("companionchat://peer/$peerId"), recipientId))');
    expect(kotlin).toContain('uri.buildUpon().appendQueryParameter("for", recipientId).build()');
    expect(count(kotlin, 'callActionIntent(context, peerId, callId, "answer", medium, recipientId)')).toBe(1);
    expect(count(kotlin, 'openConversation(context, peerId, recipientId)')).toBe(2);
    expect(count(kotlin, '.setIntent(peerIntent(context, peerId, recipientId))')).toBe(2);

    const app = withoutComments(read('App.tsx'));
    const consume = app.slice(
      app.indexOf('const consume = (url: string | null): void => {'),
      app.indexOf('void Linking.getInitialURL().then(consume);'),
    );
    const gate = consume.indexOf('if (isAccountLink(url) && !linkIsForAccount(url, storedAccountId())) {');
    expect(gate).toBeGreaterThan(-1);
    const gateEnd = consume.indexOf('return;', gate);
    for (const hold of ['setPendingV2Peer(', 'setPendingIncoming(', 'setPendingPeer(', 'endCall(']) {
      expect({ hold, after: consume.indexOf(hold) > gateEnd }).toEqual({ hold, after: true });
    }
  });

  it('send-push and send-call name the row\'s owner in every payload', () => {
    const sendPush = withoutComments(read('supabase/functions/send-push/index.ts'));
    expect(sendPush).toContain('recipientId: row.recipient_id,');
    const sendCall = withoutComments(read('supabase/functions/send-call/index.ts'));
    expect(sendCall).toContain('recipientId: row.recipient_id,');
    // The nudges too, from the account their tokens were chosen by.
    expect(withoutComments(read('supabase/functions/send-engagement/index.ts'))).toContain('recipientId: row.member_id,');
    const openAlert = withoutComments(read('supabase/functions/send-open-alert/index.ts'));
    expect(openAlert).toContain('recipientId,\n');
    expect(openAlert).toContain("directory?.avatar_url ?? null, openerId, peerId)");
  });
});

describe('a ring under a sheet or the media viewer is not on screen', () => {
  /*
   * Both are RN Modals, which Android draws as Dialog windows above the
   * activity's; the ring is a View in the activity's window. A ring that
   * started under an open photo was out of sight, and its own push was
   * silenced on the grounds that the ring showed it.
   */
  it('lets the push peek, with no sound, while a cover is up over a ring', () => {
    expect(foregroundPushAction({ conversationId: A }, null, true, A, null, true)).toBe('show-in-app');
    expect(foregroundPushAction({ conversationId: B }, null, true, A, null, true)).toBe('show-in-app');
    // Uncovered, the ring is what is on screen: silent, as before.
    expect(foregroundPushAction({ conversationId: A }, null, true, A, null, false)).toBe('show-silent');
  });

  it('reads the cover in the foreground handler', () => {
    const h = load();
    const handlers = { onCall: jest.fn(), onEngagement: jest.fn() };
    h.push.onForegroundPush(handlers);
    const deliver = h.onMessage.mock.calls[0][1] as RemoteListener;
    h.viewing.setRingingConversation(A);
    const uncover = h.viewing.coverViewing();
    deliver({ data: { conversationId: A, peerId: PEER, senderName: 'Asha', sentAt: '1790000000000', kind: 'message' } });
    uncover();
    expect(h.native.notify).toHaveBeenCalledTimes(1);
    // In-app, and not silenced: a heads-up over the Dialog.
    expect(h.native.notify.mock.calls[0][6]).toBe(true);
    expect(h.native.notify.mock.calls[0][7]).toBe(false);
    expect(h.logs()).toContain('foreground message: show-in-app');
  });
});

describe('what was posted is remembered for a Decline landing later', () => {
  it('records the sentAt of every post, in either handler, and nothing it ignored', async () => {
    const h = load();
    const handlers = { onCall: jest.fn(), onEngagement: jest.fn() };
    h.push.onForegroundPush(handlers);
    const deliver = h.onMessage.mock.calls[0][1] as RemoteListener;
    h.viewing.setViewingConversation(B);
    deliver({ data: { conversationId: B, peerId: PEER, senderName: 'Asha', sentAt: '1790000009000', kind: 'message' } });
    expect(h.viewing.postedSince(B, 1_790_000_000_000)).toBe(false);
    h.viewing.setRingingConversation(A);
    deliver({ data: { conversationId: A, peerId: PEER, senderName: 'Asha', sentAt: '1790000002000', kind: 'message' } });
    expect(h.viewing.postedSince(A, 1_790_000_000_000)).toBe(true);
    expect(h.viewing.postedSince(A, 1_790_000_002_000)).toBe(false);
    await h.push.handleBackgroundPush(
      { data: { conversationId: B, peerId: PEER, senderName: 'Asha', sentAt: '1790000005000', kind: 'message' } },
      jest.fn(async () => undefined),
    );
    expect(h.viewing.postedSince(B, 1_790_000_000_000)).toBe(true);
  });
});

describe('a sign-out\'s row delete deletes, and says when it did not (143)', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('deletes the row through unregister_push_token, never a DELETE on the table', async () => {
    const h = load();
    const { supabase } = require('../src/lib/supabase') as { supabase: { from: jest.Mock } };
    await expect(h.push.stopPush()).resolves.toBe(true);
    expect(h.rpc.mock.calls.filter(call => call[0] === 'unregister_push_token')).toEqual([
      ['unregister_push_token', { p_token: TOKEN }],
    ]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it('reports a teardown that stopped nothing: the row delete and the token delete both failed', async () => {
    const h = load();
    const messaging = require('@react-native-firebase/messaging') as { deleteToken: jest.Mock };
    messaging.deleteToken.mockImplementationOnce(async () => {
      throw new Error('SERVICE_NOT_AVAILABLE');
    });
    h.rpc.mockImplementation(async () => ({ data: null, error: { code: '', message: 'TypeError: Network request failed' } }));
    await expect(h.push.stopPush()).resolves.toBe(false);
  });

  it.each([
    ['the row went, though the token delete failed', true, false],
    ['the token went, though the row delete failed', false, true],
  ] as const)('counts it done when %s', async (_name, rowOk, tokenOk) => {
    const h = load();
    const messaging = require('@react-native-firebase/messaging') as { deleteToken: jest.Mock };
    if (!tokenOk) {
      messaging.deleteToken.mockImplementationOnce(async () => {
        throw new Error('SERVICE_NOT_AVAILABLE');
      });
    }
    if (!rowOk) {
      h.rpc.mockImplementation(async () => ({ data: null, error: { code: '', message: 'offline' } }));
    }
    await expect(h.push.stopPush()).resolves.toBe(true);
  });

  it('runs only the account half for a retry with somebody signed in: the row, never the listeners or the token', async () => {
    const h = load();
    await h.push.startPush();
    expect(h.listenerCount()).toBe(1);
    const messaging = require('@react-native-firebase/messaging') as { deleteToken: jest.Mock };
    messaging.deleteToken.mockClear();
    const ghost = {
      rpc: jest.fn(async () => ({ data: false, error: null })),
    };
    await expect(h.push.unregisterPush(Promise.resolve(ghost as never))).resolves.toBe(true);
    expect(ghost.rpc).toHaveBeenCalledWith('unregister_push_token', { p_token: TOKEN });
    expect(messaging.deleteToken).not.toHaveBeenCalled();
    expect(h.listenerCount()).toBe(1);
    // And a failed delete is reported, so the entry is kept.
    ghost.rpc.mockImplementation(async () => ({ data: null, error: { code: '', message: 'offline' } }) as never);
    await expect(h.push.unregisterPush(ghost as never)).resolves.toBe(false);
  });
});

describe('a device nobody is signed in on posts nothing, and finishes the sign-out instead', () => {
  /*
   * A sign-out drops the stored session at once and leaves the push row and
   * the FCM token to a server half that can fail on the network, and a
   * headless process never ran the boot retry. So pushes for the account that
   * left kept arriving, and both handlers posted them: the peer's name, a
   * MessagingStyle entry and a pushed shortcut on a signed-out phone.
   */
  const messageData = { conversationId: A, peerId: PEER, senderName: 'Asha', sentAt: '1790000000000', kind: 'message' };
  const contactData = { ...messageData, kind: 'contact', requestId: REQUEST };
  const payloads: Array<[string, Record<string, string>, keyof Harness['native']]> = [
    ['a message', messageData, 'notify'],
    ['a chat request', contactData, 'notifyChatRequest'],
    ['a call', { kind: 'call', callId: REQUEST, peerId: PEER, senderName: 'Asha', medium: 'voice' }, 'notifyCall'],
    ['a nudge', { kind: 'engagement', peerId: PEER, title: 'Asha is here' }, 'notifyEngagement'],
  ];
  const posters = ['notify', 'notifyChatRequest', 'notifyCall', 'notifyEngagement'] as const;

  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it.each(payloads)('posts %s in the background while a session is stored', async (_name, data, poster) => {
    const h = load();
    const finish = jest.fn(async () => undefined);
    await h.push.handleBackgroundPush({ data }, finish);
    expect(h.native[poster]).toHaveBeenCalledTimes(1);
    expect(finish).not.toHaveBeenCalled();
  });

  it.each(payloads)(
    'posts nothing for %s in the background once the stored session is gone, and retries the sign-out',
    async (_name, data) => {
      const h = load();
      h.signOutDevice();
      const finish = jest.fn(async () => undefined);
      await h.push.handleBackgroundPush({ data }, finish);
      for (const poster of posters) {
        expect({ poster, calls: h.native[poster].mock.calls.length }).toEqual({ poster, calls: 0 });
      }
      expect(finish).toHaveBeenCalledTimes(1);
      expect(h.logs()).toContain('background push: dropped, nobody is signed in on this device');
    },
  );

  it('waits for the retry, which the headless task lives for, and never rejects into FCM', async () => {
    const h = load();
    h.signOutDevice();
    let done = false;
    let release: () => void = () => undefined;
    const finish = jest.fn(
      () =>
        new Promise<void>(resolve => {
          release = () => {
            done = true;
            resolve();
          };
        }),
    );
    const handled = h.push.handleBackgroundPush({ data: messageData }, finish);
    let settled = false;
    void handled.then(() => {
      settled = true;
    });
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve();
    }
    expect(settled).toBe(false);
    release();
    await handled;
    expect(done).toBe(true);
    await expect(
      h.push.handleBackgroundPush({ data: messageData }, async () => {
        throw new Error('offline');
      }),
    ).resolves.toBeUndefined();
  });

  it('draws nothing in the foreground either once the stored session is gone', () => {
    const h = load();
    const handlers = { onCall: jest.fn(), onEngagement: jest.fn() };
    h.push.onForegroundPush(handlers);
    const listener = h.onMessage.mock.calls[0][1] as RemoteListener;
    h.signOutDevice();
    for (const [, data] of payloads) {
      listener({ data });
    }
    for (const poster of posters) {
      expect({ poster, calls: h.native[poster].mock.calls.length }).toEqual({ poster, calls: 0 });
    }
    expect(handlers.onCall).not.toHaveBeenCalled();
    expect(handlers.onEngagement).not.toHaveBeenCalled();
    expect(h.logs()).toContain('foreground push: dropped, nobody is signed in on this device');
  });

  it('drops a request push sent no later than a Decline this process holds, and posts what came after', async () => {
    // The provider declined in the app and pressed Home at once: the live
    // process is backgrounded, so the request's late push reaches this
    // handler, with the Decline still in memory.
    const h = load();
    const finish = jest.fn(async () => undefined);
    h.viewing.recordDeclined(A, 1_790_000_000_000);
    await h.push.handleBackgroundPush({ data: contactData }, finish);
    await h.push.handleBackgroundPush({ data: messageData }, finish);
    expect(h.native.notifyChatRequest).not.toHaveBeenCalled();
    expect(h.native.notify).not.toHaveBeenCalled();
    expect(h.logs()).toContain('background contact: dropped, sent before this device declined');
    await h.push.handleBackgroundPush({ data: { ...messageData, sentAt: '1790000000001' } }, finish);
    expect(h.native.notify).toHaveBeenCalledTimes(1);
    // Another conversation is not touched by A's Decline.
    await h.push.handleBackgroundPush({ data: { ...contactData, conversationId: B } }, finish);
    expect(h.native.notifyChatRequest).toHaveBeenCalledTimes(1);
  });

  it('asks the one predicate both handlers share', () => {
    const push = withoutComments(read('src/lib/push.ts'));
    const background = push.slice(
      push.indexOf('export async function handleBackgroundPush'),
      push.indexOf('export function onForegroundPush'),
    );
    expect(background).toContain('sentBeforeDecline(push, declinedAt(push.conversationId))');
    const viewing = withoutComments(read('src/lib/viewingConversation.ts'));
    const action = viewing.slice(viewing.indexOf('export function foregroundPushAction'));
    expect(action).toContain('if (sentBeforeDecline(push, declinedAtMs)) {');
  });
});

describe('token registration stays alive', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-09-25T10:00:00Z'));
    // `pushLog` mirrors warnings to the console in __DEV__, which jest is;
    // the lines are asserted through the native stub instead.
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('registers at start and logs the outcome without the token', async () => {
    const h = load();
    await h.push.startPush();
    expect(registerCalls(h)).toBe(1);
    expect(h.rpc).toHaveBeenCalledWith('register_push_token', {
      p_token: TOKEN,
      p_platform: 'android',
    });
    expect(h.logs()).toContain('register start: ok');
  });

  it('re-registers when the app comes back, once the return has settled', async () => {
    const h = load();
    await h.push.startPush();
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_MIN_INTERVAL_MS);
    h.appState('background');
    h.appState('active');
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_SETTLE_MS - 1);
    expect(registerCalls(h)).toBe(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(registerCalls(h)).toBe(2);
    expect(h.logs()).toContain('register active: ok');
  });

  it('does not fire on a flicker: a system sheet passing over the app', async () => {
    const h = load();
    await h.push.startPush();
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_MIN_INTERVAL_MS);
    for (let i = 0; i < 5; i += 1) {
      h.appState('background');
      h.appState('active');
      await jest.advanceTimersByTimeAsync(200);
    }
    h.appState('background');
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_SETTLE_MS * 2);
    expect(registerCalls(h)).toBe(1);
  });

  it('does not call the RPC on every app switch', async () => {
    const h = load();
    await h.push.startPush();
    h.appState('background');
    h.appState('active');
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_SETTLE_MS);
    expect(registerCalls(h)).toBe(1);
    expect(h.logs().some(line => line.startsWith('register active: skipped, last ok'))).toBe(
      true,
    );
  });

  it('recovers a boot whose registration failed on the very next return', async () => {
    const h = load();
    h.getToken.mockImplementationOnce(async () => {
      throw new Error('[messaging/unknown] java.io.IOException: SERVICE_NOT_AVAILABLE');
    });
    await h.push.startPush();
    expect(registerCalls(h)).toBe(0);
    expect(h.logs().some(line => line.includes('SERVICE_NOT_AVAILABLE'))).toBe(true);
    h.appState('background');
    h.appState('active');
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_SETTLE_MS);
    expect(registerCalls(h)).toBe(1);
  });

  it('registers on the way back from Settings once notifications are granted', async () => {
    const h = load();
    h.setGranted(false);
    await h.push.startPush();
    expect(registerCalls(h)).toBe(0);
    expect(h.logs()).toContain('register start: skipped, notifications not granted');
    h.appState('background');
    h.setGranted(true);
    h.appState('active');
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_SETTLE_MS);
    expect(registerCalls(h)).toBe(1);
  });

  it('never asks for the permission from the listener, only checks it', async () => {
    const h = load();
    await h.push.startPush();
    const rn = require('react-native') as typeof import('react-native');
    const requests = (rn.PermissionsAndroid.request as jest.Mock).mock.calls.length;
    h.setGranted(false);
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_MIN_INTERVAL_MS);
    h.appState('background');
    h.appState('active');
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_SETTLE_MS);
    expect((rn.PermissionsAndroid.request as jest.Mock).mock.calls.length).toBe(requests);
    expect(registerCalls(h)).toBe(1);
  });

  it('stops re-registering once the session ends, by unsubscribe or by stopPush', async () => {
    const h = load();
    const stop = await h.push.startPush();
    stop();
    expect(h.unsubscribeRefresh).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_MIN_INTERVAL_MS);
    h.appState('background');
    h.appState('active');
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_SETTLE_MS);
    expect(registerCalls(h)).toBe(1);

    await h.push.startPush();
    await h.push.stopPush();
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_MIN_INTERVAL_MS);
    h.appState('background');
    h.appState('active');
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_SETTLE_MS);
    expect(registerCalls(h)).toBe(2);
  });

  it('installs no listeners for a start that a sign-out overtook', async () => {
    const h = load();
    let release: () => void = () => undefined;
    h.getToken.mockImplementationOnce(
      () =>
        new Promise<string>(resolve => {
          release = () => resolve(TOKEN);
        }),
    );
    const starting = h.push.startPush();
    // Wait until the start is parked on FCM, past its own halt().
    for (let i = 0; i < 50 && h.getToken.mock.calls.length === 0; i += 1) {
      await Promise.resolve();
    }
    expect(h.getToken).toHaveBeenCalledTimes(1);
    await h.push.stopPush();
    release();
    await starting;
    expect(registerCalls(h)).toBe(0);
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_MIN_INTERVAL_MS);
    h.appState('background');
    h.appState('active');
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_SETTLE_MS);
    expect(registerCalls(h)).toBe(0);
  });

  /** Start, hold one of its waits, sign out, then let the wait finish. */
  async function signOutDuring(
    h: Harness,
    hold: (keep: (release: () => void) => void) => void,
    parked: () => boolean,
  ): Promise<void> {
    let release: () => void = () => undefined;
    hold(next => {
      release = next;
    });
    const starting = h.push.startPush();
    for (let i = 0; i < 50 && !parked(); i += 1) {
      await Promise.resolve();
    }
    expect(parked()).toBe(true);
    await h.push.stopPush();
    release();
    await starting;
  }

  /** Nothing registered, nothing listening, and a later return does nothing. */
  async function expectNothingLeft(h: Harness): Promise<void> {
    expect(registerCalls(h)).toBe(0);
    expect(h.onTokenRefresh).not.toHaveBeenCalled();
    expect(h.listenerCount()).toBe(0);
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_MIN_INTERVAL_MS);
    h.appState('background');
    h.appState('active');
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_SETTLE_MS);
    expect(registerCalls(h)).toBe(0);
  }

  it('neither registers nor listens when a sign-out lands during the permission dialog', async () => {
    // The generation used to be re-read inside register(), AFTER this wait, so
    // it adopted the sign-out's value and called the RPC anyway.
    const h = load();
    await signOutDuring(
      h,
      keep =>
        h.request.mockImplementationOnce(
          () =>
            new Promise<string>(resolve => {
              keep(() => resolve('granted'));
            }),
        ),
      () => h.request.mock.calls.length > 0,
    );
    // stopPush's own getToken, and no second one from a registration.
    expect(h.getToken).toHaveBeenCalledTimes(1);
    expect(h.logs()).toContain('register start: dropped, push stopped meanwhile');
    await expectNothingLeft(h);
  });

  it('asks nothing, registers nothing and listens to nothing when a sign-out lands while the channel is made', async () => {
    // halt() used to run after this wait, so it undid the sign-out outright.
    const h = load();
    await signOutDuring(
      h,
      keep =>
        h.native.ensureChannel.mockImplementationOnce(
          () =>
            new Promise<undefined>(resolve => {
              keep(() => resolve(undefined));
            }),
        ),
      () => h.native.ensureChannel.mock.calls.length > 0,
    );
    expect(h.request).not.toHaveBeenCalled();
    await expectNothingLeft(h);
  });

  /**
   * Hold the next register_push_token on the wire, the way the supabase query
   * builder does it: a thenable, not a promise, that sends a request each time
   * `then` is called on it.
   */
  function holdNextRegistration(h: Harness): { answer: () => void; thens: () => number } {
    let answer: () => void = () => undefined;
    let thens = 0;
    const reply = new Promise<{ error: null }>(resolve => {
      answer = () => {
        h.events.push('register answered');
        resolve({ error: null });
      };
    });
    h.rpc.mockImplementationOnce(() => {
      h.events.push('register sent');
      return {
        then: (onFulfilled: (value: { error: null }) => unknown, onRejected?: (err: unknown) => unknown) => {
          thens += 1;
          return reply.then(onFulfilled, onRejected);
        },
      };
    });
    return { answer: () => answer(), thens: () => thens };
  }

  /** Signed in, registered, and a later return to the app has an RPC out. */
  async function registrationOnTheWire(h: Harness) {
    await h.push.startPush();
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_MIN_INTERVAL_MS);
    const held = holdNextRegistration(h);
    h.appState('background');
    h.appState('active');
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_SETTLE_MS);
    expect(h.events).toEqual(['register', 'register sent']);
    return held;
  }

  const DELETE = 'delete push_tokens token=TOKEN';

  it('lets a registration already on the wire land before stopPush deletes the row', async () => {
    // The generation checks stop a registration from STARTING after a
    // sign-out; one already sent used to be answered after the delete and
    // recreate the row for the user who had just signed out.
    const h = load();
    const held = await registrationOnTheWire(h);
    const stopping = h.push.stopPush();
    await jest.advanceTimersByTimeAsync(h.push.STOP_DRAIN_MS - 1);
    expect(h.events).not.toContain(DELETE);
    held.answer();
    await stopping;
    expect(h.events).toEqual(['register', 'register sent', 'register answered', DELETE]);
    // One request per registration: the builder's `then` is called once.
    expect(held.thens()).toBe(1);
    // And nothing recreates it afterwards, on a return or otherwise.
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_MIN_INTERVAL_MS);
    h.appState('background');
    h.appState('active');
    await jest.advanceTimersByTimeAsync(h.push.ACTIVE_SETTLE_MS);
    expect(h.events[h.events.length - 1]).toBe(DELETE);
    expect(registerCalls(h)).toBe(2);
  });

  it('holds a sign-in that lands during a sign-out teardown until the teardown is done', async () => {
    // Sign-out shows the sign-in screen at once and tears push down behind
    // it. A quick re-sign-in used to register a row the old teardown then
    // deleted, and have its token revoked by that teardown's deleteToken.
    const h = load();
    const held = await registrationOnTheWire(h);
    const stopping = h.push.stopPush();
    const starting = h.push.startPush();
    await flush();
    const before = registerCalls(h);
    held.answer();
    await stopping;
    await starting;
    await flush();
    const deleteAt = h.events.indexOf(DELETE);
    expect(deleteAt).toBeGreaterThanOrEqual(0);
    // The new start registered, and only after the old row was deleted.
    expect(registerCalls(h)).toBe(before + 1);
    expect(h.events.lastIndexOf('register')).toBeGreaterThan(deleteAt);
  });

  it('holds a sign-in behind every teardown still running, not only the latest one', async () => {
    // Two pending sign-outs resumed at launch run two teardowns. `teardown`
    // used to be REPLACED by the second, so a start waited for the fast one
    // only, registered, and the slow one's deleteToken then revoked the new
    // account's token.
    const h = load();
    const messaging = require('@react-native-firebase/messaging') as { deleteToken: jest.Mock };
    messaging.deleteToken.mockImplementation(async () => {
      h.events.push('deleteToken');
    });
    const as = (name: string) =>
      ({
        rpc: async () => {
          h.events.push(`delete ${name}`);
          return { data: true, error: null };
        },
      }) as never;
    let authenticated: () => void = () => undefined;
    const slow = new Promise<void>(resolve => {
      authenticated = resolve;
    }).then(() => as('first'));
    const first = h.push.stopPush(slow);
    await h.push.stopPush(as('second'));
    h.setSessionUser('user-c');
    const starting = h.push.startPush();
    await flush();
    expect(registerCalls(h)).toBe(0);
    authenticated();
    await first;
    await starting;
    await flush();
    expect(h.events).toEqual(['delete second', 'deleteToken', 'delete first', 'deleteToken', 'register']);
  });

  /** Wait, microtask by microtask, until `condition` holds. */
  async function until(condition: () => boolean): Promise<void> {
    for (let i = 0; i < 200 && !condition(); i += 1) {
      await Promise.resolve();
    }
    expect(condition()).toBe(true);
  }

  /** Run every microtask a settled RPC sets off, without moving the clock. */
  async function flush(): Promise<void> {
    for (let i = 0; i < 200; i += 1) {
      await Promise.resolve();
    }
  }

  /** The onTokenRefresh handler the live `listen` installed. */
  function refreshHandler(h: Harness): (next: string) => void {
    const calls = h.onTokenRefresh.mock.calls;
    return calls[calls.length - 1][1] as (next: string) => void;
  }

  /** What FCM hands onTokenRefresh; any token will do, the RPC is held. */
  const FRESH = 'fcm-FRESH-rotated-by-onTokenRefresh-0123456789';

  type Held = ReturnType<typeof holdNextRegistration>;

  /**
   * A registration of each kind held on the wire, all three through the same
   * `register`. `settled` is whatever else waits on it: the start itself, for
   * a start.
   */
  const onTheWire: Record<
    'start' | 'refresh' | 'active',
    (h: Harness) => Promise<{ held: Held; settled: Promise<unknown> }>
  > = {
    start: async h => {
      const held = holdNextRegistration(h);
      const settled = h.push.startPush();
      await until(() => h.events.includes('register sent'));
      return { held, settled };
    },
    refresh: async h => {
      await h.push.startPush();
      const held = holdNextRegistration(h);
      refreshHandler(h)(FRESH);
      await until(() => h.events.includes('register sent'));
      return { held, settled: Promise.resolve() };
    },
    active: async h => ({ held: await registrationOnTheWire(h), settled: Promise.resolve() }),
  };

  it.each(['start', 'refresh', 'active'] as const)(
    'lets a %s registration already on the wire land before the delete',
    async reason => {
      const h = load();
      const { held, settled } = await onTheWire[reason](h);
      const stopping = h.push.stopPush();
      await jest.advanceTimersByTimeAsync(h.push.STOP_DRAIN_MS - 1);
      expect(h.events).not.toContain(DELETE);
      held.answer();
      await stopping;
      await settled;
      const answered = h.events.indexOf('register answered');
      expect(answered).toBeGreaterThan(-1);
      expect(h.events.indexOf(DELETE)).toBeGreaterThan(answered);
      expect(h.events[h.events.length - 1]).toBe(DELETE);
      // A start overtaken by the sign-out installs nothing either.
      expect(h.listenerCount()).toBe(0);
    },
  );

  it.each([
    ['the older one first', 'older'],
    ['the newer one first', 'newer'],
  ] as const)(
    'waits for every registration on the wire, not just one, answered %s',
    async (_order, first) => {
      // A return-to-app register and a token refresh can overlap. Waiting on
      // only the first or only the last of them lets the other land after the
      // delete, which is the defect the drain exists for.
      const h = load();
      const older = await registrationOnTheWire(h);
      const newer = holdNextRegistration(h);
      refreshHandler(h)(FRESH);
      await until(() => count(h.events.join('\n'), 'register sent') === 2);
      const stopping = h.push.stopPush();
      const [one, other] = first === 'older' ? [older, newer] : [newer, older];
      one.answer();
      await flush();
      expect(h.events).not.toContain(DELETE);
      other.answer();
      await stopping;
      expect(h.events).toEqual([
        'register',
        'register sent',
        'register sent',
        'register answered',
        'register answered',
        DELETE,
      ]);
    },
  );

  it('waits a bounded time for it, then deletes anyway and says so', async () => {
    const h = load();
    await registrationOnTheWire(h);
    const stopping = h.push.stopPush();
    await jest.advanceTimersByTimeAsync(h.push.STOP_DRAIN_MS - 1);
    expect(h.events).not.toContain(DELETE);
    await jest.advanceTimersByTimeAsync(1);
    await stopping;
    expect(h.events[h.events.length - 1]).toBe(DELETE);
    expect(h.logs()).toContain(
      `stop: a registration was still in flight after ${h.push.STOP_DRAIN_MS}ms, deleting anyway`,
    );
  });

  it('does not wait at all when nothing is on the wire', async () => {
    const h = load();
    await h.push.startPush();
    // No timer is advanced: a stopPush that waited here would never finish.
    await h.push.stopPush();
    expect(h.events).toEqual(['register', DELETE]);
    expect(h.logs().some(line => line.startsWith('stop:'))).toBe(false);
  });

  it('never writes the token to the log, even when the server echoes it', async () => {
    const h = load();
    h.rpc.mockImplementation(async () => ({
      error: { code: '22023', message: `not a token: ${TOKEN}` },
    }));
    await h.push.startPush();
    const logs = h.logs();
    expect(logs.some(line => line.startsWith('register start: failed, 22023'))).toBe(true);
    for (const line of logs) {
      expect(line).not.toContain(TOKEN);
    }
  });
});

describe('useViewingConversation', () => {
  /*
   * No renderer in this repo's dev dependencies, and one is not worth adding
   * for a single effect: `useEffect` is swapped for a recorder, so the effect
   * body and its cleanup run exactly as React would call them on mount and
   * unmount.
   */
  function mount() {
    jest.resetModules();
    const effects: Array<() => void | (() => void)> = [];
    jest.doMock('react', () => ({
      ...jest.requireActual('react'),
      useEffect: (effect: () => void | (() => void)) => {
        effects.push(effect);
      },
    }));
    const rn = require('react-native') as typeof import('react-native');
    const listeners = new Set<(next: string) => void>();
    (rn.AppState.addEventListener as jest.Mock).mockImplementation(
      (_type: string, handler: (next: string) => void) => {
        listeners.add(handler);
        return { remove: () => listeners.delete(handler) };
      },
    );
    (rn.AppState as unknown as { currentState: string }).currentState = 'active';
    // conversations.ts reads the module once, at load, so it goes in first.
    const clear = jest.fn(async (_conversationId: string) => undefined);
    (rn.NativeModules as Record<string, unknown>).Conversations = { clear };
    const viewing = require('../src/lib/viewingConversation') as ViewingModule;
    const screen = (conversationId: string | undefined) => {
      viewing.useViewingConversation(conversationId);
      const cleanup = effects[effects.length - 1]?.();
      return () => {
        if (typeof cleanup === 'function') {
          cleanup();
        }
      };
    };
    const appState = (next: 'active' | 'background') => {
      for (const listener of [...listeners]) {
        listener(next);
      }
    };
    return { viewing, screen, appState, listeners, clear };
  }

  afterEach(() => {
    jest.dontMock('react');
  });

  it('holds the conversation while mounted and active, and clears on unmount', () => {
    const { viewing, screen, listeners } = mount();
    const unmount = screen(A);
    expect(viewing.getViewingConversation()).toBe(A);
    unmount();
    expect(viewing.getViewingConversation()).toBeNull();
    expect(listeners.size).toBe(0);
  });

  it('lets go while the app is in the background, and takes it back on return', () => {
    const { viewing, screen, appState } = mount();
    screen(A);
    appState('background');
    expect(viewing.getViewingConversation()).toBeNull();
    appState('active');
    expect(viewing.getViewingConversation()).toBe(A);
  });

  it('claims nothing before the thread resolves', () => {
    const { viewing, screen, listeners, clear } = mount();
    screen(undefined);
    expect(viewing.getViewingConversation()).toBeNull();
    expect(listeners.size).toBe(0);
    expect(clear).not.toHaveBeenCalled();
  });

  it('takes the conversation out of the shade when it opens, and on every return to it', () => {
    // Otherwise each in-app foreground post for a chat later opened from Home
    // stays behind, and the next post grows that already-read transcript.
    const { screen, appState, clear } = mount();
    screen(A);
    expect(clear.mock.calls).toEqual([[A]]);
    appState('background');
    expect(clear).toHaveBeenCalledTimes(1);
    appState('active');
    expect(clear.mock.calls).toEqual([[A], [A]]);
  });

  it('clears only once the chat can be seen: not under a sheet, and on the sheet closing', () => {
    // Greptile P1 on d0a4f8d: a return with a sheet or the media viewer still
    // open cleared a notification for a message hidden behind it.
    const { viewing, screen, appState, clear } = mount();
    const unmount = screen(A);
    expect(clear.mock.calls).toEqual([[A]]);
    const sheet = viewing.coverViewing();
    appState('background');
    appState('active');
    expect(clear).toHaveBeenCalledTimes(1);
    sheet();
    expect(clear.mock.calls).toEqual([[A], [A]]);
    // After the chat is gone, lifting a cover clears nothing for it.
    unmount();
    viewing.coverViewing()();
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it('lets go of the conversation even when it leaves under a sheet', () => {
    const { viewing, screen } = mount();
    const unmount = screen(A);
    const sheet = viewing.coverViewing();
    unmount();
    sheet();
    // Nothing is left claiming A once the cover is gone.
    expect(viewing.getViewingConversation()).toBeNull();
  });

  it('leaves the shade alone while this conversation\'s ring covers the chat', () => {
    // The ring is opaque, so the chat under it is in use and unseen, and the
    // shade entry is the ring's out-of-app half. Clearing it on mount or on a
    // return threw away the entry `show-silent` exists to keep.
    const { viewing, screen, appState, clear } = mount();
    viewing.setRingingConversation(A);
    screen(A);
    expect(viewing.getViewingConversation()).toBe(A);
    appState('background');
    appState('active');
    expect(clear).not.toHaveBeenCalled();
    // Once the ring is gone, the next return clears it as usual.
    viewing.setRingingConversation(null);
    appState('background');
    appState('active');
    expect(clear.mock.calls).toEqual([[A]]);
  });

  it('leaves the shade alone while a ring for ANOTHER conversation covers the chat', () => {
    // The ring is opaque whatever it is for. Chat A under ring B is in use and
    // unseen, A's pushes go to the shade silently, and clearing A on mount, on
    // a return, or when a sheet over the ring lifted cancelled a message still
    // hidden behind it. ChatRingScreen clears A when the ring leaves.
    const { viewing, screen, appState, clear } = mount();
    viewing.setRingingConversation(B);
    screen(A);
    expect(viewing.getViewingConversation()).toBe(A);
    expect(
      viewing.foregroundPushAction({ conversationId: A }, A, true, viewing.getRingingConversation()),
    ).toBe('show-silent');
    appState('background');
    appState('active');
    expect(clear).not.toHaveBeenCalled();
    viewing.coverViewing()();
    expect(clear).not.toHaveBeenCalled();
    // Once the ring is gone, the next return clears it as usual.
    viewing.setRingingConversation(null);
    appState('background');
    appState('active');
    expect(clear.mock.calls).toEqual([[A]]);
  });

  it('leaves the shade alone while the chat is mounted but not in use', () => {
    // Cancelling a message the person has not seen loses it: a chat left open
    // under a locked screen is not a chat being read.
    const { screen, appState, clear } = mount();
    (require('react-native') as typeof import('react-native')).AppState.currentState =
      'background' as never;
    screen(A);
    appState('background');
    expect(clear).not.toHaveBeenCalled();
  });

  it('does not erase the arriving chat when the leaving one unmounts late', () => {
    const { viewing, screen } = mount();
    const leaveA = screen(A);
    screen(B);
    leaveA();
    expect(viewing.getViewingConversation()).toBe(B);
  });
});

/* -------------------------------------------------------------------------- */
/* Contract: the parts only a device can run                                   */
/* -------------------------------------------------------------------------- */

describe('the in-app flag reaches its own Android channel', () => {
  const kt = read('android/app/src/main/java/com/companionchat/Conversations.kt');
  const code = withoutComments(kt);
  const module = read('android/app/src/main/java/com/companionchat/ConversationsModule.kt');
  const bridge = withoutComments(read('src/lib/conversations.ts'));

  /** From `start` to the first `end` after it, comments removed. */
  function slice(start: string, end: string): string {
    const from = code.indexOf(start);
    const to = code.indexOf(end, from);
    expect({ start, found: from !== -1 && to > from }).toEqual({ start, found: true });
    return code.slice(from, to);
  }

  /** One NotificationChannelCompat builder chain, from its Builder to build(). */
  function channel(id: string): string {
    return slice(`.Builder(${id}, `, '.build()');
  }

  it('creates the in-app channel at HIGH, with no sound and no vibration', () => {
    // HIGH is what peeks on 26+ ("Urgent: Makes a sound and appears as a
    // heads-up notification"); the sound is the channel's, so it is nulled.
    expect(code).toContain('private const val CHANNEL_IN_APP = "conversations_in_app_v1"');
    const inApp = channel('CHANNEL_IN_APP');
    expect(inApp).toContain('NotificationManagerCompat.IMPORTANCE_HIGH)');
    expect(inApp).toContain('.setSound(null, null)');
    // The Compat builder's name for NotificationChannel#enableVibration(false).
    expect(inApp).toContain('.setVibrationEnabled(false)');
    expect(inApp).toContain('.setName(context.getString(R.string.channel_conversations_in_app))');
    // No group of its own, because Messages has none to share.
    expect(inApp).not.toContain('setGroup');
    expect(slice('fun ensureChannel(', '\n    }\n')).toContain('createNotificationChannel(inApp)');
    // Created with Messages at startup, so it is in Settings before its first
    // banner, and never swept up by the pre-_v2 migration.
    expect(slice('private fun migrateSilentChannels(', '\n    }\n')).not.toContain('in_app');
  });

  it('leaves Messages exactly as it was: HIGH, with the notification sound', () => {
    const messages = channel('CHANNEL_ID');
    expect(messages).toContain('NotificationManagerCompat.IMPORTANCE_HIGH)');
    expect(messages).toContain(
      '.setSound(Settings.System.DEFAULT_NOTIFICATION_URI, notificationAttributes())',
    );
  });

  it('names it for the system settings screen', () => {
    const strings = read('android/app/src/main/res/values/strings.xml');
    expect(strings).toContain(
      '<string name="channel_conversations_in_app">Messages while using the app</string>',
    );
    expect(strings).toContain('name="channel_conversations_in_app_desc"');
  });

  it('is chosen only for a foreground post, and yields to a turned-down Messages', () => {
    const route = slice('private fun route(', '\n    }\n');
    // Messages is read through this conversation's own channel under it, on
    // both paths, before anything else.
    expect(route).toMatch(
      /^[^]*?\{\s*val messages = manager\.getNotificationChannelCompat\(CHANNEL_ID, conversationId\)\s*if \(inApp\) \{/,
    );
    const inApp = route.slice(route.indexOf('if (inApp) {'), route.indexOf('val inAppChoice'));
    // The in-app channel only while Messages is still at the HIGH the app
    // created it with...
    expect(inApp).toContain(
      'if (messages == null || messages.importance >= NotificationManagerCompat.IMPORTANCE_HIGH) {\n                return Route(CHANNEL_IN_APP, quiet = false)',
    );
    // ...and below that the yield: Messages itself, quieted, so a person who
    // turned Messages down gets no banner and no sound while the app is open.
    expect(inApp).toMatch(/return Route\(CHANNEL_ID, quiet = true\)\s*\}\s*$/);
    // That yield, and the caller-asked silence of `silencedIf`: nowhere else is
    // a post quieted.
    expect(count(code, 'Route(CHANNEL_ID, quiet = true)')).toBe(1);
    expect(count(code, 'quiet = true')).toBe(2);
    // Declaration, channel builder, route's post and route's three lookups
    // (the in-app path's parent-off and conversation-off checks, the
    // background path's choice): nothing else names it, so no builder can
    // post on it except through `route`.
    expect(count(code, 'CHANNEL_IN_APP')).toBe(6);
    expect(count(code, 'Route(CHANNEL_IN_APP')).toBe(1);
  });

  it('carries a quieter choice made from an in-app banner to background posts', () => {
    // A conversation made Silent (or turned off) from a banner posted on the
    // in-app channel gets its conversation channel under THAT parent, which a
    // post on Messages never consults. So the background path reads it too.
    const route = slice('private fun route(', '\n    }\n');
    const background = route.slice(route.indexOf('val inAppChoice'));
    expect(background).toContain(
      'manager.getNotificationChannelCompat(CHANNEL_IN_APP, conversationId)\n            ?.takeIf { it.conversationId != null }',
    );
    // None made there: Messages decides, with its sound, as it always did.
    expect(background).toContain('?: return Route(CHANNEL_ID, quiet = false)');
    // Turned off: no post, and before Messages is asked anything (the next
    // test runs it). Below HIGH: Messages, quieted.
    const off = background.indexOf(
      'if (inAppChoice.importance == NotificationManagerCompat.IMPORTANCE_NONE) {\n            return null',
    );
    const messagesChoice = background.indexOf(
      'if (messages?.conversationId != null) {\n            return Route(CHANNEL_ID, quiet = false)',
    );
    expect(off).toBeGreaterThan(-1);
    expect(messagesChoice).toBeGreaterThan(off);
    expect(background).toContain(
      'quiet = inAppChoice.importance < NotificationManagerCompat.IMPORTANCE_HIGH,',
    );
    expect(route).toContain('): Route? {');
  });

  /**
   * The shipped body of `route`, run. Its Kotlin is close enough to JS that
   * four rewrites make it one: `val`, `takeIf`'s lambda, the named `quiet =`
   * argument, and the elvis `?: return X`, which becomes a throw the wrapper
   * turns back into the return. Anything else the body grows is a
   * SyntaxError here, which is the point: this runs the code that ships, not
   * a copy of it.
   *
   * The manager stands in for NotificationManagerCompat with the one rule the
   * whole function is about: `getNotificationChannelCompat(parent, id)`
   * returns the conversation channel under THAT parent, and "If a
   * conversation channel with the given conversation id is not found, this
   * method will instead return the parent channel".
   * https://developer.android.com/reference/android/app/NotificationManager#getNotificationChannel(java.lang.String,%20java.lang.String)
   */
  type Channel = { importance: number; conversationId: string | null };
  type Routed = { channelId: string; quiet: boolean } | null;
  const IMPORTANCE = { NONE: 0, MIN: 1, LOW: 2, DEFAULT: 3, HIGH: 4 };
  /** The elvis `?: return X`, carried out of the expression it sits in. */
  class Returned {
    constructor(readonly value: Routed) {}
  }

  function runRoute(
    conversations: { messages?: number; inApp?: number },
    inApp: boolean,
    parents: { messages?: number; inApp?: number } = {},
  ): Routed {
    const route = slice('private fun route(', '\n    }\n');
    const body = route
      .slice(route.indexOf('): Route? {') + '): Route? {'.length)
      .replace(/\bval /g, 'const ')
      .replace(/\?\.takeIf \{ ([^}]*) \}/g, '?.takeIf((it) => $1)')
      .replace(/\?: return ([^\n]+)/g, '?? __return($1)')
      .replace(/\bquiet = /g, '');
    const standIn = (importance: number, conversationId: string | null) => ({
      importance,
      conversationId,
      takeIf(predicate: (it: Channel) => boolean) {
        return predicate(this) ? this : null;
      },
    });
    const own = { CHANNEL_ID: conversations.messages, CHANNEL_IN_APP: conversations.inApp };
    const parent = {
      CHANNEL_ID: parents.messages ?? IMPORTANCE.HIGH,
      CHANNEL_IN_APP: parents.inApp ?? IMPORTANCE.HIGH,
    };
    const manager = {
      getNotificationChannelCompat(id: 'CHANNEL_ID' | 'CHANNEL_IN_APP', conversationId?: string) {
        // The one-argument overload reads the parent itself, whatever
        // conversation channels sit under it.
        if (conversationId === undefined) {
          return standIn(parent[id], null);
        }
        const mine = own[id];
        return mine === undefined ? standIn(parent[id], null) : standIn(mine, conversationId);
      },
    };
    const fn = runInNewContext(
      '(function (manager, conversationId, inApp, Route, CHANNEL_ID, CHANNEL_IN_APP, ' +
        `NotificationManagerCompat, __return) {${body}\n})`,
    ) as (...args: unknown[]) => Routed;
    try {
      return fn(
        manager, 'c-1', inApp,
        (channelId: string, quiet: boolean) => ({ channelId, quiet }),
        'CHANNEL_ID', 'CHANNEL_IN_APP',
        {
          IMPORTANCE_NONE: IMPORTANCE.NONE,
          IMPORTANCE_LOW: IMPORTANCE.LOW,
          IMPORTANCE_DEFAULT: IMPORTANCE.DEFAULT,
          IMPORTANCE_HIGH: IMPORTANCE.HIGH,
        },
        (value: Routed) => {
          throw new Returned(value);
        },
      );
    } catch (thrown) {
      if (thrown instanceof Returned) {
        return thrown.value;
      }
      throw thrown;
    }
  }

  const messagesLoud = { channelId: 'CHANNEL_ID', quiet: false };
  const messagesQuiet = { channelId: 'CHANNEL_ID', quiet: true };

  it.each<[string, { messages?: number; inApp?: number }, Routed]>([
    // Greptile P1 on bb32af4: made Priority or Silent from a background post,
    // then turned off from an in-app banner. Off wins, whatever Messages holds.
    ['off in-app, Priority on Messages', { inApp: IMPORTANCE.NONE, messages: IMPORTANCE.HIGH }, null],
    ['off in-app, Silent on Messages', { inApp: IMPORTANCE.NONE, messages: IMPORTANCE.LOW }, null],
    ['off in-app, nothing on Messages', { inApp: IMPORTANCE.NONE }, null],
    // Quieter from a banner quiets the background post, unless Messages has
    // its own choice for the conversation, which the system applies.
    ['Silent in-app, nothing on Messages', { inApp: IMPORTANCE.LOW }, messagesQuiet],
    ['Silent in-app, Priority on Messages', { inApp: IMPORTANCE.LOW, messages: IMPORTANCE.HIGH }, messagesLoud],
    ['Priority in-app', { inApp: IMPORTANCE.HIGH }, messagesLoud],
    ['no choice anywhere', {}, messagesLoud],
    // Messages' own conversation channel off: posted on it, and the system
    // drops it, as it does for every choice made on the channel posted on.
    ['nothing in-app, off on Messages', { messages: IMPORTANCE.NONE }, messagesLoud],
  ])('routes a background post with %s', (_name, conversations, expected) => {
    expect(runRoute(conversations, false)).toEqual(expected);
  });

  it('reads the in-app PARENT turned down as a choice about banners, not about this conversation', () => {
    // No conversation channel under it, so the lookup returns the parent
    // (conversationId null), and a background post keeps Messages' sound.
    expect(runRoute({}, false, { inApp: IMPORTANCE.NONE })).toEqual(messagesLoud);
  });

  it.each<[string, { messages?: number; inApp?: number }, { messages?: number; inApp?: number }, Routed]>([
    ['no choice anywhere', {}, {}, { channelId: 'CHANNEL_IN_APP', quiet: false }],
    ['the conversation turned off on Messages', { messages: IMPORTANCE.NONE }, {}, messagesQuiet],
    ['the conversation made Silent on Messages', { messages: IMPORTANCE.LOW }, {}, messagesQuiet],
    ['Messages itself turned down', {}, { messages: IMPORTANCE.DEFAULT }, messagesQuiet],
    // Turned off from an in-app banner is off on this path too. The yield
    // below HIGH moved the post to Messages, whose lookup never sees the
    // in-app conversation channel, and it came back quietly in the shade.
    ['the conversation turned off in-app, Messages turned down', { inApp: IMPORTANCE.NONE }, { messages: IMPORTANCE.DEFAULT }, null],
    ['the conversation turned off in-app and made Silent on Messages', { inApp: IMPORTANCE.NONE, messages: IMPORTANCE.LOW }, {}, null],
    ['the conversation turned off in-app, Messages at HIGH', { inApp: IMPORTANCE.NONE }, {}, null],
    // "Messages while using the app" switched off: the yield to a turned-down
    // Messages must not carry the post past the channel the person turned off.
    ['the in-app parent off, Messages turned down', {}, { messages: IMPORTANCE.DEFAULT, inApp: IMPORTANCE.NONE }, null],
    ['the in-app parent off, Messages at HIGH', {}, { inApp: IMPORTANCE.NONE }, null],
    ['the in-app parent off, the conversation Priority in-app', { inApp: IMPORTANCE.HIGH }, { messages: IMPORTANCE.DEFAULT, inApp: IMPORTANCE.NONE }, null],
    // Silent from a banner stays the system's to apply on the in-app parent.
    ['the conversation made Silent in-app', { inApp: IMPORTANCE.LOW }, {}, { channelId: 'CHANNEL_IN_APP', quiet: false }],
  ])('routes an in-app post with %s', (_name, conversations, parents, expected) => {
    expect(runRoute(conversations, true, parents)).toEqual(expected);
  });

  /** One builder's body, comments removed: from its `fun` to the next declaration. */
  function builder(start: string, end: string): string {
    return slice(start, end);
  }

  const builders: Array<[string, string]> = [
    // notify() ends where the helper it reads the live notification with begins.
    ['    fun notify(\n', '    private fun activeNotification('],
    ['    fun notifyChatRequest(\n', '    private fun callActionIntent('],
  ];

  it.each(builders)('posts on the routed channel, with no sound of its own in-app, in %j', (start, end) => {
    const body = builder(start, end);
    expect(body).toContain('inApp: Boolean = false,');
    expect(body).toContain('silent: Boolean = false,');
    // A null route is the person having turned the conversation off: no post.
    expect(count(body, 'val route = route(manager, conversationId, inApp)?.silencedIf(silent) ?: return')).toBe(1);
    // Every post, text or fill, names the route it was handed and nothing
    // else: the builder never reaches for the closure's `route` itself.
    expect(count(body, 'NotificationCompat.Builder(context, via.channelId)')).toBe(1);
    expect(body).not.toContain('route.channelId');
    // The route's quiet flag reaches the builder, or the yield is only a
    // channel choice and a turned-down Messages still sounds in the app.
    expect(count(body, '.setSilent(via.quiet)')).toBe(1);
    expect(body).not.toContain('route.quiet');
    expect(body).not.toContain('NotificationCompat.Builder(context, CHANNEL_ID)');
    // Below 26 the channel is ignored and the defaults ARE the alert: none
    // for an in-app post, sound and vibration for a background one.
    expect(body).toContain(
      'if (inApp) 0 else NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE',
    );
    // The flag touches the route and the defaults, and nothing else; silent
    // touches only the route, through `silencedIf`.
    expect(body.match(/\binApp\b/g)).toEqual(['inApp', 'inApp', 'inApp']);
    expect(body.match(/\bsilent\b/g)).toEqual(['silent', 'silent']);
  });

  it.each(builders)(
    'extends the live transcript whichever channel posted last, in %j',
    (start, end) => {
      const body = builder(start, end);
      // The text post: the transcript on screen is read back BEFORE the new
      // line is added, then that same style is posted.
      const readBack = body.indexOf('val style = activeMessagingStyle(manager, id)');
      const add = body.indexOf('style.addMessage(', readBack);
      const post = body.indexOf('post(style, null, route)', add);
      expect(readBack).toBeGreaterThan(-1);
      expect(add).toBeGreaterThan(readBack);
      expect(post).toBeGreaterThan(add);
      // The photo fill re-reads what is live at that moment, never the copy
      // captured above, and is the only post that is an update.
      const live = body.indexOf('val live = activeNotification(manager, id) ?: return@execute');
      expect(live).toBeGreaterThan(post);
      const style = body.indexOf('.extractMessagingStyleFromNotification(live)', live);
      expect(style).toBeGreaterThan(live);
      expect(body.indexOf('post(withSenderIcon(style, peerId, icon), icon, liveRoute(live, route), photoFill = true)')).toBeGreaterThan(style);
      expect(count(body, 'photoFill = true')).toBe(1);
      expect(count(body, '.setOnlyAlertOnce(photoFill)')).toBe(1);
    },
  );

  it.each(builders)(
    'fills the photo in on the channel the live notification is on, not the one its own post used, in %j',
    (start, end) => {
      /*
       * A newer post can move the notification between Messages and the
       * in-app channel while an older post's photo is downloading. The fill
       * re-posted it on the older post's route, moving it back. So the fill
       * reads the route off the live notification (`liveRoute`), and only the
       * text post uses the route it computed.
       */
      const body = builder(start, end);
      const fill = body.slice(body.indexOf('avatarExecutor.execute {'));
      expect(fill).toContain('liveRoute(live, route), photoFill = true)');
      // No post in the fill names a route that is not the live one.
      expect(fill).not.toMatch(/icon, (route|via), photoFill/);
      expect(count(body, 'liveRoute(')).toBe(1);
      expect(count(body, 'post(style, null, route)')).toBe(1);
    },
  );

  it('reads the live route off the notification itself: its channel and its silent group', () => {
    /*
     * The whole body, whitespace aside, and not a line at a time: a line check
     * still passes with an early `return posted` in front of them, which is
     * the original defect (the fill's own route) back again. No Kotlin unit
     * tests exist in this repo, so the source is what there is to hold.
     *
     * Below O there is no channel to read, and the fill's own route stands.
     * setSilent files an ungrouped post under GROUP_KEY_SILENT on O and up,
     * and no builder here sets a group, so the group IS the quiet flag.
     */
    const live = slice('private fun liveRoute(', '\n    }\n').replace(/\s+/g, ' ').trim();
    expect(live).toBe(
      [
        'private fun liveRoute(live: Notification, posted: Route): Route {',
        'val channelId = NotificationCompat.getChannelId(live) ?: return posted',
        'return Route(',
        'channelId,',
        'quiet = NotificationCompat.getGroup(live) == NotificationCompat.GROUP_KEY_SILENT,',
        ')',
      ].join(' '),
    );
    expect(count(live, 'return')).toBe(2);
    expect(code).not.toMatch(/\.setGroup\(/);
    expect(count(code, 'liveRoute(live, route)')).toBe(2);
  });

  it.each(builders)(
    'reads and posts under one lock, text post and fill alike, and skips a fill whose notification is gone, in %j',
    (start, end) => {
      // Otherwise a fill that read the live notification can post over a newer
      // message, or bring back a notification `clear` cancelled meanwhile.
      // ChatRequestReceiver's Decline goes through `clear`, so it holds the
      // lock too; only a tap or swipe in the shade takes none (see `postLock`).
      const body = builder(start, end);
      expect(body).toMatch(
        /synchronized\(postLock\) \{\s*val style = activeMessagingStyle\(manager, id\)/,
      );
      expect(body).toMatch(
        /synchronized\(postLock\) \{\s*if \(!stillCurrentLocked\(id, version\)\) return@execute\s*val live = activeNotification\(manager, id\) \?: return@execute/,
      );
      expect(count(body, 'synchronized(postLock)')).toBe(2);
      // The download is outside it: the lock never waits on the network.
      const download = body.indexOf('loadAvatarBitmap(');
      expect(download).toBeGreaterThan(-1);
      expect(download).toBeLessThan(body.lastIndexOf('synchronized(postLock)'));
    },
  );

  it('cancels under the same lock and drops the post stamp with it, since the lock alone cannot stop a fill', () => {
    /*
     * NotificationManager's cancel is applied later, on the system's handler,
     * and getActiveNotifications keeps listing the record until it is: a fill
     * that took the lock straight after the cancel found the notification
     * "live" and posted it back. The lock was said to prevent that and did
     * not. So the id's stamp goes in the same hold, and the fill checks it.
     */
    const clear = slice('fun clear(context: Context, conversationId: String) {', '\n    }\n');
    expect(clear).toMatch(
      /synchronized\(postLock\) \{\s*cancelLocked\(NotificationManagerCompat\.from\(context\), notificationId\(conversationId\)\)\s*\}/,
    );
    expect(slice('private fun cancelLocked(', '\n    }\n')).toMatch(
      /\{\s*manager\.cancel\(id\)\s*posted\.remove\(id\)\s*requestPosts\.remove\(id\)\s*cleared\.add\(id\)\s*$/,
    );
    // The stamp a post leaves, and the two readings of it.
    expect(slice('private fun stampPostLocked(id: Int): Long {', '\n    }\n').replace(/\s+/g, ' ')).toBe(
      'private fun stampPostLocked(id: Int): Long { postVersion += 1 posted[id] = postVersion cleared.remove(id) return postVersion',
    );
    expect(code).toContain('private fun stillCurrentLocked(id: Int, version: Long): Boolean = posted[id] == version');
    expect(code).toContain(
      'private fun liveTrustedLocked(id: Int): Boolean =\n        id !in cleared && (!clearedAll || posted.containsKey(id))',
    );
    // A text post after a clear does not extend what the system still lists.
    expect(slice('private fun activeMessagingStyle(', '\n\n')).toContain('?.takeIf { liveTrustedLocked(id) }');
  });

  it.each(builders)('stamps every text post in the same hold as its post, and hands the stamp to its fill, in %j', (start, end) => {
    const body = builder(start, end);
    // A chat request's post records which request it was as well (`clearRequest`).
    expect(body).toMatch(
      /val version = synchronized\(postLock\) \{[^]*?post\(style, null, route\)\s*stampPostLocked\(id\)(\.also \{ requestPosts\[id\] = RequestPost\(requestId, it\) \})?\s*\}/,
    );
    expect(count(body, 'stampPostLocked(id)')).toBe(1);
    expect(count(body, 'stillCurrentLocked(id, version)')).toBe(1);
  });

  it('clears a declined request only while the request is what is posted there', () => {
    /*
     * A request and a message for one conversation share its notification
     * id, and the lock-screen Decline's clear lands a cold start and a round
     * trip after the press. A message posted in that window replaced the
     * request's entry and alerted, and the old unconditional clear cancelled
     * it. The whole body, whitespace aside, as for liveRoute: a line check
     * still passes with the version comparison dropped.
     */
    const clearRequest = slice(
      'fun clearRequest(context: Context, conversationId: String, requestId: String) {',
      '\n    }\n',
    ).replace(/\s+/g, ' ').trim();
    expect(clearRequest).toBe(
      [
        'fun clearRequest(context: Context, conversationId: String, requestId: String) {',
        'synchronized(postLock) {',
        'val manager = NotificationManagerCompat.from(context)',
        'val id = notificationId(conversationId)',
        'val stillTheRequest = if (posted.containsKey(id)) {',
        'requestPosts[id] == RequestPost(requestId, posted.getValue(id))',
        '} else {',
        'liveTrustedLocked(id) &&',
        'activeNotification(manager, id)?.extras?.getString(EXTRA_REQUEST_ID) == requestId',
        '}',
        'if (stillTheRequest) {',
        'cancelLocked(manager, id)',
        '}',
        '}',
      ].join(' '),
    );
    // Recorded by the request's own post, and only there, at the version that
    // post stamped; a message post over it stamps a newer one.
    expect(count(code, 'requestPosts[id] = RequestPost(requestId, it)')).toBe(1);
    const request = builder('    fun notifyChatRequest(\n', '    private fun callActionIntent(');
    expect(request).toContain('stampPostLocked(id).also { requestPosts[id] = RequestPost(requestId, it) }');
    // The extra a process that did not post it reads, set on every post of it.
    expect(count(request, '.addExtras(android.os.Bundle().apply { putString(EXTRA_REQUEST_ID, requestId) })')).toBe(1);
    // Declared, set and read: nothing else in this file names its own extra
    // (the Decline intent's is ChatRequestReceiver's).
    expect(code.match(/(?<![.\w])EXTRA_REQUEST_ID\b/g)).toHaveLength(3);
    // Bridged, and the lock-screen Decline is its only caller.
    expect(module).toMatch(
      /fun clearRequest\(conversationId: String, requestId: String, promise: Promise\) \{\s*Conversations\.clearRequest\(reactContext, conversationId, requestId\)\s*promise\.resolve\(null\)/,
    );
    expect(bridge).toMatch(/await native\.clearRequest\(conversationId, requestId\);/);
    expect(withoutComments(read('src/lib/chatRequestDecline.ts'))).toContain(
      'await clearChatRequest(conversationId, requestId);',
    );
  });

  it('stamps an engagement nudge too, so its photo cannot bring it back after a clear-all', () => {
    const nudge = slice('    fun notifyEngagement(\n', '    fun notifyCall(\n');
    expect(nudge).toMatch(/val version = synchronized\(postLock\) \{\s*post\(null\)\s*stampPostLocked\(id\)\s*\}/);
    expect(nudge).toMatch(/synchronized\(postLock\) \{\s*if \(stillCurrentLocked\(id, version\)\) post\(avatar\)\s*\}/);
  });

  it('stamps a call ring, so an older call\'s photo fill cannot post over a newer ring or bring a cancelled one back', () => {
    /*
     * Every ring shares CALL_PRENOTIFICATION_ID, and each fill re-posts its
     * own call's name and Answer/Decline intents. A fill that only checked
     * the live list put call 1 over call 2's ring, and one that read the list
     * just after a cancel brought a dead ring back for up to 60 s.
     */
    const ring = slice('    fun notifyCall(\n', '    fun clearCall(');
    expect(ring).toMatch(
      /val version = synchronized\(postLock\) \{\s*post\(null\)\s*stampPostLocked\(CALL_PRENOTIFICATION_ID\)\s*\}/,
    );
    expect(ring).toMatch(
      /synchronized\(postLock\) \{\s*if \(stillCurrentLocked\(CALL_PRENOTIFICATION_ID, version\) &&\s*manager\.activeNotifications\.any \{ shown -> shown\.id == CALL_PRENOTIFICATION_ID \}\s*\) \{\s*post\(IconCompat\.createWithBitmap\(avatar\)\)\s*\}\s*\}/,
    );
    expect(count(ring, 'post(')).toBe(3);
    // The download stays outside the lock.
    expect(ring.indexOf('loadAvatarBitmap(')).toBeLessThan(ring.lastIndexOf('synchronized(postLock)'));
    // Every cancel of the ring goes through the locked cancel that drops its stamp.
    expect(slice('fun cancelCallPrenotification(context: Context) {', '\n    }\n')).toMatch(
      /synchronized\(postLock\) \{\s*cancelLocked\(NotificationManagerCompat\.from\(context\), CALL_PRENOTIFICATION_ID\)\s*\}/,
    );
    expect(slice('fun clearCall(context: Context, callId: String) {', '\n    }\n')).toMatch(
      /\{\s*cancelCallPrenotification\(context\)\s*$/,
    );
    expect(code).not.toMatch(/\.cancel\(CALL_PRENOTIFICATION_ID\)/);
  });

  it('clears everything the account left, notifications and shortcuts, under the post lock', () => {
    const all = slice('fun clearAll(context: Context) {', '\n    }\n');
    expect(all).toMatch(
      /synchronized\(postLock\) \{\s*NotificationManagerCompat\.from\(context\)\.cancelAll\(\)\s*posted\.clear\(\)\s*requestPosts\.clear\(\)\s*cleared\.clear\(\)\s*clearedAll = true\s*\}/,
    );
    // Cached long-lived copies, not only the dynamic list, which keeps them.
    expect(all).toContain('ShortcutManagerCompat.FLAG_MATCH_DYNAMIC or ShortcutManagerCompat.FLAG_MATCH_CACHED');
    expect(all).toContain('ShortcutManagerCompat.removeLongLivedShortcuts(context, ids)');
    expect(all).toContain('ShortcutManagerCompat.removeAllDynamicShortcuts(context)');
    expect(module).toMatch(/fun clearAll\(promise: Promise\) \{\s*Conversations\.clearAll\(reactContext\)\s*promise\.resolve\(null\)/);
    expect(bridge).toMatch(/export async function clearAllConversations\(\): Promise<void> \{\s*if \(native === undefined\) \{\s*return;\s*\}\s*await native\.clearAll\(\);/);
    for (const page of [
      'https://developer.android.com/reference/android/app/NotificationManager#cancelAll()',
      'https://developer.android.com/reference/androidx/core/content/pm/ShortcutManagerCompat#removeLongLivedShortcuts(android.content.Context,java.util.List%3Cjava.lang.String%3E)',
      'https://developer.android.com/reference/androidx/core/app/NotificationManagerCompat#getActiveNotifications()',
    ]) {
      expect({ page, cited: kt.includes(page) }).toEqual({ page, cited: true });
    }
  });

  it('silences a post by the caller only through setSilent, on the channel it would have used', () => {
    const route = slice('private class Route(', '\n    }\n');
    expect(route).toContain(
      'fun silencedIf(silent: Boolean): Route = if (silent) Route(channelId, quiet = true) else this',
    );
    expect(count(code, '.silencedIf(silent)')).toBe(2);
  });

  it('reads the transcript back by notification id alone, never by channel', () => {
    // A background post on Messages and a foreground post on the in-app
    // channel share one id, so a lookup that filtered on the channel would
    // start a fresh transcript every time the two alternated.
    const lookup = slice('private fun activeNotification(', 'private fun withSenderIcon(');
    expect(lookup).toContain('.firstOrNull { it.id == id }');
    expect(lookup).not.toMatch(/channel/i);
    expect(count(code, 'private fun notificationId(conversationId: String): Int = conversationId.hashCode()')).toBe(1);
  });

  it('cites the platform pages it follows', () => {
    for (const page of [
      'https://developer.android.com/develop/ui/views/notifications/channels',
      'https://developer.android.com/develop/ui/views/notifications/build-notification#Updating',
      'https://developer.android.com/develop/ui/views/notifications/conversations',
      'https://developer.android.com/develop/ui/compose/notifications#Heads-up',
      'https://developer.android.com/reference/android/app/NotificationManager#getNotificationChannel(java.lang.String,%20java.lang.String)',
      'https://developer.android.com/reference/androidx/core/app/NotificationManagerCompat#getNotificationChannelCompat(java.lang.String,java.lang.String)',
      'https://developer.android.com/develop/ui/views/notifications/build-notification#Removing',
      'https://developer.android.com/reference/androidx/core/app/NotificationCompat.Builder#setSilent(boolean)',
      'https://developer.android.com/reference/androidx/core/app/NotificationCompat#getChannelId(android.app.Notification)',
      'https://developer.android.com/reference/androidx/core/app/NotificationCompat#GROUP_KEY_SILENT()',
    ]) {
      expect({ page, cited: kt.includes(page) }).toEqual({ page, cited: true });
    }
  });

  it('crosses the bridge on both methods', () => {
    expect(count(module, 'inApp: Boolean,')).toBe(2);
    expect(count(module, 'inApp = inApp,')).toBe(2);
    expect(count(bridge, 'options.inApp === true')).toBe(2);
    expect(bridge).toContain("options: NotifyOptions = {}");
    // `silent` crosses as its own flag, right after inApp, and is never folded
    // into it: the in-app banner is a channel, not a silenced post.
    expect(count(module, 'inApp: Boolean,\n        silent: Boolean,\n        recipientId: String,\n        promise: Promise,')).toBe(2);
    expect(count(module, 'inApp = inApp,\n                silent = silent,')).toBe(2);
    expect(count(bridge, 'options.inApp === true,\n    options.silent === true,')).toBe(2);
  });

  it('logs under a stable tag that survives release builds', () => {
    expect(module).toContain('const val PUSH_LOG_TAG = "PappalPush"');
    expect(module).toMatch(/Log\.i\(PUSH_LOG_TAG, message\)/);
    expect(module).toMatch(/Log\.w\(PUSH_LOG_TAG, message\)/);
    // Nothing in R8's config strips android.util.Log.
    expect(read('android/app/proguard-rules.pro')).not.toMatch(/assumenosideeffects[\s\S]*android\.util\.Log/);
  });
});

describe('push.ts wiring', () => {
  const push = withoutComments(read('src/lib/push.ts'));
  const foreground = push.slice(push.indexOf('export function onForegroundPush'));

  it('routes conversation and contact pushes in the foreground handler', () => {
    expect(foreground).toContain('readConversationPush(remote.data)');
    expect(foreground).toContain('getViewingConversation()');
    expect(foreground).toContain('getRingingConversation()');
    expect(foreground).toContain("AppState.currentState === 'active'");
    expect(foreground).toContain("inApp: action === 'show-in-app' || action === 'show-silent',");
    // Silenced only for the ringing request, never for the in-app banner.
    expect(foreground).toContain("silent: action === 'show-silent',");
    expect(count(foreground, 'silent:')).toBe(1);
    expect(foreground).toContain('notifyChatRequest(push, options)');
    expect(foreground).toContain('notifyConversation(push, MESSAGE_BODY, options)');
  });

  it('uses the same copy as the background handler, since both extend one transcript', () => {
    const body = /const MESSAGE_BODY = '([^']+)';/.exec(push)?.[1];
    expect(body).toBe('wants to have a chat with you');
    const background = push.slice(
      push.indexOf('export async function handleBackgroundPush'),
      push.indexOf('export function onForegroundPush'),
    );
    expect(background).toContain('await notifyConversation(push, MESSAGE_BODY);');
    // index.js registers that handler, and routes nothing itself.
    const entry = withoutComments(read('index.js'));
    expect(entry).toContain(
      'setBackgroundMessageHandler(getMessaging(), remote =>\n  handleBackgroundPush(remote, finishPendingSignOuts),\n);',
    );
    expect(entry).not.toMatch(/notify(Conversation|ChatRequest|Call|Engagement)\(/);
  });

  it('re-registers from AppState, debounced, and checks rather than requests permission', () => {
    const listen = push.slice(push.indexOf('function listen'), push.indexOf('export async function startPush'));
    expect(listen).toContain("AppState.addEventListener('change'");
    expect(listen).toContain('ACTIVE_SETTLE_MS');
    expect(listen).toContain('ACTIVE_MIN_INTERVAL_MS');
    expect(listen).toContain("registerIfGranted('active')");
    expect(listen).toContain("registerIfGranted('refresh', next)");
    const check = push.slice(push.indexOf('async function registerIfGranted'), push.indexOf('function listen'));
    expect(check).toContain('notificationsGranted()');
    expect(check).not.toContain('ensurePermission');
    expect(push).toMatch(
      /export function stopPush\([^]*?\): Promise<boolean> \{\s*halt\(\);\s*const run = revoke\(account\);\s*teardown = Promise\.all\(\[teardown, run\.catch\(\(\) => undefined\)\]\)\.then\(\(\) => undefined\);/,
    );
  });

  it('carries the start generation into registration instead of re-reading it later', () => {
    const start = push.slice(push.indexOf('export async function startPush'), push.indexOf('export function stopPush'));
    expect(start).toMatch(/^[^]*?\{\s*halt\(\);\s*const started = generation;/);
    expect(start.indexOf('const started = generation;')).toBeLessThan(start.indexOf('await '));
    expect(start).toContain("register('start', started)");
    const register = push.slice(push.indexOf('async function register('), push.indexOf('async function registerIfGranted'));
    // No `const mine = generation` of its own: that read happens after the
    // caller's awaits and adopts a sign-out's value.
    expect(register).not.toMatch(/\b(const|let|var)\s+\w+\s*=\s*generation\b/);
    expect(count(register, 'gen !== generation')).toBe(2);
  });

  it('never passes the token to a log line', () => {
    const lines = callArguments(push, 'pushLog');
    expect(lines.length).toBeGreaterThanOrEqual(6);
    for (const args of lines) {
      expect({ args, leaks: /token|fresh\b|\bnext\b/i.test(args) }).toEqual({ args, leaks: false });
    }
    // A server message reaches a log only through the redaction.
    expect(push).toContain('detail(error.message, token)');
    expect(push).not.toMatch(/console\.\w+\([^)]*\$\{(token|fresh|next)\b/);
  });
});

describe('who sets the signal, and who starts push', () => {
  it('sets it from the V2 chat controller, which both trees mount', () => {
    const controller = withoutComments(read('src/chat-v2/useChatV2Controller.ts'));
    expect(controller).toContain('useViewingConversation(conversationId);');
    const lib = withoutComments(read('src/lib/viewingConversation.ts'));
    expect(lib).toContain("AppState.addEventListener('change', sync)");
    expect(lib).toMatch(/return \(\) => \{\s*subscription\.remove\(\);\s*uncoverListeners\.delete\(clearIfSeen\);\s*release\(\);/);
  });

  it('starts push once, at the ready phase, above the member/provider split', () => {
    const app = withoutComments(read('App.tsx'));
    // Exactly one caller in the app, and it is Root's ready effect, which
    // returns the start's own cleanup (see `startPushWhenConfigured`).
    expect(count(app, 'startPushWhenConfigured(')).toBe(1);
    expect(app).not.toContain('startPush()');
    const effect = app.slice(app.indexOf("if (boot.phase !== 'ready') {"));
    expect(effect).toMatch(/^[^]*?return startPushWhenConfigured\(/);
    expect(effect.indexOf('startPushWhenConfigured(')).toBeLessThan(effect.indexOf('}, [boot.phase]);'));
    // The role split lives inside SignedIn, which renders only after every
    // non-ready phase has returned — so neither tree can miss it.
    const signedIn = app.slice(app.indexOf('function SignedIn('));
    expect(signedIn).toContain("if (role === 'provider') {");
    expect(signedIn).not.toContain('startPush');
  });
});

/* -------------------------------------------------------------------------- */
/* The chat-request ring and its notification                                  */
/* -------------------------------------------------------------------------- */

describe('the chat-request ring takes its notification with it', () => {
  /*
   * A provider's ring and the "wants to have a chat with you" notification for
   * the same conversation are one event told twice. When the ring ends in the
   * app (a Decline, or 30 seconds watched to the end) the shade copy goes, by
   * the conversation's own id. When it ran out with nobody there, it stays:
   * cancelling a conversation notification the person never saw is the
   * platform's own example of doing this wrong.
   *
   * Driven, not read: the component is called as a function with its hooks
   * swapped for recorders (no renderer in this repo, as for
   * `useViewingConversation` above), so the effect, the clock and the Decline
   * callback run exactly as React would run them.
   */
  const REQUEST_ROW = {
    requestId: REQUEST,
    conversationId: A,
    peerId: PEER,
    peerName: 'Asha',
    // Server time of the row, which a Decline is anchored to (Greptile P1 on
    // 6bb4114): the same instant as the member message that opened it.
    createdAt: new Date(1_790_000_000_000).toISOString(),
  };

  interface Element {
    type: unknown;
    props: { testID?: string; onPress?: () => void; children?: unknown };
  }

  /** The element in a returned tree carrying `testID`, without rendering it. */
  function byTestId(node: unknown, testID: string): Element | undefined {
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = byTestId(child, testID);
        if (found !== undefined) {
          return found;
        }
      }
      return undefined;
    }
    if (node === null || typeof node !== 'object' || !('props' in node)) {
      return undefined;
    }
    const element = node as Element;
    if (element.props.testID === testID) {
      return element;
    }
    return byTestId(element.props.children, testID);
  }

  /** The store as the ring sees it: its request, and the two actions it calls. */
  interface RingStore {
    incomingRequest: typeof REQUEST_ROW | null;
    readonly queuedRequests: ReadonlyArray<typeof REQUEST_ROW>;
    clearIncomingRequest: jest.Mock;
    setNotice: jest.Mock;
  }

  interface RingOptions {
    /** AppState when the ring starts. */
    startState?: 'active' | 'background';
    /**
     * Requests queued behind the ringing one, oldest first. The store's
     * clearIncomingRequest promotes the next of them in the same update that
     * ends the ring, as useStore.ts does, instead of emptying it.
     */
    queued?: Array<typeof REQUEST_ROW>;
    /** The provider is on a call (App.tsx passes `providerRoute.name === 'call'`). */
    held?: boolean;
    /**
     * A V2 chat already on screen under the ring, mounted (and so subscribed
     * to AppState) before it, as it is when the provider is in a thread when
     * the request arrives.
     */
    chatUnder?: string;
  }

  /**
   * One of the ring's mutation hooks, as TanStack Query's MutationObserver
   * behaves (query-core mutationObserver.js): each call starts its own
   * mutation, `mutateAsync` returns that mutation's promise, and a `mutate`
   * call's own callbacks fire only while it is the observer's latest call,
   * because the next call replaces them. What the ring reads off the result:
   * whether an answer is on the wire, and the variables of the last call.
   */
  function fakeMutation() {
    interface Call {
      variables: RequestVariables;
      resolve: (data: unknown) => void;
      reject: (error: unknown) => void;
    }
    const calls: Call[] = [];
    let latest: Call | undefined;
    const start = (variables: RequestVariables): { call: Call; promise: Promise<unknown> } => {
      let call!: Call;
      const promise = new Promise<unknown>((resolve, reject) => {
        call = { variables, resolve, reject };
      });
      calls.push(call);
      latest = call;
      return { call, promise };
    };
    const hook = {
      calls,
      isPending: false,
      variables: undefined as RequestVariables | undefined,
      mutateAsync: jest.fn((variables: RequestVariables) => start(variables).promise),
      mutate: jest.fn((variables: RequestVariables, options?: MutateCallbacks) => {
        const { call, promise } = start(variables);
        promise.then(
          data => {
            if (latest === call) {
              options?.onSuccess?.(data, variables, undefined, MUTATION_CONTEXT);
              options?.onSettled?.(data, null, variables, undefined, MUTATION_CONTEXT);
            }
          },
          (error: Error) => {
            if (latest === call) {
              options?.onError?.(error, variables, undefined, MUTATION_CONTEXT);
              options?.onSettled?.(undefined, error, variables, undefined, MUTATION_CONTEXT);
            }
          },
        );
      }),
    };
    return hook;
  }
  type FakeMutation = ReturnType<typeof fakeMutation>;

  function mountRing({ startState = 'active', chatUnder, queued = [], held = false }: RingOptions = {}) {
    jest.resetModules();
    const effects: Array<() => void | (() => void)> = [];
    jest.doMock('react', () => ({
      ...jest.requireActual('react'),
      useEffect: (effect: () => void | (() => void)) => {
        effects.push(effect);
      },
      useState: <T,>(initial: T) => [initial, () => undefined],
      useCallback: <T,>(callback: T) => callback,
      useRef: <T,>(initial: T) => ({ current: initial }),
    }));
    jest.doMock('react-native-safe-area-context', () => ({
      useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    }));
    jest.doMock('../src/theme/ThemeProvider', () => ({
      useStyles: () => new Proxy({}, { get: () => ({}) }),
      useTheme: () => ({
        color: { text: { onAccent: '#fff' }, state: { danger: '#f00', available: '#0f0' } },
      }),
    }));
    // A live store, not a snapshot: the ring reads it again when an answer
    // lands (`stillRinging`), and its clear really empties it.
    const waiting = [...queued];
    const store: RingStore = {
      incomingRequest: REQUEST_ROW,
      get queuedRequests() {
        return waiting;
      },
      clearIncomingRequest: jest.fn(),
      setNotice: jest.fn(),
    };
    store.clearIncomingRequest.mockImplementation(() => {
      store.incomingRequest = waiting.shift() ?? null;
    });
    const useStore = Object.assign(
      (select: (state: RingStore) => unknown) => select(store),
      { getState: () => store },
    );
    jest.doMock('../src/store/useStore', () => ({ useStore }));
    const accept = fakeMutation();
    const decline = fakeMutation();
    jest.doMock('../src/api/sessions', () => ({
      useAcceptSessionRequest: () => accept,
      useDeclineSessionRequest: () => decline,
    }));
    for (const leaf of ['Avatar', 'CallRing', 'Icon', 'Pressable']) {
      jest.doMock(`../src/components/${leaf}`, () => ({ [leaf]: () => null }));
    }

    const rn = require('react-native') as typeof import('react-native');
    const listeners = new Set<(next: string) => void>();
    (rn.AppState.addEventListener as jest.Mock).mockImplementation(
      (_type: string, handler: (next: string) => void) => {
        listeners.add(handler);
        return { remove: () => listeners.delete(handler) };
      },
    );
    const setState = (next: 'active' | 'background') => {
      (rn.AppState as unknown as { currentState: string }).currentState = next;
    };
    setState(startState);
    // conversations.ts reads the module once, at load, so it goes in first.
    const clear = jest.fn(async (_conversationId: string) => undefined);
    const notify = jest.fn(async (..._args: unknown[]) => true);
    (rn.NativeModules as Record<string, unknown>).Conversations = { clear, notify };

    // The same module instance the component imports, so its signal is ours.
    const viewing = require('../src/lib/viewingConversation') as ViewingModule;
    if (chatUnder !== undefined) {
      // The chat first, as on a device: it was on screen before the request
      // arrived, so its AppState listener runs before the ring's on every
      // change. Its mount clear predates the ring and is not under test.
      viewing.useViewingConversation(chatUnder);
      expect(effects).toHaveLength(1);
      for (const effect of effects.splice(0)) {
        effect();
      }
      clear.mockClear();
    }
    const { ChatRingScreen } = require('../src/components/ChatRingScreen') as typeof import('../src/components/ChatRingScreen');
    const onOpenConversation = jest.fn();
    const props = { onOpenConversation, held };
    // One effect, the ring's clock; run it the way React would on mount.
    let tree = ChatRingScreen(props);
    expect(effects).toHaveLength(1);
    let cleanup = effects.splice(0)[0]!();
    return {
      get tree() {
        return tree;
      },
      /** Call the component again, as React does on a store change. */
      render: () => ChatRingScreen(props),
      /** The call route changes: held or not, and React re-runs the clock. */
      setHeld: (next: boolean) => {
        props.held = next;
      },
      /**
       * What React does when the ringing request changes (the next queued
       * one promoted): the old clock's cleanup, a render, and the new
       * request's clock.
       */
      rerun: () => {
        if (typeof cleanup === 'function') {
          cleanup();
        }
        effects.length = 0;
        tree = ChatRingScreen(props);
        expect(effects).toHaveLength(1);
        cleanup = effects.splice(0)[0]!();
      },
      store,
      clear,
      notify,
      clearIncomingRequest: store.clearIncomingRequest,
      setNotice: store.setNotice,
      accept,
      decline,
      onOpenConversation,
      listeners,
      viewing,
      appState: (next: 'active' | 'background') => {
        setState(next);
        for (const listener of [...listeners]) {
          listener(next);
        }
      },
      unmount: () => {
        if (typeof cleanup === 'function') {
          cleanup();
        }
      },
    };
  }

  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
    for (const name of [
      'react',
      'react-native-safe-area-context',
      '../src/theme/ThemeProvider',
      '../src/store/useStore',
      '../src/api/sessions',
      '../src/components/Avatar',
      '../src/components/CallRing',
      '../src/components/Icon',
      '../src/components/Pressable',
    ]) {
      jest.dontMock(name);
    }
  });

  type Ring = ReturnType<typeof mountRing>;
  type RequestVariables = { requestId: string; conversationId: string };
  /** A `mutate`'s own callbacks, typed as TanStack Query declares them. */
  type MutateCallbacks = MutateOptions<unknown, Error, RequestVariables, unknown>;
  /** The callbacks' last argument. The ring reads none of it. */
  const MUTATION_CONTEXT: MutationFunctionContext = {
    client: {} as QueryClient,
    meta: undefined,
  };

  /** Press one of the ring's two buttons. */
  function press(ring: Ring, testID: 'chat-ring-accept' | 'chat-ring-decline'): void {
    const button = byTestId(ring.tree, testID);
    expect(button?.props.onPress).toBeDefined();
    button!.props.onPress!();
  }

  /** Run every microtask a settled answer sets off, without moving the clock. */
  async function settleAnswers(): Promise<void> {
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve();
    }
  }

  /**
   * Answer one call on `hook`, the latest unless `which` says otherwise, the
   * way the server would: `data` on success, and on failure `error` or a
   * network error. Every call settles on its own, as TanStack Query's
   * mutations do; a `mutate` call's callbacks still fire only while it is the
   * latest (`fakeMutation`).
   */
  async function answer(
    hook: FakeMutation,
    outcome: 'success' | 'error',
    data: unknown = undefined,
    which: number = hook.calls.length - 1,
  ): Promise<void> {
    const call = hook.calls[which]!;
    expect(call).toBeDefined();
    if (outcome === 'success') {
      call.resolve(data);
    } else {
      call.reject(data instanceof Error ? data : new Error('TypeError: Network request failed'));
    }
    await settleAnswers();
  }

  /** Press Decline, check nothing ends on the press itself, then answer it. */
  async function declineAnd(ring: Ring, outcome: 'success' | 'error'): Promise<void> {
    press(ring, 'chat-ring-decline');
    expect(ring.decline.mutateAsync).toHaveBeenCalledTimes(1);
    expect(ring.decline.calls[0]?.variables).toEqual({ requestId: REQUEST, conversationId: A });
    // Nothing ends on the press itself, only when the RPC answers.
    expect(ring.clear).not.toHaveBeenCalled();
    expect(ring.clearIncomingRequest).not.toHaveBeenCalled();
    await answer(ring.decline, outcome);
  }

  it('clears the notification when the provider declines in the app', async () => {
    const ring = mountRing();
    await declineAnd(ring, 'success');
    // The ring and its shade entry end together, once the server took it.
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.clear.mock.calls).toEqual([[A]]);
    expect(ring.setNotice).not.toHaveBeenCalled();
  });

  it('keeps the ring and the notification when the decline does not reach the server, and says so', async () => {
    // The request is still pending. Clearing on settle took away both ways to
    // answer it: the ring and the shade entry.
    const ring = mountRing();
    await declineAnd(ring, 'error');
    expect(ring.clearIncomingRequest).not.toHaveBeenCalled();
    expect(ring.clear).not.toHaveBeenCalled();
    expect(ring.setNotice.mock.calls).toEqual([['Could not decline. Try again.']]);
    // Still ringing, so its pushes still go to the shade without a banner.
    expect(ring.viewing.getRingingConversation()).toBe(A);
  });

  it('waits out a call: nothing on screen, no clock, no claim, and rings in full once the call ends', () => {
    // Over a live call, Accept pushed the chat route, which unmounts
    // CallScreen, whose unmount cleanup ends the call.
    const ring = mountRing({ held: true });
    expect(ring.tree).toBeNull();
    expect(ring.viewing.getRingingConversation()).toBeNull();
    jest.advanceTimersByTime(60_000);
    expect(ring.clearIncomingRequest).not.toHaveBeenCalled();
    ring.setHeld(false);
    ring.rerun();
    expect(byTestId(ring.tree, 'chat-ring-accept')).toBeDefined();
    expect(ring.viewing.getRingingConversation()).toBe(A);
    jest.advanceTimersByTime(29_000);
    expect(ring.clearIncomingRequest).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
  });

  it('never opens the chat over a call, even for an Accept that lands after the call was routed', () => {
    const app = withoutComments(read('App.tsx'));
    expect(app).toMatch(
      /<ChatRingScreen\s*held=\{providerRoute\.name === 'call'\}\s*onOpenConversation=\{openAcceptedChat\}\s*\/>/,
    );
    expect(app).toMatch(
      /const openAcceptedChat = useCallback\(\s*\(peerId: string\) => \{\s*if \(currentProviderRouteRef\.current\.name === 'call'\) \{\s*setNotice\('Accepted\. The chat is waiting in your list\.', 'confirm'\);\s*return;\s*\}\s*pushProvider\(\{ name: 'chat', peerId \}\);/,
    );
  });

  it('announces each request queued behind the ring, alerting, once, when the provider leaves the app', () => {
    // Its push went to the shade silently while the ring was up, and the
    // queue is promoted only in an app nobody is looking at.
    const second = { ...REQUEST_ROW, requestId: 'r-queued', conversationId: B, peerId: 'member-b', peerName: 'Bea' };
    const ring = mountRing({ queued: [second] });
    expect(ring.notify).not.toHaveBeenCalled();
    ring.appState('background');
    expect(ring.notify).toHaveBeenCalledTimes(1);
    const [conversationId, peerId, senderName, body, , avatar, inApp, silent] = ring.notify.mock.calls[0]!;
    expect({ conversationId, peerId, senderName, body, avatar, inApp, silent }).toEqual({
      conversationId: B,
      peerId: 'member-b',
      senderName: 'Bea',
      body: 'wants to have a chat with you',
      avatar: '',
      inApp: false,
      silent: false,
    });
    // A second departure is not news.
    ring.appState('active');
    ring.appState('background');
    expect(ring.notify).toHaveBeenCalledTimes(1);
    // Nothing once the ring is gone.
    ring.unmount();
    ring.appState('active');
    ring.appState('background');
    expect(ring.notify).toHaveBeenCalledTimes(1);
  });

  it('leaves the notification when the ring is watched to the end', () => {
    // Greptile P1 on 1e845ce: the entry is the whole conversation's, and a
    // message sent while the ring covered the chat sat in it unseen. The
    // request is still pending, so its entry is still true.
    const ring = mountRing();
    jest.advanceTimersByTime(29_000);
    expect(ring.clearIncomingRequest).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.clear).not.toHaveBeenCalled();
    // Once: the clock stops itself rather than waiting for the re-render.
    jest.advanceTimersByTime(5_000);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    ring.unmount();
    expect(ring.listeners.size).toBe(0);
  });

  it('leaves the notification when the ring ran out after the person left', () => {
    const ring = mountRing();
    jest.advanceTimersByTime(10_000);
    ring.appState('background');
    ring.appState('active');
    jest.advanceTimersByTime(20_000);
    // The ring still stops (silence is not a decline, and not a ring forever),
    // but the shade keeps what nobody watched to the end.
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.clear).not.toHaveBeenCalled();
  });

  it('leaves the notification when the ring started with nobody looking', () => {
    const ring = mountRing({ startState: 'background' });
    jest.advanceTimersByTime(30_000);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.clear).not.toHaveBeenCalled();
  });

  it('holds the ringing signal for the whole ring, in use or not, and lets go when it ends', () => {
    // Not dropped on a departure: the chat under the ring reads it on the way
    // back, before the ring's own listener has run (see the chat tests below).
    const ring = mountRing();
    expect(ring.viewing.getRingingConversation()).toBe(A);
    ring.appState('background');
    expect(ring.viewing.getRingingConversation()).toBe(A);
    // And a phone locked mid-ring still alerts, because the decision tests
    // `inUse` before the ring.
    expect(
      foregroundPushAction({ conversationId: A }, null, false, ring.viewing.getRingingConversation()),
    ).toBe('show');
    ring.appState('active');
    expect(ring.viewing.getRingingConversation()).toBe(A);
    ring.unmount();
    expect(ring.viewing.getRingingConversation()).toBeNull();
  });

  it('claims it for a ring that starts with nobody looking, too', () => {
    const ring = mountRing({ startState: 'background' });
    expect(ring.viewing.getRingingConversation()).toBe(A);
  });

  it('lets go when the clock runs out, and does not take it back on a return', () => {
    const ring = mountRing();
    jest.advanceTimersByTime(30_000);
    expect(ring.viewing.getRingingConversation()).toBeNull();
    ring.appState('background');
    ring.appState('active');
    expect(ring.viewing.getRingingConversation()).toBeNull();
  });

  it('does not erase a newer ring\'s claim when it unmounts late', () => {
    const ring = mountRing();
    ring.viewing.setRingingConversation(B);
    ring.unmount();
    expect(ring.viewing.getRingingConversation()).toBe(B);
  });

  it('uses the same clear the chat screen does, by conversation id', () => {
    const ring = withoutComments(read('src/components/ChatRingScreen.tsx'));
    expect(ring).toContain("import { clearConversation, notifyConversation } from '../lib/conversations';");
    // A decline that landed, and a ring leaving its own chat on screen
    // (`clearIfUncovered`). Never a ring-out on its own.
    expect(count(ring, 'void clearConversation(conversationId);')).toBe(2);
  });

  /* A Decline still on the wire when the ring runs out ------------------- */

  it('leaves the notification when the ring runs out on a Decline in flight, and points to the thread if it fails', async () => {
    const ring = mountRing();
    jest.advanceTimersByTime(20_000);
    press(ring, 'chat-ring-decline');
    jest.advanceTimersByTime(10_000);
    // The ring is gone, watched to the end...
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    // ...but the answer has not landed, so its notification stays.
    expect(ring.clear).not.toHaveBeenCalled();
    await answer(ring.decline, 'error');
    expect(ring.clear).not.toHaveBeenCalled();
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    // No ring left to try again on; the thread has its own Decline.
    expect(ring.setNotice.mock.calls).toEqual([['Could not decline. It is still waiting in the chat.']]);
  });

  it('clears the notification when that Decline lands after the ring-out', async () => {
    const ring = mountRing();
    jest.advanceTimersByTime(20_000);
    press(ring, 'chat-ring-decline');
    jest.advanceTimersByTime(10_000);
    expect(ring.clear).not.toHaveBeenCalled();
    await answer(ring.decline, 'success');
    expect(ring.clear.mock.calls).toEqual([[A]]);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.setNotice).not.toHaveBeenCalled();
  });

  it('keeps the notification through a ring-out after a failed Decline has settled', async () => {
    const ring = mountRing();
    jest.advanceTimersByTime(5_000);
    await declineAnd(ring, 'error');
    expect(ring.setNotice.mock.calls).toEqual([['Could not decline. Try again.']]);
    jest.advanceTimersByTime(25_000);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.clear).not.toHaveBeenCalled();
  });

  it.each([
    ['accept', 'chat-ring-accept'],
    ['decline', 'chat-ring-decline'],
  ] as const)('does not end a newer ring when a late %s lands', async (kind, testID) => {
    // The store's clear is unconditional, so an answer for a ring that ran
    // out would end whichever request rings now.
    const NEWER = 'eeeeeeee-0000-4000-8000-00000000000e';
    const ring = mountRing();
    jest.advanceTimersByTime(20_000);
    press(ring, testID);
    jest.advanceTimersByTime(10_000);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    ring.store.incomingRequest = { ...REQUEST_ROW, requestId: NEWER, conversationId: B };
    await answer(kind === 'accept' ? ring.accept : ring.decline, 'success', kind === 'accept' ? 'session-1' : undefined);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.store.incomingRequest?.requestId).toBe(NEWER);
  });

  it('keeps the newer request\'s notification when an older Decline for the same chat lands late', async () => {
    // Greptile P1 on 03c9aae: the clear is by conversation, so an answer to
    // the old request took the new, unanswered one out of the shade.
    const NEWER = 'eeeeeeee-0000-4000-8000-00000000000e';
    const ring = mountRing();
    jest.advanceTimersByTime(20_000);
    press(ring, 'chat-ring-decline');
    jest.advanceTimersByTime(10_000);
    ring.store.incomingRequest = { ...REQUEST_ROW, requestId: NEWER, conversationId: A };
    await answer(ring.decline, 'success');
    expect(ring.clear).not.toHaveBeenCalled();
    expect(ring.store.incomingRequest?.requestId).toBe(NEWER);
  });

  /* The ring over its own conversation's chat --------------------------- */

  it('leaves the notification on a return while the ring covers its own chat', () => {
    // The chat's listener runs first on the way back. A ringing signal that
    // the ring dropped on leaving and took back on return was still clear
    // when the chat asked, and the chat cleared what nobody could see.
    const ring = mountRing({ chatUnder: A });
    expect(ring.viewing.getViewingConversation()).toBe(A);
    ring.appState('background');
    ring.appState('active');
    expect(ring.viewing.getViewingConversation()).toBe(A);
    expect(ring.clear).not.toHaveBeenCalled();
  });

  it('clears it on Accept when that chat is already the screen underneath', async () => {
    // Accept opens the chat that is already mounted, so nothing mounts again
    // to take the notification out of the shade.
    const ring = mountRing({ chatUnder: A });
    press(ring, 'chat-ring-accept');
    expect(ring.clear).not.toHaveBeenCalled();
    await answer(ring.accept, 'success', 'session-1');
    expect(ring.clear.mock.calls).toEqual([[A]]);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.onOpenConversation.mock.calls).toEqual([[PEER]]);
  });

  it('leaves it to the chat that opens when Accept is pressed over a different one', async () => {
    const ring = mountRing({ chatUnder: B });
    press(ring, 'chat-ring-accept');
    await answer(ring.accept, 'success', 'session-1');
    expect(ring.clear).not.toHaveBeenCalled();
    expect(ring.onOpenConversation.mock.calls).toEqual([[PEER]]);
  });

  it('keeps the ring and the notification when Accept never reached the server', async () => {
    // Greptile P1 on 5cb4480: a network failure cleared the notification of a
    // request still pending, leaving nothing to answer it from.
    const ring = mountRing({ chatUnder: A });
    press(ring, 'chat-ring-accept');
    await answer(ring.accept, 'error');
    expect(ring.clear).not.toHaveBeenCalled();
    expect(ring.clearIncomingRequest).not.toHaveBeenCalled();
    expect(ring.onOpenConversation).not.toHaveBeenCalled();
    expect(ring.setNotice.mock.calls).toEqual([['Could not accept. Try again.']]);
  });

  it('does not invite a tap on a newer ring when an Accept fails after its own ring ran out', async () => {
    // "Try again" over a different request ringing now invited the press that
    // accepted THAT one instead.
    const NEWER = 'eeeeeeee-0000-4000-8000-00000000000e';
    const ring = mountRing();
    press(ring, 'chat-ring-accept');
    jest.advanceTimersByTime(30_000);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    ring.store.incomingRequest = { ...REQUEST_ROW, requestId: NEWER, conversationId: B };
    await answer(ring.accept, 'error');
    expect(ring.setNotice.mock.calls).toEqual([['Could not accept. It is still waiting in the chat.']]);
    expect(ring.store.incomingRequest?.requestId).toBe(NEWER);
  });

  it.each(['accept', 'decline'] as const)(
    'keeps a newer ring\'s buttons live while an older request\'s %s is still on the wire',
    hook => {
      // The ring is always mounted, so its mutation observers carry over from
      // one request to the next: an older answer in flight disabled both
      // buttons for the whole of the newer ring.
      const NEWER = 'eeeeeeee-0000-4000-8000-00000000000e';
      const ring = mountRing();
      const disabled = (tree: unknown) =>
        (['chat-ring-accept', 'chat-ring-decline'] as const).map(
          id => (byTestId(tree, id)?.props as { disabled?: boolean } | undefined)?.disabled,
        );
      press(ring, hook === 'accept' ? 'chat-ring-accept' : 'chat-ring-decline');
      ring[hook].isPending = true;
      ring[hook].variables = { requestId: REQUEST, conversationId: A };
      // Its own request on screen: both disabled while the answer is out.
      expect(disabled(ring.render())).toEqual([true, true]);
      jest.advanceTimersByTime(30_000);
      ring.store.incomingRequest = { ...REQUEST_ROW, requestId: NEWER, conversationId: B };
      expect(disabled(ring.render())).toEqual([false, false]);
      // And an answer for the newer one disables them again.
      ring[hook].variables = { requestId: NEWER, conversationId: B };
      expect(disabled(ring.render())).toEqual([true, true]);
    },
  );

  it.each(['P0001', 'P0007', '42501'])(
    'ends the ring and opens the chat when the server refused the Accept (%s)',
    async code => {
      const ring = mountRing({ chatUnder: A });
      press(ring, 'chat-ring-accept');
      await answer(ring.accept, 'error', Object.assign(new Error('refused'), { code }));
      expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
      expect(ring.onOpenConversation.mock.calls).toEqual([[PEER]]);
      expect(ring.setNotice).not.toHaveBeenCalled();
    },
  );

  it('does not clear a newer request\'s notification when an older Accept lands late', async () => {
    const NEWER = 'eeeeeeee-0000-4000-8000-00000000000e';
    const ring = mountRing({ chatUnder: A });
    jest.advanceTimersByTime(20_000);
    press(ring, 'chat-ring-accept');
    jest.advanceTimersByTime(10_000);
    // The ring-out itself uncovered A, which may clear; only the late
    // answer is under test here.
    const before = ring.clear.mock.calls.length;
    ring.store.incomingRequest = { ...REQUEST_ROW, requestId: NEWER, conversationId: A };
    await answer(ring.accept, 'success', 'session-1');
    expect(ring.clear.mock.calls.length).toBe(before);
    expect(ring.store.incomingRequest?.requestId).toBe(NEWER);
  });

  it('clears it when an unwatched ring runs out over its own chat, which then shows', () => {
    const ring = mountRing({ chatUnder: A });
    jest.advanceTimersByTime(10_000);
    ring.appState('background');
    ring.appState('active');
    jest.advanceTimersByTime(19_000);
    expect(ring.clear).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(ring.clear.mock.calls).toEqual([[A]]);
  });

  /* The ring over a DIFFERENT conversation's chat ------------------------ */

  it('keeps the covered chat\'s silent entries for the whole ring, and clears them when it runs out', () => {
    // Chat B under ring A: B's pushes go to the shade silently while the ring
    // hides B, and nothing may clear them until B can be seen again.
    const ring = mountRing({ chatUnder: B });
    expect(
      foregroundPushAction({ conversationId: B }, ring.viewing.getViewingConversation(), true, ring.viewing.getRingingConversation()),
    ).toBe('show-silent');
    ring.appState('background');
    ring.appState('active');
    jest.advanceTimersByTime(29_000);
    expect(ring.clear).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    // B is on screen again with every line posted under the ring; A's own
    // entry is the pending request's and stays.
    expect(ring.clear.mock.calls).toEqual([[B]]);
  });

  it('clears the revealed chat on a ring-out even while the Decline is on the wire', async () => {
    const ring = mountRing({ chatUnder: B });
    jest.advanceTimersByTime(20_000);
    press(ring, 'chat-ring-decline');
    jest.advanceTimersByTime(10_000);
    // The in-flight guard is for A's entry only.
    expect(ring.clear.mock.calls).toEqual([[B]]);
    await answer(ring.decline, 'success');
    expect(ring.clear.mock.calls).toEqual([[B], [A]]);
  });

  it('clears both the ring\'s entry and the revealed chat\'s when a Decline ends the ring', async () => {
    const ring = mountRing({ chatUnder: B });
    await declineAnd(ring, 'success');
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.clear.mock.calls).toEqual([[B], [A]]);
  });

  it('clears nothing for the covered chat when the Decline fails and the ring stays', async () => {
    const ring = mountRing({ chatUnder: B });
    await declineAnd(ring, 'error');
    expect(ring.clear).not.toHaveBeenCalled();
    expect(ring.viewing.getRingingConversation()).toBe(A);
  });

  it('clears nothing for a chat that is not on screen when the ring runs out', () => {
    const ring = mountRing({ chatUnder: B });
    ring.appState('background');
    jest.advanceTimersByTime(30_000);
    expect(ring.clear).not.toHaveBeenCalled();
  });

  /* The next queued request rings in the same update ------------------ */

  // clearIncomingRequest promotes the oldest queued request as it ends a ring
  // (useStore.ts), so the chat under the ring is covered again at once. Both
  // reveal clears used to run as if it could be seen, and cancelled its entry,
  // the queued request's own among it, while the next ring hid it.
  const QUEUED = 'eeeeeeee-0000-4000-8000-0000000000ee';
  const PEER_B = 'ffffffff-0000-4000-8000-0000000000ff';
  const queuedFor = (conversationId: string) => ({
    ...REQUEST_ROW,
    requestId: QUEUED,
    conversationId,
    peerId: PEER_B,
    // Created as the first ring ran out, so its anchor differs from the first's.
    createdAt: new Date(1_790_000_030_000).toISOString(),
  });

  it('keeps the covered chat\'s entry while the queued request for it rings, and clears it when that ring leaves', () => {
    const ring = mountRing({ chatUnder: B, queued: [queuedFor(B)] });
    jest.advanceTimersByTime(30_000);
    expect(ring.store.incomingRequest?.requestId).toBe(QUEUED);
    expect(ring.clear).not.toHaveBeenCalled();
    ring.rerun();
    jest.advanceTimersByTime(29_000);
    expect(ring.clear).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(ring.store.incomingRequest).toBeNull();
    expect(ring.clear.mock.calls).toEqual([[B]]);
  });

  it('keeps its own chat\'s entry while a queued ring for another covers it, and the last ring to leave clears it', () => {
    const ring = mountRing({ chatUnder: A, queued: [queuedFor(B)] });
    jest.advanceTimersByTime(30_000);
    expect(ring.clear).not.toHaveBeenCalled();
    ring.rerun();
    jest.advanceTimersByTime(30_000);
    expect(ring.clear.mock.calls).toEqual([[A]]);
  });

  it('clears only the declined request\'s own entry when a Decline lands with the next request ringing over the chat', async () => {
    const ring = mountRing({ chatUnder: B, queued: [queuedFor(B)] });
    await declineAnd(ring, 'success');
    expect(ring.store.incomingRequest?.requestId).toBe(QUEUED);
    // A's entry is the answered request's; B's is covered by the next ring.
    expect(ring.clear.mock.calls).toEqual([[A]]);
    ring.rerun();
    jest.advanceTimersByTime(30_000);
    expect(ring.clear.mock.calls).toEqual([[A], [B]]);
  });

  it('leaves the entry of the chat an Accept lands on while the next request rings over it', async () => {
    const ring = mountRing({ chatUnder: A, queued: [queuedFor(B)] });
    press(ring, 'chat-ring-accept');
    await answer(ring.accept, 'success', 'session-1');
    expect(ring.store.incomingRequest?.requestId).toBe(QUEUED);
    expect(ring.clear).not.toHaveBeenCalled();
    expect(ring.onOpenConversation.mock.calls).toEqual([[PEER]]);
  });

  /* Answers to two rings on one always-mounted hook ---------------------- */

  // TanStack Query's observer keeps only the latest mutate's callbacks, and
  // the per-request `busy` lets the next ring be answered while the older
  // answer is still out. Each answer now settles on its own promise.
  it('runs an older Decline\'s landing after the next ring was declined too', async () => {
    jest.setSystemTime(1_790_000_000_000);
    const ring = mountRing({ queued: [queuedFor(B)] });
    press(ring, 'chat-ring-decline');
    jest.advanceTimersByTime(30_000);
    ring.rerun();
    press(ring, 'chat-ring-decline');
    expect(ring.decline.calls.map(call => call.variables.requestId)).toEqual([REQUEST, QUEUED]);
    await answer(ring.decline, 'success', undefined, 0);
    expect(ring.clear.mock.calls).toEqual([[A]]);
    expect(ring.viewing.declinedAt(A)).toBe(1_790_000_000_000);
    await answer(ring.decline, 'success', undefined, 1);
    expect(ring.clear.mock.calls).toEqual([[A], [B]]);
    expect(ring.viewing.declinedAt(B)).toBe(1_790_000_030_000);
  });

  it('says so when an older Decline fails after the next ring was declined', async () => {
    const ring = mountRing({ queued: [queuedFor(B)] });
    press(ring, 'chat-ring-decline');
    jest.advanceTimersByTime(30_000);
    ring.rerun();
    press(ring, 'chat-ring-decline');
    await answer(ring.decline, 'error', undefined, 0);
    expect(ring.setNotice.mock.calls).toEqual([['Could not decline. It is still waiting in the chat.']]);
  });

  it('opens an older Accept\'s chat after the next ring was accepted too', async () => {
    const ring = mountRing({ queued: [queuedFor(B)] });
    press(ring, 'chat-ring-accept');
    jest.advanceTimersByTime(30_000);
    ring.rerun();
    press(ring, 'chat-ring-accept');
    await answer(ring.accept, 'success', 'session-1', 0);
    expect(ring.onOpenConversation.mock.calls).toEqual([[PEER]]);
    await answer(ring.accept, 'success', 'session-2', 1);
    expect(ring.onOpenConversation.mock.calls).toEqual([[PEER], [PEER_B]]);
  });

  /* A Decline is stamped when it was pressed ----------------------------- */

  it('keeps a message sent while the Decline was on the wire, in the shade and past the late-push rule', async () => {
    // Pressed at T0 and landed six seconds later. The member wrote at T0+2 s,
    // posted silently under the ring; the landing cancelled it unseen, and a
    // push for it arriving after the landing was ignored as "before the
    // Decline".
    const T0 = 1_790_000_000_000;
    jest.setSystemTime(T0);
    const ring = mountRing();
    press(ring, 'chat-ring-decline');
    jest.advanceTimersByTime(2_000);
    ring.viewing.recordPosted(A, T0 + 2_000);
    jest.advanceTimersByTime(4_000);
    await answer(ring.decline, 'success');
    expect(ring.clear).not.toHaveBeenCalled();
    expect(ring.viewing.declinedAt(A)).toBe(T0);
    expect(
      foregroundPushAction({ conversationId: A, sentAt: T0 + 2_000 }, null, true, null, ring.viewing.declinedAt(A)),
    ).toBe('show-in-app');
    // The request's own push, sent before the press, is still the answered one.
    expect(
      foregroundPushAction({ conversationId: A, sentAt: T0 - 1_000 }, null, true, null, ring.viewing.declinedAt(A)),
    ).toBe('ignore');
  });

  it('clears the kept entry when the chat the ring covered is that conversation, now on screen', async () => {
    // Something posted since the press keeps the entry, but the ring has
    // left and the person is reading the very chat it covered.
    const T0 = 1_790_000_000_000;
    jest.setSystemTime(T0);
    const ring = mountRing({ chatUnder: A });
    press(ring, 'chat-ring-decline');
    ring.viewing.recordPosted(A, T0 + 2_000);
    jest.advanceTimersByTime(4_000);
    await answer(ring.decline, 'success');
    expect(ring.clear.mock.calls).toEqual([[A]]);
  });

  it('clears the entry a ring-out skipped for a Decline in flight, once that Decline settles, with the chat on screen', async () => {
    const ring = mountRing({ chatUnder: A });
    press(ring, 'chat-ring-decline');
    jest.advanceTimersByTime(30_000);
    expect(ring.clear).not.toHaveBeenCalled();
    await answer(ring.decline, 'error');
    expect(ring.clear.mock.calls).toEqual([[A]]);
  });

  it('keeps the entry after a failed Decline while the ring is still up', async () => {
    const ring = mountRing({ chatUnder: A });
    await declineAnd(ring, 'error');
    expect(ring.clear).not.toHaveBeenCalled();
  });

  it('still clears the entry when nothing newer than the press was posted', async () => {
    const T0 = 1_790_000_000_000;
    jest.setSystemTime(T0);
    const ring = mountRing();
    ring.viewing.recordPosted(A, T0 - 1_000);
    press(ring, 'chat-ring-decline');
    jest.advanceTimersByTime(6_000);
    await answer(ring.decline, 'success');
    expect(ring.clear.mock.calls).toEqual([[A]]);
  });

  /* A Decline, remembered ---------------------------------------------- */

  it('remembers a Decline that landed, so the request\'s late push does not peek', async () => {
    jest.setSystemTime(1_790_000_002_000);
    const ring = mountRing();
    await declineAnd(ring, 'success');
    // Anchored to the request's server time, not the press two seconds on.
    expect(ring.viewing.declinedAt(A)).toBe(1_790_000_000_000);
    // The member's first message, sent as the ring started, arriving now.
    expect(
      foregroundPushAction({ conversationId: A, sentAt: 1_790_000_000_000 }, null, true, null, ring.viewing.declinedAt(A)),
    ).toBe('ignore');
  });

  it('does not silence a new message when the phone clock runs ahead of the server', async () => {
    // Greptile P1 on 6bb4114: stamped with a device clock a minute fast, a
    // message the member sent 5 s after the request was treated as part of it.
    jest.setSystemTime(1_790_000_000_000 + 60_000);
    const ring = mountRing();
    await declineAnd(ring, 'success');
    expect(ring.viewing.declinedAt(A)).toBe(1_790_000_000_000);
    expect(
      foregroundPushAction({ conversationId: A, sentAt: 1_790_000_005_000 }, null, true, null, ring.viewing.declinedAt(A)),
    ).toBe('show-in-app');
  });

  it('suppresses nothing when the request row carries no server time', async () => {
    const ring = mountRing();
    const { createdAt: _dropped, ...withoutTime } = ring.store.incomingRequest!;
    ring.store.incomingRequest = withoutTime as typeof ring.store.incomingRequest;
    ring.rerun();
    await declineAnd(ring, 'success');
    expect(ring.viewing.declinedAt(A)).toBeNull();
  });

  it('remembers nothing for a Decline that failed', async () => {
    const ring = mountRing();
    await declineAnd(ring, 'error');
    expect(ring.viewing.declinedAt(A)).toBeNull();
  });

  it('remembers nothing when a newer request for the conversation rings, whose push is still to come', async () => {
    const NEWER = 'eeeeeeee-0000-4000-8000-00000000000e';
    const ring = mountRing();
    jest.advanceTimersByTime(20_000);
    press(ring, 'chat-ring-decline');
    jest.advanceTimersByTime(10_000);
    ring.store.incomingRequest = { ...REQUEST_ROW, requestId: NEWER, conversationId: A };
    await answer(ring.decline, 'success');
    expect(ring.viewing.declinedAt(A)).toBeNull();
  });
});

describe('account deletion keeps push until the account is actually gone', () => {
  it('stops push only after deleteAccount resolves, and never from the catch', () => {
    /*
     * stopPush used to run first, so a deletion that then failed left an
     * account that still exists on a device with no token and no listeners.
     * Moving it after is the fix that needs nothing undone; a startPush in the
     * catch would re-ask for the notification permission over the sheet.
     */
    const sheet = withoutComments(read('src/screens/SettingsSheet.tsx'));
    const onDelete = sheet.slice(
      sheet.indexOf('const onDelete = useCallback(async () => {'),
      sheet.indexOf('}, [onDeleted, queryClient, setNotice]);'),
    );
    const tryBlock = onDelete.slice(0, onDelete.indexOf('} catch (err) {'));
    const catchBlock = onDelete.slice(onDelete.indexOf('} catch (err) {'));
    expect(tryBlock.indexOf('await deleteAccount();')).toBeGreaterThan(-1);
    expect(tryBlock.indexOf('await stopPush();')).toBeGreaterThan(
      tryBlock.indexOf('await deleteAccount();'),
    );
    expect(count(onDelete, 'stopPush(')).toBe(1);
    expect(catchBlock).not.toContain('stopPush');
    expect(catchBlock).not.toContain('startPush');
    // And the precondition that makes the order safe: stopPush cannot throw.
    const push = withoutComments(read('src/lib/push.ts'));
    const stop = push.slice(push.indexOf('export function stopPush'), push.indexOf('const MESSAGE_BODY'));
    expect(stop).toMatch(/halt\(\);\s*const run = revoke\(account\);/);
    // Both halves in a try of their own, so the row delete failing still
    // revokes the token, and neither can throw.
    expect(stop).toMatch(
      /async function revoke\([^)]*\): Promise<boolean> \{\s*let rowGone = false;\s*try \{[^]*?\} catch \(err\) \{[^]*?try \{\s*await deleteToken\(getMessaging\(\)\);\s*return true;\s*\} catch \(err\) \{/,
    );
    // The wait for a registration on the wire is inside that try, and first.
    expect(stop).toMatch(/try \{\s*await drainRegistrations\(STOP_DRAIN_MS\);\s*const token = await getToken/);
  });
});

describe('the lock-screen Decline runs without the app and clears only once it landed', () => {
  const receiver = withoutComments(read('android/app/src/main/java/com/companionchat/ChatRequestReceiver.kt'));
  const service = withoutComments(read('android/app/src/main/java/com/companionchat/ChatRequestDeclineService.kt'));

  it('ChatRequestReceiver clears nothing and hands the Decline to a headless task', () => {
    // It cleared first and emitted to a listener that exists only while the
    // signed-in tree is mounted: with the app swiped away, the Decline was
    // lost and its shade entry already gone.
    expect(receiver).not.toContain('Conversations.clear');
    expect(receiver).not.toMatch(/\.cancel(All)?\(/);
    expect(receiver).not.toContain('ReactBridgeEvents');
    expect(receiver).toContain('Intent(context, ChatRequestDeclineService::class.java)');
    expect(receiver).toMatch(/context\.startService\(task\)\s*HeadlessJsTaskService\.acquireWakeLockNow\(context\)/);
  });

  it('runs the task index.js registers, in the foreground too', () => {
    expect(service).toContain('class ChatRequestDeclineService : HeadlessJsTaskService()');
    expect(service).toContain('const val TASK = "ChatRequestDecline"');
    expect(service).toContain('return HeadlessJsTaskConfig(TASK, data, TIMEOUT_MS, true)');
    // Structure, not layout: the pre-commit formatter wraps this call.
    expect(withoutComments(read('index.js'))).toMatch(
      /AppRegistry\.registerHeadlessTask\(\s*'ChatRequestDecline',\s*\(\) => declineFromNotification,?\s*\);/,
    );
    expect(read('android/app/src/main/AndroidManifest.xml')).toMatch(
      /<service\s+android:name="\.ChatRequestDeclineService"\s+android:exported="false" \/>/,
    );
    // Nothing in the tree runs the RPC for it any more.
    expect(withoutComments(read('App.tsx'))).not.toContain("'chatRequestDecline'");
  });

  it('tells the mounted tree under the one name it listens for, and the tree refetches what changed', () => {
    // Only the emit side was held: the listener could be renamed, and a
    // shade Decline then left the thread showing live Accept and Decline
    // buttons for a request already declined.
    const decline = withoutComments(read('src/lib/chatRequestDecline.ts'));
    const emitted = /DeviceEventEmitter\.emit\('([^']+)', conversationId\)/.exec(decline)?.[1];
    expect(emitted).toBe('chatRequestDeclined');
    const app = withoutComments(read('App.tsx'));
    expect(app).toMatch(
      new RegExp(
        `const sub = DeviceEventEmitter\\.addListener\\('${emitted}', \\(conversationId: string\\) => \\{\\s*` +
          'refetchAfterDecline\\(queryClient, conversationId\\);\\s*\\}\\);\\s*return \\(\\) => sub\\.remove\\(\\);',
      ),
    );
    expect(count(app, `addListener('${emitted}'`)).toBe(1);
  });

  function loadDecline(rpcResult: { error: { code: string } | null } | Error) {
    jest.resetModules();
    const rn = require('react-native') as typeof import('react-native');
    const clear = jest.fn(async (_conversationId: string) => undefined);
    const clearRequest = jest.fn(async (_conversationId: string, _requestId: string) => undefined);
    const pushLog = jest.fn();
    (rn.NativeModules as Record<string, unknown>).Conversations = { clear, clearRequest, pushLog };
    const { supabase } = require('../src/lib/supabase') as { supabase: { rpc: jest.Mock } };
    const order: string[] = [];
    supabase.rpc.mockImplementation(async () => {
      order.push('rpc');
      if (rpcResult instanceof Error) throw rpcResult;
      return rpcResult;
    });
    clear.mockImplementation(async () => {
      order.push('clear');
    });
    clearRequest.mockImplementation(async () => {
      order.push('clearRequest');
    });
    const emit = jest.spyOn(rn.DeviceEventEmitter, 'emit').mockImplementation(() => undefined);
    const { declineFromNotification } = require('../src/lib/chatRequestDecline') as typeof import('../src/lib/chatRequestDecline');
    return { declineFromNotification, rpc: supabase.rpc, clear, clearRequest, emit, order, pushLog };
  }

  // pushLog mirrors a warning to the console in __DEV__, which jest is; the
  // line is asserted through the native stub instead.
  beforeEach(() => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  it('declines, then clears the notification and tells a mounted tree', async () => {
    const d = loadDecline({ error: null });
    await d.declineFromNotification({ requestId: REQUEST, conversationId: A });
    expect(d.rpc).toHaveBeenCalledWith('decline_session_request', { p_request_id: REQUEST });
    // Only while the entry is still this request: never the conversation's
    // unconditional clear, which cancelled a message posted meanwhile.
    expect(d.order).toEqual(['rpc', 'clearRequest']);
    expect(d.clearRequest.mock.calls).toEqual([[A, REQUEST]]);
    expect(d.clear).not.toHaveBeenCalled();
    expect(d.emit).toHaveBeenCalledWith('chatRequestDeclined', A);
  });

  it.each([
    ['an error the RPC reports', { error: { code: 'PGRST301' } }],
    ['a request that never got there', new Error('TypeError: Network request failed')],
  ] as const)('keeps the notification when the Decline did not land: %s', async (_name, result) => {
    const d = loadDecline(result);
    await d.declineFromNotification({ requestId: REQUEST, conversationId: A });
    expect(d.clear).not.toHaveBeenCalled();
    expect(d.clearRequest).not.toHaveBeenCalled();
    expect(d.emit).not.toHaveBeenCalled();
    expect(d.pushLog.mock.calls[0][0]).toBe(true);
  });

  it('does nothing without a request id', async () => {
    const d = loadDecline({ error: null });
    await d.declineFromNotification({ conversationId: A });
    expect(d.rpc).not.toHaveBeenCalled();
    expect(d.clear).not.toHaveBeenCalled();
    expect(d.clearRequest).not.toHaveBeenCalled();
  });
});

describe('a sign-in waits for a sign-out still finishing (Greptile P1 on 6c8e3b7)', () => {
  const auth = read('src/api/auth.ts');
  const bodyOf = (signature: string) => {
    const at = auth.indexOf(signature);
    expect(at).toBeGreaterThanOrEqual(0);
    return auth.slice(at, auth.indexOf('\n}\n', at));
  };

  it.each([
    'export async function sendPhoneOtp(',
    'export async function verifyPhoneOtp(',
    'export async function signInWith(',
    'export async function signInWithTruecaller(',
    'export async function confirmTruecallerNewUser(',
    'export async function signInWithGoogle(',
    'export async function handleAuthDeepLink(',
  ])('%s waits before it starts a session', signature => {
    // First statement, so no session work can run before the old sign-out ends.
    expect(bodyOf(signature)).toMatch(/\): Promise<[^>]+> \{\s*await afterPendingSignOut\(\);/);
  });

  it('Settings signs out through beginSignOut, not its own unrecorded chain', () => {
    const settings = read('src/screens/SettingsSheet.tsx');
    const press = settings.slice(settings.indexOf('const onSignOutPress'), settings.indexOf('}, [onSignedOut, queryClient]);'));
    expect(press).toContain('beginSignOut()');
    expect(press).not.toMatch(/await stopPush\(\)|await signOut\(\)/);
  });
});

describe('sign-out drops the device session first and ends the old one on a client of its own', () => {
  /*
   * Driven, not read. auth.ts is loaded with its collaborators replaced by
   * recorders: MMKV by a Map, the app's Supabase client and the sign-out
   * client by stand-ins that log what they are asked, push by a `stopPush`
   * whose teardown is held open. The sign-in used to be held by source
   * regexes only, which a no-op `afterPendingSignOut` still passed.
   */
  const SESSION_KEY = 'sb-test-auth-token';
  const STORED = JSON.stringify({ access_token: 'access-A', refresh_token: 'refresh-A', user: { id: 'user-a' } });

  function gate() {
    let open: () => void = () => undefined;
    const promise = new Promise<void>(resolve => {
      open = resolve;
    });
    return { promise, open };
  }

  const settle = async (): Promise<void> => {
    for (let i = 0; i < 20; i += 1) {
      await Promise.resolve();
    }
  };

  function loadAuth(options: {
    firebase?: Promise<void>;
    firebaseFails?: boolean;
    ghostSignOut?: () => Promise<{ error: unknown }>;
    store?: Map<string, string>;
    /** Whether a push half fails: the row delete and the token delete both. */
    pushFails?: () => boolean;
  } = {}) {
    jest.resetModules();
    const store = options.store ?? new Map<string, string>([[SESSION_KEY, STORED]]);
    const events: string[] = [];
    jest.doMock('../src/lib/storage', () => ({
      storage: {
        get: (key: string) => store.get(key) ?? null,
        set: (key: string, value: string) => {
          store.set(key, value);
        },
        remove: (key: string) => {
          store.delete(key);
        },
      },
      supabaseStorage: {},
    }));
    const ghost = {
      auth: {
        setSession: jest.fn(async (tokens: { access_token: string; refresh_token: string }) => {
          events.push(`ghost setSession ${tokens.access_token}`);
          return { data: {}, error: null };
        }),
        signOut: jest.fn(async (opts: { scope: string }) => {
          events.push(`ghost signOut ${opts.scope}`);
          return options.ghostSignOut ? options.ghostSignOut() : { error: null };
        }),
      },
    };
    const main = {
      rpc: jest.fn(async () => ({ error: null })),
      auth: {
        signOut: jest.fn(async (opts?: { scope?: string }) => {
          events.push(`main signOut ${opts?.scope ?? 'global'}`);
          return { error: null };
        }),
        exchangeCodeForSession: jest.fn(async () => {
          events.push('exchangeCodeForSession');
          return { data: {}, error: null };
        }),
        getSession: jest.fn(async () => ({ data: { session: null }, error: null })),
        signInWithOAuth: jest.fn(async () => {
          events.push('signInWithOAuth');
          return { data: { url: 'https://accounts.example/consent' }, error: null };
        }),
      },
    };
    jest.doMock('../src/lib/supabase', () => ({
      supabase: main,
      SESSION_STORAGE_KEY: SESSION_KEY,
      signOutClient: () => ghost,
    }));
    const pushTeardown = gate();
    /** Whether somebody's session was stored when each push half started. */
    const signedInAtPush: boolean[] = [];
    const stopPush = jest.fn((account: unknown) => {
      events.push('stopPush');
      signedInAtPush.push(store.has(SESSION_KEY));
      return (async () => {
        const db = await account;
        events.push(`push row delete as ${db === ghost ? 'the old account' : String(db)}`);
        await pushTeardown.promise;
        return !(options.pushFails?.() ?? false);
      })();
    });
    // The account half alone: the row, never the device's listeners or token.
    const unregisterPush = jest.fn(async (account: unknown) => {
      events.push('unregisterPush');
      const db = await account;
      events.push(`push row delete only, as ${db === ghost ? 'the old account' : String(db)}`);
      return !(options.pushFails?.() ?? false);
    });
    jest.doMock('../src/lib/push', () => ({
      stopPush,
      unregisterPush,
      signedInOnDevice: () => store.has(SESSION_KEY),
      storedAccountId: () => {
        const raw = store.get(SESSION_KEY);
        return raw === undefined ? null : (JSON.parse(raw) as { user: { id: string } }).user.id;
      },
    }));
    jest.doMock('../src/lib/firebasePhone', () => ({
      firebaseSendOtp: jest.fn(),
      firebaseConfirmOtp: jest.fn(),
      firebaseSignOut: jest.fn(async () => {
        events.push('firebaseSignOut');
        await options.firebase;
        if (options.firebaseFails) {
          throw new Error('firebase');
        }
      }),
    }));
    jest.doMock('../src/lib/sentry', () => ({ reportSwallowed: jest.fn() }));
    const clearAll = jest.fn(async () => {
      events.push('clearAll');
    });
    jest.doMock('../src/lib/conversations', () => ({
      ...jest.requireActual('../src/lib/conversations'),
      clearAllConversations: clearAll,
    }));
    const viewing = require('../src/lib/viewingConversation') as ViewingModule;
    const auth = require('../src/api/auth') as typeof import('../src/api/auth');
    return {
      auth,
      viewing,
      store,
      events,
      main,
      ghost,
      stopPush,
      unregisterPush,
      signedInAtPush,
      pushTeardown,
      clearAll,
    };
  }

  afterEach(() => {
    for (const name of [
      '../src/lib/storage',
      '../src/lib/push',
      '../src/lib/firebasePhone',
      '../src/lib/sentry',
      '../src/lib/conversations',
    ]) {
      jest.dontMock(name);
    }
    // Back to the file's own stand-ins, which `load()` configures per test.
    jest.doMock('../src/lib/supabase', () => ({
      supabase: { rpc: jest.fn(), from: jest.fn(), auth: { getSession: jest.fn() } },
      SESSION_STORAGE_KEY: STORED_SESSION_KEY,
    }));
    jest.doMock('../src/lib/storage', () => mockStorageModule);
  });

  it('removes the stored session before it returns, so a process killed at once relaunches signed out', () => {
    const a = loadAuth({ firebase: new Promise<void>(() => undefined) });
    a.viewing.setViewingConversation(A);
    a.viewing.setRingingConversation(B);
    a.viewing.recordDeclined(A);
    void a.auth.beginSignOut();
    // Synchronously: nothing awaited yet, and the session is already gone.
    expect(a.store.has(SESSION_KEY)).toBe(false);
    expect(JSON.parse(a.store.get('auth.pendingSignOut') ?? '[]')).toEqual([{ session: STORED, push: true }]);
    // The push teardown has started (registration halted) in the same step.
    expect(a.stopPush).toHaveBeenCalledTimes(1);
    // Nothing this account set decides a push for the next one.
    expect(a.viewing.getViewingConversation()).toBeNull();
    expect(a.viewing.getRingingConversation()).toBeNull();
    expect(a.viewing.declinedAt(A)).toBeNull();
  });

  it('lets a sign-in start once the device half is done, without waiting for the server half', async () => {
    const firebase = gate();
    const a = loadAuth({ firebase: firebase.promise });
    const out = a.auth.beginSignOut();
    const signIn = a.auth.signInWith('google');
    await settle();
    // The device half is still running: no sign-in yet.
    expect(a.events).not.toContain('signInWithOAuth');
    firebase.open();
    await signIn;
    // Local sign-out first (no request, nothing stored), then the sign-in,
    // with the server half still held open behind it.
    expect(a.events.indexOf('main signOut local')).toBeGreaterThan(-1);
    expect(a.events.indexOf('signInWithOAuth')).toBeGreaterThan(a.events.indexOf('main signOut local'));
    expect(a.events).not.toContain('ghost signOut local');
    a.pushTeardown.open();
    await out;
    // The old session is ended on its own client, and the app's client is
    // never asked to sign out again: that call is what ended new sessions.
    expect(a.main.auth.signOut.mock.calls).toEqual([[{ scope: 'local' }]]);
    expect(a.ghost.auth.setSession).toHaveBeenCalledWith({ access_token: 'access-A', refresh_token: 'refresh-A' });
    expect(a.events).toContain('push row delete as the old account');
    expect(a.events.indexOf('ghost signOut local')).toBeGreaterThan(a.events.indexOf('signInWithOAuth'));
    expect(a.store.has('auth.pendingSignOut')).toBe(false);
    expect(a.clearAll).toHaveBeenCalledTimes(1);
  });

  it('still lets the sign-in through when the device half fails', async () => {
    const a = loadAuth({ firebaseFails: true });
    const out = a.auth.beginSignOut();
    await a.auth.signInWith('google');
    expect(a.events).toContain('signInWithOAuth');
    a.pushTeardown.open();
    await expect(out).rejects.toThrow('firebase');
  });

  it('keeps the dropped session for the next launch when the server could not be reached, and finishes it there', async () => {
    const { AuthRetryableFetchError } = jest.requireActual('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
    const a = loadAuth({ ghostSignOut: async () => ({ error: new AuthRetryableFetchError('Failed to fetch', 0) }) });
    const out = a.auth.beginSignOut();
    a.pushTeardown.open();
    await out;
    expect(a.store.has(SESSION_KEY)).toBe(false);
    // Kept, and with its push half written down as done: only the session
    // is left to end.
    expect(JSON.parse(a.store.get('auth.pendingSignOut') ?? '[]')).toEqual([{ session: STORED, push: false }]);
    // The next launch: a fresh module graph over the same storage.
    const next = loadAuth({ store: a.store });
    const resumed = next.auth.resumePendingSignOuts();
    next.pushTeardown.open();
    await resumed;
    expect(next.events).toEqual(['ghost setSession access-A', 'ghost signOut local']);
    expect(next.store.has('auth.pendingSignOut')).toBe(false);
    // Once per process.
    await next.auth.resumePendingSignOuts();
    expect(next.ghost.auth.signOut).toHaveBeenCalledTimes(1);
  });

  it('drops a pending sign-out the server refused, rather than retrying it forever', async () => {
    const a = loadAuth({ ghostSignOut: async () => ({ error: Object.assign(new Error('invalid'), { status: 400 }) }) });
    const out = a.auth.beginSignOut();
    a.pushTeardown.open();
    await out;
    expect(a.store.has('auth.pendingSignOut')).toBe(false);
  });

  it('takes a Truecaller-link session back the same way, without the push teardown', async () => {
    const a = loadAuth();
    await a.auth.signOut();
    expect(a.store.has(SESSION_KEY)).toBe(false);
    expect(a.stopPush).not.toHaveBeenCalled();
    expect(a.events).toContain('ghost signOut local');
    expect(a.clearAll).toHaveBeenCalledTimes(1);
  });

  it('finishes pending sign-outs one at a time, and again whenever asked, not once per process', async () => {
    // One at a time: each runs a push teardown, and two at once raced their
    // deleteTokens against the next sign-in. Again whenever asked: the FCM
    // background handler retries on every push that reaches a signed-out
    // phone, which a headless process never had a boot retry for.
    const { AuthRetryableFetchError } = jest.requireActual('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
    const STORED_B = JSON.stringify({ access_token: 'access-B', refresh_token: 'refresh-B', user: { id: 'user-b' } });
    const store = new Map<string, string>([
      ['auth.pendingSignOut', JSON.stringify([{ session: STORED, push: true }, { session: STORED_B, push: true }])],
    ]);
    let reachable = false;
    const a = loadAuth({
      store,
      ghostSignOut: async () =>
        reachable ? { error: null } : { error: new AuthRetryableFetchError('Failed to fetch', 0) },
    });
    a.pushTeardown.open();
    await a.auth.resumePendingSignOuts();
    const one = (token: string) => [
      `ghost setSession ${token}`,
      'stopPush',
      'push row delete as the old account',
      'ghost signOut local',
    ];
    expect(a.events).toEqual([...one('access-A'), ...one('access-B')]);
    expect(JSON.parse(a.store.get('auth.pendingSignOut') ?? '[]')).toHaveLength(2);
    // The boot retry is once per process; the other is not.
    await a.auth.resumePendingSignOuts();
    expect(a.ghost.auth.signOut).toHaveBeenCalledTimes(2);
    reachable = true;
    await a.auth.finishPendingSignOuts();
    expect(a.ghost.auth.signOut).toHaveBeenCalledTimes(4);
    expect(a.store.has('auth.pendingSignOut')).toBe(false);
  });

  /* A retry that runs after somebody signed in ------------------------- */

  const STORED_B = JSON.stringify({ access_token: 'access-B', refresh_token: 'refresh-B', user: { id: 'user-b' } });

  it('never tears push down for a retry that finds the next account signed in', async () => {
    // The online listener triggers a retry with nobody signed in; it parks on
    // the first attempt; B signs in; the first attempt's /logout fails on the
    // network. The retry used to run stopPush again, whose halt and
    // deleteToken belong to B by then.
    const { AuthRetryableFetchError } = jest.requireActual('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
    const a = loadAuth({ ghostSignOut: async () => ({ error: new AuthRetryableFetchError('Failed to fetch', 0) }) });
    const out = a.auth.beginSignOut();
    const retry = a.auth.finishPendingSignOuts();
    await settle();
    a.store.set(SESSION_KEY, STORED_B);
    a.pushTeardown.open();
    await out;
    await retry;
    expect(a.stopPush).toHaveBeenCalledTimes(1);
    expect(a.signedInAtPush).toEqual([false]);
  });

  it('runs only the old account\'s row delete, as that account, when the push half is still owed and somebody signed in', async () => {
    // The first attempt's push half failed, so its entry still owes it. The
    // retry runs with B signed in: the old account's row, never B's device.
    let pushFails = true;
    const a = loadAuth({ pushFails: () => pushFails });
    const out = a.auth.beginSignOut();
    const retry = a.auth.finishPendingSignOuts();
    await settle();
    a.store.set(SESSION_KEY, STORED_B);
    a.pushTeardown.open();
    await out;
    pushFails = false;
    await retry;
    expect(a.stopPush).toHaveBeenCalledTimes(1);
    expect(a.signedInAtPush).toEqual([false]);
    expect(a.unregisterPush).toHaveBeenCalledTimes(1);
    expect(a.events.slice(a.events.indexOf('unregisterPush'))).toEqual([
      'unregisterPush',
      'push row delete only, as the old account',
      'ghost signOut local',
    ]);
    expect(a.store.has('auth.pendingSignOut')).toBe(false);
  });

  it('clears what a dead session left on the device, with no server half', async () => {
    // auth-js already dropped the refused session; the outbox is still A's.
    const a = loadAuth({ store: new Map([[OUTBOX_KEY, QUEUED]]) });
    a.viewing.setViewingConversation(A);
    const dead = a.auth.forgetDeadSession();
    expect(a.store.has(OUTBOX_KEY)).toBe(false);
    expect(a.viewing.getViewingConversation()).toBeNull();
    await dead;
    expect(a.clearAll).toHaveBeenCalledTimes(1);
    expect(a.ghost.auth.setSession).not.toHaveBeenCalled();
    expect(a.stopPush).not.toHaveBeenCalled();
    expect(a.store.has('auth.pendingSignOut')).toBe(false);
  });

  it('leaves the row alone when the same person signed back in, and still ends the old session', async () => {
    // A flaky sign-out kept the entry with its push half owed; A signed back
    // in and registered the same token under the same id. The old session's
    // row delete (`user_id = auth.uid()`) would be A's live registration.
    const store = new Map<string, string>([
      ['auth.pendingSignOut', JSON.stringify([{ session: STORED, push: true }])],
      [SESSION_KEY, JSON.stringify({ access_token: 'access-A2', refresh_token: 'refresh-A2', user: { id: 'user-a' } })],
    ]);
    const a = loadAuth({ store });
    a.pushTeardown.open();
    await a.auth.resumePendingSignOuts();
    expect(a.unregisterPush).not.toHaveBeenCalled();
    expect(a.stopPush).not.toHaveBeenCalled();
    expect(a.events).toEqual(['ghost setSession access-A', 'ghost signOut local']);
    expect(a.store.has('auth.pendingSignOut')).toBe(false);
  });

  it('asks again before each entry, so a sign-in between two pending sign-outs spares the next account', async () => {
    const STORED_C = JSON.stringify({ access_token: 'access-C', refresh_token: 'refresh-C', user: { id: 'user-c' } });
    const store = new Map<string, string>([
      ['auth.pendingSignOut', JSON.stringify([{ session: STORED, push: true }, { session: STORED_C, push: true }])],
    ]);
    const a = loadAuth({ store });
    const resumed = a.auth.resumePendingSignOuts();
    await settle();
    // B signs in while the first entry's teardown is still running.
    a.store.set(SESSION_KEY, STORED_B);
    a.pushTeardown.open();
    await resumed;
    expect(a.signedInAtPush).toEqual([false]);
    expect(a.unregisterPush).toHaveBeenCalledTimes(1);
    expect(a.store.has('auth.pendingSignOut')).toBe(false);
  });

  it('keeps a sign-out whose push half did not finish, and does not end the session that alone can finish it', async () => {
    // The token delete failed and the row delete removed nothing (143). The
    // entry used to be forgotten after a /logout, and the row went on
    // delivering the old account's pushes.
    let pushFails = true;
    const a = loadAuth({ pushFails: () => pushFails });
    const out = a.auth.beginSignOut();
    a.pushTeardown.open();
    await out;
    expect(JSON.parse(a.store.get('auth.pendingSignOut') ?? '[]')).toEqual([{ session: STORED, push: true }]);
    expect(a.events).not.toContain('ghost signOut local');
    // The next retry, with the network back: the whole teardown, then /logout.
    pushFails = false;
    await a.auth.finishPendingSignOuts();
    expect(a.stopPush).toHaveBeenCalledTimes(2);
    expect(a.events[a.events.length - 1]).toBe('ghost signOut local');
    expect(a.store.has('auth.pendingSignOut')).toBe(false);
  });

  it('never runs a sign-out\'s server half twice at once: a retry waits for the one still on the wire', async () => {
    const a = loadAuth();
    const out = a.auth.beginSignOut();
    const retry = a.auth.finishPendingSignOuts();
    await settle();
    expect(a.ghost.auth.setSession).toHaveBeenCalledTimes(1);
    a.pushTeardown.open();
    await out;
    await retry;
    // The first one landed and forgot its entry, so the retry found nothing.
    expect(a.ghost.auth.setSession).toHaveBeenCalledTimes(1);
    expect(a.store.has('auth.pendingSignOut')).toBe(false);
  });

  it.each([
    ['the staged link expired while the browser was open', JSON.stringify({ challenge: 'c'.repeat(40), expiresAt: 1 })],
    ['the link itself failed', JSON.stringify({ challenge: 'c'.repeat(40), expiresAt: Date.now() + 600_000 })],
    ['no link was staged for the marked callback', null],
  ])('takes back the browser Google session with a LOCAL sign-out when %s', async (_name, staged) => {
    // auth-js's bare signOut() is scope 'global': a failed link on a new
    // phone revoked the same Google account's sessions on every device.
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const store = new Map<string, string>([[SESSION_KEY, STORED]]);
    if (staged !== null) {
      store.set('auth.truecallerGoogleLink', staged);
    }
    const a = loadAuth({ store });
    const result = await a.auth.handleAuthDeepLink('companionchat://auth-callback/truecaller-link?code=abc');
    expect(result.status).toBe('failed');
    expect(a.main.auth.signOut.mock.calls).toEqual([[{ scope: 'local' }]]);
    // Through `signOut`: the device half at once, the session's own /logout
    // on the sign-out client, tracked like any other.
    expect(a.store.has(SESSION_KEY)).toBe(false);
    a.pushTeardown.open();
    await a.auth.finishPendingSignOuts();
    expect(a.events).toContain('ghost signOut local');
    expect(a.stopPush).not.toHaveBeenCalled();
    jest.restoreAllMocks();
  });

  const OUTBOX_KEY = 'companion.outbox.v1';
  const QUEUED = JSON.stringify([
    { nonce: 'n-1', conversationId: A, body: 'see you at six', queuedAt: Date.now(), attempts: 0 },
  ]);

  it.each(['beginSignOut', 'signOut', 'deleteAccount'] as const)(
    'forgets the queued sends on %s, so the next account never replays them',
    async entry => {
      // An outbox entry names a conversation and carries the text, and not who
      // queued it; the drain replays every entry as whoever is signed in.
      const a = loadAuth({ store: new Map([[SESSION_KEY, STORED], [OUTBOX_KEY, QUEUED]]) });
      const done = a.auth[entry]();
      if (entry !== 'deleteAccount') {
        // In the synchronous device half, with the session.
        expect(a.store.has(OUTBOX_KEY)).toBe(false);
      }
      a.pushTeardown.open();
      await done;
      expect(a.store.has(OUTBOX_KEY)).toBe(false);
      const { readOutbox } = require('../src/lib/outboxStore') as typeof import('../src/lib/outboxStore');
      expect(readOutbox()).toEqual([]);
    },
  );

  it('keeps the queued sends when the deletion itself fails', async () => {
    const a = loadAuth({ store: new Map([[SESSION_KEY, STORED], [OUTBOX_KEY, QUEUED]]) });
    a.main.rpc.mockImplementation(async () => ({ error: { message: 'offline' } }) as never);
    await expect(a.auth.deleteAccount()).rejects.toThrow('offline');
    expect(a.store.get(OUTBOX_KEY)).toBe(QUEUED);
  });

  it('leaves the device after an account deletion, with nothing kept for a server that has no session left', async () => {
    const a = loadAuth();
    await a.auth.deleteAccount();
    expect(a.main.rpc).toHaveBeenCalledWith('delete_user_account');
    expect(a.store.has(SESSION_KEY)).toBe(false);
    expect(a.store.has('auth.pendingSignOut')).toBe(false);
    expect(a.clearAll).toHaveBeenCalledTimes(1);
    expect(a.ghost.auth.setSession).not.toHaveBeenCalled();
  });

  it('keeps the session when the deletion itself fails', async () => {
    const a = loadAuth();
    a.main.rpc.mockImplementation(async () => ({ error: { message: 'offline' } }) as never);
    await expect(a.auth.deleteAccount()).rejects.toThrow('offline');
    expect(a.store.get(SESSION_KEY)).toBe(STORED);
    expect(a.clearAll).not.toHaveBeenCalled();
  });

  it('names the stored session with supabase-js\'s own key, so nobody is signed out by the upgrade', () => {
    const lib = withoutComments(read('src/lib/supabase.ts'));
    expect(lib).toContain(
      "export const SESSION_STORAGE_KEY = `sb-${new URL(ENV.supabaseUrl).hostname.split('.')[0]}-auth-token`;",
    );
    expect(lib).toContain('storageKey: SESSION_STORAGE_KEY,');
    expect(read('node_modules/@supabase/supabase-js/dist/index.cjs')).toContain(
      'const defaultStorageKey = `sb-${baseUrl.hostname.split(".")[0]}-auth-token`;',
    );
  });
});

describe('every user-initiated sign-out takes the whole teardown', () => {
  it('the permissions gate signs out like Settings, and leaves the gate', () => {
    const app = withoutComments(read('App.tsx'));
    const gate = app.slice(app.indexOf('<PermissionsScreen'), app.indexOf("if (boot.phase === 'error')"));
    expect(gate).toMatch(/onSignOut=\{\(\) => \{\s*queryClient\.clear\(\);\s*resetStore\(\);\s*toSignedOut\(\);\s*beginSignOut\(\)\.catch\(/);
  });

  it('no screen signs out with the bare signOut, except to take back a sign-in that failed half way', () => {
    for (const file of ['App.tsx', 'src/screens/SettingsSheet.tsx', 'src/screens/PermissionsScreen.tsx']) {
      const code = withoutComments(read(file));
      expect({ file, bare: /\bsignOut\(\)/.test(code.replace(/\bbeginSignOut\(\)/g, '')) }).toEqual({ file, bare: false });
    }
    const onboarding = withoutComments(read('src/screens/OnboardingScreen.tsx'));
    expect(count(onboarding, 'await signOut();')).toBe(1);
  });

  it('drops a chat, call or V2 link that arrives with nobody signed in, rather than hold it for the next account', () => {
    // Held in Root's state, which survives signedOut to ready, a leftover
    // shortcut's tap was applied inside whichever account signed in next.
    const app = withoutComments(read('App.tsx'));
    const consume = app.slice(
      app.indexOf('const consume = (url: string | null): void => {'),
      app.indexOf('void Linking.getInitialURL().then(consume);'),
    );
    expect(consume).toMatch(
      /^const consume = \(url: string \| null\): void => \{\s*if \(url === null\) \{\s*return;\s*\}\s*if \(!signedInOnDevice\(\) && isAccountLink\(url\)\) \{/,
    );
    const gate = consume.indexOf('if (!signedInOnDevice() && isAccountLink(url)) {');
    const gateEnd = consume.indexOf('return;', gate);
    for (const hold of ['setPendingV2Peer(', 'setPendingIncoming(', 'setPendingPeer(']) {
      expect({ hold, after: consume.indexOf(hold) > gateEnd }).toEqual({ hold, after: true });
    }
    // Behind the gate, only a leftover call's notification is taken down.
    expect(consume.slice(gate, gateEnd)).not.toMatch(/setPending|endCall|handleAuthDeepLink|setBoot/);
    expect(consume.slice(gate, gateEnd)).toContain('void clearCall(leftoverCall);');
  });

  it('retries a pending sign-out when a signed-out device comes back online', () => {
    const app = withoutComments(read('App.tsx'));
    expect(app).toMatch(
      /onlineManager\.subscribe\(online => \{\s*if \(online && !signedInOnDevice\(\)\) \{\s*void finishPendingSignOuts\(\);\s*\}\s*\}\)/,
    );
  });

  it('finishes a dead process\'s sign-out at every boot, before the session is even read, whatever it finds', () => {
    // A pending server half is the push row still delivering to this phone,
    // signed in or not, so the call is unconditional and first.
    const app = withoutComments(read('App.tsx'));
    expect(app).toMatch(
      /useEffect\(\(\) => \{\s*let cancelled = false;\s*\(async \(\) => \{\s*try \{\s*assertEnv\(\);\s*void resumePendingSignOuts\(\);\s*const hadStoredSession = signedInOnDevice\(\);\s*const \{ session, retryableError \} = await currentSession\(\);/,
    );
    expect(count(app, 'resumePendingSignOuts()')).toBe(1);
  });

  it('the root forgets a tap or a ring held for the account that left', () => {
    const app = withoutComments(read('App.tsx'));
    expect(app).toMatch(
      /const toSignedOut = useCallback\(\(\) => \{\s*setPendingPeer\(null\);\s*setPendingV2Peer\(null\);\s*setPendingIncoming\(null\);\s*setBoot\(\{ phase: 'signedOut' \}\);/,
    );
    expect(app).toContain('onSignedOut={toSignedOut}');
  });

  it('a boot that finds its stored session dead signs out through toSignedOut and runs the device half', () => {
    // A revoked session: a tap held for it at arrival, and its outbox, would
    // otherwise carry into the next sign-in.
    const app = withoutComments(read('App.tsx'));
    expect(app).toMatch(
      /const hadStoredSession = signedInOnDevice\(\);\s*const \{ session, retryableError \} = await currentSession\(\);/,
    );
    expect(app).toMatch(
      /if \(hadStoredSession\) \{\s*void forgetDeadSession\(\);\s*\}\s*toSignedOut\(\);\s*return;\s*\}/,
    );
    // Every signed-out phase set with no message goes through toSignedOut.
    expect(app.match(/setBoot\(\{ phase: 'signedOut' \}\)/g)).toHaveLength(1);
  });
});

describe('a push start stands down for a session that ended before it ran', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('starts nothing when the effect was cleaned up while the permissions config was pending', async () => {
    const h = load();
    let answer: (level: 'optional' | 'required') => void = () => undefined;
    const level = new Promise<'optional' | 'required'>(resolve => {
      answer = resolve;
    });
    const cleanup = h.push.startPushWhenConfigured(() => level);
    cleanup();
    answer('optional');
    await jest.runAllTimersAsync();
    expect(registerCalls(h)).toBe(0);
    expect(h.listenerCount()).toBe(0);
  });

  it('stops what the start returns when the cleanup ran while it was starting', async () => {
    const h = load();
    let release: () => void = () => undefined;
    h.request.mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve('granted');
        }),
    );
    const cleanup = h.push.startPushWhenConfigured(async () => 'optional');
    await jest.advanceTimersByTimeAsync(0);
    cleanup();
    release();
    await jest.runAllTimersAsync();
    expect(h.listenerCount()).toBe(0);
  });

  it('registers and listens as usual when nothing ended it', async () => {
    const h = load();
    const cleanup = h.push.startPushWhenConfigured(async () => 'optional');
    await jest.runAllTimersAsync();
    expect(registerCalls(h)).toBe(1);
    expect(h.listenerCount()).toBe(1);
    cleanup();
    expect(h.listenerCount()).toBe(0);
  });

  it('registers nothing and listens to nothing for a start with no session behind it', async () => {
    // A start that begins after the sign-out takes a fresh generation of its
    // own, so only the account check can see it is stale.
    const h = load();
    await h.push.stopPush();
    h.setSessionUser(null);
    const stop = await h.push.startPush();
    expect(registerCalls(h)).toBe(0);
    expect(h.listenerCount()).toBe(0);
    stop();
  });

  it('registers nothing for a start whose session changed hands while it waited', async () => {
    const h = load();
    let release: () => void = () => undefined;
    h.request.mockImplementation(
      () =>
        new Promise(resolve => {
          release = () => resolve('granted');
        }),
    );
    const started = h.push.startPush();
    await jest.advanceTimersByTimeAsync(0);
    h.setSessionUser('user-b');
    release();
    await started;
    expect(registerCalls(h)).toBe(0);
    expect(h.listenerCount()).toBe(0);
  });
});

describe('a chat covered by a sheet or the media viewer is not on screen (Greptile P1 on 7a9de76)', () => {
  it('reads no viewed conversation while anything covers it, and the chat again after', () => {
    const vc = require('../src/lib/viewingConversation') as typeof import('../src/lib/viewingConversation');
    vc.setViewingConversation(A);
    expect(vc.getViewingConversation()).toBe(A);
    const sheet = vc.coverViewing();
    const viewer = vc.coverViewing();
    expect(vc.getViewingConversation()).toBeNull();
    expect(vc.foregroundPushAction({ conversationId: A }, vc.getViewingConversation())).toBe('show-in-app');
    sheet();
    sheet(); // idempotent: an effect cleanup after an explicit close
    expect(vc.getViewingConversation()).toBeNull();
    viewer();
    expect(vc.getViewingConversation()).toBe(A);
    vc.setViewingConversation(null);
  });

  it('Sheet and MediaViewer cover the screen while open', () => {
    const sheet = read('src/components/Sheet.tsx');
    expect(sheet).toMatch(/if \(!visible\) return;[^]*const uncover = coverViewing\(\);[^]*uncover\(\);/);
    const viewer = read('src/components/MediaViewer.tsx');
    expect(viewer).toContain('useEffect(() => (open ? coverViewing() : undefined), [open]);');
  });
});
