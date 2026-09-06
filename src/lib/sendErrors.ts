import type { SendResult } from './database.types';

/**
 * The Postgres errcode the provider-channel trigger raises (migration 064).
 *
 * A member's first message — text, voice note or photo — does not go through
 * `create_session_request`; `send_message` INSERTS the session request itself
 * (037:216). So a channel the provider has switched off arrives as a RAISED
 * exception rather than one of `send_message`'s own `{success:false}` returns,
 * and every caller of that RPC would otherwise report it as "check your
 * connection".
 */
export const CHANNEL_DISABLED_SQLSTATE = 'P0009';

/**
 * The result of a `send_message` call, with a raised channel refusal folded
 * back into the structured shape the callers already handle.
 *
 * One place knows this, rather than three: `chat.ts`, `voice.ts` and
 * `attachments.ts` all call the same RPC with the same `{ data, error }`
 * destructure. Mapping here beats re-stating a 330-line RPC to return the error
 * structurally — which is how migration 054 silently dropped four guards (063).
 */
export function sendResultFrom(
  data: SendResult | null,
  error: { code?: string } | null,
): SendResult | null {
  if (error === null || error === undefined) {
    return data;
  }
  return error.code === CHANNEL_DISABLED_SQLSTATE
    ? { success: false, error: 'CHANNEL_DISABLED_BY_PROVIDER' }
    : null;
}
