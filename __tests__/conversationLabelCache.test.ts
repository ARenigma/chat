/**
 * Tests for src/lib/conversationLabelCache.ts and the push handler's label
 * substitution in src/lib/push.ts.
 *
 * B-BS-3: push notifications must show the user's private conversation label
 * ("rename chat") rather than the sender's real display name.
 *
 * The cache module is exercised directly (per-user keying, clear on sign-out)
 * and the push paths are driven through a thin harness that verifies the right
 * name is passed to the native Conversations module.
 */

/*
 * react-native-mmkv ships ESM that Jest cannot load. Provide a Map-backed stub
 * so storage.ts and the cache module are exercisable without native code.
 */
// Prefixed with `mock` so babel-plugin-jest-hoist allows it inside jest.mock().
const mockMmkvData = new Map<string, string>();
jest.mock('react-native-mmkv', () => ({
  createMMKV: () => ({
    getString: (k: string) => mockMmkvData.get(k),
    set: (k: string, v: string) => { mockMmkvData.set(k, v); },
    delete: (k: string) => { mockMmkvData.delete(k); },
  }),
}));

/*
 * The test must require the module AFTER the mock above is in place.
 * babel-plugin-jest-hoist lifts jest.mock() calls before imports, so the
 * mock IS applied even though the import text appears before it.
 */
import {
  clearLabels,
  getLabel,
  getLabelByPeer,
  setAllLabels,
  setLabel,
  setPeerLabel,
} from '../src/lib/conversationLabelCache';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const USER_A = 'user-a-uuid';
const USER_B = 'user-b-uuid';
const CONV_1 = 'conv-1-uuid';
const CONV_2 = 'conv-2-uuid';
const PEER_1 = 'peer-1-uuid';
const PEER_2 = 'peer-2-uuid';

beforeEach(() => {
  mockMmkvData.clear();
});

// ---------------------------------------------------------------------------
// Cache module: per-user keying
// ---------------------------------------------------------------------------

describe('getLabel', () => {
  it('returns null when no label has been stored', () => {
    expect(getLabel(USER_A, CONV_1)).toBeNull();
  });

  it('returns the stored label for the right user', () => {
    setLabel(USER_A, CONV_1, 'My label');
    expect(getLabel(USER_A, CONV_1)).toBe('My label');
  });

  it('does not cross-contaminate between users', () => {
    setLabel(USER_A, CONV_1, 'Label A');
    setLabel(USER_B, CONV_1, 'Label B');
    expect(getLabel(USER_A, CONV_1)).toBe('Label A');
    expect(getLabel(USER_B, CONV_1)).toBe('Label B');
  });

  it('does not cross-contaminate between conversations', () => {
    setLabel(USER_A, CONV_1, 'First');
    setLabel(USER_A, CONV_2, 'Second');
    expect(getLabel(USER_A, CONV_1)).toBe('First');
    expect(getLabel(USER_A, CONV_2)).toBe('Second');
  });
});

describe('setLabel', () => {
  it('clears a label when the name is empty', () => {
    setLabel(USER_A, CONV_1, 'Something');
    setLabel(USER_A, CONV_1, '');
    expect(getLabel(USER_A, CONV_1)).toBeNull();
  });

  it('clears a label when the name is null', () => {
    setLabel(USER_A, CONV_1, 'Something');
    setLabel(USER_A, CONV_1, null);
    expect(getLabel(USER_A, CONV_1)).toBeNull();
  });

  it('does not erase other conversations for the same user', () => {
    setLabel(USER_A, CONV_1, 'Keep me');
    setLabel(USER_A, CONV_2, 'Change me');
    setLabel(USER_A, CONV_2, 'Changed');
    expect(getLabel(USER_A, CONV_1)).toBe('Keep me');
    expect(getLabel(USER_A, CONV_2)).toBe('Changed');
  });
});

describe('getLabelByPeer', () => {
  it('returns null when no peer label has been stored', () => {
    expect(getLabelByPeer(USER_A, PEER_1)).toBeNull();
  });

  it('returns the stored peer label', () => {
    setPeerLabel(USER_A, PEER_1, 'Dr. Smith');
    expect(getLabelByPeer(USER_A, PEER_1)).toBe('Dr. Smith');
  });

  it('does not cross-contaminate between users', () => {
    setPeerLabel(USER_A, PEER_1, 'For A');
    setPeerLabel(USER_B, PEER_1, 'For B');
    expect(getLabelByPeer(USER_A, PEER_1)).toBe('For A');
    expect(getLabelByPeer(USER_B, PEER_1)).toBe('For B');
  });
});

describe('setPeerLabel', () => {
  it('clears a peer label when the name is empty', () => {
    setPeerLabel(USER_A, PEER_1, 'Has label');
    setPeerLabel(USER_A, PEER_1, '');
    expect(getLabelByPeer(USER_A, PEER_1)).toBeNull();
  });

  it('clears a peer label when the name is null', () => {
    setPeerLabel(USER_A, PEER_1, 'Has label');
    setPeerLabel(USER_A, PEER_1, null);
    expect(getLabelByPeer(USER_A, PEER_1)).toBeNull();
  });
});

describe('setAllLabels', () => {
  it('replaces the conversation index for the user', () => {
    setLabel(USER_A, CONV_1, 'Old');
    const map = new Map([[CONV_2, 'New']]);
    setAllLabels(USER_A, map);
    expect(getLabel(USER_A, CONV_1)).toBeNull(); // CONV_1 not in new map
    expect(getLabel(USER_A, CONV_2)).toBe('New');
  });

  it('writes the peer index when provided', () => {
    const map = new Map([[CONV_1, 'My label']]);
    const peerIndex = new Map([[PEER_1, 'My label']]);
    setAllLabels(USER_A, map, peerIndex);
    expect(getLabelByPeer(USER_A, PEER_1)).toBe('My label');
  });

  it('merges the peer index: a peer outside the loaded inbox keeps its label', () => {
    setPeerLabel(USER_A, PEER_1, 'Outside the inbox');
    setAllLabels(USER_A, new Map([[CONV_2, 'Loaded']]), new Map([[PEER_2, 'Loaded']]));
    expect(getLabelByPeer(USER_A, PEER_1)).toBe('Outside the inbox');
    expect(getLabelByPeer(USER_A, PEER_2)).toBe('Loaded');
  });

  it('clears a loaded peer whose conversation lost its label', () => {
    setPeerLabel(USER_A, PEER_1, 'Old');
    setAllLabels(USER_A, new Map(), new Map([[PEER_1, null]]));
    expect(getLabelByPeer(USER_A, PEER_1)).toBeNull();
  });

  it('does not touch the peer index when not provided', () => {
    setPeerLabel(USER_A, PEER_1, 'Existing peer label');
    const map = new Map([[CONV_1, 'Conv label']]);
    setAllLabels(USER_A, map); // no peerIndex
    expect(getLabelByPeer(USER_A, PEER_1)).toBe('Existing peer label');
  });
});

// ---------------------------------------------------------------------------
// Cache module: clear on sign-out
// ---------------------------------------------------------------------------

describe('clearLabels', () => {
  it('removes all cached labels for the user', () => {
    setLabel(USER_A, CONV_1, 'Gone');
    setLabel(USER_A, CONV_2, 'Also gone');
    setPeerLabel(USER_A, PEER_1, 'Peer gone');
    clearLabels(USER_A);
    expect(getLabel(USER_A, CONV_1)).toBeNull();
    expect(getLabel(USER_A, CONV_2)).toBeNull();
    expect(getLabelByPeer(USER_A, PEER_1)).toBeNull();
  });

  it('does not affect labels belonging to another user', () => {
    setLabel(USER_A, CONV_1, 'A label');
    setLabel(USER_B, CONV_1, 'B label');
    setPeerLabel(USER_B, PEER_1, 'B peer');
    clearLabels(USER_A);
    expect(getLabel(USER_B, CONV_1)).toBe('B label');
    expect(getLabelByPeer(USER_B, PEER_1)).toBe('B peer');
  });
});

// ---------------------------------------------------------------------------
// Push handler: label substitution
// ---------------------------------------------------------------------------

/*
 * The push handler harness mirrors the pattern from pushForeground.test.ts.
 * A fresh module graph per test isolates the module-level state that push.ts
 * and conversations.ts carry.
 */

const STORED_SESSION_KEY = 'test-session-key';
const ACCOUNT_ID = 'account-uuid';

jest.mock('../src/lib/supabase', () => ({
  SESSION_STORAGE_KEY: STORED_SESSION_KEY,
  supabase: {
    rpc: jest.fn(async () => ({ error: null })),
    auth: { getSession: jest.fn(async () => ({ data: { session: null } })) },
  },
}));
jest.mock('../src/lib/storage', () => ({
  storage: {
    get: (k: string) => mockMmkvData.get(k) ?? null,
    set: (k: string, v: string) => { mockMmkvData.set(k, v); },
    remove: (k: string) => { mockMmkvData.delete(k); },
  },
  supabaseStorage: {},
}));
jest.mock('../src/lib/sentry', () => ({ reportSwallowed: jest.fn() }));
jest.mock('../src/lib/permissions', () => ({
  requestAndroidPermission: jest.fn(async () => 'granted'),
  alertPermissionBlocked: jest.fn(),
}));
jest.mock('../src/lib/viewingConversation', () => ({
  declinedAt: jest.fn(() => null),
  foregroundPushAction: jest.fn(() => 'show-in-app'),
  getRingingConversation: jest.fn(() => null),
  getViewingConversation: jest.fn(() => null),
  isViewingCovered: jest.fn(() => false),
  recordPosted: jest.fn(),
  sentBeforeDecline: jest.fn(() => false),
}));
jest.mock('@react-native-firebase/messaging', () => ({
  AuthorizationStatus: { AUTHORIZED: 1, PROVISIONAL: 2 },
  deleteToken: jest.fn(async () => {}),
  getMessaging: jest.fn(() => ({})),
  getToken: jest.fn(async () => 'fake-token'),
  onMessage: jest.fn(() => () => {}),
  onTokenRefresh: jest.fn(() => () => {}),
  requestPermission: jest.fn(async () => 1),
}));

/** Store a mock session for the account so storedAccountId() returns it. */
function signInAccount(id: string = ACCOUNT_ID): void {
  mockMmkvData.set(STORED_SESSION_KEY, JSON.stringify({ user: { id } }));
}

describe('handleBackgroundPush label substitution', () => {
  function loadPush() {
    jest.resetModules();
    const rn = require('react-native') as typeof import('react-native');
    Object.defineProperty(rn.Platform, 'OS', { value: 'android', configurable: true });
    Object.defineProperty(rn.Platform, 'Version', { get: () => 34, configurable: true });
    jest.spyOn(rn.PermissionsAndroid, 'check').mockResolvedValue(true);

    const native = {
      notify: jest.fn(async () => true),
      notifyChatRequest: jest.fn(async () => true),
      notifyCall: jest.fn(async () => true),
      notifyEngagement: jest.fn(async () => true),
      ensureChannel: jest.fn(async () => {}),
      pushLog: jest.fn(),
      clear: jest.fn(async () => {}),
      clearCall: jest.fn(async () => {}),
      clearAll: jest.fn(async () => {}),
      clearRequest: jest.fn(async () => {}),
      startCallForegroundService: jest.fn(),
      stopCallForegroundService: jest.fn(),
    };
    (rn.NativeModules as Record<string, unknown>).Conversations = native;

    const push = require('../src/lib/push') as typeof import('../src/lib/push');
    return { push, native };
  }

  it('uses the cached label instead of senderName for a message push', async () => {
    signInAccount(ACCOUNT_ID);
    setLabel(ACCOUNT_ID, CONV_1, 'My trusted contact');

    const { push, native } = loadPush();
    await push.handleBackgroundPush(
      {
        data: {
          conversationId: CONV_1,
          peerId: PEER_1,
          senderName: 'Real Name',
          sentAt: String(Date.now()),
          recipientId: ACCOUNT_ID,
        },
      },
      async () => {},
    );

    expect(native.notify).toHaveBeenCalledTimes(1);
    const [, , name] = native.notify.mock.calls[0] as unknown[];
    expect(name).toBe('My trusted contact');
  });

  it('falls back to senderName when no label is cached', async () => {
    signInAccount(ACCOUNT_ID);
    // No label set for CONV_2.

    const { push, native } = loadPush();
    await push.handleBackgroundPush(
      {
        data: {
          conversationId: CONV_2,
          peerId: PEER_2,
          senderName: 'Real Name',
          sentAt: String(Date.now()),
          recipientId: ACCOUNT_ID,
        },
      },
      async () => {},
    );

    expect(native.notify).toHaveBeenCalledTimes(1);
    const [, , name] = native.notify.mock.calls[0] as unknown[];
    expect(name).toBe('Real Name');
  });

  it('uses the peer-keyed label for an incoming call push', async () => {
    signInAccount(ACCOUNT_ID);
    setPeerLabel(ACCOUNT_ID, PEER_1, 'My doctor');

    const { push, native } = loadPush();
    await push.handleBackgroundPush(
      {
        data: {
          kind: 'call',
          callId: 'call-1',
          peerId: PEER_1,
          senderName: 'Real Name',
          medium: 'voice',
          recipientId: ACCOUNT_ID,
        },
      },
      async () => {},
    );

    expect(native.notifyCall).toHaveBeenCalledTimes(1);
    // notifyCall(callId, peerId, callerName, avatarUrl, medium, recipientId)
    const [, , callerName] = native.notifyCall.mock.calls[0] as unknown[];
    expect(callerName).toBe('My doctor');
  });

  it('falls back to callerName when no peer label is cached', async () => {
    signInAccount(ACCOUNT_ID);
    // No peer label for PEER_2.

    const { push, native } = loadPush();
    await push.handleBackgroundPush(
      {
        data: {
          kind: 'call',
          callId: 'call-2',
          peerId: PEER_2,
          senderName: 'Real Name',
          medium: 'voice',
          recipientId: ACCOUNT_ID,
        },
      },
      async () => {},
    );

    expect(native.notifyCall).toHaveBeenCalledTimes(1);
    const [, , callerName] = native.notifyCall.mock.calls[0] as unknown[];
    expect(callerName).toBe('Real Name');
  });
});
