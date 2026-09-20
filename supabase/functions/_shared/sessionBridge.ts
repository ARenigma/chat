/**
 * Shared phone-user resolver and GoTrue session minter used by both
 * exchange-firebase-token and exchange-truecaller-code.
 *
 * WHY THE generateLink → verifyOtp DANCE. supabase-js has no admin "create a
 * session for this user" call, and a hand-signed JWT dies on the first refresh
 * because GoTrue has no matching row in auth.refresh_tokens. The only way to
 * get a session whose refresh works long-term is to let GoTrue itself issue it:
 * `admin.generateLink({type:'magiclink'})` returns a single-use `hashed_token`
 * WITHOUT sending any email, and `anon.verifyOtp({token_hash, type:'email'})`
 * exchanges it for a real session. generateLink is email-based, so phone users
 * carry an unroutable `*.invalid` placeholder email purely to drive this.
 *
 * This keeps the "Supabase is the only thing that mints a session" rule intact
 * across every phone-based auth path.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

/** E.164 with the plus. Must agree with migration 010's phone check. */
export const E164 = /^\+[1-9][0-9]{7,14}$/;

/** RFC 2606 `.invalid` placeholder email for a phone user. GoTrue requires an
 *  email to drive generateLink; nothing is ever sent to this address. */
export function placeholderEmail(): string {
  return `phone_${crypto.randomUUID()}@pappal.invalid`;
}

/**
 * Find an existing auth.users row by E.164 phone via the SECURITY DEFINER RPC
 * `get_user_id_by_phone` (migration 018). Returns null if no match.
 *
 * Also checks profiles.phone_e164 so a member who signed up with Google and
 * later verified their phone is found on both auth.users.phone AND their profile.
 * The RPC already reads auth.users; the profile resolution is the extended
 * lookup added by migration 127.
 */
export async function findUserIdByPhone(
  admin: ReturnType<typeof createClient>,
  phone: string,
): Promise<string | null> {
  const { data, error } = await admin.rpc('resolve_phone_owner', { p_phone: phone });
  if (error != null) throw error;
  return typeof data === 'string' && data !== '' ? data : null;
}

/** Ensure the user identified by `userId` has a placeholder email so generateLink works. */
export async function ensureEmail(
  admin: ReturnType<typeof createClient>,
  userId: string,
): Promise<string> {
  const { data: got, error: getError } = await admin.auth.admin.getUserById(userId);
  if (getError != null || got?.user == null) throw getError ?? new Error('user vanished');
  const current = got.user.email ?? '';
  if (current !== '') return current;
  const email = placeholderEmail();
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    email,
    email_confirm: true,
  });
  if (updateError != null) throw updateError;
  return email;
}

/** Create a new Supabase user for this verified phone number. */
export async function createPhoneUser(
  admin: ReturnType<typeof createClient>,
  phone: string,
): Promise<{ userId: string; email: string }> {
  const email = placeholderEmail();
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    phone,
    phone_confirm: true,
    email,
    email_confirm: true,
  });
  if (createError != null || created?.user == null) {
    throw createError ?? new Error('createUser returned no user');
  }
  return { userId: created.user.id, email };
}

export interface GoTrueSession {
  access_token: string;
  refresh_token: string;
}

/**
 * Mint a refreshable GoTrue session for the user identified by `email`.
 *
 * Never call this with an email that could be routed — only placeholder
 * `*.invalid` addresses should be used here so GoTrue never actually tries
 * to send anything.
 */
export async function mintSession(
  admin: ReturnType<typeof createClient>,
  anonClient: ReturnType<typeof createClient>,
  email: string,
): Promise<GoTrueSession> {
  const { data: link, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });
  if (linkError != null || link?.properties?.hashed_token == null) {
    throw linkError ?? new Error('generateLink returned no hashed_token');
  }
  const { data: verified, error: verifyError } = await anonClient.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: 'email',
  });
  if (verifyError != null || verified?.session == null) {
    throw verifyError ?? new Error('verifyOtp returned no session');
  }
  return {
    access_token: verified.session.access_token,
    refresh_token: verified.session.refresh_token,
  };
}
