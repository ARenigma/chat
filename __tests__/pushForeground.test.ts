import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

  it('ignores a push for the conversation ringing in-app', () => {
    // The member's first message and the ring are one event: the full-screen
    // ring is already telling it, and a banner over it opened the chat
    // underneath the ring.
    expect(foregroundPushAction({ conversationId: A }, null, true, A)).toBe('ignore');
  });

  it('still shows a banner for a different conversation while a ring is up', () => {
    expect(foregroundPushAction({ conversationId: A }, null, true, B)).toBe('show-in-app');
    expect(foregroundPushAction({ conversationId: A }, B, true, B)).toBe('show-in-app');
  });

  it('still alerts for the ringing conversation when the phone is not in use', () => {
    expect(foregroundPushAction({ conversationId: A }, null, false, A)).toBe('show');
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
    pushLog: jest.Mock;
    ensureChannel: jest.Mock;
  };
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
  },
}));

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
  const { supabase } = require('../src/lib/supabase') as { supabase: { rpc: jest.Mock } };

  const native = {
    notify: jest.fn(async () => true),
    notifyChatRequest: jest.fn(async () => true),
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
  supabase.rpc.mockImplementation(async () => ({ error: null }));

  const push = require('../src/lib/push') as PushModule;
  const viewing = require('../src/lib/viewingConversation') as ViewingModule;

  return {
    push,
    viewing,
    native,
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

  it('posts nothing for the conversation ringing in the app, and a banner for any other', () => {
    const h = load();
    const { deliver } = subscribe(h);
    h.viewing.setRingingConversation(A);
    deliver(message(A));
    expect(h.native.notify).not.toHaveBeenCalled();
    expect(h.logs()).toContain('foreground message: ignore');
    deliver(message(B));
    expect(h.native.notify).toHaveBeenCalledTimes(1);
    expect(h.native.notify.mock.calls[0][0]).toBe(B);
    expect(h.native.notify.mock.calls[0][6]).toBe(true);
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
  });

  it('alerts when the delivery lands while AppState is not active', () => {
    const h = load();
    const { deliver } = subscribe(h);
    h.setCurrentState('background');
    deliver(message(A));
    expect(h.native.notify.mock.calls[0][6]).toBe(false);
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
    expect(count(code, 'quiet = true')).toBe(1);
    // Declaration, channel builder, route's post and route's lookup: nothing
    // else names it, so no builder can post on it except through `route`.
    expect(count(code, 'CHANNEL_IN_APP')).toBe(4);
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
    // None made there, or one made on Messages itself: Messages decides, with
    // its sound, as it always did.
    expect(background).toContain(
      'if (inAppChoice == null || messages?.conversationId != null) {\n            return Route(CHANNEL_ID, quiet = false)',
    );
    // Turned off: no post. Below HIGH: Messages, quieted.
    expect(background).toContain(
      'if (inAppChoice.importance == NotificationManagerCompat.IMPORTANCE_NONE) {\n            return null',
    );
    expect(background).toContain(
      'quiet = inAppChoice.importance < NotificationManagerCompat.IMPORTANCE_HIGH,',
    );
    expect(route).toContain('): Route? {');
  });

  /** One builder's body, comments removed: from its `fun` to the next declaration. */
  function builder(start: string, end: string): string {
    return slice(start, end);
  }

  const builders: Array<[string, string]> = [
    // notify() ends where the helper it reads the live transcript with begins.
    ['    fun notify(\n', '    private fun activeMessagingStyle('],
    ['    fun notifyChatRequest(\n', '    private fun callActionIntent('],
  ];

  it.each(builders)('posts on the routed channel, with no sound of its own in-app, in %j', (start, end) => {
    const body = builder(start, end);
    expect(body).toContain('inApp: Boolean = false,');
    // A null route is the person having turned the conversation off: no post.
    expect(count(body, 'val route = route(manager, conversationId, inApp) ?: return')).toBe(1);
    expect(count(body, 'NotificationCompat.Builder(context, route.channelId)')).toBe(1);
    // The route's quiet flag reaches the builder, or the yield is only a
    // channel choice and a turned-down Messages still sounds in the app.
    expect(count(body, '.setSilent(route.quiet)')).toBe(1);
    expect(body).not.toContain('NotificationCompat.Builder(context, CHANNEL_ID)');
    // Below 26 the channel is ignored and the defaults ARE the alert: none
    // for an in-app post, sound and vibration for a background one.
    expect(body).toContain(
      'if (inApp) 0 else NotificationCompat.DEFAULT_SOUND or NotificationCompat.DEFAULT_VIBRATE',
    );
    // The flag touches the route and the defaults, and nothing else.
    expect(body.match(/\binApp\b/g)).toEqual(['inApp', 'inApp', 'inApp']);
  });

  it.each(builders)(
    'extends the live transcript whichever channel posted last, in %j',
    (start, end) => {
      const body = builder(start, end);
      // The text post: the transcript on screen is read back BEFORE the new
      // line is added, then that same style is posted.
      const readBack = body.indexOf('val style = activeMessagingStyle(manager, id)');
      const add = body.indexOf('style.addMessage(', readBack);
      const post = body.indexOf('post(style, null)', add);
      expect(readBack).toBeGreaterThan(-1);
      expect(add).toBeGreaterThan(readBack);
      expect(post).toBeGreaterThan(add);
      // The photo fill re-reads what is live at that moment, never the copy
      // captured above, and is the only post that is an update.
      const live = body.indexOf('val live = activeMessagingStyle(manager, id) ?: return@execute');
      expect(live).toBeGreaterThan(post);
      expect(body.indexOf('post(withSenderIcon(live, peerId, icon), icon, photoFill = true)')).toBeGreaterThan(live);
      expect(count(body, 'photoFill = true')).toBe(1);
      expect(count(body, '.setOnlyAlertOnce(photoFill)')).toBe(1);
    },
  );

  it('reads the transcript back by notification id alone, never by channel', () => {
    // A background post on Messages and a foreground post on the in-app
    // channel share one id, so a lookup that filtered on the channel would
    // start a fresh transcript every time the two alternated.
    const lookup = slice('private fun activeMessagingStyle(', 'private fun withSenderIcon(');
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
    ]) {
      expect({ page, cited: kt.includes(page) }).toEqual({ page, cited: true });
    }
  });

  it('crosses the bridge on both methods', () => {
    expect(count(module, 'inApp: Boolean,')).toBe(2);
    expect(count(module, 'inApp = inApp,')).toBe(2);
    expect(count(bridge, 'options.inApp === true')).toBe(2);
    expect(bridge).toContain("options: NotifyOptions = {}");
    expect(module).not.toMatch(/\bsilent\b/);
    expect(bridge).not.toMatch(/\bsilent\b/);
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
    expect(foreground).toContain("inApp: action === 'show-in-app'");
    expect(foreground).toContain('notifyChatRequest(push, options)');
    expect(foreground).toContain('notifyConversation(push, MESSAGE_BODY, options)');
  });

  it('uses the same copy as the background handler, since both extend one transcript', () => {
    const body = /const MESSAGE_BODY = '([^']+)';/.exec(push)?.[1];
    expect(body).toBeDefined();
    expect(withoutComments(read('index.js'))).toContain(
      `await notifyConversation(push, '${body}');`,
    );
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
    expect(push).toMatch(/export async function stopPush\(\): Promise<void> \{\s*halt\(\);/);
  });

  it('carries the start generation into registration instead of re-reading it later', () => {
    const start = push.slice(push.indexOf('export async function startPush'), push.indexOf('export async function stopPush'));
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
    expect(lib).toMatch(/return \(\) => \{\s*subscription\.remove\(\);\s*release\(\);/);
  });

  it('starts push once, at the ready phase, above the member/provider split', () => {
    const app = withoutComments(read('App.tsx'));
    // Exactly one caller in the app, and it is Root's ready effect.
    expect(count(app, 'await startPush()')).toBe(2);
    const effect = app.slice(app.indexOf("if (boot.phase !== 'ready') {"));
    expect(effect.indexOf('startPush()')).toBeLessThan(effect.indexOf('}, [boot.phase]);'));
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

  function mountRing(startState: 'active' | 'background' = 'active') {
    jest.resetModules();
    const effects: Array<() => void | (() => void)> = [];
    jest.doMock('react', () => ({
      ...jest.requireActual('react'),
      useEffect: (effect: () => void | (() => void)) => {
        effects.push(effect);
      },
      useState: <T,>(initial: T) => [initial, () => undefined],
      useCallback: <T,>(callback: T) => callback,
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
    const clearIncomingRequest = jest.fn();
    jest.doMock('../src/store/useStore', () => ({
      useStore: (select: (state: object) => unknown) =>
        select({ incomingRequest: REQUEST_ROW, clearIncomingRequest }),
    }));
    const decline = { mutate: jest.fn(), isPending: false };
    jest.doMock('../src/api/sessions', () => ({
      useAcceptSessionRequest: () => ({ mutate: jest.fn(), isPending: false }),
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
    (rn.NativeModules as Record<string, unknown>).Conversations = { clear };

    const { ChatRingScreen } = require('../src/components/ChatRingScreen') as typeof import('../src/components/ChatRingScreen');
    // The same module instance the component imported, so its signal is ours.
    const viewing = require('../src/lib/viewingConversation') as ViewingModule;
    const tree = ChatRingScreen({ onOpenConversation: jest.fn() });
    // One effect, the ring's clock; run it the way React would on mount.
    expect(effects).toHaveLength(1);
    const cleanup = effects.map(effect => effect())[0];
    return {
      tree,
      clear,
      clearIncomingRequest,
      decline,
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

  it('clears the notification when the provider declines in the app', () => {
    const ring = mountRing();
    const button = byTestId(ring.tree, 'chat-ring-decline');
    expect(button?.props.onPress).toBeDefined();
    button!.props.onPress!();
    expect(ring.decline.mutate).toHaveBeenCalledTimes(1);
    const [variables, callbacks] = ring.decline.mutate.mock.calls[0] as [
      { requestId: string; conversationId: string },
      { onSettled: () => void },
    ];
    expect(variables).toEqual({ requestId: REQUEST, conversationId: A });
    // The ring and its shade entry end together, when the RPC settles.
    expect(ring.clear).not.toHaveBeenCalled();
    callbacks.onSettled();
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.clear.mock.calls).toEqual([[A]]);
  });

  it('clears the notification when the ring is watched to the end', () => {
    const ring = mountRing();
    jest.advanceTimersByTime(29_000);
    expect(ring.clearIncomingRequest).not.toHaveBeenCalled();
    expect(ring.clear).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1_000);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.clear.mock.calls).toEqual([[A]]);
    // Once: the clock stops itself rather than waiting for the re-render.
    jest.advanceTimersByTime(5_000);
    expect(ring.clear).toHaveBeenCalledTimes(1);
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
    const ring = mountRing('background');
    jest.advanceTimersByTime(30_000);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.clear).not.toHaveBeenCalled();
  });

  it('holds the ringing signal while the ring is up and in use, and lets go on every departure', () => {
    const ring = mountRing();
    expect(ring.viewing.getRingingConversation()).toBe(A);
    ring.appState('background');
    expect(ring.viewing.getRingingConversation()).toBeNull();
    ring.appState('active');
    expect(ring.viewing.getRingingConversation()).toBe(A);
    ring.unmount();
    expect(ring.viewing.getRingingConversation()).toBeNull();
  });

  it('claims nothing for a ring that starts with nobody looking', () => {
    const ring = mountRing('background');
    expect(ring.viewing.getRingingConversation()).toBeNull();
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
    expect(ring).toContain("import { clearConversation } from '../lib/conversations';");
    expect(count(ring, 'void clearConversation(conversationId);')).toBe(2);
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
    const stop = push.slice(push.indexOf('export async function stopPush'), push.indexOf('const MESSAGE_BODY'));
    expect(stop).toMatch(/halt\(\);\s*try \{[^]*\} catch \(err\) \{/);
  });
});
