jest.mock('../src/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

import { readFileSync } from 'fs';
import { join } from 'path';
import type { AppStateStatus } from 'react-native';
import { supabase } from '../src/lib/supabase';
import {
  PRESENCE_HEARTBEAT_MS,
  haltPresenceHeartbeat,
  sendPresenceHeartbeat,
  startPresenceHeartbeat,
  type AppStateSource,
} from '../src/lib/presenceHeartbeat';

const mockRpc = supabase.rpc as jest.Mock;

/** AppState as the heartbeat sees it, driven by hand. */
function fakeAppState(initial: AppStateStatus) {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const source: AppStateSource & { emit(state: AppStateStatus): void } = {
    currentState: initial,
    addEventListener(_type, listener) {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
    emit(state) {
      source.currentState = state;
      for (const listener of [...listeners]) {
        listener(state);
      }
    },
  };
  return { source, listeners };
}

/** What was sent, in order: true for a heartbeat, false for an offline. */
const sent = () =>
  mockRpc.mock.calls.map(([name, args]) => {
    expect(name).toBe('presence_heartbeat');
    return args.p_online as boolean;
  });

describe('the provider presence heartbeat', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('beats at once in the foreground, then every 30 s', () => {
    const { source } = fakeAppState('active');
    const stop = startPresenceHeartbeat({ appState: source });
    expect(sent()).toEqual([true]);

    jest.advanceTimersByTime(PRESENCE_HEARTBEAT_MS - 1);
    expect(sent()).toEqual([true]);
    jest.advanceTimersByTime(1);
    expect(sent()).toEqual([true, true]);
    jest.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 2);
    expect(sent()).toEqual([true, true, true, true]);
    stop();
  });

  it('keeps 30 s clear of the server 20 s floor and inside its 75 s window', () => {
    // The pair the migration depends on: slower than 20 s or beats get
    // dropped, and two missed beats must still land inside 75 s.
    expect(PRESENCE_HEARTBEAT_MS).toBeGreaterThan(20_000);
    expect(PRESENCE_HEARTBEAT_MS * 2).toBeLessThan(75_000);
  });

  it('says nothing while it starts in the background', () => {
    const { source } = fakeAppState('background');
    const stop = startPresenceHeartbeat({ appState: source });
    jest.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 5);
    expect(mockRpc).not.toHaveBeenCalled();

    source.emit('active');
    expect(sent()).toEqual([true]);
    jest.advanceTimersByTime(PRESENCE_HEARTBEAT_MS);
    expect(sent()).toEqual([true, true]);
    stop();
  });

  it('says offline on background and stops the interval', () => {
    const { source } = fakeAppState('active');
    const stop = startPresenceHeartbeat({ appState: source });
    source.emit('background');
    expect(sent()).toEqual([true, false]);

    jest.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 10);
    expect(sent()).toEqual([true, false]);
    expect(jest.getTimerCount()).toBe(0);
    stop();
  });

  it('says offline once for inactive then background', () => {
    const { source } = fakeAppState('active');
    const stop = startPresenceHeartbeat({ appState: source });
    source.emit('inactive');
    source.emit('background');
    expect(sent()).toEqual([true, false]);
    stop();
  });

  it('comes back online on return, with one interval however often active fires', () => {
    const { source } = fakeAppState('active');
    const stop = startPresenceHeartbeat({ appState: source });
    source.emit('background');
    source.emit('active');
    source.emit('active');
    expect(sent()).toEqual([true, false, true]);
    expect(jest.getTimerCount()).toBe(1);

    jest.advanceTimersByTime(PRESENCE_HEARTBEAT_MS);
    expect(sent()).toEqual([true, false, true, true]);
    stop();
  });

  it('ignores states that are not a departure or a return', () => {
    const { source } = fakeAppState('active');
    const stop = startPresenceHeartbeat({ appState: source });
    source.emit('unknown');
    source.emit('extension');
    expect(sent()).toEqual([true]);
    expect(jest.getTimerCount()).toBe(1);
    stop();
  });

  it('says offline when stopped while online, then goes quiet', () => {
    const { source, listeners } = fakeAppState('active');
    const stop = startPresenceHeartbeat({ appState: source });
    stop();
    expect(sent()).toEqual([true, false]);
    expect(listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);

    source.emit('active');
    jest.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 3);
    stop();
    expect(sent()).toEqual([true, false]);
  });

  it('does not repeat the offline when stopped in the background', () => {
    const { source } = fakeAppState('active');
    const stop = startPresenceHeartbeat({ appState: source });
    source.emit('background');
    stop();
    expect(sent()).toEqual([true, false]);
  });

  it('keeps beating through a failed call', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'offline' } });
    mockRpc.mockRejectedValueOnce(new Error('network'));
    const { source } = fakeAppState('active');
    const stop = startPresenceHeartbeat({ appState: source });
    jest.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 2);
    await Promise.resolve();
    expect(sent()).toEqual([true, true, true]);
    stop();
  });
});

describe('haltPresenceHeartbeat, the sign-out stop', () => {
  /*
   * Sign-out removes the stored session synchronously, so an offline sent by
   * the heartbeat itself would leave through a client with no session (or the
   * next account's). The halt quiets it without a word and says whether an
   * offline is owed; sign-out sends that one as the leaving account.
   */
  beforeEach(() => {
    jest.useFakeTimers();
    mockRpc.mockReset();
    mockRpc.mockResolvedValue({ data: null, error: null });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('stops an online heartbeat without sending, and says an offline is owed', () => {
    const { source, listeners } = fakeAppState('active');
    const stop = startPresenceHeartbeat({ appState: source });
    expect(haltPresenceHeartbeat()).toBe(true);
    expect(sent()).toEqual([true]);
    expect(listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);

    // The tree's own stop, when it unmounts after the sign-out, says nothing.
    stop();
    source.emit('active');
    jest.advanceTimersByTime(PRESENCE_HEARTBEAT_MS * 3);
    expect(sent()).toEqual([true]);
  });

  it('owes nothing once the app already said offline, or with nothing running', () => {
    const { source } = fakeAppState('active');
    const stop = startPresenceHeartbeat({ appState: source });
    source.emit('background');
    expect(haltPresenceHeartbeat()).toBe(false);
    expect(sent()).toEqual([true, false]);
    stop();
    expect(haltPresenceHeartbeat()).toBe(false);
  });

  it('forgets a heartbeat the tree already stopped', () => {
    const { source } = fakeAppState('active');
    const stop = startPresenceHeartbeat({ appState: source });
    stop();
    expect(sent()).toEqual([true, false]);
    expect(haltPresenceHeartbeat()).toBe(false);
  });

  it('halts the latest of two starts, as a Strict Mode double effect leaves it', () => {
    const first = fakeAppState('active');
    const stopFirst = startPresenceHeartbeat({ appState: first.source });
    stopFirst();
    const second = fakeAppState('active');
    startPresenceHeartbeat({ appState: second.source });
    expect(haltPresenceHeartbeat()).toBe(true);
    expect(second.listeners.size).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });
});

describe('sendPresenceHeartbeat', () => {
  beforeEach(() => {
    mockRpc.mockReset();
  });

  it('calls the RPC with the state and reports success', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });
    await expect(sendPresenceHeartbeat(false)).resolves.toBe(true);
    expect(mockRpc).toHaveBeenCalledWith('presence_heartbeat', {
      p_online: false,
    });
  });

  it('sends through the client it is given, which is how sign-out says offline', async () => {
    const other = { rpc: jest.fn(async () => ({ data: null, error: null })) };
    await expect(
      sendPresenceHeartbeat(false, other as unknown as typeof supabase),
    ).resolves.toBe(true);
    expect(other.rpc).toHaveBeenCalledWith('presence_heartbeat', { p_online: false });
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it('never rejects: an error or a throw is reported as false', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    await expect(sendPresenceHeartbeat(true)).resolves.toBe(false);
    mockRpc.mockRejectedValueOnce(new Error('network'));
    await expect(sendPresenceHeartbeat(true)).resolves.toBe(false);
  });
});

describe('where the heartbeat is mounted and stopped', () => {
  const ROOT = join(__dirname, '..');
  /** Source with comments removed, so a note cannot satisfy an assertion. */
  const code = (file: string) =>
    readFileSync(join(ROOT, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

  it('runs for the provider tree only, at the top level of SignedIn', () => {
    const app = code('App.tsx');
    const signedIn = app.slice(app.indexOf('function SignedIn('));
    const call = "usePresenceHeartbeat(role === 'provider');";
    expect(signedIn).toContain(call);
    // Beside the provider's chat-request ring, which is gated the same way,
    // and not inside a branch: at two-space indent in the component body.
    const ring = signedIn.indexOf('useIncomingChatRequests(role');
    expect(ring).toBeGreaterThan(-1);
    expect(signedIn.indexOf(call)).toBeGreaterThan(ring);
    expect(signedIn).toContain(`\n  ${call}`);
    // Mounted once, nowhere else.
    expect(app.split('usePresenceHeartbeat(').length - 1).toBe(1);
  });

  it('is halted by sign-out before the stored session is removed', () => {
    const auth = code('src/api/auth.ts');
    const leave = auth.slice(
      auth.indexOf('function leaveDevice('),
      auth.indexOf('function tokensOf('),
    );
    const halt = leave.indexOf('haltPresenceHeartbeat()');
    expect(halt).toBeGreaterThan(-1);
    expect(halt).toBeLessThan(leave.indexOf('storage.remove(SESSION_STORAGE_KEY)'));
    // And the owed offline goes as the leaving account, before `/logout`.
    const tell = auth.slice(
      auth.indexOf('async function tellServer('),
      auth.indexOf('export function beginSignOut('),
    );
    const offline = tell.indexOf('sendPresenceHeartbeat(false, client)');
    expect(offline).toBeGreaterThan(-1);
    expect(offline).toBeLessThan(tell.indexOf("client.auth.signOut({ scope: 'local' })"));
    expect(auth).toContain("tellServer(pending, 'device', presenceOwed)");
  });
});
