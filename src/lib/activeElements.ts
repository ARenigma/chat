/**
 * Registry of closeable UI elements (bottom sheets, dialogs, media viewer).
 *
 * Incoming calls and chat requests must dismiss transient UI before presenting
 * their own full-screen surface. `closeAllActiveElements` is the single call
 * that does this, coordinated across components that do not know about each
 * other.
 *
 * Modelled on Bluesky social-app state/util.ts:35-46 and
 * Navigation.tsx:904-920 (MIT). nav-migration §3.
 *
 * PaymentSheet registers with `canClose: () => mockPhase !== 'processing'`.
 * When a gateway request is in flight, `closeAllActiveElements` returns false
 * and the caller must NOT clear the CallStyle notification — the sheet stays
 * up and the ring is still unreachable.
 * https://developer.android.com/develop/ui/views/notifications/call-style
 */

import { useEffect } from 'react';

type Entry = {
  close: () => void;
  canClose: () => boolean;
};

const _elements = new Map<symbol, Entry>();

/**
 * Register a closeable element while it is visible. The registration is
 * removed when the component unmounts or `visible` becomes false.
 *
 * @param visible  Whether the element is currently on screen.
 * @param close    Callback to close/dismiss the element.
 * @param canClose Optional guard. Return false while a non-interruptible
 *                 operation is in progress (e.g. a payment gateway request).
 *                 `closeAllActiveElements` returns false when any guard blocks.
 */
export function useActiveElement(
  visible: boolean,
  close: () => void,
  canClose?: () => boolean,
): void {
  useEffect(() => {
    if (!visible) return;
    const key = Symbol();
    _elements.set(key, { close, canClose: canClose ?? (() => true) });
    return () => {
      _elements.delete(key);
    };
  }, [visible, close, canClose]);
}

/**
 * Close every registered element. Returns true if all elements closed (or
 * none were registered), false if any element blocked via `canClose`.
 *
 * When this returns false, the caller must NOT clear the CallStyle
 * notification: the ring is not on screen and the user cannot see it.
 */
export function closeAllActiveElements(): boolean {
  let allClosed = true;
  for (const entry of _elements.values()) {
    if (!entry.canClose()) {
      allClosed = false;
      continue;
    }
    entry.close();
  }
  return allClosed;
}
