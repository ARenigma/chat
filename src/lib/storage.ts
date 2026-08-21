import AsyncStorage from '@react-native-async-storage/async-storage';
import { createMMKV } from 'react-native-mmkv';

/**
 * Key-value storage, on MMKV rather than AsyncStorage.
 *
 * MMKV is memory-mapped and **synchronous**, which is the point. AsyncStorage
 * crosses to native and back for every read, so the boot path had to `await`
 * storage twice before it could decide which screen to show — once for the
 * Supabase session and once for the last conversation. Those awaits are the
 * difference between the first frame being the right screen and the first frame
 * being a spinner.
 *
 * The catch is that Supabase's auth client wants a promise-based adapter, so the
 * sync reads are wrapped below. That is not a compromise: a resolved promise
 * still settles in the same microtask, whereas a bridge call cannot.
 */
const mmkv = createMMKV({ id: 'companionchat' });

/** Keys that existed in AsyncStorage before the switch and must survive it. */
const MIGRATED = ['companion.lastProvider'] as const;

/**
 * Move anything AsyncStorage still holds into MMKV, once.
 *
 * Without this, switching storage engines silently signs everybody out and
 * forgets which conversation they were in — the data is not gone, it is just
 * behind a door nothing opens any more. Supabase's session keys are discovered
 * rather than listed, because their names include the project ref.
 *
 * Runs at import time and deliberately does not block: every consumer reads
 * through `storage`, which falls back to nothing rather than to stale data, and
 * a missed session on one cold start costs a sign-in — whereas awaiting this
 * before the first frame would cost the boot time the migration exists to save.
 */
let migrating: Promise<void> | null = null;

export function migrateLegacyStorage(): Promise<void> {
  if (migrating !== null) {
    return migrating;
  }
  migrating = (async () => {
    if (mmkv.getBoolean('migrated.v1') === true) {
      return;
    }
    try {
      const keys = await AsyncStorage.getAllKeys();
      const wanted = keys.filter(
        k => k.startsWith('sb-') || (MIGRATED as readonly string[]).includes(k),
      );
      for (const key of wanted) {
        if (mmkv.contains(key)) {
          continue;
        }
        const value = await AsyncStorage.getItem(key);
        if (value !== null) {
          mmkv.set(key, value);
        }
      }
      mmkv.set('migrated.v1', true);
    } catch {
      // A failed migration must not brick the app. Worst case the user signs in
      // again, which is recoverable; throwing here would not be.
    }
  })();
  return migrating;
}

export const storage = {
  get(key: string): string | null {
    return mmkv.getString(key) ?? null;
  },
  set(key: string, value: string): void {
    mmkv.set(key, value);
  },
  remove(key: string): void {
    mmkv.remove(key);
  },
};

/** The promise-shaped adapter Supabase's auth client expects. */
export const supabaseStorage = {
  getItem: (key: string): Promise<string | null> => Promise.resolve(storage.get(key)),
  setItem: (key: string, value: string): Promise<void> => {
    storage.set(key, value);
    return Promise.resolve();
  },
  removeItem: (key: string): Promise<void> => {
    storage.remove(key);
    return Promise.resolve();
  },
};
