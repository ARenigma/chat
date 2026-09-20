/**
 * Consume a pending Truecaller identity challenge to bind a Truecaller identity
 * to an existing Google account.
 *
 * Called when the member chose "Already use Google?", signed in with Google,
 * and is now authenticated. The challenge links the verified Truecaller
 * subject+phone to that exact Supabase UUID so future Truecaller logins return
 * to the same wallet, profile, conversations, and history.
 *
 * The caller must supply a valid Supabase bearer (the Google session just minted).
 * The phone and Truecaller subject come from the server-side challenge record, not
 * from the client, to prevent a member from linking someone else's phone.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

Deno.serve(async request => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    return Response.json({ error: 'server configuration error' }, { status: 500 });
  }

  // Extract the bearer from the Authorization header — this is the signed-in Google session.
  const authHeader = request.headers.get('authorization') ?? '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!bearer) {
    return Response.json({ error: 'authentication required' }, { status: 401 });
  }

  let body: { challenge?: unknown } = {};
  try {
    const raw = await request.text();
    if (raw.length > 512) return Response.json({ error: 'payload too large' }, { status: 413 });
    body = JSON.parse(raw) as typeof body;
  } catch {
    return Response.json({ error: 'invalid json' }, { status: 400 });
  }
  const challengeToken = typeof body.challenge === 'string' ? body.challenge : '';
  if (!challengeToken) {
    return Response.json({ error: 'challenge is required' }, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  // Use the caller's bearer to resolve their user id — we must not trust the client
  // to supply their own UUID.
  const userClient = createClient(supabaseUrl, bearer, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return Response.json({ error: 'invalid or expired session' }, { status: 401 });
    }
    const userId = user.id;

    const hashBuf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(challengeToken),
    );
    const challengeHash = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    const { data, error: consumeError } = await admin.rpc('consume_pending_challenge', {
      p_challenge_hash: challengeHash,
    });
    if (consumeError) {
      return Response.json(
        { error: 'challenge is invalid, already used, or expired' },
        { status: 409 },
      );
    }
    const { out_provider: provider, out_subject: subject, out_phone: phone } =
      data as { out_provider: string; out_subject: string; out_phone: string };

    await admin.rpc('upsert_external_identity', {
      p_provider: provider,
      p_subject:  subject,
      p_phone:    phone,
      p_user_id:  userId,
    });

    return Response.json({ status: 'linked' }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error(`truecaller-link-account failed: ${String(err)}`);
    return Response.json({ error: 'could not link account' }, { status: 500 });
  }
});
