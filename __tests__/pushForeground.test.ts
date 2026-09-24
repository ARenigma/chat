import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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
  const events: string[] = [];
  supabase.rpc.mockImplementation(async () => {
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

  it('still clears its own conversation while a ring for another one is up', () => {
    const { viewing, screen, clear } = mount();
    viewing.setRingingConversation(B);
    screen(A);
    expect(clear.mock.calls).toEqual([[A]]);
    viewing.setRingingConversation(null);
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
        /synchronized\(postLock\) \{\s*val live = activeNotification\(manager, id\) \?: return@execute/,
      );
      expect(count(body, 'synchronized(postLock)')).toBe(2);
      // The download is outside it: the lock never waits on the network.
      const download = body.indexOf('loadAvatarBitmap(');
      expect(download).toBeGreaterThan(-1);
      expect(download).toBeLessThan(body.lastIndexOf('synchronized(postLock)'));
    },
  );

  it('cancels under the same lock, so a fill cannot put a cleared notification back', () => {
    const clear = slice('fun clear(context: Context, conversationId: String) {', '\n    }\n');
    expect(clear).toMatch(/synchronized\(postLock\) \{\s*NotificationManagerCompat\.from\(context\)\.cancel\(notificationId\(conversationId\)\)/);
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
    expect(count(module, 'inApp: Boolean,\n        silent: Boolean,\n        promise: Promise,')).toBe(2);
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
    expect(push).toMatch(/export function stopPush\(\): Promise<void> \{\s*halt\(\);\s*const run = revoke\(\);\s*teardown = run\.catch\(\(\) => undefined\);/);
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

  /** The store as the ring sees it: its request, and the two actions it calls. */
  interface RingStore {
    incomingRequest: typeof REQUEST_ROW | null;
    clearIncomingRequest: jest.Mock;
    setNotice: jest.Mock;
  }

  interface RingOptions {
    /** AppState when the ring starts. */
    startState?: 'active' | 'background';
    /**
     * A V2 chat already on screen under the ring, mounted (and so subscribed
     * to AppState) before it, as it is when the provider is in a thread when
     * the request arrives.
     */
    chatUnder?: string;
  }

  function mountRing({ startState = 'active', chatUnder }: RingOptions = {}) {
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
    const store: RingStore = {
      incomingRequest: REQUEST_ROW,
      clearIncomingRequest: jest.fn(),
      setNotice: jest.fn(),
    };
    store.clearIncomingRequest.mockImplementation(() => {
      store.incomingRequest = null;
    });
    const useStore = Object.assign(
      (select: (state: RingStore) => unknown) => select(store),
      { getState: () => store },
    );
    jest.doMock('../src/store/useStore', () => ({ useStore }));
    const accept = { mutate: jest.fn(), isPending: false };
    const decline = { mutate: jest.fn(), isPending: false };
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
    (rn.NativeModules as Record<string, unknown>).Conversations = { clear };

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
    const tree = ChatRingScreen({ onOpenConversation });
    // One effect, the ring's clock; run it the way React would on mount.
    expect(effects).toHaveLength(1);
    const cleanup = effects.map(effect => effect())[0];
    return {
      tree,
      store,
      clear,
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

  /**
   * Answer the latest `mutate` on `hook` the way TanStack Query calls a
   * mutate's own callbacks, arguments and all: onSuccess(data, variables,
   * onMutateResult, context) or onError(error, variables, onMutateResult,
   * context), then onSettled(data, error, variables, onMutateResult, context)
   * either way, with `error` null on success.
   */
  function answer(
    hook: { mutate: jest.Mock },
    outcome: 'success' | 'error',
    data: unknown = undefined,
  ): void {
    const calls = hook.mutate.mock.calls;
    const [variables, callbacks] = calls[calls.length - 1] as [RequestVariables, MutateCallbacks];
    if (outcome === 'success') {
      callbacks.onSuccess?.(data, variables, undefined, MUTATION_CONTEXT);
      callbacks.onSettled?.(data, null, variables, undefined, MUTATION_CONTEXT);
    } else {
      const error = new Error('TypeError: Network request failed');
      callbacks.onError?.(error, variables, undefined, MUTATION_CONTEXT);
      callbacks.onSettled?.(undefined, error, variables, undefined, MUTATION_CONTEXT);
    }
  }

  /** Press Decline, check nothing ends on the press itself, then answer it. */
  function declineAnd(ring: Ring, outcome: 'success' | 'error'): void {
    press(ring, 'chat-ring-decline');
    expect(ring.decline.mutate).toHaveBeenCalledTimes(1);
    expect(ring.decline.mutate.mock.calls[0][0]).toEqual({ requestId: REQUEST, conversationId: A });
    // Nothing ends on the press itself, only when the RPC answers.
    expect(ring.clear).not.toHaveBeenCalled();
    expect(ring.clearIncomingRequest).not.toHaveBeenCalled();
    answer(ring.decline, outcome);
  }

  it('clears the notification when the provider declines in the app', () => {
    const ring = mountRing();
    declineAnd(ring, 'success');
    // The ring and its shade entry end together, once the server took it.
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.clear.mock.calls).toEqual([[A]]);
    expect(ring.setNotice).not.toHaveBeenCalled();
  });

  it('keeps the ring and the notification when the decline does not reach the server, and says so', () => {
    // The request is still pending. Clearing on settle took away both ways to
    // answer it: the ring and the shade entry.
    const ring = mountRing();
    declineAnd(ring, 'error');
    expect(ring.clearIncomingRequest).not.toHaveBeenCalled();
    expect(ring.clear).not.toHaveBeenCalled();
    expect(ring.setNotice.mock.calls).toEqual([['Could not decline. Try again.']]);
    // Still ringing, so its pushes still go to the shade without a banner.
    expect(ring.viewing.getRingingConversation()).toBe(A);
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
    expect(ring).toContain("import { clearConversation } from '../lib/conversations';");
    // A decline that landed, and a ring leaving its own chat on screen
    // (`clearIfUncovered`). Never a ring-out on its own.
    expect(count(ring, 'void clearConversation(conversationId);')).toBe(2);
  });

  /* A Decline still on the wire when the ring runs out ------------------- */

  it('leaves the notification when the ring runs out on a Decline in flight, and points to the thread if it fails', () => {
    const ring = mountRing();
    jest.advanceTimersByTime(20_000);
    press(ring, 'chat-ring-decline');
    jest.advanceTimersByTime(10_000);
    // The ring is gone, watched to the end...
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    // ...but the answer has not landed, so its notification stays.
    expect(ring.clear).not.toHaveBeenCalled();
    answer(ring.decline, 'error');
    expect(ring.clear).not.toHaveBeenCalled();
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    // No ring left to try again on; the thread has its own Decline.
    expect(ring.setNotice.mock.calls).toEqual([['Could not decline. It is still waiting in the chat.']]);
  });

  it('clears the notification when that Decline lands after the ring-out', () => {
    const ring = mountRing();
    jest.advanceTimersByTime(20_000);
    press(ring, 'chat-ring-decline');
    jest.advanceTimersByTime(10_000);
    expect(ring.clear).not.toHaveBeenCalled();
    answer(ring.decline, 'success');
    expect(ring.clear.mock.calls).toEqual([[A]]);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.setNotice).not.toHaveBeenCalled();
  });

  it('keeps the notification through a ring-out after a failed Decline has settled', () => {
    const ring = mountRing();
    jest.advanceTimersByTime(5_000);
    declineAnd(ring, 'error');
    expect(ring.setNotice.mock.calls).toEqual([['Could not decline. Try again.']]);
    jest.advanceTimersByTime(25_000);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.clear).not.toHaveBeenCalled();
  });

  it.each([
    ['accept', 'chat-ring-accept'],
    ['decline', 'chat-ring-decline'],
  ] as const)('does not end a newer ring when a late %s lands', (kind, testID) => {
    // The store's clear is unconditional, so an answer for a ring that ran
    // out would end whichever request rings now.
    const NEWER = 'eeeeeeee-0000-4000-8000-00000000000e';
    const ring = mountRing();
    jest.advanceTimersByTime(20_000);
    press(ring, testID);
    jest.advanceTimersByTime(10_000);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    ring.store.incomingRequest = { ...REQUEST_ROW, requestId: NEWER, conversationId: B };
    answer(kind === 'accept' ? ring.accept : ring.decline, 'success', kind === 'accept' ? 'session-1' : undefined);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
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

  it('clears it on Accept when that chat is already the screen underneath', () => {
    // Accept opens the chat that is already mounted, so nothing mounts again
    // to take the notification out of the shade.
    const ring = mountRing({ chatUnder: A });
    press(ring, 'chat-ring-accept');
    expect(ring.clear).not.toHaveBeenCalled();
    answer(ring.accept, 'success', 'session-1');
    expect(ring.clear.mock.calls).toEqual([[A]]);
    expect(ring.clearIncomingRequest).toHaveBeenCalledTimes(1);
    expect(ring.onOpenConversation.mock.calls).toEqual([[PEER]]);
  });

  it('leaves it to the chat that opens when Accept is pressed over a different one', () => {
    const ring = mountRing({ chatUnder: B });
    press(ring, 'chat-ring-accept');
    answer(ring.accept, 'success', 'session-1');
    expect(ring.clear).not.toHaveBeenCalled();
    expect(ring.onOpenConversation.mock.calls).toEqual([[PEER]]);
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
    expect(stop).toMatch(/halt\(\);\s*const run = revoke\(\);/);
    expect(stop).toMatch(/async function revoke\(\): Promise<void> \{\s*try \{[^]*\} catch \(err\) \{/);
    // The wait for a registration on the wire is inside that try, and first.
    expect(stop).toMatch(/try \{\s*await drainRegistrations\(STOP_DRAIN_MS\);\s*const token = await getToken/);
  });
});

describe('the lock-screen Decline clears under the post lock', () => {
  it('ChatRequestReceiver cancels through Conversations.clear, never a bare cancel', () => {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../android/app/src/main/java/com/companionchat/ChatRequestReceiver.kt'),
      'utf8',
    ) as string;
    expect(src).toContain('Conversations.clear(context, conversationId)');
    expect(src).not.toMatch(/NotificationManagerCompat[\s\S]*\.cancel\(/);
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

  it('records the whole sign-out, push teardown included, the moment it starts', () => {
    const begin = bodyOf('export function beginSignOut(');
    expect(begin).toMatch(/await stopPush\(\);\s*await signOut\(\);/);
    expect(begin).toMatch(/\}\)\(\);\s*trackSignOut\(run\);\s*return run;/);
    expect(bodyOf('export function signOut(')).toMatch(/const run = endSession\(\);\s*trackSignOut\(run\);/);
    // Never rejects into a sign-in.
    expect(auth).toMatch(/run\.catch\(\(\) => undefined\)/);
  });

  it('Settings signs out through beginSignOut, not its own unrecorded chain', () => {
    const settings = read('src/screens/SettingsSheet.tsx');
    const press = settings.slice(settings.indexOf('const onSignOutPress'), settings.indexOf('}, [onSignedOut, queryClient]);'));
    expect(press).toContain('beginSignOut()');
    expect(press).not.toMatch(/await stopPush\(\)|await signOut\(\)/);
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
