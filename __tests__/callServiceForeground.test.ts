/**
 * A call's foreground service starts only while the app is in the foreground
 * (Sentry 150792524: a ring routed to the call screen while backgrounded
 * started it from the background and Android 14 killed the app).
 * https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start
 */
import * as fs from 'fs';
import * as path from 'path';

type Listener = (state: string) => void;

function load(initialState: string) {
  const listeners = new Set<Listener>();
  const native = {
    startCallForegroundService: jest.fn(),
    stopCallForegroundService: jest.fn(),
  };
  const appState = {
    currentState: initialState,
    addEventListener: jest.fn((_: string, fn: Listener) => {
      listeners.add(fn);
      return { remove: () => listeners.delete(fn) };
    }),
  };
  let mod: typeof import('../src/lib/conversations') | undefined;
  jest.isolateModules(() => {
    jest.doMock('react-native', () => ({
      AppState: appState,
      NativeModules: { Conversations: native },
      Platform: { OS: 'android' },
    }));
    mod = require('../src/lib/conversations');
  });
  const emit = (state: string) => {
    appState.currentState = state;
    for (const fn of [...listeners]) fn(state);
  };
  return { mod: mod!, native, emit, listeners };
}

describe('call foreground service waits for the foreground', () => {
  it('starts at once when the app is active', () => {
    const { mod, native } = load('active');
    mod.startCallForegroundService('Ravi', true, true);
    expect(native.startCallForegroundService).toHaveBeenCalledWith('Ravi', true, true, false);
  });

  it('defers while backgrounded and starts when the app comes forward', () => {
    const { mod, native, emit } = load('background');
    mod.startCallForegroundService('Ravi', true, true);
    expect(native.startCallForegroundService).not.toHaveBeenCalled();
    emit('inactive');
    expect(native.startCallForegroundService).not.toHaveBeenCalled();
    emit('active');
    expect(native.startCallForegroundService).toHaveBeenCalledTimes(1);
  });

  it('keeps only the latest deferred request', () => {
    const { mod, native, emit, listeners } = load('background');
    mod.startCallForegroundService('Incoming call', true, true);
    mod.startCallForegroundService('Ravi', true, true);
    expect(listeners.size).toBe(1);
    emit('active');
    expect(native.startCallForegroundService).toHaveBeenCalledTimes(1);
    expect(native.startCallForegroundService).toHaveBeenCalledWith('Ravi', true, true, false);
  });

  it('a stop cancels a start still waiting for the foreground', () => {
    const { mod, native, emit } = load('background');
    mod.startCallForegroundService('Ravi', true, true);
    mod.stopCallForegroundService();
    emit('active');
    expect(native.startCallForegroundService).not.toHaveBeenCalled();
    expect(native.stopCallForegroundService).toHaveBeenCalledTimes(1);
  });

  it('the native start catches the background refusal instead of crashing', () => {
    const kt = fs.readFileSync(
      path.join(__dirname, '../android/app/src/main/java/com/companionchat/CallForegroundService.kt'),
      'utf8',
    );
    const start = kt.slice(kt.indexOf('fun start('), kt.indexOf('fun stop('));
    expect(start).toMatch(/try\s*\{\s*ContextCompat\.startForegroundService/);
    expect(start).toContain('catch (e: IllegalStateException)');
  });
});
