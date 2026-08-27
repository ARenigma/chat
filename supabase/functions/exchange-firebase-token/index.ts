/**
 * Firebase phone sign-in → a real Supabase session.
 *
 * The client (AUTH_PHONE_PROVIDER = 'firebase') verifies the phone with Firebase,
 * then POSTs the resulting Firebase ID token here. This function:
 *   1. Verifies the ID token against Google's public keys (signature, issuer,
 *      audience, expiry) — the client's word is never trusted; the phone comes
 *      from the *verified* token's `phone_number` claim.
 *   2. Maps that E.164 phone to an existing Supabase user, or creates one
 *      (phone pre-confirmed). Repeat sign-ins land on the same user, so RLS,
 *      the profile, wallet and history all carry over.
 *   3. Mints a genuine GoTrue session (access + refresh) for that user and
 *      returns it. The client calls `supabase.auth.setSession(...)` and from
 *      there `autoRefreshToken` keeps it alive natively.
 *
 * WHY THE generateLink → verifyOtp DANCE (step 3). supabase-js has no admin
 * "create a session for this user" call, and a hand-signed JWT dies on the first
 * refresh because GoTrue has no matching row in auth.refresh_tokens. The only way
 * to get a session whose refresh works long-term is to let GoTrue itself issue
 * it: `admin.generateLink({type:'magiclink'})` returns a single-use `hashed_token`
 * WITHOUT sending any email, and `anon.verifyOtp({token_hash, type:'email'})`
 * exchanges it for a real session. generateLink is email-based, so phone users
 * carry an unroutable `*.invalid` placeholder email purely to drive this.
 *
 * This keeps the "Supabase is the only thing that mints a session" rule the
 * Supabase-native OTP path was built on — Firebase only proves the number.
 *
 * PHONE → USER LOOKUP. supabase-js has no `getUserByPhone`, so this paginates
 * `admin.listUsers` and matches on `phone`. That is O(users) per sign-in, which
 * is fine at this stage; when the user base grows, replace `findUserIdByPhone`
 * with a `service_role`-only SECURITY DEFINER RPC (`select id from auth.users
 * where phone = $1`) and call it via `admin.rpc(...)`.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@5';

/** Google's public keys for Firebase ID tokens (Secure Token service). */
const FIREBASE_JWKS = createRemoteJWKSet(
  new URL(
    'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com',
  ),
);

/** E.164 with the plus. Must agree with migration 010's phone check. */
const E164 = /^\+[1-9][0-9]{7,14}$/;

/** Unroutable placeholder email for a phone user, needed only to drive generateLink. */
function placeholderEmail(): string {
  // RFC 2606 `.invalid` TLD: syntactically valid, guaranteed unroutable.
  return `phone_${crypto.randomUUID()}@pappal.invalid`;
}

/**
 * Find an existing user's id by E.164 phone via paginated listUsers. Returns null
 * if no user has that phone. Bounded so a runaway can't page forever.
 */
async function findUserIdByPhone(
  admin: ReturnType<typeof createClient>,
  phone: string,
): Promise<string | null> {
  const PER_PAGE = 200;
  const MAX_PAGES = 50; // 10k users before this needs the RPC noted above.
  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error != null) {
      throw error;
    }
    const users: Array<{ id: string; phone?: string | null }> = data?.users ?? [];
    const match = users.find(u => (u.phone ?? '') === phone.replace(/^\+/, '') || u.phone === phone);
    if (match != null) {
      return match.id;
    }
    if (users.length < PER_PAGE) {
      return null; // last page
    }
  }
  return null;
}

Deno.serve(async request => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const projectId = Deno.env.get('FIREBASE_PROJECT_ID') ?? 'chat-d8c87';

  if (!url || !serviceKey || !anonKey) {
    console.error('exchange-firebase-token is not configured');
    return Response.json({ error: 'not configured' }, { status: 500 });
  }

  let idToken = '';
  try {
    const body = (await request.json()) as { idToken?: unknown };
    idToken = typeof body.idToken === 'string' ? body.idToken : '';
  } catch {
    idToken = '';
  }
  if (idToken === '' || idToken.length > 8192) {
    return Response.json({ error: 'bad payload' }, { status: 400 });
  }

  // 1. Verify the Firebase ID token. jwtVerify checks the signature against
  //    Google's rotating keys and enforces issuer/audience/expiry — a forged or
  //    expired token cannot get past this.
  let phone: string;
  try {
    const { payload } = await jwtVerify(idToken, FIREBASE_JWKS, {
      issuer: `https://securetoken.google.com/${projectId}`,
      audience: projectId,
    });
    const claim = typeof payload.phone_number === 'string' ? payload.phone_number : '';
    if (!E164.test(claim)) {
      // A Firebase token without a phone_number claim is a non-phone sign-in
      // (Google, anonymous, …) and has no business here.
      console.error('firebase token carried no usable phone_number');
      return Response.json({ error: 'no phone in token' }, { status: 400 });
    }
    phone = claim;
  } catch (err) {
    console.error(`firebase token verify failed: ${String(err)}`);
    return Response.json({ error: 'invalid token' }, { status: 401 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 2. Map the phone to a user, or create one. An existing user may have been
  //    created by the Supabase-native OTP path with no email, so ensure a
  //    placeholder email exists (generateLink needs one).
  let email: string;
  try {
    const existingId = await findUserIdByPhone(admin, phone);

    if (existingId !== null) {
      const { data: got, error: getError } = await admin.auth.admin.getUserById(existingId);
      if (getError != null || got?.user == null) {
        throw getError ?? new Error('user vanished');
      }
      const current = got.user.email ?? '';
      if (current === '') {
        email = placeholderEmail();
        const { error: updateError } = await admin.auth.admin.updateUserById(existingId, {
          email,
          email_confirm: true,
        });
        if (updateError != null) {
          throw updateError;
        }
      } else {
        email = current;
      }
    } else {
      email = placeholderEmail();
      const { data: created, error: createError } = await admin.auth.admin.createUser({
        phone,
        phone_confirm: true,
        email,
        email_confirm: true,
      });
      if (createError != null || created?.user == null) {
        throw createError ?? new Error('create returned no user');
      }
    }
  } catch (err) {
    console.error(`user get-or-create failed: ${String(err)}`);
    return Response.json({ error: 'could not resolve user' }, { status: 500 });
  }

  // 3. Mint a real GoTrue session: generateLink (no email is sent) → the anon
  //    client exchanges the one-time token for access + refresh tokens.
  try {
    const { data: link, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
    });
    if (linkError != null || link?.properties?.hashed_token == null) {
      throw linkError ?? new Error('no hashed_token');
    }

    const anon = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: verified, error: verifyError } = await anon.auth.verifyOtp({
      token_hash: link.properties.hashed_token,
      type: 'email',
    });
    if (verifyError != null || verified?.session == null) {
      throw verifyError ?? new Error('no session from verifyOtp');
    }

    return Response.json({
      access_token: verified.session.access_token,
      refresh_token: verified.session.refresh_token,
    });
  } catch (err) {
    console.error(`session mint failed: ${String(err)}`);
    return Response.json({ error: 'could not mint session' }, { status: 500 });
  }
});
