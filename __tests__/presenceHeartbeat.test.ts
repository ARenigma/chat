jest.mock('../src/lib/supabase', () => ({
  supabase: { rpc: jest.fn() },
}));

import type { AppStateStatus } from 'react-native';
import { supabase } from '../src/lib/supabase';
import {
  PRESENCE_HEARTBEAT_MS,
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

  it('never rejects: an error or a throw is reported as false', async () => {
    mockRpc.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    await expect(sendPresenceHeartbeat(true)).resolves.toBe(false);
    mockRpc.mockRejectedValueOnce(new Error('network'));
    await expect(sendPresenceHeartbeat(true)).resolves.toBe(false);
  });
});
