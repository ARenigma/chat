import { NativeModules, Platform } from 'react-native';
import { storage } from './storage';

/**
 * Google Play's in-app review card, shown once, right after a member rates a
 * session 4 or 5 stars. Nowhere else.
 *
 * https://developer.android.com/guide/playcore/in-app-review says to ask after
 * a good experience and never from a button the user presses expecting a
 * result (Play enforces its own quota and may show nothing). A 4-5 star rating
 * the member has just submitted is that moment; we ask no question first.
 * Play's quota is not ours to rely on, so "at most once per install" is kept
 * here.
 */

const NATIVE = (NativeModules as Record<string, unknown>).InAppReview as
  | { request(): Promise<boolean> }
  | undefined;

const ASKED_KEY = 'companion.reviewAsked';

/** Pure policy: only a good rating, and only if we have not asked before. */
export function shouldAskForReview(stars: number, alreadyAsked: boolean): boolean {
  return stars >= 4 && !alreadyAsked;
}

/** Never throws and never blocks the caller's flow. */
export async function maybeAskForReview(stars: number): Promise<void> {
  try {
    if (Platform.OS !== 'android' || NATIVE === undefined) {
      return;
    }
    if (!shouldAskForReview(stars, storage.get(ASKED_KEY) !== null)) {
      return;
    }
    // Marked before the native call so a crash inside it cannot loop the ask.
    storage.set(ASKED_KEY, String(Date.now()));
    await NATIVE.request();
  } catch {
    // The docs say to continue the normal flow on any error.
  }
}
