import { createClient } from '@supabase/supabase-js';
import { ENV } from './env';
import { supabaseStorage } from './storage';
import type { Database } from './database.types';

/**
 * `detectSessionInUrl: false` because React Native has no URL bar — the OAuth
 * code arrives through a deep link and is exchanged explicitly in
 * `src/api/auth.ts`. `flowType: 'pkce'` is what makes that exchange safe on a
 * device that cannot hold a client secret.
 */
export const supabase = createClient<Database>(ENV.supabaseUrl, ENV.supabaseAnonKey, {
  auth: {
    storage: supabaseStorage,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    flowType: 'pkce',
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
