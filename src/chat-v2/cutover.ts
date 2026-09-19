/**
 * The one switch that moves the production chat route from V1 to V2.
 *
 * It is a single module-scope constant, and everything else about the cutover
 * is derived from it, because the alternative — a condition written out at the
 * member call site and again at the provider one — is two decisions that agree
 * until the day somebody edits one of them.
 *
 * IT IS NOW TRUE. The S22 device gate passed on 2026-09-19.
 *
 * V1 is not deleted. It stays mounted by this same seam, so flipping back is
 * the same one line rather than a revert of a deletion.
 */

/** Which of the two chat screens the normal `chat` route mounts. */
export type ChatScreenChoice = 'v1' | 'v2';

/**
 * The device gate. Flipped true on 2026-09-19 after all six V2 geometry gates
 * passed on the Samsung Galaxy S22 (SM_S908E, Android 16):
 *   - Composer at screen bottom at rest
 *   - Last message 12.8dp above dock with IME open
 *   - Page-down 8.5dp above dock (≥8dp required)
 *   - Missed call row: 48.0dp, one visual line, callback in a11y label
 *   - Own-message PaperMenu rendered with correct items
 *   - Real data: messages, calls, session rows, day dividers, media
 *
 * V1 is NOT deleted — flipping back is one line.
 */
export const CHAT_V2_CUTOVER = true;

export function chatScreenChoice(cutover: boolean): ChatScreenChoice {
  return cutover ? 'v2' : 'v1';
}

/**
 * The resolved choice, read by both navigation trees.
 *
 * Exported as a value rather than as a function call at each site so the two
 * trees cannot be flipped independently — and so the choice is visible in one
 * place when somebody asks "which screen is production on?".
 */
export const CHAT_SCREEN: ChatScreenChoice = chatScreenChoice(CHAT_V2_CUTOVER);
