import type { SendResult } from './database.types';
import { CONTACT_INFO_SQLSTATE, contactGuardNotice } from './contactGuard';

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
 *
 * The contact guard (157) answers `send_message` structurally, so its codes
 * arrive in `data` and pass through untouched. Its one RAISED refusal, P0011
 * from the profile-field trigger, is folded here too, for a caller that ever
 * reaches it through a send.
 */
export function sendResultFrom(
  data: SendResult | null,
  error: { code?: string; details?: string | null } | null,
): SendResult | null {
  if (error === null || error === undefined) {
    return data;
  }
  if (error.code === CONTACT_INFO_SQLSTATE) {
    let category: SendResult['category'] = null;
    try {
      category = (JSON.parse(error.details ?? '{}') as { category?: SendResult['category'] }).category ?? null;
    } catch {
      // Still a contact-guard refusal without its category.
    }
    return { success: false, error: 'CONTACT_INFO', category };
  }
  return error.code === CHANNEL_DISABLED_SQLSTATE
    ? { success: false, error: 'CHANNEL_DISABLED_BY_PROVIDER' }
    : null;
}

/**
 * The line to show for a refused send: the contact guard's own copy when it
 * refused (it depends on the category, the reason and the strike count, not
 * the code alone), otherwise the caller's line for the code.
 */
export function sendNotice(
  result: SendResult | null | undefined,
  byCode: Partial<Record<string, string>>,
): string | undefined {
  const guard = contactGuardNotice(result);
  if (guard !== null) {
    return guard;
  }
  const code = result?.error;
  return code !== undefined ? byCode[code] : undefined;
}
