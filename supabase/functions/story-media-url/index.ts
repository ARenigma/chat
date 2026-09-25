/**
 * A short-lived URL for one story's photo or video, and the only way a client
 * gets one.
 *
 * The `stories` bucket has no client SELECT policy (migration 144), so no
 * client can sign in it. The reason is how the Storage API serves a signed
 * URL: RLS is checked when the URL is SIGNED and never when it is used, and
 * the client picks the lifetime, with no ceiling. A viewer who could sign
 * could mint a year-long link while a story was visible, and it would keep
 * working after the story expired, after the provider deleted it, and after a
 * block.
 * https://github.com/supabase/storage/blob/master/src/http/routes/object/getSignedURL.ts
 * https://github.com/supabase/storage/blob/master/src/http/routes/object/getSignedObject.ts
 *
 * So this function holds both halves. Authorization is the caller's own
 * query: the stories row is read with the caller's JWT, stories RLS is
 * story_is_visible (143), and a row comes back only for a live story the
 * caller may see (their own, or a listed provider's they are not blocked
 * with, when they are a member). The signature is the service role's, over
 * that row's media_path and nothing the client sent, for at most 60 seconds
 * and never past the story's own expiry.
 *
 * Those 60 seconds bound who can MINT a working link, not how long a link
 * already fetched keeps working, and this used to claim both. On Pro and above
 * the Smart CDN caches the response, and "that cached response can continue
 * to be served for the same signed URL until the CDN cache duration expires,
 * even if the token in that URL has already expired"; the asset is cached
 * "for as long as possible", and the cache is dropped when the object is
 * updated or deleted (up to 60 seconds to propagate). So for a viewer who
 * already opened the story, the real cutoff is the OBJECT going: a provider's
 * delete, or the expiry, which the media purge now acts on at its first
 * ten-minute tick past the 24 hours (story_objects_to_purge, 151), and a
 * block, which deletes nothing, does not cut off a URL the blocked viewer
 * already holds; they could as well have kept the bytes. A new URL is never
 * minted for them. Streaming the bytes through here with `no-store` would
 * close it, at the cost of every view passing through a function; not done,
 * and stated.
 * https://supabase.com/docs/guides/storage/cdn/smart-cdn
 *
 * Mint it on open, not on render, for voice.ts's reason: every URL is a
 * credential with a lifetime.
 */
import { createClient } from 'jsr:@supabase/supabase-js@2';

const BUCKET = 'stories';
/** The ceiling, and the usual lifetime. Sixty seconds, as src/api/voice.ts. */
const TTL_SECONDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface StoryRow {
  media_path: string;
  media_type: 'image' | 'video';
  expires_at: string;
}

Deno.serve(async (request: Request) => {
  if (request.method !== 'POST') {
    return Response.json({ error: 'method not allowed' }, { status: 405 });
  }

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) {
    return Response.json({ error: 'not configured' }, { status: 500 });
  }

  // The caller's own client: every query below runs under their RLS.
  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: request.headers.get('Authorization') ?? '' } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }

  let storyId = '';
  try {
    const body = (await request.json()) as { story_id?: unknown };
    storyId = typeof body.story_id === 'string' ? body.story_id : '';
  } catch {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }
  if (!UUID.test(storyId)) {
    return Response.json({ error: 'bad request' }, { status: 400 });
  }

  // THE authorization. One answer for missing, expired, blocked and not an
  // audience alike, as the story RPCs give NOT_FOUND for all of them.
  const { data, error } = await userClient
    .from('stories')
    .select('media_path,media_type,expires_at')
    .eq('id', storyId)
    .maybeSingle();
  if (error) {
    console.error(`story authorization query failed: ${error.code}`);
    return Response.json({ error: 'authorization failed' }, { status: 500 });
  }
  const story = data as StoryRow | null;
  if (!story) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  // Never past the 24 hours: a story ten seconds from expiry gets a URL good
  // for ten seconds.
  const left = Math.floor((Date.parse(story.expires_at) - Date.now()) / 1000);
  const ttl = Math.min(TTL_SECONDS, left);
  if (!Number.isFinite(ttl) || ttl < 1) {
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signed, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUrl(story.media_path, ttl);
  if (signError || !signed) {
    // The row is live, so the object should be there; say so in the log, and
    // tell the client only that there is nothing to show.
    console.error(`story media sign failed for ${storyId}`);
    return Response.json({ error: 'not found' }, { status: 404 });
  }

  return Response.json({
    url: signed.signedUrl,
    media_type: story.media_type,
    expires_in: ttl,
  });
});
