import { createMMKV } from 'react-native-mmkv';

/**
 * Key-value storage, on MMKV rather than AsyncStorage.
 *
 * MMKV is memory-mapped and **synchronous**, which is the point. AsyncStorage
 * crosses to native and back for every read, so the boot path had to `await`
 * storage twice before it could decide which screen to show, once for the
 * Supabase session and once for the last conversation. Those awaits are the
 * difference between the first frame being the right screen and the first frame
 * being a spinner.
 *
 * The catch is that Supabase's auth client wants a promise-based adapter, so the
 * sync reads are wrapped below. That is not a compromise: a resolved promise
 * still settles in the same microtask, whereas a bridge call cannot.
 */
const mmkv = createMMKV({ id: 'companionchat' });

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
