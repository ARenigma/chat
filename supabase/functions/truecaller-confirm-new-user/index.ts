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

    const { data, error } = await admin.rpc('consume_pending_challenge', {
      p_challenge_hash: challengeHash,
    });
    if (error) {
      // P0002 = not found / consumed / expired
      return Response.json(
        { error: 'challenge is invalid, already used, or expired' },
        { status: 409 },
      );
    }
    const { out_provider: provider, out_subject: subject, out_phone: phone } =
      data as { out_provider: string; out_subject: string; out_phone: string };

    const { userId, email } = await createPhoneUser(admin, phone);
    await admin.rpc('upsert_external_identity', {
      p_provider: provider,
      p_subject:  subject,
      p_phone:    phone,
      p_user_id:  userId,
    });
    const session = await mintSession(admin, anon, email);
    return Response.json(session, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    console.error(`truecaller-confirm-new-user failed: ${String(err)}`);
    return Response.json({ error: 'could not create account' }, { status: 500 });
  }
});
