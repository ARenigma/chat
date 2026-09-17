import type { User } from '@supabase/supabase-js';
import { createServiceClient } from '@/lib/supabase/service';

/**
 * A FOUNDER SESSION IS ONE THING: a Supabase session whose user authenticated
 * through Google OAuth, for an email Google itself reports as verified.
 *
 * Before this (Telegram-CTO audit, 2026-09-17), every call site checked only
 * `user.email` against `admin.founder_allowlist` — nothing read
 * `app_metadata.provider`, `identities`, or an email-verified flag. The admin
 * site and the mobile app share one GoTrue project (`admin.pappal.live/auth/
 * callback` is in the mobile project's own `additional_redirect_urls`,
 * supabase/config.toml), so ANY signed-in mobile member already holds a
 * session shaped exactly like a founder's. What stood between that and admin
 * access was `user.email` being a mutable column: GoTrue's own
 * `PUT /auth/v1/user {email}` applies immediately under
 * `enable_confirmations = false` (config.toml), so a member who changed their
 * email to a founder's could pass the old check without ever touching Google.
 *
 * `hasVerifiedGoogleIdentity` closes that: it is not enough for `user.email`
 * to match a row, the SESSION must be one Google actually vouches for. A
 * self-service email change carries no Google identity at all — the
 * `identities` array only grows a `provider: 'google'` entry when the user
 * completes real Google OAuth for that address, which is exactly as strong a
 * proof as owning the Google account.
 *
 * Field shapes are pinned from @supabase/auth-js's own types.d.ts, not
 * memory: `app_metadata.provider` is the first provider signed up with,
 * `identities[].provider` matches per-linked-identity, and
 * `identities[].identity_data.email_verified` — NOT `user_metadata`, NOT a
 * top-level field — is where Google's verification lands.
 *
 * NOT YET DONE, tracked as a fast-follow: `founder_allowlist` is still keyed
 * on the email string, not the auth user id. This assertion closes the
 * practical exploit (a session cannot forge a Google identity), so the uuid
 * rekey is hardening against a subtler race — an allowlist row added ahead of
 * its founder's first sign-in — rather than the live hole.
 */
export function hasVerifiedGoogleIdentity(user: User): boolean {
  if (user.app_metadata.provider !== 'google') {
    return false;
  }
  const identity = user.identities?.find(i => i.provider === 'google');
  return identity?.identity_data?.email_verified === true;
}

export type FounderRow = { email: string; role: string };

/**
 * The one lookup every admin call site should use. Returns the allowlist row
 * for `user`, or `null` if either half of the gate fails — not a verified
 * Google identity, or the (lowercase-normalised, migration 114) email is not
 * on the list. Callers that only need the email (not the role) can just
 * check the result is non-null; nothing here reveals which half failed, so a
 * probe cannot distinguish "not a founder" from "not Google".
 */
export async function founderAllowlistRow(user: User): Promise<FounderRow | null> {
  if (!user.email || !hasVerifiedGoogleIdentity(user)) {
    return null;
  }
  const { data } = await createServiceClient()
    .schema('admin')
    .from('founder_allowlist')
    .select('email, role')
    .eq('email', user.email.toLowerCase())
    .maybeSingle();
  return data;
}
