/**
 * A FOUNDER SESSION IS ONE THING: a Supabase session whose user authenticated
 * through Google OAuth, for an email Google itself reports as verified.
 *
 * Deno-side twin of admin/lib/auth/founder.ts. The two cannot share code — a
 * Next.js server module and a Deno edge function are different runtimes with
 * no import path between them — so this duplicates the check rather than
 * leaving cashfree-payout, the function that actually disburses money, on
 * the weaker one. Keep both in step; see the admin-side file for the full
 * explanation of why an email match alone was not enough (2026-09-17 audit).
 *
 * Field shapes are pinned from @supabase/auth-js's own types, not memory:
 * `app_metadata.provider` is the first provider signed up with,
 * `identities[].provider` matches per-linked-identity, and
 * `identities[].identity_data.email_verified` — not `user_metadata`, not a
 * top-level field — is where Google's verification lands.
 */

// Minimal shape of what auth.getUser() returns, for the fields this check
// reads. Not the full @supabase/auth-js User type: importing that type here
// would pull the whole package's type surface into a function that only
// needs five fields off it.
export interface AuthUser {
  email?: string;
  app_metadata: { provider?: string; providers?: string[] };
  identities?: Array<{
    provider: string;
    identity_data?: { email_verified?: boolean };
  }>;
}

export function hasVerifiedGoogleIdentity(user: AuthUser): boolean {
  if (user.app_metadata.provider !== 'google') {
    return false;
  }
  const identity = user.identities?.find(i => i.provider === 'google');
  return identity?.identity_data?.email_verified === true;
}

// Only the surface this file calls — `.schema().from().select().eq()
// .maybeSingle()` — so a caller can pass either the anon or the service
// client without pulling the whole @supabase/supabase-js type surface in.
export interface SchemaQueryClient {
  schema(name: string): {
    from(table: string): {
      select(columns: string): {
        eq(
          column: string,
          value: string,
        ): { maybeSingle(): Promise<{ data: { email: string; role: string } | null }> };
      };
    };
  };
}

/**
 * The one lookup cashfree-payout (or any future money-moving function)
 * should use. `client` must be a SERVICE-ROLE client: the admin schema is
 * RLS-restricted and only service_role bypasses it. Returns the allowlist
 * row, or `null` if either half of the gate fails — not a verified Google
 * identity, or the (lowercase-normalised, migration 114) email is not on the
 * list.
 */
export async function founderAllowlistRow(
  client: SchemaQueryClient,
  user: AuthUser,
): Promise<{ email: string; role: string } | null> {
  if (!user.email || !hasVerifiedGoogleIdentity(user)) {
    return null;
  }
  const { data } = await client
    .schema('admin')
    .from('founder_allowlist')
    .select('email, role')
    .eq('email', user.email.toLowerCase())
    .maybeSingle();
  return data;
}
