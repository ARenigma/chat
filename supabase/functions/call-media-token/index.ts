/**
 * Short-lived credentials for the media backend assigned on public.calls.
 *
 * The caller's JWT is verified and the RLS-protected calls query proves they
 * are a participant in this live call before any vendor credential is minted.
 * Vendor signing secrets remain Supabase secrets and never enter the APK.
 *
 * Agora AccessToken2:
 * https://docs.agora.io/en/realtime-media/video/build/authenticate-users/deploy-token-server
 * LiveKit tokens and grants:
 * https://docs.livekit.io/frontends/reference/tokens-grants/
 * Cloudflare TURN:
 * https://developers.cloudflare.com/realtime/turn/generate-credentials/
 */
import { RtcRole, RtcTokenBuilder } from 'npm:agora-token@2.0.6';
import { AccessToken } from 'npm:livekit-server-sdk@2.18.0';
import { createClient } from 'jsr:@supabase/supabase-js@2';

type Backend = 'current' | 'livekit' | 'agora';

interface CallRow {
  id: string;
  caller_id: string;
  callee_id: string;
  status: 'ringing' | 'active';
  media_backend: Backend;
}

const TTL_SECONDS = 10 * 60;
// Current WebRTC cannot refresh ICE credentials in-place. Keep TURN bounded but
// long enough for a normal paid call and allocation refreshes; Agora renews its
// separate 10-minute token through SDK callbacks.
const TURN_TTL_SECONDS = 60 * 60;

async function agoraUid(callId: string, userId: string): Promise<number> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${callId}:${userId}`),
  );
  // Agora requires 1..2^32-1. Identity is scoped to this unique call channel.
  return new DataView(bytes).getUint32(0) || 1;
}

async function cloudflareIceServers(): Promise<unknown[]> {
  const keyId = Deno.env.get('CLOUDFLARE_TURN_KEY_ID');
  const apiToken = Deno.env.get('CLOUDFLARE_TURN_API_TOKEN');
  if (!keyId || !apiToken) {
    return [{ urls: ['stun:stun.cloudflare.com:3478'] }];
  }

  const response = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${keyId}/credentials/generate-ice-servers`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ttl: TURN_TTL_SECONDS }),
    },
  );
  if (!response.ok) {
    console.error(`Cloudflare TURN credential generation failed: ${response.status}`);
    throw new Error('TURN credential generation failed');
  }
  const body = await response.json() as { iceServers?: unknown[] };
  if (!Array.isArray(body.iceServers)) throw new Error('Invalid TURN response');
  return body.iceServers;
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    return Response.json({ error: 'not configured' }, { status: 500 });
  }

  const authHeader = request.headers.get('Authorization') ?? '';
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let callId = '';
  try {
    const body = await request.json() as { call_id?: unknown };
    callId = typeof body.call_id === 'string' ? body.call_id : '';
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(callId)) {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }

  // RLS returns no row to an outsider. Status additionally prevents minting
  // credentials for historical calls.
  const { data, error } = await userClient
    .from('calls')
    .select('id,caller_id,callee_id,status,media_backend')
    .eq('id', callId)
    .in('status', ['ringing', 'active'])
    .maybeSingle();
  if (error) {
    console.error(`call authorization query failed: ${error.code}`);
    return Response.json({ error: 'authorization failed' }, { status: 500 });
  }
  const call = data as CallRow | null;
  if (!call || ![call.caller_id, call.callee_id].includes(userData.user.id)) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }

  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
  const room = call.id;

  try {
    if (call.media_backend === 'livekit') {
      const endpoint = Deno.env.get('LIVEKIT_URL');
      const apiKey = Deno.env.get('LIVEKIT_API_KEY');
      const apiSecret = Deno.env.get('LIVEKIT_API_SECRET');
      if (!endpoint || !apiKey || !apiSecret) throw new Error('LiveKit not configured');

      const access = new AccessToken(apiKey, apiSecret, {
        identity: userData.user.id,
        // LiveKit documents that expiry gates the initial connection only;
        // connected clients receive refreshed reconnect tokens from the server.
        // https://docs.livekit.io/frontends/reference/tokens-grants/#token-expiration
        ttl: TTL_SECONDS,
      });
      access.addGrant({
        roomJoin: true,
        room,
        canPublish: true,
        canSubscribe: true,
        canPublishData: false,
        canPublishSources: ['camera', 'microphone'],
      });
      return Response.json({
        backend: 'livekit',
        callId,
        expiresAt,
        endpoint,
        room,
        token: await access.toJwt(),
      });
    }

    if (call.media_backend === 'agora') {
      const appId = Deno.env.get('AGORA_APP_ID');
      const certificate = Deno.env.get('AGORA_APP_CERTIFICATE');
      if (!appId || !certificate) throw new Error('Agora not configured');
      const uid = await agoraUid(callId, userData.user.id);
      const token = RtcTokenBuilder.buildTokenWithUid(
        appId,
        certificate,
        room,
        uid,
        RtcRole.PUBLISHER,
        TTL_SECONDS,
        TTL_SECONDS,
      );
      return Response.json({
        backend: 'agora',
        callId,
        expiresAt,
        appId,
        room,
        uid,
        token,
      });
    }

    return Response.json({
      backend: 'current',
      callId,
      expiresAt,
      iceServers: await cloudflareIceServers(),
    });
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : 'media token failure');
    return Response.json({ error: 'credential generation failed' }, { status: 500 });
  }
});
