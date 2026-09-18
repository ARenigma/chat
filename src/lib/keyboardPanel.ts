/**
 * The keyboard's height, remembered — so a panel can take exactly its place.
 *
 * This is the load-bearing part of the docked emoji panel, and the reason it
 * reads as the keyboard *becoming* the emoji grid rather than one surface
 * closing and another opening: the panel is given exactly the height the IME
 * last reported, so swapping the two moves nothing in the transcript. The
 * measured anatomy this reimplements is recorded in
 * `design/references/chat-app-mechanics.md`.
 *
 * Persisted because the FIRST open has nothing to measure: the panel is opened
 * with the keyboard on its way down, so its height must already be known. Kept
 * per orientation because a landscape keyboard is a different height and
 * reusing the portrait one is a visible jump.
 */
import { storage } from './storage';

const PORTRAIT_KEY = 'companion.keyboardHeight';
const LANDSCAPE_KEY = 'companion.keyboardHeightLand';

/**
 * Before anything has been measured. Roughly a stock Android portrait keyboard;
 * only ever seen once per install, and replaced the first time a real keyboard
 * is shown.
 */
const FALLBACK_PORTRAIT = 300;
const FALLBACK_LANDSCAPE = 220;

/** Guard against a bogus measurement sizing the panel to the whole screen. */
const MIN_HEIGHT = 180;
const MAX_HEIGHT = 420;

export function readKeyboardHeight(landscape: boolean): number {
  const raw = storage.get(landscape ? LANDSCAPE_KEY : PORTRAIT_KEY);
  const parsed = raw === null ? NaN : Number(raw);
  if (!Number.isFinite(parsed)) {
    return landscape ? FALLBACK_LANDSCAPE : FALLBACK_PORTRAIT;
  }
  return clamp(parsed);
}

export function writeKeyboardHeight(height: number, landscape: boolean): void {
  // A keyboard that reports an implausible height (a floating/split IME, or a
  // transient frame mid-animation) must not poison the stored value: the panel
  // would then open at that size forever.
  if (height < MIN_HEIGHT || height > MAX_HEIGHT) {
    return;
  }
  storage.set(landscape ? LANDSCAPE_KEY : PORTRAIT_KEY, String(Math.round(height)));
}

function clamp(height: number): number {
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, height));
}
