import { AppState, NativeModules, Platform } from 'react-native';
import { storage } from './storage';
import {
  decideUpdateAction,
  type UpdateAction,
  type UpdateStatus,
} from './updatePolicy';

/**
 * The bridge to Google Play in-app updates, and the loop that drives it.
 *
 * Two things this deliberately does not do:
 *
 *   - **It never blocks startup.** Every failure resolves rather than rejects,
 *     and the check runs after the app is interactive. An update check that can
 *     delay a cold start is a worse bug than a missed update.
 *   - **It never reports an error to the user.** Off Play — a debug build, a
 *     sideloaded APK, an emulator without the Play Store — the native side
 *     resolves `available: false`. There is nothing here anyone can act on.
 */

const NATIVE = (NativeModules as Record<string, unknown>).InAppUpdate as
  | {
      check(): Promise<UpdateStatus>;
      startFlexible(): Promise<boolean>;
      startImmediate(): Promise<boolean>;
      complete(): Promise<boolean>;
    }
  | undefined;

/** When a flexible update was last offered, so it is not offered every launch. */
const PROMPTED_KEY = 'companion.updatePromptedAt';

const UNAVAILABLE: UpdateStatus = {
  available: false,
  immediateInProgress: false,
  downloaded: false,
  flexibleAllowed: false,
  immediateAllowed: false,
  priority: 0,
  stalenessDays: -1,
  availableVersionCode: 0,
};

export function updatesSupported(): boolean {
  return Platform.OS === 'android' && NATIVE !== undefined;
}

async function status(): Promise<UpdateStatus> {
  if (!updatesSupported()) {
    return UNAVAILABLE;
  }
  try {
    return await NATIVE!.check();
  } catch {
    return UNAVAILABLE;
  }
}

/**
 * Decide, act, and report what a caller should show.
 *
 * Returns the action taken so the UI can surface the one case that needs a
 * person: a downloaded update waiting for a restart. The immediate and flexible
 * flows are Play's own full-screen and background UI, so there is nothing for us
 * to draw.
 */
export async function runUpdateCheck(): Promise<UpdateAction> {
  const current = await status();
  if (__DEV__) {
    // Dev-only, and it earns its place: off Play everything here resolves to
    // "nothing available", which is indistinguishable from the native module
    // never having been registered. This is the only way to tell those apart
    // without a Play release.
    console.warn(
      `update check: supported=${String(updatesSupported())} ` +
        `available=${String(current.available)} downloaded=${String(current.downloaded)} ` +
        `priority=${String(current.priority)} staleness=${String(current.stalenessDays)}`,
    );
  }
  // storage is string-only, so this parses rather than reads a number. A
  // corrupt or absent value must mean "never asked" rather than 1970, which
  // would make every launch look overdue.
  const stored = Number(storage.get(PROMPTED_KEY));
  const lastPrompted = Number.isFinite(stored) && stored > 0 ? stored : null;
  const action = decideUpdateAction(current, Date.now(), lastPrompted);

  switch (action.kind) {
    case 'immediate':
    case 'resumeImmediate':
      await NATIVE?.startImmediate();
      break;
    case 'flexible':
      // Recorded before starting, not after: if the flow throws or the user
      // dismisses it, we still want the week's cooldown to apply. Otherwise a
      // dismissal means being asked again on the next foreground.
      storage.set(PROMPTED_KEY, String(Date.now()));
      await NATIVE?.startFlexible();
      break;
    default:
      break;
  }

  return action;
}

/** Install a downloaded flexible update. Restarts the app. */
export async function completeUpdate(): Promise<void> {
  await NATIVE?.complete();
}

/**
 * Check now and on every return to the foreground.
 *
 * The foreground check is not belt-and-braces: it is how a flexible update that
 * finished downloading while the app was backgrounded gets noticed, and how an
 * immediate update the user walked away from gets resumed. Google's own sample
 * does the same in `onResume`.
 */
export function watchForUpdates(onAction: (action: UpdateAction) => void): () => void {
  if (!updatesSupported()) {
    return () => {};
  }

  let disposed = false;
  const check = () => {
    void runUpdateCheck().then(action => {
      if (!disposed) {
        onAction(action);
      }
    });
  };

  check();
  const sub = AppState.addEventListener('change', state => {
    if (state === 'active') {
      check();
    }
  });

  return () => {
    disposed = true;
    sub.remove();
  };
}
