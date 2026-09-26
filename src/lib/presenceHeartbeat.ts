/**
 * The provider app's presence signal (migration 155, owner decision
 * 2026-09-27): `presence_heartbeat(true)` when the app comes to the foreground
 * and every 30 s while it stays there, and `presence_heartbeat(false)` when it
 * leaves. The server turns that into `online` (the switch open, a heartbeat
 * within 75 s, no offline since) and `last_seen_at`, so every surface agrees;
 * this module only reports.
 *
 * Providers only, and that is the caller's job: mount it in the provider tree.
 * The server also ignores a member's call, so a mistake here writes nothing.
 *
 * ONE interval, created on 'active' and cleared on leaving it, so a background
 * provider costs nothing and a double 'active' cannot stack a second timer.
 * 30 s clears the server's 20 s write floor with room for timer jitter, and two
 * missed beats fit inside its 75 s window.
 *
 * The offline is BEST EFFORT. React Native reports 'background' when the
 * Android activity stops (https://reactnative.dev/docs/appstate), and the OS
 * may suspend or kill the process before the request leaves
 * (https://developer.android.com/guide/components/activities/activity-lifecycle,
 * onStop: the process can be killed at any point after). Nothing is retried or
 * held open for it: a lost offline is what the 75 s window covers, and a
 * foreground service to guarantee one would be a notification nobody asked for.
 */
import { AppState, type AppStateStatus } from 'react-native';
import { supabase } from './supabase';

/** Anything that can make the RPC: the app's client, or sign-out's own. */
interface RpcClient {
  rpc: typeof supabase.rpc;
}

export const PRESENCE_HEARTBEAT_MS = 30_000;

/** The slice of React Native's AppState this uses, so a test can drive it. */
export interface AppStateSource {
  currentState: AppStateStatus | string | null;
  addEventListener(
    type: 'change',
    listener: (state: AppStateStatus) => void,
  ): { remove(): void };
}

/**
 * One call to the RPC. Never rejects: presence is decoration, and a failed
 * beat is simply the next one's job.
 *
 * `client` is the app's own by default. Sign-out passes the client that holds
 * the dropped session (`signOutClient`, src/api/auth.ts), because by the time
 * its offline can leave, the app's client has no session to send it as.
 */
export async function sendPresenceHeartbeat(
  online: boolean,
  client: RpcClient = supabase,
): Promise<boolean> {
  try {
    const { error } = await client.rpc('presence_heartbeat', {
      p_online: online,
    });
    return error === null;
  } catch {
    return false;
  }
}

/**
 * The running heartbeat's halt, so sign-out can stop it from outside the tree
 * that started it. One at a time: the provider tree mounts it once, and a
 * restart (a Strict Mode double effect, a role flip) replaces it.
 */
let running: (() => boolean) | null = null;

/**
 * Stops the running heartbeat WITHOUT sending anything, and says whether an
 * online was the last thing it said (so an offline is owed).
 *
 * For sign-out (`leaveDevice` in src/api/auth.ts), which removes the stored
 * session synchronously before its first await. An offline sent from here
 * would go through the app's client after that, find no session, and land as
 * an anonymous call the server refuses; worse, the unmount that follows would
 * send it again, possibly as whoever signs in next. So sign-out halts the
 * heartbeat first, in the same synchronous step, and sends the owed offline
 * itself as the account that is leaving. The tree's own stop is then a no-op.
 */
export function haltPresenceHeartbeat(): boolean {
  const halt = running;
  running = null;
  return halt === null ? false : halt();
}

interface Options {
  appState?: AppStateSource;
  send?: (online: boolean) => Promise<unknown>;
  intervalMs?: number;
}

/**
 * Starts reporting and returns the stop. Stopping (the provider tree
 * unmounting while still signed in, e.g. a role flip) also sends the offline
 * if an online was the last thing said. A SIGN-OUT does not rely on this: it
 * calls `haltPresenceHeartbeat` before clearing the session and sends the
 * offline as the leaving account, so a provider who signs out does not read
 * as online for 75 s.
 */
export function startPresenceHeartbeat({
  appState = AppState,
  send = sendPresenceHeartbeat,
  intervalMs = PRESENCE_HEARTBEAT_MS,
}: Options = {}): () => void {
  let timer: ReturnType<typeof setInterval> | null = null;
  let saidOnline = false;
  let stopped = false;

  const beat = () => {
    void send(true);
  };

  const goOnline = () => {
    if (timer !== null) {
      return;
    }
    saidOnline = true;
    beat();
    timer = setInterval(beat, intervalMs);
  };

  const goOffline = () => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    // Once per departure: 'inactive' then 'background' is one departure.
    if (saidOnline) {
      saidOnline = false;
      void send(false);
    }
  };

  const subscription = appState.addEventListener('change', state => {
    if (stopped) {
      return;
    }
    if (state === 'active') {
      goOnline();
    } else if (state === 'background' || state === 'inactive') {
      goOffline();
    }
  });

  if (appState.currentState === 'active') {
    goOnline();
  }

  /** Quiet everything; returns whether an online was owed its offline. */
  const halt = (): boolean => {
    if (stopped) {
      return false;
    }
    stopped = true;
    subscription.remove();
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
    const owed = saidOnline;
    saidOnline = false;
    return owed;
  };
  running = halt;

  return () => {
    if (running === halt) {
      running = null;
    }
    if (halt()) {
      void send(false);
    }
  };
}
