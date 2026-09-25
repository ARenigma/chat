import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ENV } from './env';
import { supabaseStorage } from './storage';
import type { Database } from './database.types';

/**
 * Every REST/RPC/Edge-Function call gets a hard ceiling.
 *
 * Without this, a half-open TCP connection (common on a phone flipping between
 * cell and Wi-Fi) hangs the request forever: the promise never settles, so the
 * screen sits on a spinner with no error and no retry. Found in the 2026-09-09
 * launch audit (networking dimension). 30s is generous for our payloads (short
 * voice notes, render-sized images, small JSON) while still turning an infinite
 * hang into a retryable failure.
 *
 * AbortController + setTimeout rather than `AbortSignal.timeout()`, which Hermes
 * does not reliably ship. A caller-provided signal still wins — we abort on
 * whichever fires first — so `.abortSignal()` on a query keeps working. The
 * realtime websocket has its own transport and is unaffected.
 */
const REQUEST_TIMEOUT_MS = 30000;

function fetchWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const callerSignal = init?.signal;
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort();
    } else {
      callerSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  return fetch(input, { ...init, signal: controller.signal }).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * The storage key the session is kept under in `supabaseStorage`.
 *
 * Exactly the key supabase-js derives when none is passed
 * (`sb-<project ref>-auth-token`, from the URL's first label), stated here
 * rather than left implicit so sign-out can drop the stored session
 * synchronously as its FIRST step (`beginSignOut` in src/api/auth.ts). A
 * different value would sign every installed device out on upgrade, which is
 * why a test pins it to supabase-js's own formula.
 */
export const SESSION_STORAGE_KEY = `sb-${new URL(ENV.supabaseUrl).hostname.split('.')[0]}-auth-token`;

/**
 * `detectSessionInUrl: false` because React Native has no URL bar, the OAuth
 * code arrives through a deep link and is exchanged explicitly in
 * `src/api/auth.ts`. `flowType: 'pkce'` is what makes that exchange safe on a
 * device that cannot hold a client secret.
 */
export const supabase = createClient<Database>(ENV.supabaseUrl, ENV.supabaseAnonKey, {
  auth: {
    storage: supabaseStorage,
    storageKey: SESSION_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
  },
  global: {
    fetch: fetchWithTimeout,
  },
  realtime: {
    params: {
      // Typing broadcasts are the high-frequency traffic here and they are
      // already throttled at the source; this is the backstop that keeps a
      // pathological client from being disconnected by the server.
      eventsPerSecond: 10,
    },
  },
});

/**
 * A client of its own for the server half of a sign-out, holding the session
 * being signed out in memory and nowhere else.
 *
 * Sign-out drops the device's session first (`beginSignOut`), so a sign-in can
 * start at once, and the requests that still need the old account's identity
 * (the push_tokens row delete, and `/logout`) run on this instead of the app's
 * client, which by then may hold the next account's session. Ending the old
 * session through the app's client is exactly what ended new sessions: auth-js
 * `signOut` removes whatever session is stored when its `/logout` returns.
 *
 * `persistSession: false` keeps it in memory (auth-js's own in-memory storage
 * when not persisting), under a key of its own, with no refresh timer; it
 * lives for one sign-out.
 */
export function signOutClient(): SupabaseClient<Database> {
  return createClient<Database>(ENV.supabaseUrl, ENV.supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'pappal-sign-out',
    },
    global: {
      fetch: fetchWithTimeout,
    },
  });
}
