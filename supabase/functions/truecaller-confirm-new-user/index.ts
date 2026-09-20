/**
 * Consume a pending Truecaller identity challenge to create a new Supabase user.
 *
 * Called when the member chooses "New here?" after exchange-truecaller-code
 * returned { status: 'no_owner', challenge }. The challenge token is consumed
 * exactly once; replaying or using an expired token returns 409.
 *
 * The verified phone and Truecaller subject come from the server-side challenge
 * record, not from the client, so the client cannot supply its own phone.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  createPhoneUser,
  ensureEmail,
  findUserIdByPhone,
  mintSession,
} from '../_shared/sessionBridge.ts';

Deno.serve(async request => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey     = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceKey || !anonKey) {
    return Response.json({ error: 'server configuration error' }, { status: 500 });
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
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    const hashBuf = await crypto.subtle.digest(
      'SHA-256',
      new TextEncoder().encode(challengeToken),
    );
    const challengeHash = Array.from(new Uint8Array(hashBuf))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');

    // Read without consuming. If user creation fails, the challenge remains
    // active and a retry is safe.
    const { data, error } = await admin.rpc('read_pending_challenge', {
      p_challenge_hash: challengeHash,
    });
    const challengeRow = Array.isArray(data) ? data[0] : data;
    const phone =
      challengeRow != null &&
      typeof (challengeRow as { out_phone?: unknown }).out_phone === 'string'
        ? (challengeRow as { out_phone: string }).out_phone
        : null;
    if (error || phone === null) {
      // The identity may already be linked and the challenge consumed while a
      // later GoTrue session mint/response failed. Resume minting for that exact
      // recorded UUID; never create or relink on this path.
      const { data: resumedUserId, error: resumeError } = await admin.rpc(
        'resolve_consumed_challenge_user',
        { p_challenge_hash: challengeHash },
      );
      if (
        !resumeError &&
        typeof resumedUserId === 'string' &&
        resumedUserId !== ''
      ) {
        const email = await ensureEmail(admin, resumedUserId);
        const session = await mintSession(admin, anon, email);
        return Response.json(session, {
          headers: { 'Cache-Control': 'no-store' },
        });
      }
      return Response.json(
        { error: 'challenge is invalid, already used, or expired' },
        { status: 409 },
      );
    }

    // A prior attempt may have created the user and failed before the atomic
    // link. Resolve by phone first so retries reuse that UUID.
    let userId = await findUserIdByPhone(admin, phone);
    let email: string;
    if (userId === null) {
      const created = await createPhoneUser(admin, phone);
      userId = created.userId;
      email = created.email;
    } else {
      email = await ensureEmail(admin, userId);
    }

    // Atomic DB commit point: link identity + consume challenge in one
    // transaction. Any conflict/error rolls both back, preserving retryability.
    const { error: linkError } = await admin.rpc(
      'consume_and_link_pending_challenge',
      {
        p_challenge_hash: challengeHash,
        p_user_id: userId,
      },
    );
    if (linkError) throw linkError;

    const session = await mintSession(admin, anon, email);
    return Response.json(session, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error(`truecaller-confirm-new-user failed: ${String(err)}`);
    return Response.json({ error: 'could not create account' }, { status: 500 });
  }
});
